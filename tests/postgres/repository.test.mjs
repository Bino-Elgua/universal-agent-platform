// Requires the dedicated disposable PostgreSQL harness. Every assertion uses real PostgreSQL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { withTenant, TenantAccessError, UnsafeDatabaseRoleError } from '../../server/src/storage/postgres/connection.ts';
import { TenantRepository, RepositoryConstraintError, RepositoryValidationError } from '../../server/src/storage/postgres/repository.ts';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) {
  throw new Error('Run this suite through npm run test:postgres with a disposable PostgreSQL database.');
}
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
const repository = new TenantRepository(application);
const prefix = `repository_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
const id = suffix => `${prefix}_${suffix}`;
const actorA = id('owner_a');
const actorB = id('owner_b');
const viewer = id('viewer');
const suspended = id('suspended');
const member = id('member');
const orgAdmin = id('org_admin');
const orgA = id('org_a');
const orgB = id('org_b');
const workspaceA = id('workspace_a');
const workspaceB = id('workspace_b');
const agentA = id('agent_a');
const agentB = id('agent_b');
const scopeA = { actorId: actorA, organizationId: orgA };
const scopeB = { actorId: actorB, organizationId: orgB };
const viewerScope = { actorId: viewer, organizationId: orgA };
const now = Date.now();

before(async () => {
  await migratePostgres(admin);
  const applicationRole = decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username);
  await grantApplicationRole(admin, applicationRole);
  for (const userId of [actorA, actorB, viewer, suspended, member, orgAdmin]) {
    await admin.query('INSERT INTO uap.users(id,email,name,created_at) VALUES ($1,$2,$3,$4)', [userId, `${userId}@example.invalid`, userId, now]);
  }
  await admin.query('INSERT INTO uap.organizations(id,slug,name,created_at) VALUES ($1,$2,$3,$4),($5,$6,$7,$4)',
    [orgA, `${prefix}_a`, 'Organization A', now, orgB, `${prefix}_b`, 'Organization B']);
  for (const [organizationId, userId, role, state] of [
    [orgA, actorA, 'owner', 'active'], [orgB, actorB, 'owner', 'active'],
    [orgA, viewer, 'viewer', 'active'], [orgA, suspended, 'member', 'suspended'],
    [orgA, member, 'member', 'active'], [orgA, orgAdmin, 'admin', 'active'],
  ]) {
    await admin.query('INSERT INTO uap.memberships(organization_id,user_id,role,state,created_at) VALUES ($1,$2,$3,$4,$5)', [organizationId, userId, role, state, now]);
  }
  await admin.query('INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES ($1,$2,$3,$4),($5,$6,$7,$4)',
    [workspaceA, orgA, 'Workspace A', now, workspaceB, orgB, 'Workspace B']);
  await admin.query(`INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,profile,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7),($8,$9,$10,$11,$12,$13::jsonb,$7,$7)`,
    [agentA, orgA, workspaceA, actorA, 'Agent A', JSON.stringify({ tenantMarker: 'A' }), now,
      agentB, orgB, workspaceB, actorB, 'Agent B', JSON.stringify({ tenantMarker: 'B' })]);
});

after(async () => { await application.end(); await admin.end(); });

test('repository metadata CRUD preserves opaque identity and tenant ownership', async () => {
  const createdWorkspace = await repository.createWorkspace(scopeA, { name: '  Research workspace  ' });
  assert.match(createdWorkspace.id, /^ws_/);
  assert.equal(createdWorkspace.organizationId, orgA);
  assert.equal(createdWorkspace.name, 'Research workspace');
  assert.equal(Number.isSafeInteger(createdWorkspace.createdAt), true);
  const created = await repository.createAgent(scopeA, {
    id: id('stable_Ș_agent'), workspaceId: createdWorkspace.id, ownerUserId: actorA,
    name: "Agent '; DROP TABLE uap.users; --", profile: { nested: { language: 'Română' }, requestedScope: orgB },
  });
  assert.equal(created.id, id('stable_Ș_agent'));
  assert.equal(created.organizationId, orgA);
  assert.deepEqual(created.profile, { nested: { language: 'Română' }, requestedScope: orgB });
  assert.equal(created.ownerUserId, actorA);
  assert.equal(created.workspaceId, createdWorkspace.id);
  const updated = await repository.updateAgent(scopeA, created.id, { name: 'Updated', profile: { state: 'saved' } });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt >= created.updatedAt, true);
  assert.deepEqual(updated.profile, { state: 'saved' });
  assert.deepEqual((await repository.listAgents(scopeA, { workspaceId: createdWorkspace.id })).map(row => row.id), [created.id]);
  assert.equal((await repository.listWorkspaces(scopeA)).some(row => row.id === createdWorkspace.id), true);
  assert.equal(await repository.deleteAgent(scopeA, created.id), true);
  assert.equal(await repository.deleteAgent(scopeA, created.id), false);
  assert.equal(await repository.getAgent(scopeA, created.id), null);
  assert.equal((await admin.query('SELECT id FROM uap.users WHERE id=$1', [actorA])).rowCount, 1);
});

test('foreign tenant object IDs cannot disclose, update or delete another organization', async () => {
  assert.equal(await repository.getAgent(scopeA, agentB), null);
  assert.equal(await repository.getAgent(scopeB, agentA), null);
  assert.deepEqual(await repository.listAgents(scopeA, { workspaceId: workspaceB }), []);
  assert.equal((await repository.listWorkspaces(scopeA)).some(row => row.id === workspaceB), false);
  assert.equal(await repository.updateAgent(scopeA, agentB, { name: 'forbidden' }), null);
  assert.equal(await repository.deleteAgent(scopeA, agentB), false);
  assert.equal((await repository.getAgent(scopeB, agentB)).name, 'Agent B');
  await assert.rejects(repository.createAgent(scopeA, {
    id: id('cross_workspace'), name: 'Invalid', workspaceId: workspaceB, ownerUserId: actorA,
  }), error => error instanceof RepositoryConstraintError && error.code === 'invalid_reference');
  await assert.rejects(repository.createAgent(scopeA, {
    id: id('cross_owner'), name: 'Invalid', workspaceId: workspaceA, ownerUserId: actorB,
  }), error => error instanceof RepositoryConstraintError && error.code === 'invalid_reference');
  // Composite foreign keys apply even if the caller bypasses the repository query.
  await assert.rejects(withTenant(application, scopeA, client => client.query(
    'INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
    [id('direct_cross_workspace'), orgA, workspaceB, actorA, 'Invalid', now],
  )), { code: '23503' });
});

test('identical opaque workspace and agent IDs remain independent across organizations', async () => {
  const sharedWorkspaceId = id('shared_workspace');
  const sharedAgentId = id('shared_agent');
  await repository.createWorkspace(scopeA, { id: sharedWorkspaceId, name: 'A shared ID' });
  await repository.createWorkspace(scopeB, { id: sharedWorkspaceId, name: 'B shared ID' });
  await repository.createAgent(scopeA, { id: sharedAgentId, workspaceId: sharedWorkspaceId, ownerUserId: actorA, name: 'A shared agent' });
  await repository.createAgent(scopeB, { id: sharedAgentId, workspaceId: sharedWorkspaceId, ownerUserId: actorB, name: 'B shared agent' });
  assert.equal((await repository.getAgent(scopeA, sharedAgentId)).name, 'A shared agent');
  assert.equal((await repository.getAgent(scopeB, sharedAgentId)).name, 'B shared agent');
  await repository.updateAgent(scopeA, sharedAgentId, { name: 'Only A changed' });
  assert.equal((await repository.getAgent(scopeA, sharedAgentId)).name, 'Only A changed');
  assert.equal((await repository.getAgent(scopeB, sharedAgentId)).name, 'B shared agent');
  assert.equal(await repository.deleteAgent(scopeA, sharedAgentId), true);
  assert.equal(await repository.getAgent(scopeA, sharedAgentId), null);
  assert.equal((await repository.getAgent(scopeB, sharedAgentId)).name, 'B shared agent');
  assert.equal(await repository.deleteAgent(scopeB, sharedAgentId), true);
});

test('row-level policies hide tenant data without request context and filter direct SQL', async () => {
  for (const table of ['users', 'organizations', 'memberships', 'workspaces', 'agents', 'import_receipts']) {
    assert.equal((await application.query(`SELECT * FROM uap.${table}`)).rowCount, 0, `${table} leaked without context`);
  }
  await withTenant(application, scopeA, async client => {
    const visible = await client.query('SELECT id,organization_id FROM uap.agents');
    assert.equal(visible.rows.length >= 1, true);
    assert.equal(visible.rows.every(row => row.organization_id === orgA), true);
    assert.equal(visible.rows.some(row => row.id === agentB), false);
    const users = await client.query('SELECT id FROM uap.users');
    assert.deepEqual(users.rows, [{ id: actorA }]);
    const memberships = await client.query('SELECT user_id FROM uap.memberships');
    assert.deepEqual(memberships.rows, [{ user_id: actorA }]);
  });
  await assert.rejects(withTenant(application, scopeA, client => client.query(
    'INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES ($1,$2,$3,$4)',
    [id('forbidden_org_insert'), orgB, 'Forbidden', now],
  )), TenantAccessError);
  await assert.rejects(withTenant(application, scopeA, client => client.query(
    'UPDATE uap.agents SET organization_id=$1,workspace_id=$2,owner_user_id=$3 WHERE id=$4',
    [orgB, workspaceB, actorB, agentA],
  )), TenantAccessError);
  assert.equal((await repository.getAgent(scopeA, agentA)).organizationId, orgA);
});

test('viewer writes are denied in the repository and by direct PostgreSQL policies', async () => {
  assert.equal((await repository.getAgent(viewerScope, agentA)).id, agentA);
  const operations = [
    () => repository.createWorkspace(viewerScope, { name: 'Forbidden' }),
    () => repository.createAgent(viewerScope, { name: 'Forbidden', workspaceId: workspaceA, ownerUserId: viewer }),
    () => repository.updateAgent(viewerScope, agentA, { name: 'Forbidden' }),
    () => repository.deleteAgent(viewerScope, agentA),
  ];
  for (const operation of operations) await assert.rejects(operation(), TenantAccessError);
  await assert.rejects(withTenant(application, viewerScope, client => client.query(
    'INSERT INTO uap.agents(id,organization_id,workspace_id,owner_user_id,name,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
    [id('direct_viewer_insert'), orgA, workspaceA, viewer, 'Forbidden', now],
  )), TenantAccessError);
  await withTenant(application, viewerScope, async client => {
    assert.equal((await client.query('UPDATE uap.agents SET name=$1 WHERE id=$2 RETURNING id', ['Forbidden', agentA])).rowCount, 0);
    assert.equal((await client.query('DELETE FROM uap.agents WHERE id=$1 RETURNING id', [agentA])).rowCount, 0);
  });
  assert.equal((await repository.getAgent(scopeA, agentA)).name, 'Agent A');
});

test('membership roles enforce implemented workspace and agent write boundaries', async () => {
  const memberScope = { actorId: member, organizationId: orgA };
  await assert.rejects(repository.createWorkspace(memberScope, { name: 'Forbidden member workspace' }), TenantAccessError);
  const created = await repository.createAgent(memberScope, { workspaceId: workspaceA, ownerUserId: member, name: 'Member agent' });
  assert.equal(created.ownerUserId, member);
  assert.equal(await repository.deleteAgent(memberScope, created.id), true);
  const createdWorkspace = await repository.createWorkspace({ actorId: orgAdmin, organizationId: orgA }, { name: 'Administrator workspace' });
  assert.equal(createdWorkspace.organizationId, orgA);
});

test('suspended and foreign identities never enter a tenant callback', async () => {
  for (const scope of [{ actorId: suspended, organizationId: orgA }, { actorId: actorA, organizationId: orgB }, { actorId: id('unknown'), organizationId: orgA }]) {
    let entered = false;
    await assert.rejects(withTenant(application, scope, async () => { entered = true; }), TenantAccessError);
    assert.equal(entered, false);
  }
  await assert.rejects(repository.listAgents({ actorId: suspended, organizationId: orgA }), TenantAccessError);
  // Database policies also enforce suspension on direct SQL with an otherwise scoped connection.
  const client = await application.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('uap.actor_id',$1,true),set_config('uap.organization_id',$2,true)", [suspended, orgA]);
    assert.equal((await client.query('SELECT * FROM uap.agents')).rowCount, 0);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('failed transactions roll back metadata and pooled context never crosses tenants', async () => {
  const rolledBackId = id('rolled_back');
  await assert.rejects(withTenant(application, scopeA, async client => {
    await client.query('INSERT INTO uap.workspaces(id,organization_id,name,created_at) VALUES ($1,$2,$3,$4)', [rolledBackId, orgA, 'Rollback', now]);
    throw new Error('intentional isolated test rollback');
  }), /intentional isolated test rollback/);
  assert.equal((await admin.query('SELECT id FROM uap.workspaces WHERE id=$1', [rolledBackId])).rowCount, 0);
  const ambient = await application.connect();
  try {
    // Deliberately stale session-level settings must not override the next authenticated scope.
    await ambient.query("SELECT set_config('uap.actor_id',$1,false),set_config('uap.organization_id',$2,false)", [actorA, orgA]);
  } finally { ambient.release(); }
  const b = await repository.listAgents(scopeB);
  assert.deepEqual(b.map(row => row.id), [agentB]);
  const raw = await application.query("SELECT current_setting('uap.actor_id',true) AS actor,current_setting('uap.organization_id',true) AS organization");
  assert.equal(raw.rows[0].actor, '');
  assert.equal(raw.rows[0].organization, '');
  assert.equal((await application.query('SELECT * FROM uap.agents')).rowCount, 0);
  assert.equal((await repository.getAgent(scopeA, agentA)).id, agentA);
});

test('tenant requests reject migration-owner and administrative database logins', async () => {
  let entered = false;
  await assert.rejects(withTenant(admin, scopeA, async () => { entered = true; }), UnsafeDatabaseRoleError);
  assert.equal(entered, false);
  const adminRole = (await admin.query('SELECT current_user AS role')).rows[0].role;
  await assert.rejects(grantApplicationRole(admin, adminRole), /must not|must exist/);
});

test('privilege drift after initial application grants blocks the next tenant request', async () => {
  assert.equal((await repository.getAgent(scopeA, agentA)).id, agentA);
  const applicationRole = decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username);
  const quotedRole = `"${applicationRole.replaceAll('"', '""')}"`;
  for (const [elevate, restore] of [
    [`ALTER ROLE ${quotedRole} CREATEROLE`, `ALTER ROLE ${quotedRole} NOCREATEROLE`],
    [`GRANT SELECT ON uap.schema_migrations TO ${quotedRole}`, `REVOKE SELECT ON uap.schema_migrations FROM ${quotedRole}`],
  ]) {
    try {
      await admin.query(elevate);
      let entered = false;
      await assert.rejects(withTenant(application, scopeA, async () => { entered = true; }), UnsafeDatabaseRoleError);
      assert.equal(entered, false, 'a newly privileged application login must not enter the tenant callback');
      const context = await application.query("SELECT current_setting('uap.actor_id',true) AS actor,current_setting('uap.organization_id',true) AS organization");
      assert.equal(context.rows[0].actor, '');
      assert.equal(context.rows[0].organization, '');
    } finally {
      await admin.query(restore);
    }
    assert.equal((await repository.getAgent(scopeA, agentA)).id, agentA);
    assert.equal((await application.query('SELECT * FROM uap.agents')).rowCount, 0);
  }
});

test('input validation cannot mutate organization identity or stringify non-JSON profile data', async () => {
  await assert.rejects(repository.updateAgent(scopeA, agentA, { organizationId: orgB }), RepositoryValidationError);
  await assert.rejects(repository.updateAgent(scopeA, agentA, {}), RepositoryValidationError);
  await assert.rejects(repository.createAgent(scopeA, { name: 'Invalid', workspaceId: workspaceA, ownerUserId: actorA, profile: { secret: undefined } }), RepositoryValidationError);
  await assert.rejects(repository.createAgent(scopeA, { name: 'Invalid', workspaceId: workspaceA, ownerUserId: actorA, profile: { text: '\0' } }), RepositoryValidationError);
  assert.equal((await repository.getAgent(scopeA, agentA)).name, 'Agent A');
});
