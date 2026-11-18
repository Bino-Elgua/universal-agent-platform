import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DurableExecutor, ToolExecutionError } from '../server/src/executor/durable-executor.ts';

const baseJob = {
  organizationId: 'org-1', id: 'job-1', taskId: 'task-1', workspaceId: 'space-1', agentId: 'agent-1',
  kind: 'local.fixture', payload: { execution: { version: 1, action: { kind: 'fixture.echo', input: { message: 'hello' } } } },
  idempotencyKey: 'request-1', retrySafety: 'idempotent', executionCostClass: 'unmetered_local', state: 'running',
  priority: 100, availableAt: 1, attemptCount: 1, maxAttempts: 3, leaseGeneration: 1, leaseOwner: 'worker-1',
  leaseExpiresAt: 60001, heartbeatAt: 1, cancelRequestedAt: null, traceId: 'trace-1', requesterSid: 'sid-1',
  policyVersion: 'policy-v1', policyDecisionId: 'decision-1', budgetReservationId: null, lastError: null,
  createdAt: 1, updatedAt: 1, finishedAt: null,
};

function allowed(overrides = {}) {
  return { allowed: true, reasonCode: 'allowed', policyVersion: 'policy-v1', policyDecisionId: 'decision-1',
    executionCostClass: 'unmetered_local', budgetReservationId: null, approval: 'not_required', ...overrides };
}

function fixture(overrides = {}) {
  const calls = [];
  const job = structuredClone(overrides.job ?? baseJob);
  const heartbeatJobs = overrides.heartbeatJobs ? [...overrides.heartbeatJobs] : null;
  let claimed = false;
  const jobs = {
    async claim(input) {
      calls.push(['claim', input]);
      if (claimed) return null;
      claimed = true;
      return { job, leaseToken: 'lease-token' };
    },
    async heartbeat(input) {
      calls.push(['heartbeat', input]);
      if (overrides.heartbeatError) throw overrides.heartbeatError;
      return { ...job, ...((heartbeatJobs?.shift()) ?? overrides.heartbeatJob ?? {}) };
    },
    async settle(input) {
      calls.push(['settle', input]);
      return { ...job, state: input.outcome };
    },
  };
  let authorizations = 0;
  const authorizer = {
    async authorize(request) {
      calls.push(['authorize', structuredClone(request)]);
      authorizations++;
      if (overrides.authorizationError) throw overrides.authorizationError;
      return overrides.decision ?? allowed();
    },
  };
  let executions = 0;
  const tool = {
    kind: 'fixture.echo', executionCostClass: 'unmetered_local', retryMode: overrides.retryMode ?? 'idempotent',
    async execute(input, context) {
      calls.push(['execute', structuredClone(input), context.invocationId]);
      executions++;
      if (overrides.toolError) throw overrides.toolError;
      return overrides.result ?? { echoed: input.message };
    },
  };
  const executor = new DurableExecutor({ workerId: 'worker-1', jobKinds: ['local.fixture'], leaseMs: 60000,
    retryDelayMs: 2500, jobs, authorizer, tools: overrides.tools ?? [tool] });
  return { executor, calls, get authorizations() { return authorizations; }, get executions() { return executions; } };
}

test('a policy-bound local action checkpoints immediately before its registered tool and settles verified output', async () => {
  const current = fixture();
  assert.equal(await current.executor.runOnce(), 'succeeded');
  assert.deepEqual(current.calls.map(call => call[0]), ['claim', 'authorize', 'heartbeat', 'execute', 'settle']);
  const request = current.calls[1][1];
  assert.deepEqual(request.action, { kind: 'fixture.echo', input: { message: 'hello' } });
  assert.equal(request.policyVersion, baseJob.policyVersion);
  assert.equal(request.policyDecisionId, baseJob.policyDecisionId);
  assert.match(current.calls[3][2], /^[a-f0-9]{64}$/);
  assert.deepEqual(current.calls[4][1].result, { actionKind: 'fixture.echo', output: { echoed: 'hello' } });
  assert.equal(await current.executor.runOnce(), 'idle');
});

test('unknown tools and malformed execution envelopes fail before authorization or execution', async () => {
  for (const job of [
    { ...baseJob, payload: { execution: { version: 1, action: { kind: 'fixture.missing', input: {} } } } },
    { ...baseJob, payload: { execution: { version: 2, action: { kind: 'fixture.echo', input: {} } } } },
    { ...baseJob, payload: { execution: { version: 1, action: { kind: 'fixture.echo', input: { lost: undefined } } } } },
    { ...baseJob, payload: { execution: { version: 1, action: { kind: 'fixture.echo', input: { invalid: Number.NaN } } } } },
    { ...baseJob, payload: { execution: { version: 1, action: { kind: 'fixture.echo', input: { invalid: new Date(0) } } } } },
  ]) {
    const current = fixture({ job });
    assert.equal(await current.executor.runOnce(), 'failed');
    assert.equal(current.authorizations, 0);
    assert.equal(current.executions, 0);
    assert.match(current.calls.at(-1)[1].error.code, /^(tool_not_registered|invalid_execution_contract)$/);
  }
});

test('policy denial, mismatched authority, paid authority and unavailable policy all fail closed', async () => {
  const cases = [
    [{ decision: allowed({ allowed: false, reasonCode: 'tool_denied' }) }, 'failed', 'policy_denied'],
    [{ decision: allowed({ policyDecisionId: 'substituted' }) }, 'incomplete', 'policy_decision_mismatch'],
    [{ authorizationError: new Error('offline') }, 'incomplete', 'policy_service_unavailable'],
    [{ job: { ...baseJob, executionCostClass: 'reserved_paid', budgetReservationId: 'reservation-1' } }, 'incomplete', 'unsupported_execution_authority'],
    [{ decision: allowed({ approval: 'required' }) }, 'failed', 'approval_required_unsupported'],
  ];
  for (const [options, status, code] of cases) {
    const current = fixture(options);
    assert.equal(await current.executor.runOnce(), status);
    assert.equal(current.executions, 0);
    assert.equal(current.calls.at(-1)[1].error.code, code);
  }
});

test('cancellation and revoked membership at the checkpoint prevent the tool call', async () => {
  const cancelled = fixture({ heartbeatJob: { state: 'cancelling', cancelRequestedAt: 10 } });
  assert.equal(await cancelled.executor.runOnce(), 'cancelled');
  assert.equal(cancelled.executions, 0);
  assert.equal(cancelled.calls.at(-1)[1].outcome, 'cancelled');

  const revoked = fixture({ heartbeatError: new Error('requester is no longer authorized') });
  assert.equal(await revoked.executor.runOnce(), 'incomplete');
  assert.equal(revoked.executions, 0);
  assert.equal(revoked.calls.at(-1)[1].error.code, 'authorization_checkpoint_failed');
});

test('only explicit known idempotent failures are retried', async () => {
  const retry = fixture({ toolError: new ToolExecutionError('temporary', 'not_started', true) });
  assert.equal(await retry.executor.runOnce(), 'failed');
  assert.equal(retry.calls.at(-1)[1].retryDelayMs, 2500);
  assert.equal(retry.calls.at(-1)[1].error.retryable, true);

  const nonIdempotent = fixture({ retryMode: 'never', toolError: new ToolExecutionError('temporary', 'not_started', true) });
  assert.equal(await nonIdempotent.executor.runOnce(), 'failed');
  assert.equal('retryDelayMs' in nonIdempotent.calls.at(-1)[1], false);
  assert.equal(nonIdempotent.calls.at(-1)[1].error.retryable, false);
});

test('ambiguous tool errors and invalid outputs settle incomplete instead of replaying side effects', async () => {
  for (const options of [
    { toolError: new Error('connection lost after send') },
    { toolError: new ToolExecutionError('provider outcome unknown', 'unknown', true) },
    { result: { invalid: undefined } },
  ]) {
    const current = fixture(options);
    assert.equal(await current.executor.runOnce(), 'incomplete');
    assert.equal(current.calls.at(-1)[1].outcome, 'incomplete');
    assert.equal(current.calls.at(-1)[1].error.code, 'tool_outcome_unknown');
    assert.equal('retryDelayMs' in current.calls.at(-1)[1], false);
  }
});

test('cancellation observed by a nested tool checkpoint is treated as a partial unknown outcome', async () => {
  let sideEffectStarted = false;
  const tool = {
    kind: 'fixture.echo', executionCostClass: 'unmetered_local', retryMode: 'never',
    async execute(_input, context) {
      sideEffectStarted = true;
      await context.checkpoint();
      return { unreachable: true };
    },
  };
  const current = fixture({ tools: [tool], heartbeatJobs: [{ state: 'running' }, { state: 'cancelling', cancelRequestedAt: 10 }] });
  assert.equal(await current.executor.runOnce(), 'incomplete');
  assert.equal(sideEffectStarted, true);
  assert.equal(current.calls.at(-1)[1].error.code, 'tool_outcome_unknown');
});
