import { listPlans } from '@/lib/gitops/store';
import { readJson } from '@/lib/http/json';
import { protectedRoute } from '@/lib/auth/guard';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRun, pruneFixes } from '@/lib/store/history';
import { createPlan } from '@/lib/gitops/plans';
import { putRecord, records } from '@/lib/store/disk';
import type { FixPlan } from '@/types/investigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ runId: z.string().min(1), resource: z.object({ kind: z.literal('Deployment'), namespace: z.string(), name: z.string() }) });
function handleGET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('runId');
  return NextResponse.json({ plans: listPlans().filter(p => !runId || p.sourceRunId === runId).map(p => ({ ...p, preview: p.preview ? { ...p.preview, content: '' } : undefined })) });
}
async function handlePOST(req: NextRequest) {
  try {
    const input = schema.parse(await readJson(req));
    const current = getRun(input.runId);
    const baseline = current?.investigation?.baselineId ? getRun(current.investigation.baselineId) : undefined;
    if (!current || !baseline) return NextResponse.json({ error: 'Source run or comparison baseline is unavailable.' }, { status: 409 });
    pruneFixes();
    if (records<FixPlan>('fixes').length >= 100) return NextResponse.json({ error: 'Tenant limit of 100 fix plans reached.' }, { status: 409 });
    const plan = createPlan(current, baseline, input.resource);
    putRecord('fixes', plan.id, plan);
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create a fix proposal.' }, { status: 400 }); }
}

export const GET = protectedRoute('viewer', handleGET);

export const POST = protectedRoute('operator', handlePOST);
