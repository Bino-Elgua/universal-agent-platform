import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { TenantAccessError, withTenant, type TenantScope } from './connection.js';

export interface WorkspaceRecord {
  id: string;
  organizationId: string;
  name: string;
  createdAt: number;
}

export interface AgentRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  ownerUserId: string;
  name: string;
  profile: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkspaceInput { id?: string; name: string }
export interface CreateAgentInput {
  id?: string;
  workspaceId: string;
  ownerUserId: string;
  name: string;
  profile?: Record<string, unknown>;
}
export interface UpdateAgentInput { name?: string; profile?: Record<string, unknown> }
export interface ListAgentsOptions { workspaceId?: string }

export class RepositoryValidationError extends Error {
  readonly code = 'invalid_repository_input';
  constructor(public readonly field: string) {
    super(`Invalid ${field}.`);
    this.name = 'RepositoryValidationError';
  }
}

/** Safe errors do not disclose another tenant's identifiers or database details. */
export class RepositoryConstraintError extends Error {
  readonly code: 'conflict' | 'invalid_reference' | 'invalid_value';
  constructor(code: RepositoryConstraintError['code']) {
    super(code === 'conflict' ? 'The record already exists.' : code === 'invalid_reference'
      ? 'The referenced record is unavailable in this organization.' : 'The record violates a data constraint.');
    this.code = code;
    this.name = 'RepositoryConstraintError';
  }
}

interface WorkspaceRow { id: string; organization_id: string; name: string; created_at: string | number }
interface AgentRow extends WorkspaceRow {
  workspace_id: string;
  owner_user_id: string;
  profile: Record<string, unknown>;
  updated_at: string | number;
}

function fields(value: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new RepositoryValidationError(field);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RepositoryValidationError(field);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, field: string): string {
  // IDs are opaque and remain byte-for-byte stable across imports; never normalize them.
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || value.includes('\0')) {
    throw new RepositoryValidationError(field);
  }
  return value;
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || value.includes('\0')) {
    throw new RepositoryValidationError('name');
  }
  return value.trim();
}

function profile(value: unknown): string {
  fields(value, Object.keys(value && typeof value === 'object' ? value : {}), 'profile');
  const seen = new Set<object>();
  let members = 0;
  function visit(item: unknown, depth: number): void {
    if (++members > 10000 || depth > 32) throw new RepositoryValidationError('profile');
    if (typeof item === 'string') {
      if (item.includes('\0')) throw new RepositoryValidationError('profile');
      return;
    }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new RepositoryValidationError('profile');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      throw new RepositoryValidationError('profile');
    }
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (key.includes('\0')) throw new RepositoryValidationError('profile');
      visit(child, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > 65536) throw new RepositoryValidationError('profile');
  return json;
}

function timestamp(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('The stored timestamp cannot be represented safely.');
  return result;
}

const workspace = (row: WorkspaceRow): WorkspaceRecord => ({
  id: row.id, organizationId: row.organization_id, name: row.name, createdAt: timestamp(row.created_at),
});
const agent = (row: AgentRow): AgentRecord => ({
  ...workspace(row), workspaceId: row.workspace_id, ownerUserId: row.owner_user_id,
  profile: row.profile, updatedAt: timestamp(row.updated_at),
});

async function constraints<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === '23505') throw new RepositoryConstraintError('conflict');
    if (code === '23503') throw new RepositoryConstraintError('invalid_reference');
    if (code === '23514' || code === '23502') throw new RepositoryConstraintError('invalid_value');
    throw error;
  }
}

async function requireWriteRole(client: PoolClient, scope: TenantScope, roles: readonly string[]): Promise<void> {
  const result = await client.query<{ role: string }>(
    "SELECT role FROM uap.memberships WHERE organization_id=$1 AND user_id=$2 AND state='active'",
    [scope.organizationId, scope.actorId],
  );
  // RLS also checks this independently. An explicit guard gives forbidden writes
  // the same error even when an UPDATE/DELETE policy would simply hide the row.
  if (!result.rows[0] || !roles.includes(result.rows[0].role)) throw new TenantAccessError();
}

/**
 * Metadata repositories only. Callers supply the authenticated actor/organization;
 * neither a requested object ID nor profile prose grants tenant access. Each call
 * obtains a transaction-local context and PostgreSQL independently enforces RLS.
 */
export class TenantRepository {
  constructor(private readonly pool: Pool) {}

  async listWorkspaces(scope: TenantScope): Promise<WorkspaceRecord[]> {
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<WorkspaceRow>(
        'SELECT id, organization_id, name, created_at FROM uap.workspaces WHERE organization_id=$1 ORDER BY created_at,id',
        [scope.organizationId],
      );
      return result.rows.map(workspace);
    });
  }

  async createWorkspace(scope: TenantScope, input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const values = fields(input, ['id', 'name'], 'workspace');
    const id = values.id === undefined ? `ws_${randomUUID()}` : identifier(values.id, 'id');
    const label = name(values.name);
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriteRole(client, scope, ['owner', 'admin']);
      const result = await client.query<WorkspaceRow>(
        'INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES ($1,$2,$3,$4) RETURNING id,organization_id,name,created_at',
        [id, scope.organizationId, label, Date.now()],
      );
      return workspace(result.rows[0]);
    }));
  }

  async listAgents(scope: TenantScope, options: ListAgentsOptions = {}): Promise<AgentRecord[]> {
    const values = fields(options, ['workspaceId'], 'agent filters');
    const workspaceId = values.workspaceId === undefined ? null : identifier(values.workspaceId, 'workspaceId');
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<AgentRow>(
        'SELECT id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at FROM uap.agents WHERE organization_id=$1 AND ($2::text IS NULL OR workspace_id=$2) ORDER BY created_at,id',
        [scope.organizationId, workspaceId],
      );
      return result.rows.map(agent);
    });
  }

  async getAgent(scope: TenantScope, id: string): Promise<AgentRecord | null> {
    identifier(id, 'id');
    return withTenant(this.pool, scope, async client => {
      const result = await client.query<AgentRow>(
        'SELECT id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at FROM uap.agents WHERE organization_id=$1 AND id=$2',
        [scope.organizationId, id],
      );
      return result.rows[0] ? agent(result.rows[0]) : null;
    });
  }

  async createAgent(scope: TenantScope, input: CreateAgentInput): Promise<AgentRecord> {
    const values = fields(input, ['id', 'workspaceId', 'ownerUserId', 'name', 'profile'], 'agent');
    const id = values.id === undefined ? `agent_${randomUUID()}` : identifier(values.id, 'id');
    const workspaceId = identifier(values.workspaceId, 'workspaceId');
    const ownerUserId = identifier(values.ownerUserId, 'ownerUserId');
    const label = name(values.name);
    const details = profile(values.profile === undefined ? {} : values.profile);
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriteRole(client, scope, ['owner', 'admin', 'member']);
      const result = await client.query<AgentRow>(
        'INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7) RETURNING id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at',
        [id, scope.organizationId, workspaceId, ownerUserId, label, details, Date.now()],
      );
      return agent(result.rows[0]);
    }));
  }

  async updateAgent(scope: TenantScope, id: string, patch: UpdateAgentInput): Promise<AgentRecord | null> {
    identifier(id, 'id');
    const values = fields(patch, ['name', 'profile'], 'agent patch');
    if (Object.keys(values).length === 0 || Object.values(values).some(value => value === undefined)) {
      throw new RepositoryValidationError('agent patch');
    }
    const label = 'name' in values ? name(values.name) : null;
    const details = 'profile' in values ? profile(values.profile) : null;
    return constraints(() => withTenant(this.pool, scope, async client => {
      await requireWriteRole(client, scope, ['owner', 'admin', 'member']);
      const result = await client.query<AgentRow>(
        'UPDATE uap.agents SET name=COALESCE($3,name),profile=COALESCE($4::jsonb,profile),updated_at=GREATEST(updated_at,$5) WHERE organization_id=$1 AND id=$2 RETURNING id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at',
        [scope.organizationId, id, label, details, Date.now()],
      );
      return result.rows[0] ? agent(result.rows[0]) : null;
    }));
  }

  async deleteAgent(scope: TenantScope, id: string): Promise<boolean> {
    identifier(id, 'id');
    return withTenant(this.pool, scope, async client => {
      await requireWriteRole(client, scope, ['owner', 'admin', 'member']);
      const result = await client.query('DELETE FROM uap.agents WHERE organization_id=$1 AND id=$2 RETURNING id', [scope.organizationId, id]);
      return result.rowCount === 1;
    });
  }
}
