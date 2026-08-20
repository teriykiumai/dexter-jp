import { describe, expect, test } from 'bun:test';
import {
  analyzeMarketCorrelation,
  analyzePeerComparison,
  analyzeStrategy,
  analyzeSupplyDemand,
  analyzeTechnical,
  type PeerCompany,
} from './index.js';
import {
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
      'analyze_technical',
      'analyze_supply_demand',
      'analyze_peer_comparison',
      'analyze_market_correlation',
      'analyze_strategy',
    ]);
    expect(new Set(names).size).toBe(names.length);
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
});
