import type { AnalysisSnapshot } from '../../analysis/snapshot/schema.js';
import type { TechnicalChartDatasetV1 } from '../../analysis/market-data/technical-artifact.js';
import type { MarketDataJobServiceV1 } from '../../analysis/market-data/job-service.js';
import { mapSnapshotToDashboard } from './presentation.js';

export type TechnicalLatest = Awaited<ReturnType<MarketDataJobServiceV1['readTechnical']>>;
export type TechnicalSource = 'auto' | 'snapshot' | 'latest';
export type TechnicalInterval = 'day' | 'week' | 'month';
type TechnicalIndicator = { state: 'available'; value: number | string } | { state: 'unavailable'; reason: string };
export type TechnicalCandle = Omit<TechnicalChartDatasetV1['series']['day'][number],
  'rsi' | 'macd' | 'signal' | 'histogram' | 'cross' | 'sma20'> & {
  rsi: TechnicalIndicator; macd: TechnicalIndicator; signal: TechnicalIndicator;
  histogram: TechnicalIndicator; cross: TechnicalIndicator; sma20?: TechnicalIndicator;
};
export function technicalSelection(search: string) {
  const params = new URLSearchParams(search);
  return { source: (params.get('chartSource') ?? 'auto') as TechnicalSource,
    interval: (params.get('interval') ?? 'day') as TechnicalInterval };
}
export function technicalPath(search: string, key: 'chartSource' | 'interval', value: string) {
  const params = new URLSearchParams(search);
  if (value === 'auto' || value === 'day') params.delete(key); else params.set(key, value);
  return `/?${params.toString()}`;
}
export function snapshotChartDate(snapshot: AnalysisSnapshot): string | null {
  const bars = mapSnapshotToDashboard(snapshot).chart.bars;
  const date = snapshot.dataDates.priceHistory;
  return date && bars.at(-1)?.date === date ? date : null;
}
export function selectedTechnicalSource(source: TechnicalSource, snapshotDate: string | null,
  latest: TechnicalLatest | null, comparison: boolean): 'snapshot' | 'latest' | null {
  if (comparison || source === 'snapshot') return snapshotDate ? 'snapshot' : null;
  if (source === 'latest') return latest ? 'latest' : null;
  if (latest && (!snapshotDate || latest.artifact.dataDate >= snapshotDate)) return 'latest';
  return snapshotDate ? 'snapshot' : null;
}
export const technicalValue = (value: TechnicalCandle['rsi'] | TechnicalCandle['cross']) =>
  value.state === 'available' ? String(value.value) : `利用不可 (${value.reason})`;
