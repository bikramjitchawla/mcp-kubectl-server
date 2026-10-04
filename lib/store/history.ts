import type { FixPlan } from '@/types/investigation';
import { DiagnosisSummary, DiagnosticScope, MCPResponse } from '@/types/mcp';
import { deleteRecord, getRecord, putRecord, records } from './disk';
import { currentPrincipal } from '@/lib/tenancy/context';

export interface HistoryEntry {
  requestId: string; generatedAt: string; status: MCPResponse['status'];
  summary: DiagnosisSummary; scope: DiagnosticScope; aiStatus: MCPResponse['metadata']['aiStatus'];
}
interface RunIndex extends HistoryEntry { context?: string; collectedAt: string; podsTruncated: boolean }
function visible(entry: { scope: DiagnosticScope; context?: string }): boolean {
  const tenant = currentPrincipal()?.tenant;
  return !tenant || (tenant.namespaces.includes(entry.scope.namespace) && entry.context === tenant.context);
}
export function pruneFixes(): void {
  const cutoff = Date.now() - 30 * 86400_000;
  for (const plan of records<FixPlan>('fixes')) {
    if (['proposed', 'closed', 'verified'].includes(plan.status) && Date.parse(plan.createdAt) < cutoff) deleteRecord('fixes', plan.id);
  }
}
export function saveRun(response: MCPResponse): void {
  pruneFixes();
  putRecord('runs', response.requestId, response);
  const entry: RunIndex = { requestId: response.requestId, generatedAt: response.generatedAt, status: response.status,
    summary: response.summary, scope: response.scope, aiStatus: response.metadata.aiStatus, context: response.snapshot.context,
    collectedAt: response.snapshot.collectedAt, podsTruncated: !!response.snapshot.coverage?.podsTruncated };
  putRecord('run-index', response.requestId, entry);
  const entries = records<RunIndex>('run-index').sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const retention = Math.min(2000, Math.max(2, Number(process.env.DIAGNOSTICS_HISTORY_LIMIT) || 200));
  const pinned = new Set(records<FixPlan>('fixes').flatMap(p => [p.sourceRunId, p.baselineRunId, ...p.verification.map(v => v.runId)]));
  entries.slice(retention).filter(r => !pinned.has(r.requestId)).forEach(r => {
    deleteRecord('run-index', r.requestId); deleteRecord('runs', r.requestId);
  });
}
export function getRun(id: string): MCPResponse | undefined {
  const run = getRecord<MCPResponse>('runs', id);
  return run && visible({ scope: run.scope, context: run.snapshot.context }) ? run : undefined;
}
export function listRuns(offset = 0, limit = 50): HistoryEntry[] {
  return records<RunIndex>('run-index').filter(visible).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(offset, offset + Math.min(100, limit)).map(({ context: _context, collectedAt: _at, podsTruncated: _truncated, ...entry }) => entry);
}
function matchingScope(a: DiagnosticScope, b: DiagnosticScope): boolean {
  return a.namespace === b.namespace && (a.workload ?? '') === (b.workload ?? '') && (a.labelSelector ?? '') === (b.labelSelector ?? '') &&
    a.maxPods === b.maxPods && a.includeLogs === b.includeLogs && a.tailLines === b.tailLines && a.includeNodes === b.includeNodes && a.includeHpa === b.includeHpa;
}
export function sameScope(a: MCPResponse, b: MCPResponse): boolean {
  return Boolean(a.snapshot.context && b.snapshot.context) && a.snapshot.context === b.snapshot.context && matchingScope(a.scope, b.scope);
}
export function findBaseline(current: MCPResponse): MCPResponse | undefined {
  const candidates = records<RunIndex>('run-index').filter(r => visible(r) && r.requestId !== current.requestId &&
    r.context === current.snapshot.context && matchingScope(r.scope, current.scope) && r.collectedAt < current.snapshot.collectedAt &&
    r.status === 'ok' && !r.podsTruncated).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  for (const candidate of candidates) { const run = getRun(candidate.requestId); if (run) return run; }
  return undefined;
}
