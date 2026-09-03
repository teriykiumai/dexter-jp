import type { TechnicalBar } from './technical-engine.js';

export const RSI_PERIOD = 14 as const;

export type RsiUnavailableReason =
  | 'insufficient_history'
  | 'missing_data'
  | 'invalid_data';

export interface UnavailableRsiMetric {
  metric: 'rsi14';
  reason: RsiUnavailableReason;
}

export interface RsiResult {
  rsi14: number | null;
  unavailable: UnavailableRsiMetric[];
}

function unavailableRsi(reason: RsiUnavailableReason): RsiResult {
  return {
    rsi14: null,
    unavailable: [{ metric: 'rsi14', reason }],
  };
}

function isPositiveFiniteClose(close: number | null): close is number {
  return typeof close === 'number' && Number.isFinite(close) && close > 0;
}

function assertSeriesCloses(closes: readonly number[]): void {
  for (const close of closes) {
    if (!isPositiveFiniteClose(close)) throw new RangeError('Invalid adjusted closes.');
  }
}

function calculateRsiValue(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;

  const relativeStrength = averageGain / averageLoss;
  const rsi = 100 - 100 / (1 + relativeStrength);
  return Math.min(100, Math.max(0, rsi));
}

/** Calculate RSI 14 from the supplied chronological adjusted-close sequence. */
export function calculateRsi(
  chronologicalAdjustedCloses: readonly (number | null)[],
): RsiResult {
  if (chronologicalAdjustedCloses.length < RSI_PERIOD + 1) {
    return unavailableRsi('insufficient_history');
  }
  if (chronologicalAdjustedCloses.some((close) => close === null)) {
    return unavailableRsi('missing_data');
  }
  if (!chronologicalAdjustedCloses.every(isPositiveFiniteClose)) {
    return unavailableRsi('invalid_data');
  }

  try {
    return { rsi14: calculateRsiSeries(chronologicalAdjustedCloses).at(-1)!, unavailable: [] };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return unavailableRsi('invalid_data');
  }
}

/** Aligned RSI values; null is warm-up only. Callers must not skip invalid closes. */
export function calculateRsiSeries(closes: readonly number[]): (number | null)[] {
  assertSeriesCloses(closes);
  const series: (number | null)[] = Array(closes.length).fill(null);
  if (closes.length < RSI_PERIOD + 1) return series;

  let totalGain = 0;
  let totalLoss = 0;
  for (let index = 1; index <= RSI_PERIOD; index += 1) {
    const change = closes[index] - closes[index - 1];
    totalGain += Math.max(change, 0);
    totalLoss += Math.max(-change, 0);
  }

  let averageGain = totalGain / RSI_PERIOD;
  let averageLoss = totalLoss / RSI_PERIOD;
  const value = () => {
    if (!Number.isFinite(averageGain) || !Number.isFinite(averageLoss)) {
      throw new RangeError('RSI arithmetic overflow.');
    }
    return calculateRsiValue(averageGain, averageLoss);
  };
  series[RSI_PERIOD] = value();

  for (let index = RSI_PERIOD + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const currentGain = Math.max(change, 0);
    const currentLoss = Math.max(-change, 0);
    averageGain = (averageGain * (RSI_PERIOD - 1) + currentGain) / RSI_PERIOD;
    averageLoss = (averageLoss * (RSI_PERIOD - 1) + currentLoss) / RSI_PERIOD;
    series[index] = value();
  }

  return series;
}

export const MACD_PERIODS = {
  fast: 12,
  slow: 26,
  signal: 9,
} as const;

export type MacdUnavailableReason =
  | 'insufficient_history'
  | 'missing_data'
  | 'invalid_data';

export interface UnavailableMacdMetric {
  metric: 'macd';
  reason: MacdUnavailableReason;
}

export interface MacdValues {
  value: number;
  signal: number;
  histogram: number;
}

export interface MacdResult {
  macd: MacdValues | null;
  unavailable: UnavailableMacdMetric[];
}

function unavailableMacd(reason: MacdUnavailableReason): MacdResult {
  return {
    macd: null,
    unavailable: [{ metric: 'macd', reason }],
  };
}

function calculateSmaSeededEmaSeries(
  values: readonly number[],
  period: number,
): number[] {
  const multiplier = 2 / (period + 1);
  const seed = values
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;
  const series = [seed];
  if (!Number.isFinite(seed)) throw new RangeError('EMA arithmetic overflow.');

  for (let index = period; index < values.length; index += 1) {
    const previousEma = series[series.length - 1];
    series.push(values[index] * multiplier + previousEma * (1 - multiplier));
    if (!Number.isFinite(series.at(-1))) throw new RangeError('EMA arithmetic overflow.');
  }

  return series;
}

/** Calculate MACD 12/26/9 from the supplied chronological adjusted-close sequence. */
export function calculateMacd(
  chronologicalAdjustedCloses: readonly (number | null)[],
): MacdResult {
  const minimumHistory = MACD_PERIODS.slow + MACD_PERIODS.signal - 1;
  if (chronologicalAdjustedCloses.length < minimumHistory) {
    return unavailableMacd('insufficient_history');
  }
  if (chronologicalAdjustedCloses.some((close) => close === null)) {
    return unavailableMacd('missing_data');
  }
  if (!chronologicalAdjustedCloses.every(isPositiveFiniteClose)) {
    return unavailableMacd('invalid_data');
  }

  try {
    return { macd: calculateMacdSeries(chronologicalAdjustedCloses).at(-1)!, unavailable: [] };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return unavailableMacd('invalid_data');
  }
}

/** Aligned MACD bundles, including signal/histogram; all three share warm-up. */
export function calculateMacdSeries(closes: readonly number[]): (MacdValues | null)[] {
  assertSeriesCloses(closes);
  const series: (MacdValues | null)[] = Array(closes.length).fill(null);
  const firstIndex = MACD_PERIODS.slow + MACD_PERIODS.signal - 2;
  if (closes.length <= firstIndex) return series;
  const fastEmaSeries = calculateSmaSeededEmaSeries(
    closes,
    MACD_PERIODS.fast,
  );
  const slowEmaSeries = calculateSmaSeededEmaSeries(
    closes,
    MACD_PERIODS.slow,
  );
  const fastEmaOffset = MACD_PERIODS.slow - MACD_PERIODS.fast;
  const macdSeries = slowEmaSeries.map((slowEma, index) => (
    fastEmaSeries[index + fastEmaOffset] - slowEma
  ));
  const signalSeries = calculateSmaSeededEmaSeries(macdSeries, MACD_PERIODS.signal);
  for (let index = firstIndex; index < closes.length; index += 1) {
    const value = macdSeries[index - (MACD_PERIODS.slow - 1)];
    const signal = signalSeries[index - firstIndex];
    const histogram = value - signal;
    if (![value, signal, histogram].every(Number.isFinite)) {
      throw new RangeError('MACD arithmetic overflow.');
    }
    series[index] = { value, signal, histogram };
  }
  return series;
}

export const BOLLINGER_PERIOD = 20 as const;
export const BOLLINGER_STANDARD_DEVIATIONS = 2 as const;

export type BollingerUnavailableReason =
  | 'insufficient_history'
  | 'missing_data'
  | 'invalid_data';

export interface UnavailableBollingerMetric {
  metric: 'bollinger20';
  reason: BollingerUnavailableReason;
}

export interface BollingerValues {
  middle: number;
  upper: number;
  lower: number;
}

export interface BollingerResult {
  bollinger20: BollingerValues | null;
  unavailable: UnavailableBollingerMetric[];
}

function unavailableBollinger(reason: BollingerUnavailableReason): BollingerResult {
  return {
    bollinger20: null,
    unavailable: [{ metric: 'bollinger20', reason }],
  };
}

/** Calculate Bollinger Bands 20/2σ from the latest supplied adjusted closes. */
export function calculateBollingerBands(
  chronologicalAdjustedCloses: readonly (number | null)[],
): BollingerResult {
  if (chronologicalAdjustedCloses.length < BOLLINGER_PERIOD) {
    return unavailableBollinger('insufficient_history');
  }

  const latestCloses = chronologicalAdjustedCloses.slice(-BOLLINGER_PERIOD);
  if (latestCloses.some((close) => close === null)) {
    return unavailableBollinger('missing_data');
  }
  if (!latestCloses.every(isPositiveFiniteClose)) {
    return unavailableBollinger('invalid_data');
  }

  const middle = latestCloses.reduce((sum, close) => sum + close, 0) / BOLLINGER_PERIOD;
  const variance = latestCloses.reduce(
    (sum, close) => sum + (close - middle) ** 2,
    0,
  ) / BOLLINGER_PERIOD;
  const standardDeviation = Math.sqrt(variance);
  const bandOffset = BOLLINGER_STANDARD_DEVIATIONS * standardDeviation;

  return {
    bollinger20: {
      middle,
      upper: middle + bandOffset,
      lower: middle - bandOffset,
    },
    unavailable: [],
  };
}

export const ADVANCED_TECHNICAL_CANONICAL_BARS = 251 as const;

export type AdvancedTechnicalUnavailableReason =
  | RsiUnavailableReason
  | MacdUnavailableReason
  | BollingerUnavailableReason;

export interface UnavailableAdvancedTechnicalMetric {
  metric: 'rsi14' | 'macd' | 'bollinger20';
  reason: AdvancedTechnicalUnavailableReason;
}

export interface AdvancedTechnicalResult {
  dataDate: string | null;
  rsi14: number | null;
  macd: MacdValues | null;
  bollinger20: BollingerValues | null;
  unavailable: UnavailableAdvancedTechnicalMetric[];
}

function assertStrictChronologicalOrder(bars: readonly TechnicalBar[]): void {
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].date <= bars[index - 1].date) {
      throw new Error('Advanced technical bars must be in strictly ascending date order.');
    }
  }
}

/** Aggregate advanced indicators from the canonical latest-251-bar sequence. */
export function analyzeAdvancedTechnical(
  chronologicalAdjustedBars: readonly TechnicalBar[],
): AdvancedTechnicalResult {
  const canonicalBars = chronologicalAdjustedBars.slice(
    -ADVANCED_TECHNICAL_CANONICAL_BARS,
  );
  assertStrictChronologicalOrder(chronologicalAdjustedBars);

  const closes = canonicalBars.map((bar) => bar.close);
  const rsiResult = calculateRsi(closes);
  const macdResult = calculateMacd(closes);
  const bollingerResult = calculateBollingerBands(closes);

  return {
    dataDate: canonicalBars.at(-1)?.date ?? null,
    rsi14: rsiResult.rsi14,
    macd: macdResult.macd,
    bollinger20: bollingerResult.bollinger20,
    unavailable: [
      ...rsiResult.unavailable,
      ...macdResult.unavailable,
      ...bollingerResult.unavailable,
    ],
  };
}
