import { NextResponse } from 'next/server';
import * as k8s from '@kubernetes/client-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const res = await coreApi.listNamespace();
    const namespaces = (res.items ?? [])
      .map((ns) => ns.metadata?.name ?? '')
      .filter(Boolean)
      .sort();

    return NextResponse.json({ namespaces });
  } catch (err) {
    return NextResponse.json(
      { namespaces: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
