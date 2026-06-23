import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/store/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ runs: listRuns() });
}
