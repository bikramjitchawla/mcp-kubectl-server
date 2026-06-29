import * as k8s from '@kubernetes/client-node';
import type { ClusterInventory, WorkloadInventoryItem } from './types';

export async function collectClusterInventory(context?: string): Promise<ClusterInventory> {
  const kubeConfig = new k8s.KubeConfig();
  if (process.env.KUBERNETES_SERVICE_HOST) {
    kubeConfig.loadFromCluster();
  } else {
    kubeConfig.loadFromDefault();
    if (context) {
      kubeConfig.currentContext = context;
    }
  }

  const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
  const appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
  const namespaceResponse = await coreApi.listNamespace();
  const namespaces = (namespaceResponse.items ?? [])
    .map((namespace) => namespace.metadata?.name ?? '')
    .filter(Boolean)
    .sort();

  const workloadGroups = await Promise.all(namespaces.map((namespace) => listNamespaceWorkloads(appsApi, namespace)));

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
      .then((response) =>
        response.items.map((item) => ({
          namespace,
          kind: 'Deployment' as const,
          name: item.metadata?.name ?? '',
        })),
      )
      .catch(() => []),
    appsApi
      .listNamespacedStatefulSet({ namespace })
      .then((response) =>
        response.items.map((item) => ({
          namespace,
          kind: 'StatefulSet' as const,
          name: item.metadata?.name ?? '',
        })),
      )
      .catch(() => []),
    appsApi
      .listNamespacedDaemonSet({ namespace })
      .then((response) =>
        response.items.map((item) => ({
          namespace,
          kind: 'DaemonSet' as const,
          name: item.metadata?.name ?? '',
        })),
      )
      .catch(() => []),
  ]);

  return [...deployments, ...statefulSets, ...daemonSets].filter((item) => item.name);
}
