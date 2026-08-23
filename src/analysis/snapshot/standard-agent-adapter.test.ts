import { describe, expect, test } from 'bun:test';
import type { ToolEndEvent, ToolStartEvent } from '../../agent/types.js';
import { StandardAgentSnapshotCollector } from './standard-agent-adapter.js';

function start(
  collector: StandardAgentSnapshotCollector,
  tool: string,
  toolCallId: string,
  args: Record<string, unknown>,
): void {
  collector.recordToolStart({ type: 'tool_start', tool, toolCallId, args } as ToolStartEvent);
}

function end(
  collector: StandardAgentSnapshotCollector,
  tool: string,
  toolCallId: string,
  data: unknown,
  args: Record<string, unknown> = {},
): void {
  collector.recordToolEnd({
    type: 'tool_end',
    tool,
    toolCallId,
    args,
    result: JSON.stringify({ data, sourceUrls: [`https://example.test/${tool}`] }),
    duration: 1,
  } as ToolEndEvent);
}

function invokeSkill(collector: StandardAgentSnapshotCollector): void {
  start(collector, 'skill', 'skill-1', { skill: 'comprehensive-analysis', args: '7203' });
  collector.recordToolEnd({
    type: 'tool_end',
    tool: 'skill',
    toolCallId: 'skill-1',
    args: {},
    result: '## Skill: comprehensive-analysis',
    duration: 1,
  });
}

function financialResult(ticker = '72030') {
  return {
    [`get_company_info_${ticker}`]: {
      sec_code: ticker,
      name_ja: ticker === '72030' ? 'トヨタ自動車株式会社' : '別会社',
      industry: '輸送用機器',
      listing_status: 'listed',
      is_delisted: false,
      listing_status_as_of: '2026-08-21',
    },
    [`get_financial_statements_${ticker}`]: [{
      fiscal_year: 2026,
      submit_date: '2026-06-10',
      revenue: 48_000,
      operating_income: 4_000,
      ordinary_income: 4_500,
      net_income: 3_000,
      adjusted_eps: 200,
      roe_official: 0.12,
      equity_ratio_official: 0.4,
      cf_operating: 5_000,
      free_cash_flow: 2_000,
    }],
  };
}

function lockToyota(collector: StandardAgentSnapshotCollector): void {
  start(collector, 'get_financials', 'financials-1', { query: '7203の会社情報と6年財務' });
  end(collector, 'get_financials', 'financials-1', financialResult());
}

function peerResult(rank: number | null = null) {
  const position = (metric: string) => ({
    metric,
    direction: metric === 'per' || metric === 'pbr' ? 'lower_is_better' : 'higher_is_better',
    targetValue: null,
    median: null,
    rank,
    percentile: null,
    peerSampleSize: 0,
    cohortSize: 1,
  });
  return {
    target: { id: '7203', name: 'トヨタ', sector: '輸送用機器', marketCap: null, metrics: {} },
    selection: {
      peers: [{ id: '7267', name: 'ホンダ', sector: '輸送用機器', marketCap: null, metrics: {} }],
      sameSectorCandidateCount: 1,
      marketCapPrioritizedPeerCount: 0,
      sectorLeaderId: null,
      sectorLeaderIncluded: false,
      tooFewPeers: true,
    },
    targetIncludedInStatistics: true,
    positions: {
      per: position('per'),
      pbr: position('pbr'),
      roe: position('roe'),
      roic: position('roic'),
      operatingMargin: position('operatingMargin'),
      revenueGrowth: position('revenueGrowth'),
      dividendYield: position('dividendYield'),
    },
    unavailable: [],
  };
}

describe('StandardAgentSnapshotCollector', () => {
  test('pairs start args and end results by toolCallId before collecting', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    start(collector, 'get_stock_price', 'price-1', { ticker: '7203', from: '2026-08-20' });
    end(collector, 'get_stock_price', 'price-1', [
      { date: '2026-08-20', open: 3_000, high: 3_050, low: 2_990, close: 3_040, volume: 10_000 },
    ], { ticker: '9999' });
    start(collector, 'analyze_financial_metrics', 'valuation-1', { ticker: '7203' });
    end(collector, 'analyze_financial_metrics', 'valuation-1', {
      priceDataDate: '2026-08-20',
      financialDataDate: '2026-06-10',
      latestFiscalYear: 2026,
      currentPrice: 3_040,
      per: 15.2,
      pbr: 1.3,
      dividendYieldPercent: 2.5,
      revenueCagrPercent: 5,
      cagrStartFiscalYear: 2021,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 5,
      unavailable: [],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.canonicalTicker).toBe('7203');
    expect(snapshot?.priceHistory?.[0].close).toBe(3_040);
    expect(snapshot?.status).toBe('partial');
    expect(snapshot?.provenance.valuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'financial_metrics_engine', role: 'calculation' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
      expect.objectContaining({ source: 'edinet_db', role: 'financial_data' }),
    ]));
  });

  test('rejects an unpaired result and a target result for a different ticker', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    end(collector, 'get_stock_price', 'missing-start', []);
    start(collector, 'get_stock_price', 'price-2', { ticker: '6758' });
    end(collector, 'get_stock_price', 'price-2', [
      { date: '2026-08-20', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.priceHistory).toBeNull();
    expect(collector.rejections.map(item => item.reason)).toContain('unpaired_tool_end');
    expect(collector.rejections.map(item => item.reason)).toContain('locked_ticker_mismatch');
  });

  test('allows different peer candidate tickers while requiring the locked ticker as peer target', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    start(collector, 'company_screener', 'screener-1', { query: '輸送用機器のpeer cohort' });
    end(collector, 'company_screener', 'screener-1', {
      companies: [{ sec_code: '72670' }, { sec_code: '72030' }],
    });
    start(collector, 'analyze_peer_comparison', 'peer-1', {
      target: { id: '7203' },
      candidates: [{ id: '7267' }],
    });
    end(collector, 'analyze_peer_comparison', 'peer-1', peerResult(2.5));

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.peerComparison?.result.selection.peers[0]?.id).toBe('7267');
    expect(snapshot?.peerComparison?.result.positions.per.rank).toBe(2.5);
    expect(snapshot?.provenance.peerComparison).toContainEqual({
      source: 'edinet_db',
      role: 'financial_data',
      asOfDate: null,
      sourceUrls: ['https://example.test/company_screener'],
    });
    expect(collector.rejections).toHaveLength(0);
  });

  test('records J-Quants as the underlying source for direct ticker engine calls', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    start(collector, 'analyze_technical', 'technical-1', {
      ticker: '7203', from: '2025-08-01', to: '2026-08-20',
    });
    end(collector, 'analyze_technical', 'technical-1', {
      dataDate: '2026-08-20',
      ma20: 3_000,
      atr14: 80,
      averageVolume20: 10_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_900,
      unavailable: [],
    });
    start(collector, 'analyze_supply_demand', 'supply-1', {
      ticker: '7203', from: '2025-08-01', to: '2026-08-20',
    });
    end(collector, 'analyze_supply_demand', 'supply-1', {
      dataDate: '2026-08-18',
      volumeDataDate: '2026-08-20',
      buyingBalance: 1_000,
      sellingBalance: 500,
      marginRatio: 2,
      buyingBalanceWeeklyChange: 10,
      sellingBalanceWeeklyChange: -10,
      mean13w: 900,
      mean52w: 800,
      deviation52w: 0.25,
      percentile52w: 0.8,
      averageDailyVolume20: 10_000,
      digestionDays: 0.1,
      unavailable: [],
    });
    start(collector, 'analyze_market_correlation', 'correlation-1', {
      ticker: '7203', from: '2025-08-01', to: '2026-08-20',
    });
    end(collector, 'analyze_market_correlation', 'correlation-1', {
      benchmark: 'TOPIX',
      dataDate: '2026-08-20',
      alignedPriceCount: 251,
      windows: [],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');
    expect(snapshot?.provenance.technical).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'technical_engine', role: 'calculation' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
    ]));
    expect(snapshot?.provenance.supplyDemand).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'jquants', role: 'margin_data' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
    ]));
    expect(snapshot?.provenance.marketCorrelation).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
      expect.objectContaining({ source: 'jquants', role: 'benchmark_data' }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('2025-08-01');
  });

  test('rejects a peer result whose target differs from its paired locked-target args', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    const mismatchedResult = peerResult();
    mismatchedResult.target.id = '6758';

    start(collector, 'analyze_peer_comparison', 'peer-2', {
      target: { id: '7203' },
      candidates: [{ id: '7267' }],
    });
    end(collector, 'analyze_peer_comparison', 'peer-2', mismatchedResult);

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');
    expect(snapshot?.peerComparison).toBeNull();
    expect(collector.rejections.map(item => item.reason)).toContain('locked_ticker_mismatch');
  });

  test('does not replace the run ticker after identity has been locked', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'get_financials', 'financials-2', { query: '6758の会社情報' });
    end(collector, 'get_financials', 'financials-2', financialResult('67580'));

    expect(collector.canonicalTicker).toBe('7203');
    expect(collector.rejections.map(item => item.reason)).toContain('locked_ticker_mismatch');
  });
});
