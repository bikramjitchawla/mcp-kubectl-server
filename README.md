# Kubernetes Diagnostic MCP

A Next.js based diagnostic console and API for read-only Kubernetes incident triage.

## What It Does

- Accepts an MCP-style JSON request at `/api/mcp`.
- Collects namespace-scoped Kubernetes state through `@kubernetes/client-node`.
- Diagnoses common platform issues with deterministic rules.
- Optionally uses OpenAI to turn the findings into an incident-ready narrative.
- Presents findings, evidence, impact, recommended actions, and read-only automation commands.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app uses your local kubeconfig by default. When deployed inside Kubernetes, it uses the pod service account.

## Environment

```bash
OPENAI_API_KEY=optional
OPENAI_MODEL=gpt-4o-mini
```

If `OPENAI_API_KEY` is missing, the app still returns the deterministic diagnostic report.

## API Example

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "kubernetes-diagnoser",
    "goal": "Find why checkout is failing",
    "input_context": {
      "namespace": "default",
      "workload": "checkout",
      "includeLogs": true,
      "enableAiSummary": true
    }
  }'
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
