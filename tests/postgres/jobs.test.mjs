// Real PostgreSQL state transitions; no provider calls or paid execution.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { grantJobWorkerRole } from '../../server/src/storage/postgres/job-worker-grants.ts';
import { TenantJobRepository, WorkerJobRepository, JobConflictError, JobValidationError, StaleJobLeaseError } from '../../server/src/storage/postgres/jobs.ts';
import { TenantAccessError, withTenant } from '../../server/src/storage/postgres/connection.ts';

if (process.env.UAP_POSTGRES_TEST_DATABASE !== '1' || !process.env.TEST_WORKER_DATABASE_URL) throw new Error('Use the disposable PostgreSQL harness.');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 8 });
const workerPool = new Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL, max: 8 });
const tenant = new TenantJobRepository(application);
const worker = new WorkerJobRepository(workerPool);
const prefix = `jobs_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const id = name => `${prefix}_${name}`;
const ownerA = id('owner_a'), ownerB = id('owner_b'), viewer = id('viewer'), member = id('member'), suspended = id('suspended');
const orgA = id('org_a'), orgB = id('org_b'), spaceA = id('space_a'), spaceB = id('space_b');
const scopeA = { actorId: ownerA, organizationId: orgA };
const scopeB = { actorId: ownerB, organizationId: orgB };
const viewerScope = { actorId: viewer, organizationId: orgA };
const memberScope = { actorId: member, organizationId: orgA };
let sequence = 0;
before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));
  await grantJobWorkerRole(admin, decodeURIComponent(new URL(process.env.TEST_WORKER_DATABASE_URL).username));
  const now = Date.now();
  for (const actor of [ownerA, ownerB, viewer, member, suspended]) await admin.query('INSERT INTO uap.users VALUES ($1,$2,$3,$4)', [actor, `${actor}@example.test`, actor, now]);
  for (const [org, owner, space] of [[orgA, ownerA, spaceA], [orgB, ownerB, spaceB]]) {
    await admin.query('INSERT INTO uap.organizations VALUES ($1,$1,$1,$2)', [org, now]);
    await admin.query("INSERT INTO uap.memberships VALUES ($1,$2,'owner','active',$3)", [org, owner, now]);
    await admin.query('INSERT INTO uap.workspaces VALUES ($1,$2,$1,$3)', [space, org, now]);
  }
  for (const [actor, role, state] of [[viewer, 'viewer', 'active'], [member, 'member', 'active'], [suspended, 'member', 'suspended']]) {
    await admin.query('INSERT INTO uap.memberships VALUES ($1,$2,$3,$4,$5)', [orgA, actor, role, state, now]);
  }
});
after(async () => { await workerPool.end(); await application.end(); await admin.end(); });

async function request(name, overrides = {}, scope = scopeA) {
  const n = ++sequence;
  const agentId = id(`agent_${name}_${n}`);
  const workspaceId = scope.organizationId === orgA ? spaceA : spaceB;
  await admin.query(`INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$1,1,1)`, [agentId, scope.organizationId, workspaceId, scope.actorId]);
  return { workspaceId, agentId, title: name, kind: `test.${name}.${n}`, payload: { input: name }, idempotencyKey: id(`key_${n}`), ...overrides };
}
const lease = claim => ({ organizationId: claim.job.organizationId, jobId: claim.job.id, generation: claim.job.leaseGeneration, token: claim.leaseToken });
const claim = input => worker.claim({ workerId: id('worker'), kinds: [input.kind], leaseMs: 60000 });
const action = { actionKind: 'local.write', actionPayload: { path: '/task/result.txt', text: 'approved' }, policyVersion: 'v1', policyDecisionId: 'decision-1' };
async function approvalJob(name, overrides = {}) {
  const input = await request(name, { policyVersion: action.policyVersion, policyDecisionId: action.policyDecisionId, maxAttempts: 1, ...overrides });
  const stored = await tenant.enqueue(scopeA, input);
  const current = await claim(input);
  const approval = await worker.requestApproval({ ...lease(current), ...action, ttlMs: 60000 });
  return { input, stored, current, approval };
}
async function expireLease(current) {
  await admin.query(`UPDATE uap.task_jobs SET heartbeat_at=created_at,
    lease_expires_at=greatest(created_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1)
    WHERE organization_id=$1 AND id=$2`, [current.job.organizationId, current.job.id]);
}
async function expireApproval(approval) {
  await admin.query(`UPDATE uap.approvals SET requested_at=requested_at-60000,
    expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1
    WHERE organization_id=$1 AND id=$2`, [approval.organizationId, approval.id]);
}

test('concurrent identical enqueue creates one task, one job and one event; changed immutable requests conflict', async () => {
  const input = await request('dedupe', { retrySafety: 'idempotent', payload: { b: 2, nested: { z: true, a: 1 } } });
  const writes = await Promise.all(Array.from({ length: 8 }, () => tenant.enqueue(scopeA, input)));
  assert.equal(new Set(writes.map(value => value.job.id)).size, 1);
  assert.equal(new Set(writes.map(value => value.task.id)).size, 1);
  assert.equal((await tenant.listEvents(scopeA, writes[0].job.id)).length, 1);
  const equivalent = await tenant.enqueue(scopeA, { ...input, payload: { nested: { a: 1, z: true }, b: 2 } });
  assert.equal(equivalent.job.id, writes[0].job.id);
  for (const change of [{ payload: { changed: true } }, { maxAttempts: 4 }, { title: 'Changed' }, { traceId: 'changed-trace' }]) {
    await assert.rejects(tenant.enqueue(scopeA, { ...input, ...change }), JobConflictError);
  }
  await assert.rejects(tenant.enqueue(memberScope, input), JobConflictError);
});

test('tenant IDs, viewers, suspended actors and blank SQL contexts cannot bypass data boundaries', async () => {
  const a = await request('isolation');
  const first = await tenant.enqueue(scopeA, { ...a, jobId: 'same-job-id', taskId: 'same-task-id' });
  const b = await request('isolation_b', {}, scopeB);
  const second = await tenant.enqueue(scopeB, { ...b, jobId: 'same-job-id', taskId: 'same-task-id' });
  assert.equal((await tenant.getJob(scopeA, first.job.id)).agentId, a.agentId);
  assert.equal((await tenant.getJob(scopeB, second.job.id)).agentId, b.agentId);
  assert.equal(await tenant.getJob(scopeB, id('absent')), null);
  assert.deepEqual(await tenant.listJobs(scopeB, { agentId: a.agentId }), []);
  assert.equal((await tenant.getJob(viewerScope, first.job.id)).id, first.job.id);
  await assert.rejects(tenant.enqueue(viewerScope, a), TenantAccessError);
  await assert.rejects(tenant.requestCancellation(viewerScope, first.job.id), TenantAccessError);
  await assert.rejects(tenant.requestCancellation(memberScope, first.job.id), TenantAccessError);
  await assert.rejects(tenant.getJob({ actorId: suspended, organizationId: orgA }, first.job.id), TenantAccessError);
  await assert.rejects(tenant.enqueue(scopeA, { ...a, idempotencyKey: 'foreign-space', workspaceId: spaceB }));
  for (const table of ['tasks', 'task_jobs', 'agent_runs', 'approvals', 'job_events']) {
    assert.equal((await application.query(`SELECT * FROM uap.${table}`)).rowCount, 0);
    await assert.rejects(withTenant(application, scopeA, client => client.query(`UPDATE uap.${table} SET organization_id=organization_id`)), TenantAccessError);
  }
});

test('concurrent workers claim one winner per agent and independent agents progress', async () => {
  const input = await request('claims', { retrySafety: 'idempotent' });
  const first = await tenant.enqueue(scopeA, input);
  await tenant.enqueue(scopeA, { ...input, idempotencyKey: id('second_claim'), title: 'Second on same agent' });
  const attempts = await Promise.all(Array.from({ length: 8 }, () => claim(input)));
  const winners = attempts.filter(Boolean);
  assert.equal(winners.length, 1);
  const current = winners[0];
  assert.match(current.leaseToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal('leaseTokenHash' in current.job, false);
  const persisted = (await admin.query('SELECT lease_token_hash FROM uap.task_jobs WHERE organization_id=$1 AND id=$2', [orgA, current.job.id])).rows[0];
  assert.equal(persisted.lease_token_hash, createHash('sha256').update(current.leaseToken).digest('hex'));
  assert.equal(await claim(input), null);
  const other = await request('independent');
  await tenant.enqueue(scopeA, other);
  const independent = await claim(other);
  assert.ok(independent);
  await worker.settle({ ...lease(independent), outcome: 'succeeded' });
  await worker.settle({ ...lease(current), outcome: 'succeeded', result: { verified: true } });
  const next = await claim(input);
  assert.ok(next);
  assert.notEqual(next.job.id, current.job.id);
  await worker.settle({ ...lease(next), outcome: 'succeeded' });
  assert.equal((await tenant.getTask(scopeA, first.task.id)).state, 'succeeded');
});

test('a closed worker connection survives as durable state and expired lease recovery fences its token', async () => {
  const input = await request('restart', { retrySafety: 'idempotent', maxAttempts: 3 });
  await tenant.enqueue(scopeA, input);
  const originalPool = new Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL, max: 1 });
  const original = await new WorkerJobRepository(originalPool).claim({ workerId: 'departed-worker', kinds: [input.kind], leaseMs: 1000 });
  await originalPool.end();
  await new Promise(resolve => setTimeout(resolve, 1100));
  const recovered = await claim(input);
  assert.ok(recovered);
  assert.equal(recovered.job.id, original.job.id);
  assert.equal(recovered.job.leaseGeneration, original.job.leaseGeneration + 1);
  assert.equal(recovered.job.attemptCount, 2);
  await assert.rejects(worker.heartbeat({ ...lease(original), leaseMs: 1000 }), StaleJobLeaseError);
  await assert.rejects(worker.settle({ ...lease(original), outcome: 'succeeded' }), StaleJobLeaseError);
  await assert.rejects(worker.settle({ ...lease(recovered), organizationId: orgB, outcome: 'succeeded' }), StaleJobLeaseError);
  const renewed = await worker.heartbeat({ ...lease(recovered), leaseMs: 90000 });
  assert.ok(renewed.leaseExpiresAt > recovered.job.leaseExpiresAt);
  await worker.settle({ ...lease(recovered), outcome: 'succeeded' });
  const runs = (await admin.query('SELECT state FROM uap.agent_runs WHERE organization_id=$1 AND job_id=$2 ORDER BY lease_generation', [orgA, original.job.id])).rows;
  assert.deepEqual(runs.map(run => run.state), ['lost', 'succeeded']);
});

test('retry delays and attempt limits are enforced; ambiguous non-idempotent leases require reconciliation', async () => {
  const input = await request('retries', { retrySafety: 'idempotent', maxAttempts: 2 });
  const stored = await tenant.enqueue(scopeA, input);
  const first = await claim(input);
  assert.equal((await worker.settle({ ...lease(first), outcome: 'failed', retryDelayMs: 60000, error: { code: 'transient' } })).state, 'queued');
  assert.equal(await claim(input), null);
  await admin.query('UPDATE uap.task_jobs SET available_at=0 WHERE organization_id=$1 AND id=$2', [orgA, stored.job.id]);
  const last = await claim(input);
  assert.equal((await worker.settle({ ...lease(last), outcome: 'failed', retryDelayMs: 0 })).state, 'dead_letter');
  assert.equal(await claim(input), null);
  const unsafe = await request('unsafe_recovery', { retrySafety: 'reconcile_only' });
  const unsafeStored = await tenant.enqueue(scopeA, unsafe);
  const abandoned = await claim(unsafe);
  await expireLease(abandoned);
  assert.equal(await claim(unsafe), null);
  assert.equal((await tenant.getJob(scopeA, unsafeStored.job.id)).state, 'incomplete');
});

test('approval can resume a one-attempt job and consumption binds the exact payload once', async () => {
  const { input, stored, current, approval } = await approvalJob('approval');
  assert.equal((await tenant.getJob(scopeA, stored.job.id)).state, 'awaiting_approval');
  assert.equal(await claim(input), null);
  assert.deepEqual(await tenant.listApprovals(viewerScope, stored.job.id), []);
  await assert.rejects(tenant.resolveApproval(viewerScope, approval.id, 'allow'), TenantAccessError);
  await assert.rejects(worker.heartbeat({ ...lease(current), leaseMs: 1000 }), StaleJobLeaseError);
  const allowed = await tenant.resolveApproval(scopeA, approval.id, 'allow');
  assert.equal(allowed.status, 'allowed');
  assert.equal((await tenant.resolveApproval(scopeA, approval.id, 'allow')).status, 'allowed');
  const resumed = await claim(input);
  assert.ok(resumed, 'approval suspension must not exhaust maxAttempts=1');
  assert.ok(resumed.job.leaseGeneration > current.job.leaseGeneration);
  await assert.rejects(worker.consumeApproval({ ...lease(resumed), ...action, approvalId: approval.id, actionPayload: { text: 'different' } }), JobConflictError);
  const consumed = await worker.consumeApproval({ ...lease(resumed), ...action, approvalId: approval.id });
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.consumedLeaseGeneration, resumed.job.leaseGeneration);
  await assert.rejects(worker.consumeApproval({ ...lease(resumed), ...action, approvalId: approval.id }), JobConflictError);
  await worker.settle({ ...lease(resumed), outcome: 'succeeded' });
});

test('pending and previously allowed approvals expire without losing the recorded human decision', async () => {
  for (const allowed of [false, true]) {
    const state = await approvalJob(allowed ? 'allowed_expiry' : 'pending_expiry');
    if (allowed) await tenant.resolveApproval(scopeA, state.approval.id, 'allow');
    await expireApproval(state.approval);
    assert.equal(await claim(state.input), null);
    const expired = (await tenant.listApprovals(scopeA, state.stored.job.id))[0];
    assert.equal(expired.status, 'expired');
    assert.equal(expired.resolvedByUserId, allowed ? ownerA : null);
    assert.equal((await tenant.getJob(scopeA, state.stored.job.id)).state, 'expired');
  }
});

test('denial and revocation prevent dispatch; revocation after claim requires cancellation acknowledgment', async () => {
  const denied = await approvalJob('denied');
  assert.equal((await tenant.resolveApproval(scopeA, denied.approval.id, 'deny')).status, 'denied');
  assert.equal(await claim(denied.input), null);
  await assert.rejects(tenant.resolveApproval(scopeA, denied.approval.id, 'allow'), JobConflictError);
  const revoked = await approvalJob('revoked');
  await tenant.resolveApproval(scopeA, revoked.approval.id, 'allow');
  await tenant.resolveApproval(scopeA, revoked.approval.id, 'revoke');
  assert.equal(await claim(revoked.input), null);
  const running = await approvalJob('revoke_running');
  await tenant.resolveApproval(scopeA, running.approval.id, 'allow');
  const resumed = await claim(running.input);
  await tenant.resolveApproval(scopeA, running.approval.id, 'revoke');
  assert.equal((await tenant.getJob(scopeA, running.stored.job.id)).state, 'cancelling');
  await assert.rejects(worker.consumeApproval({ ...lease(resumed), ...action, approvalId: running.approval.id }));
  await assert.rejects(worker.settle({ ...lease(resumed), outcome: 'succeeded' }), JobConflictError);
  assert.equal((await worker.settle({ ...lease(resumed), outcome: 'cancelled' })).state, 'cancelled');
});

test('queued cancellation is final; running cancellation remains durable until confirmed or reconciled', async () => {
  const queued = await request('cancel_queued');
  const stored = await tenant.enqueue(scopeA, queued);
  assert.equal((await tenant.requestCancellation(scopeA, stored.job.id)).state, 'cancelled');
  assert.equal(await claim(queued), null);
  const input = await request('cancel_running', { retrySafety: 'idempotent' });
  const running = await tenant.enqueue(scopeA, input);
  const active = await claim(input);
  assert.equal((await tenant.requestCancellation(scopeA, running.job.id)).state, 'cancelling');
  await assert.rejects(worker.settle({ ...lease(active), outcome: 'succeeded' }), JobConflictError);
  await expireLease(active);
  assert.equal(await claim(input), null);
  assert.equal((await tenant.getJob(scopeA, running.job.id)).state, 'incomplete');
});

test('events are ordered, causal, append-only and transaction failure cannot partially enqueue', async () => {
  const input = await request('events');
  const stored = await tenant.enqueue(scopeA, input);
  const active = await claim(input);
  await worker.settle({ ...lease(active), outcome: 'succeeded' });
  const events = await tenant.listEvents(scopeA, stored.job.id);
  assert.deepEqual(events.map(event => event.seq), [1, 2, 3]);
  assert.deepEqual(events.map(event => event.eventType), ['job.queued', 'job.claimed', 'job.succeeded']);
  assert.equal(new Set(events.map(event => event.eventId)).size, events.length);
  for (let index = 0; index < events.length; index++) {
    assert.equal(events[index].causalEventId, index ? events[index - 1].eventId : null);
    assert.equal(events[index].workspaceId, input.workspaceId);
    assert.equal(events[index].agentId, input.agentId);
  }
  await assert.rejects(withTenant(application, scopeA, client => client.query('DELETE FROM uap.job_events')), TenantAccessError);
  const rollback = await request('rollback');
  await admin.query(`CREATE FUNCTION uap.reject_job_fixture() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF NEW.event_type='job.queued' THEN RAISE EXCEPTION 'intentional test failure'; END IF; RETURN NEW; END $f$`);
  await admin.query('REVOKE ALL ON FUNCTION uap.reject_job_fixture() FROM PUBLIC');
  try {
    await admin.query('CREATE TRIGGER reject_job_fixture BEFORE INSERT ON uap.job_events FOR EACH ROW EXECUTE FUNCTION uap.reject_job_fixture()');
    await assert.rejects(tenant.enqueue(scopeA, rollback));
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM uap.tasks WHERE agent_id=$1', [rollback.agentId])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM uap.task_jobs WHERE agent_id=$1', [rollback.agentId])).rows[0].n, 0);
  } finally {
    await admin.query('DROP TRIGGER IF EXISTS reject_job_fixture ON uap.job_events');
    await admin.query('DROP FUNCTION uap.reject_job_fixture()');
  }
  assert.equal((await tenant.enqueue(scopeA, rollback)).job.state, 'queued');
});

test('a caller-supplied paid reservation cannot authorize execution and malformed requests do not persist', async () => {
  const input = await request('paid', { executionCostClass: 'reserved_paid', budgetReservationId: 'unverified-reservation' });
  const stored = await tenant.enqueue(scopeA, input);
  assert.equal(await claim(input), null);
  assert.equal((await tenant.getJob(scopeA, stored.job.id)).state, 'queued');
  await assert.rejects(tenant.enqueue(scopeA, { ...input, budgetReservationId: undefined }), JobValidationError);
  await assert.rejects(tenant.enqueue(scopeA, { ...input, payload: { invalid: undefined } }), JobValidationError);
  await assert.rejects(worker.claim({ workerId: 'worker', kinds: [input.kind], leaseMs: null }), JobValidationError);
});
