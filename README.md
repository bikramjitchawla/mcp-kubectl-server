# Kubernetes Diagnostic MCP

A read-only Kubernetes incident triage platform built with Next.js. It collects live cluster state through the official Kubernetes JavaScript client, runs a deterministic rules engine to surface findings, and optionally generates an AI-powered incident narrative — all without ever writing to your cluster.

**Install:** [Self-hosting, OIDC/Keycloak, tenant isolation and Helm](docs/SELF-HOSTING.md).

This version requires explicit tenant configuration and authenticated access. It does not use ambient cluster credentials or automatically import legacy shared history.

---

## Features

### Investigation and recovery workflows

- **What changed?** — compare scoped snapshots for deployment revisions, images, resource settings, configuration fingerprints, service routing changes, and optional Prometheus CPU/memory evidence. Correlations are labeled as hypotheses.
- **Related incidents** — group findings using owner references, service selectors, unhealthy node placement, and failing PVC dependencies, with evidence for each link.
- **Fix and verify** — propose supported Deployment reversions to an observed healthy baseline, preview a pinned GitOps manifest change, create a reviewed GitHub PR, and verify sustained recovery after merge.
- **Persistent history** — atomic disk storage, with baseline and verification evidence retained for fix workflows.

See [Investigation workflow setup and limitations](docs/INVESTIGATION-WORKFLOWS.md) for GitHub targets, optional Prometheus, persistent storage, API examples, and the recovery contract.


### Diagnostic coverage

| Resource | Failure modes detected |
|---|---|
| **Pods** | CrashLoopBackOff, ImagePullBackOff, OOMKilled, scheduling failures, probe failures |
| **Workloads** | Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs not at desired state |
| **Services** | Selectors that resolve to zero ready endpoints |
| **Nodes** | NotReady, MemoryPressure, DiskPressure, PIDPressure, cordoned |
| **HPAs** | Cannot scale (AbleToScale=False), maxed at max replicas |
| **PVCs** | Pending (provisioner failure), Lost (backing PV gone) |
| **CronJobs** | Suspended jobs with missed schedules |
| **Events** | Correlated warning events across all resource types |

### Structured risk and impact model

Every finding carries two structured assessments in addition to the plain-text description:

- **`ImpactAssessment`** — scope (pod / workload / service / namespace / node / cluster), affected resource references, affected replica counts, whether the issue is user-facing, and a summary sentence
- **`RiskAssessment`** — risk level, confidence, blast radius, risk if ignored, risk if remediated, and the reasons behind the assessment

This model powers the top-risks list in the summary and lets the UI show structured context without parsing markdown.

### Natural language query mode

Engineers can describe an incident in plain English instead of filling in form fields:

> *"checkout pods keep crashing since the last deploy"*

The LLM extracts diagnostic intent (namespace, workload, focus areas, symptoms) from the description, validates it against live cluster inventory, and resolves it to a concrete `DiagnosticScope`. The deterministic engine then runs unchanged — the LLM only translates input, never generates findings.

Key behaviours:
- **Disambiguation** — when a workload exists in multiple namespaces, a clarification panel lets the engineer pick before running
- **Namespace inference** — when a workload name uniquely identifies a namespace, it is inferred automatically (with a confirmation step)
- **Safety gate** — the resolver validates extracted namespace and workload names against the actual cluster before any diagnostic call
- **Edit fallback** — the "Edit" button pre-fills form mode with the resolved values so engineers can correct the interpretation
- **Graceful degradation** — Query mode is disabled automatically when no LLM key is configured

### AI incident narrative

When `GROQ_API_KEY` or `OPENAI_API_KEY` is set and AI summary is enabled, the deterministic findings and markdown report are passed to an LLM which produces:

- Executive summary
- Likely root cause with evidence citations
- Next actions
- Read-only automation commands

The deterministic report returns first; the dashboard requests the optional narrative separately so provider latency does not delay the evidence. The AI narrative is rendered as formatted markdown in the Report section. The LLM is instructed not to invent resources, commands, or causes — it can only explain and prioritise what the deterministic engine already found. The tool is fully functional without any LLM key.

**LLM priority:** Groq (`llama-3.3-70b-versatile`) is used when `GROQ_API_KEY` is set; OpenAI (`gpt-4o-mini`) is the fallback.

### UI

- **Form / Query toggle** — switch between structured form input and natural language query mode; preference is persisted in `localStorage`
- **Namespace dropdown** — auto-populated from the live cluster; falls back to a text input when the cluster is unreachable
- **Workload dropdown** — refreshes automatically when the namespace changes
- **Cluster context selector** — switch between kubeconfig contexts without restarting
- **Diagnostic run history** — recent persisted runs shown in the sidebar; click any entry to reload its full result
- **Metric tiles** — pod count, unhealthy pods, warning events, node health, PVC health, AI status
- **Findings panel** — top 6 findings with severity badge, evidence list, and read-only commands
- **Rendered markdown report** — the AI narrative or deterministic report is rendered with headings, code blocks, tables, and lists

### API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/mcp` | Run a diagnostic |
| `GET` | `/api/mcp` | Capability manifest |
| `POST` | `/api/nlq/parse` | Parse a natural language query into a `DiagnosticScope` |
| `GET` | `/api/nlq/parse` | Check whether NLQ mode is available |
| `GET` | `/api/namespaces` | List cluster namespaces |
| `GET` | `/api/workloads?namespace=` | List workloads in a namespace |
| `GET` | `/api/contexts` | List kubeconfig contexts |
| `GET` | `/api/history` | List recent diagnostic runs |
| `GET` | `/api/history/:id` | Retrieve a full run by ID |
| `POST` | `/api/history/:id/narrative` | Generate optional AI narrative for saved evidence |
| `GET` | `/api/health` | Health check (no cluster access, used by k8s probes) |

### Authentication and isolation

- Generic OIDC sign-in with a Keycloak setup guide; authorization code, PKCE, state, nonce and signed ID-token validation.
- Tenant workspaces with viewer/operator/admin roles, separate Kubernetes credentials and namespace allowlists.
- Tenant-partitioned history, baselines, fix plans and integration configuration.
- Tenant API keys for automation; no shared global key or anonymous access.
- Per-identity and per-tenant rate limits, bounded concurrent collection, paginated Kubernetes reads and deadlines.
- Non-root Helm deployment with a PVC, read-only credential mounts, ingress policy and separate readiness/liveness checks.

## Install or develop

Follow [the installation guide](docs/SELF-HOSTING.md) to provision tenant credentials, configure your OIDC provider, create Secrets, and install the bundled Helm chart. The source repository is the download; build an image in your own registry. No release or image is published automatically.

For local development, configure `APP_URL=http://localhost:3000` and `TENANTS_CONFIG_FILE` in `.env.local`, with explicit tenant kubeconfigs and either OIDC or a tenant API key, then run:

```sh
npm ci
npm run dev
```

## Validation

```sh
npm test
npm run typecheck
npm run build
```

Tests cover deterministic diagnostics, tenant isolation, authentication/CSRF/roles, signed OIDC token validation, workload ownership, bounded collection and reviewed recovery workflows. CI also checks the container build, production dependency audit and Helm chart.

## Environment variables

| Variable | Purpose |
|---|---|
| `APP_URL` | Canonical application origin; HTTPS required in production |
| `TENANTS_CONFIG_FILE` | Required administrator-managed tenant JSON configuration |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Browser sign-in provider configuration |
| `OIDC_GROUPS_CLAIM` | Top-level ID-token array claim; defaults to `groups` |
| `OIDC_SCOPES` | Defaults to `openid profile email` |
| `DIAGNOSTICS_DATA_DIR` | Persistent tenant records and server-side sessions; defaults to `.data` |
| `DIAGNOSTICS_HISTORY_LIMIT` | Unpinned history retention per tenant; default 200, maximum 2,000 |
| `GROQ_API_KEY`, `GROQ_MODEL` | Optional AI provider; requires tenant `allowAi` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional fallback AI provider; requires tenant `allowAi` |
| `APP_VERSION`, `BUILD_ID` | Health endpoint metadata |

GitHub and Prometheus credentials/targets are configured per tenant. See [integration configuration](docs/SELF-HOSTING.md#optional-integrations).

---

## API reference

### `POST /api/mcp`

```bash
curl -X POST https://mcp-diagnostics.127.0.0.1.nip.io/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "agent": "kubernetes-diagnoser",
    "goal": "Find why checkout is failing",
    "input_context": {
      "namespace": "team-a",
      "workload": "checkout",
      "context": "team-a",
      "includeLogs": true,
      "includeNodes": false,
      "includeHpa": true,
      "enableAiSummary": false,
      "tailLines": 120,
      "maxPods": 60
    }
  }'
```

**`input_context` fields**

| Field | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | `default` | Namespace to inspect |
| `context` | string | tenant context | Must match the configured tenant cluster |
| `workload` | string | — | Filter by workload name |
| `labelSelector` | string | — | Standard label selector e.g. `app=checkout` |
| `includeLogs` | boolean | `true` | Collect logs from unhealthy pods |
| `includeNodes` | boolean | `false` | Collect node conditions (requires ClusterRole) |
| `includeHpa` | boolean | `true` | Collect HPA status |
| `enableAiSummary` | boolean | `false` | Generate AI narrative |
| `tailLines` | number | `120` | Log lines per container (20–500) |
| `maxPods` | number | `60` | Max pods to collect (1–200) |

**Response shape**

```jsonc
{
  "requestId": "uuid",
  "status": "ok | partial | failed",
  "generatedAt": "ISO-8601",
  "summary": {
    "health": "healthy | degraded | critical",
    "totalPods": 12,
    "unhealthyPods": 2,
    "notReadyNodes": 0,
    "pendingPvcs": 1,
    "warningEvents": 5,
    "criticalFindings": 0,
    "highFindings": 2,
    "topRisks": ["[HIGH] checkout is crash-looping: pod will not recover without a fix"]
  },
  "findings": [
    {
      "id": "pod-production-checkout-0-crashloop",
      "severity": "critical",
      "category": "runtime",
      "title": "Container app is in CrashLoopBackOff",
      "resource": { "kind": "Pod", "namespace": "team-a", "name": "checkout-0" },
      "signal": "CrashLoopBackOff",
      "evidence": ["Restart count: 10", "Last exit code: 1"],
      "impact": "Pod is not serving traffic.",
      "recommendedActions": ["Check logs for the root cause", "..."],
      "automation": [{ "command": "kubectl logs ...", "destructive": false, "requiresApproval": false }],
      "impactAssessment": { "scope": "workload", "userFacing": true, "summary": "..." },
      "riskAssessment": { "level": "critical", "confidence": "high", "riskIfIgnored": "...", "blastRadius": "workload", "reasons": ["..."] }
    }
  ],
  "runbook": ["Step 1...", "Step 2..."],
  "output": "# Kubernetes Diagnostic Report\n...",
  "snapshot": { /* full raw cluster state */ },
  "metadata": { "aiStatus": "success | skipped | disabled | failed", "model": "llama-3.3-70b-versatile" }
}
```

### `POST /api/nlq/parse`

Parses a natural language incident description into a validated `DiagnosticScope`.

```bash
curl -X POST https://mcp-diagnostics.127.0.0.1.nip.io/api/nlq/parse \
  -H "Content-Type: application/json" \
  -d '{ "query": "checkout pods keep crashing since last deploy", "context": "kind-test-cluster" }'
```

**Response (resolved)**

```jsonc
{
  "intent": { "namespace": "team-a", "workload": "checkout", "focus": ["pods", "logs"], "confidence": "high", ... },
  "resolvedContext": { "namespace": "team-a", "workload": "checkout", "includeLogs": true, ... },
  "requiresConfirmation": false,
  "confirmationPrompt": null
}
```

**Response (ambiguous)**

```jsonc
{
  "intent": { ... },
  "resolvedContext": null,
  "requiresConfirmation": true,
  "confirmationPrompt": "Found 'checkout' in 2 namespaces: production, staging.",
  "clarificationOptions": {
    "field": "namespace",
    "prompt": "Choose a namespace for \"checkout\".",
    "options": [
      { "label": "production", "value": "production", "resolvedContext": { ... } },
      { "label": "staging", "value": "staging", "resolvedContext": { ... } }
    ]
  }
}
```

Returns `503` when no LLM key is configured. Call `GET /api/nlq/parse` first to check availability.

---

## Project structure

```
├── agents/
│   └── mcpAgentRunner.ts           # Orchestrates collection → analysis → AI → history
├── app/
│   ├── api/
│   │   ├── mcp/route.ts            # POST /api/mcp
│   │   ├── nlq/parse/route.ts      # POST /api/nlq/parse, GET /api/nlq/parse
│   │   ├── namespaces/route.ts     # GET  /api/namespaces
│   │   ├── workloads/route.ts      # GET  /api/workloads
│   │   ├── history/route.ts        # GET  /api/history
│   │   ├── history/[id]/route.ts   # GET  /api/history/:id
│   │   ├── contexts/route.ts       # GET  /api/contexts
│   │   └── health/route.ts         # GET  /api/health
│   └── page.tsx                    # Dashboard UI (form + query modes)
├── lib/
│   ├── diagnostics/
│   │   ├── analyzer.ts             # Deterministic Kubernetes rules engine
│   │   ├── formatter.ts            # Markdown report and summary builder
│   │   └── __tests__/
│   │       └── analyzer.test.ts    # 27 unit tests, no kubeconfig needed
│   ├── nlq/
│   │   ├── types.ts                # ExtractedIntent, NLQParseResponse, ClusterInventory
│   │   ├── parser.ts               # LLM call + Zod schema validation
│   │   ├── resolver.ts             # Deterministic parameter validation
│   │   ├── prompt.ts               # Prompt construction
│   │   ├── inventory.ts            # Cluster namespace + workload fetcher
│   │   └── __tests__/
│   │       ├── parser.test.ts      # JSON parsing and schema validation
│   │       └── resolver.test.ts    # Resolution logic, no LLM needed
│   ├── llm/
│   │   └── client.ts               # Groq → OpenAI client builder
│   ├── kubernetes/
│   │   └── collector.ts            # Kubernetes API client and snapshot builder
│   ├── store/
│   │   └── history.ts              # Persistent run history and baseline selection
│   ├── ratelimit.ts                # Bounded fixed-window rate limiter
│   └── validation.ts               # Zod request schema and normalisation
├── lib/auth/                       # OIDC, server sessions and route authorization
├── lib/tenancy/                    # Identity bindings, roles and scope authorization
├── deploy/helm/                    # Supported self-hosted installation
├── types/
│   └── mcp.ts                      # Full TypeScript type contract
├── k8s/                            # Kubernetes manifests
│   ├── namespace.yaml
│   ├── rbac.yaml
│   ├── deployment.yaml
│   ├── ingress.yaml
│   └── secret.example.yaml
├── vitest.config.ts                # Test configuration
└── Dockerfile                      # Multi-stage production build
```

---

## RBAC requirements

Each tenant uses a dedicated read-only credential restricted to its configured namespaces. Start from [the namespace Role/RoleBinding example](deploy/examples/tenant-rbac.yaml). The application service account has no cluster-wide permissions and no automatically mounted token. Node access requires an explicit tenant capability and additional cluster-level permission.

See [the self-hosting guide](docs/SELF-HOSTING.md) for credential rotation, isolation checks, storage limits, migration from shared history, and the shared-hosted roadmap.
