import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { migratePostgres, migrationStatus, grantApplicationRole } from './migrations.js';
import { inspectSqliteSource, importSqliteFoundation } from './import.js';

const help = `PostgreSQL foundation operator tools (the running application still uses SQLite).

  npm run db:postgres -- migrate
  npm run db:postgres -- status
  npm run db:postgres -- grant-app-role --role <existing-login>
  npm run db:postgres -- inspect-sqlite --source <backup.db>
  npm run db:postgres -- import-sqlite --source <backup.db> --org-id <id> --org-slug <slug>
      --org-name <name> --workspace-id <id> --workspace-name <name> [--apply]

Set UAP_POSTGRES_ADMIN_URL through the process environment or a protected env file.
Import is a dry run by default. --apply stages identity/agent metadata only;
it neither changes the running application storage nor starts imported agents.
`;

function required(value: string | undefined, field: string): string {
  if (!value) throw new Error(`Required option: --${field}`);
  return value;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, apply: { type: 'boolean', default: false },
    source: { type: 'string' }, role: { type: 'string' },
    'org-id': { type: 'string' }, 'org-slug': { type: 'string' }, 'org-name': { type: 'string' },
    'workspace-id': { type: 'string' }, 'workspace-name': { type: 'string' },
  } });
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  if (positionals.length !== 1) throw new Error('Supply exactly one operator command.');
  const command = positionals[0];
  if (command === 'inspect-sqlite') {
    const snapshot = inspectSqliteSource(required(values.source, 'source'));
    console.log(JSON.stringify({ mappingVersion: snapshot.mappingVersion, sourceDigest: snapshot.sourceDigest, fingerprintScope: snapshot.fingerprintScope, counts: snapshot.counts, runtimeState: 'inactive_metadata_only' }, null, 2));
    return;
  }
  if (!['migrate', 'status', 'grant-app-role', 'import-sqlite'].includes(command)) throw new Error('Unknown operator command. Use --help.');
  const connectionString = process.env.UAP_POSTGRES_ADMIN_URL;
  if (!connectionString && !(command === 'import-sqlite' && !values.apply)) throw new Error('Set UAP_POSTGRES_ADMIN_URL for this operator command.');
  // A dry run never opens a connection; no environment-backed pool is created when absent.
  const pool = connectionString ? new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
  try {
    if (command === 'migrate') console.log(JSON.stringify(await migratePostgres(pool!), null, 2));
    if (command === 'status') console.log(JSON.stringify(await migrationStatus(pool!), null, 2));
    if (command === 'grant-app-role') {
      await grantApplicationRole(pool!, required(values.role, 'role'));
      console.log(JSON.stringify({ status: 'granted', scope: 'tenant_metadata_only' }));
    }
    if (command === 'import-sqlite') {
      const report = await importSqliteFoundation(pool, {
        sourcePath: required(values.source, 'source'), organizationId: required(values['org-id'], 'org-id'),
        organizationSlug: required(values['org-slug'], 'org-slug'), organizationName: required(values['org-name'], 'org-name'),
        workspaceId: required(values['workspace-id'], 'workspace-id'), workspaceName: required(values['workspace-name'], 'workspace-name'),
        apply: values.apply,
      });
      console.log(JSON.stringify(report, null, 2));
    }
  } finally { await pool?.end(); }
}

main().catch(error => {
  // Never print raw PostgreSQL errors, row details, URLs, source records or credentials.
  const safe = error instanceof Error && ['SqliteImportError', 'PostgresMigrationError'].includes(error.name);
  console.error(safe || (error instanceof Error && /^(Required option:|Set UAP_POSTGRES_ADMIN_URL|Supply exactly|Unknown operator)/.test(error.message))
    ? error.message : 'Database operation failed. Check source validity, connectivity and operator privileges; no connection details are printed.');
  process.exitCode = 1;
});
