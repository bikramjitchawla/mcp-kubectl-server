import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role, Tenant } from './config';
import type { DiagnosticScope } from '@/types/mcp';

export interface Principal { subject: string; tenant: Tenant; role: Role; method: 'oidc' | 'api-key'; signal?: AbortSignal }
const context = new AsyncLocalStorage<Principal>();
export const withPrincipal = <T>(principal: Principal, fn: () => T): T => context.run(principal, fn);
export const currentPrincipal = () => context.getStore();
export function requirePrincipal(): Principal {
  const principal = currentPrincipal();
  if (!principal) throw new Error('Authenticated tenant context is required.');
  return principal;
}
export function authorizeScope(scope: DiagnosticScope): DiagnosticScope {
  const principal = currentPrincipal();
  if (!principal && process.env.NODE_ENV === 'test') return scope;
  const { tenant } = requirePrincipal();
  if (!tenant.namespaces.includes(scope.namespace) || (scope.context && scope.context !== tenant.context)) {
    throw new AccessDenied('Cluster or namespace is outside this tenant.');
  }
  if (scope.includeNodes && !tenant.allowNodes) throw new AccessDenied('Node access is disabled for this tenant.');
  if (scope.enableAiSummary && !tenant.allowAi) throw new AccessDenied('AI processing is disabled for this tenant.');
  return { ...scope, context: tenant.context, includeClusterResources: false };
}
export class AccessDenied extends Error { readonly status = 403; }
