import { NextRequest, NextResponse } from 'next/server';
import { MCPAgentRunner } from '@/agents/mcpAgentRunner';
import { formatValidationError } from '@/lib/validation';
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
      'warning event correlation',
      'read-only log collection',
      'deterministic root-cause findings',
      'optional OpenAI incident narrative',
    ],
  });
}

export async function POST(req: NextRequest) {
  try {
    const mcpRequest = await req.json();
    const runner = new MCPAgentRunner();
    const result = await runner.run(mcpRequest);
    return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid MCP request', details: formatValidationError(error) }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: 'Diagnostic run failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
