import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://identity.example/realms/diagnostics';
const transaction = { verifier: 'a'.repeat(43), state: 'expected-state', nonce: 'expected-nonce', expiresAt: Date.now() + 600000 };
let claimOverrides: Record<string, unknown>;
let corruptSignature: boolean;
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: 'diagnostics', sub: 'user-123', iat: now, exp: now + 300, nonce: transaction.nonce,
    groups: ['/diagnostics/team-a/operators'], ...claimOverrides })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  if (corruptSignature) signature[0] ^= 1;
  return `${header}.${payload}.${signature.toString('base64url')}`;
}
beforeEach(() => {
  vi.resetModules(); claimOverrides = {}; corruptSignature = false;
  vi.stubEnv('OIDC_ISSUER', issuer); vi.stubEnv('OIDC_CLIENT_ID', 'diagnostics'); vi.stubEnv('OIDC_CLIENT_SECRET', 'secret'); vi.stubEnv('APP_URL', 'https://app.example');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    let data: unknown;
    if (url.includes('.well-known')) data = { issuer, authorization_endpoint: issuer + '/auth', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] };
    else if (url.endsWith('/token')) data = { access_token: 'not-persisted', token_type: 'Bearer', expires_in: 300, id_token: token() };
    else if (url.endsWith('/jwks')) data = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] };
    else throw new Error('Unexpected endpoint: ' + url);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const callback = () => new URL('https://app.example/api/auth/callback?code=code&state=expected-state');
describe('OIDC protocol validation with real signed ID tokens', () => {
  it('uses PKCE, state and nonce for every authorization request', async () => {
    const { beginLogin } = await import('../oidc');
    const result = await beginLogin();
    expect(result.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.url.searchParams.get('state')).toBe(result.transaction.state);
    expect(result.url.searchParams.get('nonce')).toBe(result.transaction.nonce);
    expect(result.url.searchParams.get('redirect_uri')).toBe('https://app.example/api/auth/callback');
  });
  it('accepts a correctly signed ID token and only returns bounded identity claims', async () => {
    const { finishLogin } = await import('../oidc');
    const identity = await finishLogin(callback(), transaction);
    expect(identity).toMatchObject({ subject: 'user-123', issuer, groups: ['/diagnostics/team-a/operators'] });
    expect(identity).not.toHaveProperty('access_token');
  });
  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'another-client' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['expiry', { exp: 1 }],
  ])('rejects an invalid %s', async (_name, claims) => {
    claimOverrides = claims;
    const { finishLogin } = await import('../oidc');
    await expect(finishLogin(callback(), transaction)).rejects.toThrow();
  });
  it('rejects a forged signature', async () => {
    corruptSignature = true;
    const { finishLogin } = await import('../oidc');
    await expect(finishLogin(callback(), transaction)).rejects.toThrow();
  });
  it('rejects state mismatch before exchanging the code', async () => {
    const { finishLogin } = await import('../oidc');
    const url = callback(); url.searchParams.set('state', 'wrong-state');
    await expect(finishLogin(url, transaction)).rejects.toThrow();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/token'))).toBe(false);
  });
});
