import { NextResponse } from 'next/server';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { tenants } from '@/lib/tenancy/config';
import { appOrigin } from '@/lib/auth/sessions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  try {
    appOrigin();
    const configured = tenants();
    for (const tenant of configured) accessSync(tenant.kubeconfig, constants.R_OK);
    const directory = process.env.DIAGNOSTICS_DATA_DIR ?? '.data';
    mkdirSync(directory, { recursive: true, mode: 0o700 }); accessSync(directory, constants.W_OK);
    return NextResponse.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ status: 'not-ready' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
