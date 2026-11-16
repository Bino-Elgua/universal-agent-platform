import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localPostgresTestTarget } from '../scripts/lib/postgres-test-target.mjs';

test('database test runner validates effective target and identity before connecting', () => {
  assert.equal(localPostgresTestTarget('postgres://fixture:fixture@127.0.0.1:5432/scoped?sslmode=disable', { database: 'scoped', user: 'fixture' }).hostname, '127.0.0.1');
  for (const uri of [
    'postgres://fixture:never-print@127.0.0.1/postgres?host=remote.invalid',
    'postgres://fixture:never-print@127.0.0.1/scoped?dbname=postgres',
    'postgres://fixture:never-print@127.0.0.1/scoped?database=postgres',
    'postgres://fixture:never-print@127.0.0.1/scoped?user=admin',
    'postgres://fixture:never-print@127.0.0.1/scoped?host=/var/run/postgresql',
    'postgres://fixture:never-print@127.0.0.1/scoped?options=-c%20role%3Dadmin',
    'postgres://fixture:never-print@remote.invalid/scoped',
  ]) {
    assert.throws(() => localPostgresTestTarget(uri), error => /loopback URL without/.test(error.message) && !error.message.includes('never-print'));
  }
  assert.throws(() => localPostgresTestTarget('postgres://fixture:fixture@127.0.0.1/wrong', { database: 'scoped' }));
  assert.throws(() => localPostgresTestTarget('postgres://fixture:fixture@127.0.0.1/scoped', { user: 'different' }));
});
