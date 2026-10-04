import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/auth/guard';
import { requirePrincipal } from '@/lib/tenancy/context';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = protectedRoute('viewer', () => NextResponse.json({ namespaces: [...requirePrincipal().tenant.namespaces].sort() }));
