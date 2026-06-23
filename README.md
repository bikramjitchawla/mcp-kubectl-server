# Kubernetes Diagnostic MCP

An enterprise-grade, read-only Kubernetes incident triage platform built with Next.js. It collects live cluster state through the official Kubernetes JavaScript client, applies deterministic diagnosis rules, and optionally generates an AI-powered incident narrative — all without ever writing to your cluster.

---

## Features

### Diagnostic coverage
| Resource | Failure modes detected |
|---|---|
| **Pods** | CrashLoopBackOff, ImagePullBackOff, OOMKilled, scheduling failures, probe failures |
| **Workloads** | Deployments, StatefulSets, DaemonSets, ReplicaSets, and Jobs not at desired state |
| **Services** | Selectors that resolve to zero ready endpoints |
| **Nodes** | NotReady, MemoryPressure, DiskPressure, PIDPressure, cordoned |
| **HPAs** | Cannot scale (AbleToScale=False), maxed out at maximum replicas |
| **PVCs** | Pending (provisioner failure), Lost (backing PV gone) |
| **CronJobs** | Suspended jobs with missed schedules |
| **Events** | Correlated warning events across all resource types |

### Enterprise capabilities
- **API key authentication** — protect `/api/*` with `X-API-Key` header; disabled automatically in dev mode
- **Rate limiting** — 20 requests per minute per IP address
- **Diagnostic run history** — last 50 runs stored in-memory, browsable from the UI sidebar
- **Cluster context switching** — select any kubeconfig context from the UI without restarting
- **Structured JSON logging** — every diagnostic run emits a log line with request ID, namespace, health, finding count, and duration
- **Partial results** — RBAC errors are recorded as collection warnings rather than failing the whole run
- **Evidence-before-AI** — deterministic findings are always produced first; AI only summarises, never invents

### API
- `POST /api/mcp` — run a diagnostic
- `GET /api/mcp` — capability manifest
- `GET /api/history` — list recent runs
- `GET /api/history/:id` — retrieve a full run by ID
- `GET /api/contexts` — list available kubeconfig contexts

---

## Quick start (local development)

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The app reads your local `~/.kube/config` and populates the context selector automatically.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_API_KEY` | No | — | When set, all `/api/*` requests must supply a matching `X-API-Key` header. Omit for local development. |
| `OPENAI_API_KEY` | No | — | Enables the AI incident narrative. Without it, the deterministic report is returned instead. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model used for narrative generation. |

---

## API reference

### `POST /api/mcp`

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \        # only required when MCP_API_KEY is set
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
      "enableAiSummary": false,
      "tailLines": 120,
      "maxPods": 60
    }
  }'
```

**`input_context` fields**

| Field | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | `default` | Kubernetes namespace to inspect |
| `context` | string | current context | Kubeconfig context (cluster) to use |
| `workload` | string | — | Filter pods and controllers by name substring |
| `labelSelector` | string | — | Standard Kubernetes label selector (e.g. `app=checkout`) |
| `includeLogs` | boolean | `true` | Collect recent logs from unhealthy pods |
| `includeNodes` | boolean | `true` | Collect node conditions (requires ClusterRole) |
| `includeHpa` | boolean | `true` | Collect HorizontalPodAutoscaler status |
| `enableAiSummary` | boolean | `true` | Generate an OpenAI incident narrative |
| `tailLines` | number | `120` | Log lines to collect per container (20–500) |
| `maxPods` | number | `60` | Maximum pods to include (1–200) |

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
    "topRisks": ["..."]
  },
  "findings": [ /* DiagnosticFinding[] */ ],
  "runbook": [ /* ordered action strings */ ],
  "output": "markdown report",
  "snapshot": { /* full raw cluster state */ },
  "metadata": { "aiStatus": "success | skipped | disabled | failed", ... }
}
```

`status: "partial"` means some Kubernetes API calls failed due to RBAC restrictions; the response still contains all findings from the data that was successfully collected.

---

## Deploying to Kubernetes (Kind cluster)

The `k8s/` directory contains production-ready manifests for the Kind cluster defined in [Kubernetes-cluster-development](../Kubernetes-cluster-development). The cluster uses Traefik as the default ingress controller and cert-manager for TLS.

### 1. Build and push the image

```bash
# Build the production image
docker build -t localhost:5001/mcp-diagnostics:latest .

# Push to the Kind local registry
docker push localhost:5001/mcp-diagnostics:latest
```

### 2. Create a secret (optional)

```bash
# Copy the example and fill in your values
cp k8s/secret.example.yaml k8s/secret.yaml

# Generate a strong API key
echo -n "$(openssl rand -hex 32)" | base64

# Edit k8s/secret.yaml with your base64-encoded values, then apply
kubectl apply -f k8s/secret.yaml
```

If you skip this step, the app runs without API key authentication and without AI narrative.

### 3. Apply all manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

### 4. Add the hosts entry

```bash
echo "127.0.0.1 k8s-diagnostic.local" | sudo tee -a /etc/hosts
```

### 5. Open the dashboard

Navigate to **https://k8s-diagnostic.local** in your browser. Accept the self-signed certificate issued by cert-manager.

> The app uses the `mcp-diagnostics` ServiceAccount, which is bound to a read-only ClusterRole covering pods, nodes, events, services, HPAs, PVCs, CronJobs, and logs. No write permissions are granted.

---

## RBAC requirements

The minimum permissions needed are listed in [k8s/rbac.yaml](k8s/rbac.yaml). When running locally, your kubeconfig user's permissions determine what the app can collect. RBAC errors are surfaced as collection warnings in `metadata.errors` rather than crashing the run.

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed breakdown of the collection, analysis, and presentation layers.

---

## Project structure

```
├── agents/
│   └── mcpAgentRunner.ts       # Orchestrates collection → analysis → AI narrative → history
├── app/
│   ├── api/
│   │   ├── mcp/route.ts        # POST /api/mcp — main diagnostic endpoint
│   │   ├── history/route.ts    # GET  /api/history
│   │   ├── history/[id]/       # GET  /api/history/:id
│   │   └── contexts/route.ts   # GET  /api/contexts
│   └── page.tsx                # Dashboard UI
├── lib/
│   ├── diagnostics/
│   │   ├── analyzer.ts         # Deterministic Kubernetes rules engine
│   │   └── formatter.ts        # Markdown report and summary builder
│   ├── kubernetes/
│   │   └── collector.ts        # Kubernetes API client and snapshot builder
│   ├── store/
│   │   └── history.ts          # In-memory run history (last 50 runs)
│   ├── ratelimit.ts            # Sliding-window rate limiter
│   └── validation.ts           # Zod request schema and normalisation
├── middleware.ts               # API key authentication
├── types/
│   └── mcp.ts                  # Full TypeScript type contract
├── k8s/                        # Kubernetes manifests for Kind cluster
│   ├── namespace.yaml
│   ├── rbac.yaml
│   ├── deployment.yaml
│   ├── ingress.yaml
│   └── secret.example.yaml
└── Dockerfile                  # Multi-stage production build
```
