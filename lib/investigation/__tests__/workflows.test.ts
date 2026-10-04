import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareRuns } from '../compare';
import { groupIncidents } from '../group';
import { collectMetrics } from '../metrics';
import { createPlan, verifyPlan } from '@/lib/gitops/plans';
import { patchManifest, previewPlan, publishPlan, syncPullRequest } from '@/lib/gitops/github';
import { findBaseline, getRun, saveRun } from '@/lib/store/history';
import { withRecordLock } from '@/lib/store/disk';
import { normalizeMcpRequest } from '@/lib/validation';
import type { MCPResponse, DiagnosticFinding } from '@/types/mcp';
import type { FixPlan } from '@/types/investigation';
import { buildSummary } from '@/lib/diagnostics/formatter';

function run(image = 'app:v1', ready = true): MCPResponse {
  const scope = normalizeMcpRequest({ input_context: { namespace: 'team-a', context: 'cluster-a' } }).input_context;
  const snapshot: MCPResponse['snapshot'] = { namespace: 'team-a', context: 'cluster-a', collectedAt: '2026-01-01T00:00:00.000Z',
    pods: [{ uid: 'pod-1', name: 'checkout-abc-1', namespace: 'team-a', phase: 'Running', nodeName: 'worker', labels: { app: 'checkout' }, ownerReferences: [{ kind: 'ReplicaSet', name: 'checkout-abc', namespace: 'team-a' }],
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }], containers: [{ name: 'app', image, ready, restartCount: 0, state: { state: 'running' }, requests: {}, limits: {} }], initContainers: [], restartCount: 0, readyContainers: ready ? 1 : 0 }],
    workloads: [{ kind: 'Deployment', name: 'checkout', namespace: 'team-a', uid: 'deployment-1', generation: 1, observedGeneration: 1, revision: '1', desired: 1, ready: ready ? 1 : 0, updated: 1, available: ready ? 1 : 0, conditions: [], configuration: { templateHash: image, containers: [{ name: 'app', image, requests: {}, limits: {}, configurationHash: 'hash' }] } },
      { kind: 'ReplicaSet', name: 'checkout-abc', namespace: 'team-a', desired: 1, ready: ready ? 1 : 0, conditions: [], ownerReferences: [{ kind: 'Deployment', name: 'checkout', namespace: 'team-a' }] }],
    services: [{ name: 'checkout', namespace: 'team-a', type: 'ClusterIP', selector: { app: 'checkout' }, ports: ['80/TCP'], readyEndpoints: ready ? 1 : 0, notReadyEndpoints: ready ? 0 : 1 }],
    events: [], logs: [], nodes: [], hpas: [], pvcs: [], cronJobs: [], configMaps: [], accessErrors: [], coverage: { podsTruncated: false } };
  const findings = ready ? [] : [finding('Pod', 'checkout-abc-1'), finding('Service', 'checkout')];
  const response: MCPResponse = { requestId: crypto.randomUUID(), status: 'ok', generatedAt: snapshot.collectedAt, scope, snapshot, findings, summary: buildSummary(scope, snapshot, findings), runbook: [], output: '', metadata: { collector: 'test', analyzer: 'test', aiStatus: 'disabled', errors: [] } };
  response.incidents = groupIncidents(snapshot, findings); return response;
}
function finding(kind: string, name: string, namespace: string | undefined = 'team-a'): DiagnosticFinding {
  return { id: `${kind}/${namespace}/${name}`, title: `${name} unhealthy`, resource: { kind, name, namespace }, severity: 'high', category: 'availability', signal: 'unhealthy', evidence: ['test evidence'], impact: 'unavailable', recommendedActions: [], automation: [], impactAssessment: { scope: 'workload', userFacing: true, affectedResources: [], summary: 'unavailable' }, riskAssessment: { level: 'high', confidence: 'high', riskIfIgnored: 'outage', blastRadius: 'workload', reasons: [] } };
}
function fixtures() {
  const baseline = run(), current = run('app:v2', false);
  current.snapshot.collectedAt = current.generatedAt = '2026-01-01T00:01:00.000Z';
  const plan = createPlan(current, baseline, { kind: 'Deployment', namespace: 'team-a', name: 'checkout' });
  return { baseline, current, plan };
}
const manifest = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: team-a
spec:
  template:
    spec:
      containers:
        - name: app
          image: app:v2 # retain this comment
---
apiVersion: v1
kind: Service
metadata:
  name: checkout
`;
let directory: string;
beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'diagnostics-test-')); vi.stubEnv('DIAGNOSTICS_DATA_DIR', directory); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });

describe('snapshot comparison and persistence', () => {
  it('compares revisions, images and configuration fingerprints without asserting causation', () => {
    const { baseline, current } = fixtures(); current.snapshot.workloads[0].revision = '2';
    current.snapshot.configMaps = [{ name: 'settings', namespace: 'team-a', digest: 'new' }];
    const result = compareRuns(current, baseline);
    expect(result.changes.map(c => c.field)).toContain('containers/app/image');
    expect(result.changes.map(c => c.field)).toContain('revision');
    expect(result.hypotheses[0].confidence).toBe('low');
    expect(result.hypotheses[0].statement).toContain('causation is not established');
  });
  it('rejects comparisons across namespaces or clusters', () => {
    const { baseline, current } = fixtures(); baseline.snapshot.context = 'cluster-b';
    expect(compareRuns(current, baseline).status).toBe('no-baseline');
    baseline.snapshot.context = current.snapshot.context; baseline.scope.namespace = 'other';
    expect(compareRuns(current, baseline).status).toBe('no-baseline');
  });
  it('does not infer deletions from partial or truncated snapshots', () => {
    const { baseline, current } = fixtures(); current.snapshot.workloads = []; current.status = 'partial';
    expect(compareRuns(current, baseline)).toMatchObject({ status: 'incomplete', changes: [] });
    current.status = 'ok'; current.snapshot.coverage = { podsTruncated: true };
    expect(compareRuns(current, baseline).changes).toHaveLength(0);
  });
  it('persists runs and finds only earlier matching baselines', () => {
    const { baseline, current } = fixtures(); saveRun(baseline); saveRun(current);
    expect(getRun(baseline.requestId)?.snapshot).toEqual(baseline.snapshot);
    expect(findBaseline(current)?.requestId).toBe(baseline.requestId);
    expect(findBaseline(baseline)).toBeUndefined();
  });
  it('does not interpret unavailable metrics as zero', () => {
    const { baseline, current } = fixtures();
    expect(compareRuns(current, baseline).metricChanges).toEqual([]);
  });
  it('serializes simultaneous workflow mutations', async () => {
    await withRecordLock('fixes', 'one', async () => {
      await expect(withRecordLock('fixes', 'one', async () => 1)).rejects.toThrow('busy');
    });
    await expect(withRecordLock('fixes', 'one', async () => 2)).resolves.toBe(2);
  });
  it('marks missing collection as unknown health', () => {
    const r = run(); r.snapshot.accessErrors.push({ operation: 'list pods', message: 'denied' }); r.snapshot.pods = [];
    expect(buildSummary(r.scope, r.snapshot, []).health).toBe('unknown');
  });
});
describe('dependency groups', () => {
  it('links Pod → ReplicaSet → Deployment and matching service with evidence', () => {
    const r = run('app:v2', false); const groups = groupIncidents(r.snapshot, r.findings);
    expect(groups).toHaveLength(1); expect(groups[0].findingIds).toHaveLength(2);
    expect(groups[0].resources.some(r => r.kind === 'Deployment')).toBe(true);
    expect(groups[0].edges.some(e => e.relation === 'owned-by')).toBe(true);
    expect(groups[0].edges.some(e => e.relation === 'selected-by')).toBe(true);
  });
  it('does not group unrelated workloads merely because they share a healthy node', () => {
    const r = run('app:v2', false); const p = structuredClone(r.snapshot.pods[0]); p.name = 'other'; p.ownerReferences = []; p.labels = {};
    r.snapshot.pods.push(p); r.findings.push(finding('Pod', 'other'));
    expect(groupIncidents(r.snapshot, r.findings)).toHaveLength(2);
    r.findings.push(finding('Node', 'worker', ''));
    expect(groupIncidents(r.snapshot, r.findings)).toHaveLength(1);
  });
  it('does not match selectors across namespaces', () => {
    const r = run('app:v2', false); r.snapshot.services[0].namespace = 'other'; r.findings[1].resource.namespace = 'other';
    expect(groupIncidents(r.snapshot, r.findings)).toHaveLength(2);
  });
  it('groups pods mounting the same failing PVC', () => {
    const r = run('app:v2', false); r.snapshot.pods[0].persistentVolumeClaims = ['data'];
    r.findings.push(finding('PersistentVolumeClaim', 'data'));
    expect(groupIncidents(r.snapshot, r.findings)[0].edges.some(e => e.relation === 'mounts')).toBe(true);
  });
});
describe('fix proposals and YAML review', () => {
  it('proposes only observed image/resource reversions', () => {
    const { plan } = fixtures(); expect(plan.operations).toEqual([{ container: 'app', field: 'image', before: 'app:v2', after: 'app:v1' }]);
  });
  it('rejects unhealthy baselines and recreated deployments', () => {
    const { baseline, current, plan } = fixtures(); baseline.snapshot.workloads[0].ready = 0;
    expect(() => createPlan(current, baseline, plan.resource)).toThrow('baseline');
    baseline.snapshot.workloads[0].ready = 1; current.snapshot.workloads[0].uid = 'new';
    expect(() => createPlan(current, baseline, plan.resource)).toThrow('identity');
  });
  it('edits the matching YAML document while preserving comments and other resources', () => {
    const { plan } = fixtures(); const output = patchManifest(manifest, plan);
    expect(output.content).toContain('app:v1 # retain this comment'); expect(output.content).toContain('kind: Service');
    expect(output.diff).toContain('- "app:v2"');
  });
  it('rejects stale Git content, ambiguous resources, and wrong namespace', () => {
    const { plan } = fixtures();
    expect(() => patchManifest(manifest.replace('app:v2', 'app:v3'), plan)).toThrow('drifted');
    expect(() => patchManifest(manifest + '\n---\n' + manifest, plan)).toThrow('exactly one');
    expect(() => patchManifest(manifest.replace('team-a', 'team-b'), plan)).toThrow('exactly one');
  });
  it('checks reviewed digest before any GitHub call', async () => {
    const { plan } = fixtures(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(publishPlan(plan, 'not-reviewed')).rejects.toThrow('approve'); expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('recovery verification', () => {
  function setup() {
    const f = fixtures(); f.plan.pullRequest = { number: 1, url: 'https://github.com/org/repo/pull/1', branch: 'fix', mergedAt: '2026-01-01T00:02:00.000Z' };
    const recovered = run(); recovered.snapshot.collectedAt = recovered.generatedAt = '2026-01-01T00:05:00.000Z';
    return { ...f, recovered };
  }
  it('requires two healthy observations after merge', () => {
    const { plan, current, recovered } = setup();
    const first = verifyPlan(plan, current, recovered, undefined, new Date(recovered.snapshot.collectedAt)); expect(first.status).toBe('observing');
    plan.verification.push(first); const next = structuredClone(recovered); next.requestId = 'next'; next.snapshot.collectedAt = '2026-01-01T00:06:01.000Z';
    expect(verifyPlan(plan, current, next, recovered, new Date(next.snapshot.collectedAt)).status).toBe('passed');
  });
  it('cannot pass before merge, on partial data, or when the Deployment disappeared', () => {
    const { plan, current, recovered } = setup(); plan.pullRequest!.mergedAt = undefined;
    expect(verifyPlan(plan, current, recovered).status).toBe('inconclusive');
    plan.pullRequest!.mergedAt = '2026-01-01T00:02:00.000Z'; recovered.status = 'partial';
    expect(verifyPlan(plan, current, recovered).status).toBe('inconclusive');
    recovered.status = 'ok'; recovered.snapshot.workloads = [];
    expect(verifyPlan(plan, current, recovered).status).toBe('inconclusive');
  });
  it('fails if the proposed configuration is not applied or restarts grow', () => {
    const { plan, current, recovered } = setup();
    recovered.snapshot.workloads[0].configuration!.containers[0].image = 'app:v2';
    expect(verifyPlan(plan, current, recovered).status).toBe('failed');
    recovered.snapshot.workloads[0].configuration!.containers[0].image = 'app:v1';
    const prior = structuredClone(recovered); recovered.snapshot.pods[0].restartCount = 1;
    expect(verifyPlan(plan, current, recovered, prior).status).toBe('failed');
  });
});
describe('Prometheus evidence', () => {
  it('skips unconfigured or mismatched clusters without contacting Prometheus', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('PROMETHEUS_URL', '');
    expect((await collectMetrics(run().snapshot)).status).toBe('disabled');
    vi.stubEnv('PROMETHEUS_URL', 'https://prometheus.example'); vi.stubEnv('PROMETHEUS_CONTEXT', 'other');
    expect((await collectMetrics(run().snapshot)).status).toBe('unavailable'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('queries scoped samples and treats empty results as unavailable', async () => {
    vi.stubEnv('PROMETHEUS_URL', 'https://prometheus.example'); vi.stubEnv('PROMETHEUS_CONTEXT', 'cluster-a');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { resultType: 'vector', result: [] } }) }); vi.stubGlobal('fetch', fetcher);
    expect((await collectMetrics(run().snapshot)).status).toBe('unavailable');
    expect(String(fetcher.mock.calls[0][0])).toContain('api/v1/query');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('query')).toContain('namespace="team-a"');
  });
});

describe('GitHub integration (mocked transport)', () => {
  function configure() {
    vi.stubEnv('GITOPS_GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GITOPS_TARGETS', JSON.stringify([{ context: 'cluster-a', namespace: 'team-a', kind: 'Deployment', name: 'checkout', repository: 'company/gitops', branch: 'main', path: 'apps/checkout.yaml' }]));
  }
  it('previews without writes and rejects a changed base before publishing', async () => {
    configure(); const { plan } = fixtures();
    const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes('/git/ref/') ? { object: { sha: 'base-one' } } : { type: 'file', encoding: 'base64', size: manifest.length, sha: 'file-one', content: Buffer.from(manifest).toString('base64') } }));
    vi.stubGlobal('fetch', fetcher);
    const preview = await previewPlan(plan); expect(preview.preview!.diff).toContain('app:v1');
    expect(fetcher.mock.calls.every(c => c[1].method === 'GET')).toBe(true);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ object: { sha: 'base-two' } }) });
    await expect(publishPlan(preview, preview.preview!.digest)).rejects.toThrow('Base branch changed');
  });
  it('creates one reviewed manifest commit and a human-review PR without merging it', async () => {
    configure(); const { plan } = fixtures(); const patched = patchManifest(manifest, plan);
    const prepared: FixPlan = { ...plan, target: { repository: 'company/gitops', branch: 'main', path: 'apps/checkout.yaml' }, preview: { ...patched, digest: 'a'.repeat(64), baseSha: 'base', fileSha: 'file' } };
    let updated = false;
    const fetcher = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      let data: unknown = {};
      if (url.includes('/git/ref/heads/')) data = { object: { sha: 'base' } };
      else if (url.includes('/pulls?') || url.includes('/git/matching-refs/')) data = [];
      else if (url.includes('/contents/')) {
        if (options.method === 'PUT') { updated = true; data = {}; }
        else data = { sha: 'file', content: Buffer.from(updated ? patched.content : manifest).toString('base64') };
      } else if (url.includes('/compare/')) data = { commits: [{}], files: [{ filename: 'apps/checkout.yaml', status: 'modified' }] };
      else if (url.endsWith('/pulls')) data = { number: 7, html_url: 'https://github.com/company/gitops/pull/7', head: { sha: 'new-head' } };
      return { ok: true, json: async () => data };
    });
    vi.stubGlobal('fetch', fetcher);
    const submitted = await publishPlan(prepared, prepared.preview!.digest);
    expect(submitted.status).toBe('pr-open'); expect(submitted.pullRequest?.number).toBe(7);
    const writes = fetcher.mock.calls.filter(c => c[1].method !== 'GET');
    expect(writes).toHaveLength(3);
    expect(writes.some(c => c[0].includes('/merge'))).toBe(false);
    expect(JSON.parse(writes.at(-1)![1].body).body).toContain('Verification criteria');
  });
  it('rejects changed PR content during verification', async () => {
    configure(); const { plan } = fixtures(); plan.target = { repository: 'company/gitops', branch: 'main', path: 'apps/checkout.yaml' };
    plan.pullRequest = { number: 1, url: 'https://github.com/company/gitops/pull/1', branch: 'fix', headSha: 'reviewed' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ head: { sha: 'changed' }, merged_at: '2026-01-01T00:02:00Z' }) }));
    await expect(syncPullRequest(plan)).rejects.toThrow('content changed');
  });
});
