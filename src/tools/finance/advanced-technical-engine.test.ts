import { describe, expect, test } from 'bun:test';
import {
  calculateBollingerBands,
  calculateMacd,
  calculateRsi,
} from './advanced-technical-engine.js';

const deterministicCloses = [
  100, 102, 101, 104, 103, 105, 106, 104,
  107, 109, 108, 110, 111, 109, 112, 113,
] as const;

describe('calculateRsi', () => {
  test('calculates a hand-verifiable RSI from the initial 14 changes', () => {
    const result = calculateRsi(deterministicCloses.slice(0, 15));

    expect(result.unavailable).toEqual([]);
    expect(result.rsi14).toBeCloseTo(950 / 13, 12);
  });

  test('returns 100 for a rising series with zero average loss', () => {
    const closes = Array.from({ length: 15 }, (_, index) => index + 1);
    expect(calculateRsi(closes)).toEqual({ rsi14: 100, unavailable: [] });
  });

  test('returns 0 for a falling series with zero average gain', () => {
    const closes = Array.from({ length: 15 }, (_, index) => 15 - index);
    expect(calculateRsi(closes)).toEqual({ rsi14: 0, unavailable: [] });
  });

  test('returns 50 for a flat series with zero average gain and loss', () => {
    expect(calculateRsi(Array<number>(15).fill(100))).toEqual({
      rsi14: 50,
      unavailable: [],
    });
  });

  test('reports insufficient history for 14 closes or fewer', () => {
    for (const length of [0, 14]) {
      expect(calculateRsi(Array<number>(length).fill(100))).toEqual({
        rsi14: null,
        unavailable: [{ metric: 'rsi14', reason: 'insufficient_history' }],
      });
    }
  });

  test('reports missing data without skipping a null inside the sequence', () => {
    const closes: Array<number | null> = [...deterministicCloses];
    closes[5] = null;

    expect(calculateRsi(closes)).toEqual({
      rsi14: null,
      unavailable: [{ metric: 'rsi14', reason: 'missing_data' }],
    });
  });

  test('reports non-finite closes as invalid data', () => {
    for (const invalidClose of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const closes: number[] = [...deterministicCloses];
      closes[5] = invalidClose;
      expect(calculateRsi(closes)).toEqual({
        rsi14: null,
        unavailable: [{ metric: 'rsi14', reason: 'invalid_data' }],
      });
    }
  });

  test('reports zero and negative closes as invalid data', () => {
    for (const invalidClose of [0, -1]) {
      const closes: number[] = [...deterministicCloses];
      closes[5] = invalidClose;
      expect(calculateRsi(closes)).toEqual({
        rsi14: null,
        unavailable: [{ metric: 'rsi14', reason: 'invalid_data' }],
      });
    }
  });

  test('applies the recursive Wilder update after the initial result', () => {
    const result = calculateRsi(deterministicCloses);

    expect(result.unavailable).toEqual([]);
    expect(result.rsi14).toBeCloseTo(6525 / 88, 12);
  });

  test('does not mutate the input sequence', () => {
    const closes = [...deterministicCloses];
    const original = [...closes];

    calculateRsi(closes);

    expect(closes).toEqual(original);
  });

  test('keeps an as-of prefix result unchanged when future bars exist', () => {
    const prefix = deterministicCloses.slice(0, 15);
    const beforeFutureBars = calculateRsi(prefix);
    const historyWithFutureBars = [...prefix, 80, 120];

    expect(calculateRsi(historyWithFutureBars.slice(0, prefix.length))).toEqual(beforeFutureBars);
    expect(calculateRsi(historyWithFutureBars).rsi14).not.toBe(beforeFutureBars.rsi14);
  });
});

function steppedMacdCloses(stepCloses: number): number[] {
  return [
    ...Array<number>(26).fill(100),
    ...Array<number>(stepCloses).fill(113),
  ];
}

describe('calculateMacd', () => {
  test('calculates a hand-verifiable MACD 12/26/9 result', () => {
    const result = calculateMacd(steppedMacdCloses(8));

    expect(result.unavailable).toEqual([]);
    expect(result.macd?.value).toBeCloseTo(3.6073369779984232, 12);
    expect(result.macd?.signal).toBeCloseTo(2.4439086812587636, 12);
    expect(result.macd?.histogram).toBeCloseTo(1.1634282967396596, 12);
  });

  test('requires exactly 34 closes for the first complete result', () => {
    expect(calculateMacd(Array<number>(33).fill(100))).toEqual({
      macd: null,
      unavailable: [{ metric: 'macd', reason: 'insufficient_history' }],
    });
    expect(calculateMacd(Array<number>(34).fill(100)).macd).not.toBeNull();
  });

  test('returns zero MACD, signal, and histogram for a constant series', () => {
    expect(calculateMacd(Array<number>(34).fill(100))).toEqual({
      macd: { value: 0, signal: 0, histogram: 0 },
      unavailable: [],
    });
  });

  test('uses SMA seeds for EMA12 and EMA26', () => {
    const linearCloses = Array.from({ length: 34 }, (_, index) => index + 1);
    const result = calculateMacd(linearCloses);

    expect(result.macd?.value).toBeCloseTo(7, 12);
  });

  test('seeds the first signal from the first nine MACD values', () => {
    const result = calculateMacd(steppedMacdCloses(8));

    expect(result.macd?.signal).toBeCloseTo(2.4439086812587636, 12);
  });

  test('recursively updates price and signal EMAs after their seeds', () => {
    const result = calculateMacd(steppedMacdCloses(9));

    expect(result.macd?.value).toBeCloseTo(3.6126409014935934, 12);
    expect(result.macd?.signal).toBeCloseTo(2.67765512530573, 12);
  });

  test('reports missing data without skipping a null inside the recursive sequence', () => {
    const closes: Array<number | null> = steppedMacdCloses(8);
    closes[20] = null;

    expect(calculateMacd(closes)).toEqual({
      macd: null,
      unavailable: [{ metric: 'macd', reason: 'missing_data' }],
    });
  });

  test('reports non-finite and non-positive closes as invalid data', () => {
    for (const invalidClose of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
    ]) {
      const closes = steppedMacdCloses(8);
      closes[20] = invalidClose;
      expect(calculateMacd(closes)).toEqual({
        macd: null,
        unavailable: [{ metric: 'macd', reason: 'invalid_data' }],
      });
    }
  });

  test('defines histogram as MACD minus signal', () => {
    const result = calculateMacd(steppedMacdCloses(9));

    if (result.macd === null) throw new Error('Expected MACD to be available.');
    expect(result.macd.histogram).toBeCloseTo(result.macd.value - result.macd.signal, 12);
  });

  test('does not mutate the input sequence', () => {
    const closes = steppedMacdCloses(9);
    const original = [...closes];

    calculateMacd(closes);

    expect(closes).toEqual(original);
  });

  test('keeps an as-of prefix result unchanged when future bars exist', () => {
    const prefix = steppedMacdCloses(8);
    const beforeFutureBars = calculateMacd(prefix);
    const historyWithFutureBars = [...prefix, 80, 120];

    expect(calculateMacd(historyWithFutureBars.slice(0, prefix.length))).toEqual(
      beforeFutureBars,
    );
    expect(calculateMacd(historyWithFutureBars).macd).not.toEqual(beforeFutureBars.macd);
  });

  test('uses the full supplied sequence instead of truncating to the latest 251 closes', () => {
    const fullHistory = [1_000_000_000_000, ...Array<number>(251).fill(100)];
    const fullHistoryResult = calculateMacd(fullHistory);
    const latest251Result = calculateMacd(fullHistory.slice(-251));

    expect(latest251Result).toEqual({
      macd: { value: 0, signal: 0, histogram: 0 },
      unavailable: [],
    });
    expect(fullHistoryResult.macd).not.toEqual(latest251Result.macd);
  });
});

const variableBollingerCloses = Array.from({ length: 20 }, (_, index) => index + 1);

describe('calculateBollingerBands', () => {
  test('calculates hand-verifiable bands for a variable series', () => {
    const result = calculateBollingerBands(variableBollingerCloses);

    expect(result.unavailable).toEqual([]);
    expect(result.bollinger20?.middle).toBe(10.5);
    expect(result.bollinger20?.upper).toBeCloseTo(10.5 + Math.sqrt(133), 12);
    expect(result.bollinger20?.lower).toBeCloseTo(10.5 - Math.sqrt(133), 12);
  });

  test('returns equal bands for a constant 20-close series', () => {
    expect(calculateBollingerBands(Array<number>(20).fill(100))).toEqual({
      bollinger20: { middle: 100, upper: 100, lower: 100 },
      unavailable: [],
    });
  });

  test('requires 20 closes for the first available result', () => {
    expect(calculateBollingerBands(Array<number>(19).fill(100))).toEqual({
      bollinger20: null,
      unavailable: [{ metric: 'bollinger20', reason: 'insufficient_history' }],
    });
    expect(calculateBollingerBands(Array<number>(20).fill(100)).bollinger20).not.toBeNull();
  });

  test('uses population standard deviation with divisor 20', () => {
    const result = calculateBollingerBands(variableBollingerCloses);

    if (result.bollinger20 === null) throw new Error('Expected Bollinger Bands.');
    const standardDeviation = (result.bollinger20.upper - result.bollinger20.lower) / 4;
    expect(standardDeviation).toBeCloseTo(Math.sqrt(33.25), 12);
  });

  test('uses only the latest 20 closes for the latest value', () => {
    const withOlderHistory = [1_000_000, ...variableBollingerCloses];

    expect(calculateBollingerBands(withOlderHistory)).toEqual(
      calculateBollingerBands(variableBollingerCloses),
    );
  });

  test('reports missing data inside the latest 20 closes without skipping it', () => {
    const closes: Array<number | null> = [...variableBollingerCloses];
    closes[5] = null;

    expect(calculateBollingerBands(closes)).toEqual({
      bollinger20: null,
      unavailable: [{ metric: 'bollinger20', reason: 'missing_data' }],
    });
  });

  test('reports non-finite and non-positive data inside the latest 20 closes', () => {
    for (const invalidClose of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
    ]) {
      const closes = [...variableBollingerCloses];
      closes[5] = invalidClose;
      expect(calculateBollingerBands(closes)).toEqual({
        bollinger20: null,
        unavailable: [{ metric: 'bollinger20', reason: 'invalid_data' }],
      });
    }
  });

  test('ignores missing and invalid observations before the latest 20 closes', () => {
    const olderObservations = [null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1];
    const history: Array<number | null> = [...olderObservations, ...variableBollingerCloses];

    expect(calculateBollingerBands(history)).toEqual(
      calculateBollingerBands(variableBollingerCloses),
    );
  });

  test('does not mutate the input sequence', () => {
    const closes = [1_000_000, ...variableBollingerCloses];
    const original = [...closes];

    calculateBollingerBands(closes);

    expect(closes).toEqual(original);
  });
});
