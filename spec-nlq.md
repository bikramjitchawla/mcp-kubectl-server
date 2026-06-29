# Natural Language Diagnostic Queries — Feature Spec

## Purpose

Allow engineers to describe an incident in plain English instead of filling in form fields. The LLM extracts diagnostic intent from the description, resolves it to concrete Kubernetes parameters, and runs the existing deterministic diagnostic pipeline unchanged. The LLM never generates findings — it only translates input.

## Problem Statement

The current form requires the engineer to already know:
- the exact namespace the workload lives in
- the exact workload name
- which label selector applies
- which toggles to enable

During an active incident, engineers often know the symptom but not the scope. Natural language input lets them start with what they observe, not what they know.

## Guiding Principle

**The LLM translates intent into parameters. The deterministic engine produces findings. These two responsibilities must never merge.**

The LLM output from this feature is a validated `input_context` object — not findings, not commands, not explanations. If the LLM hallucinates a namespace that does not exist, parameter validation catches it before any cluster call is made.

---

## User Stories

1. **Incident start** — An engineer types: *"checkout is returning 503s since the last deploy"* and gets a full diagnostic run scoped to the checkout workload in the right namespace without touching any form field.

2. **Unfamiliar namespace** — An SRE new to the cluster types: *"the payment worker pods keep restarting"* and gets the correct namespace inferred, with a confirmation step before running.

3. **Node-level concern** — An engineer types: *"nodes seem to be under memory pressure"* and gets a diagnostic run with `includeNodes: true` and the `node` focus automatically set.

4. **Ambiguous scope** — An engineer types: *"api service is down"* and there are three namespaces containing workloads named `api`. The system asks which one before running, rather than guessing.

5. **Refinement** — After seeing results, the engineer types: *"now check just the database pods"* and the assistant updates the scope and re-runs without a full re-entry of the form.

---

## Architecture

### Current flow

```
Form fields → input_context → /api/mcp → collector → analyzer → formatter → LLM summary
```

### New flow

```
Natural language input
        ↓
  NLQ parser (LLM)
        ↓
  Extracted intent object
        ↓
  Parameter resolver (deterministic)
  - validates namespace exists
  - validates workload exists in namespace
  - fills defaults for missing fields
        ↓
  Confirmation step (if confidence < high or scope ambiguous)
        ↓
  input_context → existing /api/mcp pipeline (unchanged)
```

The NLQ parser is a **separate API call** isolated from the diagnostic pipeline. The diagnostic pipeline does not know or care how `input_context` was produced.

---

## Intent Extraction Schema

The NLQ parser returns a structured object. This is the contract between the LLM and the resolver — it must be validated with a JSON schema, not trusted as free text.

```typescript
interface ExtractedIntent {
  namespace?: string;          // exact name or null if unknown
  workload?: string;           // workload name or null
  labelSelector?: string;      // key=value selector or null
  focus: DiagnosticFocus[];    // what the user cares about
  symptoms: string[];          // plain-text symptom list, for the summary prompt
  includeNodes: boolean;       // true if user mentions nodes/infrastructure
  includeLogs: boolean;        // true if user mentions logs/output/crashes
  enableAiSummary: boolean;    // always true for NLQ path
  confidence: 'low' | 'medium' | 'high'; // how sure the LLM is
  ambiguities: string[];       // questions to ask the user if confidence < high
  timeHint?: string;           // e.g. "since last deploy", "past 30 minutes"
}

type DiagnosticFocus =
  | 'pods'
  | 'workload-availability'
  | 'service-endpoints'
  | 'scheduling'
  | 'node-health'
  | 'resource-pressure'
  | 'image-pull'
  | 'storage'
  | 'events'
  | 'logs';
```

### LLM prompt contract

The NLQ parser prompt must:
- list all known namespaces and workload names (fetched before the LLM call)
- instruct the model to match names exactly, never invent names not in the list
- instruct the model to set `confidence: "low"` and populate `ambiguities` when the input is under-specified
- return only the JSON schema above — no prose, no explanation
- use temperature 0 for determinism

---

## API Design

### New endpoint: `POST /api/nlq/parse`

Parses natural language and returns a resolved `input_context`.

**Request**
```json
{
  "query": "checkout pods keep crashing since the last deploy",
  "context": "prod-cluster"
}
```

**Response (success)**
```json
{
  "intent": { ...ExtractedIntent },
  "resolvedContext": { ...input_context },
  "requiresConfirmation": false,
  "confirmationPrompt": null
}
```

**Response (ambiguous)**
```json
{
  "intent": { ...ExtractedIntent },
  "resolvedContext": null,
  "requiresConfirmation": true,
  "confirmationPrompt": "Found 'checkout' in 3 namespaces: production, staging, dev. Which one?"
}
```

**Response (parse failure)**
```json
{
  "intent": null,
  "resolvedContext": null,
  "requiresConfirmation": false,
  "error": "Could not extract a diagnostic scope from the input."
}
```

### Authentication

`/api/nlq/parse` follows the same `MCP_API_KEY` middleware as all other API routes. No new auth surface.

### No new diagnostic endpoint

After confirmation, the UI calls the existing `POST /api/mcp` with the resolved `resolvedContext`. The NLQ path does not bypass or duplicate the diagnostic pipeline.

---

## Parameter Resolution Rules

These rules run deterministically after the LLM returns, before any cluster call:

| Condition | Action |
|---|---|
| `namespace` not in known namespace list | Set `confidence: "low"`, add to `ambiguities` |
| `workload` not found in extracted namespace | Set `confidence: "low"`, add to `ambiguities` |
| `namespace` null and only one namespace in cluster | Use that namespace, log assumption |
| `namespace` null and multiple namespaces | Add to `ambiguities`, set `requiresConfirmation: true` |
| `workload` null | Leave null (scan all workloads in namespace) |
| `focus` includes `node-health` | Set `includeNodes: true` |
| `focus` includes `logs` or `crashes` or `restarts` | Set `includeLogs: true` |
| Any `ambiguities` present | Set `requiresConfirmation: true` |

Validation uses the same `/api/namespaces` and `/api/workloads` endpoints already present — no new cluster calls.

---

## UI Design

### Query mode toggle

The sidebar gains a toggle between **Form mode** (current behavior) and **Query mode** (new). The toggle persists in `localStorage`.

### Query mode layout

Replace the namespace / workload / label selector fields with a single textarea:

```
┌─────────────────────────────────────────────────────┐
│  Describe the incident                              │
│  ┌─────────────────────────────────────────────────┐│
│  │ checkout pods keep crashing since last deploy   ││
│  └─────────────────────────────────────────────────┘│
│                                        [ Diagnose ] │
└─────────────────────────────────────────────────────┘
```

Keep the existing toggles (include logs, include nodes, AI narrative) below the textarea — they act as overrides and remain editable after intent extraction.

### Resolved parameters display

After the LLM parses intent but before running diagnostics, show the resolved parameters inline so the engineer can verify or correct them:

```
┌──────────────────────────────────────────────────┐
│  Interpreted as:                                 │
│  Namespace:  production                          │
│  Workload:   checkout                            │
│  Focus:      pods, service-endpoints, events     │
│  Logs:       yes                                 │
│                          [ Confirm ] [ Edit ]    │
└──────────────────────────────────────────────────┘
```

"Edit" switches to form mode with the resolved values pre-filled. "Confirm" runs the diagnostic.

### Clarification dialog

When `requiresConfirmation: true`, show a single inline prompt rather than a modal:

```
┌──────────────────────────────────────────────────────────┐
│  Found 'checkout' in 3 namespaces:                      │
│  ○ production   ○ staging   ○ dev                        │
└──────────────────────────────────────────────────────────┘
```

Selecting one resolves the ambiguity and proceeds to the confirmation step.

### Error states

| Scenario | UI behavior |
|---|---|
| NLQ parse fails | Show inline error, keep textarea editable, suggest switching to form mode |
| No LLM key configured | Disable query mode, show tooltip: "Requires GROQ_API_KEY or OPENAI_API_KEY" |
| Resolved namespace not found | Show error, prompt to correct or switch to form mode |
| Network error | Show retry button |

---

## Multi-Turn Follow-up (Phase 2)

The initial implementation is single-turn: one query → one diagnostic run. Phase 2 adds follow-up:

After a successful run the query textarea remains active. Follow-up queries are sent with the previous `input_context` and top findings as context:

```
User: "now focus on just the database pods"
System: updates workload filter → re-runs diagnostic
```

Follow-up context window:
```json
{
  "previousNamespace": "production",
  "previousWorkload": "checkout",
  "topFindings": ["CrashLoopBackOff on checkout-db-0", "PVC pending"],
  "query": "now focus on just the database pods"
}
```

This is deferred to Phase 2 because it requires conversation state management that doesn't exist yet.

---

## Implementation Phases

### Phase A: Backend parser (no UI)

**Deliverables**
- `POST /api/nlq/parse` endpoint
- `lib/nlq/parser.ts` — LLM call, prompt, schema validation
- `lib/nlq/resolver.ts` — deterministic parameter validation
- `lib/nlq/types.ts` — `ExtractedIntent`, `NLQResponse` types
- Unit tests for resolver (no LLM dependency — test with fixture intent objects)

**Not included:** UI changes, multi-turn.

**Acceptance criteria**
- Parser returns valid `input_context` for unambiguous queries against a fixture namespace/workload list
- Parser returns `requiresConfirmation: true` when multiple namespaces match
- Parser returns `error` when input is unparseable
- Resolver rejects namespaces not in the provided list
- Unit tests pass without `GROQ_API_KEY`

### Phase B: UI integration

**Deliverables**
- Form/Query toggle in sidebar
- Query textarea with character limit (500 chars)
- Resolved parameters confirmation panel
- Clarification selector for ambiguous results
- Graceful degradation when no LLM key is configured

**Acceptance criteria**
- Query mode is hidden / disabled without a configured LLM key
- Confirmed parameters visually match what `/api/mcp` will receive
- Form mode values are preserved when switching modes
- Switching to form mode after NLQ pre-fills the resolved values
- Existing form mode behavior is unchanged

### Phase C: Multi-turn follow-up

**Deliverables**
- Conversation state (previous run's scope + top findings)
- Follow-up query context passed to parser
- "Follow up" or "Refine" UI affordance after a completed run
- Clear conversation / start fresh action

**Acceptance criteria**
- Follow-up query can narrow workload without re-entering namespace
- Follow-up query can widen scope (e.g., "check all namespaces")
- Conversation state clears on page refresh or explicit reset

---

## File Structure

```
lib/
  nlq/
    types.ts          — ExtractedIntent, NLQResponse
    parser.ts         — LLM call, prompt template, response validation
    resolver.ts       — deterministic validation against live namespace/workload lists
    prompt.ts         — prompt construction helpers
    __tests__/
      resolver.test.ts
      parser.test.ts  — uses fixture responses, no real LLM call

app/
  api/
    nlq/
      parse/
        route.ts      — POST /api/nlq/parse

app/
  page.tsx            — toggle, textarea, confirmation panel (Phase B)
  components/
    QueryInput.tsx    — query textarea + submit
    IntentConfirm.tsx — resolved parameters display + confirm/edit buttons
    Disambiguate.tsx  — clarification selector
```

---

## Safety Constraints

- The LLM output from `parser.ts` is never used as diagnostic evidence or findings text.
- `resolvedContext` is validated against a whitelist of known namespaces and workloads before any cluster call.
- Symptoms extracted by the LLM are only passed to the LLM summarizer as `focusHint` — they do not affect which Kubernetes resources are queried.
- The existing `requiresApproval` and `destructive` constraints on automation commands are not changed.
- Query mode does not expose any new write path or bypass any existing auth.

---

## Out of Scope

- Voice input.
- Executing kubectl commands from the assistant.
- Connecting to external incident management tools (PagerDuty, Slack, Jira) — covered in Phase 5 of the main spec.
- Storing conversation history across sessions — covered in Phase 7 of the main spec.
- Fine-tuning a model on cluster-specific terminology.
- Replacing form mode — both modes must coexist.
