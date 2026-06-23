import { DiagnosisSummary, DiagnosticScope, MCPResponse } from '@/types/mcp';

const MAX_ENTRIES = 50;
const runs = new Map<string, MCPResponse>();
const order: string[] = [];

export interface HistoryEntry {
  requestId: string;
  generatedAt: string;
  status: MCPResponse['status'];
  summary: DiagnosisSummary;
  scope: DiagnosticScope;
  aiStatus: MCPResponse['metadata']['aiStatus'];
}

export function saveRun(response: MCPResponse): void {
  if (order.length >= MAX_ENTRIES) {
    const oldest = order.shift()!;
    runs.delete(oldest);
  }
  runs.set(response.requestId, response);
  order.push(response.requestId);
}

export function getRun(id: string): MCPResponse | undefined {
  return runs.get(id);
}

export function listRuns(): HistoryEntry[] {
  return order
    .slice()
    .reverse()
    .map((id) => {
      const run = runs.get(id)!;
      return {
        requestId: run.requestId,
        generatedAt: run.generatedAt,
        status: run.status,
        summary: run.summary,
        scope: run.scope,
        aiStatus: run.metadata.aiStatus,
      };
    });
}
