import { readJson } from '@/lib/http/json';
import { AccessDenied } from '@/lib/tenancy/context';
import { protectedRoute } from '@/lib/auth/guard';
import { NextRequest, NextResponse } from 'next/server';
import { MCPAgentRunner } from '@/agents/mcpAgentRunner';
import { formatValidationError } from '@/lib/validation';
import { ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET() {
  return NextResponse.json({
    name: 'kubernetes-diagnostic-mcp',
    status: 'ready',
    capabilities: [
      'namespace workload inventory',
      'pod and controller health checks',
      'node pressure and readiness',
      'hpa scaling constraints',
      'pvc binding status',
      'cronjob suspend detection',
      'warning event correlation',
      'read-only log collection',
      'deterministic root-cause findings',
      'optional OpenAI incident narrative',
      'persistent diagnostic run history',
      'snapshot configuration comparisons and optional metrics',
      'evidence-based dependency incident groups',
      'reviewed GitHub fix proposals and recovery verification',
    ],
  });
}

async function handlePOST(req: NextRequest) {
  const start = Date.now();

  try {
    const mcpRequest = await readJson(req);
    const runner = new MCPAgentRunner();
    const result = await runner.run(mcpRequest, true);

    console.log(JSON.stringify({
      event: 'diagnostic_run',
      requestId: result.requestId,
      namespace: result.scope.namespace,
      context: result.snapshot.context,
      status: result.status,
      health: result.summary.health,
      findings: result.findings.length,
      durationMs: Date.now() - start,
      aiStatus: result.metadata.aiStatus,
    }));

    return NextResponse.json(result, {
      status: result.status === 'failed' ? 500 : 200,
    });
  } catch (error) {
    if (error instanceof AccessDenied || error instanceof SyntaxError) throw error;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid MCP request', details: formatValidationError(error) }, { status: 400 });
    }

    console.error(JSON.stringify({
      event: 'diagnostic_error',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }));

    return NextResponse.json(
      {
        error: 'Diagnostic run failed',
        details: 'Check collection access and server logs.',
      },
      { status: 500 },
    );
  }
}

export const GET = protectedRoute('viewer', handleGET);

export const POST = protectedRoute('operator', handlePOST);
