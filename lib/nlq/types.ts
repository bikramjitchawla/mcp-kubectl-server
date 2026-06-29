import type { DiagnosticScope } from '@/types/mcp';

export type DiagnosticFocus =
  | 'pods'
  | 'workload-availability'
  | 'service-endpoints'
  | 'scheduling'
  | 'node-health'
  | 'resource-pressure'
  | 'image-pull'
  | 'storage'
  | 'events'
  | 'logs';

export interface ExtractedIntent {
  namespace?: string | null;
  workload?: string | null;
  labelSelector?: string | null;
  focus: DiagnosticFocus[];
  symptoms: string[];
  includeNodes: boolean;
  includeLogs: boolean;
  enableAiSummary: boolean;
  confidence: 'low' | 'medium' | 'high';
  ambiguities: string[];
  timeHint?: string | null;
}

export interface WorkloadInventoryItem {
  namespace: string;
  name: string;
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
}

export interface ClusterInventory {
  namespaces: string[];
  workloads: WorkloadInventoryItem[];
}

export interface ClarificationOption {
  label: string;
  value: string;
  resolvedContext: DiagnosticScope;
}

export interface ClarificationOptions {
  field: 'namespace' | 'workload';
  prompt: string;
  options: ClarificationOption[];
}

export interface NLQParseRequest {
  query: string;
  context?: string;
}

export interface NLQParseResponse {
  intent: ExtractedIntent | null;
  resolvedContext: DiagnosticScope | null;
  requiresConfirmation: boolean;
  confirmationPrompt: string | null;
  clarificationOptions?: ClarificationOptions;
  error?: string;
}
