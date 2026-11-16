# Implementation evidence — updated 2026-11-16

Specification: [Master Blueprint v2](master-blueprint-v2.md). This checkout is an in-development single-owner self-hosted foundation. It is not a commercial release or a completed multi-tenant platform.

## Work packet state

| Packet | Implemented and locally verified | Remaining acceptance gates |
| --- | --- | --- |
| WP-01 | Exact Bot HQ baseline, clean installation, build/typecheck, lockfile license metadata inventory; six candidate source checkouts statically inspected and pinned | Live upstream provider E2Es, complete dependency/model/asset rights review, missing OKF source and custom Agency fork |
| WP-02 | Original geometric badges for all 25 persisted shape IDs, activity states/reduced motion, neutral theme/favicon/package identifiers, licensed Lucide glyphs; excluded artwork removed; browser preference compatibility | Final commercial brand/domain and rights clearance; avatar uploads/moderation not implemented |
| WP-03 | Single-owner safeguards; six checksummed transactional SQLite migrations; PostgreSQL tenant metadata schema, async workspace/agent repository, FORCE RLS, role restrictions, safe read-only inspection and idempotent metadata staging | PostgreSQL sessions/history/jobs/runtime repositories and API cutover, full account export/import, restore rehearsal, durable orchestration and tenant-isolated runtimes |
| WP-04 | Optional credential boot, lazy clients, pre-I/O configuration guards, truthful health configuration states, disabled-provider tool/UI gating, real voice catalog error/retry, no fabricated options | Full versioned registry/conformance, per-tenant encrypted credentials, capability probes, budget/entitlement grants and live provider testing |
| WP-05 | Sticky external-primary binding, protected primary files/process, managed path/process ownership checks, opt-in credential inheritance; gateway-only default model reporting | Authorized remote pairing/tunnel, revocation, managed hosting, live Hermes acceptance, supported authorized gateway model mutation |

All five packets remain **in progress** against the full blueprint. No paid/hosted feature is enabled or advertised by these changes.

## Baseline and source evidence

- Bot HQ input: `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`, exactly the blueprint pin.
- Node 24.22.1, npm 11.9.0. `npm ci` passed on the original baseline and again after package identity changes.
- Original baseline `npm run typecheck` and `npm run build`: passed.
- Lockfile metadata: [npm-license-inventory.json](npm-license-inventory.json). Metadata is not legal approval or complete transitive/source-asset review.
- Candidate sources: [source-inventory.md](source-inventory.md), exact commits/license digests in [source-pins.json](source-pins.json). Their code/installers/cloud commands were not executed or merged into this app.
- Hermes source: [hermes-model-api-audit.md](hermes-model-api-audit.md). Its gateway model inventory does not imply global mutation permission; its dashboard setter is a different service/authorization surface.
- Detailed tenant limitations and PostgreSQL path: [tenant-audit.md](tenant-audit.md).

The OKF zip and the owner's custom Agency Agents fork are not among the provided inputs. Their features have not been treated as implemented. Public upstream Agency templates were inspected independently.

## Verified behavior and boundaries

### Ownership and migration

First enrollment requires the secret-authenticated local owner flow, explicitly enabled development login, or Google login matching one configured owner email. Owner/account/initial profile writes share a transaction; external provisioning follows commit. Subsequent identities cannot claim the installation. Existing sessions also enforce the persisted owner.

A single legacy user keeps its stable ID and primary binding. Multiple accounts or inconsistent/duplicate primary bindings block startup without selecting/deleting users. A deleted primary profile leaves its binding reserved, so a later bot cannot inherit the external gateway. User history and historical model/provider fields are retained.

Fresh installs use `platform.db`; an existing sole `grokbot.db` remains selected. When both names exist, an explicit `DB_PATH` is required. No database rename is performed. Backup/rollback guidance is in [README](../../README.md); full backup/restore acceptance is still pending.

### Hermes authority and runtime safety

The Engine panel reports the gateway-configured default from `/api/model/options`, with unknown values left unknown. It does not claim that the default is necessarily the executing model of every existing session. Configuration changes happen in Hermes; legacy model PATCH returns 409. Historical SQLite hints no longer override turn requests. Turns use the `hermes-agent` gateway alias and no model/provider fallback is added.

External primary restart/removal is unavailable. Managed homes must be separate from the primary home and cannot use symlinks to escape or alias another managed home. Process signaling requires Linux `/proc` evidence of the managed home, and unproven shutdown blocks home deletion. Failed cleanup retains the profile and binding for retry rather than reporting successful deletion.

`HERMES_INHERIT_PRIMARY_CREDENTIALS=1` is an explicit operator grant for copying permitted primary model config/auth/keys into managed homes. It defaults off; existing managed private credentials are preserved. Newly generated homes without a model remain setup-required rather than pretending to run.

### Providers, UI and authentication

Orgo/xAI/Composio credentials may be absent at boot. Their configured `_FILE` values must be readable and nonempty. A required session secret is retained. Health distinguishes `unconfigured` from `configured_unverified`; it does not prove provider validity, Hermes/model health or authorization.

Disabled tools disappear from discovery; stale calls still reject before network/command execution. Missing Orgo key versus computer ID is identified accurately. Unconfigured voice/app controls show recovery instead of fake catalog entries. Voice catalog failures return a retryable 502 without invented voices or upstream details. Unsupported compaction, consolidation and shared-computer suspension return explicit 409 errors; fabricated memory percentages and no-op Sleep controls were removed.

Google login requires a stored connection binding, rejects substituted IDs, and expires after 15 minutes. Rejected or existing-owner provisional connections are cleaned up; actual cleanup failure is logged for operator review and is not proof of deletion. Callback script data is escaped, postMessage targets the configured app origin, and connection success requires a verified owned connection. The local sign-in CLI avoids shell-built JSON and secret-bearing command arguments.

Original node badges, Lucide glyphs and a neutral palette replace excluded artwork. Source attribution remains in LICENSE/THIRD_PARTY_NOTICES. Historical filesystem/cookie/environment identifiers remain where required for compatibility; historical identity bytes were not rewritten.

## Validation

- `npm run typecheck`: passed.
- `npm test`: **50 passed**, 0 failed (the original 29 plus storage migration, source/CLI and test-harness cases). Includes real isolated SQLite/API/startup tests and clearly identified unit-only SDK/local gateway fixtures. No live provider credentials were used.
- `npm run test:postgres`: **24 passed**, 0 failed, against actual PostgreSQL 16.16. Each test file uses a separate temporary database and nonprivileged login; generated roles/databases and the disposable container were removed. Image ID `sha256:3cbd775daa28461ef484ed88ca1e5a5a72ff126e196deeebce6fec764edf1200`; pinned registry digest and operator instructions are in the storage guide.
- `npm run build`: passed for web and server.
- `npm run audit:branding`: passed; excludes 69 upstream artifact hashes from source/public/build paths. This is distribution hygiene, not trademark/legal clearance.
- `npm run test:browser`: actual Chromium against the compiled local server, real HTTP/session/SQLite and original UI, with temporary data. Covers owner link login, provider gating, read-only Hermes display, primary protection, identity after reload, missing assets/runtime errors and a 390px viewport.
- Browser evidence is generated under `tests/out/foundation/` (ignored locally and uploaded by CI). Screenshots: `signin.png`, `owner-workspace.png`, `owner-mobile.png`; structured result: `report.json`.
- `git diff --check`: passed. The verbatim supplied blueprint is exempt from whitespace lint so its original Markdown hard line breaks remain intact.
- CI workflow `.github/workflows/foundation.yml` runs clean install, local checks, browser verification and artifact upload. The workflow has been authored; no hosted CI run is claimed.

Independent diff review identified OAuth cleanup/binding/script-injection and unproven process-cleanup issues. Regression fixes and targeted tests were added before recording these results.

Not run: original `tests/e2e.mjs` / `tests/voice-call.mjs` against real Hermes/Orgo/xAI/Composio, paid billing, cloud provisioning/teardown, hosted isolation/load/restore tests, independent OTS evidence, or security assessments. A local gateway fixture is not live Hermes acceptance. No build image, remote PR, deployment region, commercial charges or external security test is claimed.

## Next implementation dependencies

1. Continue async PostgreSQL repositories for sessions, conversation history, tasks/approvals and runtime records, then authenticated API cutover. Direct database/repository two-tenant denial is tested; public multi-tenant API denial and complete account-data import/restore remain pending.
2. Implement scoped provider connections, registry contracts and worker-boundary policy/budget enforcement; replace shared-runtime authority before enabling hosted accounts.
3. Implement and verify authorized Hermes pairing against the pinned real runtime, then complete computer/voice/connector conformance.
4. Continue the audited SID/role/security/media/lab adapters in the blueprint's order. Parallax demo credit/mock/alternate-reasoning paths must not be copied into production; Cloud Attack Range needs durable expiry/verified teardown, not only expiration metadata.

## Storage continuation — 2026-11-16

[Storage operator guide](storage-foundation.md) documents the implemented commands and current limits. SQLite schema setup is centralized in six atomic, checksummed migrations, with legacy data/default/index/FK verification. Owner policy remains separate from schema creation. Applied migration drift or failed batches stop without rewriting existing rows.

The PostgreSQL metadata domain now has organizations, scoped memberships/workspaces/agents, composite tenant FKs and import receipts. Repository calls use a direct application login, explicit active actor scope, transaction-local settings and cleared pooled context. Tests exercise viewer/suspended/cross-tenant denial, matching IDs across organizations, privilege drift, rollback, lock timeout and concurrent migration runners. The metadata repository is not wired to public authentication or agent execution; existing SQLite authority remains active.

The CLI can migrate/status/grant an existing restricted application role, inspect a stopped rollback-journal SQLite backup, and dry-run or explicitly apply inactive metadata staging. It requires one source user, records excluded/unmapped counts and logical source digests, omits sessions/instructions/provider/runtime fields, rejects collisions and verifies real rows on repeat imports. This is not a full account migration or permission to start imported agents. WAL-mode headers and any journal/WAL/SHM sidecars are rejected before SQLite opens, avoiding reader changes to live shared-memory files.

Review fixes include effective pg URL target validation (query parameters cannot override a loopback host or generated test database), WAL source rejection, inherited CREATEDB rejection, and migration transaction-control lint with PostgreSQL dollar-quote/Unicode/comment handling. Migration SQL remains trusted source code; lint is not an untrusted-SQL sandbox.

The pinned PostgreSQL test job has been added to CI and its YAML parsed locally. No hosted CI, production database migration, application storage cutover, cloud provisioning or customer resource action is claimed.
