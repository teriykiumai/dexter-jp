export const STRATEGY_DEFAULTS = {
  atrMultiplier: 1.5,
  rewardRiskMultiple: 2,
} as const;

export interface StrategyTechnicalInput {
  dataDate: string | null;
  latestSwingHigh: number | null;
  latestSwingLow: number | null;
  atr14: number | null;
}

export interface StrategyOptions {
  tickSize?: number | null;
  resistanceLevels?: readonly (number | null)[];
}

export type StrategyEntryReason = 'breakout_above_swing_high';
export type StrategyStopReason = 'latest_swing_low' | 'entry_minus_1_5_atr';
export type StrategyTargetReason = 'risk_reward_2R' | 'resistance_level';

export interface StrategyEntry {
  price: number;
  reason: StrategyEntryReason;
  trigger: 'strictly_above';
  tickSizeApplied: number | null;
}

export interface StrategyPriceLevel<Reason extends string> {
  price: number;
  reason: Reason;
}

export interface StrategyCandidate {
  entry: StrategyEntry;
  stop: StrategyPriceLevel<StrategyStopReason>;
  target: StrategyPriceLevel<StrategyTargetReason>;
  risk: number;
  reward: number;
  rewardRisk: number;
}

export type StrategyCandidateType =
  | 'entry'
  | 'swing_stop'
  | 'atr_stop'
  | 'resistance_target';

export type StrategyUnavailableReason =
  | 'missing_or_invalid_swing_high'
  | 'missing_entry'
  | 'missing_or_invalid_swing_low'
  | 'missing_or_invalid_atr'
  | 'non_positive_stop'
  | 'stop_not_below_entry'
  | 'zero_risk'
  | 'missing_or_invalid_resistance'
  | 'target_not_above_entry';

export interface UnavailableStrategyCandidate {
  candidate: StrategyCandidateType;
  reason: StrategyUnavailableReason;
  price?: number;
}

export interface StrategyResult {
  dataDate: string | null;
  entry: StrategyEntry | null;
  candidates: StrategyCandidate[];
  unavailable: UnavailableStrategyCandidate[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositivePrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function normalizeFloatingPoint(value: number): number {
  return Number(value.toPrecision(15));
}

/** Return the first valid tick strictly above a supplied breakout level. */
export function nextTickAbove(price: number, tickSize: number): number {
  if (!isPositivePrice(price)) throw new RangeError('price must be positive and finite.');
  if (!isPositivePrice(tickSize)) {
    throw new RangeError('tickSize must be positive and finite.');
  }

  const quotient = price / tickSize;
  const nearestInteger = Math.round(quotient);
  const baseTick = Math.abs(quotient - nearestInteger) <= 1e-10
    ? nearestInteger
    : Math.floor(quotient);
  return normalizeFloatingPoint((baseTick + 1) * tickSize);
}

function validateStop(
  entryPrice: number,
  stopPrice: number,
  candidate: 'swing_stop' | 'atr_stop',
): UnavailableStrategyCandidate | null {
  if (!isPositivePrice(stopPrice)) {
    return { candidate, reason: 'non_positive_stop', price: stopPrice };
  }
  if (stopPrice === entryPrice) {
    return { candidate, reason: 'zero_risk', price: stopPrice };
  }
  if (stopPrice > entryPrice) {
    return { candidate, reason: 'stop_not_below_entry', price: stopPrice };
  }
  return null;
}

function buildCandidate(
  entry: StrategyEntry,
  stop: StrategyPriceLevel<StrategyStopReason>,
  target: StrategyPriceLevel<StrategyTargetReason>,
): StrategyCandidate {
  const risk = entry.price - stop.price;
  const reward = target.price - entry.price;
  return {
    entry,
    stop,
    target,
    risk,
    reward,
    rewardRisk: reward / risk,
  };
}

function buildTwoRCandidate(
  entry: StrategyEntry,
  stop: StrategyPriceLevel<StrategyStopReason>,
): StrategyCandidate {
  const risk = entry.price - stop.price;
  return buildCandidate(entry, stop, {
    price: normalizeFloatingPoint(
      entry.price + STRATEGY_DEFAULTS.rewardRiskMultiple * risk,
    ),
    reason: 'risk_reward_2R',
  });
}

/** Generate deterministic long Entry / Stop / Target candidates from technical results. */
export function analyzeStrategy(
  technical: StrategyTechnicalInput,
  options: StrategyOptions = {},
): StrategyResult {
  const unavailable: UnavailableStrategyCandidate[] = [];
  const swingHigh = technical.latestSwingHigh;
  if (!isPositivePrice(swingHigh)) {
    unavailable.push({ candidate: 'entry', reason: 'missing_or_invalid_swing_high' });
    unavailable.push({ candidate: 'swing_stop', reason: 'missing_entry' });
    unavailable.push({ candidate: 'atr_stop', reason: 'missing_entry' });
    return {
      dataDate: technical.dataDate,
      entry: null,
      candidates: [],
      unavailable,
    };
  }

  const tickSize = options.tickSize ?? null;
  if (tickSize !== null && !isPositivePrice(tickSize)) {
    throw new RangeError('tickSize must be positive and finite.');
  }
  const entry: StrategyEntry = {
    price: tickSize === null ? swingHigh : nextTickAbove(swingHigh, tickSize),
    reason: 'breakout_above_swing_high',
    trigger: 'strictly_above',
    tickSizeApplied: tickSize,
  };

  const validStops: StrategyPriceLevel<StrategyStopReason>[] = [];
  const swingLow = technical.latestSwingLow;
  if (!isPositivePrice(swingLow)) {
    unavailable.push({ candidate: 'swing_stop', reason: 'missing_or_invalid_swing_low' });
  } else {
    const invalidSwingStop = validateStop(entry.price, swingLow, 'swing_stop');
    if (invalidSwingStop === null) {
      validStops.push({ price: swingLow, reason: 'latest_swing_low' });
    } else {
      unavailable.push(invalidSwingStop);
    }
  }

  const atr = technical.atr14;
  if (!isPositivePrice(atr)) {
    unavailable.push({ candidate: 'atr_stop', reason: 'missing_or_invalid_atr' });
  } else {
    const atrStopPrice = normalizeFloatingPoint(
      entry.price - STRATEGY_DEFAULTS.atrMultiplier * atr,
    );
    const invalidAtrStop = validateStop(entry.price, atrStopPrice, 'atr_stop');
    if (invalidAtrStop === null) {
      validStops.push({ price: atrStopPrice, reason: 'entry_minus_1_5_atr' });
    } else {
      unavailable.push(invalidAtrStop);
    }
  }

  const resistanceLevels: number[] = [];
  const seenResistance = new Set<number>();
  for (const resistance of options.resistanceLevels ?? []) {
    if (!isPositivePrice(resistance)) {
      unavailable.push({
        candidate: 'resistance_target',
        reason: 'missing_or_invalid_resistance',
      });
      continue;
    }
    if (resistance <= entry.price) {
      unavailable.push({
        candidate: 'resistance_target',
        reason: 'target_not_above_entry',
        price: resistance,
      });
      continue;
    }
    if (!seenResistance.has(resistance)) {
      seenResistance.add(resistance);
      resistanceLevels.push(resistance);
    }
  }
  resistanceLevels.sort((left, right) => left - right);

  const candidates: StrategyCandidate[] = [];
  for (const stop of validStops) {
    candidates.push(buildTwoRCandidate(entry, stop));
    for (const resistance of resistanceLevels) {
      candidates.push(buildCandidate(entry, stop, {
        price: resistance,
        reason: 'resistance_level',
      }));
    }
  }

  return {
    dataDate: technical.dataDate,
    entry,
    candidates,
    unavailable,
  };
}
