import { expect, test } from 'bun:test';
import { buildTechnicalFromInputsV1 } from '../analysis/market-data/technical-source.js';
import { workspaceTechnicalHistory } from '../analysis/workspace/technical-test-fixtures.js';
import { WorkspaceTechnicalCodec } from '../analysis/workspace/technical-artifact.js';
import { projectWorkspaceChart } from './workspace-chart.js';
import { WorkspaceChartSchema } from './workspace-contracts.js';
import { calculateRsiSeries, calculateMacdSeries } from '../tools/finance/advanced-technical-engine.js';
import { calculateSma } from '../tools/finance/technical-engine.js';
import { createTechnicalArtifactCodecV1 } from '../analysis/market-data/technical-artifact.js';

test('public chart gives source gap precedence even without an ongoing week/month candle', () => {
  const fixture = workspaceTechnicalHistory(['2025-03-12', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  const legacy = buildTechnicalFromInputsV1(fixture.fetched, {}).artifact;
  const artifact = new WorkspaceTechnicalCodec('7203').build(legacy, fixture.input);
  const before = JSON.stringify(artifact);
  const chart = WorkspaceChartSchema.parse(projectWorkspaceChart(artifact));
  expect(chart.dataDate).toBe('2026-08-31');
  for (const [interval, identity] of [['week', '2026-09-07'], ['month', '2026-09']] as const) {
    expect(legacy.unavailablePeriods.find(row => row.interval === interval && row.identity === identity)?.reason).toBe('partial_period');
    expect(chart.intervals[interval].some(row => row.identity === identity)).toBe(false);
    expect(chart.unavailablePeriods.filter(row => row.interval === interval && row.identity === identity))
      .toEqual([expect.objectContaining({ reason: 'source_gap' })]);
    const gap = chart.intervals[interval].find(row => row.sourceGaps.includes('2025-03-12'))!;
    expect(gap.completion).toBe('confirmed');
    for (const field of ['sma20', 'rsi', 'macd', 'signal', 'histogram', 'cross'] as const)
      expect(gap[field]).toEqual({ state: 'unavailable', reason: 'source_gap' });
  }
  expect(new Set(chart.unavailablePeriods.map(row => `${row.interval}:${row.identity}`)).size).toBe(chart.unavailablePeriods.length);
  expect(JSON.stringify(artifact)).toBe(before);
}, 30_000);

test('post-warmup projection excludes gaps without changing stored V1/V2 indicators', () => {
  const { input, fetched } = workspaceTechnicalHistory(['2025-03-12']);
  const legacy = buildTechnicalFromInputsV1(fetched, {}).artifact;
  const codec = createTechnicalArtifactCodecV1('7203', {});
  expect(codec.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  const { sourcePayloadDigest, artifactDigest, ...draft } = legacy;
  // Golden digests from the unchanged origin/main V1 builder/calculation/codec.
  expect(sourcePayloadDigest).toBe('sha256:0999793c27b792e4159aa7c269e8988e47924ced1c6a193cd5b29d7829fa1e1f');
  expect(artifactDigest).toBe('sha256:dc7cfcd4a49d964f4411bac3669e7a934ac01cccd2edcf0ce17c5017b878dc64');
  expect(codec.build(draft)).toEqual(legacy);
  expect(legacy.calculationVersion).toBe('technical_chart_calculation_v2');
  const workspaceCodec = new WorkspaceTechnicalCodec('7203');
  const artifact = workspaceCodec.build(legacy, input);
  expect(workspaceCodec.parse(artifact)).toEqual(artifact);
  expect(artifact.source).toEqual(legacy);
  const chart = projectWorkspaceChart(artifact);
  for (const interval of ['week', 'month'] as const) {
    const legacyRows = legacy.series[interval].filter(row => !row.partial);
    const legacyCloses = legacyRows.map(row => row.close);
    const legacyRsi = calculateRsiSeries(legacyCloses), legacyMacd = calculateMacdSeries(legacyCloses);
    const gapIndex = legacyRows.findIndex(row => row.periodStart <= '2025-03-12' && row.periodEnd >= '2025-03-12');
    expect(gapIndex).toBeGreaterThan(34);
    for (const index of [gapIndex, gapIndex + 1]) {
      expect(legacyRows[index]!.rsi).toEqual({ state: 'available', value: legacyRsi[index]! });
      expect(legacyRows[index]!.macd).toEqual({ state: 'available', value: legacyMacd[index]!.value });
    }
    const rows = chart.intervals[interval];
    const gap = rows.find(row => row.identity === legacyRows[gapIndex]!.identity)!;
    expect(gap).toMatchObject({ completion: 'confirmed', partial: false, sourceGaps: ['2025-03-12'] });
    for (const field of ['sma20', 'rsi', 'macd', 'signal', 'histogram', 'cross'] as const)
      expect(gap[field]).toEqual({ state: 'unavailable', reason: 'source_gap' });
    const complete = rows.filter(row => !row.partial && row.sourceGaps.length === 0);
    const closes = complete.map(row => row.close), rsi = calculateRsiSeries(closes), macd = calculateMacdSeries(closes);
    const nextIndex = complete.findIndex(row => row.identity === legacyRows[gapIndex + 1]!.identity);
    for (let index = nextIndex; index < complete.length; index++) {
      const current = macd[index]!, previous = macd[index - 1]!;
      expect(complete[index]).toMatchObject({
        sma20: { state: 'available', value: calculateSma(closes.slice(0, index + 1), 20) },
        rsi: { state: 'available', value: rsi[index] }, macd: { state: 'available', value: current.value },
        signal: { state: 'available', value: current.signal }, histogram: { state: 'available', value: current.histogram },
        cross: { state: 'available', value: previous.value <= previous.signal && current.value > current.signal ? 'golden_cross' : 'none' },
      });
    }
    expect(complete[nextIndex]!.macd).not.toEqual(legacyRows[gapIndex + 1]!.macd);
  }
}, 30_000);
