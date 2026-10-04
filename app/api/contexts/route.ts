import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/auth/guard';
import { requirePrincipal } from '@/lib/tenancy/context';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = protectedRoute('viewer', () => {
  const { tenant } = requirePrincipal();
  return NextResponse.json({ contexts: [tenant.context], current: tenant.context });
});
