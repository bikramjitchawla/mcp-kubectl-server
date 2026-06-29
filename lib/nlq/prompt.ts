import type { ClusterInventory } from './types';

export function buildNlqPrompt(query: string, inventory: ClusterInventory): string {
  const namespaceLines = inventory.namespaces.map((namespace) => `- ${namespace}`).join('\n') || '- none';
  const workloadLines =
    inventory.workloads
      .map((workload) => `- ${workload.namespace}/${workload.kind}/${workload.name}`)
      .join('\n') || '- none';

  return [
    'You translate a Kubernetes incident description into diagnostic parameters.',
    'Return only valid JSON. Do not include prose, markdown, code fences, findings, commands, or explanations.',
    '',
    'Known namespaces:',
    namespaceLines,
    '',
    'Known workloads:',
    workloadLines,
    '',
    'Rules:',
    '- Match namespace and workload names exactly from the lists above.',
    '- Never invent namespaces or workloads.',
    '- If scope is under-specified, set confidence to "low" and add clear ambiguity questions.',
    '- If the user mentions nodes, infrastructure, memory pressure, disk pressure, or scheduling capacity, include "node-health" or "resource-pressure" in focus and set includeNodes true.',
    '- If the user mentions crashes, restarts, logs, output, stack traces, or errors, include "logs" in focus and set includeLogs true.',
    '- enableAiSummary must be true.',
    '',
    'JSON schema:',
    '{',
    '  "namespace": "exact namespace name or null",',
    '  "workload": "exact workload name or null",',
    '  "labelSelector": "selector such as app=checkout or null",',
    '  "focus": ["pods"],',
    '  "symptoms": ["plain text symptom"],',
    '  "includeNodes": false,',
    '  "includeLogs": true,',
    '  "enableAiSummary": true,',
    '  "confidence": "low|medium|high",',
    '  "ambiguities": ["question if needed"],',
    '  "timeHint": "plain text time hint or null"',
    '}',
    '',
    `Incident description: ${query}`,
  ].join('\n');
}
