import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const identitySchema = z.object({ subject: z.string().min(1), issuer: z.string(), groups: z.array(z.string()), expiresAt: z.number() });
export type Identity = z.infer<typeof identitySchema>;
export const sessionCookie = process.env.NODE_ENV === 'production' ? '__Host-diagnostics-session' : 'diagnostics-session';
export const transactionCookie = process.env.NODE_ENV === 'production' ? '__Host-diagnostics-login' : 'diagnostics-login';
function directory() {
  const root = path.join(process.env.DIAGNOSTICS_DATA_DIR ?? '.data', 'auth');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}
function file(id: string) { return path.join(directory(), createHash('sha256').update(id).digest('hex') + '.json'); }
export function createAuthRecord<T extends { expiresAt: number }>(value: T): string {
  // Bound expired session/transaction storage without retaining OIDC access tokens.
  for (const name of readdirSync(directory())) {
    if (!name.endsWith('.json')) continue;
    try {
      const location = path.join(directory(), name);
      if (JSON.parse(readFileSync(location, 'utf8')).expiresAt <= Date.now()) rmSync(location, { force: true });
    } catch { /* Concurrent expiry cleanup. */ }
  }
  if (readdirSync(directory()).length >= 5000) throw new Error('Authentication store is at capacity.');
  const id = randomBytes(32).toString('base64url');
  const destination = file(id);
  const temporary = destination + '.tmp';
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, destination);
  return id;
}
export function readAuthRecord<T extends { expiresAt: number }>(id?: string): T | undefined {
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return undefined;
  try {
    const record = JSON.parse(readFileSync(file(id), 'utf8')) as T;
    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) { deleteAuthRecord(id); return undefined; }
    return record;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export function consumeAuthRecord<T extends { expiresAt: number }>(id: string): T | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return undefined;
  const source = file(id), consumed = source + '.' + randomBytes(8).toString('hex') + '.used';
  try { renameSync(source, consumed); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
  try { const value = JSON.parse(readFileSync(consumed, 'utf8')) as T; return value.expiresAt > Date.now() ? value : undefined; }
  finally { rmSync(consumed, { force: true }); }
}
export function readSession(id?: string) {
  const record = readAuthRecord<Identity>(id);
  const parsed = identitySchema.safeParse(record);
  return parsed.success && parsed.data.issuer === process.env.OIDC_ISSUER ? parsed.data : undefined;
}
export function deleteAuthRecord(id: string) { rmSync(file(id), { force: true }); }
export function appOrigin() {
  const url = new URL(process.env.APP_URL ?? 'http://localhost:3000');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('APP_URL must be an origin.');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('APP_URL requires HTTPS in production.');
  return url.origin;
}
export const cookieOptions = () => ({ httpOnly: true, secure: new URL(appOrigin()).protocol === 'https:', sameSite: 'lax' as const, path: '/' });
