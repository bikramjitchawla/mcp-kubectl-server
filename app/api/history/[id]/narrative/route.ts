import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/auth/guard';
import { getRun } from '@/lib/store/history';
import { withRecordLock } from '@/lib/store/disk';
import { MCPAgentRunner } from '@/agents/mcpAgentRunner';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = protectedRoute('operator', async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return withRecordLock('runs', id, async () => {
    const run = getRun(id);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    const result = await new MCPAgentRunner().completeNarrative(run);
    return NextResponse.json(result);
  });
});
