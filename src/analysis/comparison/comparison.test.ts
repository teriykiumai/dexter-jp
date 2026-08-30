import { describe, expect, test } from 'bun:test';
import { buildAnalysisSnapshot } from '../snapshot/builder.js';
import type { Phase3SnapshotInput } from '../snapshot/canonical-json.js';
import {
  AnalysisSnapshotV9Schema,
  type AnalysisSnapshot,
  type AnalysisSnapshotV9,
} from '../snapshot/schema.js';
import { compareAnalysisSnapshotsV1 } from './compare.js';
import { comparisonPresentationNumberV1 } from './presentation.js';
import {
  COMPARISON_METRIC_REGISTRY_V1,
  isCanonicalCalendarDateV1,
} from './registry.js';
import {
  AnalysisSnapshotComparisonResponseV1Schema,
  COMPARISON_METRIC_KEYS,
  ComparisonObservationV1Schema,
  ComparisonSectionStateV1Schema,
  type AnalysisSnapshotComparisonResponseV1,
  type ComparisonMetricKeyV1,
  type ComparisonObservationV1,
  type SnapshotComparisonMetricRowV1,
} from './schema.js';
import {
  comparisonInput,
  comparisonSnapshot,
  phase3Input,
  snapshotAtVersion,
} from './test-fixtures.js';

type Success = Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }>;
type Failure = Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'failure' }>;

function mutateV9(
  snapshot: AnalysisSnapshotV9,
  mutate: (value: AnalysisSnapshotV9) => void,
): AnalysisSnapshotV9 {
  const value = structuredClone(snapshot);
  mutate(value);
  return AnalysisSnapshotV9Schema.parse(value);
}

function success(base: AnalysisSnapshot, target: AnalysisSnapshot): Success {
  const result = compareAnalysisSnapshotsV1({
    ticker: '7203',
    base: phase3Input(base),
    target: phase3Input(target),
  });
  if (result.outcome !== 'success') throw new Error(result.error.code);
  return result;
}

function failure(
  base: Phase3SnapshotInput,
  target: Phase3SnapshotInput,
  ticker = '7203',
): Failure {
  const result = compareAnalysisSnapshotsV1({ ticker, base, target });
  if (result.outcome !== 'failure') throw new Error('Expected Comparison failure.');
  return result;
}

function row(
  result: Success,
  key: ComparisonMetricKeyV1,
  identityValue?: readonly [string, string | number | boolean | null],
): SnapshotComparisonMetricRowV1 {
  const matches = result.metricRows.filter(candidate => (
    candidate.metricKey === key
    && (identityValue === undefined || candidate.instanceIdentity.some(item => (
      item.name === identityValue[0] && item.value === identityValue[1]
    )))
  ));
  if (matches.length !== 1) throw new Error(`Expected one row for ${key}.`);
  return matches[0];
}

describe('Comparison registry V1', () => {
  test('fixes all 67 keys, metadata, definition order, and section counts', () => {
    const metadata = [
      ['valuation.currentPrice', 'JPY', 'native', 1],
      ['valuation.per', 'multiple', 'native', 1],
      ['valuation.pbr', 'multiple', 'native', 1],
      ['valuation.dividendYieldPercent', 'percent', 'percent_value', 1],
      ['valuation.revenueCagrPercent', 'percent', 'percent_value', 1],
      ['fundamental.latest.revenue', 'JPY', 'native', 1],
      ['fundamental.latest.operatingIncome', 'JPY', 'native', 1],
      ['fundamental.latest.ordinaryIncome', 'JPY', 'native', 1],
      ['fundamental.latest.netIncome', 'JPY', 'native', 1],
      ['fundamental.latest.eps', 'JPY', 'native', 1],
      ['fundamental.latest.roe', 'ratio', 'fraction_as_percent', 1],
      ['fundamental.latest.equityRatio', 'ratio', 'fraction_as_percent', 1],
      ['fundamental.latest.operatingCashFlow', 'JPY', 'native', 1],
      ['fundamental.latest.freeCashFlow', 'JPY', 'native', 1],
      ['technical.ma20', 'JPY', 'native', 1],
      ['technical.atr14', 'JPY', 'native', 1],
      ['technical.averageVolume20', 'shares', 'native', 1],
      ['technical.latestSwingHigh', 'JPY', 'native', 1],
      ['technical.latestSwingLow', 'JPY', 'native', 1],
      ['technical.trend', null, 'category', 1],
      ['advancedTechnical.rsi14', 'index', 'native', 2],
      ['advancedTechnical.macd.value', 'JPY', 'native', 2],
      ['advancedTechnical.macd.signal', 'JPY', 'native', 2],
      ['advancedTechnical.macd.histogram', 'JPY', 'native', 2],
      ['advancedTechnical.bollinger20.middle', 'JPY', 'native', 2],
      ['advancedTechnical.bollinger20.upper', 'JPY', 'native', 2],
      ['advancedTechnical.bollinger20.lower', 'JPY', 'native', 2],
      ['supplyDemand.buyingBalance', 'shares', 'native', 1],
      ['supplyDemand.sellingBalance', 'shares', 'native', 1],
      ['supplyDemand.marginRatio', 'ratio', 'native', 1],
      ['supplyDemand.buyingBalanceWeeklyChange', 'shares', 'native', 1],
      ['supplyDemand.sellingBalanceWeeklyChange', 'shares', 'native', 1],
      ['supplyDemand.mean4w', 'shares', 'native', 3],
      ['supplyDemand.mean13w', 'shares', 'native', 1],
      ['supplyDemand.mean52w', 'shares', 'native', 1],
      ['supplyDemand.deviation52w', 'ratio', 'fraction_as_percent', 1],
      ['supplyDemand.percentile52w', 'ratio', 'fraction_as_percent', 1],
      ['supplyDemand.averageDailyVolume20', 'shares', 'native', 1],
      ['supplyDemand.digestionDays', 'days', 'native', 1],
      ['marketCorrelation.window.observations', 'count', 'native', 1],
      ['marketCorrelation.window.correlation', 'ratio', 'native', 1],
      ['marketCorrelation.window.beta', 'ratio', 'native', 1],
      ['marketCorrelation.window.alphaAnnualized', 'ratio', 'fraction_as_percent', 1],
      ['marketCorrelation.window.rSquared', 'ratio', 'native', 1],
      ['sectorBenchmark.window.observations', 'count', 'native', 6],
      ['sectorBenchmark.window.correlation', 'ratio', 'native', 6],
      ['sectorBenchmark.window.beta', 'ratio', 'native', 6],
      ['sectorBenchmark.window.alphaAnnualized', 'ratio', 'fraction_as_percent', 6],
      ['sectorBenchmark.window.rSquared', 'ratio', 'native', 6],
      ['sectorBenchmark.window.stockVolatilityAnnualized', 'ratio', 'fraction_as_percent', 6],
      ['sectorBenchmark.window.benchmarkVolatilityAnnualized', 'ratio', 'fraction_as_percent', 6],
      ['sectorBenchmark.window.excessReturn', 'ratio', 'fraction_as_percent', 6],
      ['strategy.entry.triggerPrice', 'JPY', 'native', 1],
      ['strategy.entry.price', 'JPY', 'native', 1],
      ['strategy.candidate.entry.price', 'JPY', 'native', 1],
      ['strategy.candidate.stop.price', 'JPY', 'native', 1],
      ['strategy.candidate.target.price', 'JPY', 'native', 1],
      ['strategy.candidate.rewardRisk', 'ratio', 'native', 1],
      ['advancedDividend.fiscal.annualDividendPerShare', 'JPY_per_share', 'native', 8],
      ['advancedDividend.fiscal.payoutRatio', 'ratio', 'fraction_as_percent', 8],
      ['advancedDividend.event.dividendPerShare', 'JPY_per_share', 'native', 8],
      ['advancedDividend.event.ordinaryDividendPerShare', 'JPY_per_share', 'native', 8],
      ['advancedDividend.event.commemorativeDividendPerShare', 'JPY_per_share', 'native', 8],
      ['advancedDividend.event.specialDividendPerShare', 'JPY_per_share', 'native', 8],
      ['volumeProfile.poc.price', 'JPY', 'native', 9],
      ['volumeProfile.valueArea.val', 'JPY', 'native', 9],
      ['volumeProfile.valueArea.vah', 'JPY', 'native', 9],
    ];
    expect(COMPARISON_METRIC_REGISTRY_V1).toHaveLength(67);
    expect(COMPARISON_METRIC_REGISTRY_V1.map(definition => definition.key))
      .toEqual([...COMPARISON_METRIC_KEYS]);
    expect(new Set(COMPARISON_METRIC_KEYS).size).toBe(67);
    expect(JSON.stringify(COMPARISON_METRIC_REGISTRY_V1.map(definition => [
      definition.key,
      definition.expectedUnit,
      definition.displaySemantics,
      definition.introducedInSnapshotVersion,
    ]))).toBe(JSON.stringify(metadata));
    expect(Object.fromEntries([...new Set(COMPARISON_METRIC_REGISTRY_V1.map(item => item.section))]
      .map(section => [section, COMPARISON_METRIC_REGISTRY_V1.filter(item => item.section === section).length])))
      .toEqual({
        valuation: 5,
        fundamental: 9,
        technical: 6,
        advancedTechnical: 7,
        supplyDemand: 12,
        marketCorrelation: 5,
        sectorBenchmark: 8,
        strategy: 6,
        advancedDividend: 6,
        volumeProfile: 3,
      });
  });

  test('emits every definition in deterministic instance order with exact provenance', () => {
    const result = success(
      comparisonSnapshot('2026-08-22T01:00:00.000Z'),
      comparisonSnapshot('2026-08-22T02:00:00.000Z'),
    );
    expect(result.metricRows).toHaveLength(103);
    expect(new Set(result.metricRows.map(item => item.metricKey))).toEqual(new Set(COMPARISON_METRIC_KEYS));
    expect(result.metricRows.every(item => (
      item.instanceIntroducedInSnapshotVersion >= item.definitionIntroducedInSnapshotVersion
    ))).toBeTrue();
    expect(result.metricRows
      .filter(item => item.metricKey === 'marketCorrelation.window.beta')
      .map(item => item.instanceIdentity.find(identity => identity.name === 'period')?.value))
      .toEqual([20, 60, 250]);
    expect(result.metricRows
      .filter(item => item.metricKey === 'advancedDividend.fiscal.payoutRatio')
      .map(item => item.instanceIdentity))
      .toEqual([
        [{ name: 'kind', value: 'company_forecast' }, { name: 'fiscalYearEndDate', value: '2027-03-31' }],
        [{ name: 'kind', value: 'actual' }, { name: 'fiscalYearEndDate', value: '2026-03-31' }],
      ]);
    const fiscal = row(
      result,
      'advancedDividend.fiscal.annualDividendPerShare',
      ['fiscalYearEndDate', '2027-03-31'],
    );
    expect(fiscal.base.provenance.some(item => item.qualifiers.some(qualifier => (
      qualifier.name === 'endpoint' && qualifier.value === '/v2/fins/summary'
    )))).toBeTrue();
    expect(row(result, 'valuation.currentPrice').base.provenance)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        source: 'jquants', role: 'price_data', sourceUrls: ['https://example.test/prices'],
      })]));
  });

  test('uses the explicit V9 accessor for every definition key', () => {
    const result = success(
      comparisonSnapshot('2026-08-22T01:00:00.000Z'),
      comparisonSnapshot('2026-08-22T02:00:00.000Z'),
    );
    const firstValueByKey = Object.fromEntries(COMPARISON_METRIC_KEYS.map(key => {
      const observation = result.metricRows.find(item => item.metricKey === key)?.base;
      if (observation === undefined) throw new Error(`Missing ${key}.`);
      return [key, observation.value];
    }));
    expect(firstValueByKey).toEqual({
      'valuation.currentPrice': 3_000,
      'valuation.per': 15,
      'valuation.pbr': 1.2,
      'valuation.dividendYieldPercent': 2.5,
      'valuation.revenueCagrPercent': 5,
      'fundamental.latest.revenue': 48_000,
      'fundamental.latest.operatingIncome': 4_000,
      'fundamental.latest.ordinaryIncome': 4_500,
      'fundamental.latest.netIncome': 3_000,
      'fundamental.latest.eps': 200,
      'fundamental.latest.roe': 0.12,
      'fundamental.latest.equityRatio': 0.4,
      'fundamental.latest.operatingCashFlow': 5_000,
      'fundamental.latest.freeCashFlow': 2_000,
      'technical.ma20': 2_950,
      'technical.atr14': 80,
      'technical.averageVolume20': 20_000_000,
      'technical.latestSwingHigh': 3_050,
      'technical.latestSwingLow': 2_800,
      'technical.trend': 'uptrend',
      'advancedTechnical.rsi14': 62.5,
      'advancedTechnical.macd.value': 45,
      'advancedTechnical.macd.signal': 40,
      'advancedTechnical.macd.histogram': 5,
      'advancedTechnical.bollinger20.middle': 2_950,
      'advancedTechnical.bollinger20.upper': 3_150,
      'advancedTechnical.bollinger20.lower': 2_750,
      'supplyDemand.buyingBalance': 10_000,
      'supplyDemand.sellingBalance': 2_000,
      'supplyDemand.marginRatio': 5,
      'supplyDemand.buyingBalanceWeeklyChange': 100,
      'supplyDemand.sellingBalanceWeeklyChange': -100,
      'supplyDemand.mean4w': 9_500,
      'supplyDemand.mean13w': 9_000,
      'supplyDemand.mean52w': 8_000,
      'supplyDemand.deviation52w': 0.25,
      'supplyDemand.percentile52w': 0.8,
      'supplyDemand.averageDailyVolume20': 20_000_000,
      'supplyDemand.digestionDays': 0.0005,
      'marketCorrelation.window.observations': 20,
      'marketCorrelation.window.correlation': 0.6,
      'marketCorrelation.window.beta': 1.1,
      'marketCorrelation.window.alphaAnnualized': 0.02,
      'marketCorrelation.window.rSquared': 0.36,
      'sectorBenchmark.window.observations': 20,
      'sectorBenchmark.window.correlation': 0.6,
      'sectorBenchmark.window.beta': 1.1,
      'sectorBenchmark.window.alphaAnnualized': 0.02,
      'sectorBenchmark.window.rSquared': 0.36,
      'sectorBenchmark.window.stockVolatilityAnnualized': 0.25,
      'sectorBenchmark.window.benchmarkVolatilityAnnualized': 0.18,
      'sectorBenchmark.window.excessReturn': 0.03,
      'strategy.entry.triggerPrice': 3_050,
      'strategy.entry.price': 3_051,
      'strategy.candidate.entry.price': 3_051,
      'strategy.candidate.stop.price': 2_931,
      'strategy.candidate.target.price': 3_291,
      'strategy.candidate.rewardRisk': 2,
      'advancedDividend.fiscal.annualDividendPerShare': 100,
      'advancedDividend.fiscal.payoutRatio': 0.35,
      'advancedDividend.event.dividendPerShare': 50,
      'advancedDividend.event.ordinaryDividendPerShare': 50,
      'advancedDividend.event.commemorativeDividendPerShare': null,
      'advancedDividend.event.specialDividendPerShare': null,
      'volumeProfile.poc.price': 3_000,
      'volumeProfile.valueArea.val': 2_900,
      'volumeProfile.valueArea.vah': 3_100,
    });
    expect(row(
      result,
      'advancedDividend.event.commemorativeDividendPerShare',
      ['recordDateYearMonth', '2026-09'],
    ).base).toMatchObject({ state: 'available', value: 5 });
  });

  test('declares every comparison date role in the registry instead of inferring it', () => {
    const roles = (key: ComparisonMetricKeyV1) => (
      COMPARISON_METRIC_REGISTRY_V1.find(item => item.key === key)!.comparisonDateRoles
    );
    expect(roles('valuation.currentPrice')).toEqual(['price']);
    for (const key of ['valuation.per', 'valuation.pbr', 'valuation.dividendYieldPercent'] as const) {
      expect(roles(key)).toEqual(['price', 'financial']);
    }
    expect(roles('valuation.revenueCagrPercent')).toEqual(['financial']);
    for (const definition of COMPARISON_METRIC_REGISTRY_V1) {
      if (definition.section === 'fundamental') expect(definition.comparisonDateRoles).toEqual(['submit']);
      if (definition.section === 'technical' || definition.section === 'advancedTechnical') {
        expect(definition.comparisonDateRoles).toEqual(['section']);
      }
      if (definition.section === 'marketCorrelation') {
        expect(definition.comparisonDateRoles).toEqual(['section', 'window_start', 'window_end']);
      }
      if (definition.section === 'sectorBenchmark') {
        expect(definition.comparisonDateRoles)
          .toEqual(['analysis_as_of', 'section', 'window_start', 'window_end']);
      }
      if (definition.section === 'strategy') expect(definition.comparisonDateRoles).toEqual(['section']);
      if (definition.section === 'volumeProfile') {
        expect(definition.comparisonDateRoles).toEqual(['section', 'window_start', 'window_end']);
      }
    }
    expect(roles('supplyDemand.averageDailyVolume20')).toEqual(['volume']);
    expect(roles('supplyDemand.digestionDays')).toEqual(['section', 'volume']);
    for (const definition of COMPARISON_METRIC_REGISTRY_V1.filter(item => (
      item.section === 'supplyDemand'
      && item.key !== 'supplyDemand.averageDailyVolume20'
      && item.key !== 'supplyDemand.digestionDays'
    ))) expect(definition.comparisonDateRoles).toEqual(['section']);
    for (const definition of COMPARISON_METRIC_REGISTRY_V1.filter(item => (
      item.key.startsWith('advancedDividend.fiscal.')
    ))) expect(definition.comparisonDateRoles).toEqual(['source_eligible', 'disclosed']);
    for (const definition of COMPARISON_METRIC_REGISTRY_V1.filter(item => (
      item.key.startsWith('advancedDividend.event.')
    ))) expect(definition.comparisonDateRoles).toEqual(['source_eligible', 'notified']);
  });
});

describe('compareAnalysisSnapshotsV1 request and version contract', () => {
  test('returns the versioned success identity, digests, raw delta, and comparisonAsOf', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.valuation === null) throw new Error('fixture');
      value.valuation.currentPrice = 3_100;
    });
    const result = success(base, target);
    expect(result.resultVersion).toBe(1);
    expect(result.registryVersion).toBe(1);
    expect(result.comparisonAsOf).toBe(target.generatedAt);
    expect(result.base.snapshotDigest).toBe(phase3Input(base).snapshotDigest);
    expect(result.target.snapshotDigest).toBe(phase3Input(target).snapshotDigest);
    expect(row(result, 'valuation.currentPrice').comparison).toEqual({
      state: 'comparable', mode: 'absolute_delta', delta: 100, deltaUnit: 'JPY', changed: true,
    });
    expect(AnalysisSnapshotComparisonResponseV1Schema.safeParse(result).success).toBeTrue();
  });

  test('accepts all 81 readable V1-V9 combinations without mutating either input', () => {
    const versions = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
    const baseV9 = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const targetV9 = comparisonSnapshot('2026-08-22T02:00:00.000Z');
    for (const baseVersion of versions) {
      for (const targetVersion of versions) {
        const base = snapshotAtVersion(baseV9, baseVersion);
        const target = snapshotAtVersion(targetV9, targetVersion);
        const before = JSON.stringify({ base, target });
        const result = success(base, target);
        expect(result.base.schemaVersion).toBe(baseVersion);
        expect(result.target.schemaVersion).toBe(targetVersion);
        expect(JSON.stringify({ base, target })).toBe(before);
      }
    }
  });

  test('uses numeric epoch order and rejects invalid selectors without swapping or leaking detail', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00Z');
    const target = comparisonSnapshot('2026-08-22T01:00:00.500Z');
    expect(success(base, target).outcome).toBe('success');
    expect(failure(phase3Input(target), phase3Input(base)).error.code).toBe('invalid_order');
    expect(failure(phase3Input(base), phase3Input(target), '../7203').error.code).toBe('invalid_ticker');
    expect(failure(
      { ...phase3Input(base), snapshotId: 'bad' },
      phase3Input(target),
    ).error.code).toBe('invalid_base_snapshot_id');
    expect(failure(
      phase3Input(base),
      { ...phase3Input(target), snapshotId: 'bad' },
    ).error.code).toBe('invalid_target_snapshot_id');
    expect(failure(phase3Input(base), { ...phase3Input(target), snapshotId: phase3Input(base).snapshotId })
      .error.code).toBe('same_snapshot_id');

    const mismatch = mutateV9(target, value => { value.canonicalTicker = '6758'; });
    expect(failure(phase3Input(base), phase3Input(mismatch)).error.code)
      .toBe('target_ticker_mismatch');
    const baseMismatch = mutateV9(base, value => { value.canonicalTicker = '6758'; });
    expect(failure(phase3Input(baseMismatch), phase3Input(target)).error.code)
      .toBe('base_ticker_mismatch');
    const badDigest = failure(
      { ...phase3Input(base), snapshotDigest: `sha256:${'0'.repeat(64)}` },
      phase3Input(target),
    );
    expect(badDigest.error).toEqual({
      code: 'corrupt_snapshot', message: 'A requested Snapshot is corrupt.',
    });
    expect(JSON.stringify(badDigest)).not.toContain('example.test');
  });

  test('distinguishes an unsupported runtime schema version from corruption', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = comparisonSnapshot('2026-08-22T02:00:00.000Z');
    const unsupported = {
      ...phase3Input(base),
      snapshot: { ...base, schemaVersion: 10 },
    } as unknown as Phase3SnapshotInput;
    expect(failure(unsupported, phase3Input(target)).error.code)
      .toBe('unsupported_snapshot_version');
  });
});

describe('Comparison observations and dispositions', () => {
  test('uses fixed instance introduction versions instead of treating old data as absent', () => {
    const base = snapshotAtVersion(comparisonSnapshot('2026-08-22T01:00:00.000Z'), 1);
    const target = snapshotAtVersion(comparisonSnapshot('2026-08-22T02:00:00.000Z'), 3);
    const result = success(base, target);
    const day20 = row(result, 'marketCorrelation.window.beta', ['period', 20]);
    const day60 = row(result, 'marketCorrelation.window.beta', ['period', 60]);
    expect(day20.instanceIntroducedInSnapshotVersion).toBe(3);
    expect(day20.base).toMatchObject({
      state: 'not_collected',
      unavailableReasons: [{ reason: 'schema_predates_instance', detail: null }],
    });
    expect(day20.target.state).toBe('available');
    expect(day60.instanceIntroducedInSnapshotVersion).toBe(1);
    expect(day60.base.state).toBe('available');
    for (const period of [20, 60, 250] as const) {
      expect(row(
        result,
        'sectorBenchmark.window.beta',
        ['period', period],
      ).instanceIntroducedInSnapshotVersion).toBe(6);
    }
    expect(row(result, 'supplyDemand.mean4w').base).toMatchObject({
      state: 'not_collected',
      unavailableReasons: [{ reason: 'schema_predates_instance', detail: null }],
    });
  });

  test('preserves exact reasons, uses only missing_metric_value fallback, and keeps zero available', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.valuation === null || value.fundamental === null || value.advancedDividend === null) {
        throw new Error('fixture');
      }
      value.valuation.per = null;
      value.valuation.currentPrice = null;
      value.fundamental.periods.at(-1)!.revenue = null;
      value.fundamental.periods.at(-1)!.operatingIncome = null;
      value.fundamental.periods.at(-1)!.roe = 0;
      value.unavailable.push({
        section: 'valuation', metric: 'per', reason: 'missing_or_invalid_eps', detail: 'stored',
      });
      value.unavailable.push({
        section: 'valuation', metric: 'currentPrice', reason: 'missing_or_invalid_price',
      });
      value.unavailable.push({
        section: 'fundamental', metric: 'revenue', reason: 'fundamental_source_missing',
      });
    });
    const result = success(base, target);
    expect(row(result, 'valuation.per').target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_or_invalid_eps', detail: 'stored' }],
    });
    expect(row(result, 'valuation.currentPrice').target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_or_invalid_price', detail: null }],
    });
    expect(row(result, 'fundamental.latest.revenue').target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'fundamental_source_missing', detail: null }],
    });
    expect(row(result, 'fundamental.latest.operatingIncome').target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_metric_value', detail: null }],
    });
    expect(row(result, 'fundamental.latest.roe').target).toMatchObject({
      state: 'available', value: 0,
    });
  });

  test('fails closed on a non-null value paired with its exact stored unavailable reason', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      value.unavailable.push({
        section: 'valuation', metric: 'per', reason: 'missing_or_invalid_eps',
      });
    });
    expect(failure(phase3Input(base), phase3Input(target)).error.code).toBe('corrupt_snapshot');
  });

  test('maps nullable fiscal and event facts to exact stored scope reasons', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.advancedDividend === null) throw new Error('fixture');
      for (const observation of value.advancedDividend.observations) {
        observation.annualDividendPerShare = null;
        observation.payoutRatio = null;
      }
      for (const event of value.advancedDividend.events ?? []) {
        event.ordinaryDividendPerShare = null;
        event.commemorativeDividendPerShare = null;
        event.specialDividendPerShare = null;
      }
      value.advancedDividend.unavailable.push(
        { scope: 'core', reason: 'no_eligible_dividend_disclosure_data' },
        { scope: 'component', reason: 'component_breakdown_unavailable' },
      );
      value.unavailable.push(
        { section: 'advancedDividend', metric: 'core', reason: 'no_eligible_dividend_disclosure_data' },
        { section: 'advancedDividend', metric: 'component', reason: 'component_breakdown_unavailable' },
      );
    });
    const result = success(base, target);
    expect(row(
      result,
      'advancedDividend.fiscal.annualDividendPerShare',
      ['fiscalYearEndDate', '2027-03-31'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'no_eligible_dividend_disclosure_data', detail: null }],
    });
    expect(row(
      result,
      'advancedDividend.event.ordinaryDividendPerShare',
      ['recordDateYearMonth', '2027-03'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'component_breakdown_unavailable', detail: null }],
    });

    const eventUnavailable = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.advancedDividend === null) throw new Error('fixture');
      value.advancedDividend.events = null;
      value.advancedDividend.unavailable.push({
        scope: 'event', reason: 'event_source_plan_unavailable',
      });
      value.unavailable.push({
        section: 'advancedDividend', metric: 'event', reason: 'event_source_plan_unavailable',
      });
    });
    expect(row(
      success(base, eventUnavailable),
      'advancedDividend.event.dividendPerShare',
      ['recordDateYearMonth', '2027-03'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'event_source_plan_unavailable', detail: null }],
    });
    expect(row(
      success(base, eventUnavailable),
      'advancedDividend.event.ordinaryDividendPerShare',
      ['recordDateYearMonth', '2027-03'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'event_source_plan_unavailable', detail: null }],
    });
  });

  test('keeps complete dividend siblings available under collection-wide scope reasons', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.advancedDividend === null || value.advancedDividend.events === null) {
        throw new Error('fixture');
      }
      const incompleteFiscal = value.advancedDividend.observations.find(
        observation => observation.kind === 'company_forecast',
      );
      const incompleteEvent = value.advancedDividend.events.find(
        event => event.corporateActionReferenceNumber === 'action-2',
      );
      if (incompleteFiscal === undefined || incompleteEvent === undefined) throw new Error('fixture');
      incompleteFiscal.annualDividendPerShare = null;
      incompleteFiscal.payoutRatio = null;
      incompleteEvent.ordinaryDividendPerShare = null;
      value.advancedDividend.unavailable.push(
        { scope: 'core', reason: 'missing_data' },
        { scope: 'component', reason: 'component_breakdown_unavailable' },
      );
      value.unavailable.push(
        { section: 'advancedDividend', metric: 'core', reason: 'missing_data' },
        { section: 'advancedDividend', metric: 'component', reason: 'component_breakdown_unavailable' },
      );
    });
    const result = success(base, target);

    expect(row(
      result,
      'advancedDividend.fiscal.annualDividendPerShare',
      ['fiscalYearEndDate', '2026-03-31'],
    ).target).toMatchObject({ state: 'available', value: 90 });
    expect(row(
      result,
      'advancedDividend.fiscal.annualDividendPerShare',
      ['fiscalYearEndDate', '2027-03-31'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_data', detail: null }],
    });
    expect(row(
      result,
      'advancedDividend.event.ordinaryDividendPerShare',
      ['recordDateYearMonth', '2026-09'],
    ).target).toMatchObject({ state: 'available', value: 45 });
    expect(row(
      result,
      'advancedDividend.event.ordinaryDividendPerShare',
      ['recordDateYearMonth', '2027-03'],
    ).target).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'component_breakdown_unavailable', detail: null }],
    });
  });

  test('does not let an unrelated dividend scope reason hide an exact removed identity', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.advancedDividend === null || value.advancedDividend.events === null) {
        throw new Error('fixture');
      }
      value.advancedDividend.observations = value.advancedDividend.observations
        .filter(observation => observation.kind === 'actual');
      value.advancedDividend.observations[0].annualDividendPerShare = null;
      value.advancedDividend.observations[0].payoutRatio = null;
      value.advancedDividend.events = value.advancedDividend.events
        .filter(event => event.corporateActionReferenceNumber === 'action-1');
      value.advancedDividend.events[0].ordinaryDividendPerShare = null;
      value.advancedDividend.unavailable.push(
        { scope: 'core', reason: 'missing_data' },
        { scope: 'component', reason: 'component_breakdown_unavailable' },
      );
      value.unavailable.push(
        { section: 'advancedDividend', metric: 'core', reason: 'missing_data' },
        { section: 'advancedDividend', metric: 'component', reason: 'component_breakdown_unavailable' },
      );
    });
    const result = success(base, target);

    expect(row(
      result,
      'advancedDividend.fiscal.annualDividendPerShare',
      ['fiscalYearEndDate', '2027-03-31'],
    ).comparison).toMatchObject({ reason: 'record_removed', presentSide: 'base' });
    expect(row(
      result,
      'advancedDividend.event.ordinaryDividendPerShare',
      ['recordDateYearMonth', '2027-03'],
    ).comparison).toMatchObject({ reason: 'record_removed', presentSide: 'base' });
  });

  test('classifies section absence and rejects an existing section marked not_collected', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const missingInput = comparisonInput('2026-08-22T02:00:00.000Z');
    missingInput.fundamental = null;
    missingInput.advancedDividend = null;
    const target = mutateV9(comparisonSnapshotFromInput(missingInput), value => {
      value.units.fundamental.revenue = 'ratio';
    });
    const result = success(base, target);
    expect(result.sectionStates.find(item => item.section === 'fundamental')?.target).toEqual({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_required_section', detail: null }],
    });
    expect(result.sectionStates.find(item => item.section === 'advancedDividend')?.target).toEqual({
      state: 'not_collected',
      unavailableReasons: [{ reason: 'not_collected', detail: null }],
    });
    expect(row(result, 'fundamental.latest.revenue').target).toMatchObject({
      state: 'unavailable', actualUnit: 'ratio',
      unavailableReasons: [{ reason: 'missing_required_section', detail: null }],
    });

    const contradiction = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      value.unavailable.push({ section: 'technical', reason: 'not_collected' });
    });
    expect(failure(phase3Input(base), phase3Input(contradiction)).error.code)
      .toBe('corrupt_snapshot');
  });

  test('returns exact unit, identity, method, window, and date incomparability', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.fundamental === null || value.sectorBenchmark === null || value.volumeProfile === null) {
        throw new Error('fixture');
      }
      value.units.valuation.currentPrice = 'ratio';
      value.fundamental.periods.at(-1)!.fiscalYear = 2027;
      value.sectorBenchmark.benchmark!.sectorCode = '3600';
      value.volumeProfile.priceBasis = null;
      value.volumeProfile.inputBarCount = 119;
    });
    const result = success(base, target);
    expect(row(result, 'valuation.currentPrice').comparison).toMatchObject({ reason: 'unit_mismatch' });
    expect(row(result, 'fundamental.latest.revenue').comparison).toMatchObject({ reason: 'period_changed' });
    expect(row(result, 'sectorBenchmark.window.beta', ['period', 60]).comparison)
      .toMatchObject({ reason: 'benchmark_changed' });
    expect(row(result, 'volumeProfile.poc.price').comparison).toMatchObject({ reason: 'method_changed' });

    const windowOnly = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.volumeProfile === null) throw new Error('fixture');
      value.volumeProfile.inputBarCount = 119;
    });
    expect(row(success(base, windowOnly), 'volumeProfile.poc.price').comparison)
      .toMatchObject({ reason: 'window_changed' });

    const missingPeriodBase = mutateV9(base, value => {
      if (value.valuation === null) throw new Error('fixture');
      value.valuation.latestFiscalYear = null;
    });
    const missingPeriodTarget = mutateV9(
      comparisonSnapshot('2026-08-22T02:00:00.000Z'),
      value => {
        if (value.valuation === null) throw new Error('fixture');
        value.valuation.latestFiscalYear = null;
      },
    );
    expect(row(success(missingPeriodBase, missingPeriodTarget), 'valuation.per').comparison)
      .toMatchObject({ reason: 'period_changed' });
  });

  test('uses strict canonical Gregorian date roles and deterministic date precedence', () => {
    expect(isCanonicalCalendarDateV1('2000-02-29')).toBeTrue();
    for (const invalid of ['0000-01-01', '1900-02-29', '2026-2-01', '2026-04-31', '2026-01-1']) {
      expect(isCanonicalCalendarDateV1(invalid)).toBeFalse();
    }
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    for (const [date, reason] of [
      [null, 'missing_data_date'],
      ['2026-2-22', 'invalid_data_date'],
      ['2026-08-20', 'data_date_regressed'],
    ] as const) {
      const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
        if (value.technical === null) throw new Error('fixture');
        value.technical.dataDate = date;
      });
      expect(row(success(base, target), 'technical.ma20').comparison).toEqual({
        state: 'incomparable', mode: 'incomparable', delta: null, reason,
      });
    }

    const unchanged = success(
      base,
      comparisonSnapshot('2026-08-22T02:00:00.000Z'),
    );
    const definition = COMPARISON_METRIC_REGISTRY_V1.find(item => item.key === 'technical.ma20')!;
    const baseObservation = row(unchanged, 'technical.ma20').base;
    const targetObservation = row(unchanged, 'technical.ma20').target;
    if (baseObservation.state !== 'available' || targetObservation.state !== 'available') {
      throw new Error('fixture');
    }
    expect(definition.compare(baseObservation, {
      ...targetObservation,
      dataDates: [...targetObservation.dataDates, targetObservation.dataDates[0]],
    })).toMatchObject({ reason: 'invalid_data_date' });
  });

  test('emits added, removed, and duplicate-identity outcomes without selecting an array value', () => {
    const base = mutateV9(comparisonSnapshot('2026-08-22T01:00:00.000Z'), value => {
      if (value.strategy === null) throw new Error('fixture');
      value.strategy.candidates = value.strategy.candidates.slice(0, 1);
    });
    const target = comparisonSnapshot('2026-08-22T02:00:00.000Z');
    const added = success(base, target).metricRows.filter(item => (
      item.metricKey.startsWith('strategy.candidate.')
      && item.instanceIdentity.some(identity => identity.value === 'entry_minus_1_5_atr')
    ));
    expect(added).toHaveLength(4);
    expect(added.every(item => (
      'reason' in item.comparison && item.comparison.reason === 'record_added'
    ))).toBeTrue();
    const removed = success(
      comparisonSnapshot('2026-08-22T01:00:00.000Z'),
      mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
        if (value.strategy === null) throw new Error('fixture');
        value.strategy.candidates = value.strategy.candidates.slice(0, 1);
      }),
    );
    expect(row(
      removed,
      'strategy.candidate.rewardRisk',
      ['stop.reason', 'entry_minus_1_5_atr'],
    ).comparison).toMatchObject({ reason: 'record_removed' });

    const duplicate = mutateV9(target, value => {
      if (value.strategy === null) throw new Error('fixture');
      value.strategy.candidates.push(structuredClone(value.strategy.candidates[0]));
    });
    const ambiguous = row(
      success(base, duplicate),
      'strategy.candidate.entry.price',
      ['stop.reason', 'latest_swing_low'],
    );
    expect(ambiguous.target).toEqual({
      state: 'ambiguous',
      value: null,
      actualUnit: null,
      dataDates: [],
      provenance: [],
      identity: ambiguous.instanceIdentity,
      unavailableReasons: [{ reason: 'duplicate_instance_identity', detail: null }],
      candidateCount: 2,
    });
    expect(ambiguous.comparison).toMatchObject({
      reason: 'identity_ambiguous', affectedSides: ['target'],
      candidateCounts: { base: null, target: 2 },
    });

    const duplicateBase = mutateV9(base, value => {
      if (value.strategy === null) throw new Error('fixture');
      value.strategy.candidates.push(structuredClone(value.strategy.candidates[0]));
    });
    const bothAmbiguous = row(
      success(duplicateBase, duplicate),
      'strategy.candidate.entry.price',
      ['stop.reason', 'latest_swing_low'],
    );
    expect(bothAmbiguous.comparison).toMatchObject({
      reason: 'identity_ambiguous',
      affectedSides: ['base', 'target'],
      candidateCounts: { base: 2, target: 2 },
    });
  });

  test('detects duplicate Dividend identities and excludes resistance candidates', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.advancedDividend === null || value.strategy === null) throw new Error('fixture');
      value.advancedDividend.observations.push(structuredClone(value.advancedDividend.observations[0]));
      const resistance = structuredClone(value.strategy.candidates[0]);
      resistance.target.reason = 'resistance_level';
      value.strategy.candidates.push(resistance);
    });
    const result = success(base, target);
    const ambiguous = row(
      result,
      'advancedDividend.fiscal.payoutRatio',
      ['fiscalYearEndDate', '2026-03-31'],
    );
    expect(ambiguous.target).toMatchObject({ state: 'ambiguous', candidateCount: 2 });
    expect(result.metricRows.filter(item => item.metricKey.startsWith('strategy.candidate.')))
      .toHaveLength(8);
    expect(JSON.stringify(result.metricRows)).not.toContain('resistance_level');

    const duplicateBase = mutateV9(base, value => {
      if (value.advancedDividend === null) throw new Error('fixture');
      value.advancedDividend.observations.push(structuredClone(value.advancedDividend.observations[0]));
    });
    expect(row(
      success(duplicateBase, target),
      'advancedDividend.fiscal.payoutRatio',
      ['fiscalYearEndDate', '2026-03-31'],
    ).comparison).toMatchObject({
      reason: 'identity_ambiguous',
      affectedSides: ['base', 'target'],
      candidateCounts: { base: 2, target: 2 },
    });
  });

  test('uses from-to for categories without assigning favorable meaning', () => {
    const base = comparisonSnapshot('2026-08-22T01:00:00.000Z');
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.technical === null) throw new Error('fixture');
      value.technical.trend = 'downtrend';
    });
    expect(row(success(base, target), 'technical.trend').comparison).toEqual({
      state: 'comparable', mode: 'from_to', delta: null, changed: true,
    });
  });

  test('normalizes negative zero and exposes only registry-directed presentation scaling', () => {
    expect(comparisonPresentationNumberV1(0.12, 'fraction_as_percent')).toBe(12);
    expect(comparisonPresentationNumberV1(5, 'percent_value')).toBe(5);
    expect(comparisonPresentationNumberV1(1.2, 'native')).toBe(1.2);
    expect(Object.is(comparisonPresentationNumberV1(-0, 'native'), -0)).toBeFalse();
    const base = mutateV9(comparisonSnapshot('2026-08-22T01:00:00.000Z'), value => {
      if (value.valuation === null) throw new Error('fixture');
      value.valuation.currentPrice = 0;
    });
    const target = mutateV9(comparisonSnapshot('2026-08-22T02:00:00.000Z'), value => {
      if (value.valuation === null) throw new Error('fixture');
      value.valuation.currentPrice = -0;
    });
    const comparison = row(success(base, target), 'valuation.currentPrice').comparison;
    expect(comparison).toMatchObject({ mode: 'absolute_delta', delta: 0, changed: false });
    if (comparison.mode === 'absolute_delta') expect(Object.is(comparison.delta, -0)).toBeFalse();
  });
});

describe('Comparison runtime schemas', () => {
  const context = { dataDates: [], provenance: [], identity: [] };
  const invalidObservations = [
    { ...context, state: 'available', value: null, actualUnit: 'JPY', unavailableReasons: [] },
    { ...context, state: 'available', value: 1, actualUnit: 'JPY', unavailableReasons: [{ reason: 'x', detail: null }] },
    { ...context, state: 'unavailable', value: 1, actualUnit: 'JPY', unavailableReasons: [{ reason: 'x', detail: null }] },
    { ...context, state: 'unavailable', value: null, actualUnit: 'JPY', unavailableReasons: [] },
    { ...context, state: 'not_collected', value: 1, actualUnit: null, unavailableReasons: [{ reason: 'x', detail: null }] },
    { ...context, state: 'not_collected', value: null, actualUnit: 'JPY', unavailableReasons: [{ reason: 'x', detail: null }] },
    { ...context, state: 'not_collected', value: null, actualUnit: null, unavailableReasons: [] },
    { ...context, state: 'absent', value: null, actualUnit: null, unavailableReasons: [], dataDates: [{ role: 'section', value: null }] },
    { ...context, state: 'ambiguous', value: null, actualUnit: null, unavailableReasons: [{ reason: 'duplicate_instance_identity', detail: null }], candidateCount: 1 },
  ];

  test('rejects every invalid observation combination and empty section reason tuple', () => {
    for (const observation of invalidObservations) {
      expect(ComparisonObservationV1Schema.safeParse(observation).success).toBeFalse();
    }
    expect(ComparisonSectionStateV1Schema.safeParse({
      section: 'valuation',
      base: { state: 'unavailable', unavailableReasons: [] },
      target: { state: 'available', unavailableReasons: [] },
    }).success).toBeFalse();
  });

  test('makes every non-available disposition branch reachable in declared precedence', () => {
    const definition = COMPARISON_METRIC_REGISTRY_V1[0];
    const available: ComparisonObservationV1 = {
      ...context, state: 'available', value: 1, actualUnit: 'JPY', unavailableReasons: [],
    };
    const absent: ComparisonObservationV1 = {
      dataDates: [], provenance: [], identity: [],
      state: 'absent', value: null, actualUnit: null, unavailableReasons: [],
    };
    const unavailable: ComparisonObservationV1 = {
      ...context, state: 'unavailable', value: null, actualUnit: 'JPY',
      unavailableReasons: [{ reason: 'missing_metric_value', detail: null }],
    };
    const ambiguous: ComparisonObservationV1 = {
      dataDates: [], provenance: [], identity: [],
      state: 'ambiguous', value: null, actualUnit: null,
      unavailableReasons: [{ reason: 'duplicate_instance_identity', detail: null }],
      candidateCount: 2,
    };
    expect(definition.compare(absent, available)).toMatchObject({ reason: 'record_added' });
    expect(definition.compare(available, absent)).toMatchObject({ reason: 'record_removed' });
    expect(definition.compare(absent, unavailable)).toMatchObject({
      reason: 'non_available_state', affectedSides: ['base', 'target'],
    });
    expect(definition.compare(ambiguous, unavailable)).toMatchObject({
      reason: 'identity_ambiguous', affectedSides: ['base'],
    });
    expect(() => definition.compare(absent, absent)).toThrow();
  });
});

function comparisonSnapshotFromInput(input: ReturnType<typeof comparisonInput>): AnalysisSnapshotV9 {
  return buildAnalysisSnapshot(input);
}
