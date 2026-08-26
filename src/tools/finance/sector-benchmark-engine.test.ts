import { describe, expect, test } from 'bun:test';
import {
  analyzeMarketCorrelation,
  MARKET_CORRELATION_DEFAULTS,
  type MarketPricePoint,
} from './market-correlation-engine.js';
import {
  analyzeSectorBenchmark,
  type SectorBenchmarkInput,
} from './sector-benchmark-engine.js';
import type {
  SectorIndexCode,
  SectorIndexPriceSourceRow,
  SectorIndexSourceResult,
} from './sector-index.js';

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

function sectorPrices(
  prices: readonly MarketPricePoint[],
  indexCode: SectorIndexCode = '0050',
): SectorIndexPriceSourceRow[] {
  return prices.map((point) => ({
    date: point.date,
    indexCode,
    open: null,
    high: null,
    low: null,
    close: point.close,
  }));
}

function sourceResult(
  prices: readonly SectorIndexPriceSourceRow[],
  analysisAsOfDate = prices.at(-1)?.date ?? isoDate(0),
): SectorIndexSourceResult {
  return {
    analysisAsOfDate,
    classification: {
      issuerCode: '72030',
      classificationDate: analysisAsOfDate,
      sectorCode: '3700',
      sectorName: '輸送用機器',
      indexCode: '0050',
    },
    prices: [...prices],
  };
}

describe('analyzeSectorBenchmark', () => {
  test('returns the fixed sector identity and exact 20/60/250 benchmark metrics', () => {
    const benchmarkReturns = patternedReturns(250);
    const stockReturns = benchmarkReturns.map((value) => 0.0001 + 1.5 * value);
    const stock = pricesFromReturns(stockReturns);
    const benchmark = pricesFromReturns(benchmarkReturns, 2_000);
    const result = analyzeSectorBenchmark(
      stock,
      sourceResult(sectorPrices(benchmark)),
    );

    expect(result.analysisAsOfDate).toBe(isoDate(250));
    expect(result.benchmark).toEqual({
      type: 'TSE33_SECTOR_PRICE_INDEX',
      sectorCode: '3700',
      sectorName: '輸送用機器',
      indexCode: '0050',
      classificationDate: isoDate(250),
    });
    expect(result.dataDate).toBe(isoDate(250));
    expect(result.alignedPriceCount).toBe(251);
    expect(result.windows.map((window) => window.period)).toEqual([20, 60, 250]);
    expect(result.unavailable).toEqual([]);

    for (const window of result.windows) {
      expect(window.observations).toBe(window.period);
      expect(window.correlation).toBeCloseTo(1, 12);
      expect(window.beta).toBeCloseTo(1.5, 12);
      expect(window.alphaAnnualized).toBeCloseTo(
        0.0001 * MARKET_CORRELATION_DEFAULTS.annualizationDays,
        12,
      );
      expect(window.rSquared).toBeCloseTo(1, 12);
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

    expect(result.provenance).toEqual({
      classification: { source: 'jquants', endpoint: '/v2/equities/master' },
      index: { source: 'jquants', endpoint: '/v2/indices/bars/daily' },
      calculation: { source: 'market_correlation_engine' },
    });
    expect(result.units).toEqual({
      indexLevel: 'index_points',
      observations: 'count',
      correlation: 'ratio',
      beta: 'ratio',
      alphaAnnualized: 'ratio',
      rSquared: 'ratio',
      stockVolatilityAnnualized: 'ratio',
      benchmarkVolatilityAnnualized: 'ratio',
      excessReturn: 'ratio',
    });
  });

  test('requires exactly period + 1 aligned closes for each fixed window', () => {
    for (const period of MARKET_CORRELATION_DEFAULTS.periods) {
      const insufficientReturns = patternedReturns(period - 1);
      const insufficient = analyzeSectorBenchmark(
        pricesFromReturns(insufficientReturns),
        sourceResult(sectorPrices(pricesFromReturns(insufficientReturns, 2_000))),
      ).windows.find((window) => window.period === period)!;
      expect(insufficient.observations).toBe(period - 1);
      expect(insufficient.correlation).toBeNull();
      expect(insufficient.unavailable).toContainEqual({
        metric: 'correlation',
        reason: 'insufficient_history',
      });

      const availableReturns = patternedReturns(period);
      const available = analyzeSectorBenchmark(
        pricesFromReturns(availableReturns),
        sourceResult(sectorPrices(pricesFromReturns(availableReturns, 2_000))),
      ).windows.find((window) => window.period === period)!;
      expect(available.observations).toBe(period);
      expect(available.correlation).toBeCloseTo(1, 12);
      expect(available.unavailable).toEqual([]);
    }
  });

  test('excludes future rows before validation and latest-window selection', () => {
    const benchmarkReturns = patternedReturns(60);
    const stock = pricesFromReturns(
      benchmarkReturns.map((value) => 0.0002 + 1.25 * value),
    );
    const benchmark = pricesFromReturns(benchmarkReturns, 2_000);
    const source = sourceResult(sectorPrices(benchmark));
    const baseline = analyzeSectorBenchmark(stock, source);
    const futureDate = isoDate(61);
    const futureInput: SectorIndexSourceResult = {
      ...source,
      prices: [
        ...source.prices,
        {
          date: futureDate,
          indexCode: '0040',
          open: null,
          high: null,
          low: null,
          close: Number.NaN,
        },
      ],
    };

    const actual = analyzeSectorBenchmark(
      [...stock, { date: futureDate, close: -1 }],
      futureInput,
    );

    expect(actual).toEqual(baseline);
  });

  test('inner joins first and neither fills missing dates nor accepts invalid closes', () => {
    const returns = patternedReturns(23);
    const stock = pricesFromReturns(returns);
    const benchmark = sectorPrices(pricesFromReturns(returns, 2_000))
      .filter((point) => point.date !== isoDate(1))
      .map((point) => point.date === isoDate(2) ? { ...point, close: null } : point);
    stock[3] = { ...stock[3], close: Number.NaN };

    const result = analyzeSectorBenchmark(stock, sourceResult(benchmark));
    const window20 = result.windows.find((window) => window.period === 20)!;

    expect(result.alignedPriceCount).toBe(21);
    expect(window20.startDate).toBe(isoDate(0));
    expect(window20.endDate).toBe(isoDate(23));
    expect(window20.observations).toBe(20);
    expect(window20.unavailable).toEqual([]);
  });

  test('preserves existing zero-benchmark-variance semantics', () => {
    const stockReturns = patternedReturns(60);
    const benchmarkReturns = Array.from({ length: 60 }, () => 0);
    const window = analyzeSectorBenchmark(
      pricesFromReturns(stockReturns),
      sourceResult(sectorPrices(pricesFromReturns(benchmarkReturns, 2_000))),
    ).windows.find((candidate) => candidate.period === 20)!;

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

  test('keeps all windows stable when older aligned history is prepended', () => {
    const benchmarkReturns = patternedReturns(250);
    const stockReturns = benchmarkReturns.map((value) => 0.0001 + 1.2 * value);
    const stock = pricesFromReturns(stockReturns);
    const benchmark = pricesFromReturns(benchmarkReturns, 2_000);
    const original = analyzeSectorBenchmark(
      stock,
      sourceResult(sectorPrices(benchmark)),
    );
    const olderStock: MarketPricePoint[] = [
      { date: '2024-12-30', close: 80 },
      { date: '2024-12-31', close: 90 },
    ];
    const olderBenchmark = sectorPrices([
      { date: '2024-12-30', close: 1_800 },
      { date: '2024-12-31', close: 1_900 },
    ]);
    const extended = analyzeSectorBenchmark(
      [...olderStock, ...stock],
      sourceResult([...olderBenchmark, ...sectorPrices(benchmark)]),
    );

    expect(extended.dataDate).toBe(original.dataDate);
    expect(extended.windows).toEqual(original.windows);
  });

  test('uses only the as-of sector index even when classification changed in lookback', () => {
    const asOfSectorReturns = patternedReturns(250);
    const priorSectorReturns = asOfSectorReturns.map((value) => -0.75 * value);
    const stockReturns = asOfSectorReturns.map((value) => 0.0001 + 1.4 * value);
    const stock = pricesFromReturns(stockReturns);
    const asOfSectorPrices = pricesFromReturns(asOfSectorReturns, 2_000);
    const hypotheticallyStitchedPrices = pricesFromReturns([
      ...priorSectorReturns.slice(0, 125),
      ...asOfSectorReturns.slice(125),
    ], 2_000);
    const input = sourceResult(sectorPrices(asOfSectorPrices));
    input.classification.classificationDate = isoDate(200);

    const result = analyzeSectorBenchmark(stock, input);
    const expectedSingleBenchmark = analyzeMarketCorrelation(stock, asOfSectorPrices);
    const forbiddenStitchedBenchmark = analyzeMarketCorrelation(
      stock,
      hypotheticallyStitchedPrices,
    );

    expect(result.benchmark?.classificationDate).toBe(isoDate(200));
    expect(result.windows).toEqual(expectedSingleBenchmark.windows);
    expect(result.windows).not.toEqual(forbiddenStitchedBenchmark.windows);
  });

  test('preserves each source-level unavailable reason without producing windows', () => {
    const reasons = [
      'sector_classification_unavailable',
      'unsupported_sector',
      'no_sector_index_data',
    ] as const;

    for (const reason of reasons) {
      const input: SectorBenchmarkInput = {
        analysisAsOfDate: '2026-08-26',
        reason,
      };
      expect(analyzeSectorBenchmark([], input)).toMatchObject({
        analysisAsOfDate: '2026-08-26',
        benchmark: null,
        dataDate: null,
        alignedPriceCount: 0,
        windows: [],
        unavailable: [{ reason }],
      });
    }
  });

  test('distinguishes empty eligible index history from zero', () => {
    const input = sourceResult([], '2026-08-26');
    const result = analyzeSectorBenchmark([], input);

    expect(result.benchmark?.indexCode).toBe('0050');
    expect(result.windows).toEqual([]);
    expect(result.unavailable).toEqual([{ reason: 'no_sector_index_data' }]);
  });

  test('returns invalid_data for conflicting identity or chronological data', () => {
    const prices = sectorPrices(pricesFromReturns(patternedReturns(20), 2_000));
    const conflicting = sourceResult(prices);
    conflicting.classification.indexCode = '0040';
    expect(analyzeSectorBenchmark([], conflicting).unavailable).toEqual([
      { reason: 'invalid_data' },
    ]);

    const outOfOrder = sourceResult([prices[1], prices[0], ...prices.slice(2)]);
    expect(analyzeSectorBenchmark([], outOfOrder).unavailable).toEqual([
      { reason: 'invalid_data' },
    ]);
  });

  test('does not mutate stock or sector-source inputs', () => {
    const returns = patternedReturns(250);
    const stock = pricesFromReturns(returns);
    const source = sourceResult(sectorPrices(pricesFromReturns(returns, 2_000)));
    const stockBefore = structuredClone(stock);
    const sourceBefore = structuredClone(source);

    analyzeSectorBenchmark(stock, source);

    expect(stock).toEqual(stockBefore);
    expect(source).toEqual(sourceBefore);
  });
});
