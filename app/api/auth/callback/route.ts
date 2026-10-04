import { NextRequest, NextResponse } from 'next/server';
import { finishLogin, redirectUri, type LoginTransaction } from '@/lib/auth/oidc';
import { consumeAuthRecord, createAuthRecord, deleteAuthRecord, sessionCookie, transactionCookie, cookieOptions, appOrigin } from '@/lib/auth/sessions';
import { tenants, roleFor } from '@/lib/tenancy/config';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const transaction = consumeAuthRecord<LoginTransaction>(req.cookies.get(transactionCookie)?.value ?? '');
    if (!transaction) throw new Error('Expired or replayed login.');
    const url = new URL(redirectUri()); url.search = req.nextUrl.search;
    const identity = await finishLogin(url, transaction);
    if (!tenants().some(t => roleFor(t, identity.subject, identity.groups))) throw new Error('No tenant membership.');
    const previous = req.cookies.get(sessionCookie)?.value; if (previous) deleteAuthRecord(previous);
    const response = NextResponse.redirect(new URL('/', appOrigin()));
    response.cookies.set(sessionCookie, createAuthRecord(identity), { ...cookieOptions(), maxAge: Math.max(0, Math.floor((identity.expiresAt - Date.now()) / 1000)) });
    response.cookies.set(transactionCookie, '', { ...cookieOptions(), maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign-in failed or no tenant access is assigned. Start a new sign-in or contact your administrator.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
}
