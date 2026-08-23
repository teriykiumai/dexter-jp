import { describe, expect, test } from 'bun:test';
import {
  analyzeFinancialMetrics,
  type FinancialMetricPoint,
} from './financial-metrics-engine.js';

function point(overrides: Partial<FinancialMetricPoint> = {}): FinancialMetricPoint {
  return {
    fiscalYear: 2026,
    submitDate: '2026-06-10 15:33',
    revenue: 50_684_952_000_000,
    eps: 295.25,
    bps: 3_062.82,
    dividendPerShare: 95,
    ...overrides,
  };
}

describe('analyzeFinancialMetrics', () => {
  test('calculates current valuation ratios and multi-year CAGR', () => {
    const result = analyzeFinancialMetrics(3_132, '2026-08-21', [
      point({ fiscalYear: 2021, submitDate: '2021-06-24', revenue: 27_214_594_000_000 }),
      point(),
    ]);

    expect(result.per).toBeCloseTo(10.6079593565, 10);
    expect(result.pbr).toBeCloseTo(1.022587, 6);
    expect(result.dividendYieldPercent).toBeCloseTo(3.0332056, 6);
    expect(result.revenueCagrPercent).toBeCloseTo(13.244061, 6);
    expect(result).toMatchObject({
      priceDataDate: '2026-08-21',
      financialDataDate: '2026-06-10 15:33',
      latestFiscalYear: 2026,
      cagrStartFiscalYear: 2021,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 5,
      unavailable: [],
    });
  });

  test('makes insufficient history and missing values explicit', () => {
    const result = analyzeFinancialMetrics(3_132, '2026-08-21', [point({
      eps: null,
      bps: null,
      dividendPerShare: null,
    })]);

    expect(result.per).toBeNull();
    expect(result.pbr).toBeNull();
    expect(result.dividendYieldPercent).toBeNull();
    expect(result.revenueCagrPercent).toBeNull();
    expect(result.unavailable).toContainEqual({ metric: 'per', reason: 'missing_or_invalid_eps' });
    expect(result.unavailable).toContainEqual({ metric: 'pbr', reason: 'missing_or_invalid_bps' });
    expect(result.unavailable).toContainEqual({
      metric: 'dividendYieldPercent',
      reason: 'missing_or_invalid_dividend',
    });
    expect(result.unavailable).toContainEqual({
      metric: 'revenueCagrPercent',
      reason: 'insufficient_financial_history',
    });
  });

  test('does not divide by zero or calculate CAGR from non-positive revenue', () => {
    const result = analyzeFinancialMetrics(3_132, '2026-08-21', [
      point({ fiscalYear: 2025, revenue: 0 }),
      point({ eps: 0, bps: 0, dividendPerShare: 0 }),
    ]);

    expect(result.per).toBeNull();
    expect(result.pbr).toBeNull();
    expect(result.dividendYieldPercent).toBe(0);
    expect(result.revenueCagrPercent).toBeNull();
    expect(result.unavailable).toContainEqual({ metric: 'per', reason: 'non_positive_eps' });
    expect(result.unavailable).toContainEqual({ metric: 'pbr', reason: 'non_positive_bps' });
    expect(result.unavailable).toContainEqual({
      metric: 'revenueCagrPercent',
      reason: 'non_positive_revenue',
    });
  });

  test('rejects duplicate or out-of-order fiscal years', () => {
    expect(() => analyzeFinancialMetrics(100, null, [
      point({ fiscalYear: 2026 }),
      point({ fiscalYear: 2025 }),
    ])).toThrow(RangeError);
    expect(() => analyzeFinancialMetrics(100, null, [
      point({ fiscalYear: 2026 }),
      point({ fiscalYear: 2026 }),
    ])).toThrow(RangeError);
  });
});
