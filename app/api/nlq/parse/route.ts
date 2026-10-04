import { requirePrincipal, AccessDenied } from '@/lib/tenancy/context';
import { readJson } from '@/lib/http/json';
import { protectedRoute } from '@/lib/auth/guard';
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

async function handleGET() {
  return NextResponse.json({
    enabled: hasLlmClient() && requirePrincipal().tenant.allowAi,
    requires: hasLlmClient() ? [] : ['GROQ_API_KEY', 'OPENAI_API_KEY'],
  });
}

async function handlePOST(req: NextRequest) {
  if (!requirePrincipal().tenant.allowAi) throw new AccessDenied('AI processing is disabled for this tenant.');
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

  const parsedRequest = requestSchema.safeParse(await readJson(req));
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

    intent.includeNodes = intent.includeNodes && requirePrincipal().tenant.allowNodes;
    return NextResponse.json(
      resolveIntent({
        intent,
        inventory,
        context: requirePrincipal().tenant.context,
      }),
    );
  } catch (error) {
    return NextResponse.json({
      intent: null,
      resolvedContext: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
      error: 'Could not extract a diagnostic scope. Check tenant cluster access and provider availability.',
    }, { status: 502 });
  }
}

export const GET = protectedRoute('viewer', handleGET);

export const POST = protectedRoute('operator', handlePOST);
