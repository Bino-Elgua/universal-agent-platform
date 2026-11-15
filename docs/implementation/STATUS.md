# Implementation evidence — 2026-11-15

Specification: [Master Blueprint v2](master-blueprint-v2.md). This checkout is an in-development single-owner self-hosted foundation. It is not a commercial release or a completed multi-tenant platform.

## Work packet state

| Packet | Implemented and locally verified | Remaining acceptance gates |
| --- | --- | --- |
| WP-01 | Exact Bot HQ baseline, clean installation, build/typecheck, lockfile license metadata inventory; six candidate source checkouts statically inspected and pinned | Live upstream provider E2Es, complete dependency/model/asset rights review, missing OKF source and custom Agency fork |
| WP-02 | Original geometric badges for all 25 persisted shape IDs, activity states/reduced motion, neutral theme/favicon/package identifiers, licensed Lucide glyphs; excluded artwork removed; browser preference compatibility | Final commercial brand/domain and rights clearance; avatar uploads/moderation not implemented |
| WP-03 | Transactional single-owner setup, legacy owner migration, rejection of ambiguous/multi-user legacy installs, session owner enforcement; account/profile rollback and restart tests | PostgreSQL async repositories, organizations/workspaces/RBAC/RLS, SQLite import/export, durable orchestration and tenant-isolated runtimes |
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
- `npm test`: **29 passed**, 0 failed. Includes real isolated SQLite/API/startup tests and clearly identified unit-only SDK/local gateway fixtures. No live provider credentials were used.
- `npm run build`: passed for web and server.
- `npm run audit:branding`: passed; excludes 69 upstream artifact hashes from source/public/build paths. This is distribution hygiene, not trademark/legal clearance.
- `npm run test:browser`: actual Chromium against the compiled local server, real HTTP/session/SQLite and original UI, with temporary data. Covers owner link login, provider gating, read-only Hermes display, primary protection, identity after reload, missing assets/runtime errors and a 390px viewport.
- Browser evidence is generated under `tests/out/foundation/` (ignored locally and uploaded by CI). Screenshots: `signin.png`, `owner-workspace.png`, `owner-mobile.png`; structured result: `report.json`.
- `git diff --check`: passed.
- CI workflow `.github/workflows/foundation.yml` runs clean install, local checks, browser verification and artifact upload. The workflow has been authored; no hosted CI run is claimed.

Independent diff review identified OAuth cleanup/binding/script-injection and unproven process-cleanup issues. Regression fixes and targeted tests were added before recording these results.

Not run: original `tests/e2e.mjs` / `tests/voice-call.mjs` against real Hermes/Orgo/xAI/Composio, paid billing, cloud provisioning/teardown, hosted isolation/load/restore tests, independent OTS evidence, or security assessments. A local gateway fixture is not live Hermes acceptance. No build image, remote PR, deployment region, commercial charges or external security test is claimed.

## Next implementation dependencies

1. Complete the tenant/async PostgreSQL repository migration, with actual two-tenant database/API denial tests and preserved SQLite export/import evidence.
2. Implement scoped provider connections, registry contracts and worker-boundary policy/budget enforcement; replace shared-runtime authority before enabling hosted accounts.
3. Implement and verify authorized Hermes pairing against the pinned real runtime, then complete computer/voice/connector conformance.
4. Continue the audited SID/role/security/media/lab adapters in the blueprint's order. Parallax demo credit/mock/alternate-reasoning paths must not be copied into production; Cloud Attack Range needs durable expiry/verified teardown, not only expiration metadata.
