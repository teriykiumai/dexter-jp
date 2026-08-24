import { describe, expect, test } from 'bun:test';
import { calculateRsi } from './advanced-technical-engine.js';

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
