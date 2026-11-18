// Actual disposable PostgreSQL, direct least-privileged logins; no model/runtime execution.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { ConversationRepository } from '../../server/src/storage/postgres/conversations.ts';
import { RepositoryConstraintError, RepositoryValidationError } from '../../server/src/storage/postgres/repository.ts';
import { TenantAccessError, withTenant } from '../../server/src/storage/postgres/connection.ts';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) throw new Error('Run through npm run test:postgres with a disposable database.');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
// Parallel connections exercise PostgreSQL row locks, rather than relying on pool serialization.
const parallel = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 8 });
const repository = new ConversationRepository(application);
const concurrent = new ConversationRepository(parallel);
const prefix = `conversation_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const id = suffix => `${prefix}_${suffix}`;
const actorA = id('owner_a');
const actorB = id('owner_b');
const viewer = id('viewer');
const orgA = id('org_a');
const orgB = id('org_b');
const workspaceA = id('workspace_a');
const workspaceB = id('workspace_b');
const scopeA = { actorId: actorA, organizationId: orgA };
const scopeB = { actorId: actorB, organizationId: orgB };
const viewerScope = { actorId: viewer, organizationId: orgA };
const now = Date.now();
async function agent(suffix, organizationId = orgA, workspaceId = workspaceA, owner = actorA) {
  const agentId = id(suffix);
  await admin.query('INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
    [agentId, organizationId, workspaceId, owner, 'Conversation agent', now]);
  return agentId;
}
before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));
  for (const userId of [actorA, actorB, viewer]) await admin.query('INSERT INTO uap.users(id,email,name,created_at) VALUES ($1,$2,$3,$4)', [userId, `${userId}@example.invalid`, userId, now]);
  await admin.query('INSERT INTO uap.organizations(id,slug,name,created_at) VALUES ($1,$2,$3,$4),($5,$6,$7,$4)', [orgA, `${prefix}_a`, 'A', now, orgB, `${prefix}_b`, 'B']);
  for (const [organizationId, actor, role] of [[orgA, actorA, 'owner'], [orgB, actorB, 'owner'], [orgA, viewer, 'viewer']]) {
    await admin.query("INSERT INTO uap.memberships(organization_id,user_id,role,state,created_at) VALUES ($1,$2,$3,'active',$4)", [organizationId, actor, role, now]);
  }
  await admin.query('INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES ($1,$2,$3,$4),($5,$6,$7,$4)', [workspaceA, orgA, 'A', now, workspaceB, orgB, 'B']);
});
after(async () => { await parallel.end(); await application.end(); await admin.end(); });

test('concurrent appends allocate unique contiguous sequences and revisions', async () => {
  const agentId = await agent('append_concurrency');
  const first = await repository.createConversation(scopeA, agentId);
  assert.equal(first.generation, 1);
  assert.equal(first.nextSeq, 1);
  assert.equal(first.revision, 0);
  const rows = await Promise.all(Array.from({ length: 16 }, (_, index) => concurrent.appendRow(scopeA, {
    agentId, generation: 1, kind: 'message', body: { role: 'user', text: `Message ${index}` },
  })));
  assert.deepEqual(rows.map(row => row.seq).sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(rows.map(row => row.updatedRevision).sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index + 1));
  const stored = await repository.getCurrentConversation(scopeA, agentId);
  assert.equal(stored.nextSeq, 17);
  assert.equal(stored.revision, 16);
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1 })).map(row => row.seq), Array.from({ length: 16 }, (_, index) => index + 1));
});

test('concurrent new generations serialize under the agent lock and retain prior history', async () => {
  const agentId = await agent('generation_concurrency');
  const first = await repository.createConversation(scopeA, agentId);
  const original = await repository.appendRow(scopeA, { agentId, generation: first.generation, kind: 'event', body: { text: 'First generation' } });
  const created = await Promise.all(Array.from({ length: 6 }, () => concurrent.createConversation(scopeA, agentId)));
  assert.deepEqual(created.map(row => row.generation).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);
  assert.equal((await repository.getCurrentConversation(scopeA, agentId)).generation, 7);
  assert.deepEqual(await repository.listRows(scopeA, { agentId, generation: 1 }), [original]);
  assert.deepEqual(await repository.listRows(scopeA, { agentId, generation: 7 }), []);
  const newest = await repository.appendRow(scopeA, { agentId, generation: 7, kind: 'activity', body: { text: 'New generation' } });
  assert.equal(newest.seq, 1);
  assert.equal(newest.updatedRevision, 1);
  assert.equal((await repository.getConversation(scopeA, agentId, 1)).revision, 1);
  assert.equal(await repository.createConversation(scopeA, id('absent_agent')), null);
});

test('idempotency returns the original row without consuming sequence and rejects changed requests', async () => {
  const agentId = await agent('idempotency');
  await repository.createConversation(scopeA, agentId);
  const request = { agentId, generation: 1, kind: 'message', body: { text: 'Original', nested: { a: 1, b: true } }, idempotencyKey: 'request-1' };
  const attempts = await Promise.all(Array.from({ length: 8 }, () => concurrent.appendRow(scopeA, request)));
  assert.equal(attempts.every(row => row.seq === 1 && row.updatedRevision === 1), true);
  const equivalent = await repository.appendRow(scopeA, { ...request, body: { nested: { b: true, a: 1 }, text: 'Original' } });
  assert.equal(equivalent.seq, 1);
  await assert.rejects(repository.appendRow(scopeA, { ...request, body: { text: 'Changed' } }), error => error instanceof RepositoryConstraintError && error.code === 'conflict');
  await assert.rejects(repository.appendRow(scopeA, { ...request, kind: 'event' }), RepositoryConstraintError);
  const updated = await repository.updateRow(scopeA, { agentId, generation: 1, seq: 1, body: { text: 'Edited later' } });
  const originalRetry = await repository.appendRow(scopeA, request);
  assert.deepEqual(originalRetry, updated, 'repeating the original request must not undo a later row update');
  await assert.rejects(repository.appendRow(scopeA, { ...request, body: updated.body }), RepositoryConstraintError);
  const state = await repository.getCurrentConversation(scopeA, agentId);
  assert.equal(state.nextSeq, 2);
  assert.equal(state.revision, 2);
});

test('sequence and revision cursors expose old-message updates without crossing generations', async () => {
  const agentId = await agent('cursor');
  await repository.createConversation(scopeA, agentId);
  for (let index = 0; index < 5; index++) await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'message', body: { text: `Message ${index}` } });
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1, limit: 2 })).map(row => row.seq), [4, 5]);
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1, beforeSeq: 4, limit: 2 })).map(row => row.seq), [2, 3]);
  const changed = await repository.updateRow(scopeA, { agentId, generation: 1, seq: 1, body: { text: 'Changed first row' } });
  assert.equal(changed.updatedRevision, 6);
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1, afterRevision: 5 })).map(row => row.seq), [1]);
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1, afterRevision: 6 })), []);
  assert.equal(await repository.updateRow(scopeA, { agentId, generation: 1, seq: 999, body: {} }), null);
  assert.equal((await repository.getCurrentConversation(scopeA, agentId)).revision, 6);
  await assert.rejects(repository.listRows(scopeA, { agentId, generation: 1, beforeSeq: 4, afterRevision: 5 }), RepositoryValidationError);
  await assert.rejects(repository.listRows(scopeA, { agentId, generation: 1, limit: 501 }), RepositoryValidationError);
  await assert.rejects(repository.listRows(scopeA, { agentId, generation: 1, afterRevision: Number.MAX_SAFE_INTEGER + 1 }), RepositoryValidationError);
});

test('legacy tool-call and notice row kinds retain their original body and identity', async () => {
  const agentId = await agent('legacy_kinds');
  await repository.createConversation(scopeA, agentId);
  const call = await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'tool-call', body: { type: 'tool-call', tool: 'read_file', status: 'done' } });
  const notice = await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'notice', body: { type: 'notice', text: 'Historical notice' } });
  assert.deepEqual((await repository.listRows(scopeA, { agentId, generation: 1 })).map(row => [row.kind, row.body]), [
    ['tool-call', call.body], ['notice', notice.body],
  ]);
});

test('viewers cannot mutate conversations, transcript rows or model history', async () => {
  const agentId = await agent('viewer');
  await repository.createConversation(scopeA, agentId);
  const row = await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'card', body: { type: 'approval' } });
  assert.equal((await repository.getCurrentConversation(viewerScope, agentId)).generation, 1);
  assert.deepEqual(await repository.listRows(viewerScope, { agentId, generation: 1 }), [row]);
  for (const operation of [
    () => repository.createConversation(viewerScope, agentId),
    () => repository.appendRow(viewerScope, { agentId, generation: 1, kind: 'message', body: {} }),
    () => repository.updateRow(viewerScope, { agentId, generation: 1, seq: 1, body: {} }),
    () => repository.appendHistory(viewerScope, { agentId, generation: 1, items: [{ role: 'user', content: 'Forbidden' }] }),
  ]) await assert.rejects(operation(), TenantAccessError);
  await assert.rejects(withTenant(application, viewerScope, client => client.query(
    'INSERT INTO uap.message_rows(organization_id,agent_id,generation,seq,updated_revision,kind,body,created_at) VALUES ($1,$2,1,2,2,$3,$4::jsonb,$5)',
    [orgA, agentId, 'message', '{}', now],
  )), TenantAccessError);
  assert.deepEqual(await repository.listRows(scopeA, { agentId, generation: 1 }), [row]);
});

test('identical agent and conversation keys remain tenant-scoped in reads and writes', async () => {
  const agentId = await agent('shared');
  await agent('shared', orgB, workspaceB, actorB);
  await repository.createConversation(scopeA, agentId);
  await repository.createConversation(scopeB, agentId);
  const a = await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'message', body: { tenant: 'A' }, idempotencyKey: 'same-key' });
  const b = await repository.appendRow(scopeB, { agentId, generation: 1, kind: 'message', body: { tenant: 'B' }, idempotencyKey: 'same-key' });
  assert.deepEqual(await repository.listRows(scopeA, { agentId, generation: 1 }), [a]);
  assert.deepEqual(await repository.listRows(scopeB, { agentId, generation: 1 }), [b]);
  await repository.updateRow(scopeA, { agentId, generation: 1, seq: 1, body: { tenant: 'A updated' } });
  assert.deepEqual(await repository.listRows(scopeB, { agentId, generation: 1 }), [b]);
  assert.equal((await application.query('SELECT * FROM uap.message_rows')).rowCount, 0);
  const onlyB = await agent('b_only', orgB, workspaceB, actorB);
  await repository.createConversation(scopeB, onlyB);
  assert.equal(await repository.getCurrentConversation(scopeA, onlyB), null);
  assert.equal(await repository.appendRow(scopeA, { agentId: onlyB, generation: 1, kind: 'event', body: {} }), null);
  assert.deepEqual(await repository.listHistory(scopeA, { agentId: onlyB, generation: 1 }), []);
});

test('failed PostgreSQL row insertion rolls back sequence and revision allocation', async () => {
  const agentId = await agent('rollback');
  await repository.createConversation(scopeA, agentId);
  const triggerName = id('reject_row');
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  await admin.query(`CREATE FUNCTION uap.${quote(triggerName)}() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN
    IF NEW.body->>'rollbackTest'='reject' THEN RAISE EXCEPTION 'intentional test insert rejection'; END IF; RETURN NEW; END; $function$`);
  try {
    await admin.query(`REVOKE ALL ON FUNCTION uap.${quote(triggerName)}() FROM PUBLIC`);
    await admin.query(`CREATE TRIGGER ${quote(triggerName)} BEFORE INSERT ON uap.message_rows FOR EACH ROW EXECUTE FUNCTION uap.${quote(triggerName)}()`);
    const before = await repository.getCurrentConversation(scopeA, agentId);
    await assert.rejects(repository.appendRow(scopeA, { agentId, generation: 1, kind: 'event', body: { rollbackTest: 'reject' } }), /intentional test insert rejection/);
    assert.deepEqual(await repository.getCurrentConversation(scopeA, agentId), before);
    assert.deepEqual(await repository.listRows(scopeA, { agentId, generation: 1 }), []);
    const retry = await repository.appendRow(scopeA, { agentId, generation: 1, kind: 'event', body: { rollbackTest: 'accept' } });
    assert.equal(retry.seq, 1);
    assert.equal(retry.updatedRevision, 1);
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${quote(triggerName)} ON uap.message_rows`);
    await admin.query(`DROP FUNCTION IF EXISTS uap.${quote(triggerName)}()`);
  }
});

test('concurrent history batches remain ordered, atomic and generation-scoped', async () => {
  const agentId = await agent('history');
  await repository.createConversation(scopeA, agentId);
  const batches = await Promise.all(Array.from({ length: 6 }, (_, index) => concurrent.appendHistory(scopeA, {
    agentId, generation: 1, items: [{ role: 'user', content: `Question ${index}` }, { role: 'assistant', content: `Answer ${index}` }],
  })));
  assert.deepEqual(batches.flat().map(row => row.idx).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
  for (const batch of batches) assert.equal(batch[1].idx, batch[0].idx + 1);
  assert.deepEqual((await repository.listHistory(scopeA, { agentId, generation: 1, afterIndex: 8, limit: 2 })).map(row => row.idx), [9, 10]);
  assert.equal((await repository.getCurrentConversation(scopeA, agentId)).revision, 0, 'context append must not invent transcript row changes');
  await repository.createConversation(scopeA, agentId);
  assert.deepEqual(await repository.listHistory(scopeA, { agentId, generation: 2 }), []);
  assert.equal((await repository.listHistory(scopeA, { agentId, generation: 1 })).length, 12);
  await assert.rejects(repository.appendHistory(scopeA, { agentId, generation: 2, items: [{ content: 'valid' }, { value: undefined }] }), RepositoryValidationError);
  assert.deepEqual(await repository.listHistory(scopeA, { agentId, generation: 2 }), []);
});
