# Install and operate tenant-isolated diagnostics

This release supports one self-hosted application instance with multiple tenants and one OIDC issuer. A tenant is a team or organization with its own cluster credential, namespace allowlist, records, roles, and optional integrations. One person can belong to several tenants. Membership comes from validated OIDC subject/group claims; choosing a workspace never grants membership.

The application remains read-only against Kubernetes. Only a tenant admin can publish a reviewed GitHub fix proposal; GitHub review and merge happen outside this application.

## 1. Download and build

Prerequisites: Node.js 22, npm, Docker, kubectl, Helm 3, a cluster with a default StorageClass, and an HTTPS OIDC provider reachable from the app. You need authority to create tenant service accounts and namespace RoleBindings.

```sh
git clone https://github.com/bikramjitchawla/mcp-kubectl-server.git
cd mcp-kubectl-server
npm ci
npm test
npm run typecheck
npm run build
docker build -t YOUR_REGISTRY/diagnostics:YOUR_RELEASE .
docker push YOUR_REGISTRY/diagnostics:YOUR_RELEASE
```

Use a release/commit containing these changes; they are not automatically published by changing this workspace. No official prebuilt image or hosted chart repository is published by this implementation. The Helm chart ships in the source tree. Pin your deployed image to an immutable release tag in your own registry.

## 2. Give each tenant its own Kubernetes identity

Create a namespace for each tenant, then apply `deploy/examples/tenant-rbac.yaml`, substituting the namespace for every tenant. Do not bind the app itself to a cluster-wide reader role.

```sh
kubectl create namespace team-a
kubectl apply -f deploy/examples/tenant-rbac.yaml
```

The sample Role grants `get/list` for diagnostic resources in **team-a only**. It does not grant Secrets, exec, Kubernetes writes, Nodes, or namespace listing. ConfigMaps and logs can contain sensitive application data. Give each tenant only the namespaces whose evidence its users are permitted to see. All members of a tenant share that tenant's saved evidence; use separate tenants for different data access boundaries.

Create a kubeconfig per tenant with an exact context name (e.g. `team-a`) and credentials for that tenant's `diagnostics-reader` service account. Include the API server URL and CA; do not disable TLS verification. Kubernetes should reject access to any other tenant even if application filtering fails.

For a short-lived evaluation, an administrator can obtain a token with `kubectl -n team-a create token diagnostics-reader --duration=1h`. Put it into the tenant kubeconfig using a secure local editor. This token expires; the app does **not** renew it. In production, use your platform's credential controller to rotate token files or kubeconfig Secrets, or a dedicated credential sidecar. A kubeconfig `tokenFile` must point to the mounted rotating credential. Only installation administrators may supply kubeconfigs; do not expose kubeconfig upload to tenants. Executable authentication plugins require separately packaged binaries and are not included in the image.

Check RBAC with your tenant credential:

```sh
kubectl --kubeconfig=deploy/local/team-a.yaml -n team-a get pods
kubectl --kubeconfig=deploy/local/team-a.yaml -n team-b get pods
```

The second command must be denied. This is an operator verification step; do not use cluster-admin credentials for tenant kubeconfigs.

## 3. Configure OIDC (Keycloak example)

Use your existing HTTPS Keycloak deployment. An importable client template is provided at `deploy/examples/keycloak-client.json`; replace its application URLs before importing it, then generate/copy the client secret in Keycloak. In realm `diagnostics`:

1. Create an OpenID Connect client `diagnostics` with client authentication enabled and Standard Flow enabled. Disable implicit flow and direct access grants.
2. Set the exact valid redirect URI to `https://diagnostics.example.com/api/auth/callback` and the web origin to `https://diagnostics.example.com`. Require S256 PKCE. Do not use wildcard redirect URIs.
3. Copy the client secret into a secret manager/local protected file, never a Git-tracked manifest.
4. Add a **Group Membership** protocol mapper to the client's dedicated scope: token claim name `groups`, full group path enabled, **Add to ID token enabled**. This application reads the ID token, not UserInfo or access-token group claims.
5. Create groups such as `/diagnostics/team-a/viewers`, `/diagnostics/team-a/operators`, and `/diagnostics/team-a/admins`, and assign users. Repeat for team-b. The group strings must exactly match `bindings` in the tenant configuration.

Issuer: `https://id.example.com/realms/diagnostics`. Other OIDC providers use the same issuer/client/secret settings and must emit an array of strings in the configured top-level group claim. If your provider cannot emit groups, use exact immutable `sub` identifiers in `bindings[].subjects`; email addresses/domains never grant membership automatically.

The implementation uses authorization code flow, PKCE, random state and nonce, issuer/audience/expiry checks, and JWKS signature verification through `openid-client`. Login transactions are single-use and expire after ten minutes. Session cookies are opaque, HttpOnly, SameSite=Lax, Secure with a `__Host-` prefix in production. Sessions live on the server, expire at the earlier of one hour or ID-token expiry, and are revoked on local sign-out. Tokens are not stored in browser storage. Cookie-authenticated mutations require the configured Origin.

Group changes at the IdP take effect at the next login or session expiry. Local binding changes are rechecked on every request. Local sign-out does not end the IdP SSO session; back-channel logout and refresh tokens are not implemented.

References: [Keycloak protocol mappers](https://www.keycloak.org/admin-api/protocol-mappers), [openid-client](https://github.com/panva/openid-client), [Kubernetes multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/).

## 4. Configure tenants and secrets

```sh
mkdir -p deploy/local
cp deploy/examples/tenants.json deploy/local/tenants.json
```

Edit the example: retain only tenants you have provisioned; set the credential filenames, context names, namespace lists and identity bindings. Tenant IDs must remain stable because they identify storage partitions. Each tenant has one cluster context in this release; create another tenant/workspace for another cluster.

| Role | Permissions |
|---|---|
| viewer | Read tenant inventory, diagnostic history, fix proposals |
| operator | Viewer permissions plus run diagnostics/NLQ, propose/preview fixes, check recovery |
| admin | Operator permissions plus publish a reviewed fix PR |

Tenant admins cannot edit server tenant configuration or grant themselves access to additional namespaces. Configuration is managed by the installation administrator.

`allowNodes` defaults to false because node evidence is shared cluster data. Enable only for trusted platform tenants and grant the matching Node read permission separately. `allowAi` defaults to false because AI processing sends selected evidence, potentially including log text, to the configured provider. Enable only after selecting an approved provider and considering that tenant's data policy.

Create deployment Secrets from protected files:

```sh
kubectl create namespace diagnostics
kubectl -n diagnostics create secret generic diagnostics-oidc \
  --from-file=client-secret=deploy/local/oidc-client-secret
kubectl -n diagnostics create secret generic diagnostics-tenants \
  --from-file=tenants.json=deploy/local/tenants.json
kubectl -n diagnostics create secret generic diagnostics-credentials \
  --from-file=team-a.yaml=deploy/local/team-a.yaml \
  --from-file=team-b.yaml=deploy/local/team-b.yaml
```

For rotation, update the Secrets with your usual secret-management tooling. Tenant configuration and Kubernetes credential files are read on new requests. Restart the app after changing OIDC configuration or environment-sourced integration credentials.

### Automation API keys

OIDC is the browser sign-in path. Non-browser automation uses a random tenant API key; arbitrary bearer/ID tokens and proxy identity headers are not accepted as API authentication.

Generate a 32-byte random value and its SHA-256 digest in a protected terminal:

```sh
node -e 'const c=require("node:crypto"); const key=c.randomBytes(32).toString("base64url"); console.log(JSON.stringify({key,sha256:c.createHash("sha256").update(key).digest("hex")}))'
```

Store the raw key in your secret manager. Add only its digest to the chosen tenant:

```json
"apiKeys": [{ "id": "ci-reader", "sha256": "REPLACE_WITH_64_HEX_DIGEST", "role": "viewer" }]
```

A digest must belong to one tenant only. Send the raw key in `X-API-Key`; `X-Tenant-ID` is optional for keys but, if supplied, must match. For browser sessions the workspace selector supplies `X-Tenant-ID`. Keys are individually identified in audit logs and revoked by removing them from configuration.

## 5. Install with Helm

```sh
helm upgrade --install diagnostics ./deploy/helm/diagnostics \
  --namespace diagnostics \
  --set image.repository=YOUR_REGISTRY/diagnostics \
  --set image.tag=YOUR_RELEASE \
  --set appUrl=https://diagnostics.example.com \
  --set oidc.issuer=https://id.example.com/realms/diagnostics \
  --set ingress.enabled=true \
  --set ingress.className=YOUR_INGRESS_CLASS \
  --set ingress.host=diagnostics.example.com \
  --set ingress.tlsSecret=diagnostics-tls \
  --set networkPolicy.ingressNamespace=YOUR_INGRESS_NAMESPACE
```

Provision `diagnostics-tls` with your certificate tooling. The chart runs one non-root replica, uses a 2 GiB persistent volume, disables the default service-account token, mounts tenant credential/config Secrets read-only, and uses a read-only root filesystem. It grants the app no cluster-wide RBAC. The ingress NetworkPolicy requires a CNI that enforces NetworkPolicies; configure its namespace selector for your ingress controller. Egress policy depends on the installation's cluster APIs, IdP, DNS, GitHub and optional providers and must be supplied by the platform operator.

The app must reach the HTTPS issuer and trust its certificate. Use an organizational CA bundle through `NODE_EXTRA_CA_CERTS` when needed; never disable TLS checks. Place an ingress/proxy body-size limit and unauthenticated request-rate limit in front of the app as well.

Open the app, choose **Sign in with your organization**, and choose a workspace. The dropdown contains only authorized memberships. Log in with a second tenant's user and confirm their namespace list and saved runs are separate.

## Local development

Set `APP_URL=http://localhost:3000`, `TENANTS_CONFIG_FILE` to an absolute local tenant JSON path, and kubeconfig paths to local tenant credentials in `.env.local`. OIDC still requires an HTTPS issuer with `http://localhost:3000/api/auth/callback` registered for development; alternatively use a tenant API key. Run `npm ci && npm run dev`. No anonymous mode or ambient `~/.kube/config` fallback exists. Development cookies are allowed on localhost HTTP; production always requires HTTPS.

## Optional integrations

GitOps configuration belongs to the tenant object:

```json
{
  "githubTokenEnv": "TEAM_A_GITHUB_TOKEN",
  "gitopsTargets": [{ "context": "team-a", "namespace": "team-a", "kind": "Deployment", "name": "checkout", "repository": "your-org/gitops", "branch": "main", "path": "apps/checkout/deployment.yaml" }],
  "prometheus": { "url": "https://team-a-prometheus.example/", "tokenEnv": "TEAM_A_PROMETHEUS_TOKEN" }
}
```

These fields are additions to a full tenant object. Store the actual tokens in a Kubernetes Secret and set chart `integrationSecret` to its name. Give the GitHub token access only to that tenant's repositories. The Prometheus endpoint/credential must isolate the tenant's cluster; namespace/pod labels alone cannot distinguish identically named resources across clusters. No request-supplied repository, endpoint or credential is accepted.

Diagnostics return deterministic evidence first. When AI is requested, the response has `metadata.aiStatus: "pending"`; the dashboard then calls `POST /api/history/:id/narrative` separately. API clients can call the same tenant-authorized endpoint. An AI timeout never discards the saved diagnostic run.

AI credentials are installation-wide (`GROQ_API_KEY` or `OPENAI_API_KEY`); usage requires each tenant's `allowAi`. An organization requiring a separate AI account should use a separate installation for now.

## Operations, retention and migration

- `/api/health` is public process liveness. `/api/ready` is public readiness for local configuration, readable credential files and writable storage; it does not contact Kubernetes or the IdP. It returns no configuration details.
- Data routes require authentication and return `Cache-Control: no-store`. Audit events go to structured stdout with tenant, subject, action path, role and status; ship them to your audit sink. Diagnostic evidence is not included in these audit events.
- Storage layout: `.data/tenants/<id>/{runs,run-index,fixes}` and a separate `.data/auth` session store. Back up the volume with access restricted to installation administrators; use encrypted storage/backups at the infrastructure layer.
- History defaults to 200 unpinned runs per tenant, maximum configurable retention 2,000; pinned fix evidence can exceed this. Reads use small index records and `GET /api/history?offset=0&limit=50` (maximum 100).
- Fix plans are capped at 100 per tenant. Proposed/closed/verified plans older than 30 days are pruned on collection/proposal creation. Open/merged plans remain pinned. Verification history retains the most recent 20 observations. Inspect and archive old active plans administratively when needed.
- Each record is limited to 8 MiB and each tenant partition to 256 MiB. Quota exhaustion rejects new writes; it never evicts reviewed evidence automatically. Take a backup and remove obsolete plans/runs and matching index entries during maintenance to reclaim space. Quota accounting and storage are designed for one process, not concurrent replicas.
- Kubernetes requests have ten-second transport deadlines, list pages of 500 with a 2,000-resource collection cap (marked incomplete), at most four concurrent log reads and 32 KiB per log response. Expensive routes have per-identity/per-tenant budgets and at most two concurrent operations per tenant. Limits are process-local. Large namespaces may need a narrower label/workload scope.
- The previous shared `MCP_API_KEY`, global GitOps settings, ambient kubeconfig access and unpartitioned history are no longer used. Existing `.data/runs`/`.data/fixes` are **not** exposed to any tenant automatically. Back them up and explicitly assign/import evidence with a reviewed migration before deleting it; this release intentionally does not guess tenant ownership.
- The old Skaffold/raw `k8s/` examples are superseded by the Helm installation. They now require the same tenant/OIDC Secrets; do not retain an old cluster-wide reader binding from a previous installation.

## Shared-hosted roadmap and trust boundary

Application authorization isolates tenants within a trusted installation; separate Kubernetes credentials provide an additional RBAC boundary. The server process and installation administrators can access all configured tenant credentials and stored data. For mutually untrusted organizations requiring a process/volume/credential isolation boundary, deploy one release per organization or separate worker/collector instances.

Before running a replicated shared SaaS control plane, add a transactional database with tenant-scoped queries and row-level security, shared session/rate-limit/job stores, durable background collection jobs, per-tenant secrets management, per-organization OIDC provider registration, tested migrations and backups, and centralized audit retention. Do not increase replicas with the current file store and in-memory limiter. The current release provides the self-hosted foundation, not those SaaS operations features.

## Validation before rollout

`npm test`, `npm run typecheck`, `npm run build`, `helm lint`, and `helm template` run locally/CI. Protocol tests use actual RSA-signed ID tokens and mocked provider HTTP responses to check signatures, issuer, audience, nonce, state and expiry. Route tests exercise isolation and roles. Complete a live Keycloak sign-in/logout and two-tenant Kubernetes RBAC test in your staging cluster before rollout; unit tests do not replace these environment checks.
