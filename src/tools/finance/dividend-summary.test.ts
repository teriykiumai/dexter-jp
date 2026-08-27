import { afterEach, describe, expect, test } from 'bun:test';
import {
  getDividendSummary,
  resolveDividendSourceEligibleDate,
  type DividendSummarySourceRow,
} from './dividend-summary.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function sourceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DiscDate: '2026-05-15',
    DiscTime: '15:00:00',
    Code: '72030',
    DiscNo: '20260515000001',
    CurFYEn: '2027-03-31',
    NxtFYEn: '2028-03-31',
    DivAnn: '90.0',
    PayoutRatioAnn: '0.321',
    FDivAnn: '100.0',
    FPayoutRatioAnn: '0.35',
    NxFDivAnn: '110.0',
    NxFPayoutRatioAnn: '0.36',
    ...overrides,
  };
}

function parseToolData(result: unknown): unknown {
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

describe('getDividendSummary', () => {
  test('describes source-only amount, ratio, missing, and plan semantics', () => {
    expect(getDividendSummary.description).toContain('actual and company-forecast');
    expect(getDividendSummary.description).toContain('JPY per share');
    expect(getDividendSummary.description).toContain('0.321 means 32.1%');
    expect(getDividendSummary.description).toContain('latest twelve weeks');
    expect(getDividendSummary.description).toContain('does not calculate dividend yield');
    expect(getDividendSummary.description).toContain('unavailable, not zero');
  });

  test('maps only the fixed dividend fields with source units and normalized code', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const request = { url: '', apiKey: null as string | null };
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      request.url = String(input);
      request.apiKey = new Headers(init?.headers).get('x-api-key');
      return new Response(JSON.stringify({ data: [sourceRow({ Unrelated: 'omit me' })] }));
    }) as unknown as typeof fetch;

    const result = await getDividendSummary.invoke({ ticker: '7203' });

    const url = new URL(request.url);
    expect(url.pathname).toBe('/v2/fins/summary');
    expect(url.searchParams.get('code')).toBe('72030');
    expect(url.searchParams.has('date')).toBe(false);
    expect(request.apiKey).toBe('secret-test-key');
    expect(request.url).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('Unrelated');
    expect(parseToolData(result)).toEqual([{
      issuerCode: '72030',
      disclosedDate: '2026-05-15',
      disclosedTime: '15:00:00',
      disclosureNumber: '20260515000001',
      currentFiscalYearEndDate: '2027-03-31',
      nextFiscalYearEndDate: '2028-03-31',
      actualAnnualDividendPerShare: 90,
      actualPayoutRatio: 0.321,
      forecastAnnualDividendPerShare: 100,
      forecastPayoutRatio: 0.35,
      nextForecastAnnualDividendPerShare: 110,
      nextForecastPayoutRatio: 0.36,
    }]);
  });

  test('normalizes legacy HH:MM times and preserves canonical HH:MM:SS times', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
      sourceRow({ DiscTime: '15:30', DiscNo: '20260515000001' }),
      sourceRow({ DiscTime: '16:00:45', DiscNo: '20260515000002' }),
    ] }))) as unknown as typeof fetch;

    const result = await getDividendSummary.invoke({ ticker: '7203' });
    const rows = parseToolData(result) as DividendSummarySourceRow[];

    expect(rows.map((row) => row.disclosedTime)).toEqual([
      '15:30:00',
      '16:00:45',
    ]);
  });

  test('preserves zero and finite negative source values while mapping blanks to null', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [sourceRow({
      DiscTime: '',
      NxtFYEn: '-',
      DivAnn: 0,
      PayoutRatioAnn: '',
      FDivAnn: null,
      FPayoutRatioAnn: '-',
      NxFDivAnn: -1,
      NxFPayoutRatioAnn: -0.1,
    })] }))) as unknown as typeof fetch;

    const result = await getDividendSummary.invoke({ ticker: '7203' });

    expect(parseToolData(result)).toEqual([{
      issuerCode: '72030',
      disclosedDate: '2026-05-15',
      disclosedTime: null,
      disclosureNumber: '20260515000001',
      currentFiscalYearEndDate: '2027-03-31',
      nextFiscalYearEndDate: null,
      actualAnnualDividendPerShare: 0,
      actualPayoutRatio: null,
      forecastAnnualDividendPerShare: null,
      forecastPayoutRatio: null,
      nextForecastAnnualDividendPerShare: -1,
      nextForecastPayoutRatio: -0.1,
    }]);
  });

  test('combines pagination in source order without calculating eligibility', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({
          data: [sourceRow({ DiscDate: '2026-05-14', DiscNo: '20260514000001' })],
          pagination_key: 'next-page',
        }));
      }
      return new Response(JSON.stringify({ data: [
        sourceRow({ DiscDate: '2026-05-15', DiscNo: '20260515000002' }),
      ] }));
    }) as unknown as typeof fetch;

    const result = await getDividendSummary.invoke({ ticker: '7203' });
    const rows = parseToolData(result) as Array<Record<string, unknown>>;

    expect(rows.map((row) => row.disclosureNumber)).toEqual([
      '20260514000001',
      '20260515000002',
    ]);
    expect(new URL(requestedUrls[1]).searchParams.get('pagination_key')).toBe('next-page');
    expect(String(result)).not.toContain('sourceEligibleDate');
  });

  test('separates Premium D+1 eligibility from a Free runtime history omission', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const calendar = [
      { date: '2026-05-15', holidayDivision: '1' },
      { date: '2026-05-18', holidayDivision: '1' },
    ];

    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [sourceRow()],
    }))) as unknown as typeof fetch;
    const premiumResult = await getDividendSummary.invoke({ ticker: '7203' });

    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;
    const freeResult = await getDividendSummary.invoke({ ticker: '7203' });

    expect(resolveDividendSourceEligibleDate('2026-05-15', calendar)).toBe('2026-05-18');
    expect(parseToolData(premiumResult)).toHaveLength(1);
    expect(parseToolData(freeResult)).toEqual({
      error: 'No eligible dividend financial-summary data returned for 7203',
      reason: 'no_eligible_dividend_disclosure_data',
    });
    expect(String(freeResult)).not.toContain('actualAnnualDividendPerShare');
    expect(String(freeResult)).not.toContain('actualPayoutRatio');
  });

  test('rejects malformed source rows and mismatched issuer identity', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const invalidRows = [
      sourceRow({ DiscDate: '2026-02-30' }),
      sourceRow({ DiscTime: '9:00' }),
      sourceRow({ DiscTime: '24:00' }),
      sourceRow({ DiscTime: '15:60' }),
      sourceRow({ DiscTime: '15:30:60' }),
      sourceRow({ DiscTime: '15:30:00.000' }),
      sourceRow({ DivAnn: 'not-a-number' }),
      sourceRow({ FDivAnn: 'Infinity' }),
      sourceRow({ Code: '67580' }),
    ];

    for (const row of invalidRows) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: [row] }))) as unknown as typeof fetch;
      await expect(getDividendSummary.invoke({ ticker: '7203' })).rejects.toMatchObject({
        name: 'JQuantsApiError',
        kind: 'invalid_response',
      });
    }
  });

  test('preserves plan-unavailable errors without exposing the API key', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'This API is not available on your subscription.',
    }), { status: 403 })) as unknown as typeof fetch;

    try {
      await getDividendSummary.invoke({ ticker: '7203' });
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

describe('resolveDividendSourceEligibleDate', () => {
  test('makes a disclosure eligible only on the following official business day', () => {
    const calendar = [
      { date: '2026-05-15', holidayDivision: '1' },
      { date: '2026-05-16', holidayDivision: '0' },
      { date: '2026-05-17', holidayDivision: '0' },
      { date: '2026-05-18', holidayDivision: '1' },
    ];

    const eligibleDate = resolveDividendSourceEligibleDate('2026-05-15', calendar);

    expect(eligibleDate).toBe('2026-05-18');
    expect(eligibleDate! <= '2026-05-15').toBeFalse();
    expect(eligibleDate! <= '2026-05-18').toBeTrue();
  });

  test('accepts half-day sessions and does not depend on calendar ordering', () => {
    const calendar = [
      { date: '2026-05-20', holidayDivision: '1' },
      { date: '2026-05-19', holidayDivision: '2' },
      { date: '2026-05-18', holidayDivision: '0' },
    ];

    expect(resolveDividendSourceEligibleDate('2026-05-18', calendar)).toBe('2026-05-19');
  });

  test('returns null for insufficient official calendar coverage', () => {
    expect(resolveDividendSourceEligibleDate('2026-05-15', [
      { date: '2026-05-15', holidayDivision: '1' },
      { date: '2026-05-16', holidayDivision: '0' },
    ])).toBeNull();
  });

  test('does not mutate the supplied calendar', () => {
    const calendar = [
      { date: '2026-05-19', holidayDivision: '1' },
      { date: '2026-05-18', holidayDivision: '0' },
    ];
    const before = structuredClone(calendar);

    const eligibleDate = resolveDividendSourceEligibleDate('2026-05-15', calendar);

    expect(eligibleDate).toBe('2026-05-19');
    expect(calendar).toEqual(before);
  });

  test('rejects invalid source or calendar values', () => {
    expect(() => resolveDividendSourceEligibleDate('2026-02-30', [])).toThrow(RangeError);
    expect(() => resolveDividendSourceEligibleDate('2026-05-15', [
      { date: 'bad-date', holidayDivision: '1' },
    ])).toThrow(RangeError);
    expect(() => resolveDividendSourceEligibleDate('2026-05-15', [
      { date: '2026-05-18', holidayDivision: '9' },
    ])).toThrow(RangeError);
  });
});
