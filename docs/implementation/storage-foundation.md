# Storage foundation and operator tools

The running UI/API remains on the supported single-owner SQLite path. The PostgreSQL code implements tenant metadata repositories and operator staging, with real database tests. It does not enable hosted accounts, replace runtime authorization, authenticate public requests, or migrate conversations and jobs.

## SQLite upgrades in the running application

`server/src/storage/sqlite-migrations.ts` owns six ordered migrations: baseline tables, agent runtime columns, settings/memory metadata, rooms/subagents, proactive/event configuration, and owner-binding schema. Previously scattered CREATE/ALTER calls have been removed. The ownership data policy remains in deployment.ts.

Each installation records migration ID/name/SHA-256/applied time in `application_schema_migrations`. Startup takes one immediate write transaction for ledger validation and the pending batch. It validates required tables, columns, defaults, uniqueness/indexes, foreign-key declarations and existing FK data. An unexpected version, changed applied checksum or invalid legacy schema stops startup and rolls back the pending batch. No repair/deletion is inferred.

Migration manifests are trusted source code. The runner rejects top-level transaction/connection controls so ordinary migration changes cannot accidentally escape its transaction. This lint is not a sandbox for untrusted SQL. New migration IDs must be appended; editing an applied entry prevents startup.

Take a consistent database and managed-home backup before upgrades. Restore a pre-upgrade database and matching application version to roll back; there is no destructive automatic downgrade command. IDs and legacy data are preserved by the current additive migrations. This does not yet constitute the blueprint's full backup/restore acceptance.

## PostgreSQL schema and permissions

The `uap` schema has a separate checksummed migration ledger and these metadata tables:

| Table | Ownership / role |
| --- | --- |
| users | Global stable user identity; application reads only the current actor's row |
| organizations | Global organization ID/slug; active members can read their scoped organization |
| memberships | Organization + user key; application reads its own scoped membership only |
| workspaces | Organization + workspace ID key; owner/admin writes, active members read |
| agents | Organization + agent ID key; owner/admin/member writes, viewers read |
| import_receipts | Organization-scoped staging provenance; application read only |

Composite foreign keys reject cross-organization workspace and agent-owner links. The application login has no user, organization, membership, migration or provenance write privilege. Enrollment and membership administration are not implemented as public APIs yet. Agents are metadata records; no provider/runtime starts from these repositories.

All six metadata tables have ENABLE and FORCE ROW LEVEL SECURITY. The active actor and organization are set locally to one transaction, membership is checked, and context is cleared before releasing the connection, including after rollback. Repository queries also scope their object lookups explicitly. Viewer and suspended-member restrictions are checked by both the repository and database policies.

The actor ID is supplied by a trusted authenticated server, not by arbitrary client object IDs. Public HTTP authentication has not been switched to this repository. Database application credentials are server credentials; tenant session context is not a replacement for authenticated request handling.

Migration/import operator credentials are distinct from the direct application login. Tenant requests reject privileged, schema-owning, database-owning and unsafe inherited roles, including privileges added after initial grants. The schema's security-definer membership helper uses an explicit search path and scoped actor lookup to avoid recursive policy evaluation.

## Operator commands

From a development checkout:

```sh
npm run db:postgres -- --help
```

In an installed build, use `node server/dist/storage/postgres/cli.js` with the same commands. Load `UAP_POSTGRES_ADMIN_URL` through a protected environment file or process environment. The commands do not read or change the application's `DB_PATH` and do not select PostgreSQL for the UI/API.

```sh
npm run db:postgres -- migrate
npm run db:postgres -- status
npm run db:postgres -- grant-app-role --role platform_app
```

The migration runner serializes pending batches with an advisory transaction lock, uses bounded lock/statement timeouts, checks contiguous history/checksums, and commits the whole pending batch together. Unknown, missing or changed ledger entries stop it. A nonempty unversioned `uap` schema requires explicit review rather than automatic adoption. `status` reports applied entries; `migrate` validates them.

`grant-app-role` targets an existing direct login, never creates a shared password, and grants only implemented metadata operations. It rejects elevated attributes, reachable privileged roles, schema/table/database ownership and inherited unsupported privileges. Create and provision that login through your database operator workflow. The ordinary application role must not receive the operator URL. Applying the metadata staging import requires an explicitly privileged operator with RLS bypass; an application login is rejected.

## Source inspection and staging import

Prepare a consistent, stopped SQLite backup in rollback-journal format. On the **backup copy**, configure `PRAGMA journal_mode=DELETE` using SQLite tooling and close all connections before inspection. WAL-mode headers and any `-wal`, `-shm` or hot-journal sidecars are rejected before the inspector opens SQLite. The tool never checkpoints the original or uses `immutable` to ignore pending WAL data. Do not point it at the running application database.

Read-only inspection and dry-run import do not need a PostgreSQL connection:

```sh
npm run db:postgres -- inspect-sqlite --source /backups/platform-offline.db
npm run db:postgres -- import-sqlite \
  --source /backups/platform-offline.db \
  --org-id org_example --org-slug example --org-name Example \
  --workspace-id workspace_example --workspace-name Main
```

The report lists mapping version, a deterministic logical SHA-256 fingerprint, mapped/excluded/unmapped row counts and the inactive metadata state. The fingerprint covers all user-table schemas and row digests within one read snapshot; it is not a raw file hash, signature or proof of provider execution. Raw records, credentials and source paths are not printed. Reports and receipt metadata still contain organization/workspace identifiers and table counts; store them with appropriate access.

The mapping requires exactly one source user. It preserves the stable user and agent IDs, normalizes the login email, and maps presentation metadata for non-room agents. Room count and all unmapped table counts remain explicit. Instructions, conversations, authentication sessions, primary gateway assignments, selected-model hints, computer IDs, provider tokens, browser profiles and runtime homes are not copied. Fields omitted from users/bots also remain in the source; this is not a complete account export.

Add `--apply` with the operator environment only after reviewing the dry-run report. The importer stages everything in one bounded, locked transaction. It rejects identity/organization collisions without merging, retains tenant-scoped workspace/agent IDs, and stores a receipt. Repeating the exact source/target verifies the actual user, membership, workspace and agent records as well as the receipt. Tampered records, changed source or changed target metadata fail closed. A database error rolls back all staged writes.

No application cutover, active login/session import, provider grant or runtime provisioning follows `--apply`. The source and unmapped history remain necessary. Full account-data migration, reconciliation, restore rehearsal and HTTP API cutover are subsequent WP-03 work.

## Verification and evidence

```sh
npm run check
npm run test:postgres
npm run test:browser
```

The ordinary suite includes SQLite legacy/upgrade, rollback, checksum/default/index/FK drift, read-only import, WAL rejection, CLI dry-run/redaction, local-test-target validation and migration-control lint tests. The PostgreSQL suite uses a real PostgreSQL 16 instance, separate temporary databases per test file, and direct unprivileged application logins. It exercises RLS denial, role drift, foreign-key isolation, pooled connection reuse, concurrent/failed migrations, bounded locking, idempotent import and failure rollback.

Without a local test URL the harness starts the pinned PostgreSQL Docker image and removes its container/data at the end. With `TEST_POSTGRES_ADMIN_URL`, it accepts only a loopback target and validates pg's effective host/database/user after parsing. Connection query parameters cannot override generated test targets. It creates and removes only databases and roles with its freshly generated IDs.

Results and server/image identity are written to `tests/out/postgres/report.json`; individual logs are in the same ignored directory and uploaded by CI. The new CI job is authored; a hosted run is not claimed. No paid provider, cloud lab, merchant or customer resource is part of these tests.
