import { z } from 'zod';
import { DiagnosticScope, MCPRequest, NormalizedMCPRequest } from '@/types/mcp';

const namespaceSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'namespace must be a valid Kubernetes namespace');

const diagnosticScopeSchema = z.object({
  namespace: namespaceSchema.default('default'),
  labelSelector: z.string().trim().min(1).max(256).optional(),
  workload: z.string().trim().min(1).max(128).optional(),
  includeLogs: z.coerce.boolean().default(true),
  tailLines: z.coerce.number().int().min(20).max(500).default(120),
  maxPods: z.coerce.number().int().min(1).max(200).default(60),
  includeClusterResources: z.coerce.boolean().default(false),
  enableAiSummary: z.coerce.boolean().default(true),
});

const outputExpectationSchema = z.object({
  format: z.enum(['markdown', 'json']).default('markdown'),
  includes: z
    .array(z.string().trim().min(1).max(80))
    .default(['executive summary', 'root cause', 'evidence', 'remediation', 'automation commands']),
});

export const mcpRequestSchema = z
  .object({
    request_id: z.string().trim().min(1).max(128).optional(),
    agent: z.string().trim().min(1).max(80).default('kubernetes-diagnoser'),
    goal: z.string().trim().min(1).max(500).default('Diagnose Kubernetes workload issues'),
    memory: z.record(z.unknown()).default({}),
    tools: z.array(z.string().trim().min(1).max(80)).default(['kubernetes-api', 'events', 'logs']),
    input_context: diagnosticScopeSchema.default({} as DiagnosticScope),
    output_expectation: outputExpectationSchema.default({}),
  })
  .passthrough();

export function normalizeMcpRequest(input: MCPRequest): NormalizedMCPRequest {
  const parsed = mcpRequestSchema.parse(input);

  return {
    request_id: parsed.request_id ?? crypto.randomUUID(),
    agent: parsed.agent,
    goal: parsed.goal,
    memory: parsed.memory,
    tools: parsed.tools,
    input_context: parsed.input_context,
    output_expectation: parsed.output_expectation,
  };
}

export function formatValidationError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
}
