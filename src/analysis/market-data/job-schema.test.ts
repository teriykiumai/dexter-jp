import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MarketDataJobViewV1Schema, assertMarketDataJobReplacementV1,
  marketDataJobFailureV1 } from './job-schema.js';

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
