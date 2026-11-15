import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

async function fixture(script, inherit = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-engine-safety-'));
  const env = {
    ...process.env,
    SESSION_SECRET: 'isolated-engine-safety-test',
    DB_PATH: path.join(dir, 'app.sqlite'),
    HERMES_HOME_PRIMARY: path.join(dir, 'primary'),
    ENGINES_DIR: path.join(dir, 'managed'),
    HQ_LOCAL: '0',
    HERMES_INHERIT_PRIMARY_CREDENTIALS: inherit ? '1' : '0',
    FIXTURE_ROOT: dir,
  };
  for (const name of ['XAI_API_KEY', 'COMPOSIO_API_KEY', 'ORGO_API_KEY']) {
    delete env[name]; delete env[`${name}_FILE`];
  }
  const preamble = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { db } from './server/src/db.ts';
    import { env } from './server/src/env.ts';
    const dir = process.env.FIXTURE_ROOT;
    fs.mkdirSync(env.hermesHome, { recursive: true });
    const primaryConfig = path.join(env.hermesHome, 'config.yaml');
    fs.writeFileSync(primaryConfig, 'model: original-owner-model\\n');
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('owner', 'owner@example.test', 'Owner', 1);
    const engine = await import('./server/src/engine.ts');
    const { deployment } = await import('./server/src/deployment.ts');
    const bot = (id, user = 'owner', kind = null) => db.prepare('INSERT INTO bots(id,user_id,name,engine,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, user, id, kind, 1, 1);
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

test('deleting the primary bot leaves its external Hermes binding reserved', { timeout: 20000 }, async () => {
  await fixture(`
    bot('bot_primary');
    assert.equal(engine.assignEngine('bot_primary'), 'primary');
    assert.equal(engine.primaryBotId(), 'bot_primary');
    const before = fs.readFileSync(primaryConfig, 'utf8');
    const info = await engine.engineFor('bot_primary');
    assert.equal(info.home, env.hermesHome);
    await engine.restartEngine('bot_primary');
    engine.syncPersona('bot_primary');
    // Even a shadow managed directory must not make primary deletion remove files.
    fs.mkdirSync(path.join(env.enginesDir, 'bot_primary'), { recursive: true });
    const shadow = path.join(env.enginesDir, 'bot_primary', 'keep.txt');
    fs.writeFileSync(shadow, 'retain');
    await engine.removeEngine('bot_primary');
    assert.equal(fs.readFileSync(shadow, 'utf8'), 'retain');
    assert.equal(fs.readFileSync(primaryConfig, 'utf8'), before);
    db.prepare('DELETE FROM bots WHERE id=?').run('bot_primary');
    bot('bot_new');
    assert.equal(engine.assignEngine('bot_new'), 'managed');
    assert.equal(engine.primaryBotId(), null);
    assert.equal(deployment.assignPrimary('bot_new', 'owner'), false);
  `);
});

test('managed and primary roots cannot contain or alias one another', { timeout: 20000 }, async () => {
  await fixture(`
    const originalRoot = env.enginesDir;
    for (const unsafe of [env.hermesHome, path.join(env.hermesHome, 'nested'), path.dirname(env.hermesHome), path.parse(env.hermesHome).root]) {
      env.enginesDir = unsafe;
      assert.throws(() => engine.initEngines(), /non-overlapping/);
    }
    env.enginesDir = originalRoot;
    const alias = path.join(dir, 'alias');
    fs.symlinkSync(env.hermesHome, alias, 'dir');
    env.enginesDir = path.join(alias, 'not-created');
    assert.throws(() => engine.initEngines(), /non-overlapping/);
    assert.equal(fs.existsSync(path.join(env.hermesHome, 'not-created')), false);
    env.enginesDir = originalRoot;
  `);
});

test('managed homes and files cannot follow symlinks into primary Hermes', { timeout: 20000 }, async () => {
  await fixture(`
    bot('bot_primary'); engine.assignEngine('bot_primary');
    bot('bot_managed'); engine.assignEngine('bot_managed');
    fs.mkdirSync(env.enginesDir, { recursive: true });
    const managedHome = path.join(env.enginesDir, 'bot_managed');
    fs.symlinkSync(env.hermesHome, managedHome, 'dir');
    assert.throws(() => engine.engineHome('bot_managed'), /escapes or aliases/);
    await assert.rejects(engine.removeEngine('bot_managed'), /escapes or aliases/);
    fs.unlinkSync(managedHome);
    fs.mkdirSync(managedHome);
    fs.symlinkSync(primaryConfig, path.join(managedHome, 'SOUL.md'));
    assert.throws(() => engine.syncPersona('bot_managed'), /file escapes/);
    assert.equal(fs.readFileSync(primaryConfig, 'utf8'), 'model: original-owner-model\\n');
    const other = path.join(env.enginesDir, 'other');
    fs.mkdirSync(other);
    fs.rmSync(managedHome, { recursive: true });
    fs.symlinkSync(other, managedHome, 'dir');
    assert.throws(() => engine.engineHome('bot_managed'), /escapes or aliases/);
  `);
});

test('engine boundaries reject a bot owned by a different account', { timeout: 20000 }, async () => {
  await fixture(`
    db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('other', 'other@example.test', 'Other', 2);
    bot('bot_other', 'other');
    assert.throws(() => engine.assignEngine('bot_other'), { name: 'DeploymentOwnershipError' });
    assert.throws(() => engine.engineHome('bot_other'), { name: 'DeploymentOwnershipError' });
    await assert.rejects(engine.engineFor('bot_other'), { name: 'DeploymentOwnershipError' });
    await assert.rejects(engine.removeEngine('bot_other'), { name: 'DeploymentOwnershipError' });
    assert.equal(db.prepare('SELECT engine FROM bots WHERE id=?').get('bot_other').engine, null);
  `);
});

test('a forged managed pid file cannot stop a gateway with a different Hermes home', { timeout: 20000 }, async () => {
  await fixture(`
    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');
    bot('bot_primary'); engine.assignEngine('bot_primary');
    bot('bot_managed'); engine.assignEngine('bot_managed');
    const home = path.join(env.enginesDir, 'bot_managed');
    fs.mkdirSync(home, { recursive: true });
    const external = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'gateway'], { env: { ...process.env, HERMES_HOME: env.hermesHome }, stdio: 'ignore' });
    await once(external, 'spawn');
    try {
      fs.writeFileSync(path.join(home, 'gateway.pid'), String(external.pid));
      await assert.rejects(engine.removeEngine('bot_managed'), /cleanup is blocked/);
      assert.equal(fs.existsSync(home), true);
      assert.doesNotThrow(() => process.kill(external.pid, 0));
      assert.equal(external.exitCode, null);
      assert.equal(fs.existsSync(primaryConfig), true);
      fs.writeFileSync(path.join(home, 'gateway.pid'), 'invalid-pid-record');
      await assert.rejects(engine.removeEngine('bot_managed'), /cleanup is blocked/);
      assert.equal(fs.existsSync(home), true);
    } finally {
      const stopped = once(external, 'exit');
      external.kill('SIGTERM');
      await stopped;
    }
  `);
});

test('managed cleanup stops only a process proven to belong to that home', { timeout: 20000 }, async () => {
  await fixture(`
    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');
    bot('bot_primary'); engine.assignEngine('bot_primary');
    bot('bot_managed'); engine.assignEngine('bot_managed');
    const home = path.join(env.enginesDir, 'bot_managed');
    fs.mkdirSync(home, { recursive: true });
    const managed = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'gateway'], { detached: true, env: { ...process.env, HERMES_HOME: home }, stdio: 'ignore' });
    await once(managed, 'spawn');
    try {
      const exited = once(managed, 'exit');
      fs.writeFileSync(path.join(home, 'gateway.pid'), String(managed.pid));
      await engine.removeEngine('bot_managed');
      await exited;
      assert.equal(managed.signalCode, 'SIGTERM');
      assert.equal(fs.existsSync(home), false);
      assert.equal(fs.existsSync(primaryConfig), true);
    } finally {
      if (managed.exitCode === null && managed.signalCode === null) {
        const stopped = once(managed, 'exit'); managed.kill('SIGKILL'); await stopped;
      }
    }
  `);
});

const provisioningSetup = `
  const YAML = (await import('yaml')).default;
  fs.writeFileSync(primaryConfig, YAML.stringify({ model: 'primary-private-model', providers: { private_provider: { credential: 'primary-config-secret' } }, telegram: { token: 'never-inherit-message-token' } }));
  fs.writeFileSync(path.join(env.hermesHome, '.env'), 'OPENAI_API_KEY=primary-private-model-key\\nTELEGRAM_BOT_TOKEN=never-inherit-message-token\\n');
  fs.writeFileSync(path.join(env.hermesHome, 'auth.json'), JSON.stringify({ private_provider: { token: 'primary-private-auth' } }));
  const snapshot = ['config.yaml', '.env', 'auth.json'].map(name => fs.readFileSync(path.join(env.hermesHome, name), 'utf8'));
  bot('bot_primary'); engine.assignEngine('bot_primary');
  bot('bot_managed'); engine.assignEngine('bot_managed');
  const home = path.join(env.enginesDir, 'bot_managed');
  // Exercise real provisioning with a deliberately unavailable local executable.
  // Health failures are confined to this unit-test process; no provider is contacted.
  env.hermesBin = path.join(dir, 'unavailable-hermes-for-test');
  globalThis.fetch = async () => new Response('', { status: 503 });
  const provision = async (expected = /could not run/) => {
    await assert.rejects(engine.engineFor('bot_managed'), expected);
    const info = await engine.engineInfo('bot_managed');
    assert.equal(info.status, 'error');
    assert.equal(info.providers.length, 0);
  };
  const primaryUnchanged = () => {
    const after = ['config.yaml', '.env', 'auth.json'].map(name => fs.readFileSync(path.join(env.hermesHome, name), 'utf8'));
    assert.equal(JSON.stringify(after) === JSON.stringify(snapshot), true, 'primary home must remain unchanged');
  };
`;

test('new managed homes copy no primary model configuration or credentials by default', { timeout: 20000 }, async () => {
  await fixture(provisioningSetup + `
    assert.equal(env.inheritPrimaryCredentials, false);
    await provision(/Managed Hermes needs model setup/);
    await provision(/Managed Hermes needs model setup/);
    const cfg = YAML.parse(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
    assert.equal(cfg.model, undefined);
    assert.equal(cfg.providers, undefined);
    assert.equal(fs.existsSync(path.join(home, 'auth.json')), false);
    const privateEnv = fs.readFileSync(path.join(home, '.env'), 'utf8');
    assert.equal(privateEnv.includes('OPENAI_API_KEY'), false);
    assert.equal(privateEnv.includes('primary-private'), false);
    assert.equal(privateEnv.includes('TELEGRAM_BOT_TOKEN'), false);
    // A Hermes model object is accepted as explicit setup without inventing model validation.
    cfg.model = { default: 'operator-configured-local-model', provider: 'custom' };
    fs.writeFileSync(path.join(home, 'config.yaml'), YAML.stringify(cfg));
    await provision();
    assert.equal(fs.existsSync(path.join(home, '.uap-model-setup-required')), false);
    primaryUnchanged();
  `);
});

test('explicit inheritance copies only permitted primary configuration and model credentials', { timeout: 20000 }, async () => {
  await fixture(provisioningSetup + `
    assert.equal(env.inheritPrimaryCredentials, true);
    await provision();
    const cfg = YAML.parse(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
    assert.equal(cfg.model === 'primary-private-model', true);
    assert.equal(!!cfg.providers.private_provider, true);
    assert.equal(cfg.telegram, undefined);
    const auth = fs.readFileSync(path.join(home, 'auth.json'), 'utf8');
    assert.equal(auth.includes('primary-private-auth'), true);
    const privateEnv = fs.readFileSync(path.join(home, '.env'), 'utf8');
    assert.equal(privateEnv.includes('OPENAI_API_KEY=primary-private-model-key'), true);
    assert.equal(privateEnv.includes('TELEGRAM_BOT_TOKEN'), false);
    for (const file of ['config.yaml', '.env', 'auth.json']) assert.equal(fs.statSync(path.join(home, file)).mode & 0o777, 0o600);
    primaryUnchanged();
  `, true);
});

test('disabling inheritance preserves private credentials and model config already in a managed home', { timeout: 20000 }, async () => {
  await fixture(provisioningSetup + `
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.yaml'), YAML.stringify({ model: 'managed-private-model', providers: { own: { credential: 'managed-config-secret' } } }));
    fs.writeFileSync(path.join(home, '.env'), 'OPENAI_API_KEY=managed-private-model-key\\n');
    const ownAuth = JSON.stringify({ own: { token: 'managed-private-auth' } });
    fs.writeFileSync(path.join(home, 'auth.json'), ownAuth);
    await provision();
    const cfg = YAML.parse(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'));
    assert.equal(cfg.model === 'managed-private-model', true);
    assert.equal(!!cfg.providers.own, true);
    assert.equal(fs.readFileSync(path.join(home, 'auth.json'), 'utf8') === ownAuth, true);
    const privateEnv = fs.readFileSync(path.join(home, '.env'), 'utf8');
    assert.equal(privateEnv.includes('OPENAI_API_KEY=managed-private-model-key'), true);
    assert.equal(privateEnv.includes('primary-private'), false);
    // Preserve existing alternative Hermes config layouts; they are not newly created homes.
    delete cfg.model;
    fs.writeFileSync(path.join(home, 'config.yaml'), YAML.stringify(cfg));
    await provision();
    assert.equal(fs.existsSync(path.join(home, '.uap-model-setup-required')), false);
    primaryUnchanged();
  `);
});
