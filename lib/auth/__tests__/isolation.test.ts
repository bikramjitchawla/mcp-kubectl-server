import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, protectedRoute } from '../guard';
import { createAuthRecord, consumeAuthRecord, readSession, deleteAuthRecord } from '../sessions';
import { withPrincipal, authorizeScope, currentPrincipal, type Principal } from '@/lib/tenancy/context';
import { tenants } from '@/lib/tenancy/config';
import { getRecord, putRecord, records } from '@/lib/store/disk';
import { normalizeMcpRequest } from '@/lib/validation';
import { GET as getHistory } from '@/app/api/history/[id]/route';
import { GET as getFix } from '@/app/api/fixes/[id]/route';
import { GET as getNamespaces } from '@/app/api/namespaces/route';
import { POST as diagnose } from '@/app/api/mcp/route';
import { POST as mutateFix } from '@/app/api/fixes/[id]/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { checkRateLimit } from '@/lib/ratelimit';
import { readJson } from '@/lib/http/json';
let directory: string;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function config() {
  return ['alpha', 'bravo'].map(id => ({ id, name: id, context: `${id}-cluster`, kubeconfig: `/no-credentials/${id}`, namespaces: [`${id}-namespace`],
    bindings: [{ groups: [`${id}-viewers`], role: 'viewer' }, { subjects: [`${id}-admin`], role: 'admin' }],
    apiKeys: [{ id: 'automation', sha256: hash(`${id}-key`), role: 'operator' }] }));
}
function req(route: string, key?: string, extra: Record<string, string> = {}, method = 'GET', body?: unknown) {
  return new NextRequest(`https://app.example${route}`, { method, headers: { ...(key ? { 'x-api-key': key } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function principal(id: string): Principal { return { subject: id, tenant: tenants().find(t => t.id === id)!, role: 'admin', method: 'api-key' }; }
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'tenant-test-'));
  vi.stubEnv('DIAGNOSTICS_DATA_DIR', directory); vi.stubEnv('TENANTS_CONFIG_FILE', path.join(directory, 'tenants.json'));
  vi.stubEnv('OIDC_ISSUER', 'https://id.example/realms/test'); vi.stubEnv('APP_URL', 'https://app.example');
  writeFileSync(process.env.TENANTS_CONFIG_FILE!, JSON.stringify(config()));
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe('authentication and tenant isolation', () => {
  it('fails closed without credentials, including when a caller spoofs identity headers', async () => {
    expect((await getNamespaces(req('/api/namespaces', undefined, { 'x-tenant-id': 'alpha', 'x-user': 'alpha-admin' }), undefined)).status).toBe(401);
  });
  it('fails closed when deployment configuration is missing', async () => {
    vi.stubEnv('TENANTS_CONFIG_FILE', '');
    expect((await getNamespaces(req('/api/namespaces', 'alpha-key'), undefined)).status).toBe(500);
  });
  it('binds an API key to exactly one tenant and refuses tenant header substitution', async () => {
    expect(authenticate(req('/api/history', 'alpha-key')).tenant.id).toBe('alpha');
    expect(() => authenticate(req('/api/history', 'alpha-key', { 'x-tenant-id': 'bravo' }))).toThrow();
    const result = await getNamespaces(req('/api/namespaces', 'bravo-key'), undefined);
    expect(await result.json()).toEqual({ namespaces: ['bravo-namespace'] });
  });
  it('rejects a credential accidentally assigned to two tenants', () => {
    const c = config(); c[1].apiKeys[0].sha256 = hash('alpha-key'); writeFileSync(process.env.TENANTS_CONFIG_FILE!, JSON.stringify(c));
    expect(() => authenticate(req('/api/history', 'alpha-key'))).toThrow();
  });
  it('partitions record reads, listings and writes even with identical IDs', async () => {
    await Promise.all(['alpha', 'bravo'].map(id => withPrincipal(principal(id), async () => {
      await new Promise(resolve => setTimeout(resolve, id === 'alpha' ? 2 : 1));
      expect(currentPrincipal()?.tenant.id).toBe(id);
      putRecord('runs', 'same-id', { owner: id });
      expect(getRecord('runs', 'same-id')).toEqual({ owner: id });
    })));
    withPrincipal(principal('alpha'), () => { expect(records('runs')).toEqual([{ owner: 'alpha' }]); putRecord('fixes', 'alpha-fix', { id: 'alpha-fix' }); putRecord('runs', 'alpha-only', { requestId: 'alpha-only', scope: { namespace: 'alpha-namespace' }, snapshot: { context: 'alpha-cluster' } }); });
    expect((await getHistory(req('/api/history/alpha-only', 'alpha-key'), { params: Promise.resolve({ id: 'alpha-only' }) })).status).toBe(200);
    expect((await getHistory(req('/api/history/alpha-only', 'bravo-key'), { params: Promise.resolve({ id: 'alpha-only' }) })).status).toBe(404);
    expect((await getFix(req('/api/fixes/alpha-fix', 'bravo-key'), { params: Promise.resolve({ id: 'alpha-fix' }) })).status).toBe(404);
  });
  it('hides historical runs and plans when their namespace is removed from the tenant', async () => {
    withPrincipal(principal('alpha'), () => {
      putRecord('runs', 'old-run', { requestId: 'old-run', scope: { namespace: 'alpha-namespace' }, snapshot: { context: 'alpha-cluster' } });
      putRecord('fixes', 'old-fix', { id: 'old-fix', scope: { context: 'alpha-cluster' }, resource: { namespace: 'alpha-namespace' } });
    });
    expect((await getFix(req('/api/fixes/old-fix', 'alpha-key'), { params: Promise.resolve({ id: 'old-fix' }) })).status).toBe(200);
    const c = config(); c[0].namespaces = ['alpha-new']; writeFileSync(process.env.TENANTS_CONFIG_FILE!, JSON.stringify(c));
    expect((await getHistory(req('/api/history/old-run', 'alpha-key'), { params: Promise.resolve({ id: 'old-run' }) })).status).toBe(404);
    expect((await getFix(req('/api/fixes/old-fix', 'alpha-key'), { params: Promise.resolve({ id: 'old-fix' }) })).status).toBe(404);
  });
  it('rejects cluster/namespace escalation before opening any Kubernetes client', async () => {
    const result = await diagnose(req('/api/mcp', 'alpha-key', {}, 'POST', { input_context: { namespace: 'bravo-namespace', includeNodes: false, enableAiSummary: false } }), undefined);
    expect(result.status).toBe(403);
    withPrincipal(principal('alpha'), () => {
      const scope = normalizeMcpRequest({ input_context: { namespace: 'alpha-namespace', includeNodes: false, enableAiSummary: false } }).input_context;
      expect(authorizeScope(scope).context).toBe('alpha-cluster');
      expect(() => authorizeScope({ ...scope, context: 'bravo-cluster' })).toThrow();
      expect(() => authorizeScope({ ...scope, includeNodes: true })).toThrow();
      expect(() => authorizeScope({ ...scope, enableAiSummary: true })).toThrow();
    });
  });
  it('enforces role and CSRF checks for browser sessions', async () => {
    const id = createAuthRecord({ subject: 'reader', issuer: process.env.OIDC_ISSUER, groups: ['alpha-viewers'], expiresAt: Date.now() + 60000 });
    const cookie = `diagnostics-session=${id}`;
    const operation = vi.fn(() => NextResponse.json({ ok: true }));
    const route = protectedRoute('operator', operation);
    expect((await route(req('/api/mcp', undefined, { cookie, origin: 'https://app.example' }, 'POST'), undefined)).status).toBe(403);
    expect(operation).not.toHaveBeenCalled();
    const admin = createAuthRecord({ subject: 'alpha-admin', issuer: process.env.OIDC_ISSUER, groups: [], expiresAt: Date.now() + 60000 });
    expect((await route(req('/api/mcp', undefined, { cookie: `diagnostics-session=${admin}`, origin: 'https://evil.example' }, 'POST'), undefined)).status).toBe(403);
    expect((await route(req('/api/mcp', undefined, { cookie: `diagnostics-session=${admin}`, origin: 'https://app.example' }, 'POST'), undefined)).status).toBe(200);
  });
  it('requires admin for GitHub publishing', async () => {
    expect((await mutateFix(req('/api/fixes/id', 'alpha-key', {}, 'POST', { action: 'publish', approvedDigest: 'a'.repeat(64) }), { params: Promise.resolve({ id: 'id' }) })).status).toBe(403);
  });
  it('re-evaluates configured membership and expires/revokes sessions', () => {
    const id = createAuthRecord({ subject: 'reader', issuer: process.env.OIDC_ISSUER, groups: ['alpha-viewers'], expiresAt: Date.now() + 60000 });
    expect(authenticate(req('/api/history', undefined, { cookie: `diagnostics-session=${id}` })).role).toBe('viewer');
    const c = config(); c[0].bindings = []; writeFileSync(process.env.TENANTS_CONFIG_FILE!, JSON.stringify(c));
    expect(() => authenticate(req('/api/history', undefined, { cookie: `diagnostics-session=${id}` }))).toThrow();
    deleteAuthRecord(id); expect(readSession(id)).toBeUndefined();
    const expired = createAuthRecord({ subject: 'reader', issuer: process.env.OIDC_ISSUER, groups: [], expiresAt: Date.now() - 1 });
    expect(readSession(expired)).toBeUndefined();
  });
  it('consumes login transactions only once and rejects foreign issuer sessions', () => {
    const id = createAuthRecord({ expiresAt: Date.now() + 60000, state: 'test' });
    expect(consumeAuthRecord(id)).toBeDefined(); expect(consumeAuthRecord(id)).toBeUndefined();
    const session = createAuthRecord({ subject: 'alpha-admin', issuer: 'https://evil.example', groups: [], expiresAt: Date.now() + 60000 });
    expect(readSession(session)).toBeUndefined();
  });
  it('requires same-origin logout and revokes the session server-side', async () => {
    const id = createAuthRecord({ subject: 'alpha-admin', issuer: process.env.OIDC_ISSUER, groups: [], expiresAt: Date.now() + 60000 });
    expect((await logout(req('/api/auth/logout', undefined, { cookie: `diagnostics-session=${id}`, origin: 'https://evil.example' }, 'POST'))).status).toBe(403);
    expect(readSession(id)).toBeDefined();
    expect((await logout(req('/api/auth/logout', undefined, { cookie: `diagnostics-session=${id}`, origin: 'https://app.example' }, 'POST'))).status).toBe(200);
    expect(readSession(id)).toBeUndefined();
  });
  it('rejects malformed/oversized JSON and string booleans', async () => {
    await expect(readJson(new Request('https://app.example', { method: 'POST', body: '{' }))).rejects.toThrow();
    await expect(readJson(new Request('https://app.example', { method: 'POST', body: 'x'.repeat(65537) }))).rejects.toThrow('64 KiB');
    expect(() => normalizeMcpRequest({ input_context: { includeLogs: 'false' } })).toThrow();
    expect((await diagnose(req('/api/mcp', 'alpha-key', {}, 'POST', { input_context: { includeLogs: 'false' } }), undefined)).status).toBe(400);
  });
  it('expires limits and keeps tenant budgets independent', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01'));
    for (let i = 0; i < 20; i++) expect(checkRateLimit('test-alpha').allowed).toBe(true);
    expect(checkRateLimit('test-alpha').allowed).toBe(false); expect(checkRateLimit('test-bravo').allowed).toBe(true);
    vi.advanceTimersByTime(60000); expect(checkRateLimit('test-alpha').allowed).toBe(true);
  });
});
