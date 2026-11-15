// SDK stubs are confined to this isolated test process; no OAuth/provider account is contacted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
async function fixture(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-oauth-cleanup-'));
  const env = { ...process.env, SESSION_SECRET: 'isolated-oauth-cleanup-test', DB_PATH: path.join(dir, 'app.sqlite'),
    ENGINES_DIR: path.join(dir, 'engines'), HERMES_HOME_PRIMARY: path.join(dir, 'primary'),
    COMPOSIO_API_KEY: 'sdk-fixture-key', DEV_LOGIN: '0', ALLOWED_EMAILS: '', APP_URL: 'http://localhost:5173' };
  for (const name of ['COMPOSIO_API_KEY_FILE', 'XAI_API_KEY', 'XAI_API_KEY_FILE', 'ORGO_API_KEY', 'ORGO_API_KEY_FILE']) delete env[name];
  const preamble = `
    import assert from 'node:assert/strict';
    import { db, now } from './server/src/db.ts';
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('owner', 'owner@example.test', 'Owner', now());
    globalThis.fetch = () => { throw new Error('Unexpected provider network request'); };
    const { api } = await import('./server/src/routes.ts');
    const { Hono } = await import('hono');
    const { ProviderUnavailableError } = await import('./server/src/providers.ts');
    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof ProviderUnavailableError) return c.json({ error: error.message, code: 'provider_unavailable', provider: error.provider }, 503);
      throw error;
    });
    app.route('/api', api);
    const { getComposio } = await import('./server/src/composio.ts');
    const client = getComposio();
    const deleted = [];
    const profiled = [];
    let profileEmail = 'other@example.test';
    client.tools.proxyExecute = async (request) => {
      profiled.push(request.connectedAccountId);
      return { data: { emailAddress: profileEmail } };
    };
    client.connectedAccounts.delete = async id => { deleted.push(id); };
    const attempt = (id, account = 'provisional-connection') => db.prepare('INSERT INTO login_attempts(id,provisional_user_id,connected_account_id,created_at) VALUES (?,?,?,?)').run(id, 'provisional-user', account, now());
    const snapshot = () => ({
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
      bots: db.prepare('SELECT * FROM bots ORDER BY id').all(),
      sessions: db.prepare('SELECT * FROM auth_sessions ORDER BY token').all(),
      binding: db.prepare('SELECT * FROM deployment_binding').all(),
    });
  `;
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', preamble + script], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 0, output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('rejected non-owner Google login removes its provisional connection without creating account data', { timeout: 20000 }, async () => {
  await fixture(`
    attempt('rejected-attempt');
    const before = snapshot();
    const response = await api.request('/auth/google/callback?attempt=rejected-attempt&connected_account_id=provisional-connection');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:5173/?login=failed');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(profiled, ['provisional-connection']);
    assert.deepEqual(deleted, ['provisional-connection']);
    assert.deepEqual(snapshot(), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM login_attempts').get().count, 0);
    db.close();
  `);
});

test('successful existing-owner Google login cleans its throwaway connection and creates a scoped session', { timeout: 20000 }, async () => {
  await fixture(`
    profileEmail = 'owner@example.test';
    attempt('owner-attempt');
    const response = await api.request('/auth/google/callback?attempt=owner-attempt&connected_account_id=provisional-connection');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:5173/');
    assert.match(response.headers.get('set-cookie'), /grokbot_session=/);
    assert.deepEqual(deleted, ['provisional-connection']);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bots').get().count, 0);
    assert.deepEqual(db.prepare('SELECT DISTINCT user_id FROM auth_sessions').all(), [{ user_id: 'owner' }]);
    db.close();
  `);
});

test('Google callbacks cannot substitute an unrelated connection ID', { timeout: 20000 }, async () => {
  await fixture(`
    profileEmail = 'owner@example.test';
    attempt('substituted-id');
    const before = snapshot();
    const response = await api.request('/auth/google/callback?attempt=substituted-id&connected_account_id=unrelated-owner-connection');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:5173/?login=failed');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(profiled, []);
    assert.equal(deleted.includes('unrelated-owner-connection'), false, 'must never delete an arbitrary callback-supplied connection');
    assert.deepEqual(snapshot(), before);
    db.close();
  `);
});


test('Google callbacks require a persisted connection binding and expire after fifteen minutes', { timeout: 20000 }, async () => {
  await fixture(`
    profileEmail = 'owner@example.test';
    attempt('missing-binding', null);
    const before = snapshot();
    const missing = await app.request('/api/auth/google/callback?attempt=missing-binding&connected_account_id=unrelated-owner-connection');
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.get('location'), 'http://localhost:5173/?login=failed');
    assert.deepEqual(profiled, []);
    assert.deepEqual(deleted, []);
    assert.deepEqual(snapshot(), before);
    attempt('expired-attempt', 'expired-provisional-connection');
    db.prepare('UPDATE login_attempts SET created_at=? WHERE id=?').run(now() - 15 * 60000 - 1, 'expired-attempt');
    const expired = await app.request('/api/auth/google/callback?attempt=expired-attempt');
    assert.equal(expired.status, 302);
    assert.equal(expired.headers.get('location'), 'http://localhost:5173/?login=failed');
    assert.deepEqual(profiled, []);
    assert.deepEqual(deleted, ['expired-provisional-connection']);
    assert.deepEqual(snapshot(), before);
    db.close();
  `);
});

test('app callback escapes query values and cannot report unauthenticated connection success', { timeout: 20000 }, async () => {
  await fixture(`
    const payload = '</script><script>globalThis.injected = true</script>';
    const response = await app.request('/api/apps/callback?slug=' + encodeURIComponent(payload));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal(html.includes(payload), false);
    assert.equal(html.split('<script>').length - 1, 1, 'only the authored callback script may appear');
    assert.match(html, /Connection failed/);
    assert.match(html, /ok:false/);
    assert.equal(html.includes("postMessage({type:'uap-connected'"), true);
    assert.equal(html.includes(',"http://localhost:5173")'), true, 'callback targets the configured app origin');
    assert.deepEqual(profiled, []);
    assert.deepEqual(deleted, []);
    db.close();
  `);
});

test('failed remote cleanup retains the bot and its reserved primary binding for retry', { timeout: 20000 }, async () => {
  await fixture(`
    const { deployment } = await import('./server/src/deployment.ts');
    db.prepare("INSERT INTO bots(id,user_id,name,engine,created_at,updated_at) VALUES ('bot_primary','owner','Primary','primary',1,1)").run();
    deployment.assignPrimary('bot_primary', 'owner');
    db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run('owner-session','owner',now(),now()+60000);
    const before = snapshot();
    const response = await app.request('/api/bots/bot_primary', { method: 'DELETE', headers: { cookie: 'grokbot_session=owner-session' } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'provider_unavailable');
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(deleted, []);
    db.close();
  `);
});
