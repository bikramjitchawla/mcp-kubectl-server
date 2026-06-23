import { NextRequest, NextResponse } from 'next/server';
import { MCPAgentRunner } from '@/agents/mcpAgentRunner';
import { formatValidationError } from '@/lib/validation';
import { checkRateLimit } from '@/lib/ratelimit';
import { ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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
      'diagnostic run history',
    ],
  });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  const start = Date.now();

  try {
    const mcpRequest = await req.json();
    const runner = new MCPAgentRunner();
    const result = await runner.run(mcpRequest);

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
      headers: { 'X-RateLimit-Remaining': String(rateLimit.remaining) },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid MCP request', details: formatValidationError(error) }, { status: 400 });
    }

    console.error(JSON.stringify({
      event: 'diagnostic_error',
      ip,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    }));

    return NextResponse.json(
      {
        error: 'Diagnostic run failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
