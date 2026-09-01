import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { comparisonSnapshot, snapshotAtVersion } from '../comparison/test-fixtures.js';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { createSnapshotId } from '../snapshot/id.js';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import {
  JQuantsExecutionRuntimeV1,
  acceptJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
} from './jquants-execution.js';
import { JQuantsValidationAdapterV1 } from './jquants-validation-adapter.js';
import {
  StrategyValidationRunRepositoryV1,
  type StrategyValidationRunPublicationV1,
  type StrategyValidationRunPublishOptionsV1,
} from './run-repository.js';
import {
  createSnapshotAuditPreflightV1,
  executeSnapshotAuditV1,
} from './snapshot-audit.js';
import {
  parseValidateStrategyCliArgsV1,
  runValidateStrategyCliV1,
} from './validate-strategy-cli.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function repositories() {
  const directory = await mkdtemp(join(tmpdir(), 'dexter-snapshot-audit-'));
  directories.push(directory);
  return {
    directory,
    snapshots: new AnalysisSnapshotRepository(join(directory, 'analysis')),
    runs: new StrategyValidationRunRepositoryV1(join(directory, 'research'), {
      promoteDirectory: rename,
    }),
  };
}

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

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function runtimeFor(
  preflight: Awaited<ReturnType<typeof createSnapshotAuditPreflightV1>>,
  fetchOverride?: (url: URL) => Promise<Response>,
) {
  let wallMs = Date.parse('2026-12-01T00:00:01.000Z');
  let monotonicMs = 0;
  const paths: string[] = [];
  const environment: JQuantsExecutionEnvironmentV1 = Object.freeze({
    fetch: async input => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (fetchOverride !== undefined) return fetchOverride(url);
      if (url.pathname === '/v2/markets/calendar') {
        return response({
          data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!).map(date => ({
            Date: date,
            HolDiv: isWeekday(date) ? '1' : '0',
          })),
        });
      }
      if (url.pathname === '/v2/equities/master') {
        return response({ data: [{
          Date: url.searchParams.get('date'),
          Code: '72030',
          ScaleCat: 'TOPIX Large70',
          Mkt: '0111',
          ProdCat: '011',
        }] });
      }
      return response({
        data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!)
          .filter(isWeekday)
          .map(date => ({
            Date: date,
            Code: '72030',
            O: 3_051,
            H: 4_000,
            L: 3_000,
            C: 3_500,
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
  const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
  const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
  const advance = (durationMs: number): void => {
    wallMs += durationMs;
    monotonicMs += durationMs;
  };
  return { runtime, accepted, environment, paths, advance };
}

describe('saved-Snapshot Strategy audit', () => {
  test('parses the exact Snapshot CLI surface', () => {
    expect(parseValidateStrategyCliArgsV1([
      '--ticker', '7203',
      '--snapshot-id', '2026-08-22T01-00-00-000Z',
      '--confirm-external-fetch',
    ])).toEqual({
      ticker: '7203',
      snapshotId: '2026-08-22T01-00-00-000Z',
      confirmedExternalFetch: true,
    });
    for (const invalid of [
      ['--ticker', '7203'],
      ['--ticker', '7203', '--snapshot-id', '../latest'],
      ['--ticker', '7203', '--snapshot-id', '2026-08-22T01-00-00-000Z', '--manifest', 'x'],
      ['--ticker', '7203', '--ticker', '6758', '--snapshot-id', '2026-08-22T01-00-00-000Z'],
    ]) {
      expect(() => parseValidateStrategyCliArgsV1(invalid)).toThrow(
        expect.objectContaining({ code: 'invalid_configuration' }),
      );
    }
  });

  test('loads exact V1-V9 history and preserves local date-guard precedence', async () => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const { directory, snapshots } = await repositories();
      const oldSnapshot = snapshotAtVersion(comparisonSnapshot(), version);
      const snapshotId = createSnapshotId(oldSnapshot.generatedAt);
      await mkdir(join(directory, 'analysis', oldSnapshot.canonicalTicker), { recursive: true });
      await writeFile(
        join(directory, 'analysis', oldSnapshot.canonicalTicker, `${snapshotId}.json`),
        canonicalJsonV1(oldSnapshot as CanonicalJsonValue),
      );
      const input = { ticker: oldSnapshot.canonicalTicker, snapshotId };
      const preflight = await createSnapshotAuditPreflightV1(input, {
        snapshotRepository: snapshots,
        startedAt: '2026-12-01T00:00:00.000Z',
        requestsPerMinute: 5,
      });
      expect(preflight.selector.snapshotSchemaVersion).toBe(version);
      expect(preflight.localUnavailableReason).toBeNull();
    }

    const { snapshots } = await repositories();
    const base = comparisonSnapshot();
    const cases = [
      { dataDate: null, expected: 'strategy_data_date_invalid' },
      { dataDate: '2026/08/21', expected: 'strategy_data_date_invalid' },
      { dataDate: '2026-02-30', expected: 'strategy_data_date_invalid' },
      { dataDate: '2026-08-23', expected: 'future_strategy_data' },
      { dataDate: '2026-08-24', expected: 'future_strategy_data' },
    ] as const;
    for (const value of cases) {
      const snapshot = structuredClone(base);
      snapshot.generatedAt = `2026-08-22T0${cases.indexOf(value)}:00:00.000Z`;
      snapshot.strategy!.dataDate = value.dataDate;
      const saved = await snapshots.save(snapshot);
      const preflight = await createSnapshotAuditPreflightV1({
        ticker: saved.canonicalTicker,
        snapshotId: saved.snapshotId,
      }, {
        snapshotRepository: snapshots,
        startedAt: '2026-12-01T00:00:00.000Z',
        requestsPerMinute: 5,
      });
      expect(preflight.localUnavailableReason).toBe(value.expected);
      expect(preflight.candidates).toHaveLength(0);
      expect(preflight.executionPlan.estimatedMinimumAttempts).toBe(0);
    }
  });

  test('publishes and rereads every stored candidate with frozen Snapshot identity', async () => {
    const { snapshots, runs } = await repositories();
    const snapshot = comparisonSnapshot();
    snapshot.strategy!.candidates[1]!.target = {
      price: 3_600,
      reason: 'resistance_level',
    };
    snapshot.strategy!.candidates.push(structuredClone(snapshot.strategy!.candidates[0]!));
    const saved = await snapshots.save(snapshot);
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const derivedOutcomeAsOfSessions: string[] = [];
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
      onOutcomeAsOfSession: value => { derivedOutcomeAsOfSessions.push(value); },
    });
    const loaded = await runs.load(result.runId);

    expect(result.caseCount).toBe(3);
    expect(loaded.run.selector).toEqual(preflight.selector);
    expect(derivedOutcomeAsOfSessions).toEqual(['2026-11-30']);
    expect(loaded.run.outcomeAsOfSession).toBe('2026-11-30');
    expect(loaded.cases.every(value => value.caseKind === 'candidate')).toBe(true);
    expect(loaded.cases.map(value => value.caseKind === 'candidate'
      ? value.duplicateOrdinal
      : -1).sort()).toEqual([0, 0, 1]);
    expect(loaded.cases.every(value => value.caseKind === 'candidate'
      && value.outcome.kind === 'target_hit')).toBe(true);
    expect(loaded.cases.map(value => value.caseKind === 'candidate'
      ? value.resistanceEvidenceTier
      : 'unexpected').sort()).toEqual([
      'none', 'none', 'precommitted_source_unknown',
    ]);
    expect(paths.filter(path => path === '/v2/equities/bars/daily')).toHaveLength(1);
    expect(paths.filter(path => path === '/v2/equities/master').length).toBeLessThanOrEqual(2);
  });

  test('publishes local invalid and future anchor cases without confirmation or J-Quants', async () => {
    const mondayAfterWeekend = '2026-08-24T00:00:00.000Z';
    for (const input of [
      { dataDate: null, reason: 'strategy_data_date_invalid' },
      { dataDate: '2026/08/21', reason: 'strategy_data_date_invalid' },
      { dataDate: '2026-02-30', reason: 'strategy_data_date_invalid' },
      { dataDate: '2026-08-23', reason: 'future_strategy_data' },
      { dataDate: '2026-08-24', reason: 'future_strategy_data' },
    ] as const) {
      const { snapshots, runs } = await repositories();
      const snapshot = comparisonSnapshot();
      snapshot.strategy!.dataDate = input.dataDate;
      const saved = await snapshots.save(snapshot);
      const preflight = await createSnapshotAuditPreflightV1({
        ticker: saved.canonicalTicker,
        snapshotId: saved.snapshotId,
      }, {
        snapshotRepository: snapshots,
        startedAt: mondayAfterWeekend,
        requestsPerMinute: 500,
      });
      let confirmationCount = 0;
      const { environment, paths } = runtimeFor(preflight);
      const result = await runValidateStrategyCliV1([
        '--ticker', saved.canonicalTicker,
        '--snapshot-id', saved.snapshotId,
      ], {
        snapshotRepository: snapshots,
        runRepository: runs,
        startedAt: mondayAfterWeekend,
        requestsPerMinute: 500,
        executionEnvironment: environment,
        confirm: async () => {
          confirmationCount += 1;
          return false;
        },
        writeOutput: () => {},
      });
      const loaded = await runs.load(result.runId);
      expect(result.attemptCount).toBe(0);
      expect(confirmationCount).toBe(0);
      expect(paths).toEqual([]);
      expect(loaded.cases).toHaveLength(1);
      expect(loaded.cases[0]).toMatchObject({
        caseKind: 'anchor_unavailable',
        unavailableReason: input.reason,
        outcomeAsOfSession: null,
      });
      expect(loaded.run.outcomeAsOfSession).toBeNull();
      expect(loaded.cases[0]!.sourceManifest.outcomeAsOfSession).toBeNull();
      expect(loaded.cases[0]!.sourceManifest.sources).toEqual([]);
      expect(loaded.sources).toEqual([]);
    }
  });

  test('uses only the official calendar to reject a proven non-session date', async () => {
    const { snapshots, runs } = await repositories();
    const snapshot = comparisonSnapshot();
    snapshot.strategy!.dataDate = '2026-08-22';
    const saved = await snapshots.save(snapshot);
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      caseKind: 'anchor_unavailable', unavailableReason: 'strategy_data_date_invalid',
    });
    expect(paths).toEqual(['/v2/markets/calendar']);
  });

  test('publishes calendar_incomplete with causal evidence and no later request', async () => {
    const { snapshots, runs } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(preflight, async url => response({
      data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!)
        .filter(date => date !== '2026-08-20')
        .map(date => ({ Date: date, HolDiv: isWeekday(date) ? '1' : '0' })),
    }));
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    expect(paths).toEqual(['/v2/markets/calendar']);
    expect(result.attemptCount).toBe(1);
    expect(loaded.run.outcomeAsOfSession).toBeNull();
    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      caseKind: 'anchor_unavailable',
      unavailableReason: 'calendar_incomplete',
      outcomeAsOfSession: null,
      sourceManifest: {
        outcomeAsOfSession: null,
        sources: [{ role: 'candidate_calendar' }],
      },
    });
    expect(loaded.sources).toHaveLength(1);
    expect(loaded.sources[0]!.result).toEqual({
      state: 'unavailable', reason: 'calendar_incomplete', rows: [],
    });
  });

  test('checks the official session before publishing a relationally invalid candidate', async () => {
    const { snapshots, runs } = await repositories();
    const snapshot = comparisonSnapshot();
    const candidate = structuredClone(snapshot.strategy!.candidates[0]!);
    candidate.entry.price = 100;
    candidate.stop.price = 110;
    candidate.target.price = 120;
    snapshot.strategy!.candidates = [candidate];
    const saved = await snapshots.save(snapshot);
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(preflight.localUnavailableReason).toBeNull();
    expect(preflight.candidateNormalizationInvalid).toBe(false);
    expect(preflight.executionPlan.estimatedMinimumAttempts).toBe(1);
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    expect(paths).toEqual(['/v2/markets/calendar']);
    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      caseKind: 'candidate',
      outcome: { kind: 'unavailable', reason: 'invalid_candidate' },
    });
  });

  test('gives a proven non-session date precedence over a nonnormalizable candidate', async () => {
    const { snapshots, runs } = await repositories();
    const snapshot = comparisonSnapshot();
    snapshot.strategy!.dataDate = '2026-08-22';
    snapshot.strategy!.candidates[0]!.entry.price = 0;
    const saved = await snapshots.save(snapshot);
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(preflight.localUnavailableReason).toBeNull();
    expect(preflight.candidateNormalizationInvalid).toBe(true);
    expect(preflight.executionPlan.estimatedMinimumAttempts).toBe(1);
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    expect(paths).toEqual(['/v2/markets/calendar']);
    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      caseKind: 'anchor_unavailable', unavailableReason: 'strategy_data_date_invalid',
    });
  });

  test('publishes a nonnormalizable candidate only after the official-session guard', async () => {
    const { snapshots, runs } = await repositories();
    const snapshot = comparisonSnapshot();
    snapshot.strategy!.candidates[0]!.entry.price = 0;
    const saved = await snapshots.save(snapshot);
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    expect(paths).toEqual(['/v2/markets/calendar']);
    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      caseKind: 'anchor_unavailable',
      unavailableReason: 'invalid_candidate',
      outcomeAsOfSession: '2026-11-30',
      sourceManifest: { sources: [{ role: 'candidate_calendar' }] },
    });
  });

  test('declined confirmation creates no run and performs no external request', async () => {
    const { directory, snapshots, runs } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    let confirmationCount = 0;
    await expect(runValidateStrategyCliV1([
      '--ticker', saved.canonicalTicker,
      '--snapshot-id', saved.snapshotId,
    ], {
      snapshotRepository: snapshots,
      runRepository: runs,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 5,
      confirm: async () => {
        confirmationCount += 1;
        return false;
      },
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(confirmationCount).toBe(1);
    await expect(access(join(directory, 'research', 'runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await runs.list()).toEqual([]);
  });

  test('cancellation before collection publishes no run', async () => {
    const { directory, snapshots, runs } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(preflight);
    const controller = new AbortController();
    controller.abort();
    await expect(executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(paths).toEqual([]);
    await expect(access(join(directory, 'research', 'runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('preserves a typed calendar-source failure and publishes no run', async () => {
    const { directory, snapshots, runs } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { runtime, accepted, paths } = runtimeFor(
      preflight,
      async () => response({ data: [] }),
    );
    await expect(executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime), runtime, accepted, runRepository: runs,
    })).rejects.toMatchObject({ code: 'source_history_unavailable' });
    expect(paths).toEqual(['/v2/markets/calendar']);
    await expect(access(join(directory, 'research', 'runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('cleans temporary data when cancellation arrives during pre-promotion assembly', async () => {
    const { directory, snapshots } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const controller = new AbortController();
    class AbortAfterPublishStartsRepository extends StrategyValidationRunRepositoryV1 {
      override publish(
        publication: StrategyValidationRunPublicationV1,
        options: StrategyValidationRunPublishOptionsV1 = {},
      ) {
        const publishing = super.publish(publication, options);
        controller.abort();
        return publishing;
      }
    }
    const runs = new AbortAfterPublishStartsRepository(join(directory, 'cancel-before-promote'), {
      promoteDirectory: rename,
    });
    const { runtime, accepted } = runtimeFor(preflight);
    await expect(executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await readdir(runs.runsDirectory)).toEqual([]);
  });

  test('finishes publication when cancellation arrives after atomic promotion begins', async () => {
    const { directory, snapshots } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const controller = new AbortController();
    const runs = new StrategyValidationRunRepositoryV1(join(directory, 'cancel-after-promote'), {
      promoteDirectory: async (temporaryDirectory, finalDirectory) => {
        controller.abort();
        await rename(temporaryDirectory, finalDirectory);
      },
    });
    const { runtime, accepted } = runtimeFor(preflight);
    const result = await executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
      signal: controller.signal,
    });
    expect(controller.signal.aborted).toBe(true);
    await expect(runs.load(result.runId)).resolves.toMatchObject({
      run: { runId: result.runId },
    });
  });

  test('cleans temporary data when the execution deadline expires before promotion', async () => {
    const { directory, snapshots } = await repositories();
    const saved = await snapshots.save(comparisonSnapshot());
    const preflight = await createSnapshotAuditPreflightV1({
      ticker: saved.canonicalTicker,
      snapshotId: saved.snapshotId,
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    let advance = (_durationMs: number): void => {};
    class ExpireAfterPublishStartsRepository extends StrategyValidationRunRepositoryV1 {
      override publish(
        publication: StrategyValidationRunPublicationV1,
        options: StrategyValidationRunPublishOptionsV1 = {},
      ) {
        const publishing = super.publish(publication, options);
        advance(preflight.executionPlan.executionBudgetMs);
        return publishing;
      }
    }
    const runs = new ExpireAfterPublishStartsRepository(join(directory, 'expire-before-promote'), {
      promoteDirectory: rename,
    });
    const execution = runtimeFor(preflight);
    advance = execution.advance;
    await expect(executeSnapshotAuditV1(preflight, {
      source: new JQuantsValidationAdapterV1(execution.runtime),
      runtime: execution.runtime,
      accepted: execution.accepted,
      runRepository: runs,
    })).rejects.toMatchObject({ code: 'execution_timeout' });
    expect(await readdir(runs.runsDirectory)).toEqual([]);
  });
});
