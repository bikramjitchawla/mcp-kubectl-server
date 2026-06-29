import { z } from 'zod';
import { buildLlmClient } from '@/lib/llm/client';
import type { ClusterInventory, ExtractedIntent } from './types';
import { buildNlqPrompt } from './prompt';

const focusSchema = z.enum([
  'pods',
  'workload-availability',
  'service-endpoints',
  'scheduling',
  'node-health',
  'resource-pressure',
  'image-pull',
  'storage',
  'events',
  'logs',
]);

export const extractedIntentSchema = z.object({
  namespace: z.string().trim().min(1).nullable().optional(),
  workload: z.string().trim().min(1).nullable().optional(),
  labelSelector: z.string().trim().min(1).nullable().optional(),
  focus: z.array(focusSchema).default(['pods']),
  symptoms: z.array(z.string().trim().min(1)).default([]),
  includeNodes: z.boolean().default(false),
  includeLogs: z.boolean().default(true),
  enableAiSummary: z.boolean().default(true),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  ambiguities: z.array(z.string().trim().min(1)).default([]),
  timeHint: z.string().trim().min(1).nullable().optional(),
});

export function parseIntentJson(raw: string): ExtractedIntent {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(withoutFence);
  return extractedIntentSchema.parse(parsed);
}

export async function parseNaturalLanguageQuery(input: {
  query: string;
  inventory: ClusterInventory;
}): Promise<ExtractedIntent> {
  const llm = buildLlmClient();
  if (!llm) {
    throw new Error('Natural language query mode requires GROQ_API_KEY or OPENAI_API_KEY.');
  }

  const response = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a Kubernetes intent parser. Translate the user request into the requested JSON object only. Do not diagnose the cluster.',
      },
      {
        role: 'user',
        content: buildNlqPrompt(input.query, input.inventory),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Could not extract a diagnostic scope from the input.');
  }

  return parseIntentJson(content);
}
