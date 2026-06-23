import {
  AutomationCommand,
  CronJobSnapshot,
  DiagnosticFinding,
  EventSnapshot,
  HPASnapshot,
  KubernetesResourceRef,
  KubernetesSnapshot,
  NodeSnapshot,
  PodSnapshot,
  PVCSnapshot,
  Severity,
  WorkloadSnapshot,
} from '@/types/mcp';

const imagePullReasons = new Set(['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName']);
const crashReasons = new Set(['CrashLoopBackOff', 'Error']);
const schedulingReasons = new Set(['FailedScheduling', 'Unschedulable']);
const probeReasons = new Set(['Unhealthy', 'FailedPostStartHook', 'FailedPreStopHook']);
const nodePressureConditions = ['MemoryPressure', 'DiskPressure', 'PIDPressure'] as const;

export function analyzeKubernetesSnapshot(snapshot: KubernetesSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const pod of snapshot.pods) {
    findings.push(...analyzePod(snapshot, pod));
  }

  for (const workload of snapshot.workloads) {
    const finding = analyzeWorkload(workload);
    if (finding) {
      findings.push(finding);
    }
  }

  for (const service of snapshot.services) {
    if (Object.keys(service.selector).length > 0 && service.readyEndpoints === 0) {
      findings.push({
        id: `service-${service.namespace}-${service.name}-no-endpoints`,
        severity: 'high',
        category: 'networking',
        title: `Service ${service.name} has no ready endpoints`,
        resource: { kind: 'Service', namespace: service.namespace, name: service.name },
        signal: `Selector ${JSON.stringify(service.selector)} currently resolves to 0 ready endpoints.`,
        evidence: [
          `Service type: ${service.type}`,
          `Ports: ${service.ports.join(', ') || 'none'}`,
          `Ready endpoints: ${service.readyEndpoints}; not ready endpoints: ${service.notReadyEndpoints}`,
        ],
        impact: 'Traffic through this service will fail or blackhole until matching pods become ready.',
        recommendedActions: [
          'Verify the service selector matches pod labels.',
          'Check readiness probes on the selected pods.',
          'Confirm the targetPort matches the container port exposed by the workload.',
        ],
        automation: [
          readCommand(`kubectl -n ${service.namespace} describe service ${service.name}`, 'Inspect service selector and ports'),
          readCommand(`kubectl -n ${service.namespace} get endpoints ${service.name} -o wide`, 'Inspect resolved endpoints'),
        ],
      });
    }
  }

  for (const node of snapshot.nodes) {
    findings.push(...analyzeNode(node));
  }

  for (const hpa of snapshot.hpas) {
    const finding = analyzeHPA(hpa);
    if (finding) findings.push(finding);
  }

  for (const pvc of snapshot.pvcs) {
    const finding = analyzePVC(pvc);
    if (finding) findings.push(finding);
  }

  for (const cronJob of snapshot.cronJobs) {
    const finding = analyzeCronJob(cronJob);
    if (finding) findings.push(finding);
  }

  findings.push(...analyzeWarningEvents(snapshot));

  if (findings.length === 0 && snapshot.accessErrors.length === 0) {
    findings.push({
      id: `namespace-${snapshot.namespace}-healthy`,
      severity: 'info',
      category: 'availability',
      title: `No obvious workload failures found in ${snapshot.namespace}`,
      resource: { kind: 'Namespace', name: snapshot.namespace },
      signal: 'The collected pods, workloads, services, and recent events do not show obvious failure signals.',
      evidence: [
        `${snapshot.pods.length} pods collected`,
        `${snapshot.workloads.length} workloads collected`,
        `${snapshot.events.filter((event) => event.type === 'Warning').length} warning events collected`,
      ],
      impact: 'No immediate operational impact was detected from the available evidence.',
      recommendedActions: [
        'If engineers still observe an incident, narrow the request with workload or labelSelector.',
        'Add includeLogs=true and check application-level symptoms.',
      ],
      automation: [readCommand(`kubectl -n ${snapshot.namespace} get all`, 'Review namespace resources')],
    });
  }

  return dedupeFindings(findings).sort(sortFindings);
}

function analyzePod(snapshot: KubernetesSnapshot, pod: PodSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const events = relatedEvents(snapshot.events, { kind: 'Pod', namespace: pod.namespace, name: pod.name });
  const allContainers = [...pod.initContainers, ...pod.containers];

  const unscheduled = pod.conditions.find((condition) => condition.type === 'PodScheduled' && condition.status === 'False');
  const schedulingEvent = events.find((event) => schedulingReasons.has(event.reason ?? ''));
  if (pod.phase === 'Pending' && (unscheduled || schedulingEvent)) {
    findings.push({
      id: `pod-${pod.namespace}-${pod.name}-scheduling`,
      severity: 'high',
      category: 'scheduling',
      title: `Pod ${pod.name} cannot be scheduled`,
      resource: podRef(pod),
      signal: unscheduled?.reason ?? schedulingEvent?.reason ?? 'Pending',
      evidence: compact([
        unscheduled?.message,
        schedulingEvent?.message,
        `Phase: ${pod.phase}`,
        `QoS: ${pod.qosClass ?? 'unknown'}`,
      ]),
      impact: 'The workload has no running replica for this pod until scheduling constraints are resolved.',
      recommendedActions: [
        'Check node capacity, taints, tolerations, affinity, topology spread constraints, and PVC binding.',
        'If this is a capacity issue, scale nodes or lower resource requests after validating workload needs.',
      ],
      automation: [
        readCommand(`kubectl -n ${pod.namespace} describe pod ${pod.name}`, 'Inspect scheduler events'),
        readCommand('kubectl describe nodes', 'Check node pressure, taints, and allocatable capacity'),
      ],
    });
  }

  for (const container of allContainers) {
    const reason = container.state.reason;
    if (reason && imagePullReasons.has(reason)) {
      findings.push({
        id: `pod-${pod.namespace}-${pod.name}-${container.name}-image`,
        severity: 'high',
        category: 'image',
        title: `Container ${container.name} cannot pull image`,
        resource: podRef(pod),
        signal: reason,
        evidence: compact([
          `Image: ${container.image}`,
          container.state.message,
          ...events.filter((event) => event.message?.includes(container.image)).map((event) => event.message),
        ]),
        impact: 'The pod cannot start until the image reference or registry authentication is fixed.',
        recommendedActions: [
          'Verify the image name and tag exist in the registry.',
          'Check imagePullSecrets and registry credentials in this namespace.',
          'Confirm network egress from nodes to the registry.',
        ],
        automation: [
          readCommand(`kubectl -n ${pod.namespace} describe pod ${pod.name}`, 'Inspect image pull events'),
          readCommand(`kubectl -n ${pod.namespace} get secrets`, 'Check image pull secrets are present'),
        ],
      });
    }

    if (reason && crashReasons.has(reason)) {
      findings.push({
        id: `pod-${pod.namespace}-${pod.name}-${container.name}-crashloop`,
        severity: container.restartCount > 5 ? 'critical' : 'high',
        category: 'runtime',
        title: `Container ${container.name} is restarting`,
        resource: podRef(pod),
        signal: `${reason}; restarts=${container.restartCount}`,
        evidence: compact([
          container.state.message,
          `Current state: ${container.state.state}`,
          `Last state: ${container.lastState?.state ?? 'unknown'} ${container.lastState?.reason ?? ''}`,
          `Restart count: ${container.restartCount}`,
          ...logEvidence(snapshot, pod.name, container.name),
        ]),
        impact: 'Application capacity is reduced and requests may fail while the container repeatedly exits.',
        recommendedActions: [
          'Read current and previous container logs to identify the failing code path.',
          'Check required environment variables, mounted ConfigMaps/Secrets, command args, and startup dependencies.',
          'Review liveness probe timing if the process needs longer warm-up.',
        ],
        automation: [
          readCommand(`kubectl -n ${pod.namespace} logs ${pod.name} -c ${container.name} --tail=120`, 'Read current logs'),
          readCommand(
            `kubectl -n ${pod.namespace} logs ${pod.name} -c ${container.name} --previous --tail=120`,
            'Read logs from the previous crashed container',
          ),
          readCommand(`kubectl -n ${pod.namespace} describe pod ${pod.name}`, 'Inspect restart events and probes'),
        ],
      });
    }

    const oomKilled = container.lastState?.reason === 'OOMKilled' || container.state.reason === 'OOMKilled';
    if (oomKilled) {
      findings.push({
        id: `pod-${pod.namespace}-${pod.name}-${container.name}-oom`,
        severity: 'high',
        category: 'resource',
        title: `Container ${container.name} was OOMKilled`,
        resource: podRef(pod),
        signal: `Exit code ${container.lastState?.exitCode ?? container.state.exitCode ?? 'unknown'}`,
        evidence: compact([
          `Limits: ${JSON.stringify(container.limits)}`,
          `Requests: ${JSON.stringify(container.requests)}`,
          `Restart count: ${container.restartCount}`,
        ]),
        impact: 'The kernel terminated the process because it exceeded its memory limit.',
        recommendedActions: [
          'Check memory metrics and recent deployment changes.',
          'Right-size memory requests and limits, or fix the application memory growth.',
          'Consider adding alerts for memory saturation before the next rollout.',
        ],
        automation: [
          readCommand(`kubectl -n ${pod.namespace} top pod ${pod.name} --containers`, 'Check live container memory usage'),
          readCommand(`kubectl -n ${pod.namespace} describe pod ${pod.name}`, 'Inspect termination reason and limits'),
        ],
      });
    }
  }

  const probeEvent = events.find((event) => probeReasons.has(event.reason ?? ''));
  const notReady = pod.conditions.find((condition) => condition.type === 'Ready' && condition.status !== 'True');
  if (notReady && probeEvent) {
    findings.push({
      id: `pod-${pod.namespace}-${pod.name}-readiness`,
      severity: 'medium',
      category: 'availability',
      title: `Pod ${pod.name} is not ready`,
      resource: podRef(pod),
      signal: probeEvent.reason ?? notReady.reason ?? 'NotReady',
      evidence: compact([notReady.message, probeEvent.message, `Ready containers: ${pod.readyContainers}/${pod.containers.length}`]),
      impact: 'This pod will not receive service traffic until readiness succeeds.',
      recommendedActions: [
        'Verify readiness and liveness probe paths, ports, thresholds, and initial delays.',
        'Check application logs around probe failures.',
        'Confirm downstream dependencies are reachable from the pod.',
      ],
      automation: [
        readCommand(`kubectl -n ${pod.namespace} describe pod ${pod.name}`, 'Inspect probe failure events'),
        readCommand(`kubectl -n ${pod.namespace} get pod ${pod.name} -o yaml`, 'Review probe configuration'),
      ],
    });
  }

  return findings;
}

function analyzeWorkload(workload: WorkloadSnapshot): DiagnosticFinding | undefined {
  const unavailable = workload.desired > 0 && workload.ready < workload.desired;
  const failedJob = workload.kind === 'Job' && (workload.failed ?? 0) > 0 && (workload.succeeded ?? 0) < workload.desired;

  if (!unavailable && !failedJob) {
    return undefined;
  }

  const severity: Severity = workload.ready === 0 || failedJob ? 'high' : 'medium';

  return {
    id: `workload-${workload.namespace}-${workload.kind.toLowerCase()}-${workload.name}-unavailable`,
    severity,
    category: failedJob ? 'runtime' : 'availability',
    title: `${workload.kind} ${workload.name} is not at desired state`,
    resource: {
      kind: workload.kind,
      namespace: workload.namespace,
      name: workload.name,
    },
    signal: `desired=${workload.desired}, ready=${workload.ready}, available=${workload.available ?? 'n/a'}`,
    evidence: [
      `Desired replicas/completions: ${workload.desired}`,
      `Ready/succeeded: ${workload.ready}`,
      `Conditions: ${workload.conditions.map((condition) => `${condition.type}=${condition.status}/${condition.reason ?? 'none'}`).join(', ') || 'none'}`,
    ],
    impact: 'The controller is not delivering the requested capacity.',
    recommendedActions: [
      'Inspect child pods and recent warning events for the concrete blocker.',
      'Check rollout history and compare the current template against the last healthy revision.',
      'Pause further rollout automation until the failing condition is understood.',
    ],
    automation: [
      readCommand(
        `kubectl -n ${workload.namespace} describe ${workload.kind.toLowerCase()} ${workload.name}`,
        'Inspect controller status and events',
      ),
      readCommand(`kubectl -n ${workload.namespace} get pods -o wide`, 'Correlate controller with child pods'),
    ],
  };
}

function analyzeNode(node: NodeSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  const notReadyCond = node.conditions.find((c) => c.type === 'Ready' && c.status !== 'True');
  if (notReadyCond) {
    findings.push({
      id: `node-${node.name}-notready`,
      severity: 'critical',
      category: 'availability',
      title: `Node ${node.name} is NotReady`,
      resource: { kind: 'Node', name: node.name },
      signal: notReadyCond.reason ?? 'NotReady',
      evidence: compact([
        notReadyCond.message,
        `Roles: ${node.roles.join(', ')}`,
        `Kubelet: ${node.kubeletVersion ?? 'unknown'}`,
      ]),
      impact: 'All pods on this node are effectively unreachable. The scheduler will not place new pods here.',
      recommendedActions: [
        'SSH to the node and check kubelet: `systemctl status kubelet` and `journalctl -u kubelet --since "5m ago"`',
        'Verify the node has network connectivity to the API server.',
        'Check for disk or memory exhaustion at the OS level.',
      ],
      automation: [
        readCommand(`kubectl describe node ${node.name}`, 'Inspect node conditions and recent events'),
        readCommand(`kubectl get pods -A --field-selector spec.nodeName=${node.name}`, 'List all pods on this node'),
      ],
    });
  }

  for (const pressureType of nodePressureConditions) {
    const cond = node.conditions.find((c) => c.type === pressureType && c.status === 'True');
    if (cond) {
      const pressureAdvice: Record<typeof pressureType, string> = {
        MemoryPressure: 'Identify memory-hungry containers and increase node capacity, or reduce pod memory limits.',
        DiskPressure: 'Remove unused images (`crictl rmi --prune`) and logs. Enable log rotation or increase disk.',
        PIDPressure: 'Check for process leaks in containers. Review pid limits and securityContext settings.',
      };

      findings.push({
        id: `node-${node.name}-${pressureType.toLowerCase()}`,
        severity: 'high',
        category: 'resource',
        title: `Node ${node.name} has ${pressureType}`,
        resource: { kind: 'Node', name: node.name },
        signal: `${pressureType}=True`,
        evidence: compact([cond.reason, cond.message, `Kubelet: ${node.kubeletVersion ?? 'unknown'}`]),
        impact: 'The node may evict pods or refuse to schedule new workloads until pressure is relieved.',
        recommendedActions: [pressureAdvice[pressureType]],
        automation: [
          readCommand(`kubectl describe node ${node.name}`, 'Inspect allocatable and conditions'),
          readCommand(`kubectl top node ${node.name}`, 'Check live node resource usage'),
        ],
      });
    }
  }

  if (node.unschedulable) {
    findings.push({
      id: `node-${node.name}-cordoned`,
      severity: 'medium',
      category: 'scheduling',
      title: `Node ${node.name} is cordoned`,
      resource: { kind: 'Node', name: node.name },
      signal: 'unschedulable=true',
      evidence: compact([`Roles: ${node.roles.join(', ')}`, `Kubelet: ${node.kubeletVersion ?? 'unknown'}`]),
      impact: 'No new pods will be scheduled on this node. Existing pods are unaffected until they restart.',
      recommendedActions: [
        'Verify any planned node maintenance is complete.',
        'Uncordon when ready: `kubectl uncordon ' + node.name + '`',
      ],
      automation: [readCommand(`kubectl describe node ${node.name}`, 'Inspect node status and taints')],
    });
  }

  return findings;
}

function analyzeHPA(hpa: HPASnapshot): DiagnosticFinding | undefined {
  const atMax = hpa.maxReplicas > 0 && hpa.currentReplicas >= hpa.maxReplicas;
  const unableToScale = hpa.conditions.some((c) => c.type === 'AbleToScale' && c.status === 'False');
  const scalingLimited = hpa.conditions.some((c) => c.type === 'ScalingLimited' && c.status === 'True');

  if (!atMax && !unableToScale) return undefined;

  if (unableToScale) {
    return {
      id: `hpa-${hpa.namespace}-${hpa.name}-unable`,
      severity: 'high',
      category: 'availability',
      title: `HPA ${hpa.name} cannot scale ${hpa.targetKind}/${hpa.targetName}`,
      resource: { kind: 'HorizontalPodAutoscaler', namespace: hpa.namespace, name: hpa.name },
      signal: 'AbleToScale=False',
      evidence: compact([
        `Target: ${hpa.targetKind}/${hpa.targetName}`,
        `Replicas: ${hpa.currentReplicas}/${hpa.maxReplicas} (desired: ${hpa.desiredReplicas})`,
        ...hpa.conditions
          .filter((c) => c.status !== 'True')
          .map((c) => `${c.type}: ${c.reason ?? ''} — ${c.message ?? ''}`),
      ]),
      impact: 'The workload cannot scale to meet demand. Traffic may be dropped or delayed under load.',
      recommendedActions: [
        'Verify the metrics-server is running: `kubectl -n kube-system get pods -l k8s-app=metrics-server`',
        'Check the HPA target reference matches an existing workload.',
        'Inspect HPA events for the concrete scaling error.',
      ],
      automation: [
        readCommand(`kubectl -n ${hpa.namespace} describe hpa ${hpa.name}`, 'Inspect HPA conditions and events'),
        readCommand(`kubectl -n ${hpa.namespace} get ${hpa.targetKind.toLowerCase()} ${hpa.targetName}`, 'Verify target workload'),
      ],
    };
  }

  return {
    id: `hpa-${hpa.namespace}-${hpa.name}-maxed`,
    severity: scalingLimited ? 'high' : 'medium',
    category: 'resource',
    title: `HPA ${hpa.name} is at maximum replicas (${hpa.maxReplicas})`,
    resource: { kind: 'HorizontalPodAutoscaler', namespace: hpa.namespace, name: hpa.name },
    signal: `currentReplicas=${hpa.currentReplicas} == maxReplicas=${hpa.maxReplicas}`,
    evidence: compact([
      `Target: ${hpa.targetKind}/${hpa.targetName}`,
      `Min/Max: ${hpa.minReplicas}–${hpa.maxReplicas}`,
      `Current/Desired: ${hpa.currentReplicas}/${hpa.desiredReplicas}`,
      scalingLimited ? 'ScalingLimited=True: further scaling is blocked' : undefined,
    ]),
    impact: 'The workload cannot scale further. If load increases, requests may be rejected or delayed.',
    recommendedActions: [
      'Increase maxReplicas if the workload legitimately needs more capacity.',
      'Check if the resource spike is expected or caused by a bug or memory leak.',
      'Consider vertical scaling or improving per-replica throughput.',
    ],
    automation: [
      readCommand(`kubectl -n ${hpa.namespace} describe hpa ${hpa.name}`, 'Inspect current metrics and conditions'),
      readCommand(`kubectl -n ${hpa.namespace} top pods`, 'Check resource usage of target pods'),
    ],
  };
}

function analyzePVC(pvc: PVCSnapshot): DiagnosticFinding | undefined {
  if (pvc.phase === 'Bound') return undefined;

  const severity: Severity = pvc.phase === 'Lost' ? 'critical' : 'high';

  return {
    id: `pvc-${pvc.namespace}-${pvc.name}-${pvc.phase.toLowerCase()}`,
    severity,
    category: 'storage',
    title: `PVC ${pvc.name} is ${pvc.phase}`,
    resource: { kind: 'PersistentVolumeClaim', namespace: pvc.namespace, name: pvc.name },
    signal: `phase=${pvc.phase}`,
    evidence: compact([
      `StorageClass: ${pvc.storageClass ?? 'default'}`,
      `Access modes: ${pvc.accessModes.join(', ') || 'none'}`,
      pvc.capacity ? `Requested: ${pvc.capacity}` : undefined,
      pvc.phase === 'Lost' ? `Backing PV ${pvc.volumeName ?? 'unknown'} is no longer available.` : undefined,
    ]),
    impact:
      pvc.phase === 'Lost'
        ? 'The PVC has lost its backing volume. Any pod mounting it will fail to start and data may be irrecoverable.'
        : 'Pods that mount this PVC remain in Pending state until the claim is bound.',
    recommendedActions:
      pvc.phase === 'Lost'
        ? [
            'Check if the backing PersistentVolume was accidentally deleted: `kubectl get pv`',
            'Restore from a volume snapshot if your storage class supports it.',
            'For Rook-Ceph, check cluster health: `kubectl -n rook-ceph get cephcluster -o wide`',
          ]
        : [
            'Verify a matching PersistentVolume exists for the requested StorageClass and access mode.',
            'Check the storage provisioner is running (e.g. `kubectl -n rook-ceph get pods`).',
            'Inspect PVC events for the exact provisioning error.',
          ],
    automation: [
      readCommand(`kubectl -n ${pvc.namespace} describe pvc ${pvc.name}`, 'Inspect PVC binding conditions and events'),
      readCommand(`kubectl get pv`, 'List all PersistentVolumes and their claim bindings'),
    ],
  };
}

function analyzeCronJob(cronJob: CronJobSnapshot): DiagnosticFinding | undefined {
  if (!cronJob.suspended) return undefined;

  return {
    id: `cronjob-${cronJob.namespace}-${cronJob.name}-suspended`,
    severity: 'medium',
    category: 'availability',
    title: `CronJob ${cronJob.name} is suspended`,
    resource: { kind: 'CronJob', namespace: cronJob.namespace, name: cronJob.name },
    signal: 'suspended=true',
    evidence: compact([
      `Schedule: ${cronJob.schedule}`,
      cronJob.lastScheduleTime ? `Last scheduled: ${cronJob.lastScheduleTime}` : 'Never scheduled.',
      cronJob.lastSuccessfulTime ? `Last successful: ${cronJob.lastSuccessfulTime}` : undefined,
    ]),
    impact: 'Scheduled jobs are not running. Periodic tasks such as backups, reports, or reconciliation are being skipped.',
    recommendedActions: [
      'Confirm maintenance is complete, then resume: `kubectl -n ' + cronJob.namespace + ' patch cronjob ' + cronJob.name + ' -p \'{"spec":{"suspend":false}}\'`',
      'Verify no in-flight jobs are running before resuming to avoid duplicate execution.',
    ],
    automation: [readCommand(`kubectl -n ${cronJob.namespace} describe cronjob ${cronJob.name}`, 'Inspect CronJob status and history')],
  };
}

function analyzeWarningEvents(snapshot: KubernetesSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const grouped = new Map<string, EventSnapshot[]>();

  for (const event of snapshot.events.filter((item) => item.type === 'Warning')) {
    if (imagePullReasons.has(event.reason ?? '') || schedulingReasons.has(event.reason ?? '') || probeReasons.has(event.reason ?? '')) {
      continue;
    }

    const key = `${event.involvedObject.kind}/${event.involvedObject.name}/${event.reason ?? 'Warning'}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  for (const events of grouped.values()) {
    const event = events[0];
    if (!event) {
      continue;
    }

    findings.push({
      id: `event-${snapshot.namespace}-${event.involvedObject.kind}-${event.involvedObject.name}-${event.reason ?? 'warning'}`,
      severity: 'medium',
      category: inferCategory(event),
      title: `Warning event: ${event.reason ?? 'Unknown'} on ${event.involvedObject.kind} ${event.involvedObject.name}`,
      resource: event.involvedObject,
      signal: event.reason ?? 'Warning',
      evidence: compact([event.message, `Count: ${events.reduce((total, item) => total + (item.count ?? 1), 0)}`]),
      impact: 'Kubernetes reported warning events that may explain degraded workload behavior.',
      recommendedActions: [
        'Inspect the involved resource and correlate the event timestamp with recent deployments or infrastructure changes.',
        'Promote this event pattern into monitoring if it repeats during incidents.',
      ],
      automation: [
        readCommand(
          `kubectl -n ${event.involvedObject.namespace ?? snapshot.namespace} describe ${event.involvedObject.kind.toLowerCase()} ${event.involvedObject.name}`,
          'Inspect the resource that produced this warning',
        ),
      ],
    });
  }

  return findings;
}

function inferCategory(event: EventSnapshot) {
  const text = `${event.reason ?? ''} ${event.message ?? ''}`.toLowerCase();
  if (text.includes('volume') || text.includes('mount') || text.includes('pvc')) return 'storage';
  if (text.includes('network') || text.includes('endpoint') || text.includes('dns')) return 'networking';
  if (text.includes('memory') || text.includes('cpu') || text.includes('evict')) return 'resource';
  if (text.includes('config') || text.includes('secret')) return 'configuration';
  return 'unknown';
}

function podRef(pod: PodSnapshot): KubernetesResourceRef {
  return { kind: 'Pod', namespace: pod.namespace, name: pod.name };
}

function relatedEvents(events: EventSnapshot[], resource: KubernetesResourceRef): EventSnapshot[] {
  return events.filter(
    (event) =>
      event.involvedObject.kind === resource.kind &&
      event.involvedObject.name === resource.name &&
      (!resource.namespace || event.involvedObject.namespace === resource.namespace),
  );
}

function logEvidence(snapshot: KubernetesSnapshot, pod: string, container: string): string[] {
  return snapshot.logs
    .filter((log) => log.pod === pod && log.container === container)
    .flatMap((log) => {
      if (log.error) {
        return [`Log read failed (${log.previous ? 'previous' : 'current'}): ${log.error}`];
      }

      return log.lines.slice(-8).map((line) => `${log.previous ? 'previous' : 'current'} log: ${line}`);
    });
}

function readCommand(command: string, description: string): AutomationCommand {
  return {
    description,
    command,
    destructive: false,
    requiresApproval: false,
  };
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function dedupeFindings(findings: DiagnosticFinding[]): DiagnosticFinding[] {
  return Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());
}

function sortFindings(a: DiagnosticFinding, b: DiagnosticFinding): number {
  const score: Record<Severity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };

  return score[b.severity] - score[a.severity] || a.title.localeCompare(b.title);
}
