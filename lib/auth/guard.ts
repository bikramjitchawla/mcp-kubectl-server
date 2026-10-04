import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { tenants, roleFor, hasRole, type Role } from '@/lib/tenancy/config';
import { withPrincipal, AccessDenied, type Principal } from '@/lib/tenancy/context';
import { readSession, sessionCookie, appOrigin } from './sessions';
import { checkRateLimit } from '@/lib/ratelimit';

export function authenticate(req: NextRequest): Principal {
  const configured = tenants();
  const selected = req.headers.get('x-tenant-id');
  const key = req.headers.get('x-api-key');
  if (key) {
    const digest = createHash('sha256').update(key).digest();
    const matches = configured.flatMap(tenant => tenant.apiKeys.filter(k => timingSafeEqual(digest, Buffer.from(k.sha256, 'hex'))).map(k => ({ tenant, key: k })));
    if (matches.length !== 1 || (selected && selected !== matches[0].tenant.id)) throw new AuthenticationError();
    return { subject: `api-key:${matches[0].key.id}`, tenant: matches[0].tenant, role: matches[0].key.role, method: 'api-key' };
  }
  const identity = readSession(req.cookies.get(sessionCookie)?.value);
  if (!identity) throw new AuthenticationError();
  const memberships = configured.flatMap(tenant => { const role = roleFor(tenant, identity.subject, identity.groups); return role ? [{ tenant, role }] : []; });
  const membership = selected ? memberships.find(m => m.tenant.id === selected) : memberships.length === 1 ? memberships[0] : undefined;
  if (!membership) throw new AccessDenied('Select a tenant you belong to.');
  return { ...membership, subject: identity.subject, method: 'oidc' };
}
export class AuthenticationError extends Error { readonly status = 401; constructor() { super('Sign in or provide a tenant API key.'); } }
export function checkOrigin(req: NextRequest) {
  if (req.headers.get('origin') !== appOrigin()) throw new AccessDenied('Same-origin request required.');
}
const inFlight = new Map<string, number>();

// Every data route must use this wrapper. Tenant context is never accepted from a request body.
export function protectedRoute<C>(required: Role, handler: (req: NextRequest, context: C) => Promise<Response> | Response) {
  return async (req: NextRequest, context: C): Promise<Response> => {
    const started = Date.now();
    let principal: Principal | undefined;
    let acquired = false;
    try {
      principal = authenticate(req);
      if (!hasRole(principal.role, required)) throw new AccessDenied('Your role does not permit this operation.');
      if (principal.method === 'oidc' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) checkOrigin(req);
      const expensive = req.method !== 'GET';
      const rate = checkRateLimit(`${principal.tenant.id}:${principal.subject}:${expensive ? 'write' : 'read'}`, expensive ? 20 : 120);
      const tenantRate = checkRateLimit(`${principal.tenant.id}:tenant:${expensive ? 'write' : 'read'}`, expensive ? 60 : 600);
      if (!rate.allowed || !tenantRate.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) } });
      if (expensive) {
        const active = inFlight.get(principal.tenant.id) ?? 0;
        if (active >= 2) return NextResponse.json({ error: 'Tenant already has two operations running.' }, { status: 429, headers: { 'Retry-After': '5' } });
        inFlight.set(principal.tenant.id, active + 1); acquired = true;
      }
      principal.signal = AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]);
      const response = await withPrincipal(principal, () => handler(req, context));
      response.headers.set('Cache-Control', 'no-store');
      console.info(JSON.stringify({ event: 'api_audit', tenant: principal.tenant.id, subject: principal.subject, role: principal.role, method: req.method, path: req.nextUrl.pathname, status: response.status, durationMs: Date.now() - started }));
      return response;
    } catch (error) {
      const status = error instanceof AuthenticationError ? 401 : error instanceof AccessDenied ? 403 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
      console.error(JSON.stringify({ event: 'api_denied_or_failed', tenant: principal?.tenant.id, subject: principal?.subject, path: req.nextUrl.pathname, status, reason: status === 500 && error instanceof Error ? error.message : undefined }));
      return NextResponse.json({ error: status === 500 ? 'Request failed. Check server configuration and logs.' : error instanceof Error ? error.message : 'Invalid request' }, { status, headers: { 'Cache-Control': 'no-store' } });
    } finally {
      if (acquired && principal) {
        const remaining = (inFlight.get(principal.tenant.id) ?? 1) - 1;
        if (remaining > 0) inFlight.set(principal.tenant.id, remaining); else inFlight.delete(principal.tenant.id);
      }
    }
  };
}
