// Real PostgreSQL only. The harness supplies separate app and session-issuer logins.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { withTenant, TenantAccessError, UnsafeDatabaseRoleError } from '../../server/src/storage/postgres/connection.ts';
import { SESSION_MIGRATION } from '../../server/src/storage/postgres/sessions-schema.ts';
import { grantSessionIssuerRole, UnsafeSessionIssuerRoleError } from '../../server/src/storage/postgres/session-grants.ts';
import { SessionAuthenticator, SessionIssuer, SessionValidationError, SessionIssuanceError } from '../../server/src/storage/postgres/sessions.ts';

for (const name of ['TEST_DATABASE_URL', 'TEST_APP_DATABASE_URL', 'TEST_ISSUER_DATABASE_URL']) {
  if (!process.env[name]) throw new Error('Use npm run test:postgres with dedicated disposable database roles.');
}
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
const issuance = new Pool({ connectionString: process.env.TEST_ISSUER_DATABASE_URL, max: 1 });
const issuer = new SessionIssuer(issuance);
const authenticator = new SessionAuthenticator(application);
const appRole = decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username);
const issuerRole = decodeURIComponent(new URL(process.env.TEST_ISSUER_DATABASE_URL).username);
const quote = role => `"${role.replaceAll('"', '""')}"`;
const userA = 'session_user_a';
const userB = 'session_user_b';
const revokeUser = 'session_user_revoke_all';
const orgA = 'session_org_a';
const orgB = 'session_org_b';
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex');

before(async () => {
  await migratePostgres(admin);
  await grantApplicationRole(admin, appRole);
  await grantSessionIssuerRole(admin, issuerRole);
  for (const user of [userA, userB, revokeUser]) {
    await admin.query('INSERT INTO uap.users(id,email,name,created_at) VALUES ($1,$2,$1,$3)', [user, `${user}@example.invalid`, Date.now()]);
  }
  for (const [org, user] of [[orgA, userA], [orgB, userB]]) {
    await admin.query('INSERT INTO uap.organizations(id,slug,name,created_at) VALUES ($1,$1,$1,$2)', [org, Date.now()]);
    await admin.query("INSERT INTO uap.memberships(organization_id,user_id,role,state,created_at) VALUES ($1,$2,'owner','active',$3)", [org, user, Date.now()]);
  }
});
after(async () => { await application.end(); await issuance.end(); await admin.end(); });

test('session storage forces RLS and identity functions expose only a single hash argument', async () => {
  const relation = (await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='uap.auth_sessions'::regclass")).rows[0];
  assert.deepEqual(relation, { relrowsecurity: true, relforcerowsecurity: true });
  const functions = (await admin.query(`SELECT procedure.proname,procedure.prosecdef,procedure.pronargs,procedure.proconfig
    FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='uap' AND procedure.proname IN ('authenticate_session','revoke_session') ORDER BY procedure.proname`)).rows;
  assert.equal(functions.length, 2);
  for (const procedure of functions) {
    assert.equal(procedure.prosecdef, true);
    assert.equal(procedure.pronargs, 1, 'no caller-provided user or organization argument');
    assert.ok(procedure.proconfig.includes('search_path=pg_catalog, uap'));
    assert.ok(procedure.proconfig.includes('row_security=on'));
  }
});

test('issuer returns distinct opaque credentials once and stores only their digests', async () => {
  const first = await issuer.issue(userA, { ttlMs: 60000 });
  const second = await issuer.issue(userA, { ttlMs: 60000 });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first.token, 'base64url').length, 32);
  assert.notEqual(first.token, second.token);
  assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'expiresAt', 'token', 'userId']);
  assert.equal(first.expiresAt - first.createdAt, 60000);
  const stored = (await issuance.query('SELECT * FROM uap.auth_sessions WHERE token_hash=$1', [digest(first.token)])).rows[0];
  assert.equal(stored.token_hash, digest(first.token));
  assert.equal(stored.user_id, userA);
  assert.equal(Object.values(stored).includes(first.token), false);
  assert.deepEqual(Object.keys(stored).sort(), ['created_at', 'expires_at', 'revoked_at', 'token_hash', 'user_id']);
  assert.deepEqual(await authenticator.authenticate(first.token), { userId: userA, expiresAt: first.expiresAt });
  assert.equal(await authenticator.authenticate(crypto.randomBytes(32).toString('base64url')), null);
});

test('expiry, token-only logout and issuer revoke-all are enforced independently', async () => {
  const short = await issuer.issue(userA, { ttlMs: 1000 });
  assert.equal((await authenticator.authenticate(short.token)).userId, userA);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(await authenticator.authenticate(short.token), null);
  const first = await issuer.issue(revokeUser);
  const second = await issuer.issue(revokeUser);
  const other = await issuer.issue(userB);
  assert.equal(await authenticator.revoke(first.token), true);
  assert.equal(await authenticator.revoke(first.token), false);
  assert.equal(await authenticator.authenticate(first.token), null);
  assert.equal((await authenticator.authenticate(second.token)).userId, revokeUser);
  assert.equal(await issuer.revokeAll(revokeUser), 1);
  assert.equal(await issuer.revokeAll(revokeUser), 0);
  assert.equal(await authenticator.authenticate(second.token), null);
  assert.equal((await authenticator.authenticate(other.token)).userId, userB);
});

test('invalid requests do not issue sessions or leak database reference errors', async () => {
  const before = Number((await issuance.query('SELECT count(*) AS count FROM uap.auth_sessions')).rows[0].count);
  for (const ttlMs of [0, 999, 30 * 86400000 + 1, 1000.5, NaN, Infinity, '1000', null]) {
    await assert.rejects(issuer.issue(userA, { ttlMs }), SessionValidationError);
  }
  for (const options of [null, 'invalid', []]) await assert.rejects(issuer.issue(userA, options), SessionValidationError);
  for (const user of ['', '\0', 'x'.repeat(201), null]) await assert.rejects(issuer.issue(user), SessionValidationError);
  await assert.rejects(issuer.issue('nonexistent_session_user'), SessionIssuanceError);
  for (const token of ['', 'x'.repeat(10000), 'not a session', null, undefined, {}, 'A'.repeat(42) + 'B']) {
    assert.equal(await authenticator.authenticate(token), null);
    assert.equal(await authenticator.revoke(token), false);
  }
  const after = Number((await issuance.query('SELECT count(*) AS count FROM uap.auth_sessions')).rows[0].count);
  assert.equal(after, before);
});

test('a session establishes no organization authority and pooled identity context is cleared', async () => {
  const session = await issuer.issue(userA);
  await application.query("SELECT set_config('uap.actor_id',$1,false),set_config('uap.organization_id',$2,false)", [userB, orgB]);
  const identity = await authenticator.authenticate(session.token);
  assert.deepEqual(identity, { userId: userA, expiresAt: session.expiresAt });
  const context = (await application.query("SELECT current_setting('uap.actor_id',true) AS actor,current_setting('uap.organization_id',true) AS organization")).rows[0];
  assert.deepEqual(context, { actor: '', organization: '' });
  assert.equal((await application.query('SELECT * FROM uap.organizations')).rowCount, 0);
  await assert.rejects(withTenant(application, { actorId: identity.userId, organizationId: orgB }, client => client.query('SELECT * FROM uap.agents')), TenantAccessError);
  assert.equal((await withTenant(application, { actorId: identity.userId, organizationId: orgA }, client => client.query('SELECT * FROM uap.organizations'))).rowCount, 1);
});

test('application cannot inspect, forge, delete or bulk-revoke sessions; issuer cannot access metadata', async () => {
  for (const query of [
    'SELECT * FROM uap.auth_sessions', 'UPDATE uap.auth_sessions SET revoked_at=created_at',
    "INSERT INTO uap.auth_sessions(token_hash,user_id,created_at,expires_at) VALUES (repeat('a',64),'session_user_a',1,2)",
    'DELETE FROM uap.auth_sessions', 'TRUNCATE uap.auth_sessions',
  ]) await assert.rejects(application.query(query), { code: '42501' });
  await assert.rejects(new SessionIssuer(application).issue(userA), UnsafeSessionIssuerRoleError);
  await assert.rejects(grantSessionIssuerRole(admin, appRole), UnsafeSessionIssuerRoleError);
  await assert.rejects(grantApplicationRole(admin, issuerRole), /session issuance rights/);
  assert.equal((await issuer.issue(userA)).userId, userA, 'a rejected role conversion must preserve issuer permissions');
  await assert.rejects(grantSessionIssuerRole(admin, 'nonexistent_issuer_role'), UnsafeSessionIssuerRoleError);
  for (const query of [
    'SELECT * FROM uap.users', 'SELECT * FROM uap.memberships', 'SELECT * FROM uap.agents',
    'DELETE FROM uap.auth_sessions', 'TRUNCATE uap.auth_sessions',
    'CREATE TABLE uap.forbidden_session_issuer(id text)',
    "SELECT * FROM uap.authenticate_session(repeat('a',64))", "SELECT uap.revoke_session(repeat('a',64))",
  ]) await assert.rejects(issuance.query(query), { code: '42501' });
});

test('role privilege drift is rejected before lookup, logout or issuance', async () => {
  const session = await issuer.issue(userA);
  await admin.query(`GRANT SELECT ON uap.auth_sessions TO ${quote(appRole)}`);
  try {
    await assert.rejects(authenticator.authenticate(session.token), UnsafeDatabaseRoleError);
    await assert.rejects(authenticator.revoke(session.token), UnsafeDatabaseRoleError);
    await assert.rejects(authenticator.authenticate('invalid'), UnsafeDatabaseRoleError);
  } finally { await admin.query(`REVOKE SELECT ON uap.auth_sessions FROM ${quote(appRole)}`); }
  assert.equal((await authenticator.authenticate(session.token)).userId, userA);
  await admin.query(`GRANT SELECT ON uap.users TO ${quote(issuerRole)}`);
  try {
    await assert.rejects(issuer.issue(userA), UnsafeSessionIssuerRoleError);
    await assert.rejects(issuer.revokeAll(userA), UnsafeSessionIssuerRoleError);
  } finally { await admin.query(`REVOKE SELECT ON uap.users FROM ${quote(issuerRole)}`); }
  await admin.query(`GRANT pg_read_all_data TO ${quote(issuerRole)}`);
  try {
    await assert.rejects(issuer.issue(userA), UnsafeSessionIssuerRoleError);
  } finally { await admin.query(`REVOKE pg_read_all_data FROM ${quote(issuerRole)}`); }
  await assert.rejects(new SessionAuthenticator(issuance).authenticate(session.token), UnsafeDatabaseRoleError);
  await assert.rejects(new SessionAuthenticator(admin).authenticate(session.token), UnsafeDatabaseRoleError);
});

test('FORCE RLS security-definer functions work with a non-superuser migration owner', async () => {
  const schema = `session_owner_${crypto.randomBytes(6).toString('hex')}`;
  // Apply the exact migration SQL in a disposable alternate schema owned by an
  // ordinary login. This exercises the owner policy without granting BYPASSRLS.
  await admin.query(`CREATE SCHEMA "${schema}" AUTHORIZATION ${quote(issuerRole)}`);
  try {
    await issuance.query(`CREATE TABLE "${schema}".users(id text PRIMARY KEY)`);
    await issuance.query(SESSION_MIGRATION.sql.replaceAll('uap.', `${schema}.`).replaceAll('pg_catalog, uap', `pg_catalog, ${schema}`));
    const attributes = (await issuance.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(attributes, { rolsuper: false, rolbypassrls: false });
    await issuance.query(`INSERT INTO "${schema}".users VALUES ('owner_fixture_user')`);
    const tokenHash = digest(crypto.randomBytes(32).toString('base64url'));
    await issuance.query(`INSERT INTO "${schema}".auth_sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,'owner_fixture_user',$2,$3)`, [tokenHash, Date.now(), Date.now() + 60000]);
    assert.equal((await issuance.query(`SELECT * FROM "${schema}".authenticate_session($1)`, [tokenHash])).rows[0].user_id, 'owner_fixture_user');
    assert.equal((await issuance.query(`SELECT "${schema}".revoke_session($1) AS revoked`, [tokenHash])).rows[0].revoked, true);
    assert.equal((await issuance.query(`SELECT "${schema}".revoke_session($1) AS revoked`, [tokenHash])).rows[0].revoked, false);
    assert.equal((await issuance.query(`SELECT * FROM "${schema}".authenticate_session($1)`, [tokenHash])).rowCount, 0);
  } finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
});
