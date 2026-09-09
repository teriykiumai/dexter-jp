import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
  TECHNICAL_SOURCE_SMOKE_LIMITS_V1,
  TechnicalSourceSmokeClientV1,
  TechnicalSourceSmokeErrorV1,
  parseTechnicalSourceSmokeArgsV1,
  proveTechnicalSourceGateV1,
  type TechnicalSourceSmokeEnvironmentV1,
} from './technical-source-smoke.js';

function dates(from: string, to: string): string[] {
  const output: string[] = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000) output.push(new Date(cursor).toISOString().slice(0, 10));
  return output;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function environment(fetcher: TechnicalSourceSmokeEnvironmentV1['fetch'], options: Readonly<{
  wallNowMs?: number;
  timeoutImmediately?: boolean;
  apiKey?: string;
  processEnvironment?: NodeJS.ProcessEnv;
}> = {}): TechnicalSourceSmokeEnvironmentV1 {
  let monotonic = 0;
  let wall = options.wallNowMs ?? Date.parse('2026-09-04T08:00:00.000Z');
  return Object.freeze({
    fetch: fetcher,
    wallNowMs: () => wall,
    monotonicNowMs: () => monotonic,
    sleep: (duration, signal) => {
      if (options.timeoutImmediately) { monotonic += duration; wall += duration; return Promise.resolve(); }
      if (signal !== undefined && duration <= TECHNICAL_SOURCE_SMOKE_LIMITS_V1.requestTimeoutMs) {
        return new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      monotonic += duration;
      wall += duration;
      return Promise.resolve();
    },
    apiKey: () => options.apiKey ?? 'test-jquants-key',
    processEnvironment: options.processEnvironment ?? {},
  });
}

function paged<T>(rows: readonly T[], url: URL, pageSize: number): Response {
  const offset = Number(url.searchParams.get('pagination_key') ?? 0);
  const next = offset + pageSize;
  return jsonResponse({
    data: rows.slice(offset, next),
    ...(next < rows.length ? { pagination_key: String(next) } : {}),
  });
}

describe('DR-T0 bounded Technical source smoke', () => {
  test('non-interactive CLI refuses before credential configuration without confirmation', () => {
    const result = Bun.spawnSync([process.execPath,
      fileURLToPath(new URL('./technical-source-smoke.ts', import.meta.url)), '--ticker', '7203'], {
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, JQUANTS_API_KEY: '', JQUANTS_REQUESTS_PER_MINUTE: 'invalid' },
      timeout: 5_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(JSON.parse(result.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
  });

  test('parses only one canonical ticker and the explicit non-interactive confirmation', () => {
    expect(parseTechnicalSourceSmokeArgsV1(['--ticker', '7203'])).toEqual({
      ticker: '7203', confirmedExternalFetch: false,
    });
    expect(parseTechnicalSourceSmokeArgsV1(['--confirm-external-fetch', '--ticker', '130A'])).toEqual({
      ticker: '130A', confirmedExternalFetch: true,
    });
    for (const args of [[], ['--ticker', '7203', '--ticker', '6758'], ['--ticker', '123'], ['--unknown']]) {
      expect(() => parseTechnicalSourceSmokeArgsV1(args)).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
    }
  });

  test('proves all three paginated inputs without publishing data or leaking request internals', async () => {
    const requested: URL[] = [];
    const calendar = dates('2016-09-04', '2026-09-30').map(Date => ({
      Date, HolDiv: isWeekday(Date) ? '1' : '0', ignored: 'calendar-extra',
    }));
    const bars = dates('2016-09-04', '2026-09-04').filter(isWeekday).map(Date => ({
      Date, Code: '72030', AdjO: 100, AdjH: 110, AdjL: 90, AdjC: 105,
      AdjVo: Date.endsWith('-01') ? 0 : 1000, AdjFactor: 1, ExRT: null,
      rawProviderField: 'ignored',
    }));
    const client = new TechnicalSourceSmokeClientV1({
      requestsPerMinute: 500,
      environment: environment(async (input, init) => {
        const url = new URL(String(input));
        requested.push(url);
        expect(new Headers(init?.headers).get('x-api-key')).toBe('test-jquants-key');
        if (url.pathname === '/v2/markets/calendar') return paged(calendar, url, 2_000);
        if (url.pathname === '/v2/equities/master') return jsonResponse({ data: [{
          Date: '2026-09-04', Code: '72030', CoName: '現在の会社名', Mkt: '0111', ProdCat: '011',
          MktNm: 'ignored',
        }] });
        return paged(bars, url, 2_000);
      }),
    });
    const evidence = await proveTechnicalSourceGateV1(client, '7203');

    expect(evidence).toMatchObject({
      schemaVersion: 'technical_source_gate_evidence_v1', result: 'passed',
      calendarBoundaryPolicy: 'standard_calendar_boundary_v2',
      entitlementClass: 'configured_standard_or_higher', ticker: '7203', jquantsCode: '72030',
      calculationDate: '2026-09-04', queryFrom: '2016-09-04', queryTo: '2026-09-04',
      currentMaster: { Date: '2026-09-04', Code: '72030', CoName: '現在の会社名', Mkt: '0111', ProdCat: '011' },
      historyBoundary: { sourceCoverageFrom: '2016-09-05', sourceCoverageThrough: '2026-09-04', historicalIdentity: 'not_verified' },
      checks: { standardMaximumTenYearRange: true, completePostStartSessions: true, adjustedNotTotalReturn: true },
    });
    expect(evidence.totals).toEqual({
      attempts: 5,
      pages: 5,
      rows: calendar.length + bars.length + 1,
      responseBytes: evidence.sources.reduce((sum, source) => sum + source.responseBytes, 0),
    });
    expect(evidence.sources.map(source => source.role)).toEqual(['daily_bars', 'security_master', 'trading_calendar']);
    expect(evidence.sources.every(source => /^sha256:[0-9a-f]{64}$/.test(source.observationDigest))).toBe(true);
    expect(requested.map(url => url.pathname)).toEqual([
      '/v2/markets/calendar', '/v2/markets/calendar',
      '/v2/equities/master',
      '/v2/equities/bars/daily', '/v2/equities/bars/daily',
    ]);
    expect(requested[0]?.searchParams.get('from')).toBe('2016-09-04');
    expect(requested[3]?.searchParams.get('from')).toBe('2016-09-04');
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('test-jquants-key');
    expect(serialized).not.toContain('pagination_key');
    expect(serialized).not.toContain('rawProviderField');
    expect(serialized).not.toContain('MktNm');
  });

  test('uses the exact endpoint query allowlist and rejects malformed response envelopes', async () => {
    const client = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({ data: [], extra: true })) });
    await expect(client.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'source_response_invalid' });
    await expect(client.getAll('/v2/markets/calendar', { from: '2026-09-01', date: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'invalid_configuration' });
  });

  test('does not retry entitlement, server, or malformed-JSON failures and never includes provider text', async () => {
    for (const response of [
      jsonResponse({ message: 'subscription denied test-jquants-key C:\\private' }, 403),
      jsonResponse({ message: 'Your subscription covers the following dates: private detail' }, 400),
      jsonResponse({ message: 'server secret' }, 500),
      new Response('{bad', { status: 200 }),
    ]) {
      let calls = 0;
      const client = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
        environment: environment(async () => { calls += 1; return response.clone(); }) });
      try {
        await client.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' });
        throw new Error('expected failure');
      } catch (error) {
        expect(calls).toBe(1);
        if (error instanceof TechnicalSourceSmokeErrorV1 && error.status !== undefined) {
          expect(error.endpoint).toBe('/v2/markets/calendar');
        }
        expect(String(error)).not.toContain('subscription');
        expect(String(error)).not.toContain('test-jquants-key');
        expect(String(error)).not.toContain('private');
        expect(String(error)).not.toContain('server secret');
      }
    }
  });

  test('derives only the safe side of a dated plan restriction', async () => {
    const client = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({
        message: 'Your subscription covers the following dates: 2016-09-04 ~ 2026-09-04.',
      }, 400)) });
    await expect(client.getAll('/v2/markets/calendar', { from: '2016-08-29', to: '2026-09-30' }))
      .rejects.toMatchObject({
        code: 'source_plan_unavailable',
        status: 400,
        endpoint: '/v2/markets/calendar',
        restrictionBoundary: 'request_outside_coverage',
      });
  });

  test('enforces declared-byte, row, page/attempt, timeout, and repeated-cursor ceilings', async () => {
    const oversized = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({ data: [] }, 200,
        { 'content-length': String(TECHNICAL_SOURCE_SMOKE_LIMITS_V1.responseBytes + 1) })) });
    await expect(oversized.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'source_response_too_large' });

    const tooManyRows = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({ data: Array.from({ length: 8_001 }, () => null) })) });
    await expect(tooManyRows.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'source_response_too_large' });

    let page = 0;
    const tooManyPages = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({ data: [], pagination_key: String(++page) })) });
    await expect(tooManyPages.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'page_limit_exceeded' });
    expect(tooManyPages.attempts).toBe(20);

    const repeated = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async () => jsonResponse({ data: [], pagination_key: 'same' })) });
    await expect(repeated.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'source_response_invalid' });
    expect(repeated.attempts).toBe(2);

    const timeout = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(() => new Promise(() => {}), { timeoutImmediately: true }) });
    await expect(timeout.getAll('/v2/markets/calendar', { from: '2026-09-01', to: '2026-09-04' }))
      .rejects.toMatchObject({ code: 'execution_timeout' });
    expect(timeout.attempts).toBe(1);
  });

  test('fails the current-master predicate without exposing the rejected source row', async () => {
    const calendar = dates('2016-09-04', '2026-09-30').map(Date => ({ Date, HolDiv: isWeekday(Date) ? '1' : '0' }));
    const client = new TechnicalSourceSmokeClientV1({ requestsPerMinute: 500,
      environment: environment(async input => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/markets/calendar') return jsonResponse({ data: calendar });
        return jsonResponse({ data: [{ Date: '2026-09-04', Code: '72030', CoName: 'test-jquants-key', Mkt: '0109', ProdCat: '014' }] });
      }, { processEnvironment: { JQUANTS_API_KEY: 'test-jquants-key' } }) });
    await expect(proveTechnicalSourceGateV1(client, '7203'))
      .rejects.toMatchObject({ code: 'instrument_identity_unverified' });
  });
});
