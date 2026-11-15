import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

async function scenario(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-model-authority-'));
  const env = {
    ...process.env, SESSION_SECRET: 'model-authority-test-only', DB_PATH: path.join(dir, 'app.sqlite'),
    HERMES_HOME_PRIMARY: path.join(dir, 'primary'), ENGINES_DIR: path.join(dir, 'managed'),
    HQ_LOCAL: '0', ORGO_COMPUTER_ID: '', HERMES_KEY: '', FIXTURE_ROOT: dir,
  };
  for (const key of ['XAI_API_KEY', 'COMPOSIO_API_KEY', 'ORGO_API_KEY']) {
    delete env[key]; delete env[`${key}_FILE`];
  }
  const preamble = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import { once } from 'node:events';
    import { db } from './server/src/db.ts';
    import { env } from './server/src/env.ts';
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('owner', 'owner@example.test', 'Owner', 1);
    db.prepare('INSERT INTO bots(id,user_id,name,engine,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('bot_primary', 'owner', 'Owner Agent', 'primary', 'historical-stale-model', 'historical-stale-provider', 1, 1);
    const engine = await import('./server/src/engine.ts');
    let metadata = { model: 'gateway-configured-model', provider: 'gateway-configured-provider', providers: [] };
    let metadataStatus = 200;
    let configuredModel = 'gateway-configured-model';
    let responseStatus = 200;
    const requests = [];
    // A local contract fixture, not a real Hermes gateway or provider validation.
    const gateway = createServer(async (req, res) => {
      if (req.url === '/health') {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', version: 'fixture-version' })); return;
      }
      if (req.url === '/api/model/options') {
        res.statusCode = metadataStatus;
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(metadata)); return;
      }
      if (req.url === '/v1/responses' && req.method === 'POST') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        requests.push(JSON.parse(raw));
        res.statusCode = responseStatus;
        if (responseStatus !== 200) { res.end('fixture configured provider unavailable'); return; }
        res.setHeader('content-type', 'text/event-stream');
        res.end('event: response.output_text.delta\\ndata: ' + JSON.stringify({ delta: 'Configured ' + configuredModel }) + '\\n\\n'); return;
      }
      res.statusCode = 404; res.end();
    });
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
    env.hermesUrl = 'http://127.0.0.1:' + gateway.address().port;
    try {
  `;
  const suffix = `
    } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
  `;
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', preamble + script + suffix], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 0, output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('gateway metadata is the only displayed model/provider authority', { timeout: 25000 }, async () => {
  await scenario(`
    const info = await engine.engineInfo('bot_primary');
    assert.equal(info.model, 'gateway-configured-model');
    assert.equal(info.provider, 'gateway-configured-provider');
    assert.equal(info.kind, 'primary');
    assert.equal(info.configurationMode, 'in_hermes');
    assert.equal(info.version, 'fixture-version');
    const { getBot } = await import('./server/src/store.ts');
    assert.equal(getBot('bot_primary').model, null);
    assert.equal(getBot('bot_primary').provider, null);
    assert.deepEqual(db.prepare('SELECT model, provider FROM bots WHERE id=?').get('bot_primary'), { model: 'historical-stale-model', provider: 'historical-stale-provider' });
    metadata = { model: { invalid: true }, provider: 99, providers: [] };
    engine.forgetEngineOptions('bot_primary');
    const malformed = await engine.engineInfo('bot_primary');
    assert.equal(malformed.model, null); assert.equal(malformed.provider, null);
    metadataStatus = 503;
    engine.forgetEngineOptions('bot_primary');
    const missing = await engine.engineInfo('bot_primary');
    assert.equal(missing.model, null); assert.equal(missing.provider, null);
    gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
    const unreachable = await engine.engineInfo('bot_primary');
    assert.equal(unreachable.status, 'error');
    assert.equal(unreachable.model, null); assert.equal(unreachable.provider, null);
  `);
});

test('model PATCH gives change-in-Hermes guidance without mutating historical state', { timeout: 25000 }, async () => {
  await scenario(`
    const { configApi } = await import('./server/src/routes-config.ts');
    db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)').run('owner-session', 'owner', 1, Date.now() + 100000);
    const request = (cookie) => configApi.request('http://localhost/bots/bot_primary/engine', {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ model: 'unverified-request-model', provider: 'unverified-request-provider' }),
    });
    assert.equal((await request()).status, 401);
    const before = db.prepare('SELECT model, provider, updated_at FROM bots WHERE id=?').get('bot_primary');
    const res = await request('grokbot_session=owner-session');
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'configuration_in_hermes');
    assert.equal(body.configurationMode, 'in_hermes');
    assert.match(body.error, /in Hermes/);
    assert.deepEqual(db.prepare('SELECT model, provider, updated_at FROM bots WHERE id=?').get('bot_primary'), before);
    for (const operation of ['memories/consolidate', 'compact']) {
      const res = await configApi.request('http://localhost/bots/bot_primary/' + operation, { method: 'POST', headers: { cookie: 'grokbot_session=owner-session' } });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.code, 'managed_in_hermes');
      assert.match(body.error, /managed in Hermes/);
      assert.equal(Object.hasOwn(body, 'added'), false);
      assert.equal(Object.hasOwn(body, 'compacted'), false);
    }
  `);
});

test('turns use the gateway default alias, ignore SQLite overrides, and never fall back', { timeout: 25000 }, async () => {
  await scenario(`
    const { initRooms } = await import('./server/src/agent/rooms.ts'); initRooms();
    const { initSubagents } = await import('./server/src/agent/subagents.ts'); initSubagents();
    const { enqueue, runInBotQueue } = await import('./server/src/agent/loop.ts');
    enqueue('bot_primary', { type: 'user', text: 'first fixture request' });
    await runInBotQueue('bot_primary', async () => {});
    configuredModel = 'changed-in-gateway-model';
    enqueue('bot_primary', { type: 'user', text: 'second fixture request' });
    await runInBotQueue('bot_primary', async () => {});
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.model, 'hermes-agent');
      assert.equal(Object.hasOwn(request, 'provider'), false);
      assert.equal(JSON.stringify(request).includes('historical-stale-model'), false);
      assert.equal(JSON.stringify(request).includes('historical-stale-provider'), false);
    }
    const rows = db.prepare('SELECT body FROM rows WHERE bot_id=? AND kind=? ORDER BY seq').all('bot_primary', 'message').map(r => JSON.parse(r.body));
    assert.equal(rows.some(row => row.text === 'Configured gateway-configured-model'), true);
    assert.equal(rows.some(row => row.text === 'Configured changed-in-gateway-model'), true);
    responseStatus = 503;
    enqueue('bot_primary', { type: 'user', text: 'third fixture request fails' });
    await runInBotQueue('bot_primary', async () => {});
    assert.equal(requests.length, 3, 'one request only; no provider/model fallback');
    const notices = db.prepare('SELECT body FROM rows WHERE bot_id=? AND kind=?').all('bot_primary', 'notice').map(r => JSON.parse(r.body));
    assert.equal(notices.some(row => row.tone === 'error'), true);
    assert.deepEqual(db.prepare('SELECT model, provider FROM bots WHERE id=?').get('bot_primary'), { model: 'historical-stale-model', provider: 'historical-stale-provider' });
  `);
});
