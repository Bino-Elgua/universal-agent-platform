# Hermes model API source audit — 2026-11-15

Static inspection only; no Hermes code or live provider executed. Checkout: `/workspace/upstreams/hermes-agent`, commit `4162ecf11f611400fa6e5c42d2f360188ce50b39`. This HEAD differs from the earlier reachability snapshot in STATUS.md; integration must pin its selected source version.

## Gateway versus dashboard

The gateway API route table in `gateway/platforms/api_server.py` exposes:

- Authenticated `GET /api/model/options`: actual configured model/provider plus picker inventory.
- Authenticated `GET /v1/models`: virtual gateway/profile alias and configured `model_routes` aliases. This is **not** necessarily the actual provider model identifier.
- Authenticated `GET /v1/capabilities`: gateway API features, including `model_options: true`, `session_model_lock: true`, and `admin_config_rw: false`.
- `POST /api/sessions/{session_id}/model`: sets a browser-session model lock, not the global gateway configuration.
- No global `POST /api/model/set` in the gateway route table.

`POST /api/model/set` exists in the separate dashboard, `hermes_cli/web_routers/models.py`. It validates `scope` (`main` or `auxiliary`), provider/model assignment and expensive model confirmation; it writes Hermes config and applies to **new** sessions. Dashboard authentication has its own middleware and is not interchangeable with gateway `API_SERVER_KEY` authorization. A gateway connector must not infer dashboard mutation permission from a valid gateway key.

Gateway auth is `Authorization: Bearer <API_SERVER_KEY>` in `_check_auth()`. The API server startup guard requires a usable key; named-profile paths resolve their own profile key and fail closed without it.

## Correct discovery shape

`hermes_cli/inventory.py::load_picker_context()` reads Hermes disk config `model.default` (fallback `model.name`) and `model.provider`. `build_models_payload()` returns:

```json
{"providers": [], "model": "configured-provider-model-id", "provider": "configured-provider-slug"}
```

Provider rows contain `slug`, `name`, `is_current`, `models`, authentication/user-defined metadata and optional capability, price, limit and usage decorations. `include_unconfigured=false` excludes setup-only rows. The snapshot is configuration state, not proof that a particular existing session or fallback executed this model. Do not replace it with the platform SQLite bot model.

`/v1/models` and `/v1/capabilities.model` typically advertise `hermes-agent` or a profile alias. Display them as the API alias when options discovery is unavailable, not as a verified underlying model.

## Per-request overrides do not modify configuration

`_request_agent_overrides()` and `api_server_openai_routes.py::_select_request_route()` support request-level model/provider selection:

- The virtual `hermes-agent` alias means gateway default.
- An explicit `provider` is honored by the request parser.
- A bare `model` without `provider` is honored only with gateway `direct_model_requests=true`, which defaults to false on OpenAI-compatible endpoints such as `/v1/responses`.
- There is no `direct_model_requests` flag in the inspected `/v1/capabilities` payload.
- Runtime precedence is: confirmed browser lock → session `/model` override → persisted session model → model-route alias → request provider/model → global defaults.
- Explicit request selection does not mutate `config.yaml`, and session state can supersede a requested selection. The default runtime can also use configured fallback behavior. A request or API model string alone is not verified actual execution evidence.

## Safe compatibility behavior

For the current gateway-only platform connection, display actual `options.model`/`options.provider` as **Hermes configured default**, preserve identity/history, and direct global configuration changes to Hermes. Reject a local SQLite-only model change rather than presenting it as a gateway mutation.

A future separately supported override feature must identify the selection as **requested for this turn**, validate against the authenticated gateway inventory, obtain execution/runtime acknowledgement, enforce explicit spending policy, and distinguish requested, configured-default and executed model. It must not silently turn a failed/unavailable override into a success state.
