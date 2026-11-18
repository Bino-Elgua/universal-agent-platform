import type { PostgresMigration } from './schema.js';

/**
 * Durable tenant task records. Execution transitions are deliberately granted
 * through narrow service functions in a later layer; these tables are not a
 * public queue merely because their state is durable.
 */
export const RUNTIME_MIGRATION: PostgresMigration = {
  id: 5,
  name: 'durable_task_runtime',
  sql: `
ALTER TABLE uap.agents
  ADD CONSTRAINT agents_org_id_workspace_unique UNIQUE (organization_id, id, workspace_id);

CREATE TABLE uap.tasks (
  organization_id text NOT NULL,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  created_by_user_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  note text NOT NULL DEFAULT '' CHECK (octet_length(note) <= 65536),
  state text NOT NULL CHECK (state IN (
    'queued','running','awaiting_approval','cancelling','succeeded','failed',
    'incomplete','expired','cancelled','dead_letter'
  )),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= created_at),
  finished_at bigint CHECK (finished_at >= created_at),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, id, workspace_id, agent_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES uap.workspaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, agent_id, workspace_id)
    REFERENCES uap.agents(organization_id, id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES uap.memberships(organization_id, user_id) ON DELETE RESTRICT,
  CHECK ((state IN ('succeeded','failed','incomplete','expired','cancelled','dead_letter')) = (finished_at IS NOT NULL))
);

CREATE TABLE uap.task_jobs (
  organization_id text NOT NULL,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  task_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  retry_safety text NOT NULL CHECK (retry_safety IN ('idempotent','reconcile_only')),
  -- A reservation reference is evidence to verify, not authority to spend.
  -- Worker claim functions keep reserved_paid rows blocked until a ledger exists.
  execution_cost_class text NOT NULL DEFAULT 'unmetered_local'
    CHECK (execution_cost_class IN ('unmetered_local','reserved_paid')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN (
    'queued','running','awaiting_approval','cancelling','succeeded','failed',
    'incomplete','expired','cancelled','dead_letter'
  )),
  priority smallint NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  available_at bigint NOT NULL CHECK (available_at >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_token_hash text CHECK (lease_token_hash ~ '^[a-f0-9]{64}$'),
  lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at bigint CHECK (lease_expires_at >= 0),
  heartbeat_at bigint CHECK (heartbeat_at >= 0),
  cancel_requested_at bigint CHECK (cancel_requested_at >= 0),
  next_event_seq bigint NOT NULL DEFAULT 1 CHECK (next_event_seq >= 1),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  requester_sid text CHECK (length(requester_sid) BETWEEN 1 AND 500),
  policy_version text CHECK (length(policy_version) BETWEEN 1 AND 200),
  policy_decision_id text CHECK (length(policy_decision_id) BETWEEN 1 AND 200),
  budget_reservation_id text CHECK (length(budget_reservation_id) BETWEEN 1 AND 200),
  last_error jsonb CHECK (last_error IS NULL OR (jsonb_typeof(last_error) = 'object' AND octet_length(last_error::text) <= 65536)),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= created_at),
  finished_at bigint CHECK (finished_at >= created_at),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id, task_id),
  UNIQUE (organization_id, id, task_id, workspace_id, agent_id),
  FOREIGN KEY (organization_id, task_id, workspace_id, agent_id)
    REFERENCES uap.tasks(organization_id, id, workspace_id, agent_id) ON DELETE RESTRICT,
  CHECK (attempt_count <= max_attempts),
  CHECK ((state IN ('succeeded','failed','incomplete','expired','cancelled','dead_letter')) = (finished_at IS NOT NULL)),
  CHECK (
    (state IN ('running','cancelling')
      AND lease_token_hash IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL
      AND attempt_count > 0 AND lease_generation > 0)
    OR
    (state NOT IN ('running','cancelling')
      AND lease_token_hash IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
  ),
  CHECK (heartbeat_at IS NULL OR lease_expires_at IS NULL OR heartbeat_at <= lease_expires_at),
  CHECK (state <> 'cancelling' OR cancel_requested_at IS NOT NULL),
  CHECK ((execution_cost_class = 'reserved_paid') = (budget_reservation_id IS NOT NULL))
);
CREATE INDEX task_jobs_claimable
  ON uap.task_jobs(priority DESC, available_at, created_at, organization_id, id)
  WHERE state = 'queued';
CREATE UNIQUE INDEX task_jobs_one_active_agent
  ON uap.task_jobs(organization_id, agent_id)
  WHERE state IN ('running','awaiting_approval','cancelling');

CREATE TABLE uap.agent_runs (
  organization_id text NOT NULL,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  job_id text NOT NULL,
  task_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 100),
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  worker_id text NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN (
    'running','awaiting_approval','succeeded','failed','incomplete','expired','cancelled','lost'
  )),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  runtime_refs jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(runtime_refs) = 'object' AND octet_length(runtime_refs::text) <= 262144),
  outcome jsonb CHECK (outcome IS NULL OR (jsonb_typeof(outcome) = 'object' AND octet_length(outcome::text) <= 1048576)),
  error jsonb CHECK (error IS NULL OR (jsonb_typeof(error) = 'object' AND octet_length(error::text) <= 65536)),
  started_at bigint NOT NULL CHECK (started_at >= 0),
  heartbeat_at bigint NOT NULL CHECK (heartbeat_at >= started_at),
  finished_at bigint CHECK (finished_at >= started_at),
  PRIMARY KEY (organization_id, id),
  -- An approval suspension/resumption uses a new fenced run within one attempt.
  UNIQUE (organization_id, job_id, lease_generation),
  UNIQUE (organization_id, id, job_id, task_id, workspace_id, agent_id),
  FOREIGN KEY (organization_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.task_jobs(organization_id, id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  CHECK ((state = 'running') = (finished_at IS NULL))
);

CREATE TABLE uap.approvals (
  organization_id text NOT NULL,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  job_id text NOT NULL,
  task_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  requester_type text NOT NULL CHECK (requester_type IN ('user','agent','worker','system')),
  requester_id text NOT NULL CHECK (length(requester_id) BETWEEN 1 AND 200),
  requester_sid text CHECK (length(requester_sid) BETWEEN 1 AND 500),
  requested_by_user_id text,
  action_kind text NOT NULL CHECK (action_kind ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  action_payload jsonb NOT NULL
    CHECK (jsonb_typeof(action_payload) = 'object' AND octet_length(action_payload::text) <= 1048576),
  action_digest text NOT NULL CHECK (action_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','allowed','denied','expired','revoked','consumed')),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 200),
  policy_decision_id text NOT NULL CHECK (length(policy_decision_id) BETWEEN 1 AND 200),
  budget_reservation_id text CHECK (length(budget_reservation_id) BETWEEN 1 AND 200),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  requested_at bigint NOT NULL CHECK (requested_at >= 0),
  expires_at bigint NOT NULL CHECK (expires_at > requested_at),
  resolved_at bigint CHECK (resolved_at >= requested_at),
  resolved_by_user_id text,
  revoked_at bigint CHECK (revoked_at >= requested_at),
  revoked_by_user_id text,
  consumed_at bigint CHECK (consumed_at >= requested_at),
  consumed_by_run_id text,
  consumed_lease_generation bigint CHECK (consumed_lease_generation > 0),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, id, job_id),
  UNIQUE (organization_id, id, job_id, task_id, workspace_id, agent_id),
  FOREIGN KEY (organization_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.task_jobs(organization_id, id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, requested_by_user_id)
    REFERENCES uap.memberships(organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, resolved_by_user_id)
    REFERENCES uap.memberships(organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, revoked_by_user_id)
    REFERENCES uap.memberships(organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, consumed_by_run_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.agent_runs(organization_id, id, job_id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  CHECK ((requester_type = 'user') = (requested_by_user_id IS NOT NULL)),
  CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
  CHECK ((consumed_at IS NULL) = (consumed_by_run_id IS NULL)),
  CHECK ((consumed_at IS NULL) = (consumed_lease_generation IS NULL)),
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND revoked_at IS NULL AND consumed_at IS NULL)
    OR (status IN ('allowed','denied') AND resolved_at IS NOT NULL AND revoked_at IS NULL AND consumed_at IS NULL)
    OR (status = 'expired' AND revoked_at IS NULL AND consumed_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL AND consumed_at IS NULL)
    OR (status = 'consumed' AND resolved_at IS NOT NULL AND revoked_at IS NULL AND consumed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX approvals_one_active_job
  ON uap.approvals(organization_id, job_id)
  WHERE status IN ('pending','allowed');

CREATE TABLE uap.job_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 200),
  organization_id text NOT NULL,
  job_id text NOT NULL,
  task_id text NOT NULL,
  workspace_id text NOT NULL,
  agent_id text NOT NULL,
  run_id text,
  approval_id text,
  seq bigint NOT NULL CHECK (seq >= 1),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','worker','system')),
  actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  requester_sid text CHECK (length(requester_sid) BETWEEN 1 AND 500),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  causal_event_id text,
  idempotency_key text CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  idempotency_digest text CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  policy_version text CHECK (length(policy_version) BETWEEN 1 AND 200),
  policy_decision_id text CHECK (length(policy_decision_id) BETWEEN 1 AND 200),
  budget_reservation_id text CHECK (length(budget_reservation_id) BETWEEN 1 AND 200),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object' AND octet_length(provenance::text) <= 262144),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  UNIQUE (organization_id, event_id),
  UNIQUE (organization_id, job_id, seq),
  UNIQUE (organization_id, job_id, idempotency_key),
  FOREIGN KEY (organization_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.task_jobs(organization_id, id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, run_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.agent_runs(organization_id, id, job_id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, approval_id, job_id, task_id, workspace_id, agent_id)
    REFERENCES uap.approvals(organization_id, id, job_id, task_id, workspace_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, causal_event_id)
    REFERENCES uap.job_events(organization_id, event_id) ON DELETE RESTRICT,
  CHECK ((idempotency_key IS NULL) = (idempotency_digest IS NULL))
);
CREATE INDEX job_events_job_order ON uap.job_events(organization_id, job_id, seq);

ALTER TABLE uap.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.task_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.task_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.job_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tasks_member_read ON uap.tasks FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY tasks_writer_insert ON uap.tasks FOR INSERT WITH CHECK (
  created_by_user_id = nullif(current_setting('uap.actor_id', true), '')
  AND uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY task_jobs_member_read ON uap.task_jobs FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY task_jobs_writer_insert ON uap.task_jobs FOR INSERT WITH CHECK (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY agent_runs_member_read ON uap.agent_runs FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY approvals_writer_read ON uap.approvals FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY job_events_member_read ON uap.job_events FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);

-- Future narrow SECURITY DEFINER transition functions execute as the migration
-- owner. FORCE RLS still applies, so grant that owner an explicit policy rather
-- than relying on implicit table-owner bypass behavior.
DO $operator_policies$
DECLARE
  relation_name text;
BEGIN
  -- Narrow transition functions revalidate the requester's active membership.
  -- This policy also works when the migration owner has no BYPASSRLS.
  EXECUTE format('CREATE POLICY memberships_runtime_operator_read ON uap.memberships FOR SELECT TO %I USING (true)', current_user);
  FOREACH relation_name IN ARRAY ARRAY['tasks','task_jobs','agent_runs','approvals','job_events']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON uap.%I TO %I USING (true) WITH CHECK (true)',
      relation_name || '_operator', relation_name, current_user
    );
  END LOOP;
END
$operator_policies$;

REVOKE ALL ON uap.tasks,uap.task_jobs,uap.agent_runs,uap.approvals,uap.job_events FROM PUBLIC;
`,
};
