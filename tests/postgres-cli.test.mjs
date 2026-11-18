import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createImportSource } from './helpers/import-source.mjs';
import { createHistorySource } from './helpers/history-source.mjs';

const root = path.resolve(import.meta.dirname, '..');
async function cli(args, extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.SESSION_SECRET; delete env.UAP_POSTGRES_ADMIN_URL;
  Object.assign(env, extra);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/storage/postgres/cli.ts', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  return { code, stdout, stderr };
}

test('operator CLI help, inspection and dry-run work without application secrets or PostgreSQL', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-cli-'));
  try {
    const help = await cli(['--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /running application still uses SQLite/);
    assert.match(help.stdout, /grant-job-worker --role <separate-worker-login>/);
    const { sourcePath, options } = createImportSource(dir, 'cli');
    const inspected = await cli(['inspect-sqlite', '--source', sourcePath]);
    assert.equal(inspected.code, 0, inspected.stderr);
    const summary = JSON.parse(inspected.stdout);
    assert.equal(summary.counts.agents, 1);
    assert.equal(summary.counts.unmappedTables.auth_sessions, 1);
    for (const excluded of ['session-secret-not-imported', 'secret-instructions-not-imported', sourcePath, 'owner_cli@example.test']) assert.equal(inspected.stdout.includes(excluded), false);
    const imported = await cli(['import-sqlite', '--source', sourcePath,
      '--org-id', options.organizationId, '--org-slug', options.organizationSlug, '--org-name', options.organizationName,
      '--workspace-id', options.workspaceId, '--workspace-name', options.workspaceName]);
    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).status, 'dry_run');
    assert.equal(JSON.parse(imported.stdout).sourceDigest, summary.sourceDigest);
    assert.equal(JSON.parse(imported.stdout).runtimeState, 'inactive_metadata_only');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('operator CLI requires explicit administrator access and redacts connection failure details', async () => {
  const absent = await cli(['migrate']);
  assert.equal(absent.code, 1);
  assert.match(absent.stderr, /Set UAP_POSTGRES_ADMIN_URL/);
  const rejected = await cli(['status'], { UAP_POSTGRES_ADMIN_URL: 'postgres://test:must-not-appear@127.0.0.1:1/test' });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.stderr.includes('must-not-appear'), false);
  assert.equal(rejected.stderr.includes('postgres://'), false);
  assert.match(rejected.stderr, /no connection details are printed/);
});


test('history staging CLI dry run returns counts without database access or transcript bodies', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-cli-history-'));
  try {
    const { sourcePath, options } = createHistorySource(dir, 'cli');
    const result = await cli(['stage-history', '--source', sourcePath,
      '--org-id', options.organizationId, '--org-slug', options.organizationSlug, '--org-name', options.organizationName,
      '--workspace-id', options.workspaceId, '--workspace-name', options.workspaceName]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'dry_run');
    assert.equal(report.runtimeState, 'inactive_history_only');
    assert.equal(report.counts.rows, 4);
    assert.equal(report.counts.historyItems, 2);
    assert.equal(result.stdout.includes('Historical user message'), false);
    assert.equal(result.stdout.includes('NEVER-IMPORT-SESSION'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
