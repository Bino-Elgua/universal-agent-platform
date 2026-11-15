# WP-03 source audit: tenant authority and PostgreSQL migration

Observed 2026-11-15 at Bot HQ input `decf9a215cddd8792a5f20f4a11a87d4dffa6d15` plus in-workspace optional-provider startup changes. This audit is source inspection, not a passing isolation test or implementation of WP-03.

## Release conclusion

The current runtime is a single installation sharing one Hermes primary agent, host identity, and Orgo computer. Per-user API filters are useful but do not establish tenant runtime isolation. Merely moving its existing tables to PostgreSQL would leave the critical cross-user provider/secret/runtime paths intact. Hosted multi-tenant operation must remain unavailable until those paths are replaced.

## Prioritized findings

| Priority | Evidence | Consequence | Required change |
| --- | --- | --- | --- |
| P0 | `server/src/engine.ts:89` assigns the global primary gateway to whichever bot is first; `primaryBotId` is global (`:62`). | First account can inherit the installation owner's existing primary agent; deleting its binding allows a later bot to claim it. No pairing/ownership evidence is recorded. | Explicit owner-authorized connection binding, unique connection ownership and revocation. Preserve historical ownership after bot deletion. |
| P0 | `server/src/engine.ts:173` copies primary provider config; `:192` copies primary `auth.json`; `:199` reads primary dotenv and copies provider API keys into every managed home's dotenv. | A second account's managed runtime receives installation-wide credentials or subscription authentication. Filesystem separation does not establish credential tenancy. | No implicit credential inheritance across users/tenants. Record explicit scoped credential grants; enable a self-hosted owner opt-in separately from hosted credentials. |
| P0 | `server/src/computer.ts:21` and `:48` use the global Orgo computer ID regardless of user; `server/src/box.ts` runs arbitrary commands/files with the server OS user when local. | Different account screens share files, OS identity and machine credentials. API filtering cannot contain a shell or browser session on the shared host. | Tenant/agent sandbox runtime records and boundary authorization; VM-grade isolation for hosted untrusted code, scoped runtime admin operations. |
| P0 | `server/src/routes.ts:53` allows arbitrary new accounts unless an optional email allowlist is configured; first user creation immediately creates/provisions a bot (`:58`). | Open account creation reaches the global Hermes and credential/runtime paths. User insert and bot creation are not atomic: capacity failure can leave an account without its initial bot. | Explicit single-owner self-hosted mode until hosted isolation exists. Transactionally create account/binding/profile; perform external provisioning only after commit. |
| P1 | `server/src/db.ts` has users and bots.user_id, but no organizations, memberships or workspaces. Child objects generally have a bot FK only. `screens` has no bot/user FK (`:38`). | Database cannot reject inconsistent tenant ownership; Teams/RBAC lacks a data authority. | Explicit tenant keys and composite FKs for agents and children; membership role/state constraints; immutable audit trail. |
| P1 | `server/src/routes.ts:36` counts agents across all accounts; `server/src/computer.ts` caches computer health/leasing globally. | One account consumes capacity or affects runtime state used by another. | Per-tenant entitlements/quotas plus separately scoped runtime caches and locks. |
| P1 | `server/src/engine.ts:58` derives stable MCP bearer tokens from a global session secret. | Tokens do not carry a grant version, expiry, tenant or independently revocable connection scope. | Short-lived grant-bound tokens checked against persistent capability scope and revocation. |
| P1 | `server/src/routes-config.ts:131` writes provider/model shadow values into SQLite; engineInfo prefers them over gateway state (`engine.ts:510`). | UI can report selected models not confirmed by Hermes. | Gateway-authorized model updates with verified response or honest “change in Hermes”; keep identity stable. |
| P1 | Schema is mutated at import time in db.ts, db-config.ts, agent/rooms.ts, agent/subagents.ts, proactive.ts and triggers.ts. | No migration ledger/checksum, consistent transaction boundary or tested reverse path. Some ALTER errors are swallowed broadly. | Versioned migrations with lock/checksum and explicit upgrade/restore procedure. |

Existing positive controls: session-required bot routes generally apply `ownBot(user.id, objectId)`; room membership UI filters member IDs by user; VNC resolves bot ID with user_id before connecting. These do not compensate for shared host execution or credential inheritance. No obvious generic bot-ID-only HTTP access is asserted by this audit.

## Smallest safe implementation slice

1. Preserve the existing SQLite installation as explicitly single-owner self-hosted mode. Add an installation-owner record bound transactionally during approved setup/first login. Reject other account identities before new user or bot writes; fail startup on an existing multi-user DB with a clear repair path rather than guessing the owner.
2. Bind the installation primary connection to that owner independently of bot lifecycle. Bot deletion must not transfer primary gateway ownership. Reject ambiguous legacy primary bindings. Never reset, restart or reconfigure the existing Hermes primary automatically.
3. Require explicit owner opt-in before copying primary credential/auth files to a managed agent. Default to isolated new credentials; return a meaningful setup-required state.
4. Add adversarial tests: second account denied with zero user/bot/engine/file changes; owner restart retains binding; deletion does not transfer primary authority; failed bootstrap rolls back; credential inheritance disabled by default; unowned memory/config/model operations denied.
5. Continue PostgreSQL development behind an unavailable hosted-mode gate. Steps 1–4 reduce immediate exposure but do not satisfy tenant isolation or complete WP-03.

## PostgreSQL implementation path

The source currently has approximately 172 direct synchronous db.prepare call sites. `better-sqlite3` is synchronous; replacing it with an asynchronous PostgreSQL driver requires repository/API call-path changes, not a URL switch or SQL adapter shim.

- Introduce an asynchronous repository boundary by domain: identity/session → organizations/workspaces → agents/history → tasks/approvals → providers/runtime → billing/audit.
- Separate global identities from tenant membership. Use stable IDs and tenant-scoped uniqueness. For tenant-owned objects include org_id/workspace_id and composite FKs that prevent cross-tenant links even under a query bug.
- PostgreSQL application role must not own tables or possess BYPASSRLS. Use transaction-local tenant context with RLS and explicit worker tenant scopes; never session-global tenant context on a shared pool. Enforce ownership through the repository and database.
- Reserve unique agent engine ports/runtime connections within transactions; remove process-local assignment as authority. Persist task execution state, approvals and idempotency keys before external work.
- Export SQLite through a deterministic migration tool into a staging schema. Validate foreign keys, row counts, tenant assignment and digests before cutover. Preserve original SQLite bytes and record import provenance. Do not silently merge multiple existing user identities into a tenant.
- Rehearse clean install, legacy upgrade, interrupted import, repeated import, restore/rollback, two-tenant API denial, direct SQL RLS denial, worker restart and connection-pool tenant reuse.
- Record PostgreSQL live evidence only after an actual database run. SQL text or mocked repository tests do not count as migration/isolation acceptance.

The current source remains incomplete for SaaS account sharing, team roles, durable jobs, immutable audit, billing enforcement and runtime credential tenancy. These findings must remain visible in release status until verified implementations replace the corresponding paths.

## Single-owner legacy migration rules

- Empty DB: owner binding is established within the same transaction as approved first-account and initial-profile creation. A public OAuth login must not silently win ownership of an operator's installation.
- One existing user: migrate that stable user ID as the owner, retaining all agent/history IDs and the existing primary gateway configuration.
- Multiple existing users: fail closed before primary assignment/provisioning; do not select the oldest/first account automatically. Supply an offline export/review path and retain the original DB bytes.
- Persist owner binding independently of agent deletion. Existing auth sessions and existing-user sign-in paths must enforce owner equality, not merely new-account creation.
- Duplicate primary bindings or a primary binding owned by another user are ambiguous; reject startup and document repair. Do not reassign the gateway as part of migration.
- Failures between account/profile SQL writes must roll back. External provisioning runs after commit so a failed DB transaction cannot leave an engine holding inherited secrets.

Recommended executable cases include first setup; a repeated startup with the same owner; migration of a one-user legacy database; rejection of multiple-user legacy data without writes; rejection of a second login with zero user/bot/home creation; revocation of a pre-existing non-owner session; rollback when initial bot creation fails; and primary bot deletion without transferring gateway ownership.
