import { describe, expect, test } from 'bun:test';
import {
  analyzeStrategy,
  nextTickAbove,
  type StrategyTechnicalInput,
} from './strategy-engine.js';

function technical(
  overrides: Partial<StrategyTechnicalInput> = {},
): StrategyTechnicalInput {
  return {
    dataDate: '2026-08-20',
    latestSwingHigh: 4_200,
    latestSwingLow: 4_050,
    atr14: 100,
    ...overrides,
  };
}

describe('nextTickAbove', () => {
  test('returns one tick above an aligned breakout level', () => {
    expect(nextTickAbove(4_200, 5)).toBe(4_205);
  });

  test('returns the first tick above a non-aligned level', () => {
    expect(nextTickAbove(100.1, 1)).toBe(101);
    expect(nextTickAbove(0.3, 0.1)).toBe(0.4);
  });

  test('rejects invalid price or tick inputs', () => {
    expect(() => nextTickAbove(0, 1)).toThrow(RangeError);
    expect(() => nextTickAbove(100, 0)).toThrow(RangeError);
    expect(() => analyzeStrategy(technical(), { tickSize: -1 })).toThrow(RangeError);
  });
});

describe('analyzeStrategy', () => {
  test('builds normal swing and ATR long setups with exact 2R targets', () => {
    const result = analyzeStrategy(technical(), { tickSize: 5 });

    expect(result.dataDate).toBe('2026-08-20');
    expect(result.entry).toEqual({
      price: 4_205,
      reason: 'breakout_above_swing_high',
      trigger: 'strictly_above',
      tickSizeApplied: 5,
    });
    if (!result.entry) {
      throw new Error('Expected a valid breakout entry');
    }
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual({
      entry: result.entry,
      stop: { price: 4_050, reason: 'latest_swing_low' },
      target: { price: 4_515, reason: 'risk_reward_2R' },
      risk: 155,
      reward: 310,
      rewardRisk: 2,
    });
    expect(result.candidates[1]).toEqual({
      entry: result.entry,
      stop: { price: 4_055, reason: 'entry_minus_1_5_atr' },
      target: { price: 4_505, reason: 'risk_reward_2R' },
      risk: 150,
      reward: 300,
      rewardRisk: 2,
    });
    expect(result.unavailable).toEqual([]);
  });

  test('uses the swing high as an unrounded strictly-above trigger without tick data', () => {
    const result = analyzeStrategy(technical());
    expect(result.entry).toMatchObject({
      price: 4_200,
      trigger: 'strictly_above',
      tickSizeApplied: null,
    });
  });

  test('rejects a swing stop above entry but keeps a valid ATR setup', () => {
    const result = analyzeStrategy(technical({ latestSwingLow: 4_300 }));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].stop.reason).toBe('entry_minus_1_5_atr');
    expect(result.unavailable).toContainEqual({
      candidate: 'swing_stop',
      reason: 'stop_not_below_entry',
      price: 4_300,
    });
  });

  test('makes zero risk explicit and omits the invalid candidate', () => {
    const result = analyzeStrategy(technical({ latestSwingLow: 4_200 }));

    expect(result.candidates).toHaveLength(1);
    expect(result.unavailable).toContainEqual({
      candidate: 'swing_stop',
      reason: 'zero_risk',
      price: 4_200,
    });
  });

  test('makes unavailable or invalid ATR explicit without losing the swing setup', () => {
    for (const atr14 of [null, 0, -1, Number.NaN]) {
      const result = analyzeStrategy(technical({ atr14 }));
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].stop.reason).toBe('latest_swing_low');
      expect(result.unavailable).toContainEqual({
        candidate: 'atr_stop',
        reason: 'missing_or_invalid_atr',
      });
    }
  });

  test('rejects a non-positive ATR stop', () => {
    const result = analyzeStrategy(technical({
      latestSwingHigh: 100,
      latestSwingLow: 90,
      atr14: 100,
    }));

    expect(result.candidates).toHaveLength(1);
    expect(result.unavailable).toContainEqual({
      candidate: 'atr_stop',
      reason: 'non_positive_stop',
      price: -50,
    });
  });

  test('returns no setup when the entry source is missing', () => {
    const result = analyzeStrategy(technical({ latestSwingHigh: null }));

    expect(result.entry).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.unavailable).toContainEqual({
      candidate: 'entry',
      reason: 'missing_or_invalid_swing_high',
    });
    expect(result.unavailable).toContainEqual({
      candidate: 'swing_stop',
      reason: 'missing_entry',
    });
  });

  test('adds only sourced resistance targets above entry', () => {
    const result = analyzeStrategy(technical(), {
      resistanceLevels: [4_500, 4_400, 4_500, 4_100, null],
    });

    expect(result.candidates).toHaveLength(6);
    const resistanceCandidates = result.candidates.filter((candidate) => (
      candidate.target.reason === 'resistance_level'
    ));
    expect(resistanceCandidates.map((candidate) => candidate.target.price)).toEqual([
      4_400, 4_500, 4_400, 4_500,
    ]);
    expect(resistanceCandidates[0]).toMatchObject({
      risk: 150,
      reward: 200,
      rewardRisk: 4 / 3,
    });
    expect(result.unavailable).toContainEqual({
      candidate: 'resistance_target',
      reason: 'target_not_above_entry',
      price: 4_100,
    });
    expect(result.unavailable).toContainEqual({
      candidate: 'resistance_target',
      reason: 'missing_or_invalid_resistance',
    });
  });
});
