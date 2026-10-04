import { currentPrincipal } from '@/lib/tenancy/context';
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (!request.body) throw new SyntaxError('JSON body required.');
  const reader = request.body.getReader();
  const signal = currentPrincipal()?.signal ?? request.signal;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new SyntaxError('Request was cancelled.');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new SyntaxError('Request was cancelled.');
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new SyntaxError('Request body exceeds 64 KiB.'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
