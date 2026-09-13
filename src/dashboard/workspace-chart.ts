import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { WorkspaceChart } from './workspace-contracts.js';
import { calculateRsiSeries, calculateMacdSeries } from '../tools/finance/advanced-technical-engine.js';
import { calculateSma } from '../tools/finance/technical-engine.js';
import { fail } from '../analysis/workspace/contracts.js';

/** Explicit public projection of an already verified exact artifact. No I/O. */
export function projectWorkspaceChart(artifact: TechnicalArtifactV2): WorkspaceChart {
  const gapDates = artifact.input.daily.filter(row => row.Date >= artifact.input.eligibilityFrom && row.Date >= artifact.input.queryFrom
    && row.O === null && row.H === null && row.L === null && row.C === null && row.Vo === null).map(row => row.Date);
  const gapsIn = (period: { periodStart: string; periodEnd: string }) =>
    gapDates.filter(date => date >= period.periodStart && date <= period.periodEnd);
  const rows = (interval: 'day' | 'week' | 'month'): WorkspaceChart['intervals']['day'] => {
    const candles = artifact.result.intervals[interval].map(row => ({ row, sourceGaps: gapsIn(row) }));
    // The verified V2 codec proves these eligible OHLCV rows from exact input.
    // Only this non-persisted projection owns the gap-free indicator sequence;
    // neither V1 nor V2 stored calculations, bytes or identities may change.
    const closes = candles.filter(({ row, sourceGaps }) => !row.partial && !sourceGaps.length).map(({ row }) => row.close);
    const rsi = calculateRsiSeries(closes), macd = calculateMacdSeries(closes);
    let index = -1;
    return candles.map(({ row, sourceGaps }) => {
      const complete = !row.partial && sourceGaps.length === 0;
      if (complete) index++;
      const unavailable = { state: 'unavailable' as const,
        reason: sourceGaps.length ? 'source_gap' as const : row.partial ? 'partial_period' as const : 'warmup' as const };
      const numeric = (value: number | null | undefined) => {
        if (value == null) return unavailable;
        if (!Number.isFinite(value)) fail('invalid_input');
        return { state: 'available' as const, value };
      };
      const current = complete ? macd[index] : null, previous = complete ? macd[index - 1] : null;
      return {
        interval: row.interval, identity: row.identity, periodStart: row.periodStart, periodEnd: row.periodEnd,
        displayDate: row.displayDate, firstSessionDate: row.firstSessionDate, lastSessionDate: row.lastSessionDate,
        partial: row.partial, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
        completion: row.completion, coverage: row.coverage, sourceGaps,
        rsi: numeric(complete ? rsi[index] : null), macd: numeric(current?.value),
        signal: numeric(current?.signal), histogram: numeric(current?.histogram),
        cross: current && previous ? { state: 'available' as const, value: previous.value <= previous.signal
          && current.value > current.signal ? 'golden_cross' as const : 'none' as const } : unavailable,
        sma20: numeric(complete ? calculateSma(closes.slice(Math.max(0, index - 19), index + 1), 20) : null),
      };
    });
  };
  // No candle exists for all-gap periods. Classify these from exact input too,
  // keeping legacy Artifact reasons untouched and source shortage above ongoing.
  const projectedUnavailable: WorkspaceChart['unavailablePeriods'] = artifact.result.unavailablePeriods.map(row => {
    const { interval, identity, periodStart, periodEnd } = row;
    return gapsIn(row).length ? { interval, identity, periodStart, periodEnd, reason: 'source_gap' } : { ...row };
  });
  for (const interval of ['week', 'month'] as const) for (const row of artifact.result.intervals[interval]) {
    if (gapsIn(row).length && !projectedUnavailable.some(item => item.interval === interval && item.identity === row.identity))
      projectedUnavailable.push({ interval, identity: row.identity, periodStart: row.periodStart, periodEnd: row.periodEnd, reason: 'source_gap' });
  }
  projectedUnavailable.sort((a, b) => ['day', 'week', 'month'].indexOf(a.interval) - ['day', 'week', 'month'].indexOf(b.interval)
    || a.identity.localeCompare(b.identity));
  const chart: WorkspaceChart = { schemaVersion: 'workspace_chart_v1', dataDate: artifact.dataDate, eligibilityFrom: artifact.input.eligibilityFrom,
    artifactDigest: artifact.artifactDigest, intervals: { day: rows('day'), week: rows('week'), month: rows('month') },
    unavailablePeriods: projectedUnavailable };
  return chart;
}
