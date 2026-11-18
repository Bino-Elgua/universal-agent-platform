import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { TenantAccessError, UnsafeDatabaseRoleError, withTenant, type TenantScope } from './connection.js';
import { assertJobWorkerRole, UnsafeJobWorkerRoleError } from './job-worker-grants.js';

export type TaskState =
  | 'queued' | 'running' | 'awaiting_approval' | 'cancelling'
  | 'succeeded' | 'failed' | 'incomplete' | 'expired' | 'cancelled' | 'dead_letter';
export type JobRetrySafety = 'idempotent' | 'reconcile_only';
export type ExecutionCostClass = 'unmetered_local' | 'reserved_paid';
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired' | 'revoked' | 'consumed';
export type JobOutcome = 'succeeded' | 'failed' | 'incomplete' | 'cancelled';

export interface TaskRecord {
  organizationId: string;
  id: string;
  workspaceId: string;
  agentId: string;
  createdByUserId: string;
  title: string;
  note: string;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface JobRecord {
  organizationId: string;
  id: string;
  taskId: string;
  workspaceId: string;
  agentId: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  retrySafety: JobRetrySafety;
  executionCostClass: ExecutionCostClass;
  state: TaskState;
  priority: number;
  availableAt: number;
  attemptCount: number;
  maxAttempts: number;
  leaseGeneration: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  heartbeatAt: number | null;
  cancelRequestedAt: number | null;
  traceId: string;
  requesterSid: string | null;
  policyVersion: string | null;
  policyDecisionId: string | null;
  budgetReservationId: string | null;
  lastError: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface ApprovalRecord {
  organizationId: string;
  id: string;
  jobId: string;
  taskId: string;
  workspaceId: string;
  agentId: string;
  requesterType: 'user' | 'agent' | 'worker' | 'system';
  requesterId: string;
  requesterSid: string | null;
  actionKind: string;
  actionPayload: Record<string, unknown>;
  actionDigest: string;
  status: ApprovalStatus;
  policyVersion: string;
  policyDecisionId: string;
  budgetReservationId: string | null;
  traceId: string;
  requestedAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  resolvedByUserId: string | null;
  revokedAt: number | null;
  revokedByUserId: string | null;
  consumedAt: number | null;
  consumedByRunId: string | null;
  consumedLeaseGeneration: number | null;
}

export interface JobEventRecord {
  eventId: string;
  organizationId: string;
  jobId: string;
  taskId: string;
  workspaceId: string;
  agentId: string;
  runId: string | null;
  approvalId: string | null;
  seq: number;
  eventType: string;
  actorType: 'user' | 'agent' | 'worker' | 'system';
  actorId: string;
  requesterSid: string | null;
  traceId: string;
  causalEventId: string | null;
  policyVersion: string | null;
  policyDecisionId: string | null;
  budgetReservationId: string | null;
  provenance: Record<string, unknown>;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface EnqueueJobInput {
  taskId?: string;
  jobId?: string;
  workspaceId: string;
  agentId: string;
  title: string;
  note?: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  retrySafety?: JobRetrySafety;
  executionCostClass?: ExecutionCostClass;
  maxAttempts?: number;
  priority?: number;
  availableAt?: number;
  traceId?: string;
  requesterSid?: string;
  policyVersion?: string;
  policyDecisionId?: string;
  budgetReservationId?: string;
}

export interface RecordCursor { createdAt: number; id: string }
export interface RecordPage { after?: RecordCursor; limit?: number }
export interface ListJobsInput extends RecordPage { agentId?: string; state?: TaskState }
export interface AgentRunRecord {
  organizationId: string; id: string; jobId: string; taskId: string; workspaceId: string; agentId: string;
  attemptNumber: number; leaseGeneration: number; workerId: string;
  state: 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'incomplete' | 'expired' | 'cancelled' | 'lost';
  traceId: string; runtimeRefs: Record<string, unknown>;
  outcome: Record<string, unknown> | null; error: Record<string, unknown> | null;
  startedAt: number; heartbeatAt: number; finishedAt: number | null;
}
export interface ClaimedJob { job: JobRecord; leaseToken: string }
export interface JobLease { organizationId: string; jobId: string; generation: number; token: string }
export interface ClaimJobsInput { workerId: string; kinds: string[]; leaseMs: number }
export interface SettleJobInput extends JobLease {
  outcome: JobOutcome;
  retryDelayMs?: number;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}
export interface RequestApprovalInput extends JobLease {
  approvalId?: string;
  actionKind: string;
  actionPayload: Record<string, unknown>;
  ttlMs: number;
  policyVersion: string;
  policyDecisionId: string;
  budgetReservationId?: string;
}
export interface ConsumeApprovalInput extends JobLease {
  approvalId: string;
  actionKind: string;
  actionPayload: Record<string, unknown>;
  policyVersion: string;
  policyDecisionId: string;
  budgetReservationId?: string;
}

export class JobValidationError extends Error {
  readonly code = 'invalid_job_request';
  constructor(public readonly field: string) {
    super(`Invalid ${field}.`);
    this.name = 'JobValidationError';
  }
}
export class JobConflictError extends Error {
  readonly code = 'job_conflict';
  constructor() { super('The durable job request conflicts with existing state.'); this.name = 'JobConflictError'; }
}
export class StaleJobLeaseError extends Error {
  readonly code = 'stale_job_lease';
  constructor() { super('The job lease is missing, expired, or no longer current.'); this.name = 'StaleJobLeaseError'; }
}
export class JobTransitionError extends Error {
  readonly code = 'invalid_job_transition';
  constructor() { super('The requested durable job transition is not available.'); this.name = 'JobTransitionError'; }
}
export class JobStorageError extends Error {
  readonly code = 'job_storage_unavailable';
  constructor() { super('Durable job storage is unavailable.'); this.name = 'JobStorageError'; }
}

interface TaskRow {
  organization_id: string; id: string; workspace_id: string; agent_id: string; created_by_user_id: string;
  title: string; note: string; state: TaskState; created_at: string | number; updated_at: string | number; finished_at: string | number | null;
}
interface JobRow {
  organization_id: string; id: string; task_id: string; workspace_id: string; agent_id: string; kind: string;
  payload: Record<string, unknown>; idempotency_key: string; retry_safety: JobRetrySafety; execution_cost_class: ExecutionCostClass;
  state: TaskState; priority: string | number; available_at: string | number; attempt_count: string | number; max_attempts: string | number;
  lease_generation: string | number; lease_owner: string | null; lease_expires_at: string | number | null; heartbeat_at: string | number | null;
  cancel_requested_at: string | number | null; trace_id: string; policy_version: string | null; policy_decision_id: string | null;
  requester_sid: string | null;
  budget_reservation_id: string | null; last_error: Record<string, unknown> | null; created_at: string | number;
  updated_at: string | number; finished_at: string | number | null;
}
interface ApprovalRow {
  organization_id: string; id: string; job_id: string; task_id: string; workspace_id: string; agent_id: string;
  requester_type: ApprovalRecord['requesterType']; requester_id: string; requester_sid: string | null; action_kind: string; action_payload: Record<string, unknown>;
  action_digest: string; status: ApprovalStatus; policy_version: string; policy_decision_id: string; budget_reservation_id: string | null;
  trace_id: string; requested_at: string | number; expires_at: string | number; resolved_at: string | number | null;
  resolved_by_user_id: string | null; revoked_at: string | number | null; revoked_by_user_id: string | null;
  consumed_at: string | number | null; consumed_by_run_id: string | null; consumed_lease_generation: string | number | null;
}
interface EventRow {
  event_id: string; organization_id: string; job_id: string; task_id: string; workspace_id: string; agent_id: string;
  run_id: string | null; approval_id: string | null;
  seq: string | number; event_type: string; actor_type: JobEventRecord['actorType']; actor_id: string; trace_id: string;
  requester_sid: string | null;
  causal_event_id: string | null; policy_version: string | null; policy_decision_id: string | null; budget_reservation_id: string | null;
  provenance: Record<string, unknown>; payload: Record<string, unknown>; created_at: string | number;
}
interface RunRow {
  organization_id: string; id: string; job_id: string; task_id: string; workspace_id: string; agent_id: string;
  attempt_number: string | number; lease_generation: string | number; worker_id: string; state: AgentRunRecord['state'];
  trace_id: string; runtime_refs: Record<string, unknown>; outcome: Record<string, unknown> | null;
  error: Record<string, unknown> | null; started_at: string | number; heartbeat_at: string | number; finished_at: string | number | null;
}

const TASK_COLUMNS = 'organization_id,id,workspace_id,agent_id,created_by_user_id,title,note,state,created_at,updated_at,finished_at';
const JOB_COLUMNS = 'organization_id,id,task_id,workspace_id,agent_id,kind,payload,idempotency_key,retry_safety,execution_cost_class,state,priority,available_at,attempt_count,max_attempts,lease_generation,lease_owner,lease_expires_at,heartbeat_at,cancel_requested_at,trace_id,requester_sid,policy_version,policy_decision_id,budget_reservation_id,last_error,created_at,updated_at,finished_at';
const APPROVAL_COLUMNS = 'organization_id,id,job_id,task_id,workspace_id,agent_id,requester_type,requester_id,requester_sid,action_kind,action_payload,action_digest,status,policy_version,policy_decision_id,budget_reservation_id,trace_id,requested_at,expires_at,resolved_at,resolved_by_user_id,revoked_at,revoked_by_user_id,consumed_at,consumed_by_run_id,consumed_lease_generation';
const EVENT_COLUMNS = 'event_id,organization_id,job_id,task_id,workspace_id,agent_id,run_id,approval_id,seq,event_type,actor_type,actor_id,requester_sid,trace_id,causal_event_id,policy_version,policy_decision_id,budget_reservation_id,provenance,payload,created_at';
const RUN_COLUMNS = 'organization_id,id,job_id,task_id,workspace_id,agent_id,attempt_number,lease_generation,worker_id,state,trace_id,runtime_refs,outcome,error,started_at,heartbeat_at,finished_at';

function fields(input: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new JobValidationError(field);
  }
  return input as Record<string, unknown>;
}
function identifier(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 200 || input.includes('\0') || /[\uD800-\uDFFF]/u.test(input)) {
    throw new JobValidationError(field);
  }
  return input;
}
function optionalIdentifier(input: unknown, field: string): string | null {
  return input === undefined ? null : identifier(input, field);
}
function integer(input: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum || input > maximum) throw new JobValidationError(field);
  return input;
}
function label(input: unknown, field: string, maximum: number): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || /[\uD800-\uDFFF]/u.test(input) || input.length > maximum) {
    throw new JobValidationError(field);
  }
  return input.trim();
}
function plainText(input: unknown, field: string, maximumBytes: number): string {
  if (typeof input !== 'string' || input.includes('\0') || /[\uD800-\uDFFF]/u.test(input) || Buffer.byteLength(input, 'utf8') > maximumBytes) {
    throw new JobValidationError(field);
  }
  return input;
}
function storedInteger(input: string | number): number {
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Stored durable job values cannot be represented safely.');
  return value;
}
const nullableInteger = (input: string | number | null): number | null => input === null ? null : storedInteger(input);

function canonicalObject(input: unknown, field: string, maximumBytes = 1024 * 1024): string {
  fields(input, Object.keys(input && typeof input === 'object' ? input : {}), field);
  const seen = new Set<object>();
  let nodes = 0;
  function canonical(value: unknown, depth: number): unknown {
    if (++nodes > 30000 || depth > 32) throw new JobValidationError(field);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
    if (typeof value === 'string') {
      if (value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) throw new JobValidationError(field);
      return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value) ||
        (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new JobValidationError(field);
    seen.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new JobValidationError(field);
      result = Array.from(value, child => canonical(child, depth + 1));
    }
    else {
      const object: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(value).sort()) {
        if (key.includes('\0') || /[\uD800-\uDFFF]/u.test(key)) throw new JobValidationError(field);
        object[key] = canonical((value as Record<string, unknown>)[key], depth + 1);
      }
      result = object;
    }
    seen.delete(value);
    return result;
  }
  const json = JSON.stringify(canonical(input, 0));
  if (Buffer.byteLength(json, 'utf8') > maximumBytes) throw new JobValidationError(field);
  return json;
}
function hash(...parts: string[]): string { return createHash('sha256').update(parts.join('\0')).digest('hex'); }
function tokenHash(token: string): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) {
    throw new JobValidationError('lease token');
  }
  return hash(token);
}
function task(row: TaskRow): TaskRecord {
  return {
    organizationId: row.organization_id, id: row.id, workspaceId: row.workspace_id, agentId: row.agent_id,
    createdByUserId: row.created_by_user_id, title: row.title, note: row.note, state: row.state,
    createdAt: storedInteger(row.created_at), updatedAt: storedInteger(row.updated_at), finishedAt: nullableInteger(row.finished_at),
  };
}
function job(row: JobRow): JobRecord {
  return {
    organizationId: row.organization_id, id: row.id, taskId: row.task_id, workspaceId: row.workspace_id, agentId: row.agent_id,
    kind: row.kind, payload: row.payload, idempotencyKey: row.idempotency_key, retrySafety: row.retry_safety,
    executionCostClass: row.execution_cost_class, state: row.state, priority: storedInteger(row.priority),
    availableAt: storedInteger(row.available_at), attemptCount: storedInteger(row.attempt_count), maxAttempts: storedInteger(row.max_attempts),
    leaseGeneration: storedInteger(row.lease_generation), leaseOwner: row.lease_owner, leaseExpiresAt: nullableInteger(row.lease_expires_at),
    heartbeatAt: nullableInteger(row.heartbeat_at), cancelRequestedAt: nullableInteger(row.cancel_requested_at), traceId: row.trace_id,
    requesterSid: row.requester_sid, policyVersion: row.policy_version, policyDecisionId: row.policy_decision_id,
    budgetReservationId: row.budget_reservation_id,
    lastError: row.last_error, createdAt: storedInteger(row.created_at), updatedAt: storedInteger(row.updated_at),
    finishedAt: nullableInteger(row.finished_at),
  };
}
function approval(row: ApprovalRow): ApprovalRecord {
  return {
    organizationId: row.organization_id, id: row.id, jobId: row.job_id, taskId: row.task_id,
    workspaceId: row.workspace_id, agentId: row.agent_id, requesterType: row.requester_type, requesterId: row.requester_id,
    requesterSid: row.requester_sid,
    actionKind: row.action_kind, actionPayload: row.action_payload, actionDigest: row.action_digest, status: row.status,
    policyVersion: row.policy_version, policyDecisionId: row.policy_decision_id, budgetReservationId: row.budget_reservation_id,
    traceId: row.trace_id, requestedAt: storedInteger(row.requested_at), expiresAt: storedInteger(row.expires_at),
    resolvedAt: nullableInteger(row.resolved_at), resolvedByUserId: row.resolved_by_user_id,
    revokedAt: nullableInteger(row.revoked_at), revokedByUserId: row.revoked_by_user_id,
    consumedAt: nullableInteger(row.consumed_at), consumedByRunId: row.consumed_by_run_id,
    consumedLeaseGeneration: nullableInteger(row.consumed_lease_generation),
  };
}
function event(row: EventRow): JobEventRecord {
  return {
    eventId: row.event_id, organizationId: row.organization_id, jobId: row.job_id, taskId: row.task_id,
    workspaceId: row.workspace_id, agentId: row.agent_id,
    runId: row.run_id, approvalId: row.approval_id, seq: storedInteger(row.seq), eventType: row.event_type,
    actorType: row.actor_type, actorId: row.actor_id, requesterSid: row.requester_sid, traceId: row.trace_id,
    causalEventId: row.causal_event_id,
    policyVersion: row.policy_version, policyDecisionId: row.policy_decision_id, budgetReservationId: row.budget_reservation_id,
    provenance: row.provenance, payload: row.payload, createdAt: storedInteger(row.created_at),
  };
}
function run(row: RunRow): AgentRunRecord {
  return {
    organizationId: row.organization_id, id: row.id, jobId: row.job_id, taskId: row.task_id,
    workspaceId: row.workspace_id, agentId: row.agent_id, attemptNumber: storedInteger(row.attempt_number),
    leaseGeneration: storedInteger(row.lease_generation), workerId: row.worker_id, state: row.state,
    traceId: row.trace_id, runtimeRefs: row.runtime_refs, outcome: row.outcome, error: row.error,
    startedAt: storedInteger(row.started_at), heartbeatAt: storedInteger(row.heartbeat_at), finishedAt: nullableInteger(row.finished_at),
  };
}

function translate(error: unknown): never {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'P0001' || code === '23505') throw new JobConflictError();
  if (code === 'P0002') throw new StaleJobLeaseError();
  if (code === 'P0003') throw new JobTransitionError();
  if (code === '23503' || code === '23514' || code === '23502' || code === '22P02') throw new JobTransitionError();
  if (code === '42501') throw new TenantAccessError();
  if (error instanceof TenantAccessError || error instanceof UnsafeDatabaseRoleError || error instanceof UnsafeJobWorkerRoleError ||
      error instanceof JobValidationError || error instanceof JobConflictError || error instanceof StaleJobLeaseError ||
      error instanceof JobTransitionError || error instanceof JobStorageError) throw error;
  // PostgreSQL errors may include row details, SQL or connection information.
  throw new JobStorageError();
}
async function transitions<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { return translate(error); }
}
async function requireWriter(client: PoolClient, scope: TenantScope): Promise<void> {
  const result = await client.query<{ role: string }>(
    "SELECT role FROM uap.memberships WHERE organization_id=$1 AND user_id=$2 AND state='active'", [scope.organizationId, scope.actorId],
  );
  if (!['owner', 'admin', 'member'].includes(result.rows[0]?.role)) throw new TenantAccessError();
}

async function withWorker<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let transaction = false;
  let discard = false;
  try {
    await client.query("SELECT set_config('uap.actor_id','',false),set_config('uap.organization_id','',false)");
    await client.query('BEGIN');
    transaction = true;
    await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='15s'; SET LOCAL search_path=pg_catalog,uap");
    await assertJobWorkerRole(client);
    const result = await work(client);
    await client.query('COMMIT');
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => { discard = true; });
    throw error;
  } finally {
    if (!discard) await client.query("SELECT set_config('uap.actor_id','',false),set_config('uap.organization_id','',false)").catch(() => { discard = true; });
    client.release(discard);
  }
}

function jobKind(value: unknown, field = 'job kind'): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value)) throw new JobValidationError(field);
  return value;
}
function taskState(value: unknown): TaskState {
  const states: TaskState[] = ['queued','running','awaiting_approval','cancelling','succeeded','failed','incomplete','expired','cancelled','dead_letter'];
  if (!states.includes(value as TaskState)) throw new JobValidationError('job state');
  return value as TaskState;
}
function lease(values: Record<string, unknown>): { organizationId: string; jobId: string; generation: number; hash: string } {
  // The caller already validates the complete transition shape; read only the
  // common lease fields without rejecting its additional transition fields.
  return {
    organizationId: identifier(values.organizationId, 'organizationId'), jobId: identifier(values.jobId, 'jobId'),
    generation: integer(values.generation, 'lease generation', 1, Number.MAX_SAFE_INTEGER), hash: tokenHash(values.token as string),
  };
}
function page(values: Record<string, unknown>): { createdAt: number | null; id: string | null; limit: number } {
  const limit = values.limit === undefined ? 100 : integer(values.limit, 'limit', 1, 500);
  if (values.after === undefined) return { createdAt: null, id: null, limit };
  const cursor = fields(values.after, ['createdAt', 'id'], 'cursor');
  return { createdAt: integer(cursor.createdAt, 'cursor timestamp', 0, Number.MAX_SAFE_INTEGER), id: identifier(cursor.id, 'cursor ID'), limit };
}

/** Durable tenant records only. This class never claims or executes a job. */
export class TenantJobRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(scope: TenantScope, input: EnqueueJobInput): Promise<{ task: TaskRecord; job: JobRecord }> {
    const values = fields(input, ['taskId','jobId','workspaceId','agentId','title','note','kind','payload','idempotencyKey','retrySafety',
      'executionCostClass','maxAttempts','priority','availableAt','traceId','requesterSid','policyVersion','policyDecisionId','budgetReservationId'], 'job');
    const taskId = values.taskId === undefined ? `task_${randomUUID()}` : identifier(values.taskId, 'taskId');
    const jobId = values.jobId === undefined ? `job_${randomUUID()}` : identifier(values.jobId, 'jobId');
    const workspaceId = identifier(values.workspaceId, 'workspaceId');
    const agentId = identifier(values.agentId, 'agentId');
    const title = label(values.title, 'title', 500);
    const note = values.note === undefined ? '' : plainText(values.note, 'note', 65536);
    const kind = jobKind(values.kind);
    const payload = canonicalObject(values.payload, 'payload');
    const idempotencyKey = identifier(values.idempotencyKey, 'idempotencyKey');
    const retrySafety: JobRetrySafety = values.retrySafety === undefined ? 'reconcile_only' : values.retrySafety as JobRetrySafety;
    if (!['idempotent', 'reconcile_only'].includes(retrySafety)) throw new JobValidationError('retrySafety');
    const executionCostClass: ExecutionCostClass = values.executionCostClass === undefined ? 'unmetered_local' : values.executionCostClass as ExecutionCostClass;
    if (!['unmetered_local', 'reserved_paid'].includes(executionCostClass)) throw new JobValidationError('executionCostClass');
    const maxAttempts = values.maxAttempts === undefined ? (retrySafety === 'idempotent' ? 3 : 1) : integer(values.maxAttempts, 'maxAttempts', 1, 100);
    const priority = values.priority === undefined ? 100 : integer(values.priority, 'priority', 0, 1000);
    const availableAt = values.availableAt === undefined ? null : integer(values.availableAt, 'availableAt', 0, Number.MAX_SAFE_INTEGER);
    const policyVersion = optionalIdentifier(values.policyVersion, 'policyVersion');
    const policyDecisionId = optionalIdentifier(values.policyDecisionId, 'policyDecisionId');
    const budgetReservationId = optionalIdentifier(values.budgetReservationId, 'budgetReservationId');
    const requesterSid = optionalIdentifier(values.requesterSid, 'requesterSid');
    if ((executionCostClass === 'reserved_paid') !== (budgetReservationId !== null)) throw new JobValidationError('budgetReservationId');
    const traceId = values.traceId === undefined
      ? `trace_${hash('job-trace-v1', scope.organizationId, idempotencyKey).slice(0, 32)}`
      : identifier(values.traceId, 'traceId');
    const request = canonicalObject({ actorId: scope.actorId,
      taskId: values.taskId === undefined ? null : taskId, jobId: values.jobId === undefined ? null : jobId,
      traceId, workspaceId, agentId, title, note, kind, payload: JSON.parse(payload), retrySafety,
      executionCostClass, maxAttempts, priority, availableAt, requesterSid, policyVersion, policyDecisionId,
      budgetReservationId }, 'job request', 2 * 1024 * 1024);
    const requestDigest = hash('task-job-request-v1', scope.organizationId, request);
    return transitions(() => withTenant(this.pool, scope, async client => {
      await requireWriter(client, scope);
      const result = await client.query<JobRow>(
        `SELECT * FROM uap.enqueue_task_job($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [scope.organizationId, taskId, jobId, workspaceId, agentId, title, note, kind, payload, idempotencyKey,
          requestDigest, retrySafety, maxAttempts, priority, availableAt, traceId, requesterSid, policyVersion,
          policyDecisionId, executionCostClass, budgetReservationId],
      );
      if (result.rows.length !== 1) throw new JobTransitionError();
      const storedJob = job(result.rows[0]);
      const taskResult = await client.query<TaskRow>(`SELECT ${TASK_COLUMNS} FROM uap.tasks WHERE organization_id=$1 AND id=$2`, [scope.organizationId, storedJob.taskId]);
      if (taskResult.rows.length !== 1) throw new JobTransitionError();
      return { task: task(taskResult.rows[0]), job: storedJob };
    }));
  }

  async getTask(scope: TenantScope, id: string): Promise<TaskRecord | null> {
    identifier(id, 'taskId');
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<TaskRow>(`SELECT ${TASK_COLUMNS} FROM uap.tasks WHERE organization_id=$1 AND id=$2`, [scope.organizationId, id]);
      return result.rows[0] ? task(result.rows[0]) : null;
    }));
  }

  async getJob(scope: TenantScope, id: string): Promise<JobRecord | null> {
    identifier(id, 'jobId');
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM uap.task_jobs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, id]);
      return result.rows[0] ? job(result.rows[0]) : null;
    }));
  }

  async listJobs(scope: TenantScope, input: ListJobsInput = {}): Promise<JobRecord[]> {
    const values = fields(input, ['agentId', 'state', 'after', 'limit'], 'job filters');
    const agentId = optionalIdentifier(values.agentId, 'agentId');
    const state = values.state === undefined ? null : taskState(values.state);
    const cursor = page(values);
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<JobRow>(`SELECT ${JOB_COLUMNS} FROM uap.task_jobs
        WHERE organization_id=$1 AND ($2::text IS NULL OR agent_id=$2) AND ($3::text IS NULL OR state=$3)
          AND ($4::bigint IS NULL OR (created_at,id)>($4::bigint,$5::text))
        ORDER BY created_at,id LIMIT $6`, [scope.organizationId, agentId, state, cursor.createdAt, cursor.id, cursor.limit]);
      return result.rows.map(job);
    }));
  }

  async listEvents(scope: TenantScope, jobId: string, afterSeq = 0, limit = 100): Promise<JobEventRecord[]> {
    identifier(jobId, 'jobId'); integer(afterSeq, 'afterSeq', 0, Number.MAX_SAFE_INTEGER); integer(limit, 'limit', 1, 500);
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM uap.job_events
        WHERE organization_id=$1 AND job_id=$2 AND seq>$3 ORDER BY seq LIMIT $4`, [scope.organizationId, jobId, afterSeq, limit]);
      return result.rows.map(event);
    }));
  }

  async listApprovals(scope: TenantScope, jobId: string, input: RecordPage = {}): Promise<ApprovalRecord[]> {
    identifier(jobId, 'jobId');
    const cursor = page(fields(input, ['after', 'limit'], 'approval page'));
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM uap.approvals
        WHERE organization_id=$1 AND job_id=$2
          AND ($3::bigint IS NULL OR (requested_at,id)>($3::bigint,$4::text))
        ORDER BY requested_at,id LIMIT $5`, [scope.organizationId, jobId, cursor.createdAt, cursor.id, cursor.limit]);
      return result.rows.map(approval);
    }));
  }

  async listTasks(scope: TenantScope, input: ListJobsInput = {}): Promise<TaskRecord[]> {
    const values = fields(input, ['agentId', 'state', 'after', 'limit'], 'task filters');
    const agentId = optionalIdentifier(values.agentId, 'agentId');
    const state = values.state === undefined ? null : taskState(values.state);
    const cursor = page(values);
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<TaskRow>(`SELECT ${TASK_COLUMNS} FROM uap.tasks
        WHERE organization_id=$1 AND ($2::text IS NULL OR agent_id=$2) AND ($3::text IS NULL OR state=$3)
          AND ($4::bigint IS NULL OR (created_at,id)>($4::bigint,$5::text))
        ORDER BY created_at,id LIMIT $6`, [scope.organizationId, agentId, state, cursor.createdAt, cursor.id, cursor.limit]);
      return result.rows.map(task);
    }));
  }

  async listRuns(scope: TenantScope, jobId: string, afterGeneration = 0, limit = 100): Promise<AgentRunRecord[]> {
    identifier(jobId, 'jobId'); integer(afterGeneration, 'afterGeneration', 0, Number.MAX_SAFE_INTEGER); integer(limit, 'limit', 1, 500);
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM uap.agent_runs
        WHERE organization_id=$1 AND job_id=$2 AND lease_generation>$3
        ORDER BY lease_generation LIMIT $4`, [scope.organizationId, jobId, afterGeneration, limit]);
      return result.rows.map(run);
    }));
  }

  async requestCancellation(scope: TenantScope, jobId: string): Promise<JobRecord | null> {
    identifier(jobId, 'jobId');
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<JobRow>('SELECT * FROM uap.request_task_job_cancellation($1,$2)', [scope.organizationId, jobId]);
      return result.rows[0] ? job(result.rows[0]) : null;
    }));
  }

  async resolveApproval(scope: TenantScope, approvalId: string, decision: 'allow' | 'deny' | 'revoke'): Promise<ApprovalRecord | null> {
    identifier(approvalId, 'approvalId');
    if (!['allow', 'deny', 'revoke'].includes(decision)) throw new JobValidationError('approval decision');
    return transitions(() => withTenant(this.pool, scope, async client => {
      const result = await client.query<ApprovalRow>('SELECT * FROM uap.resolve_task_approval($1,$2,$3)', [scope.organizationId, approvalId, decision]);
      return result.rows[0] ? approval(result.rows[0]) : null;
    }));
  }
}

/** Separate worker credentials call fenced database transitions; no human tenant context is set. */
export class WorkerJobRepository {
  constructor(private readonly pool: Pool) {}

  async claim(input: ClaimJobsInput): Promise<ClaimedJob | null> {
    const values = fields(input, ['workerId', 'kinds', 'leaseMs'], 'job claim');
    const workerId = identifier(values.workerId, 'workerId');
    if (!Array.isArray(values.kinds) || values.kinds.length < 1 || values.kinds.length > 50) throw new JobValidationError('job kinds');
    const kinds = [...new Set(values.kinds.map(value => jobKind(value)))];
    const leaseMs = integer(values.leaseMs, 'leaseMs', 1000, 15 * 60_000);
    const leaseToken = randomBytes(32).toString('base64url');
    const digest = tokenHash(leaseToken);
    return transitions(() => withWorker(this.pool, async client => {
      const result = await client.query<JobRow>('SELECT * FROM uap.claim_task_job($1,$2::text[],$3,$4)', [workerId, kinds, leaseMs, digest]);
      if (!result.rows[0]) return null;
      return { job: job(result.rows[0]), leaseToken };
    }));
  }

  async heartbeat(input: JobLease & { leaseMs: number }): Promise<JobRecord> {
    const values = fields(input, ['organizationId', 'jobId', 'generation', 'token', 'leaseMs'], 'job heartbeat');
    const current = lease(values);
    const leaseMs = integer(values.leaseMs, 'leaseMs', 1000, 15 * 60_000);
    return transitions(() => withWorker(this.pool, async client => {
      const result = await client.query<JobRow>('SELECT * FROM uap.heartbeat_task_job($1,$2,$3,$4,$5)',
        [current.organizationId, current.jobId, current.generation, current.hash, leaseMs]);
      if (result.rows.length !== 1) throw new StaleJobLeaseError();
      return job(result.rows[0]);
    }));
  }

  async settle(input: SettleJobInput): Promise<JobRecord> {
    const values = fields(input, ['organizationId','jobId','generation','token','outcome','retryDelayMs','result','error'], 'job settlement');
    const current = lease(values);
    const outcome = values.outcome as JobOutcome;
    if (!['succeeded', 'failed', 'incomplete', 'cancelled'].includes(outcome)) throw new JobValidationError('job outcome');
    const retryDelayMs = values.retryDelayMs === undefined ? null : integer(values.retryDelayMs, 'retryDelayMs', 0, 7 * 24 * 60 * 60_000);
    if (outcome !== 'failed' && retryDelayMs !== null) throw new JobValidationError('retryDelayMs');
    const result = canonicalObject(values.result === undefined ? {} : values.result, 'job result');
    const error = canonicalObject(values.error === undefined ? {} : values.error, 'job error', 65536);
    return transitions(() => withWorker(this.pool, async client => {
      const settled = await client.query<JobRow>('SELECT * FROM uap.settle_task_job($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',
        [current.organizationId, current.jobId, current.generation, current.hash, outcome, retryDelayMs, result, error]);
      if (settled.rows.length !== 1) throw new StaleJobLeaseError();
      return job(settled.rows[0]);
    }));
  }

  async requestApproval(input: RequestApprovalInput): Promise<ApprovalRecord> {
    const values = fields(input, ['organizationId','jobId','generation','token','approvalId','actionKind','actionPayload','ttlMs',
      'policyVersion','policyDecisionId','budgetReservationId'], 'approval request');
    const current = lease(values);
    const approvalId = values.approvalId === undefined ? `approval_${randomUUID()}` : identifier(values.approvalId, 'approvalId');
    const actionKind = jobKind(values.actionKind, 'actionKind');
    const actionPayload = canonicalObject(values.actionPayload, 'actionPayload');
    const ttlMs = integer(values.ttlMs, 'approval ttl', 1000, 24 * 60 * 60_000);
    const policyVersion = identifier(values.policyVersion, 'policyVersion');
    const policyDecisionId = identifier(values.policyDecisionId, 'policyDecisionId');
    const budgetReservationId = optionalIdentifier(values.budgetReservationId, 'budgetReservationId');
    // This compares exact action requests. It is neither a signature nor a
    // substitute for policy, scope, membership, or spending authorization.
    const actionDigest = hash('approval-action-v1', current.organizationId, current.jobId, actionKind, actionPayload,
      policyVersion, policyDecisionId, budgetReservationId ?? '');
    return transitions(() => withWorker(this.pool, async client => {
      const requested = await client.query<ApprovalRow>(`SELECT * FROM uap.request_task_approval(
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8,
        floor(extract(epoch FROM clock_timestamp())*1000)::bigint+$9,$10,$11,$12)`,
        [current.organizationId, current.jobId, current.generation, current.hash, approvalId, actionKind, actionPayload,
          actionDigest, ttlMs, policyVersion, policyDecisionId, budgetReservationId]);
      if (requested.rows.length !== 1) throw new JobTransitionError();
      return approval(requested.rows[0]);
    }));
  }

  async consumeApproval(input: ConsumeApprovalInput): Promise<ApprovalRecord> {
    const values = fields(input, ['organizationId','jobId','generation','token','approvalId','actionKind','actionPayload',
      'policyVersion','policyDecisionId','budgetReservationId'], 'approval consumption');
    const current = lease(values);
    const approvalId = identifier(values.approvalId, 'approvalId');
    const actionKind = jobKind(values.actionKind, 'actionKind');
    const actionPayload = canonicalObject(values.actionPayload, 'actionPayload');
    const policyVersion = identifier(values.policyVersion, 'policyVersion');
    const policyDecisionId = identifier(values.policyDecisionId, 'policyDecisionId');
    const budgetReservationId = optionalIdentifier(values.budgetReservationId, 'budgetReservationId');
    return transitions(() => withWorker(this.pool, async client => {
      const actionDigest = hash('approval-action-v1', current.organizationId, current.jobId, actionKind, actionPayload,
        policyVersion, policyDecisionId, budgetReservationId ?? '');
      const consumed = await client.query<ApprovalRow>('SELECT * FROM uap.consume_task_approval($1,$2,$3,$4,$5,$6)',
        [current.organizationId, current.jobId, current.generation, current.hash, approvalId, actionDigest]);
      if (consumed.rows.length !== 1) throw new JobTransitionError();
      return approval(consumed.rows[0]);
    }));
  }
}
