# Kubernetes Diagnostic MCP

A read-only Kubernetes incident triage platform built with Next.js. It collects live cluster state through the official Kubernetes JavaScript client, runs a deterministic rules engine to surface findings, and optionally generates an AI-powered incident narrative — all without ever writing to your cluster.

---

## Features

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

The AI narrative is rendered as formatted markdown in the Report section. The LLM is instructed not to invent resources, commands, or causes — it can only explain and prioritise what the deterministic engine already found. The tool is fully functional without any LLM key.

**LLM priority:** Groq (`llama-3.3-70b-versatile`) is used when `GROQ_API_KEY` is set; OpenAI (`gpt-4o-mini`) is the fallback.

### UI

- **Form / Query toggle** — switch between structured form input and natural language query mode; preference is persisted in `localStorage`
- **Namespace dropdown** — auto-populated from the live cluster; falls back to a text input when the cluster is unreachable
- **Workload dropdown** — refreshes automatically when the namespace changes
- **Cluster context selector** — switch between kubeconfig contexts without restarting
- **Diagnostic run history** — last 50 runs shown in the sidebar; click any entry to reload its full result
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
| `GET` | `/api/health` | Health check (no cluster access, used by k8s probes) |

### Enterprise capabilities

- **API key authentication** — protect `/api/*` with `X-API-Key` header; health endpoint is always unauthenticated
- **Rate limiting** — 20 requests per minute per IP
- **Partial results** — RBAC errors are recorded as collection warnings rather than failing the whole run
- **Evidence-before-AI** — deterministic findings always run first; AI only summarises, never invents
- **Kubernetes-ready** — liveness and readiness probes on `/api/health`, `allowPrivilegeEscalation: false`, no root container

---

## Quick start (local development)

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The app reads your local `~/.kube/config` and populates the context selector automatically.

To enable AI narrative, add to `.env.local`:

```bash
GROQ_API_KEY=your-groq-key          # preferred
# or
OPENAI_API_KEY=your-openai-key      # fallback
```

---

## Testing

```bash
npm run test          # run all unit tests
npm run test:watch    # watch mode
npm run typecheck     # TypeScript type check
```

The test suite covers all 14 diagnostic categories and the NLQ resolver without requiring a kubeconfig or LLM key.

---

## Deploying to a Kind cluster

### Prerequisites

| Tool | Purpose |
|---|---|
| [Docker](https://www.docker.com/) | Kind runs nodes as containers |
| [Kind](https://kind.sigs.k8s.io/) | Local Kubernetes cluster |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | Cluster CLI |
| [Skaffold](https://skaffold.dev/) | Build + deploy |
| [Helm](https://helm.sh/) | Installs Traefik and cert-manager |

### 1. Spin up the cluster

Use the companion cluster repository which sets up Kind with Calico CNI, MetalLB, cert-manager, Traefik ingress, and a local Docker registry:

```bash
git clone https://github.com/bikramjitchawla/Kubernetes-cluster-development.git
cd Kubernetes-cluster-development
./start.sh
```

The script creates the cluster, starts a local Docker registry at `localhost:5001`, and installs all components. Takes 3–5 minutes on first run.

### 2. Create the secret

```bash
cp k8s/secret.example.yaml k8s/secret.yaml
# edit k8s/secret.yaml with your base64-encoded values
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
```

If you skip this step the app runs without API key auth and without AI narrative.

### 3. Deploy with Skaffold

```bash
skaffold run
```

Builds the image, pushes it to the local registry, and applies all manifests. The app is available at:

```
https://mcp-diagnostics.127.0.0.1.nip.io
```

Accept the self-signed cert issued by cert-manager. No `/etc/hosts` entry is needed — nip.io resolves `*.127.0.0.1.nip.io` to `127.0.0.1` via public DNS.

### 4. Tear down

```bash
skaffold delete
cd Kubernetes-cluster-development
./delete.sh
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_API_KEY` | No | — | When set, all `/api/*` requests (except `/api/health`) must supply a matching `X-API-Key` header |
| `GROQ_API_KEY` | No | — | Enables AI narrative via Groq (preferred over OpenAI) |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | Groq model for narrative and NLQ parsing |
| `OPENAI_API_KEY` | No | — | Enables AI narrative via OpenAI (used when no Groq key is set) |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model |
| `APP_VERSION` | No | `0.1.0` | Reported by the health endpoint |
| `BUILD_ID` | No | `local` | Reported by the health endpoint |

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
      "namespace": "production",
      "workload": "checkout",
      "context": "kind-test-cluster",
      "includeLogs": true,
      "includeNodes": true,
      "includeHpa": true,
      "enableAiSummary": true,
      "tailLines": 120,
      "maxPods": 60
    }
  }'
```

**`input_context` fields**

| Field | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | `default` | Namespace to inspect |
| `context` | string | current | Kubeconfig context |
| `workload` | string | — | Filter by workload name |
| `labelSelector` | string | — | Standard label selector e.g. `app=checkout` |
| `includeLogs` | boolean | `true` | Collect logs from unhealthy pods |
| `includeNodes` | boolean | `true` | Collect node conditions (requires ClusterRole) |
| `includeHpa` | boolean | `true` | Collect HPA status |
| `enableAiSummary` | boolean | `true` | Generate AI narrative |
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
      "resource": { "kind": "Pod", "namespace": "production", "name": "checkout-0" },
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
  "intent": { "namespace": "production", "workload": "checkout", "focus": ["pods", "logs"], "confidence": "high", ... },
  "resolvedContext": { "namespace": "production", "workload": "checkout", "includeLogs": true, ... },
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
│   │   └── history.ts              # In-memory run history (last 50 runs)
│   ├── ratelimit.ts                # Sliding-window rate limiter
│   └── validation.ts               # Zod request schema and normalisation
├── middleware.ts                   # API key authentication
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

The minimum permissions are in [k8s/rbac.yaml](k8s/rbac.yaml). The app uses a dedicated `mcp-diagnostics` ServiceAccount with a read-only ClusterRole covering pods, nodes, events, services, endpoints, HPAs, PVCs, CronJobs, and logs. No write permissions are granted at any level.

When running locally, your kubeconfig user's permissions apply. RBAC errors are surfaced as collection warnings in `metadata.errors` rather than crashing the run.
