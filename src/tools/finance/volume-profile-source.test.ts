import { afterEach, describe, expect, test } from 'bun:test';
import { JQuantsApiError } from './jquants-client.js';
import {
  isVerifiedVolumeProfileSource,
  validateVolumeProfileSource,
} from './volume-profile-engine.js';
import {
  fetchVolumeProfileSourceInput,
  normalizeVolumeProfileSourceDate,
} from './volume-profile-source.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.JQUANTS_API_KEY;
  else process.env.JQUANTS_API_KEY = originalApiKey;
});

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function collectionDateInJapan(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

function priceRow(date: string, code: string, index: number) {
  const middle = 100 + index;
  return {
    Date: date,
    Code: code,
    AdjO: middle,
    AdjH: middle + 1,
    AdjL: middle - 1,
    AdjC: middle + 0.5,
    AdjVo: 1_000 + index,
    AdjFactor: index === 30 ? 0.5 : 1,
    ExRT: index === 30 ? '2' : null,
  };
}

describe('volume-profile source mapping', () => {
  test('normalizes only valid canonical or compact source dates', () => {
    expect(normalizeVolumeProfileSourceDate('20260827', 'from')).toBe('2026-08-27');
    expect(normalizeVolumeProfileSourceDate('2026-08-27', 'from')).toBe('2026-08-27');
    for (const invalid of ['2026--08-27', '2026-02-30', '2026082A']) {
      expect(() => normalizeVolumeProfileSourceDate(invalid, 'from')).toThrow(
        'from must be a valid YYYY-MM-DD or YYYYMMDD date.',
      );
    }
  });

  test('paginates both official sources and retains adjusted basis metadata', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const collectionDate = collectionDateInJapan();
    const from = shiftDate(collectionDate, -60);
    const dates = dateRange(from, collectionDate);
    const prices = dates.map((date, index) => priceRow(date, '72030', index));
    const calendar = dates.map((date) => ({ Date: date, HolDiv: '1' }));
    const requests: URL[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      const secondPage = url.searchParams.get('pagination_key') === 'next';
      const data = url.pathname.endsWith('/equities/bars/daily') ? prices : calendar;
      const midpoint = 30;
      return new Response(JSON.stringify({
        data: secondPage ? data.slice(midpoint) : data.slice(0, midpoint),
        ...(secondPage ? {} : { pagination_key: 'next' }),
      }));
    }) as typeof fetch;

    const source = validateVolumeProfileSource(
      await fetchVolumeProfileSourceInput({ ticker: '7203', from }),
    );

    expect(isVerifiedVolumeProfileSource(source)).toBe(true);
    expect(source.issuerCode).toBe('72030');
    expect(source.rows).toHaveLength(61);
    expect(source.rows[30]).toMatchObject({ AdjFactor: 0.5, ExRT: '2' });
    expect(source.basisAuditRequiredThroughDate).toBe(collectionDate);
    expect(source.basisAuditThroughDate).toBe(collectionDate);
    expect(source.provenance).toEqual({
      source: 'jquants',
      endpoint: '/v2/equities/bars/daily',
      availabilityCalendarEndpoint: '/v2/markets/calendar',
      mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
      basisAudit: 'collection_horizon_rights_audit_v1',
    });
    expect(requests.filter((url) => url.pathname.endsWith('/equities/bars/daily')))
      .toHaveLength(2);
    expect(requests.filter((url) => url.pathname.endsWith('/markets/calendar')))
      .toHaveLength(2);
    for (const url of requests) {
      expect(url.searchParams.get('from')).toBe(from);
      expect(url.searchParams.get('to')).toBe(collectionDate);
    }
    const priceRequests = requests.filter((url) => url.pathname.endsWith('/equities/bars/daily'));
    expect(priceRequests.every((url) => url.searchParams.get('code') === '72030')).toBe(true);
  });

  test('normalizes an alphanumeric JPX code before source retrieval', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const collectionDate = collectionDateInJapan();
    const from = shiftDate(collectionDate, -59);
    const dates = dateRange(from, collectionDate);
    const requestedCodes: Array<string | null> = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/equities/bars/daily')) {
        requestedCodes.push(url.searchParams.get('code'));
        return new Response(JSON.stringify({
          data: dates.map((date, index) => priceRow(date, '130A0', index)),
        }));
      }
      return new Response(JSON.stringify({
        data: dates.map((date) => ({ Date: date, HolDiv: '1' })),
      }));
    }) as typeof fetch;

    const source = validateVolumeProfileSource(
      await fetchVolumeProfileSourceInput({ ticker: '130A', from }),
    );

    expect(source.issuerCode).toBe('130A0');
    expect(requestedCodes).toEqual(['130A0']);
  });

  test('preserves typed J-Quants source errors without exposing the key', async () => {
    delete process.env.JQUANTS_API_KEY;
    await expect(fetchVolumeProfileSourceInput({
      ticker: '7203',
      from: '2026-01-01',
    })).rejects.toMatchObject({ name: 'JQuantsApiError', kind: 'missing_api_key' });

    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const cases: Array<{
      expected: { kind: string; status?: number };
      response: () => Promise<Response>;
    }> = [
      {
        expected: { kind: 'network_error' },
        response: async () => { throw new Error('network unavailable'); },
      },
      {
        expected: { kind: 'http_error', status: 500 },
        response: async () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }),
      },
      {
        expected: { kind: 'plan_unavailable', status: 403 },
        response: async () => new Response(JSON.stringify({ message: 'plan unavailable' }), { status: 403 }),
      },
      {
        expected: { kind: 'invalid_response', status: 200 },
        response: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
      },
    ];

    for (const { expected, response } of cases) {
      globalThis.fetch = (async () => response()) as unknown as typeof fetch;
      try {
        await fetchVolumeProfileSourceInput({ ticker: '7203', from: '2026-01-01' });
        throw new Error('Expected J-Quants source failure.');
      } catch (error) {
        expect(error).toBeInstanceOf(JQuantsApiError);
        expect(error).toMatchObject(expected);
        expect((error as Error).message).not.toContain('secret-test-key');
      }
    }
  });

  test('rejects malformed mapped OHLCV as an invalid source response', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const collectionDate = collectionDateInJapan();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/equities/bars/daily')) {
        return new Response(JSON.stringify({
          data: [{ ...priceRow(collectionDate, '72030', 0), AdjO: '100' }],
        }));
      }
      return new Response(JSON.stringify({
        data: [{ Date: collectionDate, HolDiv: '1' }],
      }));
    }) as typeof fetch;

    await expect(fetchVolumeProfileSourceInput({
      ticker: '7203',
      from: collectionDate,
    })).rejects.toMatchObject({
      name: 'JQuantsApiError',
      kind: 'invalid_response',
    });
  });
});
