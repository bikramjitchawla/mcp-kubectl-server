import { tenantKubeConfig, boundedApi } from '@/lib/kubernetes/client';
import { requirePrincipal, AccessDenied } from '@/lib/tenancy/context';
import { protectedRoute } from '@/lib/auth/guard';
import { NextRequest, NextResponse } from 'next/server';
import * as k8s from '@kubernetes/client-node';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET(req: NextRequest) {
  const { tenant } = requirePrincipal();
  const namespace = req.nextUrl.searchParams.get('namespace') ?? tenant.namespaces[0];
  if (!tenant.namespaces.includes(namespace)) throw new AccessDenied('Namespace is outside this tenant.');

  try {
    const kc = tenantKubeConfig(req.nextUrl.searchParams.get('context') ?? undefined);
    const appsApi = boundedApi(kc.makeApiClient(k8s.AppsV1Api));

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
    if (err instanceof AccessDenied) throw err;
    return NextResponse.json(
      { workloads: [], error: 'Workload inventory is unavailable.' },
      { status: 502 },
    );
  }
}

export const GET = protectedRoute('viewer', handleGET);
