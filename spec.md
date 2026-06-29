# Kubernetes Cluster Assistant Evolution Spec

## Purpose

Evolve the current Kubernetes Diagnostic MCP from a one-shot diagnostic dashboard/API into a chat-oriented Kubernetes cluster assistant that helps engineers debug incidents, assess operational risk, and understand impact before taking action.

The assistant must remain evidence-first: deterministic Kubernetes facts are collected and analyzed before any AI narrative is generated. AI may explain, summarize, and prioritize, but it must not invent resources, causes, or commands that are not supported by collected evidence.

## Current Baseline

The repo already provides a strong diagnostic foundation:

- Next.js app with `/api/mcp` diagnostic endpoint.
- Typed request and response contract.
- Read-only Kubernetes collection through `@kubernetes/client-node`.
- Deterministic analysis for common failure modes:
  - CrashLoopBackOff
  - ImagePullBackOff
  - scheduling failures
  - OOMKilled containers
  - readiness/probe failures
  - unavailable workloads
  - services without ready endpoints
  - node readiness and pressure
  - HPA scaling issues
  - pending/lost PVCs
  - suspended CronJobs
  - warning events
- Optional OpenAI incident narrative.
- Basic UI for namespace, workload, label selector, logs, node health, and context selection.
- Read-only Kubernetes RBAC.

## Target Outcome

The finished system should act like a Kubernetes operations assistant that can answer:

- What is broken?
- Why is it likely broken?
- What evidence supports that conclusion?
- What services, pods, nodes, users, or workflows are affected?
- What is the risk if we do nothing?
- What is the risk if we apply a proposed remediation?
- What safe next action should an engineer take?
- What commands can be run to verify the diagnosis?

## Non-Goals

- Do not execute destructive remediation automatically.
- Do not require OpenAI for deterministic diagnosis.
- Do not replace Kubernetes RBAC or tenant authorization.
- Do not store secrets, raw tokens, or unredacted sensitive logs in persistent history.
- Do not make AI the source of truth for root cause.

## Phase 1: Deployment And Auth Hardening

### Requirements

1. Add a health endpoint that does not require Kubernetes access.
   - Example: `GET /api/health`.
   - Returns basic service readiness, version/build metadata if available, and does not trigger cluster collection.

2. Update Kubernetes probes to use the health endpoint.
   - Readiness and liveness probes must not call `/api/mcp`.
   - Probes must continue to work when `MCP_API_KEY` is enabled.

3. Fix API authentication behavior.
   - Keep API key protection for diagnostic and history endpoints.
   - Allow unauthenticated health checks.
   - Decide how browser UI obtains or sends the API key when auth is enabled.

4. Replace deprecated Next.js `middleware.ts` convention.
   - Move auth behavior to the current supported Next.js proxy convention.

5. Fix Docker packaging assumptions.
   - Ensure the Dockerfile does not fail when `public/` does not exist.
   - Preserve standalone Next.js output behavior.

### Acceptance Criteria

- `npm run typecheck` passes.
- `npm run build` passes.
- Container build succeeds.
- Kubernetes readiness/liveness probes stay healthy with and without `MCP_API_KEY`.
- UI diagnostic calls work in the selected auth mode.

## Phase 2: Analyzer Test Coverage

### Requirements

1. Add unit tests for deterministic analyzer rules.
2. Use fixture snapshots rather than live cluster dependencies.
3. Cover at least:
   - healthy namespace
   - CrashLoopBackOff
   - ImagePullBackOff
   - OOMKilled
   - pending unschedulable pod
   - service with no endpoints
   - node NotReady
   - node pressure
   - HPA unable to scale
   - HPA at max replicas
   - pending PVC
   - lost PVC
   - suspended CronJob
   - generic warning event

### Acceptance Criteria

- Test command exists in `package.json`.
- Analyzer tests can run without kubeconfig.
- Every supported diagnostic category has at least one test.
- Findings include stable `id`, `severity`, `category`, `resource`, `evidence`, `impact`, and read-only automation commands.

## Phase 3: First-Class Risk And Impact Model

### Requirements

Replace the current single `impact: string` model with structured impact and risk fields while preserving readable report output.

Proposed types:

```ts
export type ImpactScope =
  | 'pod'
  | 'workload'
  | 'service'
  | 'namespace'
  | 'node'
  | 'cluster'
  | 'unknown';

export interface ImpactAssessment {
  scope: ImpactScope;
  affectedResources: KubernetesResourceRef[];
  affectedReplicas?: {
    desired: number;
    ready: number;
    unavailable: number;
  };
  userFacing: boolean;
  summary: string;
}

export interface RiskAssessment {
  level: Severity;
  confidence: 'low' | 'medium' | 'high';
  riskIfIgnored: string;
  riskIfRemediated?: string;
  blastRadius: ImpactScope;
  reasons: string[];
}
```

Update `DiagnosticFinding` to include:

- `impactAssessment`
- `riskAssessment`
- optional `confidence`
- optional `relatedResources`

The existing `impact` string may be retained temporarily for backward compatibility, but the formatter and UI should prefer structured impact.

### Acceptance Criteria

- High-level summary exposes top risks with reasons, not only titles.
- Report includes affected scope and blast radius.
- UI can show risk level, affected resources, and confidence.
- Existing clients still receive a readable `impact` string during transition.

## Phase 4: Better Kubernetes Context Collection

### Requirements

Extend the collector to support impact analysis:

1. Owner chain mapping.
   - Resolve pod -> ReplicaSet -> Deployment where possible.
   - Preserve owner references in response.

2. EndpointSlice support.
   - Prefer EndpointSlices over legacy Endpoints when available.
   - Fall back to Endpoints when EndpointSlice RBAC is unavailable.

3. Ingress collection.
   - Collect Ingress resources in namespace.
   - Map ingress backend services to impacted services.

4. NetworkPolicy collection.
   - Identify when a workload/service may be isolated by policy.

5. PodDisruptionBudget collection.
   - Determine remediation risk for drain, rollout, restart, and scale-down operations.

6. ResourceQuota and LimitRange collection.
   - Improve scheduling and resource failure explanations.

7. Rollout history signal.
   - Collect deployment annotations and revision metadata where available.
   - Recommend `kubectl rollout history` as a read-only command.

### Acceptance Criteria

- Service findings can identify whether a user-facing ingress depends on the broken service.
- Workload findings can report desired, ready, unavailable, and related services.
- Node findings can list pods on the node and whether any have PDB protection.
- Collector degrades gracefully when RBAC denies optional resources.

## Phase 5: External Signal Integrations

### Requirements

Add optional integrations that improve root cause and timeline analysis:

1. Prometheus or metrics API.
   - CPU/memory saturation.
   - request/error/latency signals when labels are available.

2. Loki or log backend.
   - Query recent logs across affected pods.
   - Correlate error spikes with Kubernetes events.

3. Argo CD.
   - App sync status.
   - Last deployment time.
   - Out-of-sync resources.

4. GitHub Actions or deployment source.
   - Recent deployments.
   - Failed release workflows.
   - Commit metadata.

5. Policy and security tools.
   - Polaris, Kyverno, OPA/Gatekeeper, or similar.
   - Identify risky manifests and policy violations.

### Acceptance Criteria

- Integrations are optional and disabled by default.
- Missing credentials or RBAC produce collection warnings, not failed diagnostic runs.
- AI prompt receives only structured, redacted evidence.
- Report has a timeline section when external signals are available.

## Phase 6: Chat Assistant And MCP Tool Layer

### Requirements

Move from a single diagnostic request to a conversational assistant model.

Core tools:

- `collect_snapshot`
  - Collect Kubernetes evidence for namespace/workload/labels.

- `analyze_incident`
  - Run deterministic diagnosis and return structured findings.

- `explain_finding`
  - Explain one finding in plain language with evidence and commands.

- `assess_impact`
  - Compute blast radius and affected resources.

- `assess_change_risk`
  - Analyze a proposed action, such as rollout restart, scale change, rollback, cordon, or drain.

- `propose_remediation`
  - Produce safe next steps and verification commands.

- `compare_runs`
  - Compare two diagnostic runs and highlight what changed.

Conversation behavior:

- Preserve diagnostic context across turns.
- Ask clarifying questions only when scope is ambiguous.
- Cite exact findings and resources in answers.
- Refuse or require approval for destructive actions.
- Prefer read-only verification commands first.

### Acceptance Criteria

- User can ask follow-up questions about a previous run.
- Assistant can explain why a finding is high or critical.
- Assistant can assess the risk of a proposed remediation before execution.
- MCP-style tool contract is documented and versioned.
- Deterministic analyzer remains usable without chat or AI.

## Phase 7: Persistence And Audit Trail

### Requirements

Replace in-memory run history with persistent storage.

Store:

- request metadata
- cluster context
- namespace and scope
- redacted snapshot
- deterministic findings
- AI narrative status
- runbook
- timestamps
- user/session metadata if auth exists

Do not store:

- raw API keys
- kubeconfig contents
- secret values
- unredacted sensitive logs

### Acceptance Criteria

- Runs survive process restart.
- History can be filtered by namespace, workload, health, severity, and time.
- Sensitive data redaction is tested.
- Audit record shows what was collected and what actions were proposed.

## Phase 8: UI Improvements

### Requirements

Update the dashboard from diagnostic report view to incident workspace.

Add:

- risk and impact summary panel
- affected resource graph or grouped list
- timeline section
- finding detail drawer
- safe command copy buttons
- run comparison view
- chat panel for follow-up questions
- auth state handling
- collection warning visibility

### Acceptance Criteria

- Engineers can identify the top risk within five seconds.
- Every finding has evidence, impact, risk, and next actions visible without reading raw JSON.
- Chat answers link back to exact findings/resources.
- UI remains useful when AI is disabled.

## Safety Principles

- All default commands must be read-only.
- Any destructive or mutating command must be marked:
  - `destructive: true`
  - `requiresApproval: true`
  - with rollback or verification guidance when possible
- The assistant should prefer:
  1. observe
  2. explain
  3. verify
  4. propose
  5. require approval
  6. execute only if an execution feature is explicitly implemented later

## Implementation Order

1. Phase 1: deployment and auth hardening.
2. Phase 2: analyzer test coverage.
3. Phase 3: structured risk and impact model.
4. Phase 4: richer Kubernetes collection.
5. Phase 8 partial: UI changes for structured risk and impact.
6. Phase 6: chat and MCP tool layer.
7. Phase 5: external integrations.
8. Phase 7: persistence and audit trail.

This order keeps the system shippable while evolving toward the full assistant vision.
