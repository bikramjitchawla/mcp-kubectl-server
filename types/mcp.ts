export type OutputFormat = 'markdown' | 'json';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type DiagnosticCategory =
  | 'availability'
  | 'configuration'
  | 'image'
  | 'networking'
  | 'resource'
  | 'runtime'
  | 'scheduling'
  | 'storage'
  | 'unknown';

export interface MCPRequest {
  request_id?: string;
  agent?: string;
  goal?: string;
  memory?: Record<string, unknown>;
  tools?: string[];
  input_context?: Partial<DiagnosticScope>;
  output_expectation?: {
    format?: OutputFormat;
    includes?: string[];
  };
}

export interface NormalizedMCPRequest {
  request_id: string;
  agent: string;
  goal: string;
  memory: Record<string, unknown>;
  tools: string[];
  input_context: DiagnosticScope;
  output_expectation: {
    format: OutputFormat;
    includes: string[];
  };
}

export interface DiagnosticScope {
  namespace: string;
  labelSelector?: string;
  workload?: string;
  includeLogs: boolean;
  tailLines: number;
  maxPods: number;
  includeClusterResources: boolean;
  enableAiSummary: boolean;
}

export interface KubernetesResourceRef {
  apiVersion?: string;
  kind: string;
  namespace?: string;
  name: string;
}

export interface ConditionSnapshot {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface ContainerStateSnapshot {
  state: 'running' | 'terminated' | 'waiting' | 'unknown';
  reason?: string;
  message?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface ContainerSnapshot {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: ContainerStateSnapshot;
  lastState?: ContainerStateSnapshot;
  requests: Record<string, string>;
  limits: Record<string, string>;
}

export interface PodSnapshot {
  name: string;
  namespace: string;
  phase: string;
  nodeName?: string;
  serviceAccountName?: string;
  qosClass?: string;
  createdAt?: string;
  labels: Record<string, string>;
  ownerReferences: KubernetesResourceRef[];
  conditions: ConditionSnapshot[];
  containers: ContainerSnapshot[];
  initContainers: ContainerSnapshot[];
  restartCount: number;
  readyContainers: number;
}

export interface WorkloadSnapshot {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet' | 'Job';
  name: string;
  namespace: string;
  desired: number;
  ready: number;
  available?: number;
  updated?: number;
  succeeded?: number;
  failed?: number;
  conditions: ConditionSnapshot[];
}

export interface ServiceSnapshot {
  name: string;
  namespace: string;
  type: string;
  selector: Record<string, string>;
  ports: string[];
  readyEndpoints: number;
  notReadyEndpoints: number;
}

export interface EventSnapshot {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstSeen?: string;
  lastSeen?: string;
  involvedObject: KubernetesResourceRef;
}

export interface ContainerLogSnapshot {
  pod: string;
  container: string;
  previous: boolean;
  lines: string[];
  error?: string;
}

export interface AccessError {
  operation: string;
  statusCode?: number;
  message: string;
}

export interface KubernetesSnapshot {
  namespace: string;
  context?: string;
  collectedAt: string;
  pods: PodSnapshot[];
  workloads: WorkloadSnapshot[];
  services: ServiceSnapshot[];
  events: EventSnapshot[];
  logs: ContainerLogSnapshot[];
  accessErrors: AccessError[];
}

export interface AutomationCommand {
  description: string;
  command: string;
  destructive: boolean;
  requiresApproval: boolean;
}

export interface DiagnosticFinding {
  id: string;
  severity: Severity;
  category: DiagnosticCategory;
  title: string;
  resource: KubernetesResourceRef;
  signal: string;
  evidence: string[];
  impact: string;
  recommendedActions: string[];
  automation: AutomationCommand[];
}

export interface DiagnosisSummary {
  health: 'healthy' | 'degraded' | 'critical' | 'unknown';
  namespace: string;
  totalPods: number;
  unhealthyPods: number;
  warningEvents: number;
  criticalFindings: number;
  highFindings: number;
  topRisks: string[];
}

export interface MCPResponse {
  requestId: string;
  status: 'ok' | 'partial' | 'failed';
  generatedAt: string;
  scope: DiagnosticScope;
  summary: DiagnosisSummary;
  findings: DiagnosticFinding[];
  runbook: string[];
  output: string;
  aiNarrative?: string;
  snapshot: KubernetesSnapshot;
  metadata: {
    collector: string;
    analyzer: string;
    aiStatus: 'disabled' | 'skipped' | 'success' | 'failed';
    model?: string;
    errors: AccessError[];
  };
}
