import { describe, expect, it } from 'vitest';
import { parseIntentJson } from '../parser';

describe('parseIntentJson', () => {
  it('validates a fixture LLM JSON response', () => {
    const intent = parseIntentJson(
      JSON.stringify({
        namespace: 'production',
        workload: 'checkout',
        labelSelector: null,
        focus: ['pods', 'service-endpoints', 'logs'],
        symptoms: ['checkout returns 503s'],
        includeNodes: false,
        includeLogs: true,
        enableAiSummary: true,
        confidence: 'high',
        ambiguities: [],
        timeHint: 'since last deploy',
      }),
    );

    expect(intent.namespace).toBe('production');
    expect(intent.workload).toBe('checkout');
    expect(intent.focus).toContain('service-endpoints');
    expect(intent.confidence).toBe('high');
  });

  it('accepts JSON wrapped in a code fence', () => {
    const intent = parseIntentJson(
      [
        '```json',
        '{"namespace":null,"workload":null,"focus":["node-health"],"symptoms":["nodes under memory pressure"],"includeNodes":true,"includeLogs":false,"enableAiSummary":true,"confidence":"low","ambiguities":["Which namespace?"]}',
        '```',
      ].join('\n'),
    );

    expect(intent.focus).toEqual(['node-health']);
    expect(intent.includeNodes).toBe(true);
    expect(intent.confidence).toBe('low');
  });

  it('rejects unsupported focus values', () => {
    expect(() =>
      parseIntentJson(
        JSON.stringify({
          focus: ['made-up-focus'],
          symptoms: [],
          includeNodes: false,
          includeLogs: true,
          enableAiSummary: true,
          confidence: 'high',
          ambiguities: [],
        }),
      ),
    ).toThrow();
  });
});
