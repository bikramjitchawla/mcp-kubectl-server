import * as oidc from 'openid-client';
import { appOrigin } from './sessions';
let configuration: Promise<oidc.Configuration> | undefined;
export function oidcConfig() {
  if (!process.env.OIDC_ISSUER || !process.env.OIDC_CLIENT_ID || !process.env.OIDC_CLIENT_SECRET) throw new Error('OIDC issuer, client ID, and secret are required.');
  const issuer = new URL(process.env.OIDC_ISSUER);
  if (issuer.protocol !== 'https:') throw new Error('OIDC_ISSUER must use HTTPS.');
  configuration ??= oidc.discovery(issuer, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET, undefined, { timeout: 10, execute: [oidc.enableNonRepudiationChecks] }).catch(e => { configuration = undefined; throw e; });
  return configuration;
}
export const redirectUri = () => appOrigin() + '/api/auth/callback';
export interface LoginTransaction { verifier: string; state: string; nonce: string; expiresAt: number }
export async function beginLogin() {
  const config = await oidcConfig();
  if (!(process.env.OIDC_SCOPES ?? 'openid profile email').split(/\s+/).includes('openid')) throw new Error('OIDC_SCOPES must include openid.');
  const transaction: LoginTransaction = { verifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce(), expiresAt: Date.now() + 600_000 };
  const url = oidc.buildAuthorizationUrl(config, { redirect_uri: redirectUri(), scope: process.env.OIDC_SCOPES ?? 'openid profile email', response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier), code_challenge_method: 'S256', state: transaction.state, nonce: transaction.nonce });
  return { transaction, url };
}
export async function finishLogin(url: URL, transaction: LoginTransaction) {
  const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), url, {
    pkceCodeVerifier: transaction.verifier, expectedState: transaction.state, expectedNonce: transaction.nonce, idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('OIDC subject missing.');
  const groups = claims[process.env.OIDC_GROUPS_CLAIM ?? 'groups'];
  return { subject: claims.sub, issuer: claims.iss, groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
    expiresAt: Math.min(Date.now() + 3600_000, claims.exp * 1000) };
}
