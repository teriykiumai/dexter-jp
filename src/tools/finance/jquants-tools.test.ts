import { afterEach, describe, expect, test } from 'bun:test';
import { getMarginData } from './margin-data.js';
import { getStockPrice } from './stock-price.js';
import { getTopix } from './topix.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];

function mockData(body: Record<string, unknown>): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

function parseToolResult(result: unknown): unknown {
  return JSON.parse(String(result)).data;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.JQUANTS_API_KEY;
  } else {
    process.env.JQUANTS_API_KEY = originalApiKey;
  }
});

describe('J-Quants finance tools', () => {
  test('maps 7203 adjusted OHLCV data', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let requestedUrl = '';
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ data: [{
        Date: '2026-05-20', Code: '72030', AdjO: 2800, AdjH: 2850,
        AdjL: 2780, AdjC: 2840, AdjVo: 12345600, Va: 35000000000,
      }] }));
    }) as unknown as typeof fetch;

    const result = await getStockPrice.invoke({
      ticker: '7203',
      from: '2026-05-20',
      to: '2026-05-20',
    });

    expect(new URL(requestedUrl).pathname).toBe('/v2/equities/bars/daily');
    expect(new URL(requestedUrl).searchParams.get('code')).toBe('72030');
    expect(parseToolResult(result)).toEqual([{
      date: '2026-05-20', open: 2800, high: 2850, low: 2780,
      close: 2840, volume: 12345600,
    }]);
  });

  test('maps 7203 weekly margin data', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let requestedUrl = '';
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ data: [{
        Date: '2026-05-15', Code: '72030', ShrtVol: 100, LongVol: 200,
        ShrtNegVol: 10, LongNegVol: 20, ShrtStdVol: 90, LongStdVol: 180,
        IssType: '1',
      }] }));
    }) as unknown as typeof fetch;

    const result = await getMarginData.invoke({
      ticker: '7203',
      from: '2026-05-01',
      to: '2026-05-20',
    });

    expect(new URL(requestedUrl).pathname).toBe('/v2/markets/margin-interest');
    expect(new URL(requestedUrl).searchParams.get('code')).toBe('72030');
    expect(parseToolResult(result)).toEqual([{
      date: '2026-05-15', code: '72030', shortBalance: 100, longBalance: 200,
      negotiableShortBalance: 10, negotiableLongBalance: 20,
      standardizedShortBalance: 90, standardizedLongBalance: 180,
      issueType: '1',
    }]);
  });

  test('maps TOPIX OHLC data', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let requestedUrl = '';
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ data: [{
        Date: '2026-05-20', O: 2800.1, H: 2820.2, L: 2790.3, C: 2810.4,
      }] }));
    }) as unknown as typeof fetch;

    const result = await getTopix.invoke({ from: '2026-05-20', to: '2026-05-20' });

    expect(new URL(requestedUrl).pathname).toBe('/v2/indices/bars/daily/topix');
    expect(new URL(requestedUrl).searchParams.has('code')).toBe(false);
    expect(parseToolResult(result)).toEqual([{
      date: '2026-05-20', open: 2800.1, high: 2820.2, low: 2790.3, close: 2810.4,
    }]);
  });

  test('returns an explicit missing-data state for an empty result', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    mockData({ data: [] });

    const result = await getMarginData.invoke({ ticker: '7203' });

    expect(parseToolResult(result)).toEqual({ error: 'No margin data found for 7203' });
  });
});
