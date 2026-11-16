import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export class UnsafeSessionIssuerRoleError extends Error {
  readonly code = 'unsafe_session_issuer_role';
  constructor() {
    super('Session issuance requires a separate direct login with only session SELECT, INSERT and UPDATE privileges and no metadata, ownership or elevated role privileges.');
    this.name = 'UnsafeSessionIssuerRoleError';
  }
}

const ISSUER_ROLE_CHECK = `
SELECT (
  NOT role.rolcanlogin OR role.rolsuper OR role.rolbypassrls OR role.rolcreaterole OR role.rolcreatedb OR role.rolreplication
  OR EXISTS (
    SELECT 1 FROM pg_roles candidate
    WHERE pg_has_role(role.oid,candidate.oid,'MEMBER') AND (
      candidate.rolsuper OR candidate.rolbypassrls OR candidate.rolcreaterole OR candidate.rolcreatedb OR candidate.rolreplication
      OR has_schema_privilege(candidate.oid,'uap','CREATE')
      OR has_table_privilege(candidate.oid,'uap.auth_sessions','DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR EXISTS (
        SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname='uap' AND relation.relkind IN ('r','p','v','m','f') AND relation.relname <> 'auth_sessions'
          AND has_table_privilege(candidate.oid,relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      )
      OR EXISTS (
        SELECT 1 FROM pg_proc function JOIN pg_namespace namespace ON namespace.oid=function.pronamespace
        WHERE namespace.nspname='uap' AND has_function_privilege(candidate.oid,function.oid,'EXECUTE')
      )
    )
  )
  OR EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND pg_has_role(role.oid,datdba,'MEMBER'))
  OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='uap' AND pg_has_role(role.oid,nspowner,'MEMBER'))
  OR EXISTS (
    SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='uap' AND pg_has_role(role.oid,relation.relowner,'MEMBER')
  )
) AS unsafe FROM pg_roles role WHERE role.rolname=$1`;

function quoteRole(role: string): string {
  if (typeof role !== 'string' || !role || role.includes('\0') || Buffer.byteLength(role, 'utf8') > 63) throw new UnsafeSessionIssuerRoleError();
  return `"${role.replaceAll('"', '""')}"`;
}

/** Rechecked at every write so a changed database grant cannot bypass service separation. */
export async function assertSessionIssuerRole(client: PoolClient): Promise<void> {
  const identity = await client.query<{ name: string; direct: boolean }>('SELECT current_user AS name, current_user=session_user AS direct');
  if (identity.rows.length !== 1 || !identity.rows[0].direct) throw new UnsafeSessionIssuerRoleError();
  const result = await client.query<{ unsafe: boolean }>(ISSUER_ROLE_CHECK, [identity.rows[0].name]);
  if (result.rows.length !== 1 || result.rows[0].unsafe !== false) throw new UnsafeSessionIssuerRoleError();
}

/** Operator-only grants to an existing isolated login; never create users or prove a login here. */
export async function grantSessionIssuerRole(pool: Pool, role: string): Promise<void> {
  const quoted = quoteRole(role);
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL standard_conforming_strings=on");
    const result = await client.query<{ unsafe: boolean }>(ISSUER_ROLE_CHECK, [role]);
    if (result.rows.length !== 1 || result.rows[0].unsafe !== false) throw new UnsafeSessionIssuerRoleError();
    await client.query(`REVOKE ALL ON SCHEMA uap FROM ${quoted}`);
    await client.query(`REVOKE ALL ON uap.auth_sessions FROM ${quoted}`);
    await client.query(`GRANT USAGE ON SCHEMA uap TO ${quoted}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE ON uap.auth_sessions TO ${quoted}`);
    const policy = `auth_sessions_issuer_${crypto.createHash('sha256').update(role).digest('hex').slice(0, 24)}`;
    await client.query(`DROP POLICY IF EXISTS "${policy}" ON uap.auth_sessions`);
    await client.query(`CREATE POLICY "${policy}" ON uap.auth_sessions TO ${quoted} USING (true) WITH CHECK (true)`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { discard = true; });
    throw error;
  } finally { client.release(discard); }
}
