import { describe, expect, test } from 'bun:test';
import type { ToolEndEvent, ToolStartEvent } from '../../agent/types.js';
import { analyzeAdvancedTechnical } from '../../tools/finance/advanced-technical-engine.js';
import { analyzeTechnicalTool } from '../../tools/finance/analysis-tools.js';
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

function peerResult(
  rank: number | null = null,
  targetMarketCap: number | null = null,
  peerMarketCap: number | null = null,
) {
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
    target: { id: '7203', name: 'トヨタ', sector: '輸送用機器', marketCap: targetMarketCap, metrics: {} },
    selection: {
      peers: [{ id: '7267', name: 'ホンダ', sector: '輸送用機器', marketCap: peerMarketCap, metrics: {} }],
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

function sectorBenchmarkResult() {
  return {
    analysisAsOfDate: '2026-08-20',
    benchmark: {
      type: 'TSE33_SECTOR_PRICE_INDEX' as const,
      sectorCode: '3700',
      sectorName: '輸送用機器',
      indexCode: '0050',
      classificationDate: '2026-08-20',
    },
    dataDate: '2026-08-20',
    alignedPriceCount: 251,
    windows: [],
    unavailable: [],
    provenance: {
      classification: { source: 'jquants' as const, endpoint: '/v2/equities/master' as const },
      index: { source: 'jquants' as const, endpoint: '/v2/indices/bars/daily' as const },
      calculation: { source: 'market_correlation_engine' as const },
    },
    units: {
      indexLevel: 'index_points' as const,
      observations: 'count' as const,
      correlation: 'ratio' as const,
      beta: 'ratio' as const,
      alphaAnnualized: 'ratio' as const,
      rSquared: 'ratio' as const,
      stockVolatilityAnnualized: 'ratio' as const,
      benchmarkVolatilityAnnualized: 'ratio' as const,
      excessReturn: 'ratio' as const,
    },
  };
}

function sectorShortRatioResult() {
  return {
    analysisAsOfDate: '2026-08-20',
    issuerCode: '72030',
    sector: {
      classificationDate: '2026-08-20',
      sectorCode: '3700',
      sectorName: '輸送用機器',
    },
    dataDate: '2026-08-20',
    observations: [{
      date: '2026-08-20',
      nonShortSellingValue: 100,
      restrictedShortSellingValue: 20,
      unrestrictedShortSellingValue: 30,
      shortSellingValue: 50,
      totalSellingValue: 150,
      shortSellingRatio: 1 / 3,
      unavailable: [],
    }],
    unavailable: [],
    provenance: {
      classification: { source: 'jquants' as const, endpoint: '/v2/equities/master' as const },
      flow: { source: 'jquants' as const, endpoint: '/v2/markets/short-ratio' as const },
      calculation: { source: 'sector_short_ratio_engine' as const },
    },
    units: {
      nonShortSellingValue: 'JPY' as const,
      restrictedShortSellingValue: 'JPY' as const,
      unrestrictedShortSellingValue: 'JPY' as const,
      shortSellingValue: 'JPY' as const,
      totalSellingValue: 'JPY' as const,
      shortSellingRatio: 'ratio' as const,
    },
  };
}

function advancedDividendResult(issuerCode = '72030') {
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-21T10:00:00.000Z',
    issuerCode,
    dataDate: '2026-08-20',
    observations: [{
      kind: 'company_forecast' as const,
      fiscalYearEndDate: '2027-03-31',
      disclosedDate: '2026-08-20',
      disclosedTime: '15:00:00',
      sourceEligibleDate: '2026-08-21',
      disclosureNumber: '20260820000001',
      sourceField: 'FDivAnn' as const,
      payoutRatioSourceField: 'FPayoutRatioAnn' as const,
      annualDividendPerShare: 100,
      payoutRatio: 0.35,
    }],
    events: null,
    unavailable: [{
      scope: 'event' as const,
      reason: 'event_source_plan_unavailable' as const,
    }],
    provenance: {
      financialSummary: { source: 'jquants' as const, endpoint: '/v2/fins/summary' as const },
      dividendEvents: null,
      availabilityCalendar: { source: 'jquants' as const, endpoint: '/v2/markets/calendar' as const },
      calculation: { source: 'advanced_dividend_engine' as const },
    },
    units: { dividendPerShare: 'JPY_per_share' as const, payoutRatio: 'ratio' as const },
  };
}

function volumeProfileResult(issuerCode = '72030') {
  const bins = Array.from({ length: 50 }, (_, index) => ({
    index,
    lowerPrice: 3_000 + index,
    upperPrice: 3_001 + index,
    representativePrice: 3_000.5 + index,
    allocatedVolume: 240,
    volumeShare: 0.02,
  }));
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-23T01:00:00.000Z',
    issuerCode,
    dataDate: '2026-08-21',
    windowStartDate: '2026-03-06',
    windowEndDate: '2026-08-21',
    inputBarCount: 120,
    priceBasis: 'jquants_corporate_action_adjusted' as const,
    volumeBasis: 'jquants_corporate_action_adjusted' as const,
    allocationMethod: 'uniform_range_overlap_v1' as const,
    binningMethod: {
      id: 'fixed_count_linear_v1' as const,
      requestedBinCount: 50 as const,
      effectiveBinCount: 50,
      minPrice: 3_000,
      maxPrice: 3_050,
    },
    bins,
    poc: { binIndex: 0, price: 3_000.5, allocatedVolume: 240, volumeShare: 0.02 },
    valueArea: {
      targetVolumeShare: 0.7 as const,
      achievedVolumeShare: 0.7,
      val: 3_000,
      vah: 3_035,
      firstBinIndex: 0,
      lastBinIndex: 34,
    },
    unavailable: [],
    methodology: {
      id: 'daily_ohlcv_volume_profile_proxy_v1' as const,
      approximation: 'uniform_daily_range' as const,
      actualHolderCostBasis: false as const,
    },
    provenance: {
      source: 'jquants' as const,
      endpoint: '/v2/equities/bars/daily' as const,
      availabilityCalendarEndpoint: '/v2/markets/calendar' as const,
      sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1' as const,
      adjustmentFactorField: 'AdjFactor' as const,
      exRightsField: 'ExRT' as const,
      basisAudit: 'collection_horizon_rights_audit_v1' as const,
      basisAuditRequiredThroughDate: '2026-08-22',
      basisAuditThroughDate: '2026-08-22',
      corporateActionBasisStatus: 'supported_common_basis_established' as const,
      calculation: 'volume_profile_engine' as const,
    },
    units: {
      price: 'JPY' as const,
      allocatedVolume: 'adjusted_shares' as const,
      volumeShare: 'ratio' as const,
    },
  };
}

describe('StandardAgentSnapshotCollector', () => {
  test('preserves deterministic Advanced Technical values from tool result to Snapshot', async () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    const bars = Array.from({ length: 251 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1_000 + index,
    }));
    const args = { ticker: '7203', bars };
    start(collector, 'analyze_technical', 'technical-engine', args);
    const result = await analyzeTechnicalTool.invoke(args);
    collector.recordToolEnd({
      type: 'tool_end',
      tool: 'analyze_technical',
      toolCallId: 'technical-engine',
      args: {},
      result: String(result),
      duration: 1,
    } as ToolEndEvent);

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.advancedTechnical).toEqual(analyzeAdvancedTechnical(bars));
  });

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

  test('retains incomplete candidate market-cap coverage without storing candidate args', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    start(collector, 'analyze_peer_comparison', 'peer-incomplete-cap', {
      target: { id: '7203', marketCap: 1_000 },
      candidates: [
        { id: '7267', marketCap: 900 },
        { id: '7270', marketCap: null },
      ],
    });
    end(
      collector,
      'analyze_peer_comparison',
      'peer-incomplete-cap',
      peerResult(null, 1_000, 900),
    );

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.peerComparison).toMatchObject({
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap',
    });
    expect(JSON.stringify(snapshot)).not.toContain('7270');
  });

  test('records J-Quants as the underlying source for direct ticker engine calls', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    start(collector, 'analyze_technical', 'technical-1', {
      ticker: '7203', from: '2025-08-01', to: '2026-08-20',
    });
    const advancedTechnical = {
      dataDate: '2026-08-20',
      rsi14: 63.25,
      macd: { value: 40, signal: 35, histogram: 5 },
      bollinger20: { middle: 3_000, upper: 3_200, lower: 2_800 },
      unavailable: [],
    };
    end(collector, 'analyze_technical', 'technical-1', {
      dataDate: '2026-08-20',
      ma20: 3_000,
      atr14: 80,
      averageVolume20: 10_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_900,
      unavailable: [],
      advancedTechnical,
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
      mean4w: 950,
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
      windows: [{
        period: 20,
        startDate: '2026-07-24',
        endDate: '2026-08-20',
        observations: 20,
        correlation: 0.6,
        beta: 1.1,
        alphaAnnualized: 0.02,
        rSquared: 0.36,
        stockVolatilityAnnualized: 0.25,
        benchmarkVolatilityAnnualized: 0.18,
        excessReturn: 0.03,
        unavailable: [],
      }],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');
    expect(snapshot?.advancedTechnical).toEqual(advancedTechnical);
    expect(snapshot?.supplyDemand?.mean4w).toBe(950);
    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.marketCorrelation?.windows).toEqual([{
      period: 20,
      startDate: '2026-07-24',
      endDate: '2026-08-20',
      observations: 20,
      correlation: 0.6,
      beta: 1.1,
      alphaAnnualized: 0.02,
      rSquared: 0.36,
      stockVolatilityAnnualized: 0.25,
      benchmarkVolatilityAnnualized: 0.18,
      excessReturn: 0.03,
      unavailable: [],
    }]);
    expect(snapshot?.dataDates.advancedTechnical).toBe('2026-08-20');
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

  test('collects only structured reported-position analysis into the current Snapshot', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_reported_short_positions', 'short-1', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
    });
    end(collector, 'analyze_reported_short_positions', 'short-1', {
      dataDate: '2026-08-20',
      reports: [{
        disclosedDate: '2026-08-20',
        calculatedDate: '2026-08-18',
        reporterName: 'Reporter Exact',
        discretionaryManagerName: null,
        fundName: 'Fund Exact',
        shortPositionRatio: 0.006,
        shortPositionShares: 120_000,
        previousCalculatedDate: '2026-08-11',
        previousReportedRatio: 0.005,
        ratioDelta: 0.001,
        address: 'must-not-survive',
      }],
      unavailable: [],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.status).toBe('partial');
    expect(snapshot?.reportedShortPositions?.reports[0]).toEqual({
      disclosedDate: '2026-08-20',
      calculatedDate: '2026-08-18',
      reporterName: 'Reporter Exact',
      discretionaryManagerName: null,
      fundName: 'Fund Exact',
      shortPositionRatio: 0.006,
      shortPositionShares: 120_000,
      previousCalculatedDate: '2026-08-11',
      previousReportedRatio: 0.005,
      ratioDelta: 0.001,
    });
    expect(snapshot?.dataDates.reportedShortPositions).toBe('2026-08-20');
    expect(snapshot?.provenance.reportedShortPositions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'reported_short_position_engine',
        role: 'calculation',
      }),
      expect.objectContaining({ source: 'jquants', role: 'short_position_data' }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
  });

  test('collects only the structured sector benchmark result into the current Snapshot', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_sector_benchmark', 'sector-1', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
      from: '2025-08-01',
    });
    end(collector, 'analyze_sector_benchmark', 'sector-1', {
      ...sectorBenchmarkResult(),
      rawSourceRows: 'must-not-survive',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.sectorBenchmark).toEqual(sectorBenchmarkResult());
    expect(snapshot?.dataDates.sectorBenchmark).toBe('2026-08-20');
    expect(snapshot?.units.sectorBenchmark.indexLevel).toBe('index_points');
    expect(snapshot?.provenance.sectorBenchmark).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'market_correlation_engine', role: 'calculation' }),
      expect.objectContaining({ source: 'jquants', role: 'benchmark_data' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
    expect(JSON.stringify(snapshot)).not.toContain('2025-08-01');
  });

  test('collects structured sector short-selling flow without issuer attribution or recalculation', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_sector_short_ratio', 'sector-short-1', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
      from: '2026-01-01',
    });
    end(collector, 'analyze_sector_short_ratio', 'sector-short-1', {
      ...sectorShortRatioResult(),
      sourceRows: 'must-not-survive',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.sectorShortRatio).toEqual(sectorShortRatioResult());
    expect(snapshot?.dataDates.sectorShortRatio).toBe('2026-08-20');
    expect(snapshot?.provenance.sectorShortRatio).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'sector_short_ratio_engine', role: 'calculation', endpoint: null,
      }),
      expect.objectContaining({
        source: 'jquants',
        role: 'sector_classification_data',
        endpoint: '/v2/equities/master',
      }),
      expect.objectContaining({
        source: 'jquants',
        role: 'sector_short_ratio_data',
        endpoint: '/v2/markets/short-ratio',
      }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
    expect(JSON.stringify(snapshot)).not.toContain('2026-01-01');
  });

  test('rejects sector flow for another issuer without claiming classification provenance', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_sector_short_ratio', 'sector-short-mismatch', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
      from: '2026-01-01',
    });
    end(collector, 'analyze_sector_short_ratio', 'sector-short-mismatch', {
      ...sectorShortRatioResult(),
      issuerCode: '67580',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.sectorShortRatio).toBeNull();
    expect(snapshot?.provenance.sectorShortRatio).toEqual([]);
    expect(snapshot?.unavailable).toContainEqual({
      section: 'sectorShortRatio',
      reason: 'locked_ticker_mismatch',
    });
  });

  test('preserves unavailable sector flow as unavailable rather than zero', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_sector_short_ratio', 'sector-short-empty', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
      from: '2026-01-01',
    });
    end(collector, 'analyze_sector_short_ratio', 'sector-short-empty', {
      ...sectorShortRatioResult(),
      dataDate: null,
      observations: [],
      unavailable: [{ reason: 'no_sector_short_ratio_data' }],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.sectorShortRatio?.observations).toEqual([]);
    expect(snapshot?.sectorShortRatio?.unavailable).toEqual([
      { reason: 'no_sector_short_ratio_data' },
    ]);
    expect(snapshot?.sectorShortRatio?.sector).toEqual(
      sectorShortRatioResult().sector,
    );
    expect(snapshot?.unavailable).toContainEqual({
      section: 'sectorShortRatio',
      reason: 'no_sector_short_ratio_data',
    });
  });

  test('preserves typed sector source absence instead of converting it to zero', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_sector_benchmark', 'sector-empty', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
      stockPrices: [],
      sectorSource: {
        analysisAsOfDate: '2026-08-20',
        reason: 'no_sector_index_data',
      },
    });
    end(collector, 'analyze_sector_benchmark', 'sector-empty', {
      ...sectorBenchmarkResult(),
      benchmark: null,
      dataDate: null,
      alignedPriceCount: 0,
      windows: [],
      unavailable: [{ reason: 'no_sector_index_data' }],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.sectorBenchmark?.alignedPriceCount).toBe(0);
    expect(snapshot?.sectorBenchmark?.unavailable).toEqual([
      { reason: 'no_sector_index_data' },
    ]);
    expect(snapshot?.unavailable).toContainEqual({
      section: 'sectorBenchmark',
      reason: 'no_sector_index_data',
    });
  });

  test('does not claim stock price provenance for a source-level unavailable sector result', () => {
    for (const withExistingPriceHistory of [false, true]) {
      const collector = new StandardAgentSnapshotCollector();
      invokeSkill(collector);
      lockToyota(collector);
      if (withExistingPriceHistory) {
        start(collector, 'get_stock_price', 'price-before-sector', {
          ticker: '7203',
          from: '2026-08-20',
        });
        end(collector, 'get_stock_price', 'price-before-sector', [{
          date: '2026-08-20',
          open: 3_000,
          high: 3_050,
          low: 2_990,
          close: 3_040,
          volume: 10_000,
        }]);
      }
      start(collector, 'analyze_sector_benchmark', 'sector-no-source', {
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        sectorSource: {
          analysisAsOfDate: '2026-08-20',
          reason: 'sector_classification_unavailable',
        },
      });
      end(collector, 'analyze_sector_benchmark', 'sector-no-source', {
        ...sectorBenchmarkResult(),
        benchmark: null,
        dataDate: null,
        alignedPriceCount: 0,
        windows: [],
        unavailable: [{ reason: 'sector_classification_unavailable' }],
      });

      const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

      expect(snapshot?.sectorBenchmark?.unavailable).toEqual([
        { reason: 'sector_classification_unavailable' },
      ]);
      expect(snapshot?.provenance.sectorBenchmark.some(item => (
        item.source === 'jquants' && item.role === 'price_data'
      ))).toBe(false);
      expect(snapshot?.priceHistory !== null).toBe(withExistingPriceHistory);
    }
  });

  test('preserves no-public-disclosure as unavailable rather than zero', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_reported_short_positions', 'short-empty', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-20',
    });
    end(collector, 'analyze_reported_short_positions', 'short-empty', {
      dataDate: null,
      reports: [],
      unavailable: [{ reason: 'no_public_disclosure_data' }],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.reportedShortPositions).toEqual({
      dataDate: null,
      reports: [],
      unavailable: [{ reason: 'no_public_disclosure_data' }],
    });
    expect(snapshot?.unavailable).toContainEqual({
      section: 'reportedShortPositions',
      reason: 'no_public_disclosure_data',
    });
  });

  test('collects only structured investor-type analysis with dates and provenance into the current Snapshot', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_investor_type_flows', 'investor-1', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-21',
    });
    const zeroValue = { sell: 0, buy: 0, total: 0, balance: 0 };
    const period = {
      publishedDate: '2026-08-20',
      periodStartDate: '2026-08-10',
      periodEndDate: '2026-08-14',
      section: 'TokyoNagoya' as const,
      summary: {
        proprietary: zeroValue,
        brokerage: zeroValue,
        total: zeroValue,
      },
      brokerageBreakdown: {
        individuals: zeroValue,
        foreignInvestors: zeroValue,
        securitiesCompanies: zeroValue,
        investmentTrusts: zeroValue,
        businessCorporations: zeroValue,
        otherCorporations: zeroValue,
        insuranceCompanies: zeroValue,
        banks: zeroValue,
        trustBanks: zeroValue,
        otherFinancialInstitutions: zeroValue,
      },
    };
    end(collector, 'analyze_investor_type_flows', 'investor-1', {
      dataDate: '2026-08-20',
      section: 'TokyoNagoya',
      period,
      unavailable: [],
      rawSourceRows: 'must-not-survive',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.investorTypeFlows).toEqual({
      dataDate: '2026-08-20',
      section: 'TokyoNagoya',
      period,
      unavailable: [],
    });
    expect(snapshot?.dataDates.investorTypeFlows).toBe('2026-08-20');
    expect(snapshot?.units.investorTypeFlows).toEqual({
      sell: 'thousand_JPY',
      buy: 'thousand_JPY',
      total: 'thousand_JPY',
      balance: 'thousand_JPY',
    });
    expect(snapshot?.provenance.investorTypeFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'investor_type_flow_engine',
        role: 'calculation',
        section: 'TokyoNagoya',
        endpoint: null,
      }),
      expect.objectContaining({
        source: 'jquants',
        role: 'investor_type_flow_data',
        section: 'TokyoNagoya',
        endpoint: '/v2/equities/investor-types',
      }),
      expect.objectContaining({
        source: 'jquants',
        role: 'market_calendar_data',
        section: null,
        endpoint: '/v2/markets/calendar',
      }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
  });

  test('preserves unavailable investor-type data instead of converting it to zero', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_investor_type_flows', 'investor-empty', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-21',
      sourcePeriods: [{ marker: 'source-arg-must-not-survive' }],
      officialCalendar: [],
    });
    end(collector, 'analyze_investor_type_flows', 'investor-empty', {
      dataDate: null,
      section: 'TokyoNagoya',
      period: null,
      unavailable: [{ reason: 'no_investor_type_flow_data' }],
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.investorTypeFlows).toEqual({
      dataDate: null,
      section: 'TokyoNagoya',
      period: null,
      unavailable: [{ reason: 'no_investor_type_flow_data' }],
    });
    expect(snapshot?.unavailable).toContainEqual({
      section: 'investorTypeFlows',
      reason: 'no_investor_type_flow_data',
    });
    expect(snapshot?.provenance.investorTypeFlows).toEqual([
      expect.objectContaining({ source: 'investor_type_flow_engine' }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('source-arg-must-not-survive');
  });

  test('collects only the structured advanced dividend result into Snapshot V9', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_advanced_dividend', 'dividend-1', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-21',
      summaryRows: [{ marker: 'source-arg-must-not-survive' }],
    });
    end(collector, 'analyze_advanced_dividend', 'dividend-1', {
      ...advancedDividendResult(),
      rawSourceRows: 'must-not-survive',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.advancedDividend).toEqual(advancedDividendResult());
    expect(snapshot?.dataDates.advancedDividend).toBe('2026-08-20');
    expect(snapshot?.units.advancedDividend).toEqual({
      dividendPerShare: 'JPY_per_share',
      payoutRatio: 'ratio',
    });
    expect(snapshot?.provenance.advancedDividend).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'advanced_dividend_engine', role: 'calculation' }),
      expect.objectContaining({
        source: 'jquants',
        role: 'dividend_financial_summary_data',
        endpoint: '/v2/fins/summary',
      }),
      expect.objectContaining({
        source: 'jquants', role: 'market_calendar_data', endpoint: '/v2/markets/calendar',
      }),
    ]));
    expect(snapshot?.provenance.advancedDividend).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'dividend_event_data' }),
    ]));
    expect(snapshot?.unavailable).toContainEqual({
      section: 'advancedDividend',
      metric: 'event',
      reason: 'event_source_plan_unavailable',
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
    expect(JSON.stringify(snapshot)).not.toContain('source-arg-must-not-survive');
  });

  test('rejects an advanced dividend result for another issuer', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_advanced_dividend', 'dividend-mismatch', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-21',
    });
    end(
      collector,
      'analyze_advanced_dividend',
      'dividend-mismatch',
      advancedDividendResult('67580'),
    );

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.advancedDividend).toBeNull();
    expect(snapshot?.provenance.advancedDividend).toEqual([]);
    expect(snapshot?.unavailable).toContainEqual({
      section: 'advancedDividend',
      reason: 'locked_ticker_mismatch',
    });
  });

  test('does not reconstruct advanced dividend values from final Markdown', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    const snapshot = collector.finalize(
      '# Report\nForecast annual dividend: 100 JPY / payout ratio: 35%',
      '2026-08-23T01:02:03.000Z',
    );

    expect(snapshot?.advancedDividend).toBeNull();
    expect(snapshot?.unavailable).toContainEqual({
      section: 'advancedDividend',
      reason: 'not_collected',
    });
  });

  test('collects only the structured volume-profile result into Snapshot V9', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_volume_profile', 'volume-profile-1', {
      analysisAsOfDate: '2026-08-21',
      source: { marker: 'source-envelope-must-not-survive' },
    });
    end(collector, 'analyze_volume_profile', 'volume-profile-1', {
      ...volumeProfileResult(),
      rawSourceRows: 'must-not-survive',
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.schemaVersion).toBe(9);
    expect(snapshot?.volumeProfile).toEqual(volumeProfileResult());
    expect(snapshot?.dataDates.volumeProfile).toBe('2026-08-21');
    expect(snapshot?.units.volumeProfile).toEqual({
      price: 'JPY',
      allocatedVolume: 'adjusted_shares',
      volumeShare: 'ratio',
    });
    expect(snapshot?.provenance.volumeProfile).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'volume_profile_engine', role: 'calculation', endpoint: null,
      }),
      expect.objectContaining({
        source: 'jquants', role: 'price_data', endpoint: '/v2/equities/bars/daily',
      }),
      expect.objectContaining({
        source: 'jquants', role: 'market_calendar_data', endpoint: '/v2/markets/calendar',
      }),
    ]));
    expect(snapshot?.volumeProfile?.provenance).toMatchObject({
      basisAuditRequiredThroughDate: '2026-08-22',
      basisAuditThroughDate: '2026-08-22',
      corporateActionBasisStatus: 'supported_common_basis_established',
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
    expect(JSON.stringify(snapshot)).not.toContain('source-envelope-must-not-survive');
  });

  test('preserves typed unavailable volume profile instead of converting it to zero', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_volume_profile', 'volume-profile-empty', {
      ticker: '7203',
      analysisAsOfDate: '2026-08-21',
    });
    end(collector, 'analyze_volume_profile', 'volume-profile-empty', {
      ...volumeProfileResult(),
      dataDate: null,
      windowStartDate: null,
      windowEndDate: null,
      inputBarCount: 0,
      priceBasis: null,
      volumeBasis: null,
      binningMethod: {
        ...volumeProfileResult().binningMethod,
        effectiveBinCount: 0,
        minPrice: null,
        maxPrice: null,
      },
      bins: null,
      poc: null,
      valueArea: null,
      unavailable: [{ scope: 'profile', reason: 'no_price_data' }],
      provenance: {
        ...volumeProfileResult().provenance,
        basisAuditRequiredThroughDate: null,
        basisAuditThroughDate: null,
        corporateActionBasisStatus: 'not_evaluated',
      },
    });

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.volumeProfile?.bins).toBeNull();
    expect(snapshot?.volumeProfile?.poc).toBeNull();
    expect(snapshot?.volumeProfile?.valueArea).toBeNull();
    expect(snapshot?.unavailable).toContainEqual({
      section: 'volumeProfile',
      metric: 'profile',
      reason: 'no_price_data',
    });
  });

  test('rejects a volume-profile result for another issuer', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_volume_profile', 'volume-profile-mismatch', {
      analysisAsOfDate: '2026-08-21',
      source: {},
    });
    end(
      collector,
      'analyze_volume_profile',
      'volume-profile-mismatch',
      volumeProfileResult('67580'),
    );

    const snapshot = collector.finalize('# Report', '2026-08-23T01:02:03.000Z');

    expect(snapshot?.volumeProfile).toBeNull();
    expect(snapshot?.provenance.volumeProfile).toEqual([]);
    expect(snapshot?.unavailable).toContainEqual({
      section: 'volumeProfile',
      reason: 'locked_ticker_mismatch',
    });
  });

  test('does not reconstruct volume-profile values from final Markdown', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);

    const snapshot = collector.finalize(
      '# Report\nPOC: 3000 / VAL: 2900 / VAH: 3100',
      '2026-08-23T01:02:03.000Z',
    );

    expect(snapshot?.volumeProfile).toBeNull();
    expect(snapshot?.unavailable).toContainEqual({
      section: 'volumeProfile',
      reason: 'not_collected',
    });
  });

  test('does not reconstruct an absent Advanced Technical companion from Markdown', () => {
    const collector = new StandardAgentSnapshotCollector();
    invokeSkill(collector);
    lockToyota(collector);
    start(collector, 'analyze_technical', 'technical-legacy', {
      ticker: '7203', from: '2025-08-01', to: '2026-08-20',
    });
    end(collector, 'analyze_technical', 'technical-legacy', {
      dataDate: '2026-08-20',
      ma20: 3_000,
      atr14: 80,
      averageVolume20: 10_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_900,
      unavailable: [],
    });

    const snapshot = collector.finalize(
      '# Report\nRSI14: 99 / MACD: 123',
      '2026-08-23T01:02:03.000Z',
    );

    expect(snapshot?.advancedTechnical).toBeNull();
    expect(snapshot?.unavailable).toContainEqual({
      section: 'advancedTechnical',
      reason: 'not_collected',
    });
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
