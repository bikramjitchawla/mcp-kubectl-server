import { tenantKubeConfig, boundedApi } from '@/lib/kubernetes/client';
import { requirePrincipal } from '@/lib/tenancy/context';
import * as k8s from '@kubernetes/client-node';
import type { ClusterInventory, WorkloadInventoryItem } from './types';

export async function collectClusterInventory(context?: string): Promise<ClusterInventory> {
  const kubeConfig = tenantKubeConfig(context);
  const appsApi = boundedApi(kubeConfig.makeApiClient(k8s.AppsV1Api));
  const namespaces = [...requirePrincipal().tenant.namespaces].sort();
  const workloadGroups: WorkloadInventoryItem[][] = [];
  // Bound cluster fan-out regardless of tenant namespace count.
  for (let i = 0; i < namespaces.length; i += 4) {
    workloadGroups.push(...await Promise.all(namespaces.slice(i, i + 4).map(namespace => listNamespaceWorkloads(appsApi, namespace))));
  }

  return {
    namespaces,
    workloads: workloadGroups.flat().sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`)),
  };
}

async function listNamespaceWorkloads(
  appsApi: k8s.AppsV1Api,
  namespace: string,
): Promise<WorkloadInventoryItem[]> {
  const [deployments, statefulSets, daemonSets] = await Promise.all([
    appsApi
      .listNamespacedDeployment({ namespace })
      .then((response) => {
        if (response.metadata?._continue) throw new Error('Inventory limit reached.');
        return response.items.map((item) => ({
          namespace,
          kind: 'Deployment' as const,
          name: item.metadata?.name ?? '',
        }));
      })
      .catch(() => { throw new Error('Tenant workload inventory is incomplete.'); }),
    appsApi
      .listNamespacedStatefulSet({ namespace })
      .then((response) => {
        if (response.metadata?._continue) throw new Error('Inventory limit reached.');
        return response.items.map((item) => ({
          namespace,
          kind: 'StatefulSet' as const,
          name: item.metadata?.name ?? '',
        }));
      })
      .catch(() => { throw new Error('Tenant workload inventory is incomplete.'); }),
    appsApi
      .listNamespacedDaemonSet({ namespace })
      .then((response) => {
        if (response.metadata?._continue) throw new Error('Inventory limit reached.');
        return response.items.map((item) => ({
          namespace,
          kind: 'DaemonSet' as const,
          name: item.metadata?.name ?? '',
        }));
      })
      .catch(() => { throw new Error('Tenant workload inventory is incomplete.'); }),
  ]);

  return [...deployments, ...statefulSets, ...daemonSets].filter((item) => item.name);
}
