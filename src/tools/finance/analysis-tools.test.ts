import { describe, expect, test } from 'bun:test';
import {
  analyzeFinancialMetrics,
  analyzeMarketCorrelation,
  analyzePeerComparison,
  analyzeStrategy,
  analyzeSupplyDemand,
  analyzeTechnical,
  type PeerCompany,
} from './index.js';
import {
  analyzeFinancialMetricsTool,
  analyzeMarketCorrelationTool,
  analyzePeerComparisonTool,
  analyzeStrategyTool,
  analyzeSupplyDemandTool,
  analyzeTechnicalTool,
  deterministicAnalysisTools,
} from './analysis-tools.js';

function toolData(value: unknown): unknown {
  expect(typeof value).toBe('string');
  return JSON.parse(value as string).data;
}

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });
}

describe('deterministic analysis tools', () => {
  test('have stable unique names', () => {
    const names = deterministicAnalysisTools.map((tool) => tool.name);
    expect(names).toEqual([
      'analyze_financial_metrics',
      'analyze_technical',
      'analyze_supply_demand',
      'analyze_peer_comparison',
      'analyze_market_correlation',
      'analyze_strategy',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test('delegates valuation and CAGR calculations to the Financial Metrics Engine', async () => {
    const financials = [
      {
        fiscalYear: 2021,
        submitDate: '2021-06-24',
        revenue: 100,
        eps: 10,
        bps: 50,
        dividendPerShare: 2,
      },
      {
        fiscalYear: 2026,
        submitDate: '2026-06-10',
        revenue: 200,
        eps: 20,
        bps: 80,
        dividendPerShare: 4,
      },
    ];
    const actual = toolData(await analyzeFinancialMetricsTool.invoke({
      currentPrice: 100,
      priceDataDate: '2026-08-21',
      financials,
    }));

    expect(actual).toEqual(analyzeFinancialMetrics(100, '2026-08-21', financials));
  });

  test('delegates OHLCV calculations to the Technical Engine', async () => {
    const bars = dates(20).map((date, index) => ({
      date,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1_000 + index,
    }));

    const actual = toolData(await analyzeTechnicalTool.invoke({ bars }));
    expect(actual).toEqual(analyzeTechnical(bars));
  });

  test('delegates margin and volume calculations to the Supply-Demand Engine', async () => {
    const marginHistory = dates(2).map((date, index) => ({
      date,
      longBalance: 100 + index * 20,
      shortBalance: 50 + index * 10,
    }));
    const volumeHistory = dates(20).map((date) => ({ date, volume: 10 }));

    const actual = toolData(await analyzeSupplyDemandTool.invoke({
      marginHistory,
      volumeHistory,
    }));
    expect(actual).toEqual(analyzeSupplyDemand(marginHistory, volumeHistory));
  });

  test('delegates sourced company cohorts to the Peer Comparison Engine', async () => {
    const target: PeerCompany = {
      id: 'target',
      name: 'Target',
      sector: '輸送用機器',
      marketCap: 1_000,
      metrics: { per: 10, roe: 12 },
    };
    const candidates: PeerCompany[] = [{
      id: 'peer',
      name: 'Peer',
      sector: '輸送用機器',
      marketCap: 900,
      metrics: { per: 12, roe: 10 },
    }];

    const actual = toolData(await analyzePeerComparisonTool.invoke({ target, candidates }));
    expect(actual).toEqual(analyzePeerComparison(target, candidates));
  });

  test('delegates aligned closes to the Market Correlation Engine', async () => {
    const stockPrices = dates(61).map((date, index) => ({ date, close: 100 + index }));
    const topixPrices = dates(61).map((date, index) => ({ date, close: 200 + index * 2 }));

    const actual = toolData(await analyzeMarketCorrelationTool.invoke({
      stockPrices,
      topixPrices,
    }));
    expect(actual).toEqual(analyzeMarketCorrelation(stockPrices, topixPrices));
  });

  test('delegates technical levels and sourced options to the Strategy Engine', async () => {
    const technical = {
      dataDate: '2026-08-20',
      latestSwingHigh: 4_200,
      latestSwingLow: 4_050,
      atr14: 100,
    };
    const options = { tickSize: 5, resistanceLevels: [4_600] };

    const actual = toolData(await analyzeStrategyTool.invoke({
      technical,
      ...options,
    }));
    expect(actual).toEqual(analyzeStrategy(technical, options));
  });

  test('fetches complete J-Quants histories in direct ticker mode', async () => {
    const priceDates = dates(251);
    const marginDates = Array.from({ length: 52 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 2 + index * 7));
      return date.toISOString().slice(0, 10);
    });
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      let data: Record<string, unknown>[];

      if (url.pathname.endsWith('/equities/bars/daily')) {
        data = priceDates.map((date, index) => ({
          Date: date,
          Code: '72030',
          AdjO: 100 + index,
          AdjH: 102 + index,
          AdjL: 99 + index,
          AdjC: 101 + index,
          AdjVo: 1_000 + index,
          Va: null,
        }));
      } else if (url.pathname.endsWith('/markets/margin-interest')) {
        data = marginDates.map((date, index) => ({
          Date: date,
          Code: '72030',
          ShrtVol: 100 + index,
          LongVol: 1_000 + index,
          ShrtNegVol: null,
          LongNegVol: null,
          ShrtStdVol: null,
          LongStdVol: null,
          IssType: '2',
        }));
      } else if (url.pathname.endsWith('/indices/bars/daily/topix')) {
        data = priceDates.map((date, index) => ({
          Date: date,
          O: 200 + index,
          H: 202 + index,
          L: 199 + index,
          C: 201 + index * 1.01,
        }));
      } else {
        throw new Error(`Unexpected test URL: ${url.pathname}`);
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const source = { ticker: '7203', from: '2025-01-01', to: '2026-12-31' };
      const technical = toolData(await analyzeTechnicalTool.invoke(source)) as {
        dataDate: string | null;
      };
      const supplyDemand = toolData(await analyzeSupplyDemandTool.invoke(source)) as {
        mean52w: number | null;
        unavailable: unknown[];
      };
      const correlation = toolData(await analyzeMarketCorrelationTool.invoke(source)) as {
        alignedPriceCount: number;
        windows: Array<{ period: number; observations: number; unavailable: unknown[] }>;
      };

      expect(technical.dataDate).toBe(priceDates[priceDates.length - 1]);
      expect(supplyDemand.mean52w).not.toBeNull();
      expect(supplyDemand.unavailable).toEqual([]);
      expect(correlation.alignedPriceCount).toBe(251);
      expect(correlation.windows.find((window) => window.period === 250)).toMatchObject({
        observations: 250,
        unavailable: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });
});
