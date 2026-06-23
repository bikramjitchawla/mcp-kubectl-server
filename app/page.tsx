'use client';

import { useEffect, useState } from 'react';
import { Activity, Bot, ChevronDown, ClipboardList, Clock, Loader2, Search, Server, ShieldCheck, Terminal } from 'lucide-react';
import { HistoryEntry } from '@/lib/store/history';
import { MCPResponse } from '@/types/mcp';

const defaultGoal = 'Diagnose failing workloads and produce an incident-ready remediation plan.';

export default function HomePage() {
  const [namespace, setNamespace] = useState('default');
  const [labelSelector, setLabelSelector] = useState('');
  const [workload, setWorkload] = useState('');
  const [goal, setGoal] = useState(defaultGoal);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [enableAiSummary, setEnableAiSummary] = useState(true);
  const [includeNodes, setIncludeNodes] = useState(true);
  const [context, setContext] = useState('');
  const [contexts, setContexts] = useState<string[]>([]);
  const [result, setResult] = useState<MCPResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/contexts')
      .then((r) => r.json())
      .then((data) => {
        setContexts(data.contexts ?? []);
        if (data.current) setContext(data.current);
      })
      .catch(() => {});

    fetch('/api/history')
      .then((r) => r.json())
      .then((data) => setHistory(data.runs ?? []))
      .catch(() => {});
  }, []);

  const runDiagnosis = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    const body = {
      agent: 'kubernetes-diagnoser',
      goal,
      tools: ['kubernetes-api', 'events', 'logs', 'runbook-generator'],
      input_context: {
        namespace,
        context: context || undefined,
        labelSelector: labelSelector || undefined,
        workload: workload || undefined,
        includeLogs,
        enableAiSummary,
        includeNodes,
        includeHpa: true,
        tailLines: 120,
        maxPods: 60,
      },
      output_expectation: {
        format: 'markdown',
        includes: ['root cause', 'evidence', 'remediation', 'automation commands'],
      },
    };

    const response = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.details ?? data.error ?? 'Diagnostic request failed');
    } else {
      setResult(data);
      // Refresh history after a successful run
      fetch('/api/history')
        .then((r) => r.json())
        .then((d) => setHistory(d.runs ?? []))
        .catch(() => {});
    }

    setLoading(false);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>Kubernetes Diagnostic MCP</h1>
            <p>Read-only incident triage for platform teams.</p>
          </div>
        </div>

        <div className="form-grid">
          {contexts.length > 0 && (
            <div className="field">
              <label htmlFor="context">Cluster context</label>
              <div className="select-wrap">
                <select id="context" value={context} onChange={(e) => setContext(e.target.value)}>
                  {contexts.map((ctx) => (
                    <option key={ctx} value={ctx}>{ctx}</option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="namespace">Namespace</label>
            <input id="namespace" value={namespace} onChange={(event) => setNamespace(event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="workload">Workload filter</label>
            <input
              id="workload"
              placeholder="api, checkout, worker"
              value={workload}
              onChange={(event) => setWorkload(event.target.value)}
            />
            <p className="helper">Matches pod or owner names.</p>
          </div>

          <div className="field">
            <label htmlFor="labels">Label selector</label>
            <input
              id="labels"
              placeholder="app=checkout,tier=backend"
              value={labelSelector}
              onChange={(event) => setLabelSelector(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="goal">Incident goal</label>
            <textarea id="goal" value={goal} onChange={(event) => setGoal(event.target.value)} />
          </div>

          <div className="toggles">
            <label className="toggle">
              <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />
              Collect recent logs from unhealthy pods
            </label>
            <label className="toggle">
              <input type="checkbox" checked={includeNodes} onChange={(event) => setIncludeNodes(event.target.checked)} />
              Include node health (requires ClusterRole)
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={enableAiSummary}
                onChange={(event) => setEnableAiSummary(event.target.checked)}
              />
              Generate AI incident narrative
            </label>
          </div>

          <button className="primary-button" onClick={runDiagnosis} disabled={loading}>
            {loading ? <Loader2 size={18} /> : <Search size={18} />}
            {loading ? 'Running diagnostics' : 'Run diagnostics'}
          </button>
        </div>

        <p className="meta">
          Uses kubeconfig or in-cluster identity. The current implementation only reads Kubernetes state and proposes commands.
        </p>

        {history.length > 0 && (
          <div className="history-panel">
            <h4><Clock size={14} /> Recent runs</h4>
            <ul className="history-list">
              {history.slice(0, 8).map((entry) => (
                <li key={entry.requestId}>
                  <button
                    className="history-item"
                    onClick={() => {
                      fetch(`/api/history/${entry.requestId}`)
                        .then((r) => r.json())
                        .then((data) => {
                          setResult(data);
                          setError('');
                        })
                        .catch(() => {});
                    }}
                  >
                    <span className={`status-dot ${entry.summary.health}`} />
                    <span className="history-ns">{entry.scope.namespace}</span>
                    <span className="history-time">{new Date(entry.generatedAt).toLocaleTimeString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <main className="content">
        <div className="toolbar">
          <div>
            <h2>Incident workspace</h2>
            <p className="helper">Collects pods, controllers, nodes, services, events, and logs, then produces evidence-backed findings.</p>
          </div>
          {result ? <span className={`status-pill ${result.summary.health}`}>{result.summary.health}</span> : null}
        </div>

        {error ? <div className="error">{error}</div> : null}

        {result ? (
          <>
            <section className="metric-grid" aria-label="diagnostic summary">
              <Metric label="Pods" value={String(result.summary.totalPods)} icon={<Activity size={18} />} />
              <Metric label="Unhealthy" value={String(result.summary.unhealthyPods)} icon={<ClipboardList size={18} />} />
              <Metric label="Warnings" value={String(result.summary.warningEvents)} icon={<Terminal size={18} />} />
              {result.snapshot.nodes.length > 0 && (
                <Metric label="Nodes" value={`${result.snapshot.nodes.length - result.summary.notReadyNodes}/${result.snapshot.nodes.length}`} icon={<Server size={18} />} />
              )}
              {result.snapshot.pvcs.length > 0 && (
                <Metric label="PVCs" value={`${result.snapshot.pvcs.filter(p => p.phase === 'Bound').length}/${result.snapshot.pvcs.length}`} icon={<Activity size={18} />} />
              )}
              <Metric label="AI" value={result.metadata.aiStatus} icon={<Bot size={18} />} />
            </section>

            <section className="panel">
              <h3>Top findings</h3>
              <div className="findings">
                {result.findings.slice(0, 6).map((finding) => (
                  <article className="finding" key={finding.id}>
                    <div className="finding-header">
                      <div className="finding-title">
                        <Activity size={18} />
                        <span>{finding.title}</span>
                      </div>
                      <span className={`severity ${finding.severity}`}>{finding.severity}</span>
                    </div>
                    <p className="helper">
                      {finding.resource.kind}/{finding.resource.name} · {finding.signal}
                    </p>
                    <ul className="list">
                      {finding.evidence.slice(0, 4).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="command-list">
                      {finding.automation.slice(0, 2).map((command) => (
                        <code className="command" key={command.command}>
                          {command.command}
                        </code>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <h3>Report</h3>
              <pre className="report">{result.output}</pre>
            </section>
          </>
        ) : (
          <section className="panel">
            <h3>Ready to diagnose</h3>
            <p className="helper">
              Start with a namespace, optionally narrow by workload or label selector, and run a read-only diagnostic pass.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <span>
        {icon} {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
