import type { PostgresMigration } from './schema.js';

/** Opaque sessions establish user identity only; organization authority remains membership-scoped. */
export const SESSION_MIGRATION: PostgresMigration = {
  id: 3,
  name: 'opaque_user_sessions',
  sql: `
CREATE TABLE uap.auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id text NOT NULL REFERENCES uap.users(id) ON DELETE RESTRICT,
  created_at bigint NOT NULL CHECK (created_at >= 0),
  expires_at bigint NOT NULL CHECK (expires_at > created_at),
  revoked_at bigint CHECK (revoked_at >= created_at)
);
CREATE INDEX auth_sessions_user_active ON uap.auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
ALTER TABLE uap.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.auth_sessions FORCE ROW LEVEL SECURITY;

-- The narrow functions need their owner's policy even when the migrator is not
-- a superuser: FORCE RLS deliberately also applies to the table owner.
DO $policy$
BEGIN
  EXECUTE format('CREATE POLICY auth_sessions_operator ON uap.auth_sessions TO %I USING (true) WITH CHECK (true)', current_user);
END
$policy$;

CREATE FUNCTION uap.authenticate_session(session_hash text)
RETURNS TABLE(user_id text, expires_at bigint)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
  SELECT session.user_id, session.expires_at FROM uap.auth_sessions AS session
  WHERE session.token_hash = session_hash
    AND session_hash ~ '^[a-f0-9]{64}$'
    AND session.revoked_at IS NULL
    AND session.expires_at > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
$function$;

CREATE FUNCTION uap.revoke_session(session_hash text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
  WITH revoked AS (
    UPDATE uap.auth_sessions
    SET revoked_at = greatest(created_at, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    WHERE token_hash = session_hash AND session_hash ~ '^[a-f0-9]{64}$' AND revoked_at IS NULL
    RETURNING token_hash
  ) SELECT EXISTS (SELECT 1 FROM revoked)
$function$;
REVOKE ALL ON uap.auth_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION uap.authenticate_session(text), uap.revoke_session(text) FROM PUBLIC;
`,
};
