import { Hono } from 'hono';
import type { Pool } from 'pg';
import { SessionAuthenticator, type SessionIdentity } from './sessions.js';
import { TenantRepository, RepositoryValidationError } from './repository.js';
import { ConversationRepository } from './conversations.js';
import { TenantAccessError, UnsafeDatabaseRoleError } from './connection.js';

type ApiContext = { Variables: { identity: SessionIdentity } };

function bearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '');
  return match?.[1] ?? null;
}
function integer(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new RepositoryValidationError(field);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RepositoryValidationError(field);
  return number;
}

/**
 * Authenticated PostgreSQL data reads only. This router is not mounted in the legacy
 * runtime: using it never grants a computer, invokes Hermes, or accepts transcript writes.
 */
export function createStorageReadApi(applicationPool: Pool): Hono<ApiContext> {
  const app = new Hono<ApiContext>();
  const sessions = new SessionAuthenticator(applicationPool);
  const metadata = new TenantRepository(applicationPool);
  const conversations = new ConversationRepository(applicationPool);
  app.onError((error, c) => {
    if (error instanceof TenantAccessError) return c.json({ error: 'Access to this organization is unavailable.', code: 'tenant_access_denied' }, 403);
    if (error instanceof RepositoryValidationError) return c.json({ error: error.message, code: error.code }, 400);
    if (error instanceof UnsafeDatabaseRoleError) return c.json({ error: 'Storage access is not configured safely.', code: 'storage_unavailable' }, 503);
    return c.json({ error: 'Storage request failed.', code: 'storage_request_failed' }, 500);
  });
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Vary', 'Authorization');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  // Revocation is idempotent and never reports whether a token existed.
  app.post('/v1/session/revoke', async c => {
    const token = bearer(c.req.header('authorization'));
    if (token) await sessions.revoke(token);
    return c.body(null, 204);
  });
  app.use('/v1/*', async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    const identity = token ? await sessions.authenticate(token) : null;
    if (!identity) return c.json({ error: 'Unauthenticated.', code: 'unauthenticated' }, 401);
    c.set('identity', identity);
    await next();
  });
  app.get('/v1/session', c => c.json({ identity: c.get('identity') }));
  const scope = (actorId: string, organizationId: string) => ({ actorId, organizationId });
  app.get('/v1/organizations/:organizationId/workspaces', async c => c.json({
    workspaces: await metadata.listWorkspaces(scope(c.get('identity').userId, c.req.param('organizationId'))),
  }));
  app.get('/v1/organizations/:organizationId/agents', async c => {
    const workspaceId = c.req.query('workspaceId');
    return c.json({ agents: await metadata.listAgents(scope(c.get('identity').userId, c.req.param('organizationId')), workspaceId === undefined ? {} : { workspaceId }) });
  });
  app.get('/v1/organizations/:organizationId/agents/:agentId/conversations/current', async c => {
    const record = await conversations.getCurrentConversation(scope(c.get('identity').userId, c.req.param('organizationId')), c.req.param('agentId'));
    return record ? c.json({ conversation: record }) : c.json({ error: 'Not found.' }, 404);
  });
  app.get('/v1/organizations/:organizationId/agents/:agentId/conversations/:generation/rows', async c => {
    const generation = integer(c.req.param('generation'), 'generation')!;
    if (generation < 1) throw new RepositoryValidationError('generation');
    const queries = c.req.queries();
    if (Object.entries(queries).some(([key, values]) => !['beforeSeq', 'afterRevision', 'limit'].includes(key) || values.length !== 1)) throw new RepositoryValidationError('row cursor');
    const tenant = scope(c.get('identity').userId, c.req.param('organizationId'));
    const record = await conversations.getConversation(tenant, c.req.param('agentId'), generation);
    if (!record) return c.json({ error: 'Not found.' }, 404);
    // A stored body is bounded at 1MiB; keep HTTP pages small enough to serialize safely.
    const limit = integer(c.req.query('limit'), 'limit') ?? 4;
    if (limit < 1 || limit > 4) throw new RepositoryValidationError('limit (maximum 4 rows per HTTP page)');
    return c.json({ rows: await conversations.listRows(tenant, {
      agentId: record.agentId, generation,
      beforeSeq: integer(c.req.query('beforeSeq'), 'beforeSeq'),
      afterRevision: integer(c.req.query('afterRevision'), 'afterRevision'),
      limit,
    }) });
  });
  return app;
}
