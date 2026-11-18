import type { PostgresMigration } from './schema.js';

/**
 * Narrow state transitions for durable task records. Tenant-facing callers and
 * cross-tenant workers receive EXECUTE on different functions; neither needs
 * raw UPDATE privileges on lease, approval or event state.
 */
export const RUNTIME_TRANSITIONS_MIGRATION: PostgresMigration = {
  id: 6,
  name: 'durable_task_transitions',
  sql: `
CREATE FUNCTION uap.append_task_job_event(
  p_organization_id text,
  p_job_id text,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_run_id text,
  p_approval_id text,
  p_payload jsonb,
  p_idempotency_key text,
  p_idempotency_digest text
)
RETURNS uap.job_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  selected_job uap.task_jobs%ROWTYPE;
  inserted_event uap.job_events%ROWTYPE;
  previous_event_id text;
  event_time bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  SELECT * INTO selected_job
  FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job is unavailable';
  END IF;

  SELECT event_id INTO previous_event_id
  FROM uap.job_events
  WHERE organization_id=p_organization_id AND job_id=p_job_id
    AND seq=selected_job.next_event_seq-1;

  UPDATE uap.task_jobs
  SET next_event_seq=next_event_seq+1
  WHERE organization_id=p_organization_id AND id=p_job_id;

  INSERT INTO uap.job_events(
    event_id,organization_id,job_id,task_id,workspace_id,agent_id,run_id,approval_id,
    seq,event_type,actor_type,actor_id,requester_sid,trace_id,causal_event_id,
    idempotency_key,idempotency_digest,policy_version,policy_decision_id,
    budget_reservation_id,provenance,payload,created_at
  ) VALUES (
    'evt_' || replace(gen_random_uuid()::text,'-',''),
    p_organization_id,p_job_id,selected_job.task_id,selected_job.workspace_id,
    selected_job.agent_id,p_run_id,p_approval_id,selected_job.next_event_seq,
    p_event_type,p_actor_type,p_actor_id,selected_job.requester_sid,
    selected_job.trace_id,previous_event_id,p_idempotency_key,p_idempotency_digest,
    selected_job.policy_version,selected_job.policy_decision_id,
    selected_job.budget_reservation_id,
    jsonb_build_object('source','durable_task_transition','schemaVersion',1),
    coalesce(p_payload,'{}'::jsonb),event_time
  ) RETURNING * INTO inserted_event;
  RETURN inserted_event;
END
$function$;

CREATE FUNCTION uap.enqueue_task_job(
  p_organization_id text,
  p_task_id text,
  p_job_id text,
  p_workspace_id text,
  p_agent_id text,
  p_title text,
  p_note text,
  p_kind text,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_digest text,
  p_retry_safety text,
  p_max_attempts integer,
  p_priority integer,
  p_available_at bigint,
  p_trace_id text,
  p_requester_sid text,
  p_policy_version text,
  p_policy_decision_id text,
  p_execution_cost_class text,
  p_budget_reservation_id text
)
RETURNS SETOF uap.task_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  actor_id text := nullif(current_setting('uap.actor_id',true),'');
  request_organization text := nullif(current_setting('uap.organization_id',true),'');
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
BEGIN
  IF request_organization IS DISTINCT FROM p_organization_id
    OR actor_id IS NULL
    OR NOT uap.has_org_role(p_organization_id,ARRAY['owner','admin','member']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='tenant action is not permitted';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_organization_id,p_idempotency_key)::text,21442));
  SELECT * INTO selected_job
  FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF selected_job.request_digest IS DISTINCT FROM p_request_digest THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='idempotency request conflicts with stored job';
    END IF;
    RETURN NEXT selected_job;
    RETURN;
  END IF;

  INSERT INTO uap.tasks(
    organization_id,id,workspace_id,agent_id,created_by_user_id,title,note,state,
    created_at,updated_at
  ) VALUES (
    p_organization_id,p_task_id,p_workspace_id,p_agent_id,actor_id,p_title,
    coalesce(p_note,''),'queued',v_now,v_now
  );

  INSERT INTO uap.task_jobs(
    organization_id,id,task_id,workspace_id,agent_id,kind,payload,idempotency_key,
    request_digest,retry_safety,state,priority,available_at,max_attempts,trace_id,
    requester_sid,policy_version,policy_decision_id,execution_cost_class,
    budget_reservation_id,created_at,updated_at
  ) VALUES (
    p_organization_id,p_job_id,p_task_id,p_workspace_id,p_agent_id,p_kind,p_payload,
    p_idempotency_key,p_request_digest,p_retry_safety,'queued',p_priority,
    coalesce(p_available_at,v_now),p_max_attempts,p_trace_id,p_requester_sid,
    p_policy_version,p_policy_decision_id,p_execution_cost_class,
    p_budget_reservation_id,
    v_now,v_now
  ) RETURNING * INTO selected_job;

  PERFORM uap.append_task_job_event(
    p_organization_id,p_job_id,'job.queued','user',actor_id,NULL,NULL,
    jsonb_build_object('kind',p_kind,'retrySafety',p_retry_safety,
      'executionCostClass',p_execution_cost_class),NULL,NULL
  );
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN NEXT selected_job;
END
$function$;

CREATE FUNCTION uap.request_task_job_cancellation(p_organization_id text,p_job_id text)
RETURNS SETOF uap.task_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  actor_id text := nullif(current_setting('uap.actor_id',true),'');
  request_organization text := nullif(current_setting('uap.organization_id',true),'');
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  creator_id text;
BEGIN
  IF request_organization IS DISTINCT FROM p_organization_id OR actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='tenant action is not permitted';
  END IF;
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job is unavailable';
  END IF;
  SELECT created_by_user_id INTO creator_id FROM uap.tasks
  WHERE organization_id=p_organization_id AND id=selected_job.task_id;
  IF NOT (uap.has_org_role(p_organization_id,ARRAY['owner','admin'])
    OR (actor_id=creator_id AND uap.has_org_role(p_organization_id,ARRAY['member']))) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='tenant action is not permitted';
  END IF;

  IF selected_job.state IN ('succeeded','failed','incomplete','expired','cancelled','dead_letter') THEN
    RETURN NEXT selected_job;
    RETURN;
  ELSIF selected_job.state IN ('queued','awaiting_approval') THEN
    UPDATE uap.approvals SET status='revoked',revoked_at=v_now,revoked_by_user_id=actor_id
    WHERE organization_id=p_organization_id AND job_id=p_job_id
      AND status IN ('pending','allowed');
    UPDATE uap.task_jobs
    SET state='cancelled',cancel_requested_at=coalesce(cancel_requested_at,v_now),
      updated_at=v_now,finished_at=v_now,
      lease_token_hash=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL
    WHERE organization_id=p_organization_id AND id=p_job_id RETURNING * INTO selected_job;
    UPDATE uap.tasks SET state='cancelled',updated_at=v_now,finished_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    PERFORM uap.append_task_job_event(
      p_organization_id,p_job_id,'job.cancelled','user',actor_id,NULL,NULL,'{}'::jsonb,NULL,NULL
    );
  ELSIF selected_job.state='running' THEN
    UPDATE uap.task_jobs
    SET state='cancelling',cancel_requested_at=coalesce(cancel_requested_at,v_now),
      updated_at=v_now
    WHERE organization_id=p_organization_id AND id=p_job_id RETURNING * INTO selected_job;
    UPDATE uap.tasks SET state='cancelling',updated_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    PERFORM uap.append_task_job_event(
      p_organization_id,p_job_id,'job.cancellation_requested','user',actor_id,NULL,NULL,'{}'::jsonb,NULL,NULL
    );
  END IF;
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN NEXT selected_job;
END
$function$;

CREATE FUNCTION uap.resolve_task_approval(
  p_organization_id text,
  p_approval_id text,
  p_decision text
)
RETURNS SETOF uap.approvals
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  actor_id text := nullif(current_setting('uap.actor_id',true),'');
  request_organization text := nullif(current_setting('uap.organization_id',true),'');
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_approval uap.approvals%ROWTYPE;
  selected_job uap.task_jobs%ROWTYPE;
  creator_id text;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('allow','deny','revoke') THEN
    RAISE EXCEPTION USING ERRCODE='P0003', MESSAGE='approval decision is invalid';
  END IF;
  IF request_organization IS DISTINCT FROM p_organization_id OR actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='tenant action is not permitted';
  END IF;
  SELECT * INTO selected_approval FROM uap.approvals
  WHERE organization_id=p_organization_id AND id=p_approval_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='approval is unavailable';
  END IF;
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=selected_approval.job_id FOR UPDATE;
  SELECT * INTO selected_approval FROM uap.approvals
  WHERE organization_id=p_organization_id AND id=p_approval_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  SELECT created_by_user_id INTO creator_id FROM uap.tasks
  WHERE organization_id=p_organization_id AND id=selected_job.task_id;
  IF NOT (uap.has_org_role(p_organization_id,ARRAY['owner','admin'])
    OR (actor_id=creator_id AND uap.has_org_role(p_organization_id,ARRAY['member']))) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='tenant action is not permitted';
  END IF;

  IF selected_approval.status IN ('pending','allowed') AND selected_approval.expires_at <= v_now THEN
    UPDATE uap.approvals SET status='expired'
    WHERE organization_id=p_organization_id AND id=p_approval_id RETURNING * INTO selected_approval;
    IF selected_job.state IN ('queued','awaiting_approval') THEN
      UPDATE uap.task_jobs SET state='expired',updated_at=v_now,finished_at=v_now
      WHERE organization_id=p_organization_id AND id=selected_job.id;
      UPDATE uap.tasks SET state='expired',updated_at=v_now,finished_at=v_now
      WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    ELSIF selected_job.state='running' THEN
      UPDATE uap.task_jobs SET state='cancelling',cancel_requested_at=coalesce(cancel_requested_at,v_now),updated_at=v_now
      WHERE organization_id=p_organization_id AND id=selected_job.id;
      UPDATE uap.tasks SET state='cancelling',updated_at=v_now
      WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    END IF;
    PERFORM uap.append_task_job_event(
      p_organization_id,selected_job.id,'approval.expired','system','durable_scheduler',
      NULL,p_approval_id,'{}'::jsonb,NULL,NULL
    );
    RETURN NEXT selected_approval;
    RETURN;
  END IF;

  IF selected_approval.status <> 'pending'
    AND NOT (p_decision='revoke' AND selected_approval.status='allowed') THEN
    IF (p_decision='allow' AND selected_approval.status IN ('allowed','consumed'))
      OR (p_decision='deny' AND selected_approval.status='denied')
      OR (p_decision='revoke' AND selected_approval.status='revoked') THEN
      RETURN NEXT selected_approval;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='approval decision conflicts with stored decision';
  END IF;

  IF p_decision='allow' THEN
    UPDATE uap.approvals
    SET status='allowed',resolved_at=v_now,resolved_by_user_id=actor_id
    WHERE organization_id=p_organization_id AND id=p_approval_id RETURNING * INTO selected_approval;
    IF selected_job.state <> 'awaiting_approval' THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='approval job state conflicts with decision';
    END IF;
    UPDATE uap.task_jobs SET state='queued',available_at=v_now,updated_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.id;
    UPDATE uap.tasks SET state='queued',updated_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    PERFORM uap.append_task_job_event(
      p_organization_id,selected_job.id,'approval.allowed','user',actor_id,NULL,
      p_approval_id,'{}'::jsonb,NULL,NULL
    );
  ELSIF p_decision='deny' THEN
    UPDATE uap.approvals
    SET status='denied',resolved_at=v_now,resolved_by_user_id=actor_id
    WHERE organization_id=p_organization_id AND id=p_approval_id RETURNING * INTO selected_approval;
    UPDATE uap.task_jobs SET state='cancelled',cancel_requested_at=v_now,
      updated_at=v_now,finished_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.id;
    UPDATE uap.tasks SET state='cancelled',updated_at=v_now,finished_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id;
    PERFORM uap.append_task_job_event(
      p_organization_id,selected_job.id,'approval.denied','user',actor_id,NULL,
      p_approval_id,'{}'::jsonb,NULL,NULL
    );
  ELSE
    UPDATE uap.approvals
    SET status='revoked',revoked_at=v_now,revoked_by_user_id=actor_id
    WHERE organization_id=p_organization_id AND id=p_approval_id RETURNING * INTO selected_approval;
    UPDATE uap.task_jobs SET state='cancelled',cancel_requested_at=v_now,
      updated_at=v_now,finished_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.id
      AND state IN ('queued','awaiting_approval');
    UPDATE uap.tasks SET state='cancelled',updated_at=v_now,finished_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id
      AND state IN ('queued','awaiting_approval');
    UPDATE uap.task_jobs SET state='cancelling',cancel_requested_at=coalesce(cancel_requested_at,v_now),updated_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.id AND state='running';
    UPDATE uap.tasks SET state='cancelling',updated_at=v_now
    WHERE organization_id=p_organization_id AND id=selected_job.task_id AND state='running';
    PERFORM uap.append_task_job_event(
      p_organization_id,selected_job.id,'approval.revoked','user',actor_id,NULL,
      p_approval_id,'{}'::jsonb,NULL,NULL
    );
  END IF;
  RETURN NEXT selected_approval;
END
$function$;

CREATE FUNCTION uap.claim_task_job(
  p_worker_id text,
  p_kinds text[],
  p_lease_ms bigint,
  p_lease_token_hash text
)
RETURNS SETOF uap.task_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  selected_approval uap.approvals%ROWTYPE;
  current_run_id text;
  new_run_id text;
  recovery_state text;
  resume_approval boolean;
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 200
    OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 1800000
    OR p_lease_token_hash IS NULL OR p_lease_token_hash !~ '^[a-f0-9]{64}$'
    OR coalesce(array_length(p_kinds,1),0) NOT BETWEEN 1 AND 50
    OR EXISTS (SELECT 1 FROM unnest(p_kinds) kind WHERE kind IS NULL OR kind !~ '^[a-z0-9][a-z0-9._-]{0,99}$') THEN
    RAISE EXCEPTION USING ERRCODE='P0003', MESSAGE='worker claim input is invalid';
  END IF;

  FOR selected_approval IN
    SELECT * FROM uap.approvals
    WHERE status IN ('pending','allowed') AND expires_at <= v_now
    ORDER BY expires_at,organization_id,id LIMIT 50
  LOOP
    SELECT * INTO selected_job FROM uap.task_jobs
    WHERE organization_id=selected_approval.organization_id AND id=selected_approval.job_id
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    SELECT * INTO selected_approval FROM uap.approvals
    WHERE organization_id=selected_job.organization_id AND id=selected_approval.id
    FOR UPDATE;
    IF NOT FOUND OR selected_approval.status NOT IN ('pending','allowed')
      OR selected_approval.expires_at>v_now THEN
      CONTINUE;
    END IF;
    UPDATE uap.approvals SET status='expired'
    WHERE organization_id=selected_approval.organization_id AND id=selected_approval.id;
    IF selected_job.state IN ('queued','awaiting_approval') THEN
      UPDATE uap.task_jobs SET state='expired',updated_at=v_now,finished_at=v_now
      WHERE organization_id=selected_job.organization_id AND id=selected_job.id;
      UPDATE uap.tasks SET state='expired',updated_at=v_now,finished_at=v_now
      WHERE organization_id=selected_job.organization_id AND id=selected_job.task_id;
    ELSIF selected_job.state='running' THEN
      UPDATE uap.task_jobs SET state='cancelling',cancel_requested_at=coalesce(cancel_requested_at,v_now),updated_at=v_now
      WHERE organization_id=selected_job.organization_id AND id=selected_job.id;
      UPDATE uap.tasks SET state='cancelling',updated_at=v_now
      WHERE organization_id=selected_job.organization_id AND id=selected_job.task_id;
    END IF;
    PERFORM uap.append_task_job_event(
      selected_job.organization_id,selected_job.id,'approval.expired','system',
      'durable_scheduler',NULL,selected_approval.id,'{}'::jsonb,NULL,NULL
    );
  END LOOP;

  FOR selected_job IN
    SELECT * FROM uap.task_jobs
    WHERE state IN ('running','cancelling') AND lease_expires_at <= v_now
    ORDER BY lease_expires_at,organization_id,id FOR UPDATE SKIP LOCKED LIMIT 50
  LOOP
    SELECT id INTO current_run_id FROM uap.agent_runs
    WHERE organization_id=selected_job.organization_id AND job_id=selected_job.id
      AND lease_generation=selected_job.lease_generation FOR UPDATE;
    UPDATE uap.agent_runs
    SET state='lost',finished_at=v_now,heartbeat_at=greatest(heartbeat_at,v_now),
      error=jsonb_build_object('code','lease_expired')
    WHERE organization_id=selected_job.organization_id AND id=current_run_id AND state='running';

    IF selected_job.state='cancelling' OR selected_job.retry_safety='reconcile_only'
      OR EXISTS (SELECT 1 FROM uap.approvals WHERE organization_id=selected_job.organization_id
        AND job_id=selected_job.id AND consumed_at IS NOT NULL) THEN
      recovery_state := 'incomplete';
    ELSIF selected_job.attempt_count < selected_job.max_attempts THEN
      recovery_state := 'queued';
    ELSE
      recovery_state := 'dead_letter';
    END IF;
    UPDATE uap.task_jobs SET state=recovery_state,
      available_at=CASE WHEN recovery_state='queued' THEN v_now ELSE available_at END,
      updated_at=v_now,
      finished_at=CASE WHEN recovery_state='queued' THEN NULL ELSE v_now END,
      lease_token_hash=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,
      last_error=jsonb_build_object('code','lease_expired')
    WHERE organization_id=selected_job.organization_id AND id=selected_job.id;
    UPDATE uap.tasks SET state=recovery_state,updated_at=v_now,
      finished_at=CASE WHEN recovery_state='queued' THEN NULL ELSE v_now END
    WHERE organization_id=selected_job.organization_id AND id=selected_job.task_id;
    PERFORM uap.append_task_job_event(
      selected_job.organization_id,selected_job.id,
      CASE WHEN recovery_state='queued' THEN 'job.lease_recovered'
        WHEN recovery_state='incomplete' THEN 'job.incomplete'
        ELSE 'job.dead_lettered' END,
      'system','durable_scheduler',current_run_id,NULL,
      jsonb_build_object('reason','lease_expired'),NULL,NULL
    );
  END LOOP;

  SELECT * INTO selected_job FROM uap.task_jobs AS candidate
  WHERE candidate.state='queued' AND candidate.available_at <= v_now
    AND (candidate.attempt_count < candidate.max_attempts OR EXISTS (
      SELECT 1 FROM uap.agent_runs previous_run JOIN uap.approvals approval
        ON approval.organization_id=previous_run.organization_id AND approval.job_id=previous_run.job_id
      WHERE previous_run.organization_id=candidate.organization_id AND previous_run.job_id=candidate.id
        AND previous_run.lease_generation=candidate.lease_generation AND previous_run.state='awaiting_approval'
        AND approval.status='allowed' AND approval.expires_at>v_now
    ))
    AND candidate.kind=ANY(p_kinds)
    AND candidate.execution_cost_class='unmetered_local'
    AND NOT EXISTS (
      SELECT 1 FROM uap.approvals approval
      WHERE approval.organization_id=candidate.organization_id AND approval.job_id=candidate.id
        AND (approval.status IN ('pending','expired','revoked','denied')
          OR (approval.status='allowed' AND approval.expires_at<=v_now))
    )
    AND EXISTS (
      SELECT 1 FROM uap.tasks task JOIN uap.memberships membership
        ON membership.organization_id=task.organization_id AND membership.user_id=task.created_by_user_id
      WHERE task.organization_id=candidate.organization_id AND task.id=candidate.task_id
        AND membership.state='active' AND membership.role IN ('owner','admin','member')
    )
    AND NOT EXISTS (
      SELECT 1 FROM uap.task_jobs AS active
      WHERE active.organization_id=candidate.organization_id
        AND active.agent_id=candidate.agent_id
        AND active.state IN ('running','awaiting_approval','cancelling')
    )
  ORDER BY candidate.priority DESC,candidate.available_at,candidate.created_at,
    candidate.organization_id,candidate.id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    jsonb_build_array(selected_job.organization_id,selected_job.agent_id)::text,21443)) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM uap.task_jobs WHERE organization_id=selected_job.organization_id
      AND agent_id=selected_job.agent_id AND id<>selected_job.id
      AND state IN ('running','awaiting_approval','cancelling')
  ) THEN RETURN; END IF;

  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF EXISTS (
    SELECT 1 FROM uap.approvals approval
    WHERE approval.organization_id=selected_job.organization_id AND approval.job_id=selected_job.id
      AND (approval.status IN ('pending','expired','revoked','denied')
        OR (approval.status='allowed' AND approval.expires_at<=v_now))
  ) THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM uap.tasks task JOIN uap.memberships membership
      ON membership.organization_id=task.organization_id AND membership.user_id=task.created_by_user_id
    WHERE task.organization_id=selected_job.organization_id AND task.id=selected_job.task_id
      AND membership.state='active' AND membership.role IN ('owner','admin','member')
  ) THEN RETURN; END IF;
  SELECT EXISTS (
    SELECT 1 FROM uap.agent_runs previous_run JOIN uap.approvals approval
      ON approval.organization_id=previous_run.organization_id AND approval.job_id=previous_run.job_id
    WHERE previous_run.organization_id=selected_job.organization_id AND previous_run.job_id=selected_job.id
      AND previous_run.lease_generation=selected_job.lease_generation AND previous_run.state='awaiting_approval'
      AND approval.status='allowed' AND approval.expires_at>v_now
  ) INTO resume_approval;
  IF NOT resume_approval AND selected_job.attempt_count>=selected_job.max_attempts THEN RETURN; END IF;
  new_run_id := 'run_' || replace(gen_random_uuid()::text,'-','');
  UPDATE uap.task_jobs SET state='running',attempt_count=attempt_count+CASE WHEN resume_approval THEN 0 ELSE 1 END,
    lease_generation=lease_generation+1,lease_token_hash=p_lease_token_hash,
    lease_owner=p_worker_id,lease_expires_at=v_now+p_lease_ms,
    heartbeat_at=v_now,updated_at=v_now,finished_at=NULL,last_error=NULL
  WHERE organization_id=selected_job.organization_id AND id=selected_job.id
  RETURNING * INTO selected_job;
  INSERT INTO uap.agent_runs(
    organization_id,id,job_id,task_id,workspace_id,agent_id,attempt_number,
    lease_generation,worker_id,state,trace_id,started_at,heartbeat_at
  ) VALUES (
    selected_job.organization_id,new_run_id,selected_job.id,selected_job.task_id,
    selected_job.workspace_id,selected_job.agent_id,selected_job.attempt_count,
    selected_job.lease_generation,p_worker_id,'running',selected_job.trace_id,
    v_now,v_now
  );
  UPDATE uap.tasks SET state='running',updated_at=v_now,finished_at=NULL
  WHERE organization_id=selected_job.organization_id AND id=selected_job.task_id;
  PERFORM uap.append_task_job_event(
    selected_job.organization_id,selected_job.id,'job.claimed','worker',p_worker_id,
    new_run_id,NULL,jsonb_build_object('attempt',selected_job.attempt_count,
      'leaseGeneration',selected_job.lease_generation),NULL,NULL
  );
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=selected_job.organization_id AND id=selected_job.id;
  RETURN NEXT selected_job;
END
$function$;

CREATE FUNCTION uap.heartbeat_task_job(
  p_organization_id text,
  p_job_id text,
  p_lease_generation bigint,
  p_lease_token_hash text,
  p_lease_ms bigint
)
RETURNS SETOF uap.task_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  current_run_id text;
BEGIN
  IF p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 1800000 OR p_lease_token_hash IS NULL OR p_lease_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='P0003', MESSAGE='worker heartbeat input is invalid';
  END IF;
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR selected_job.state NOT IN ('running','cancelling')
    OR selected_job.lease_generation IS DISTINCT FROM p_lease_generation
    OR selected_job.lease_token_hash IS DISTINCT FROM p_lease_token_hash
    OR selected_job.lease_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job lease is unavailable';
  END IF;
  SELECT id INTO current_run_id FROM uap.agent_runs
  WHERE organization_id=p_organization_id AND job_id=p_job_id
    AND lease_generation=p_lease_generation AND state='running' FOR UPDATE;
  IF current_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job run is unavailable';
  END IF;
  UPDATE uap.task_jobs SET heartbeat_at=v_now,
    lease_expires_at=v_now+p_lease_ms,updated_at=v_now
  WHERE organization_id=p_organization_id AND id=p_job_id RETURNING * INTO selected_job;
  UPDATE uap.agent_runs SET heartbeat_at=v_now
  WHERE organization_id=p_organization_id AND id=current_run_id;
  RETURN NEXT selected_job;
END
$function$;

CREATE FUNCTION uap.settle_task_job(
  p_organization_id text,
  p_job_id text,
  p_lease_generation bigint,
  p_lease_token_hash text,
  p_outcome text,
  p_retry_delay_ms bigint,
  p_result jsonb,
  p_error jsonb
)
RETURNS SETOF uap.task_jobs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  current_run_id text;
  current_worker_id text;
  next_state text;
  event_name text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded','failed','incomplete','cancelled')
    OR (p_retry_delay_ms IS NOT NULL AND p_retry_delay_ms NOT BETWEEN 0 AND 604800000) THEN
    RAISE EXCEPTION USING ERRCODE='P0003', MESSAGE='worker settlement input is invalid';
  END IF;
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR selected_job.state NOT IN ('running','cancelling')
    OR selected_job.lease_generation IS DISTINCT FROM p_lease_generation
    OR selected_job.lease_token_hash IS DISTINCT FROM p_lease_token_hash
    OR selected_job.lease_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job lease is unavailable';
  END IF;
  IF p_outcome NOT IN ('cancelled','incomplete') AND (selected_job.state='cancelling' OR selected_job.cancel_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cancelled work requires stop confirmation or reconciliation';
  END IF;
  IF p_outcome='succeeded' AND EXISTS (SELECT 1 FROM uap.approvals
    WHERE organization_id=p_organization_id AND job_id=p_job_id AND status IN ('pending','allowed','expired','revoked')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='approval has not authorized the completed work';
  END IF;
  IF p_outcome='cancelled' AND selected_job.cancel_requested_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='job has no cancellation request';
  END IF;
  SELECT id,worker_id INTO current_run_id,current_worker_id FROM uap.agent_runs
  WHERE organization_id=p_organization_id AND job_id=p_job_id
    AND lease_generation=p_lease_generation AND state='running' FOR UPDATE;
  IF current_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job run is unavailable';
  END IF;

  IF p_outcome='failed' AND p_retry_delay_ms IS NOT NULL THEN
    IF selected_job.state='cancelling' OR selected_job.retry_safety='reconcile_only'
      OR EXISTS (SELECT 1 FROM uap.approvals WHERE organization_id=p_organization_id
        AND job_id=p_job_id AND consumed_at IS NOT NULL) THEN
      next_state := 'incomplete';
    ELSIF selected_job.attempt_count < selected_job.max_attempts THEN
      next_state := 'queued';
    ELSE
      next_state := 'dead_letter';
    END IF;
  ELSE
    next_state := p_outcome;
  END IF;
  UPDATE uap.agent_runs SET state=CASE WHEN p_outcome='failed' THEN 'failed' ELSE p_outcome END,
    outcome=p_result,error=p_error,heartbeat_at=greatest(heartbeat_at,v_now),finished_at=v_now
  WHERE organization_id=p_organization_id AND id=current_run_id;
  UPDATE uap.task_jobs SET state=next_state,
    available_at=CASE WHEN next_state='queued' THEN v_now+p_retry_delay_ms ELSE available_at END,
    updated_at=v_now,finished_at=CASE WHEN next_state='queued' THEN NULL ELSE v_now END,
    lease_token_hash=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,
    last_error=CASE WHEN p_outcome='failed' THEN p_error ELSE last_error END
  WHERE organization_id=p_organization_id AND id=p_job_id RETURNING * INTO selected_job;
  UPDATE uap.tasks SET state=next_state,updated_at=v_now,
    finished_at=CASE WHEN next_state='queued' THEN NULL ELSE v_now END
  WHERE organization_id=p_organization_id AND id=selected_job.task_id;
  event_name := CASE next_state
    WHEN 'queued' THEN 'job.retry_scheduled'
    WHEN 'dead_letter' THEN 'job.dead_lettered'
    ELSE 'job.' || next_state END;
  PERFORM uap.append_task_job_event(
    p_organization_id,p_job_id,event_name,'worker',current_worker_id,
    current_run_id,NULL,jsonb_build_object('outcome',p_outcome),NULL,NULL
  );
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN NEXT selected_job;
END
$function$;

CREATE FUNCTION uap.request_task_approval(
  p_organization_id text,
  p_job_id text,
  p_lease_generation bigint,
  p_lease_token_hash text,
  p_approval_id text,
  p_action_kind text,
  p_action_payload jsonb,
  p_action_digest text,
  p_expires_at bigint,
  p_policy_version text,
  p_policy_decision_id text,
  p_budget_reservation_id text
)
RETURNS SETOF uap.approvals
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  inserted_approval uap.approvals%ROWTYPE;
  current_run_id text;
  current_worker_id text;
BEGIN
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR selected_job.state<>'running'
    OR selected_job.lease_generation IS DISTINCT FROM p_lease_generation
    OR selected_job.lease_token_hash IS DISTINCT FROM p_lease_token_hash
    OR selected_job.lease_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job lease is unavailable';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at<=v_now OR p_expires_at>v_now+86400000
    OR p_action_digest IS NULL OR p_action_digest !~ '^[a-f0-9]{64}$'
    OR p_policy_version IS NULL OR p_policy_decision_id IS NULL
    OR p_policy_version IS DISTINCT FROM selected_job.policy_version
    OR p_policy_decision_id IS DISTINCT FROM selected_job.policy_decision_id
    OR p_budget_reservation_id IS DISTINCT FROM selected_job.budget_reservation_id THEN
    RAISE EXCEPTION USING ERRCODE='P0003', MESSAGE='approval request is invalid';
  END IF;
  SELECT run.id,run.worker_id INTO current_run_id,current_worker_id
  FROM uap.agent_runs AS run
  WHERE run.organization_id=p_organization_id AND run.job_id=p_job_id
    AND run.lease_generation=p_lease_generation AND run.state='running' FOR UPDATE;
  IF current_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job run is unavailable';
  END IF;
  INSERT INTO uap.approvals(
    organization_id,id,job_id,task_id,workspace_id,agent_id,requester_type,
    requester_id,requester_sid,action_kind,action_payload,action_digest,status,
    policy_version,policy_decision_id,budget_reservation_id,trace_id,requested_at,expires_at
  ) VALUES (
    p_organization_id,p_approval_id,p_job_id,selected_job.task_id,
    selected_job.workspace_id,selected_job.agent_id,'worker',current_worker_id,
    selected_job.requester_sid,p_action_kind,p_action_payload,p_action_digest,
    'pending',p_policy_version,p_policy_decision_id,p_budget_reservation_id,
    selected_job.trace_id,v_now,p_expires_at
  ) RETURNING * INTO inserted_approval;
  UPDATE uap.agent_runs SET state='awaiting_approval',heartbeat_at=v_now,finished_at=v_now
  WHERE organization_id=p_organization_id AND id=current_run_id;
  UPDATE uap.task_jobs SET state='awaiting_approval',updated_at=v_now,
    lease_token_hash=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL
  WHERE organization_id=p_organization_id AND id=p_job_id;
  UPDATE uap.tasks SET state='awaiting_approval',updated_at=v_now
  WHERE organization_id=p_organization_id AND id=selected_job.task_id;
  PERFORM uap.append_task_job_event(
    p_organization_id,p_job_id,'approval.requested','worker',current_worker_id,
    current_run_id,p_approval_id,jsonb_build_object('actionKind',p_action_kind),NULL,NULL
  );
  RETURN NEXT inserted_approval;
END
$function$;

CREATE FUNCTION uap.consume_task_approval(
  p_organization_id text,
  p_job_id text,
  p_lease_generation bigint,
  p_lease_token_hash text,
  p_approval_id text,
  p_action_digest text
)
RETURNS SETOF uap.approvals
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
DECLARE
  v_now bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  selected_job uap.task_jobs%ROWTYPE;
  selected_approval uap.approvals%ROWTYPE;
  current_run_id text;
BEGIN
  SELECT * INTO selected_job FROM uap.task_jobs
  WHERE organization_id=p_organization_id AND id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR selected_job.state<>'running'
    OR selected_job.lease_generation IS DISTINCT FROM p_lease_generation
    OR selected_job.lease_token_hash IS DISTINCT FROM p_lease_token_hash
    OR selected_job.lease_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job lease is unavailable';
  END IF;
  SELECT * INTO selected_approval FROM uap.approvals
  WHERE organization_id=p_organization_id AND id=p_approval_id AND job_id=p_job_id FOR UPDATE;
  v_now := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT EXISTS (
    SELECT 1 FROM uap.tasks task JOIN uap.memberships membership
      ON membership.organization_id=task.organization_id AND membership.user_id=task.created_by_user_id
    WHERE task.organization_id=p_organization_id AND task.id=selected_job.task_id
      AND membership.state='active' AND membership.role IN ('owner','admin','member')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='requester is no longer authorized';
  END IF;
  IF selected_approval.id IS NULL OR selected_approval.status<>'allowed'
    OR selected_approval.expires_at<=v_now
    OR selected_approval.action_digest IS DISTINCT FROM p_action_digest
    OR selected_approval.policy_version IS DISTINCT FROM selected_job.policy_version
    OR selected_approval.policy_decision_id IS DISTINCT FROM selected_job.policy_decision_id
    OR selected_approval.budget_reservation_id IS DISTINCT FROM selected_job.budget_reservation_id THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='approval cannot authorize this action';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM uap.tasks task JOIN uap.memberships membership
      ON membership.organization_id=task.organization_id AND membership.user_id=selected_approval.resolved_by_user_id
    WHERE task.organization_id=p_organization_id AND task.id=selected_job.task_id
      AND membership.state='active' AND (membership.role IN ('owner','admin')
        OR (membership.role='member' AND membership.user_id=task.created_by_user_id))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='approver is no longer authorized';
  END IF;
  SELECT id INTO current_run_id FROM uap.agent_runs
  WHERE organization_id=p_organization_id AND job_id=p_job_id
    AND lease_generation=p_lease_generation AND state='running' FOR UPDATE;
  IF current_run_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task job run is unavailable';
  END IF;
  UPDATE uap.approvals SET status='consumed',consumed_at=v_now,
    consumed_by_run_id=current_run_id,consumed_lease_generation=p_lease_generation
  WHERE organization_id=p_organization_id AND id=p_approval_id RETURNING * INTO selected_approval;
  PERFORM uap.append_task_job_event(
    p_organization_id,p_job_id,'approval.consumed','worker',selected_job.lease_owner,
    current_run_id,p_approval_id,'{}'::jsonb,NULL,NULL
  );
  RETURN NEXT selected_approval;
END
$function$;

REVOKE ALL ON FUNCTION
  uap.append_task_job_event(text,text,text,text,text,text,text,jsonb,text,text),
  uap.enqueue_task_job(text,text,text,text,text,text,text,text,jsonb,text,text,text,integer,integer,bigint,text,text,text,text,text,text),
  uap.request_task_job_cancellation(text,text),
  uap.resolve_task_approval(text,text,text),
  uap.claim_task_job(text,text[],bigint,text),
  uap.heartbeat_task_job(text,text,bigint,text,bigint),
  uap.settle_task_job(text,text,bigint,text,text,bigint,jsonb,jsonb),
  uap.request_task_approval(text,text,bigint,text,text,text,jsonb,text,bigint,text,text,text),
  uap.consume_task_approval(text,text,bigint,text,text,text)
FROM PUBLIC;
`,
};
