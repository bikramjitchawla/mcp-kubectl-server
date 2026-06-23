import OpenAI from 'openai';
import { analyzeKubernetesSnapshot } from '@/lib/diagnostics/analyzer';
import { buildRunbook, buildSummary, formatMarkdownReport } from '@/lib/diagnostics/formatter';
import { normalizeMcpRequest } from '@/lib/validation';
import { KubernetesDiagnosticCollector } from '@/tools/kubectlTool';
import { saveRun } from '@/lib/store/history';
import { DiagnosticFinding, MCPRequest, MCPResponse } from '@/types/mcp';

export class MCPAgentRunner {
  private readonly openai?: OpenAI;

  constructor() {
    this.openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : undefined;
  }

  async run(mcp: MCPRequest): Promise<MCPResponse> {
    const request = normalizeMcpRequest(mcp);
    const collector = new KubernetesDiagnosticCollector(request.input_context.context);
    const snapshot = await collector.collect(request.input_context);
    const findings = analyzeKubernetesSnapshot(snapshot);
    const summary = buildSummary(request.input_context, snapshot, findings);
    const runbook = buildRunbook(findings);
    const deterministicReport = formatMarkdownReport(summary, findings, snapshot, runbook);

    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const ai = await this.generateAiNarrative({
      enabled: request.input_context.enableAiSummary,
      model,
      goal: request.goal,
      findings,
      report: deterministicReport,
    });

    const response: MCPResponse = {
      requestId: request.request_id,
      status: snapshot.accessErrors.length > 0 ? 'partial' : 'ok',
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

    if (!this.openai) {
      return { status: 'skipped' };
    }

    try {
      const response = await this.openai.chat.completions.create({
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
      });

      return { status: 'success', text: response.choices[0]?.message?.content ?? input.report };
    } catch {
      return { status: 'failed' };
    }
  }
}
