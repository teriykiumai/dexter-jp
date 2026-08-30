import { buildAnalysisSnapshot } from '../snapshot/builder.js';
import {
  digestValidatedAnalysisSnapshot,
  type Phase3SnapshotInput,
} from '../snapshot/canonical-json.js';
import { createSnapshotId } from '../snapshot/repository.js';
import {
  AnalysisSnapshotSchema,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV9,
} from '../snapshot/schema.js';

function correlationWindow(period: 20 | 60 | 250, offset = 0) {
  return {
    period,
    startDate: period === 20 ? '2026-07-24' : period === 60 ? '2026-05-29' : '2025-08-22',
    endDate: '2026-08-21',
    observations: period,
    correlation: 0.6 + offset,
    beta: 1.1 + offset,
    alphaAnnualized: 0.02 + offset,
    rSquared: 0.36 + offset,
    stockVolatilityAnnualized: 0.25 + offset,
    benchmarkVolatilityAnnualized: 0.18 + offset,
    excessReturn: 0.03 + offset,
    unavailable: [],
  };
}

function volumeProfile() {
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-22T01:00:00.000Z',
    issuerCode: '72030',
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
      effectiveBinCount: 1,
      minPrice: 2_900,
      maxPrice: 3_100,
    },
    bins: [{
      index: 0,
      lowerPrice: 2_900,
      upperPrice: 3_100,
      representativePrice: 3_000,
      allocatedVolume: 1_000,
      volumeShare: 1,
    }],
    poc: { binIndex: 0, price: 3_000, allocatedVolume: 1_000, volumeShare: 1 },
    valueArea: {
      targetVolumeShare: 0.7 as const,
      achievedVolumeShare: 1,
      val: 2_900,
      vah: 3_100,
      firstBinIndex: 0,
      lastBinIndex: 0,
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
      basisAuditRequiredThroughDate: '2026-08-21',
      basisAuditThroughDate: '2026-08-21',
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

export function comparisonInput(generatedAt = '2026-08-22T01:00:00.000Z'): AnalysisSnapshotInput {
  const strategyEntry = {
    triggerPrice: 3_050,
    price: 3_051,
    reason: 'breakout_above_swing_high' as const,
    trigger: 'strictly_above' as const,
    tickSizeApplied: 1,
  };
  const strategyCandidate = (
    stopReason: 'latest_swing_low' | 'entry_minus_1_5_atr',
    stopPrice: number,
  ) => ({
    entry: strategyEntry,
    stop: { price: stopPrice, reason: stopReason },
    target: { price: 3_051 + 2 * (3_051 - stopPrice), reason: 'risk_reward_2R' as const },
    risk: 3_051 - stopPrice,
    reward: 2 * (3_051 - stopPrice),
    rewardRisk: 2,
  });

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
    generatedAt,
    fundamental: {
      periods: [{
        fiscalYear: 2026,
        submitDate: '2026-06-10',
        revenue: 48_000,
        operatingIncome: 4_000,
        ordinaryIncome: 4_500,
        netIncome: 3_000,
        eps: 200,
        roe: 0.12,
        equityRatio: 0.4,
        operatingCashFlow: 5_000,
        freeCashFlow: 2_000,
      }],
      sourceUrls: ['https://example.test/financials'],
    },
    valuation: {
      priceDataDate: '2026-08-21',
      financialDataDate: '2026-06-10',
      latestFiscalYear: 2026,
      currentPrice: 3_000,
      per: 15,
      pbr: 1.2,
      dividendYieldPercent: 2.5,
      revenueCagrPercent: 5,
      cagrStartFiscalYear: 2021,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 5,
      unavailable: [],
    },
    peerComparison: null,
    peerCandidateMarketCapsComplete: null,
    technical: {
      dataDate: '2026-08-21',
      ma20: 2_950,
      atr14: 80,
      averageVolume20: 20_000_000,
      trend: 'uptrend',
      latestSwingHigh: 3_050,
      latestSwingLow: 2_800,
      unavailable: [],
    },
    advancedTechnical: {
      dataDate: '2026-08-21',
      rsi14: 62.5,
      macd: { value: 45, signal: 40, histogram: 5 },
      bollinger20: { middle: 2_950, upper: 3_150, lower: 2_750 },
      unavailable: [],
    },
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
      buyingBalance: 10_000,
      sellingBalance: 2_000,
      marginRatio: 5,
      buyingBalanceWeeklyChange: 100,
      sellingBalanceWeeklyChange: -100,
      mean4w: 9_500,
      mean13w: 9_000,
      mean52w: 8_000,
      deviation52w: 0.25,
      percentile52w: 0.8,
      averageDailyVolume20: 20_000_000,
      digestionDays: 0.0005,
      unavailable: [],
    },
    reportedShortPositions: null,
    investorTypeFlows: null,
    marketCorrelation: {
      benchmark: 'TOPIX',
      dataDate: '2026-08-21',
      alignedPriceCount: 251,
      windows: WINDOW_VALUES,
    },
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
      alignedPriceCount: 251,
      windows: WINDOW_VALUES,
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
    sectorShortRatio: null,
    advancedDividend: {
      analysisAsOfDate: '2026-08-21',
      collectedAt: '2026-08-21T10:00:00.000Z',
      issuerCode: '72030',
      dataDate: '2026-08-20',
      observations: [
        {
          kind: 'actual',
          fiscalYearEndDate: '2026-03-31',
          disclosedDate: '2026-06-10',
          disclosedTime: '15:00:00',
          sourceEligibleDate: '2026-06-11',
          disclosureNumber: '20260610000001',
          sourceField: 'DivAnn',
          payoutRatioSourceField: 'PayoutRatioAnn',
          annualDividendPerShare: 90,
          payoutRatio: 0.3,
        },
        {
          kind: 'company_forecast',
          fiscalYearEndDate: '2027-03-31',
          disclosedDate: '2026-08-20',
          disclosedTime: '15:00:00',
          sourceEligibleDate: '2026-08-21',
          disclosureNumber: '20260820000001',
          sourceField: 'FDivAnn',
          payoutRatioSourceField: 'FPayoutRatioAnn',
          annualDividendPerShare: 100,
          payoutRatio: 0.35,
        },
      ],
      events: [
        {
          notifiedDate: '2026-08-20',
          notifiedTime: '15:00',
          sourceEligibleDate: '2026-08-21',
          referenceNumber: 'event-1',
          corporateActionReferenceNumber: 'action-1',
          kind: 'interim',
          decision: 'forecast',
          recordDateYearMonth: '2026-09',
          dividendPerShare: 50,
          ordinaryDividendPerShare: 45,
          commemorativeDividendPerShare: 5,
          specialDividendPerShare: null,
          recordDate: '2026-09-30',
          rightsRecordDate: '2026-09-30',
          exDate: '2026-09-29',
          paymentDate: null,
        },
        {
          notifiedDate: '2026-08-20',
          notifiedTime: '15:00',
          sourceEligibleDate: '2026-08-21',
          referenceNumber: 'event-2',
          corporateActionReferenceNumber: 'action-2',
          kind: 'fiscal_year_end',
          decision: 'forecast',
          recordDateYearMonth: '2027-03',
          dividendPerShare: 50,
          ordinaryDividendPerShare: 50,
          commemorativeDividendPerShare: null,
          specialDividendPerShare: null,
          recordDate: '2027-03-31',
          rightsRecordDate: '2027-03-31',
          exDate: '2027-03-30',
          paymentDate: null,
        },
      ],
      unavailable: [],
      provenance: {
        financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
        dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
        availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
        calculation: { source: 'advanced_dividend_engine' },
      },
      units: { dividendPerShare: 'JPY_per_share', payoutRatio: 'ratio' },
    },
    volumeProfile: volumeProfile(),
    strategy: {
      dataDate: '2026-08-21',
      entry: strategyEntry,
      candidates: [
        strategyCandidate('latest_swing_low', 2_800),
        strategyCandidate('entry_minus_1_5_atr', 2_931),
      ],
      unavailable: [],
    },
    priceHistory: [
      { date: '2026-08-20', open: 2_980, high: 3_020, low: 2_970, close: 3_000, volume: 10_000 },
      { date: '2026-08-21', open: 3_000, high: 3_050, low: 2_990, close: 3_040, volume: 11_000 },
    ],
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: ['https://example.test/prices'],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: [],
    investorTypeFlowSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: true, financialsFromEdinetDb: true },
      technical: { priceFromJQuants: true },
      supplyDemand: { marginFromJQuants: true, volumeFromJQuants: true },
      marketCorrelation: { stockFromJQuants: true, benchmarkFromJQuants: true },
      reportedShortPositions: { sourceFromJQuants: false },
      investorTypeFlows: { sourceFromJQuants: false, calendarFromJQuants: false },
      sectorBenchmark: { stockFromJQuants: true },
    },
    additionalUnavailable: [],
  };
}

const WINDOW_VALUES = [correlationWindow(20), correlationWindow(60), correlationWindow(250)];

export function comparisonSnapshot(
  generatedAt = '2026-08-22T01:00:00.000Z',
): AnalysisSnapshotV9 {
  return buildAnalysisSnapshot(comparisonInput(generatedAt));
}

const SUPPORTED_SECTIONS_BY_VERSION: Readonly<Record<number, ReadonlySet<string>>> = {
  1: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  2: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  3: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  4: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  5: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'investorTypeFlows', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  6: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'investorTypeFlows', 'sectorBenchmark', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  7: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'investorTypeFlows', 'sectorBenchmark', 'sectorShortRatio', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  8: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'investorTypeFlows', 'sectorBenchmark', 'sectorShortRatio', 'advancedDividend', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
  9: new Set(['identity', 'fundamental', 'valuation', 'peerComparison', 'technical', 'advancedTechnical', 'reportedShortPositions', 'investorTypeFlows', 'sectorBenchmark', 'sectorShortRatio', 'advancedDividend', 'volumeProfile', 'supplyDemand', 'marketCorrelation', 'strategy', 'priceHistory', 'scenarios', 'risks']),
};

export function snapshotAtVersion(snapshot: AnalysisSnapshotV9, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): AnalysisSnapshot {
  const value = structuredClone(snapshot) as unknown as Record<string, unknown>;
  value.schemaVersion = version;
  const unavailable = value.unavailable as { section: string }[];
  value.unavailable = unavailable.filter(item => SUPPORTED_SECTIONS_BY_VERSION[version].has(item.section));
  return AnalysisSnapshotSchema.parse(value);
}

export function phase3Input(snapshot: AnalysisSnapshot): Phase3SnapshotInput {
  return {
    snapshotId: createSnapshotId(snapshot.generatedAt),
    snapshot,
    snapshotDigest: digestValidatedAnalysisSnapshot(snapshot),
  };
}

export function parsedSnapshot(value: unknown): AnalysisSnapshot {
  return AnalysisSnapshotSchema.parse(value);
}
