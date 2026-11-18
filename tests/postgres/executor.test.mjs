// Complete PostgreSQL claim -> policy -> checkpoint -> tool -> settlement flow.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { DurableExecutor } from '../../server/src/executor/durable-executor.ts';
import { grantJobWorkerRole } from '../../server/src/storage/postgres/job-worker-grants.ts';
import { TenantJobRepository, WorkerJobRepository } from '../../server/src/storage/postgres/jobs.ts';
import { grantApplicationRole, migratePostgres } from '../../server/src/storage/postgres/migrations.ts';

if (process.env.UAP_POSTGRES_TEST_DATABASE !== '1' || !process.env.TEST_WORKER_DATABASE_URL) throw new Error('Use the disposable PostgreSQL harness.');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 2 });
const workers = new Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL, max: 2 });
const tenant = new TenantJobRepository(application);
const jobs = new WorkerJobRepository(workers);
const prefix = `executor_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const id = name => `${prefix}_${name}`;
const organizationId = id('org'), workspaceId = id('space'), actorId = id('owner'), agentId = id('agent');
const scope = { organizationId, actorId };
let sequence = 0;

before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));
  await grantJobWorkerRole(admin, decodeURIComponent(new URL(process.env.TEST_WORKER_DATABASE_URL).username));
  await admin.query('INSERT INTO uap.users VALUES ($1,$2,$1,1)', [actorId, `${actorId}@example.test`]);
  await admin.query('INSERT INTO uap.organizations VALUES ($1,$1,$1,1)', [organizationId]);
  await admin.query("INSERT INTO uap.memberships VALUES ($1,$2,'owner','active',1)", [organizationId, actorId]);
  await admin.query('INSERT INTO uap.workspaces VALUES ($1,$2,$1,1)', [workspaceId, organizationId]);
  await admin.query(`INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$1,1,1)`, [agentId, organizationId, workspaceId, actorId]);
});
after(async () => { await workers.end(); await application.end(); await admin.end(); });

function decision(overrides = {}) {
  return { allowed: true, reasonCode: 'allowed', policyVersion: 'local-v1', policyDecisionId: 'allow-fixture',
    executionCostClass: 'unmetered_local', budgetReservationId: null, approval: 'not_required', ...overrides };
}

async function enqueue(name) {
  const number = ++sequence;
  const kind = `local.executor.${name}.${number}`;
  const stored = await tenant.enqueue(scope, { workspaceId, agentId, title: name, kind,
    payload: { execution: { version: 1, action: { kind: 'fixture.record', input: { name, number } } } },
    idempotencyKey: id(`request_${number}`), retrySafety: 'idempotent', policyVersion: 'local-v1', policyDecisionId: 'allow-fixture' });
  return { kind, stored };
}

function executor(kind, authorize, execute) {
  return new DurableExecutor({ workerId: id('worker'), jobKinds: [kind], leaseMs: 60000, jobs,
    authorizer: { authorize }, tools: [{ kind: 'fixture.record', executionCostClass: 'unmetered_local', retryMode: 'idempotent', execute }] });
}

test('real durable execution crosses claim, current authorization, tool and settlement boundaries', async () => {
  const entry = await enqueue('success');
  const invocations = [];
  const runtime = executor(entry.kind, async request => {
    assert.equal(request.organizationId, organizationId);
    assert.equal(request.policyDecisionId, 'allow-fixture');
    return decision();
  }, async (input, context) => {
    invocations.push(context.invocationId);
    return { recorded: input.name };
  });
  assert.equal(await runtime.runOnce(), 'succeeded');
  assert.equal(invocations.length, 1);
  assert.equal((await tenant.getJob(scope, entry.stored.job.id)).state, 'succeeded');
  assert.deepEqual((await tenant.listEvents(scope, entry.stored.job.id)).map(event => event.eventType), ['job.queued', 'job.claimed', 'job.succeeded']);
  assert.equal((await tenant.listRuns(scope, entry.stored.job.id))[0].state, 'succeeded');
});

test('membership revoked after policy evaluation prevents the real tool invocation', async () => {
  const entry = await enqueue('revoked');
  let executed = false;
  const runtime = executor(entry.kind, async () => {
    await admin.query("UPDATE uap.memberships SET state='suspended' WHERE organization_id=$1 AND user_id=$2", [organizationId, actorId]);
    return decision();
  }, async () => { executed = true; return {}; });
  try {
    assert.equal(await runtime.runOnce(), 'incomplete');
  } finally {
    await admin.query("UPDATE uap.memberships SET state='active' WHERE organization_id=$1 AND user_id=$2", [organizationId, actorId]);
  }
  assert.equal(executed, false);
  assert.equal((await tenant.getJob(scope, entry.stored.job.id)).state, 'incomplete');
});

test('cancellation arriving after policy evaluation is acknowledged before the tool call', async () => {
  const entry = await enqueue('cancelled');
  let executed = false;
  const runtime = executor(entry.kind, async () => {
    await tenant.requestCancellation(scope, entry.stored.job.id);
    return decision();
  }, async () => { executed = true; return {}; });
  assert.equal(await runtime.runOnce(), 'cancelled');
  assert.equal(executed, false);
  assert.equal((await tenant.getJob(scope, entry.stored.job.id)).state, 'cancelled');
});
