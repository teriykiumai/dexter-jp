import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateEtf1321EodV1, calculateEtfRelativeV1, etfRangeStartV1 } from './etf-series.js';
import { collectEtfModuleV1, ETF_JOB_LIMITS_V1 } from './etf-source.js';
import { createEtfArtifactCodecV1, etfRegistryRowsV1 } from './etf-artifact.js';
import { createEtfOverviewRegistryV1 } from './etf-adapter.js';
import type { OverviewCollectionContextV1 } from './overview-registry.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { MarketDataRepositoryV1 } from './repository.js';
import { MarketDataJobServiceV1 } from './job-service.js';
import { MarketDataJobRepositoryV1 } from './job-repository.js';
import { DashboardJobCoordinatorV1 } from '../dashboard-jobs/coordinator.js';

const bar = (date: string, close: number) => ({ kind: 'bar' as const, date, open: close, high: close, low: close, close, volume: 0 });
test('ETF arithmetic uses exact inner joins, inclusive clamped ranges, base 100 and unrounded sign', () => {
  expect(etfRangeStartV1('2024-05-31', '3m')).toBe('2024-02-29');
  expect(etfRangeStartV1('2024-02-29', '1y')).toBe('2023-02-28');
  expect(etfRangeStartV1('2024-02-29', 'max')).toBeNull();
  const left = [bar('2025-01-01', 10), bar('2026-06-09', 20), bar('2026-09-08', 25), bar('2026-09-09', 30)];
  const right = [bar('2025-01-01', 10), bar('2026-06-09', 20), bar('2026-09-09', 20)];
  const result = calculateEtfRelativeV1(left, right);
  expect(result[0]).toMatchObject({ state: 'available', commonDates: ['2026-06-09', '2026-09-09'],
    normalized1321: [100, 150], normalized2633: [100, 100], differencePercentagePoints: 50, direction: '1321_leads' });
  expect(calculateEtfRelativeV1(right, left)[0]).toMatchObject({ direction: '2633_leads' });
  expect(calculateEtfRelativeV1(left, left)[0]).toMatchObject({ direction: 'same', differencePercentagePoints: 0 });
  expect(() => calculateEtfRelativeV1([left[0]!, left[0]!], right)).toThrow();
  expect(calculateEtfRelativeV1([bar('2026-09-08', 0), bar('2026-09-09', 1)],
    [bar('2026-09-08', 1), bar('2026-09-09', 1)])[0]).toMatchObject({ reason: 'invalid_base' });
  expect(calculateEtf1321EodV1([bar('2026-09-09', 1)], '2026-09-09').changeYen)
    .toEqual({ state: 'unavailable', reason: 'insufficient_history' });
  expect(calculateEtf1321EodV1([bar('2026-09-08', 0), bar('2026-09-09', 1)], '2026-09-09').changeRatePercent)
    .toEqual({ state: 'unavailable', reason: 'zero_denominator' });
});

test('relative ETF handles no/one common date, mixed range availability and preserves its inputs', () => {
  const left = [bar('2025-01-01', 100), bar('2026-09-09', 101)];
  const before = JSON.stringify(left);
  const mixed = calculateEtfRelativeV1(left, left);
  expect(mixed[0]).toMatchObject({ state: 'unavailable', reason: 'insufficient_common_dates', commonDateCount: 1,
    rangeStart: '2026-09-09', rangeEnd: '2026-09-09' });
  expect(mixed[4]).toMatchObject({ state: 'available', direction: 'same' });
  for (const row of calculateEtfRelativeV1(left, [bar('2026-09-08', 100)])) {
    expect(row).toMatchObject({ state: 'unavailable', reason: 'insufficient_common_dates', rangeStart: null, rangeEnd: null, commonDateCount: 0 });
    expect(row).not.toHaveProperty('direction');
  }
  expect(JSON.stringify(left)).toBe(before);
});

test('announced ETF split registries do not apply a second adjustment or distributions to adjusted prices', () => {
  expect(etfRegistryRowsV1('1321', '2026-09-10T08:00:00.000Z', '2026-09-10')).toEqual([]);
  expect(etfRegistryRowsV1('1321', '2026-10-08T08:00:00.000Z', '2026-10-08')[0]).toMatchObject({ ratioTo: 100, effectiveDate: '2026-10-07' });
  expect(etfRegistryRowsV1('2633', '2026-09-10T08:00:00.000Z', '2026-09-10')[0]).toMatchObject({ ratioTo: 10, effectiveDate: '2023-12-08' });
  for (const [before, after] of [['2026-10-06', '2026-10-07'], ['2023-12-07', '2023-12-08']]) {
    const adjusted = [bar(before!, 100), bar(after!, 100)];
    expect(calculateEtf1321EodV1(adjusted, after!).changeRatePercent).toEqual({ state: 'available', value: 0 });
    expect(calculateEtfRelativeV1(adjusted, adjusted)[4]).toMatchObject({ normalized1321: [100, 100], direction: 'same' });
  }
});

function fixture(options: { empty?: string[]; gap?: string[]; missing?: boolean; mismatch?: boolean; status?: number; acceptedAt?: string } = {}) {
  const acceptedAt = options.acceptedAt ?? '2026-09-10T08:00:00.000Z';
  const calls: string[] = [], shared = new Map<string, Promise<unknown>>();
  const environment: JQuantsExecutionEnvironmentV1 = {
    apiKey: () => 'fixture-key', wallNowMs: () => Date.parse(acceptedAt) + 1000, monotonicNowMs: () => 0,
    sleep: async () => {}, fetch: async input => {
      const url = new URL(String(input)), code = url.searchParams.get('code') ?? '';
      calls.push(`${url.pathname}:${code}`);
      if (options.status) return new Response('private error', { status: options.status });
      if (url.pathname.endsWith('master')) return Response.json({ data: [{ Date: url.searchParams.get('date'), Code: code,
        CoName: '合成ETF', ProdCat: '014', Mkt: options.mismatch ? '0111' : '0109', ignored: 'not-persisted' }] });
      if (url.pathname.endsWith('daily') && options.empty?.includes(code)) return Response.json({ data: [] });
      const calendar = url.pathname.endsWith('calendar'), rows = [];
      for (let ms = Date.parse(calendar ? url.searchParams.get('from')! : '2026-07-01'); ms <= Date.parse(url.searchParams.get('to')!); ms += 86400000) {
        const d = new Date(ms), date = d.toISOString().slice(0, 10), session = ![0, 6].includes(d.getUTCDay());
        if (calendar) rows.push({ Date: date, HolDiv: session ? '1' : '0' });
        else if (session && !(options.missing && date === '2026-07-10')) {
          const gap = options.gap?.includes(code), close = code === '13210' ? 100 : 200;
          rows.push({ Date: date, Code: code, AdjO: gap ? null : close, AdjH: gap ? null : close,
            AdjL: gap ? null : close, AdjC: gap ? null : close, AdjVo: gap ? null : 0, AdjFactor: 1, ExRT: null });
        }
      }
      return Response.json({ data: rows });
    },
  };
  const context: OverviewCollectionContextV1 = { jobId: '11111111-1111-4111-8111-111111111111', acceptedAt,
    signal: new AbortController().signal, dispatch: async start => start(new AbortController().signal), recordProgress: () => {},
    shareSource: <T>(key: string, load: () => Promise<T>) => { if (!shared.has(key)) shared.set(key, load()); return shared.get(key) as Promise<T>; } };
  return { context, environment, calls };
}

test('ETF production modules share five inputs but persist exact four/seven-role manifests', async () => {
  const h = fixture();
  const first = await collectEtfModuleV1('etf_1321_eod', h.context, h.environment, {});
  const second = await collectEtfModuleV1('etf_1321_2633_relative', h.context, h.environment, {});
  expect(first.attempts).toBe(3); expect(second.attempts).toBe(2); expect(h.calls).toHaveLength(5);
  expect(first.artifact.sourceInputs).toHaveLength(4); expect(second.artifact.sourceInputs).toHaveLength(7);
  expect(first.artifact.sourceInputs.find(i => i.role === 'daily_bars_1321')?.inputDigest)
    .toBe(second.artifact.sourceInputs.find(i => i.role === 'daily_bars_1321')?.inputDigest);
  expect(second.artifact.warnings.map(w => w.code)).toEqual(['history_coverage_clipped', 'historical_identity_unverified']);
  expect(second.artifact.warnings[0]?.message).toBe('取得できた履歴の開始日は1321が2026-07-01、2633が2026-07-01です。これらの日付は上場日を示しません。');
  const codec = createEtfArtifactCodecV1('etf_1321_2633_relative', {});
  expect(codec.parse(second.artifact)).toEqual(second.artifact);
  const { sourcePayloadDigest: _s, artifactDigest: _a, ...draft } = second.artifact;
  expect(() => codec.build({ ...draft, extra: true })).toThrow();
  expect(() => codec.build({ ...draft, historyBoundaries: [...draft.historyBoundaries].reverse() })).toThrow();
  expect(() => codec.build({ ...draft, warnings: [] })).toThrow();
  expect(() => codec.build({ ...draft, observations: draft.observations.map(o => ({ ...o, direction: '1321_leads' })) })).toThrow();
  expect(JSON.stringify(second.artifact)).not.toContain('not-persisted');
  expect(JSON.stringify(second.artifact)).not.toContain('fixture-key');
});

for (const options of [ { empty: ['13210'] }, { empty: ['26330'] }, { empty: ['13210', '26330'] },
  { gap: ['13210'] }, { gap: ['26330'] }, { gap: ['13210', '26330'] } ]) {
  test(`complete empty/all-null ETF remains authoritative unavailable ${JSON.stringify(options)}`, async () => {
    const h = fixture(options);
    const { artifact } = await collectEtfModuleV1('etf_1321_2633_relative', h.context, h.environment, {});
    expect(artifact.state).toBe('unavailable'); expect(artifact.reason).toBe('source_no_observation');
    expect(artifact.dataDate).toBe('2026-09-10');
    expect(artifact.observations).toHaveLength(5);
    for (const o of artifact.observations) expect(o).toMatchObject({ state: 'unavailable', reason: 'source_no_observation',
      rangeStart: null, rangeEnd: null, commonDateCount: 0 });
    expect(artifact.historyBoundaries.map(b => b.state)).toEqual(['13210', '26330'].map(code => options.empty?.includes(code) ? 'unavailable' : 'available'));
  });
}

test('complete unavailable 1321 publishes a new receipt replacing prior available without fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dexter-etf-'));
  try {
    const h = fixture(), empty = fixture({ empty: ['13210'], acceptedAt: '2026-09-10T08:00:01.000Z' });
    const repository = new MarketDataRepositoryV1(createEtfArtifactCodecV1('etf_1321_eod', {}), root);
    const first = await collectEtfModuleV1('etf_1321_eod', h.context, h.environment, {});
    const second = await collectEtfModuleV1('etf_1321_eod', empty.context, empty.environment, {});
    await repository.publish(first.artifact, { jobId: h.context.jobId, acceptedAt: h.context.acceptedAt, checkedAt: first.artifact.fetchedAt });
    await repository.publish(second.artifact, { jobId: '22222222-2222-4222-8222-222222222222',
      acceptedAt: '2026-09-10T08:00:01.000Z', checkedAt: '2026-09-10T08:00:02.000Z' });
    const latest = await repository.latest();
    expect(latest.artifact.state).toBe('unavailable'); expect(latest.state).toBe('available');
    const registry = createEtfOverviewRegistryV1(h.environment, root, {});
    expect(registry.get('etf_1321_eod')!.project(latest.artifact).state).toBe('unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [options, code] of [[{ missing: true }, 'source_invalid_response'], [{ mismatch: true }, 'instrument_identity_unverified'],
  [{ status: 403 }, 'source_entitlement_required'], [{ status: 500 }, 'source_invalid_response']] as const) {
  test(`ETF failures never produce artifacts: ${code}`, async () => {
    const h = fixture(options);
    await expect(collectEtfModuleV1('etf_1321_eod', h.context, h.environment, {})).rejects.toMatchObject({ code });
    expect(h.calls.length).toBeLessThanOrEqual(3);
  });
}

test('registered ETF adapters complete one shared job with exact accounting and read without fetching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dexter-etf-job-'));
  try {
    const h = fixture();
    const registry = createEtfOverviewRegistryV1(h.environment, join(root, 'data'), {});
    const coordinator = new DashboardJobCoordinatorV1(h.environment, 500);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
      cleanup: async () => {}, reconcile: async () => { throw new Error('Unexpected fixture recovery.'); } });
    const service = new MarketDataJobServiceV1({ coordinator,
      overviewRegistry: registry, jobRepository: new MarketDataJobRepositoryV1(join(root, 'jobs'), {}), limits: ETF_JOB_LIMITS_V1 });
    const accepted = await service.acceptOverview();
    let job = await service.getJob(accepted.jobId);
    for (let i = 0; i < 200 && !['completed', 'failed'].includes(job.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 10)); job = await service.getJob(accepted.jobId);
    }
    expect(job.status).toBe('completed'); expect(job.progress.attempts).toBe(5); expect(h.calls).toHaveLength(5);
    for (const module of registry.implemented()) expect(module.project((await module.latest()).artifact).state).toBe('available');
    expect(h.calls).toHaveLength(5);
    const unconfigured = { ...h.environment, apiKey: () => undefined };
    const noKeyService = new MarketDataJobServiceV1({ coordinator: new DashboardJobCoordinatorV1(unconfigured, 500),
      overviewRegistry: createEtfOverviewRegistryV1(unconfigured, join(root, 'missing-key'), {}),
      jobRepository: new MarketDataJobRepositoryV1(join(root, 'missing-key-jobs'), {}), limits: ETF_JOB_LIMITS_V1 });
    await expect(noKeyService.acceptOverview()).rejects.toMatchObject({ code: 'source_configuration_missing' });
    expect(h.calls).toHaveLength(5);
  } finally { await rm(root, { recursive: true, force: true }); }
});
