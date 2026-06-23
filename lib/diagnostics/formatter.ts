import { DiagnosisSummary, DiagnosticFinding, DiagnosticScope, KubernetesSnapshot } from '@/types/mcp';

export function buildSummary(
  scope: DiagnosticScope,
  snapshot: KubernetesSnapshot,
  findings: DiagnosticFinding[],
): DiagnosisSummary {
  const criticalFindings = findings.filter((finding) => finding.severity === 'critical').length;
  const highFindings = findings.filter((finding) => finding.severity === 'high').length;
  const unhealthyPods = snapshot.pods.filter((pod) => {
    const ready = pod.conditions.find((condition) => condition.type === 'Ready');
    return pod.phase !== 'Running' || ready?.status === 'False' || pod.restartCount > 0;
  }).length;
  const notReadyNodes = snapshot.nodes.filter((n) => !n.ready).length;
  const pendingPvcs = snapshot.pvcs.filter((p) => p.phase !== 'Bound').length;

  return {
    health: criticalFindings > 0 ? 'critical' : highFindings > 0 || unhealthyPods > 0 ? 'degraded' : 'healthy',
    namespace: scope.namespace,
    totalPods: snapshot.pods.length,
    unhealthyPods,
    warningEvents: snapshot.events.filter((event) => event.type === 'Warning').length,
    criticalFindings,
    highFindings,
    notReadyNodes,
    pendingPvcs,
    topRisks: findings
      .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
      .slice(0, 5)
      .map((finding) => finding.title),
  };
}

export function buildRunbook(findings: DiagnosticFinding[]): string[] {
  const actions = new Set<string>();

  for (const finding of findings) {
    finding.recommendedActions.slice(0, 2).forEach((action) => actions.add(action));
  }

  if (actions.size === 0) {
    actions.add('Narrow the diagnostic scope by workload or label selector if users still report impact.');
  }

  return Array.from(actions).slice(0, 8);
}

export function formatMarkdownReport(
  summary: DiagnosisSummary,
  findings: DiagnosticFinding[],
  snapshot: KubernetesSnapshot,
  runbook: string[],
): string {
  const lines: string[] = [
    `# Kubernetes Diagnostic Report`,
    '',
    `**Namespace:** ${summary.namespace}`,
    `**Cluster context:** ${snapshot.context ?? 'unknown'}`,
    `**Health:** ${summary.health}`,
    `**Pods:** ${summary.totalPods} collected, ${summary.unhealthyPods} unhealthy`,
    `**Warning events:** ${summary.warningEvents}`,
  ];

  if (snapshot.nodes.length > 0) {
    lines.push(`**Nodes:** ${snapshot.nodes.length} total, ${summary.notReadyNodes} not ready`);
  }
  if (snapshot.pvcs.length > 0) {
    lines.push(`**PVCs:** ${snapshot.pvcs.length} total, ${summary.pendingPvcs} not bound`);
  }
  if (snapshot.hpas.length > 0) {
    const maxed = snapshot.hpas.filter((h) => h.currentReplicas >= h.maxReplicas && h.maxReplicas > 0).length;
    lines.push(`**HPAs:** ${snapshot.hpas.length} total, ${maxed} at max replicas`);
  }
  if (snapshot.cronJobs.length > 0) {
    const suspended = snapshot.cronJobs.filter((c) => c.suspended).length;
    lines.push(`**CronJobs:** ${snapshot.cronJobs.length} total, ${suspended} suspended`);
  }

  lines.push('', `## Top Findings`);

  for (const finding of findings.slice(0, 8)) {
    lines.push(
      '',
      `### [${finding.severity.toUpperCase()}] ${finding.title}`,
      `- Resource: ${finding.resource.kind}/${finding.resource.name}${finding.resource.namespace ? ` in ${finding.resource.namespace}` : ''}`,
      `- Signal: ${finding.signal}`,
      `- Impact: ${finding.impact}`,
      `- Evidence:`,
      ...finding.evidence.slice(0, 8).map((item) => `  - ${item}`),
      `- Recommended actions:`,
      ...finding.recommendedActions.map((item) => `  - ${item}`),
    );

    if (finding.automation.length > 0) {
      lines.push(`- Read-only commands:`, ...finding.automation.map((item) => `  - \`${item.command}\` - ${item.description}`));
    }
  }

  lines.push('', `## Incident Runbook`, ...runbook.map((item, index) => `${index + 1}. ${item}`));

  if (snapshot.accessErrors.length > 0) {
    lines.push(
      '',
      `## Collection Warnings`,
      ...snapshot.accessErrors.map((error) => `- ${error.operation}: ${error.statusCode ?? 'n/a'} ${error.message}`),
    );
  }

  return lines.join('\n');
}
