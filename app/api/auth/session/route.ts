import { NextRequest, NextResponse } from 'next/server';
import { readSession, sessionCookie } from '@/lib/auth/sessions';
import { tenants, roleFor } from '@/lib/tenancy/config';
import { authenticate } from '@/lib/auth/guard';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (req.headers.has('x-api-key')) {
      const p = authenticate(req);
      return NextResponse.json({ authenticated: true, method: p.method, tenants: [{ id: p.tenant.id, name: p.tenant.name, role: p.role, allowNodes: p.tenant.allowNodes, allowAi: p.tenant.allowAi }] }, { headers });
    }
    const identity = readSession(req.cookies.get(sessionCookie)?.value);
    if (!identity) return NextResponse.json({ authenticated: false, oidc: !!process.env.OIDC_ISSUER }, { headers });
    const memberships = tenants().flatMap(t => { const role = roleFor(t, identity.subject, identity.groups); return role ? [{ id: t.id, name: t.name, role, allowNodes: t.allowNodes, allowAi: t.allowAi }] : []; });
    return NextResponse.json({ authenticated: true, method: 'oidc', tenants: memberships }, { headers });
  } catch { return NextResponse.json({ error: 'Authentication configuration unavailable.' }, { status: 503, headers }); }
}
