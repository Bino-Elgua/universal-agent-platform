import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { TenantAccessError, withTenant, type TenantScope } from './connection.js';
import { RepositoryConstraintError, RepositoryValidationError } from './repository.js';

export type MessageRowKind = 'message' | 'activity' | 'card' | 'event' | 'tool-call' | 'notice';
export interface ConversationRecord {
  organizationId: string;
  agentId: string;
  generation: number;
  nextSeq: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export interface MessageRowRecord {
  organizationId: string;
  agentId: string;
  generation: number;
  seq: number;
  updatedRevision: number;
  kind: MessageRowKind;
  body: Record<string, unknown>;
  createdAt: number;
  idempotencyKey: string | null;
}
export interface HistoryItemRecord {
  organizationId: string;
  agentId: string;
  generation: number;
  idx: number;
  item: Record<string, unknown>;
}
export interface AppendRowInput {
  agentId: string;
  generation: number;
  kind: MessageRowKind;
  body: Record<string, unknown>;
  idempotencyKey?: string;
}
export interface UpdateRowInput { agentId: string; generation: number; seq: number; body: Record<string, unknown> }
export interface ListRowsInput { agentId: string; generation: number; beforeSeq?: number; afterRevision?: number; limit?: number }
export interface AppendHistoryInput { agentId: string; generation: number; items: Record<string, unknown>[] }
export interface ListHistoryInput { agentId: string; generation: number; afterIndex?: number; limit?: number }

interface ConversationRow {
  organization_id: string; agent_id: string; generation: string;
  next_seq: string; revision: string; created_at: string; updated_at: string;
}
interface MessageRow {
  organization_id: string; agent_id: string; generation: string; seq: string;
  updated_revision: string; kind: MessageRowKind; body: Record<string, unknown>;
  created_at: string; idempotency_key: string | null; idempotency_digest: string | null;
}
interface HistoryRow { organization_id: string; agent_id: string; generation: string; idx: string; item: Record<string, unknown> }
const CONVERSATION_COLUMNS = 'organization_id,agent_id,generation,next_seq,revision,created_at,updated_at';
const MESSAGE_COLUMNS = 'organization_id,agent_id,generation,seq,updated_revision,kind,body,created_at,idempotency_key,idempotency_digest';

function fields(input: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new RepositoryValidationError(field);
  }
  return input as Record<string, unknown>;
}
function identifier(input: unknown, field: string): string {
  if (typeof input !== 'string' || !input.length || input.length > 200 || input.includes('\0') || /[\uD800-\uDFFF]/u.test(input)) {
    throw new RepositoryValidationError(field);
  }
  return input;
}
function integer(input: unknown, field: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || input > maximum) throw new RepositoryValidationError(field);
  return input;
}
function storedInteger(input: string | number): number {
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Stored conversation values cannot be represented safely.');
  return value;
}
function jsonObject(input: unknown, field: string): string {
  fields(input, Object.keys(input && typeof input === 'object' ? input : {}), field);
  const seen = new Set<object>();
  let nodes = 0;
  function canonical(value: unknown, depth: number): unknown {
    if (++nodes > 30000 || depth > 32) throw new RepositoryValidationError(field);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      if (value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) throw new RepositoryValidationError(field);
      return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value) ||
        (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new RepositoryValidationError(field);
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(child => canonical(child, depth + 1));
    else {
      const object: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value).sort()) {
        if (key.includes('\0') || /[\uD800-\uDFFF]/u.test(key)) throw new RepositoryValidationError(field);
        object[key] = canonical((value as Record<string, unknown>)[key], depth + 1);
      }
      result = object;
    }
    seen.delete(value);
    return result;
  }
  const json = JSON.stringify(canonical(input, 0));
  if (Buffer.byteLength(json, 'utf8') > 1024 * 1024) throw new RepositoryValidationError(field);
  return json;
}
function conversation(row: ConversationRow): ConversationRecord {
  return {
    organizationId: row.organization_id, agentId: row.agent_id, generation: storedInteger(row.generation),
    nextSeq: storedInteger(row.next_seq), revision: storedInteger(row.revision),
    createdAt: storedInteger(row.created_at), updatedAt: storedInteger(row.updated_at),
  };
}
function message(row: MessageRow): MessageRowRecord {
  return {
    organizationId: row.organization_id, agentId: row.agent_id, generation: storedInteger(row.generation), seq: storedInteger(row.seq),
    updatedRevision: storedInteger(row.updated_revision), kind: row.kind, body: row.body,
    createdAt: storedInteger(row.created_at), idempotencyKey: row.idempotency_key,
  };
}
function history(row: HistoryRow): HistoryItemRecord {
  return { organizationId: row.organization_id, agentId: row.agent_id, generation: storedInteger(row.generation), idx: storedInteger(row.idx), item: row.item };
}
async function requireWriter(client: PoolClient, scope: TenantScope): Promise<void> {
  const result = await client.query<{ role: string }>(
    "SELECT role FROM uap.memberships WHERE organization_id=$1 AND user_id=$2 AND state='active'", [scope.organizationId, scope.actorId],
  );
  if (!['owner', 'admin', 'member'].includes(result.rows[0]?.role)) throw new TenantAccessError();
}
async function constraints<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === '23505') throw new RepositoryConstraintError('conflict');
    if (code === '23503') throw new RepositoryConstraintError('invalid_reference');
    if (code === '23514' || code === '23502') throw new RepositoryConstraintError('invalid_value');
    throw error;
  }
}
async function lockConversation(client: PoolClient, scope: TenantScope, agentId: string, generation: number): Promise<ConversationRecord | null> {
  const result = await client.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM uap.conversations WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 FOR UPDATE`,
    [scope.organizationId, agentId, generation],
  );
  return result.rows[0] ? conversation(result.rows[0]) : null;
}
function canIncrement(value: number, amount = 1): void {
  if (value > Number.MAX_SAFE_INTEGER - amount) throw new RepositoryConstraintError('invalid_value');
}

/** Durable history only: these methods neither execute an agent nor emit a runtime event. */
export class ConversationRepository {
  constructor(private readonly pool: Pool) {}

  async createConversation(scope: TenantScope, agentId: string): Promise<ConversationRecord | null> {
    identifier(agentId, 'agentId');
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriter(client, scope);
      const agent = await client.query('SELECT id FROM uap.agents WHERE organization_id=$1 AND id=$2 FOR UPDATE', [scope.organizationId, agentId]);
      if (!agent.rows.length) return null;
      const latest = await client.query<{ generation: string }>('SELECT COALESCE(MAX(generation),0) AS generation FROM uap.conversations WHERE organization_id=$1 AND agent_id=$2', [scope.organizationId, agentId]);
      const generation = storedInteger(latest.rows[0].generation);
      canIncrement(generation);
      const result = await client.query<ConversationRow>(
        `INSERT INTO uap.conversations(organization_id,agent_id,generation,next_seq,revision,created_at,updated_at)
         VALUES ($1,$2,$3,1,0,$4,$4) RETURNING ${CONVERSATION_COLUMNS}`,
        [scope.organizationId, agentId, generation + 1, Date.now()],
      );
      return conversation(result.rows[0]);
    }));
  }

  async getCurrentConversation(scope: TenantScope, agentId: string): Promise<ConversationRecord | null> {
    identifier(agentId, 'agentId');
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<ConversationRow>(
        `SELECT ${CONVERSATION_COLUMNS} FROM uap.conversations WHERE organization_id=$1 AND agent_id=$2 ORDER BY generation DESC LIMIT 1`,
        [scope.organizationId, agentId],
      );
      return result.rows[0] ? conversation(result.rows[0]) : null;
    });
  }

  async getConversation(scope: TenantScope, agentId: string, generation: number): Promise<ConversationRecord | null> {
    identifier(agentId, 'agentId'); integer(generation, 'generation');
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<ConversationRow>(
        `SELECT ${CONVERSATION_COLUMNS} FROM uap.conversations WHERE organization_id=$1 AND agent_id=$2 AND generation=$3`,
        [scope.organizationId, agentId, generation],
      );
      return result.rows[0] ? conversation(result.rows[0]) : null;
    });
  }

  async appendRow(scope: TenantScope, input: AppendRowInput): Promise<MessageRowRecord | null> {
    const values = fields(input, ['agentId', 'generation', 'kind', 'body', 'idempotencyKey'], 'row');
    const agentId = identifier(values.agentId, 'agentId');
    const generation = integer(values.generation, 'generation');
    const kind = values.kind;
    if (!['message', 'activity', 'card', 'event', 'tool-call', 'notice'].includes(kind as string)) throw new RepositoryValidationError('kind');
    const body = jsonObject(values.body, 'body');
    const key = values.idempotencyKey === undefined ? null : identifier(values.idempotencyKey, 'idempotencyKey');
    // This is request deduplication, not a SID/evidence canonicalization or proof.
    const digest = key === null ? null : createHash('sha256').update(`row-v1\0${kind}\0${body}`).digest('hex');
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriter(client, scope);
      const current = await lockConversation(client, scope, agentId, generation);
      if (!current) return null;
      if (key !== null) {
        const prior = await client.query<MessageRow>(
          `SELECT ${MESSAGE_COLUMNS} FROM uap.message_rows WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND idempotency_key=$4`,
          [scope.organizationId, agentId, generation, key],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].idempotency_digest !== digest) throw new RepositoryConstraintError('conflict');
          return message(prior.rows[0]);
        }
      }
      canIncrement(current.nextSeq); canIncrement(current.revision);
      const revision = current.revision + 1;
      await client.query('UPDATE uap.conversations SET next_seq=next_seq+1,revision=revision+1,updated_at=GREATEST(updated_at,$4) WHERE organization_id=$1 AND agent_id=$2 AND generation=$3',
        [scope.organizationId, agentId, generation, Date.now()]);
      const result = await client.query<MessageRow>(
        `INSERT INTO uap.message_rows(organization_id,agent_id,generation,seq,updated_revision,kind,body,created_at,idempotency_key,idempotency_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING ${MESSAGE_COLUMNS}`,
        [scope.organizationId, agentId, generation, current.nextSeq, revision, kind, body, Date.now(), key, digest],
      );
      return message(result.rows[0]);
    }));
  }

  async updateRow(scope: TenantScope, input: UpdateRowInput): Promise<MessageRowRecord | null> {
    const values = fields(input, ['agentId', 'generation', 'seq', 'body'], 'row update');
    const agentId = identifier(values.agentId, 'agentId');
    const generation = integer(values.generation, 'generation');
    const seq = integer(values.seq, 'seq');
    const body = jsonObject(values.body, 'body');
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriter(client, scope);
      const current = await lockConversation(client, scope, agentId, generation);
      if (!current) return null;
      const existing = await client.query('SELECT seq FROM uap.message_rows WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND seq=$4', [scope.organizationId, agentId, generation, seq]);
      if (!existing.rows.length) return null;
      canIncrement(current.revision);
      await client.query('UPDATE uap.conversations SET revision=revision+1,updated_at=GREATEST(updated_at,$4) WHERE organization_id=$1 AND agent_id=$2 AND generation=$3', [scope.organizationId, agentId, generation, Date.now()]);
      const result = await client.query<MessageRow>(
        `UPDATE uap.message_rows SET body=$5::jsonb,updated_revision=$6 WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND seq=$4 RETURNING ${MESSAGE_COLUMNS}`,
        [scope.organizationId, agentId, generation, seq, body, current.revision + 1],
      );
      return message(result.rows[0]);
    }));
  }

  async listRows(scope: TenantScope, input: ListRowsInput): Promise<MessageRowRecord[]> {
    const values = fields(input, ['agentId', 'generation', 'beforeSeq', 'afterRevision', 'limit'], 'row cursor');
    const agentId = identifier(values.agentId, 'agentId');
    const generation = integer(values.generation, 'generation');
    const beforeSeq = values.beforeSeq === undefined ? null : integer(values.beforeSeq, 'beforeSeq');
    const afterRevision = values.afterRevision === undefined ? null : integer(values.afterRevision, 'afterRevision', 0);
    const limit = values.limit === undefined ? 100 : integer(values.limit, 'limit', 1, 500);
    if (beforeSeq !== null && afterRevision !== null) throw new RepositoryValidationError('row cursor');
    return withTenant(this.pool, scope, async client => {
      if (afterRevision !== null) {
        const result = await client.query<MessageRow>(
          `SELECT ${MESSAGE_COLUMNS} FROM uap.message_rows WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND updated_revision>$4 ORDER BY updated_revision,seq LIMIT $5`,
          [scope.organizationId, agentId, generation, afterRevision, limit],
        );
        return result.rows.map(message);
      }
      const result = await client.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM uap.message_rows WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND ($4::bigint IS NULL OR seq<$4) ORDER BY seq DESC LIMIT $5`,
        [scope.organizationId, agentId, generation, beforeSeq, limit],
      );
      return result.rows.reverse().map(message);
    });
  }

  async appendHistory(scope: TenantScope, input: AppendHistoryInput): Promise<HistoryItemRecord[] | null> {
    const values = fields(input, ['agentId', 'generation', 'items'], 'history');
    const agentId = identifier(values.agentId, 'agentId');
    const generation = integer(values.generation, 'generation');
    if (!Array.isArray(values.items) || !values.items.length || values.items.length > 100) throw new RepositoryValidationError('history items');
    const items = values.items.map(value => jsonObject(value, 'history item'));
    if (items.reduce((size, item) => size + Buffer.byteLength(item, 'utf8'), 0) > 4 * 1024 * 1024) throw new RepositoryValidationError('history items');
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriter(client, scope);
      if (!await lockConversation(client, scope, agentId, generation)) return null;
      const maximum = await client.query<{ idx: string }>('SELECT COALESCE(MAX(idx),-1) AS idx FROM uap.llm_items WHERE organization_id=$1 AND agent_id=$2 AND generation=$3', [scope.organizationId, agentId, generation]);
      const start = Number(maximum.rows[0].idx) + 1;
      integer(start, 'stored history index', 0); canIncrement(start, items.length);
      const added: HistoryItemRecord[] = [];
      for (let index = 0; index < items.length; index++) {
        const result = await client.query<HistoryRow>(
          'INSERT INTO uap.llm_items(organization_id,agent_id,generation,idx,item) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING organization_id,agent_id,generation,idx,item',
          [scope.organizationId, agentId, generation, start + index, items[index]],
        );
        added.push(history(result.rows[0]));
      }
      await client.query('UPDATE uap.conversations SET updated_at=GREATEST(updated_at,$4) WHERE organization_id=$1 AND agent_id=$2 AND generation=$3', [scope.organizationId, agentId, generation, Date.now()]);
      return added;
    }));
  }

  async listHistory(scope: TenantScope, input: ListHistoryInput): Promise<HistoryItemRecord[]> {
    const values = fields(input, ['agentId', 'generation', 'afterIndex', 'limit'], 'history cursor');
    const agentId = identifier(values.agentId, 'agentId');
    const generation = integer(values.generation, 'generation');
    const afterIndex = values.afterIndex === undefined ? -1 : integer(values.afterIndex, 'afterIndex', -1);
    const limit = values.limit === undefined ? 100 : integer(values.limit, 'limit', 1, 500);
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<HistoryRow>(
        'SELECT organization_id,agent_id,generation,idx,item FROM uap.llm_items WHERE organization_id=$1 AND agent_id=$2 AND generation=$3 AND idx>$4 ORDER BY idx LIMIT $5',
        [scope.organizationId, agentId, generation, afterIndex, limit],
      );
      return result.rows.map(history);
    });
  }
}
