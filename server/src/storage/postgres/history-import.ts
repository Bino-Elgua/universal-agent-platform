import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { SqliteImportError, withSqliteFoundationSnapshot, verifyFoundationImport, validateSqliteImportTarget, type SqliteFoundationSnapshot, type SqliteImportOptions } from './import.js';

export const SQLITE_HISTORY_MAPPING_VERSION = 1;
type SourceKind = 'message' | 'tool-call' | 'activity' | 'card' | 'event' | 'notice';
interface StagedConversation { agentId: string; generation: number; nextSeq: number; revision: number; createdAt: number; updatedAt: number }
interface StagedRow { agentId: string; generation: number; seq: number; updatedRevision: number; kind: SourceKind; body: Record<string, unknown>; createdAt: number }
interface StagedItem { agentId: string; generation: number; idx: number; item: Record<string, unknown> }
export interface HistoryImportCounts { conversations: number; rows: number; historyItems: number; excludedRoomRows: number; excludedRoomHistoryItems: number; unmappedTables: Record<string, number> }
interface HistorySnapshot { foundation: SqliteFoundationSnapshot; conversations: StagedConversation[]; rows: StagedRow[]; items: StagedItem[]; counts: HistoryImportCounts }
export interface HistoryImportReport {
  status: 'dry_run' | 'applied' | 'already_imported'; mappingVersion: number; sourceDigest: string;
  organizationId: string; workspaceId: string; counts: HistoryImportCounts;
  runtimeState: 'inactive_history_only'; receiptId: string | null;
}
const kinds = new Set<SourceKind>(['message','tool-call','activity','card','event','notice']);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const digest = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function integer(value: unknown, field: string, minimum = 0): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum) throw new SqliteImportError(`Invalid history ${field}; no history was imported.`);
  return number;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 200 || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) throw new SqliteImportError('Invalid history agent identity; no history was imported.');
  return value;
}
function numberForm(token: string): string {
  const match = token.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/)!;
  let coefficient = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!coefficient) return '0';
  let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
  const trailing = coefficient.match(/0+$/)?.[0].length ?? 0;
  if (trailing) { coefficient = coefficient.slice(0, -trailing); exponent += BigInt(trailing); }
  return `${match[1]}${coefficient}e${exponent}`;
}
/** Reject JSON that cannot survive the application's JSON/JSONB boundary losslessly. */
function jsonObject(raw: unknown, maximumBytes = 1024 * 1024): Record<string, unknown> {
  const failure = () => new SqliteImportError('History JSON is invalid, ambiguous, too large or cannot be represented losslessly; no history was imported.');
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maximumBytes) throw failure();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw failure(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  // Detect duplicate keys and lossy numeric literals before the parser's result is used.
  const stack: { object: boolean; key: boolean; keys: Set<string> }[] = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index;
      for (index++; index < raw.length; index++) { if (raw[index] === '\\') { index++; continue; } if (raw[index] === '"') break; }
      const top = stack.at(-1);
      if (top?.object && top.key) {
        const key = JSON.parse(raw.slice(start, index + 1));
        if (top.keys.has(key)) throw failure(); top.keys.add(key); top.key = false;
      }
    } else if (char === '{' || char === '[') stack.push({ object: char === '{', key: char === '{', keys: new Set() });
    else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.object) stack.at(-1)!.key = true;
    else if (char === '-' || /[0-9]/.test(char)) {
      const token = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)![0];
      const number = Number(token);
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)) || numberForm(token) !== numberForm(JSON.stringify(number))) throw failure();
      index += token.length - 1;
    }
  }
  let nodes = 0;
  const validate = (child: unknown, depth = 0): void => {
    if (++nodes > 30000 || depth > 32) throw failure();
    if (typeof child === 'string' && (child.includes('\0') || /[\uD800-\uDFFF]/u.test(child))) throw failure();
    if (Array.isArray(child)) for (const entry of child) validate(entry, depth + 1);
    else if (child && typeof child === 'object') for (const [key, entry] of Object.entries(child)) { validate(key, depth + 1); validate(entry, depth + 1); }
  };
  validate(value); return value as Record<string, unknown>;
}
function inspectHistory(sourcePath: string): HistorySnapshot {
  return withSqliteFoundationSnapshot(sourcePath, (source, foundation) => {
    const agents = new Map(foundation.agents.map(agent => [agent.id, agent]));
    const botColumns = source.prepare('PRAGMA table_info(bots)').all() as { name: string }[];
    const kindColumn = botColumns.some(column => column.name === 'kind') ? 'kind' : "'agent' AS kind";
    const bots = source.prepare(`SELECT id,${kindColumn},generation FROM bots ORDER BY id`).all() as { id: string; kind: string | null; generation: unknown }[];
    const botKinds = new Map(bots.map(bot => [bot.id, bot.kind]));
    const currentGenerations = new Map<string, number>();
    const conversations = new Map<string, StagedConversation>();
    const key = (agentId: string, generation: number) => canonical([agentId, generation]);
    const ensureConversation = (agentId: string, generation: number): StagedConversation => {
      const agent = agents.get(agentId);
      if (!agent || generation > currentGenerations.get(agentId)!) throw new SqliteImportError('History refers to a missing agent or future conversation generation; no history was imported.');
      const identity = key(agentId, generation);
      let conversation = conversations.get(identity);
      if (!conversation) { conversation = { agentId, generation, nextSeq: 1, revision: 0, createdAt: agent.createdAt, updatedAt: agent.updatedAt }; conversations.set(identity, conversation); }
      return conversation;
    };
    for (const bot of bots) if (agents.has(bot.id)) currentGenerations.set(bot.id, integer(bot.generation, 'current generation', 1));
    for (const [agentId, generation] of currentGenerations) ensureConversation(agentId, generation);
    const rows: StagedRow[] = []; const items: StagedItem[] = [];
    const rowKeys = new Set<string>(); const revisionKeys = new Set<string>(); const itemKeys = new Set<string>();
    let excludedRoomRows = 0; let excludedRoomHistoryItems = 0;
    for (const record of source.prepare('SELECT bot_id,generation,seq,updated_seq,kind,body,created_at FROM rows ORDER BY bot_id,generation,seq').iterate() as Iterable<Record<string, unknown>>) {
      const agentId = id(record.bot_id);
      if (!botKinds.has(agentId)) throw new SqliteImportError('History has an unowned transcript row; no history was imported.');
      if (botKinds.get(agentId) === 'room') { excludedRoomRows++; continue; }
      const generation = integer(record.generation, 'row generation', 1); const seq = integer(record.seq, 'row sequence', 1);
      const updatedRevision = integer(record.updated_seq, 'row revision', 1); const createdAt = integer(record.created_at, 'row creation time');
      if (!kinds.has(record.kind as SourceKind)) throw new SqliteImportError('Unknown history transcript kind; no history was imported.');
      const kind = record.kind as SourceKind; const body = jsonObject(record.body);
      if (body.type !== kind) throw new SqliteImportError('History row kind and JSON body type disagree; no history was imported.');
      const identity = canonical([agentId,generation,seq]);
      if (rowKeys.has(identity)) throw new SqliteImportError('Duplicate history transcript identity; no history was imported.'); rowKeys.add(identity);
      const revisionIdentity = canonical([agentId,generation,updatedRevision]);
      if (revisionKeys.has(revisionIdentity)) throw new SqliteImportError('Duplicate history row revisions make revision pagination ambiguous; no history was imported.'); revisionKeys.add(revisionIdentity);
      if (seq === Number.MAX_SAFE_INTEGER) throw new SqliteImportError('History sequence has no safe next value; no history was imported.');
      const conversation = ensureConversation(agentId, generation);
      conversation.nextSeq = Math.max(conversation.nextSeq, seq + 1); conversation.revision = Math.max(conversation.revision, updatedRevision, seq);
      conversation.createdAt = Math.min(conversation.createdAt, createdAt); conversation.updatedAt = Math.max(conversation.updatedAt, createdAt);
      rows.push({ agentId,generation,seq,updatedRevision,kind,body,createdAt });
    }
    for (const record of source.prepare('SELECT bot_id,generation,idx,item FROM llm_items ORDER BY bot_id,generation,idx').iterate() as Iterable<Record<string, unknown>>) {
      const agentId = id(record.bot_id);
      if (!botKinds.has(agentId)) throw new SqliteImportError('History has an unowned LLM item; no history was imported.');
      if (botKinds.get(agentId) === 'room') { excludedRoomHistoryItems++; continue; }
      const generation = integer(record.generation, 'LLM generation', 1); const idx = integer(record.idx, 'LLM item index');
      ensureConversation(agentId, generation); const item = jsonObject(record.item);
      const identity = canonical([agentId,generation,idx]);
      if (itemKeys.has(identity)) throw new SqliteImportError('Duplicate history LLM item identity; no history was imported.'); itemKeys.add(identity);
      items.push({ agentId,generation,idx,item });
    }
    const unmappedTables = Object.fromEntries(Object.entries(foundation.counts.unmappedTables).filter(([table]) => table !== 'rows' && table !== 'llm_items'));
    return { foundation, conversations: [...conversations.values()], rows, items,
      counts: { conversations: conversations.size, rows: rows.length, historyItems: items.length, excludedRoomRows, excludedRoomHistoryItems, unmappedTables } };
  });
}
function metadata(options: SqliteImportOptions, snapshot: HistorySnapshot, foundationReceiptId: string) {
  return { foundationReceiptId, organizationId: options.organizationId, workspaceId: options.workspaceId,
    runtimeState: 'inactive_history_only', historyDigest: digest({ conversations: snapshot.conversations, rows: snapshot.rows, items: snapshot.items }),
    timestampDerivation: 'Conversation bounds use source agent and transcript timestamps; exact historical session timestamps are unavailable.',
    sourceFingerprintScope: snapshot.foundation.fingerprintScope };
}
async function verifyHistory(client: PoolClient, options: SqliteImportOptions, snapshot: HistorySnapshot): Promise<void> {
  const agentIds = snapshot.foundation.agents.map(agent => agent.id);
  const conversations = (await client.query('SELECT agent_id,generation,next_seq,revision,created_at,updated_at FROM uap.conversations WHERE organization_id=$1 AND agent_id=ANY($2::text[])', [options.organizationId,agentIds])).rows.map(row => ({ agentId: row.agent_id, generation: Number(row.generation), nextSeq: Number(row.next_seq), revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }));
  const rows = (await client.query('SELECT agent_id,generation,seq,updated_revision,kind,body::text AS body_json,created_at,idempotency_key,idempotency_digest FROM uap.message_rows WHERE organization_id=$1 AND agent_id=ANY($2::text[])', [options.organizationId,agentIds])).rows;
  const items = (await client.query('SELECT agent_id,generation,idx,item::text AS item_json FROM uap.llm_items WHERE organization_id=$1 AND agent_id=ANY($2::text[])', [options.organizationId,agentIds])).rows.map(row => ({ agentId: row.agent_id, generation: Number(row.generation), idx: Number(row.idx), item: jsonObject(row.item_json, 2 * 1024 * 1024) }));
  if (rows.some(row => row.idempotency_key !== null || row.idempotency_digest !== null)) throw new SqliteImportError('Imported history has changed; receipt verification failed.');
  const mappedRows = rows.map(row => ({ agentId: row.agent_id, generation: Number(row.generation), seq: Number(row.seq), updatedRevision: Number(row.updated_revision), kind: row.kind, body: jsonObject(row.body_json, 2 * 1024 * 1024), createdAt: Number(row.created_at) }));
  const same = (actual: unknown[], expected: unknown[]) => canonical(actual.map(canonical).sort()) === canonical(expected.map(canonical).sort());
  if (!same(conversations,snapshot.conversations) || !same(mappedRows,snapshot.rows) || !same(items,snapshot.items)) throw new SqliteImportError('Imported history has changed; receipt verification failed.');
}
/** Counts-only report. No transcript or model context is emitted by operator dry runs. */
export async function importSqliteHistory(adminPool: Pool | null, options: SqliteImportOptions): Promise<HistoryImportReport> {
  validateSqliteImportTarget(options);
  const snapshot = inspectHistory(options.sourcePath);
  const report: HistoryImportReport = { status: 'dry_run', mappingVersion: SQLITE_HISTORY_MAPPING_VERSION, sourceDigest: snapshot.foundation.sourceDigest,
    organizationId: options.organizationId, workspaceId: options.workspaceId, counts: snapshot.counts, runtimeState: 'inactive_history_only', receiptId: null };
  if (options.apply !== true) return report;
  if (!adminPool) throw new SqliteImportError('An explicitly privileged administrator connection is required to stage history.');
  let client: PoolClient;
  try { client = await adminPool.connect(); } catch { throw new SqliteImportError('Could not connect to the history staging database.'); }
  let transaction = false; let discardClient = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); transaction = true;
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='30s'"); await client.query('SET LOCAL row_security=off');
    const operator = (await client.query('SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user')).rows[0];
    if (!operator?.permitted) throw new SqliteImportError('History staging requires an explicitly privileged operator; application credentials are not accepted.');
    await client.query('SELECT pg_advisory_xact_lock(21442, 2)');
    const foundationReceiptId = await verifyFoundationImport(client, options, snapshot.foundation);
    const receipts = (await client.query('SELECT id,mapping_version,counts,metadata FROM uap.history_import_receipts WHERE organization_id=$1 AND source_digest=$2', [options.organizationId,snapshot.foundation.sourceDigest])).rows;
    const expectedMetadata = metadata(options,snapshot,foundationReceiptId);
    if (receipts.length) {
      const receipt = receipts[0];
      const exactReceipt = (await client.query('SELECT counts=$1::jsonb AS counts_match,metadata=$2::jsonb AS metadata_match FROM uap.history_import_receipts WHERE organization_id=$3 AND id=$4', [JSON.stringify(snapshot.counts),JSON.stringify(expectedMetadata),options.organizationId,receipt.id])).rows[0];
      if (receipt.mapping_version !== SQLITE_HISTORY_MAPPING_VERSION || !exactReceipt?.counts_match || !exactReceipt?.metadata_match || canonical(receipt.counts) !== canonical(snapshot.counts) || canonical(receipt.metadata) !== canonical(expectedMetadata)) throw new SqliteImportError('History receipt mapping or counts do not match; no history was changed.');
      await verifyHistory(client,options,snapshot); await client.query('COMMIT'); transaction = false;
      return { ...report, status: 'already_imported', receiptId: receipt.id };
    }
    const agentIds = snapshot.foundation.agents.map(agent => agent.id);
    const collision = (await client.query(`SELECT EXISTS(SELECT 1 FROM uap.conversations WHERE organization_id=$1 AND agent_id=ANY($2::text[])) OR
      EXISTS(SELECT 1 FROM uap.message_rows WHERE organization_id=$1 AND agent_id=ANY($2::text[])) OR
      EXISTS(SELECT 1 FROM uap.llm_items WHERE organization_id=$1 AND agent_id=ANY($2::text[])) AS exists`, [options.organizationId,agentIds])).rows[0];
    if (collision.exists) throw new SqliteImportError('Target history exists without an identical verified receipt; no history was merged.');
    for (const record of snapshot.conversations) await client.query('INSERT INTO uap.conversations(organization_id,agent_id,generation,next_seq,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [options.organizationId,record.agentId,record.generation,record.nextSeq,record.revision,record.createdAt,record.updatedAt]);
    for (const record of snapshot.rows) await client.query('INSERT INTO uap.message_rows(organization_id,agent_id,generation,seq,updated_revision,kind,body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [options.organizationId,record.agentId,record.generation,record.seq,record.updatedRevision,record.kind,JSON.stringify(record.body),record.createdAt]);
    for (const record of snapshot.items) await client.query('INSERT INTO uap.llm_items(organization_id,agent_id,generation,idx,item) VALUES($1,$2,$3,$4,$5::jsonb)', [options.organizationId,record.agentId,record.generation,record.idx,JSON.stringify(record.item)]);
    const receiptId = `history_import_${crypto.randomUUID()}`;
    await client.query('INSERT INTO uap.history_import_receipts(organization_id,id,source_digest,mapping_version,counts,metadata,imported_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [options.organizationId,receiptId,snapshot.foundation.sourceDigest,SQLITE_HISTORY_MAPPING_VERSION,JSON.stringify(snapshot.counts),JSON.stringify(expectedMetadata),Date.now()]);
    await client.query('COMMIT'); transaction = false; return { ...report, status: 'applied', receiptId };
  } catch (error) {
    if (transaction) { try { await client.query('ROLLBACK'); } catch { discardClient = true; } }
    if (error instanceof SqliteImportError) throw error;
    throw new SqliteImportError('Conversation history staging failed and was rolled back; no history report contains source bodies or database details.');
  } finally { client.release(discardClient); }
}
