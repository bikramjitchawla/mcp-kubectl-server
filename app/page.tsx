'use client';

import { AuthGate, useTenant } from './components/AuthGate';
import { InvestigationPanel } from './components/InvestigationPanel';
import { apiFetch } from './components/api';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, Bot, ChevronDown, ClipboardList, Clock, Loader2, Radar, Search, Server, ShieldCheck, Terminal } from 'lucide-react';
import { CommandBlock } from './components/CommandBlock';
import type { HistoryEntry } from '@/lib/store/history';
import type { DiagnosticScope, MCPResponse } from '@/types/mcp';
import type { ClarificationOptions, NLQParseResponse } from '@/lib/nlq/types';

const defaultGoal = 'Diagnose failing workloads and produce an incident-ready remediation plan.';
type InputMode = 'form' | 'query';

export default function HomePage() { return <AuthGate><Workspace /></AuthGate>; }

function Workspace() {
  const tenant = useTenant();
  const [namespace, setNamespace] = useState('default');
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [workload, setWorkload] = useState('');
  const [workloads, setWorkloads] = useState<{ name: string; kind: string }[]>([]);
  const [workloadsLoading, setWorkloadsLoading] = useState(false);
  const [labelSelector, setLabelSelector] = useState('');
  const [goal, setGoal] = useState(defaultGoal);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [enableAiSummary, setEnableAiSummary] = useState(tenant.allowAi);
  const [includeNodes, setIncludeNodes] = useState(tenant.allowNodes);
  const [context, setContext] = useState('');
  const [contexts, setContexts] = useState<string[]>([]);
  const [result, setResult] = useState<MCPResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('form');
  const [query, setQuery] = useState('');
  const [queryModeAvailable, setQueryModeAvailable] = useState(false);
  const [queryModeChecked, setQueryModeChecked] = useState(false);
  const [queryParsing, setQueryParsing] = useState(false);
  const [queryError, setQueryError] = useState('');
  const [nlqResponse, setNlqResponse] = useState<NLQParseResponse | null>(null);
  const [resolvedQueryContext, setResolvedQueryContext] = useState<DiagnosticScope | null>(null);

  const fetchWorkloads = (ns: string, resetSelection = true) => {
    setWorkloadsLoading(true);
    if (resetSelection) setWorkload('');
    apiFetch(`/api/workloads?namespace=${encodeURIComponent(ns)}`)
      .then((r) => r.json())
      .then((data) => setWorkloads(data.workloads ?? []))
      .catch(() => setWorkloads([]))
      .finally(() => setWorkloadsLoading(false));
  };

  useEffect(() => {
    apiFetch('/api/contexts')
      .then((r) => r.json())
      .then((data) => {
        setContexts(data.contexts ?? []);
        if (data.current) setContext(data.current);
      })
      .catch(() => {});

    apiFetch('/api/namespaces')
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.namespaces ?? [];
        setNamespaces(list);
        const initial = list.includes('default') ? 'default' : (list[0] ?? 'default');
        if (list.length > 0 && !list.includes(namespace)) setNamespace(initial);
        fetchWorkloads(list.includes('default') ? 'default' : (list[0] ?? 'default'));
      })
      .catch(() => {});

    apiFetch('/api/history')
      .then((r) => r.json())
      .then((data) => setHistory(data.runs ?? []))
      .catch(() => {});

    apiFetch('/api/nlq/parse')
      .then((r) => r.json())
      .then((data) => {
        setQueryModeAvailable(Boolean(data.enabled));
        const storedMode = window.localStorage.getItem('diagnostic-input-mode');
        if (storedMode === 'query' && data.enabled) setInputMode('query');
      })
      .catch(() => setQueryModeAvailable(false))
      .finally(() => setQueryModeChecked(true));
  }, []);

  const handleNamespaceChange = (ns: string) => {
    setNamespace(ns);
    fetchWorkloads(ns);
  };

  const setMode = (mode: InputMode) => {
    if (mode === 'query' && !queryModeAvailable) return;
    setInputMode(mode);
    window.localStorage.setItem('diagnostic-input-mode', mode);
  };

  const applyResolvedContext = (scope: DiagnosticScope) => {
    setNamespace(scope.namespace);
    fetchWorkloads(scope.namespace, false);
    setWorkload(scope.workload ?? '');
    setLabelSelector(scope.labelSelector ?? '');
    setIncludeLogs(scope.includeLogs);
    setIncludeNodes(scope.includeNodes && tenant.allowNodes);
    setEnableAiSummary(scope.enableAiSummary && tenant.allowAi);
  };

  const parseQuery = async () => {
    setQueryParsing(true);
    setQueryError('');
    setNlqResponse(null);
    setResolvedQueryContext(null);

    try {
      const response = await apiFetch('/api/nlq/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: context || undefined }),
      });
      const data: NLQParseResponse = await response.json();
      if (!response.ok || data.error) {
        setQueryError(data.error ?? 'Could not interpret the query');
        return;
      }

      setNlqResponse(data);
      if (data.resolvedContext) {
        setResolvedQueryContext(data.resolvedContext);
        applyResolvedContext(data.resolvedContext);
      }
    } catch {
      setQueryError('Natural language parsing failed. Retry or switch to form mode.');
    } finally {
      setQueryParsing(false);
    }
  };

  const chooseClarification = (scope: DiagnosticScope) => {
    setResolvedQueryContext(scope);
    applyResolvedContext(scope);
    setQueryError('');
    setNlqResponse((current) =>
      current
        ? {
            ...current,
            resolvedContext: scope,
            requiresConfirmation: true,
            confirmationPrompt: 'Review the interpreted diagnostic scope before running.',
            clarificationOptions: undefined,
          }
        : current,
    );
  };

  const editResolvedContext = () => {
    if (resolvedQueryContext) applyResolvedContext(resolvedQueryContext);
    setMode('form');
  };

  const runDiagnosis = async (scopeOverride?: DiagnosticScope) => {
    setLoading(true);
    setError('');
    setResult(null);
    const scope = scopeOverride
      ? {
          ...scopeOverride,
          includeLogs,
          includeNodes,
          enableAiSummary,
        }
      : {
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
        };

    const body = {
      agent: 'kubernetes-diagnoser',
      goal,
      tools: ['kubernetes-api', 'events', 'logs', 'runbook-generator'],
      input_context: scope,
      output_expectation: {
        format: 'markdown',
        includes: ['root cause', 'evidence', 'remediation', 'automation commands'],
      },
    };

    try {
    const response = await apiFetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.details ?? data.error ?? 'Diagnostic request failed');
    } else {
      setResult(data);
      if (data.metadata.aiStatus === 'pending') {
        void apiFetch(`/api/history/${encodeURIComponent(data.requestId)}/narrative`, { method: 'POST' })
          .then(async response => { if (!response.ok) throw new Error('AI summary could not be generated; diagnostic evidence is still available.'); return response.json(); })
          .then(updated => setResult(current => current?.requestId === updated.requestId ? updated : current))
          .catch(e => setError(e.message));
      }
      // Refresh history after a successful run
      apiFetch('/api/history')
        .then((r) => r.json())
        .then((d) => setHistory(d.runs ?? []))
        .catch(() => {});
    }

    } catch (e) { setError(e instanceof Error ? e.message : 'Diagnostic request failed'); }
    finally { setLoading(false); }
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
          {tenant.role === 'viewer' && <p className="helper">Viewer access: browse saved diagnostic runs. Ask an operator to collect new evidence.</p>}
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

          <div className="mode-toggle" aria-label="input mode">
            <button className={inputMode === 'form' ? 'active' : ''} onClick={() => setMode('form')} type="button">
              Form
            </button>
            <button
              className={inputMode === 'query' ? 'active' : ''}
              onClick={() => setMode('query')}
              disabled={!queryModeAvailable}
              title={!queryModeAvailable && queryModeChecked ? 'Requires GROQ_API_KEY or OPENAI_API_KEY' : undefined}
              type="button"
            >
              Query
            </button>
          </div>

          {inputMode === 'form' ? (
            <>
              <div className="field">
                <label htmlFor="namespace">Namespace</label>
                {namespaces.length > 0 ? (
                  <div className="select-wrap">
                    <select id="namespace" value={namespace} onChange={(e) => handleNamespaceChange(e.target.value)}>
                      {namespaces.map((ns) => (
                        <option key={ns} value={ns}>{ns}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                ) : (
                  <input id="namespace" value={namespace} onChange={(e) => handleNamespaceChange(e.target.value)} placeholder="default" />
                )}
              </div>

              <div className="field">
                <label htmlFor="workload">
                  Workload filter {workloadsLoading && <Loader2 size={12} className="spin-inline" />}
                </label>
                {workloads.length > 0 ? (
                  <div className="select-wrap">
                    <select id="workload" value={workload} onChange={(e) => setWorkload(e.target.value)}>
                      <option value="">All workloads</option>
                      {workloads.map((w) => (
                        <option key={`${w.kind}/${w.name}`} value={w.name}>
                          {w.name} ({w.kind})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                ) : (
                  <input
                    id="workload"
                    placeholder="api, checkout, worker"
                    value={workload}
                    onChange={(e) => setWorkload(e.target.value)}
                  />
                )}
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
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="query">Describe the incident</label>
                <textarea
                  id="query"
                  maxLength={500}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="checkout pods keep crashing since last deploy"
                />
              </div>

              {queryError ? <div className="error">{queryError}</div> : null}
              {nlqResponse?.clarificationOptions ? (
                <ClarificationPanel options={nlqResponse.clarificationOptions} onChoose={chooseClarification} />
              ) : null}
              {resolvedQueryContext ? (
                <ResolvedContextPanel
                  scope={resolvedQueryContext}
                  focus={nlqResponse?.intent?.focus ?? []}
                  prompt={nlqResponse?.confirmationPrompt}
                  onConfirm={() => runDiagnosis(resolvedQueryContext)}
                  onEdit={editResolvedContext}
                  loading={loading}
                />
              ) : null}
            </>
          )}

          <div className="toggles">
            <label className="toggle">
              <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />
              Collect recent logs from unhealthy pods
            </label>
            <label className="toggle">
              <input type="checkbox" checked={includeNodes} disabled={!tenant.allowNodes} onChange={(event) => setIncludeNodes(event.target.checked)} />
              Include node health (requires ClusterRole)
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={enableAiSummary}
                disabled={!tenant.allowAi}
                onChange={(event) => setEnableAiSummary(event.target.checked)}
              />
              Generate AI incident narrative
            </label>
          </div>

          {inputMode === 'form' ? (
            <button className="primary-button" onClick={() => runDiagnosis()} disabled={loading || tenant.role === 'viewer'}>
              {loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              {loading ? 'Running diagnostics' : 'Run diagnostics'}
            </button>
          ) : (
            <button className="primary-button" onClick={parseQuery} disabled={tenant.role === 'viewer' || queryParsing || !query.trim() || !queryModeAvailable}>
              {queryParsing ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              {queryParsing ? 'Interpreting query' : 'Interpret query'}
            </button>
          )}
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
                    aria-current={result?.requestId === entry.requestId}
                    onClick={() => {
                      apiFetch(`/api/history/${encodeURIComponent(entry.requestId)}`)
                        .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? 'Could not load run'); return data; })
                        .then((data) => {
                          setResult(data);
                          setError('');
                        })
                        .catch((e) => setError(e.message));
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
              <Metric
                label="Unhealthy"
                value={String(result.summary.unhealthyPods)}
                icon={<ClipboardList size={18} />}
                tone={result.summary.unhealthyPods > 0 ? 'danger' : 'success'}
              />
              <Metric
                label="Warnings"
                value={String(result.summary.warningEvents)}
                icon={<Terminal size={18} />}
                tone={result.summary.warningEvents > 0 ? 'warning' : 'success'}
              />
              {result.snapshot.nodes.length > 0 && (
                <Metric
                  label="Nodes"
                  value={`${result.snapshot.nodes.length - result.summary.notReadyNodes}/${result.snapshot.nodes.length}`}
                  icon={<Server size={18} />}
                  tone={result.summary.notReadyNodes > 0 ? 'danger' : 'success'}
                />
              )}
              {result.snapshot.pvcs.length > 0 && (
                <Metric label="PVCs" value={`${result.snapshot.pvcs.filter(p => p.phase === 'Bound').length}/${result.snapshot.pvcs.length}`} icon={<Activity size={18} />} />
              )}
              <Metric label="AI" value={result.metadata.aiStatus} icon={<Bot size={18} />} tone="muted" />
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
                        <CommandBlock command={command.command} key={command.command} />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <InvestigationPanel key={result.requestId} result={result} />

            <section className="panel">
              <h3>Report</h3>
              <div className="report-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.output}</ReactMarkdown>
              {result.aiNarrative && <><h3>AI narrative</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.aiNarrative}</ReactMarkdown></>}
              </div>
            </section>
          </>
        ) : loading ? (
          <DiagnosticSkeleton />
        ) : (
          <section className="panel">
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <Radar size={22} />
              </span>
              <h3>Ready to diagnose</h3>
              <p className="helper">
                Start with a namespace, optionally narrow by workload or label selector, and run a read-only diagnostic pass.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

type MetricTone = 'danger' | 'warning' | 'success' | 'muted';

function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: MetricTone;
}) {
  return (
    <div className="metric" data-tone={tone}>
      <span>
        {icon} {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

/** Keeps the workspace layout stable while a diagnostic pass is collecting evidence. */
function DiagnosticSkeleton() {
  return (
    <>
      <section className="metric-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="skeleton skeleton-metric" key={i} />
        ))}
      </section>
      <section className="panel" aria-busy="true">
        <h3>Collecting evidence</h3>
        <p className="helper" role="status">
          Reading pods, controllers, events and logs from the cluster…
        </p>
        <div className="skeleton-stack" style={{ marginTop: 16 }} aria-hidden="true">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
      </section>
    </>
  );
}

function ClarificationPanel({
  options,
  onChoose,
}: {
  options: ClarificationOptions;
  onChoose: (scope: DiagnosticScope) => void;
}) {
  return (
    <div className="inline-panel">
      <p>{options.prompt}</p>
      <div className="choice-list">
        {options.options.map((option) => (
          <button key={`${options.field}-${option.value}`} type="button" onClick={() => onChoose(option.resolvedContext)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResolvedContextPanel({
  scope,
  focus,
  prompt,
  onConfirm,
  onEdit,
  loading,
}: {
  scope: DiagnosticScope;
  focus: string[];
  prompt?: string | null;
  onConfirm: () => void;
  onEdit: () => void;
  loading: boolean;
}) {
  return (
    <div className="inline-panel">
      {prompt ? <p>{prompt}</p> : null}
      <dl className="resolved-grid">
        <div>
          <dt>Namespace</dt>
          <dd>{scope.namespace}</dd>
        </div>
        <div>
          <dt>Workload</dt>
          <dd>{scope.workload ?? 'All workloads'}</dd>
        </div>
        <div>
          <dt>Focus</dt>
          <dd>{focus.length > 0 ? focus.join(', ') : 'pods'}</dd>
        </div>
        <div>
          <dt>Logs</dt>
          <dd>{scope.includeLogs ? 'yes' : 'no'}</dd>
        </div>
      </dl>
      <div className="inline-actions">
        <button className="primary-button" type="button" onClick={onConfirm} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
          {loading ? 'Running diagnostics' : 'Confirm'}
        </button>
        <button className="secondary-button" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}
