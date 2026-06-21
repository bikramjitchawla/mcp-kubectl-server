# Enterprise Kubernetes Diagnostic MCP Architecture

## Current Project Context

The original project was a small Next.js proof of concept. It accepted a JSON request at `/api/mcp`, executed `kubectl get pods` and `kubectl describe pod` through a shell, then sent the raw output to OpenAI. That proved the idea, but it was not ready for company use because it had no schema validation, no RBAC-aware Kubernetes API client, no deterministic diagnosis, no structured response contract, and no operational UI.

## Target Architecture

This rewrite keeps the developer-friendly Next.js shape and separates the system into clear layers:

1. **Request contract**: `types/mcp.ts` and `lib/validation.ts` define a typed request/response contract and validate incoming JSON with Zod.
2. **Collection layer**: `lib/kubernetes/collector.ts` uses the official Kubernetes JavaScript client. It reads pods, controllers, services, endpoints, events, and logs through kubeconfig or in-cluster identity.
3. **Analysis layer**: `lib/diagnostics/analyzer.ts` applies deterministic Kubernetes rules for the failure modes platform teams see every day: CrashLoopBackOff, ImagePullBackOff, scheduling failures, OOMKilled, probe failures, unavailable controllers, failed jobs, and services without endpoints.
4. **Narrative layer**: `agents/mcpAgentRunner.ts` optionally asks OpenAI for an incident-ready summary, but only after deterministic evidence has been collected. The tool still works without an API key.
5. **Presentation layer**: `app/page.tsx` provides a console for engineers to choose namespace, workload, labels, logs, and AI narrative settings.

## Enterprise Principles

- **Read-only by default**: the collector only uses read APIs and generated commands are marked as non-destructive. Future remediation execution should require explicit approval and audit logging.
- **Evidence before AI**: the analyzer produces findings from Kubernetes state before any model is called. AI is used to summarize, not to invent root causes.
- **Least privilege compatible**: namespace-scoped reads are enough for the default path. RBAC gaps are returned as collection warnings instead of crashing the run.
- **Operationally useful output**: every finding includes severity, impact, evidence, recommended actions, and read-only commands that platform engineers can run or automate.
- **Extensible diagnosis rules**: add new detectors in `lib/diagnostics/analyzer.ts` for ingress, PVCs, autoscaling, node pressure, service mesh, policy engines, or cloud-provider signals.

## Recommended Company Roadmap

1. Add authentication and tenant/cluster authorization before exposing this beyond local development.
2. Persist diagnostic runs with request metadata, findings, and redacted logs for incident review.
3. Add approved remediation workflows such as rollout restart, scale down, rollback, or cordon/drain behind policy checks.
4. Integrate Prometheus, Loki, Argo CD, GitHub Actions, and cloud provider APIs to correlate symptoms with deployments and infrastructure events.
5. Package a true MCP server transport for AI clients while keeping the Next.js dashboard as the human-facing console.
