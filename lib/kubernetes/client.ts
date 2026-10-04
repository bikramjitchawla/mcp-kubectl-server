import * as k8s from '@kubernetes/client-node';
import { currentPrincipal, requirePrincipal, AccessDenied } from '@/lib/tenancy/context';

export function tenantKubeConfig(context?: string) {
  const principal = currentPrincipal();
  const kc = new k8s.KubeConfig();
  if (!principal && process.env.NODE_ENV === 'test') { kc.loadFromDefault(); if (context) kc.setCurrentContext(context); return kc; }
  const { tenant } = requirePrincipal();
  if (context && context !== tenant.context) throw new AccessDenied('Cluster is outside this tenant.');
  // No default or in-cluster credential fallback: each tenant gets an explicit credential file.
  kc.loadFromFile(tenant.kubeconfig);
  if (!kc.getContextObject(tenant.context)) throw new Error('Tenant cluster context is unavailable.');
  kc.setCurrentContext(tenant.context);
  return kc;
}
export const requestOptions = (): k8s.ConfigurationOptions => ({ middleware: [{
  pre(context) {
    const signal = currentPrincipal()?.signal;
    context.setSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000));
    return new k8s.Observable(Promise.resolve(context));
  },
  post(context) { return new k8s.Observable(Promise.resolve(context)); },
}] });

// Read APIs only. Bound page size and total resources; propagate continuation as incomplete evidence.
export function boundedApi<T extends object>(api: T): T {
  return new Proxy(api, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function' || typeof property !== 'string' || !/^(list|read)/.test(property)) return method;
      return async (parameters: Record<string, unknown> = {}) => {
        const principal = currentPrincipal();
        if (principal) {
          if (property === 'listNode') {
            if (!principal.tenant.allowNodes) throw new AccessDenied('Node access is disabled for this tenant.');
          } else if (!property.includes('Namespaced') || !parameters.namespace || !principal.tenant.namespaces.includes(String(parameters.namespace))) {
            throw new AccessDenied('Resource access is outside this tenant.');
          }
        }
        if (!property.startsWith('list')) return method.call(target, parameters, requestOptions());
        let items: unknown[] = [], continuation: string | undefined;
        let response;
        do {
          response = await method.call(target, { ...parameters, limit: 500, _continue: continuation }, requestOptions());
          items = items.concat(response.items ?? []);
          continuation = response.metadata?._continue;
        } while (continuation && items.length < 2000);
        return { ...response, items, metadata: { ...response.metadata, _continue: continuation } };
      };
    },
  });
}
