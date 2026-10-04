'use client';
import { useEffect, useState } from 'react';
import type { MCPResponse } from '@/types/mcp';
import type { FixPlan } from '@/types/investigation';
import { useTenant } from './AuthGate';
import { apiFetch } from './api';

export function InvestigationPanel({ result }: { result: MCPResponse }) {
  const tenant = useTenant();
  const [plans, setPlans] = useState<FixPlan[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    setPlans([]); setError(''); setApproved({});
    apiFetch(`/api/fixes?runId=${encodeURIComponent(result.requestId)}`).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? 'Could not load fixes.');
      if (active) setPlans(data.plans ?? []);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [result.requestId]);
  async function act(id: string, body: unknown, endpoint = `/api/fixes/${id}`) {
    setBusy(id); setError('');
    try {
      const response = await apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Workflow failed.');
      setPlans(prev => [data, ...prev.filter(p => p.id !== data.id)]);
      setApproved(prev => ({ ...prev, [data.id]: false }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Workflow failed.'); }
    finally { setBusy(''); }
  }
  const investigation = result.investigation;
  return <>
    <section className="panel investigation-panel">
      <h3>What changed?</h3>
      {investigation ? <>
        <p className="helper">{investigation.baselineAt ? `Compared with ${new Date(investigation.baselineAt).toLocaleString()} · ${investigation.status}` : 'First observation for this scope'}</p>
        {investigation.status === 'compared' && !investigation.changes.length && <p>No configuration changes observed between these snapshots.</p>}
        <div className="change-list">{investigation.changes.map((c, i) => <article className="finding" key={i}>
          <strong>{c.resource.kind}/{c.resource.name}</strong><p className="helper">{c.field} · observed change</p>
          <pre className="change-before">− {JSON.stringify(c.before, null, 2)}</pre><pre className="change-after">+ {JSON.stringify(c.after, null, 2)}</pre>
        </article>)}</div>
        {!!investigation.metricChanges.length && <table className="evidence-table"><thead><tr><th>Metric</th><th>Before</th><th>Now</th></tr></thead><tbody>
          {investigation.metricChanges.map(m => <tr key={m.name}><td>{m.name}</td><td>{m.before.toPrecision(4)} {m.unit}</td><td>{m.after.toPrecision(4)} {m.unit}</td></tr>)}
        </tbody></table>}
        {investigation.hypotheses.map((h, i) => <div className="inline-panel" key={i}><strong>Hypothesis · low confidence</strong><p>{h.statement}</p><ul>{h.evidence.map(e => <li key={e}>{e}</li>)}</ul></div>)}
        <ul className="helper">{investigation.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {result.snapshot.metrics?.reason && <p className="helper">Metrics: {result.snapshot.metrics.reason}</p>}
      </> : <p className="helper">This older run has no comparison evidence. Run diagnostics to start an investigation.</p>}
    </section>
    <section className="panel investigation-panel">
      <h3>Related incidents</h3>
      {!result.incidents?.length && <p className="helper">No incident groups in this run.</p>}
      {result.incidents?.map(group => <article className="finding" key={group.id}>
        <strong>{group.title}</strong><p className="helper">{group.interpretation}</p>
        <ul>{result.findings.filter(f => group.findingIds.includes(f.id)).map(f => <li key={f.id}><span className={`severity ${f.severity}`}>{f.severity}</span> {f.title}</li>)}</ul>
        <details><summary>Dependency evidence ({group.edges.length})</summary><ul>{group.edges.map((e, i) => <li key={i}>{e.evidence}</li>)}</ul></details>
      </article>)}
    </section>
    <section className="panel investigation-panel">
      <h3>Fix and verify</h3>
      <p className="helper">Propose a reversion of Deployment images or resource settings to the comparison baseline. A healthy baseline and a related incident are required. Review in Git before merging.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="inline-actions">{result.snapshot.workloads.filter(w => w.kind === 'Deployment').map(w => <button className="secondary-button" key={w.name} disabled={tenant.role === 'viewer' || !!busy || !investigation?.baselineId}
        onClick={() => act(w.name, { runId: result.requestId, resource: { kind: w.kind, namespace: w.namespace, name: w.name } }, '/api/fixes')}>
        {busy === w.name ? 'Preparing…' : `Propose fix · ${w.name}`}
      </button>)}</div>
      {plans.map(plan => <article className="finding" key={plan.id}>
        <div className="finding-header"><strong>{plan.resource.namespace}/{plan.resource.name}</strong><span className="status-pill">{plan.status}</span></div>
        <p>{plan.rationale}</p>
        {plan.operations.map((op, i) => <div key={i}><p className="helper">{op.container}/{op.field}</p><pre className="command">{JSON.stringify(op.before)} → {JSON.stringify(op.after)}</pre></div>)}
        <details><summary>Recovery success criteria</summary><ul>{plan.successCriteria.map(c => <li key={c}>{c}</li>)}</ul></details>
        {plan.status === 'proposed' && <button className="secondary-button" disabled={tenant.role === 'viewer' || !!busy} onClick={() => act(plan.id, { action: 'preview' })}>Preview GitOps change</button>}
        {plan.preview && <>
          <p className="helper">{plan.target?.repository} · {plan.target?.branch} · {plan.target?.path}<br/>Base commit: {plan.preview.baseSha}</p>
          <pre className="command">{plan.preview.diff}</pre>
          {plan.preview.content && <details><summary>Full proposed manifest</summary><pre className="command">{plan.preview.content}</pre></details>}
          {plan.status === 'proposed' && <>
            <label className="toggle"><input type="checkbox" checked={!!approved[plan.id]} onChange={e => setApproved(p => ({ ...p, [plan.id]: e.target.checked }))}/>I reviewed this proposal and approve creating a pull request.</label>
            <button className="primary-button" disabled={tenant.role !== 'admin' || !!busy || !approved[plan.id]} onClick={() => act(plan.id, { action: 'publish', approvedDigest: plan.preview!.digest })}>Create review PR</button>
          </>}
        </>}
        {plan.pullRequest && <div className="inline-actions"><a href={plan.pullRequest.url} target="_blank" rel="noreferrer">Open PR #{plan.pullRequest.number}</a>
          <button className="secondary-button" disabled={tenant.role === 'viewer' || !!busy} onClick={() => act(plan.id, { action: 'verify' })}>Check recovery after merge</button></div>}
        {busy === plan.id && <p role="status">Working…</p>}
        {plan.verification.slice().reverse().map((v, i) => <div className="inline-panel" key={i}><strong>{v.status} · {new Date(v.at).toLocaleString()}</strong>
          <ul>{v.checks.map(c => <li key={c.name}>{c.passed === null ? 'Unknown' : c.passed ? 'Pass' : 'Fail'} — {c.name}: {c.detail}</li>)}</ul>
          {v.status === 'observing' && <p>Check again in at least 60 seconds to confirm sustained recovery.</p>}
        </div>)}
      </article>)}
    </section>
  </>;
}
