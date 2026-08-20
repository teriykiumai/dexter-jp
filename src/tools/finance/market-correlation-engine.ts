export const MARKET_CORRELATION_DEFAULTS = {
  periods: [60, 250] as const,
  annualizationDays: 245,
} as const;

const ZERO_VARIANCE_EPSILON = 1e-24;

export interface MarketPricePoint {
  date: string;
  close: number | null;
}

export interface AlignedMarketPricePoint {
  date: string;
  stockClose: number;
  benchmarkClose: number;
}

export interface AlignedMarketReturn {
  date: string;
  stockReturn: number;
  benchmarkReturn: number;
}

export type MarketCorrelationMetric =
  | 'correlation'
  | 'beta'
  | 'alphaAnnualized'
  | 'rSquared'
  | 'stockVolatilityAnnualized'
  | 'benchmarkVolatilityAnnualized'
  | 'excessReturn';

export type MarketCorrelationUnavailableReason =
  | 'insufficient_history'
  | 'zero_stock_variance'
  | 'zero_benchmark_variance';

export interface UnavailableMarketCorrelationMetric {
  metric: MarketCorrelationMetric;
  reason: MarketCorrelationUnavailableReason;
}

export interface MarketCorrelationWindowResult {
  period: number;
  startDate: string | null;
  endDate: string | null;
  observations: number;
  correlation: number | null;
  beta: number | null;
  alphaAnnualized: number | null;
  rSquared: number | null;
  stockVolatilityAnnualized: number | null;
  benchmarkVolatilityAnnualized: number | null;
  excessReturn: number | null;
  unavailable: UnavailableMarketCorrelationMetric[];
}

export interface MarketCorrelationResult {
  benchmark: 'TOPIX';
  dataDate: string | null;
  alignedPriceCount: number;
  windows: MarketCorrelationWindowResult[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositivePrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

/** Inner join positive stock and benchmark closes by date without forward fill. */
export function alignMarketPrices(
  stockPrices: readonly MarketPricePoint[],
  benchmarkPrices: readonly MarketPricePoint[],
): AlignedMarketPricePoint[] {
  assertChronologicalOrder(stockPrices, 'Stock prices');
  assertChronologicalOrder(benchmarkPrices, 'Benchmark prices');

  const benchmarkByDate = new Map(
    benchmarkPrices
      .filter((point) => isPositivePrice(point.close))
      .map((point) => [point.date, point.close] as const),
  );

  return stockPrices.flatMap((point) => {
    if (!isPositivePrice(point.close)) return [];
    const benchmarkClose = benchmarkByDate.get(point.date);
    if (!isPositivePrice(benchmarkClose)) return [];
    return [{
      date: point.date,
      stockClose: point.close,
      benchmarkClose,
    }];
  });
}

/** Calculate matched daily log returns from already aligned price observations. */
export function calculateAlignedLogReturns(
  alignedPrices: readonly AlignedMarketPricePoint[],
): AlignedMarketReturn[] {
  assertChronologicalOrder(alignedPrices, 'Aligned prices');

  const returns: AlignedMarketReturn[] = [];
  for (let index = 1; index < alignedPrices.length; index += 1) {
    const previous = alignedPrices[index - 1];
    const current = alignedPrices[index];
    if (
      !isPositivePrice(previous.stockClose)
      || !isPositivePrice(previous.benchmarkClose)
      || !isPositivePrice(current.stockClose)
      || !isPositivePrice(current.benchmarkClose)
    ) {
      throw new Error('Aligned prices must contain positive finite closes.');
    }

    returns.push({
      date: current.date,
      stockReturn: Math.log(current.stockClose / previous.stockClose),
      benchmarkReturn: Math.log(current.benchmarkClose / previous.benchmarkClose),
    });
  }
  return returns;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[], average: number): number {
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / (values.length - 1);
}

function sampleCovariance(
  left: readonly number[],
  right: readonly number[],
  leftMean: number,
  rightMean: number,
): number {
  return left.reduce(
    (sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean),
    0,
  ) / (left.length - 1);
}

function clampCorrelation(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function unavailableWindow(
  period: number,
  alignedPrices: readonly AlignedMarketPricePoint[],
): MarketCorrelationWindowResult {
  const availableReturns = Math.max(0, alignedPrices.length - 1);
  const metrics: readonly MarketCorrelationMetric[] = [
    'correlation',
    'beta',
    'alphaAnnualized',
    'rSquared',
    'stockVolatilityAnnualized',
    'benchmarkVolatilityAnnualized',
    'excessReturn',
  ];

  return {
    period,
    startDate: alignedPrices.at(0)?.date ?? null,
    endDate: alignedPrices.at(-1)?.date ?? null,
    observations: availableReturns,
    correlation: null,
    beta: null,
    alphaAnnualized: null,
    rSquared: null,
    stockVolatilityAnnualized: null,
    benchmarkVolatilityAnnualized: null,
    excessReturn: null,
    unavailable: metrics.map((metric) => ({
      metric,
      reason: 'insufficient_history',
    })),
  };
}

function analyzeWindow(
  allAlignedPrices: readonly AlignedMarketPricePoint[],
  period: number,
): MarketCorrelationWindowResult {
  assertPositiveInteger(period, 'period');
  if (allAlignedPrices.length < period + 1) {
    return unavailableWindow(period, allAlignedPrices);
  }

  const alignedPrices = allAlignedPrices.slice(-(period + 1));
  const returns = calculateAlignedLogReturns(alignedPrices);
  const stockReturns = returns.map((point) => point.stockReturn);
  const benchmarkReturns = returns.map((point) => point.benchmarkReturn);
  const stockMean = mean(stockReturns);
  const benchmarkMean = mean(benchmarkReturns);
  const stockVariance = sampleVariance(stockReturns, stockMean);
  const benchmarkVariance = sampleVariance(benchmarkReturns, benchmarkMean);
  const covariance = sampleCovariance(
    stockReturns,
    benchmarkReturns,
    stockMean,
    benchmarkMean,
  );
  const stockVarianceIsZero = stockVariance <= ZERO_VARIANCE_EPSILON;
  const benchmarkVarianceIsZero = benchmarkVariance <= ZERO_VARIANCE_EPSILON;
  const stockVolatilityAnnualized = stockVarianceIsZero
    ? 0
    : Math.sqrt(stockVariance) * Math.sqrt(MARKET_CORRELATION_DEFAULTS.annualizationDays);
  const benchmarkVolatilityAnnualized = benchmarkVarianceIsZero
    ? 0
    : Math.sqrt(benchmarkVariance)
      * Math.sqrt(MARKET_CORRELATION_DEFAULTS.annualizationDays);
  const beta = benchmarkVarianceIsZero ? null : covariance / benchmarkVariance;
  const correlation = stockVarianceIsZero || benchmarkVarianceIsZero
    ? null
    : clampCorrelation(covariance / Math.sqrt(stockVariance * benchmarkVariance));
  const alphaAnnualized = beta === null
    ? null
    : (stockMean - beta * benchmarkMean)
      * MARKET_CORRELATION_DEFAULTS.annualizationDays;
  const rSquared = correlation === null ? null : correlation ** 2;
  const excessReturn = stockReturns.reduce((sum, value) => sum + value, 0)
    - benchmarkReturns.reduce((sum, value) => sum + value, 0);
  const unavailable: UnavailableMarketCorrelationMetric[] = [];

  if (benchmarkVarianceIsZero) {
    for (const metric of ['correlation', 'beta', 'alphaAnnualized', 'rSquared'] as const) {
      unavailable.push({ metric, reason: 'zero_benchmark_variance' });
    }
  } else if (stockVarianceIsZero) {
    for (const metric of ['correlation', 'rSquared'] as const) {
      unavailable.push({ metric, reason: 'zero_stock_variance' });
    }
  }

  return {
    period,
    startDate: alignedPrices[0].date,
    endDate: alignedPrices.at(-1)?.date ?? null,
    observations: returns.length,
    correlation,
    beta,
    alphaAnnualized,
    rSquared,
    stockVolatilityAnnualized,
    benchmarkVolatilityAnnualized,
    excessReturn,
    unavailable,
  };
}

/** Build fixed 60-day and 250-day market statistics against TOPIX. */
export function analyzeMarketCorrelation(
  stockPrices: readonly MarketPricePoint[],
  topixPrices: readonly MarketPricePoint[],
): MarketCorrelationResult {
  const alignedPrices = alignMarketPrices(stockPrices, topixPrices);
  return {
    benchmark: 'TOPIX',
    dataDate: alignedPrices.at(-1)?.date ?? null,
    alignedPriceCount: alignedPrices.length,
    windows: MARKET_CORRELATION_DEFAULTS.periods.map((period) => (
      analyzeWindow(alignedPrices, period)
    )),
  };
}
