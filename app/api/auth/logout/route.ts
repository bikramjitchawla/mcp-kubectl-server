import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/auth/guard';
import { deleteAuthRecord, sessionCookie, cookieOptions } from '@/lib/auth/sessions';
export async function POST(req: NextRequest) {
  try { checkOrigin(req); } catch { return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 }); }
  const id = req.cookies.get(sessionCookie)?.value; if (id) deleteAuthRecord(id);
  const response = NextResponse.json({ signedOut: true });
  response.cookies.set(sessionCookie, '', { ...cookieOptions(), maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
