import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePostgresMigrationSql } from '../server/src/storage/postgres/sql-validation.ts';

test('migration manifests cannot escape the runner transaction through SQL commands', () => {
  for (const command of ['COMMIT', 'END', 'BEGIN', 'ROLLBACK', 'START TRANSACTION', 'SAVEPOINT x', 'RELEASE x', "PREPARE TRANSACTION 'x'", 'SET ROLE privileged', 'RESET ALL', 'DISCARD ALL']) {
    assert.throws(() => validatePostgresMigrationSql(`CREATE TABLE x(id int); /* nested /* comment */ remains */ ${command};`), /cannot control transactions/);
  }
  assert.throws(() => validatePostgresMigrationSql('CREATE TABLE x(id int); -- comment\rCOMMIT;'), /cannot control transactions/);
  assert.throws(() => validatePostgresMigrationSql('CREATE TABLE uap.é$tag$(id int); COMMIT; SELECT 1 AS x$tag$;'), /cannot control transactions/);
  for (const invalid of ["SELECT 'unterminated", 'SELECT $tag$missing', '/* incomplete']) assert.throws(() => validatePostgresMigrationSql(invalid), /Unterminated/);
});

test('SQL literals, comments and function bodies do not masquerade as migration control', () => {
  for (const valid of [
    "SELECT 'COMMIT; SET ROLE x;'; -- ROLLBACK\nSELECT 1;",
    'CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN PERFORM 1; END $body$;',
    'CREATE FUNCTION y() RETURNS text LANGUAGE sql AS $$ SELECT \'ROLLBACK;\' $$;',
    'CREATE TABLE "COMMIT;"(id int); /* COMMIT; */',
    "SELECT E'quoted\\\' ; COMMIT; still literal';",
  ]) assert.doesNotThrow(() => validatePostgresMigrationSql(valid));
});
