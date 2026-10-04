import { authorizeScope, currentPrincipal } from '@/lib/tenancy/context';
import { compareRuns } from '@/lib/investigation/compare';
import { groupIncidents } from '@/lib/investigation/group';
import { collectMetrics } from '@/lib/investigation/metrics';
import { analyzeKubernetesSnapshot } from '@/lib/diagnostics/analyzer';
import { buildRunbook, buildSummary, formatMarkdownReport } from '@/lib/diagnostics/formatter';
import { normalizeMcpRequest } from '@/lib/validation';
import { KubernetesDiagnosticCollector } from '@/tools/kubectlTool';
import { findBaseline, saveRun } from '@/lib/store/history';
import { DiagnosticFinding, MCPRequest, MCPResponse } from '@/types/mcp';
import { buildLlmClient, LlmClient } from '@/lib/llm/client';

export class MCPAgentRunner {
  private readonly llm?: LlmClient;

  constructor() {
    this.llm = buildLlmClient();
  }

  async run(mcp: unknown, deferNarrative = false): Promise<MCPResponse> {
    const request = normalizeMcpRequest(mcp);
    request.input_context = authorizeScope(request.input_context);
    const collector = new KubernetesDiagnosticCollector(request.input_context.context);
    const snapshot = await collector.collect(request.input_context);
    snapshot.metrics = await collectMetrics(snapshot);
    const findings = analyzeKubernetesSnapshot(snapshot);
    const summary = buildSummary(request.input_context, snapshot, findings);
    const runbook = buildRunbook(findings);
    const deterministicReport = formatMarkdownReport(summary, findings, snapshot, runbook);

    const model = this.llm?.model ?? '';
    const ai: { status: MCPResponse['metadata']['aiStatus']; text?: string } = deferNarrative
      ? { status: !request.input_context.enableAiSummary ? 'disabled' : this.llm ? 'pending' : 'skipped' }
      : await this.generateAiNarrative({
      enabled: request.input_context.enableAiSummary,
      model,
      goal: request.goal,
      findings,
      report: deterministicReport,
    });

    const response: MCPResponse = {
      requestId: crypto.randomUUID(),
      status: snapshot.accessErrors.length > 0 || snapshot.coverage?.podsTruncated ? 'partial' : 'ok',
      generatedAt: new Date().toISOString(),
      scope: request.input_context,
      summary,
      findings,
      runbook,
      output: ai.text ?? deterministicReport,
      aiNarrative: ai.text,
      snapshot,
      metadata: {
        collector: '@kubernetes/client-node',
        analyzer: 'deterministic-kubernetes-rules',
        aiStatus: ai.status,
        model: ai.status === 'success' ? model : undefined,
        errors: snapshot.accessErrors,
      },
    };

    response.incidents = groupIncidents(snapshot, findings);
    response.investigation = compareRuns(response, findBaseline(response));
    response.output += '\n\n## What changed?\n' +
      response.investigation.changes.map(c => `- ${c.resource.kind}/${c.resource.name}: ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`).join('\n') +
      '\n' + response.investigation.limitations.join('\n') +
      '\n\n## Related incidents\n' + response.incidents.map(i => `- ${i.title}. ${i.interpretation}`).join('\n') +
      '\n\nChanges are observations. Their relationship to symptoms remains a hypothesis, not proven causation.';
    saveRun(response);
    return response;
  }

  async completeNarrative(response: MCPResponse): Promise<MCPResponse> {
    authorizeScope({ ...response.scope, enableAiSummary: true });
    if (response.metadata.aiStatus === 'success') return response;
    const ai = await this.generateAiNarrative({ enabled: true, model: this.llm?.model ?? '',
      goal: `Explain the observed incident in ${response.scope.namespace}`, findings: response.findings, report: response.output });
    response.aiNarrative = ai.text;
    response.metadata.aiStatus = ai.status;
    response.metadata.model = ai.status === 'success' ? this.llm?.model : undefined;
    saveRun(response);
    return response;
  }

  private async generateAiNarrative(input: {
    enabled: boolean;
    model: string;
    goal: string;
    findings: DiagnosticFinding[];
    report: string;
  }): Promise<{ status: MCPResponse['metadata']['aiStatus']; text?: string }> {
    if (!input.enabled) {
      return { status: 'disabled' };
    }

    if (!this.llm) {
      return { status: 'skipped' };
    }

    try {
      const response = await this.llm.client.chat.completions.create({
        model: input.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior Kubernetes platform engineer. Use only the supplied diagnostic evidence. Do not invent resources, commands, or causes. Prefer concise incident-ready markdown.',
          },
          {
            role: 'user',
            content: [
              `Goal: ${input.goal}`,
              '',
              'Return sections: Executive summary, likely root cause, evidence, next actions, read-only automation commands.',
              '',
              `Deterministic findings JSON:\n${JSON.stringify(input.findings.slice(0, 10), null, 2)}`,
              '',
              `Base report:\n${input.report}`,
            ].join('\n'),
          },
        ],
      }, { signal: currentPrincipal()?.signal });

      return { status: 'success', text: response.choices[0]?.message?.content ?? input.report };
    } catch {
      return { status: 'failed' };
    }
  }
}
