import { createHash } from 'node:crypto';
import type { KubernetesSnapshot, DiagnosticFinding, KubernetesResourceRef } from '@/types/mcp';
import type { DependencyEdge, IncidentGroup } from '@/types/investigation';
import { resourceKey } from './compare';

export function groupIncidents(snapshot: KubernetesSnapshot, findings: DiagnosticFinding[]): IncidentGroup[] {
  const edges: DependencyEdge[] = [];
  const ref = (kind: string, name: string, namespace?: string) => ({ kind, name, namespace });
  const add = (from: KubernetesResourceRef, to: KubernetesResourceRef, relation: DependencyEdge['relation'], evidence: string) => edges.push({ from, to, relation, evidence });
  for (const w of snapshot.workloads) for (const owner of w.ownerReferences ?? []) add(w, owner, 'owned-by', `${w.kind}/${w.name} ownerReference points to ${owner.kind}/${owner.name}.`);
  for (const pod of snapshot.pods) {
    const p = ref('Pod', pod.name, pod.namespace);
    for (const owner of pod.ownerReferences) add(p, owner, 'owned-by', `Pod/${pod.name} ownerReference points to ${owner.kind}/${owner.name}.`);
    for (const service of snapshot.services) if (service.namespace === pod.namespace && Object.keys(service.selector).length && Object.entries(service.selector).every(([k, v]) => pod.labels[k] === v))
      add(p, ref('Service', service.name, service.namespace), 'selected-by', `Service/${service.name} selector ${JSON.stringify(service.selector)} matches Pod/${pod.name}.`);
    // Healthy shared infrastructure does not merge otherwise unrelated incidents.
    if (pod.nodeName && findings.some(f => f.resource.kind === 'Node' && f.resource.name === pod.nodeName))
      add(p, ref('Node', pod.nodeName), 'scheduled-on', `Pod/${pod.name} is scheduled on unhealthy Node/${pod.nodeName}.`);
    for (const claim of pod.persistentVolumeClaims ?? []) if (findings.some(f => f.resource.kind === 'PersistentVolumeClaim' && f.resource.name === claim && f.resource.namespace === pod.namespace))
      add(p, ref('PersistentVolumeClaim', claim, pod.namespace), 'mounts', `Pod/${pod.name} mounts PVC/${claim}, which has a diagnostic finding.`);
  }
  const parent = new Map<string, string>(), resources = new Map<string, KubernetesResourceRef>();
  const root = (k: string): string => { const p = parent.get(k); if (!p || p === k) return k; const r = root(p); parent.set(k, r); return r; };
  const register = (r: KubernetesResourceRef) => { const k = resourceKey(r); resources.set(k, { kind: r.kind, name: r.name, namespace: r.namespace }); return k; };
  for (const e of edges) parent.set(root(register(e.from)), root(register(e.to)));
  const groups = new Map<string, DiagnosticFinding[]>();
  for (const f of findings) { const k = root(register(f.resource)); groups.set(k, [...(groups.get(k) ?? []), f]); }
  return [...groups.entries()].map(([key, fs]) => {
    const members = [...resources.entries()].filter(([k]) => root(k) === key).map(([, r]) => r);
    const links = edges.filter(e => root(resourceKey(e.from)) === key);
    return { id: createHash('sha256').update(members.map(resourceKey).sort().join('|')).digest('hex').slice(0, 16),
      title: fs.length > 1 ? `${fs.length} related findings · ${fs[0].resource.name}` : fs[0].title,
      findingIds: fs.map(f => f.id), resources: members, edges: links,
      interpretation: links.length ? 'Grouped by observed resource dependencies. These links do not prove a common root cause.' : 'No dependency linking this finding to another incident was observed.',
    };
  });
}
