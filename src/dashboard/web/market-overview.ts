import type { EtfRangeV1, EtfRelativeRangeV1 } from '../../analysis/market-data/etf-series.js';

export const MARKET_RANGES = ['3m', '6m', '1y', '3y', 'max'] as const;
export function marketRange(search: string): EtfRangeV1 {
  const value = new URLSearchParams(search).get('marketRange');
  return MARKET_RANGES.find(range => range === value) ?? '1y';
}
export function marketRangePath(search: string, range: EtfRangeV1): string {
  const parameters = new URLSearchParams(search);
  parameters.set('marketRange', range);
  return `/?${parameters}`;
}
export function elapsedCalendarDays(date: string, now = new Date()): number {
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}
export function etfNumber(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
}
export function etfDirection(result: Extract<EtfRelativeRangeV1, { state: 'available' }>): string {
  return `JPY建てETF市場価格・選択期間: ${result.direction === '1321_leads' ? '1321優勢' : result.direction === '2633_leads' ? '2633優勢' : '同水準'}`;
}
