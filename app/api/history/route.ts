import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listRuns } from '@/lib/store/history';
import { protectedRoute } from '@/lib/auth/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = protectedRoute('viewer', (req: NextRequest) => {
  const offset = z.coerce.number().int().min(0).parse(req.nextUrl.searchParams.get('offset') ?? 0);
  const limit = z.coerce.number().int().min(1).max(100).parse(req.nextUrl.searchParams.get('limit') ?? 50);
  const runs = listRuns(offset, limit);
  return NextResponse.json({ runs, nextOffset: runs.length === limit ? offset + limit : null });
});
