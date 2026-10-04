import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { completion } = vi.hoisted(() => ({ completion: vi.fn() }));
vi.mock('@/lib/llm/client', () => ({ buildLlmClient: () => ({ model: 'fixture-model', client: { chat: { completions: { create: completion } } } }) }));
vi.mock('@/tools/kubectlTool', () => ({ KubernetesDiagnosticCollector: class {
  async collect() { return { namespace: 'default', context: 'fixture', collectedAt: '2026-01-01T00:00:00Z', pods: [], workloads: [], events: [], services: [], nodes: [], hpas: [], pvcs: [], cronJobs: [], logs: [], accessErrors: [] }; }
} }));
import { MCPAgentRunner } from '../mcpAgentRunner';
import { getRun } from '@/lib/store/history';
let directory: string;
beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'narrative-test-')); vi.stubEnv('DIAGNOSTICS_DATA_DIR', directory); vi.stubEnv('PROMETHEUS_URL', ''); completion.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { force: true, recursive: true }); });
describe('evidence before optional AI', () => {
  it('saves and returns the deterministic report before contacting a provider', async () => {
    const runner = new MCPAgentRunner();
    const run = await runner.run({ input_context: { enableAiSummary: true } }, true);
    expect(completion).not.toHaveBeenCalled();
    expect(run.metadata.aiStatus).toBe('pending');
    expect(getRun(run.requestId)?.output).toContain('Kubernetes Diagnostic Report');
    completion.mockResolvedValue({ choices: [{ message: { content: 'AI explanation' } }] });
    const enriched = await runner.completeNarrative(run);
    expect(enriched.aiNarrative).toBe('AI explanation');
    expect(enriched.output).toContain('Kubernetes Diagnostic Report');
    expect(getRun(run.requestId)?.metadata.aiStatus).toBe('success');
  });
  it('keeps saved evidence when the narrative provider fails', async () => {
    const runner = new MCPAgentRunner();
    const run = await runner.run({ input_context: { enableAiSummary: true } }, true);
    completion.mockRejectedValue(new Error('Provider timed out'));
    const result = await runner.completeNarrative(run);
    expect(result.metadata.aiStatus).toBe('failed');
    expect(getRun(run.requestId)?.output).toBe(run.output);
  });
});
