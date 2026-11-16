import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import type { Pool, PoolClient } from 'pg';

export const SQLITE_FOUNDATION_MAPPING_VERSION = 1;
export class SqliteImportError extends Error {
  constructor(message: string) { super(message); this.name = 'SqliteImportError'; }
}
export interface ImportedUser { id: string; email: string; name: string; createdAt: number }
export interface ImportedAgent { id: string; name: string; profile: Record<string, unknown>; createdAt: number; updatedAt: number }
export interface ImportCounts {
  users: number; agents: number; excludedRooms: number;
  sourceTables: Record<string, number>; unmappedTables: Record<string, number>;
}
export interface SqliteFoundationSnapshot {
  mappingVersion: number; sourceDigest: string; fingerprintScope: string;
  user: ImportedUser; agents: ImportedAgent[]; counts: ImportCounts;
}
export interface SqliteImportOptions {
  sourcePath: string;
  organizationId: string; organizationSlug: string; organizationName: string;
  workspaceId: string; workspaceName: string;
  apply?: boolean;
}
export interface SqliteImportReport {
  status: 'dry_run' | 'imported' | 'already_imported';
  mappingVersion: number; sourceDigest: string; fingerprintScope: string;
  organizationId: string; workspaceId: string; counts: ImportCounts;
  runtimeState: 'inactive_metadata_only'; receiptId: string | null;
}

const fingerprintScope = 'all user-defined table schemas and row digests in one read-only SQLite snapshot; not a raw file digest';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function canonical(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify({ integer: value.toString() });
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify({ real: String(value) });
  if (Buffer.isBuffer(value)) return JSON.stringify({ blob: value.toString('hex') });
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown): string { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function text(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) throw new SqliteImportError(`Invalid ${field}; no import was performed.`);
  return value;
}
function timestamp(value: unknown, field: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw new SqliteImportError(`Invalid ${field}; no import was performed.`);
  return number;
}
function validateTarget(options: SqliteImportOptions): void {
  text(options.organizationId, 'organization ID'); text(options.workspaceId, 'workspace ID');
  text(options.organizationName, 'organization name'); text(options.workspaceName, 'workspace name');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(options.organizationSlug)) throw new SqliteImportError('Invalid organization slug; no import was performed.');
}

function offlineRollbackSource(sourcePath: string): string {
  const resolved = fs.realpathSync(sourcePath);
  const descriptor = fs.openSync(resolved, 'r');
  const header = Buffer.alloc(32);
  try {
    if (!fs.fstatSync(descriptor).isFile() || fs.readSync(descriptor, header, 0, header.length, 0) !== header.length ||
        header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') throw new SqliteImportError('Source is not a supported SQLite database backup.');
  } finally { fs.closeSync(descriptor); }
  if (header[18] !== 1 || header[19] !== 1 || ['-wal', '-shm', '-journal'].some(suffix => fs.existsSync(resolved + suffix))) {
    throw new SqliteImportError('Source must be a stopped, checkpointed rollback-journal backup. Create an offline rollback-journal backup before inspecting; this tool never checkpoints or changes the source journal mode.');
  }
  return resolved;
}

/** Requires a stopped rollback-journal backup; WAL inputs are rejected before SQLite opens. */
export function inspectSqliteSource(sourcePath: string): SqliteFoundationSnapshot {
  let source: Database.Database | undefined;
  try {
    const offlineSource = offlineRollbackSource(sourcePath);
    source = new Database(offlineSource, { readonly: true, fileMustExist: true });
    source.defaultSafeIntegers(true);
    source.pragma('query_only = ON');
    source.exec('BEGIN');
    const schemas = source.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
    if (!schemas.some(table => table.name === 'users') || !schemas.some(table => table.name === 'bots')) throw new SqliteImportError('Source must contain the users and bots tables.');
    const sourceTables: Record<string, number> = Object.create(null);
    const tables: { name: string; schema: string; rows: string[] }[] = [];
    for (const schema of schemas) {
      if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(schema.sql)) throw new SqliteImportError('Virtual source tables require a separately reviewed exporter.');
      const rows: string[] = [];
      for (const row of source.prepare(`SELECT * FROM ${quote(schema.name)}`).iterate()) rows.push(digest(row));
      rows.sort(); sourceTables[schema.name] = rows.length;
      tables.push({ name: schema.name, schema: schema.sql, rows });
    }
    const users = source.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
    if (users.length !== 1) throw new SqliteImportError('Staging import requires exactly one source user; separate ambiguous legacy accounts before importing.');
    const row = users[0];
    const email = text(row.email, 'source email', 254).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new SqliteImportError('Invalid source email; no import was performed.');
    const user: ImportedUser = { id: text(row.id, 'source user ID'), email, name: text(row.name, 'source user name'), createdAt: timestamp(row.created_at, 'source user creation time') };
    const bots = source.prepare('SELECT * FROM bots ORDER BY id').all() as Record<string, unknown>[];
    const agents: ImportedAgent[] = [];
    let excludedRooms = 0;
    for (const bot of bots) {
      if (bot.user_id !== user.id) throw new SqliteImportError('Source contains an agent owned by another or missing account; no import was performed.');
      if (bot.kind === 'room') { excludedRooms++; continue; }
      if (bot.kind !== undefined && bot.kind !== null && bot.kind !== 'agent') throw new SqliteImportError('Unknown source bot kind; no import was performed.');
      const createdAt = timestamp(bot.created_at, 'source agent creation time');
      const updatedAt = timestamp(bot.updated_at, 'source agent update time');
      if (updatedAt < createdAt) throw new SqliteImportError('Source agent update precedes creation; no import was performed.');
      const profile: Record<string, unknown> = { importState: 'inactive_metadata_only' };
      // Credentials, instructions, model selections, runtime references, sessions,
      // browser profiles, computer IDs and provider grants are deliberately omitted.
      for (const key of ['label', 'description', 'avatar_shape', 'avatar_color', 'mode', 'effort', 'voice', 'voice_language']) {
        if (typeof bot[key] === 'string') profile[key] = bot[key];
      }
      if (typeof bot.voice_speed === 'number' && Number.isFinite(bot.voice_speed)) profile.voice_speed = bot.voice_speed;
      agents.push({ id: text(bot.id, 'source agent ID'), name: text(bot.name, 'source agent name'), profile, createdAt, updatedAt });
    }
    const unmappedTables = Object.fromEntries(Object.entries(sourceTables).filter(([name]) => name !== 'users' && name !== 'bots'));
    const snapshot: SqliteFoundationSnapshot = {
      mappingVersion: SQLITE_FOUNDATION_MAPPING_VERSION, fingerprintScope,
      sourceDigest: digest({ mappingVersion: SQLITE_FOUNDATION_MAPPING_VERSION, tables }), user, agents,
      counts: { users: 1, agents: agents.length, excludedRooms, sourceTables, unmappedTables },
    };
    source.exec('ROLLBACK');
    return snapshot;
  } catch (error) {
    if (error instanceof SqliteImportError) throw error;
    throw new SqliteImportError('Could not inspect the SQLite source in read-only mode; no import was performed.');
  } finally { source?.close(); }
}

function targetMetadata(options: SqliteImportOptions, snapshot: SqliteFoundationSnapshot) {
  return { organizationId: options.organizationId, organizationSlug: options.organizationSlug, organizationName: options.organizationName,
    workspaceId: options.workspaceId, workspaceName: options.workspaceName, userId: snapshot.user.id,
    fingerprintScope, runtimeState: 'inactive_metadata_only', recordsDigest: digest({ user: snapshot.user, agents: snapshot.agents }) };
}
async function verifyExisting(client: PoolClient, options: SqliteImportOptions, snapshot: SqliteFoundationSnapshot, receipt: Record<string, unknown>): Promise<void> {
  if (receipt.mapping_version !== SQLITE_FOUNDATION_MAPPING_VERSION || canonical(receipt.metadata) !== canonical(targetMetadata(options, snapshot)) || canonical(receipt.counts) !== canonical(snapshot.counts)) throw new SqliteImportError('Existing receipt does not match this mapping or target; no import was performed.');
  const user = (await client.query('SELECT id,email,name,created_at FROM uap.users WHERE id=$1', [snapshot.user.id])).rows[0];
  const organization = (await client.query('SELECT id,slug,name,created_at FROM uap.organizations WHERE id=$1', [options.organizationId])).rows[0];
  const workspace = (await client.query('SELECT id,organization_id,name,created_at FROM uap.workspaces WHERE organization_id=$1 AND id=$2', [options.organizationId, options.workspaceId])).rows[0];
  const membership = (await client.query('SELECT organization_id,user_id,role,state,created_at FROM uap.memberships WHERE organization_id=$1', [options.organizationId])).rows;
  const agents = (await client.query('SELECT id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at FROM uap.agents WHERE organization_id=$1 ORDER BY id', [options.organizationId])).rows;
  const expectedTime = String(snapshot.user.createdAt);
  if (!user || user.email !== snapshot.user.email || user.name !== snapshot.user.name || String(user.created_at) !== expectedTime ||
      !organization || organization.slug !== options.organizationSlug || organization.name !== options.organizationName || String(organization.created_at) !== expectedTime ||
      !workspace || workspace.organization_id !== options.organizationId || workspace.name !== options.workspaceName || String(workspace.created_at) !== expectedTime ||
      membership.length !== 1 || membership[0].user_id !== snapshot.user.id || membership[0].role !== 'owner' || membership[0].state !== 'active' || String(membership[0].created_at) !== expectedTime ||
      agents.length !== snapshot.agents.length) throw new SqliteImportError('Imported target records have changed; idempotent verification failed.');
  const expectedAgents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
  for (let index = 0; index < agents.length; index++) {
    const actual = agents[index]; const expected = expectedAgents.get(actual.id);
    if (!expected) throw new SqliteImportError('Imported target records have changed; idempotent verification failed.');
    if (actual.id !== expected.id || actual.workspace_id !== options.workspaceId || actual.owner_user_id !== snapshot.user.id || actual.name !== expected.name ||
        canonical(actual.profile) !== canonical(expected.profile) || String(actual.created_at) !== String(expected.createdAt) || String(actual.updated_at) !== String(expected.updatedAt)) throw new SqliteImportError('Imported target records have changed; idempotent verification failed.');
  }
}

/** Operator-only metadata staging. apply=false does not connect to PostgreSQL. */
export async function importSqliteFoundation(adminPool: Pool | null, options: SqliteImportOptions): Promise<SqliteImportReport> {
  validateTarget(options);
  const snapshot = inspectSqliteSource(options.sourcePath);
  const report: SqliteImportReport = { status: 'dry_run', mappingVersion: snapshot.mappingVersion, sourceDigest: snapshot.sourceDigest,
    fingerprintScope, organizationId: options.organizationId, workspaceId: options.workspaceId, counts: snapshot.counts,
    runtimeState: 'inactive_metadata_only', receiptId: null };
  if (options.apply !== true) return report;
  if (!adminPool) throw new SqliteImportError('An explicitly privileged administrator connection is required to apply a staging import.');
  let client: PoolClient;
  try { client = await adminPool.connect(); }
  catch { throw new SqliteImportError('Could not connect to the administrator staging database; no import was performed.'); }
  let transaction = false;
  let discardClient = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); transaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SET LOCAL row_security = off');
    const operator = (await client.query('SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user')).rows[0];
    if (!operator?.permitted) throw new SqliteImportError('Import requires an explicitly privileged operator connection with RLS bypass; application credentials are not accepted.');
    await client.query('SELECT pg_advisory_xact_lock(21442, 2)');
    const receipts = (await client.query('SELECT id,mapping_version,counts,metadata FROM uap.import_receipts WHERE organization_id=$1 AND source_digest=$2', [options.organizationId, snapshot.sourceDigest])).rows;
    if (receipts.length) {
      await verifyExisting(client, options, snapshot, receipts[0]);
      await client.query('COMMIT'); transaction = false;
      return { ...report, status: 'already_imported', receiptId: receipts[0].id };
    }
    const ids = snapshot.agents.map(agent => agent.id);
    const collision = await client.query(`SELECT EXISTS(SELECT 1 FROM uap.users WHERE id=$1 OR email=$2)
      OR EXISTS(SELECT 1 FROM uap.organizations WHERE id=$3 OR slug=$4)
      OR EXISTS(SELECT 1 FROM uap.workspaces WHERE organization_id=$3 AND id=$5)
      OR EXISTS(SELECT 1 FROM uap.agents WHERE organization_id=$3 AND id=ANY($6::text[])) AS exists`, [snapshot.user.id, snapshot.user.email, options.organizationId, options.organizationSlug, options.workspaceId, ids]);
    if (collision.rows[0].exists) throw new SqliteImportError('Target identity, organization, workspace or agent already exists without an identical verified receipt; no records were merged.');
    const user = snapshot.user;
    await client.query('INSERT INTO uap.users(id,email,name,created_at) VALUES($1,$2,$3,$4)', [user.id, user.email, user.name, user.createdAt]);
    await client.query('INSERT INTO uap.organizations(id,slug,name,created_at) VALUES($1,$2,$3,$4)', [options.organizationId, options.organizationSlug, options.organizationName, user.createdAt]);
    await client.query("INSERT INTO uap.memberships(organization_id,user_id,role,state,created_at) VALUES($1,$2,'owner','active',$3)", [options.organizationId, user.id, user.createdAt]);
    await client.query('INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES($1,$2,$3,$4)', [options.workspaceId, options.organizationId, options.workspaceName, user.createdAt]);
    for (const agent of snapshot.agents) await client.query('INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)', [agent.id, options.organizationId, options.workspaceId, user.id, agent.name, JSON.stringify(agent.profile), agent.createdAt, agent.updatedAt]);
    const receiptId = `import_${crypto.randomUUID()}`;
    await client.query('INSERT INTO uap.import_receipts(id,organization_id,source_digest,mapping_version,counts,metadata,imported_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)', [receiptId, options.organizationId, snapshot.sourceDigest, SQLITE_FOUNDATION_MAPPING_VERSION, JSON.stringify(snapshot.counts), JSON.stringify(targetMetadata(options, snapshot)), Date.now()]);
    await client.query('COMMIT'); transaction = false;
    return { ...report, status: 'imported', receiptId };
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { discardClient = true; }
    }
    if (error instanceof SqliteImportError) throw error;
    throw new SqliteImportError('PostgreSQL staging import failed and was rolled back; inspect operator diagnostics without publishing database details.');
  } finally { client.release(discardClient); }
}
