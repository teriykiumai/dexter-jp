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
