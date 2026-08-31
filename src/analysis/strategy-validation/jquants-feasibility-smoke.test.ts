import { describe, expect, test } from 'bun:test';
import {
  JQuantsExecutionRuntimeV1,
  acceptJQuantsExecutionV1,
  planJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
} from './jquants-execution.js';
import {
  JQUANTS_FEASIBILITY_SMOKE_ATTEMPT_LIMIT_V1,
  JQUANTS_FEASIBILITY_WORST_CASE_SESSION_V1,
  parseJQuantsFeasibilitySmokeArgsV1,
  proveJQuantsMaturedAnchorV1,
} from './jquants-feasibility-smoke.js';
import { JQuantsValidationAdapterV1 } from './jquants-validation-adapter.js';
import type { AsOfCutoff } from './date.js';

function dates(from: string, to: string): string[] {
  const result: string[] = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Phase 4 J-Quants feasibility smoke', () => {
  test('parses the exact non-interactive confirmation flag and required selectors', () => {
    expect(parseJQuantsFeasibilitySmokeArgsV1([
      '--ticker', '7203',
      '--anchor', '2026-01-05',
      '--outcome-to', '2026-04-30',
      '--confirm-external-fetch',
    ])).toEqual({
      ticker: '7203',
      anchor: '2026-01-05',
      outcomeTo: '2026-04-30',
      confirmedExternalFetch: true,
    });
    expect(parseJQuantsFeasibilitySmokeArgsV1([
      '--ticker', '130A',
      '--anchor', '2026-01-05',
      '--outcome-to', '2026-04-30',
    ])).toMatchObject({ ticker: '130A', confirmedExternalFetch: false });
    for (const invalid of [
      ['--ticker', '7203'],
      ['--ticker', '7203', '--anchor', '2026-01-05', '--outcome-to', '2026-01-05'],
      ['--ticker', '7203', '--anchor', '2026-01-05', '--outcome-to', '2026-04-30', '--unknown'],
      ['--ticker', '7203', '--ticker', '6758', '--anchor', '2026-01-05', '--outcome-to', '2026-04-30'],
    ]) {
      expect(() => parseJQuantsFeasibilitySmokeArgsV1(invalid)).toThrow(
        expect.objectContaining({ code: 'invalid_configuration' }),
      );
    }
  });

  test('proves one matured anchor with all three strict sources in at most ten attempts', async () => {
    let wallMs = Date.parse('2026-05-01T00:00:00.000Z');
    let monotonicMs = 0;
    const requestedUrls: URL[] = [];
    const executionEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: async input => {
        const url = new URL(String(input));
        requestedUrls.push(url);
        if (url.pathname === '/v2/markets/calendar') {
          return jsonResponse({
            data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!).map(date => ({
              Date: date,
              HolDiv: isWeekday(date) ? '1' : '0',
            })),
          });
        }
        if (url.pathname === '/v2/equities/master') {
          return jsonResponse({ data: [{
            Date: url.searchParams.get('date'),
            Code: '72030',
            ScaleCat: 'TOPIX Large70',
            Mkt: '0111',
            ProdCat: '011',
          }] });
        }
        return jsonResponse({
          data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!)
            .filter(isWeekday)
            .map(date => ({
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
            })),
        });
      },
      wallNowMs: () => wallMs,
      monotonicNowMs: () => monotonicMs,
      sleep: (durationMs, signal) => {
        if (signal !== undefined && durationMs === 30_000) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        wallMs += durationMs;
        monotonicMs += durationMs;
        return Promise.resolve();
      },
      apiKey: () => 'test-key',
    });
    const accepted = acceptJQuantsExecutionV1(
      planJQuantsExecutionV1(3, 5),
      executionEnvironment,
    );
    const runtime = new JQuantsExecutionRuntimeV1(accepted, {
      environment: executionEnvironment,
      actualAttemptLimit: JQUANTS_FEASIBILITY_SMOKE_ATTEMPT_LIMIT_V1,
    });
    const evidence = await proveJQuantsMaturedAnchorV1(
      new JQuantsValidationAdapterV1(runtime),
      runtime,
      {
        ticker: '7203',
        anchor: '2026-01-05',
        outcomeTo: '2026-04-30',
        startedAt: '2026-05-01T00:00:00.000Z' as AsOfCutoff,
      },
    );

    expect(String(evidence.anchor)).toBe('2026-01-05');
    expect(JQUANTS_FEASIBILITY_WORST_CASE_SESSION_V1).toBe(79);
    expect(String(evidence.maturityThrough)).toBe('2026-04-24');
    expect(evidence).toMatchObject({
      ticker: '7203', marketCode: '0111', scaleCategory: 'TOPIX Large70', attempts: 3,
    });
    expect([evidence.calendarDigest, evidence.masterDigest, evidence.dailyBarsDigest]
      .every(digest => /^sha256:[0-9a-f]{64}$/.test(digest))).toBe(true);
    expect(requestedUrls.map(url => url.pathname)).toEqual([
      '/v2/markets/calendar', '/v2/equities/master', '/v2/equities/bars/daily',
    ]);
    expect(requestedUrls[2]?.searchParams.get('to')).toBe(String(evidence.maturityThrough));
  });

  test('rejects an outcome boundary on the startedAt Tokyo date before external access', async () => {
    let calls = 0;
    const executionEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: async () => { calls += 1; return jsonResponse({ data: [] }); },
      wallNowMs: () => Date.parse('2026-04-10T00:00:00.000Z'),
      monotonicNowMs: () => 0,
      sleep: () => Promise.resolve(),
      apiKey: () => 'test-key',
    });
    const accepted = acceptJQuantsExecutionV1(planJQuantsExecutionV1(3, 5), executionEnvironment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment: executionEnvironment });
    await expect(proveJQuantsMaturedAnchorV1(
      new JQuantsValidationAdapterV1(runtime),
      runtime,
      {
        ticker: '7203',
        anchor: '2026-01-05',
        outcomeTo: '2026-04-10',
        startedAt: '2026-04-10T00:00:00.000Z' as AsOfCutoff,
      },
    )).rejects.toMatchObject({ code: 'source_response_invalid' });
    expect(calls).toBe(0);
  });
});
