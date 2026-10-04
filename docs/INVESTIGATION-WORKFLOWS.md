# Investigation and recovery workflows

The dashboard now supports snapshot comparison, dependency-based incident groups, and reviewed GitOps recovery workflows. Kubernetes access remains read-only. The only external write implemented by the workflow is an explicitly requested GitHub branch/commit/PR; the app never merges a PR or applies a manifest.

## What changed?

Run diagnostics twice with the same cluster context, namespace, workload filter, label selector, pod limit, log settings, node flag, and HPA flag. The latest earlier complete run becomes the baseline. Comparison records:

- Deployment revision, resource identity, desired replica count, image and resource requests/limits.
- Pod-template and container configuration fingerprints, including configuration such as probes and environment references.
- ConfigMap content fingerprints and Service selector/port differences.
- Added/removed workloads and optional CPU/memory observations.

Sensitive environment values and ConfigMap contents are not persisted as configuration diffs. Fingerprints show that content changed but cannot reconstruct the content. Existing collected logs and diagnostic evidence may still contain sensitive information: control access to the data directory and API.

The comparison interval is bounded by snapshot timestamps. The app does not claim to know the exact deployment time or establish causation from simultaneous changes. Hypotheses are explicitly low-confidence and linked to dependency groups. Incomplete/truncated runs suppress change inference; absent metrics are not interpreted as zero.

History and fix plans are partitioned under `.data/tenants/<id>`. A lightweight metadata index supports paginated history and baseline selection. Retention, quotas, credential configuration and migration from shared history are documented in [Self-hosting](SELF-HOSTING.md). The supported deployment uses one replica with persistent storage; replicated SaaS storage is not implemented.

## Dependency grouping

Edges come from observed Kubernetes relationships:

- Pod → ReplicaSet → Deployment via owner references.
- Pod → Service via an exact, non-empty selector match in the same namespace.
- Pod → unhealthy Node via node placement.
- Pod → failing PVC via volume claims.

Connected findings form an incident group with evidence for every edge. Healthy shared nodes/PVCs do not join unrelated incidents. Groups indicate related symptoms, not proof of a common cause. Ingress/DNS/external-service discovery is not implemented in this version.

## Optional Prometheus evidence

Configure `prometheus.url` and optional `prometheus.tokenEnv` in the tenant's server-side configuration. The token environment variable contains a credential scoped to that tenant's metrics endpoint. See [integration setup](SELF-HOSTING.md#optional-integrations).

The context must match the collected snapshot. Configure an endpoint scoped to that cluster; namespace/pod selectors cannot disambiguate multiple clusters that share those labels in a global metrics store. The built-in queries collect summed 5-minute average CPU usage and memory working set for the selected pod names using cAdvisor metrics. No arbitrary query or endpoint is accepted from a request. Queries have bounded timeouts and failures leave deterministic Kubernetes diagnostics available.

Before/after values summarize observed pods in each run, whose population can change during a rollout. They are supporting evidence, not SLO measurements or causal proof. Missing series can affect aggregates; this version does not assert complete per-pod metrics coverage. Metrics do not gate recovery success in this version.

## GitHub configuration

Configure a repository-scoped GitHub token with Contents read/write and Pull requests read/write permissions. Use repository branch protection to require review before merge.

Set `githubTokenEnv` and `gitopsTargets` on the tenant object, and inject the token from a deployment Secret. There must be exactly one allowlisted target for the selected context/namespace/Deployment. Targets and credentials never come from browser requests. See [integration setup](SELF-HOSTING.md#optional-integrations).

Sign in with OIDC or a tenant API key. Operators can propose, preview and verify fixes; publishing a PR requires tenant admin role and approval of the reviewed preview digest.

### Workflow

1. Capture a healthy baseline, then diagnose an incident with the same scope.
2. Choose **Propose fix** for the affected Deployment. The immediately preceding comparison baseline must be healthy for that Deployment and its connected resources.
3. A proposal reverses observed image or resource request/limit changes only. It does not invent values, restore ConfigMaps from hashes, or generate arbitrary YAML through AI. Review compatibility with database migrations and other configuration changes.
4. **Preview GitOps change** fetches the target YAML at a pinned base commit. It requires exactly one matching `apps/v1` Deployment with an explicit namespace. Multi-document YAML is supported; Helm templates and generated overlays are not. Every changed field must still match the diagnosed value in Git.
5. Review the field diff and complete proposed manifest, then check the approval box and **Create review PR**. Publishing rechecks the base commit and preview digest. The PR contains the rationale and success criteria. The app does not merge it.
6. A reviewer reviews and merges the PR in GitHub. Your existing GitOps controller deploys it.
7. **Check recovery after merge** fetches a new read-only diagnostic run. Wait at least 120 seconds after merge and collect two healthy observations at least 60 seconds apart.

A changed PR head is rejected because it invalidates the original verification contract; create a new plan for the revised proposal. Branch retries use the same plan ID and verify the branch contains only the reviewed manifest change. An interrupted operation can leave a `.lock` directory in the data store: inspect the PR/branch and running process before removing a stale lock. No automatic lock takeover is attempted.

### Recovery contract

A pass requires a merged PR, complete matching collection, the same Deployment identity, the proposed fields applied, observed generation, all desired replicas updated/ready/available, ready owned pods, no related high/critical findings, and stable pod identities without restart increases across two observations. Missing resources, missing evidence, and incomplete runs produce `inconclusive`; the first healthy observation is `observing`; failed checks produce `failed`.

This verifies observed Kubernetes workload recovery. It does not prove that the PR caused recovery or that business transactions and latency SLOs recovered. Add application-specific synthetic/SLO checks before relying on it for those claims.

## API

All endpoints use the server-side tenant authorization guard. Cookie-authenticated mutations additionally require the configured Origin.

- `POST /api/mcp`: diagnostics now return `investigation`, `incidents`, and optional `snapshot.metrics`.
- `GET /api/fixes?runId=...`: list proposals, optionally for a source run.
- `POST /api/fixes`: `{ "runId": "...", "resource": { "kind": "Deployment", "namespace": "team-a", "name": "checkout" } }`.
- `GET /api/fixes/:id`: retrieve a plan and its evidence.
- `POST /api/fixes/:id`: `{ "action": "preview" }`, `{ "action": "publish", "approvedDigest": "..." }`, or `{ "action": "verify" }`.

Diagnostic run IDs are generated by the server so callers cannot overwrite prior evidence with a supplied request ID.

## Validation

Run `npm test`, `npm run typecheck`, and `npm run build`. Tests cover scope isolation in comparisons, incomplete collections, dependency grouping, drift rejection, YAML patching, mocked GitHub publishing, history persistence, metrics failures, and recovery state transitions. Live GitHub publishing, Prometheus, and Kubernetes validation require configured infrastructure and are not exercised by these tests.

The current Next.js/Turbopack version may emit a broad filesystem tracing warning for the runtime store. Runtime `.data`, local environment files and Git metadata are explicitly excluded from route deployment traces. Authentication is enforced in route handlers, independently of framework middleware.
