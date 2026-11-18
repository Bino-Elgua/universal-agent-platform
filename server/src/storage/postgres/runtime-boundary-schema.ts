import type { PostgresMigration } from './schema.js';

/**
 * Revalidate the human requester whenever a worker checkpoints immediately
 * before a tool boundary. Existing migration bytes remain unchanged.
 */
export const RUNTIME_BOUNDARY_MIGRATION: PostgresMigration = {
  id: 7,
  name: 'runtime_membership_boundary',
  sql: `
CREATE OR REPLACE FUNCTION uap.heartbeat_task_job(
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
  IF p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 1800000
    OR p_lease_token_hash IS NULL OR p_lease_token_hash !~ '^[a-f0-9]{64}$' THEN
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
  IF NOT EXISTS (
    SELECT 1 FROM uap.tasks AS task
    JOIN uap.memberships AS membership
      ON membership.organization_id=task.organization_id
      AND membership.user_id=task.created_by_user_id
    WHERE task.organization_id=p_organization_id AND task.id=selected_job.task_id
      AND membership.state='active' AND membership.role IN ('owner','admin','member')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='requester is no longer authorized';
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
REVOKE ALL ON FUNCTION uap.heartbeat_task_job(text,text,bigint,text,bigint) FROM PUBLIC;
`,
};
