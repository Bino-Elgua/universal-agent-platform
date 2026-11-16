import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, after, test } from 'node:test';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { createStorageReadApi } from '../../server/src/storage/postgres/read-api.ts';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { grantSessionIssuerRole } from '../../server/src/storage/postgres/session-grants.ts';
import { SessionIssuer } from '../../server/src/storage/postgres/sessions.ts';
import { ConversationRepository } from '../../server/src/storage/postgres/conversations.ts';

if (process.env.UAP_POSTGRES_TEST_DATABASE !== '1') throw new Error('Use the disposable PostgreSQL test harness.');
const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const appPool = new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
const issuerPool = new pg.Pool({ connectionString: process.env.TEST_ISSUER_DATABASE_URL, max: 1 });
let server, base, ownerToken, viewerToken;
const scope = { actorId: 'owner-a', organizationId: 'org-a' };
const auth = token => ({ authorization: `Bearer ${token}` });

before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));
  await grantSessionIssuerRole(admin, decodeURIComponent(new URL(process.env.TEST_ISSUER_DATABASE_URL).username));
  await admin.query("INSERT INTO uap.users(id,email,name,created_at) VALUES ('owner-a','a@example.test','A',1),('owner-b','b@example.test','B',1),('viewer-a','v@example.test','V',1)");
  await admin.query("INSERT INTO uap.organizations(id,slug,name,created_at) VALUES ('org-a','a','A',1),('org-b','b','B',1)");
  await admin.query("INSERT INTO uap.memberships VALUES ('org-a','owner-a','owner','active',1),('org-b','owner-b','owner','active',1),('org-a','viewer-a','viewer','active',1)");
  await admin.query("INSERT INTO uap.workspaces VALUES ('workspace','org-a','A workspace',1),('workspace','org-b','B workspace',1)");
  await admin.query("INSERT INTO uap.agents VALUES ('agent','org-a','workspace','owner-a','A agent','{}',1,1),('agent','org-b','workspace','owner-b','B agent','{}',1,1)");
  const repository = new ConversationRepository(appPool);
  await repository.createConversation(scope, 'agent');
  await repository.appendRow(scope, { agentId: 'agent', generation: 1, kind: 'message', body: { type: 'message', text: 'Tenant A actual persisted row' } });
  await repository.createConversation({ actorId: 'owner-b', organizationId: 'org-b' }, 'agent');
  await repository.appendRow({ actorId: 'owner-b', organizationId: 'org-b' }, { agentId: 'agent', generation: 1, kind: 'message', body: { type: 'message', text: 'Tenant B private row' } });
  const issuer = new SessionIssuer(issuerPool);
  ownerToken = (await issuer.issue('owner-a')).token;
  viewerToken = (await issuer.issue('viewer-a')).token;
  server = serve({ fetch: createStorageReadApi(appPool).fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await appPool.end(); await issuerPool.end(); await admin.end();
});

test('actual HTTP requests authenticate with a hashed PG session and return scoped persisted rows', async () => {
  assert.equal((await fetch(`${base}/v1/session`)).status, 401);
  assert.equal((await fetch(`${base}/v1/session?token=${ownerToken}`)).status, 401, 'tokens in URLs are not accepted');
  const response = await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/1/rows`, { headers: auth(ownerToken) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.rows[0].body.text, 'Tenant A actual persisted row');
  assert.equal(JSON.stringify(data).includes('Tenant B private row'), false);
  assert.equal(JSON.stringify(data).includes(ownerToken), false);
  const identity = await (await fetch(`${base}/v1/session`, { headers: auth(ownerToken) })).json();
  assert.equal(identity.identity.userId, 'owner-a');
  const expired = await new SessionIssuer(issuerPool).issue('owner-a', { ttlMs: 1000 });
  const now = Date.now();
  await admin.query('UPDATE uap.auth_sessions SET created_at=$2,expires_at=$3 WHERE token_hash=$1', [createHash('sha256').update(expired.token).digest('hex'), now - 2000, now - 1000]);
  assert.equal((await fetch(`${base}/v1/session`, { headers: auth(expired.token) })).status, 401, 'expired sessions cannot pass HTTP authentication');
  assert.equal((await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/current`, { headers: auth(ownerToken) })).status, 200);
});

test('URL-selected organization and matching object IDs never replace authenticated membership', async () => {
  assert.equal((await fetch(`${base}/v1/organizations/org-b/agents`, { headers: auth(ownerToken) })).status, 403);
  assert.equal((await fetch(`${base}/v1/organizations/org-a/agents/missing/conversations/1/rows`, { headers: auth(ownerToken) })).status, 404);
  const response = await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/1/rows`, { headers: auth(viewerToken) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rows.length, 1);
  assert.equal((await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/1/rows`, { method: 'POST', headers: auth(viewerToken) })).status, 404, 'no transcript-write HTTP endpoint is exposed');
  const invalid = await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/1/rows?limit=5000`, { headers: auth(viewerToken) });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${base}/v1/organizations/org-a/agents/agent/conversations/1/rows?limit=5`, { headers: auth(viewerToken) })).status, 400, 'HTTP history pages are capped independently of internal batch reads');
});

test('membership suspension and token revocation apply on the next HTTP request', async () => {
  await admin.query("UPDATE uap.memberships SET state='suspended' WHERE organization_id='org-a' AND user_id='viewer-a'");
  assert.equal((await fetch(`${base}/v1/organizations/org-a/agents`, { headers: auth(viewerToken) })).status, 403);
  assert.equal((await fetch(`${base}/v1/session`, { headers: auth(viewerToken) })).status, 200, 'identity is separate from org permission');
  assert.equal((await fetch(`${base}/v1/session/revoke`, { method: 'POST', headers: auth(ownerToken) })).status, 204);
  assert.equal((await fetch(`${base}/v1/session/revoke`, { method: 'POST', headers: auth(ownerToken) })).status, 204);
  assert.equal((await fetch(`${base}/v1/session`, { headers: auth(ownerToken) })).status, 401);
  assert.equal((await appPool.query("SELECT current_setting('uap.actor_id',true) AS actor,current_setting('uap.organization_id',true) AS org")).rows[0].actor, '');
});
