import { describe, expect, test } from 'bun:test';
import {
  alignMarketPrices,
  analyzeMarketCorrelation,
  calculateAlignedLogReturns,
  MARKET_CORRELATION_DEFAULTS,
  type MarketPricePoint,
} from './market-correlation-engine.js';

function isoDate(index: number): string {
  const date = new Date(Date.UTC(2025, 0, 1 + index));
  return date.toISOString().slice(0, 10);
}

function pricesFromReturns(
  returns: readonly number[],
  initialPrice = 100,
): MarketPricePoint[] {
  const prices: MarketPricePoint[] = [{ date: isoDate(0), close: initialPrice }];
  let price = initialPrice;
  for (let index = 0; index < returns.length; index += 1) {
    price *= Math.exp(returns[index]);
    prices.push({ date: isoDate(index + 1), close: price });
  }
  return prices;
}

function patternedReturns(count: number): number[] {
  const pattern = [-0.012, -0.004, 0.003, 0.009, 0.015];
  return Array.from({ length: count }, (_, index) => pattern[index % pattern.length]);
}

describe('alignMarketPrices', () => {
  test('uses only common valid dates without forward filling', () => {
    const stock: MarketPricePoint[] = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 110 },
      { date: '2026-01-03', close: 121 },
      { date: '2026-01-04', close: 133.1 },
    ];
    const benchmark: MarketPricePoint[] = [
      { date: '2026-01-01', close: 200 },
      { date: '2026-01-03', close: 220 },
      { date: '2026-01-04', close: 242 },
    ];

    const aligned = alignMarketPrices(stock, benchmark);
    expect(aligned.map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-04',
    ]);

    const returns = calculateAlignedLogReturns(aligned);
    expect(returns).toHaveLength(2);
    expect(returns[0].stockReturn).toBeCloseTo(Math.log(121 / 100));
    expect(returns[0].benchmarkReturn).toBeCloseTo(Math.log(220 / 200));
  });

  test('excludes missing, zero, and negative closes instead of fabricating data', () => {
    const stock: MarketPricePoint[] = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: null },
      { date: '2026-01-03', close: 0 },
      { date: '2026-01-04', close: -1 },
      { date: '2026-01-05', close: 110 },
    ];
    const benchmark = stock.map((point) => ({ date: point.date, close: 200 }));

    expect(alignMarketPrices(stock, benchmark).map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-01-05',
    ]);
  });

  test('rejects duplicate or out-of-order dates', () => {
    const invalid: MarketPricePoint[] = [
      { date: '2026-01-02', close: 100 },
      { date: '2026-01-01', close: 101 },
    ];
    expect(() => alignMarketPrices(invalid, [])).toThrow(
      'Stock prices must be in strictly ascending date order',
    );
    expect(() => alignMarketPrices([], invalid)).toThrow(
      'Benchmark prices must be in strictly ascending date order',
    );
  });
});

describe('analyzeMarketCorrelation', () => {
  test('calculates perfectly correlated 60-day and 250-day statistics', () => {
    const benchmarkReturns = patternedReturns(250);
    const stockReturns = benchmarkReturns.map((value) => 0.0001 + 1.5 * value);
    const result = analyzeMarketCorrelation(
      pricesFromReturns(stockReturns),
      pricesFromReturns(benchmarkReturns, 2_000),
    );

    expect(result.benchmark).toBe('TOPIX');
    expect(result.alignedPriceCount).toBe(251);
    expect(result.dataDate).toBe(isoDate(250));
    expect(result.windows.map((window) => window.period)).toEqual([60, 250]);

    for (const window of result.windows) {
      expect(window.observations).toBe(window.period);
      expect(window.correlation).toBeCloseTo(1, 12);
      expect(window.beta).toBeCloseTo(1.5, 12);
      expect(window.alphaAnnualized).toBeCloseTo(
        0.0001 * MARKET_CORRELATION_DEFAULTS.annualizationDays,
        12,
      );
      expect(window.rSquared).toBeCloseTo(1, 12);
      expect(window.stockVolatilityAnnualized).toBeGreaterThan(0);
      expect(window.benchmarkVolatilityAnnualized).toBeGreaterThan(0);
      expect(window.stockVolatilityAnnualized).toBeCloseTo(
        (window.benchmarkVolatilityAnnualized ?? 0) * 1.5,
        12,
      );
      const expectedExcessReturn = stockReturns.slice(-window.period)
        .reduce((sum, value) => sum + value, 0)
        - benchmarkReturns.slice(-window.period).reduce((sum, value) => sum + value, 0);
      expect(window.excessReturn).toBeCloseTo(expectedExcessReturn, 12);
      expect(window.unavailable).toEqual([]);
    }
  });

  test('calculates a perfectly negative relationship', () => {
    const benchmarkReturns = patternedReturns(60);
    const stockReturns = benchmarkReturns.map((value) => 0.0002 - value);
    const window = analyzeMarketCorrelation(
      pricesFromReturns(stockReturns),
      pricesFromReturns(benchmarkReturns, 2_000),
    ).windows[0];

    expect(window.correlation).toBeCloseTo(-1, 12);
    expect(window.beta).toBeCloseTo(-1, 12);
    expect(window.alphaAnnualized).toBeCloseTo(
      0.0002 * MARKET_CORRELATION_DEFAULTS.annualizationDays,
      12,
    );
    expect(window.rSquared).toBeCloseTo(1, 12);
  });

  test('makes insufficient 60-day and 250-day history explicit', () => {
    const returns = patternedReturns(10);
    const result = analyzeMarketCorrelation(
      pricesFromReturns(returns),
      pricesFromReturns(returns, 2_000),
    );

    for (const window of result.windows) {
      expect(window.observations).toBe(10);
      expect(window.correlation).toBeNull();
      expect(window.beta).toBeNull();
      expect(window.alphaAnnualized).toBeNull();
      expect(window.rSquared).toBeNull();
      expect(window.unavailable).toContainEqual({
        metric: 'correlation',
        reason: 'insufficient_history',
      });
    }
  });

  test('calculates the 60-day window while leaving 250 days unavailable', () => {
    const returns = patternedReturns(60);
    const result = analyzeMarketCorrelation(
      pricesFromReturns(returns),
      pricesFromReturns(returns, 2_000),
    );

    expect(result.windows[0].observations).toBe(60);
    expect(result.windows[0].correlation).toBeCloseTo(1);
    expect(result.windows[0].unavailable).toEqual([]);
    expect(result.windows[1].correlation).toBeNull();
    expect(result.windows[1].unavailable).toContainEqual({
      metric: 'correlation',
      reason: 'insufficient_history',
    });
  });

  test('makes zero benchmark variance explicit without hiding available metrics', () => {
    const stockReturns = patternedReturns(60);
    const benchmarkReturns = Array.from({ length: 60 }, () => 0);
    const window = analyzeMarketCorrelation(
      pricesFromReturns(stockReturns),
      pricesFromReturns(benchmarkReturns, 2_000),
    ).windows[0];

    expect(window.correlation).toBeNull();
    expect(window.beta).toBeNull();
    expect(window.alphaAnnualized).toBeNull();
    expect(window.rSquared).toBeNull();
    expect(window.stockVolatilityAnnualized).toBeGreaterThan(0);
    expect(window.benchmarkVolatilityAnnualized).toBe(0);
    expect(window.excessReturn).toBeNumber();
    expect(window.unavailable).toContainEqual({
      metric: 'beta',
      reason: 'zero_benchmark_variance',
    });
  });

  test('returns beta zero when only stock variance is zero', () => {
    const stockReturns = Array.from({ length: 60 }, () => 0.001);
    const benchmarkReturns = patternedReturns(60);
    const window = analyzeMarketCorrelation(
      pricesFromReturns(stockReturns),
      pricesFromReturns(benchmarkReturns, 2_000),
    ).windows[0];

    expect(window.correlation).toBeNull();
    expect(window.beta).toBeCloseTo(0, 12);
    expect(window.alphaAnnualized).toBeCloseTo(
      0.001 * MARKET_CORRELATION_DEFAULTS.annualizationDays,
      12,
    );
    expect(window.rSquared).toBeNull();
    expect(window.stockVolatilityAnnualized).toBe(0);
    expect(window.unavailable).toContainEqual({
      metric: 'correlation',
      reason: 'zero_stock_variance',
    });
  });
});
