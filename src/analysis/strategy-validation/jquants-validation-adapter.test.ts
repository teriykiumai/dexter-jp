import { describe, expect, test } from 'bun:test';
import {
  JQUANTS_REQUEST_TIMEOUT_MS_V1,
  JQuantsExecutionRuntimeV1,
  acceptJQuantsExecutionV1,
  planJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
} from './jquants-execution.js';
import { JQuantsValidationAdapterV1 } from './jquants-validation-adapter.js';

type Fetcher = JQuantsExecutionEnvironmentV1['fetch'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createAdapter(
  fetcher: Fetcher,
  options: Readonly<{ wallNowMs?: number; attemptLimit?: number }> = {},
): Readonly<{
  adapter: JQuantsValidationAdapterV1;
  runtime: JQuantsExecutionRuntimeV1;
  advanceWall: (durationMs: number) => void;
}> {
  let monotonicMs = 0;
  let wallNowMs = options.wallNowMs ?? Date.parse('2026-08-31T00:00:00.000Z');
  const environment: JQuantsExecutionEnvironmentV1 = Object.freeze({
    fetch: fetcher,
    wallNowMs: () => wallNowMs,
    monotonicNowMs: () => monotonicMs,
    sleep: (durationMs, signal) => {
      if (signal !== undefined && durationMs === JQUANTS_REQUEST_TIMEOUT_MS_V1) {
        return new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      if (signal?.aborted) return Promise.reject(signal.reason);
      monotonicMs += durationMs;
      wallNowMs += durationMs;
      return Promise.resolve();
    },
    apiKey: () => 'test-jquants-key',
  });
  const accepted = acceptJQuantsExecutionV1(planJQuantsExecutionV1(3, 500), environment);
  const runtime = new JQuantsExecutionRuntimeV1(accepted, {
    environment,
    actualAttemptLimit: options.attemptLimit,
  });
  return Object.freeze({
    adapter: new JQuantsValidationAdapterV1(runtime),
    runtime,
    advanceWall: (durationMs: number) => { wallNowMs += durationMs; },
  });
}

const CUTOFF = '2026-08-29T14:59:59.999Z';

function tradedBar(date: string, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    Date: date,
    Code: '72030',
    O: 100,
    H: 110,
    L: 90,
    C: 105,
    UL: '0',
    LL: '0',
    AdjFactor: 1,
    ExRT: null,
    ...overrides,
  };
}

describe('JQuantsValidationAdapterV1', () => {
  test('uses only the three exact endpoint/query shapes and maps allowlisted fields', async () => {
    const urls: URL[] = [];
    const { adapter, runtime } = createAdapter(async input => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === '/v2/markets/calendar') {
        return jsonResponse({ data: [
          { Date: '2026-08-28', HolDiv: '1', Ignored: 'calendar-secret' },
          { Date: '2026-08-29', HolDiv: '0', Ignored: 'calendar-secret' },
          { Date: '2026-08-30', HolDiv: 'invalid-future', Ignored: 'future' },
        ] });
      }
      if (url.pathname === '/v2/equities/master') {
        return jsonResponse({ data: [
          {
            Date: '2026-08-28', Code: '72030', ScaleCat: 'TOPIX Core30',
            Mkt: '0111', ProdCat: '011', CoName: 'ignored issuer name',
          },
          {
            Date: '2026-08-29', Code: 123, ScaleCat: 999,
            Mkt: null, ProdCat: null,
          },
        ] });
      }
      return jsonResponse({ data: [
        tradedBar('2026-08-28', { IgnoredAdjustedClose: 999 }),
        tradedBar('2026-08-29', {
          O: null, H: null, L: null, C: null, UL: null, LL: null,
        }),
        tradedBar('2026-08-30', {
          Code: 'wrong-future', O: 'invalid-future', ExRT: 'invalid-future',
        }),
      ] });
    });

    const calendar = await adapter.fetchCalendar({
      dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
    });
    const master = await adapter.fetchMaster({
      ticker: '7203', date: '2026-08-28', asOfCutoff: CUTOFF,
    });
    const bars = await adapter.fetchDailyBars({
      ticker: '7203', dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
    });

    expect(calendar.state).toBe('available');
    if (calendar.state === 'available') {
      expect(calendar.calendar.sessions.map(String)).toEqual(['2026-08-28']);
      expect(calendar.envelope.result.rows).toEqual([
        { Date: '2026-08-28', HolDiv: '1' },
        { Date: '2026-08-29', HolDiv: '0' },
      ]);
    }
    expect(master.state).toBe('available');
    if (master.state === 'available') {
      expect(String(master.observation.date)).toBe('2026-08-28');
      expect(master.observation).toMatchObject({
        code: '72030',
        ticker: '7203',
        scaleCategory: 'TOPIX Core30',
        tickCategory: 'topix_core30',
        marketCode: '0111',
        productCategory: '011',
      });
      expect(master.envelope.result.rows[0]).not.toHaveProperty('CoName');
    }
    expect(bars.state).toBe('available');
    if (bars.state === 'available') {
      expect(bars.bars).toHaveLength(2);
      expect(bars.bars[1]).toMatchObject({
        date: '2026-08-29', open: null, upperLimitFlag: null, adjustmentFactor: 1,
      });
      expect(bars.envelope.result.rows).toHaveLength(2);
      expect(bars.envelope.result.rows[0]).not.toHaveProperty('IgnoredAdjustedClose');
    }
    expect(urls.map(url => [url.pathname, [...url.searchParams]])).toEqual([
      ['/v2/markets/calendar', [['from', '2026-08-28'], ['to', '2026-08-29']]],
      ['/v2/equities/master', [['code', '72030'], ['date', '2026-08-28']]],
      ['/v2/equities/bars/daily', [
        ['code', '72030'], ['from', '2026-08-28'], ['to', '2026-08-29'],
      ]],
    ]);
    expect(runtime.attempts).toHaveLength(3);
  });

  test('accepts supported alphanumeric tickers without coercion', async () => {
    const requested: URL[] = [];
    const { adapter } = createAdapter(async input => {
      requested.push(new URL(String(input)));
      return jsonResponse({ data: [{
        Date: '2026-08-28', Code: '130A0', ScaleCat: 'その他', Mkt: '0111', ProdCat: '011',
      }] });
    });
    const result = await adapter.fetchMaster({
      ticker: '130A', date: '2026-08-28', asOfCutoff: CUTOFF,
    });
    expect(result.state).toBe('available');
    if (result.state === 'available') expect(result.observation.tickCategory).toBe('other');
    expect(requested[0]?.searchParams.get('code')).toBe('130A0');
  });

  test('treats non-domestic products and empty endpoint rows as explicit unavailable states', async () => {
    const nonDomestic = createAdapter(async () => jsonResponse({ data: [{
      Date: '2026-08-28', Code: '72030', ScaleCat: 'TOPIX Core30',
      Mkt: '0111', ProdCat: '999',
    }] })).adapter;
    await expect(nonDomestic.fetchMaster({
      ticker: '7203', date: '2026-08-28', asOfCutoff: CUTOFF,
    })).resolves.toMatchObject({
      state: 'unavailable', reason: 'source_history_unavailable',
      envelope: { result: { state: 'unavailable', rows: [] } },
    });

    const empty = createAdapter(async () => jsonResponse({ data: [] })).adapter;
    await expect(empty.fetchDailyBars({
      ticker: '7203', dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
    })).resolves.toMatchObject({ state: 'unavailable', reason: 'source_history_unavailable' });
  });

  test('maps plan restrictions to a sanitized unavailable envelope without retry', async () => {
    let calls = 0;
    const { adapter, runtime } = createAdapter(async () => {
      calls += 1;
      return jsonResponse({ message: 'This API is not available on your subscription. secret' }, 403);
    });
    const result = await adapter.fetchCalendar({
      dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
    });
    expect(result).toMatchObject({
      state: 'unavailable',
      reason: 'source_plan_unavailable',
      envelope: { result: { state: 'unavailable', reason: 'source_plan_unavailable', rows: [] } },
    });
    expect(calls).toBe(1);
    expect(runtime.attempts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('subscription');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test('keeps an unrecognized 403 fatal and sanitizes invalid-key response content', async () => {
    let calls = 0;
    const secret = 'invalid-secret-api-key';
    const { adapter, runtime } = createAdapter(async () => {
      calls += 1;
      return jsonResponse({ message: `Invalid API key: ${secret} at /private/path` }, 403);
    });
    try {
      await adapter.fetchCalendar({
        dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
      });
      throw new Error('Expected an unrecognized 403 to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'http_error', status: 403 });
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain('private');
      expect(message).not.toContain('Invalid API key');
    }
    expect(calls).toBe(1);
    expect(runtime.attempts).toHaveLength(1);
  });

  test('rejects master date/ticker conflicts, duplicate identities, and missing market evidence', async () => {
    const cases = [
      [{ Date: '2026-08-27', Code: '72030', ScaleCat: 'その他', Mkt: '0111', ProdCat: '011' }],
      [{ Date: '2026-08-28', Code: '67580', ScaleCat: 'その他', Mkt: '0111', ProdCat: '011' }],
      [
        { Date: '2026-08-28', Code: '72030', ScaleCat: 'その他', Mkt: '0111', ProdCat: '011' },
        { Date: '2026-08-28', Code: '72030', ScaleCat: 'その他', Mkt: '0111', ProdCat: '011' },
      ],
      [{ Date: '2026-08-28', Code: '72030', ScaleCat: 'その他', Mkt: '', ProdCat: '011' }],
    ] as const;
    for (const rows of cases) {
      const { adapter } = createAdapter(async () => jsonResponse({ data: rows }));
      await expect(adapter.fetchMaster({
        ticker: '7203', date: '2026-08-28', asOfCutoff: CUTOFF,
      })).rejects.toMatchObject({ code: 'source_response_invalid' });
    }
  });

  test('rejects duplicate calendar and daily identities, including pagination duplicates', async () => {
    const duplicateCalendar = createAdapter(async () => jsonResponse({ data: [
      { Date: '2026-08-28', HolDiv: '1' },
      { Date: '2026-08-28', HolDiv: '1' },
      { Date: '2026-08-29', HolDiv: '0' },
    ] })).adapter;
    await expect(duplicateCalendar.fetchCalendar({
      dateFrom: '2026-08-28', dateTo: '2026-08-29', asOfCutoff: CUTOFF,
    })).rejects.toMatchObject({ code: 'source_response_invalid' });

    let page = 0;
    const duplicateDaily = createAdapter(async () => {
      page += 1;
      return page === 1
        ? jsonResponse({ data: [tradedBar('2026-08-28')], pagination_key: 'next' })
        : jsonResponse({ data: [tradedBar('2026-08-28')] });
    }).adapter;
    await expect(duplicateDaily.fetchDailyBars({
      ticker: '7203', dateFrom: '2026-08-28', dateTo: '2026-08-28', asOfCutoff: CUTOFF,
    })).rejects.toMatchObject({ code: 'source_response_invalid' });
  });

  test('filters future rows before used-field validation and same-day availability cannot change outcome rows', async () => {
    const response = { data: [
      tradedBar('2026-08-28'),
      tradedBar('2026-08-31', {
        Code: null, O: 'future-invalid', H: null, L: null, C: null,
        UL: 'future-invalid', LL: 'future-invalid', AdjFactor: 0, ExRT: 'future-invalid',
      }),
    ] };
    const before = createAdapter(
      async () => jsonResponse(response),
      { wallNowMs: Date.parse('2026-08-31T05:00:00.000Z') },
    ).adapter;
    const after = createAdapter(
      async () => jsonResponse(response),
      { wallNowMs: Date.parse('2026-08-31T12:00:00.000Z') },
    ).adapter;
    const input = {
      ticker: '7203',
      dateFrom: '2026-08-28',
      dateTo: '2026-08-28',
      asOfCutoff: '2026-08-31T01:00:00.000Z',
    } as const;
    const beforeResult = await before.fetchDailyBars(input);
    const afterResult = await after.fetchDailyBars(input);
    expect(beforeResult.state).toBe('available');
    expect(afterResult.state).toBe('available');
    if (beforeResult.state === 'available' && afterResult.state === 'available') {
      expect(beforeResult.bars).toEqual(afterResult.bars);
      expect(beforeResult.envelope.result.rows).toEqual(afterResult.envelope.result.rows);
      expect(String(beforeResult.envelope.request.asOfCutoff)).toBe(input.asOfCutoff);
      expect(String(afterResult.envelope.request.asOfCutoff)).toBe(input.asOfCutoff);
    }
  });

  test('strictly rejects malformed used daily fields instead of coercing them', async () => {
    const invalidRows = [
      tradedBar('2026-08-28', { O: '100' }),
      tradedBar('2026-08-28', { UL: 0 }),
      tradedBar('2026-08-28', { AdjFactor: '1' }),
      tradedBar('2026-08-28', { ExRT: 1 }),
    ];
    for (const row of invalidRows) {
      const { adapter } = createAdapter(async () => jsonResponse({ data: [row] }));
      await expect(adapter.fetchDailyBars({
        ticker: '7203', dateFrom: '2026-08-28', dateTo: '2026-08-28', asOfCutoff: CUTOFF,
      })).rejects.toMatchObject({ code: 'source_response_invalid' });
    }
  });

  test('shares identical completed adapter requests without another external attempt', async () => {
    let calls = 0;
    const { adapter, runtime, advanceWall } = createAdapter(async () => {
      calls += 1;
      return jsonResponse({ data: [tradedBar('2026-08-28')] });
    });
    const input = {
      ticker: '7203', dateFrom: '2026-08-28', dateTo: '2026-08-28', asOfCutoff: CUTOFF,
    } as const;
    const first = await adapter.fetchDailyBars(input);
    advanceWall(60_000);
    const second = await adapter.fetchDailyBars(input);
    expect(calls).toBe(1);
    expect(runtime.attempts).toHaveLength(1);
    expect(first.envelope.fetchedAt).toBe(second.envelope.fetchedAt);
    expect(first.envelope.digest).toBe(second.envelope.digest);
  });
});
