import { describe, expect, test } from 'bun:test';
import {
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  AnalysisSnapshotV4Schema,
  AnalysisSnapshotV5Schema,
  AnalysisSnapshotV6Schema,
  AnalysisSnapshotV7Schema,
  AnalysisSnapshotV8Schema,
  buildAnalysisSnapshot,
  buildAnalysisSnapshotLatestItem,
  type AnalysisSnapshot,
  type AnalysisSnapshotV2,
  type AnalysisSnapshotV3,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotV5,
  type AnalysisSnapshotV6,
  type AnalysisSnapshotV7,
  type AnalysisSnapshotV8,
  type AnalysisSnapshotV9,
  type AnalysisSnapshotInput,
} from '../../analysis/snapshot/index.js';
import {
  ADVANCED_DIVIDEND_CONTEXT_NOTE,
  DASHBOARD_SECTION_DESTINATIONS,
  DASHBOARD_TABS,
  DEFAULT_DASHBOARD_TAB,
  UNAVAILABLE_TEXT,
  INVESTOR_TYPE_FLOW_CONTEXT_NOTE,
  REPORTED_SHORT_POSITION_DISCLOSURE_NOTE,
  SECTOR_BENCHMARK_CONTEXT_NOTE,
  SECTOR_SHORT_RATIO_CONTEXT_NOTE,
  VOLUME_PROFILE_CONTEXT_NOTE,
  WATCHLIST_STALE_AFTER_DAYS,
  buildDashboardAvailabilityNavigation,
  buildDashboardTabPath,
  buildDetailPath,
  buildWatchlistPath,
  displayText,
  formatMetric,
  hasCanonicalDetailTab,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  moveDashboardTab,
  parseDetailTab,
  parseDetailTicker,
  sortWatchlistItems,
} from './presentation.js';

function snapshotInput(
  volumeProfile: AnalysisSnapshotInput['volumeProfile'] = null,
): AnalysisSnapshotInput {
  return {
    identity: {
      canonicalTicker: '7203',
      companyName: 'トヨタ自動車株式会社',
      industry: '輸送用機器',
      listingStatus: 'listed',
      isDelisted: false,
      dataDate: '2026-08-21',
      sourceUrls: ['https://example.test/company'],
    },
    generatedAt: '2026-08-23T01:02:03.000Z',
    fundamental: null,
    valuation: null,
    peerComparison: null,
    peerCandidateMarketCapsComplete: null,
    technical: null,
    advancedTechnical: null,
    supplyDemand: null,
    reportedShortPositions: null,
    investorTypeFlows: null,
    marketCorrelation: null,
    sectorBenchmark: null,
    sectorShortRatio: null,
    advancedDividend: null,
    volumeProfile,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis\n\nSafe text.',
    priceSourceUrls: [],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: [],
    investorTypeFlowSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
      reportedShortPositions: { sourceFromJQuants: false },
      investorTypeFlows: { sourceFromJQuants: false, calendarFromJQuants: false },
      sectorBenchmark: { stockFromJQuants: false },
    },
    additionalUnavailable: [],
  };
}

function v9Snapshot(
  volumeProfile: AnalysisSnapshotInput['volumeProfile'] = null,
): AnalysisSnapshotV9 {
  return buildAnalysisSnapshot(snapshotInput(volumeProfile));
}

function v8Snapshot(): AnalysisSnapshotV8 {
  const v9 = v9Snapshot();
  const {
    volumeProfile: _volumeProfile,
    dataDates: v9DataDates,
    provenance: v9Provenance,
    units: v9Units,
    unavailable: v9Unavailable,
    ...common
  } = v9;
  const { volumeProfile: _volumeProfileDate, ...dataDates } = v9DataDates;
  const { volumeProfile: _volumeProfileProvenance, ...provenance } = v9Provenance;
  const { volumeProfile: _volumeProfileUnits, ...units } = v9Units;
  return AnalysisSnapshotV8Schema.parse({
    ...common,
    schemaVersion: 8,
    dataDates,
    provenance,
    units,
    unavailable: v9Unavailable.filter(item => item.section !== 'volumeProfile'),
  });
}

function v7Snapshot(): AnalysisSnapshotV7 {
  const v8 = v8Snapshot();
  const {
    advancedDividend: _advancedDividend,
    dataDates: v8DataDates,
    provenance: v8Provenance,
    units: v8Units,
    unavailable: v8Unavailable,
    ...common
  } = v8;
  const { advancedDividend: _advancedDividendDate, ...dataDates } = v8DataDates;
  const { advancedDividend: _advancedDividendProvenance, ...provenance } = v8Provenance;
  const { advancedDividend: _advancedDividendUnits, ...units } = v8Units;
  return AnalysisSnapshotV7Schema.parse({
    ...common,
    schemaVersion: 7,
    dataDates,
    provenance,
    units,
    unavailable: v8Unavailable.filter(item => item.section !== 'advancedDividend'),
  });
}

function v6Snapshot(): AnalysisSnapshotV6 {
  const v7 = v7Snapshot();
  const {
    sectorShortRatio: _sectorShortRatio,
    dataDates: v7DataDates,
    provenance: v7Provenance,
    units: v7Units,
    unavailable: v7Unavailable,
    ...common
  } = v7;
  const { sectorShortRatio: _sectorShortRatioDate, ...dataDates } = v7DataDates;
  const { sectorShortRatio: _sectorShortRatioProvenance, ...provenance } = v7Provenance;
  const { sectorShortRatio: _sectorShortRatioUnits, ...units } = v7Units;

  return AnalysisSnapshotV6Schema.parse({
    ...common,
    schemaVersion: 6,
    dataDates,
    provenance,
    units,
    unavailable: v7Unavailable.filter(item => item.section !== 'sectorShortRatio'),
  });
}

function v5Snapshot(): AnalysisSnapshotV5 {
  const v6 = v6Snapshot();
  const {
    sectorBenchmark: _sectorBenchmark,
    dataDates: v6DataDates,
    provenance: v6Provenance,
    units: v6Units,
    unavailable: v6Unavailable,
    ...common
  } = v6;
  const { sectorBenchmark: _sectorDate, ...dataDates } = v6DataDates;
  const { sectorBenchmark: _sectorProvenance, ...provenance } = v6Provenance;
  const { sectorBenchmark: _sectorUnits, ...units } = v6Units;

  return AnalysisSnapshotV5Schema.parse({
    ...common,
    schemaVersion: 5,
    dataDates,
    provenance,
    units,
    unavailable: v6Unavailable.filter(item => item.section !== 'sectorBenchmark'),
  });
}

function baseSnapshot(): AnalysisSnapshotV4 {
  const v5 = v5Snapshot();
  const {
    investorTypeFlows: _investorTypeFlows,
    dataDates: v5DataDates,
    provenance: v5Provenance,
    units: v5Units,
    unavailable: v5Unavailable,
    ...common
  } = v5;
  const { investorTypeFlows: _investorDate, ...dataDates } = v5DataDates;
  const { investorTypeFlows: _investorProvenance, ...provenance } = v5Provenance;
  const { investorTypeFlows: _investorUnits, ...units } = v5Units;

  return AnalysisSnapshotV4Schema.parse({
    ...common,
    schemaVersion: 4,
    dataDates,
    provenance,
    units,
    unavailable: v5Unavailable.filter(item => item.section !== 'investorTypeFlows'),
  });
}

function v3Snapshot(): AnalysisSnapshotV3 {
  const v4 = baseSnapshot();
  const {
    reportedShortPositions: _reportedShortPositions,
    dataDates: v4DataDates,
    provenance: v4Provenance,
    units: v4Units,
    unavailable: v4Unavailable,
    ...common
  } = v4;
  const { reportedShortPositions: _reportedDate, ...dataDates } = v4DataDates;
  const { reportedShortPositions: _reportedProvenance, ...provenance } = v4Provenance;
  const { reportedShortPositions: _reportedUnits, ...units } = v4Units;

  return AnalysisSnapshotV3Schema.parse({
    ...common,
    schemaVersion: 3,
    dataDates,
    provenance,
    units,
    unavailable: v4Unavailable.filter(item => item.section !== 'reportedShortPositions'),
  });
}

function v2Snapshot(): AnalysisSnapshotV2 {
  const v3 = v3Snapshot();
  const { mean4w: _mean4w, unavailable, ...supplyDemand } = v3.supplyDemand ?? {};
  const { mean4w: _mean4wUnit, ...supplyDemandUnits } = v3.units.supplyDemand;

  return AnalysisSnapshotV2Schema.parse({
    ...v3,
    schemaVersion: 2,
    supplyDemand: v3.supplyDemand
      ? {
          ...supplyDemand,
          unavailable: unavailable?.filter(item => item.metric !== 'mean4w'),
        }
      : null,
    units: { ...v3.units, supplyDemand: supplyDemandUnits },
  });
}

function v1Snapshot(): AnalysisSnapshot {
  const v2 = v2Snapshot();
  const {
    advancedTechnical: _advancedTechnical,
    dataDates: v2DataDates,
    provenance: v2Provenance,
    units: v2Units,
    unavailable: v2Unavailable,
    ...common
  } = v2;
  const { advancedTechnical: _advancedDate, ...dataDates } = v2DataDates;
  const { advancedTechnical: _advancedProvenance, ...provenance } = v2Provenance;
  const { advancedTechnical: _advancedUnits, ...units } = v2Units;

  return AnalysisSnapshotV1Schema.parse({
    ...common,
    schemaVersion: 1,
    dataDates,
    provenance,
    units,
    unavailable: v2Unavailable.filter(item => (
      item.section !== 'advancedTechnical'
    )),
  });
}

function peerComparison(marketCapPriorityApplied: boolean): AnalysisSnapshot['peerComparison'] {
  const peerPosition = (
    metric: 'per' | 'pbr' | 'roe' | 'roic' | 'operatingMargin' | 'revenueGrowth' | 'dividendYield',
  ) => ({
    metric,
    direction: metric === 'per' || metric === 'pbr'
      ? 'lower_is_better' as const
      : 'higher_is_better' as const,
    targetValue: 12,
    median: 10,
    rank: 2.5,
    percentile: 0.75,
    peerSampleSize: 4,
    cohortSize: 5,
  });
  return {
    result: {
      target: {
        id: '7203',
        name: 'トヨタ自動車株式会社',
        sector: '輸送用機器',
        marketCap: 50_000,
        dataDate: '2026-08-21',
        metrics: {
          per: 12,
          pbr: 12,
          roe: 12,
          roic: 12,
          operatingMargin: 12,
          revenueGrowth: 12,
          dividendYield: 12,
        },
      },
      selection: {
        peers: Array.from({ length: 5 }, (_, index) => ({
          id: `72${index + 10}`,
          name: `比較企業${index + 1}`,
          sector: '輸送用機器',
          marketCap: 20_000 - index * 1_000,
          dataDate: '2026-08-21',
          metrics: { per: 10 + index },
        })),
        sameSectorCandidateCount: 5,
        marketCapPrioritizedPeerCount: 5,
        sectorLeaderId: '7203',
        sectorLeaderIncluded: true,
        tooFewPeers: false,
      },
      targetIncludedInStatistics: true,
      positions: {
        per: peerPosition('per'),
        pbr: peerPosition('pbr'),
        roe: peerPosition('roe'),
        roic: peerPosition('roic'),
        operatingMargin: peerPosition('operatingMargin'),
        revenueGrowth: peerPosition('revenueGrowth'),
        dividendYield: peerPosition('dividendYield'),
      },
      unavailable: [],
    },
    marketCapPriorityApplied,
    marketCapPriorityUnavailableReason: marketCapPriorityApplied
      ? null
      : 'incomplete_peer_market_cap',
  };
}

function watchlistSnapshot(
  ticker: string,
  generatedAt: string,
  latestDataDate: string,
): AnalysisSnapshotV4 {
  return {
    ...baseSnapshot(),
    canonicalTicker: ticker,
    companyName: `${ticker}株式会社`,
    generatedAt,
    status: 'complete',
    dataDates: {
      identity: latestDataDate,
      fundamental: latestDataDate,
      valuation: { price: latestDataDate, financial: latestDataDate },
      peerComparison: latestDataDate,
      technical: latestDataDate,
      advancedTechnical: latestDataDate,
      reportedShortPositions: latestDataDate,
      supplyDemand: latestDataDate,
      marketCorrelation: latestDataDate,
      strategy: latestDataDate,
      priceHistory: latestDataDate,
    },
    fundamental: {
      periods: [{
        fiscalYear: 2026,
        submitDate: latestDataDate,
        revenue: 1_000,
        operatingIncome: 100,
        ordinaryIncome: 100,
        netIncome: 80,
        eps: 100,
        roe: 0.12,
        equityRatio: 0.4,
        operatingCashFlow: 120,
        freeCashFlow: 90,
      }],
      sourceUrls: [],
    },
    valuation: {
      priceDataDate: latestDataDate,
      financialDataDate: latestDataDate,
      latestFiscalYear: 2026,
      currentPrice: 2_850,
      per: 12.4,
      pbr: 1.1,
      dividendYieldPercent: 2.5,
      revenueCagrPercent: 4,
      cagrStartFiscalYear: 2023,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 3,
      unavailable: [],
    },
    technical: {
      dataDate: latestDataDate,
      ma20: 2_800,
      atr14: 65,
      averageVolume20: 12_000_000,
      trend: 'uptrend',
      latestSwingHigh: 2_900,
      latestSwingLow: 2_650,
      unavailable: [],
    },
    supplyDemand: {
      dataDate: latestDataDate,
      volumeDataDate: latestDataDate,
      buyingBalance: 10_000,
      sellingBalance: 5_000,
      marginRatio: 2,
      buyingBalanceWeeklyChange: 100,
      sellingBalanceWeeklyChange: -100,
      mean4w: 9_500,
      mean13w: 9_000,
      mean52w: 8_000,
      deviation52w: 0.25,
      percentile52w: 0.8,
      averageDailyVolume20: 2_000,
      digestionDays: 5,
      unavailable: [],
    },
    marketCorrelation: {
      benchmark: 'TOPIX',
      dataDate: latestDataDate,
      alignedPriceCount: 250,
      windows: [{
        period: 250,
        startDate: '2025-08-21',
        endDate: latestDataDate,
        observations: 250,
        correlation: 0.7,
        beta: 1.05,
        alphaAnnualized: 0.02,
        rSquared: 0.49,
        stockVolatilityAnnualized: 0.2,
        benchmarkVolatilityAnnualized: 0.15,
        excessReturn: 0.03,
        unavailable: [],
      }],
    },
  };
}

function advancedDividendResult(): NonNullable<AnalysisSnapshotV8['advancedDividend']> {
  return {
    analysisAsOfDate: '2026-08-24',
    collectedAt: '2026-08-24T03:04:05.000Z',
    issuerCode: '72030',
    dataDate: '2026-08-21',
    observations: [
      {
        kind: 'actual',
        fiscalYearEndDate: '2026-03-31',
        disclosedDate: '2026-05-08',
        disclosedTime: '15:00:00',
        sourceEligibleDate: '2026-05-11',
        disclosureNumber: 'summary-actual',
        sourceField: 'DivAnn',
        payoutRatioSourceField: 'PayoutRatioAnn',
        annualDividendPerShare: 120,
        payoutRatio: 0.321,
      },
      {
        kind: 'company_forecast',
        fiscalYearEndDate: '2027-03-31',
        disclosedDate: '2026-08-20',
        disclosedTime: null,
        sourceEligibleDate: '2026-08-21',
        disclosureNumber: 'summary-forecast',
        sourceField: 'FDivAnn',
        payoutRatioSourceField: 'FPayoutRatioAnn',
        annualDividendPerShare: 0,
        payoutRatio: 0,
      },
    ],
    events: [
      {
        notifiedDate: '2021-05-10',
        notifiedTime: '15:30',
        sourceEligibleDate: '2021-05-11',
        referenceNumber: 'event-pre-component',
        corporateActionReferenceNumber: 'ca-pre-component',
        kind: 'interim',
        decision: 'forecast',
        recordDateYearMonth: '2021-09',
        dividendPerShare: 50,
        ordinaryDividendPerShare: null,
        commemorativeDividendPerShare: null,
        specialDividendPerShare: null,
        recordDate: '2021-09-30',
        rightsRecordDate: null,
        exDate: '2021-09-29',
        paymentDate: null,
      },
      {
        notifiedDate: '2026-08-21',
        notifiedTime: null,
        sourceEligibleDate: '2026-08-24',
        referenceNumber: 'event-zero',
        corporateActionReferenceNumber: 'ca-zero',
        kind: 'fiscal_year_end',
        decision: 'decided',
        recordDateYearMonth: '2027-03',
        dividendPerShare: 60,
        ordinaryDividendPerShare: 40,
        commemorativeDividendPerShare: 5,
        specialDividendPerShare: 15,
        recordDate: null,
        rightsRecordDate: null,
        exDate: null,
        paymentDate: null,
      },
    ],
    unavailable: [{ scope: 'component', reason: 'component_breakdown_unavailable' }],
    provenance: {
      financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
      dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
      availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
      calculation: { source: 'advanced_dividend_engine' },
    },
    units: { dividendPerShare: 'JPY_per_share', payoutRatio: 'ratio' },
  };
}

function volumeProfileResult(): NonNullable<AnalysisSnapshotV9['volumeProfile']> {
  const totalVolume = 12_250;
  const bins = Array.from({ length: 50 }, (_, index) => {
    const allocatedVolume = index * 10;
    return {
      index,
      lowerPrice: 1_000 + index * 10,
      upperPrice: 1_010 + index * 10,
      representativePrice: 1_005 + index * 10,
      allocatedVolume,
      volumeShare: allocatedVolume / totalVolume,
    };
  });

  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-28T03:04:05.000Z',
    issuerCode: '72030',
    dataDate: '2026-08-21',
    windowStartDate: '2026-03-03',
    windowEndDate: '2026-08-21',
    inputBarCount: 120,
    priceBasis: 'jquants_corporate_action_adjusted',
    volumeBasis: 'jquants_corporate_action_adjusted',
    allocationMethod: 'uniform_range_overlap_v1',
    binningMethod: {
      id: 'fixed_count_linear_v1',
      requestedBinCount: 50,
      effectiveBinCount: 50,
      minPrice: 1_000,
      maxPrice: 1_500,
    },
    bins,
    // Presentation sentinels intentionally differ from bin-derived values.
    poc: {
      binIndex: 7,
      price: 1_234.56,
      allocatedVolume: 487.5,
      volumeShare: 0.0398,
    },
    valueArea: {
      targetVolumeShare: 0.7,
      achievedVolumeShare: 0.7654,
      val: 1_039.25,
      vah: 1_121.75,
      firstBinIndex: 4,
      lastBinIndex: 11,
    },
    unavailable: [],
    methodology: {
      id: 'daily_ohlcv_volume_profile_proxy_v1',
      approximation: 'uniform_daily_range',
      actualHolderCostBasis: false,
    },
    provenance: {
      source: 'jquants',
      endpoint: '/v2/equities/bars/daily',
      availabilityCalendarEndpoint: '/v2/markets/calendar',
      sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
      adjustmentFactorField: 'AdjFactor',
      exRightsField: 'ExRT',
      basisAudit: 'collection_horizon_rights_audit_v1',
      basisAuditRequiredThroughDate: '2026-08-26',
      basisAuditThroughDate: '2026-08-27',
      corporateActionBasisStatus: 'supported_common_basis_established',
      calculation: 'volume_profile_engine',
    },
    units: {
      price: 'JPY',
      allocatedVolume: 'adjusted_shares',
      volumeShare: 'ratio',
    },
  };
}

describe('dashboard presentation helpers', () => {
  test('keeps nullable values explicitly unavailable instead of displaying zero', () => {
    expect(formatMetric(null, 'JPY')).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(formatMetric(undefined, 'percent')).toEqual({
      text: UNAVAILABLE_TEXT,
      available: false,
    });
    expect(displayText('')).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(formatMetric(0, 'JPY')).toEqual({ text: '¥0', available: true });
  });

  test('formats sourced values according to their declared units', () => {
    expect(formatMetric(1_234.5, 'JPY').text).toBe('¥1,234.5');
    expect(formatMetric(18.75, 'percent').text).toBe('18.75%');
    expect(formatMetric(2.5, 'multiple').text).toBe('2.5x');
    expect(formatMetric(1200, 'shares').text).toBe('1,200 株');
    expect(formatMetric(0.123, 'ratio', { ratioAsPercent: true }).text).toBe('12.3%');
    expect(formatMetric(62.345, 'index').text).toBe('62.35');
    expect(formatMetric(1_234, 'thousand_JPY').text).toBe('1,234 千円');
    expect(formatMetric(120, 'JPY_per_share').text).toBe('¥120 / 株');
    expect(formatMetric(1_234.5, 'adjusted_shares').text).toBe('1,234.5 調整後株');
  });
});

describe('snapshot presentation mapping', () => {
  test('passes through and formats the seven latest Advanced Technical values', () => {
    const snapshot: AnalysisSnapshotV4 = {
      ...baseSnapshot(),
      advancedTechnical: {
        dataDate: '2026-08-21',
        rsi14: 62.345,
        macd: { value: 45.5, signal: 40.25, histogram: 5.25 },
        bollinger20: { middle: 2_950, upper: 3_150.5, lower: 2_749.5 },
        unavailable: [],
      },
      dataDates: { ...baseSnapshot().dataDates, advancedTechnical: '2026-08-21' },
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.advancedTechnical?.metrics).toEqual([
      { label: 'RSI 14', value: { text: '62.35', available: true } },
      { label: 'MACD', value: { text: '¥45.5', available: true } },
      { label: 'MACD シグナル', value: { text: '¥40.25', available: true } },
      { label: 'MACD ヒストグラム', value: { text: '¥5.25', available: true } },
      { label: 'ボリンジャー中心線', value: { text: '¥2,950', available: true } },
      { label: 'ボリンジャー上限', value: { text: '¥3,150.5', available: true } },
      { label: 'ボリンジャー下限', value: { text: '¥2,749.5', available: true } },
    ]);
    expect(view.advancedTechnical?.dataDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.advancedTechnical?.metrics.map(metric => metric.label)).not.toContain('Buy');
    expect(view.advancedTechnical?.metrics.map(metric => metric.label)).not.toContain('Sell');
    expect(view.dataDates).toContainEqual({
      label: 'テクニカル指標',
      value: { text: '2026-08-21', available: true },
    });
  });

  test('keeps unavailable Advanced Technical metrics distinct from zero', () => {
    const snapshot: AnalysisSnapshotV4 = {
      ...baseSnapshot(),
      advancedTechnical: {
        dataDate: '2026-08-21',
        rsi14: null,
        macd: null,
        bollinger20: { middle: 2_800, upper: 3_000, lower: 2_600 },
        unavailable: [
          { metric: 'rsi14', reason: 'missing_data' },
          { metric: 'macd', reason: 'insufficient_history' },
        ],
      },
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.advancedTechnical?.metrics[0].value).toEqual({
      text: UNAVAILABLE_TEXT,
      available: false,
    });
    expect(view.advancedTechnical?.metrics[1].value).toEqual({
      text: UNAVAILABLE_TEXT,
      available: false,
    });
    expect(view.advancedTechnical?.metrics[4].value).toEqual({
      text: '¥2,800',
      available: true,
    });
    expect(view.advancedTechnical?.unavailableReasons).toEqual([
      'rsi14: missing data',
      'macd: insufficient history',
    ]);
  });

  test('presents V8 advanced dividend observations and events without recalculation or aggregation', () => {
    const base = v8Snapshot();
    const snapshot: AnalysisSnapshotV8 = {
      ...base,
      valuation: {
        priceDataDate: '2026-08-21',
        financialDataDate: '2026-08-21',
        latestFiscalYear: 2026,
        currentPrice: 3_000,
        per: 12,
        pbr: 1.1,
        dividendYieldPercent: 2.5,
        revenueCagrPercent: 4,
        cagrStartFiscalYear: 2023,
        cagrEndFiscalYear: 2026,
        cagrPeriods: 3,
        unavailable: [],
      },
      advancedDividend: advancedDividendResult(),
      dataDates: { ...base.dataDates, advancedDividend: '2026-08-21' },
      unavailable: base.unavailable.filter(item => item.section !== 'advancedDividend'),
    };

    const view = mapSnapshotToDashboard(snapshot).advancedDividend;

    expect(view.state).toBe('available');
    expect(view.analysisAsOfDate).toEqual({ text: '2026-08-24', available: true });
    expect(view.dataDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.existingDividendYield).toEqual({ text: '2.5%', available: true });
    expect(view.observations.map(observation => observation.kind)).toEqual([
      'actual',
      'company_forecast',
    ]);
    expect(view.observations[0]).toMatchObject({
      fiscalYearEndDate: { text: '2026-03-31', available: true },
      disclosedDate: { text: '2026-05-08', available: true },
      sourceEligibleDate: { text: '2026-05-11', available: true },
      annualDividendPerShare: { text: '¥120 / 株', available: true },
      payoutRatio: { text: '32.1%', available: true },
      sourceField: { text: 'DivAnn', available: true },
    });
    expect(view.observations[1]).toMatchObject({
      annualDividendPerShare: { text: '¥0 / 株', available: true },
      payoutRatio: { text: '0%', available: true },
    });
    expect(view.events).toHaveLength(2);
    expect(view.events?.[0]).toMatchObject({
      dividendPerShare: { text: '¥50 / 株', available: true },
      ordinaryDividendPerShare: { text: UNAVAILABLE_TEXT, available: false },
      commemorativeDividendPerShare: { text: UNAVAILABLE_TEXT, available: false },
      specialDividendPerShare: { text: UNAVAILABLE_TEXT, available: false },
    });
    expect(view.events?.[1]).toMatchObject({
      dividendPerShare: { text: '¥60 / 株', available: true },
      ordinaryDividendPerShare: { text: '¥40 / 株', available: true },
      commemorativeDividendPerShare: { text: '¥5 / 株', available: true },
      specialDividendPerShare: { text: '¥15 / 株', available: true },
    });
    expect(view.unavailableReasons).toEqual([
      'component: component breakdown unavailable',
    ]);
    expect(mapSnapshotToDashboard(snapshot).dataDates).toContainEqual({
      label: '配当分析',
      value: { text: '2026-08-21', available: true },
    });
    expect(ADVANCED_DIVIDEND_CONTEXT_NOTE).toContain('ブラウザで再計算');
    expect(ADVANCED_DIVIDEND_CONTEXT_NOTE).toContain('既存の決定論的な配当利回り');
  });

  test('keeps optional event-source unavailability separate from an available core result', () => {
    const base = v8Snapshot();
    const result = advancedDividendResult();
    const snapshot: AnalysisSnapshotV8 = {
      ...base,
      advancedDividend: {
        ...result,
        events: null,
        unavailable: [{ scope: 'event', reason: 'event_source_plan_unavailable' }],
        provenance: { ...result.provenance, dividendEvents: null },
      },
      unavailable: base.unavailable.filter(item => item.section !== 'advancedDividend'),
    };

    const view = mapSnapshotToDashboard(snapshot).advancedDividend;

    expect(view.state).toBe('available');
    expect(view.observations).toHaveLength(2);
    expect(view.events).toBeNull();
    expect(view.unavailableReasons).toEqual(['event: event source plan unavailable']);
  });

  test('distinguishes structured advanced-dividend unavailability from zero and not-collected', () => {
    const base = v8Snapshot();
    const result = advancedDividendResult();
    const unavailable: AnalysisSnapshotV8 = {
      ...base,
      advancedDividend: {
        ...result,
        dataDate: null,
        observations: [],
        events: null,
        unavailable: [
          { scope: 'core', reason: 'no_eligible_dividend_disclosure_data' },
          { scope: 'event', reason: 'no_eligible_dividend_event_data' },
        ],
      },
    };

    const unavailableView = mapSnapshotToDashboard(unavailable).advancedDividend;
    expect(unavailableView.state).toBe('unavailable');
    expect(unavailableView.observations).toEqual([]);
    expect(unavailableView.events).toBeNull();
    expect(unavailableView.unavailableReasons).toEqual([
      'core: no eligible dividend disclosure data',
      'event: no eligible dividend event data',
    ]);

    for (const snapshot of [
      v1Snapshot(), v2Snapshot(), v3Snapshot(), baseSnapshot(),
      v5Snapshot(), v6Snapshot(), v7Snapshot(), v8Snapshot(),
    ]) {
      const view = mapSnapshotToDashboard(snapshot).advancedDividend;
      expect(view.state).toBe('not_collected');
      expect(view.observations).toEqual([]);
      expect(view.events).toBeNull();
      if (snapshot.schemaVersion !== 8) {
        expect(mapSnapshotToDashboard(snapshot).dataDates.map(item => item.label))
          .not.toContain('Advanced Dividend');
      }
    }
  });

  test('passes through every V9 volume-profile bin, POC, and Value Area value', () => {
    const result = volumeProfileResult();
    const snapshot = v9Snapshot(result);
    const dashboard = mapSnapshotToDashboard(snapshot);
    const view = dashboard.volumeProfile;

    expect(view.state).toBe('available');
    expect(view.analysisAsOfDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.windowStartDate).toEqual({ text: '2026-03-03', available: true });
    expect(view.windowEndDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.inputBarCount).toEqual({ text: '120', available: true });
    expect(view.bins).toHaveLength(50);
    expect(view.bins.map(bin => bin.index)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(view.bins.map(bin => bin.volumeShareValue)).toEqual(
      result.bins!.map(bin => bin.volumeShare),
    );
    expect(view.bins[0]).toEqual({
      index: 0,
      lowerPrice: { text: '¥1,000', available: true },
      upperPrice: { text: '¥1,010', available: true },
      representativePrice: { text: '¥1,005', available: true },
      allocatedVolume: { text: '0 調整後株', available: true },
      volumeShareValue: 0,
      volumeShare: { text: '0%', available: true },
    });
    expect(view.bins[49]).toMatchObject({
      index: 49,
      representativePrice: { text: '¥1,495', available: true },
      allocatedVolume: { text: '490 調整後株', available: true },
      volumeShareValue: 0.04,
      volumeShare: { text: '4%', available: true },
    });
    expect(view.poc).toEqual({
      binIndex: 7,
      price: { text: '¥1,234.56', available: true },
      allocatedVolume: { text: '487.5 調整後株', available: true },
      volumeShare: { text: '3.98%', available: true },
    });
    expect(view.valueArea).toEqual({
      targetVolumeShare: { text: '70%', available: true },
      achievedVolumeShare: { text: '76.54%', available: true },
      val: { text: '¥1,039.25', available: true },
      vah: { text: '¥1,121.75', available: true },
      firstBinIndex: 4,
      lastBinIndex: 11,
    });
    expect(dashboard.dataDates).toContainEqual({
      label: '出来高価格分布',
      value: { text: '2026-08-21', available: true },
    });
    expect(dashboard.availability.uncollectedSections).not.toContain('volumeProfile');
    expect(dashboard.availability.distinctUnavailable
      .filter(item => item.section === 'volumeProfile')).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('2026-08-26');
    expect(JSON.stringify(view)).not.toContain('2026-08-27');
    expect(JSON.stringify(view)).not.toContain('basisAuditThroughDate');
    expect(VOLUME_PROFILE_CONTEXT_NOTE).toContain('推定出来高価格分布');
    expect(VOLUME_PROFILE_CONTEXT_NOTE).toContain('ブラウザで再計算せず');
    expect(VOLUME_PROFILE_CONTEXT_NOTE).toContain('真のしこり玉');
    expect(VOLUME_PROFILE_CONTEXT_NOTE).toContain('支持線・抵抗線');
    expect(VOLUME_PROFILE_CONTEXT_NOTE).toContain('買い／売りシグナル');
  });

  test('distinguishes volume-profile unavailability and valid zero from not-collected', () => {
    const result = volumeProfileResult();
    const unavailable = v9Snapshot({
      ...result,
      dataDate: null,
      windowStartDate: null,
      windowEndDate: null,
      inputBarCount: 59,
      priceBasis: null,
      volumeBasis: null,
      binningMethod: {
        ...result.binningMethod,
        effectiveBinCount: 0,
        minPrice: null,
        maxPrice: null,
      },
      bins: null,
      poc: null,
      valueArea: null,
      unavailable: [{ scope: 'profile', reason: 'insufficient_history' }],
      provenance: {
        ...result.provenance,
        basisAuditRequiredThroughDate: null,
        basisAuditThroughDate: null,
        corporateActionBasisStatus: 'not_evaluated',
      },
    });

    const unavailableView = mapSnapshotToDashboard(unavailable).volumeProfile;
    expect(unavailableView.state).toBe('unavailable');
    expect(unavailableView.bins).toEqual([]);
    expect(unavailableView.poc).toBeNull();
    expect(unavailableView.valueArea).toBeNull();
    expect(unavailableView.dataDate).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(unavailableView.unavailableReasons).toEqual([
      'profile: insufficient history',
    ]);

    for (const snapshot of [
      v1Snapshot(), v2Snapshot(), v3Snapshot(), baseSnapshot(),
      v5Snapshot(), v6Snapshot(), v7Snapshot(), v8Snapshot(), v9Snapshot(),
    ]) {
      const view = mapSnapshotToDashboard(snapshot).volumeProfile;
      expect(view.state).toBe('not_collected');
      expect(view.bins).toEqual([]);
      expect(view.poc).toBeNull();
      expect(view.valueArea).toBeNull();
      if (snapshot.schemaVersion !== 9) {
        expect(mapSnapshotToDashboard(snapshot).dataDates.map(item => item.label))
          .not.toContain('Volume Profile');
      }
    }
  });

  test('passes through V4 report rows and formats stored ratios without aggregation or delta calculation', () => {
    const snapshot: AnalysisSnapshotV4 = {
      ...baseSnapshot(),
      reportedShortPositions: {
        dataDate: '2026-08-20',
        reports: [
          {
            disclosedDate: '2026-08-20',
            calculatedDate: '2026-08-18',
            reporterName: ' Reporter A ',
            discretionaryManagerName: 'Manager A',
            fundName: 'Fund A',
            shortPositionRatio: 0.006,
            shortPositionShares: 120_000,
            previousCalculatedDate: '2026-08-11',
            previousReportedRatio: 0.0054,
            ratioDelta: 0.0005,
          },
          {
            disclosedDate: '2026-08-21',
            calculatedDate: '2026-08-18',
            reporterName: 'Reporter B',
            discretionaryManagerName: null,
            fundName: null,
            shortPositionRatio: 0.007,
            shortPositionShares: 80_000,
            previousCalculatedDate: '2026-08-12',
            previousReportedRatio: 0.005,
            ratioDelta: -0.001,
          },
          {
            disclosedDate: '2026-08-22',
            calculatedDate: '2026-08-19',
            reporterName: 'Reporter C',
            discretionaryManagerName: null,
            fundName: null,
            shortPositionRatio: 0.008,
            shortPositionShares: 70_000,
            previousCalculatedDate: null,
            previousReportedRatio: null,
            ratioDelta: null,
          },
        ],
        unavailable: [],
      },
      dataDates: {
        ...baseSnapshot().dataDates,
        reportedShortPositions: '2026-08-20',
      },
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.reportedShortPositions.state).toBe('available');
    expect(view.reportedShortPositions.reports).toHaveLength(3);
    expect(view.reportedShortPositions.reports[0]).toEqual({
      disclosedDate: { text: '2026-08-20', available: true },
      calculatedDate: { text: '2026-08-18', available: true },
      reporterName: { text: ' Reporter A ', available: true },
      discretionaryManagerName: { text: 'Manager A', available: true },
      fundName: { text: 'Fund A', available: true },
      shortPositionRatio: { text: '0.6%', available: true },
      shortPositionShares: { text: '120,000 株', available: true },
      previousCalculatedDate: { text: '2026-08-11', available: true },
      previousReportedRatio: { text: '0.54%', available: true },
      ratioDelta: { text: '+0.05 pt', available: true },
    });
    expect(view.reportedShortPositions.reports[1]).toMatchObject({
      calculatedDate: { text: '2026-08-18', available: true },
      previousReportedRatio: { text: '0.5%', available: true },
      ratioDelta: { text: '-0.10 pt', available: true },
    });
    expect(view.reportedShortPositions.reports[2]).toMatchObject({
      discretionaryManagerName: { text: UNAVAILABLE_TEXT, available: false },
      fundName: { text: UNAVAILABLE_TEXT, available: false },
      previousCalculatedDate: { text: UNAVAILABLE_TEXT, available: false },
      previousReportedRatio: { text: UNAVAILABLE_TEXT, available: false },
      ratioDelta: { text: UNAVAILABLE_TEXT, available: false },
    });
    expect(view.dataDates).toContainEqual({
      label: '公開空売り残高報告',
      value: { text: '2026-08-20', available: true },
    });
  });

  test('preserves the existing reported-position presentation for Snapshot V5', () => {
    const snapshot: AnalysisSnapshotV5 = {
      ...v5Snapshot(),
      reportedShortPositions: {
        dataDate: '2026-08-20',
        reports: [{
          disclosedDate: '2026-08-20',
          calculatedDate: '2026-08-18',
          reporterName: 'Reporter Exact',
          discretionaryManagerName: null,
          fundName: null,
          shortPositionRatio: 0.006,
          shortPositionShares: 120_000,
          previousCalculatedDate: null,
          previousReportedRatio: null,
          ratioDelta: null,
        }],
        unavailable: [],
      },
      dataDates: {
        ...v5Snapshot().dataDates,
        reportedShortPositions: '2026-08-20',
      },
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.reportedShortPositions.state).toBe('available');
    expect(view.reportedShortPositions.reports[0]?.shortPositionRatio).toEqual({
      text: '0.6%',
      available: true,
    });
    expect(view.dataDates).toContainEqual({
      label: '公開空売り残高報告',
      value: { text: '2026-08-20', available: true },
    });
  });

  test('presents V5 investor-type values with exact source hierarchy, dates, and section', () => {
    // Deliberately non-derived values prove that the Browser formats stored values only.
    const stored = { sell: 10, buy: 20, total: 777, balance: -333 };
    const snapshot: AnalysisSnapshotV5 = {
      ...v5Snapshot(),
      investorTypeFlows: {
        dataDate: '2026-08-20',
        section: 'TokyoNagoya',
        period: {
          publishedDate: '2026-08-20',
          periodStartDate: '2026-08-10',
          periodEndDate: '2026-08-14',
          section: 'TokyoNagoya',
          summary: {
            proprietary: stored,
            brokerage: stored,
            total: stored,
          },
          brokerageBreakdown: {
            individuals: stored,
            foreignInvestors: stored,
            securitiesCompanies: stored,
            investmentTrusts: stored,
            businessCorporations: stored,
            otherCorporations: stored,
            insuranceCompanies: stored,
            banks: stored,
            trustBanks: stored,
            otherFinancialInstitutions: stored,
          },
        },
        unavailable: [],
      },
      dataDates: {
        ...v5Snapshot().dataDates,
        investorTypeFlows: '2026-08-20',
      },
    };

    const dashboard = mapSnapshotToDashboard(snapshot);
    const view = dashboard.investorTypeFlows;

    expect(view.state).toBe('available');
    expect(view.section).toEqual({ text: 'TokyoNagoya', available: true });
    expect(view.publishedDate).toEqual({ text: '2026-08-20', available: true });
    expect(view.periodStartDate).toEqual({ text: '2026-08-10', available: true });
    expect(view.periodEndDate).toEqual({ text: '2026-08-14', available: true });
    expect(dashboard.dataDates).toContainEqual({
      label: '投資部門別 公表日',
      value: { text: '2026-08-20', available: true },
    });
    expect(view.summary.map(row => row.category)).toEqual([
      'proprietary',
      'brokerage',
      'total',
    ]);
    expect(view.brokerageBreakdown.map(row => row.category)).toEqual([
      'individuals',
      'foreignInvestors',
      'securitiesCompanies',
      'investmentTrusts',
      'businessCorporations',
      'otherCorporations',
      'insuranceCompanies',
      'banks',
      'trustBanks',
      'otherFinancialInstitutions',
    ]);
    expect(view.summary[0]).toEqual({
      category: 'proprietary',
      sell: { text: '10 千円', available: true },
      buy: { text: '20 千円', available: true },
      total: { text: '777 千円', available: true },
      balance: { text: '-333 千円', available: true },
    });
    expect(INVESTOR_TYPE_FLOW_CONTEXT_NOTE).toContain('市場全体');
    expect(INVESTOR_TYPE_FLOW_CONTEXT_NOTE).toContain('個別銘柄');
  });

  test('keeps a valid all-zero investor-type period available', () => {
    const zero = { sell: 0, buy: 0, total: 0, balance: 0 };
    const snapshot: AnalysisSnapshotV5 = {
      ...v5Snapshot(),
      investorTypeFlows: {
        dataDate: '2026-08-20',
        section: 'TokyoNagoya',
        period: {
          publishedDate: '2026-08-20',
          periodStartDate: '2026-08-10',
          periodEndDate: '2026-08-14',
          section: 'TokyoNagoya',
          summary: { proprietary: zero, brokerage: zero, total: zero },
          brokerageBreakdown: {
            individuals: zero,
            foreignInvestors: zero,
            securitiesCompanies: zero,
            investmentTrusts: zero,
            businessCorporations: zero,
            otherCorporations: zero,
            insuranceCompanies: zero,
            banks: zero,
            trustBanks: zero,
            otherFinancialInstitutions: zero,
          },
        },
        unavailable: [],
      },
    };

    const view = mapSnapshotToDashboard(snapshot).investorTypeFlows;

    expect(view.state).toBe('available');
    expect(view.summary[0]).toMatchObject({
      sell: { text: '0 千円', available: true },
      buy: { text: '0 千円', available: true },
      total: { text: '0 千円', available: true },
      balance: { text: '0 千円', available: true },
    });
  });

  test('keeps investor-type unavailable reasons distinct from zero', () => {
    for (const reason of ['no_investor_type_flow_data', 'invalid_data'] as const) {
      const snapshot: AnalysisSnapshotV5 = {
        ...v5Snapshot(),
        investorTypeFlows: {
          dataDate: null,
          section: 'TokyoNagoya',
          period: null,
          unavailable: [{ reason }],
        },
      };

      const view = mapSnapshotToDashboard(snapshot).investorTypeFlows;

      expect(view.state).toBe('unavailable');
      expect(view.summary).toEqual([]);
      expect(view.brokerageBreakdown).toEqual([]);
      expect(view.unavailableReasons).toEqual([reason.replaceAll('_', ' ')]);
    }
  });

  test('treats V1-V4 and a null V5 investor-type section as not collected', () => {
    for (const snapshot of [
      v1Snapshot(),
      v2Snapshot(),
      v3Snapshot(),
      baseSnapshot(),
      v5Snapshot(),
    ]) {
      const view = mapSnapshotToDashboard(snapshot);

      expect(view.investorTypeFlows.state).toBe('not_collected');
      expect(view.investorTypeFlows.summary).toEqual([]);
      expect(view.investorTypeFlows.brokerageBreakdown).toEqual([]);
      if (snapshot.schemaVersion !== 5) {
        expect(view.dataDates.map(item => item.label)).not.toContain('投資部門別 公表日');
      }
    }
  });

  test('keeps typed report absence and invalid data unavailable instead of zero', () => {
    for (const reason of ['no_public_disclosure_data', 'invalid_data'] as const) {
      const snapshot: AnalysisSnapshotV4 = {
        ...baseSnapshot(),
        reportedShortPositions: {
          dataDate: null,
          reports: [],
          unavailable: [{ reason }],
        },
      };

      const view = mapSnapshotToDashboard(snapshot).reportedShortPositions;

      expect(view.state).toBe('unavailable');
      expect(view.reports).toEqual([]);
      expect(view.unavailableReasons).toEqual([reason.replaceAll('_', ' ')]);
    }
    expect(REPORTED_SHORT_POSITION_DISCLOSURE_NOTE).toContain('0.5%以上');
    expect(REPORTED_SHORT_POSITION_DISCLOSURE_NOTE).toContain('空売り残高0');
    expect(REPORTED_SHORT_POSITION_DISCLOSURE_NOTE).toContain('信用売残');
    expect(REPORTED_SHORT_POSITION_DISCLOSURE_NOTE).toContain('市場全体の空売り残高');
  });

  test('treats V1, V2, V3, and a null V4 report section as not collected', () => {
    for (const snapshot of [v1Snapshot(), v2Snapshot(), v3Snapshot(), baseSnapshot()]) {
      const view = mapSnapshotToDashboard(snapshot);
      expect(view.reportedShortPositions).toEqual({
        state: 'not_collected',
        dataDate: { text: UNAVAILABLE_TEXT, available: false },
        reports: [],
        unavailableReasons: [],
      });
      if (snapshot.schemaVersion !== 4) {
        expect(view.dataDates.map(item => item.label)).not.toContain('公開空売り残高報告');
      }
    }
  });

  test('passes through V3 mean4w and keeps unavailable distinct from zero', () => {
    const availableSnapshot = watchlistSnapshot(
      '7203',
      '2026-08-23T01:02:03.000Z',
      '2026-08-21',
    );
    const available = mapSnapshotToDashboard(availableSnapshot);

    expect(available.supplyDemand).toContainEqual({
      label: '買残4週平均',
      value: { text: '9,500 株', available: true },
    });
    expect(available.supplyDemand).toContainEqual({
      label: '52週パーセンタイル',
      value: { text: '80%', available: true },
    });

    const unavailableSnapshot: AnalysisSnapshotV4 = {
      ...availableSnapshot,
      supplyDemand: {
        ...availableSnapshot.supplyDemand!,
        mean4w: null,
        unavailable: [{ metric: 'mean4w', reason: 'missing_data' }],
      },
    };
    const unavailable = mapSnapshotToDashboard(unavailableSnapshot);

    expect(unavailable.supplyDemand).toContainEqual({
      label: '買残4週平均',
      value: { text: UNAVAILABLE_TEXT, available: false },
    });
  });

  test('passes through the 20-day correlation window and keeps unavailable distinct from zero', () => {
    const snapshot: AnalysisSnapshotV4 = {
      ...baseSnapshot(),
      marketCorrelation: {
        benchmark: 'TOPIX',
        dataDate: '2026-08-21',
        alignedPriceCount: 21,
        windows: [{
          period: 20,
          startDate: '2026-07-24',
          endDate: '2026-08-21',
          observations: 20,
          correlation: 0.625,
          beta: 1.1,
          alphaAnnualized: 0.02,
          rSquared: 0.390625,
          stockVolatilityAnnualized: 0.25,
          benchmarkVolatilityAnnualized: 0.18,
          excessReturn: 0.03,
          unavailable: [],
        }],
      },
    };

    expect(mapSnapshotToDashboard(snapshot).correlations).toEqual([{
      period: 20,
      observations: { text: '20', available: true },
      correlation: { text: '0.625', available: true },
      beta: { text: '1.1', available: true },
      alpha: { text: '2%', available: true },
      rSquared: { text: '0.391', available: true },
      unavailableReasons: [],
    }]);

    const unavailable: AnalysisSnapshotV4 = {
      ...snapshot,
      marketCorrelation: {
        ...snapshot.marketCorrelation!,
        alignedPriceCount: 20,
        windows: [{
          ...snapshot.marketCorrelation!.windows[0]!,
          observations: 19,
          correlation: null,
          beta: null,
          alphaAnnualized: null,
          rSquared: null,
          stockVolatilityAnnualized: null,
          benchmarkVolatilityAnnualized: null,
          excessReturn: null,
          unavailable: [{ metric: 'correlation', reason: 'insufficient_history' }],
        }],
      },
    };
    const unavailableWindow = mapSnapshotToDashboard(unavailable).correlations?.[0];

    expect(unavailableWindow?.observations).toEqual({ text: '19', available: true });
    expect(unavailableWindow?.correlation).toEqual({
      text: UNAVAILABLE_TEXT,
      available: false,
    });
  });

  test('passes through the V6 sector identity and stored window metrics without recalculation', () => {
    const base = v6Snapshot();
    const snapshot: AnalysisSnapshotV6 = {
      ...base,
      dataDates: { ...base.dataDates, sectorBenchmark: '2026-08-21' },
      sectorBenchmark: {
        analysisAsOfDate: '2026-08-22',
        benchmark: {
          type: 'TSE33_SECTOR_PRICE_INDEX',
          sectorCode: '3700',
          sectorName: '輸送用機器',
          indexCode: '0050',
          classificationDate: '2026-08-21',
        },
        dataDate: '2026-08-21',
        alignedPriceCount: 21,
        windows: [{
          period: 20,
          startDate: '2026-07-24',
          endDate: '2026-08-21',
          observations: 20,
          correlation: 0.625,
          beta: 1.1,
          alphaAnnualized: 0.02,
          rSquared: 0.777,
          stockVolatilityAnnualized: 0.25,
          benchmarkVolatilityAnnualized: 0.18,
          excessReturn: 0.03,
          unavailable: [],
        }],
        unavailable: [],
        provenance: {
          classification: { source: 'jquants', endpoint: '/v2/equities/master' },
          index: { source: 'jquants', endpoint: '/v2/indices/bars/daily' },
          calculation: { source: 'market_correlation_engine' },
        },
        units: {
          indexLevel: 'index_points',
          observations: 'count',
          correlation: 'ratio',
          beta: 'ratio',
          alphaAnnualized: 'ratio',
          rSquared: 'ratio',
          stockVolatilityAnnualized: 'ratio',
          benchmarkVolatilityAnnualized: 'ratio',
          excessReturn: 'ratio',
        },
      },
      unavailable: base.unavailable.filter(item => item.section !== 'sectorBenchmark'),
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.sectorBenchmark).toMatchObject({
      state: 'available',
      analysisAsOfDate: { text: '2026-08-22', available: true },
      benchmarkType: { text: 'TSE33_SECTOR_PRICE_INDEX', available: true },
      sectorCode: { text: '3700', available: true },
      sectorName: { text: '輸送用機器', available: true },
      indexCode: { text: '0050', available: true },
      classificationDate: { text: '2026-08-21', available: true },
      dataDate: { text: '2026-08-21', available: true },
      alignedPriceCount: { text: '21', available: true },
      unavailableReasons: [],
    });
    expect(view.sectorBenchmark.windows).toEqual([{
      period: 20,
      observations: { text: '20', available: true },
      correlation: { text: '0.625', available: true },
      beta: { text: '1.1', available: true },
      alpha: { text: '2%', available: true },
      rSquared: { text: '0.777', available: true },
      stockVolatility: { text: '25%', available: true },
      benchmarkVolatility: { text: '18%', available: true },
      excessReturn: { text: '3%', available: true },
      unavailableReasons: [],
    }]);
    expect(view.dataDates).toContainEqual({
      label: '業種指数比較',
      value: { text: '2026-08-21', available: true },
    });
    expect(SECTOR_BENCHMARK_CONTEXT_NOTE).toContain('analysisAsOfDate');
    expect(SECTOR_BENCHMARK_CONTEXT_NOTE).toContain('遡及期間全体');
    expect(SECTOR_BENCHMARK_CONTEXT_NOTE).toContain('現在の分類の過去適用');
    expect(SECTOR_BENCHMARK_CONTEXT_NOTE).toContain('複数業種指数の接合');
    expect(SECTOR_BENCHMARK_CONTEXT_NOTE).toContain('順位・スコア・シグナル');
  });

  test('keeps sector source and metric unavailability distinct from zero', () => {
    const base = v6Snapshot();
    for (const reason of [
      'sector_classification_unavailable',
      'unsupported_sector',
      'no_sector_index_data',
      'invalid_data',
    ] as const) {
      const snapshot: AnalysisSnapshotV6 = {
        ...base,
        sectorBenchmark: {
          analysisAsOfDate: '2026-08-21',
          benchmark: null,
          dataDate: null,
          alignedPriceCount: 0,
          windows: [],
          unavailable: [{ reason }],
          provenance: {
            classification: { source: 'jquants', endpoint: '/v2/equities/master' },
            index: { source: 'jquants', endpoint: '/v2/indices/bars/daily' },
            calculation: { source: 'market_correlation_engine' },
          },
          units: {
            indexLevel: 'index_points',
            observations: 'count',
            correlation: 'ratio',
            beta: 'ratio',
            alphaAnnualized: 'ratio',
            rSquared: 'ratio',
            stockVolatilityAnnualized: 'ratio',
            benchmarkVolatilityAnnualized: 'ratio',
            excessReturn: 'ratio',
          },
        },
      };

      const view = mapSnapshotToDashboard(snapshot).sectorBenchmark;

      expect(view.state).toBe('unavailable');
      expect(view.windows).toEqual([]);
      expect(view.unavailableReasons).toEqual([reason.replaceAll('_', ' ')]);
      expect(view.sectorName.available).toBe(false);
    }

    const metricUnavailable: AnalysisSnapshotV6 = {
      ...base,
      sectorBenchmark: {
        analysisAsOfDate: '2026-08-21',
        benchmark: {
          type: 'TSE33_SECTOR_PRICE_INDEX',
          sectorCode: '3700',
          sectorName: '輸送用機器',
          indexCode: '0050',
          classificationDate: '2026-08-21',
        },
        dataDate: '2026-08-21',
        alignedPriceCount: 20,
        windows: [{
          period: 20,
          startDate: null,
          endDate: null,
          observations: 19,
          correlation: null,
          beta: null,
          alphaAnnualized: null,
          rSquared: null,
          stockVolatilityAnnualized: null,
          benchmarkVolatilityAnnualized: null,
          excessReturn: null,
          unavailable: [{ metric: 'correlation', reason: 'insufficient_history' }],
        }],
        unavailable: [],
        provenance: {
          classification: { source: 'jquants', endpoint: '/v2/equities/master' },
          index: { source: 'jquants', endpoint: '/v2/indices/bars/daily' },
          calculation: { source: 'market_correlation_engine' },
        },
        units: {
          indexLevel: 'index_points',
          observations: 'count',
          correlation: 'ratio',
          beta: 'ratio',
          alphaAnnualized: 'ratio',
          rSquared: 'ratio',
          stockVolatilityAnnualized: 'ratio',
          benchmarkVolatilityAnnualized: 'ratio',
          excessReturn: 'ratio',
        },
      },
    };
    const unavailableWindow = mapSnapshotToDashboard(
      metricUnavailable,
    ).sectorBenchmark.windows[0];

    expect(unavailableWindow?.observations).toEqual({ text: '19', available: true });
    expect(unavailableWindow?.correlation).toEqual({
      text: UNAVAILABLE_TEXT,
      available: false,
    });
    expect(unavailableWindow?.unavailableReasons).toEqual([
      'correlation: insufficient history',
    ]);
  });

  test('treats V1-V5 and a null V6 sector benchmark as not collected', () => {
    for (const snapshot of [
      v1Snapshot(),
      v2Snapshot(),
      v3Snapshot(),
      baseSnapshot(),
      v5Snapshot(),
      v6Snapshot(),
    ]) {
      const view = mapSnapshotToDashboard(snapshot);

      expect(view.sectorBenchmark.state).toBe('not_collected');
      expect(view.sectorBenchmark.windows).toEqual([]);
      if (snapshot.schemaVersion !== 6) {
        expect(view.dataDates.map(item => item.label)).not.toContain('業種指数比較');
      }
    }
  });

  test('passes through V7 sector short-selling flow values and stored ratios without recalculation', () => {
    const base = v7Snapshot();
    const snapshot: AnalysisSnapshotV7 = {
      ...base,
      dataDates: { ...base.dataDates, sectorShortRatio: '2026-08-21' },
      sectorShortRatio: {
        analysisAsOfDate: '2026-08-21',
        issuerCode: '72030',
        sector: {
          classificationDate: '2026-08-21',
          sectorCode: '3700',
          sectorName: '輸送用機器',
        },
        dataDate: '2026-08-21',
        observations: [
          {
            date: '2026-08-20',
            nonShortSellingValue: 100,
            restrictedShortSellingValue: 0,
            unrestrictedShortSellingValue: 0,
            shortSellingValue: 0,
            totalSellingValue: 100,
            shortSellingRatio: 0,
            unavailable: [],
          },
          {
            date: '2026-08-21',
            nonShortSellingValue: 100,
            restrictedShortSellingValue: 20,
            unrestrictedShortSellingValue: 30,
            shortSellingValue: 999,
            totalSellingValue: 1_099,
            shortSellingRatio: 0.9,
            unavailable: [],
          },
        ],
        unavailable: [],
        provenance: {
          classification: { source: 'jquants', endpoint: '/v2/equities/master' },
          flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
          calculation: { source: 'sector_short_ratio_engine' },
        },
        units: {
          nonShortSellingValue: 'JPY',
          restrictedShortSellingValue: 'JPY',
          unrestrictedShortSellingValue: 'JPY',
          shortSellingValue: 'JPY',
          totalSellingValue: 'JPY',
          shortSellingRatio: 'ratio',
        },
      },
      unavailable: base.unavailable.filter(item => item.section !== 'sectorShortRatio'),
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.sectorShortRatio).toMatchObject({
      state: 'available',
      analysisAsOfDate: { text: '2026-08-21', available: true },
      classificationDate: { text: '2026-08-21', available: true },
      sectorCode: { text: '3700', available: true },
      sectorName: { text: '輸送用機器', available: true },
      dataDate: { text: '2026-08-21', available: true },
      unavailableReasons: [],
    });
    expect(view.sectorShortRatio.observations[0]).toEqual({
      date: { text: '2026-08-21', available: true },
      nonShortSellingValue: { text: '¥100', available: true },
      restrictedShortSellingValue: { text: '¥20', available: true },
      unrestrictedShortSellingValue: { text: '¥30', available: true },
      shortSellingValue: { text: '¥999', available: true },
      totalSellingValue: { text: '¥1,099', available: true },
      shortSellingRatio: { text: '90%', available: true },
      unavailableReasons: [],
    });
    expect(view.sectorShortRatio.observations[1]?.shortSellingRatio).toEqual({
      text: '0%', available: true,
    });
    expect(view.dataDates).toContainEqual({
      label: '業種別空売り比率',
      value: { text: '2026-08-21', available: true },
    });
    expect(SECTOR_SHORT_RATIO_CONTEXT_NOTE).toContain('個別銘柄の空売り残高');
    expect(SECTOR_SHORT_RATIO_CONTEXT_NOTE).toContain('合算');
    expect(SECTOR_SHORT_RATIO_CONTEXT_NOTE).toContain('買い／売りシグナル');
  });

  test('keeps sector short-ratio unavailable observations and empty source distinct from zero', () => {
    const base = v7Snapshot();
    const unavailableObservation: AnalysisSnapshotV7 = {
      ...base,
      sectorShortRatio: {
        analysisAsOfDate: '2026-08-21',
        issuerCode: '72030',
        sector: {
          classificationDate: '2026-08-21', sectorCode: '3700', sectorName: '輸送用機器',
        },
        dataDate: '2026-08-21',
        observations: [{
          date: '2026-08-21',
          nonShortSellingValue: null,
          restrictedShortSellingValue: 0,
          unrestrictedShortSellingValue: 0,
          shortSellingValue: null,
          totalSellingValue: null,
          shortSellingRatio: null,
          unavailable: [{ reason: 'missing_data' }],
        }],
        unavailable: [],
        provenance: {
          classification: { source: 'jquants', endpoint: '/v2/equities/master' },
          flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
          calculation: { source: 'sector_short_ratio_engine' },
        },
        units: {
          nonShortSellingValue: 'JPY', restrictedShortSellingValue: 'JPY',
          unrestrictedShortSellingValue: 'JPY', shortSellingValue: 'JPY',
          totalSellingValue: 'JPY', shortSellingRatio: 'ratio',
        },
      },
    };
    const observation = mapSnapshotToDashboard(
      unavailableObservation,
    ).sectorShortRatio.observations[0];
    expect(observation?.shortSellingRatio).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(observation?.unavailableReasons).toEqual(['missing data']);

    const noData: AnalysisSnapshotV7 = {
      ...base,
      sectorShortRatio: {
        ...unavailableObservation.sectorShortRatio!,
        dataDate: null,
        observations: [],
        unavailable: [{ reason: 'no_sector_short_ratio_data' }],
      },
    };
    const noDataView = mapSnapshotToDashboard(noData).sectorShortRatio;
    expect(noDataView.state).toBe('unavailable');
    expect(noDataView.observations).toEqual([]);
    expect(noDataView.unavailableReasons).toEqual(['no sector short ratio data']);
  });

  test('treats V1-V6 and a null V7 sector short ratio as not collected', () => {
    for (const snapshot of [
      v1Snapshot(), v2Snapshot(), v3Snapshot(), baseSnapshot(),
      v5Snapshot(), v6Snapshot(), v7Snapshot(),
    ]) {
      const view = mapSnapshotToDashboard(snapshot);
      expect(view.sectorShortRatio.state).toBe('not_collected');
      expect(view.sectorShortRatio.observations).toEqual([]);
      if (snapshot.schemaVersion !== 7) {
        expect(view.dataDates.map(item => item.label)).not.toContain('業種別空売り比率');
      }
    }
  });

  test('treats V1 Advanced Technical as not collected', () => {
    const view = mapSnapshotToDashboard(v1Snapshot());

    expect(view.advancedTechnical).toBeNull();
    expect(view.dataDates.map(item => item.label)).not.toContain('Advanced Technical');
  });

  test('keeps structured narrative nullable and only passes through typed values', () => {
    const unavailableView = mapSnapshotToDashboard(baseSnapshot());
    expect(unavailableView.scenarios).toBeNull();
    expect(unavailableView.risks).toBeNull();

    const scenarios = {
      bull: { condition: 'Bull condition', evidence: ['Bull evidence'], invalidation: 'Bull invalidation' },
      base: { condition: 'Base condition', evidence: ['Base evidence'], invalidation: 'Base invalidation' },
      bear: { condition: 'Bear condition', evidence: ['Bear evidence'], invalidation: 'Bear invalidation' },
    };
    const risks = [{ category: 'Market', description: 'Typed risk', relatedSection: 'strategy' as const }];
    const typedView = mapSnapshotToDashboard({ ...baseSnapshot(), scenarios, risks });

    expect(typedView.scenarios).toEqual(scenarios);
    expect(typedView.risks).toEqual(risks);
  });

  test('does not invent an exact entry from a strictly-above trigger', () => {
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      strategy: {
        dataDate: '2026-08-21',
        entry: {
          triggerPrice: 2_900,
          price: null,
          reason: 'breakout_above_swing_high',
          trigger: 'strictly_above',
          tickSizeApplied: null,
        },
        candidates: [],
        unavailable: [{
          candidate: 'entry',
          reason: 'missing_tick_size_for_executable_entry',
          price: 2_900,
        }],
      },
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.strategy?.trigger).toEqual({ text: '> ¥2,900', available: true });
    expect(view.strategy?.exactEntry).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(view.strategy?.candidates).toEqual([]);
  });

  test('shows market-cap priority as unavailable when the snapshot says it was not applied', () => {
    const base = baseSnapshot();
    const snapshot: AnalysisSnapshot = {
      ...base,
      dataDates: { ...base.dataDates, peerComparison: '2026-08-21' },
      peerComparison: peerComparison(false),
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.peer?.marketCapPriority).toEqual({ text: '未適用', available: false });
    expect(view.peer?.marketCapPriorityReason).toBe('incomplete peer market cap');
    expect(view.peer?.selectionState).toBe('available');
    expect(view.peer?.selectedPeerCount).toBe(5);
    expect(view.peer?.polygonPercentiles).toEqual(Array.from({ length: 7 }, () => 0.75));
    expect(view.peer?.rows[0].rank.text).toBe('2.5 / 5');
    expect(view.peer?.rows[0]).toMatchObject({
      direction: 'lower_is_better',
      sampleSize: { text: '4 / 選定 5 社', available: true },
      dataDate: { text: '2026-08-21', available: true },
      state: 'available',
      stateText: '利用可能',
    });
  });

  test('preserves invalid Peer values in the exact table while suppressing the polygon', () => {
    const peer = peerComparison(true)!;
    peer.result.positions.roe.percentile = 1.2;
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      peerComparison: peer,
    };

    const view = mapSnapshotToDashboard(snapshot);
    const roe = view.peer?.rows.find(row => row.metric === 'roe');

    expect(view.peer?.polygonPercentiles).toBeNull();
    expect(roe).toMatchObject({
      percentile: { text: '1.2 / 120%', available: true },
      state: 'invalid',
      stateText: '保存値不整合 (position_structure_mismatch)',
    });
  });

  test('fails closed on a builder-reachable top-level Peer unavailable conflict', () => {
    const input = snapshotInput();
    input.peerComparison = peerComparison(true)!.result;
    input.peerCandidateMarketCapsComplete = true;
    input.additionalUnavailable = [{
      section: 'peerComparison',
      metric: 'roe',
      reason: 'additional_validation_failure',
    }];
    const snapshot = buildAnalysisSnapshot(input);

    expect(snapshot.unavailable).toContainEqual({
      section: 'peerComparison',
      metric: 'roe',
      reason: 'additional_validation_failure',
    });
    const view = mapSnapshotToDashboard(snapshot);
    expect(view.peer?.polygonPercentiles).toBeNull();
    expect(view.peer?.rows.find(row => row.metric === 'roe')).toMatchObject({
      state: 'invalid',
      stateText: '保存値不整合 (snapshot_unavailable_conflict)',
    });
  });

  test('preserves a repeating stored Peer percentile losslessly in the exact table', () => {
    const peer = peerComparison(true)!;
    peer.result.selection.peers.push({
      ...structuredClone(peer.result.selection.peers[0]!),
      id: '7299',
      name: '比較企業6',
    });
    peer.result.selection.sameSectorCandidateCount = 6;
    peer.result.selection.marketCapPrioritizedPeerCount = 6;
    const storedPercentile = 5 / 6;
    Object.assign(peer.result.positions.roe, {
      percentile: storedPercentile,
      peerSampleSize: 6,
      cohortSize: 7,
    });
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      peerComparison: peer,
    };

    const percentile = mapSnapshotToDashboard(snapshot).peer?.rows
      .find(row => row.metric === 'roe')?.percentile;

    expect(percentile).toEqual({
      text: `${String(storedPercentile)} / ${String(storedPercentile * 100)}%`,
      available: true,
    });
    expect(Number(percentile?.text.split(' / ')[0])).toBe(storedPercentile);
  });

  test('passes through only complete adjusted OHLC bars and precomputed latest levels', () => {
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      technical: {
        dataDate: '2026-08-21',
        ma20: 2_800,
        atr14: 65,
        averageVolume20: 12_000_000,
        trend: 'uptrend',
        latestSwingHigh: 2_900,
        latestSwingLow: 2_650,
        unavailable: [],
      },
      advancedTechnical: {
        dataDate: '2026-08-21',
        rsi14: 60,
        macd: { value: 10, signal: 8, histogram: 2 },
        bollinger20: { middle: 2_800, upper: 3_100, lower: 2_500 },
        unavailable: [],
      },
      priceHistory: [
        { date: '2026-08-20', open: 2_700, high: 2_800, low: 2_650, close: 2_780, volume: 10_000 },
        { date: '2026-08-21', open: null, high: 2_900, low: 2_700, close: 2_850, volume: null },
      ],
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.chart.bars).toEqual([{
      date: '2026-08-20',
      open: 2_700,
      high: 2_800,
      low: 2_650,
      close: 2_780,
      volume: 10_000,
    }]);
    expect(view.chart.priceLines.map(line => [line.label, line.price, line.displayPrice])).toEqual([
      ['SMA 20', 2_800, { text: '¥2,800', available: true }],
      ['Swing High', 2_900, { text: '¥2,900', available: true }],
      ['Swing Low', 2_650, { text: '¥2,650', available: true }],
    ]);
    expect(view.chart.startDate).toEqual({ text: '2026-08-20', available: true });
    expect(view.chart.endDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.chart.latestClose).toEqual({ text: '¥2,850', available: true });
  });

  test('keeps a stored latest row with a null close unavailable in chart description metadata', () => {
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      priceHistory: [
        { date: '2026-08-20', open: 2_700, high: 2_800, low: 2_650, close: 2_780, volume: 10_000 },
        { date: '2026-08-21', open: 2_780, high: 2_900, low: 2_700, close: null, volume: 12_000 },
      ],
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.chart.bars).toHaveLength(1);
    expect(view.chart.startDate).toEqual({ text: '2026-08-20', available: true });
    expect(view.chart.endDate).toEqual({ text: '2026-08-21', available: true });
    expect(view.chart.latestClose).toEqual({ text: UNAVAILABLE_TEXT, available: false });
  });
});

describe('watchlist presentation mapping', () => {
  test('maps latest metrics without recalculation and keeps missing values unavailable', () => {
    const snapshot = watchlistSnapshot(
      '7203',
      '2026-08-23T01:02:03.000Z',
      '2026-08-21',
    );
    const view = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(snapshot),
      new Date('2026-08-23T00:00:00.000Z'),
    );

    expect(view).toMatchObject({
      ticker: '7203',
      price: { text: '¥2,850', available: true },
      per: { text: '12.4x', available: true },
      pbr: { text: '1.1x', available: true },
      roe: { text: '12%', available: true },
      trend: { text: 'uptrend', available: true },
      marginPercentile: { text: '80%', available: true },
      beta250: { text: '1.05', available: true },
      latestDataDateRaw: '2026-08-21',
      stale: false,
    });

    const missing = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(baseSnapshot()),
    );
    expect(missing.price).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(missing.marginPercentile).toEqual({ text: UNAVAILABLE_TEXT, available: false });
    expect(missing.beta250).toEqual({ text: UNAVAILABLE_TEXT, available: false });
  });

  test('marks only source dates older than the explicit seven-day UI threshold stale', () => {
    const referenceDate = new Date('2026-08-23T18:30:00.000Z');
    const boundary = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(
        watchlistSnapshot('7203', '2026-08-23T00:00:00.000Z', '2026-08-16'),
      ),
      referenceDate,
    );
    const stale = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(
        watchlistSnapshot('6758', '2026-08-23T00:00:00.000Z', '2026-08-15'),
      ),
      referenceDate,
    );

    expect(WATCHLIST_STALE_AFTER_DAYS).toBe(7);
    expect(boundary.stale).toBeFalse();
    expect(stale.stale).toBeTrue();
  });

  test('uses the newest V7 sector short-ratio date for Watchlist freshness', () => {
    const base = v7Snapshot();
    const snapshot: AnalysisSnapshotV7 = {
      ...base,
      dataDates: {
        ...base.dataDates,
        sectorShortRatio: '2026-08-22',
      },
      sectorShortRatio: {
        analysisAsOfDate: '2026-08-22',
        issuerCode: '72030',
        sector: {
          classificationDate: '2026-08-21',
          sectorCode: '3700',
          sectorName: '輸送用機器',
        },
        dataDate: '2026-08-22',
        observations: [{
          date: '2026-08-22',
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
          classification: { source: 'jquants', endpoint: '/v2/equities/master' },
          flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
          calculation: { source: 'sector_short_ratio_engine' },
        },
        units: {
          nonShortSellingValue: 'JPY',
          restrictedShortSellingValue: 'JPY',
          unrestrictedShortSellingValue: 'JPY',
          shortSellingValue: 'JPY',
          totalSellingValue: 'JPY',
          shortSellingRatio: 'ratio',
        },
      },
      unavailable: base.unavailable.filter(item => item.section !== 'sectorShortRatio'),
    };

    const latest = buildAnalysisSnapshotLatestItem(snapshot);
    const view = mapLatestAnalysisToWatchlistItem(
      latest,
      new Date('2026-08-29T18:30:00.000Z'),
    );

    expect(latest.latestSourceDataDate).toBe('2026-08-22');
    expect(view.latestDataDateRaw).toBe('2026-08-22');
    expect(view.stale).toBeFalse();
  });

  test('sorts by generatedAt or latest source data date with missing dates last', () => {
    const referenceDate = new Date('2026-08-23T00:00:00.000Z');
    const newestGenerated = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(
        watchlistSnapshot('7203', '2026-08-23T02:00:00.000Z', '2026-08-20'),
      ),
      referenceDate,
    );
    const newestData = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(
        watchlistSnapshot('6758', '2026-08-22T02:00:00.000Z', '2026-08-21'),
      ),
      referenceDate,
    );
    const missingSnapshot: AnalysisSnapshotV4 = {
      ...baseSnapshot(),
      canonicalTicker: '130A',
      companyName: '130A株式会社',
      dataDates: {
        identity: null,
        fundamental: null,
        valuation: { price: null, financial: null },
        peerComparison: null,
        technical: null,
        advancedTechnical: null,
        reportedShortPositions: null,
        supplyDemand: null,
        marketCorrelation: null,
        strategy: null,
        priceHistory: null,
      },
    };
    const missingData = mapLatestAnalysisToWatchlistItem(
      buildAnalysisSnapshotLatestItem(missingSnapshot),
      referenceDate,
    );

    expect(sortWatchlistItems(
      [newestGenerated, newestData, missingData],
      'generatedAt',
    ).map(item => item.ticker)).toEqual(['7203', '130A', '6758']);
    expect(sortWatchlistItems(
      [newestGenerated, newestData, missingData],
      'latestDataDate',
    ).map(item => item.ticker)).toEqual(['6758', '7203', '130A']);
  });

  test('builds and parses safe detail navigation without a router dependency', () => {
    expect(buildDetailPath('130A')).toBe('/?ticker=130A&tab=report');
    expect(buildDetailPath('7203', 'market', '?snapshot=v9&ticker=130A&tab=technical'))
      .toBe('/?snapshot=v9&ticker=7203&tab=market');
    expect(buildWatchlistPath('?snapshot=v9&ticker=7203&tab=market'))
      .toBe('/?snapshot=v9');
    expect(buildWatchlistPath('?ticker=7203&tab=market')).toBe('/');
    expect(buildDetailPath(
      '6758',
      'report',
      '?ticker=7203&tab=market&base=old&target=new&validationRun=run&validationCase=case&future=keep',
    )).toBe('/?ticker=6758&tab=report&future=keep');
    expect(buildDashboardTabPath(
      '7203',
      'technical',
      '?ticker=7203&tab=report&base=old&target=new&validationRun=run&validationCase=case&future=keep',
    )).toBe('/?ticker=7203&tab=technical&base=old&target=new&validationRun=run&validationCase=case&future=keep');
    expect(buildWatchlistPath(
      '?ticker=7203&tab=report&base=old&target=new&validationRun=run&validationCase=case&future=keep',
    )).toBe('/?future=keep');
    expect(parseDetailTicker('?ticker=7203')).toBe('7203');
    expect(parseDetailTicker('?ticker=130A')).toBe('130A');
    expect(parseDetailTicker('?ticker=../7203')).toBeNull();
    expect(parseDetailTicker('?ticker=72030')).toBeNull();
  });

  test('uses stable tabs and canonicalizes missing or unknown detail tabs to report', () => {
    expect(DASHBOARD_TABS.map(tab => tab.id)).toEqual([
      'report',
      'technical',
      'fundamentals',
      'supply-demand',
      'market',
      'validation',
    ]);
    expect(new Set(DASHBOARD_TABS.map(tab => tab.id)).size).toBe(DASHBOARD_TABS.length);
    expect(DEFAULT_DASHBOARD_TAB).toBe('report');
    expect(parseDetailTab('?ticker=7203&tab=technical')).toBe('technical');
    expect(parseDetailTab('?ticker=7203')).toBe('report');
    expect(parseDetailTab('?ticker=7203&tab=unknown')).toBe('report');
    expect(hasCanonicalDetailTab('?ticker=7203&tab=market')).toBeTrue();
    expect(hasCanonicalDetailTab('?ticker=7203')).toBeFalse();
    expect(hasCanonicalDetailTab('?ticker=7203&tab=unknown')).toBeFalse();
  });

  test('maps every V9 Snapshot section to one tab or the persistent area', () => {
    expect(DASHBOARD_SECTION_DESTINATIONS).toEqual({
      identity: 'persistent',
      fundamental: 'persistent',
      valuation: 'persistent',
      priceHistory: 'technical',
      technical: 'technical',
      advancedTechnical: 'technical',
      volumeProfile: 'technical',
      strategy: 'technical',
      peerComparison: 'fundamentals',
      advancedDividend: 'fundamentals',
      supplyDemand: 'supply-demand',
      reportedShortPositions: 'supply-demand',
      investorTypeFlows: 'market',
      marketCorrelation: 'market',
      sectorBenchmark: 'market',
      sectorShortRatio: 'market',
      scenarios: 'report',
      risks: 'report',
    });
  });

  test('keeps fixed unavailable and uncollected navigation counts across V1, V4, V8, and V9 fixtures', () => {
    for (const snapshot of [v1Snapshot(), baseSnapshot(), v8Snapshot(), v9Snapshot()]) {
      const availability = buildDashboardAvailabilityNavigation(snapshot);

      expect(availability.global).toEqual({ unavailable: 10, uncollected: 7 });
      expect(availability.tabs).toEqual({
        report: { unavailable: 2, uncollected: 0 },
        technical: { unavailable: 3, uncollected: 2 },
        fundamentals: { unavailable: 1, uncollected: 1 },
        'supply-demand': { unavailable: 1, uncollected: 1 },
        market: { unavailable: 1, uncollected: 3 },
        validation: { unavailable: 0, uncollected: 0 },
      });
    }
  });

  test('de-duplicates only exact unavailable identities without changing the stored list', () => {
    const snapshot: AnalysisSnapshotV9 = {
      ...v9Snapshot(),
      unavailable: [
        {
          section: 'technical',
          metric: 'rsi14',
          reason: 'missing_data',
          detail: 'same detail',
        },
        {
          section: 'technical',
          metric: 'rsi14',
          reason: 'missing_data',
          detail: 'same detail',
        },
        { section: 'technical', reason: 'missing_data', detail: 'same detail' },
        {
          section: 'technical',
          metric: 'rsi14',
          reason: 'missing_data',
          detail: 'different detail',
        },
        { section: 'fundamental', reason: 'missing_required_section' },
        { section: 'volumeProfile', reason: 'not_collected' },
        { section: 'volumeProfile', reason: 'not_collected' },
      ],
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.availability.global).toEqual({ unavailable: 4, uncollected: 1 });
    expect(view.availability.tabs.technical).toEqual({ unavailable: 3, uncollected: 1 });
    expect(Object.values(view.availability.tabs)
      .reduce((count, tab) => count + tab.unavailable, 0)).toBe(3);
    expect(view.unavailable).toHaveLength(7);
    expect(view.unavailable).toEqual(snapshot.unavailable);
  });

  test('does not infer uncollected from a null field', () => {
    const snapshot: AnalysisSnapshotV9 = {
      ...v9Snapshot(),
      fundamental: null,
      unavailable: [{ section: 'fundamental', reason: 'missing_required_section' }],
    };

    const availability = buildDashboardAvailabilityNavigation(snapshot);

    expect(availability.global).toEqual({ unavailable: 1, uncollected: 0 });
    expect(Object.values(availability.tabs)).toEqual([
      { unavailable: 0, uncollected: 0 },
      { unavailable: 0, uncollected: 0 },
      { unavailable: 0, uncollected: 0 },
      { unavailable: 0, uncollected: 0 },
      { unavailable: 0, uncollected: 0 },
      { unavailable: 0, uncollected: 0 },
    ]);
  });

  test('counts schema absence and stored not-collected as one section each', () => {
    const v1Availability = buildDashboardAvailabilityNavigation(v1Snapshot());
    expect(v1Availability.uncollectedSections.filter(section => section === 'volumeProfile'))
      .toHaveLength(1);

    const v9: AnalysisSnapshotV9 = {
      ...v9Snapshot(),
      volumeProfile: null,
      unavailable: [{ section: 'volumeProfile', reason: 'not_collected' }],
    };
    const v9Availability = buildDashboardAvailabilityNavigation(v9);
    expect(v9Availability.global).toEqual({ unavailable: 0, uncollected: 1 });
    expect(v9Availability.uncollectedSections.filter(section => section === 'volumeProfile'))
      .toHaveLength(1);
  });

  test('moves automatic tab activation with wrapping and Home/End behavior', () => {
    expect(moveDashboardTab('report', 'ArrowLeft')).toBe('validation');
    expect(moveDashboardTab('market', 'ArrowRight')).toBe('validation');
    expect(moveDashboardTab('validation', 'ArrowRight')).toBe('report');
    expect(moveDashboardTab('technical', 'ArrowRight')).toBe('fundamentals');
    expect(moveDashboardTab('market', 'Home')).toBe('report');
    expect(moveDashboardTab('report', 'End')).toBe('validation');
  });
});
