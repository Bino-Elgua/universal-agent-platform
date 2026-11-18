# Storage foundation and operator tools

The running UI/API remains on the supported single-owner SQLite path. The PostgreSQL code implements tenant metadata, opaque sessions, conversation/model history, durable task transitions and operator staging, with real database and HTTP tests. A read-only API factory and a single-action executor boundary are tested but are not mounted in the legacy server or deployed as worker processes. They do not enable hosted accounts or switch the running agent queue.

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
| import_receipts | Original metadata-staging provenance; application read only |
| conversations | Agent/generation key; atomic sequence and revision counters |
| message_rows | Immutable row identity with mutable body/revision; scoped request deduplication |
| llm_items | Ordered agent/generation model context; application insert/read only |
| auth_sessions | Global user identity, token hashes only; no direct application table access |
| history_import_receipts | Separate history-stage provenance; application read only |
| tasks / task_jobs | Tenant work and immutable dispatch input; application reads and narrow transitions |
| agent_runs | Durable execution attempts and lease generations; worker transitions only |
| approvals | Exact-action request, human decision, expiry, revocation and one-time consumption; viewers excluded |
| job_events | Ordered, causal transition records; no application/worker direct writes |

Composite foreign keys reject cross-organization workspace and agent-owner links. The application login has no user, organization, membership, migration or provenance write privilege. Enrollment and membership administration are not implemented as public APIs yet. Agents are metadata records; no provider/runtime starts from these repositories.

All sixteen data tables have ENABLE and FORCE ROW LEVEL SECURITY; session access uses narrow identity functions and separate issuer policies rather than organization context. The active actor and organization are set locally to one transaction, membership is checked, and context is cleared before releasing the connection, including after rollback. Repository queries also scope their object lookups explicitly. Viewer and suspended-member restrictions are checked by both the repository and database policies.

The actor ID is supplied by a trusted authenticated server, not by arbitrary client object IDs. The default application HTTP authentication has not been switched to PostgreSQL; the new read-only factory uses its own opaque bearer sessions in isolated HTTP tests. Database application credentials are server credentials; tenant session context is not a replacement for authenticated request handling.

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
npm run db:postgres -- grant-session-issuer --role platform_session_issuer
npm run db:postgres -- grant-job-worker --role platform_job_worker
```

The migration runner serializes pending batches with an advisory transaction lock, uses bounded lock/statement timeouts, checks contiguous history/checksums, and commits the whole pending batch together. Unknown, missing or changed ledger entries stop it. A nonempty unversioned `uap` schema requires explicit review rather than automatic adoption. `status` reports applied entries; `migrate` validates them.

`grant-app-role` targets an existing direct login, never creates a shared password, and grants only implemented data operations plus token lookup/revocation functions. It rejects session-issuer credentials before changing their grants. It rejects elevated attributes, reachable privileged roles, schema/table/database ownership and inherited unsupported privileges. Create and provision that login through your database operator workflow. The ordinary application role must not receive the operator URL. Applying the metadata staging import requires an explicitly privileged operator with RLS bypass; an application login is rejected.

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

No application cutover, active login/session import, provider grant or runtime provisioning follows `--apply`. Full account-data migration, reconciliation, restore rehearsal and HTTP API cutover remain WP-03 work.

## Sessions and authenticated data reads

Migration 3 stores SHA-256 hashes of random 256-bit opaque tokens, expiration and revocation. Tokens are returned only at issuance and are not persisted in plaintext. A separate direct issuer login receives only session SELECT/INSERT/UPDATE access. It cannot read metadata, change schema, execute identity lookup functions or acquire tenant authority. The application login cannot read or forge session rows; it can invoke narrowly defined token lookup and single-token revocation functions. Issuer and application privilege restrictions are rechecked when used.

`SessionIssuer.issue` is for a trusted authentication service that has independently proved the user. This phase does not add a public issuance endpoint, password verifier or PostgreSQL Google sign-in. Existing source authentication sessions are never imported. Issuer revoke-all and token-only logout invalidate the next lookup. An authenticated identity grants no organization access without active membership.

`createStorageReadApi(applicationPool)` exposes authenticated session, metadata and transcript reads plus idempotent self-logout. It is tested over actual loopback HTTP against PostgreSQL, including foreign organizations, suspended membership, expiration/revocation and pooled context reuse. Bearer tokens in URL query strings are not accepted; credential-bearing responses use `Cache-Control: no-store`. There are no transcript-write or agent-execution endpoints in this router, and it is not mounted in the main application.

Transcript HTTP pages are capped at four rows; database transcript/model-context payloads are bounded at 2 MiB, while repository/source inputs are bounded at 1 MiB (JSONB formatting can expand them). Broader metadata pagination, rate limiting, auth-provider integration and full write-path migration remain necessary before public mounting. This factory is not a complete hosted API release.

## Durable conversation history and staged legacy data

Migration 2 adds conversation generations, transcript rows and LLM context. Creating a generation locks its agent row; append/update/history operations lock the conversation row. Sequence and revision allocation rolls back with insertion failures. Concurrent requests do not reuse a row sequence. Request keys keep a digest of the original append independently of subsequent edits, so an original retry neither duplicates the row nor overwrites a later update.

The repository retains prior generations and supports bounded sequence/revision cursors. New-history batching is append-only. Legacy `tool-call` and `notice` kinds are preserved through an additional migration 4 constraint expansion; earlier migration bytes are not rewritten. A unique revision index protects bounded revision cursors.

After an identical metadata foundation import exists, inspect/stage the same offline backup's history with the same target flags:

```sh
npm run db:postgres -- stage-history \
  --source /backups/platform-offline.db \
  --org-id org_example --org-slug example --org-name Example \
  --workspace-id workspace_example --workspace-name Main
```

Add `--apply` to stage data using the operator connection. Without it, no target connection is opened. Foundation fingerprinting and history extraction share one read-only SQLite transaction. The counts-only report omits transcript bodies/model context, source paths and credentials. Apply requires a matching, still-valid foundation receipt; it never creates missing metadata itself.

History staging preserves observed generations, the configured current generation even when empty, transcript row identities/revisions, legacy kinds and LLM indices. Room content remains explicitly excluded. Duplicate identities/revisions, future generations, malformed or lossy JSON and target collisions fail closed. Conversation timestamp bounds are derived from source agent/transcript timestamps; receipts record this derivation rather than asserting unavailable historical session times.

One transaction stages all history and a distinct receipt. Existing sessions, pending turns, active approvals, provider grants and runtime state remain excluded/unmapped. A historical approval card is data, not an active authorization. Repeat imports verify actual records and exact JSONB receipt/profile values, including numeric changes below JavaScript parser precision. JSONB spacing expansion is allowed without relaxing source limits. Partial target histories are never silently merged. The original source and remaining unmapped data are still required; this is not a complete account cutover.

## Durable tasks, leases and approvals

Migrations 5 and 6 add task/job/run/approval/event records and narrow database transition functions. Migration 7 replaces only the heartbeat function to recheck the task creator's current active owner/admin/member authority at every worker checkpoint; migrations 1–6 retain their original bytes. `TenantJobRepository` can enqueue, read bounded pages, request cancellation and record human approval decisions. A tenant request requires an active membership; cancellation and approval resolution require an owner/admin or the task's member creator. Enqueue compares a versioned digest of the authenticated actor and immutable request fields under a scoped lock. Repeated identical requests return the original task/job; conflicting requests fail.

`WorkerJobRepository` requires a separate direct `NOINHERIT` login provisioned with `grant-job-worker`. It receives only schema usage and the five worker transition functions, with no direct table access or tenant/session functions. Both service paths check privilege drift on every operation. Application credentials cannot claim a job, update a lease or forge an approval/event by directly writing a table. The worker is a trusted cross-tenant dispatcher credential: never distribute it to a model, customer, tool process or sandbox.

Claims use row locks with `SKIP LOCKED`, per-agent coordination and an active-job uniqueness constraint. PostgreSQL supplies lease times; each claim increments a fencing generation and creates a distinct run. Only a SHA-256 hash of a random 256-bit lease token is stored. Heartbeat, settlement and approval operations require the current unexpired generation/token. Transactions end before any external work. Approval pauses close a run and release its lease; resuming an allowed approval receives a new fence without consuming a retry attempt.

Lease recovery and explicit retries are bounded by `maxAttempts`. `reconcile_only` work and jobs that have consumed an approval become `incomplete` when recovery might repeat a side effect. Other explicitly idempotent jobs can retry, with caller-specified delay on reported failure; exhaustion becomes `dead_letter`. There is no automatic dead-letter replay or claim of provider reconciliation. Queued cancellation completes immediately; running cancellation stays `cancelling` until a worker confirms stop or reports `incomplete`. Expired cancellation leases require reconciliation.

Approvals bind a versioned digest to organization/job, exact action kind/arguments and policy/budget references. Pending and allowed approvals expire using the database clock, and allowed decisions can be revoked. Consumption checks the current lease, exact digest, current requester/approver membership and recorded policy/budget references, then records the consuming run atomically. Consumption is one-time. A digest is request comparison, not a signature, SID proof, policy-engine decision or verified funding reservation. Payloads must not contain credentials. Historical imported approval cards remain inactive data.

Events allocate a per-job sequence transactionally with state changes and carry global IDs, causal links, tenant/workspace/agent, trace and provenance. Application/worker roles cannot mutate them directly. These are database audit records, not cryptographically signed evidence or a durable delivery outbox. The nullable requester SID is an unverified reference until the SID service exists.

`reserved_paid` jobs are deliberately unclaimable: a reservation ID supplied by a caller does not establish funds. `DurableExecutor` implements one narrow execution contract for `unmetered_local` jobs: one versioned action, an explicitly registered local handler, an injected policy decision that must exactly match the immutable job references, and a database heartbeat immediately before the tool call. Unknown tools, malformed payloads, policy drift, approval-required actions and paid authority fail closed. Only an explicitly reported, known idempotent failure can retry; ambiguous errors and partial nested checkpoints become `incomplete`. A stable invocation digest is supplied to handlers, and handlers must checkpoint again immediately before every nested external side effect.

The executor contract is exercised end to end against actual PostgreSQL, including successful settlement, cancellation after policy evaluation and membership revocation before invocation. It is a library boundary, not a deployed or isolated worker. The tests use an in-process fixture policy and fixture tool; there is no production policy service, provider handler, sandbox, credential broker, process supervisor or approval-resume adapter. No default worker process, Hermes dispatch, cron/webhook scheduler, execution endpoint or UI cutover is enabled. Capability grants, real policy/entitlement checks, spending ledger, runtime isolation, resource reconciliation and the blueprint's orchestration service remain required before provider execution. The main app still uses its existing SQLite queue.

Membership is rechecked at claim, heartbeat and approval consumption. The library executor heartbeats before its one tool call and exposes a nested checkpoint callback. A later membership change still does not by itself stop code already executing: each real handler must use the callback before subsequent side effects and propagate revocation to its runtime. Lease expiration fences database transitions; it does not prove an external command stopped.

Upgrade staging databases with `migrate`, then reapply the application grants and provision a distinct worker login. Older application builds must not be pointed at the expanded schema without their matching grants. For rollback, restore the verified backup with its matching application version; there is no automatic destructive downgrade. Preserve unfinished jobs for explicit reconciliation and never replay them just to repair a migration.

## Verification and evidence

```sh
npm run check
npm run test:postgres
npm run test:browser
```

The ordinary suite includes SQLite legacy/upgrade, rollback, checksum/default/index/FK drift, read-only import, WAL rejection, CLI dry-run/redaction, local-test-target validation and migration-control lint tests. The PostgreSQL suite uses a real PostgreSQL 16 instance, separate temporary databases per test file, and direct unprivileged application logins. It exercises RLS denial, role drift, foreign-key isolation, pooled connection reuse, concurrent/failed migrations, bounded locking, idempotent import and failure rollback.

Without a local test URL the harness starts the pinned PostgreSQL Docker image and removes its container/data at the end. With `TEST_POSTGRES_ADMIN_URL`, it accepts only a loopback target and validates pg's effective host/database/user after parsing. Connection query parameters cannot override generated test targets. It creates and removes only databases and roles with its freshly generated IDs.

Results and server/image identity are written to `tests/out/postgres/report.json`; individual logs are in the same ignored directory and uploaded by CI. The new CI job is authored; a hosted run is not claimed. No paid provider, cloud lab, merchant or customer resource is part of these tests.

To run a focused database regression while preserving the same isolated setup and cleanup, pass existing filenames, for example `node scripts/test-postgres.mjs jobs.test.mjs`. Application, issuer and worker roles have distinct generated passwords and are removed with each disposable test database.
