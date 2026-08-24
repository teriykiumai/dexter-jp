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

  let totalGain = 0;
  let totalLoss = 0;
  for (let index = 1; index <= RSI_PERIOD; index += 1) {
    const change = chronologicalAdjustedCloses[index] - chronologicalAdjustedCloses[index - 1];
    totalGain += Math.max(change, 0);
    totalLoss += Math.max(-change, 0);
  }

  let averageGain = totalGain / RSI_PERIOD;
  let averageLoss = totalLoss / RSI_PERIOD;

  for (let index = RSI_PERIOD + 1; index < chronologicalAdjustedCloses.length; index += 1) {
    const change = chronologicalAdjustedCloses[index] - chronologicalAdjustedCloses[index - 1];
    const currentGain = Math.max(change, 0);
    const currentLoss = Math.max(-change, 0);
    averageGain = (averageGain * (RSI_PERIOD - 1) + currentGain) / RSI_PERIOD;
    averageLoss = (averageLoss * (RSI_PERIOD - 1) + currentLoss) / RSI_PERIOD;
  }

  return {
    rsi14: calculateRsiValue(averageGain, averageLoss),
    unavailable: [],
  };
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

  for (let index = period; index < values.length; index += 1) {
    const previousEma = series[series.length - 1];
    series.push(values[index] * multiplier + previousEma * (1 - multiplier));
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

  const fastEmaSeries = calculateSmaSeededEmaSeries(
    chronologicalAdjustedCloses,
    MACD_PERIODS.fast,
  );
  const slowEmaSeries = calculateSmaSeededEmaSeries(
    chronologicalAdjustedCloses,
    MACD_PERIODS.slow,
  );
  const fastEmaOffset = MACD_PERIODS.slow - MACD_PERIODS.fast;
  const macdSeries = slowEmaSeries.map((slowEma, index) => (
    fastEmaSeries[index + fastEmaOffset] - slowEma
  ));
  const signalSeries = calculateSmaSeededEmaSeries(macdSeries, MACD_PERIODS.signal);
  const value = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];

  return {
    macd: {
      value,
      signal,
      histogram: value - signal,
    },
    unavailable: [],
  };
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
