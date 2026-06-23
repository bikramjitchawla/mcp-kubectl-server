import * as k8s from '@kubernetes/client-node';
import {
  AccessError,
  ConditionSnapshot,
  ContainerLogSnapshot,
  ContainerSnapshot,
  ContainerStateSnapshot,
  CronJobSnapshot,
  DiagnosticScope,
  EventSnapshot,
  HPASnapshot,
  KubernetesSnapshot,
  NodeSnapshot,
  PodSnapshot,
  PVCSnapshot,
  ServiceSnapshot,
  WorkloadSnapshot,
} from '@/types/mcp';

type ListResult<T> = {
  items: T[];
  error?: AccessError;
};

export class KubernetesDiagnosticCollector {
  private readonly kubeConfig: k8s.KubeConfig;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly appsApi: k8s.AppsV1Api;
  private readonly batchApi: k8s.BatchV1Api;
  private readonly autoscalingApi: k8s.AutoscalingV2Api;

  constructor(context?: string) {
    this.kubeConfig = new k8s.KubeConfig();

    if (process.env.KUBERNETES_SERVICE_HOST) {
      this.kubeConfig.loadFromCluster();
    } else {
      this.kubeConfig.loadFromDefault();
      if (context) {
        this.kubeConfig.currentContext = context;
      }
    }

    this.coreApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kubeConfig.makeApiClient(k8s.AppsV1Api);
    this.batchApi = this.kubeConfig.makeApiClient(k8s.BatchV1Api);
    this.autoscalingApi = this.kubeConfig.makeApiClient(k8s.AutoscalingV2Api);
  }

  async collect(scope: DiagnosticScope): Promise<KubernetesSnapshot> {
    const accessErrors: AccessError[] = [];

    const nodeListPromise: Promise<ListResult<k8s.V1Node>> = scope.includeNodes
      ? this.safeList('list nodes', () => this.coreApi.listNode())
      : Promise.resolve({ items: [] });

    const hpaListPromise: Promise<ListResult<k8s.V2HorizontalPodAutoscaler>> = scope.includeHpa
      ? this.safeList('list hpas', () =>
          this.autoscalingApi.listNamespacedHorizontalPodAutoscaler({ namespace: scope.namespace }),
        )
      : Promise.resolve({ items: [] });

    const [pods, events, services, endpoints, deployments, statefulSets, daemonSets, replicaSets, jobs, pvcs, cronJobs, nodes, hpas] =
      await Promise.all([
        this.safeList('list pods', () =>
          this.coreApi.listNamespacedPod({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list events', () => this.coreApi.listNamespacedEvent({ namespace: scope.namespace })),
        this.safeList('list services', () => this.coreApi.listNamespacedService({ namespace: scope.namespace })),
        this.safeList('list endpoints', () => this.coreApi.listNamespacedEndpoints({ namespace: scope.namespace })),
        this.safeList('list deployments', () =>
          this.appsApi.listNamespacedDeployment({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list statefulsets', () =>
          this.appsApi.listNamespacedStatefulSet({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list daemonsets', () =>
          this.appsApi.listNamespacedDaemonSet({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list replicasets', () =>
          this.appsApi.listNamespacedReplicaSet({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list jobs', () =>
          this.batchApi.listNamespacedJob({ namespace: scope.namespace, labelSelector: scope.labelSelector }),
        ),
        this.safeList('list pvcs', () =>
          this.coreApi.listNamespacedPersistentVolumeClaim({ namespace: scope.namespace }),
        ),
        this.safeList('list cronjobs', () =>
          this.batchApi.listNamespacedCronJob({ namespace: scope.namespace }),
        ),
        nodeListPromise,
        hpaListPromise,
      ]);

    for (const result of [pods, events, services, endpoints, deployments, statefulSets, daemonSets, replicaSets, jobs, pvcs, cronJobs, nodes, hpas]) {
      if (result.error) {
        accessErrors.push(result.error);
      }
    }

    const selectedPods = this.selectPodsForDiagnosis(pods.items, scope);
    const logs = scope.includeLogs ? await this.collectLogs(scope.namespace, selectedPods, scope.tailLines) : [];

    return {
      namespace: scope.namespace,
      context: this.kubeConfig.getCurrentContext(),
      collectedAt: new Date().toISOString(),
      pods: selectedPods.map(toPodSnapshot),
      workloads: [
        ...deployments.items.map(toDeploymentSnapshot),
        ...statefulSets.items.map(toStatefulSetSnapshot),
        ...daemonSets.items.map(toDaemonSetSnapshot),
        ...replicaSets.items.map(toReplicaSetSnapshot),
        ...jobs.items.map(toJobSnapshot),
      ],
      services: services.items.map((service) => toServiceSnapshot(service, endpoints.items)),
      events: events.items.map(toEventSnapshot).sort(sortEventsRecentFirst).slice(0, 80),
      logs,
      nodes: nodes.items.map(toNodeSnapshot),
      hpas: hpas.items.map(toHPASnapshot),
      pvcs: pvcs.items.map(toPVCSnapshot),
      cronJobs: cronJobs.items.map(toCronJobSnapshot),
      accessErrors,
    };
  }

  private async safeList<T>(
    operation: string,
    load: () => Promise<{ items?: T[] }>,
  ): Promise<ListResult<T>> {
    try {
      const response = await load();
      return { items: response.items ?? [] };
    } catch (error) {
      return { items: [], error: toAccessError(operation, error) };
    }
  }

  private selectPodsForDiagnosis(pods: k8s.V1Pod[], scope: DiagnosticScope): k8s.V1Pod[] {
    const workload = scope.workload?.toLowerCase();
    const filtered = workload
      ? pods.filter((pod) => {
          const name = pod.metadata?.name?.toLowerCase() ?? '';
          const ownerMatch = pod.metadata?.ownerReferences?.some((owner) => owner.name?.toLowerCase().includes(workload));
          return name.includes(workload) || ownerMatch;
        })
      : pods;

    return filtered
      .sort((a, b) => Number(isInterestingPod(b)) - Number(isInterestingPod(a)))
      .slice(0, scope.maxPods);
  }

  private async collectLogs(
    namespace: string,
    pods: k8s.V1Pod[],
    tailLines: number,
  ): Promise<ContainerLogSnapshot[]> {
    const interestingPods = pods.filter(isInterestingPod).slice(0, 15);
    const logs: ContainerLogSnapshot[] = [];

    for (const pod of interestingPods) {
      const podName = pod.metadata?.name;
      if (!podName) {
        continue;
      }

      const containers = [...(pod.spec?.initContainers ?? []), ...(pod.spec?.containers ?? [])];
      for (const container of containers) {
        if (!container.name) {
          continue;
        }

        const status = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])].find(
          (item) => item.name === container.name,
        );
        const shouldReadPrevious = Boolean(status?.restartCount && status.restartCount > 0);

        logs.push(await this.readPodLog(namespace, podName, container.name, tailLines, false));

        if (shouldReadPrevious) {
          logs.push(await this.readPodLog(namespace, podName, container.name, tailLines, true));
        }
      }
    }

    return logs;
  }

  private async readPodLog(
    namespace: string,
    pod: string,
    container: string,
    tailLines: number,
    previous: boolean,
  ): Promise<ContainerLogSnapshot> {
    try {
      const output = await this.coreApi.readNamespacedPodLog({
        namespace,
        name: pod,
        container,
        tailLines,
        previous,
        timestamps: true,
      });

      return {
        pod,
        container,
        previous,
        lines: String(output)
          .split('\n')
          .filter(Boolean)
          .slice(-tailLines),
      };
    } catch (error) {
      return {
        pod,
        container,
        previous,
        lines: [],
        error: toAccessError(`read logs for ${pod}/${container}`, error).message,
      };
    }
  }
}

function toAccessError(operation: string, error: unknown): AccessError {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : undefined;
  const bodyMessage =
    typeof error === 'object' &&
    error !== null &&
    'body' in error &&
    typeof error.body === 'object' &&
    error.body !== null &&
    'message' in error.body
      ? String(error.body.message)
      : undefined;
  const message = bodyMessage ?? (error instanceof Error ? error.message : String(error));

  return { operation, statusCode, message };
}

function toPodSnapshot(pod: k8s.V1Pod): PodSnapshot {
  const containerStatuses = pod.status?.containerStatuses ?? [];
  const initContainerStatuses = pod.status?.initContainerStatuses ?? [];
  const containers = pod.spec?.containers ?? [];
  const initContainers = pod.spec?.initContainers ?? [];

  return {
    name: pod.metadata?.name ?? 'unknown',
    namespace: pod.metadata?.namespace ?? 'unknown',
    phase: pod.status?.phase ?? 'Unknown',
    nodeName: pod.spec?.nodeName,
    serviceAccountName: pod.spec?.serviceAccountName,
    qosClass: pod.status?.qosClass,
    createdAt: pod.metadata?.creationTimestamp?.toISOString(),
    labels: pod.metadata?.labels ?? {},
    ownerReferences: (pod.metadata?.ownerReferences ?? []).map((owner) => ({
      apiVersion: owner.apiVersion,
      kind: owner.kind ?? 'Unknown',
      name: owner.name ?? 'unknown',
      namespace: pod.metadata?.namespace,
    })),
    conditions: (pod.status?.conditions ?? []).map(toConditionSnapshot),
    containers: containers.map((container) => {
      const status = containerStatuses.find((item) => item.name === container.name);
      return toContainerSnapshot(container, status);
    }),
    initContainers: initContainers.map((container) => {
      const status = initContainerStatuses.find((item) => item.name === container.name);
      return toContainerSnapshot(container, status);
    }),
    restartCount: [...containerStatuses, ...initContainerStatuses].reduce((total, status) => total + (status.restartCount ?? 0), 0),
    readyContainers: containerStatuses.filter((status) => status.ready).length,
  };
}

function toContainerSnapshot(
  container: k8s.V1Container,
  status?: k8s.V1ContainerStatus,
): ContainerSnapshot {
  return {
    name: container.name,
    image: container.image ?? status?.image ?? 'unknown',
    ready: status?.ready ?? false,
    restartCount: status?.restartCount ?? 0,
    state: toContainerState(status?.state),
    lastState: toContainerState(status?.lastState),
    requests: normalizeResourceList(container.resources?.requests),
    limits: normalizeResourceList(container.resources?.limits),
  };
}

function normalizeResourceList(resources?: Record<string, string | number>): Record<string, string> {
  if (!resources) {
    return {};
  }

  return Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, String(value)]));
}

function toContainerState(state?: k8s.V1ContainerState): ContainerStateSnapshot {
  if (state?.waiting) {
    return {
      state: 'waiting',
      reason: state.waiting.reason,
      message: state.waiting.message,
    };
  }

  if (state?.terminated) {
    return {
      state: 'terminated',
      reason: state.terminated.reason,
      message: state.terminated.message,
      exitCode: state.terminated.exitCode,
      startedAt: state.terminated.startedAt?.toISOString(),
      finishedAt: state.terminated.finishedAt?.toISOString(),
    };
  }

  if (state?.running) {
    return {
      state: 'running',
      startedAt: state.running.startedAt?.toISOString(),
    };
  }

  return { state: 'unknown' };
}

function toConditionSnapshot(condition: {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: Date;
}): ConditionSnapshot {
  return {
    type: condition.type ?? 'Unknown',
    status: condition.status ?? 'Unknown',
    reason: condition.reason,
    message: condition.message,
    lastTransitionTime: condition.lastTransitionTime?.toISOString(),
  };
}

function toDeploymentSnapshot(deployment: k8s.V1Deployment): WorkloadSnapshot {
  return {
    kind: 'Deployment',
    name: deployment.metadata?.name ?? 'unknown',
    namespace: deployment.metadata?.namespace ?? 'unknown',
    desired: deployment.spec?.replicas ?? 0,
    ready: deployment.status?.readyReplicas ?? 0,
    available: deployment.status?.availableReplicas ?? 0,
    updated: deployment.status?.updatedReplicas ?? 0,
    conditions: (deployment.status?.conditions ?? []).map(toConditionSnapshot),
  };
}

function toStatefulSetSnapshot(statefulSet: k8s.V1StatefulSet): WorkloadSnapshot {
  return {
    kind: 'StatefulSet',
    name: statefulSet.metadata?.name ?? 'unknown',
    namespace: statefulSet.metadata?.namespace ?? 'unknown',
    desired: statefulSet.spec?.replicas ?? 0,
    ready: statefulSet.status?.readyReplicas ?? 0,
    updated: statefulSet.status?.updatedReplicas ?? 0,
    conditions: (statefulSet.status?.conditions ?? []).map(toConditionSnapshot),
  };
}

function toDaemonSetSnapshot(daemonSet: k8s.V1DaemonSet): WorkloadSnapshot {
  return {
    kind: 'DaemonSet',
    name: daemonSet.metadata?.name ?? 'unknown',
    namespace: daemonSet.metadata?.namespace ?? 'unknown',
    desired: daemonSet.status?.desiredNumberScheduled ?? 0,
    ready: daemonSet.status?.numberReady ?? 0,
    available: daemonSet.status?.numberAvailable ?? 0,
    updated: daemonSet.status?.updatedNumberScheduled ?? 0,
    conditions: (daemonSet.status?.conditions ?? []).map(toConditionSnapshot),
  };
}

function toReplicaSetSnapshot(replicaSet: k8s.V1ReplicaSet): WorkloadSnapshot {
  return {
    kind: 'ReplicaSet',
    name: replicaSet.metadata?.name ?? 'unknown',
    namespace: replicaSet.metadata?.namespace ?? 'unknown',
    desired: replicaSet.spec?.replicas ?? 0,
    ready: replicaSet.status?.readyReplicas ?? 0,
    available: replicaSet.status?.availableReplicas ?? 0,
    conditions: (replicaSet.status?.conditions ?? []).map(toConditionSnapshot),
  };
}

function toJobSnapshot(job: k8s.V1Job): WorkloadSnapshot {
  return {
    kind: 'Job',
    name: job.metadata?.name ?? 'unknown',
    namespace: job.metadata?.namespace ?? 'unknown',
    desired: job.spec?.completions ?? 1,
    ready: job.status?.succeeded ?? 0,
    succeeded: job.status?.succeeded ?? 0,
    failed: job.status?.failed ?? 0,
    conditions: (job.status?.conditions ?? []).map(toConditionSnapshot),
  };
}

function toServiceSnapshot(service: k8s.V1Service, endpoints: k8s.V1Endpoints[]): ServiceSnapshot {
  const endpoint = endpoints.find((item) => item.metadata?.name === service.metadata?.name);
  const readyEndpoints =
    endpoint?.subsets?.reduce((total, subset) => total + (subset.addresses?.length ?? 0), 0) ?? 0;
  const notReadyEndpoints =
    endpoint?.subsets?.reduce((total, subset) => total + (subset.notReadyAddresses?.length ?? 0), 0) ?? 0;

  return {
    name: service.metadata?.name ?? 'unknown',
    namespace: service.metadata?.namespace ?? 'unknown',
    type: service.spec?.type ?? 'ClusterIP',
    selector: service.spec?.selector ?? {},
    ports: (service.spec?.ports ?? []).map((port) => {
      const target = port.targetPort ? `->${port.targetPort}` : '';
      return `${port.name ? `${port.name}:` : ''}${port.port}/${port.protocol ?? 'TCP'}${target}`;
    }),
    readyEndpoints,
    notReadyEndpoints,
  };
}

function toEventSnapshot(event: k8s.CoreV1Event): EventSnapshot {
  return {
    type: event.type,
    reason: event.reason,
    message: event.message,
    count: event.count,
    firstSeen: event.firstTimestamp?.toISOString(),
    lastSeen: event.lastTimestamp?.toISOString() ?? event.eventTime?.toISOString(),
    involvedObject: {
      apiVersion: event.involvedObject.apiVersion,
      kind: event.involvedObject.kind ?? 'Unknown',
      namespace: event.involvedObject.namespace,
      name: event.involvedObject.name ?? 'unknown',
    },
  };
}

function toNodeSnapshot(node: k8s.V1Node): NodeSnapshot {
  const labels = node.metadata?.labels ?? {};
  const roles = Object.keys(labels)
    .filter((key) => key.startsWith('node-role.kubernetes.io/'))
    .map((key) => key.replace('node-role.kubernetes.io/', ''));

  const readyCond = (node.status?.conditions ?? []).find((c) => c.type === 'Ready');

  return {
    name: node.metadata?.name ?? 'unknown',
    ready: readyCond?.status === 'True',
    roles: roles.length > 0 ? roles : ['worker'],
    conditions: (node.status?.conditions ?? []).map(toConditionSnapshot),
    taints: (node.spec?.taints ?? []).map((t) => ({
      key: t.key ?? '',
      effect: t.effect ?? '',
      value: t.value,
    })),
    allocatable: normalizeResourceList(node.status?.allocatable as Record<string, string | number> | undefined),
    capacity: normalizeResourceList(node.status?.capacity as Record<string, string | number> | undefined),
    kubeletVersion: node.status?.nodeInfo?.kubeletVersion,
    unschedulable: node.spec?.unschedulable ?? false,
  };
}

function toHPASnapshot(hpa: k8s.V2HorizontalPodAutoscaler): HPASnapshot {
  return {
    name: hpa.metadata?.name ?? 'unknown',
    namespace: hpa.metadata?.namespace ?? 'unknown',
    targetKind: hpa.spec?.scaleTargetRef?.kind ?? 'Deployment',
    targetName: hpa.spec?.scaleTargetRef?.name ?? 'unknown',
    minReplicas: hpa.spec?.minReplicas ?? 1,
    maxReplicas: hpa.spec?.maxReplicas ?? 1,
    currentReplicas: hpa.status?.currentReplicas ?? 0,
    desiredReplicas: hpa.status?.desiredReplicas ?? 0,
    conditions: (hpa.status?.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
      lastTransitionTime: c.lastTransitionTime?.toISOString(),
    })),
  };
}

function toPVCSnapshot(pvc: k8s.V1PersistentVolumeClaim): PVCSnapshot {
  const capacity = pvc.status?.capacity?.['storage'];
  return {
    name: pvc.metadata?.name ?? 'unknown',
    namespace: pvc.metadata?.namespace ?? 'unknown',
    phase: pvc.status?.phase ?? 'Unknown',
    storageClass: pvc.spec?.storageClassName,
    capacity: capacity ? String(capacity) : undefined,
    volumeName: pvc.spec?.volumeName,
    accessModes: pvc.spec?.accessModes ?? [],
  };
}

function toCronJobSnapshot(cronJob: k8s.V1CronJob): CronJobSnapshot {
  return {
    name: cronJob.metadata?.name ?? 'unknown',
    namespace: cronJob.metadata?.namespace ?? 'unknown',
    schedule: cronJob.spec?.schedule ?? '',
    suspended: cronJob.spec?.suspend ?? false,
    active: cronJob.status?.active?.length ?? 0,
    lastScheduleTime: cronJob.status?.lastScheduleTime?.toISOString(),
    lastSuccessfulTime: cronJob.status?.lastSuccessfulTime?.toISOString(),
  };
}

function isInterestingPod(pod: k8s.V1Pod): boolean {
  const phase = pod.status?.phase;
  const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
  const notReady = (pod.status?.conditions ?? []).some((condition) => condition.type === 'Ready' && condition.status !== 'True');

  return (
    phase !== 'Running' ||
    notReady ||
    statuses.some((status) => {
      const waitingReason = status.state?.waiting?.reason;
      const terminatedReason = status.state?.terminated?.reason ?? status.lastState?.terminated?.reason;
      return Boolean(waitingReason || terminatedReason || (status.restartCount ?? 0) > 0);
    })
  );
}

function sortEventsRecentFirst(a: EventSnapshot, b: EventSnapshot): number {
  return new Date(b.lastSeen ?? b.firstSeen ?? 0).getTime() - new Date(a.lastSeen ?? a.firstSeen ?? 0).getTime();
}
