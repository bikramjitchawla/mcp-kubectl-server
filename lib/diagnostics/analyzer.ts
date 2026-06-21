import {
  AutomationCommand,
  DiagnosticFinding,
  EventSnapshot,
  KubernetesResourceRef,
  KubernetesSnapshot,
  PodSnapshot,
  Severity,
  WorkloadSnapshot,
} from '@/types/mcp';

const imagePullReasons = new Set(['ImagePullBackOff', 'ErrImagePull', 'InvalidImageName']);
const crashReasons = new Set(['CrashLoopBackOff', 'Error']);
const schedulingReasons = new Set(['FailedScheduling', 'Unschedulable']);
const probeReasons = new Set(['Unhealthy', 'FailedPostStartHook', 'FailedPreStopHook']);

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
