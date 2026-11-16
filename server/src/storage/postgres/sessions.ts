import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withIdentity } from './connection.js';
import { assertSessionIssuerRole } from './session-grants.js';

export interface SessionIdentity { userId: string; expiresAt: number }
export interface IssuedSession extends SessionIdentity { token: string; createdAt: number }
export interface IssueSessionOptions { ttlMs?: number }
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = MAX_TTL_MS;

export class SessionValidationError extends Error {
  readonly code = 'invalid_session_request';
  constructor() {
    super('A valid user ID and an integer session lifetime between one second and thirty days are required.');
    this.name = 'SessionValidationError';
  }
}
export class SessionIssuanceError extends Error {
  readonly code = 'invalid_session_user';
  constructor() {
    super('A session can only be issued for an existing user.');
    this.name = 'SessionIssuanceError';
  }
}

function validUserId(userId: string): boolean {
  return typeof userId === 'string' && userId.trim().length > 0 && userId.length <= 200 && !userId.includes('\0');
}
function digestToken(token: string): string | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== token) return null;
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Issuer credentials never enter an application request path or a tenant transaction. */
async function withIssuer<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let transaction = false;
  let discard = false;
  try {
    await client.query("SELECT set_config('uap.actor_id','',false),set_config('uap.organization_id','',false)");
    await client.query('BEGIN');
    transaction = true;
    await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL search_path=pg_catalog,uap");
    await assertSessionIssuerRole(client);
    const result = await work(client);
    await client.query('COMMIT');
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => { discard = true; });
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') throw new SessionIssuanceError();
    throw error;
  } finally {
    if (!discard) {
      await client.query("SELECT set_config('uap.actor_id','',false),set_config('uap.organization_id','',false)").catch(() => { discard = true; });
    }
    client.release(discard);
  }
}

/** A trusted enrollment/authentication service must independently prove the user before issuance. */
export class SessionIssuer {
  constructor(private readonly pool: Pool) {}

  async issue(userId: string, options: IssueSessionOptions = {}): Promise<IssuedSession> {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new SessionValidationError();
    const ttlMs = options.ttlMs === undefined ? DEFAULT_TTL_MS : options.ttlMs;
    if (!validUserId(userId) || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_TTL_MS) throw new SessionValidationError();
    return withIssuer(this.pool, async client => {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const createdAt = Date.now();
      const expiresAt = createdAt + ttlMs;
      await client.query('INSERT INTO uap.auth_sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', [tokenHash, userId, createdAt, expiresAt]);
      // This is the only place the raw token is returned. It is never stored or logged.
      return { token, userId, createdAt, expiresAt };
    });
  }

  async revokeAll(userId: string): Promise<number> {
    if (!validUserId(userId)) throw new SessionValidationError();
    return withIssuer(this.pool, async client => {
      const result = await client.query(`UPDATE uap.auth_sessions
        SET revoked_at=greatest(created_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
        WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
      return result.rowCount ?? 0;
    });
  }
}

/** Resolves identity before choosing any organization; no token confers membership authority. */
export class SessionAuthenticator {
  constructor(private readonly pool: Pool) {}

  async authenticate(rawToken: string): Promise<SessionIdentity | null> {
    return withIdentity(this.pool, async client => {
      const tokenHash = digestToken(rawToken);
      if (!tokenHash) return null;
      const result = await client.query<{ user_id: string; expires_at: string }>('SELECT user_id,expires_at FROM uap.authenticate_session($1)', [tokenHash]);
      if (!result.rows.length) return null;
      const row = result.rows[0];
      const expiresAt = Number(row.expires_at);
      if (result.rows.length !== 1 || typeof row.user_id !== 'string' || !Number.isSafeInteger(expiresAt)) throw new Error('Invalid session identity result.');
      return { userId: row.user_id, expiresAt };
    });
  }

  async revoke(rawToken: string): Promise<boolean> {
    return withIdentity(this.pool, async client => {
      const tokenHash = digestToken(rawToken);
      if (!tokenHash) return false;
      const result = await client.query<{ revoked: boolean }>('SELECT uap.revoke_session($1) AS revoked', [tokenHash]);
      return result.rows.length === 1 && result.rows[0].revoked === true;
    });
  }
}
