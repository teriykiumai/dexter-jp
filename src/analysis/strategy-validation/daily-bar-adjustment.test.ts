import { describe, expect, test } from 'bun:test';
import {
  adjustDailyBarsToT0V1,
  hasCorporateActionV1,
  parseEligibleDailyBarsV1,
  requireDailyBarsForSessionsV1,
  parseTseSessionDate,
  type DailyBarInputV1,
} from './index.js';

function traded(date: string, overrides: Partial<DailyBarInputV1> = {}): DailyBarInputV1 {
  return {
    date,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    upperLimitFlag: '0',
    lowerLimitFlag: '0',
    adjustmentFactor: 1,
    exRightsType: null,
    ...overrides,
  };
}

describe('strict daily bars', () => {
  test('validates traded and explicit no-trade rows while rejecting mixed states', () => {
    const bars = parseEligibleDailyBarsV1([
      traded('2025-01-02'),
      traded('2025-01-03', {
        open: null, high: null, low: null, close: null,
        upperLimitFlag: null, lowerLimitFlag: '0',
      }),
    ], '2025-01-03');
    expect(bars[1]).toMatchObject({ open: null, upperLimitFlag: null, lowerLimitFlag: '0' });
    expect(() => parseEligibleDailyBarsV1([
      traded('2025-01-02', { close: null }),
    ], '2025-01-02')).toThrow('OHLC must be all');
    expect(() => parseEligibleDailyBarsV1([
      traded('2025-01-02', { open: null, high: null, low: null, close: null, upperLimitFlag: '1' }),
    ], '2025-01-02')).toThrow('limit flag');
    expect(() => parseEligibleDailyBarsV1([
      traded('2025-01-02', { high: 99 }),
    ], '2025-01-02')).toThrow('geometry');
  });

  test('filters future invalid rows before parsing, sorting, and duplicate checks', () => {
    const input = [
      traded('2025-01-02'),
      traded('2025-01-04', { upperLimitFlag: 'invalid' }),
      traded('2025-01-02', { date: '2025-01-04', adjustmentFactor: 0 }),
    ];
    const before = structuredClone(input);
    expect(parseEligibleDailyBarsV1(input, '2025-01-02')).toHaveLength(1);
    expect(input).toEqual(before);
  });

  test('distinguishes a missing official-session row from an explicit no-trade row', () => {
    const sessions = [parseTseSessionDate('2025-01-02'), parseTseSessionDate('2025-01-03')];
    const missing = parseEligibleDailyBarsV1([traded('2025-01-02')], '2025-01-03');
    expect(() => requireDailyBarsForSessionsV1(missing, sessions)).toThrow('official-session daily bar is missing');

    const explicit = parseEligibleDailyBarsV1([
      traded('2025-01-02'),
      traded('2025-01-03', {
        open: null, high: null, low: null, close: null,
        upperLimitFlag: null, lowerLimitFlag: null,
      }),
    ], '2025-01-03');
    expect(requireDailyBarsForSessionsV1(explicit, sessions)).toHaveLength(2);
    expect(() => adjustDailyBarsToT0V1(explicit, explicit[1]!.date)).toThrow('has no OHLC');
  });
});

describe('jquants_t0_adjustment_v1', () => {
  test('applies each factor only to earlier rows and uses exact one-decimal half-up rounding', () => {
    const bars = parseEligibleDailyBarsV1([
      traded('2025-01-01', { open: 100.05, high: 100.05, low: 100.05, close: 100.05 }),
      traded('2025-01-02', {
        open: 200.05, high: 200.05, low: 200.05, close: 200.05,
        adjustmentFactor: 0.5,
      }),
      traded('2025-01-03', {
        open: 100.05, high: 100.05, low: 100.05, close: 100.05,
        adjustmentFactor: 0.5,
      }),
    ], '2025-01-03');
    const before = structuredClone(bars);
    const adjusted = adjustDailyBarsToT0V1(bars, bars[2]!.date);
    expect(adjusted.map(row => row.close)).toEqual([25, 100, 100.1]);
    expect(adjusted.every(row => row.volume === null)).toBe(true);
    expect(bars).toEqual(before);
  });

  test('does not let a future factor affect the t0 basis', () => {
    const bars = parseEligibleDailyBarsV1([
      traded('2025-01-01', { close: 100.05 }),
      traded('2025-01-02', { close: 100.05 }),
      traded('2025-01-03', { close: 100.05, adjustmentFactor: 0.01 }),
    ], '2025-01-03');
    expect(adjustDailyBarsToT0V1(bars, bars[1]!.date).map(row => row.close)).toEqual([100.1, 100.1]);
  });

  test('detects both ExRT and non-unit adjustment factors as corporate actions', () => {
    const bars = parseEligibleDailyBarsV1([
      traded('2025-01-01'),
      traded('2025-01-02', { exRightsType: '1' }),
      traded('2025-01-03', { adjustmentFactor: 0.5 }),
    ], '2025-01-03');
    expect(bars.map(hasCorporateActionV1)).toEqual([false, true, true]);
  });
});
