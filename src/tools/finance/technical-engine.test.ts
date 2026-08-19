import { describe, expect, test } from 'bun:test';
import {
  analyzeTechnical,
  calculateAtr,
  calculateAverageVolume,
  calculateSma,
  classifyTrend,
  findSwingHighs,
  findSwingLows,
  type SwingPoint,
  type TechnicalBar,
} from './technical-engine.js';

function makeBars(
  highs: readonly (number | null)[],
  lows: readonly (number | null)[] = highs.map((value) => value === null ? null : value - 1),
): TechnicalBar[] {
  return highs.map((high, index) => {
    const low = lows[index];
    return {
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      high,
      low,
      close: high === null || low === null ? null : (high + low) / 2,
      volume: 100 + index,
    };
  });
}

function swingPoint(value: number, index: number): SwingPoint {
  return { index, date: `2026-01-${String(index + 1).padStart(2, '0')}`, value };
}

describe('calculateSma', () => {
  test('calculates the latest simple moving average', () => {
    expect(calculateSma([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  test('returns null for insufficient history', () => {
    expect(calculateSma([1, 2], 3)).toBeNull();
  });

  test('returns the latest value for period 1', () => {
    expect(calculateSma([1, 2, 3], 1)).toBe(3);
  });

  test('returns null when the calculation window contains missing data', () => {
    expect(calculateSma([1, null, 3], 3)).toBeNull();
  });

  test('rejects a non-positive period', () => {
    expect(() => calculateSma([1], 0)).toThrow(RangeError);
  });
});

describe('calculateAverageVolume', () => {
  test('calculates average volume without treating zero as missing', () => {
    expect(calculateAverageVolume([0, 100, 200], 3)).toBe(100);
  });

  test('returns null for missing volume', () => {
    expect(calculateAverageVolume([100, null, 200], 3)).toBeNull();
  });

  test('returns null for an invalid negative volume', () => {
    expect(calculateAverageVolume([100, -1, 200], 3)).toBeNull();
  });
});

describe('calculateAtr', () => {
  test('calculates the average of the latest true ranges', () => {
    const bars = [
      { high: 10, low: 8, close: 9 },
      { high: 11, low: 9, close: 10 },
      { high: 12, low: 10, close: 11 },
    ];
    expect(calculateAtr(bars, 2)).toBe(2);
  });

  test('captures an overnight price gap', () => {
    const bars = [
      { high: 11, low: 9, close: 10 },
      { high: 15, low: 14, close: 14.5 },
    ];
    expect(calculateAtr(bars, 1)).toBe(5);
  });

  test('returns null when there is not enough history', () => {
    expect(calculateAtr([{ high: 10, low: 8, close: 9 }], 1)).toBeNull();
  });

  test('returns null for missing data or an invalid high-low range', () => {
    expect(calculateAtr([
      { high: 10, low: 8, close: 9 },
      { high: null, low: 9, close: 10 },
    ], 1)).toBeNull();
    expect(calculateAtr([
      { high: 10, low: 8, close: 9 },
      { high: 8, low: 9, close: 8.5 },
    ], 1)).toBeNull();
  });
});

describe('swing detection', () => {
  test('finds a clear strict swing high', () => {
    expect(findSwingHighs(makeBars([1, 3, 1]), 1)).toEqual([
      swingPoint(3, 1),
    ]);
  });

  test('finds a clear strict swing low', () => {
    expect(findSwingLows(makeBars([3, 1, 3], [2, 0, 2]), 1)).toEqual([
      swingPoint(0, 1),
    ]);
  });

  test('does not classify equal highs as swings', () => {
    expect(findSwingHighs(makeBars([1, 3, 3, 1]), 1)).toEqual([]);
  });

  test('returns no swings for insufficient or missing history', () => {
    expect(findSwingHighs(makeBars([1, 2]), 1)).toEqual([]);
    expect(findSwingHighs(makeBars([1, 3, null]), 1)).toEqual([]);
  });
});

describe('classifyTrend', () => {
  test('classifies higher high and higher low as uptrend', () => {
    expect(classifyTrend(
      [swingPoint(10, 1), swingPoint(12, 3)],
      [swingPoint(5, 2), swingPoint(6, 4)],
    )).toBe('uptrend');
  });

  test('classifies lower high and lower low as downtrend', () => {
    expect(classifyTrend(
      [swingPoint(12, 1), swingPoint(10, 3)],
      [swingPoint(6, 2), swingPoint(5, 4)],
    )).toBe('downtrend');
  });

  test('classifies mixed or equal swings as range or transition', () => {
    expect(classifyTrend(
      [swingPoint(10, 1), swingPoint(12, 3)],
      [swingPoint(6, 2), swingPoint(5, 4)],
    )).toBe('range_or_transition');
    expect(classifyTrend(
      [swingPoint(10, 1), swingPoint(10, 3)],
      [swingPoint(5, 2), swingPoint(6, 4)],
    )).toBe('range_or_transition');
  });

  test('returns unavailable without two highs and two lows', () => {
    expect(classifyTrend([swingPoint(10, 1)], [swingPoint(5, 2)])).toBe('unavailable');
  });
});

describe('analyzeTechnical', () => {
  const highs = [
    10, 11, 12, 13, 14, 13, 12, 11, 10, 11, 12,
    13, 16, 14, 13, 12, 11, 12, 13, 14, 15,
  ];
  const lows = [
    8, 9, 10, 11, 12, 11, 10, 9, 7, 9, 10,
    11, 13, 12, 11, 10, 8, 10, 11, 12, 13,
  ];

  test('returns the fixed MVP technical snapshot from OHLCV only', () => {
    const bars = makeBars(highs, lows);
    const result = analyzeTechnical(bars);

    expect(result.dataDate).toBe('2026-01-21');
    expect(result.ma20).toBeNumber();
    expect(result.atr14).toBeNumber();
    expect(result.averageVolume20).toBe(110.5);
    expect(result.trend).toBe('uptrend');
    expect(result.latestSwingHigh).toBe(16);
    expect(result.latestSwingLow).toBe(8);
    expect(result.unavailable).toEqual([]);
  });

  test('makes insufficient history explicit', () => {
    expect(analyzeTechnical([])).toEqual({
      dataDate: null,
      ma20: null,
      atr14: null,
      averageVolume20: null,
      trend: 'unavailable',
      latestSwingHigh: null,
      latestSwingLow: null,
      unavailable: [
        'ma20',
        'atr14',
        'averageVolume20',
        'latestSwingHigh',
        'latestSwingLow',
        'trend',
      ],
    });
  });

  test('reports missing values without fabricating metrics', () => {
    const bars = makeBars(highs, lows);
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      close: null,
      volume: null,
    };

    const result = analyzeTechnical(bars);
    expect(result.ma20).toBeNull();
    expect(result.averageVolume20).toBeNull();
    expect(result.unavailable).toContain('ma20');
    expect(result.unavailable).toContain('averageVolume20');
  });

  test('does not classify swings or trend when high-low history is incomplete', () => {
    const bars = makeBars(highs, lows);
    bars[10] = { ...bars[10], high: null };

    const result = analyzeTechnical(bars);
    expect(result.latestSwingHigh).toBeNull();
    expect(result.latestSwingLow).toBeNull();
    expect(result.trend).toBe('unavailable');
    expect(result.unavailable).toContain('trend');
  });

  test('rejects bars that are not in chronological order', () => {
    const bars = makeBars([10, 11]);
    bars[1] = { ...bars[1], date: bars[0].date };
    expect(() => analyzeTechnical(bars)).toThrow('strictly ascending date order');
  });
});
