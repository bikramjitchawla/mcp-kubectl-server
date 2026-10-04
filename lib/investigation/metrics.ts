import { currentPrincipal } from '@/lib/tenancy/context';
import type { KubernetesSnapshot } from '@/types/mcp';
import type { MetricsEvidence } from '@/types/investigation';

export async function collectMetrics(snapshot: KubernetesSnapshot): Promise<MetricsEvidence> {
  const result: MetricsEvidence = { status: 'disabled', collectedAt: snapshot.collectedAt, windowSeconds: 300, values: [] };
  const principal = currentPrincipal();
  const metrics = principal?.tenant.prometheus;
  const endpoint = principal ? metrics?.url : process.env.NODE_ENV === 'test' ? process.env.PROMETHEUS_URL : undefined;
  const context = principal ? principal.tenant.context : process.env.PROMETHEUS_CONTEXT;
  const token = principal ? (metrics?.tokenEnv ? process.env[metrics.tokenEnv] : undefined) : process.env.PROMETHEUS_TOKEN;
  if (!endpoint) return { ...result, reason: 'PROMETHEUS_URL is not configured.' };
  if (!snapshot.context || context !== snapshot.context)
    return { ...result, status: 'unavailable', reason: 'PROMETHEUS_CONTEXT must match the collected cluster context.' };
  if (!snapshot.pods.length || snapshot.coverage?.podsTruncated) return { ...result, status: 'unavailable', reason: 'No complete pod selection for metrics.' };
  const regex = snapshot.pods.map(p => p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const selector = `namespace=${JSON.stringify(snapshot.namespace)},pod=~${JSON.stringify(regex)},container!="",container!="POD"`;
  const queries = [
    { name: 'CPU usage (5m average)', unit: 'cores', query: `sum(rate(container_cpu_usage_seconds_total{${selector}}[5m]))` },
    { name: 'Memory working set (5m average)', unit: 'bytes', query: `sum(avg_over_time(container_memory_working_set_bytes{${selector}}[5m]))` },
  ];
  try {
    result.values = await Promise.all(queries.map(async metric => {
      const url = new URL('api/v1/query', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
      url.searchParams.set('query', metric.query); url.searchParams.set('time', snapshot.collectedAt); url.searchParams.set('timeout', '8s');
      const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Prometheus returned HTTP ${response.status}`);
      const body = await response.json();
      const sample = body.data?.result?.[0]?.value;
      if (body.status !== 'success' || body.data?.resultType !== 'vector' || !sample || !Number.isFinite(Number(sample[1]))) throw new Error('Prometheus has no valid samples for the selected pods.');
      return { name: metric.name, unit: metric.unit, value: Number(sample[1]) };
    }));
    return { ...result, status: 'available' };
  } catch (error) { return { ...result, status: 'unavailable', values: [], reason: error instanceof Error ? error.message : 'Metrics collection failed.' }; }
}
