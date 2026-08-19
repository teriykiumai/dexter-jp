export const TECHNICAL_DEFAULTS = {
  smaPeriod: 20,
  atrPeriod: 14,
  averageVolumePeriod: 20,
  swingWindow: 3,
} as const;

export interface TechnicalBar {
  date: string;
  open?: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface SwingPoint {
  index: number;
  date: string;
  value: number;
}

export type TechnicalTrend =
  | 'uptrend'
  | 'downtrend'
  | 'range_or_transition'
  | 'unavailable';

export type UnavailableTechnicalMetric =
  | 'ma20'
  | 'atr14'
  | 'averageVolume20'
  | 'latestSwingHigh'
  | 'latestSwingLow'
  | 'trend';

export interface TechnicalResult {
  dataDate: string | null;
  ma20: number | null;
  atr14: number | null;
  averageVolume20: number | null;
  trend: TechnicalTrend;
  latestSwingHigh: number | null;
  latestSwingLow: number | null;
  unavailable: UnavailableTechnicalMetric[];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Return the simple average of the latest period, or null when unavailable. */
export function calculateSma(
  values: readonly (number | null)[],
  period: number,
): number | null {
  assertPositiveInteger(period, 'period');
  if (values.length < period) return null;

  const window = values.slice(-period);
  if (!window.every(isFiniteNumber)) return null;
  return window.reduce((sum, value) => sum + value, 0) / period;
}

/** Average volume uses the same arithmetic mean while retaining financial intent. */
export function calculateAverageVolume(
  volumes: readonly (number | null)[],
  period: number,
): number | null {
  const average = calculateSma(volumes, period);
  if (average === null) return null;
  const window = volumes.slice(-period);
  if (window.some((volume) => isFiniteNumber(volume) && volume < 0)) return null;
  return average;
}

/**
 * Calculate the simple average of the latest true ranges.
 * A period of N requires N + 1 bars so every range has a previous close.
 */
export function calculateAtr(
  bars: readonly Pick<TechnicalBar, 'high' | 'low' | 'close'>[],
  period: number,
): number | null {
  assertPositiveInteger(period, 'period');
  if (bars.length < period + 1) return null;

  const window = bars.slice(-(period + 1));
  const trueRanges: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const previousClose = window[index - 1].close;
    const { high, low } = window[index];
    if (!isFiniteNumber(previousClose) || !isFiniteNumber(high) || !isFiniteNumber(low)) {
      return null;
    }
    if (high < low) return null;

    trueRanges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ));
  }

  return trueRanges.reduce((sum, value) => sum + value, 0) / period;
}

function findSwingPoints(
  bars: readonly TechnicalBar[],
  window: number,
  field: 'high' | 'low',
): SwingPoint[] {
  assertPositiveInteger(window, 'window');
  if (bars.length < window * 2 + 1) return [];

  const points: SwingPoint[] = [];
  for (let index = window; index < bars.length - window; index += 1) {
    const candidate = bars[index][field];
    const neighbors = bars
      .slice(index - window, index + window + 1)
      .filter((_, offset) => offset !== window)
      .map((bar) => bar[field]);

    if (!isFiniteNumber(candidate) || !neighbors.every(isFiniteNumber)) continue;
    const isSwing = field === 'high'
      ? neighbors.every((value) => candidate > value)
      : neighbors.every((value) => candidate < value);

    if (isSwing) {
      points.push({ index, date: bars[index].date, value: candidate });
    }
  }
  return points;
}

export function findSwingHighs(
  bars: readonly TechnicalBar[],
  window: number = TECHNICAL_DEFAULTS.swingWindow,
): SwingPoint[] {
  return findSwingPoints(bars, window, 'high');
}

export function findSwingLows(
  bars: readonly TechnicalBar[],
  window: number = TECHNICAL_DEFAULTS.swingWindow,
): SwingPoint[] {
  return findSwingPoints(bars, window, 'low');
}

/** Classify trend from the latest two swing highs and latest two swing lows. */
export function classifyTrend(
  swingHighs: readonly SwingPoint[],
  swingLows: readonly SwingPoint[],
): TechnicalTrend {
  if (swingHighs.length < 2 || swingLows.length < 2) return 'unavailable';

  const previousHigh = swingHighs[swingHighs.length - 2].value;
  const latestHigh = swingHighs[swingHighs.length - 1].value;
  const previousLow = swingLows[swingLows.length - 2].value;
  const latestLow = swingLows[swingLows.length - 1].value;

  if (latestHigh > previousHigh && latestLow > previousLow) return 'uptrend';
  if (latestHigh < previousHigh && latestLow < previousLow) return 'downtrend';
  return 'range_or_transition';
}

function assertChronologicalOrder(bars: readonly TechnicalBar[]): void {
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].date <= bars[index - 1].date) {
      throw new Error('Technical bars must be in strictly ascending date order.');
    }
  }
}

/** Build the fixed MVP technical snapshot from chronological OHLCV bars. */
export function analyzeTechnical(bars: readonly TechnicalBar[]): TechnicalResult {
  assertChronologicalOrder(bars);

  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const hasCompleteSwingData = bars.every((bar) => (
    isFiniteNumber(bar.high)
    && isFiniteNumber(bar.low)
    && bar.high >= bar.low
  ));
  const swingHighs = hasCompleteSwingData ? findSwingHighs(bars) : [];
  const swingLows = hasCompleteSwingData ? findSwingLows(bars) : [];
  const latestSwingHigh = swingHighs.at(-1)?.value ?? null;
  const latestSwingLow = swingLows.at(-1)?.value ?? null;

  const result: TechnicalResult = {
    dataDate: bars.at(-1)?.date ?? null,
    ma20: calculateSma(closes, TECHNICAL_DEFAULTS.smaPeriod),
    atr14: calculateAtr(bars, TECHNICAL_DEFAULTS.atrPeriod),
    averageVolume20: calculateAverageVolume(
      volumes,
      TECHNICAL_DEFAULTS.averageVolumePeriod,
    ),
    trend: classifyTrend(swingHighs, swingLows),
    latestSwingHigh,
    latestSwingLow,
    unavailable: [],
  };

  const metricKeys: readonly UnavailableTechnicalMetric[] = [
    'ma20',
    'atr14',
    'averageVolume20',
    'latestSwingHigh',
    'latestSwingLow',
  ];
  result.unavailable.push(...metricKeys.filter((key) => result[key] === null));
  if (result.trend === 'unavailable') result.unavailable.push('trend');

  return result;
}
