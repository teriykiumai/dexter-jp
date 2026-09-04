import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1, MarketDataJobViewV1Schema,
  MarketDataWarningV1Schema, assertMarketDataJobReplacementV1,
  assertCurrentCodeWarningsV1, currentCodeWarningsV1, isCurrentCodePersistedWarningV1,
  marketDataJobFailureV1, marketDataWarningCodesV1 } from './job-schema.js';

function accepted() {
  return MarketDataJobViewV1Schema.parse({
    schemaVersion: 'market_data_job_view_v1', jobId: randomUUID(), kind: 'overview_refresh',
    target: { kind: 'overview' }, status: 'accepted', acceptedAt: '2026-09-04T00:00:00.000Z',
    startedAt: null, completedAt: null,
    progress: { attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0,
      completedModules: 0, totalModules: 1 }, failure: null, result: null,
  });
}

describe('Market Data job schema', () => {
  test('is closed and enforces target, nullability, and root failure semantics', () => {
    const job = accepted();
    expect(MarketDataJobViewV1Schema.safeParse({ ...job, extra: true }).success).toBeFalse();
    expect(MarketDataJobViewV1Schema.safeParse({ ...job, target: { kind: 'technical', ticker: '7203' } }).success).toBeFalse();
    expect(MarketDataJobViewV1Schema.safeParse({ ...job, status: 'completed',
      completedAt: '2026-09-04T00:00:01.000Z' }).success).toBeFalse();
    expect(MarketDataJobViewV1Schema.safeParse({ ...job, status: 'failed',
      completedAt: '2026-09-04T00:00:01.000Z', failure: marketDataJobFailureV1('source_timeout') }).success).toBeFalse();
  });

  test('requires one ordered Overview result for every implemented module and one checkedAt', () => {
    const job = accepted();
    const checkedAt = '2026-09-04T00:00:02.000Z';
    const failed = { moduleId: 'market_short_ratio', state: 'failed', checkedAt,
      artifactIdentity: null, observationReceiptIdentity: null,
      failureCode: 'source_timeout', warningCodes: [] } as const;
    const terminal = { ...job, status: 'failed', startedAt: '2026-09-04T00:00:01.000Z',
      completedAt: checkedAt, progress: { ...job.progress, completedModules: 1 },
      failure: marketDataJobFailureV1('all_modules_failed'),
      result: { kind: 'overview', checkedAt, moduleResults: [failed] } };
    expect(MarketDataJobViewV1Schema.safeParse(terminal).success).toBeTrue();
    expect(MarketDataJobViewV1Schema.safeParse({ ...terminal,
      result: { ...terminal.result, checkedAt: '2026-09-04T00:00:03.000Z' } }).success).toBeFalse();
    expect(MarketDataJobViewV1Schema.safeParse({ ...terminal,
      result: { ...terminal.result, moduleResults: [failed, failed] },
      progress: { ...terminal.progress, totalModules: 2, completedModules: 2 } }).success).toBeFalse();
    expect(MarketDataJobViewV1Schema.safeParse({ ...terminal,
      result: { ...terminal.result, moduleResults: [{ ...failed, warningCodes: ['source_refresh_failed'] }] } }).success).toBeFalse();
  });

  test('normalizes warning codes to one canonical order', () => {
    expect(marketDataWarningCodesV1([
      'historical_identity_unverified', 'source_refresh_failed', 'basis_break',
      'history_coverage_clipped', 'artifact_corrupt_fallback', 'basis_break',
    ])).toEqual(['artifact_corrupt_fallback', 'basis_break', 'source_refresh_failed',
      'history_coverage_clipped', 'historical_identity_unverified']);
    expect(MarketDataWarningV1Schema.safeParse({ code: 'instrument_lifetime_clipped',
      message: 'retired', moduleId: null, artifactIdentity: null }).success).toBeFalse();
  });

  test('builds exact single-boundary current-code warnings in canonical order', () => {
    expect(currentCodeWarningsV1({ kind: 'technical', boundary: {
      state: 'available', sourceCoverageFrom: '2018-03-01', historyCoverageClipped: true,
    } })).toEqual([
      { code: 'history_coverage_clipped',
        message: '取得できた履歴は 2018-03-01 からです。この日付は上場日を示しません。',
        moduleId: null, artifactIdentity: null },
      { code: 'historical_identity_unverified',
        message: HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1,
        moduleId: null, artifactIdentity: null },
    ]);
    expect(currentCodeWarningsV1({ kind: 'etf_1321_eod', boundary: {
      state: 'unavailable', historyCoverageClipped: false,
    } })).toEqual([{ code: 'historical_identity_unverified',
      message: HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1,
      moduleId: 'etf_1321_eod', artifactIdentity: null }]);
    expect(() => currentCodeWarningsV1({ kind: 'technical', boundary: {
      state: 'unavailable', historyCoverageClipped: false,
    } } as never)).toThrow();
  });

  test('builds one fixed-order relative warning with an unavailable boundary token', () => {
    expect(currentCodeWarningsV1({ kind: 'etf_1321_2633_relative',
      boundary1321: { state: 'unavailable', historyCoverageClipped: false },
      boundary2633: { state: 'available', sourceCoverageFrom: '2020-01-06',
        historyCoverageClipped: true } })).toEqual([
      { code: 'history_coverage_clipped',
        message: '取得できた履歴の開始日は1321が観測なし、2633が2020-01-06です。これらの日付は上場日を示しません。',
        moduleId: 'etf_1321_2633_relative', artifactIdentity: null },
      { code: 'historical_identity_unverified',
        message: HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1,
        moduleId: 'etf_1321_2633_relative', artifactIdentity: null },
    ]);
    expect(currentCodeWarningsV1({ kind: 'etf_1321_2633_relative',
      boundary1321: { state: 'available', sourceCoverageFrom: '2019-01-04',
        historyCoverageClipped: false },
      boundary2633: { state: 'available', sourceCoverageFrom: '2020-01-06',
        historyCoverageClipped: false } })).toEqual([
      { code: 'historical_identity_unverified',
        message: HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1,
        moduleId: 'etf_1321_2633_relative', artifactIdentity: null },
    ]);
    for (const [clipped1321, clipped2633] of [[true, false], [false, true], [true, true]]) {
      expect(currentCodeWarningsV1({ kind: 'etf_1321_2633_relative',
        boundary1321: { state: 'available', sourceCoverageFrom: '2019-01-04',
          historyCoverageClipped: clipped1321 },
        boundary2633: { state: 'available', sourceCoverageFrom: '2020-01-06',
          historyCoverageClipped: clipped2633 } })[0]).toEqual({
        code: 'history_coverage_clipped',
        message: '取得できた履歴の開始日は1321が2019-01-04、2633が2020-01-06です。これらの日付は上場日を示しません。',
        moduleId: 'etf_1321_2633_relative', artifactIdentity: null,
      });
    }
    expect(() => currentCodeWarningsV1({ kind: 'etf_1321_eod', boundary: {
      state: 'unavailable', historyCoverageClipped: true,
    } } as never)).toThrow();
    expect(isCurrentCodePersistedWarningV1({ code: 'history_coverage_clipped',
      message: '取得できた履歴の開始日は1321が観測なし、2633が観測なしです。これらの日付は上場日を示しません。',
      moduleId: 'etf_1321_2633_relative', artifactIdentity: null })).toBeFalse();
  });

  test('requires the exact current-code warning set for validated boundaries', () => {
    const singleInput = { kind: 'etf_1321_eod', boundary: {
      state: 'available', sourceCoverageFrom: '2018-03-01', historyCoverageClipped: true,
    } } as const;
    const single = currentCodeWarningsV1(singleInput);
    expect(() => assertCurrentCodeWarningsV1(single, singleInput)).not.toThrow();
    expect(() => assertCurrentCodeWarningsV1([], singleInput)).toThrow();
    expect(() => assertCurrentCodeWarningsV1(single.slice(0, 1), singleInput)).toThrow();
    expect(() => assertCurrentCodeWarningsV1(single.slice(1), singleInput)).toThrow();
    expect(() => assertCurrentCodeWarningsV1(single, { ...singleInput,
      boundary: { ...singleInput.boundary, historyCoverageClipped: false } })).toThrow();
    expect(() => assertCurrentCodeWarningsV1(single.map(warning => warning.code === 'history_coverage_clipped'
      ? { ...warning, message: warning.message.replace('2018-03-01', '2018-03-02') } : warning),
    singleInput)).toThrow();

    const relativeInput = { kind: 'etf_1321_2633_relative',
      boundary1321: { state: 'unavailable', historyCoverageClipped: false },
      boundary2633: { state: 'available', sourceCoverageFrom: '2020-01-06',
        historyCoverageClipped: true } } as const;
    const relative = currentCodeWarningsV1(relativeInput);
    expect(() => assertCurrentCodeWarningsV1(relative, relativeInput)).not.toThrow();
    for (const replacement of [
      '取得できた履歴の開始日は1321が観測なし、2633が2020-01-07です。これらの日付は上場日を示しません。',
      '取得できた履歴の開始日は1321が2020-01-06、2633が観測なしです。これらの日付は上場日を示しません。',
      '取得できた履歴の開始日は1321が2019-01-04、2633が2020-01-06です。これらの日付は上場日を示しません。',
    ]) {
      expect(() => assertCurrentCodeWarningsV1(relative.map(warning =>
        warning.code === 'history_coverage_clipped' ? { ...warning, message: replacement } : warning),
      relativeInput)).toThrow();
    }
  });

  test('replacement accepts monotonic lifecycle updates and rejects identity or progress rollback', () => {
    const job = accepted();
    const running = MarketDataJobViewV1Schema.parse({ ...job, status: 'running',
      startedAt: '2026-09-04T00:00:01.000Z', progress: { ...job.progress, attempts: 1 } });
    expect(() => assertMarketDataJobReplacementV1(job, running)).not.toThrow();
    expect(() => assertMarketDataJobReplacementV1(running, { ...running,
      progress: { ...running.progress, attempts: 0 } })).toThrow();
    expect(() => assertMarketDataJobReplacementV1(running, { ...running, jobId: randomUUID() })).toThrow();
  });
});
