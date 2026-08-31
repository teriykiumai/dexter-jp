import {
  decimalRationalV1,
  multiplyDecimalRationalV1,
  roundProductToOneDecimalV1,
  type DecimalRationalV1,
} from './decimal.js';
import type { TseSessionDate } from './date.js';
import type { TseDailyBarV1 } from './daily-bar.js';
import { PointInTimeErrorV1 } from './errors.js';

export const JQUANTS_T0_ADJUSTMENT_VERSION = 'jquants_t0_adjustment_v1' as const;

export type T0AdjustedPriceBarV1 = Readonly<{
  date: TseSessionDate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: null;
}>;

export function adjustDailyBarsToT0V1(
  inputBars: readonly TseDailyBarV1[],
  t0: TseSessionDate,
): readonly T0AdjustedPriceBarV1[] {
  const bars = inputBars.filter(bar => bar.date <= t0);
  for (let index = 1; index < bars.length; index += 1) {
    if ((bars[index - 1]?.date ?? '') >= (bars[index]?.date ?? '')) {
      throw new PointInTimeErrorV1('source_response_invalid', 't0 daily bars must be strictly increasing and unique.');
    }
  }
  if (bars.length === 0 || bars.at(-1)?.date !== t0) {
    throw new PointInTimeErrorV1('price_history_incomplete', 'The t0 daily bar is missing.', t0);
  }

  let cumulative: DecimalRationalV1 = decimalRationalV1(1);
  const adjusted = new Array<T0AdjustedPriceBarV1>(bars.length);
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    if (bar === undefined) continue;
    if (bar.open === null || bar.high === null || bar.low === null || bar.close === null) {
      throw new PointInTimeErrorV1('price_history_incomplete', 'A required t0 technical row has no OHLC.', bar.date);
    }
    adjusted[index] = Object.freeze({
      date: bar.date,
      open: roundProductToOneDecimalV1(bar.open, cumulative),
      high: roundProductToOneDecimalV1(bar.high, cumulative),
      low: roundProductToOneDecimalV1(bar.low, cumulative),
      close: roundProductToOneDecimalV1(bar.close, cumulative),
      volume: null,
    });
    cumulative = multiplyDecimalRationalV1(cumulative, decimalRationalV1(bar.adjustmentFactor));
  }
  return Object.freeze(adjusted);
}
