import { randomUUID } from 'node:crypto';
import type { MCPResponse, KubernetesResourceRef } from '@/types/mcp';
import type { FixPlan, FixOperation, Verification } from '@/types/investigation';
import { equal, resourceKey } from '@/lib/investigation/compare';
import { sameScope } from '@/lib/store/history';
import { groupIncidents } from '@/lib/investigation/group';

export function createPlan(current: MCPResponse, baseline: MCPResponse, resource: KubernetesResourceRef): FixPlan {
  if (!sameScope(current, baseline) || baseline.snapshot.collectedAt >= current.snapshot.collectedAt) throw new Error('A prior baseline in the same cluster and scope is required.');
  if (current.status !== 'ok' || baseline.status !== 'ok' || current.snapshot.coverage?.podsTruncated || baseline.snapshot.coverage?.podsTruncated)
    throw new Error('Complete collection is required to propose a fix.');
  if (resource.kind !== 'Deployment') throw new Error('Automatic fix proposals currently support Deployments only.');
  const before = baseline.snapshot.workloads.find(w => resourceKey(w) === resourceKey(resource));
  const after = current.snapshot.workloads.find(w => resourceKey(w) === resourceKey(resource));
  if (!before?.configuration || !after?.configuration || !before.uid || before.uid !== after.uid) throw new Error('Comparable configuration and unchanged resource identity are required.');
  if (before.desired < 1 || before.ready < before.desired || (before.available ?? 0) < before.desired || before.updated !== before.desired || before.generation === undefined || before.observedGeneration === undefined || before.generation !== before.observedGeneration)
    throw new Error('The baseline Deployment must have a completed, available rollout.');
  const previousGroups = baseline.incidents ?? groupIncidents(baseline.snapshot, baseline.findings);
  if (previousGroups.some(g => g.resources.some(r => resourceKey(r) === resourceKey(resource)))) throw new Error('The baseline has findings connected to this Deployment; it is not a healthy reference.');
  const currentGroups = current.incidents ?? groupIncidents(current.snapshot, current.findings);
  if (!currentGroups.some(g => g.resources.some(r => resourceKey(r) === resourceKey(resource)))) throw new Error('No observed incident is connected to this Deployment.');
  const operations: FixOperation[] = [];
  for (const c of after.configuration.containers) {
    const previous = before.configuration.containers.find(p => p.name === c.name);
    if (!previous) continue;
    for (const field of ['image', 'requests', 'limits'] as const)
      if (!equal(c[field], previous[field])) operations.push({ container: c.name, field, before: c[field], after: previous[field] });
  }
  if (!operations.length) throw new Error('No supported image or resource change can be reverted. Configuration fingerprints cannot safely reconstruct configuration values.');
  return { id: randomUUID(), createdAt: new Date().toISOString(), sourceRunId: current.requestId, baselineRunId: baseline.requestId,
    scope: { ...current.scope, context: current.snapshot.context }, resource: { kind: resource.kind, namespace: resource.namespace, name: resource.name }, operations,
    rationale: 'Candidate reversion of observed image/resource changes to a previously healthy Deployment. Correlation is not causation; review configuration compatibility and migration risks before merging.',
    successCriteria: ['PR is merged and the proposed fields are observed in the live Deployment.', 'Deployment generation is observed and all desired replicas are updated, ready, and available.',
      'No connected high/critical findings; selected pods are ready with no restart increase or new unhealthy pod replacement.',
      'Two complete successful observations at least 60 seconds apart, after a 120-second post-merge settling period.'],
    status: 'proposed', verification: [] };
}
export function verifyPlan(plan: FixPlan, source: MCPResponse, current: MCPResponse, priorRun?: MCPResponse, now = new Date()): Verification {
  const checks: Verification['checks'] = [];
  const add = (name: string, passed: boolean | null, detail: string) => checks.push({ name, passed, detail });
  const complete = current.status === 'ok' && !current.snapshot.coverage?.podsTruncated && sameScope(source, current);
  add('Complete matching scope', complete ? true : null, complete ? 'Complete evidence from the original cluster and scope.' : 'Missing evidence, truncated pods, or a different cluster/scope.');
  const mergedAt = plan.pullRequest?.mergedAt;
  const settled = !!mergedAt && now.getTime() - Date.parse(mergedAt) >= 120000 && Date.parse(current.snapshot.collectedAt) >= Date.parse(mergedAt) + 120000;
  add('Merged and settled', settled ? true : null, settled ? 'At least 120 seconds since merge.' : 'Wait for merge and the settling period.');
  const workload = current.snapshot.workloads.find(w => resourceKey(w) === resourceKey(plan.resource));
  add('Deployment observed', workload ? true : null, workload ? 'Target Deployment exists.' : 'A missing Deployment is not evidence of recovery.');
  const original = source.snapshot.workloads.find(w => resourceKey(w) === resourceKey(plan.resource));
  add('Resource identity', workload?.uid && original?.uid && workload.uid === original.uid ? true : null, 'Verification requires the original Deployment identity.');
  if (workload) {
    add('Proposed configuration applied', workload.configuration ? plan.operations.every(op => {
      const c = workload.configuration!.containers.find(c => c.name === op.container); return c && equal(c[op.field], op.after);
    }) : null, 'Every proposed image/resource field must match live state.');
    add('Rollout available', workload.generation !== undefined && workload.observedGeneration !== undefined ?
      workload.observedGeneration >= workload.generation && workload.desired > 0 && workload.ready >= workload.desired && (workload.available ?? 0) >= workload.desired && workload.updated === workload.desired : null,
      `${workload.ready}/${workload.desired} ready; ${workload.updated ?? '?'} updated; observed generation ${workload.observedGeneration ?? '?'}.`);
    const groups = groupIncidents(current.snapshot, current.findings);
    const linkedIds = groups.filter(g => g.resources.some(r => resourceKey(r) === resourceKey(plan.resource))).flatMap(g => g.findingIds);
    add('Connected severe findings cleared', !current.findings.some(f => linkedIds.includes(f.id) && ['critical', 'high'].includes(f.severity)), 'Check linked workload, pod, service, node, and PVC findings.');
    const replicaSets = current.snapshot.workloads.filter(w => w.kind === 'ReplicaSet' && w.ownerReferences?.some(r => resourceKey(r) === resourceKey(plan.resource)));
    const pods = current.snapshot.pods.filter(p => p.ownerReferences.some(r => replicaSets.some(rs => resourceKey(rs) === resourceKey(r))));
    add('Serving pods ready', pods.length ? pods.every(p => p.phase === 'Running' && p.conditions.some(c => c.type === 'Ready' && c.status === 'True') && p.containers.every(c => c.ready)) : null,
      pods.length ? `${pods.length} owned pods inspected.` : 'No owned pods collected.');
    if (priorRun) {
      const stable = pods.length > 0 && pods.every(p => {
        const prev = priorRun.snapshot.pods.find(x => x.uid && x.uid === p.uid);
        return prev ? p.restartCount <= prev.restartCount : false;
      });
      add('No new restarts', stable, 'Pod identities must remain stable across observations and restart counts must not increase.');
    } else add('No new restarts', null, 'A second observation is needed.');
  }
  const last = plan.verification.at(-1);
  const observationChecks = checks.filter(c => c.name !== 'No new restarts');
  const priorEligible = (last?.status === 'observing' || last?.status === 'passed') && priorRun?.requestId === last.runId && Date.parse(current.snapshot.collectedAt) - Date.parse(priorRun.snapshot.collectedAt) >= 60000;
  const missing = checks.some(c => c.passed === null && c.name !== 'No new restarts');
  const failed = checks.some(c => c.passed === false);
  const status: Verification['status'] = missing ? 'inconclusive' : failed ? 'failed' : priorEligible && checks.every(c => c.passed === true) ? 'passed' : observationChecks.every(c => c.passed === true) ? 'observing' : 'inconclusive';
  return { at: now.toISOString(), runId: current.requestId, status, checks };
}
