import { NextRequest, NextResponse } from 'next/server';
import * as k8s from '@kubernetes/client-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const namespace = req.nextUrl.searchParams.get('namespace') ?? 'default';

  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const appsApi = kc.makeApiClient(k8s.AppsV1Api);

    const [deployments, statefulSets, daemonSets] = await Promise.all([
      appsApi.listNamespacedDeployment({ namespace }).then((r) => r.items.map((w) => ({ name: w.metadata?.name ?? '', kind: 'Deployment' }))),
      appsApi.listNamespacedStatefulSet({ namespace }).then((r) => r.items.map((w) => ({ name: w.metadata?.name ?? '', kind: 'StatefulSet' }))),
      appsApi.listNamespacedDaemonSet({ namespace }).then((r) => r.items.map((w) => ({ name: w.metadata?.name ?? '', kind: 'DaemonSet' }))),
    ]);

    const workloads = [...deployments, ...statefulSets, ...daemonSets]
      .filter((w) => w.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ workloads });
  } catch (err) {
    return NextResponse.json(
      { workloads: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
