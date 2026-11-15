# Candidate source inventory — 2026-11-15

Blueprint requirements: WP-01, WP-06, WP-07, WP-13–WP-21 and 34.A source/rights gates. This is a **static source inspection** of shallow checkouts in `/workspace/upstreams`, outside the application. No candidate repository code, installer, test, cloud command or dependency lifecycle hook was executed. None of these modules has been integrated or enabled. Build, runtime, live-provider and security claims remain unverified.

Exact commits and SHA-256 digests of the observed top-level license files are recorded in [source-pins.json](source-pins.json). These pins are candidates for integration review, not signed release provenance.

| Source | Inspected commit | Top-level license | Concrete source scope |
| --- | --- | --- | --- |
| `nickvasilescu/parallax` | `f1bad631c83ba528216466c551a0a42e816cb9a2` | MIT, Nick Vasilescu 2026 | Next.js 16.4.6 / React 19.3.0 application; Node built-in SQLite; studios, media worker, Treg gateway, independent credits/account state and agent engine |
| `bugbasesecurity/cloud-attack-range` | `2542e81d8c0a14cea44c918ce4c28354792a4763` | Apache-2.0 | Python entrypoint and lifecycle tools, Terraform labs, provider bootstraps, Kubernetes chart, benchmark schema |
| `cryptonomicsed-byte/sid` | `756d8d8ecb36c359ee1ebfe9bd7772a42ec37418` | MIT, card-protocol contributors 2026 | Draft `sid/0.1` schema/spec; TypeScript canonicalization, hash chain, Markdown parser/emitter and unsigned birth-event formatter |
| `msitarzewski/agency-agents` | `8ae6164602c95ca78828b148b9052460ee426885` | MIT, AgentLand Contributors 2025 | Markdown specialist definitions, divisions/tools metadata and installation/conversion scripts; upstream role catalog, not the owner's custom fork |
| `bugbasesecurity/pentest-copilot` | `cd512edd037a32ddb1df3caf2672915bd555daec` | MIT, BugBase Pte Ltd 2025 | Node/Express backend, MongoDB, Redis, Next.js frontend, stateless MCP transport, interactive shell/browser/proxy/C2/VPN adapters |

## Parallax: useful media implementation, incompatible defaults

Inspected `package.json`, `LICENSE`, `src/server/treg.ts`, `src/server/super/config.ts`, `src/app/api/wallet/topup/route.ts`, and the server/component tree.

- `tregMode()` returns `mock` without a token and can be explicitly forced to mock. `src/server/mock.ts` is a built-in sample provider. Importing its advertised studio/model UI unchanged would breach this platform's production no-stub contract.
- `serviceMode()` independently returns mock for missing LLM/computer/connector keys. `hermesEngine()` returns `null` on incomplete Hermes settings and reports that it is using the built-in engine. This fallback conflicts with Hermes being the platform's reasoning authority.
- The top-up route grants credits without a processor unless `PARALLAX_DEMO_BILLING=off`; this is explicit source behavior, not a payment integration. Keep platform billing authoritative and do not reuse demo grants.
- Useful review targets: `src/server/worker.ts`, `src/server/cinema/`, `src/server/media.ts`, `src/registry/`, and `src/server/developer/`. The Treg adapter exposes cost/idempotency/customer hints, but vendor terms, model/asset rights and actual quote/usage correctness still require live verification.
- Its Next/React stack differs from the Bot HQ compatibility UI. Prefer a narrow media-job/provider adapter over copying the whole UI, account system, database or second agent loop. Exclude preview/sample/guest-demo surfaces from paid scope.

## Cloud Attack Range: lifecycle code is present; expiration is not automatic teardown

Inspected `cloudrange.py`, `tools/rangectl.py`, `tools/setup_wizard.py`, `tools/setup_manifest.py`, `tools/provider_config.py`, root `LICENSE`, `benchmark/schema.json`, and lab/chart paths.

- Python 3.11+, Terraform 1.8+, and AWS/Azure/GCP operator CLIs are documented prerequisites. Setup/deploy create real deliberately vulnerable cloud resources and bootstrap identities.
- The entrypoint routes explicit setup/plan/deploy/status/teardown/verify-clean commands. `expires_at` is recorded in configuration/tags and setup displays planned teardown as **manual**. No background cleanup guarantee was established. The platform must implement its own durable expiry/reaper, quotas and cost reservation.
- `verify_clean()` validates receipt/manifest binding, independently checks provider inventories and bootstrap absence, and records residuals. This is a useful teardown verification boundary; no cloud cleanup was exercised in this inspection.
- Keep Terraform state and operator/bootstrap credentials outside the lab and any evaluated agent's scope. Published attack solutions must be separated from benchmark agent inputs. No claim is made that the catalog's advertised counts or every scenario function were independently verified.
- Integrate as a dedicated disposable-lab worker with reviewed plan approval and post-teardown inventory checks; do not expose its setup/deploy CLI as a general agent shell command.

## SID: preserve canonical bytes; hashing is not issuer authorization

Inspected `schema/sid.schema.json`, `spec/sid-0.1.md`, `implementations/typescript/src/canonical.ts`, `src/sid.ts`, `src/tests/sid.test.ts`, and fixture paths.

- `canonicalJson()` sorts keys, prunes empty object/array values, and implements Python-style ASCII string escaping; `canonicalHash()` excludes `hash` and `_`-prefixed fields. These are historical compatibility inputs. Do not rename legacy fields or normalize historical diacritics during rebranding.
- `verifySid()` checks hashes, version links when a previous certificate is supplied, identity/lifecycle constraints and timestamp **metadata** constraints. Presence of an OTS proof/status is not independent proof verification; the implementation inspected does not establish trust merely because `time.anchored` validates structurally.
- `birthEvent()` explicitly produces an **unsigned** Nostr event. Issuer signing, key custody, authorization, revocation, tenant ownership and an independent proof verifier still belong to platform integration work.
- First integration step: freeze upstream fixtures, add cross-language canonicalization/migration vectors, and keep SID identity separate from execution permissions and the policy grant system. No SID test was run in this source-only task.

## Agency Agents: import content, not installer authority

Inspected `LICENSE`, `divisions.json`, `tools.json`, `engineering/engineering-frontend-developer.md`, `scripts/` and `integrations/hermes/README.md`.

- Role files contain frontmatter metadata and Markdown instructions/examples. They are template content, not independently provisioned running agents or evidence of validated expertise.
- The Hermes integration README describes a generated lazy router and states that installation writes under the user's Hermes plugin directory and enables it in Hermes configuration. No such installation was run. A platform importer must not mutate the externally owned primary Hermes configuration without the specified consent flow.
- Treat role bodies as untrusted content: validate size/frontmatter, retain exact source commit/path/license, calculate deterministic template versions, and apply capability policy separately. Do not execute scripts or grant permissions from role prose.
- This clone is the public upstream only. It does not verify the owner's unspecified Agency Agents fork or its fork diff/publisher rights.

## Pentest Copilot: adapt the restricted service surface

Inspected root `LICENSE`, backend/frontend `package.json`, `docker-compose.yml`, `backend/src/routes/mcp-http.routes.ts`, `services/mcp-auth.service.ts`, and `services/mcp-tools.service.ts`.

- Root license is MIT while backend package metadata says `ISC`; record and resolve the metadata discrepancy before redistribution. Third-party tool/model/container licenses remain separate audit work.
- MCP HTTP transport authenticates via per-user bearer tokens and constructs a per-user server. The token model inspected stores the raw token in user configuration with revocation/last-used fields; it does not define the platform's tenant/engagement/capability-scoped grants.
- The common MCP registration wrapper records activity. The exposed surface includes `platform_setup`, `platform_repair`, `shell_exec`, `shell_session`, `burp`, `caido`, `mythic`, `browser_run`, `vpn_manage`, findings and artifact operations. This is broader than a read-only findings connector.
- Compose binds service ports to loopback, persists backend workspaces, and gives the backend `NET_ADMIN` for local OpenVPN. Local work hosts execute in the backend runtime. That deployment is not a tenant-isolated SaaS sandbox boundary.
- Begin with a read-only status/findings adapter. Add active tools only behind target ownership, explicit engagement scope, capability authorization, budget limits and isolated per-engagement runtime. Keep this service's account/model/payment state subordinate to platform ownership and Hermes reasoning.

## Remaining source and commercial gates

- The OKF source archive mentioned in the blueprint is not present in the supplied workspace. The embedded audit is a reference, not substitute source verification.
- The owner's custom Agency Agents fork URL/access and exact diff remain absent.
- PayloadsAllTheThings fork diff, Hermes SDK/runtime behavior, voice model assets, CUA/AgentDesk commercial boundaries and all transitive dependencies require their own pinned source/rights audits. No clean bill of health is implied by the top-level licenses above.
- No repository's README screenshots, test counts, hosted marketing, or feature assertions were counted as a passed platform acceptance test. Preserve notices when any reusable source is eventually adapted or vendored.
