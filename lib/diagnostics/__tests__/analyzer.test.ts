import { describe, it, expect } from 'vitest';
import { analyzeKubernetesSnapshot } from '../analyzer';
import {
  KubernetesSnapshot,
  PodSnapshot,
  ContainerSnapshot,
  ContainerStateSnapshot,
  NodeSnapshot,
  HPASnapshot,
  PVCSnapshot,
  CronJobSnapshot,
  ServiceSnapshot,
  WorkloadSnapshot,
  EventSnapshot,
} from '@/types/mcp';

// ─── fixture helpers ───────────────────────────────────────────────────────────

function emptySnapshot(namespace = 'test'): KubernetesSnapshot {
  return {
    namespace,
    collectedAt: '2026-01-01T00:00:00.000Z',
    pods: [],
    workloads: [],
    services: [],
    events: [],
    logs: [],
    nodes: [],
    hpas: [],
    pvcs: [],
    cronJobs: [],
    accessErrors: [],
  };
}

function runningContainer(name = 'app', image = 'myapp:latest'): ContainerSnapshot {
  return {
    name,
    image,
    ready: true,
    restartCount: 0,
    state: { state: 'running' },
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '500m', memory: '256Mi' },
  };
}

function waitingContainer(
  name: string,
  reason: string,
  message = '',
  restartCount = 0,
  lastState?: ContainerStateSnapshot,
): ContainerSnapshot {
  return {
    name,
    image: 'myapp:latest',
    ready: false,
    restartCount,
    state: { state: 'waiting', reason, message },
    lastState,
    requests: {},
    limits: {},
  };
}

function basicPod(name: string, namespace = 'test', phase = 'Running'): PodSnapshot {
  return {
    name,
    namespace,
    phase,
    labels: {},
    ownerReferences: [],
    conditions: [{ type: 'Ready', status: 'True' }],
    containers: [runningContainer()],
    initContainers: [],
    restartCount: 0,
    readyContainers: 1,
  };
}

function assertFindingShape(finding: ReturnType<typeof analyzeKubernetesSnapshot>[number]) {
  expect(typeof finding.id).toBe('string');
  expect(finding.id.length).toBeGreaterThan(0);
  expect(['info', 'low', 'medium', 'high', 'critical']).toContain(finding.severity);
  expect(typeof finding.category).toBe('string');
  expect(finding.resource).toBeDefined();
  expect(finding.resource.kind).toBeTruthy();
  expect(finding.resource.name).toBeTruthy();
  expect(Array.isArray(finding.evidence)).toBe(true);
  expect(finding.evidence.length).toBeGreaterThan(0);
  expect(typeof finding.impact).toBe('string');
  expect(finding.impact.length).toBeGreaterThan(0);
  expect(Array.isArray(finding.automation)).toBe(true);
  expect(finding.automation.length).toBeGreaterThan(0);
  // every automation command must be read-only
  for (const cmd of finding.automation) {
    expect(cmd.destructive).toBe(false);
    expect(cmd.requiresApproval).toBe(false);
  }
  // Phase 3 structured fields
  expect(finding.impactAssessment).toBeDefined();
  expect(finding.impactAssessment.summary).toBeTruthy();
  expect(finding.riskAssessment).toBeDefined();
  expect(finding.riskAssessment.reasons.length).toBeGreaterThan(0);
  expect(typeof finding.riskAssessment.riskIfIgnored).toBe('string');
}

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('analyzeKubernetesSnapshot', () => {
  describe('healthy namespace', () => {
    it('returns a single info finding when nothing is broken', () => {
      const snapshot = {
        ...emptySnapshot('production'),
        pods: [basicPod('web-abc', 'production')],
        workloads: [],
      };
      const findings = analyzeKubernetesSnapshot(snapshot);
      expect(findings).toHaveLength(1);
      const [f] = findings;
      expect(f!.severity).toBe('info');
      expect(f!.id).toContain('healthy');
      assertFindingShape(f!);
    });
  });

  describe('CrashLoopBackOff', () => {
    it('detects a crash-looping container', () => {
      const pod: PodSnapshot = {
        ...basicPod('crasher', 'test'),
        containers: [waitingContainer('app', 'CrashLoopBackOff', 'back-off restarting', 3)],
        conditions: [{ type: 'Ready', status: 'False' }],
        readyContainers: 0,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      const f = findings.find((x) => x.id.includes('crashloop'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('runtime');
      assertFindingShape(f!);
    });

    it('escalates to critical when restarts exceed 5', () => {
      const pod: PodSnapshot = {
        ...basicPod('heavy-crasher', 'test'),
        containers: [waitingContainer('app', 'CrashLoopBackOff', '', 10)],
        readyContainers: 0,
        conditions: [{ type: 'Ready', status: 'False' }],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      const f = findings.find((x) => x.id.includes('crashloop'));
      expect(f!.severity).toBe('critical');
    });
  });

  describe('ImagePullBackOff', () => {
    it('detects image pull failure', () => {
      const pod: PodSnapshot = {
        ...basicPod('bad-img', 'test'),
        containers: [waitingContainer('app', 'ImagePullBackOff', 'Back-off pulling image "bad:tag"')],
        readyContainers: 0,
        conditions: [{ type: 'Ready', status: 'False' }],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      const f = findings.find((x) => x.id.includes('-image'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('image');
      assertFindingShape(f!);
    });

    it('also detects ErrImagePull', () => {
      const pod: PodSnapshot = {
        ...basicPod('bad-img2', 'test'),
        containers: [waitingContainer('app', 'ErrImagePull')],
        readyContainers: 0,
        conditions: [{ type: 'Ready', status: 'False' }],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      expect(findings.find((x) => x.id.includes('-image'))).toBeDefined();
    });
  });

  describe('OOMKilled', () => {
    it('detects OOMKilled in container last state', () => {
      const container: ContainerSnapshot = {
        ...runningContainer(),
        ready: false,
        restartCount: 2,
        lastState: { state: 'terminated', reason: 'OOMKilled', exitCode: 137 },
      };
      const pod: PodSnapshot = { ...basicPod('oom-pod'), containers: [container] };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      const f = findings.find((x) => x.id.includes('-oom'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('resource');
      assertFindingShape(f!);
    });

    it('detects OOMKilled in current container state', () => {
      const container: ContainerSnapshot = {
        ...runningContainer(),
        ready: false,
        restartCount: 1,
        state: { state: 'terminated', reason: 'OOMKilled', exitCode: 137 },
      };
      const pod: PodSnapshot = { ...basicPod('oom-pod2'), containers: [container] };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      expect(findings.find((x) => x.id.includes('-oom'))).toBeDefined();
    });
  });

  describe('pending unschedulable pod', () => {
    it('detects pod stuck in Pending with unschedulable condition', () => {
      const pod: PodSnapshot = {
        ...basicPod('pending-pod', 'test', 'Pending'),
        conditions: [
          { type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/3 nodes available: insufficient cpu.' },
        ],
        readyContainers: 0,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pods: [pod] });
      const f = findings.find((x) => x.id.includes('-scheduling'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('scheduling');
      expect(f!.evidence.some((e) => e.includes('insufficient'))).toBe(true);
      assertFindingShape(f!);
    });
  });

  describe('service with no endpoints', () => {
    it('detects a service whose selector matches no ready pods', () => {
      const service: ServiceSnapshot = {
        name: 'ghost-svc',
        namespace: 'test',
        type: 'ClusterIP',
        selector: { app: 'ghost' },
        ports: ['80/TCP'],
        readyEndpoints: 0,
        notReadyEndpoints: 0,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), services: [service] });
      const f = findings.find((x) => x.id.includes('no-endpoints'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('networking');
      expect(f!.impactAssessment.userFacing).toBe(true);
      assertFindingShape(f!);
    });

    it('ignores a service with an empty selector (headless / external)', () => {
      const service: ServiceSnapshot = {
        name: 'headless',
        namespace: 'test',
        type: 'ClusterIP',
        selector: {},
        ports: [],
        readyEndpoints: 0,
        notReadyEndpoints: 0,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), services: [service] });
      expect(findings.find((x) => x.id.includes('no-endpoints'))).toBeUndefined();
    });
  });

  describe('node NotReady', () => {
    it('detects a NotReady node', () => {
      const node: NodeSnapshot = {
        name: 'worker-1',
        ready: false,
        roles: ['worker'],
        conditions: [{ type: 'Ready', status: 'False', reason: 'KubeletNotReady', message: 'container runtime is down' }],
        taints: [],
        allocatable: {},
        capacity: {},
        unschedulable: false,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), nodes: [node] });
      const f = findings.find((x) => x.id.includes('-notready'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.category).toBe('availability');
      assertFindingShape(f!);
    });
  });

  describe('node pressure', () => {
    it.each(['MemoryPressure', 'DiskPressure', 'PIDPressure'] as const)(
      'detects %s on a node',
      (pressureType) => {
        const node: NodeSnapshot = {
          name: 'worker-2',
          ready: true,
          roles: ['worker'],
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: pressureType, status: 'True', reason: 'NodeHas' + pressureType, message: 'threshold exceeded' },
          ],
          taints: [],
          allocatable: {},
          capacity: {},
          unschedulable: false,
        };
        const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), nodes: [node] });
        const f = findings.find((x) => x.id.includes(pressureType.toLowerCase()));
        expect(f).toBeDefined();
        expect(f!.severity).toBe('high');
        expect(f!.category).toBe('resource');
        assertFindingShape(f!);
      },
    );
  });

  describe('HPA unable to scale', () => {
    it('detects HPA with AbleToScale=False', () => {
      const hpa: HPASnapshot = {
        name: 'web-hpa',
        namespace: 'test',
        targetKind: 'Deployment',
        targetName: 'web',
        minReplicas: 2,
        maxReplicas: 10,
        currentReplicas: 2,
        desiredReplicas: 4,
        conditions: [{ type: 'AbleToScale', status: 'False', reason: 'FailedGetScale', message: 'could not get scale' }],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), hpas: [hpa] });
      const f = findings.find((x) => x.id.includes('-unable'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('availability');
      assertFindingShape(f!);
    });
  });

  describe('HPA at max replicas', () => {
    it('detects HPA that has reached maxReplicas', () => {
      const hpa: HPASnapshot = {
        name: 'web-hpa',
        namespace: 'test',
        targetKind: 'Deployment',
        targetName: 'web',
        minReplicas: 2,
        maxReplicas: 5,
        currentReplicas: 5,
        desiredReplicas: 5,
        conditions: [{ type: 'AbleToScale', status: 'True' }],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), hpas: [hpa] });
      const f = findings.find((x) => x.id.includes('-maxed'));
      expect(f).toBeDefined();
      expect(['medium', 'high']).toContain(f!.severity);
      expect(f!.category).toBe('resource');
      assertFindingShape(f!);
    });

    it('escalates to high when ScalingLimited=True', () => {
      const hpa: HPASnapshot = {
        name: 'api-hpa',
        namespace: 'test',
        targetKind: 'Deployment',
        targetName: 'api',
        minReplicas: 1,
        maxReplicas: 3,
        currentReplicas: 3,
        desiredReplicas: 3,
        conditions: [
          { type: 'AbleToScale', status: 'True' },
          { type: 'ScalingLimited', status: 'True', reason: 'TooManyReplicas' },
        ],
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), hpas: [hpa] });
      const f = findings.find((x) => x.id.includes('-maxed'));
      expect(f!.severity).toBe('high');
    });
  });

  describe('pending PVC', () => {
    it('detects a PVC stuck in Pending', () => {
      const pvc: PVCSnapshot = {
        name: 'data-pvc',
        namespace: 'test',
        phase: 'Pending',
        storageClass: 'does-not-exist',
        accessModes: ['ReadWriteOnce'],
        capacity: '10Gi',
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pvcs: [pvc] });
      const f = findings.find((x) => x.id.includes('-pending'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('high');
      expect(f!.category).toBe('storage');
      assertFindingShape(f!);
    });
  });

  describe('lost PVC', () => {
    it('detects a PVC in Lost state', () => {
      const pvc: PVCSnapshot = {
        name: 'lost-pvc',
        namespace: 'test',
        phase: 'Lost',
        storageClass: 'standard',
        accessModes: ['ReadWriteOnce'],
        volumeName: 'pv-abc123',
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), pvcs: [pvc] });
      const f = findings.find((x) => x.id.includes('-lost'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.category).toBe('storage');
      assertFindingShape(f!);
    });
  });

  describe('suspended CronJob', () => {
    it('detects a suspended CronJob', () => {
      const cronJob: CronJobSnapshot = {
        name: 'nightly-backup',
        namespace: 'test',
        schedule: '0 2 * * *',
        suspended: true,
        active: 0,
        lastScheduleTime: '2026-01-01T02:00:00Z',
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), cronJobs: [cronJob] });
      const f = findings.find((x) => x.id.includes('-suspended'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('medium');
      expect(f!.category).toBe('availability');
      assertFindingShape(f!);
    });

    it('ignores an active CronJob', () => {
      const cronJob: CronJobSnapshot = {
        name: 'active-job',
        namespace: 'test',
        schedule: '*/5 * * * *',
        suspended: false,
        active: 0,
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), cronJobs: [cronJob] });
      expect(findings.find((x) => x.id.includes('-suspended'))).toBeUndefined();
    });
  });

  describe('generic warning event', () => {
    it('surfaces a warning event that is not already covered by a specific rule', () => {
      const event: EventSnapshot = {
        type: 'Warning',
        reason: 'Evicted',
        message: 'The node was low on resource: memory. Threshold quantity: 100Mi, available: 50Mi.',
        count: 3,
        involvedObject: { kind: 'Pod', namespace: 'test', name: 'evicted-pod' },
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), events: [event] });
      const f = findings.find((x) => x.id.includes('event-'));
      expect(f).toBeDefined();
      expect(f!.severity).toBe('medium');
      assertFindingShape(f!);
    });

    it('does not double-report events already covered by scheduling rules', () => {
      const event: EventSnapshot = {
        type: 'Warning',
        reason: 'FailedScheduling',
        message: '0/3 nodes available',
        involvedObject: { kind: 'Pod', namespace: 'test', name: 'sched-pod' },
      };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), events: [event] });
      // FailedScheduling without a pending pod → no pod finding, but also no event finding
      expect(findings.find((x) => x.id.startsWith('event-'))).toBeUndefined();
    });

    it('ignores stale pod sandbox warnings after the pod has recovered', () => {
      const pod = basicPod('local-path-provisioner-7b8c8ddbd6-5xhb7', 'local-path-storage');
      const event: EventSnapshot = {
        type: 'Warning',
        reason: 'FailedCreatePodSandBox',
        message:
          'Failed to create pod sandbox: plugin type="calico" failed (add): stat /var/lib/calico/nodename: no such file or directory',
        count: 5,
        firstSeen: '2026-06-29T20:00:00.000Z',
        lastSeen: '2026-06-29T20:01:00.000Z',
        involvedObject: {
          kind: 'Pod',
          namespace: 'local-path-storage',
          name: 'local-path-provisioner-7b8c8ddbd6-5xhb7',
        },
      };

      const findings = analyzeKubernetesSnapshot({
        ...emptySnapshot('local-path-storage'),
        collectedAt: '2026-06-29T20:25:00.000Z',
        pods: [pod],
        events: [event],
      });

      expect(findings.find((x) => x.id.includes('FailedCreatePodSandBox'))).toBeUndefined();
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe('info');
    });

    it('keeps recent pod sandbox warnings visible even when the pod is currently running', () => {
      const pod = basicPod('local-path-provisioner-7b8c8ddbd6-5xhb7', 'local-path-storage');
      const event: EventSnapshot = {
        type: 'Warning',
        reason: 'FailedCreatePodSandBox',
        message:
          'Failed to create pod sandbox: plugin type="calico" failed (add): stat /var/lib/calico/nodename: no such file or directory',
        count: 1,
        lastSeen: '2026-06-29T20:23:00.000Z',
        involvedObject: {
          kind: 'Pod',
          namespace: 'local-path-storage',
          name: 'local-path-provisioner-7b8c8ddbd6-5xhb7',
        },
      };

      const findings = analyzeKubernetesSnapshot({
        ...emptySnapshot('local-path-storage'),
        collectedAt: '2026-06-29T20:25:00.000Z',
        pods: [pod],
        events: [event],
      });

      expect(findings.find((x) => x.id.includes('FailedCreatePodSandBox'))).toBeDefined();
    });
  });

  describe('finding uniqueness and shape', () => {
    it('deduplicates findings with the same id', () => {
      const pvc: PVCSnapshot = {
        name: 'dup-pvc',
        namespace: 'test',
        phase: 'Pending',
        accessModes: ['ReadWriteOnce'],
      };
      const snapshot = { ...emptySnapshot(), pvcs: [pvc, pvc] };
      const findings = analyzeKubernetesSnapshot(snapshot);
      const dupes = findings.filter((x) => x.id.includes('dup-pvc'));
      expect(dupes).toHaveLength(1);
    });

    it('sorts findings: critical before high before medium before info', () => {
      const node: NodeSnapshot = {
        name: 'n1',
        ready: false,
        roles: [],
        conditions: [{ type: 'Ready', status: 'False' }],
        taints: [],
        allocatable: {},
        capacity: {},
        unschedulable: false,
      };
      const pvc: PVCSnapshot = { name: 'p1', namespace: 'test', phase: 'Pending', accessModes: [] };
      const findings = analyzeKubernetesSnapshot({ ...emptySnapshot(), nodes: [node], pvcs: [pvc] });
      const severities = findings.map((f) => f.severity);
      const order: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
      for (let i = 1; i < severities.length; i++) {
        expect(order[severities[i]!]!).toBeLessThanOrEqual(order[severities[i - 1]!]!);
      }
    });
  });
});
