# Universal Agent Platform

An implementation of the [Master Blueprint v2](docs/implementation/master-blueprint-v2.md), based on Bot HQ commit `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`. Development is in progress. The commercial SaaS, billing, marketplace, security, simulation and creative modules are not released.

This checkout currently supports the upstream **single-owner self-hosted architecture**. It shares the owner's computer and operating-system identity; agent screens are not security sandboxes. Hosted multi-tenant operation remains blocked until the data, credential and runtime isolation gates pass.

The [storage operator guide](docs/implementation/storage-foundation.md) documents versioned SQLite upgrades, PostgreSQL tenant metadata, and the staged import tools. PostgreSQL has not replaced the running application database.

See [implementation evidence](docs/implementation/STATUS.md), [tenant audit](docs/implementation/tenant-audit.md), and [candidate source review](docs/implementation/source-inventory.md) for what has actually been inspected and tested.

## Local setup

Requirements: Node.js 22 or newer, npm, and an operational Hermes API gateway for agent reasoning. Building and starting the UI/API does not require paid provider keys. Actual agent turns require the owner's working Hermes model; desktops, connected apps and voice require their configured providers.

```sh
npm ci
cp .env.example .env
```

Edit `.env`: replace `SESSION_SECRET` with a securely generated value, set `HERMES_URL` and `HERMES_HOME_PRIMARY` to your existing gateway, and keep `DEV_LOGIN=0`. Optional Orgo, Composio and xAI keys can remain empty. Keys support `<NAME>_FILE` paths; explicitly configured missing or empty secret files fail startup.

```sh
npm run build
npm start
```

For the built UI, set `APP_URL=http://localhost:8787` and open that address. For UI development use `npm run dev` with `APP_URL=http://localhost:5173`. The Vite API proxy defaults to port 8787; override with `UAP_API` if needed. Keep the development server private.

On the server machine, create the first owner's single-use sign-in link:

```sh
node --env-file=.env scripts/sign-in-link.mjs owner@example.com
```

Open the printed link within 15 minutes. Anyone holding it can sign in once, so treat it as a credential. The command sends the setup proof only to the local server. Google sign-in requires Composio and one configured `ALLOWED_EMAILS` owner address for first enrollment. Further sign-ins must match the persisted owner. Development email sign-in is available only when explicitly enabled and does not verify email ownership.

## Provider behavior

- Hermes remains the reasoning authority. The Engine panel reports the gateway-configured default; change provider/model in Hermes and refresh. Historical SQLite model/provider hints are retained but no longer override turns or masquerade as gateway state. Gateway model mutation is unsupported, and its legacy PATCH endpoint returns an explicit 409. This release does not implement remote pairing or tenant-isolated managed hosting.
- Orgo requires `ORGO_API_KEY` and `ORGO_COMPUTER_ID` for its desktop adapter. `HQ_LOCAL=1` is the existing trusted host mode; it is not the planned isolated `local-linux` provider.
- Composio is optional for app connections and Google login. The platform's own MCP tools can be discovered without it.
- xAI is optional for research and voice. Unconfigured controls are disabled or absent; failed provider operations return errors, never fabricated success.
- Managed agents have separate Hermes homes. Copying primary model configuration, credentials or subscription auth into those homes requires explicit operator opt-in with `HERMES_INHERIT_PRIMARY_CREDENTIALS=1`. Configure credentials in each managed home instead when this is off. Existing private managed credentials are retained. No remote-provider fallback is added by this platform.
- `/api/health` reports API liveness and `unconfigured` / `configured_unverified` credential status. It does not prove Hermes/model health or provider credential validity.

## Upgrade and data safety

Stop the server and any managed gateways before taking a consistent backup. Retain the database, its WAL state where applicable, the `data/engines` directory, and operator configuration using access-controlled storage. Verify restoration in a separate installation before upgrading a live one.

Fresh installations default to `data/platform.db`. If only `data/grokbot.db` exists, it remains selected automatically unless `DB_PATH` is explicit; if both names exist, startup requires an explicit `DB_PATH`; the upgrade does not rename it or discard history. Legacy filesystem paths, cookies and environment aliases remain where needed for compatibility. Original browser preferences migrate to `uap.*` without deleting historical keys.

One legacy account retains its stable owner and agent IDs. A database containing multiple users or ambiguous primary bindings stops startup with a repair message. No account is selected or deleted automatically. Back up and separate legacy accounts into isolated installations before running this version. There is no automated multi-account exporter yet.

The owner/primary binding is transactional. Deleting the primary bot leaves the external gateway binding reserved; the next bot cannot silently adopt it. Recovering a deleted primary binding currently requires an offline reviewed repair; it is not a self-service re-pairing feature. This app never automatically restarts or deletes the external primary gateway. Managed-home paths must remain outside the primary home; symlink escapes are rejected. Process shutdown requires Linux `/proc` evidence that a process belongs to the managed home.

Restore the pre-upgrade database and matching source version for rollback. Do not delete binding records or point multiple installations at the same database/computer. These controls reduce current exposure; they do not complete the PostgreSQL migration or hosted isolation requirements.

## Verification

```sh
npm run check
```

This runs TypeScript checks, isolated contract/integration tests, the production build and branding hygiene audit. Tests use temporary databases and identified test fixtures. Existing `tests/e2e.mjs` and `tests/voice-call.mjs` require real Hermes/Orgo/xAI/Composio services and can create resources. They are separate release gates; passing local checks does not imply they passed.

The PostgreSQL checks run separately against real PostgreSQL, with a new database and unprivileged application login for each test file:

```sh
npm run test:postgres
```

By default the runner starts and removes a pinned local Docker PostgreSQL container. A local `TEST_POSTGRES_ADMIN_URL` can target an existing test server instead; only generated test databases/roles are created and removed. The URL is checked against pg's effective connection target so query parameters cannot redirect tests or override the generated database/identity.

Original geometric avatars and a neutral theme replace the upstream excluded artwork. [Third-party notices](THIRD_PARTY_NOTICES.md) retain source attribution. `audit:branding` detects excluded upstream asset hashes and stale bundled asset references; it does not establish trademark clearance or legal approval.

Upstream code remains attributed under [LICENSE](LICENSE). This project is independent of xAI, Cursor/Anysphere, Nous Research and the referenced service providers.
