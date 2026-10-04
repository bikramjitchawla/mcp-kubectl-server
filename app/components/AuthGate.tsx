'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from './api';
import { ThemeToggle } from './ThemeToggle';
interface Membership { id: string; name: string; role: 'viewer' | 'operator' | 'admin'; allowNodes: boolean; allowAi: boolean }
const TenantContext = createContext<Membership | null>(null);
export function useTenant() { const tenant = useContext(TenantContext); if (!tenant) throw new Error('Select a tenant.'); return tenant; }
export function AuthGate({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false);
  const [oidc, setOidc] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  async function load() {
    setError(''); setReady(false);
    try {
      const response = await apiFetch('/api/auth/session'); const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Authentication unavailable.');
      setOidc(data.oidc ?? data.method === 'oidc');
      const list: Membership[] = data.tenants ?? []; setMemberships(list);
      const stored = window.sessionStorage.getItem('diagnostics-tenant');
      const id = list.find(t => t.id === stored)?.id ?? list[0]?.id ?? '';
      window.sessionStorage.setItem('diagnostics-tenant', id); setSelected(id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load session.'); }
    finally { setReady(true); }
  }
  useEffect(() => {
    void load();
    const expired = () => { void load(); };
    window.addEventListener('diagnostics-session-expired', expired);
    return () => window.removeEventListener('diagnostics-session-expired', expired);
  }, []);
  const tenant = memberships.find(t => t.id === selected);
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.sessionStorage.removeItem('diagnostics-api-key'); window.sessionStorage.removeItem('diagnostics-tenant');
    setMemberships([]); setSelected(''); await load();
  }
  if (!ready) return <main className="auth-screen"><p role="status" className="auth-loading"><Loader2 size={16} className="spin" />Loading your workspace…</p></main>;
  if (!tenant) return <main className="auth-screen"><ThemeToggle /><section className="panel auth-card">
    <div className="brand">
      <div className="brand-mark" aria-hidden="true"><ShieldCheck size={24} /></div>
      <div><h1>Kubernetes diagnostics</h1><p>Read-only incident triage for platform teams.</p></div>
    </div>
    <p>Sign in to access your organization’s workspaces.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {oidc && <a className="primary-button" href="/api/auth/login">Sign in with your organization</a>}
    <details><summary>Use a tenant API key</summary><form onSubmit={e => { e.preventDefault(); window.sessionStorage.setItem('diagnostics-api-key', key); window.sessionStorage.removeItem('diagnostics-tenant'); void load(); }}>
      <label htmlFor="access-key">API key</label><input id="access-key" type="password" autoComplete="off" required value={key} onChange={e => setKey(e.target.value)} />
      <button type="submit" className="secondary-button">Connect</button>
    </form><button className="secondary-button" onClick={() => { window.sessionStorage.removeItem('diagnostics-api-key'); void load(); }}>Clear saved API key</button></details>
    {!oidc && !error && <p className="helper">Your administrator can configure organization sign-in or issue a tenant API key.</p>}
  </section></main>;
  return <TenantContext.Provider value={tenant}><div className="account-bar">
    <label>Workspace <select aria-label="Workspace" value={selected} onChange={e => { window.sessionStorage.setItem('diagnostics-tenant', e.target.value); setSelected(e.target.value); }}>
      {memberships.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select></label><span>{tenant.role}</span><ThemeToggle /><button className="secondary-button" onClick={() => void signOut()}>Sign out</button>
  </div><div key={tenant.id}>{children}</div></TenantContext.Provider>;
}
