import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasLlmClient } from '@/lib/llm/client';
import { collectClusterInventory } from '@/lib/nlq/inventory';
import { parseNaturalLanguageQuery } from '@/lib/nlq/parser';
import { resolveIntent } from '@/lib/nlq/resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  context: z.string().trim().min(1).max(128).optional(),
});

export async function GET() {
  return NextResponse.json({
    enabled: hasLlmClient(),
    requires: hasLlmClient() ? [] : ['GROQ_API_KEY', 'OPENAI_API_KEY'],
  });
}

export async function POST(req: NextRequest) {
  if (!hasLlmClient()) {
    return NextResponse.json(
      {
        intent: null,
        resolvedContext: null,
        requiresConfirmation: false,
        confirmationPrompt: null,
        error: 'Natural language query mode requires GROQ_API_KEY or OPENAI_API_KEY.',
      },
      { status: 503 },
    );
  }

  const parsedRequest = requestSchema.safeParse(await req.json());
  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        intent: null,
        resolvedContext: null,
        requiresConfirmation: false,
        confirmationPrompt: null,
        error: parsedRequest.error.issues.map((issue) => issue.message).join('; '),
      },
      { status: 400 },
    );
  }

  try {
    const inventory = await collectClusterInventory(parsedRequest.data.context);
    const intent = await parseNaturalLanguageQuery({
      query: parsedRequest.data.query,
      inventory,
    });

    return NextResponse.json(
      resolveIntent({
        intent,
        inventory,
        context: parsedRequest.data.context,
      }),
    );
  } catch (error) {
    return NextResponse.json({
      intent: null,
      resolvedContext: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
      error: error instanceof Error ? error.message : 'Could not extract a diagnostic scope from the input.',
    });
  }
}
