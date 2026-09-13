import { expect, test } from 'bun:test';
import { buildTechnicalFromInputsV1 } from '../analysis/market-data/technical-source.js';
import { workspaceTechnicalHistory } from '../analysis/workspace/technical-test-fixtures.js';
import { WorkspaceTechnicalCodec } from '../analysis/workspace/technical-artifact.js';
import { projectWorkspaceChart } from './workspace-chart.js';
import { WorkspaceChartSchema } from './workspace-contracts.js';

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
