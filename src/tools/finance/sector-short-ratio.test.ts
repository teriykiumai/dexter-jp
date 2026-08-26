import { afterEach, describe, expect, test } from 'bun:test';
import {
  fetchSectorShortRatioSource,
  getSectorShortRatio,
} from './sector-short-ratio.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function response(data: unknown[], paginationKey?: string): Response {
  return new Response(JSON.stringify({
    data,
    ...(paginationKey ? { pagination_key: paginationKey } : {}),
  }));
}

function sourceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Date: '2026-05-20',
    S33: '3700',
    SellExShortVa: 100,
    ShrtWithResVa: 20,
    ShrtNoResVa: 30,
    ...overrides,
  };
}

function parseToolResult(result: unknown): unknown {
  return JSON.parse(String(result)).data;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.JQUANTS_API_KEY;
  else process.env.JQUANTS_API_KEY = originalApiKey;
});

describe('getSectorShortRatio', () => {
  test('documents sector-flow boundaries without an issuer claim or source calculation', () => {
    expect(getSectorShortRatio.description).toContain('sector-wide trading-flow');
    expect(getSectorShortRatio.description).toContain('not an issuer short position');
    expect(getSectorShortRatio.description).toContain('unavailable, not zero');
    expect(getSectorShortRatio.description).toContain('No ratio');
  });

  test('reuses an authoritative classification and maps paginated official fields exactly', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const requests: Array<{ url: URL; apiKey: string | null }> = [];
    let page = 0;
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      const url = new URL(String(input));
      requests.push({ url, apiKey: new Headers(init?.headers).get('x-api-key') });
      expect(url.pathname).toBe('/v2/markets/short-ratio');
      page += 1;
      return page === 1
        ? response([sourceRow({ Date: '2026-05-19' })], 'next-page')
        : response([
            sourceRow({ Date: '2026-05-21' }),
            sourceRow({ Date: '2026-05-20', SellExShortVa: null }),
          ]);
    }) as unknown as typeof fetch;

    const input = Object.freeze({
      analysisAsOfDate: '20260520',
      from: '2026-05-01',
      classification: Object.freeze({
        classificationDate: '2026-05-20',
        sectorCode: '3700' as const,
        sectorName: '輸送用機器',
      }),
    });
    const result = await fetchSectorShortRatioSource(input);

    expect(requests).toHaveLength(2);
    expect(requests[0].url.searchParams.get('s33')).toBe('3700');
    expect(requests[0].url.searchParams.get('from')).toBe('2026-05-01');
    expect(requests[0].url.searchParams.get('to')).toBe('2026-05-20');
    expect(requests[1].url.searchParams.get('pagination_key')).toBe('next-page');
    expect(requests.every(({ apiKey }) => apiKey === 'secret-test-key')).toBe(true);
    expect(requests.every(({ url }) => !String(url).includes('secret-test-key'))).toBe(true);
    expect(result).toEqual({
      analysisAsOfDate: '2026-05-20',
      classification: {
        classificationDate: '2026-05-20',
        sectorCode: '3700',
        sectorName: '輸送用機器',
      },
      rows: [
        {
          date: '2026-05-19', sectorCode: '3700',
          nonShortSellingValue: 100,
          restrictedShortSellingValue: 20,
          unrestrictedShortSellingValue: 30,
        },
        {
          date: '2026-05-20', sectorCode: '3700',
          nonShortSellingValue: null,
          restrictedShortSellingValue: 20,
          unrestrictedShortSellingValue: 30,
        },
      ],
      provenance: {
        classification: { source: 'jquants', endpoint: '/v2/equities/master' },
        flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
      },
    });
    expect(input.classification).toEqual({
      classificationDate: '2026-05-20',
      sectorCode: '3700',
      sectorName: '輸送用機器',
    });
  });

  test('uses the shared calendar/equity-master resolver in direct ticker mode', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const paths: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([{ Date: '2026-05-20', HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) {
        return response([{
          Date: '2026-05-20', Code: '72030', S33: '3700', S33Nm: '輸送用機器',
        }]);
      }
      return response([sourceRow()]);
    }) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorShortRatio.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
      from: '2026-05-01',
    }));

    expect(paths).toEqual([
      '/v2/markets/calendar',
      '/v2/equities/master',
      '/v2/markets/short-ratio',
    ]);
    expect(result).toMatchObject({
      classification: { sectorCode: '3700', sectorName: '輸送用機器' },
      rows: [{ date: '2026-05-20', sectorCode: '3700' }],
    });
  });

  test('keeps empty data typed unavailable and never reports zero', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => response([])) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorShortRatio.invoke({
      analysisAsOfDate: '2026-05-20',
      from: '2026-05-01',
      classification: {
        classificationDate: '2026-05-20', sectorCode: '3700', sectorName: '輸送用機器',
      },
    }));

    expect(result).toMatchObject({
      reason: 'no_sector_short_ratio_data',
      classification: { sectorCode: '3700' },
    });
    expect(JSON.stringify(result)).not.toContain('shortSellingRatio');
  });

  test('rejects bad boundaries, mismatched S33, duplicate dates, and plan errors', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return response([]);
    }) as unknown as typeof fetch;
    await expect(getSectorShortRatio.invoke({
      analysisAsOfDate: '2026-05-20',
      from: '2026-05-21',
      classification: {
        classificationDate: '2026-05-20', sectorCode: '3700', sectorName: '輸送用機器',
      },
    })).rejects.toThrow('from must be on or before analysisAsOfDate');
    expect(fetchCount).toBe(0);

    globalThis.fetch = (async () => response([sourceRow({ S33: '3650' })])) as unknown as typeof fetch;
    await expect(getSectorShortRatio.invoke({
      analysisAsOfDate: '2026-05-20', from: '2026-05-01',
      classification: {
        classificationDate: '2026-05-20', sectorCode: '3700', sectorName: '輸送用機器',
      },
    })).rejects.toMatchObject({ kind: 'invalid_response' });

    globalThis.fetch = (async () => response([
      sourceRow(), sourceRow(),
    ])) as unknown as typeof fetch;
    await expect(getSectorShortRatio.invoke({
      analysisAsOfDate: '2026-05-20', from: '2026-05-01',
      classification: {
        classificationDate: '2026-05-20', sectorCode: '3700', sectorName: '輸送用機器',
      },
    })).rejects.toMatchObject({ kind: 'invalid_response' });

    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'This API is not available on your subscription.',
    }), { status: 403 })) as unknown as typeof fetch;
    await expect(getSectorShortRatio.invoke({
      analysisAsOfDate: '2026-05-20', from: '2026-05-01',
      classification: {
        classificationDate: '2026-05-20', sectorCode: '3700', sectorName: '輸送用機器',
      },
    })).rejects.toMatchObject({ kind: 'plan_unavailable', status: 403 });
  });
});
