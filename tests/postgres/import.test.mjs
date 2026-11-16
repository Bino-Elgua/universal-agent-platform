// Staging migration acceptance against the harness's actual disposable PostgreSQL.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { migratePostgres, grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { importSqliteFoundation, inspectSqliteSource, SqliteImportError } from '../../server/src/storage/postgres/import.ts';
import { createImportSource } from '../helpers/import-source.mjs';
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) throw new Error('Use npm run test:postgres with a disposable local PostgreSQL instance.');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const application = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 1 });
let dir;
before(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'uap-pg-import-')); await migratePostgres(admin); await grantApplicationRole(admin, decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username)); });
after(async () => { await application.end(); await admin.end(); await rm(dir, { recursive: true, force: true }); });
const count = async (table, organizationId) => Number((await admin.query(`SELECT count(*) AS count FROM uap.${table} WHERE organization_id=$1`, [organizationId])).rows[0].count);

test('real staging import preserves IDs and creates only inactive metadata with auditable unmapped counts', async () => {
  const source = createImportSource(dir, 'apply');
  const before = await readFile(source.sourcePath);
  const result = await importSqliteFoundation(admin, { ...source.options, apply: true });
  assert.equal(result.status, 'imported');
  assert.match(result.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.counts.agents, 1); assert.equal(result.counts.excludedRooms, 1);
  assert.equal(result.counts.unmappedTables.auth_sessions, 1);
  const rows = (await admin.query('SELECT * FROM uap.agents WHERE organization_id=$1', [source.options.organizationId])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, source.botId); assert.equal(rows[0].owner_user_id, source.userId);
  assert.equal(rows[0].profile.importState, 'inactive_metadata_only');
  for (const field of ['engine', 'engine_port', 'model', 'instructions']) assert.equal(Object.hasOwn(rows[0].profile, field), false);
  const receipt = (await admin.query('SELECT * FROM uap.import_receipts WHERE organization_id=$1', [source.options.organizationId])).rows[0];
  assert.equal(JSON.stringify(receipt).includes(source.sourcePath), false);
  assert.equal(JSON.stringify(receipt).includes('session-secret'), false);
  assert.deepEqual(await readFile(source.sourcePath), before);
  const repeat = await importSqliteFoundation(admin, { ...source.options, apply: true });
  assert.equal(repeat.status, 'already_imported'); assert.equal(repeat.receiptId, result.receiptId);
  assert.equal(await count('agents', source.options.organizationId), 1);
});

test('idempotent imports verify actual records and reject tampered rows or changed target metadata', async () => {
  const source = createImportSource(dir, 'tampered');
  await importSqliteFoundation(admin, { ...source.options, apply: true });
  await assert.rejects(importSqliteFoundation(admin, { ...source.options, organizationName: 'Changed target', apply: true }), /does not match/);
  await admin.query("UPDATE uap.agents SET profile='{}'::jsonb WHERE organization_id=$1", [source.options.organizationId]);
  await assert.rejects(importSqliteFoundation(admin, { ...source.options, apply: true }), /records have changed/);
  assert.equal(await count('import_receipts', source.options.organizationId), 1);
});

test('changed source and identity collisions fail closed instead of merging or overwriting', async () => {
  const source = createImportSource(dir, 'changed');
  await importSqliteFoundation(admin, { ...source.options, apply: true });
  const database = new Database(source.sourcePath); database.prepare('UPDATE rows SET body=?').run('Changed unimported history'); database.close();
  await assert.rejects(importSqliteFoundation(admin, { ...source.options, apply: true }), /already exists/);
  const target = { ...source.options, organizationId: 'different-target', organizationSlug: 'different-target', workspaceId: 'different-workspace', apply: true };
  await assert.rejects(importSqliteFoundation(admin, target), /already exists/);
  assert.equal((await admin.query('SELECT count(*) AS count FROM uap.organizations WHERE id=$1', [target.organizationId])).rows[0].count, '0');
});

test('a mid-import database failure rolls back every identity, membership, workspace and receipt write', async () => {
  const source = createImportSource(dir, 'rollback');
  await admin.query(`CREATE FUNCTION uap.reject_import_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identified-test-failure'; END $$;
    CREATE TRIGGER reject_import_test BEFORE INSERT ON uap.agents FOR EACH ROW EXECUTE FUNCTION uap.reject_import_test();`);
  try { await assert.rejects(importSqliteFoundation(admin, { ...source.options, apply: true }), SqliteImportError); }
  finally { await admin.query('DROP TRIGGER reject_import_test ON uap.agents; DROP FUNCTION uap.reject_import_test()'); }
  for (const table of ['agents','workspaces','memberships','import_receipts']) assert.equal(await count(table, source.options.organizationId), 0);
  assert.equal((await admin.query('SELECT count(*) AS count FROM uap.users WHERE id=$1', [source.userId])).rows[0].count, '0');
  assert.equal((await admin.query('SELECT count(*) AS count FROM uap.organizations WHERE id=$1', [source.options.organizationId])).rows[0].count, '0');
  assert.equal((await importSqliteFoundation(admin, { ...source.options, apply: true })).status, 'imported');
});

test('application credentials cannot run operator imports; dry runs do not connect or write target', async () => {
  const source = createImportSource(dir, 'operator');
  const dry = await importSqliteFoundation({ connect: () => { throw new Error('Unexpected connection'); } }, source.options);
  assert.equal(dry.status, 'dry_run');
  await assert.rejects(importSqliteFoundation(application, { ...source.options, apply: true }), /privileged operator/);
  assert.equal(await count('agents', source.options.organizationId), 0);
});

test('tenant-scoped stable workspace and agent IDs do not collide across imported organizations', async () => {
  const stable = `shared_bot_${randomUUID()}`;
  const first = createImportSource(dir, 'firsttenant', stable);
  const second = createImportSource(dir, 'secondtenant', stable);
  first.options.workspaceId = 'shared-workspace'; second.options.workspaceId = 'shared-workspace';
  assert.notEqual(inspectSqliteSource(first.sourcePath).sourceDigest, inspectSqliteSource(second.sourcePath).sourceDigest);
  assert.equal((await importSqliteFoundation(admin, { ...first.options, apply: true })).status, 'imported');
  assert.equal((await importSqliteFoundation(admin, { ...second.options, apply: true })).status, 'imported');
  assert.equal((await importSqliteFoundation(admin, { ...second.options, apply: true })).status, 'already_imported');
  const rows = (await admin.query('SELECT organization_id,id FROM uap.agents WHERE id=$1', [stable])).rows;
  assert.equal(rows.length, 2);
});
