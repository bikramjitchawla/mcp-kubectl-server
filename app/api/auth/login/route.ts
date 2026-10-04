import { checkRateLimit } from '@/lib/ratelimit';
import { NextResponse } from 'next/server';
import { beginLogin } from '@/lib/auth/oidc';
import { createAuthRecord, transactionCookie, cookieOptions } from '@/lib/auth/sessions';
export const runtime = 'nodejs';
export async function GET() {
  if (!checkRateLimit('oidc-login-global', 60).allowed) return NextResponse.json({ error: 'Too many sign-in attempts.' }, { status: 429, headers: { 'Retry-After': '60' } });
  try {
    const { transaction, url } = await beginLogin();
    const response = NextResponse.redirect(url);
    response.cookies.set(transactionCookie, createAuthRecord(transaction), { ...cookieOptions(), maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch { return NextResponse.json({ error: 'OIDC sign-in is not configured or the provider is unavailable.' }, { status: 503 }); }
}
