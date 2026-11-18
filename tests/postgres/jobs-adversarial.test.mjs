// Actual PostgreSQL boundaries: direct SQL, revoked memberships, and FORCE RLS.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { POSTGRES_MIGRATIONS } from '../../server/src/storage/postgres/schema.ts';
import { grantJobWorkerRole, UnsafeJobWorkerRoleError } from '../../server/src/storage/postgres/job-worker-grants.ts';
import { TenantJobRepository, WorkerJobRepository, JobConflictError } from '../../server/src/storage/postgres/jobs.ts';

if (process.env.UAP_POSTGRES_TEST_DATABASE !== '1' || !process.env.TEST_WORKER_DATABASE_URL) throw new Error('Use the disposable PostgreSQL harness.');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 2 });
const workers = new Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL, max: 3 });
const issuer = new Pool({ connectionString: process.env.TEST_ISSUER_DATABASE_URL, max: 1 });
const tenant = new TenantJobRepository(application);
const worker = new WorkerJobRepository(workers);
const prefix = `adversarial_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const id = name => `${prefix}_${name}`;
const org = id('org'), workspaceId = id('space'), requester = id('requester'), approver = id('approver');
const requesterScope = { organizationId: org, actorId: requester };
const approverScope = { organizationId: org, actorId: approver };
const action = { actionKind: 'local.write', actionPayload: { path: '/fixture/result', content: 'approved' }, policyVersion: 'p1', policyDecisionId: 'd1' };
const hash = value => createHash('sha256').update(value).digest('hex');
const lease = claim => ({ organizationId: claim.job.organizationId, jobId: claim.job.id, generation: claim.job.leaseGeneration, token: claim.leaseToken });
const quote = value => `"${value.replaceAll('"', '""')}"`;
let next = 0;

before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));
  await grantJobWorkerRole(admin, decodeURIComponent(new URL(process.env.TEST_WORKER_DATABASE_URL).username));
  for (const user of [requester, approver]) await admin.query('INSERT INTO uap.users VALUES ($1,$2,$1,1)', [user, `${user}@example.test`]);
  await admin.query('INSERT INTO uap.organizations VALUES ($1,$1,$1,1)', [org]);
  await admin.query("INSERT INTO uap.memberships VALUES ($1,$2,'member','active',1),($1,$3,'admin','active',1)", [org, requester, approver]);
  await admin.query('INSERT INTO uap.workspaces VALUES ($1,$2,$1,1)', [workspaceId, org]);
});
after(async () => { await issuer.end(); await workers.end(); await application.end(); await admin.end(); });

async function enqueue(name, overrides = {}) {
  const number = ++next;
  const agentId = id(`agent_${number}`);
  await admin.query(`INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$1,1,1)`, [agentId, org, workspaceId, requester]);
  const input = { agentId, workspaceId, title: name, kind: `test.${name}.${number}`, payload: {},
    idempotencyKey: id(`key_${number}`), retrySafety: 'idempotent', maxAttempts: 3,
    policyVersion: action.policyVersion, policyDecisionId: action.policyDecisionId, ...overrides };
  const stored = await tenant.enqueue(requesterScope, input);
  return { input, ...stored };
}
const claim = entry => worker.claim({ workerId: 'test-worker', kinds: [entry.input.kind], leaseMs: 60000 });
async function awaiting(name) {
  const entry = await enqueue(name);
  const claimed = await claim(entry);
  const approval = await worker.requestApproval({ ...lease(claimed), ...action, ttlMs: 60000 });
  return { ...entry, approval };
}
async function allowed(name) {
  const entry = await awaiting(name);
  await tenant.resolveApproval(approverScope, entry.approval.id, 'allow');
  const claimed = await claim(entry);
  return { ...entry, claimed };
}

test('raw SQL null token, generation and action digest cannot bypass transition fencing', async () => {
  const entry = await enqueue('null_fences');
  const claimed = await claim(entry);
  const generation = claimed.job.leaseGeneration, digest = hash(claimed.leaseToken);
  for (const [badGeneration, badDigest] of [[null, digest], [generation, null], [null, null]]) {
    await assert.rejects(workers.query('SELECT * FROM uap.heartbeat_task_job($1,$2,$3,$4,60000)', [org, entry.job.id, badGeneration, badDigest]), error => ['P0002','P0003'].includes(error.code));
    await assert.rejects(workers.query("SELECT * FROM uap.settle_task_job($1,$2,$3,$4,'succeeded',NULL,'{}','{}')", [org, entry.job.id, badGeneration, badDigest]), { code: 'P0002' });
    await assert.rejects(workers.query(`SELECT * FROM uap.request_task_approval($1,$2,$3,$4,$5,'local.write','{}',$6,
      floor(extract(epoch FROM clock_timestamp())*1000)::bigint+60000,'p1','d1',NULL)`,
    [org, entry.job.id, badGeneration, badDigest, id('bad_approval'), 'a'.repeat(64)]), { code: 'P0002' });
  }
  assert.equal((await tenant.getJob(requesterScope, entry.job.id)).state, 'running');
  assert.equal((await tenant.listEvents(requesterScope, entry.job.id)).length, 2);
  await worker.settle({ ...lease(claimed), outcome: 'succeeded' });

  const approved = await allowed('null_action');
  await assert.rejects(workers.query('SELECT * FROM uap.consume_task_approval($1,$2,$3,$4,$5,NULL)',
    [org, approved.job.id, approved.claimed.job.leaseGeneration, hash(approved.claimed.leaseToken), approved.approval.id]), { code: 'P0001' });
  assert.equal((await tenant.listApprovals(requesterScope, approved.job.id))[0].status, 'allowed');
  for (const pool of [admin, application, issuer]) {
    await assert.rejects(new WorkerJobRepository(pool).claim({ workerId: 'wrong-role', kinds: [entry.input.kind], leaseMs: 60000 }), UnsafeJobWorkerRoleError);
  }
});

test('a consumed one-action approval forces explicit retry into reconciliation', async () => {
  const entry = await allowed('consumed_retry');
  await worker.consumeApproval({ ...lease(entry.claimed), ...action, approvalId: entry.approval.id });
  const result = await worker.settle({ ...lease(entry.claimed), outcome: 'failed', retryDelayMs: 0, error: { code: 'unknown_external_outcome' } });
  assert.equal(result.state, 'incomplete');
  assert.equal(await claim(entry), null);
  assert.equal((await tenant.listApprovals(requesterScope, entry.job.id))[0].status, 'consumed');
});

test('consumed approvals in earlier runs still prohibit retry after a second approval pause', async () => {
  for (const mode of ['explicit_retry', 'lease_expiry']) {
    const entry = await allowed(`multiple_${mode}`);
    await worker.consumeApproval({ ...lease(entry.claimed), ...action, approvalId: entry.approval.id });
    const secondAction = { ...action, actionPayload: { path: '/fixture/second', content: 'second action' } };
    const secondApproval = await worker.requestApproval({ ...lease(entry.claimed), ...secondAction, ttlMs: 60000 });
    await tenant.resolveApproval(approverScope, secondApproval.id, 'allow');
    const resumed = await claim(entry);
    assert.ok(resumed);
    assert.ok(resumed.job.leaseGeneration > entry.claimed.job.leaseGeneration);
    if (mode === 'explicit_retry') {
      assert.equal((await worker.settle({ ...lease(resumed), outcome: 'failed', retryDelayMs: 0 })).state, 'incomplete');
    } else {
      await admin.query(`UPDATE uap.task_jobs SET heartbeat_at=created_at,
        lease_expires_at=greatest(created_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1)
        WHERE organization_id=$1 AND id=$2`, [org, entry.job.id]);
    }
    assert.equal(await claim(entry), null);
    assert.equal((await tenant.getJob(requesterScope, entry.job.id)).state, 'incomplete');
  }
});

test('requester suspension or demotion prevents queued dispatch', async () => {
  for (const change of ["state='suspended'", "role='viewer'"]) {
    const entry = await enqueue('requester_dispatch');
    try {
      await admin.query(`UPDATE uap.memberships SET ${change} WHERE organization_id=$1 AND user_id=$2`, [org, requester]);
      assert.equal(await claim(entry), null);
      assert.equal((await tenant.getJob(approverScope, entry.job.id)).state, 'queued');
    } finally {
      await admin.query("UPDATE uap.memberships SET state='active',role='member' WHERE organization_id=$1 AND user_id=$2", [org, requester]);
    }
    await tenant.requestCancellation(requesterScope, entry.job.id);
  }
});

test('requester and approver membership must still authorize consumption after human approval', async () => {
  for (const [actor, change, restoredRole] of [
    [requester, "state='suspended'", 'member'], [requester, "role='viewer'", 'member'],
    [approver, "state='suspended'", 'admin'], [approver, "role='member'", 'admin'],
  ]) {
    const entry = await allowed('consumption_membership');
    try {
      await admin.query(`UPDATE uap.memberships SET ${change} WHERE organization_id=$1 AND user_id=$2`, [org, actor]);
      await assert.rejects(worker.consumeApproval({ ...lease(entry.claimed), ...action, approvalId: entry.approval.id }), JobConflictError);
      const stored = (await admin.query('SELECT status FROM uap.approvals WHERE organization_id=$1 AND id=$2', [org, entry.approval.id])).rows[0];
      assert.equal(stored.status, 'allowed');
    } finally {
      await admin.query("UPDATE uap.memberships SET state='active',role=$3 WHERE organization_id=$1 AND user_id=$2", [org, actor, restoredRole]);
    }
    await worker.consumeApproval({ ...lease(entry.claimed), ...action, approvalId: entry.approval.id });
    await worker.settle({ ...lease(entry.claimed), outcome: 'succeeded' });
  }
});

test('an expired approval with a locked job does not stall unrelated worker dispatch', async () => {
  const expired = await awaiting('locked_expiry');
  await admin.query(`UPDATE uap.approvals SET requested_at=requested_at-60000,
    expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1
    WHERE organization_id=$1 AND id=$2`, [org, expired.approval.id]);
  const other = await enqueue('unrelated');
  const holder = await admin.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM uap.task_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE', [org, expired.job.id]);
    const claimed = await claim(other);
    assert.ok(claimed, 'claim must skip the expired job lock instead of waiting for it');
    await worker.settle({ ...lease(claimed), outcome: 'succeeded' });
  } finally { await holder.query('ROLLBACK'); holder.release(); }
  assert.equal(await claim(expired), null);
  assert.equal((await tenant.getJob(requesterScope, expired.job.id)).state, 'expired');
});

test('expired approvals beyond the bounded cleanup batch remain unclaimable', async () => {
  const target = await awaiting('expiry_backlog');
  await tenant.resolveApproval(approverScope, target.approval.id, 'allow');
  // Build 51 older expired grants through the administrative test fixture.
  // All are separate agents/jobs, so per-agent exclusion cannot hide the bug.
  const backlog = id('backlog');
  await admin.query(`INSERT INTO uap.agents SELECT (jsonb_populate_record(NULL::uap.agents,
    to_jsonb(source)||jsonb_build_object('id',$3||'_agent_'||series.n))).*
    FROM uap.agents source CROSS JOIN generate_series(1,51) series(n)
    WHERE source.organization_id=$1 AND source.id=$2`, [org, target.input.agentId, backlog]);
  await admin.query(`INSERT INTO uap.tasks SELECT (jsonb_populate_record(NULL::uap.tasks,
    to_jsonb(source)||jsonb_build_object('id',$3||'_task_'||series.n,'agent_id',$3||'_agent_'||series.n))).*
    FROM uap.tasks source CROSS JOIN generate_series(1,51) series(n)
    WHERE source.organization_id=$1 AND source.id=$2`, [org, target.task.id, backlog]);
  await admin.query(`INSERT INTO uap.task_jobs SELECT (jsonb_populate_record(NULL::uap.task_jobs,
    to_jsonb(source)||jsonb_build_object('id',$3||'_job_'||series.n,'task_id',$3||'_task_'||series.n,
      'agent_id',$3||'_agent_'||series.n,'idempotency_key',$3||'_key_'||series.n,'next_event_seq',1))).*
    FROM uap.task_jobs source CROSS JOIN generate_series(1,51) series(n)
    WHERE source.organization_id=$1 AND source.id=$2`, [org, target.job.id, backlog]);
  await admin.query(`INSERT INTO uap.approvals SELECT (jsonb_populate_record(NULL::uap.approvals,
    to_jsonb(source)||jsonb_build_object('id',$3||'_approval_'||series.n,'job_id',$3||'_job_'||series.n,
      'task_id',$3||'_task_'||series.n,'agent_id',$3||'_agent_'||series.n,
      'requested_at',source.requested_at-120000,'resolved_at',source.requested_at-110000,
      'expires_at',source.requested_at-60000))).*
    FROM uap.approvals source CROSS JOIN generate_series(1,51) series(n)
    WHERE source.organization_id=$1 AND source.id=$2`, [org, target.approval.id, backlog]);
  await admin.query(`UPDATE uap.approvals SET requested_at=requested_at-60000,
    expires_at=floor(extract(epoch FROM clock_timestamp())*1000)::bigint-1
    WHERE organization_id=$1 AND id=$2`, [org, target.approval.id]);
  assert.equal(await claim(target), null, 'an unswept expired approval must never allow dispatch');
  assert.equal((await tenant.getJob(requesterScope, target.job.id)).state, 'queued');
  assert.equal((await tenant.listApprovals(requesterScope, target.job.id))[0].status, 'allowed',
    'target must be outside the cleanup batch for this regression to be meaningful');
  assert.equal(await claim(target), null);
  assert.equal((await tenant.getJob(requesterScope, target.job.id)).state, 'expired');
});

test('an ordinary migration owner executes the complete approval flow under FORCE RLS', async () => {
  const schema = id('plain_owner');
  const role = decodeURIComponent(new URL(process.env.TEST_ISSUER_DATABASE_URL).username);
  await admin.query(`CREATE SCHEMA ${quote(schema)} AUTHORIZATION ${quote(role)}`);
  try {
    for (const migration of POSTGRES_MIGRATIONS) {
      await issuer.query(migration.sql.replaceAll('uap.', `${schema}.`)
        .replaceAll('SCHEMA uap ', `SCHEMA ${schema} `).replaceAll('pg_catalog, uap', `pg_catalog, ${schema}`));
    }
    const roleState = (await issuer.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(roleState, { rolsuper: false, rolbypassrls: false });
    await admin.query(`INSERT INTO ${schema}.users VALUES ('ordinary-user','ordinary@example.test','Ordinary',1)`);
    await admin.query(`INSERT INTO ${schema}.organizations VALUES ('ordinary-org','ordinary-org','Ordinary',1)`);
    await admin.query(`INSERT INTO ${schema}.memberships VALUES ('ordinary-org','ordinary-user','owner','active',1)`);
    await admin.query(`INSERT INTO ${schema}.workspaces VALUES ('ordinary-space','ordinary-org','Space',1)`);
    await admin.query(`INSERT INTO ${schema}.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at)
      VALUES ('ordinary-agent','ordinary-org','ordinary-space','ordinary-user','Agent',1,1)`);
    await issuer.query(`SELECT set_config($1,'ordinary-user',false),set_config($2,'ordinary-org',false)`, [`${schema}.actor_id`, `${schema}.organization_id`]);
    await issuer.query(`SELECT * FROM ${schema}.enqueue_task_job('ordinary-org','ordinary-task','ordinary-job','ordinary-space','ordinary-agent',
      'Task','','test.ordinary','{}','ordinary-key',$1,'reconcile_only',1,100,NULL,'ordinary-trace',NULL,'p1','d1','unmetered_local',NULL)`, ['a'.repeat(64)]);
    await issuer.query(`SELECT set_config($1,'',false),set_config($2,'',false)`, [`${schema}.actor_id`, `${schema}.organization_id`]);
    const first = (await issuer.query(`SELECT * FROM ${schema}.claim_task_job('ordinary-worker',ARRAY['test.ordinary'],60000,$1)`, ['b'.repeat(64)])).rows[0];
    assert.ok(first);
    await issuer.query(`SELECT * FROM ${schema}.request_task_approval('ordinary-org','ordinary-job',$1,$2,'ordinary-approval','local.write','{}',$3,
      floor(extract(epoch FROM clock_timestamp())*1000)::bigint+60000,'p1','d1',NULL)`, [first.lease_generation, 'b'.repeat(64), 'c'.repeat(64)]);
    await issuer.query(`SELECT set_config($1,'ordinary-user',false),set_config($2,'ordinary-org',false)`, [`${schema}.actor_id`, `${schema}.organization_id`]);
    await issuer.query(`SELECT * FROM ${schema}.resolve_task_approval('ordinary-org','ordinary-approval','allow')`);
    await issuer.query(`SELECT set_config($1,'',false),set_config($2,'',false)`, [`${schema}.actor_id`, `${schema}.organization_id`]);
    const resumed = (await issuer.query(`SELECT * FROM ${schema}.claim_task_job('ordinary-worker',ARRAY['test.ordinary'],60000,$1)`, ['d'.repeat(64)])).rows[0];
    assert.ok(resumed);
    await issuer.query(`SELECT * FROM ${schema}.consume_task_approval('ordinary-org','ordinary-job',$1,$2,'ordinary-approval',$3)`, [resumed.lease_generation, 'd'.repeat(64), 'c'.repeat(64)]);
    const settled = (await issuer.query(`SELECT * FROM ${schema}.settle_task_job('ordinary-org','ordinary-job',$1,$2,'succeeded',NULL,'{}','{}')`, [resumed.lease_generation, 'd'.repeat(64)])).rows[0];
    assert.equal(settled.state, 'succeeded');
  } finally { await admin.query(`DROP SCHEMA ${quote(schema)} CASCADE`); }
});
