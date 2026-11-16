import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createImportSource } from './helpers/import-source.mjs';
import { inspectSqliteSource, importSqliteFoundation, SqliteImportError } from '../server/src/storage/postgres/import.ts';

async function fixture(work) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uap-source-import-'));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('readonly source inspection preserves bytes/IDs and fingerprints all unimported content without exporting secrets', async () => fixture(async dir => {
  const { sourcePath, userId, botId, options } = createImportSource(dir, 'source');
  const bytes = await readFile(sourcePath);
  const files = await readdir(dir);
  const first = inspectSqliteSource(sourcePath);
  const second = inspectSqliteSource(sourcePath);
  assert.deepEqual(first, second);
  assert.deepEqual(await readFile(sourcePath), bytes);
  assert.deepEqual(await readdir(dir), files);
  assert.equal(first.user.id, userId);
  assert.equal(first.user.email, 'owner_source@example.test');
  assert.equal(first.agents[0].id, botId);
  assert.equal(first.counts.excludedRooms, 1);
  assert.equal(first.counts.unmappedTables.auth_sessions, 1);
  assert.equal(first.counts.unmappedTables.rows, 1);
  const serialized = JSON.stringify(first);
  for (const excluded of ['session-secret-not-imported', 'secret-instructions-not-imported', 'unverified-model', 'conversation-not-imported']) assert.equal(serialized.includes(excluded), false);
  assert.equal(first.agents[0].profile.importState, 'inactive_metadata_only');
  const dry = await importSqliteFoundation({ connect: () => { throw new Error('dry run contacted PostgreSQL'); } }, options);
  assert.equal(dry.status, 'dry_run');
  assert.equal(JSON.stringify(dry).includes(sourcePath), false);
  const changed = new Database(sourcePath);
  changed.prepare('UPDATE auth_sessions SET token=?').run('different-session-secret'); changed.close();
  assert.notEqual(inspectSqliteSource(sourcePath).sourceDigest, first.sourceDigest, 'Unmapped contents still contribute to source integrity fingerprint');
}));

test('ambiguous accounts, invalid references and missing sources fail before target access', async () => fixture(async dir => {
  const { sourcePath, options } = createImportSource(dir, 'ambiguous');
  const source = new Database(sourcePath);
  source.prepare('INSERT INTO users VALUES(?,?,?,?)').run('another-user','another@example.test','Other',1700000000000); source.close();
  assert.throws(() => inspectSqliteSource(sourcePath), /exactly one source user/);
  await assert.rejects(importSqliteFoundation({ connect: () => { throw new Error('must not connect'); } }, { ...options, apply: true }), SqliteImportError);
  const fixed = new Database(sourcePath);
  fixed.prepare('DELETE FROM users WHERE id=?').run('another-user'); fixed.prepare('UPDATE bots SET user_id=?').run('missing-user'); fixed.close();
  assert.throws(() => inspectSqliteSource(sourcePath), /owned by another or missing/);
  const absent = path.join(dir, 'missing.sqlite');
  assert.throws(() => inspectSqliteSource(absent), SqliteImportError);
  assert.equal((await readdir(dir)).includes('missing.sqlite'), false);
}));


test('live WAL input is rejected before SQLite opens, preserving database, WAL and shared-memory bytes', async () => fixture(async dir => {
  const { sourcePath } = createImportSource(dir, 'livewal');
  const live = new Database(sourcePath);
  try {
    live.pragma('journal_mode = WAL');
    live.prepare('UPDATE rows SET body=?').run('Uncheckpointed live history');
    const paths = [sourcePath, sourcePath + '-wal', sourcePath + '-shm'];
    const before = await Promise.all(paths.map(file => readFile(file)));
    const files = await readdir(dir);
    assert.throws(() => inspectSqliteSource(sourcePath), /stopped, checkpointed rollback-journal backup/);
    const after = await Promise.all(paths.map(file => readFile(file)));
    assert.deepEqual(after, before);
    assert.deepEqual(await readdir(dir), files);
  } finally { live.close(); }
}));

test('closed WAL-header backup is rejected without creating WAL or shared-memory sidecars', async () => fixture(async dir => {
  const { sourcePath } = createImportSource(dir, 'closedwal');
  const source = new Database(sourcePath);
  source.pragma('journal_mode = WAL');
  source.close();
  const before = await readFile(sourcePath);
  assert.equal(before[18], 2);
  const files = await readdir(dir);
  assert.throws(() => inspectSqliteSource(sourcePath), /rollback-journal backup/);
  assert.deepEqual(await readFile(sourcePath), before);
  assert.deepEqual(await readdir(dir), files);
}));
