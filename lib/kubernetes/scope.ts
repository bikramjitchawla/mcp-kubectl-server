import type { V1Pod, V1ObjectMeta } from '@kubernetes/client-node';
import type { KubernetesSnapshot, DiagnosticScope } from '@/types/mcp';
interface Controller { kind: string; metadata?: V1ObjectMeta }
export function selectOwnedPods(pods: V1Pod[], controllers: Controller[], workload?: string): V1Pod[] {
  if (!workload) return pods;
  const roots = controllers.filter(c => c.metadata?.name === workload && c.kind !== 'ReplicaSet');
  if (roots.length !== 1) throw new Error('Workload name is missing or ambiguous. Select one exact controller name.');
  const owned = new Set([`${roots[0].kind}/${workload}`]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of controllers) {
      const key = `${c.kind}/${c.metadata?.name}`;
      if (!owned.has(key) && c.metadata?.ownerReferences?.some(o => owned.has(`${o.kind}/${o.name}`))) { owned.add(key); changed = true; }
    }
  }
  return pods.filter(p => p.metadata?.ownerReferences?.some(o => owned.has(`${o.kind}/${o.name}`)));
}
export function narrowSnapshot(snapshot: KubernetesSnapshot, scope: DiagnosticScope): KubernetesSnapshot {
  if (!scope.workload && !scope.labelSelector) return snapshot;
  const keys = new Set(snapshot.pods.map(p => `Pod/${p.name}`));
  snapshot.pods.forEach(p => p.ownerReferences.forEach(o => keys.add(`${o.kind}/${o.name}`)));
  if (scope.workload) snapshot.workloads.filter(w => w.name === scope.workload && w.kind !== 'ReplicaSet').forEach(w => keys.add(`${w.kind}/${w.name}`));
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of snapshot.workloads) {
      const key = `${w.kind}/${w.name}`;
      if (keys.has(key)) for (const owner of w.ownerReferences ?? []) {
        const parent = `${owner.kind}/${owner.name}`;
        if (!keys.has(parent)) { keys.add(parent); changed = true; }
      }
      if (scope.workload && !keys.has(key) && w.ownerReferences?.some(o => keys.has(`${o.kind}/${o.name}`))) { keys.add(key); changed = true; }
    }
  }
  snapshot.workloads = snapshot.workloads.filter(w => keys.has(`${w.kind}/${w.name}`));
  snapshot.services = snapshot.services.filter(s => Object.keys(s.selector).length && snapshot.pods.some(p => Object.entries(s.selector).every(([k,v]) => p.labels[k] === v)));
  snapshot.services.forEach(s => keys.add(`Service/${s.name}`));
  snapshot.hpas = snapshot.hpas.filter(h => keys.has(`${h.targetKind}/${h.targetName}`));
  snapshot.hpas.forEach(h => keys.add(`HorizontalPodAutoscaler/${h.name}`));
  snapshot.pvcs = snapshot.pvcs.filter(v => snapshot.pods.some(p => p.persistentVolumeClaims?.includes(v.name)));
  snapshot.pvcs.forEach(v => keys.add(`PersistentVolumeClaim/${v.name}`));
  snapshot.cronJobs = snapshot.cronJobs.filter(c => keys.has(`CronJob/${c.name}`));
  snapshot.nodes = snapshot.nodes.filter(n => snapshot.pods.some(p => p.nodeName === n.name));
  snapshot.nodes.forEach(n => keys.add(`Node/${n.name}`));
  snapshot.events = snapshot.events.filter(e => keys.has(`${e.involvedObject.kind}/${e.involvedObject.name}`));
  // Namespace-wide ConfigMap changes cannot be attributed to a selected workload from these fingerprints.
  snapshot.configMaps = [];
  return snapshot;
}
