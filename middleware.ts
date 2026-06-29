import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const apiKey = process.env.MCP_API_KEY;

  // Skip auth in dev mode (no key configured)
  if (!apiKey) return NextResponse.next();

  const provided = request.headers.get('x-api-key');
  if (provided !== apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized', hint: 'Provide a valid X-API-Key header.' },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Exclude /api/health so liveness/readiness probes work without auth
  matcher: '/api/((?!health$).*)',
};
