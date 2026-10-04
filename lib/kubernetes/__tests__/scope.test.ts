import { describe, expect, it } from 'vitest';
import { selectOwnedPods } from '../scope';
import { boundedApi, requestOptions } from '../client';
import { buildSummary } from '@/lib/diagnostics/formatter';
import { normalizeMcpRequest } from '@/lib/validation';
import type { KubernetesSnapshot } from '@/types/mcp';
import * as k8s from '@kubernetes/client-node';

describe('bounded cluster collection', () => {
  it('follows exact controller ownership instead of matching name prefixes', () => {
    const controllers = [{ kind: 'Deployment', metadata: { name: 'api' } }, { kind: 'Deployment', metadata: { name: 'api-worker' } },
      { kind: 'ReplicaSet', metadata: { name: 'api-abc', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'api', uid: 'api' }] } }];
    const pods = [{ metadata: { name: 'unrelated-name', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'api-abc', uid: 'rs' }] } },
      { metadata: { name: 'api-worker-pod', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'api-worker', uid: 'other' }] } }];
    expect(selectOwnedPods(pods, controllers, 'api')).toEqual([pods[0]]);
    expect(() => selectOwnedPods(pods, controllers, 'ap')).toThrow();
  });
  it('paginates and marks oversized resource lists incomplete', async () => {
    const seen: unknown[] = [];
    const api = boundedApi({ async listPods(params: Record<string, unknown>) { seen.push(params); return { items: Array.from({ length: 500 }, (_, i) => i), metadata: { _continue: 'next' } }; } });
    const result = await api.listPods({ namespace: 'team' });
    expect(result.items).toHaveLength(2000); expect(seen).toHaveLength(4); expect(result.metadata._continue).toBe('next');
    expect(seen[1]).toMatchObject({ _continue: 'next', limit: 500 });
  });
  it('attaches a transport abort signal', async () => {
    const request = new k8s.RequestContext('https://cluster.example', k8s.HttpMethod.GET);
    const result = await requestOptions().middleware![0].pre(request).toPromise();
    expect(result.getSignal()).toBeDefined();
  });
  it('does not count successful jobs or historical restarts as unhealthy pods', () => {
    const scope = normalizeMcpRequest({}).input_context;
    const base = { namespace: 'default', name: 'pod', labels: {}, ownerReferences: [], conditions: [{ type: 'Ready', status: 'True' }], containers: [], initContainers: [], restartCount: 2, readyContainers: 0 };
    const snapshot: KubernetesSnapshot = { namespace: 'default', collectedAt: new Date().toISOString(), pods: [{ ...base, phase: 'Succeeded' }, { ...base, name: 'recovered', phase: 'Running' }], workloads: [], services: [], events: [], logs: [], nodes: [], hpas: [], pvcs: [], cronJobs: [], accessErrors: [] };
    expect(buildSummary(scope, snapshot, []).unhealthyPods).toBe(0);
    snapshot.pods[1].conditions = [{ type: 'Ready', status: 'False' }];
    expect(buildSummary(scope, snapshot, []).unhealthyPods).toBe(1);
  });
});
