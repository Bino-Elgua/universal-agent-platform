#!/usr/bin/env node
// Run locally with node --env-file=.env scripts/sign-in-link.mjs owner@example.com.
// Only the resulting short-lived, single-use link is printed. Secrets stay in-process.
import crypto from 'node:crypto';

async function main() {
  const email = process.argv[2]?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) throw new Error('Usage: node --env-file=.env scripts/sign-in-link.mjs <owner-email>');
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required; load the same .env used by the server.');
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be the running local server port.');
  const key = crypto.createHmac('sha256', process.env.SESSION_SECRET).update('owner-login').digest('hex');
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/owner`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, link: true }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.url !== 'string') throw new Error(body.error ?? `Sign-in failed (${response.status}).`);
  process.stdout.write(`${body.url}\n`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
