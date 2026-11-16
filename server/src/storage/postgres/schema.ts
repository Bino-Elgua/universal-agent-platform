/** Embedded migrations ship unchanged with the compiled service. Never edit an applied entry. */
export interface PostgresMigration {
  id: number;
  name: string;
  sql: string;
}

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [{
  id: 1,
  name: 'tenant_identity_and_agent_metadata',
  sql: `
CREATE TABLE uap.users (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at bigint NOT NULL CHECK (created_at >= 0)
);
CREATE TABLE uap.organizations (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at bigint NOT NULL CHECK (created_at >= 0)
);
CREATE TABLE uap.memberships (
  organization_id text NOT NULL REFERENCES uap.organizations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES uap.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended')),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_scope ON uap.memberships(user_id, organization_id, state);
CREATE TABLE uap.workspaces (
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  organization_id text NOT NULL REFERENCES uap.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (organization_id, id)
);
CREATE TABLE uap.agents (
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  organization_id text NOT NULL REFERENCES uap.organizations(id) ON DELETE RESTRICT,
  workspace_id text NOT NULL,
  owner_user_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES uap.workspaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES uap.memberships(organization_id, user_id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, id)
);
CREATE INDEX agents_workspace_scope ON uap.agents(organization_id, workspace_id, id);
CREATE TABLE uap.import_receipts (
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  organization_id text NOT NULL REFERENCES uap.organizations(id) ON DELETE RESTRICT,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  mapping_version integer NOT NULL CHECK (mapping_version > 0),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  imported_at bigint NOT NULL CHECK (imported_at >= 0),
  PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, source_digest)
);

ALTER TABLE uap.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.users FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.agents FORCE ROW LEVEL SECURITY;
ALTER TABLE uap.import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.import_receipts FORCE ROW LEVEL SECURITY;

-- This SELECT policy intentionally has no membership-helper call. It allows the
-- helper to read only the current actor's own scoped row without recursive RLS,
-- even when the function owner has no BYPASSRLS privilege.
CREATE POLICY memberships_self_read ON uap.memberships FOR SELECT USING (
  organization_id = nullif(current_setting('uap.organization_id', true), '')
  AND user_id = nullif(current_setting('uap.actor_id', true), '')
);
CREATE FUNCTION uap.has_org_role(target_organization text, allowed_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, uap
SET row_security = on
AS $function$
  SELECT target_organization = nullif(current_setting('uap.organization_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uap.memberships AS membership
      WHERE membership.organization_id = target_organization
        AND membership.user_id = nullif(current_setting('uap.actor_id', true), '')
        AND membership.state = 'active'
        AND membership.role = ANY(allowed_roles)
    )
$function$;
REVOKE ALL ON FUNCTION uap.has_org_role(text, text[]) FROM PUBLIC;

CREATE POLICY users_self_read ON uap.users FOR SELECT USING (
  id = nullif(current_setting('uap.actor_id', true), '')
);
CREATE POLICY organizations_member_read ON uap.organizations FOR SELECT USING (
  uap.has_org_role(id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY workspaces_member_read ON uap.workspaces FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY workspaces_admin_insert ON uap.workspaces FOR INSERT WITH CHECK (
  uap.has_org_role(organization_id, ARRAY['owner','admin'])
);
CREATE POLICY workspaces_admin_update ON uap.workspaces FOR UPDATE USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin'])
) WITH CHECK (
  uap.has_org_role(organization_id, ARRAY['owner','admin'])
);
CREATE POLICY workspaces_admin_delete ON uap.workspaces FOR DELETE USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin'])
);
CREATE POLICY agents_member_read ON uap.agents FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
CREATE POLICY agents_writer_insert ON uap.agents FOR INSERT WITH CHECK (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY agents_writer_update ON uap.agents FOR UPDATE USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
) WITH CHECK (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY agents_writer_delete ON uap.agents FOR DELETE USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member'])
);
CREATE POLICY import_receipts_member_read ON uap.import_receipts FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);

REVOKE ALL ON ALL TABLES IN SCHEMA uap FROM PUBLIC;
REVOKE ALL ON SCHEMA uap FROM PUBLIC;
`,
}];
