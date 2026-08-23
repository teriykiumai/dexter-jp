import { describe, expect, test } from 'bun:test';
import {
  fetchPeerCohort,
  normalizeScreenerConditions,
  PEER_COHORT_METRICS,
} from './screen-companies.js';

describe('normalizeScreenerConditions', () => {
  test('preserves explicit screening conditions', () => {
    const input = {
      conditions: [{ metric: 'roe', operator: 'gte' as const, value: 10 }],
      industry: '輸送用機器',
      limit: 10,
    };

    expect(normalizeScreenerConditions(input)).toEqual(input);
  });

  test('adds a neutral revenue condition for an industry-only screen', () => {
    expect(normalizeScreenerConditions({
      conditions: [],
      industry: '輸送用機器',
    })).toEqual({
      conditions: [{ metric: 'revenue', operator: 'gte', value: 0 }],
      industry: '輸送用機器',
    });
  });
});

describe('fetchPeerCohort', () => {
  test('queries each metric independently and merges the same-sector union by ticker', async () => {
    const originalFetch = globalThis.fetch;
    const observedConditions: Array<Array<{ metric: string }>> = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      const conditions = JSON.parse(url.searchParams.get('conditions') ?? '[]') as Array<{
        metric: string;
      }>;
      observedConditions.push(conditions);
      const metric = conditions[0]?.metric;
      const companies = metric === 'per'
        ? [{ secCode: '22220', industry: '輸送用機器', per: 12 }]
        : [{ secCode: '11110', industry: '輸送用機器', [metric]: 10 }];

      return new Response(JSON.stringify({
        data: { companies },
        meta: { data_as_of: '2026-08-23' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    try {
      const result = await fetchPeerCohort('輸送用機器', 20);
      const payload = result.data.data as { companies: Array<Record<string, unknown>> };

      expect(observedConditions).toHaveLength(PEER_COHORT_METRICS.length);
      expect(observedConditions.every((conditions) => conditions.length === 1)).toBeTrue();
      expect(observedConditions.map(([condition]) => condition.metric)).toEqual([
        ...PEER_COHORT_METRICS,
      ]);
      expect(payload.companies.map((company) => company.secCode)).toEqual(['11110', '22220']);
      expect(payload.companies[0]).toMatchObject({ revenue: 10, pbr: 10, roe: 10 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
