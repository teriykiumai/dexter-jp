import { afterEach, describe, expect, test } from 'bun:test';
import { getDividendEvents } from './dividend-events.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function sourceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PubDate: '2026-05-15',
    PubTime: '15:30',
    Code: '72030',
    RefNo: '202605151B00001',
    StatCode: '1',
    BoardDate: '2026-05-15',
    IFCode: '2',
    FRCode: '1',
    IFTerm: '2026-03',
    DivRate: '50.0',
    RecDate: '2026-03-31',
    ExDate: '2026-03-30',
    ActRecDate: '2026-03-31',
    PayDate: '2026-06-01',
    CARefNo: '202605151B00001',
    DistAmt: 'omit me',
    CommSpecCode: '3',
    CommDivRate: '5.0',
    SpecDivRate: '10.0',
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

describe('getDividendEvents', () => {
  test('documents Premium, source-only, component, and no-aggregation semantics', () => {
    expect(getDividendEvents.description).toContain('Premium-only');
    expect(getDividendEvents.description).toContain('TSE-listed');
    expect(getDividendEvents.description).toContain('2022-06-06');
    expect(getDividendEvents.description).toContain('does not replay updates');
    expect(getDividendEvents.description).toContain('aggregate annual amounts');
    expect(getDividendEvents.description).toContain('event_source_plan_unavailable');
    expect(getDividendEvents.description).toContain('unavailable, not zero');
  });

  test('maps only the fixed official event fields using a normalized issuer code', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const request = { url: '', apiKey: null as string | null };
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      request.url = String(input);
      request.apiKey = new Headers(init?.headers).get('x-api-key');
      return new Response(JSON.stringify({ data: [sourceRow()] }));
    }) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '7203' });
    const url = new URL(request.url);

    expect(url.pathname).toBe('/v2/fins/dividend');
    expect(url.searchParams.get('code')).toBe('72030');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(request.apiKey).toBe('secret-test-key');
    expect(request.url).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('secret-test-key');
    expect(String(result)).not.toContain('DistAmt');
    expect(String(result)).not.toContain('omit me');
    expect(parseToolData(result)).toEqual([{
      notifiedDate: '2026-05-15',
      notifiedTime: '15:30',
      issuerCode: '72030',
      referenceNumber: '202605151B00001',
      statusCode: '1',
      kindCode: '2',
      decisionCode: '1',
      recordDateYearMonth: '2026-03',
      dividendPerShare: 50,
      recordDate: '2026-03-31',
      exDate: '2026-03-30',
      rightsRecordDate: '2026-03-31',
      paymentDate: '2026-06-01',
      corporateActionReferenceNumber: '202605151B00001',
      componentCode: '3',
      commemorativeDividendPerShare: 5,
      specialDividendPerShare: 10,
    }]);
    expect(String(result)).not.toContain('ordinaryDividendPerShare');
    expect(String(result)).not.toContain('sourceEligibleDate');
  });

  test('supports normalized alphanumeric J-Quants issuer codes', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedCodes: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      const code = new URL(String(input)).searchParams.get('code');
      if (code !== null) requestedCodes.push(code);
      return new Response(JSON.stringify({ data: [sourceRow({ Code: '130A0' })] }));
    }) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '130A' });

    expect(requestedCodes).toEqual(['130A0']);
    expect((parseToolData(result) as Array<{ issuerCode: string }>)[0].issuerCode).toBe('130A0');
  });

  test('maps blanks to null while preserving valid zero and finite negative source values', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [sourceRow({
      PubTime: '',
      DivRate: 0,
      RecDate: '',
      ExDate: '-',
      ActRecDate: null,
      PayDate: '-',
      CommDivRate: -1,
      SpecDivRate: '0',
    })] }))) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '7203' });

    expect(parseToolData(result)).toEqual([expect.objectContaining({
      notifiedTime: null,
      dividendPerShare: 0,
      recordDate: null,
      exDate: null,
      rightsRecordDate: null,
      paymentDate: null,
      commemorativeDividendPerShare: -1,
      specialDividendPerShare: 0,
    })]);
  });

  test('combines pagination in source order without replaying notifications', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({
          data: [sourceRow()],
          pagination_key: 'next-page',
        }));
      }
      return new Response(JSON.stringify({ data: [sourceRow({
        PubDate: '2026-05-16',
        RefNo: '202605161B00002',
        StatCode: '2',
      })] }));
    }) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '7203' });
    const rows = parseToolData(result) as Array<{ referenceNumber: string; statusCode: string }>;

    expect(rows).toEqual([
      expect.objectContaining({ referenceNumber: '202605151B00001', statusCode: '1' }),
      expect.objectContaining({ referenceNumber: '202605161B00002', statusCode: '2' }),
    ]);
    expect(new URL(requestedUrls[1]).searchParams.get('pagination_key')).toBe('next-page');
  });

  test('keeps an empty successful response unavailable rather than zero', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '7203' });

    expect(parseToolData(result)).toEqual({
      error: 'No eligible dividend-event data returned for 7203',
      reason: 'no_eligible_dividend_event_data',
    });
    expect(String(result)).not.toContain('dividendPerShare');
  });

  test('rejects malformed identity, codes, dates, times, and numbers', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const invalidRows = [
      sourceRow({ Code: '67580' }),
      sourceRow({ PubDate: '2026-02-30' }),
      sourceRow({ PubTime: '15:30:00' }),
      sourceRow({ IFTerm: '2026-13' }),
      sourceRow({ StatCode: '4' }),
      sourceRow({ IFCode: '3' }),
      sourceRow({ FRCode: '0' }),
      sourceRow({ CommSpecCode: '4' }),
      sourceRow({ DivRate: 'Infinity' }),
      sourceRow({ RecDate: 'bad-date' }),
    ];

    for (const row of invalidRows) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: [row] }))) as unknown as typeof fetch;
      await expect(getDividendEvents.invoke({ ticker: '7203' })).rejects.toMatchObject({
        name: 'JQuantsApiError',
        kind: 'invalid_response',
      });
    }
  });

  test('returns typed Premium plan unavailability without exposing the API key', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      message: 'This API is not available on your subscription.',
    }), { status: 403 })) as unknown as typeof fetch;

    const result = await getDividendEvents.invoke({ ticker: '7203' });
    expect(parseToolData(result)).toEqual({
      error: 'Dividend-event data is unavailable for the current J-Quants plan.',
      reason: 'event_source_plan_unavailable',
    });
    expect(String(result)).not.toContain('secret-test-key');
  });
});
