// Each test file receives its own database and direct, unprivileged application login.
// With no local TEST_POSTGRES_ADMIN_URL, start a disposable loopback-only Docker PostgreSQL.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { localPostgresTestTarget } from './lib/postgres-test-target.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'tests/out/postgres');
const suffix = () => crypto.randomBytes(10).toString('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const dockerEnv = { ...process.env };
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[name];
let currentChild;
let container;
let admin;
const report = { status: 'running', server: null, image: null, files: [], limitations: 'Real identity, conversation, HTTP read-API and staging tests; the default UI/API still uses SQLite. No hosted runtime isolation or full cutover is claimed.' };

async function command(binary, args, env = process.env, stream = false) {
  const child = spawn(binary, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: args.includes('--test') ? 180000 : 120000 });
  currentChild = child;
  let output = '';
  child.stdout.on('data', part => { output += part; if (stream) process.stdout.write(part); });
  child.stderr.on('data', part => { output += part; if (stream) process.stderr.write(part); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  currentChild = undefined;
  return { code, output };
}
const docker = (args, env = dockerEnv) => command('docker', ['--host=unix:///var/run/docker.sock', ...args], env);

process.once('SIGINT', () => { currentChild?.kill('SIGTERM'); process.exitCode = 130; });
process.once('SIGTERM', () => { currentChild?.kill('SIGTERM'); process.exitCode = 143; });

try {
  await mkdir(output, { recursive: true });
  let adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) {
    container = `uap-postgres-test-${suffix()}`;
    const password = crypto.randomBytes(24).toString('hex');
    console.log('Starting disposable PostgreSQL 16 for database verification.');
    const launched = await docker(['run', '--detach', '--rm', '--name', container,
      '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=512m',
      '--memory', '512m', '-e', 'POSTGRES_PASSWORD', 'postgres:16-alpine@sha256:81e77a4833487b8132fe4b00bedd39dc3f74b8641e387f19312a48f7de218c2e'], { ...dockerEnv, POSTGRES_PASSWORD: password });
    if (launched.code !== 0) throw new Error(`Unable to start PostgreSQL: ${launched.output}`);
    const port = await docker(['port', container, '5432/tcp']);
    const address = port.output.trim().match(/^127\.0\.0\.1:(\d+)$/);
    if (!address) throw new Error('Docker did not report a loopback PostgreSQL port.');
    adminUrl = `postgres://postgres:${password}@127.0.0.1:${address[1]}/postgres`;
    const image = await docker(['inspect', '--format', '{{.Image}}', container]);
    report.image = image.output.trim();
  }
  localPostgresTestTarget(adminUrl);
  admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 1000, max: 1 });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; } catch { await delay(250); }
  }
  if (!ready) throw new Error('Local PostgreSQL did not become ready within 30 seconds.');
  report.server = (await admin.query('SELECT version() AS version')).rows[0].version;
  const files = (await readdir(path.join(root, 'tests/postgres'))).filter(file => file.endsWith('.test.mjs')).sort();
  if (!files.length) throw new Error('No PostgreSQL tests found.');
  for (const file of files) {
    if (process.exitCode) break;
    const id = suffix();
    const dbName = `uap_test_${id}`;
    const appRole = `uap_app_${id}`;
    const issuerRole = `uap_issuer_${id}`;
    const password = crypto.randomBytes(24).toString('hex');
    const issuerPassword = crypto.randomBytes(24).toString('hex');
    let createdDatabase = false;
    let createdRole = false;
    let createdIssuer = false;
    try {
      await admin.query(`CREATE ROLE ${quote(appRole)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`);
      createdRole = true;
      await admin.query(`CREATE ROLE ${quote(issuerRole)} LOGIN PASSWORD ${literal(issuerPassword)} NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`);
      createdIssuer = true;
      await admin.query(`CREATE DATABASE ${quote(dbName)}`);
      createdDatabase = true;
      const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${dbName}`;
      const appUrl = new URL(databaseUrl); appUrl.username = appRole; appUrl.password = password;
      localPostgresTestTarget(databaseUrl, { database: dbName });
      localPostgresTestTarget(appUrl, { database: dbName, user: appRole });
      const issuerUrl = new URL(appUrl); issuerUrl.username = issuerRole; issuerUrl.password = issuerPassword;
      localPostgresTestTarget(issuerUrl, { database: dbName, user: issuerRole });
      const result = await command(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', `tests/postgres/${file}`], {
        ...process.env, UAP_POSTGRES_TEST_DATABASE: '1', TEST_DATABASE_URL: databaseUrl.toString(), TEST_APP_DATABASE_URL: appUrl.toString(), TEST_ISSUER_DATABASE_URL: issuerUrl.toString(),
      }, true);
      report.files.push({ file, exitCode: result.code });
      await writeFile(path.join(output, `${file}.log`), result.output);
      if (result.code !== 0) process.exitCode = 1;
    } finally {
      if (createdDatabase) await admin.query(`DROP DATABASE ${quote(dbName)} WITH (FORCE)`);
      if (createdRole) await admin.query(`DROP ROLE ${quote(appRole)}`);
      if (createdIssuer) await admin.query(`DROP ROLE ${quote(issuerRole)}`);
    }
  }
  report.status = process.exitCode ? 'failed' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await admin?.end();
  if (container) {
    const cleanup = await docker(['rm', '--force', container]);
    report.containerCleanup = cleanup.code === 0;
    if (cleanup.code !== 0) { process.exitCode = 1; report.status = 'failed'; }
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
