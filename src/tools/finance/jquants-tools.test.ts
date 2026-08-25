import { afterEach, describe, expect, test } from 'bun:test';
import { getInvestorTypeFlows } from './investor-type-flows.js';
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

function investorTypeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PubDate: '2026-05-14',
    StDate: '2026-05-04',
    EnDate: '2026-05-08',
    Section: 'TokyoNagoya',
    PropSell: 10,
    PropBuy: 12,
    PropTot: 22,
    PropBal: 2,
    BrkSell: 100,
    BrkBuy: 100,
    BrkTot: 200,
    BrkBal: 0,
    TotSell: 110,
    TotBuy: 112,
    TotTot: 222,
    TotBal: 2,
    IndSell: 20,
    IndBuy: 15,
    IndTot: 35,
    IndBal: -5,
    FrgnSell: 30,
    FrgnBuy: 40,
    FrgnTot: 70,
    FrgnBal: 10,
    SecCoSell: 5,
    SecCoBuy: 4,
    SecCoTot: 9,
    SecCoBal: -1,
    InvTrSell: 6,
    InvTrBuy: 8,
    InvTrTot: 14,
    InvTrBal: 2,
    BusCoSell: 10,
    BusCoBuy: 9,
    BusCoTot: 19,
    BusCoBal: -1,
    OthCoSell: 4,
    OthCoBuy: 5,
    OthCoTot: 9,
    OthCoBal: 1,
    InsCoSell: 3,
    InsCoBuy: 2,
    InsCoTot: 5,
    InsCoBal: -1,
    BankSell: 7,
    BankBuy: 6,
    BankTot: 13,
    BankBal: -1,
    TrstBnkSell: 8,
    TrstBnkBuy: 7,
    TrstBnkTot: 15,
    TrstBnkBal: -1,
    OthFinSell: 7,
    OthFinBuy: 4,
    OthFinTot: 11,
    OthFinBal: -3,
    ...overrides,
  };
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
  test('preserves investor-type market-context semantics in the tool description', () => {
    expect(getInvestorTypeFlows.description).toContain('Light plan or higher');
    expect(getInvestorTypeFlows.description).toContain('thousand JPY');
    expect(getInvestorTypeFlows.description).toContain('not evidence');
    expect(getInvestorTypeFlows.description).toContain('Correction rows remain separate');
    expect(getInvestorTypeFlows.description).toContain('does not mean buying, selling, or balance was zero');
  });

  test('preserves short-sale source semantics in the tool description', () => {
    expect(getShortSaleReports.description).toContain('0.5%');
    expect(getShortSaleReports.description).toContain('does not mean that the short position is zero');
    expect(getShortSaleReports.description).toContain('get_margin_data');
  });

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

  test('maps every investor-type category and publication-date parameter without recalculation', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const request = { url: '', apiKey: null as string | null };
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      request.url = String(input);
      request.apiKey = new Headers(init?.headers).get('x-api-key');
      return new Response(JSON.stringify({ data: [investorTypeRow({ PropTot: 999 })] }));
    }) as unknown as typeof fetch;

    const result = await getInvestorTypeFlows.invoke({
      section: 'TokyoNagoya',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    const url = new URL(request.url);
    expect(url.pathname).toBe('/v2/equities/investor-types');
    expect(url.searchParams.get('section')).toBe('TokyoNagoya');
    expect(url.searchParams.get('from')).toBe('2026-05-01');
    expect(url.searchParams.get('to')).toBe('2026-05-31');
    expect(url.searchParams.has('code')).toBe(false);
    expect(request.apiKey).toBe('secret-test-key');
    expect(request.url).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('secret-test-key');
    expect(parseToolResult(result)).toEqual([{
      publishedDate: '2026-05-14',
      periodStartDate: '2026-05-04',
      periodEndDate: '2026-05-08',
      section: 'TokyoNagoya',
      summary: {
        proprietary: { sell: 10, buy: 12, total: 999, balance: 2 },
        brokerage: { sell: 100, buy: 100, total: 200, balance: 0 },
        total: { sell: 110, buy: 112, total: 222, balance: 2 },
      },
      brokerageBreakdown: {
        individuals: { sell: 20, buy: 15, total: 35, balance: -5 },
        foreignInvestors: { sell: 30, buy: 40, total: 70, balance: 10 },
        securitiesCompanies: { sell: 5, buy: 4, total: 9, balance: -1 },
        investmentTrusts: { sell: 6, buy: 8, total: 14, balance: 2 },
        businessCorporations: { sell: 10, buy: 9, total: 19, balance: -1 },
        otherCorporations: { sell: 4, buy: 5, total: 9, balance: 1 },
        insuranceCompanies: { sell: 3, buy: 2, total: 5, balance: -1 },
        banks: { sell: 7, buy: 6, total: 13, balance: -1 },
        trustBanks: { sell: 8, buy: 7, total: 15, balance: -1 },
        otherFinancialInstitutions: { sell: 7, buy: 4, total: 11, balance: -3 },
      },
    }]);
  });

  test('keeps paginated investor-type correction rows separate', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({
          data: [investorTypeRow({ PubDate: '2023-03-30' })],
          pagination_key: 'corrected-page',
        }));
      }
      return new Response(JSON.stringify({
        data: [investorTypeRow({ PubDate: '2023-04-04', PropTot: 999 })],
      }));
    }) as unknown as typeof fetch;

    const result = await getInvestorTypeFlows.invoke({ section: 'TokyoNagoya' });
    const rows = parseToolResult(result) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.publishedDate)).toEqual(['2023-03-30', '2023-04-04']);
    expect((rows[0].summary as { proprietary: { total: number } }).proprietary.total).toBe(22);
    expect((rows[1].summary as { proprietary: { total: number } }).proprietary.total).toBe(999);
    expect(new URL(requestedUrls[1]).searchParams.get('pagination_key')).toBe('corrected-page');
    expect(String(result)).not.toContain('eligibleDate');
  });

  test('does not interpret an empty investor-type response as zero', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    mockData({ data: [] });

    const result = await getInvestorTypeFlows.invoke({ section: 'TokyoNagoya' });

    expect(parseToolResult(result)).toEqual({
      error: 'No investor-type market-section data found for the requested publication-date range',
      reason: 'no_investor_type_flow_data',
    });
    expect(String(result)).not.toContain('balance: 0');
  });

  test('preserves invalid-response and plan-unavailable errors for investor-type data', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: {} }))) as unknown as typeof fetch;

    await expect(getInvestorTypeFlows.invoke({ section: 'TokyoNagoya' })).rejects.toMatchObject({
      name: 'JQuantsApiError',
      kind: 'invalid_response',
    });

    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'This API is not available on your subscription.',
    }), { status: 403 })) as unknown as typeof fetch;

    try {
      await getInvestorTypeFlows.invoke({ section: 'TokyoNagoya' });
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
