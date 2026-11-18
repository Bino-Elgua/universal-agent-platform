import { createHash } from 'node:crypto';
import type {
  ClaimedJob,
  ClaimJobsInput,
  JobLease,
  JobRecord,
  SettleJobInput,
} from '../storage/postgres/jobs.js';

export type ExecutorRunStatus = 'idle' | 'succeeded' | 'failed' | 'incomplete' | 'cancelled';

export interface DurableJobPort {
  claim(input: ClaimJobsInput): Promise<ClaimedJob | null>;
  heartbeat(input: JobLease & { leaseMs: number }): Promise<JobRecord>;
  settle(input: SettleJobInput): Promise<JobRecord>;
}

export interface ToolAction {
  kind: string;
  input: Record<string, unknown>;
}

export interface ExecutionAuthorizationRequest {
  organizationId: string;
  workspaceId: string;
  agentId: string;
  requesterSid: string | null;
  jobId: string;
  jobKind: string;
  traceId: string;
  action: ToolAction;
  executionCostClass: 'unmetered_local';
  policyVersion: string;
  policyDecisionId: string;
  budgetReservationId: null;
}

export interface ExecutionAuthorizationDecision {
  allowed: boolean;
  reasonCode: string;
  policyVersion: string;
  policyDecisionId: string;
  executionCostClass: 'unmetered_local' | 'reserved_paid';
  budgetReservationId: string | null;
  approval: 'not_required' | 'required';
}

export interface ExecutionAuthorizer {
  authorize(request: Readonly<ExecutionAuthorizationRequest>): Promise<ExecutionAuthorizationDecision>;
}

export interface ToolContext {
  organizationId: string;
  workspaceId: string;
  agentId: string;
  requesterSid: string | null;
  jobId: string;
  traceId: string;
  invocationId: string;
  /** Call immediately before every nested external side effect. */
  checkpoint(): Promise<void>;
}

export interface ExecutorTool {
  kind: string;
  executionCostClass: 'unmetered_local';
  retryMode: 'never' | 'idempotent';
  execute(input: Readonly<Record<string, unknown>>, context: Readonly<ToolContext>): Promise<Record<string, unknown>>;
}

export class ToolExecutionError extends Error {
  readonly code = 'tool_execution_error';

  constructor(
    message: string,
    readonly outcome: 'not_started' | 'known_failed' | 'unknown',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class ExecutorConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecutorConfigurationError'; }
}

class ExecutionContractError extends Error {}
class ExecutionCancelledError extends Error {}

export interface DurableExecutorOptions {
  workerId: string;
  jobKinds: string[];
  leaseMs: number;
  retryDelayMs?: number;
  jobs: DurableJobPort;
  authorizer: ExecutionAuthorizer;
  tools: ExecutorTool[];
}

function plainIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
    throw new ExecutorConfigurationError(`Invalid ${field}.`);
  }
  return value;
}

function actionKind(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value)) {
    throw new ExecutionContractError('Invalid tool action kind.');
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ExecutionContractError(`Invalid ${field}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !(key in record))) {
    throw new ExecutionContractError(`Invalid ${field}.`);
  }
  return record;
}

function jsonObject(value: unknown, field: string, maximumBytes = 1024 * 1024): Record<string, unknown> {
  exactObject(value, Object.keys(value && typeof value === 'object' ? value : {}), field);
  const seen = new Set<object>();
  let nodes = 0;
  function canonical(item: unknown, depth: number): unknown {
    if (++nodes > 30000 || depth > 32) throw new ExecutionContractError(`Invalid ${field}.`);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))) return item;
    if (typeof item === 'string') {
      if (item.includes('\0') || /[\uD800-\uDFFF]/u.test(item)) throw new ExecutionContractError(`Invalid ${field}.`);
      return item;
    }
    if (!item || typeof item !== 'object' || seen.has(item)
      || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      throw new ExecutionContractError(`Invalid ${field}.`);
    }
    seen.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new ExecutionContractError(`Invalid ${field}.`);
      result = Array.from(item, nested => canonical(nested, depth + 1));
    } else {
      const object: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        if (key.includes('\0') || /[\uD800-\uDFFF]/u.test(key)) throw new ExecutionContractError(`Invalid ${field}.`);
        object[key] = canonical((item as Record<string, unknown>)[key], depth + 1);
      }
      result = object;
    }
    seen.delete(item);
    return result;
  }
  const encoded = JSON.stringify(canonical(value, 0));
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > maximumBytes) throw new ExecutionContractError(`Invalid ${field}.`);
  const parsed: unknown = JSON.parse(encoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ExecutionContractError(`Invalid ${field}.`);
  return parsed as Record<string, unknown>;
}

function executionAction(job: JobRecord): ToolAction {
  const envelope = exactObject(job.payload.execution, ['version', 'action'], 'execution envelope');
  if (envelope.version !== 1) throw new ExecutionContractError('Unsupported execution contract version.');
  const action = exactObject(envelope.action, ['kind', 'input'], 'tool action');
  const kind = actionKind(action.kind);
  return { kind, input: jsonObject(action.input, 'tool action input') };
}

function lease(claimed: ClaimedJob): JobLease {
  return {
    organizationId: claimed.job.organizationId,
    jobId: claimed.job.id,
    generation: claimed.job.leaseGeneration,
    token: claimed.leaseToken,
  };
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(value) ? value : fallback;
}

function decisionIsExact(decision: unknown): decision is ExecutionAuthorizationDecision {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return false;
  const keys = ['allowed','reasonCode','policyVersion','policyDecisionId','executionCostClass','budgetReservationId','approval'];
  const value = decision as Record<string, unknown>;
  return Object.keys(value).length === keys.length && keys.every(key => key in value)
    && typeof value.allowed === 'boolean' && typeof value.reasonCode === 'string'
    && typeof value.policyVersion === 'string' && typeof value.policyDecisionId === 'string'
    && ['unmetered_local','reserved_paid'].includes(value.executionCostClass as string)
    && (value.budgetReservationId === null || typeof value.budgetReservationId === 'string')
    && ['not_required','required'].includes(value.approval as string);
}

/**
 * Runs at most one claimed, single-action job. It deliberately supports only
 * unmetered local tools; paid and approval-required actions remain fail-closed.
 */
export class DurableExecutor {
  private readonly tools = new Map<string, ExecutorTool>();
  private readonly workerId: string;
  private readonly jobKinds: string[];
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: DurableExecutorOptions) {
    this.workerId = plainIdentifier(options.workerId, 'workerId');
    if (!Array.isArray(options.jobKinds) || options.jobKinds.length < 1 || options.jobKinds.length > 50) {
      throw new ExecutorConfigurationError('At least one job kind is required.');
    }
    this.jobKinds = [...new Set(options.jobKinds.map(kind => plainIdentifier(kind, 'job kind')))];
    if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 1000 || options.leaseMs > 15 * 60_000) {
      throw new ExecutorConfigurationError('Invalid lease duration.');
    }
    this.leaseMs = options.leaseMs;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs < 0 || this.retryDelayMs > 7 * 24 * 60 * 60_000) {
      throw new ExecutorConfigurationError('Invalid retry delay.');
    }
    if (!Array.isArray(options.tools) || options.tools.length < 1) throw new ExecutorConfigurationError('At least one tool is required.');
    for (const tool of options.tools) {
      const kind = plainIdentifier(tool.kind, 'tool kind');
      if (tool.executionCostClass !== 'unmetered_local' || !['never','idempotent'].includes(tool.retryMode) || this.tools.has(kind)) {
        throw new ExecutorConfigurationError('Tool registrations must be unique, local, and explicit about retry safety.');
      }
      this.tools.set(kind, tool);
    }
  }

  async runOnce(): Promise<ExecutorRunStatus> {
    const claimed = await this.options.jobs.claim({ workerId: this.workerId, kinds: this.jobKinds, leaseMs: this.leaseMs });
    if (!claimed) return 'idle';
    const currentLease = lease(claimed);
    const settle = (input: Omit<SettleJobInput, keyof JobLease>) => this.options.jobs.settle({ ...currentLease, ...input });
    let action: ToolAction;
    try {
      action = executionAction(claimed.job);
    } catch {
      await settle({ outcome: 'failed', error: { code: 'invalid_execution_contract' } });
      return 'failed';
    }
    const tool = this.tools.get(action.kind);
    if (!tool) {
      await settle({ outcome: 'failed', error: { code: 'tool_not_registered', actionKind: action.kind } });
      return 'failed';
    }
    if (claimed.job.executionCostClass !== 'unmetered_local' || claimed.job.budgetReservationId !== null
      || !claimed.job.policyVersion || !claimed.job.policyDecisionId) {
      await settle({ outcome: 'incomplete', error: { code: 'unsupported_execution_authority' } });
      return 'incomplete';
    }
    const authorizationRequest: ExecutionAuthorizationRequest = {
      organizationId: claimed.job.organizationId,
      workspaceId: claimed.job.workspaceId,
      agentId: claimed.job.agentId,
      requesterSid: claimed.job.requesterSid,
      jobId: claimed.job.id,
      jobKind: claimed.job.kind,
      traceId: claimed.job.traceId,
      action,
      executionCostClass: 'unmetered_local',
      policyVersion: claimed.job.policyVersion,
      policyDecisionId: claimed.job.policyDecisionId,
      budgetReservationId: null,
    };
    let decision: ExecutionAuthorizationDecision;
    try {
      decision = await this.options.authorizer.authorize(deepFreeze(authorizationRequest));
    } catch {
      await settle({ outcome: 'incomplete', error: { code: 'policy_service_unavailable' } });
      return 'incomplete';
    }
    if (!decisionIsExact(decision)
      || decision.policyVersion !== claimed.job.policyVersion
      || decision.policyDecisionId !== claimed.job.policyDecisionId
      || decision.executionCostClass !== 'unmetered_local'
      || decision.budgetReservationId !== null) {
      await settle({ outcome: 'incomplete', error: { code: 'policy_decision_mismatch' } });
      return 'incomplete';
    }
    if (!decision.allowed) {
      await settle({ outcome: 'failed', error: { code: 'policy_denied', reasonCode: safeCode(decision.reasonCode, 'denied') } });
      return 'failed';
    }
    if (decision.approval !== 'not_required') {
      await settle({ outcome: 'failed', error: { code: 'approval_required_unsupported' } });
      return 'failed';
    }

    const checkpoint = async (): Promise<void> => {
      const current = await this.options.jobs.heartbeat({ ...currentLease, leaseMs: this.leaseMs });
      if (current.state === 'cancelling' || current.cancelRequestedAt !== null) throw new ExecutionCancelledError();
    };
    try {
      await checkpoint();
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        await settle({ outcome: 'cancelled', error: { code: 'cancelled_before_tool_boundary' } });
        return 'cancelled';
      }
      await settle({ outcome: 'incomplete', error: { code: 'authorization_checkpoint_failed' } });
      return 'incomplete';
    }
    try {
      const invocationId = createHash('sha256').update(`uap-tool-v1\0${claimed.job.organizationId}\0${claimed.job.id}\0${action.kind}`).digest('hex');
      const result = jsonObject(await tool.execute(deepFreeze(action.input), Object.freeze({
        organizationId: claimed.job.organizationId,
        workspaceId: claimed.job.workspaceId,
        agentId: claimed.job.agentId,
        requesterSid: claimed.job.requesterSid,
        jobId: claimed.job.id,
        traceId: claimed.job.traceId,
        invocationId,
        checkpoint,
      })), 'tool result', 512 * 1024);
      await settle({ outcome: 'succeeded', result: { actionKind: action.kind, output: result } });
      return 'succeeded';
    } catch (error) {
      if (error instanceof ToolExecutionError && error.outcome !== 'unknown') {
        const retryable = error.retryable && claimed.job.retrySafety === 'idempotent' && tool.retryMode === 'idempotent';
        await settle({ outcome: 'failed', ...(retryable ? { retryDelayMs: this.retryDelayMs } : {}),
          error: { code: error.code, outcome: error.outcome, retryable } });
        return 'failed';
      }
      await settle({ outcome: 'incomplete', error: { code: 'tool_outcome_unknown' } });
      return 'incomplete';
    }
  }
}
