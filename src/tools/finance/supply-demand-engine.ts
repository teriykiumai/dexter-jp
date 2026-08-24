export const SUPPLY_DEMAND_DEFAULTS = {
  mean4wPeriod: 4,
  mean13wPeriod: 13,
  mean52wPeriod: 52,
  averageVolumePeriod: 20,
} as const;

export interface MarginHistoryPoint {
  date: string;
  longBalance: number | null;
  shortBalance: number | null;
}

export interface VolumeHistoryPoint {
  date: string;
  volume: number | null;
}

export type SupplyDemandMetric =
  | 'buyingBalance'
  | 'sellingBalance'
  | 'marginRatio'
  | 'buyingBalanceWeeklyChange'
  | 'sellingBalanceWeeklyChange'
  | 'mean4w'
  | 'mean13w'
  | 'mean52w'
  | 'deviation52w'
  | 'percentile52w'
  | 'averageDailyVolume20'
  | 'digestionDays';

export type SupplyDemandUnavailableReason =
  | 'missing_data'
  | 'insufficient_history'
  | 'zero_selling_balance'
  | 'zero_mean_52w'
  | 'zero_average_daily_volume';

export interface UnavailableSupplyDemandMetric {
  metric: SupplyDemandMetric;
  reason: SupplyDemandUnavailableReason;
}

export interface SupplyDemandResult {
  dataDate: string | null;
  volumeDataDate: string | null;
  buyingBalance: number | null;
  sellingBalance: number | null;
  marginRatio: number | null;
  buyingBalanceWeeklyChange: number | null;
  sellingBalanceWeeklyChange: number | null;
  mean4w: number | null;
  mean13w: number | null;
  mean52w: number | null;
  deviation52w: number | null;
  percentile52w: number | null;
  averageDailyVolume20: number | null;
  digestionDays: number | null;
  unavailable: UnavailableSupplyDemandMetric[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asNonNegative(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

/** Calculate the mean of the latest period without skipping missing values. */
export function calculateMean(
  values: readonly (number | null)[],
  period: number,
): number | null {
  assertPositiveInteger(period, 'period');
  if (values.length < period) return null;

  const window = values.slice(-period);
  if (!window.every(isFiniteNumber)) return null;
  return window.reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Return an inclusive percentile rank for an observed value.
 * Ties use their average rank; the lowest and highest ranks are 0 and 1.
 */
export function calculatePercentileRank(
  values: readonly (number | null)[],
  current: number | null,
): number | null {
  if (!isFiniteNumber(current) || values.length < 2 || !values.every(isFiniteNumber)) {
    return null;
  }

  const lessCount = values.filter((value) => value < current).length;
  const equalCount = values.filter((value) => value === current).length;
  if (equalCount === 0) return null;

  const averageRank = lessCount + (equalCount - 1) / 2;
  return averageRank / (values.length - 1);
}

function assertChronologicalOrder(
  points: readonly { date: string }[],
  label: string,
): void {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].date <= points[index - 1].date) {
      throw new Error(`${label} must be in strictly ascending date order.`);
    }
  }
}

function historyReason(actual: number, required: number): SupplyDemandUnavailableReason {
  return actual < required ? 'insufficient_history' : 'missing_data';
}

/** Build the fixed MVP supply-demand snapshot from chronological histories. */
export function analyzeSupplyDemand(
  marginHistory: readonly MarginHistoryPoint[],
  volumeHistory: readonly VolumeHistoryPoint[],
): SupplyDemandResult {
  assertChronologicalOrder(marginHistory, 'Margin history');
  assertChronologicalOrder(volumeHistory, 'Volume history');

  const dataDate = marginHistory.at(-1)?.date ?? null;
  const eligibleVolumeHistory = dataDate === null
    ? volumeHistory
    : volumeHistory.filter((point) => point.date <= dataDate);
  const longBalances = marginHistory.map((point) => asNonNegative(point.longBalance));
  const shortBalances = marginHistory.map((point) => asNonNegative(point.shortBalance));
  const volumes = eligibleVolumeHistory.map((point) => asNonNegative(point.volume));
  const currentLong = longBalances.at(-1) ?? null;
  const currentShort = shortBalances.at(-1) ?? null;
  const previousLong = longBalances.at(-2) ?? null;
  const previousShort = shortBalances.at(-2) ?? null;

  const mean4w = calculateMean(longBalances, SUPPLY_DEMAND_DEFAULTS.mean4wPeriod);
  const mean13w = calculateMean(longBalances, SUPPLY_DEMAND_DEFAULTS.mean13wPeriod);
  const mean52w = calculateMean(longBalances, SUPPLY_DEMAND_DEFAULTS.mean52wPeriod);
  const latest52w = longBalances.slice(-SUPPLY_DEMAND_DEFAULTS.mean52wPeriod);
  const percentile52w = marginHistory.length >= SUPPLY_DEMAND_DEFAULTS.mean52wPeriod
    ? calculatePercentileRank(latest52w, currentLong)
    : null;
  const averageDailyVolume20 = calculateMean(
    volumes,
    SUPPLY_DEMAND_DEFAULTS.averageVolumePeriod,
  );

  const result: SupplyDemandResult = {
    dataDate,
    volumeDataDate: eligibleVolumeHistory.at(-1)?.date ?? null,
    buyingBalance: currentLong,
    sellingBalance: currentShort,
    marginRatio: currentLong !== null && currentShort !== null && currentShort !== 0
      ? currentLong / currentShort
      : null,
    buyingBalanceWeeklyChange: currentLong !== null && previousLong !== null
      ? currentLong - previousLong
      : null,
    sellingBalanceWeeklyChange: currentShort !== null && previousShort !== null
      ? currentShort - previousShort
      : null,
    mean4w,
    mean13w,
    mean52w,
    deviation52w: currentLong !== null && mean52w !== null && mean52w !== 0
      ? (currentLong - mean52w) / mean52w
      : null,
    percentile52w,
    averageDailyVolume20,
    digestionDays: currentLong !== null
      && averageDailyVolume20 !== null
      && averageDailyVolume20 !== 0
      ? currentLong / averageDailyVolume20
      : null,
    unavailable: [],
  };

  const markUnavailable = (
    metric: SupplyDemandMetric,
    reason: SupplyDemandUnavailableReason,
  ): void => {
    result.unavailable.push({ metric, reason });
  };

  if (currentLong === null) markUnavailable('buyingBalance', 'missing_data');
  if (currentShort === null) markUnavailable('sellingBalance', 'missing_data');

  if (result.marginRatio === null) {
    markUnavailable(
      'marginRatio',
      currentLong === null || currentShort === null
        ? 'missing_data'
        : 'zero_selling_balance',
    );
  }

  if (result.buyingBalanceWeeklyChange === null) {
    markUnavailable(
      'buyingBalanceWeeklyChange',
      historyReason(marginHistory.length, 2),
    );
  }
  if (result.sellingBalanceWeeklyChange === null) {
    markUnavailable(
      'sellingBalanceWeeklyChange',
      historyReason(marginHistory.length, 2),
    );
  }

  if (mean4w === null) {
    markUnavailable(
      'mean4w',
      historyReason(marginHistory.length, SUPPLY_DEMAND_DEFAULTS.mean4wPeriod),
    );
  }

  if (mean13w === null) {
    markUnavailable(
      'mean13w',
      historyReason(marginHistory.length, SUPPLY_DEMAND_DEFAULTS.mean13wPeriod),
    );
  }

  const reason52w = historyReason(
    marginHistory.length,
    SUPPLY_DEMAND_DEFAULTS.mean52wPeriod,
  );
  if (mean52w === null) markUnavailable('mean52w', reason52w);
  if (result.deviation52w === null) {
    const deviationReason = currentLong === null
      ? 'missing_data'
      : marginHistory.length < SUPPLY_DEMAND_DEFAULTS.mean52wPeriod
        ? 'insufficient_history'
        : mean52w === null
          ? 'missing_data'
          : 'zero_mean_52w';
    markUnavailable(
      'deviation52w',
      deviationReason,
    );
  }
  if (percentile52w === null) {
    markUnavailable(
      'percentile52w',
      currentLong === null ? 'missing_data' : reason52w,
    );
  }

  if (averageDailyVolume20 === null) {
    markUnavailable(
      'averageDailyVolume20',
      historyReason(eligibleVolumeHistory.length, SUPPLY_DEMAND_DEFAULTS.averageVolumePeriod),
    );
  }

  if (result.digestionDays === null) {
    const digestionReason = currentLong === null
      ? 'missing_data'
      : averageDailyVolume20 === 0
        ? 'zero_average_daily_volume'
        : averageDailyVolume20 === null
          ? historyReason(
            eligibleVolumeHistory.length,
            SUPPLY_DEMAND_DEFAULTS.averageVolumePeriod,
          )
          : 'missing_data';
    markUnavailable('digestionDays', digestionReason);
  }

  return result;
}
