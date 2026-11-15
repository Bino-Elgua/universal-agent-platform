# Universal AI Agent Platform — Commercial Master Build Blueprint, Revision 2

**Baseline:** `nickvasilescu/bot-hq` (main, observed commit `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`, November 11, 2026)  
**Original specification date:** November 14, 2026  
**Revision 2 date:** November 14, 2026 — expanded following Security / Simulation / Creative / SID / Agency Agents review  
**Target:** Original, commercially licensable, provider-neutral, multi-tenant, full-featured AI agent SaaS, with self-hosted mode and Free / Basic / Pro / Teams / Enterprise plans.  
**Status:** SPECIFICATION ONLY. None of the proposed refactoring, paid tiers, deployment, or end-to-end validations in this plan are claimed complete. The appended Revision 2 sections are authoritative where they supersede the original baseline.

**Revision 2 scope:** Preserve all 121 baseline checklist items and add the security, evidence, cloud laboratory, specialist workforce marketplace, SID identity, media studio, simulation, commerce and verification requirements defined below. No product features are claimed shipped solely because the referenced repositories contain code. 

**Audit header — Summary | Threat Model | Tests | Invariants | Diacritics**  
**Summary:** One agent-native commercial platform with separately owned Hermes reasoning, SID identity, role catalog, security tools, OKF evidence, controlled labs and media jobs.  
**Threat Model:** cross-tenant exposure; sandbox and lab escape; tool authorization bypass; prompt injection; cloud-cost abuse; source-asset/license violations; evidence forgery.  
**Tests:** 24 baseline end-to-end scenarios + 52 new scenarios (E2E-25…E2E-76), service contracts, tenant-isolation, billing, restore, media, lab teardown and independent receipt verification.  
**Invariants:** Hermes is the primary reasoning authority; SID never grants permissions by itself; no unverified proof is labeled verified; no paid-provider fallback without approval; no production-facing stubs.  
**Diacritics:** commercial UI and service identifiers are neutral; historical names and quoted source material retain their original spelling; no changes to legacy identity canonical bytes.

## 0. Executive directive — definition of the product

Build one complete commercial agent-operations application based on Bot HQ. Preserve its working chat, Hermes gateway, per-agent model selection, tool execution via MCP, tasks, routines, team messaging, memory display, computer viewing, app connectors and voice. Remove all Grok-derived protected images, product identifiers, animations and branding, replacing them with commercially owned original assets. Add a universal registry so every agent can select permitted computer, voice, tool and storage providers independently, while **Hermes remains the authority for reasoning and its configured model**. Add customer accounts, organizations, plans, billing, usage metering, provider credentials, audit, secure runtime isolation, production hosting, installation and support.

**No-stub contract:** A feature is either (A) complete, tested, documented and enabled or (B) not advertised or selectable. No mock data in production, no TODO controllers, no dummy backend functions, no fake payment results, no cosmetic-only dashboards, no "coming soon" buttons for promised launch scope, no silent provider fallbacks to paid services, and no untested security assurances. Unit tests may mock dependencies; release tests must use real services or a fully identified self-hosted equivalent.

**Five plans:** Free / Basic / Pro / Teams / Enterprise. Prices and allowances below are **planning hypotheses** requiring margin testing, not existing product prices or commercial commitments.

## 1. Verified upstream inventory, retain/replace/add

### Retain and improve (real features in upstream)
- Hermes primary gateway attachment, plus independently managed Hermes homes/gateways for additional agents; do not overwrite the customer's primary Hermes configuration without affirmative consent.
- `POST /v1/responses`-based streaming turns through Hermes, per-bot queue, response/activity transcript rows and SSE.
- Bot profiles, roles, skills, memory files and per-bot model/provider settings in the Engine panel.
- Bot-to-bot messaging, group chats, Hermes delegation, routines, task records, proactive check-ins and Library.
- Per-bot MCP tools and Composio catalog, OAuth flow, connected apps, approval cards and event triggers.
- Desktop viewer watch/control UX, screen control concepts, browser profiles and task activity visualization.
- xAI voice and X search as **optional** paid providers, not mandatory environmental dependencies.
- Orgo as an **optional** hosted computer provider, not mandatory environmental dependency.

### Replace or refactor
- Replace hard requirement for `XAI_API_KEY`, `ORGO_API_KEY`, `ORGO_COMPUTER_ID` and `COMPOSIO_API_KEY` at API boot with provider-conditional validation and fail-safe health indicators. A local setup with zero third-party paid keys must boot, but the user's Hermes must have an operational model or local model; hosted Composio is optional when only MCP is used.
- Replace `MAX_SCREENS=4` as universal limit: it is Orgo-specific, not a platform-wide agent-count rule.
- Replace `HQ_LOCAL`/`ORGO_COMPUTER_ID` branching with a `ComputerProvider` registry and per-agent sandbox records.
- Replace direct per-bot Chrome DevTools port assumptions (`9200+display`) with isolated endpoint discovery and scoped capability tokens.
- Replace the xAI-specific `/voice/session` workflow with a provider-neutral voice session service. Keep the xAI adapter operational.
- Replace only name-based internal identification with stable tenant-scoped IDs and verifiable Hermes instance binding.
- Replace fragile process-local queues/schedules with durable, restart-safe jobs and explicit task states.
- Replace SQLite-as-SaaS-authority with PostgreSQL, migrations, tenant constraints, and durable event records; preserve a SQLite option only for self-hosted single-user mode if fully supported and tested.
- Replace Grok-era artwork, `grokbot` names, package identifiers, database filenames, favicon, landing page visuals, CSS-derived branding and other unlicensed artifacts.
- Replace built-in permissive browser/shell approval with execution-boundary authorization; no model prompt can bypass approval.
- Replace single-server installer assumptions (`/opt/hq`, root/supervisor, Orgo URL) with local, Docker and managed cloud installers.

### Add
- Organization accounts, teams, RBAC, SSO options, signup, verified email, invitations, account recovery, deletion and export.
- Payment provider, subscriptions, five plan entitlements, prepaid usage credits, metering, budget enforcement, invoices and tax workflows.
- Secure hosted sandbox lifecycle, snapshot/restore where supported, quotas, file storage, sandbox cleanup, egress restrictions.
- Hermes external-connection/pairing agent, secure outbound tunnel or explicitly reachable gateway and connection status, reconnect, ownership checks.
- Local voice pipeline, vendor voice adapters, supported voice catalog, selection, interruption, transcripts and audio permissions.
- Original avatar/pet engine with owned 2D assets, optional 3D support, states and accessibility.
- Admin/operator dashboard, provider health dashboard, incident and customer support workflows, security logs and abuse protections.
- Public product website, pricing, usage guide, documentation, terms, privacy policy, licensed attribution, and support contact.

## 2. Product invariants (cannot be violated)

1. Each agent has one stable agent ID, tenant/workspace ownership, capability scope and configuration version independent of its LLM, voice, or desktop provider.
2. Hermes runs reasoning. The active provider/model is read from the actual Hermes gateway and changing it must not erase the agent's task history or identity. A user may choose another Hermes model in the Engine UI through authorized gateway configuration, with model metadata validated against Hermes.
3. An externally owned Hermes primary agent is NEVER reset/restarted, mutated, or deleted automatically by our app. Explicit permission is required for optional configuration changes and MCP registration.
4. Every external tool and sandbox command is authorized by tenant identity, actor identity, tool capability, object scope, risk policy, credit balance and explicit approval where required. The model's prose is not an authorization layer.
5. Per-tenant credentials are encrypted and scoped. They cannot appear in prompts, streamed UI events, downloadable artifacts or another tenant's logs.
6. All paid actions are preauthorized against a spending ledger and server-side budget; no automatic free-to-paid fallback.
7. Separate agents' virtual desktops cannot read each other's files or credentials; screen separation alone is not isolation.
8. Disabled/uninstalled providers disappear from selectable configuration or show honest unavailability with recovery instructions. Features are never advertised without a working adapter.
9. The free tier cannot run an unmetered company-funded machine, GPU speech model, phone call or cloud LLM.
10. Pricing entitlements are decided on the server, not by React UI flags, and enforced at the worker/provider boundary.
11. Every result is traceable to a task, provider, input authorizations, events, measurements, artifact IDs and error logs.
12. Human can interrupt, revoke permissions, stop the desktop, and disconnect connected apps at any time.
13. Data export and deletion cover application DB, remote sandboxes, object storage, external connection references, logs (subject to legal retention), and account tokens.
14. A release cannot deploy to production unless the complete live-workflow acceptance suite passes.

## 3. Provider catalog / plans

### 3.1 Reasoning (Hermes-owned)
- **Built-in behavior:** The app connects to the customer's Hermes gateway; it reads selected model, provider, capabilities, active status and current token/cost metrics if Hermes supplies them. It does not hardcode DeepSeek or xAI.
- **External:** Customer connects an already-running Hermes via a dedicated connector or secure reachable gateway, performs one-time pairing, registers the agent, and optionally grants MCP tools. Enforce gateway TLS, endpoint verification, per-workspace revocable tokens, heartbeat, reconnection and no arbitrary SSRF.
- **Managed:** App deploys fully isolated Hermes gateways for customers who explicitly choose hosted mode. Credentials stored per customer; payer is either BYOK (provider charges user) or managed credits (our bill and bill-back).
- **Model subscriptions:** Only connect consumer-provider subscriptions if their terms authorize the usage; never resell a consumer plan as our hosted API capacity.
- **Per-agent:** model configured in Hermes, personality/skills/memory in Hermes home. UI reflects actual state, not a separately invented shadow model.
- **Capabilities:** text, tools, images/vision, structured output, context length and rate limits are probed/disclosed; unsupported capabilities disable dependent UI.

### 3.2 Computer providers
- `local-linux`: self-hosted sandbox with per-agent isolation, browser, shell, file workspace, screenshot, input and viewer, no mandatory hosted provider API. Implement using commercially permissible MIT CUA SDK core/AgentDesk where viable and self-managed Linux runtime. Do **not** embed CUA Spaces or `cua-spacesd` in commercial hosting without a valid license; parts use FSL restrictions.
- `orgo`: preserve the existing hosted Orgo functionality as a paid BYOK or operator-managed provider; real screenshots, VNC, file exports, system lifecycle and teardown must work.
- `external-computer`: customer pairs an allowed remote host with a scoped agent connector and outbound secure session; never expose unrestricted RDP/VNC to the public web.
- Optional later adapters can be released after their own validation; do not list them as shipped until complete.
- **Hosted production isolation:** use per-tenant/per-agent VM-grade runtime or carefully reviewed gVisor isolation. Firecracker is Apache-2.0 but requires a suitable KVM host and a built guest image, broker, file transfer, Chrome, desktop streaming and network rules; it is not a plug-in replacement by itself. Docker desktop isolation alone is insufficient for untrusted tenant code.

### 3.3 Voice
- `local-pipeline`: Pipecat (BSD-2), Faster Whisper (MIT), Silero VAD (license check), Kokoro ONNX (model license Apache-2, asset audit); runs on customer-controlled compute for genuinely API-fee-free operation, or on metered hosted compute when we run it.
- `piper`: optional local TTS module; current Piper engine is GPL-3.0-or-later and voice models have independent rights. License review and compatible distribution architecture are release gates.
- `elevenlabs`: paid hosted STT/TTS/realtime capabilities as supported by vendor SDK; user key or prepaid hosted credits, with explicit usage estimate.
- `gemini-live`: optional native streaming voice; must delegate actionable work to Hermes rather than create an unaccountable second agent.
- `xai-realtime`: preserve Grok Voice under optional paid key and maintain voice-to-Hermes delegation.
- Other voice providers only after adapter conformance tests. Speech-only vs speech-to-speech capabilities must be explicit.
- Voice-session features: device permissions, language/voice selection, VAD, interruption/barge-in, network recovery, text transcript, mic mute, session cancellation, opt-in recording, bounded context, usage accounting, provider errors and truthful fallback to text.

### 3.4 Connected services
- Composio: keep existing integration; production should support organization-owned OAuth clients and separate customer credentials/Composio projects as appropriate. Composio Hobby free quota is **project/account-level, not per platform customer**. Its current published cap is 100k tool calls/month, with 20k managed-app subset and separate triggers; do not promise those quotas to each subscriber. Enable usage tracking and fallback to self-managed MCP/direct integrations.
- MCP: generic verified MCP servers, scoped transport and tool catalogs, allowlists, OAuth/token auth, approval boundaries; never let a remote server arbitrarily return executable instructions into the host shell.
- Future direct adapters: implement only as actual provider packages with health, auth, error handling and test suite.

### 3.5 Storage
- Self-host: explicitly supported local DB + local encrypted disk or object store.
- SaaS: PostgreSQL for identities, entitlements, agent records, tasks, audit and ledger; Redis for coordination/cache if needed; S3-compatible object storage for artifacts; immutable object versioning as configured; encrypted secrets manager. Always verify backup and restore.

## 4. Universal adapter APIs (versioned contracts)

### 4.1 Common provider manifest
Every provider advertises: `id`, `category`, `display_name`, `version`, `sdk_version`, `license_status`, `deployment_modes`, `requirements`, `capabilities`, `operations`, `credential_mode`, `metering_units`, `health`, `regions`, `cost_estimate`, `status` and `configuration_schema`. A provider is marked `available` only when credentials, runtime prerequisites, capability probes and permission checks pass. Manifests are not trust authority: server verifies entitlement per request.

### 4.2 ComputerProvider contract
```
probe(config)->Capabilities
validateCredentials(tenant,config)->Result
createInstance(tenant,agent,image,limits)->Instance
start/stop/suspend/resume/delete(instance)->State
exec(instance,command,cwd,env,timeout,policyToken)->ExitResult
screenshot(instance,display)->ImageArtifact
pointer(instance,action,coordinates)->Receipt
keyboard(instance,keys,text)->Receipt
files.list/read/write/download(instance,path,scope)->Result
browser.attach(instance,profile)->BrowserEndpoint
viewer.issueSession(instance,mode,ttl)->ScopedSession
getMetrics(instance)->CpuRamDiskNetworkUsage
getHealth(instance)->Health
```
Keep `ComputerProvider` for provider-wide lifecycle, `SandboxSession` for one agent, and `ViewerProvider` for the streaming protocol. Credential use and per-tenant access checks precede every call. The runtime manager alone can obtain the host's real VM admin token.

### 4.3 VoiceProvider contract
```
capabilities()->{stt,tts,realtime,bidirectional,languages,voices,interruptions}
validateCredentials()->Result
createSession(agent,policy,creditReservation)->VoiceSession
transcribe(stream,options)->TextEvents
synthesize(text,voice,options)->AudioEvents
streamDuplex(audio,events)->Events  // only when supported
interrupt(session)->Ack
endSession(session)->UsageReceipt
estimateCost(request)->Quote
```
Voice session must map speech input to the *same* Hermes agent, authorized tasks and output stream. If using native Gemini/Grok voice conversational reasoning, it is a UI-facing conversational layer; all actions are approved/executed by Hermes and policy middleware.

### 4.4 Model/agent engine
`HermesConnection` with `pair`, `health`, `whoami`, `getModel`, `listSupportedModels`, `setModelIfAuthorized`, `startTurn`, `streamEvents`, `cancel`, `registerToolsWithConsent`, `getMemoryMetadata` and `close`; unmanaged remote gateways permit only approved operations. The app must not promise to modify every remote gateway's model if its endpoint does not expose authorized model setting; show "change in Hermes" accurately.

### 4.5 Tool adapter
`discover`, `checkAuth`, `authorize`, `listScopes`, `execute`, `subscribeTrigger`, `unsubscribe`, `audit`, `disconnect`. All tool executions pass `policyDecisionId`, tenant-scoped actor, idempotency key and metering context.

## 5. The five subscription tiers — proposed commercial packaging

All numerical allowances below are initial **hypotheses** for customer research and cost modeling. Credits are metered *retail platform usage credits*, not transferable cash or generic tokens, and do not replace external-provider fees for BYOK customers. They reset at renewal unless contract says otherwise. No overdrafts.

| Feature | Free | Basic | Pro | Teams | Enterprise |
|---|---:|---:|---:|---:|---:|
| Indicative price | $0 | $29/mo | $79/mo | $199/mo | Custom |
| Users/seats | 1 | 1 | 1 | 5 included | Contract |
| Registered agents | 1 | 2 | 5 | 15 | Contract |
| Concurrent active runs | 1 | 1 | 3 | 5 | Contract |
| Included managed usage credits | $0 | $5 | $20 | $50 | Contract |
| Customer's Hermes & local model | Yes | Yes | Yes | Yes | Yes |
| Customer-hosted agent desktop | Yes | Yes | Yes | Yes | Yes |
| Managed cloud computer | BYOK or separate prepaid | Covered by credits / BYOK | Credits / BYOK | Credits / BYOK | Reserved or metered |
| Local voice on customer's device | Yes | Yes | Yes | Yes | Yes |
| Managed premium speech | BYOK only | Credits/BYOK | Credits/BYOK | Credits/BYOK | Custom |
| Composio / MCP | Own credentials or small shared budget | Own credentials + optional pooled | Own credentials + optional pooled | Org integrations | Managed contract |
| Team workspaces | No | No | No | Yes | Yes |
| SSO / SCIM | No | No | No | Optional add-on | Contract |
| Dedicated runtime/region | No | No | Optional add-on | Optional add-on | Yes |
| SLA/priority support | Community | Standard | Priority | Business | Contracted |

### Free-tier economics (mandatory)
- Free is **bring-your-own Hermes** and **bring-your-own hardware** first, not unlimited company-hosted compute.
- Users may run Pipecat/Kokoro locally. If hosted voice is enabled, meter and hard-cap it explicitly (no free unlimited GPU).
- Composio free Hobby project allowance belongs to **the Composio account/project**; if our company provides connections, customers share a company-funded pool with a much smaller per-account hard cap, which may be zero until economics are proven. Users may connect their own Composio project or use their own MCP server.
- No company-funded LLM API tokens on an unrestricted free plan. If promotional credits exist, set real anti-abuse verification and an expiration time.
- Free support through documentation and community channels; no guaranteed dedicated support capacity.

### Credits and charging rules
- Keep a double-entry accounting ledger separate from external provider statistics. Each task obtains a bounded reservation against the subscription's spendable credits or user's authorized top-up.
- Capture provider invoice cost and retail usage price separately, per billable minute/token/computer-hour/tool call. Include platform margin or pass-through policies transparently.
- On each action: check `plan entitlement -> credit availability -> consent -> start -> measure -> reconcile -> settle/refund reservation`. Tasks blocked by quota end with a meaningful error and upgrade/reload option.
- BYOK usage is charged directly by the customer's provider. The company cannot silently absorb or replace those costs; optionally charge a platform subscription for the software use, but do not mark BYOK tokens as included credits.
- Cloud VM utilization and streaming/storage traffic count toward real hosting expense. Meter minimum session time and cleanup on idle.
- Credit allocations, upgrades, proration, overages, payment retries, failed payments, refunds, downgrades, cancellations and chargebacks are authoritative webhook-driven state transitions.
- Users set hard budget caps, provider-specific caps and task approval thresholds; admin may impose tenant/org caps.
- On credit exhaustion, suspend paid tasks safely and preserve records; NEVER silently charge without opt-in.

### Illustrative margin discipline
For each plan, calculate `net revenue - payment fees - COGS(model + voice + compute + network + object storage + Composio + support + taxes as relevant)`. Stress test burst usage at the **maximum advertised allowances** rather than typical usage. Reprice allowances if worst-case fair-use usage produces negative contribution margin. Model credits as a financial liability until consumed/expired under applicable accounting policy; seek professional advice.

## 6. Data model & tenant ownership

Recommended entities and key fields:

- `users`: id, verified_email, auth_subject, status, MFA settings.
- `organizations`: id, slug, name, plan_subscription_id, billing_owner_id, status, region.
- `memberships`: org_id, user_id, role, joined_at, invitation_id, state.
- `workspaces`: id, org_id, name, defaults, region, retention_policy.
- `agents`: id, workspace_id, owner_id, Hermes_connection_id, profile, lifecycle, model_snapshot, avatar_id, created_at.
- `hermes_connections`: id, owner_scope, endpoint_mode, auth_ref, pairing_state, last_heartbeat, capabilities, configuration_version.
- `provider_catalog`: provider_id, version, category, license_gate, manifest_hash, availability.
- `provider_connections`: id, org_id, user_id, provider_id, credential_secret_ref, auth_scopes, health_state, region, revoked_at.
- `agent_provider_assignments`: agent_id, capability, provider_connection_id, config_version, changed_by, changed_at.
- `sandboxes`: id, org_id, agent_id, provider, runtime_ref, isolation_class, limits, state, idle_at, destroyed_at.
- `viewer_sessions`: id, org_id, agent_id, mode, expires_at, revoked_at.
- `conversations`, `messages`, `tool_events`, `agent_runs`, `task_jobs`, `approvals`, `artifacts`, `skills`, `routines`, `schedule_events`, `audit_events`, `agent_relations`.
- `billing_customers`, `subscriptions`, `plan_versions`, `entitlements`, `credit_accounts`, `credit_ledger_entries`, `meter_events`, `usage_reservations`, `topups`, `invoices`, `payment_webhook_events`.
- `voice_sessions`: id, agent_id, provider, consent_state, transcript_ref, duration, billable_units, termination_reason.
- `avatars`, `avatar_assets`, `animation_states`, `avatar_user_preferences`, `asset_license_records`.
- `incidents`, `support_cases`, `provider_outages`, `deployment_versions`, `security_events`.

All tenant-owned rows have foreign keys, tenant-scoped uniqueness, database row-level controls where appropriate, and no authorization based solely on a user-supplied ID. Internal agent and cloud VM identities are distinct. External URLs/credentials have allowlists to prevent SSRF. Use transactions for billing and critical task state changes. Migration is versioned and reversible; audit events are append-only with retention rules.

## 7. Polyglot service responsibilities (TS is UI, not the execution authority)

Use the smallest operational number of services while preserving clear language boundaries. No language is introduced solely for symbolism: each service has a concrete API and test suite.

- **Rust — secure execution kernel:** capability tokens, sandbox permissions, command broker, policy enforcement at tool boundary, execution receipts, resource limits and archive validation.
- **Julia — numerical/memory analytics:** optional scalable retrieval metrics, simulation analytics, scoring and usage forecasting; deterministic numerical tests and resource budgets. Keep this off the synchronous request path for basic chat unless necessary.
- **Elixir — task and agent orchestration:** supervised agent sessions, durable jobs using a PostgreSQL-backed scheduler, retries, concurrency, backpressure, event fan-out and saga workflows.
- **Clojure — symbolic/business rule service:** versioned policy rules, tool risk assessments, entitlement rule evaluation, governance/business logic tests. Use compiled policy snapshots so common path latency is bounded.
- **Python — voice, ML and adapters:** Pipecat, Faster Whisper, Kokoro, transcription, media preprocessing, optional ML evaluation and compatible computer SDK wrappers.
- **Go — network/stream gateway:** secure reverse pairing tunnel, HTTP/WebSocket/WebRTC signaling, desktop stream proxy, rate limiting and multiplexing where it improves system reliability.
- **Move — optional on-chain receipts/settlement plugin:** never required for conventional SaaS subscriptions, fiat billing, or free tier. If publicly offered later, deploy and fully test actual Move modules with audits. Do not ship empty on-chain functions as if implemented.
- **TypeScript — client UI plus transition adapters:** React dashboard; initially retain the Node/Hono compatibility API until capabilities are safely relocated behind production services. No large breaking rewrite in one commit.

Shared API schemas must be versioned (OpenAPI / protobuf / JSON Schema) and generated clients must have compatibility tests. Do not duplicate authorization logic in seven languages; central policy decision plus enforcement at every boundary.

## 8. Brand, avatars, commercial assets

- Choose legally screened, original company name and product name; register domain; commission an original logo, colors, typography licenses and design tokens.
- Inventory entire upstream tree for `grokbot`, Grok-inspired images and terms, brand colors, SVGs, generated shapes and assets, favicons, package names, DB strings, setup scripts, screenshots and fixture data.
- Rewrite copy and navigation to our own identity. Preserve LICENSE + copyright notices and necessary third-party notices, but do not display upstream trademarks as our product name.
- Create first-party avatar/pet system: sprite or vector manifest, animated states (`idle`, `listening`, `thinking`, `speaking`, `working`, `success`, `error`, `sleep`), input event mapping, asset versioning, user selection and upload moderation, accessibility/reduced motion, fallback when WebGL unsupported.
- Avatars are visual identities only; agent reasoning/voice/computer provider remains independent. Lip-sync when audio provides amplitude/phoneme timing, otherwise simple sound-reactive animation that is labeled accurately.
- Include attributions for legitimately used logos; avoid implying endorsement or affiliation by provider logos.
- Ensure uploaded user artwork licenses, moderation and deletion policy are documented.
- Paid voice cloning, if ever offered, must require explicit subject consent and verifiable authorization; it is not a default launch feature.

## 9. UX inventory (each has real server-backed behavior)

**Public:** Landing page, features, demos from actual tested environments, pricing, legal pages, docs, support and status page.  
**Account:** Signup, email verification, sign-in, OAuth, MFA, passwordless recovery, sessions, devices, account export/delete.  
**Workspaces:** Create/join, invites, roles, agent roster, team activity, tools, files, policy settings.  
**Agents:** Create, connect external Hermes, provision managed Hermes, model view/config through Hermes, select voice/desktop, avatar, skills, memories, tasks, tools, schedules, collaboration.  
**Conversation:** Streaming, citation references, task list, tool receipts, approvals, cancel/retry, uploads, artifacts, history search/export.  
**Computers:** Start/stop/pause where supported, screenshots, live streaming, watch/control permissions, file download/upload, idle budget and auto-destroy.  
**Voice:** Mic controls, voice options, input/output subtitles, provider switch, language, live session status, interruptions, transcript download and consent.  
**Integrations:** Composio/MCP catalog, connect/disconnect, scopes, secrets, quotas, tool usage, event triggers.  
**Billing:** Plan chooser, checkout, upgrade/downgrade, credits and usage, invoices, top-ups, card changes, cancellation, tax details, prepaid cap.  
**Teams:** Member invite, RBAC and seat allocation, shared workspaces, approvals, agent ownership handoffs and org audit trail.  
**Admin:** Tenants, entitlements, provider health, abuse flags, refunds and credit adjustments with approval workflow, queue jobs, support cases, incident logs.

## 10. Operational security / threat model

Threats: malicious user prompts, prompt injection from a webpage/tool response, tenant escape from a sandbox, root shell abuse, token leakage, OAuth misbinding, arbitrary agent-to-agent messaging, SSRF, exfiltration, expense attacks, webhook replay, fraudulent free accounts, VNC hijacking, stale credentials, compromised third-party provider, human-in-the-loop bypass.

Required controls:
- Auth: OIDC/OAuth, verified email, MFA, session rotation/revocation, CSRF protections, secure SameSite cookies, HTTPS/HSTS and anti-brute-force throttling.
- Identity: every API, SSE, WS, MCP tool and WebRTC signaling request authenticates user/agent and authorizes resource tenant ownership.
- Remote Hermes pairing: challenge-response, expiring scoped token, outbound encrypted transport, bind endpoint to workspace/agent, token rotation/revocation, display owner+fingerprint.
- Secrets: cloud KMS or equivalent envelope encryption; never client-readable; rotate keys, redact logs and error messages; revoke on disconnect.
- Sandboxes: separate unprivileged OS users/VMs, read-only base images, dropped Linux capabilities, seccomp/AppArmor, constrained resource limits, isolated networks, egress allowlists and no host Docker socket mounting.
- Computer actions: allow/deny/ask review by risk category, approval receipts bound to exact action payload hash, human viewer takeover requires role and ephemeral token, no clipboard theft via watch mode.
- Files: path traversal and symlink escape prevention, malware scans, content type/size limits, signed download URLs, automatic cleanups and tenant-scoped bucket keys.
- Integrations: least-scope OAuth, action classification from verified capability metadata, not only slug names; safe execute and audit; no writable action routed via browser bypass.
- Billing: verified Stripe webhook signatures, idempotent event consumer, transactional ledger, reconcile provider invoices, protect against race-spending across concurrent jobs.
- Abuse: IP/identity limits, free-tier quota, CAPTCHA as appropriate, email domain anomaly screening, rate limiting, abuse response and suspension process.
- Corporate: privacy policy, security incident runbook, data processing agreements, retention/deletion/export, customer support contact, legal review of recordings and voice/model data use.

## 11. Reliability, telemetry and production infrastructure

- Dev uses containers and a local compose profile; staging mirrors production topology with synthetic tenants and safe test credentials.
- Production uses TLS ingress, API and gateway deployments, PostgreSQL backups and replicas where justified, queue workers, durable scheduler, sandbox manager, object store, secrets manager, metrics and log aggregation, customer-facing status service.
- Infrastructure-as-code (Terraform/OpenTofu or similar) provisions reproducible infrastructure. No root password/keys embedded in images or manifests.
- Blue/green or rolling deployments with feature flag, migration verification and rollback for both app and schema changes.
- OpenTelemetry traces connect request ID -> Hermes agent -> tool action -> desktop provider -> usage ledger -> artifact. Avoid collecting model secrets in telemetry.
- Provider-level circuit breakers, backoff/retry only for idempotent operations, dead-letter queue, worker heartbeat, orphan cleanup and tenant capacity limits.
- SLO proposals (validate with load tests): 99.9% app API monthly availability, successful task dispatch >=99%, billing ledger 100% reconciled, no known critical vulnerabilities at launch, defined incident recovery RPO <=1h/RTO <=4h. These are TARGETS, not proven guarantees.
- Scaling targets: benchmark 100 concurrent interactive sessions and planned voice/desktop concurrency at selected hardware sizes, then set published limits only after real test evidence.
- User controls: stop every agent, revoke access, download files, export data and cancel billing. Termination drains or cancels jobs and closes sandbox sessions.

## 12. Real purchase/subscription lifecycle

1. Visitor chooses Free/Basic/Pro/Teams/Enterprise; selected plan stored before redirect.
2. Auth creates a tenant account, owner membership and billing customer record.
3. Paid plan uses Stripe (or chosen processor) Checkout; never assume success from client redirect alone.
4. Signed payment webhook updates subscription through idempotent DB transaction and emits entitlement event.
5. Workspace and sandbox provisioning is initiated only after server-side entitlement is active; BYOK setup can proceed separately.
6. Metering reserves credit before each premium action and settles measured usage at end. Retry same event ID never doubles charge.
7. User sees exactly which service charged which usage, with invoices, credit balances and unit prices.
8. Downgrade creates a scheduled transition and helps delete/export extra agents or seats without silently erasing data.
9. Cancellation stops future renewals, preserves data according to published retention and stops unauthorized paid resources.
10. Admin refund/credit adjustments are audited with dual control for large amounts.

## 13. Customer onboarding flows

**Free existing Hermes:** create account -> email verification -> choose Free -> install local connector -> pair existing Hermes (read-only default) -> verify actual model -> select local sandbox -> select local voice -> configure own Composio or MCP -> run approved real task -> see its work -> save artifact -> disconnect/export.

**Basic managed:** choose plan -> verified checkout -> connect BYOK or allocate managed model credits -> managed Hermes isolated -> paid computer selection -> run task -> usage receipt -> reach quota -> correct upgrade/topup prompt.

**Pro:** configure different per-agent models, two or more simultaneous tasks, hybrid voice (local and ElevenLabs), computer choice per agent, shared task delegation.

**Teams:** invite 5 seats, role permissions, shared tools, supervisor approvals, org billing, distributed agent tasks, activity/audit export.

**Enterprise:** SSO/SAML/OIDC plus SCIM if contracted, dedicated tenant deployment, audit/data retention controls, dedicated provider credentials, org provisioning, negotiated SLA and support.

## 14. Precise source-code refactor map (upstream Bot HQ)

**Never overwrite upstream blindly; fork to our repo and pin a commit with a reproducible hash.**

- `server/src/env.ts`: make Orgo/xAI/Composio provider-conditional, add `PROVIDER_REGISTRY_PATH`, `SECRETS_PROVIDER`, `DATABASE_URL`, `STORAGE_*`, `BILLING_*`, `VOICE_SERVICE_URL`, `COMPUTER_PROVIDER_DEFAULT` and validated environment profiles; no secrets from the browser.
- `server/src/engine.ts`: retain Hermes gateway behavior; add `HermesConnection`/remote pairing, tenant-scoped managed instances and safe model change APIs; separate agent identity from one-machine paths and Chrome endpoints.
- `server/src/agent/loop.ts`: move turn queue onto durable job service, retain streaming translation, add metering/cancel/replay guarantees and reasoned task end states.
- `server/src/agent/prompt.ts`: strip old product persona, maintain tenant-safe agent instructions and original platform prompts.
- `server/src/mcp.ts`: scope MCP bearer tokens to tenant, agent, operation and expiry, policy checks on each call, versioned schemas and external connector transport; remove reliance on globally shared signing material for all agents.
- `server/src/agent/tools.ts`: retain useful task/routine/team tools, classify risk, replace direct computer execution with permissioned sandbox interfaces, make x_search optional and feature-gated.
- `server/src/computer.ts`: replace hardcoded one-Orgo-VM/four-X-screen assumption with per-agent lifecycle manager; preserve an `OrgoComputerProvider` adapter for existing customers.
- `server/src/orgo.ts`: wrap existing API under `providers/computer/orgo`, make errors/timeouts and credential scopes explicit; migrate but do not delete.
- `server/src/box.ts`, `server/src/desk.ts`, `server/box/*`: move old desktop decoration logic to a separate optional managed Linux image installer; no commands on the application host; isolate Chrome profiles/DevTools and terminal ports.
- `server/src/vnc.ts`: change Orgo-specific WebSocket URL to authorized `ViewerProvider` session; watch/control and user permission enforced server side.
- `server/src/voice.ts`, `web/src/voice/*`, `web/src/components/VoiceCallBar.tsx`, `VoiceSettings.tsx`: use provider-neutral voice session endpoint and media gateway, keep xAI, add local pipeline and premium adapters.
- `server/src/composio.ts`, `server/src/triggers.ts`: preserve Composio, add per-tenant projects/credential options, usage tracking, managed-vs-own OAuth and limit warnings; normalize generic MCP tools.
- `server/src/proactive.ts`, `server/src/routines.ts`: use durable scheduler, idempotent triggers, tenant-specific timezone handling and budget requirements.
- `server/src/db.ts`, `server/src/store.ts`, `server/src/engine-memory.ts`: migrations to SaaS DB, durable conversations/audits, Hermes-owned memory synchronization metadata, tenant isolation.
- `server/src/routes.ts`, `routes-config.ts`, `routes-rooms.ts`, `routes-proactive.ts`: introduce workspace/tenant routing, explicit role checks, versioned API and long-lived subscription state, no dev login in production.
- `server/src/lib/auth.ts`: identity provider, sessions, MFA, secure cookies and tenant-aware auth.
- `web/src/components/EngineSettings.tsx`: show Hermes reported model and compatible models, not arbitrary platform model inference.
- `web/src/components/ComputerViewer.tsx`: universal viewer session endpoints, reconnect, watch/control permission and expiry.
- `web/src/App.tsx`, `web/src/avatar/*`, `web/public/assets/*`, `web/artwork/*`, styles and assets: original brand and avatar engine, owner-friendly onboarding.
- `scripts/install-on-computer.sh`, `scripts/add-hq-to-hermes.py`, `scripts/pack.sh`: retain a supported legacy Orgo path in a separate adapter; create cross-platform self-hosted installer/upgrade/rollback, docker compose and enterprise Helm deployment.
- `tests/e2e.mjs`, `tests/voice-call.mjs`: keep legacy provider smoke tests and add full matrix below. Remove machine-specific test paths and secrets.

### Proposed new monorepo structure
```
apps/
  web/                  React + TypeScript product and account admin UI
  api/                  Compatibility API, REST/GraphQL or REST, schema validation
  marketing/            First-party branded public pages, docs and pricing
services/
  hermes-connector/     Hermes pairing, model discovery, reconnect, events
  orchestration/        Elixir durable agent jobs, schedules and recovery
  execution/            Rust sandbox policy enforcement and command broker
  voice/                Python Pipecat, STT, TTS, audio sessions
  streaming/            Go viewer proxy, WebRTC signaling, reverse tunnels
  policies/             Clojure entitlement and rule policy evaluation
  analytics/            Julia memory/simulation/usage analysis jobs
  billing/              Ledger and subscription reconciliation
  integrations/         Composio, MCP tools and trigger normalization
packages/
  contracts/            Versioned provider, event and policy schemas
  sdk-ts/               Public client SDK and generated clients
  ui/                   First-party design system, avatars and animations
  provider-core/        Registry, capability manifests and test harness
providers/
  computers/local/      Commercially permitted self-hosted sandbox
  computers/orgo/       Existing Orgo integration
  voices/local/         Pipecat + Faster Whisper + Kokoro
  voices/elevenlabs/    Paid vendor-specific adapter
  voices/gemini-live/   Paid native realtime adapter
  voices/xai/           Existing Grok Voice adapter
  tools/composio/       Own/user Composio projects
  tools/mcp/            Generic secure MCP providers
infrastructure/
  compose/ terraform/ kubernetes/ monitoring/ migrations/
tests/
  unit/ contract/ integration/ e2e/ security/ load/ restore/
docs/
  architecture/ api/ deployment/ provider-sdk/ admin/ legal/ operations/
```
Each folder above is a **build target**; do not create empty placeholder packages for features that do not yet have implementations. Where a feature is not in launch scope, keep it in specifications only rather than compiling a fake stub.

## 15. Phased delivery with full release gates (tasks cannot be waived)

### A. Baseline and rights
- [ ] Fork Bot HQ into organization-owned repository; pin upstream commit and record all changes.
- [ ] Run upstream install/build/typecheck/test against supported environment; record failures, requirements and evidence.
- [ ] Inventory every binary, font, artwork and dependency license including generated shapes, fixtures, voice weights, CUA packages and provider SDKs.
- [ ] Preserve MIT and third-party notices; remove protected Grok/Cursor-like artwork and product wording.
- [ ] Choose and clear commercial product/company name, domain and trademark risks.
- [ ] Record clear target OS, CPU/GPU hardware and supported installation profiles.
- [ ] Write threat model and privacy data-flow map before exposing public accounts.

### B. Platform foundation
- [ ] Create customer organizations, workspaces, user membership and role model with account deletion/export.
- [ ] Implement secure login, verified email, account recovery and MFA.
- [ ] Implement PostgreSQL schema, migrations, tenant constraints and backup strategy.
- [ ] Implement tenant-aware public API, SSE, WebSocket and MCP middleware.
- [ ] Implement credential vault, secret redaction and revocation.
- [ ] Implement provider registry manifests and validation.
- [ ] Implement independent runtime health, error responses and retry protocol.
- [ ] Integrate durable job queue, heartbeat, worker recovery and dead-letter process.
- [ ] Implement comprehensive audit and authorization event capture.
- [ ] Build organization admin, status, and system operator dashboards backed by real data.

### C. Hermes — universal reasoning
- [ ] Preserve primary Hermes connect-without-modifying behavior and document it.
- [ ] Build external Hermes pairing with scoped revocable credentials and endpoint verification.
- [ ] Verify and report actual configured model and Hermes capabilities.
- [ ] Build managed isolated Hermes homes and gateway lifecycle with safe start/stop.
- [ ] Implement per-agent model selection by calling Hermes' authorized model configuration facilities.
- [ ] Support use of supported remote or local model as defined by Hermes, without hardcoded DeepSeek default.
- [ ] Preserve skills, memory, session continuity, tool streaming, cancellation and conversation search.
- [ ] Validate reconnect after Hermes crash/disconnect and exact task failure status.
- [ ] Verify additional agents cannot read another Hermes home's secrets or files.

### D. Universal computers
- [ ] Specify computer, sandbox and viewer interfaces with conformance suite.
- [ ] Preserve Orgo adapter and verify existing screen/viewer/command behavior.
- [ ] Implement first commercially permissible local sandbox provider with real browser, file, shell and GUI input.
- [ ] Add per-agent filesystem, Chrome, process, desktop and network isolation.
- [ ] Implement sandbox create/start/stop/suspend (if supported)/delete and metering.
- [ ] Implement desktop screenshot and browser automation with reliable coordinate scaling.
- [ ] Implement viewer transport with short-lived, tenant-scoped watch and control tokens.
- [ ] Verify human takeover, clipboard filtering, session revoke and reconnect.
- [ ] Implement clean sandbox snapshot/restore only when actually supported and tested.
- [ ] Implement idle suspension, hard lease expiration, storage cleanup and orphan scanning.
- [ ] Verify externally attached and managed Hermes only control authorized sandboxes.
- [ ] Test two unrelated tenants in parallel, including adversarial file/network escape attempts.

### E. Universal voice
- [ ] Implement provider-neutral session protocol and web audio transport.
- [ ] Implement Pipecat local STT/TTS with Faster Whisper, Kokoro and licensed assets.
- [ ] Implement microphone permissions, VAD, barge-in, mute, transcript and audio playback.
- [ ] Reconnect speech requests to same Hermes agent through authenticated task routing.
- [ ] Preserve xAI realtime voice as optional adapter with full session lifecycle.
- [ ] Implement ElevenLabs provider adapter and real billing receipt.
- [ ] Implement Gemini Live provider adapter with authorized Hermes action delegation.
- [ ] Implement provider capabilities for speech-only versus speech-to-speech, language and speed selection.
- [ ] Implement explicit recording consent, retention limits and voice session export/deletion.
- [ ] Test provider failures, dropped WebRTC, silent microphone, long speech, interruptions and tool approval during speech.
- [ ] Confirm local voice works without a paid voice API key; confirm hosted local inference is metered.
- [ ] Audit Piper engine and individual voice model licensing before enabling it in commercial bundle.

### F. Connected apps and automation
- [ ] Preserve Composio search, connect, execute, disconnect, and triggers with real callback handling.
- [ ] Support customer-owned Composio projects/keys and operator-owned projects with isolated usage.
- [ ] Build generic MCP catalog, scoped OAuth/token auth and disconnect.
- [ ] Implement risk-based approval for tool writes plus browser/shell equivalent actions.
- [ ] Implement cron and webhook event deduplication, retries, time zone handling and audit.
- [ ] Test read actions, approved write, denied write, duplicate trigger, expired OAuth, revoked connection and quota exhaustion.
- [ ] Log all Composio costs/limits, showing managed-app and own-app allowances separately.

### G. Original design and full product UI
- [ ] Replace every Grok-derived image, icon, character, page title, fixture, package name, CSS token and favicon.
- [ ] Launch an original responsive design system and branded public marketing site.
- [ ] Implement original pet/avatar renderers, animation states, controls and reduced-motion mode.
- [ ] Implement usable onboarding for all five plans.
- [ ] Implement user/workspace/agent settings and provider selections with real health checks.
- [ ] Implement complete conversation, transcript, history, file library, activity views and permission cards.
- [ ] Implement accessible keyboard/navigation screen reader and mobile layouts.
- [ ] Implement search, task lists, agent/team messaging and dashboards with server-backed values.
- [ ] Verify every button navigates, changes real persisted state or explicitly reports unavailable capability.

### H. Payments, quotas and revenue
- [ ] Create five versioned plans and server-side entitlement checks.
- [ ] Configure Stripe catalog/products/prices, checkout, customer portal and taxes as applicable.
- [ ] Implement signed webhook processing with idempotency and replay tests.
- [ ] Implement usage reservation ledger, reconciliation, credits, refunds and topups.
- [ ] Implement per-agent, user, workspace, organization and provider usage reporting.
- [ ] Implement plan upgrades/downgrades, proration policy, dunning, cancellation and reactivation.
- [ ] Implement account/customer-managed BYOK cost mode versus platform-funded credit mode.
- [ ] Implement free-tier hard limits, free-trial anti-abuse and no-overdraft enforcement.
- [ ] Validate margins for advertised plan allowances under maximum credible consumption.
- [ ] Test malicious parallel usage, credit-race spending, webhooks out of order and provider invoice mismatch.

### I. Teams and enterprise
- [ ] Implement seats, role-based workspace membership, invites and ownership transfer.
- [ ] Implement shared agents, scopes for tool approvals and delegated agent collaboration.
- [ ] Implement organization-level model, tool and computer allowlists and max spending.
- [ ] Implement org audit/export and team activity dashboard.
- [ ] Implement SSO/OIDC/SAML and SCIM only if promised on Enterprise contract; real integration + regression suite.
- [ ] Implement enterprise deploy, dedicated keys/data region, custom retention, account provisioning and support process.
- [ ] Document data isolation and establish contract/SLA/SLO evidence before making guarantees.

### J. Security and compliance
- [ ] Audit all dependency, model weight and artwork licenses with a signed SBOM.
- [ ] Run SAST, DAST, dependencies/CVE audit, secret scanning, image scanning and fuzz/property-based tests.
- [ ] Perform manual review of MCP and remote Hermes credential paths.
- [ ] Test cross-tenant database APIs, screenshots, files, tasks, streaming events and billing.
- [ ] Test sandbox escape, prompt injection, SSRF, webhook replay and agent loops.
- [ ] Set consent, voice recording, retention, privacy and deletion policies with appropriate legal review.
- [ ] Document terms of service, privacy, DPA procedures, cookie use and data subprocessors.
- [ ] Establish abuse reporting and security contact; incident response and key rotation drills.
- [ ] Complete independent security assessment of high-risk systems before admitting arbitrary public untrusted code.

### K. Hosting and release
- [ ] Build local Docker/self-host install and uninstall paths that work without Orgo/xAI keys.
- [ ] Build managed hosting IaC, staging and production environments and provider credentials injection.
- [ ] Configure HTTPS/TLS, domain, DNS, transactional email, support and product status page.
- [ ] Set up monitoring, tracing, alerts, runbooks, exception reporting and on-call ownership.
- [ ] Set up encrypted backups with documented automatic restore tests.
- [ ] Implement rolling deploy, schema compatibility migration, rollback and feature flags.
- [ ] Confirm marketing claims match observed implementation and license grants.
- [ ] Run real-service end-to-end tests for all published providers and every plan.
- [ ] Run load/soak/chaos tests against declared concurrency and cost limits.
- [ ] Fix all release-blocking defects and publish signed tagged release with migration notes.
- [ ] Conduct limited production pilot with real subscriptions, real credit ledger and monitored support.
- [ ] Expand availability only after security, financial and reliability gates pass.

## 16. Release verification matrix — actual users, actual services

Every row must pass under automated CI plus manually witnessed acceptance evidence for the production release target:

| ID | Scenario | Pass condition |
|---|---|---|
| E2E-01 | Free sign-up | Verified owner has working account, correct plan and limits, no paid API credential required just to open UI |
| E2E-02 | External Hermes pairing | Customer connects existing Hermes; true model reported; server leaves its config unchanged by default |
| E2E-03 | Managed Hermes | Provisioned new agent can use its actual configured model with independent profile/memory |
| E2E-04 | Local desktop | Agent opens real browser, types, runs command, saves artifact; viewer displays it |
| E2E-05 | Hosted Orgo | Same task works on paid Orgo adapter, no source-code changes |
| E2E-06 | Isolation | Tenant A cannot access B's files, sessions, screens, tokens or logs |
| E2E-07 | Local voice | Microphone -> Faster Whisper -> Hermes -> Kokoro -> audible reply without xAI voice key |
| E2E-08 | Premium voice | Actual ElevenLabs and Gemini Live sessions route authenticated work through Hermes and meter usage |
| E2E-09 | xAI voice | Existing xAI adapter still works with authorized key and user opt-in |
| E2E-10 | Composio | Connect one real app, read, request approval to write, execute if approved, refuse if denied, revoke |
| E2E-11 | Generic MCP | Connect real authenticated MCP server, discover, call, audit and disconnect |
| E2E-12 | Multi-agent | Agents use different model/voice/computer providers, collaborate and leave correct receipts |
| E2E-13 | Schedules | Cron and provider webhook initiate exactly one durable task across worker restart |
| E2E-14 | Billing | Real test-mode checkout and webhook activate correct plan and credits, no double charge |
| E2E-15 | Credit hard stop | Concurrent tasks cannot overspend prepaid balance; all paid work stops or prompts before limit |
| E2E-16 | Teams | Seat invitation, role changes, shared tool approval and workspace data permissions work |
| E2E-17 | Provider failure | Paid provider outage shows honest error without silent rerouting to another paid provider |
| E2E-18 | Cancellation | Cancel/expire entitlement terminates active billable resources and preserves data per policy |
| E2E-19 | Data export/delete | Export and deletion include conversations, attachments, sandbox files, tokens and mapped data |
| E2E-20 | Branding | No unlicensed Grok artwork, product names or protected animations shipped in UI or bundles |
| E2E-21 | Install/upgrade | Clean self-host installation, backup upgrade, rollback and uninstall pass on target OS |
| E2E-22 | Restore | Disaster recovery restore returns intact tenant-scoped user, billing and agent state |
| E2E-23 | Abuse | Automated attempts at cross-tenant access, prompt injection, SSRF and tool override are rejected |
| E2E-24 | Mobile/accessibility | Sign-up, chat, approvals, subscriptions, voice and agent viewer usable on supported browsers/devices |

**No launch unless every advertised integration has at least one real-provider end-to-end test passing in staging.** An optional provider may be excluded from initial public catalog if not yet implemented, with its assets/spec remaining in development only; it must not be listed as a shipped feature.

## 17. Development and deployment sequence (dependencies)

1. Freeze and verify upstream tests, licenses and original assets; decide company branding.
2. Add tenant/organization model and migration scaffolding; do not turn on public multi-tenancy until isolation tests pass.
3. Add versioned provider contracts, registry, health and secret storage; wrap existing Orgo/xAI/Composio and Hermes rather than deleting them.
4. Add remote Hermes pairing; verify existing Hermes remains untouched and can use its model.
5. Add local computer sandbox, viewer, file API and hard isolation; keep Orgo passing same conformance suite.
6. Add local voice service and production media transport; keep xAI passing same interface.
7. Add ElevenLabs and Gemini Live real adapters; enable only as tested.
8. Add original branding, UI, avatar system and accessible product onboarding.
9. Add prepaid ledger, Stripe billing, plan entitlements and metering before offering paid hosted tasks.
10. Add Teams and Enterprise org controls, supported SSO where sold, admin and compliance documents.
11. Load-test, penetration-test, reconcile costs, launch staging pilot, fix release blockers, then release to customers.

Constrain each coding change to one focused PR with a working build, tests and rollback instructions. Do not combine a whole-platform rewrite with new billing and security migration in one unrecoverable commit.

## 18. No-stub acceptance checklist for Codex or other coding agent

- [ ] Actual source code implements every documented public feature and no public controls call mocked APIs.
- [ ] Clean install from documented instructions works on at least one Linux target without paid Orgo or xAI keys.
- [ ] Hermes agent reasons from its own configured, real LLM provider.
- [ ] Changing LLM provider in Hermes reflects correctly in our UI without losing identity/task history.
- [ ] Each launched computer provider can start, use browser, save file, stream viewer and stop with real data.
- [ ] Each launched voice provider can capture speech, play audio, route tasks to Hermes and stop with real measured usage.
- [ ] Composio and MCP can execute real approved actions, obey revocation and record usage.
- [ ] Provider availability UI matches capabilities and credential state exactly.
- [ ] Every plan limit is enforced at the backend under concurrent load.
- [ ] Stripe checkout/subscription/credit events reconcile with real signed webhooks and DB transactions.
- [ ] Multi-tenant and cross-agent data isolation security checks pass.
- [ ] Every scheduled task survives restart or ends with exact recoverable status.
- [ ] All user-visible texts/images reflect original branding and licensed assets.
- [ ] Relevant units, integrations, contracts, live E2Es, security, load and restore tests pass.
- [ ] Customer documentation, operations runbooks, onboarding, support, legal pages and payment disclosures are finished.
- [ ] Release manifest states exact supported OS, provider versions, credential modes, performance limits, invoices and costs.
- [ ] Independent owner can reproduce the release and deploy it without access to a developer's private machine.

## 19. External decisions required before production launch

These are legitimate **business inputs**, not missing code stubs:
- Original commercial company/product name, domain and artwork identity; trademark/legal checks.
- Payment processor merchant account and payout/tax settings.
- Which geographic regions to operate in and a reviewed privacy/terms/legal program.
- Hosting provider and hardware budget for managed workers and local-speech hosting.
- Production OAuth clients/Composio organization setup and SaaS provider terms.
- Test and production API keys/authorized model accounts for paid provider conformance tests.
- Approval of final plan prices, capacities, credit values, rollover and refund rules after worst-case COGS modeling.
- Security assessment signoff, owner for incident response and customer support.

## 20. Baseline sources / due diligence

- Bot HQ source: https://github.com/nickvasilescu/bot-hq (main, commit `decf9a215cddd8792a5f20f4a11a87d4dffa6d15`)
- Bot HQ architecture: https://github.com/nickvasilescu/bot-hq/blob/main/docs/ARCHITECTURE.md
- Bot HQ third-party notices: https://github.com/nickvasilescu/bot-hq/blob/main/THIRD_PARTY_NOTICES.md
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- CUA licensing: https://github.com/trycua/cua/blob/main/legal/LICENSING.md (verify exact repository path/version at implementation)
- AgentDesk license: https://github.com/agentsea/agentdesk/blob/main/LICENSE (MIT; maintenance status must be evaluated)
- Pipecat BSD-2: https://github.com/pipecat-ai/pipecat/blob/main/LICENSE
- Faster Whisper MIT: https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE
- Kokoro Apache-2 model card: https://huggingface.co/hexgrad/Kokoro-82M
- Piper current GPL engine and voice licensing: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md
- Composio free plan (limits can change): https://composio.dev/pricing/platform
- Firecracker Apache-2: https://github.com/firecracker-microvm/firecracker

**End of specification. This document is the complete target scope and implementation gate list, not evidence the software has been delivered.**

---

# Revision 2 — Complete Cross-Repository Integration and Commercialization Specification

> **Status and precedence:** Sections 0–20 are the complete baseline blueprint, retained for compatibility and traceability. Sections 21 onward are the new integrated requirements. Where a Revision 2 requirement changes a baseline assumption, Revision 2 controls. The two uploaded source documents and the inspected repositories are inputs to the design, **not proof of an implemented combined product**.

## 21. Revision 2 executive decision register

### 21.1 Product definition

Build **one original commercial AI-agent operations platform** with modular product surfaces:

1. **Agent Workspace:** universal chat, Hermes runtime, computers, voice, automation, tools, memory, teams and original avatar/pet visuals.
2. **Workforce Marketplace:** versioned specialist agent role templates and one-click team compositions from approved Agency Agents definitions; persistent identity through SID.
3. **Security Operations:** interactive, authorized security assessments via a restricted Pentest Copilot service; scanner workflows through OKF; findings and remediation.
4. **Security Evidence & Verification:** OKF canonical receipt, ledger, artifact verification and optional independently verified Bitcoin/OpenTimestamps/Nostr proofs.
5. **Security Knowledge:** curated, versioned, citation-bearing PayloadsAllTheThings reference search; knowledge alone never authorizes code execution.
6. **Simulation & Benchmarks:** disposable, authorized Cloud Attack Range laboratories; independently scored evaluation and proof-linked results.
7. **Creative Studio:** Parallax-derived image/video/audio workflows if current source and rights pass audit, backed by universal media providers, task orchestration and credits.
8. **Commercial Control Plane:** subscription tiers, plans, entitlements, provider catalog, BYOK, credits, billing, tenant management, operator support and contractual Enterprise hosting.

### 21.2 Decisions locked for architecture

| ID | Decision | Consequence / acceptance rule |
|---|---|---|
| D-001 | Hermes is the **sole required reasoning runtime** | Do not duplicate model settings or introduce a mandatory independent reasoning engine within Pentest Copilot, Parallax or the marketplace. Standalone legacy engines may remain optional only. |
| D-002 | SID is the **agent identity spec of record** | Use an immutable agent identity reference; do not confuse persona templates with independent identities. |
| D-003 | Agency Agents is a **role/template catalog** | Role content describes expected work; it grants no execution permissions by itself. |
| D-004 | Pentest Copilot is a **restricted security tool service** | Expose through scoped MCP/adapters, not a general administrator token or uncontrolled public API. |
| D-005 | OKF owns **scan pipeline and evidence integrity** | Preserve its existing evidence semantics and explicitly migrate legacy integrity exceptions; do not claim unverified Bitcoin proofs. |
| D-006 | PayloadsAllTheThings is **untrusted reference content** | Index for retrieval; never auto-run payloads directly from text; maintain provenance and license compliance. |
| D-007 | Cloud Attack Range is an **isolated lab provider** | Ownership/authorization, network restrictions, cloud account ownership, budgets, lifetime and teardown are mandatory. |
| D-008 | Parallax is a **candidate Creative Studio implementation** | Adapt only once exact source code, provenance, media providers and licenses have been audited. |
| D-009 | No monolithic code dump | Keep functional domains behind service contracts, deployable modules and tested interfaces; avoid mixing runtime ownership. |
| D-010 | Free-first hosting | Free means customer-provided Hermes/compute/inference and local voice; optional managed infrastructure is always metered and hard-capped. |
| D-011 | Five plans remain | Free, Basic, Pro, Teams and Enterprise with modular product entitlements and managed credits, not five separate code branches. |
| D-012 | Public marketing uses neutral naming | Keep historical repo/protocol names where required; create first-party commercial branding and replace unlicensed artwork. |
| D-013 | No production demo stubs | Only enabled and advertised providers with passing real-service tests may be sold or enabled. |
| D-014 | Polyglot system roles remain | Rust/Julia/Elixir/Clojure/Python/Go/Move services have explicit duties; TypeScript used for UI and temporary migration gateways. |
| D-015 | Security simulations are controlled | Scores/rewards (if introduced) derive from objective validation + signed evidence; no unverified bounty or blockchain reward promises. |

### 21.3 Evidence and verification confidence, as of this revision

| Repository/source | Inspection status | Decision / caution |
|---|---|---|
| `nickvasilescu/bot-hq` | **Live source previously inspected**: MIT, Hermes gateway, Orgo/xAI/Composio, Node/Hono + SQLite | Working upstream foundation; not yet commercial multi-tenant hardened. |
| `bugbasesecurity/pentest-copilot` | **Live source previously inspected**: MIT root license, MCP, Kali/Burp/Caido, Docker, MongoDB/Redis, own LLM, permissions | Use restricted security capabilities; do not expose broad MCP token. Source-level features ≠ live end-to-end validated here. |
| `cryptonomicsed-byte/okf-security-pipeline` | **User ZIP statically inspected** (see Appendix) | Scan/evidence system with 69 internally consistent receipt IDs; 8 artifact mismatches and 4 missing refs; proofs not independently chain-verified. |
| `bugbasesecurity/PayloadsAllTheThings` | **Exact fork source not freshly audited**; upstream `swisskyrepo/PayloadsAllTheThings` references inspected | Use versioned reference importer only after fork diff, license and content review. |
| `bugbasesecurity/cloud-attack-range` | **Exact repository files not freshly audited**; prior public metadata/description discussed | Treat implementation claims, cloud coverage, pricing, cleanup, license as pending exact-source audit. |
| `nickvasilescu/parallax` | **Exact repository files not freshly audited**; prior indexed description suggests media studio | Candidate Creative Studio, not an established tested media pipeline yet. |
| User's `agency-agents` repository | **Exact fork not audited**; upstream `msitarzewski/agency-agents` role catalog reviewed | Require exact repo URL or ZIP, fork delta, provenance and content license inventory. |
| `cryptonomicsed-byte/sid` | **Earlier saved source audit and blueprint available**, not freshly reread from remote | `sid/0.1` schema/canonicalization/hash-chain/history; neutral issuer-signed `sid/0.2` remains a design migration, not a shipped fact. |

**Rule:** Any repository not yet source-audited may be represented in engineering plans as a candidate adapter, **never** as a completed integration. Recheck HEAD SHAs and content before procurement, fork, or commercial license claim.

## 22. Unified domain ownership — no duplicate authorities

| Domain | System of record | Adapters / participants | Must not own |
|---|---|---|---|
| Human customers, organizations, plan | Commercial Control Plane (Postgres) | Stripe/BYOK/auth connectors | Hermes, security tools or media model |
| Agent permanent identity and lifecycle | SID Identity Registry | Hermes agent runtime, marketplace catalog, human operator | Role-template file or avatar skin |
| Specialist professional roles | Agency Roles Catalog | Templates, evaluators, Hermes installation | Persistent identity, auth rights, billing |
| Reasoning, context, local Hermes memories | Hermes instance | Model provider, API client, adapters | Parallel Pentest Copilot LLM in integrated mode |
| Secure tool permission and actions | Policy/Execution Gateway (Rust + policy service) | MCP/Composio/browser/security/media workers | Prompt text, role description, raw tool name regex |
| Ordinary desktop and GUI | Computer Provider Manager | Local sandbox, Orgo, permitted provider | Pentest-specific work-host by default |
| Browser voice and realtime media | Voice/Media Gateway | Pipecat, local STT/TTS, ElevenLabs/Gemini/xAI | Second autonomous task authority |
| General app connection | Integration Registry | Composio, MCP, webhooks | Individual providers maintaining tenant security policy |
| Interactive security work | Restricted Security Operations Service | Pentest Copilot tool handlers, Kali, Burp, Caido | Unscoped access to company SaaS host |
| Static/dynamic security pipeline | OKF Scan Workers | Gitea/GitHub event adapters, security engine | Subscription, billing, agent memory authority |
| Findings, transitions, remediation | Unified Findings Service (Postgres) | OKF memory, Pentest Copilot findings | Each service independently creating unrelated customer truth |
| Evidence integrity and receipts | OKF Evidence/Proof Service | Signatures, OTS, Bitcoin verifier, Nostr outbox | Claim of finding validity or target ownership by hash alone |
| Security methodology | Versioned Knowledge Service | PayloadsAllTheThings upstream/fork | Execution permissions or agent-generated authoritative claims |
| Lab provisioning and benchmark truth | Simulation/Lab Manager | Cloud Attack Range (after verification), verified validators | Task model/agent identity/payment authority |
| Media generation and project artifacts | Creative Projects / Media Service | Parallax-derived components (after audit), image/video/audio provider plugins | Core Hermes model selection |
| Usage costs / customer credits | Billing Ledger | Provider usage receipts and payment provider | Mutable UI counters or external service as sole balance |

**Principle:** Every object has a single authoritative owner, a stable ID, a tenant, a versioned schema and explicit cross-service access. A service cannot inherit authorization simply because it receives another service's metadata.

## 23. SID + Agency Agents: persistent identity and specialist workforce catalog

### 23.1 Core separation

- **SID Agent Identity:** created for an actual deployed agent principal. Holds issuer, owner binding, genesis/creation record, keys or credential references, supported lifecycle, and cryptographically supported provenance. ID itself does not grant access.
- **Agency Role Template:** reusable work specification (instructions, duties, tasks, skills, artifacts, review criteria and compatible tools). It has a publisher, version, content digest and license; no independent execution rights or persistent identity.
- **Agent Installation:** a binding among `SID`, `role_template@version`, `HermesConnection`, `Workspace`, `ToolGrants`, `ComputerAssignment`, `VoiceAssignment` and `AvatarAssignment`. This is the commercial platform's deployable worker.
- **Agent Memory:** lives within Hermes-owned namespaces, while platform metadata and authorized memory-sharing grants reside in the control plane; changing a template must not silently replace identity or drop memory.
- **Persona:** presentation traits and professional instructions; must be separable from agent owner, spend authority, tool grant and official identity.

### 23.2 SID migration and compatibility rules

Earlier available SID audit describes `sid/0.1` with TypeScript and Python canonicalization, tests, hash-linked history, active hash, lifecycle and Nostr announcement templates. Those historical bytes are immutable. **Do not mutate archived records and claim their old hashes still verify.** Introduce a new neutral profile as `sid/0.2` only after source audit, versioned fixture tests, key and issuer verification and a provenance-preserving migration record. The new profile should include signed issuer, audience, key reference, capabilities/claims, version, expiry and revocation metadata. Verify signatures and issuer trust separately; a hash or Nostr announcement alone proves neither ownership nor rights.

`SID ↔ Hermes` binding must support an external already-running Hermes, managed independent gateways, rotation/revocation, and optionally multiple installations with explicit uniqueness of active ownership policy. A role template may be updated; an agent SID may not be silently replaced. An avatar/pet is presentation, never identity proof.

### 23.3 Versioned contracts (required; examples are design targets, not currently implemented)

`AgentIdentity`: `sid`, `schema_version`, `issuer`, `owner_subject`, `public_keys`, `created_at`, `previous_document_digest`, `signature`, `status`, `revocations`, `provenance`.

`RoleTemplate`: `role_id`, `publisher_id`, `name`, `domain`, `version`, `source_repo`, `source_commit`, `license`, `content_digest`, `instructions`, `skills`, `expected_artifacts`, `evaluation_suite`, `requested_capabilities`, `risk_class`, `compatible_runtime_versions`, `deprecation`.

`AgentInstallation`: `installation_id`, `tenant_id`, `workspace_id`, `sid`, `role_version_ref`, `hermes_connection_id`, `provider_assignments`, `grants`, `memory_namespace_ref`, `avatar_ref`, `lifecycle`, `created_by`, `audit_event_id`.

`TeamTemplate`: `template_id`, `version`, `roles[]`, `task_edges[]`, `handoff_contracts[]`, `approval_rules[]`, `budget_policy`, `evaluation_suite`, `publisher_signature`.

**Selection algorithm:** customer chooses template → preview requested capabilities, projected recurring costs and policies → confirm SID creation or select existing compatible SID → pair or create Hermes instance → grant specific allowed actions → provision resources → run actual health check → mark agent active only on success. Failure rolls back reservations and partial provisioning; no phantom agent deployed.

### 23.4 Team templates and marketplace

- Support engineering (architect, developer, QA), marketing (strategist, content, SEO), creative (director, editor, image/audio producer), research, operations, customer support and security (analyst, reviewer, remediation) role bundles.
- Support one-click **deployment**, not merely copying a prompt. Real installation creates independent agent instances, assigns tools, binds memory, stores status, and runs a test task.
- Allow user-authored templates and organization-private catalogs. Future third-party publication requires identity verification appropriate to risk, content scanning, sandbox testing, signed releases, rollback and moderation.
- Keep role templates separate from actual employer/employee claims: don't represent AI as a legally certified human practitioner. Label human review requirements for high-stakes domains.
- Store template permissions as **requests**, not grants. Security roles cannot gain scanning authority without an authorized engagement and execution policy.
- Track performance: task success, elapsed time, deliverable quality, review corrections, cost, rate of permission denials and reliability. Prevent self-reported success from being scored as verified success.
- Support role change, template pin/rollback, custom fork, organization policy overrides, and controlled lineage display.

### 23.5 Market economics

Basic/Pro can unlock additional specialist templates and managed run credits. Teams enables shared team workspaces and approval handoffs. Enterprise allows private signed catalogs, custom evaluations, dedicated instances and governance. Free users can install customer-hosted starter specialists without paid credits. Third-party template revenue share is **future optional**; implement publisher contracts, payout identity/tax, fraud prevention and dispute support before selling it as a feature.

## 24. Security Operations: Pentest Copilot as a restricted module

### 24.1 Verified upstream capabilities (previous source audit)

Pentest Copilot exposes Kali/SSH work hosts, command and Python tooling, browser automation, Burp Suite, Caido, VPN, CTF/engagement state, vulnerabilities, subagent and parallel swarm functionality, and an MCP endpoint. Its root `LICENSE` is MIT (backend package metadata also contains ISC; confirm final legal attribution). Its default Docker deployment includes MongoDB and Redis; this does not have to become the SaaS-wide database topology.

Its existing MCP server uses bearer tokens bound to a local user. The README warns tokens act as local admin-level access, and its MCP implementation advertises platform configuration, shell and other powerful operations. A flag controls whether consent-gated MCP tools may be run. **Never embed its raw MCP token in a customer's Hermes prompts or expose it on the internet as-is.** Local-only host checks and existing tool-approval logic are not equivalent to tenant-aware, target-aware network isolation.

### 24.2 Commercial integration phases

1. Run Pentest Copilot as a private, separately deployable service or import only clearly licensed tool handlers into a secured adapter, not as the public SaaS's general-purpose execution host.
2. Map the current MCP capabilities to a narrow allowlisted `SecurityToolDescriptor` catalog. Disable platform configuration, raw host shell, VPN modification, payload creation, general remote execution, and privileged operations until individually approved and scoped. Allow discovery/health/read-only findings first.
3. Create `Engagement` authorization that binds customer, ownership evidence, exact IP/CIDR/FQDN scope, exclusions, allowed methods, start/end windows, budgets, approvers and emergency stop.
4. Apply the same enforcement for Hermes tool calls, UI buttons, security worker jobs and manual operator actions; request approval for high-impact actions.
5. Place tools in sandboxed networks with egress restriction to approved targets and no host credential access. Use isolated Kali images only when their license/deployment rights have been established.
6. Normalize results into shared findings/evidence schemas; never allow a helper service to directly mutate another tenant's documents.
7. Preserve useful Pentest Copilot UI concepts (sessions, terminal, findings, approvals) with original first-party components, rather than embedding a second billing/account engine.
8. Separate provider failure from safety denial in logs and UI. Always offer customer stop/revoke and report/export.
9. Treat Mythic and similar adversary-emulation functionality as an elevated-risk, separately authorized enterprise/lab-only capability with isolated infrastructure and explicit policy checks; never enabled by default.

### 24.3 Tool-level security rules

Each security invocation must carry `tenant_id`, `workspace_id`, `engagement_id`, `agent_sid`, `tool_id`, `policy_grant`, `authorization_evidence_ref`, `scope_snapshot_digest`, `approval_ref`, `budget_reservation_id`, `execution_sandbox_id`, `trace_id`. The executor revalidates scope and expiration at **execution time**. If DNS changes after approval, re-resolve against allowed IPs and prevent rebinding; reject metadata-service and private control-plane destinations unless explicitly approved. Immutable audit logs record policy version and result. A prompt or knowledge document is not a scope expansion.

### 24.4 Findings and remediation

Findings from Pentest Copilot and OKF must be normalized with stable issue fingerprints, code/component path, severity (with source of score), confidence, first/last seen, reproduction/evidence references, business impact, assigned reviewer, remediation links, and lifecycle `open -> triaged -> accepted/risk_accepted -> fixed_candidate -> retest_pending -> verified_fixed` plus `false_positive` with reviewer identity and rationale. A scanner's failure must not be recorded as `verified_fixed`.

## 25. OKF scanning, evidence and provenance authority

### 25.1 What the uploaded source actually contains

The user-supplied ZIP previously underwent an offline static audit (source and full addendum in Appendix). It contains Strix pipeline generations, Gitea webhook workflows, static scanning, threat-intelligence ingestion, memory/finding transitions, tool manifests, evidence receipts, Bitcoin/OpenTimestamps verification logic, Nostr publication/outbox, Koodu time utilities, and an evasion/prompt-injection test harness. The scope is **source snapshot**, not a working network-verified deployment.

**Observed audit metrics:** 26 Python modules parsed successfully; 69 receipt IDs recomputed consistently; 506 referenced evidence hashes matched archived bytes; 8 artifact hash mismatches; 4 missing referenced artifacts; externally claimed Bitcoin checks and HMAC author signatures were not independently verified. Report artifact counts are per ZIP snapshot, not current GitHub state. Historical exceptions are never overwritten for cosmetic success.

### 25.2 Service decomposition

- `okf-scan-worker`: versioned stage runner for repository intake, secret checks, SAST-like heuristics, optional authorized dynamic/browser probes, normalized findings and independent output. Convert `strix_pipeline_v4.py` to testable, explicit, separately configured stages.
- `okf-finding-history`: stable finding fingerprints, recurrence, merge with interactive assessments, triage, remediation link and repeated-run diff. Separate from Hermes conversation memory.
- `okf-evidence`: canonical artifact manifests, content-addressed immutable storage, Merkle tree generation, signed receipts, previous receipt chain, public verification keys and append-only event history.
- `okf-proof`: asynchronous OpenTimestamps initiation/upgrade, chain proof verification, Bitcoin header validation with independently trusted source, optional Nostr publication of **commitments only**.
- `okf-webhook-ingest`: signed/validated GitHub/Gitea callbacks; source branch/commit and tenant ownership; enqueue jobs via durable queue.
- `okf-evaluation`: defensive prompt-injection regression and controlled agent-evaluation cases, with objective pass/fail criteria, not claims of guaranteed immunity.

### 25.3 Mandatory migration rules

- Quarantine legacy receipts with missing or mismatched input evidence and surface proof state as `legacy_mismatch` or `incomplete`; preserve original bytes, metadata, and audit note.
- Historical `receipt_id` self-consistency must not be represented as external chain attestation or evidence authorship. Enforce issuer signatures and key rotation for new receipts.
- Unknown external proofs stay `pending/unverified`; distinguish `verified_integrity`, `verified_timestamp`, `verified_signer`, `verified_authorization` and `verified_finding`. None implies the others automatically.
- Fix insecure `strix_runner.py` loopback `/run` handler by replacing with authenticated tenant-scoped durable jobs; revalidate Git clone URL and prohibit internal SSRF/network targets.
- Fix hardcoded Strix paths, Gitea and Vantage endpoint assumptions; run workers with explicit resource and egress policy.
- Fix webhook default secret, unbounded request size, replay possibilities, and event execution; require externally provisioned secrets, immutable event IDs and signed queue handoff.
- Move sensitive raw security logs out of public distribution; apply encryption, retention and role-based export.
- Support independent public receipt verifier that does not need secret signing keys, external services, or our application database for local checks.
- If optional Move/Sui proofs are ever added, implement them as separately audited verifiable receipt-consumer adapters. Do not imply OKF already uses Move settlement.

### 25.4 Evidence object (required)

`EvidenceManifest`: `manifest_id`, `tenant_id`, `engagement_id`, `scan_job_id`, `created_at`, `canonicalization_version`, `artifact_digests[]`, `merkle_root`, `provenance`, `policy_snapshot_digest`, `producer_sid`, `signature_algorithm`, `key_id`, `signature`, `verification_states`, `external_proofs[]`, `previous_receipt_hash`.

`ExternalProof`: `proof_id`, `type(ots/bitcoin/nostr/other)`, `reference`, `state(pending/verified/failed/inconclusive)`, `submitted_at`, `confirmed_at`, `verifier_version`, `trust_source`, `receipt_digest`. Public commitment never contains report plaintext or customer secrets.

## 26. Security knowledge: PayloadsAllTheThings importer

### 26.1 Intended use

Index curated documentation from the source/fork as **untrusted security reference material**. It is a knowledge dataset, not an execution engine. Its upstream convention organizes vulnerability descriptions, references and (in some chapters) test payloads or Burp Intruder datasets. The exact BugBase fork SHA/license differences are an audit gate before bundling.

Ingestion pipeline: repository source pin → license/distribution check → enumerate paths/attachments → strip executable active content from previews → normalized Markdown and citation parsing → taxonomy tagging (CWE/OWASP category where evidence supports) → provenance metadata → content digest → full-text/semantic index → review/publish approved catalog version. Store fetched text as evidence with explicit source; obey any content licenses. Never auto-update into trusted agent instructions.

### 26.2 Retrieval controls

- Tool `security_knowledge.search`: search categories, return short bounded snippets and precise source reference/version.
- Tool `security_knowledge.get`: fetch a source excerpt with permission, length, citation and untrusted-content wrapper.
- Optional `security_knowledge.dataset`: return **approved, environment-scoped** test fixtures to an authorized sandbox only, with scope check and rate limits.
- All returned source content is treated as data. Injection attempts, malicious links, embedded commands and sensitive references cannot modify the agent's system instructions or authorize an out-of-scope action.
- Version updates are reviewed and pinned per engagement so evidence from an old result remains reproducible.
- Keep write/update of index operator-only or controlled CI; customers cannot inject arbitrary text into trusted global corpus without moderation.

## 27. Cloud Attack Range: authorized sandbox laboratory and agent benchmarks

### 27.1 Candidate architecture

The previously discussed project describes disposable cloud security testing ranges and benchmark scenarios across providers. Because its **exact repository** was not source-inspected in this revision, record every cloud, scenario and deployment claim as **pending implementation verification**. A named GitHub repo or published claim is not enough to advertise a working supported cloud lab.

`LabProvider`: `listTemplates`, `validateCloudConnection`, `quote`, `reserveBudget`, `create`, `health`, `getTargets`, `startScenario`, `readValidation`, `stop`, `destroy`, `enumerateOrphans`, `verifyTeardown`. Prefer managed cloud orchestration through customer-owned accounts (BYO cloud) or carefully controlled billed operator accounts. Terraform/OpenTofu and any other infra provisioner are implementation details to verify, not assumptions.

### 27.2 Lab safety and economics

- Labs may only launch for verified customers in their own authorized account/project or an approved managed ephemeral environment.
- Do not grant production network connectivity or company secrets to intentionally vulnerable ranges. Use isolated accounts/VPCs/projects, restricted ingress, egress policies and safe identities.
- Mandatory maximum run time, spending ceilings, inventory by resource IDs/tags, cost alerts, inactivity timeout, enforced cleanup, delayed deletion retries, orphan sweeps and customer teardown receipts.
- Pricing must account for compute, public IPs, NAT gateways, storage, transfer, logs, unremoved resources, cloud tax and support. Open source does not mean free infrastructure.
- Do not sell a lab score unless ground truth can be independently validated and the initial state is reproducible.
- All active lab actions require scope and cost permissions. Lab authority cannot be reused against a customer's production systems.

### 27.3 Simulation and evaluation engine

Create `EvaluationScenario`: immutable template digest, random seed, initial environment/state checksum, allowed agent tools, target criteria, timeout, resource budget, reference validators and signed expected outcome. Agents can collaborate in a controlled range with separate roles: planner, defender, checker, remediation agent. Store task traces, test outcome, cleanup status and OKF proof links. **Reward only verified measurable outcomes.** Credits/tokens as incentives require a separate economic design and anti-gaming evaluation; no speculative promises of yield or agent autonomy.

Supported initial evaluation tracks should include defensive web review, remediation quality, tool compliance, safe browser workflows and reproducible cloud lab objectives where actual lab providers are verified. Additional creative or trading simulations can reuse generic evaluation contracts but must not be mislabeled as security assessments.

## 28. Parallax: universal Creative Studio (candidate integration pending audit)

### 28.1 Source audit gate

Prior public-index discussion described Parallax as a Hermes-adjacent image/video/audio studio. **Exact source remains unverified.** Before coding from it: pin commit; inspect LICENSE, assets and frontend; identify real image/video/audio providers, webhook callbacks, export mechanisms, actual render job completion criteria and customer billing risks. Determine whether it runs a separate AI agent, an Orgo computer, or both. **No functionality is claimed shipped from Parallax until these pass.**

### 28.2 Target Creative Studio experience

Customer creates project → assigns a Hermes creative specialist from Agency Role Catalog → enters brief/assets → plans scenes/shots/storyboard as structured work items → chooses provider per image/video/audio job → preauthorizes cost → dispatches render jobs to worker/provider → previews completed media → requests revision → combines clips/assets if supported → exports actual files/license metadata → optionally signs a provenance receipt via OKF evidence service.

### 28.3 Target services

- `creative-projects`: project ownership, collaborators, revisions, scenes, prompt briefs, storyboard frames, review comments, asset lineage and export manifests.
- `media-job-service`: durable queued jobs, quotes, provider routing, progress/status, retries, file validation, idempotency, cancellation and credit settlement.
- `image-provider`: generate/edit/upscale when provider supports; output size, model, safety/licensing and usage in manifest.
- `video-provider`: generate/extend/stitch/export when provider supports; asynchronous callbacks/polling and signed asset URLs.
- `audio-provider`: local or hosted TTS/narration/music/sfx only with appropriate rights and documented platform controls; speech and media outputs remain separate from live agent voice sessions.
- `media-gallery`: safe browser previews, thumbnail worker, export versions, storage quotas, private sharing and expiration.
- `media-provenance`: input hashes, generated asset digests, licenses, tool/provider model/version, edit history; optional evidence receipts must not imply copyright ownership.

### 28.4 Creative safety, costs and licensing

Do not claim any image/video model is free just because its wrapper is open source. Verify hardware needs, restrictions on generated content, commercial licenses, media upload rights, model weights, user deletion and third-party data use. No automatic premium provider fallback. Require affirmative user consent for voices/likenesses, prohibit nonconsensual impersonation, and support accessible captions where practical. When rendering locally, include GPU/VRAM/CPU/disk expectations and enforce concurrency caps.

## 29. Cross-product workflows: make modules cooperate in real tasks

### WF-01: Specialist workforce deployment

User selects approved Agency Agents template → platform creates/binds SID identity → pairs/creates Hermes → previews model and tools → grants exact permissions → chooses local or managed computer/voice → provisioning health checks → performs actual initial test → dashboard displays active specialist. Upgrading role template preserves SID and authorized memory with audit log.

### WF-02: Secure code delivery and evidence

Developer agent makes a change in authorized repo sandbox → security agent requests permitted scan → OKF static checks → optional Pentest Copilot review in target-scoped lab → normalized findings and remediation suggestions → reviewer approves patch → rescan → issue transitions → OKF receipt including exact commit SHA and artifact digests → signed report and export. Scanner unavailability cannot produce a green status.

### WF-03: Team authorized assessment

Team owner sets target scope and confirms authorization → risk approver signs engagement policy → security specialist attaches restricted Pentest Copilot tools → work runs only inside isolated security sandbox and allowed network → findings stream to workspace → analyst reviews → OKF evidence verifier signs integrity manifests and external timestamp proofs if verified → customer downloads report → access expires at end of engagement.

### WF-04: Reproducible cloud evaluation

Team requests validated lab template → confirm provider credential and worst-case quote → reserve credits/account budget → provision disposable isolated lab → verify initial state → assign Hermes evaluation agents → run allowed scenario and independent checker → score from objective measurements → OKF artifact receipt and history → destroy all cloud resources and verify teardown → settle measured charges and release unused credits.

### WF-05: Creative media campaign

Marketing agent prepares brief → creative director and editors coordinate via shared task board → use Parallax-derived (if verified) media job adapters → customer authorizes provider costs → generate/collect actual media artifacts → produce captions and deliverables → review and version → export final assets + manifest. Voice narration may use a different TTS provider from the agent's realtime voice.

### WF-06: Cross-domain business deliverable

Customer assigns a specialist team to create product landing page → engineering agent codes → creative agent supplies licensed media → security agent scans repository/authorized preview → QA checks functionality → human reviews billing/commercial claims → platform bundles released artifacts, evaluation and evidence receipts. All tasks share workflow ID while retaining individual SID/role and independent tool permissions.

## 30. Universal contracts / data schema extension

Add the following versioned schemas to the original provider and tenant model; all are proposed, none implied already implemented:

| Entity | Minimum properties |
|---|---|
| `AgentIdentityRecord` | tenant, SID, issuer, signature, owner, key IDs, state, version, provenance |
| `AgentRoleTemplate` | publisher, role ID/version, digest, license, instructions, requested capabilities, eval rules |
| `AgentInstallation` | SID, role-version, Hermes connection, workspace, grants, provider assignments, lifecycle |
| `TeamTemplate` | role placements, edges, task contracts, budgets, approval graph, version |
| `SecurityEngagement` | tenant, approvers, authorization evidence, targets, exclusions, methods, TTL, budget, state |
| `SecurityToolGrant` | SID, engagement, tool, argument constraints, network scope, approval receipt, expiry |
| `SecurityFinding` | fingerprint, source, commit, location, severity confidence, lifecycle, evidence, reviewer |
| `ScanRun` | inputs/commit hash, job/stage state, runner version, sandbox, results, events, usage |
| `EvidenceArtifact` | content digest, MIME, size, producer SID, storage URI, encryption class, retention |
| `EvidenceReceipt` | manifest version/digest, Merkle root, signer, signature, chain reference, proofs, states |
| `KnowledgeSource` | upstream repo SHA, license, document path, taxonomy, excerpt policy, index version |
| `LabTemplate` | provider, template digest, cloud account guardrails, quotas, validators |
| `LabInstance` | tenant, account, resource inventory, spend cap, TTL, state, teardown evidence |
| `EvaluationRun` | scenario, seed, participants (SIDs), permitted tools, outcome, independent scorer, proof refs |
| `CreativeProject` | workspace, owner, collaborators, scenes, media refs, license policy, retention |
| `MediaGenerationJob` | provider, model, input refs, consent, quote, credit reservation, status, output digests |
| `MediaAsset` | content hash, storage ref, dimensions/duration, source/license, edits, download rights |
| `ModuleEntitlement` | tier, module, capability, quota, environment, provider classes, org override |
| `ProviderUsage` | provider, action/job, raw units, price table version, cost, retail charge, settlement state |

### 30.1 Identity, authorization and provenance

Database IDs must never be accepted as authority. Every object query is `caller + tenant + object + operation` checked against explicit grants; privileged service authentication uses mTLS, workload identity or appropriately scoped short-lived tokens. Role/persona, model selection, SID identifier, professional title, provider credential, and approved security engagement each represent different claims. No one claim grants another automatically.

### 30.2 Contracts, versioning and compatibility

All JSON/Proto/OpenAPI contracts have schema IDs, semantic versions and owner; older readers reject incompatible payloads rather than guessing. Preserve golden fixtures for SID `0.1` canonicalization; `sid/0.2` migration must include explicit old/new links and signed issuer attestations. API failures use typed codes (`NOT_AUTHORIZED`, `OUT_OF_SCOPE`, `QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `PROOF_INCOMPLETE`, `ARTIFACT_MISMATCH`, `LAB_TEARDOWN_FAILED`). Client UI renders meaningful errors; no silent retries that exceed scope or money.

### 30.3 Suggested API namespaces (proposed contracts, not existing routes)

```text
/v1/identities              issue/verify/revoke SID subject
/v1/roles                   list/preview/import/version/publish approved role templates
/v1/agent-installations     plan/provision/status/upgrade/retire agent bindings
/v1/team-templates          preview/deploy/revise/version specialist teams
/v1/security/engagements    request/approve/modify/revoke authorized scopes
/v1/security/scans          submit/status/cancel/results with typed stage outcomes
/v1/security/findings       normalize/review/assign/retest/export
/v1/security/evidence       sign/verify/export artifact receipts
/v1/security/proofs         OTS/Bitcoin/Nostr proof lifecycle and independent verification
/v1/security/knowledge      search/fetch approved versioned references
/v1/labs/templates          list/pricing/provider health and supported labs
/v1/labs/instances          reserve/create/status/destroy/teardown-verification
/v1/evaluations             scenarios/runs/independent scores/receipts
/v1/creative/projects       create/version/review/collaborate/export
/v1/creative/jobs           quote/submit/status/cancel/download real media jobs
/v1/marketplace             public/private catalogs, verified publisher assets
```

All actions must be bound to authenticated tenant/workspace and scoped SID+human permissions; none of these API paths is a claim that the server currently exposes it.

## 31. Final deployment topology and dependency graph

```text
                         Original Branded Web / API
         Chat | Agents | Teams | Voice | Security | Labs | Creative | Billing
                                     |
                    Commercial Control Plane (PostgreSQL)
       Identity (SID) | Role Catalog | Grants | Entitlements | Ledger
                                     |
                  Hermes Agent Gateways (existing/managed)
                                     |
                        Universal Tool/Policy Broker
              _________|_____________|______________
             |         |             |              |
      Computer/GUI  Integrations  Security Ops    Media Jobs
      local/Orgo     MCP/Composio  restricted MCP  image/video/audio
                                     |              |
                             Pentest Copilot    Parallax-derived* 
                               OKF scanners       providers*
                                     |
                            Findings/Evidence
                                     |
                     OKF receipts/OTS/Bitcoin/Nostr
                                     |
                             Simulated Lab Manager
                             Cloud Attack Range*

*Source and licensing audits required before product claims or implementation.
```

### 31.1 Consolidated monorepo target (only create packages when implementation starts)

```text
universal-agent-platform/
├── apps/
│   ├── web/                       # Original React/TS product
│   ├── admin/                     # Operator control and tenant support
│   ├── marketing/                 # Public website, pricing, docs
│   └── desktop-installer/         # Approved self-hosted client/installer
├── services/
│   ├── api/                       # Tenant HTTP/SSE/WebSocket facade
│   ├── hermes-connector/          # Pairing, model discovery, sessions
│   ├── sid-registry/              # Signed SID identity/lifecycle
│   ├── role-catalog/              # Agency roles, signatures and deployment
│   ├── orchestration/             # Durable jobs, subagents, sagas and recovery
│   ├── execution-policy/          # Capability verification and sandbox broker
│   ├── computer-manager/          # Local, Orgo and viewer provider routing
│   ├── voice/                     # Pipecat speech and hosted voice adapters
│   ├── integrations/              # Composio/MCP and webhook adapters
│   ├── billing/                   # Subscription/credits/metering/finance logs
│   ├── security-gateway/          # Engagement approval and scoped tool proxy
│   ├── security-scanner/          # OKF Strix pipeline workers
│   ├── interactive-security/      # Pentest Copilot compatibility adapter
│   ├── security-knowledge/        # PayloadsAllTheThings corpus/index
│   ├── findings/                  # Unified issue lifecycle and remediation
│   ├── evidence/                  # OKF signed manifests and verifiers
│   ├── proof-adapters/            # OTS/Bitcoin/Nostr optional proofs
│   ├── cloud-labs/                # Lab provider, reservations, teardown
│   ├── evaluation/                # Objective agents/benchmark scoring
│   ├── creative-projects/         # Media projects, scenes, approvals
│   ├── media-jobs/                # Provider-specific generation workers
│   └── analytics/                 # Julia simulation, memory and metrics jobs
├── packages/
│   ├── contracts/                 # Versioned schemas and generated clients
│   ├── provider-sdk/              # Manifests, validation and conformance tests
│   ├── role-template-sdk/         # Role import, signing, eval format
│   ├── sid-contracts/             # Canonical identity fixtures/migrations
│   ├── security-contracts/        # Engagement, finding, receipts
│   ├── media-contracts/           # Creative projects, assets, job states
│   ├── ui/                        # Original avatar/pet rendering components
│   └── common-auth/               # Scoped claims library, not duplicate policy
├── providers/
│   ├── computers/local/           # Commercially licensed isolated desktop
│   ├── computers/orgo/            # Existing Orgo functionality preserved
│   ├── voices/pipecat-local/      # Whisper/Kokoro/Piper-if-licensed
│   ├── voices/xai/                # Existing xAI voice retained
│   ├── voices/elevenlabs/         # Paid optional adapter
│   ├── voices/gemini-live/        # Paid optional adapter
│   ├── security/pentest-mcp/      # Narrow restricted security bridge
│   ├── security/okf/             # Controlled scanner worker integration
│   ├── knowledge/payloads/        # Versioned reference importer
│   ├── labs/cloud-attack-range/   # Candidate lab provider pending audit
│   ├── creative/parallax/         # Candidate media connector pending audit
│   └── tools/{composio,mcp}/      # Vendor and generic app integrations
├── infra/
│   ├── compose/                   # Working self-hosted and dev deployment
│   ├── terraform/                 # Managed infrastructure IaC
│   ├── kubernetes/                # Production manifests where justified
│   ├── sandbox-images/            # Signed, scanned runtime/lab images
│   ├── migrations/                # Tested reproducible DB schemas
│   ├── monitoring/                # Real telemetry and alerts
│   └── secrets/                   # Templates only, no private keys
├── tests/
│   ├── unit/ contract/ integration/ e2e/
│   ├── security/ sandbox/ proof/ lab/ media/
│   ├── isolation/ load/ chaos/ restore/
│   └── fixtures/                 # Harmless owned labs, test tenants
└── docs/
    ├── design/ rights/ api/ provider-sdk/ operations/
    ├── security/ roles/ sid/ lab/ media/ pricing/
    ├── self-host/ managed-host/ enterprise/ compliance/
    └── acceptance/               # Actual release evidence
```

**Deployment profiles:** `local-core` (no paid provider); `local-security` (authorized private lab); `local-creative` (optional local model resources); `managed-core`; `managed-security` (restricted, licensed, plan-gated); `managed-creative`; `enterprise-private`. Do not start unused security, cloud lab, or GPU media services for a free user who has not selected them.

## 32. Updated five-tier entitlement matrix across every product line

**Plan policy:** Maintain the original prices as non-binding hypotheses ($0 / $29 / $79 / $199 / contract). The platform runs one real entitlement engine. Submodules do not invent secondary subscriptions without explicit product/pricing approval. A feature can be `available_byok`, `available_local`, `managed_metered`, `contract_only`, `disabled_unverified` or `not_available`; these distinctions must be visible to customers.

| Product capability | Free | Basic | Pro | Teams | Enterprise |
|---|---|---|---|---|---|
| BYO Hermes and active model | Yes | Yes | Yes | Yes | Yes |
| Hosted Hermes / managed agents | BYOK only if supported; no included managed credits | 2 registered / plan limit | 5 / plan limit | 15 / plan limit | Contract |
| Local computers / Orgo BYOK | Local and BYOK | Local/BYOK plus managed credits | Same, higher credits | Shared organization budgets | Dedicated optional |
| Local speech Pipecat/STT/TTS | Customer-hosted | Customer-hosted | Customer-hosted | Customer-hosted | Customer or dedicated deployment |
| Premium voice adapters | BYOK with approved usage | BYOK / credit eligible | BYOK / credit eligible | Org approval and credits | Contract |
| Role catalog | Curated free starter roles | Expanded roles | Full licensed catalog | Team templates and approvals | Private signed catalog |
| SID-bound persistent identities | Included for every deployed agent | Included | Included | Included + org management | Included + advanced issuer/key governance |
| Agent role change / lineage | Limited history | Version history | Audit and rollback | Team change approval | Contract retention |
| Security knowledge | Public approved excerpts | Expanded workspace search | Scopes & evidence link | Shared knowledge projects | Private catalog option |
| Local static security scans | Customer-hosted with safeguards | Customer-hosted | Customer-hosted and scheduled | Shared findings | Dedicated environment |
| Managed security scans | None included | Limited metered credits if enabled | More credits; engagement approval | Team controls; approvals | Contract |
| Interactive Pentest Copilot | Customer-owned lab only, if supported | Selected safe read-only workflows | Restricted authorized workspace | Managed team engagement | Dedicated contract |
| OKF evidence integrity | Local hash receipts/verification | Hosted verification as metered | Hosted receipts/proof requests | Team signoffs | Advanced retention and verification |
| Public Bitcoin/OTS/Nostr attestation | BYO/local, only if truly verified | Optional paid/background | Optional | Organization policy | Contract |
| Cloud Attack Range | BYO-cloud only, separate cloud charges and verified plugin | BYO-cloud | Controlled labs if enabled | Shared lab budgets | Dedicated/approved accounts |
| Objective agent benchmarks | Local fixtures | Limited runs | Expanded evaluation jobs | Shared benchmark leaderboards | Contract evaluation sets |
| Creative Studio | Local or BYOK media generation after adapter verification | Limited managed credits | Higher credits, more jobs | Team review, media collaboration | Dedicated media compute |
| Avatar/pet renderer | Basic first-party assets | Extended cosmetics | Extended cosmetics | Shared brand options | Private branded assets |
| Private teams and workspaces | No | No | No | Yes | Yes |
| Enterprise policy/SSO/regions | No | No | No | Limited documented add-ons | Contract after verified delivery |

**Do not confuse limits:** Number of *registered* agents is different from concurrent managed runs, concurrent local runs, cloud lab reservations, team seats, voice minutes and model inference units. Every limit is distinct and represented in versioned entitlements. Optional modules do not automatically consume paid provider credits when run entirely on customer hardware. Do not charge a customer twice for a provider's own API bill in BYOK mode.

### 32.1 Standard billable units and cost attribution

- Hermes model: metered tokens/request, if provider exposes accurate data; display `unknown/unbilled_by_platform` for externally billed BYOK and do not fabricate token counts.
- Hosted computers: billable instance seconds/minutes, compute class, disk provisioned GB-hours, egress MB, viewer transfer; cleanup timer continues only as documented.
- Hosted STT/TTS/live voice: measured speech seconds, rendered characters or provider unit, storage and WebRTC relay costs.
- Managed integration service: Composio tool calls/trigger events or selected connector cost; own Composio project usage must not be represented as our included shared entitlement.
- Managed security: scan worker CPU/GB seconds, authorized tool runtime, isolated VM uptime, report storage and additional provider fees.
- Managed lab: real cloud resource invoice and estimated reserve, measured runtime, public IP/storage/network charges and teardown retries; prevent liability from unbounded orphan spend.
- Managed media: verified model-specific image/video/audio per-unit prices, generation size/duration, GPU seconds when self-hosted and permanent/temporary storage.
- Timestamp/proof: proof provider/transaction/network fee only when actually incurred, transparently quote expected confirmation delay and possibility of failure.
- Subscription: included platform credits, paid top-ups, refunds and usage liability tracked with two-sided ledger entries; credits are not investment assets.

### 32.2 Productized upgrade experiences

A customer opens a locked capability → sees exactly which tier or provider is required, an estimate of resource cost, whether BYOK is allowed, and a security warning if applicable → explicitly upgrades/chooses BYOK → confirms price and scope → action is dispatched. A trial must have known end date and caps. No dark patterns, false urgency or auto-activation of metered cloud resources.

## 33. Detailed code-level integration and migration work packets

These are planned implementation units for Codex or a software team. They should map into separate reviewed pull requests with an acceptance report. Parallel work may begin only after contract and authority decisions are settled.

| Packet | Owning source | Exact work | Release gate |
|---|---|---|---|
| WP-01 | `bot-hq` | Fork/pin, baseline build, retain all existing features | Existing Hermes/Composio/Orgo/xAI E2E green |
| WP-02 | `bot-hq` | Original design, remove protected shapes/logos/names in UI/build | Asset scan and trademark/rights review green |
| WP-03 | `bot-hq` | Multi-tenant PostgreSQL + migration from SQLite | Existing local data migrated or documented fallback; isolation tests |
| WP-04 | `bot-hq` | Provider SDK + registry and conditional environment validation | Zero-optional-key boot, conformance suite |
| WP-05 | `bot-hq/Hermes` | Remote/managed Hermes gateway; honest model discovery | Same agent can switch model provider in Hermes; identity stable |
| WP-06 | `sid` | Historical canonicalization fixtures; signed neutral identity migration | Old signatures/hashes preserved; new signature verification |
| WP-07 | `agency-agents` | Fork/source audit, role importer and publisher metadata | Deterministic template hash/version and license inventory |
| WP-08 | `marketplace` | Agent installation/team deployment, rollback | Real role creates real usable agent, no phantom resources |
| WP-09 | `orgo/desktop` | Existing Orgo as adapter + local sandbox alternate | Both pass same computer actions/stream tests |
| WP-10 | `voice` | Local Pipecat/Whisper/Kokoro, optional Piper if licensed | Mic to Hermes to audible reply, cancellation and transcripts |
| WP-11 | `voice` | Preserve xAI; ElevenLabs/Gemini premium | True provider sessions, policy delegation, usage receipts |
| WP-12 | `composio/mcp` | Connection lifecycle and secure cross-provider tool broker | Writes gated even through browser/shell; revoked token denied |
| WP-13 | `pentest-copilot` | Private service; read-only scoped MCP bridge | No access to raw admin MCP token from agent or tenant |
| WP-14 | `pentest-copilot` | Allowed security tooling and sandboxed assessment | Attacks outside authorized scope blocked at network boundary |
| WP-15 | `okf` | Extract pipeline v4 into durable worker stages and normalized results | Real approved fixture scans, reliable statuses |
| WP-16 | `okf` | Evidence manifest/signatures and independent verifier | Tampering fails, HMAC migration exceptions preserved |
| WP-17 | `okf` | OTS/Bitcoin/Nostr async verification adapters | Verified only after independent proof check; no sensitive publication |
| WP-18 | `PayloadsAllTheThings` | Exact fork diff and versioned reference indexing | Retrieval cited and untrusted, no auto-execute |
| WP-19 | `cloud-attack-range` | Source/legal audit; lab provider and cost preflight | Reproducible isolated lab and verified teardown |
| WP-20 | `evaluations` | Evaluation contract, objective validators, signed score evidence | Same test repeatable; score independent of agent assertion |
| WP-21 | `parallax` | Source/legal audit; isolate reusable media workers | Real media generation job, output hashes and cancellation |
| WP-22 | `creative` | Customer project UI, edits, gallery and export | Artifact exports and provider bills match UI |
| WP-23 | `billing` | Stripe entitlements + transactional credit reservations | No double charges or negative balances under concurrency |
| WP-24 | `teams/enterprise` | Seat roles, SSO where sold, org audit and custom installs | Cross-tenant and cross-team denial tests |
| WP-25 | `operations` | Compose, IaC, monitoring, backup/restore and runbooks | Clean install, migration, rollback and restore from backup |
| WP-26 | `release` | Full provider/security/lab/media acceptance matrix | Every advertised feature passes true end-to-end tests |

### 33.1 Exact Bot HQ code targets from previously inspected upstream

`server/src/engine.ts` (Hermes home/gateway and per-agent model info), `server/src/agent/loop.ts` (in-memory queue and streamed turns), `server/src/mcp.ts` (per-bot MCP facade), `server/src/agent/tools.ts` (X search / tool permissions), `server/src/computer.ts` (Orgo shared screen and 4-screen limit), `server/src/box.ts` (local root/Orgo commands), `server/src/desk.ts` (desktop dressing/CDP), `server/src/vnc.ts` (viewer relay), `server/src/voice.ts` and `web/src/voice/*` (xAI audio), `server/src/composio.ts` / `triggers.ts`, `server/src/routines.ts`, `server/src/db.ts`, `server/src/lib/auth.ts`, `server/src/env.ts`, `web/src/avatar/*`, `web/src/components/*`, `scripts/install-on-computer.sh`, `tests/e2e.mjs`.

For each modified file: preserve existing export compatibility where possible, add real unit/contract/integration tests, document migration/rollback, and remove old direct provider calls only after adapter conformance is demonstrated. Keep old Orgo/xAI integrations available; do not delete customer functionality to make a “free” variant.

### 33.2 Exact Pentest Copilot code targets from previously inspected upstream

`backend/src/services/mcp-tools.service.ts` (wide MCP capabilities and local host validation), `backend/src/services/mcp-auth.service.ts` (bearer tokens), `backend/src/middlewares/VerifyMcpToken.middleware.ts`, `backend/src/services/agent.service.ts` (legacy independent agent loop), `backend/src/services/agent.tools.ts` / `tool-approval.service.ts` (consent gates), `backend/src/services/work-host.service.ts` (local/SSH targets), `backend/src/services/swarm.manager.ts` / `subagent.manager.ts`, `backend/src/tools/handlers/*` (actual tools), `backend/src/controllers/*` and `frontend/src/app/session/*` (security workspace UI). Existing MongoDB and Redis persistence should remain local to an isolated compatibility deployment until a deliberate data migration passes; do not try to replace them globally as a prerequisite to first integration.

### 33.3 Exact OKF code targets from uploaded archive

`strix_pipeline_v4.py`, `strix_runner.py`, `stix_webhook.py`, `stix_scanner.py`, `stix_ingester.py`, `okf_memory.py`, `okf_tool_manifests.py`, `tool_manifests.json`, `okf_profile.py`, `okf_receipt.py`, `okf_time_attest.py`, `okf_ots_verify.py`, `okf_btc_chain.py`, `okf_anchor.py`, `okf_outbox.py`, `okf_evasion.py`, `okf_agent_stamp.py`, `okf_pin.py`, Koodu time/clock helpers and example evidence/report archives. See Appendix for audited implementation notes and exact migration hazards. For other repositories, first obtain actual source trees before claiming specific file refactors.

## 34. Full expanded implementation checklist — Revision 2 additions

All entries are **uncompleted planning requirements**, not status claims. The 121 original checklist entries remain in Section 15; this checklist adds the new cross-repository scope and should be tracked in the same issue/project board.

### 34.A — Source control, licensing, product identity and scope
- [ ] Obtain exact read access or ZIP for the user's Agency Agents fork; compare to upstream and pin commit.
- [ ] Obtain exact Parallax source; establish its model providers, job runners, GUI and artifact storage.
- [ ] Obtain exact Cloud Attack Range source; pin license, cloud coverage, setup and teardown behavior.
- [ ] Obtain exact BugBase PayloadsAllTheThings fork; diff upstream and verify its license/data assets.
- [ ] Pin audited OKF archive hash and compare to its newly public GitHub HEAD before making a source-of-truth claim.
- [ ] Pin Bot HQ, Pentest Copilot, Hermes, SID and all relevant dependency commits.
- [ ] Document SID `0.1` existing schema, golden fixtures and real code coverage; design `0.2` without silently changing historic bytes.
- [ ] License-scan third-party security tools, lab images, Burp/Caido integrations, media weights, fonts, logos and user-uploaded content.
- [ ] Record CUA MIT-vs-FSL component boundary and approve the precise runtime packages selected for commercial hosting.
- [ ] Record original copyright attribution for all reused upstream code; separate trademark/artwork removal from mandatory notices.
- [ ] Decide launch modules versus feature-flagged beta; publish truthful feature availability and no-stub gates.
- [ ] Establish project-owned commercial trademark/name, documentation style, interface branding and original avatar designs.

### 34.B — Unified API, data authority and immutable contracts
- [ ] Implement versioned `AgentIdentityRecord`, `RoleTemplate`, `AgentInstallation`, `TeamTemplate` schemas and tests.
- [ ] Implement versioned `Engagement`, `ScopeGrant`, `SecurityFinding`, `ScanRun` and `EvidenceReceipt` schemas and tests.
- [ ] Implement versioned `LabTemplate`, `LabInstance`, `EvaluationScenario`, `EvaluationRun` and `TeardownReceipt` schemas.
- [ ] Implement versioned `CreativeProject`, `MediaAsset`, `MediaGenerationJob`, `MediaProviderReceipt` schemas.
- [ ] Add `source_repo`, `source_commit`, `source_digest`, `license_ref`, `review_status` to all imported templates/datasets.
- [ ] Add `provenance`, `requester_sid`, `tenant_id`, `workspace_id`, `policy_version`, `trace_id` to every action event.
- [ ] Define events for status transitions, partial results, cancellation, failure and irreversible external actions.
- [ ] Enforce tenant-unique database keys and foreign keys; verify query scoping with adversarial tests.
- [ ] Produce generated SDKs or validators for TypeScript/Python/Rust/Go and language compatibility fixtures.
- [ ] Create contract breaking-change process, migration runbooks, replay tests and backward-compatibility policy.
- [ ] Add global event IDs, causal parent IDs, idempotency keys and durable inbox/outbox for cross-service workflows.
- [ ] Implement audit logs recording exact customer/agent action, decision, budget, artifacts and external outcome.

### 34.C — SID identity and agent lifecycle
- [ ] Verify historical SID 0.1 canonical byte encoding, digest and chain fixtures in CI.
- [ ] Design signed neutral SID 0.2 profile with issuer trust, key identifiers, expiry and revocation.
- [ ] Implement SID issuance only after authenticated tenant ownership and anti-abuse checks.
- [ ] Implement SID signatures, public verification, key rotation and revocation propagation.
- [ ] Implement signed migration link old SID → new profile without silently recomputing old IDs.
- [ ] Bind SID to actual Hermes gateway, installation and authorized workspace.
- [ ] Provide live/read-only status and verified model metadata from Hermes, not a shadow config.
- [ ] Support multiple registered agents with independent secrets, file permissions and memory namespaces.
- [ ] Make agent create/pause/restart/archive/revoke work with true provider lifecycle.
- [ ] Make changing models, avatars, voice or role versions preserve SID identity and history.
- [ ] Add ownership transfer and team access revocation workflows with immutable audit.
- [ ] Make SID proof vs identity claims vs execution grant differences visible in operator documentation.

### 34.D — Agency Agents roles and workforce marketplace
- [ ] Parse actual role definition formats from the audited fork and normalize versioned descriptions.
- [ ] Import role instructions, deliverables, skill dependencies, team structures and compatibility metadata.
- [ ] Produce content hashes and signed publisher manifests for approved role releases.
- [ ] Distinguish role requested tools from granted tools in UI and API.
- [ ] Build searchable agent catalog with filters for domain, capability, plan, runtime and license.
- [ ] Implement real one-click agent installation: provisioning, SID binding, Hermes pairing and tool grants.
- [ ] Implement real team template deployment with dependency graph, messaging policies and budget preview.
- [ ] Test agent creation failure recovery so no partial Hermes homes/sandboxes persist without ownership.
- [ ] Implement role editing, private organization catalogs, template fork, version pin, rollback and deprecation.
- [ ] Implement agent transition to updated role without resetting memory or implicit scope increase.
- [ ] Implement role/task performance evaluation based on measured outcomes and human quality review.
- [ ] Add per-plan workforce limits and transparent compute/inference credit implications.
- [ ] Implement marketplace publisher authentication, package signatures, scanning, permissions review and abuse workflow before external submissions.
- [ ] Keep third-party paid marketplace and payouts disabled until actual legal/tax/payout/dispute rails exist.

### 34.E — Security operation authorization and Pentest Copilot
- [ ] Run Pentest Copilot in a private isolated service and confirm its own baseline tests.
- [ ] Replace or wrap raw MCP bearer access with tenant-scoped, short-lived, tool-specific credentials.
- [ ] Default-deny dangerous/admin MCP tools; expose read-only health/findings first.
- [ ] Create engagement initiation with proof of customer authorization and stored approver identity.
- [ ] Represent allowed targets, excluded targets, methods, rate caps, time windows and maximum spend immutably per approval.
- [ ] Enforce target/DNS/IP scope at network egress and worker dispatch, not only by prompt.
- [ ] Reject cloud metadata/control-plane endpoints and disallowed private ranges unless explicitly part of approved lab scope.
- [ ] Put Kali, browser proxies, SSH tools and security utilities in independent bounded security sandboxes.
- [ ] Require consent for high-risk actions and make all approvals one-action scoped, expiring and revocable.
- [ ] Limit parallel swarms/subagents by tenant budget and engagement rules.
- [ ] Record true command/tool outcome, timestamp, scope, image version and artifact digests.
- [ ] Implement immediate kill-switch that terminates processes, sessions, tunnels and network routes.
- [ ] Audit restricted tool set including Burp, Caido, VPN, Mythic and any elevated emulation adapters individually.
- [ ] Reconcile Pentest Copilot findings with OKF fingerprint model without inventing successful verification.
- [ ] Preserve security console UX while removing second unrelated account/LLM/billing engines from customer pathway.

### 34.F — OKF scan workers and finding lifecycle
- [ ] Re-package Strix v4 as deployable, dependency-locked, reproducible scanner service.
- [ ] Convert stages to typed, independent, restart-safe and observable jobs.
- [ ] Replace direct public runner routes with authenticated durable job API.
- [ ] Validate Git URL/repository owner and block internal SSRF/non-authorized network access.
- [ ] Implement signed GitHub and Gitea webhook adapters with size limits, replay detection and tenant mapping.
- [ ] Separate static safe checks from intrusive dynamic tests requiring additional authorization.
- [ ] Replace `/opt/ares` and fixed host references with config and sandbox-local paths.
- [ ] Verify every planned stage executes or reports `not_run/failed/skipped` with reason.
- [ ] Make a complete clean scan require all mandatory stages and valid evidence.
- [ ] Define canonical finding fingerprint; correlate repeated scans and Pentest Copilot reports.
- [ ] Implement new/recurring/resolved/fixed-candidate/retest/verified-fixed state transitions.
- [ ] Add remediation task creation, code-review approvals, and rescan triggers.
- [ ] Apply artifact encryption, redaction, retention, region and tenant access rights.
- [ ] Run real positive/negative fixtures in CI with independent expected ground truth.

### 34.G — OKF receipts and cryptographic proof
- [ ] Preserve all original 69 audited receipt bodies and their canonical verification behavior.
- [ ] Preserve explicit 8 mismatches and 4 missing archived refs as historical exceptions.
- [ ] Implement versioned artifact manifests, Merkle canonicalization and tenant-bound signed receipts.
- [ ] Use managed key custody, signer IDs, rotation, expiration and revocation checks.
- [ ] Implement independent public verifier requiring no internal database secret for public keys.
- [ ] Verify tampered, missing, reordered and incorrectly signed artifacts all fail deterministically.
- [ ] Implement proof-status state machine: not requested, pending, verified, failed, inconclusive.
- [ ] Implement OTS proof initiation, asynchronous upgrades, repeated verification and retry outbox.
- [ ] Implement independent Bitcoin chain data trust/PoW verification; do not trust stored `verified` flags.
- [ ] Support optional Nostr publication of privacy-safe hashes/commitments only.
- [ ] Prevent false statements equating integrity proof with actual vulnerability, authorization or blockchain payment.
- [ ] Implement report export with clear verified/unverified/missing evidence labels.
- [ ] Test concurrent receipt generation, linked chain integrity and durable persistence after crash.

### 34.H — Security knowledge importer
- [ ] Pin and license-check exact BugBase PayloadsAllTheThings fork and upstream source.
- [ ] Build deterministic, versioned ingestion with source commit and file digests.
- [ ] Store Markdown/docs, test dataset descriptors and artifact metadata separately.
- [ ] Tag content by verified categories/CWE/OWASP where evidence supports classification.
- [ ] Implement bounded search snippets with citation path, version, offset and content warnings.
- [ ] Treat all retrieved content as untrusted and guard against role/prompt injection.
- [ ] Prevent retrieved reference commands from executing without separate tool authorization.
- [ ] Keep potentially risky reference data off public default execution paths; allow lab-scoped fixtures only.
- [ ] Support corpus update review, rollback and reindex with no silent alteration of historic assessments.
- [ ] Add search quality, provenance and prompt-injection regression tests.

### 34.I — Cloud Attack Range and benchmark simulations
- [ ] Inspect exact candidate repo and verify real cloud provider implementation and licensed assets.
- [ ] Create lab provider interface with quote, authorization, provision, health, stop, destroy and teardown proof.
- [ ] Require cloud ownership/project mapping, region approval and maximum resource/account quota.
- [ ] Isolate intentionally vulnerable environments from production networks and credentials.
- [ ] Enforce TTL and budget reserve; cancel on insufficient credits or cloud permissions.
- [ ] Record cloud resource inventory, tags, account, region, deployment digest and estimated cost.
- [ ] Verify lab reaches expected initial state before starting agent benchmark.
- [ ] Require objective scenario validators and reproducible input seed/state fixture.
- [ ] Implement independent scoring outside the participating agents' self-reports.
- [ ] Link evaluations to SID participants, requested role versions, exact tool versions and OKF receipts.
- [ ] Enforce network and scope boundaries for all lab agents; revoke at lab expiry.
- [ ] Implement automatic teardown, orphan sweeps, cleanup retries and operator alert on leaked resources.
- [ ] Validate actual final cloud resource absence and costs after destroy.
- [ ] Make simulation rewards, if introduced later, depend on trusted scoring and anti-collusion rules.

### 34.J — Parallax Creative Studio and media providers
- [ ] Inspect exact Parallax source, rights, repo architecture and actual supported image/video/audio providers.
- [ ] Determine which existing media UI/services are reusable and which are placeholders/legacy.
- [ ] Build creative projects, scenes, shot/storyboard tasks, asset history and collaborator reviews.
- [ ] Implement versioned media job provider contracts and capability declarations.
- [ ] Connect existing Hermes creative agents; no secondary compulsory LLM.
- [ ] Support real image generation/editing through at least one fully verified permitted adapter if offered.
- [ ] Support real video generation/rendering through at least one verified permitted adapter if offered.
- [ ] Support real audio narration and streaming/export with license-safe voices if offered.
- [ ] Implement media quoting, credit reservation, progress, cancellation, provider failure and reconciliation.
- [ ] Store content hashes, provider/model/version, asset license, dimensions/duration, owner and review status.
- [ ] Build actual asset gallery, preview, search, sharing, versioning and download/export.
- [ ] Implement upload safety, MIME validation, storage quotas and deletion/retention.
- [ ] Require relevant speaker/likeness consent and document provider content restrictions.
- [ ] Implement original licensed visual studio design instead of reusing third-party trademarks/artwork without rights.
- [ ] Run end-to-end production-format media jobs (not mock PNG thumbnails or synthetic billing numbers).

### 34.K — Common policies, billing and subscription expansion
- [ ] Extend each existing plan with separately enforced roles, security, lab and media entitlements.
- [ ] Make optional modules `disabled_unverified` until an actual provider adapter passes acceptance.
- [ ] Implement BYOK, customer-cloud and platform-managed billing distinctions for every new module.
- [ ] Reserve maximum authorized cost before cloud lab, media generation or managed scan begins.
- [ ] Meter true cloud lab resources and detect orphan charges.
- [ ] Meter media units, scan workers and external proof charges by provider price table version.
- [ ] Enforce seat, active agent, active scan, cloud lab, media job and voice concurrency independently.
- [ ] Show honest current balances, pending reservations, provider bills, usage and subscription entitlements.
- [ ] Prevent racing jobs/subagents from overspending a tenant or bypassing authorization.
- [ ] Implement refunds/adjustments on incomplete or failed work using documented customer-facing policy.
- [ ] Publish pricing disclosures explaining customer-hosted vs company-hosted resources.
- [ ] Re-run worst-case gross-margin scenarios with labs/GPU media/voice added, not just chat tokens.

### 34.L — Full product UI and customer journeys
- [ ] Add first-party Agent Marketplace browse, preview, install, team deployment and agent history.
- [ ] Add SID identity display, issuer verification status, role version, key rotation/revocation indicators.
- [ ] Add dedicated Security Workspace with authorized engagements and explicit boundaries.
- [ ] Add security console with progress, findings, approvals, rescan and report evidence state.
- [ ] Add knowledge search and source-linked security reference viewer.
- [ ] Add Lab Catalog with transparent cloud costs, targets, expected objectives and teardown controls.
- [ ] Add Evaluation Dashboard showing objective scores and underlying receipt/evidence status.
- [ ] Add Creative Studio project board, asset gallery, media job histories and export flows.
- [ ] Add provider catalog/marketplace with local/BYOK/paid/hosted classes and real prerequisites.
- [ ] Add per-module permission, budget and credit controls with usable mobile layouts.
- [ ] Integrate original animated avatars into agent identity display without conflating them with SID.
- [ ] Make every new screen backed by real tenant-scoped APIs and live data, never fixtures in production.

### 34.M — Full production QA, security and operations
- [ ] Add end-to-end test datasets with safe intentionally vulnerable first-party applications and controlled labs.
- [ ] Add unit, integration, provider contract, scenario, security, cross-tenant and rollback tests for each new service.
- [ ] Test prompt injection through role-template docs, knowledge snippets, external webpages and security logs.
- [ ] Test remote callback/WebSocket/MCP authorization and credential revocation.
- [ ] Test lab/proof/media job cancellations mid-operation and crash/retry idempotency.
- [ ] Run dependency/SBOM, license, model rights, asset rights and secret scans on every release build.
- [ ] Run manual security assessment focused on the security tool broker, sandbox escape and cloud lab egress.
- [ ] Test evidence verification after migrations, key rotation and restored backups.
- [ ] Test customer billing invoice reconciliation for all module types with production-like usage.
- [ ] Prove self-hosted core boots and works without Orgo, xAI, cloud lab provider or paid media keys.
- [ ] Prove all enabled providers have real credentials/config, real actions and real measurement.
- [ ] Produce full operator runbooks, customer docs, incident playbooks, status page and support pathways.
- [ ] Run staging pilot with signed acceptance and record every unresolved blocker by severity.


## 35. Expanded real-service acceptance suite (extends original E2E-01 to E2E-24)

Each test has a reproducible fixture, environment, actor, inputs, expected result, budget, log trace and preserved execution evidence. Where a provider requires paid credentials, test it in explicitly funded staging and disable its catalog entry until the corresponding real test passes. The product cannot claim module availability from unit mocks alone.

| Test ID | Real scenario | Required acceptance outcome |
|---|---|---|
| E2E-25 | Create agent from Agency role | Source/version/license pinned, permissions previewed, new agent SID issued and Hermes run succeeds |
| E2E-26 | Reuse role template | Two customer agents share template but never identity/memory/credentials |
| E2E-27 | Role version upgrade | Preserves SID, authorized memory, and historical evaluation; rollback works |
| E2E-28 | Change model/voice/computer | SID remains stable; actual provider change reflected, all jobs intact |
| E2E-29 | SID identity verify | Correct issuer signature and canonical bytes accepted; tampered document rejected |
| E2E-30 | SID legacy fixture | Existing `sid/0.1` golden hashes unaffected by `sid/0.2` schema |
| E2E-31 | SID revocation | Revoked agent loses access to tools, sessions and sandbox at enforcement boundary |
| E2E-32 | Specialist team deployment | Role composition resolves into independently authorized, working Hermes agents |
| E2E-33 | Template tool injection | Malicious template text cannot expand tool grants or tenant scope |
| E2E-34 | Security engagement registration | Customer ownership evidence and approved targets bound to exact policy version |
| E2E-35 | Security read-only tools | Scoped security agent can fetch allowed status/findings, not platform admin secrets |
| E2E-36 | Security interactive lab | Approved Pentest Copilot workflow runs inside isolated first-party/authorized lab |
| E2E-37 | Out-of-scope security action | Network and dispatcher block disallowed target, even if Hermes/tool requests it |
| E2E-38 | Expired approval | Revoked/expired engagement cannot start new scan or continue active traffic |
| E2E-39 | Security emergency stop | Agent commands, tunnels, pending jobs and network paths terminate with receipts |
| E2E-40 | Security concurrency policy | Multiple delegated agents cannot exceed scope, budget, or active-task cap |
| E2E-41 | OKF positive fixture | Known planted issue detected with source, severity rationale and real evidence |
| E2E-42 | OKF negative fixture | Green report only after every required scanner stage actually succeeded |
| E2E-43 | OKF failed stage | Unknown/incomplete result is displayed, never a verified clean report |
| E2E-44 | OKF source webhook | Signed GitHub/Gitea callback maps to intended tenant/repo/commit once |
| E2E-45 | Findings reconciliation | Pentest and OKF results deduplicated by canonical fingerprint, with provenance retained |
| E2E-46 | Remediation/rescan | Reviewer-approved fix triggers scan; verified-fixed only after validated check |
| E2E-47 | Existing OKF receipt validation | 69 stored receipt IDs preserve original canonical self-consistency |
| E2E-48 | Historical evidence exceptions | 8 mismatches and 4 missing refs explicitly identified, no fabricated verification |
| E2E-49 | Tampered evidence | Independent verifier rejects modified or missing artifacts and malformed chain refs |
| E2E-50 | Public signature verification | Valid signed receipt verifies using public key without private signing material |
| E2E-51 | OTS/Bitcoin external proof | State `verified` only after independently validated proof, otherwise pending/inconclusive |
| E2E-52 | Nostr publication privacy | Only hash commitments published, no private findings, logs, keys or customer identifiers |
| E2E-53 | Knowledge search | Returns versioned excerpt, file path, citation and untrusted provenance |
| E2E-54 | Knowledge prompt injection | Content cannot override system policy or invoke an unrestricted security action |
| E2E-55 | Reference update | Updated fork index produces new version; historical cited outputs remain reproducible |
| E2E-56 | Lab quote and approval | Worst-case proposed cost and account/resource limits presented before provisioning |
| E2E-57 | Lab creation | Disposable range starts only under approved cloud project and isolated network |
| E2E-58 | Objective benchmark | Independent scorer validates expected condition without using agent's self-rating |
| E2E-59 | Lab kill and teardown | All created resources removed; independent inventory and billing check show cleanup |
| E2E-60 | Orphan resource recovery | Crash leaves registered resources; sweeper retries teardown and alerts operator |
| E2E-61 | Cross-tenant lab attack | Tenant A cannot discover or manipulate B's cloud project, jobs or lab artifacts |
| E2E-62 | Creative project onboarding | Create project/scene, assign Hermes specialist and persist workflow history |
| E2E-63 | Real image/media job | Approved provider renders actual asset with declared file format and hash |
| E2E-64 | Real video/media job | Render completes or returns honest capability/error state; no placeholder video asset |
| E2E-65 | Real audio narration | True file produced by licensed voice provider and linked to source/consent as required |
| E2E-66 | Creative job cancellation | Billing reservation partially settles/refunds correctly and resources stop |
| E2E-67 | Creative collaboration | Member without permission cannot export/delete another member's protected media |
| E2E-68 | Mixed provider media workflow | Hermes is reasoning authority while each media job uses explicitly selected provider |
| E2E-69 | Five plan new module gates | Role catalog, security, lab, media, evidence all respect tier and spending limits |
| E2E-70 | Mixed-module budget attack | Simultaneous media+scan+voice+lab jobs cannot overspend same credit account |
| E2E-71 | Free tier zero-paid-key boot | Local agent, role, local voice and permitted local tools work with no Orgo/xAI accounts |
| E2E-72 | Multi-module account deletion | Sessions, lab resources, proof metadata, media and security artifacts handled per deletion/retention policy |
| E2E-73 | Fully rebuilt deployment | Clean operator machine launches product and sample modules without private developer files |
| E2E-74 | Network partition recovery | Durable jobs, credits and signed receipts remain correct after worker/provider outage |
| E2E-75 | Source license audit | All packaged dependencies, models, artwork, security datasets and media assets have permitted rights |
| E2E-76 | Cross-service observability | Customer action is traceable from request through Hermes, tools, sandbox, credits and deliverable |

**Contract verification:** for each optional provider advertised (Orgo, local sandbox, Pipecat, xAI, ElevenLabs, Gemini Live, Composio, Pentest Copilot, OKF, labs, media) add provider-specific tests for credentials, timeouts, disconnect, authorization, quota, actual artifact, usage receipt and cleanup. A disabled optional provider is not a stub: it is explicitly excluded from product claims and from customer selection until completed.

## 36. Launch-blocking security, financial and operational release gates

### 36.1 Security gate (P0)

The following are automatic release blockers:

- Any tenant can access another tenant's Hermes credentials, SID private keys, role catalogs, conversations, desktop stream, raw security logs, billing data, lab resources or media outputs.
- A role definition, retrieved security document, scanner finding, browser page, voice utterance or agent response can grant new permissions without policy approval.
- A scanner/proxy/interactive security worker can initiate network requests outside approved engagement targets or cloud labs.
- Any unapproved security tool can reach host Docker socket, cloud metadata, production internal services, or the company admin control plane.
- A self-hosted or free-tier account can generate unlimited company-funded cloud/voice/media/lab costs or spend more than authorized credits.
- Public MCP admin tokens, unencrypted provider secrets, dangerous dev-login flags or unrestricted root shells are available on production endpoints.
- Cloud labs are not tracked by resource inventory/TTL, or fail to terminate on cancellation/plan expiry.
- Legacy OKF receipt anomalies are hidden or migrated as successful proof without independent verification.
- Source redistribution of protected Grok artwork, unlicensed Parallax assets, restrictive CUA components or other copyrighted assets without proper rights.
- Paid/managed providers are enabled without real acceptance testing and incident response ownership.

### 36.2 Financial gate

Subscription/credits must be backed by real data, signed processor events, transactional balances and reconciled provider charges. Customer-visible quotes show provider/class, units, maximum authorized amount and who pays. No negative-credit races; no metering based on model-estimated tokens when authoritative usage is absent. Corporate admin credit edits require separate audit and business approval. Cloud labs have explicit third-party billing disclosures and budget enforcement; app cannot guarantee stopping an external cloud invoice solely from a UI timer.

### 36.3 Reliability gate

Every deployed module has readiness, liveness, metrics, alerting, log redaction, rollback, backup/restore, and least-privilege secret handling. Durable workflows distinguish `queued/running/awaiting_approval/cancelling/succeeded/failed/incomplete/expired`. A crash mid-tool or mid-cloud resource creation must reconcile instead of duplicating charges or orphaning jobs. Staging tests must include real interruptions, not only successful-path assertions.

### 36.4 Commercial rights gate

Legal review must separately address: MIT licenses and notices; upstream Agency Agents role-content rights; copyright/trademark on Grok-inspired branding; Parallax media assets and provider ToS; PayloadsAllTheThings fork and contributor content rights; Pentest Copilot third-party security products and tooling restrictions; Cloud Attack Range licensing and cloud provider service terms; CUA SDK/core vs restricted CUA Spaces; Piper software/voice weights; Kokoro and image/video model-specific licenses; payment terms; user output and training/data-use policies.

## 37. Codex development operating protocol — end-to-end, no stubs

### 37.1 Work ordering

**Foundation gate:** Baseline upstream tests, license inventory, branding removal, tenant model, provider SDK, authorized Hermes pairing, billing policy. No public sandbox or paid accounts until complete.

**Core agent gate:** Local/Orgo computer contracts, local/xAI voice parity, Composio/MCP execution grants, SID identity, role import/installation. All have real UI and real provider execution.

**Security gate:** Read-only Pentest status/findings → authorized scanning → restricted interactive tools → OKF receipts/proofs → knowledge index. No broad security MCP admin token in production.

**Creative/simulation gate:** Parallax source audit → real media jobs/project UI; Cloud Attack Range source audit → costed disposable labs → reproducible objective evaluation and teardown. Independent launch flags are acceptable **only when a module is clearly excluded from marketed and paid scope**.

**Commercial launch gate:** Signed payment processor integration, all entitlements, team permissions, support/legal operations, load/stability/security, real-customer pilot, release signing.

### 37.2 Definition of done on each pull request

- Requirement IDs and source/input commit recorded.
- Production code implements the behavior with no TODO backend, nonfunctional handler or fake fixture state in UI.
- Unit/contract/integration tests added and passing; secret/tool/scoping tests for any new privilege.
- Tenant, SID, authorization grant and budget requirements traced through the action path.
- Idempotency, cancellation, retries, timeout, concurrency and cleanup documented and exercised.
- DB migration/rollback and upgrade impact included, if persistence changed.
- Provider SDK/firmware/licenses pinned; any external connection mock confined to unit tests.
- UI includes real loading/error/empty/permission and accessibility states, not fake success.
- Costs captured via actual usage reports or honest unknown state, no fabricated measurements.
- Security analysis records any elevated permissions or new external network destination.
- Generated OpenAPI/Proto/SDK contracts match implementation and changelog.
- CI gates pass on clean environment; package can install on supported target without developer secrets.
- Reviewer approves and attaches test/report evidence before marking completion.

### 37.3 Inter-repository merge policy

Do not indiscriminately copy all upstream repositories into one Node process. First compare dependency graphs, isolate unique capabilities, pin the source version, and choose: **adapt via MCP/API**, **vendor a clearly licensed reusable library**, or **independently reimplement a well-understood capability**. Preserve upstream license notices. Where Pentest Copilot, Parallax or Agency Agents maintain independent configurations, translate to platform contracts and keep compatibility adapters rather than creating multiple competing customer billing/identity/reasoning authorities. Avoid monolithic migrations; make reversible changes.

### 37.4 Developer acceptance evidence artifacts

For every work packet, store `work_packet_id`, issue/PR URL, git SHA, build image digest, unit results, contract results, security results, deployment region/environment, approved test credentials class, safe fixture references, runtime logs/redactions, provider receipts, performance measurements, migration proof and the known limitations or blockers. End users should see only verified capabilities in release notes, not work-in-progress promises.

## 38. Release packaging, self-hosted profiles and operator guide

### 38.1 Supported installation experiences (build and test)

1. **Free self-hosted:** Install product, connect local/existing Hermes, choose approved role/agent, select local computer or owner-provided sandbox, optionally local Pipecat voice, load user-managed MCP/Composio; no mandatory xAI/Orgo billing credentials. Supply realistic RAM/CPU/GPU minima based on actual local models and agents.
2. **Free security lab:** Only on a local owner-controlled machine or environment with explicit permission; import reference corpus and run nonintrusive safe static fixtures. Active network testing requires engagement scope and isolated security environment.
3. **Paid managed core:** SaaS account, Stripe subscription, hosted or external Hermes, first-party secure cloud desktop, provider routing, voice, credits and no cross-tenant access.
4. **Paid security workspace:** Approved engagement and separate security worker, restricted MCP, OKF reports and optional signed receipts.
5. **Paid Creative Studio:** Project/asset manager, verified media adapters and actual generation, accurate usage accounting.
6. **Paid disposable lab:** Customer-owned or approved managed cloud project, budget reservation, independently verified provisioning/teardown and objective scoring.
7. **Teams/Enterprise:** Org identity, private catalogs, role approvals, audit, SSO/region/dedicated services where actually implemented/contracted.

### 38.2 Install/upgrade/uninstall requirements

Scripts must detect OS/architecture, prerequisites and missing optional services; create TLS/secrets only through approved flows; support volume persistence; preserve Hermes settings unless user approves edits; perform safe zero-downtime upgrade when supported, a rollback or tested maintenance workflow otherwise; test complete app uninstall with retained/exportable customer data and no stranded cloud resources. Document migration from original Bot HQ SQLite/Orgo layout and old names to new normalized schema; preserve source history and license attributions.

### 38.3 Operations and support

Build operator console for account support, disabled providers, quotas, failed jobs, suspended security engagements, lab orphan inventory, proof queue, media render backlog and billing reconciliation. Implement incident runbooks for cloud cost spikes, exposure of an API key, potential sandbox escapes, copyright complaint, security testing abuse, unverified evidence in report, external provider outage and lost wallet/key only if any on-chain optional feature is enabled. Document on-call escalation, disaster recovery and customer notifications.

## 39. Success metrics and commercial validation

Measure **verified value**, not just number of agents or API calls. Proposed KPIs:

- Customer onboarding completion: first functioning Hermes agent, first local tool, first completed task without support.
- Specialist activation: percentage of selected role templates that produce a genuine working agent with minimum required tools.
- Task success: externally evaluated completion and human acceptances, not self-declared by the model.
- Security outcomes: confirmed findings, time-to-triage, verified remediation, false-positive rate, target scope compliance.
- Evidence: receipts independently verified, integrity failures detected, proof pending times and reconciliation success.
- Cloud labs: objective evaluation success, average cost per scenario, resource cleanup success, orphan cost.
- Media: completed valid exports, revision loops, rendering success, unit economics and rights issues.
- Platform quality: release defects, incident minutes, support load, queue latency, media/voice turnaround and computer session uptime.
- Economics: acquisition cost, trial-to-paid conversion, subscription churn, net revenue retention, credit burn, per-plan contribution margin and externally invoiced usage.

No paid marketing claims about certified penetration testing, security guarantees, financial returns, third-party provider endorsement, external chain attestation or reliable agent competence without corresponding verifiable evidence.

## 40. Product ownership, verification and external action gates

**Inputs required from the owner (business decisions, not code stubs):** commercial name/domain; merchant/tax jurisdiction; final prices/allowances and refund policy; budget/cloud accounts; scope of authorized security services; supported jurisdictions; privacy/terms choices; provider commercial contracts/keys; choice of initial launch modules; actual repo access for still-unverified modules; employer/human supervision requirements for teams; when/how SID issuer keys should be managed. Sensitive credentials stay in secure secret storage, never in public issue text or prompts.

**Do not perform without explicit operational authorization:** live paid cloud provisioning, external network security testing, creating charges/merchant accounts, public deployment of high-risk tools, private key rotations, material data deletion, blockchain transactions, irreversible migrations or sending customer communications. The build specification may describe these as required flows; actual completion requires real access and owner confirmation.

**Unified final release rule:** every marketed capability—general agents, role catalog, SID, voice, computers, Composio, security, OKF evidence, knowledge, labs, creative, billing and teams—must have an actual implementation, truthful readiness, tenant isolation, measured costs, tests and documentation. An unverified module may remain in the roadmap but must not appear available for purchase or use. A company cannot be described as live until real deploy/merchant/security gates pass.

## 41. Revision history and source register

| Version | Scope |
|---|---|
| Baseline (Nov 14, 2026) | Bot HQ commercial SaaS, Hermes provider neutrality, computers/voice, 5 plans, billing, original avatars, operations; 121 baseline checkboxes. |
| Revision 2 (Nov 14, 2026) | Adds Pentest Copilot, OKF, PayloadsAllTheThings, Cloud Attack Range, Parallax candidate studio, SID identity, Agency Agents workforce marketplace, cross-service contracts and expanded checklists/test matrix. |

**Primary references / owned materials:**

- [Bot HQ](https://github.com/nickvasilescu/bot-hq) — upstream source reviewed in earlier turn; `[LICENSE]` MIT, Hermes/Orgo/xAI/Composio original scope.
- [Pentest Copilot](https://github.com/bugbasesecurity/pentest-copilot) — source reviewed in earlier turn; MIT source, scoped MCP modernization necessary.
- `okf-security-pipeline-main.zip` — user-provided snapshot and the accompanying `okf_security_integration_audit.md`, copied into the complete document below.
- [PayloadsAllTheThings (BugBase fork)](https://github.com/bugbasesecurity/PayloadsAllTheThings) and [upstream](https://github.com/swisskyrepo/PayloadsAllTheThings) — exact fork diff pending verification.
- [Cloud Attack Range (BugBase)](https://github.com/bugbasesecurity/cloud-attack-range) — exact source audit and rights pending.
- [Parallax](https://github.com/nickvasilescu/parallax) — exact source audit and rights pending.
- [Agency Agents upstream](https://github.com/msitarzewski/agency-agents) — exact user fork pending.
- [SID](https://github.com/cryptonomicsed-byte/sid) — earlier saved source audit and migration design; current head pending revalidation.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — runtime engine.
- [Pipecat](https://github.com/pipecat-ai/pipecat), [Faster Whisper](https://github.com/SYSTRAN/faster-whisper), [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) — local audio building blocks.
- [AgentDesk](https://github.com/agentsea/agentdesk), [CUA](https://github.com/trycua/cua) — candidate local computer components; commercial license boundaries must be audited.
- [OpenTimestamps](https://opentimestamps.org/) — independent timestamp specification and verifiers where used by OKF.

**Independent release verification required:** Do not use an unreviewed README claim as a passed test; source, model licensing, live provider behavior, browser UI, payment callbacks, cloud-resource cleanup and cryptographic proofs need separate evidence.

---

## Appendix A. OKF Security Pipeline Source-Level Audit (preserved reference)

The following is the previously generated detailed OKF addendum, incorporated into the master blueprint for completeness. It concerns the uploaded ZIP snapshot, **not** a guarantee that the latest GitHub revision has matching code. The appended original counts and findings are retained verbatim unless clearly superseded by Revision 2.


# OKF Security Pipeline — Verified Audit and Universal Platform Integration Blueprint

**Source:** `okf-security-pipeline-main.zip` provided by the project owner. **Reviewed:** November 14, 2026. **Status:** Source-level and archive-integrity audit, not live penetration testing or production acceptance.

### Audit header

| Dimension | Finding |
|---|---|
| Summary | Keep OKF as the automated security pipeline, finding-history, evidence-integrity and time-attestation service; integrate with Pentest Copilot's interactive security workspaces through Hermes and the universal Bot HQ platform. |
| Threat model | Untrusted customer code, unsafe scanner subprocesses, unauthorized network targets, cross-tenant access, leakage of scan artifacts, webhook forgery, falsified evidence claims, and missing or tampered history. |
| Tests | 26 Python modules parsed successfully. 69/69 receipt identifiers recomputed. 69 entries in 40 ledger files match receipt JSON files, with no adjacent-link breaks found. 506 artifact hashes matched; 8 mismatched; 4 referenced artifact files missing from this ZIP. |
| Invariants | No scan without target authorization; no arbitrary host execution; no evidence silently marked valid when missing or mismatched; no unapproved provider charges; never call timestamp presence on-chain settlement. |
| Diacritics | Preserve canonical Yorùbá names in project-internal documentation. Public SaaS service and API names remain neutral. |

### 1. What the archive actually contains

- 1,544 ZIP entries, approximately 9.4 MB uncompressed.
- **26 Python files**, including four generations of the Strix security pipeline, a FastAPI runner, security webhook, static scanner, threat-intelligence ingester, cryptographic receipt service, Nostr publisher, Bitcoin header verifier, OpenTimestamps verifier, clock MCP adapter, and finding-history service.
- `tool_manifests.json` declares **15** executable/tool entries with input/output schema, capabilities, side effects, timeout and audit metadata.
- `security_receipts/` contains **69** receipt JSON files and **40** ledger JSONL files, plus OTS and time attestation sidecars. `security_reports/` contains **674** report/evidence files.
- `docs/ARCHITECTURE.md` is an explicit statement of implemented features, dependencies and gaps. `docs/REDTEAM_ENHANCEMENT.md` documents experiments, fixes and partially completed integrations.
- Systemd timers/services support outbox drain, clock tick, Bitcoin deeper verification and OTS upgrades.
- No root `README.md`, `LICENSE`, standard `tests/` directory, `pyproject.toml`, `requirements.txt`, CI workflow, or reproducible container build manifests were present in the uploaded archive.

### 2. Repository map

| Module | Code-supported role | Integration disposition |
|---|---|---|
| `strix_pipeline_v4.py` | Leading pipeline: secret detection, Strix AI analysis, conditional probes, memory/history updates, evidence, receipts, OTS, optional Nostr, Vantage sink | **Keep, refactor into scoped worker and typed workflow** |
| `okf_pipeline.py`, `strix_pipeline.py`, `strix_pipeline_v2.py`, `strix_pipeline_v3.py` | Earlier pipeline generations and compatibility scripts | **Archive behind migration tests; do not use as production entrypoints** |
| `strix_runner.py` | FastAPI run/status endpoints, in-memory thread queue, git clone and Strix invocation | **Replace with durable authenticated worker/queue API** |
| `stix_webhook.py` | Gitea push webhook with signature validation and pipeline dispatch | **Replace with tenant-scoped authenticated event ingestion** |
| `stix_scanner.py` | Regex-based source-code issue discovery | **Keep as a low-cost heuristic scan, do not treat as proof of vulnerability** |
| `stix_ingester.py` | External threat intelligence ingestion and STIX-format emission | **Keep as enrichment module with source provenance** |
| `okf_memory.py` | Append-only per-repo issue history, fingerprints and finding transitions | **Keep; migrate to tenant-scoped findings database and versioned history** |
| `okf_tool_manifests.py`, `tool_manifests.json` | Source-level executable discovery and descriptive capability manifests | **Keep; enforce capabilities at runtime in a separate policy gate** |
| `okf_profile.py` | Ephemeral per-run profile, goal, capabilities and lifecycle | **Keep structure; bind to authenticated Hermes/agent identity** |
| `okf_receipt.py` | Canonical JSON hashes, Merkle evidence roots, HMAC signature, linked receipts, offline verification | **Core reusable evidence service** |
| `okf_time_attest.py`, `okf_sid_anchor.py`, `okf_ots_verify.py` | Timestamp attestations and verification | **Keep as asynchronous optional proof adapters with explicit state** |
| `okf_btc_chain.py`, `okf_pin.py`, `koodu_clock.py`, `koodu_time.py`, `okf_now.py`, `okf_clock_mcp.py` | Bitcoin header continuity, pin roots, time windows and local agent tools | **Keep; extract verifier, formalize MCP SDK integration and tenant access** |
| `okf_anchor.py`, `okf_outbox.py` | Nostr publishing and SQLite retrying outbox | **Keep; publish only public commitments, never sensitive full evidence** |
| `okf_evasion.py` | Twelve-transform normalization/prompt-injection defense evaluation harness | **Keep as defensive regression evaluation module** |
| `okf_agent_stamp.py` | Agent-facing timestamp/stamp utility | **Connect to evidence service after identity binding** |

### 3. Offline integrity audit results

The review used `zipfile`, Python AST parsing, `hashlib` and JSON decoding. **The scanners, shell commands, remote agents and external security tools were not executed.**

1. All **26** `.py` files parsed without Python syntax errors.
2. All **69** `receipt_id` values matched SHA-256 of each receipt's canonicalized, unsigned body (per `okf_receipt.py`). This checks receipt self-consistency but **not author authenticity**.
3. All 69 ledger rows mapped to a receipt in the archive. Adjacent `prev` IDs and chain indices in the 40 ledger files were internally consistent.
4. **506** referenced evidence file hashes matched their archived bytes.
5. **8** file hashes did not match: older `report.json`/`report.md` artifacts under `full-stack-demo` and `mem-demo`. Documentation notes that reports were later excluded from receipt hashing because subsequent editing invalidated historical references. Preserve as historical integrity exceptions.
6. **4** referenced files are absent from the archive: `clocktest/a.txt` and three `scan-canary/.../raw/betterleaks.log` files. The `.gitignore` explicitly excludes some canary logs; absence in ZIP does not prove absence on the original machine.
7. **66** `.attest.json` records include stored Bitcoin checks; their claim of validity is **not independently verified** in this audit. `.ots` binary files and Bitcoin PoW proofs were not independently cryptographically checked against an external chain source; the receipt HMAC keys are not supplied.

**Important:** A valid evidence hash/Bitcoin timestamp supports integrity or existence claims; it does not prove a vulnerability finding was correct, a target was authorized, or a Move blockchain settlement happened.

### 4. Source-level operational and security gaps

#### P0 — Must address before exposing commercially

- **Authorization/scope:** A target URL passed to `strix_pipeline_v4.py` influences scanning, but the pipeline has no production-grade proof of target ownership, allowed CIDR/domain, allowed test techniques, or network egress enforcement. `classify_target()` is a routing convenience, not target authorization.
- **Execution boundary:** `tool_manifests.json` declares tool permissions, but `okf_tool_manifests.py` scans command patterns in only `strix_pipeline_v4.py` and `okf_receipt.py`. `require_coverage()` checks missing manifests; it does **not** prevent a declared subprocess from executing outside its permitted targets. The Strix LLM agent's internal tool execution is not capability-constrained by these manifests.
- **Runner API:** `strix_runner.py` implements `/run` and `/run/{id}` without authentication, uses process-local thread/dictionary state, accepts arbitrary `clone_url`, and chooses the latest global Strix report. It binds loopback by default but is **not appropriate for direct public exposure**. Run IDs are lost on restart. Supersede with a durable job service.
- **Webhook:** `stix_webhook.py` defaults its `STIX_WEBHOOK_SECRET` to a string embedded in source, listens on `0.0.0.0`, reads unbounded request bodies from `Content-Length`, and creates subprocesses using values originating in event metadata. Require externally provisioned secrets, body limits, replay protection, validated repository identity, and managed queues. Never expose this handler unchanged.
- **Tenant privacy:** `security_reports/` includes raw tool logs, SQL dump CSVs and other security artifacts. Do not make them public by default; classify, encrypt, minimize and retention-control them. Before relying on the newly public repo for distribution, review historical commits and every stored report for real credentials or personal data; rotate any genuine exposed keys.
- **Evidence signing:** `okf_receipt.py` uses local HMAC key files and JSONL ledger. Production needs secure key custody, key IDs/rotation, actor/tenant binding, concurrency controls, append-only storage controls and independently verifiable signed receipts.

#### P1 — Must address for production reliability

- Replace absolute `/opt/ares/...`, `/root/...`, loopback ports and environment-specific paths with portable configuration and sandbox-local mounts.
- Replace direct Gitea/Vantage posting with signed, tenant-scoped event adapters and durable outboxes; distinguish queued from delivered.
- Deduplicate the older `strix_pipeline*` variants; standardize on a versioned runner based on v4.
- Make `status=FAILED`, tool-not-run, `skipped`, `incomplete`, `unverified`, `pending`, and `verified` explicit throughout scan, report and receipt models. Never turn a missing scan into a clean scan.
- Implement retention, tamper-evident provenance, immutable artifact storage and asynchronous proof upgrades.
- Separate finding state history (`okf_memory.py`) from LLM agent memory and from receipt evidence; these are different data models.
- Add tests, packaging, compatibility matrix, reproducible container images, dependency checks and licensed-asset inventory.

#### P2 — Architecture extensions

- Integrate per-workspace report/export and release gates (security scan pass criteria).
- Expose optional proof publication via Nostr/OpenTimestamps; keep failed or offline proof requests queued, not silently successful.
- If your ecosystem needs Move/Sui settlement, design it as an additional signed-receipt consumer. It is absent in this repository and must not be described as already implemented.
- Preserve the `okf_evasion.py` regression harness as a separate productized safety evaluation, not as a guarantee of prompt-injection immunity.

### 5. Product split across all three systems

| Layer | Owning system | Authority |
|---|---|---|
| SaaS accounts, tenants, billing, quotas, teams and UX | Universal Bot HQ successor | Control plane |
| Agent reasoning, model, planning, persistent Hermes home | Hermes | Agent execution authority |
| Interactive authorized assessment, Burp/Caido/SSH/VPN/browser/Kali tools | Pentest Copilot adapted as restricted security provider | Specialized operational tools |
| Scan orchestration, deterministic probes, code scanning, finding transitions | OKF security worker | Scanning and classification |
| Cryptographic evidence receipts, OTS, Bitcoin verification, Nostr publication | OKF evidence service | Evidence integrity and time claims |
| Security authorization policy, tenant isolation, rate limits, target restrictions | Shared policy/sandbox layer | Always authoritative, outside the LLM |
| Customer reports, remediation tickets, team approvals | Universal product security workspace | Unified presentation / business workflows |

**Avoid duplicated reasoning.** Pentest Copilot's independent LLM orchestration is a standalone-mode compatibility feature. In integrated mode, Hermes owns model reasoning and delegates explicitly authorized operations to the security service.

### 6. Suggested implementation service boundaries

```text
apps/web                          customer application
apps/admin                        company administrative application
services/agent-gateway             Hermes pairing, lifecycle and task events
services/security-gateway          authenticated engagements, policy and scoped MCP
services/security-worker           OKF v4 stages, findings and report extraction
services/interactive-security      Pentest Copilot adapters, Burp/Caido/lab controls
services/evidence                   receipt issuance, verification and immutable manifests
services/proofs                     OTS, Bitcoin verification, optional Nostr publication
services/queue                      durable jobs, retries, cancellation, rate limits
services/billing                    subscription entitlements, metering, credits
packages/security-contracts        typed engagement/findings/report/proof schemas
packages/tool-manifests            versioned capability descriptions and dispatch policy
infra/sandbox-images               isolated, permission-scoped test environments
infra/deploy                       local and managed deployment stacks
```

Recommended policy flow:

```text
User/Team > authorized engagement request > API auth & billing
     > ownership + scope verification > execution policy / sandbox egress
     > Hermes specialist agent > scoped security tool execution
     > OKF scan stages and/or Pentest Copilot interactive tools
     > normalized findings > evidence artifact storage > signed receipt
     > optional async Bitcoin/OTS/Nostr proof > report & remediation actions
```

#### Contract fields (minimum)

- `Engagement`: `tenant_id`, `workspace_id`, `id`, `authorization_evidence`, `allowed_targets`, `excluded_targets`, `allowed_methods`, `start_at`, `end_at`, `rate_limits`, `approval_policy`, `requested_by`, `status`.
- `ScanJob`: `id`, `engagement_id`, `agent_id`, `hermes_session_id`, `git_ref`, `commit_sha`, `input_digest`, `executor`, `tool_version`, `sandbox_id`, `started_at`, `completed_at`, `state`, `failure_reason`, `usage`.
- `Finding`: stable fingerprint, canonical category, CWE/CVSS when substantiated, confidence, affected component, probe method, evidence refs, remediation, reviewer decision, first/last seen, status.
- `EvidenceReceipt`: hash algorithm, canonicalization version, immutable artifact manifest and digest, Merkle root, signer and key ID, previous receipt, creation times, optional external proof references and explicit proof state.

### 7. Full development checklist / gates

#### Repository baseline
- [ ] Pin Bot HQ, Pentest Copilot and OKF commits; preserve original upstream licenses/notices.
- [ ] Add a project-owned license and rights inventory for OKF's own code and third-party scanner dependencies.
- [ ] Categorize all 674 archived report files; quarantine credential/PII/secret-bearing examples from public distributions.
- [ ] Record and explain historical 8 hash mismatches and 4 missing files; never mutate signed history to hide these exceptions.
- [ ] Add reproducible Python package metadata, dependency locks, formatting/typecheck/security scanning and CI.
- [ ] Write an integration test matrix and production acceptance policy.

#### Security control plane
- [ ] Implement tenant/workspace identity, engagement approval, ownership evidence and target-scope registry.
- [ ] Enforce outbound network boundaries on the isolated security sandbox, not by prompt or manifest alone.
- [ ] Enforce per-tool capabilities, time limits, resource quotas and event-level approvals.
- [ ] Add default-off controls for intrusive scanning and all high-risk tools.
- [ ] Implement audit logs, privacy redaction, data retention/deletion, and kill switches.
- [ ] Require short-lived scoped credentials for MCP, jobs and viewer sessions.

#### OKF worker modernization
- [ ] Extract `strix_pipeline_v4.py` into testable stages with typed job inputs and structured stage results.
- [ ] Replace `/opt/ares` paths and hardcoded host addresses with sandbox config.
- [ ] Deprecate or migrate legacy pipeline variants and the in-memory FastAPI runner.
- [ ] Support GitHub, Gitea and generic repository webhook adapters with request signatures, replay protection and scope mapping.
- [ ] Ensure no skipped, errored or unavailable scan can produce a clean assessment.
- [ ] Test secret, static, dynamic, browser and controlled scan stages on approved fixtures.
- [ ] Standardize and deduplicate reports from Pentest Copilot and OKF.

#### Evidence and proof service
- [ ] Split `okf_receipt.py` into signed immutable artifact manifests and public proof metadata.
- [ ] Add key IDs, key rotation, tenant binding and secure signing-key custody.
- [ ] Migrate history into append-only transaction-safe storage with stable schema versions.
- [ ] Implement an independent public verifier for artifacts, signatures, Merkle roots and history links.
- [ ] Implement OTS proof lifecycle: `not_requested`, `pending`, `verified`, `failed`, `inconclusive`.
- [ ] Validate Bitcoin proof roots with pinned trusted chain data and independent tests.
- [ ] Publish only redacted commitments to public Nostr relays and retry safely on failure.
- [ ] Preserve deliberate evidence integrity exceptions as historical failures, not success.

#### Hermes / Pentest Copilot
- [ ] Pair Hermes as the sole main reasoning engine and restore normal agent sessions after tool calls.
- [ ] Expose read-only project/status/findings tools before enabling scanning operations.
- [ ] Build a restricted Pentest Copilot MCP compatibility adapter, never expose its owner/admin token to arbitrary agents.
- [ ] Keep Kali, SSH, VPN, Burp, Caido and scan tools in approved execution sandboxes.
- [ ] Integrate tools' streaming progress, findings and approvals into the Bot HQ dashboard.
- [ ] Support task delegation among developer, security, remediation and verification agents.

#### Commercial product
- [ ] Free: local report review, static scans and optional BYOK/self-hosted tools with quotas.
- [ ] Paid: isolated hosted scan environments, managed time/cost credits, scheduled pipelines and full advanced integrations.
- [ ] Teams: shared engagements, assigned reviewers, approval chains and audit dashboards.
- [ ] Enterprise: contracted dedicated infrastructure and governance controls.
- [ ] Meter scanning seconds, CPU/memory, LLM usage, artifact storage and external provider fees accurately.
- [ ] Honor opt-in and customer authorization for every invasive or paid security action.

#### Acceptance and release
- [ ] Code scan of fixture with planted issue produces a finding with source location.
- [ ] A negative fixture produces a clean result only after every required stage actually finishes.
- [ ] User without target authorization cannot schedule or execute dynamic assessment.
- [ ] Out-of-scope host/network traffic is blocked at egress during real tests.
- [ ] Failed tool, killed job, missing evidence and incomplete OTS proof surface correct statuses.
- [ ] Receipt creation and independent verification pass without local signing secrets.
- [ ] A tampered file, missing file, altered receipt and broken ledger link each fail verification.
- [ ] Pentest Copilot interactive findings and OKF scanner findings reconcile without duplicates.
- [ ] Hermes remains usable if security provider is unavailable; the app fails safely.
- [ ] Cross-tenant file, MCP token, report and desktop access are denied.
- [ ] Full signup → subscription/credits → approved scan → report → receipt → remediation → rescan works on staging.
- [ ] Restore from backup, disaster recovery, billing reconciliation and rollback all pass.

### 8. Recommended order and non-goals

**First:** baseline and restrict the legacy security surfaces; then implement the read-only evidence/finding integration with Bot HQ. **Second:** add authorized job dispatch to isolated workers. **Third:** connect Pentest Copilot's interactive tools and normalize results. **Fourth:** harden receipts and proof verification. **Fifth:** ship commercial billing, entitlements, support and compliance features behind tested gates.

Do not position the source tree as a fully working turnkey cloud security SaaS, a universal hardware sandbox, an independently verified Bitcoin notarization service, or an implemented Move settlement chain. Those outcomes depend on additional code and real-world validation.
