import * as k8s from '@kubernetes/client-node';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const contexts = kc.getContexts().map((ctx) => ctx.name);
    const current = kc.getCurrentContext();
    return NextResponse.json({ contexts, current });
  } catch {
    return NextResponse.json({ contexts: [], current: null });
  }
}
