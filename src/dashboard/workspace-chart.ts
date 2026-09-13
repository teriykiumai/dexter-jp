import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { WorkspaceChart } from './workspace-contracts.js';

/** Explicit public projection of an already verified exact artifact. No I/O. */
export function projectWorkspaceChart(artifact: TechnicalArtifactV2): WorkspaceChart {
  const gapDates = artifact.input.daily.filter(row => row.Date >= artifact.input.eligibilityFrom && row.Date >= artifact.input.queryFrom
    && row.O === null && row.H === null && row.L === null && row.C === null && row.Vo === null).map(row => row.Date);
  const gapsIn = (period: { periodStart: string; periodEnd: string }) =>
    gapDates.filter(date => date >= period.periodStart && date <= period.periodEnd);
  const rows = (interval: 'day' | 'week' | 'month') => artifact.result.intervals[interval].map(row => ({
    sourceGaps: gapsIn(row),
    interval: row.interval, identity: row.identity, periodStart: row.periodStart, periodEnd: row.periodEnd,
    displayDate: row.displayDate, firstSessionDate: row.firstSessionDate, lastSessionDate: row.lastSessionDate,
    partial: row.partial, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
    rsi: row.rsi, macd: row.macd, signal: row.signal, histogram: row.histogram, cross: row.cross, sma20: row.sma20,
    completion: row.completion, coverage: row.coverage,
  }));
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
