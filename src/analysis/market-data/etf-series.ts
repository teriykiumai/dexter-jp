import { isStrictGregorianDate } from '../strategy-validation/date.js';
import type { TechnicalDailyObservationV1 } from './technical-series.js';

export const ETF_RANGES_V1 = ['3m', '6m', '1y', '3y', 'max'] as const;
export type EtfRangeV1 = typeof ETF_RANGES_V1[number];
type Value = { state: 'available'; value: number } | { state: 'unavailable'; reason: 'source_no_observation' | 'insufficient_history' | 'zero_denominator' };
const available = (value: number): Value => {
  if (!Number.isFinite(value)) throw new TypeError('Invalid ETF calculation.');
  return { state: 'available', value };
};
const unavailable = (reason: Extract<Value, { state: 'unavailable' }>['reason']): Value => ({ state: 'unavailable', reason });
export type EtfRelativeRangeV1 = {
  range: EtfRangeV1; state: 'available'; rangeStart: string; rangeEnd: string;
  commonDates: string[]; normalized1321: number[]; normalized2633: number[];
  return1321Percent: number; return2633Percent: number; differencePercentagePoints: number;
  direction: '1321_leads' | '2633_leads' | 'same';
} | { range: EtfRangeV1; state: 'unavailable'; reason: 'source_no_observation' | 'insufficient_common_dates' | 'invalid_base';
  rangeStart: string | null; rangeEnd: string | null; commonDateCount: number };

function closes(input: readonly TechnicalDailyObservationV1[]) {
  let previous = '';
  for (const row of input) {
    if (!isStrictGregorianDate(row.date) || row.date <= previous
      || (row.kind === 'bar' && (!Number.isFinite(row.close) || row.close < 0))) throw new TypeError('Invalid ETF series.');
    previous = row.date;
  }
  return input.filter(row => row.kind === 'bar').map(row => ({ date: row.date, close: row.close }));
}

export function calculateEtf1321EodV1(input: readonly TechnicalDailyObservationV1[], eligibleThrough: string) {
  if (!isStrictGregorianDate(eligibleThrough) || input.some(row => row.date > eligibleThrough)) throw new TypeError('Invalid ETF date.');
  const rows = closes(input), last = rows.at(-1), previous = rows.at(-2);
  const missing = unavailable('source_no_observation');
  if (!last) return { identity: eligibleThrough, dataDate: eligibleThrough,
    observationState: { state: 'unavailable' as const, reason: 'source_no_observation' as const },
    adjustedCloseYen: missing, previousCommonDate: null, previousAdjustedCloseYen: missing,
    changeYen: missing, changeRatePercent: missing };
  const changeMissing = unavailable(previous ? 'zero_denominator' : 'insufficient_history');
  return { identity: last.date, dataDate: last.date, observationState: { state: 'available' as const, reason: null },
    adjustedCloseYen: available(last.close), previousCommonDate: previous?.date ?? null,
    previousAdjustedCloseYen: previous ? available(previous.close) : unavailable('insufficient_history'),
    changeYen: previous && previous.close > 0 ? available(last.close - previous.close) : changeMissing,
    changeRatePercent: previous && previous.close > 0 ? available((last.close - previous.close) / previous.close * 100) : changeMissing };
}

export function etfRangeStartV1(end: string, range: EtfRangeV1): string | null {
  if (!isStrictGregorianDate(end) || !ETF_RANGES_V1.includes(range)) throw new TypeError('Invalid ETF range.');
  if (range === 'max') return null;
  const [year, month, day] = end.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1 - ({ '3m': 3, '6m': 6, '1y': 12, '3y': 36 }[range]), 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
}

export function calculateEtfRelativeV1(input1321: readonly TechnicalDailyObservationV1[],
  input2633: readonly TechnicalDailyObservationV1[]): EtfRelativeRangeV1[] {
  const left = closes(input1321), right = closes(input2633);
  const byDate = new Map(right.map(row => [row.date, row.close]));
  const common = left.filter(row => byDate.has(row.date));
  const end = common.at(-1)?.date;
  return ETF_RANGES_V1.map(range => {
    const lower = end ? etfRangeStartV1(end, range) : null;
    const selected = common.filter(row => lower === null || row.date >= lower);
    const start = selected[0]?.date ?? null, rangeEnd = selected.at(-1)?.date ?? null;
    if (!left.length || !right.length || selected.length < 2) return { range, state: 'unavailable',
      reason: !left.length || !right.length ? 'source_no_observation' : 'insufficient_common_dates',
      rangeStart: start, rangeEnd, commonDateCount: selected.length };
    const baseLeft = selected[0]!.close, baseRight = byDate.get(selected[0]!.date)!;
    if (baseLeft <= 0 || baseRight <= 0) return { range, state: 'unavailable', reason: 'invalid_base',
      rangeStart: start, rangeEnd, commonDateCount: selected.length };
    const normalized1321 = selected.map(row => row.close / baseLeft * 100);
    const normalized2633 = selected.map(row => byDate.get(row.date)! / baseRight * 100);
    const return1321Percent = (normalized1321.at(-1)! / 100 - 1) * 100;
    const return2633Percent = (normalized2633.at(-1)! / 100 - 1) * 100;
    const differencePercentagePoints = return1321Percent - return2633Percent;
    if (![...normalized1321, ...normalized2633, return1321Percent, return2633Percent, differencePercentagePoints].every(Number.isFinite)) {
      throw new TypeError('Invalid ETF calculation.');
    }
    return { range, state: 'available', rangeStart: start!, rangeEnd: rangeEnd!,
      commonDates: selected.map(row => row.date), normalized1321, normalized2633,
      return1321Percent, return2633Percent, differencePercentagePoints,
      direction: differencePercentagePoints > 0 ? '1321_leads' : differencePercentagePoints < 0 ? '2633_leads' : 'same' };
  });
}
