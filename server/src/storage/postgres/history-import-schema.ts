import type { PostgresMigration } from './schema.js';

/** History-stage provenance is distinct from the original metadata mapping receipts. */
export const HISTORY_IMPORT_MIGRATION: PostgresMigration = {
  id: 4,
  name: 'staged_conversation_history_receipts',
  sql: `
ALTER TABLE uap.message_rows DROP CONSTRAINT message_rows_kind_check;
ALTER TABLE uap.message_rows ADD CONSTRAINT message_rows_kind_check CHECK (kind IN ('message','activity','card','event','tool-call','notice'));
ALTER TABLE uap.message_rows ADD CONSTRAINT message_rows_body_size CHECK (octet_length(body::text) <= 2097152);
ALTER TABLE uap.llm_items ADD CONSTRAINT llm_items_item_size CHECK (octet_length(item::text) <= 2097152);
CREATE UNIQUE INDEX message_rows_revision_unique ON uap.message_rows(organization_id,agent_id,generation,updated_revision);
CREATE TABLE uap.history_import_receipts (
  organization_id text NOT NULL REFERENCES uap.organizations(id) ON DELETE RESTRICT,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  mapping_version integer NOT NULL CHECK (mapping_version = 1),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  imported_at bigint NOT NULL CHECK (imported_at >= 0),
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,source_digest)
);
ALTER TABLE uap.history_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE uap.history_import_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY history_import_receipts_member_read ON uap.history_import_receipts FOR SELECT USING (
  uap.has_org_role(organization_id, ARRAY['owner','admin','member','viewer'])
);
REVOKE ALL ON uap.history_import_receipts FROM PUBLIC;
`,
};
