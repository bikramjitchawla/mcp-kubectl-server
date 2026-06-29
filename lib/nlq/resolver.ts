import type { DiagnosticScope } from '@/types/mcp';
import type {
  ClarificationOptions,
  ClusterInventory,
  ExtractedIntent,
  NLQParseResponse,
  WorkloadInventoryItem,
} from './types';

const DEFAULT_TAIL_LINES = 120;
const DEFAULT_MAX_PODS = 60;

export function resolveIntent(input: {
  intent: ExtractedIntent;
  inventory: ClusterInventory;
  context?: string;
}): NLQParseResponse {
  const intent = normalizeIntent(input.intent);
  const ambiguities = [...intent.ambiguities];
  const namespaces = [...input.inventory.namespaces].sort();
  const workloads = input.inventory.workloads;
  const namespace = resolveNamespace(intent, namespaces, workloads, ambiguities);
  const labelSelector = intent.labelSelector ?? undefined;

  if (!namespace.value) {
    return {
      intent: { ...intent, confidence: 'low', ambiguities },
      resolvedContext: null,
      requiresConfirmation: true,
      confirmationPrompt: ambiguities[0] ?? 'Select a namespace before running diagnostics.',
      clarificationOptions: buildNamespaceClarifications(intent, namespaces, input.context),
    };
  }

  let workload = intent.workload ?? undefined;
  if (workload) {
    const namespaceWorkloads = workloads.filter((item) => item.namespace === namespace.value);
    const exactMatch = namespaceWorkloads.some((item) => item.name === workload);
    if (!exactMatch) {
      ambiguities.push(`Workload "${workload}" was not found in namespace "${namespace.value}".`);
      const matches = findWorkloadMatches(workload, namespaceWorkloads);
      if (matches.length === 1) {
        workload = matches[0]!.name;
      } else {
        return {
          intent: { ...intent, confidence: 'low', ambiguities },
          resolvedContext: null,
          requiresConfirmation: true,
          confirmationPrompt: `Workload "${intent.workload}" was not found in namespace "${namespace.value}".`,
          clarificationOptions:
            matches.length > 1 ? buildWorkloadClarifications(intent, namespace.value, matches, input.context) : undefined,
        };
      }
    }
  }

  const resolvedContext = buildDiagnosticScope({
    namespace: namespace.value,
    workload,
    labelSelector,
    intent,
    context: input.context,
  });

  const confidence = namespace.inferred && intent.confidence === 'high' ? 'medium' : intent.confidence;
  const requiresConfirmation = confidence !== 'high' || ambiguities.length > 0;

  return {
    intent: { ...intent, confidence, ambiguities },
    resolvedContext,
    requiresConfirmation,
    confirmationPrompt: requiresConfirmation
      ? ambiguities[0] ?? 'Review the interpreted diagnostic scope before running.'
      : null,
  };
}

function normalizeIntent(intent: ExtractedIntent): ExtractedIntent {
  return {
    ...intent,
    namespace: emptyToNull(intent.namespace),
    workload: emptyToNull(intent.workload),
    labelSelector: emptyToNull(intent.labelSelector),
    focus: intent.focus.length > 0 ? intent.focus : ['pods'],
    symptoms: intent.symptoms ?? [],
    includeNodes: intent.includeNodes,
    includeLogs: intent.includeLogs,
    enableAiSummary: true,
    ambiguities: intent.ambiguities ?? [],
  };
}

function resolveNamespace(
  intent: ExtractedIntent,
  namespaces: string[],
  workloads: WorkloadInventoryItem[],
  ambiguities: string[],
): { value?: string; inferred: boolean } {
  if (intent.namespace) {
    if (namespaces.includes(intent.namespace)) {
      return { value: intent.namespace, inferred: false };
    }

    ambiguities.push(`Namespace "${intent.namespace}" was not found.`);
    return { inferred: false };
  }

  if (intent.workload) {
    const exactWorkloadNamespaces = workloads
      .filter((item) => item.name === intent.workload)
      .map((item) => item.namespace);
    const uniqueExactNamespaces = Array.from(new Set(exactWorkloadNamespaces));
    if (uniqueExactNamespaces.length === 1) {
      return { value: uniqueExactNamespaces[0], inferred: true };
    }
    if (uniqueExactNamespaces.length > 1) {
      ambiguities.push(
        `Found workload "${intent.workload}" in ${uniqueExactNamespaces.length} namespaces: ${uniqueExactNamespaces.join(', ')}.`,
      );
      return { inferred: false };
    }
  }

  if (namespaces.length === 1) {
    return { value: namespaces[0], inferred: true };
  }

  ambiguities.push('No namespace was specified.');
  return { inferred: false };
}

function buildDiagnosticScope(input: {
  namespace: string;
  workload?: string;
  labelSelector?: string;
  intent: ExtractedIntent;
  context?: string;
}): DiagnosticScope {
  const focus = new Set(input.intent.focus);
  const symptomText = input.intent.symptoms.join(' ').toLowerCase();
  const includeLogs =
    input.intent.includeLogs ||
    focus.has('logs') ||
    /crash|restart|log|error|exception|stack/.test(symptomText);

  return {
    namespace: input.namespace,
    workload: input.workload,
    labelSelector: input.labelSelector,
    includeLogs,
    tailLines: DEFAULT_TAIL_LINES,
    maxPods: DEFAULT_MAX_PODS,
    includeClusterResources: false,
    includeNodes: input.intent.includeNodes || focus.has('node-health') || focus.has('resource-pressure'),
    includeHpa: true,
    enableAiSummary: input.intent.enableAiSummary,
    context: input.context,
  };
}

function buildNamespaceClarifications(
  intent: ExtractedIntent,
  namespaces: string[],
  context?: string,
): ClarificationOptions | undefined {
  if (namespaces.length === 0) {
    return undefined;
  }

  return {
    field: 'namespace',
    prompt: intent.workload
      ? `Choose a namespace for "${intent.workload}".`
      : 'Choose a namespace for this diagnostic.',
    options: namespaces.slice(0, 12).map((namespace) => ({
      label: namespace,
      value: namespace,
      resolvedContext: buildDiagnosticScope({
        namespace,
        workload: intent.workload ?? undefined,
        labelSelector: intent.labelSelector ?? undefined,
        intent,
        context,
      }),
    })),
  };
}

function buildWorkloadClarifications(
  intent: ExtractedIntent,
  namespace: string,
  matches: WorkloadInventoryItem[],
  context?: string,
): ClarificationOptions {
  return {
    field: 'workload',
    prompt: `Choose a workload in namespace "${namespace}".`,
    options: matches.slice(0, 12).map((workload) => ({
      label: `${workload.name} (${workload.kind})`,
      value: workload.name,
      resolvedContext: buildDiagnosticScope({
        namespace,
        workload: workload.name,
        labelSelector: intent.labelSelector ?? undefined,
        intent,
        context,
      }),
    })),
  };
}

function findWorkloadMatches(query: string, workloads: WorkloadInventoryItem[]): WorkloadInventoryItem[] {
  const lowered = query.toLowerCase();
  return workloads.filter((workload) => workload.name.toLowerCase().includes(lowered));
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
