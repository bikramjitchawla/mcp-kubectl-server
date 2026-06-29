import { describe, expect, it } from 'vitest';
import { resolveIntent } from '../resolver';
import { ClusterInventory, ExtractedIntent } from '../types';

const inventory: ClusterInventory = {
  namespaces: ['default', 'production', 'staging'],
  workloads: [
    { namespace: 'production', kind: 'Deployment', name: 'checkout' },
    { namespace: 'staging', kind: 'Deployment', name: 'checkout' },
    { namespace: 'production', kind: 'StatefulSet', name: 'payments-worker' },
    { namespace: 'default', kind: 'DaemonSet', name: 'node-exporter' },
  ],
};

function intent(overrides: Partial<ExtractedIntent>): ExtractedIntent {
  return {
    namespace: null,
    workload: null,
    labelSelector: null,
    focus: ['pods'],
    symptoms: [],
    includeNodes: false,
    includeLogs: true,
    enableAiSummary: true,
    confidence: 'high',
    ambiguities: [],
    ...overrides,
  };
}

describe('resolveIntent', () => {
  it('resolves an exact namespace and workload', () => {
    const result = resolveIntent({
      intent: intent({ namespace: 'production', workload: 'checkout' }),
      inventory,
      context: 'kind-test-cluster',
    });

    expect(result.requiresConfirmation).toBe(false);
    expect(result.resolvedContext?.namespace).toBe('production');
    expect(result.resolvedContext?.workload).toBe('checkout');
    expect(result.resolvedContext?.context).toBe('kind-test-cluster');
  });

  it('requires confirmation when a workload exists in multiple namespaces', () => {
    const result = resolveIntent({
      intent: intent({ workload: 'checkout' }),
      inventory,
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.resolvedContext).toBeNull();
    expect(result.clarificationOptions?.field).toBe('namespace');
    expect(result.clarificationOptions?.options.map((option) => option.value)).toContain('production');
    expect(result.clarificationOptions?.options.map((option) => option.value)).toContain('staging');
  });

  it('infers a namespace when the workload is unique', () => {
    const result = resolveIntent({
      intent: intent({ workload: 'payments-worker' }),
      inventory,
    });

    expect(result.resolvedContext?.namespace).toBe('production');
    expect(result.resolvedContext?.workload).toBe('payments-worker');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.intent?.confidence).toBe('medium');
  });

  it('rejects a namespace that is not in the inventory', () => {
    const result = resolveIntent({
      intent: intent({ namespace: 'prod', workload: 'checkout' }),
      inventory,
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.resolvedContext).toBeNull();
    expect(result.intent?.confidence).toBe('low');
    expect(result.confirmationPrompt).toContain('prod');
  });

  it('sets node and log flags from focus and symptoms', () => {
    const result = resolveIntent({
      intent: intent({
        namespace: 'default',
        focus: ['node-health', 'resource-pressure'],
        symptoms: ['nodes seem under memory pressure'],
        includeLogs: false,
        includeNodes: false,
      }),
      inventory,
    });

    expect(result.resolvedContext?.includeNodes).toBe(true);
    expect(result.resolvedContext?.includeLogs).toBe(false);
  });

  it('enables logs for crash symptoms even if includeLogs is false', () => {
    const result = resolveIntent({
      intent: intent({
        namespace: 'production',
        workload: 'checkout',
        symptoms: ['checkout keeps restarting'],
        includeLogs: false,
      }),
      inventory,
    });

    expect(result.resolvedContext?.includeLogs).toBe(true);
  });
});
