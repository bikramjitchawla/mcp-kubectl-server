import { currentPrincipal } from '@/lib/tenancy/context';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function dataDirectory(collection: string): string {
  const principal = currentPrincipal();
  if (!principal && process.env.NODE_ENV !== 'test') throw new Error('Tenant storage context is required.');
  if (!/^[a-z-]+$/.test(collection)) throw new Error('Invalid collection.');
  const directory = path.join(process.env.DIAGNOSTICS_DATA_DIR ?? '.data', 'tenants', principal?.tenant.id ?? 'test', collection);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}
const key = (id: string) => createHash('sha256').update(id).digest('hex');
export function putRecord<T>(collection: string, id: string, value: T): void {
  const directory = dataDirectory(collection);
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > 8 * 1024 * 1024) throw new Error('Record exceeds the 8 MiB limit. Narrow the diagnostic scope.');
  const destination = path.join(directory, `${key(id)}.json`);
  const root = path.dirname(directory);
  const usage = readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).reduce((sum, e) => {
    try { return sum + statSync(path.join(e.parentPath, e.name)).size; } catch { return sum; }
  }, 0);
  let previousSize = 0;
  try { previousSize = statSync(destination).size; } catch { /* New record. */ }
  if (usage - previousSize + bytes > 256 * 1024 * 1024) throw new Error('Tenant storage quota reached. Archive old records before continuing.');
  const temporary = path.join(directory, `${key(id)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, serialized, { mode: 0o600 });
    renameSync(temporary, path.join(directory, `${key(id)}.json`));
  } finally { rmSync(temporary, { force: true }); }
}
export function getRecord<T>(collection: string, id: string): T | undefined {
  try { return JSON.parse(readFileSync(path.join(dataDirectory(collection), `${key(id)}.json`), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export function records<T>(collection: string): T[] {
  return readdirSync(dataDirectory(collection)).filter(f => f.endsWith('.json')).flatMap(f => {
    try { return [JSON.parse(readFileSync(path.join(dataDirectory(collection), f), 'utf8')) as T]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  });
}
export function deleteRecord(collection: string, id: string) {
  rmSync(path.join(dataDirectory(collection), `${key(id)}.json`), { force: true });
}
// Cross-process exclusion; a crash leaves a lock requiring operator inspection, not an unsafe retry.
export async function withRecordLock<T>(collection: string, id: string, operation: () => Promise<T>): Promise<T> {
  const lock = path.join(dataDirectory(collection), `${key(id)}.lock`);
  try { mkdirSync(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This workflow is busy or has an interrupted operation requiring inspection.');
    throw error;
  }
  try { return await operation(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
