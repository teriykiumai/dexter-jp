import { afterEach, describe, expect, test } from 'bun:test';
import { getMarginData } from './margin-data.js';
import { getShortSaleReports } from './short-sale-report.js';
import { getStockPrice } from './stock-price.js';
import { getTopix } from './topix.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

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

  test('maps source-level short-sale reports and disclosure-date parameters', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const request = { url: '', apiKey: null as string | null };
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      request.url = String(input);
      request.apiKey = new Headers(init?.headers).get('x-api-key');
      return new Response(JSON.stringify({ data: [{
        DiscDate: '2026-05-20',
        CalcDate: '2026-05-19',
        Code: '72030',
        SSName: ' Reporter Name ',
        SSAddr: 'not returned',
        DICName: '',
        DICAddr: 'not returned',
        FundName: null,
        ShrtPosToSO: 0.0061,
        ShrtPosShares: 123400,
        ShrtPosUnits: 1234,
        PrevRptDate: '',
        PrevRptRatio: null,
        Notes: 'not returned',
      }] }));
    }) as unknown as typeof fetch;

    const result = await getShortSaleReports.invoke({
      ticker: '7203',
      disclosedDate: '2026-05-20',
      disclosedFrom: '2026-05-01',
      disclosedTo: '2026-05-31',
      calculatedDate: '2026-05-19',
    });

    const url = new URL(request.url);
    expect(url.pathname).toBe('/v2/markets/short-sale-report');
    expect(url.searchParams.get('code')).toBe('72030');
    expect(url.searchParams.get('disc_date')).toBe('2026-05-20');
    expect(url.searchParams.get('disc_date_from')).toBe('2026-05-01');
    expect(url.searchParams.get('disc_date_to')).toBe('2026-05-31');
    expect(url.searchParams.get('calc_date')).toBe('2026-05-19');
    expect(request.apiKey).toBe('secret-test-key');
    expect(request.url).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('secret-test-key');
    expect(parseToolResult(result)).toEqual([{
      disclosedDate: '2026-05-20',
      calculatedDate: '2026-05-19',
      code: '72030',
      reporterName: ' Reporter Name ',
      discretionaryManagerName: null,
      fundName: null,
      shortPositionRatio: 0.0061,
      shortPositionShares: 123400,
      previousCalculatedDate: null,
      previousReportedRatio: null,
    }]);
    expect(String(result)).not.toContain('not returned');
    expect(String(result)).not.toContain('ratioDelta');
  });

  test('combines paginated short-sale reports without inferring previous reports', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({
          data: [{
            DiscDate: '2026-05-20', CalcDate: '2026-05-19', Code: '72030',
            SSName: 'Reporter A', DICName: null, FundName: 'Fund A',
            ShrtPosToSO: 0.0061, ShrtPosShares: 123400,
            PrevRptDate: '2026-05-12', PrevRptRatio: 0.0058,
          }],
          pagination_key: 'next-page',
        }));
      }
      return new Response(JSON.stringify({ data: [{
        DiscDate: '2026-05-21', CalcDate: '2026-05-20', Code: '72030',
        SSName: 'Reporter B', DICName: 'Manager B', FundName: '',
        ShrtPosToSO: 0.007, ShrtPosShares: 140000,
        PrevRptDate: null, PrevRptRatio: null,
      }] }));
    }) as unknown as typeof fetch;

    const result = await getShortSaleReports.invoke({ ticker: '7203' });
    const reports = parseToolResult(result) as Array<Record<string, unknown>>;

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      reporterName: 'Reporter A',
      previousCalculatedDate: '2026-05-12',
      previousReportedRatio: 0.0058,
    });
    expect(reports[1]).toMatchObject({
      reporterName: 'Reporter B',
      discretionaryManagerName: 'Manager B',
      fundName: null,
    });
    expect(new URL(requestedUrls[1]).searchParams.get('pagination_key')).toBe('next-page');
  });

  test('does not interpret an empty short-sale report response as zero', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    mockData({ data: [] });

    const result = await getShortSaleReports.invoke({ ticker: '7203' });

    expect(parseToolResult(result)).toEqual({
      error: 'No public short-position disclosure data at or above the 0.5% reporting threshold found for 7203',
      reason: 'no_public_disclosure_data',
    });
    expect(String(result)).not.toContain('shortPositionRatio');
    expect(String(result)).not.toContain('shortPositionShares');
  });

  test('preserves J-Quants plan-unavailable errors for short-sale reports', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'This API is not available on your subscription.',
    }), { status: 403 })) as unknown as typeof fetch;

    try {
      await getShortSaleReports.invoke({ ticker: '7203' });
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'JQuantsApiError',
        kind: 'plan_unavailable',
        status: 403,
      });
      expect((error as Error).message).not.toContain('secret-test-key');
    }
  });
});
