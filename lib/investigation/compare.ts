import type { MCPResponse, KubernetesResourceRef } from '@/types/mcp';
import type { Investigation } from '@/types/investigation';
import { sameScope } from '@/lib/store/history';

export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.keys(a).sort(), y = Object.keys(b).sort();
  return x.length === y.length && x.every((k, i) => k === y[i] && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};
export const resourceKey = (r: KubernetesResourceRef) => `${r.namespace ?? ''}/${r.kind}/${r.name}`;
export function compareRuns(current: MCPResponse, baseline?: MCPResponse): Investigation {
  const result: Investigation = { status: 'no-baseline', changes: [], hypotheses: [], metricChanges: [], limitations: [] };
  if (!baseline || !sameScope(current, baseline)) {
    result.limitations.push('No earlier run with the same cluster and diagnostic scope. Run diagnostics again to establish a comparison.');
    return result;
  }
  result.baselineId = baseline.requestId; result.baselineAt = baseline.snapshot.collectedAt;
  if (current.status !== 'ok' || baseline.status !== 'ok' || current.snapshot.coverage?.podsTruncated || baseline.snapshot.coverage?.podsTruncated) {
    result.status = 'incomplete'; result.limitations.push('Collection is incomplete; changes and missing resources cannot be reliably inferred.'); return result;
  }
  result.status = 'compared';
  const record = (resource: KubernetesResourceRef, field: string, before: unknown, after: unknown) => {
    if (!equal(before, after)) result.changes.push({ resource, field, before: before ?? null, after: after ?? null, interpretation: 'observed-change' });
  };
  for (const w of current.snapshot.workloads.filter(w => w.kind !== 'ReplicaSet')) {
    const prev = baseline.snapshot.workloads.find(p => resourceKey(p) === resourceKey(w));
    if (!prev) { record(w, 'resource', null, 'added'); continue; }
    for (const field of ['uid', 'revision', 'desired'] as const) record(w, field, prev[field], w[field]);
    if (!prev.configuration || !w.configuration) { result.limitations.push(`Configuration evidence unavailable for ${w.kind}/${w.name}.`); continue; }
    record(w, 'templateHash', prev.configuration.templateHash, w.configuration.templateHash);
    const names = new Set([...prev.configuration.containers, ...w.configuration.containers].map(c => c.name));
    for (const name of names) {
      const a = prev.configuration.containers.find(c => c.name === name), b = w.configuration.containers.find(c => c.name === name);
      if (!a || !b) { record(w, `containers/${name}`, a ? 'present' : null, b ? 'present' : null); continue; }
      for (const field of ['image', 'requests', 'limits', 'configurationHash'] as const)
        record(w, `containers/${name}/${field}`, a[field], b[field]);
    }
  }
  for (const w of baseline.snapshot.workloads.filter(w => w.kind !== 'ReplicaSet'))
    if (!current.snapshot.workloads.some(c => resourceKey(c) === resourceKey(w))) record(w, 'resource', 'present', 'removed');
  if (baseline.snapshot.configMaps && current.snapshot.configMaps) {
    const names = new Set([...baseline.snapshot.configMaps, ...current.snapshot.configMaps].map(c => c.name));
    for (const name of names) record({ kind: 'ConfigMap', name, namespace: current.scope.namespace }, 'contentFingerprint',
      baseline.snapshot.configMaps.find(c => c.name === name)?.digest, current.snapshot.configMaps.find(c => c.name === name)?.digest);
  }
  for (const svc of current.snapshot.services) {
    const prev = baseline.snapshot.services.find(s => s.name === svc.name && s.namespace === svc.namespace);
    if (prev) for (const f of ['selector', 'ports'] as const) record({ ...svc, kind: 'Service' }, f, prev[f], svc[f]);
  }
  for (const group of current.incidents ?? []) {
    const changes = result.changes.filter(c => group.resources.some(r => resourceKey(r) === resourceKey(c.resource)));
    if (changes.length) result.hypotheses.push({
      statement: 'Configuration changes and current symptoms share a dependency group. The change may be relevant; causation is not established.',
      confidence: 'low', findingIds: group.findingIds,
      evidence: changes.map(c => `${c.resource.kind}/${c.resource.name}: ${c.field} changed between ${baseline.snapshot.collectedAt} and ${current.snapshot.collectedAt}`),
    });
  }
  const a = baseline.snapshot.metrics, b = current.snapshot.metrics;
  if (a?.status === 'available' && b?.status === 'available' && a.windowSeconds === b.windowSeconds) {
    for (const v of b.values) {
      const prev = a.values.find(x => x.name === v.name && x.unit === v.unit);
      if (prev) result.metricChanges.push({ name: v.name, before: prev.value, after: v.value, unit: v.unit });
    }
  } else result.limitations.push('Comparable metrics are unavailable; metrics require a configured Prometheus endpoint and samples in both runs.');
  result.limitations.push('Snapshots bound the observation interval; they do not identify the exact change time. Configuration values are fingerprinted, not exposed.');
  return result;
}
