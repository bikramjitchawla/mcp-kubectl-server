import type { DiagnosticScope, KubernetesResourceRef } from './mcp';

export interface WorkloadConfiguration {
  containers: { name: string; image: string; requests: Record<string, string>; limits: Record<string, string>; configurationHash: string }[];
  templateHash: string;
}
export interface ChangeEvidence {
  resource: KubernetesResourceRef;
  field: string;
  before: unknown;
  after: unknown;
  interpretation: 'observed-change';
}
export interface Investigation {
  baselineId?: string;
  baselineAt?: string;
  status: 'compared' | 'no-baseline' | 'incomplete';
  changes: ChangeEvidence[];
  hypotheses: { statement: string; evidence: string[]; confidence: 'low'; findingIds: string[] }[];
  limitations: string[];
  metricChanges: { name: string; before: number; after: number; unit: string }[];
}
export interface DependencyEdge {
  from: KubernetesResourceRef;
  to: KubernetesResourceRef;
  relation: 'owned-by' | 'selected-by' | 'scheduled-on' | 'mounts';
  evidence: string;
}
export interface IncidentGroup {
  id: string;
  title: string;
  findingIds: string[];
  resources: KubernetesResourceRef[];
  edges: DependencyEdge[];
  interpretation: string;
}
export interface MetricsEvidence {
  status: 'available' | 'disabled' | 'unavailable';
  collectedAt: string;
  windowSeconds: number;
  values: { name: string; value: number; unit: string }[];
  reason?: string;
}
export interface FixOperation {
  container: string;
  field: 'image' | 'requests' | 'limits';
  before: string | Record<string, string>;
  after: string | Record<string, string>;
}
export interface Verification {
  at: string;
  runId: string;
  status: 'observing' | 'passed' | 'failed' | 'inconclusive';
  checks: { name: string; passed: boolean | null; detail: string }[];
}
export interface FixPlan {
  id: string;
  createdAt: string;
  sourceRunId: string;
  baselineRunId: string;
  scope: DiagnosticScope;
  resource: KubernetesResourceRef;
  operations: FixOperation[];
  rationale: string;
  successCriteria: string[];
  status: 'proposed' | 'pr-open' | 'merged' | 'closed' | 'verified';
  verification: Verification[];
  target?: { repository: string; branch: string; path: string };
  preview?: { baseSha: string; fileSha: string; content: string; diff: string; digest: string };
  pullRequest?: { number: number; url: string; branch: string; mergedAt?: string; headSha?: string };
}
