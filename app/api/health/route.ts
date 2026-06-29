import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'kubernetes-diagnostic-mcp',
    version: process.env.APP_VERSION ?? '0.1.0',
    buildId: process.env.BUILD_ID ?? 'local',
    timestamp: new Date().toISOString(),
  });
}
