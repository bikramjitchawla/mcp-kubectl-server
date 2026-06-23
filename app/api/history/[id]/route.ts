import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '@/lib/store/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    const run = getRun(id);
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json(run);
  });
}
