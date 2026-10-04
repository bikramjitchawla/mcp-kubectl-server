export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const key = window.sessionStorage.getItem('diagnostics-api-key');
  if (key) headers.set('X-API-Key', key);
  const tenant = window.sessionStorage.getItem('diagnostics-tenant');
  if (tenant) headers.set('X-Tenant-ID', tenant);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && !String(input).startsWith('/api/auth/')) window.dispatchEvent(new Event('diagnostics-session-expired'));
  return response;
}
