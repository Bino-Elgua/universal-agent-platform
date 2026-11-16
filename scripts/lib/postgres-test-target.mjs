import { Client } from 'pg';

/** Validate libpq's effective target, not only the cosmetic URL authority. */
export function localPostgresTestTarget(value, expected = {}) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
    // Query keys such as host, dbname and user override URL authority/path in pg.
    // Keep the runner's test database and identity decisions authoritative.
    const allowed = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'application_name', 'connect_timeout']);
    for (const [key] of url.searchParams) if (!allowed.has(key)) throw new Error();
    const client = new Client({ connectionString: url.toString() });
    const actual = client.connectionParameters;
    if (!['localhost', '127.0.0.1', '::1'].includes(actual.host)) throw new Error();
    if (expected.database && actual.database !== expected.database) throw new Error();
    if (expected.user && actual.user !== expected.user) throw new Error();
    return url;
  } catch {
    // Do not echo a supplied URL, credentials, certificate paths or pg parse details.
    throw new Error('PostgreSQL tests require an explicit loopback URL without connection target or identity overrides.');
  }
}
