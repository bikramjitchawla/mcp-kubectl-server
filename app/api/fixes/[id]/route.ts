import { getPlan } from '@/lib/gitops/store';
import { requirePrincipal, AccessDenied } from '@/lib/tenancy/context';
import { readJson } from '@/lib/http/json';
import { protectedRoute } from '@/lib/auth/guard';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { putRecord, withRecordLock } from '@/lib/store/disk';
import { getRun } from '@/lib/store/history';
import type { FixPlan } from '@/types/investigation';
import { previewPlan, publishPlan, syncPullRequest } from '@/lib/gitops/github';
import { verifyPlan } from '@/lib/gitops/plans';
import { MCPAgentRunner } from '@/agents/mcpAgentRunner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview') }), z.object({ action: z.literal('publish'), approvedDigest: z.string().length(64) }),
  z.object({ action: z.literal('verify') }),
]);
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const plan = getPlan((await params).id);
  return plan ? NextResponse.json(plan) : NextResponse.json({ error: 'Fix not found' }, { status: 404 });
}
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = schema.parse(await readJson(req));
    if (input.action === 'publish' && requirePrincipal().role !== 'admin')
      return NextResponse.json({ error: 'Tenant admin role is required to publish a PR.' }, { status: 403 });
    const { id } = await params;
    const result = await withRecordLock('fixes', id, async () => {
      let plan = getPlan(id);
      if (!plan) throw new Error('Fix not found.');
      if (input.action === 'preview') {
        if (plan.status !== 'proposed') throw new Error('Only unsubmitted proposals can be previewed.');
        plan = await previewPlan(plan);
      } else if (input.action === 'publish') {
        if (plan.status !== 'proposed') return plan;
        plan = await publishPlan(plan, input.approvedDigest);
      } else {
        const source = getRun(plan.sourceRunId);
        if (!source) throw new Error('Source evidence is unavailable.');
        plan = await syncPullRequest(plan);
        if (!plan.pullRequest?.mergedAt) throw new Error('The PR must be merged before checking recovery.');
        const previous = plan.verification.at(-1);
        if (previous && Date.now() - Date.parse(previous.at) < 60000) throw new Error('Wait at least 60 seconds between verification observations.');
        const current = await new MCPAgentRunner().run({ goal: `Verify recovery of ${plan.resource.name}`, input_context: { ...plan.scope, enableAiSummary: false } });
        const verification = verifyPlan(plan, source, current, previous ? getRun(previous.runId) : undefined);
        plan.verification.push(verification);
        plan.verification = plan.verification.slice(-20);
        if (verification.status === 'passed') plan.status = 'verified';
      }
      putRecord('fixes', id, plan);
      return plan;
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccessDenied || error instanceof z.ZodError || error instanceof SyntaxError) throw error;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow operation failed.' }, { status: error instanceof Error && error.message === 'Fix not found.' ? 404 : 409 });
  }
}

export const GET = protectedRoute('viewer', handleGET);

export const POST = protectedRoute('operator', handlePOST);
