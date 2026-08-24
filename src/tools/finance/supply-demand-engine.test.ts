import { describe, expect, test } from 'bun:test';
import {
  analyzeSupplyDemand,
  calculateMean,
  calculatePercentileRank,
  type MarginHistoryPoint,
  type VolumeHistoryPoint,
} from './supply-demand-engine.js';

function isoDate(index: number, stepDays: number): string {
  const date = new Date(Date.UTC(2025, 0, 1 + index * stepDays));
  return date.toISOString().slice(0, 10);
}

function makeMarginHistory(
  count: number,
  longBalance: (index: number) => number | null = (index) => (index + 1) * 100,
  shortBalance: (index: number) => number | null = () => 1_000,
): MarginHistoryPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: isoDate(index, 7),
    longBalance: longBalance(index),
    shortBalance: shortBalance(index),
  }));
}

function makeVolumeHistory(
  count: number,
  volume: (index: number) => number | null = () => 1_000,
): VolumeHistoryPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: isoDate(index, 1),
    volume: volume(index),
  }));
}

describe('calculateMean', () => {
  test('calculates the latest-period arithmetic mean', () => {
    expect(calculateMean([1, 2, 3, 4], 3)).toBe(3);
  });

  test('returns null for insufficient or missing data', () => {
    expect(calculateMean([1, 2], 3)).toBeNull();
    expect(calculateMean([1, null, 3], 3)).toBeNull();
  });

  test('does not treat zero as missing', () => {
    expect(calculateMean([0, 0, 3], 3)).toBe(1);
  });

  test('rejects an invalid period', () => {
    expect(() => calculateMean([1], 0)).toThrow(RangeError);
  });
});

describe('calculatePercentileRank', () => {
  test('returns inclusive ranks from zero to one', () => {
    expect(calculatePercentileRank([10, 20, 30], 10)).toBe(0);
    expect(calculatePercentileRank([10, 20, 30], 20)).toBe(0.5);
    expect(calculatePercentileRank([10, 20, 30], 30)).toBe(1);
  });

  test('uses average rank for ties', () => {
    expect(calculatePercentileRank([10, 20, 20, 30], 20)).toBe(0.5);
  });

  test('returns null for missing data or an unobserved current value', () => {
    expect(calculatePercentileRank([10, null, 30], 30)).toBeNull();
    expect(calculatePercentileRank([10, 20, 30], 25)).toBeNull();
  });
});

describe('analyzeSupplyDemand', () => {
  test('makes empty histories explicitly unavailable', () => {
    const result = analyzeSupplyDemand([], []);

    expect(result.dataDate).toBeNull();
    expect(result.volumeDataDate).toBeNull();
    expect(result.buyingBalance).toBeNull();
    expect(result.sellingBalance).toBeNull();
    expect(result.marginRatio).toBeNull();
    expect(result.digestionDays).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'buyingBalance',
      reason: 'missing_data',
    });
    expect(result.unavailable).toContainEqual({
      metric: 'mean52w',
      reason: 'insufficient_history',
    });
  });

  test('calculates the complete 52-week MVP snapshot', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(52),
      makeVolumeHistory(20),
    );

    expect(result.dataDate).toBe(isoDate(51, 7));
    expect(result.volumeDataDate).toBe(isoDate(19, 1));
    expect(result.buyingBalance).toBe(5_200);
    expect(result.sellingBalance).toBe(1_000);
    expect(result.marginRatio).toBe(5.2);
    expect(result.buyingBalanceWeeklyChange).toBe(100);
    expect(result.sellingBalanceWeeklyChange).toBe(0);
    expect(result.mean4w).toBe(5_050);
    expect(result.mean13w).toBe(4_600);
    expect(result.mean52w).toBe(2_650);
    expect(result.deviation52w).toBeCloseTo((5_200 - 2_650) / 2_650);
    expect(result.percentile52w).toBe(1);
    expect(result.averageDailyVolume20).toBe(1_000);
    expect(result.digestionDays).toBe(5.2);
    expect(result.unavailable).toEqual([]);
  });

  test('does not use volume observations after the margin data date', () => {
    const volumes = makeVolumeHistory(20);
    volumes.push({ date: '2026-01-01', volume: 100_000 });

    const result = analyzeSupplyDemand(makeMarginHistory(52), volumes);
    expect(result.dataDate).toBe(isoDate(51, 7));
    expect(result.volumeDataDate).toBe(isoDate(19, 1));
    expect(result.averageDailyVolume20).toBe(1_000);
  });

  test('makes a zero selling balance explicit', () => {
    const margins = makeMarginHistory(52);
    margins[51] = { ...margins[51], shortBalance: 0 };

    const result = analyzeSupplyDemand(margins, makeVolumeHistory(20));
    expect(result.marginRatio).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'marginRatio',
      reason: 'zero_selling_balance',
    });
  });

  test('makes a zero average volume explicit', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(52),
      makeVolumeHistory(20, () => 0),
    );

    expect(result.averageDailyVolume20).toBe(0);
    expect(result.digestionDays).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'digestionDays',
      reason: 'zero_average_daily_volume',
    });
  });

  test('returns available 13-week metrics but not 52-week metrics', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(13, () => 1_000),
      makeVolumeHistory(20),
    );

    expect(result.mean4w).toBe(1_000);
    expect(result.mean13w).toBe(1_000);
    expect(result.mean52w).toBeNull();
    expect(result.deviation52w).toBeNull();
    expect(result.percentile52w).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'mean52w',
      reason: 'insufficient_history',
    });
  });

  test('does not skip missing balances inside statistic windows', () => {
    const margins = makeMarginHistory(52);
    margins[45] = { ...margins[45], longBalance: null };
    margins[51] = { ...margins[51], shortBalance: null };

    const result = analyzeSupplyDemand(margins, makeVolumeHistory(20));
    expect(result.mean13w).toBeNull();
    expect(result.mean52w).toBeNull();
    expect(result.percentile52w).toBeNull();
    expect(result.marginRatio).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'mean52w',
      reason: 'missing_data',
    });
    expect(result.unavailable).toContainEqual({
      metric: 'sellingBalance',
      reason: 'missing_data',
    });
  });

  test('requires four observations and calculates a hand-verifiable mean4w', () => {
    const unavailable = analyzeSupplyDemand(
      makeMarginHistory(3, index => [100, 200, 300][index]),
      makeVolumeHistory(20),
    );
    const available = analyzeSupplyDemand(
      makeMarginHistory(4, index => [100, 200, 300, 500][index]),
      makeVolumeHistory(20),
    );

    expect(unavailable.mean4w).toBeNull();
    expect(unavailable.unavailable).toContainEqual({
      metric: 'mean4w',
      reason: 'insufficient_history',
    });
    expect(available.mean4w).toBe(275);
  });

  test('uses only the latest four observations for mean4w', () => {
    const margins = makeMarginHistory(6, index => [null, -1, 100, 200, 300, 500][index]);

    const result = analyzeSupplyDemand(margins, makeVolumeHistory(20));

    expect(result.mean4w).toBe(275);
    expect(result.unavailable).not.toContainEqual(expect.objectContaining({ metric: 'mean4w' }));
  });

  test('does not skip missing or invalid observations inside the mean4w window', () => {
    for (const invalidValue of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const margins = makeMarginHistory(5, index => [1_000, 100, invalidValue, 300, 500][index]);

      const result = analyzeSupplyDemand(margins, makeVolumeHistory(20));

      expect(result.mean4w).toBeNull();
      expect(result.unavailable).toContainEqual({
        metric: 'mean4w',
        reason: 'missing_data',
      });
    }
  });

  test('does not mutate inputs while calculating mean4w or change existing means', () => {
    const margins = makeMarginHistory(52);
    const volumes = makeVolumeHistory(20);
    const marginsBefore = structuredClone(margins);
    const volumesBefore = structuredClone(volumes);

    const result = analyzeSupplyDemand(margins, volumes);

    expect(result.mean4w).toBe(5_050);
    expect(result.mean13w).toBe(4_600);
    expect(result.mean52w).toBe(2_650);
    expect(margins).toEqual(marginsBefore);
    expect(volumes).toEqual(volumesBefore);
  });

  test('handles a zero 52-week mean without division by zero', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(52, () => 0),
      makeVolumeHistory(20),
    );

    expect(result.mean52w).toBe(0);
    expect(result.deviation52w).toBeNull();
    expect(result.percentile52w).toBe(0.5);
    expect(result.digestionDays).toBe(0);
    expect(result.unavailable).toContainEqual({
      metric: 'deviation52w',
      reason: 'zero_mean_52w',
    });
  });

  test('reports insufficient volume history for digestion days', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(52),
      makeVolumeHistory(19),
    );

    expect(result.averageDailyVolume20).toBeNull();
    expect(result.digestionDays).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'digestionDays',
      reason: 'insufficient_history',
    });
  });

  test('reports insufficient margin history for weekly change', () => {
    const result = analyzeSupplyDemand(
      makeMarginHistory(1),
      makeVolumeHistory(20),
    );

    expect(result.buyingBalanceWeeklyChange).toBeNull();
    expect(result.sellingBalanceWeeklyChange).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'buyingBalanceWeeklyChange',
      reason: 'insufficient_history',
    });
  });

  test('treats negative balances and volume as missing data', () => {
    const margins = makeMarginHistory(52);
    margins[51] = { ...margins[51], longBalance: -1 };
    const volumes = makeVolumeHistory(20);
    volumes[19] = { ...volumes[19], volume: -1 };

    const result = analyzeSupplyDemand(margins, volumes);
    expect(result.buyingBalance).toBeNull();
    expect(result.averageDailyVolume20).toBeNull();
    expect(result.unavailable).toContainEqual({
      metric: 'buyingBalance',
      reason: 'missing_data',
    });
  });

  test('rejects histories that are not chronological', () => {
    const margins = makeMarginHistory(2);
    margins[1] = { ...margins[1], date: margins[0].date };
    expect(() => analyzeSupplyDemand(margins, makeVolumeHistory(20))).toThrow(
      'Margin history must be in strictly ascending date order',
    );

    const volumes = makeVolumeHistory(2);
    volumes[1] = { ...volumes[1], date: volumes[0].date };
    expect(() => analyzeSupplyDemand(makeMarginHistory(2), volumes)).toThrow(
      'Volume history must be in strictly ascending date order',
    );
  });
});
