import {
  parseTseSessionDate,
  selectRowsAtOrBeforeV1,
  type TseSessionDate,
} from './date.js';
import { PointInTimeErrorV1 } from './errors.js';

export type TseLimitFlagV1 = '0' | '1';
export type TseExRightsTypeV1 = '1' | '2' | '3';

export type DailyBarInputV1 = Readonly<{
  date: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  upperLimitFlag: unknown;
  lowerLimitFlag: unknown;
  adjustmentFactor: unknown;
  exRightsType: unknown;
}>;

export type TseDailyBarV1 = Readonly<{
  date: TseSessionDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  upperLimitFlag: TseLimitFlagV1 | null;
  lowerLimitFlag: TseLimitFlagV1 | null;
  adjustmentFactor: number;
  exRightsType: TseExRightsTypeV1 | null;
}>;

function decodeInput(value: unknown): DailyBarInputV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar rows must be objects.', value);
  }
  const row = value as Record<string, unknown>;
  return {
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    upperLimitFlag: row.upperLimitFlag,
    lowerLimitFlag: row.lowerLimitFlag,
    adjustmentFactor: row.adjustmentFactor,
    exRightsType: row.exRightsType,
  };
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseLimitFlag(value: unknown, noTrade: boolean): TseLimitFlagV1 | null {
  if (noTrade && value === null) return null;
  if (value === '0') return value;
  if (!noTrade && value === '1') return value;
  throw new PointInTimeErrorV1('source_response_invalid', 'A daily-bar limit flag is invalid.', value);
}

export function parseDailyBarV1(value: unknown): TseDailyBarV1 {
  const row = decodeInput(value);
  const date = parseTseSessionDate(row.date);
  const prices = [row.open, row.high, row.low, row.close];
  const allNull = prices.every(price => price === null);
  const allPositive = prices.every(positiveFinite);
  if (!allNull && !allPositive) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar OHLC must be all positive finite numbers or all null.', date);
  }

  if (!positiveFinite(row.adjustmentFactor)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar adjustmentFactor must be finite and positive.', row.adjustmentFactor);
  }
  if (row.exRightsType !== null && row.exRightsType !== '1'
    && row.exRightsType !== '2' && row.exRightsType !== '3') {
    throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar exRightsType is invalid.', row.exRightsType);
  }

  const open = row.open as number | null;
  const high = row.high as number | null;
  const low = row.low as number | null;
  const close = row.close as number | null;
  if (!allNull && high !== null && low !== null && open !== null && close !== null
    && (high < Math.max(open, close) || low > Math.min(open, close) || high < low)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar OHLC geometry is impossible.', date);
  }

  return Object.freeze({
    date,
    open,
    high,
    low,
    close,
    upperLimitFlag: parseLimitFlag(row.upperLimitFlag, allNull),
    lowerLimitFlag: parseLimitFlag(row.lowerLimitFlag, allNull),
    adjustmentFactor: row.adjustmentFactor,
    exRightsType: row.exRightsType,
  });
}

export function parseEligibleDailyBarsV1(
  inputRows: readonly unknown[],
  eligibleThroughValue: unknown,
): readonly TseDailyBarV1[] {
  const eligibleThrough = parseTseSessionDate(eligibleThroughValue);
  const decoded = inputRows.map(decodeInput);
  const selected = selectRowsAtOrBeforeV1(decoded, eligibleThrough, row => row.date);
  const parsed = selected.map(parseDailyBarV1).sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0);
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1]?.date === parsed[index]?.date) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar dates must be unique.', parsed[index]?.date);
    }
  }
  return Object.freeze(parsed);
}

export function requireDailyBarsForSessionsV1(
  bars: readonly TseDailyBarV1[],
  requiredSessions: readonly TseSessionDate[],
): readonly TseDailyBarV1[] {
  const byDate = new Map<string, TseDailyBarV1>();
  for (const bar of bars) {
    if (byDate.has(bar.date)) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Daily-bar dates must be unique.', bar.date);
    }
    byDate.set(bar.date, bar);
  }
  const required = new Set(requiredSessions);
  if (bars.some(bar => !required.has(bar.date))) {
    throw new PointInTimeErrorV1('source_response_invalid', 'A daily bar is outside the required session window.');
  }
  return Object.freeze(requiredSessions.map(date => {
    const bar = byDate.get(date);
    if (bar === undefined) {
      throw new PointInTimeErrorV1('price_history_incomplete', 'An official-session daily bar is missing.', date);
    }
    return bar;
  }));
}

export function hasCorporateActionV1(bar: TseDailyBarV1): boolean {
  return bar.exRightsType !== null || bar.adjustmentFactor !== 1;
}
