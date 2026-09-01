import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { expect, test, type Page } from 'playwright/test';
import {
  AnalysisSnapshotSchema,
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  AnalysisSnapshotV4Schema,
  AnalysisSnapshotV5Schema,
  AnalysisSnapshotV6Schema,
  AnalysisSnapshotV7Schema,
  AnalysisSnapshotV8Schema,
  AnalysisSnapshotV9Schema,
  buildAnalysisSnapshot,
  createSnapshotId,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV9,
} from '../../analysis/snapshot/index.js';
import { digestValidatedAnalysisSnapshot } from '../../analysis/snapshot/canonical-json.js';
import { comparisonSnapshot } from '../../analysis/comparison/test-fixtures.js';
import {
  compareAnalysisSnapshotsV1,
  comparisonFailureV1,
} from '../../analysis/comparison/index.js';
import {
  DASHBOARD_TABS,
  buildDashboardAvailabilityNavigation,
  type DashboardTabId,
} from './presentation.js';
import { COMPARISON_PAIR_REQUIREMENT } from './comparison.js';
import {
  campaignCandidateCase,
  snapshotCandidateCase,
  validationRun,
  validationSource,
} from '../../analysis/strategy-validation/artifact-test-fixtures.js';

type RadarMetric = 'per' | 'pbr' | 'roe' | 'roic' | 'operatingMargin'
  | 'revenueGrowth' | 'dividendYield';

function snapshotInput(ticker: string): AnalysisSnapshotInput {
  return {
    identity: {
      canonicalTicker: ticker,
      companyName: `${ticker} テスト株式会社`,
      industry: 'テスト業種',
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
    volumeProfile: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis\n\nBrowser fixture.',
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

function completeSnapshotInput(ticker: string): AnalysisSnapshotInput {
  const input = snapshotInput(ticker);
  const peerPosition = (
    metric: 'per' | 'pbr' | 'roe' | 'roic' | 'operatingMargin'
      | 'revenueGrowth' | 'dividendYield',
  ) => ({
    metric,
    direction: metric === 'per' || metric === 'pbr'
      ? 'lower_is_better' as const
      : 'higher_is_better' as const,
    targetValue: 10,
    median: 12,
    rank: 1,
    percentile: 1,
    peerSampleSize: 1,
    cohortSize: 2,
  });
  return {
    ...input,
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
      currentPrice: 3_050,
      per: 15,
      pbr: 1.2,
      dividendYieldPercent: 2,
      revenueCagrPercent: 5,
      cagrStartFiscalYear: 2021,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 5,
      unavailable: [],
    },
    peerComparison: {
      target: {
        id: ticker,
        name: `${ticker} テスト株式会社`,
        sector: 'テスト業種',
        marketCap: 1_000,
        dataDate: '2026-06-10',
        metrics: { per: 10 },
      },
      selection: {
        peers: [{
          id: '9999',
          name: '比較株式会社',
          sector: 'テスト業種',
          marketCap: 900,
          dataDate: '2026-06-11',
          metrics: { per: 12 },
        }],
        sameSectorCandidateCount: 1,
        marketCapPrioritizedPeerCount: 1,
        sectorLeaderId: null,
        sectorLeaderIncluded: false,
        tooFewPeers: true,
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
    peerCandidateMarketCapsComplete: true,
    technical: {
      dataDate: '2026-08-21',
      ma20: 2_950,
      atr14: 75,
      averageVolume20: 12_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_800,
      unavailable: [],
    },
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
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
    strategy: {
      dataDate: '2026-08-21',
      entry: {
        triggerPrice: 3_100,
        price: 3_101,
        reason: 'breakout_above_swing_high',
        trigger: 'strictly_above',
        tickSizeApplied: 1,
      },
      candidates: [],
      unavailable: [],
    },
    priceHistory: [
      { date: '2026-08-19', open: 2_900, high: 2_980, low: 2_880, close: 2_960, volume: 10_000 },
      { date: '2026-08-20', open: 2_960, high: 3_040, low: 2_930, close: 3_010, volume: 0 },
      { date: '2026-08-21', open: 3_010, high: 3_080, low: 2_990, close: 3_050, volume: 14_000 },
    ],
  };
}

function v9Snapshot(ticker = '1009'): AnalysisSnapshotV9 {
  return buildAnalysisSnapshot(snapshotInput(ticker));
}

const VERSIONED_SECTIONS = [
  { section: 'advancedTechnical', introducedIn: 2 },
  { section: 'reportedShortPositions', introducedIn: 4 },
  { section: 'investorTypeFlows', introducedIn: 5 },
  { section: 'sectorBenchmark', introducedIn: 6 },
  { section: 'sectorShortRatio', introducedIn: 7 },
  { section: 'advancedDividend', introducedIn: 8 },
  { section: 'volumeProfile', introducedIn: 9 },
] as const;

type SnapshotSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const SNAPSHOT_SCHEMAS: Record<
  SnapshotSchemaVersion,
  { parse: (value: unknown) => AnalysisSnapshot }
> = {
  1: AnalysisSnapshotV1Schema,
  2: AnalysisSnapshotV2Schema,
  3: AnalysisSnapshotV3Schema,
  4: AnalysisSnapshotV4Schema,
  5: AnalysisSnapshotV5Schema,
  6: AnalysisSnapshotV6Schema,
  7: AnalysisSnapshotV7Schema,
  8: AnalysisSnapshotV8Schema,
  9: AnalysisSnapshotV9Schema,
};

function omitProperties(value: object, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function versionedSnapshot(
  ticker: string,
  schemaVersion: SnapshotSchemaVersion,
): AnalysisSnapshot {
  const v9 = v9Snapshot(ticker);
  if (schemaVersion === 9) return v9;
  const laterSections = VERSIONED_SECTIONS
    .filter(item => item.introducedIn > schemaVersion)
    .map(item => item.section);
  const excludedSections = new Set<string>(laterSections);
  const units = omitProperties(v9.units, laterSections);
  if (schemaVersion < 3) {
    units.supplyDemand = omitProperties(v9.units.supplyDemand, ['mean4w']);
  }
  const payload = {
    ...omitProperties(v9, [
      'schemaVersion',
      'dataDates',
      'provenance',
      'units',
      'unavailable',
      ...laterSections,
    ]),
    schemaVersion,
    dataDates: omitProperties(v9.dataDates, laterSections),
    provenance: omitProperties(v9.provenance, laterSections),
    units,
    unavailable: v9.unavailable.filter(item => !excludedSections.has(item.section)),
  };
  return SNAPSHOT_SCHEMAS[schemaVersion].parse(payload);
}

function duplicateStateSnapshot(ticker = '1011'): AnalysisSnapshotV9 {
  const snapshot = v9Snapshot(ticker);
  return AnalysisSnapshotV9Schema.parse({
    ...snapshot,
    unavailable: [
      {
        section: 'technical',
        metric: 'rsi14',
        reason: 'missing_data',
        detail: 'same stored detail',
      },
      {
        section: 'technical',
        metric: 'rsi14',
        reason: 'missing_data',
        detail: 'same stored detail',
      },
      { section: 'volumeProfile', reason: 'not_collected' },
    ],
  });
}

function completeV9Snapshot(ticker = '1010'): AnalysisSnapshotV9 {
  const snapshot = buildAnalysisSnapshot(completeSnapshotInput(ticker));
  const investorValues = { sell: 10, buy: 20, total: 777, balance: -333 };
  const investorBreakdown = {
    individuals: investorValues,
    foreignInvestors: investorValues,
    securitiesCompanies: investorValues,
    investmentTrusts: investorValues,
    businessCorporations: investorValues,
    otherCorporations: investorValues,
    insuranceCompanies: investorValues,
    banks: investorValues,
    trustBanks: investorValues,
    otherFinancialInstitutions: investorValues,
  };

  return AnalysisSnapshotV9Schema.parse({
    ...snapshot,
    technical: {
      dataDate: '2026-08-21',
      ma20: 2_950,
      atr14: 75,
      averageVolume20: 12_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_800,
      unavailable: [],
    },
    advancedTechnical: {
      dataDate: '2026-08-21',
      rsi14: 62.35,
      macd: { value: 42.5, signal: 40.25, histogram: 2.25 },
      bollinger20: { middle: 2_950, upper: 3_100, lower: 2_800 },
      unavailable: [],
    },
    priceHistory: [
      {
        date: '2026-08-19',
        open: 2_900,
        high: 2_980,
        low: 2_880,
        close: 2_960,
        volume: 10_000,
      },
      {
        date: '2026-08-20',
        open: 2_960,
        high: 3_040,
        low: 2_930,
        close: 3_010,
        volume: 0,
      },
      {
        date: '2026-08-21',
        open: 3_010,
        high: 3_080,
        low: 2_990,
        close: 3_050,
        volume: 14_000,
      },
    ],
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
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
    reportedShortPositions: {
      dataDate: '2026-08-20',
      reports: [
        {
          disclosedDate: '2026-08-20',
          calculatedDate: '2026-08-18',
          reporterName: 'Reporter A',
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
          calculatedDate: '2026-08-19',
          reporterName: 'Reporter B',
          discretionaryManagerName: null,
          fundName: null,
          shortPositionRatio: 0,
          shortPositionShares: 0,
          previousCalculatedDate: null,
          previousReportedRatio: null,
          ratioDelta: null,
        },
      ],
      unavailable: [],
    },
    investorTypeFlows: {
      dataDate: '2026-08-20',
      section: 'TokyoNagoya',
      period: {
        publishedDate: '2026-08-20',
        periodStartDate: '2026-08-10',
        periodEndDate: '2026-08-14',
        section: 'TokyoNagoya',
        summary: {
          proprietary: investorValues,
          brokerage: investorValues,
          total: investorValues,
        },
        brokerageBreakdown: investorBreakdown,
      },
      unavailable: [],
    },
    advancedDividend: {
      analysisAsOfDate: '2026-08-24',
      collectedAt: '2026-08-24T03:04:05.000Z',
      issuerCode: `${ticker}0`,
      dataDate: '2026-08-21',
      observations: [{
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
      }],
      events: [{
        notifiedDate: '2026-08-21',
        notifiedTime: null,
        sourceEligibleDate: '2026-08-24',
        referenceNumber: 'event-one',
        corporateActionReferenceNumber: 'ca-one',
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
      }],
      unavailable: [],
      provenance: {
        financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
        dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
        availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
        calculation: { source: 'advanced_dividend_engine' },
      },
      units: { dividendPerShare: 'JPY_per_share', payoutRatio: 'ratio' },
    },
    volumeProfile: {
      analysisAsOfDate: '2026-08-21',
      collectedAt: '2026-08-28T03:04:05.000Z',
      issuerCode: `${ticker}0`,
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
        effectiveBinCount: 2,
        minPrice: 1_000,
        maxPrice: 1_020,
      },
      bins: [
        {
          index: 0,
          lowerPrice: 1_000,
          upperPrice: 1_010,
          representativePrice: 1_005,
          allocatedVolume: 510,
          volumeShare: 0.51,
        },
        {
          index: 1,
          lowerPrice: 1_010,
          upperPrice: 1_020,
          representativePrice: 1_015,
          allocatedVolume: 490,
          volumeShare: 0.49,
        },
      ],
      // Presentation sentinel: the stored POC is deliberately not the largest stored bin.
      poc: { binIndex: 1, price: 1_015, allocatedVolume: 490, volumeShare: 0.49 },
      valueArea: {
        targetVolumeShare: 0.7,
        achievedVolumeShare: 1,
        val: 1_000,
        vah: 1_020,
        firstBinIndex: 0,
        lastBinIndex: 1,
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
    },
    dataDates: {
      ...snapshot.dataDates,
      technical: '2026-08-21',
      advancedTechnical: '2026-08-21',
      supplyDemand: '2026-08-19',
      marketCorrelation: '2026-08-21',
      reportedShortPositions: '2026-08-20',
      investorTypeFlows: '2026-08-20',
      advancedDividend: '2026-08-21',
      volumeProfile: '2026-08-21',
      priceHistory: '2026-08-21',
    },
    unavailable: snapshot.unavailable.filter(item => ![
      'technical',
      'priceHistory',
      'reportedShortPositions',
      'investorTypeFlows',
      'advancedDividend',
      'volumeProfile',
      'advancedTechnical',
      'supplyDemand',
      'marketCorrelation',
    ].includes(item.section)),
  });
}

const snapshots = new Map<string, AnalysisSnapshot>([
  ['1001', versionedSnapshot('1001', 1)],
  ['1002', versionedSnapshot('1002', 2)],
  ['1003', versionedSnapshot('1003', 3)],
  ['1004', versionedSnapshot('1004', 4)],
  ['1005', versionedSnapshot('1005', 5)],
  ['1006', versionedSnapshot('1006', 6)],
  ['1007', versionedSnapshot('1007', 7)],
  ['1008', versionedSnapshot('1008', 8)],
  ['1009', versionedSnapshot('1009', 9)],
  ['1010', completeV9Snapshot()],
  ['1011', duplicateStateSnapshot()],
  ['7203', versionedSnapshot('7203', 9)],
]);

const EXPECTED_UNCOLLECTED_SECTIONS = [
  'advancedTechnical',
  'volumeProfile',
  'advancedDividend',
  'reportedShortPositions',
  'investorTypeFlows',
  'sectorBenchmark',
  'sectorShortRatio',
] as const;

function snapshotFor(ticker: string): AnalysisSnapshot {
  const snapshot = snapshots.get(ticker);
  if (!snapshot) throw new Error(`No browser fixture exists for ${ticker}.`);
  return snapshot;
}

function snapshotWithIdentity(
  ticker: string,
  generatedAt: string,
  companyName = `${ticker} テスト株式会社`,
): AnalysisSnapshot {
  return AnalysisSnapshotSchema.parse({
    ...snapshotFor(ticker),
    companyName,
    generatedAt,
  });
}

function peerRadarSnapshot(
  rawMetricVariant: 'first' | 'second' = 'first',
  issue: 'none' | 'out_of_range' | 'zero_sample' = 'none',
): AnalysisSnapshot {
  const snapshot = structuredClone(snapshotFor('1010'));
  const metrics: Readonly<Record<RadarMetric, number>> = {
    per: 12,
    pbr: 1.2,
    roe: 0.12,
    roic: 0.09,
    operatingMargin: 0.08,
    revenueGrowth: 0.05,
    dividendYield: 0.025,
  };
  const radarMetrics = Object.keys(metrics) as RadarMetric[];
  const percentiles = [0, 1, 1 / 3, 0.25, 0.75, 0.4, 0.6] as const;
  const positions = Object.fromEntries(radarMetrics.map((metric, index) => {
    const peerSampleSize = metric === 'per' ? 1 : metric === 'pbr' ? 4 : metric === 'roe' ? 3 : 5;
    return [metric, {
      metric,
      direction: metric === 'per' || metric === 'pbr'
        ? 'lower_is_better' as const
        : 'higher_is_better' as const,
      targetValue: metrics[metric],
      median: metrics[metric] + 0.5,
      rank: metric === 'pbr' ? 2.5 : 1,
      percentile: percentiles[index],
      peerSampleSize,
      cohortSize: peerSampleSize + 1,
    }];
  })) as Record<RadarMetric, {
    metric: RadarMetric;
    direction: 'higher_is_better' | 'lower_is_better';
    targetValue: number;
    median: number;
    rank: number;
    percentile: number;
    peerSampleSize: number;
    cohortSize: number;
  }>;
  const unavailable: Array<{
    metric: RadarMetric;
    reason: 'missing_target_metric' | 'insufficient_peer_data';
  }> = [];
  if (issue === 'out_of_range') positions.roe.percentile = 1.2;
  if (issue === 'zero_sample') {
    Object.assign(positions.roe, {
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: 0,
      cohortSize: 1,
    });
    unavailable.push({ metric: 'roe', reason: 'insufficient_peer_data' });
  }

  return AnalysisSnapshotSchema.parse({
    ...snapshot,
    dataDates: { ...snapshot.dataDates, peerComparison: '2026-08-21' },
    unavailable: issue === 'zero_sample'
      ? [...snapshot.unavailable, {
          section: 'peerComparison',
          metric: 'roe',
          reason: 'insufficient_peer_data',
        }]
      : snapshot.unavailable,
    peerComparison: {
      result: {
        target: {
          id: '1010',
          name: '1010 テスト株式会社',
          sector: 'テスト業種',
          marketCap: 50_000,
          dataDate: '2026-08-21',
          metrics,
        },
        selection: {
          peers: Array.from({ length: 5 }, (_, index) => ({
            id: `98${index}0`,
            name: `比較企業${index + 1}`,
            sector: 'テスト業種',
            marketCap: 20_000 - index * 1_000,
            dataDate: '2026-08-21',
            metrics: rawMetricVariant === 'first'
              ? { per: -10 - index, roe: null }
              : { per: 100 + index, roe: 100 + index },
          })),
          sameSectorCandidateCount: 5,
          marketCapPrioritizedPeerCount: 5,
          sectorLeaderId: '1010',
          sectorLeaderIncluded: true,
          tooFewPeers: false,
        },
        targetIncludedInStatistics: true,
        positions,
        unavailable,
      },
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap',
    },
  });
}

function historyItemFor(snapshot: AnalysisSnapshot) {
  return {
    snapshotId: new Date(snapshot.generatedAt).toISOString().replace(/[:.]/g, '-'),
    canonicalTicker: snapshot.canonicalTicker,
    companyName: snapshot.companyName,
    generatedAt: snapshot.generatedAt,
    status: snapshot.status,
    dataDates: snapshot.dataDates,
  };
}

let dashboardProcess: ChildProcessWithoutNullStreams;
let baseUrl: string;

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port.');
  await new Promise<void>((resolve, reject) => server.close(error => (
    error ? reject(error) : resolve()
  )));
  return address.port;
}

async function waitForServer(process: ChildProcessWithoutNullStreams): Promise<void> {
  let stderr = '';
  process.stderr.on('data', chunk => {
    stderr += String(chunk);
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Dashboard fixture server exited early: ${stderr.trim()}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling the Dashboard bundle.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Dashboard fixture server did not become ready.');
}

async function mockSnapshotApi(
  page: Page,
  responseDelayMs: Readonly<Record<string, number>> = {},
): Promise<void> {
  await page.route('**/api/analyses/**', async route => {
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    const ticker = segments[2] ?? '';
    const delay = responseDelayMs[ticker] ?? 0;
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    const snapshot = snapshotFor(ticker);
    const body = segments[3] === 'history' && segments.length === 4
      ? [historyItemFor(snapshot)]
      : snapshot;
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });
}

async function mockComparisonApi(
  page: Page,
  fixtureSnapshots: readonly AnalysisSnapshot[],
  requestLog: string[] = [],
): Promise<void> {
  const ordered = [...fixtureSnapshots].sort((left, right) => (
    Date.parse(left.generatedAt) - Date.parse(right.generatedAt)
  ));
  const ticker = ordered[0]?.canonicalTicker;
  if (!ticker || ordered.some(snapshot => snapshot.canonicalTicker !== ticker)) {
    throw new Error('Comparison browser fixtures must have one canonical ticker.');
  }
  const byId = new Map(ordered.map(snapshot => [createSnapshotId(snapshot.generatedAt), snapshot]));
  await page.route('**/api/analyses/**', async route => {
    const url = new URL(route.request().url());
    const segments = url.pathname.split('/').filter(Boolean);
    requestLog.push(`${url.pathname}${url.search}`);
    if (segments[2] !== ticker) {
      await route.fulfill({ body: '{}', contentType: 'application/json', status: 404 });
      return;
    }
    if (segments[3] === 'history' && segments.length === 4) {
      await route.fulfill({
        body: JSON.stringify([...ordered].reverse().map(historyItemFor)),
        contentType: 'application/json; charset=utf-8',
        status: 200,
      });
      return;
    }
    if (segments[3] === 'history' && segments.length === 5) {
      const snapshot = byId.get(segments[4] ?? '');
      await route.fulfill({
        body: JSON.stringify(snapshot ?? {}),
        contentType: 'application/json; charset=utf-8',
        status: snapshot ? 200 : 404,
      });
      return;
    }
    if (segments[3] === 'comparison') {
      const baseSnapshotId = url.searchParams.get('baseSnapshotId') ?? '';
      const targetSnapshotId = url.searchParams.get('targetSnapshotId') ?? '';
      const base = byId.get(baseSnapshotId);
      const target = byId.get(targetSnapshotId);
      if (!base || !target) {
        const response = comparisonFailureV1(
          { ticker, baseSnapshotId, targetSnapshotId },
          base ? 'target_snapshot_not_found' : 'base_snapshot_not_found',
        );
        await route.fulfill({
          body: JSON.stringify(response),
          contentType: 'application/json; charset=utf-8',
          status: 404,
        });
        return;
      }
      const response = compareAnalysisSnapshotsV1({
        ticker,
        base: {
          snapshotId: baseSnapshotId,
          snapshot: base,
          snapshotDigest: digestValidatedAnalysisSnapshot(base),
        },
        target: {
          snapshotId: targetSnapshotId,
          snapshot: target,
          snapshotDigest: digestValidatedAnalysisSnapshot(target),
        },
      });
      await route.fulfill({
        body: JSON.stringify(response),
        contentType: 'application/json; charset=utf-8',
        status: response.outcome === 'success' ? 200 : 400,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(ordered.at(-1)),
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });
}

function strategyValidationBrowserFixture() {
  const source = validationSource();
  const snapshotCase = snapshotCandidateCase(source.digest);
  const snapshotRun = validationRun([snapshotCase]);
  const campaignRunId = '33333333-3333-4333-8333-333333333333';
  const currentTickerCase = campaignCandidateCase(source.digest, {
    runId: campaignRunId,
    caseId: '44444444-4444-4444-8444-444444444444',
    ticker: '7203',
    anchorDate: '2025-01-06',
    targetReason: 'resistance_level',
  });
  const otherTickerCase = campaignCandidateCase(source.digest, {
    runId: campaignRunId,
    caseId: '55555555-5555-4555-8555-555555555555',
    ticker: '6758',
    anchorDate: '2025-01-07',
  });
  const campaignRun = {
    ...validationRun([currentTickerCase, otherTickerCase]),
    warnings: [
      'reconstructed_251_as_of: technical_251_strategy_v1 is a standardized retrospective policy and is not production-pipeline parity.',
    ],
  };
  const job = {
    schemaVersion: 'strategy_validation_job_view_v1' as const,
    jobId: '66666666-6666-4666-8666-666666666666',
    runId: snapshotRun.runId,
    mode: 'snapshot' as const,
    inputDigest: `sha256:${'6'.repeat(64)}` as const,
    selector: snapshotRun.selector,
    startedAt: snapshotRun.startedAt,
    acceptedAt: snapshotRun.acceptedAt,
    executionDeadline: snapshotRun.executionDeadline,
    executionControls: snapshotRun.execution.controls,
    status: 'completed' as const,
    createdAt: snapshotRun.acceptedAt,
    updatedAt: snapshotRun.completedAt,
    finishedAt: snapshotRun.completedAt,
    cancellationRequestedAt: null,
    outcomeAsOfSession: snapshotRun.outcomeAsOfSession,
    expectedRunPayloadDigest: `sha256:${'7'.repeat(64)}` as const,
    progress: {
      attemptCount: snapshotRun.execution.attemptCount,
      caseCount: snapshotRun.caseReferences.length,
    },
    failure: null,
  };
  return {
    campaignRun,
    currentTickerCase,
    job,
    otherTickerCase,
    requests: [] as Array<Readonly<{ method: string; path: string; body: unknown; csrf: string | null }>>,
    snapshotCase,
    snapshotRun,
  };
}

async function mockStrategyValidationApi(
  page: Page,
  fixture: ReturnType<typeof strategyValidationBrowserFixture>,
): Promise<void> {
  const csrfToken = 'x'.repeat(43);
  const runs = [fixture.campaignRun, fixture.snapshotRun];
  const casesByRun = new Map([
    [fixture.snapshotRun.runId, [fixture.snapshotCase]],
    [fixture.campaignRun.runId, [fixture.currentTickerCase, fixture.otherTickerCase]],
  ]);
  const summary = (run: typeof fixture.snapshotRun | typeof fixture.campaignRun) => ({
    schemaVersion: 'strategy_validation_run_summary_v1',
    runId: run.runId,
    mode: run.mode,
    confidence: run.confidence,
    campaignName: run.campaignName,
    completedAt: run.completedAt,
    outcomeAsOfSession: run.outcomeAsOfSession,
    aggregationScope: run.aggregationScope,
    caseCount: run.caseReferences.length,
    warnings: run.warnings,
  });
  const fulfill = async (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200) => {
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: 'application/json; charset=utf-8',
      status,
    });
  };
  await page.route('**/api/session', async route => {
    await fulfill(route, {
      schemaVersion: 'dashboard_session_v1',
      csrfHeader: 'X-Dexter-CSRF',
      csrfToken,
    });
  });
  await page.route('**/api/strategy-validation/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() as unknown : null;
    fixture.requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      body,
      csrf: request.headers()['x-dexter-csrf'] ?? null,
    });
    if (segments[2] === 'preflights' && method === 'POST') {
      await fulfill(route, {
        schemaVersion: 'strategy_validation_preflight_v1',
        preflightId: '77777777-7777-4777-8777-777777777777',
        mode: 'snapshot',
        startedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:10:00.000Z',
        outcomeSessionRule: 'last_official_tse_session_strictly_before_started_tokyo_date',
        inputDigest: `sha256:${'8'.repeat(64)}`,
        tickerCount: 1,
        anchorCount: 1,
        estimatedMinimumAttempts: 3,
        minimumDispatchDurationMs: 24_000,
        rateLimitVersion: 'rolling_attempt_log_v1',
        requestsPerMinute: 5,
        hardMaximumAttempts: 250,
        requestTimeoutMs: 30_000,
        executionBudgetMs: 5_400_000,
        warnings: ['Pagination and retries can increase requests.'],
      });
      return;
    }
    if (segments[2] === 'jobs' && segments[3] === 'active') {
      await fulfill(route, { schemaVersion: 'strategy_validation_active_job_v1', job: null });
      return;
    }
    if (segments[2] === 'jobs' && segments.length === 3 && method === 'POST') {
      await fulfill(route, {
        schemaVersion: 'strategy_validation_job_accepted_v1',
        job: fixture.job,
        statusUrl: `/api/strategy-validation/jobs/${fixture.job.jobId}`,
      }, 202);
      return;
    }
    if (segments[2] === 'jobs' && segments[3] === fixture.job.jobId) {
      await fulfill(route, fixture.job);
      return;
    }
    if (segments[2] !== 'runs') {
      await fulfill(route, { error: { code: 'invalid_route_parameter', message: 'Invalid route.' } }, 400);
      return;
    }
    if (segments.length === 3) {
      const ticker = url.searchParams.get('ticker');
      await fulfill(route, {
        schemaVersion: 'strategy_validation_list_v1',
        items: runs.filter(run => ticker === null || run.aggregationScope.tickers.includes(ticker)).map(summary),
        nextCursor: null,
      });
      return;
    }
    const run = runs.find(value => value.runId === segments[3]);
    if (!run) {
      await fulfill(route, { error: { code: 'run_not_found', message: 'Run not found.' } }, 404);
      return;
    }
    if (segments.length === 4) {
      await fulfill(route, run);
      return;
    }
    const runCases = casesByRun.get(run.runId) ?? [];
    if (segments.length === 5 && segments[4] === 'cases') {
      const ticker = url.searchParams.get('ticker');
      await fulfill(route, {
        schemaVersion: 'strategy_validation_list_v1',
        items: runCases.filter(value => ticker === null || value.ticker === ticker),
        nextCursor: null,
      });
      return;
    }
    const selectedCase = runCases.find(value => value.caseId === segments[5]);
    if (!selectedCase) {
      await fulfill(route, { error: { code: 'case_not_found', message: 'Case not found.' } }, 404);
      return;
    }
    await fulfill(route, selectedCase);
  });
}

interface MockReloadResponse {
  body: unknown;
  delayMs?: number;
  status?: number;
}

async function mockReloadResponses(
  page: Page,
  responses: readonly MockReloadResponse[],
): Promise<void> {
  let responseIndex = 0;
  await page.unroute('**/api/analyses/**');
  await page.route('**/api/analyses/**', async route => {
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean);
    if (segments[3] === 'history' && segments.length === 4) {
      await route.fulfill({
        body: JSON.stringify([historyItemFor(snapshotFor(segments[2] ?? ''))]),
        contentType: 'application/json; charset=utf-8',
        status: 200,
      });
      return;
    }
    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;
    if (!response) throw new Error('No reload fixture response was configured.');
    if (response.delayMs) {
      await new Promise(resolve => setTimeout(resolve, response.delayMs));
    }
    await route.fulfill({
      body: typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body),
      contentType: 'application/json; charset=utf-8',
      status: response.status ?? 200,
    });
  });
}

async function installAbortIgnoringReloadFetch(
  page: Page,
  ticker: string,
  responses: readonly Required<Pick<MockReloadResponse, 'body' | 'delayMs'>>[],
): Promise<void> {
  await page.evaluate(({ requestedTicker, queuedResponses }) => {
    const originalFetch = window.fetch.bind(window);
    let responseIndex = 0;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string') {
        const requestUrl = new URL(input, window.location.href);
        const response = queuedResponses[responseIndex];
        if (
          requestUrl.pathname === `/api/analyses/${requestedTicker}`
          && response
        ) {
          responseIndex += 1;
          return new Promise<Response>(resolve => {
            window.setTimeout(() => resolve(new Response(JSON.stringify(response.body), {
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              status: 200,
            })), response.delayMs);
          });
        }
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { requestedTicker: ticker, queuedResponses: responses });
}

async function mockWatchlistApi(page: Page): Promise<void> {
  await page.route('**/api/analyses', async route => {
    await route.fulfill({
      body: '[]',
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });
}

test.beforeAll(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dashboardProcess = spawn(
    'bun',
    [
      '-e',
      `import { startDashboardServer } from './src/dashboard/server.ts'; startDashboardServer(undefined, ${port});`,
    ],
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  await waitForServer(dashboardProcess);
});

test.afterAll(() => {
  dashboardProcess.kill();
});

async function openDetail(
  page: Page,
  ticker = '1009',
  tab: DashboardTabId = 'report',
  query = '',
): Promise<void> {
  await page.goto(`${baseUrl}/?ticker=${ticker}&tab=${tab}${query}`);
  await waitForSelectedTab(page, tab);
}

async function waitForSelectedTab(page: Page, tab: DashboardTabId): Promise<void> {
  await page.waitForFunction(selectedTab => (
    document.getElementById(`dashboard-tab-${selectedTab}`)?.getAttribute('aria-selected') === 'true'
    && document.querySelector(`#dashboard-panel-${selectedTab}:not([hidden])`) !== null
  ), tab);
}

async function expectSelectedTab(page: Page, tab: DashboardTabId): Promise<void> {
  await waitForSelectedTab(page, tab);
  const state = await page.evaluate(selectedTab => ({
    activeElement: document.activeElement instanceof HTMLElement
      ? document.activeElement.id
      : null,
    selected: document.getElementById(`dashboard-tab-${selectedTab}`)?.getAttribute('aria-selected'),
    visiblePanels: document.querySelectorAll('[role="tabpanel"]:not([hidden])').length,
    visiblePanel: document.querySelector('[role="tabpanel"]:not([hidden])')?.id,
  }), tab);
  expect(state.selected).toBe('true');
  expect(state.visiblePanels).toBe(1);
  expect(state.visiblePanel).toBe(`dashboard-panel-${tab}`);
  expect(new URL(page.url()).searchParams.get('tab')).toBe(tab);
}

test.describe('saved-analysis Comparison browser interaction', () => {
  test('pins an existing target when a valid-form base is missing instead of falling back to latest', async ({ browser }) => {
    const page = await browser.newPage();
    const target = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z', '対象Snapshot株式会社');
    const latest = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z', '最新Snapshot株式会社');
    const baseSnapshotId = createSnapshotId('2026-08-21T01:02:03.000Z');
    const targetSnapshotId = createSnapshotId(target.generatedAt);
    try {
      await mockComparisonApi(page, [target, latest]);
      await page.goto(
        `${baseUrl}/?ticker=1010&tab=report&base=${baseSnapshotId}&target=${targetSnapshotId}`,
      );
      await waitForSelectedTab(page, 'report');

      await expect(page.getByRole('heading', { name: '対象Snapshot株式会社' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '最新Snapshot株式会社' })).toHaveCount(0);
      await expect(page.getByText('基準Snapshotが見つかりません。')).toBeVisible();
      const url = new URL(page.url());
      expect(url.searchParams.get('base')).toBe(baseSnapshotId);
      expect(url.searchParams.get('target')).toBe(targetSnapshotId);
    } finally {
      await page.close();
    }
  });

  test('shows both Observation identities for period and benchmark mismatches', async ({ browser }) => {
    const page = await browser.newPage();
    const base = comparisonSnapshot('2026-08-22T01:02:03.000Z');
    const targetSnapshot = comparisonSnapshot('2026-08-23T01:02:03.000Z');
    const target = AnalysisSnapshotV9Schema.parse({
      ...targetSnapshot,
      valuation: targetSnapshot.valuation && {
        ...targetSnapshot.valuation,
        latestFiscalYear: 2027,
      },
      sectorBenchmark: targetSnapshot.sectorBenchmark && {
        ...targetSnapshot.sectorBenchmark,
        benchmark: targetSnapshot.sectorBenchmark.benchmark && {
          ...targetSnapshot.sectorBenchmark.benchmark,
          indexCode: '0051',
        },
      },
    });
    try {
      await mockComparisonApi(page, [base, target]);
      await openDetail(page, '7203');
      await page.getByRole('button', { name: '比較を開始' }).click();

      const periodRow = page.locator('tr[data-comparison-row="valuation.per"]');
      await periodRow.locator('summary').click();
      await expect(periodRow.locator('dl > div').filter({ hasText: '基準の同一性' }))
        .toContainText('latestFiscalYear=2026');
      await expect(periodRow.locator('dl > div').filter({ hasText: '対象の同一性' }))
        .toContainText('latestFiscalYear=2027');

      const benchmarkRow = page.locator('tr[data-comparison-row="sectorBenchmark.window.correlation"]').first();
      await benchmarkRow.locator('summary').click();
      await expect(benchmarkRow.locator('dl > div').filter({ hasText: '基準の同一性' }))
        .toContainText('indexCode=0050');
      await expect(benchmarkRow.locator('dl > div').filter({ hasText: '対象の同一性' }))
        .toContainText('indexCode=0051');
      await expect(benchmarkRow).toContainText('比較不可: ベンチマーク不一致');
    } finally {
      await page.close();
    }
  });

  test('starts one atomic pair, renders the semantic table, and restores pair-scoped UI state', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const target = snapshotFor('1010');
    const base = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [base, target]);
      await openDetail(page, '1010');
      await page.evaluate(() => {
        const original = window.history.pushState.bind(window.history);
        (window as unknown as { comparisonPushes: string[] }).comparisonPushes = [];
        window.history.pushState = ((state: unknown, unused: string, url?: string | URL | null) => {
          (window as unknown as { comparisonPushes: string[] }).comparisonPushes.push(String(url));
          original(state, unused, url);
        }) as History['pushState'];
      });

      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.getByRole('heading', { name: '保存済み分析の比較' })).toBeVisible();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      expect(await page.locator('.comparison-table').first().locator('thead th').allTextContents())
        .toEqual(['指標', '基準値', '対象値', '差分', '状態']);
      const url = new URL(page.url());
      expect(url.searchParams.get('base')).toBe(createSnapshotId(base.generatedAt));
      expect(url.searchParams.get('target')).toBe(createSnapshotId(target.generatedAt));
      const pushes = await page.evaluate(() => (
        (window as unknown as { comparisonPushes: string[] }).comparisonPushes
      ));
      expect(pushes).toHaveLength(1);
      expect(new URL(pushes[0]!, baseUrl).searchParams.has('base')).toBe(true);
      expect(new URL(pushes[0]!, baseUrl).searchParams.has('target')).toBe(true);

      await page.locator('.comparison-filters select').first().selectOption('all');
      const disclosure = page.locator('.comparison-row-conditions').first();
      await disclosure.locator('summary').click();
      await expect(disclosure).toHaveAttribute('open', '');
      await page.locator('#dashboard-tab-technical').click();
      await page.locator('#dashboard-tab-report').click();
      await expect(page.locator('.comparison-filters select').first()).toHaveValue('all');
      await expect(page.locator('.comparison-row-conditions').first()).toHaveAttribute('open', '');

      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => {
          const region = document.querySelector<HTMLElement>('.comparison-table-scroll');
          return {
            documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
            regionOverflow: region ? region.scrollWidth > region.clientWidth : false,
          };
        });
        expect(overflow.documentOverflow).toBe(false);
        expect(overflow.regionOverflow).toBe(width < 1280);
      }
      await page.locator('.comparison-table-scroll').first().focus();
      await expect(page.locator('.comparison-table-scroll').first()).toBeFocused();

      await page.getByRole('button', { name: '比較を解除' }).first().click();
      expect(new URL(page.url()).searchParams.has('base')).toBe(false);
      await page.goBack();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(page.locator('.comparison-filters select').first()).toHaveValue('all');
      await expect(page.locator('.comparison-row-conditions').first()).toHaveAttribute('open', '');
    } finally {
      await page.close();
    }
  });

  test('keeps zero/one history disabled and rejects a one-sided deep link without a comparison request', async ({ browser }) => {
    const page = await browser.newPage();
    const requestLog: string[] = [];
    const target = snapshotFor('1010');
    const targetId = createSnapshotId(target.generatedAt);
    try {
      await mockComparisonApi(page, [target], requestLog);
      await openDetail(page, '1010');
      await expect(page.getByRole('button', { name: '比較を開始' })).toBeDisabled();
      await expect(page.getByText(COMPARISON_PAIR_REQUIREMENT)).toBeVisible();

      await page.goto(`${baseUrl}/?ticker=1010&tab=report&base=${targetId}`);
      await waitForSelectedTab(page, 'report');
      await expect(page.getByText('比較URLには有効な基準Snapshotと対象Snapshotの両方が必要です。')).toBeVisible();
      await expect(page.getByRole('button', { name: '比較を再試行' })).toHaveCount(0);
      expect(requestLog.filter(value => value.includes('/comparison?'))).toHaveLength(0);
      await page.getByRole('button', { name: '比較を解除' }).first().click();
      const url = new URL(page.url());
      expect(url.searchParams.has('base')).toBe(false);
      expect(url.searchParams.has('target')).toBe(false);
      expect(url.searchParams.get('ticker')).toBe('1010');
      expect(url.searchParams.get('tab')).toBe('report');
    } finally {
      await page.close();
    }
  });

  test('resolves a changed target to its numeric immediate predecessor without a transient URL', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-23T01:02:03Z');
    const middle = snapshotWithIdentity('1010', '2026-08-23T01:02:03.500Z');
    const newest = snapshotWithIdentity('1010', '2026-08-24T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [newest, oldest, middle]);
      await openDetail(page, '1010');
      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get('base')).toBe(createSnapshotId(middle.generatedAt));

      await page.locator('.comparison-selectors label').filter({ hasText: '対象Snapshot' })
        .locator('select').selectOption(createSnapshotId(middle.generatedAt));
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      const url = new URL(page.url());
      expect(url.searchParams.get('target')).toBe(createSnapshotId(middle.generatedAt));
      expect(url.searchParams.get('base')).toBe(createSnapshotId(oldest.generatedAt));
    } finally {
      await page.close();
    }
  });

  test('keeps selector focus and scroll while pair changes and Back/Forward load in place', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 500 } });
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z');
    const middle = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    const newest = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [oldest, middle, newest]);
      await openDetail(page, '1010');
      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await page.route('**/api/analyses/1010/comparison?*', async route => {
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.fallback();
      });

      const targetSelect = page.locator('.comparison-selectors label').filter({ hasText: '対象Snapshot' })
        .locator('select');
      await targetSelect.scrollIntoViewIfNeeded();
      await targetSelect.focus();
      const initialScroll = await page.evaluate(() => window.scrollY);
      await targetSelect.selectOption(createSnapshotId(middle.generatedAt));
      await expect(page.getByRole('heading', { name: '保存済み分析の比較' })).toBeVisible();
      await expect(page.locator('.comparison-table')).toHaveCount(0);
      await expect(targetSelect).toBeFocused();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(targetSelect).toBeFocused();
      expect(Math.abs(await page.evaluate(() => window.scrollY) - initialScroll)).toBeLessThanOrEqual(2);

      await page.goBack();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(targetSelect).toBeFocused();
      expect(Math.abs(await page.evaluate(() => window.scrollY) - initialScroll)).toBeLessThanOrEqual(2);

      await page.goForward();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(targetSelect).toBeFocused();
      expect(Math.abs(await page.evaluate(() => window.scrollY) - initialScroll)).toBeLessThanOrEqual(2);
    } finally {
      await page.close();
    }
  });

  test('hides the previous Snapshot when an exact target transition fails', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z', '基準Snapshot株式会社');
    const current = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z', '旧対象Snapshot株式会社');
    const failing = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z', '失敗対象Snapshot株式会社');
    const failingSnapshotId = createSnapshotId(failing.generatedAt);
    try {
      await mockComparisonApi(page, [oldest, current, failing]);
      await openDetail(
        page,
        '1010',
        'report',
        `&base=${createSnapshotId(oldest.generatedAt)}&target=${createSnapshotId(current.generatedAt)}`,
      );
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: '旧対象Snapshot株式会社' })).toBeVisible();
      await page.route(`**/api/analyses/1010/history/${failingSnapshotId}`, async route => {
        await route.fulfill({ body: '{}', contentType: 'application/json', status: 404 });
      });

      const targetSelect = page.locator('.comparison-selectors label').filter({ hasText: '対象Snapshot' })
        .locator('select');
      await targetSelect.focus();
      await targetSelect.selectOption(failingSnapshotId);
      await expect(page.getByRole('heading', { name: '対象Snapshotを表示できません' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('保存済みSnapshotがありません');
      await expect(targetSelect).toBeFocused();
      await expect(page.getByRole('heading', { name: '旧対象Snapshot株式会社' })).toHaveCount(0);
      await expect(page.locator('.generated-at')).not.toBeVisible();
      await expect(page.locator('.kpi-grid')).not.toBeVisible();
      await expect(page.locator('.report-markdown')).not.toBeVisible();
      await expect(page.getByRole('button', { name: '比較を再試行' })).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('target')).toBe(failingSnapshotId);

      await page.getByRole('button', { name: '比較を解除' }).click();
      await expect(page.getByRole('heading', { name: '失敗対象Snapshot株式会社' })).toBeVisible();
      expect(new URL(page.url()).searchParams.has('target')).toBe(false);
    } finally {
      await page.close();
    }
  });

  test('retries the same pinned pair after an exact target HTTP 500', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z', '基準Snapshot株式会社');
    const current = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z', '旧対象Snapshot株式会社');
    const recovered = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z', '復旧対象Snapshot株式会社');
    const recoveredSnapshotId = createSnapshotId(recovered.generatedAt);
    const requestLog: string[] = [];
    let targetAttempts = 0;
    try {
      await mockComparisonApi(page, [oldest, current, recovered], requestLog);
      await openDetail(
        page,
        '1010',
        'report',
        `&base=${createSnapshotId(oldest.generatedAt)}&target=${createSnapshotId(current.generatedAt)}`,
      );
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await page.route(`**/api/analyses/1010/history/${recoveredSnapshotId}`, async route => {
        targetAttempts += 1;
        if (targetAttempts === 1) {
          await route.fulfill({ body: '{}', contentType: 'application/json', status: 500 });
          return;
        }
        await route.fallback();
      });

      const targetSelect = page.locator('.comparison-selectors label').filter({ hasText: '対象Snapshot' })
        .locator('select');
      await targetSelect.selectOption(recoveredSnapshotId);
      await expect(page.getByRole('heading', { name: '対象Snapshotを表示できません' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Snapshotを読み込めませんでした');
      await expect(page.getByRole('heading', { name: '旧対象Snapshot株式会社' })).toHaveCount(0);
      const pinnedUrl = page.url();
      expect(new URL(pinnedUrl).searchParams.get('target')).toBe(recoveredSnapshotId);

      await page.getByRole('button', { name: '比較を再試行' }).click();
      await expect(page.getByRole('heading', { name: '復旧対象Snapshot株式会社' })).toBeVisible();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await expect(page.getByRole('button', { name: '比較を再試行' })).toHaveCount(0);
      expect(page.url()).toBe(pinnedUrl);
      expect(targetAttempts).toBe(2);
      expect(requestLog.filter(entry => {
        const url = new URL(entry, 'http://localhost');
        return url.pathname === '/api/analyses/1010/comparison'
          && url.searchParams.get('targetSnapshotId') === recoveredSnapshotId;
      })).toHaveLength(2);
    } finally {
      await page.close();
    }
  });

  test('retries an initial pinned pair after a history-list HTTP 500', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z', '基準Snapshot株式会社');
    const target = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z', '復旧対象Snapshot株式会社');
    const latest = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z', '最新Snapshot株式会社');
    const baseSnapshotId = createSnapshotId(oldest.generatedAt);
    const targetSnapshotId = createSnapshotId(target.generatedAt);
    let historyAttempts = 0;
    try {
      await mockComparisonApi(page, [oldest, target, latest]);
      await page.route('**/api/analyses/1010/history', async route => {
        historyAttempts += 1;
        if (historyAttempts <= 2) {
          await route.fulfill({ body: '{}', contentType: 'application/json', status: 500 });
          return;
        }
        await route.fallback();
      });

      await page.goto(
        `${baseUrl}/?ticker=1010&tab=report&base=${baseSnapshotId}&target=${targetSnapshotId}`,
      );
      await expect(page.getByRole('heading', { name: '対象Snapshotを表示できません' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('保存済み分析履歴を読み込めませんでした');
      await expect(page.getByRole('button', { name: '比較を再試行' })).toBeVisible();
      const pinnedUrl = page.url();

      await page.getByRole('button', { name: '比較を再試行' }).click();
      await expect(page.getByRole('heading', { name: '復旧対象Snapshot株式会社' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '最新Snapshot株式会社' })).toHaveCount(0);
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      expect(page.url()).toBe(pinnedUrl);
      expect(historyAttempts).toBe(3);
    } finally {
      await page.close();
    }
  });

  test('keeps a pinned pair on reload and adopts a newer target only after explicit action', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z');
    const current = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    const newer = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [oldest, current]);
      await openDetail(page, '1010');
      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      const pinnedUrl = page.url();

      await page.getByRole('button', { name: '保存済みSnapshotを再読み込み' }).click();
      await expect(page.locator('.snapshot-reload-feedback')).toContainText('新しい保存済み分析はありません');
      expect(page.url()).toBe(pinnedUrl);
      await expect(page.locator('.comparison-table').first()).toBeVisible();

      await page.unroute('**/api/analyses/**');
      await mockComparisonApi(page, [oldest, current, newer]);
      await page.getByRole('button', { name: '保存済みSnapshotを再読み込み' }).click();
      await expect(page.getByRole('button', { name: '新しい保存済み分析を対象にする' })).toBeVisible();
      expect(page.url()).toBe(pinnedUrl);
      await expect(page.locator('.comparison-table').first()).toBeVisible();

      await page.getByRole('button', { name: '新しい保存済み分析を対象にする' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      const adoptedUrl = new URL(page.url());
      expect(adoptedUrl.searchParams.get('base')).toBe(createSnapshotId(current.generatedAt));
      expect(adoptedUrl.searchParams.get('target')).toBe(createSnapshotId(newer.generatedAt));
    } finally {
      await page.close();
    }
  });

  test('treats deferred Evaluation query parameters as inert unknown state', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z');
    const latest = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [oldest, latest]);
      await openDetail(
        page,
        '1010',
        'report',
        `&evaluationSnapshot=${createSnapshotId(oldest.generatedAt)}`
          + '&evaluation=123e4567-e89b-42d3-a456-426614174000',
      );
      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get('target')).toBe(createSnapshotId(latest.generatedAt));
    } finally {
      await page.close();
    }
  });

  test('ignores an abort-insensitive pinned reload after the comparison target changes', async ({ browser }) => {
    const page = await browser.newPage();
    const oldest = snapshotWithIdentity('1010', '2026-08-21T01:02:03.000Z');
    const middle = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    const newest = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z');
    try {
      await mockComparisonApi(page, [oldest, middle, newest]);
      await openDetail(page, '1010');
      await page.getByRole('button', { name: '比較を開始' }).click();
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await installAbortIgnoringReloadFetch(page, '1010', [{ body: newest, delayMs: 450 }]);

      await page.getByRole('button', { name: '保存済みSnapshotを再読み込み' }).click();
      await page.locator('.comparison-selectors label').filter({ hasText: '対象Snapshot' })
        .locator('select').selectOption(createSnapshotId(middle.generatedAt));
      await expect(page.locator('.comparison-table').first()).toBeVisible();
      await page.waitForTimeout(550);

      const url = new URL(page.url());
      expect(url.searchParams.get('target')).toBe(createSnapshotId(middle.generatedAt));
      expect(url.searchParams.get('base')).toBe(createSnapshotId(oldest.generatedAt));
      await expect(page.locator('.snapshot-reload-feedback')).toHaveText('');
    } finally {
      await page.close();
    }
  });

  test('offers a pair-bound retry only for an exact 500 comparison failure', async ({ browser }) => {
    const page = await browser.newPage();
    const base = snapshotWithIdentity('1010', '2026-08-22T01:02:03.000Z');
    const target = snapshotWithIdentity('1010', '2026-08-23T01:02:03.000Z');
    const pair = {
      baseSnapshotId: createSnapshotId(base.generatedAt),
      targetSnapshotId: createSnapshotId(target.generatedAt),
    };
    let attempts = 0;
    try {
      await mockComparisonApi(page, [base, target]);
      await page.route('**/api/analyses/1010/comparison?*', async route => {
        attempts += 1;
        await route.fulfill({
          body: JSON.stringify(comparisonFailureV1({ ticker: '1010', ...pair }, 'snapshot_filesystem_failure')),
          contentType: 'application/json; charset=utf-8',
          status: 500,
        });
      });
      await openDetail(
        page,
        '1010',
        'report',
        `&base=${pair.baseSnapshotId}&target=${pair.targetSnapshotId}`,
      );
      await expect(page.getByText('保存済みSnapshotを読み込めないため比較できません。')).toBeVisible();
      await page.getByRole('button', { name: '比較を再試行' }).click();
      await expect.poll(() => attempts).toBe(2);
      expect(new URL(page.url()).searchParams.get('target')).toBe(pair.targetSnapshotId);
    } finally {
      await page.close();
    }
  });
});

test.describe('strategy validation Dashboard interaction', () => {
  test('requires a local preflight and default-No confirmation before starting a job', async ({ browser }) => {
    const page = await browser.newPage();
    const fixture = strategyValidationBrowserFixture();
    try {
      await mockSnapshotApi(page);
      await mockStrategyValidationApi(page, fixture);
      await openDetail(page, '7203', 'validation');

      await expect(page.getByRole('tab')).toHaveCount(6);
      expect(await page.locator('.detail-tab-label').allTextContents()).toEqual([
        '概要・レポート',
        '株価・テクニカル',
        '比較・配当',
        '需給・空売り',
        '市場・セクター',
        '戦略検証',
      ]);
      await expect(page.getByRole('heading', { name: /保存済みSnapshot監査|キャンペーン全体/ }))
        .toHaveCount(0);
      expect(new URL(page.url()).searchParams.has('validationRun')).toBe(false);

      await page.getByLabel('Campaign JSON', { exact: true }).check();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'oversized.json',
        mimeType: 'application/json',
        buffer: Buffer.alloc(1_048_577, 0x20),
      });
      await expect(page.getByText('Manifestは1,048,576 bytes以下である必要があります。'))
        .toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'campaign.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
          schemaVersion: 'strategy_validation_campaign_v1',
          name: '日本株検証',
          anchors: [{ ticker: '7203', anchorDate: '2025-01-06', resistanceEvidence: [] }],
        })),
      });
      await expect(page.getByText('日本株検証 / 1基準日を検証しました。', { exact: true }))
        .toBeVisible();

      await page.getByLabel('保存済みSnapshot', { exact: true }).check();
      await page.locator('.validation-field select').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'ローカルPreflightを実行' }).click();

      const confirmation = page.getByRole('heading', { name: '外部送信・利用枠の確認' });
      await expect(confirmation).toBeVisible();
      const estimate = page.getByRole('table', { name: 'Preflight estimate' });
      await expect(estimate).toContainText('最小request数3');
      await expect(estimate).toContainText('最小dispatch時間24秒');
      await expect(estimate).toContainText('Rate5 requests/min');
      await expect(estimate).toContainText('Execution budget90分');
      await expect(page.getByText(/pagination、retry、response latency/)).toBeVisible();

      const consent = page.getByRole('checkbox', {
        name: '上記の外部送信と利用枠消費の可能性を確認しました',
      });
      const start = page.getByRole('button', { name: 'Jobを開始' });
      await expect(consent).not.toBeChecked();
      await expect(start).toBeDisabled();
      await consent.check();
      await start.click();
      await expect(page.getByRole('status').filter({ hasText: '状態 completed' })).toBeVisible();
      expect(new URL(page.url()).searchParams.has('validationRun')).toBe(false);

      const preflightRequest = fixture.requests.find(request => (
        request.method === 'POST' && request.path === '/api/strategy-validation/preflights'
      ));
      expect(preflightRequest?.body).toMatchObject({ mode: 'snapshot', ticker: '7203' });
      expect(preflightRequest?.csrf).toBe('x'.repeat(43));
      const jobRequest = fixture.requests.find(request => (
        request.method === 'POST' && request.path === '/api/strategy-validation/jobs'
      ));
      expect(jobRequest?.body).toEqual({
        preflightId: '77777777-7777-4777-8777-777777777777',
        confirmExternalFetch: true,
      });
      expect(jobRequest?.csrf).toBe('x'.repeat(43));

      await page.getByRole('button', { name: '結果を明示的に開く' }).click();
      await expect(page.getByRole('heading', { name: '保存済みSnapshot監査（7203）' }))
        .toBeVisible();
      expect(new URL(page.url()).searchParams.get('validationRun')).toBe(fixture.snapshotRun.runId);
      await expect(page.getByRole('heading', { name: '保存済みSnapshot監査（7203）' }))
        .toBeFocused();
    } finally {
      await page.close();
    }
  });

  test('restores campaign and case deep links without deriving a ticker-local aggregate', async ({ browser }) => {
    const page = await browser.newPage();
    const fixture = strategyValidationBrowserFixture();
    try {
      await mockSnapshotApi(page);
      await mockStrategyValidationApi(page, fixture);
      await openDetail(
        page,
        '7203',
        'validation',
        `&validationRun=${fixture.campaignRun.runId}`,
      );

      await expect(page.getByRole('heading', { name: 'キャンペーン全体（2銘柄・2基準日）' }))
        .toBeVisible();
      await expect(page.getByText(
        '集計値はキャンペーン全体です。表示中の銘柄は7203ですが、ケース一覧だけがこの銘柄に絞り込まれています。',
        { exact: true },
      )).toBeVisible();
      await expect(page.getByText('technical_251_strategy_v1', { exact: true })).toBeVisible();
      await expect(page.getByText(/not production-pipeline parity/)).toBeVisible();
      const caseList = page.locator('.validation-case-list');
      await expect(caseList.locator('tbody tr')).toHaveCount(1);
      await expect(caseList).toContainText('7203');
      await expect(caseList).not.toContainText('6758');

      await caseList.getByRole('button', {
        name: new RegExp(`${fixture.currentTickerCase.caseId} を開く$`),
      }).click();
      await expect(page.getByRole('heading', { name: 'ケース詳細' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'ケース詳細' })).toBeFocused();
      expect(new URL(page.url()).searchParams.get('validationCase'))
        .toBe(fixture.currentTickerCase.caseId);
      await page.reload();
      await waitForSelectedTab(page, 'validation');
      await expect(page.getByRole('heading', { name: 'ケース詳細' })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('validationCase'))
        .toBe(fixture.currentTickerCase.caseId);

      await page.goBack();
      await expect(page.getByRole('heading', { name: 'キャンペーン全体（2銘柄・2基準日）' }))
        .toBeVisible();
      expect(new URL(page.url()).searchParams.has('validationCase')).toBe(false);
      await page.getByRole('button', { name: '← Analysis Portfolio' }).click();
      await expect(page.getByRole('heading', { name: 'Analysis Watchlist' })).toBeVisible();
      expect(new URL(page.url()).searchParams.has('validationRun')).toBe(false);
      expect(new URL(page.url()).searchParams.has('validationCase')).toBe(false);

      await page.goto(
        `${baseUrl}/?ticker=7203&tab=validation&validationRun=${fixture.campaignRun.runId}`
        + `&validationCase=${fixture.otherTickerCase.caseId}`,
      );
      await waitForSelectedTab(page, 'validation');
      const crossTickerError = page.getByRole('alert').filter({
        hasText: 'このcaseは表示中の銘柄に属していません。',
      });
      await expect(crossTickerError).toBeVisible();
      await expect(crossTickerError).toBeFocused();
      await expect(page.getByRole('heading', { name: 'ケース詳細' })).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('validationCase'))
        .toBe(fixture.otherTickerCase.caseId);

      await page.goto(`${baseUrl}/?ticker=7203&tab=validation&validationCase=invalid`);
      await waitForSelectedTab(page, 'validation');
      const orphanError = page.getByRole('alert').filter({
        hasText: 'caseを指定するにはvalidationRunが必要です。',
      });
      await expect(orphanError).toBeVisible();
      await expect(orphanError).toBeFocused();
      expect(new URL(page.url()).searchParams.get('validationCase')).toBe('invalid');
    } finally {
      await page.close();
    }
  });

  test('keeps the newest explicit run selection when an older request finishes late', async ({ browser }) => {
    const page = await browser.newPage();
    const fixture = strategyValidationBrowserFixture();
    try {
      await mockSnapshotApi(page);
      await mockStrategyValidationApi(page, fixture);
      await page.route(url => (
        url.pathname === `/api/strategy-validation/runs/${fixture.campaignRun.runId}`
      ), async route => {
        await new Promise(resolve => setTimeout(resolve, 350));
        await route.fulfill({
          body: JSON.stringify(fixture.campaignRun),
          contentType: 'application/json; charset=utf-8',
          status: 200,
        });
      });
      await openDetail(page, '7203', 'validation');

      const campaignRequest = page.waitForRequest(request => (
        new URL(request.url()).pathname
          === `/api/strategy-validation/runs/${fixture.campaignRun.runId}`
      ));
      await page.locator('.validation-run-list button').filter({ hasText: '検証キャンペーン' }).click();
      await campaignRequest;
      await page.locator('.validation-run-list button').filter({ hasText: '保存Snapshot' }).click();
      await expect(page.getByRole('heading', { name: '保存済みSnapshot監査（7203）' }))
        .toBeVisible();
      await page.waitForTimeout(450);

      expect(new URL(page.url()).searchParams.get('validationRun')).toBe(fixture.snapshotRun.runId);
      await expect(page.getByRole('heading', { name: '保存済みSnapshot監査（7203）' }))
        .toBeVisible();
      await expect(page.getByRole('heading', { name: 'キャンペーン全体（2銘柄・2基準日）' }))
        .toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('recovers an active job, polls it every two seconds, and sends an authenticated cancel', async ({ browser }) => {
    const page = await browser.newPage();
    const fixture = strategyValidationBrowserFixture();
    const activeJob = {
      ...fixture.job,
      status: 'collecting' as const,
      finishedAt: null,
      updatedAt: fixture.job.startedAt,
      progress: { attemptCount: 1, caseCount: 0 },
    };
    const cancelledJob = {
      ...activeJob,
      status: 'cancelled' as const,
      updatedAt: fixture.job.finishedAt,
      finishedAt: fixture.job.finishedAt,
      cancellationRequestedAt: fixture.job.finishedAt,
    };
    let pollCount = 0;
    let cancelCsrf: string | null = null;
    try {
      await mockSnapshotApi(page);
      await mockStrategyValidationApi(page, fixture);
      await page.route(url => url.pathname === '/api/strategy-validation/jobs/active', async route => {
        await route.fulfill({
          body: JSON.stringify({ schemaVersion: 'strategy_validation_active_job_v1', job: activeJob }),
          contentType: 'application/json; charset=utf-8',
          status: 200,
        });
      });
      await page.route(url => (
        url.pathname === `/api/strategy-validation/jobs/${fixture.job.jobId}`
      ), async route => {
        if (route.request().method() === 'DELETE') {
          cancelCsrf = route.request().headers()['x-dexter-csrf'] ?? null;
          await route.fulfill({
            body: JSON.stringify(cancelledJob),
            contentType: 'application/json; charset=utf-8',
            status: 200,
          });
          return;
        }
        pollCount += 1;
        await route.fulfill({
          body: JSON.stringify(activeJob),
          contentType: 'application/json; charset=utf-8',
          status: 200,
        });
      });

      await openDetail(page, '7203', 'validation');
      await expect(page.getByRole('status').filter({ hasText: '状態 collecting' })).toBeVisible();
      await expect.poll(() => pollCount, { timeout: 4_000 }).toBeGreaterThanOrEqual(1);
      await page.getByRole('button', { name: '実行をキャンセル' }).click();
      await expect(page.getByRole('status').filter({ hasText: '状態 cancelled' })).toBeVisible();
      expect(cancelCsrf).toBe('x'.repeat(43));
      expect(new URL(page.url()).searchParams.has('validationRun')).toBe(false);
    } finally {
      await page.close();
    }
  });

  for (const width of [320, 768, 1280]) {
    test(`keeps validation tables within the document at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const fixture = strategyValidationBrowserFixture();
      try {
        await mockSnapshotApi(page);
        await mockStrategyValidationApi(page, fixture);
        await openDetail(
          page,
          '7203',
          'validation',
          `&validationRun=${fixture.campaignRun.runId}&validationCase=${fixture.currentTickerCase.caseId}`,
        );
        await expect(page.getByRole('heading', { name: 'ケース詳細' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
          .toBeLessThanOrEqual(0);
      } finally {
        await context.close();
      }
    });
  }
});

test.describe('Peer Radar browser presentation', () => {
  test('renders accessible sparse stored positions identically without raw-metric replay', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await mockComparisonApi(page, [peerRadarSnapshot('first')]);
      await openDetail(page, '1010', 'fundamentals');

      const chart = page.getByRole('img', { name: '保存済みPeer percentileのRadar' });
      const exactTable = page.getByRole('region', { name: 'Peer Radarの正確な値' });
      await expect(chart).toBeVisible();
      await expect(chart).not.toHaveAttribute('tabindex');
      await expect(chart.locator('desc')).toContainText('正確な値と利用状態は直後の表');
      await expect(chart.locator('[data-peer-radar-polygon="visible"]')).toHaveCount(1);
      await expect(exactTable.locator('tbody tr')).toHaveCount(7);
      await expect(exactTable).toContainText('1 / 選定 5 社');
      await expect(exactTable).toContainText('4 / 選定 5 社');
      await expect(exactTable).toContainText(`${String(1 / 3)} / ${String((1 / 3) * 100)}%`);
      await expect(exactTable).toContainText('lower_is_better');
      await expect(exactTable).toContainText('2026-08-21');
      await expect(exactTable).toContainText('利用可能');
      await expect(page.locator('.peer-radar-figure figcaption')).toContainText(
        '時価総額priority: 未適用 — incomplete peer market cap',
      );
      await expect(page.locator('.peer-radar-table-limitation')).toContainText(
        '時価総額priority: 未適用 — incomplete peer market cap',
      );

      const firstPresentation = {
        points: await chart.locator('[data-peer-radar-polygon="visible"]').getAttribute('points'),
        table: await exactTable.locator('table').innerText(),
      };
      await page.unroute('**/api/analyses/**');
      await mockComparisonApi(page, [peerRadarSnapshot('second')]);
      await page.reload();
      await waitForSelectedTab(page, 'fundamentals');
      await expect(chart.locator('[data-peer-radar-polygon="visible"]')).toHaveCount(1);
      expect({
        points: await chart.locator('[data-peer-radar-polygon="visible"]').getAttribute('points'),
        table: await exactTable.locator('table').innerText(),
      }).toEqual(firstPresentation);

      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))).toMatchObject({ clientWidth: width, scrollWidth: width });
      }
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await exactTable.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('suppresses the complete polygon while preserving invalid and unavailable rows', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockComparisonApi(page, [peerRadarSnapshot('first', 'out_of_range')]);
      await openDetail(page, '1010', 'fundamentals');
      const chart = page.getByRole('img', { name: '保存済みPeer percentileのRadar' });
      const exactTable = page.getByRole('region', { name: 'Peer Radarの正確な値' });
      await expect(chart.locator('[data-peer-radar-polygon="visible"]')).toHaveCount(0);
      await expect(page.locator('.peer-radar-unavailable')).toContainText('polygonを表示しません');
      await expect(exactTable.locator('tr[data-radar-state="invalid"]')).toContainText('120%');
      await expect(exactTable.locator('tr[data-radar-state="invalid"]')).toContainText(
        '保存値不整合 (position_structure_mismatch)',
      );

      await page.unroute('**/api/analyses/**');
      await mockComparisonApi(page, [peerRadarSnapshot('first', 'zero_sample')]);
      await page.reload();
      await waitForSelectedTab(page, 'fundamentals');
      await expect(chart.locator('[data-peer-radar-polygon="visible"]')).toHaveCount(0);
      const unavailableRow = exactTable.locator('tr[data-radar-state="unavailable"]');
      await expect(unavailableRow).toContainText('0 / 選定 5 社');
      await expect(unavailableRow).toContainText('利用不可 (insufficient_peer_data)');
    } finally {
      await page.close();
    }
  });
});

test.describe('Dashboard detail tab browser interaction', () => {
  test('canonicalizes tab URLs and preserves non-tab query parameters', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await page.goto(`${baseUrl}/?ticker=1009&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'report');
      let url = new URL(page.url());
      expect(url.searchParams.get('tab')).toBe('report');
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');

      await page.goto(`${baseUrl}/?ticker=1009&tab=unknown&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'report');
      url = new URL(page.url());
      expect(url.searchParams.get('tab')).toBe('report');
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');

      await page.goto(`${baseUrl}/?ticker=1009&tab=technical&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'technical');
      await page.locator('#dashboard-tab-market').click();
      await expectSelectedTab(page, 'market');
      url = new URL(page.url());
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');
    } finally {
      await page.close();
    }
  });

  test('keeps click, keyboard focus, URL, ARIA, panel, and history synchronized', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page);
      await page.locator('#dashboard-tab-report').focus();
      await page.keyboard.press('ArrowLeft');
      await expectSelectedTab(page, 'validation');
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id))
        .toBe('dashboard-tab-validation');

      await page.keyboard.press('ArrowRight');
      await expectSelectedTab(page, 'report');
      await page.keyboard.press('End');
      await expectSelectedTab(page, 'validation');
      await page.keyboard.press('Home');
      await expectSelectedTab(page, 'report');

      await page.locator('#dashboard-tab-fundamentals').click();
      await expectSelectedTab(page, 'fundamentals');

      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical&future=keep');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expectSelectedTab(page, 'technical');
      await page.getByRole('button', { name: '← Analysis Portfolio' }).focus();
      await page.goBack();
      await expectSelectedTab(page, 'fundamentals');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim()))
        .toBe('← Analysis Portfolio');
      await page.goForward();
      await expectSelectedTab(page, 'technical');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim()))
        .toBe('← Analysis Portfolio');
    } finally {
      await page.close();
    }
  });

  test('opens metric guidance accessibly and closes it across context changes', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page, { '1009': 2_500 });
      await mockWatchlistApi(page);
      await openDetail(page, '1010', 'technical');

      const rsiInvoker = page.getByRole('button', { name: 'RSIの説明を開く' });
      await rsiInvoker.click();
      const dialog = page.getByRole('dialog', { name: '用語集 / RSI' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('何を測るか', { exact: true })).toBeVisible();
      await expect(dialog.getByText('単位と読み方', { exact: true })).toBeVisible();
      await expect(dialog.getByText('主な制約', { exact: true })).toBeVisible();
      await expect(dialog.getByText('判断上の注意', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '用語集を閉じる' })).toBeFocused();
      await page.locator('#dashboard-tab-report').focus();
      expect(await page.evaluate(() => (
        document.querySelector('dialog')?.contains(document.activeElement) ?? false
      ))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(rsiInvoker).toBeFocused();

      await rsiInvoker.click();
      await page.evaluate(() => {
        window.history.replaceState({}, '', '/?ticker=1010&tab=technical&future=changed');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(dialog).toBeHidden();
      await expect(rsiInvoker).toBeFocused();

      const glossaryInvoker = page.getByRole('button', { name: '用語集', exact: true });
      await glossaryInvoker.click();
      const glossary = page.getByRole('dialog', { name: '用語集', exact: true });
      await expect(glossary).toBeVisible();
      await page.setViewportSize({ width: 320, height: 568 });
      const glossaryLayout = await glossary.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          left: rect.left,
          right: rect.right,
        };
      });
      expect(glossaryLayout.documentOverflow).toBeLessThanOrEqual(0);
      expect(glossaryLayout.left).toBeGreaterThanOrEqual(0);
      expect(glossaryLayout.right).toBeLessThanOrEqual(320);
      await glossary.getByRole('button', { name: /ATR/ }).click();
      await expect(page.getByRole('dialog', { name: '用語集 / ATR' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(glossaryInvoker).toBeFocused();

      await rsiInvoker.click();
      await page.evaluate(() => {
        window.history.replaceState({}, '', '/?ticker=1010&tab=market');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expectSelectedTab(page, 'market');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.locator('#dashboard-tab-market')).toBeFocused();

      await page.getByRole('button', { name: '投資部門別売買の説明を開く' }).click();
      await expect(page.getByRole('dialog', { name: '用語集 / 投資部門別売買' }))
        .toBeVisible();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByText('1009 Snapshotを読み込み中…')).toBeVisible();
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#dashboard-tab-technical')).toBeFocused();

      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      const watchlistHeading = page.getByRole('heading', { name: 'Saved Analysis' });
      await expect(watchlistHeading).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(watchlistHeading).toBeFocused();
    } finally {
      await page.close();
    }
  });

  test('presents Snapshot-only price and volume panes with persistent line toggles', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');

      const chart = page.getByRole('img', {
        name: '調整後日足ローソク足と日次出来高の同期チャート',
      });
      await expect(chart).toBeVisible();
      const descriptionId = await chart.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      const description = page.locator(`#${descriptionId}`);
      await expect(description).toContainText('2026-08-19から2026-08-21');
      await expect(description).toContainText('保存済み最新行の終値 ¥3,050');
      await expect(description).toContainText('SMA 20 ¥2,950');
      await expect(description).toContainText('Swing High ¥3,100');
      await expect(description).toContainText('Swing Low ¥2,800');

      const paneHeights = await chart.evaluate(element => {
        const table = element.querySelector('table');
        return table
          ? [...table.rows]
              .map(row => row.getBoundingClientRect().height)
              .filter(height => height > 50)
          : [];
      });
      expect(paneHeights.length).toBeGreaterThanOrEqual(2);
      const pricePaneShare = paneHeights[0]! / (paneHeights[0]! + paneHeights[1]!);
      expect(pricePaneShare).toBeGreaterThan(0.64);
      expect(pricePaneShare).toBeLessThan(0.76);

      await chart.scrollIntoViewIfNeeded();
      const chartBox = await chart.boundingBox();
      expect(chartBox).not.toBeNull();
      const timeAxisClip = {
        x: chartBox!.x + 30,
        y: chartBox!.y + chartBox!.height - 28,
        width: chartBox!.width - 90,
        height: 24,
      };
      await page.mouse.move(1, 1);
      const fitContentAxis = await page.screenshot({ clip: timeAxisClip });
      await page.mouse.move(
        chartBox!.x + chartBox!.width / 2,
        chartBox!.y + chartBox!.height / 2,
      );
      await page.mouse.wheel(0, -800);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      const zoomedAxis = await page.screenshot({ clip: timeAxisClip });
      expect(zoomedAxis.equals(fitContentAxis)).toBe(false);

      const latest = page.getByRole('region', { name: '最新値' });
      await expect(latest).toContainText('データ基準日 2026-08-21');
      await expect(latest).toContainText('crosshair日付とは連動しません');
      await expect(latest.getByText('RSI 14', { exact: true })).toBeVisible();
      await expect(latest.getByText('MACD', { exact: true })).toBeVisible();
      await expect(latest.getByText('ボリンジャー中心線', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'テクニカル指標', exact: true }))
        .toHaveCount(0);

      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'true');
      await smaToggle.click();
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
      await expect(description).not.toContainText('SMA 20');
      await expect(description).toContainText('Swing High ¥3,100');
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      const toggledAxis = await page.screenshot({ clip: timeAxisClip });
      expect(toggledAxis.equals(zoomedAxis)).toBe(true);

      await page.locator('#dashboard-tab-report').click();
      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'false');

      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1010&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1010 テスト株式会社' }).waitFor();
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'true');

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileLayout = await page.evaluate(() => {
        const chartBox = document.querySelector('.price-chart')!.getBoundingClientRect();
        const legendBox = document.querySelector('.chart-legend')!.getBoundingClientRect();
        const latestBox = document.querySelector('.chart-latest-values')!.getBoundingClientRect();
        return {
          chartBottom: chartBox.bottom,
          chartHeight: chartBox.height,
          legendTop: legendBox.top,
          legendBottom: legendBox.bottom,
          latestTop: latestBox.top,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(mobileLayout.chartHeight).toBeGreaterThanOrEqual(390);
      expect(mobileLayout.legendTop).toBeGreaterThanOrEqual(mobileLayout.chartBottom);
      expect(mobileLayout.latestTop).toBeGreaterThanOrEqual(mobileLayout.legendBottom);
      expect(mobileLayout.overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  });

  test('reloads with GET only and preserves every local state for an unchanged identity', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      const requests: Array<{ method: string; pathname: string }> = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
          requests.push({ method: request.method(), pathname: url.pathname });
        }
      });
      await mockReloadResponses(page, [{ body: snapshotFor('1010'), delayMs: 500 }]);

      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      const displayedGeneratedAt = (await page.locator('.generated-at').textContent())
        ?.replace(/^生成日時\s*/, '') ?? '';

      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      await reload.click();
      const feedback = page.locator('.snapshot-reload-feedback');
      await expect(feedback).toHaveText('保存済みSnapshotを再読み込み中…');
      await expect(reload).toHaveAttribute('aria-busy', 'true');
      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();

      await expect(feedback).toContainText('変更なし。');
      await expect(feedback).toContainText(`表示中の生成日時 ${displayedGeneratedAt}`);
      await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
      await expect(feedback).toHaveAttribute('aria-live', 'polite');
      await expect(reload).toHaveAttribute('aria-busy', 'false');
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
      expect(requests).toEqual([
        { method: 'GET', pathname: '/api/analyses/1010' },
        { method: 'GET', pathname: '/api/analyses/1010/history' },
      ]);
    } finally {
      await page.close();
    }
  });

  test('replaces a newer identity while preserving only the selected tab', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      const updated = snapshotWithIdentity('1010', '2026-08-24T02:03:04.000Z');
      await mockReloadResponses(page, [{ body: updated, delayMs: 500 }]);

      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      await page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      }).click();
      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();

      const feedback = page.locator('.snapshot-reload-feedback');
      await expect(feedback).toContainText('更新。');
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(bins).not.toHaveAttribute('open', '');
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'true');
      const displayedGeneratedAt = (await page.locator('.generated-at').textContent())
        ?.replace(/^生成日時\s*/, '') ?? '';
      await expect(feedback).toContainText(`表示中の生成日時 ${displayedGeneratedAt}`);
      await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
    } finally {
      await page.close();
    }
  });

  test('keeps the current Snapshot and UI state for every reload validation failure', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      await mockReloadResponses(page, [
        { body: '{', delayMs: 300 },
        { body: {} },
        { body: snapshotFor('1009') },
        { body: {}, status: 404 },
        { body: {}, status: 500 },
      ]);
      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      const generatedAt = await page.locator('.generated-at').textContent();
      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      const feedback = page.locator('.snapshot-reload-feedback');
      const expectedErrors = [
        'Snapshot JSONを読み込めませんでした。',
        'Snapshotの形式を検証できませんでした。',
        'Snapshotの銘柄が表示中の銘柄と一致しません。',
        '1010 の保存済みSnapshotがありません。',
        'Snapshotを読み込めませんでした。',
      ];

      for (const [index, expectedError] of expectedErrors.entries()) {
        await reload.click();
        if (index === 0) {
          await page.getByRole('button', { name: '用語集', exact: true }).click();
        }
        await expect(feedback).toContainText(`エラー: ${expectedError}`);
        await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
        await expect(page.locator('.generated-at')).toHaveText(generatedAt ?? '');
        await expectSelectedTab(page, 'technical');
        await expect(bins).toHaveAttribute('open', '');
        await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
        if (index === 0) {
          await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await page.close();
    }
  });

  test('ignores stale reloads after a newer request, ticker change, or list navigation', async ({ browser }) => {
    const page = await browser.newPage();
    const listPage = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      await installAbortIgnoringReloadFetch(page, '1010', [
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T01:00:00.000Z',
            '1010 stale first request',
          ),
          delayMs: 500,
        },
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T02:00:00.000Z',
            '1010 latest request',
          ),
          delayMs: 50,
        },
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T03:00:00.000Z',
            '1010 stale after ticker change',
          ),
          delayMs: 500,
        },
      ]);
      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      await reload.click();
      await reload.click();
      await page.getByRole('heading', { name: '1010 latest request' }).waitFor();
      await page.waitForTimeout(600);
      await expect(page.getByRole('heading', { name: '1010 latest request' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '1010 stale first request' })).toHaveCount(0);

      await reload.click();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.waitForTimeout(600);
      await expect(page.getByRole('heading', { name: '1009 テスト株式会社' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '1010 stale after ticker change' }))
        .toHaveCount(0);

      await mockSnapshotApi(listPage);
      await mockWatchlistApi(listPage);
      await openDetail(listPage, '1010', 'technical');
      await installAbortIgnoringReloadFetch(listPage, '1010', [{
        body: snapshotWithIdentity(
          '1010',
          '2026-08-24T04:00:00.000Z',
          '1010 stale after list navigation',
        ),
        delayMs: 500,
      }]);
      await listPage.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      }).click();
      await listPage.getByRole('button', { name: '← Analysis Portfolio' }).click();
      await expect(listPage.getByRole('heading', { name: 'Saved Analysis' })).toBeVisible();
      await listPage.waitForTimeout(600);
      await expect(listPage.getByRole('heading', { name: 'Saved Analysis' })).toBeVisible();
      await expect(listPage.getByRole('heading', { name: '1010 stale after list navigation' }))
        .toHaveCount(0);
    } finally {
      await page.close();
      await listPage.close();
    }
  });

  test('keeps initial vertical position and every tab reachable on narrow screens', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    try {
      await mockSnapshotApi(page);
      await openDetail(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await openDetail(page, '1009', 'market');
      const directLinkLayout = await page.evaluate(() => {
        const selected = document.getElementById('dashboard-tab-market')!.getBoundingClientRect();
        const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!;
        const listRect = tablist.getBoundingClientRect();
        const cueStyle = getComputedStyle(tablist.parentElement!, '::after');
        const cueWidth = cueStyle.display === 'none' ? 0 : Number.parseFloat(cueStyle.width);
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          scrollLeft: tablist.scrollLeft,
          selectedLeft: selected.left,
          selectedRight: selected.right,
          listLeft: listRect.left,
          listVisibleRight: listRect.right - cueWidth,
        };
      });
      expect(directLinkLayout.scrollLeft).toBeGreaterThan(0);
      expect(directLinkLayout.selectedLeft).toBeGreaterThanOrEqual(directLinkLayout.listLeft);
      expect(directLinkLayout.selectedRight).toBeLessThanOrEqual(
        directLinkLayout.listVisibleRight,
      );
      expect(directLinkLayout.documentOverflow).toBeLessThanOrEqual(0);

      await page.evaluate(() => window.scrollTo(0, 400));
      const stickyScrollY = await page.evaluate(() => window.scrollY);
      await page.locator('#dashboard-tab-market').focus();
      for (const key of ['Home', 'End', 'ArrowLeft'] as const) {
        await page.keyboard.press(key);
        const selectedTab = key === 'Home' ? 'report' : key === 'End' ? 'validation' : 'market';
        await expectSelectedTab(page, selectedTab);
        const stickyState = await page.evaluate(() => {
          const rect = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
          return { bottom: rect.bottom, scrollY: window.scrollY, top: rect.top };
        });
        expect(stickyState.top).toBeGreaterThanOrEqual(0);
        expect(stickyState.bottom).toBeLessThanOrEqual(568);
        expect(stickyState.scrollY).toBe(stickyScrollY);
      }

      const viewports = [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 680, height: 960 },
        { width: 768, height: 1_024 },
        { width: 980, height: 720 },
        { width: 1_024, height: 768 },
        { width: 1_280, height: 800 },
      ];
      for (const viewport of viewports) {
        const { width, height } = viewport;
        await page.setViewportSize(viewport);
        await openDetail(page);
        await page.locator('#dashboard-tab-report').focus();
        for (const tab of DASHBOARD_TABS) {
          await expectSelectedTab(page, tab.id);
          const layout = await page.evaluate(selectedTab => {
            const selected = document.getElementById(`dashboard-tab-${selectedTab}`)!
              .getBoundingClientRect();
            const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!;
            const listRect = tablist.getBoundingClientRect();
            const cueStyle = getComputedStyle(tablist.parentElement!, '::after');
            const cueWidth = cueStyle.display === 'none' ? 0 : Number.parseFloat(cueStyle.width);
            const overflowingElements = [...document.querySelectorAll<HTMLElement>('body *')]
              .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 10)
              .map(element => {
                const rect = element.getBoundingClientRect();
                return [
                  `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
                  `left=${rect.left.toFixed(1)}`,
                  `right=${rect.right.toFixed(1)}`,
                  `width=${rect.width.toFixed(1)}`,
                  `text=${element.textContent?.trim().slice(0, 30) ?? ''}`,
                ].join(' ');
              });
            return {
              documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
              overflowingElements,
              selectedLeft: selected.left,
              selectedRight: selected.right,
              listLeft: listRect.left,
              listVisibleRight: listRect.right - cueWidth,
              tablistTop: listRect.top,
              tablistBottom: listRect.bottom,
            };
          }, tab.id);
          expect(
            layout.documentOverflow,
            `${width}px ${tab.id}: ${layout.overflowingElements.join(', ')}`,
          ).toBeLessThanOrEqual(0);
          expect(layout.selectedLeft).toBeGreaterThanOrEqual(layout.listLeft);
          expect(layout.selectedRight).toBeLessThanOrEqual(layout.listVisibleRight);
          expect(layout.tablistTop).toBeGreaterThanOrEqual(0);
          expect(layout.tablistBottom).toBeLessThanOrEqual(height);
          if (tab.id !== DASHBOARD_TABS.at(-1)!.id) await page.keyboard.press('ArrowRight');
        }
      }
    } finally {
      await page.close();
    }
  });

  test('shows separate unavailable and uncollected navigation states for V1 through V9', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      for (const ticker of [
        '1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008', '1009',
      ]) {
        const availability = buildDashboardAvailabilityNavigation(snapshotFor(ticker));
        await openDetail(page, ticker);

        const overview = page.getByLabel('Snapshotのデータ利用状況');
        await expect(overview).toContainText(`利用不可 ${availability.global.unavailable}`);
        await expect(overview).toContainText(`未収集 ${availability.global.uncollected}`);
        await expect(overview).toContainText('このSnapshotでは未収集の項目です');

        for (const tab of DASHBOARD_TABS) {
          const button = page.locator(`#dashboard-tab-${tab.id}`);
          const counts = availability.tabs[tab.id];
          if (counts.unavailable > 0) {
            await expect(button).toContainText(`利用不可 ${counts.unavailable}`);
          }
          if (counts.uncollected > 0) {
            await expect(button).toContainText(`未収集 ${counts.uncollected}`);
          }
        }

        const uncollected = page.getByRole('region', { name: '未収集セクション' });
        const storedRecords = page.getByRole('region', {
          name: '保存済みデータ状態レコード',
        });
        await expect(uncollected).toBeVisible();
        const uncollectedSections = await uncollected.locator('li strong').allTextContents();
        expect(uncollectedSections).toEqual([...EXPECTED_UNCOLLECTED_SECTIONS]);
        expect(new Set(uncollectedSections).size).toBe(7);
        expect(await uncollected.getByText('fundamental', { exact: true }).count()).toBe(0);
        await expect(storedRecords.locator('li').filter({ hasText: 'fundamental' }))
          .toContainText('missing_required_section');
        expect(await page.getByRole('heading', { name: '利用不可データ', exact: true }).count())
          .toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  test('keeps exact duplicate and not-collected raw records reachable under a neutral heading', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1011');

      const uncollected = page.getByRole('region', { name: '未収集セクション' });
      const storedRecords = page.getByRole('region', {
        name: '保存済みデータ状態レコード',
      });
      expect(await uncollected.locator('li strong').allTextContents()).toEqual(['volumeProfile']);
      expect(await storedRecords.locator('li strong').allTextContents()).toEqual([
        'technical / rsi14',
        'technical / rsi14',
        'volumeProfile',
      ]);
      expect(await storedRecords.locator('li span').allTextContents()).toEqual([
        'missing_data',
        'missing_data',
        'not_collected',
      ]);
      expect(await storedRecords.locator('li small').allTextContents()).toEqual([
        'same stored detail',
        'same stored detail',
      ]);
    } finally {
      await page.close();
    }
  });

  test('keeps summaries visible and preserves or resets native disclosures by Snapshot identity', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');

      const technicalPanel = page.locator('#dashboard-panel-technical');
      const methodology = technicalPanel.locator('details').filter({
        hasText: '算出方法・データ基準',
      });
      const bins = technicalPanel.locator('details').filter({
        hasText: '価格帯別分布 2件',
      });
      await expect(technicalPanel.getByRole('heading', {
        name: 'POC（最大出来高価格帯）',
        exact: true,
      }))
        .toBeVisible();
      await expect(technicalPanel.getByText('¥1,015', { exact: true }).first()).toBeVisible();
      await expect(technicalPanel.getByText('490 調整後株', { exact: true }).first())
        .toBeVisible();
      await expect(technicalPanel.getByText('目標出来高比率', { exact: true }))
        .toBeVisible();
      await expect(methodology).not.toHaveAttribute('open', '');
      await expect(bins).not.toHaveAttribute('open', '');
      await expect(page.getByRole('region', { name: '出来高価格分布の価格帯別データ' }))
        .toBeHidden();

      const profileChart = page.getByRole('region', {
        name: '保存済み出来高価格分布チャート',
      });
      await expect(profileChart).toBeVisible();
      const profileBins = profileChart.locator('[data-volume-profile-bin]');
      await expect(profileBins).toHaveCount(2);
      await expect(profileBins.nth(0)).toHaveAttribute('data-poc', 'false');
      await expect(profileBins.nth(0)).toHaveAttribute('data-value-area', 'true');
      await expect(profileBins.nth(0).locator('meter')).toHaveAttribute('value', '0.51');
      await expect(profileBins.nth(0).locator('meter')).toHaveAttribute('max', '1');
      await expect(profileBins.nth(1)).toHaveAttribute('data-poc', 'true');
      await expect(profileBins.nth(1)).toHaveAttribute('data-value-area', 'true');
      await expect(profileBins.nth(1).locator('meter')).toHaveAttribute('value', '0.49');
      await expect(profileBins.nth(1).locator('meter')).toHaveAttribute('max', '1');
      await expect(technicalPanel.getByText(
        'POC・VAL・VAHは支持線・抵抗線や売買シグナルを意味しません。正確な保存値は下の全件表で確認できます。',
        { exact: true },
      )).toBeVisible();

      await bins.locator('summary').click();
      const binsTable = page.getByRole('region', { name: '出来高価格分布の価格帯別データ' });
      await expect(binsTable).toBeVisible();
      expect(await binsTable.locator('tbody tr th').allTextContents()).toEqual(['0', '1']);
      await expect(binsTable.getByText('510 調整後株', { exact: true })).toBeVisible();

      await page.locator('#dashboard-tab-market').click();
      await expectSelectedTab(page, 'market');
      const marketPanel = page.locator('#dashboard-panel-market');
      const brokerage = marketPanel.locator('details').filter({
        hasText: '委託内訳 10区分',
      });
      await expect(page.getByRole('region', { name: '投資部門別売買の集計' })).toBeVisible();
      await expect(marketPanel.getByText('777 千円', { exact: true }).first()).toBeVisible();
      await expect(brokerage).not.toHaveAttribute('open', '');
      await brokerage.locator('summary').click();
      const brokerageTable = page.getByRole('region', { name: '投資部門別売買の委託内訳' });
      await expect(brokerageTable).toBeVisible();
      expect(await brokerageTable.locator('tbody tr').count()).toBe(10);
      await expect(brokerageTable.getByText('777 千円', { exact: true }).first()).toBeVisible();

      await page.locator('#dashboard-tab-supply-demand').click();
      await expectSelectedTab(page, 'supply-demand');
      const shortReports = page.locator('#dashboard-panel-supply-demand details').filter({
        hasText: '公開報告 2件',
      });
      await expect(shortReports).toHaveAttribute('open', '');
      await expect(shortReports).toContainText('データ基準日 2026-08-20');
      const reportsTable = page.getByRole('region', { name: '公開空売り残高報告の全報告' });
      expect(await reportsTable.locator('tbody tr td:nth-child(3)').allTextContents())
        .toEqual(['Reporter A', 'Reporter B']);
      await expect(reportsTable.getByText('0%', { exact: true })).toBeVisible();
      await expect(reportsTable.getByText('0 株', { exact: true })).toBeVisible();

      await page.locator('#dashboard-tab-fundamentals').click();
      await expectSelectedTab(page, 'fundamentals');
      const advancedDividend = page.locator('#dashboard-panel-fundamentals details').filter({
        hasText: '年間観測 1件',
      });
      await expect(advancedDividend).toHaveAttribute('open', '');
      await expect(advancedDividend).toContainText('配当イベント 1件');
      await expect(advancedDividend).toContainText('データ基準日 2026-08-21');
      await expect(advancedDividend.getByText('¥120 / 株', { exact: true })).toBeVisible();
      await expect(advancedDividend.getByText('¥60 / 株', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: '配当分析の年間観測' })).toBeVisible();
      await expect(page.getByRole('region', { name: '配当分析の配当イベント' })).toBeVisible();

      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');
      await page.locator('#dashboard-tab-report').click();
      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');

      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        for (const tab of ['technical', 'fundamentals', 'supply-demand', 'market'] as const) {
          await page.locator(`#dashboard-tab-${tab}`).click();
          await expectSelectedTab(page, tab);
          expect(await page.evaluate(() => (
            document.documentElement.scrollWidth - window.innerWidth
          ))).toBeLessThanOrEqual(0);
        }
      }
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1010&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1010 テスト株式会社' }).waitFor();
      const resetBins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await expect(resetBins).not.toHaveAttribute('open', '');
    } finally {
      await page.close();
    }
  });

  test('supports the first-time, supply-demand, and market-context research journeys', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      expect(snapshotFor('1001').status).toBe('partial');
      expect(snapshotFor('1004').status).toBe('partial');
      expect(snapshotFor('1009').status).toBe('partial');
      expect(snapshotFor('1010').status).toBe('complete');
      await openDetail(page, '1010');

      await expect(page.getByRole('heading', { name: '1010 テスト株式会社' })).toBeVisible();
      await expect(page.locator('.status-badge.complete')).toHaveText('COMPLETE');
      await expect(page.getByLabel('Snapshotのデータ利用状況')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'データ基準日', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'データ状態', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '総合レポート', exact: true })).toBeVisible();
      await expect(page.locator('.report-markdown')).toContainText('Browser fixture.');

      await page.locator('#dashboard-tab-supply-demand').click();
      const supplyPanel = page.locator('#dashboard-panel-supply-demand');
      await expect(supplyPanel.getByRole('heading', { name: '信用需給', exact: true }))
        .toBeVisible();
      await expect(supplyPanel.getByRole('heading', {
        name: '公開空売り残高報告', exact: true,
      })).toBeVisible();
      await expect(supplyPanel.getByText(
        '信用売残や市場全体の空売り残高（short interest）とは別データです。',
        { exact: false },
      )).toBeVisible();
      const shortReportRows = page.getByRole('region', {
        name: '公開空売り残高報告の全報告',
      }).locator('tbody tr');
      await expect(shortReportRows).toHaveCount(2);
      expect(await shortReportRows.locator('td:nth-child(3)').allTextContents())
        .toEqual(['Reporter A', 'Reporter B']);

      await page.locator('#dashboard-tab-market').click();
      const marketPanel = page.locator('#dashboard-panel-market');
      await expect(marketPanel.getByText(
        '個別銘柄の売買フローではありません。', { exact: false },
      )).toBeVisible();
      await expect(marketPanel.getByText(
        '銘柄への業種指数値の帰属', { exact: false },
      )).toBeVisible();
      await expect(marketPanel.getByText(
        '個別銘柄の空売り残高や信用売残ではありません。', { exact: false },
      )).toBeVisible();
      await expect(marketPanel.getByRole('heading', { name: '市場相関', exact: true }))
        .toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('keeps all detail content reachable by touch and screen-reader semantics on mobile', async ({ browser }) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010');

      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(DASHBOARD_TABS.length);
      await page.locator('#dashboard-tab-technical').tap();
      await expectSelectedTab(page, 'technical');
      await expect(page.locator('#dashboard-panel-technical'))
        .toHaveAttribute('aria-labelledby', 'dashboard-tab-technical');

      await page.getByRole('button', { name: 'RSIの説明を開く' }).tap();
      const dialog = page.getByRole('dialog', { name: '用語集 / RSI' });
      await expect(dialog).toBeVisible();
      await page.getByRole('button', { name: '用語集を閉じる' }).tap();
      await expect(dialog).toBeHidden();

      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').tap();
      await expect(page.getByRole('region', { name: '出来高価格分布の価格帯別データ' }))
        .toBeVisible();

      for (const tab of DASHBOARD_TABS) {
        await page.locator(`#dashboard-tab-${tab.id}`).tap();
        await expectSelectedTab(page, tab.id);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  test('keeps the approved section headings reachable in V1 through V9', async ({ browser }) => {
    const page = await browser.newPage();
    const headingsByTab = {
      report: ['総合レポート'],
      technical: [
        '株価チャート',
        '価格線',
        '最新値',
        '出来高価格分布（Volume Profile）',
        '戦略水準',
      ],
      fundamentals: ['同業比較', '配当分析'],
      'supply-demand': ['信用需給', '公開空売り残高報告'],
      market: ['投資部門別売買', '市場相関', '業種指数比較', '業種別空売り売買代金'],
      validation: ['戦略検証を実行', '保存済み検証結果'],
    } as const satisfies Record<DashboardTabId, readonly string[]>;
    try {
      await mockSnapshotApi(page);
      for (const ticker of [
        '1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008', '1009',
      ]) {
        await openDetail(page, ticker);
        expect(await page.locator('[role="tab"]').count()).toBe(DASHBOARD_TABS.length);
        for (const tab of DASHBOARD_TABS) {
          await page.locator(`#dashboard-tab-${tab.id}`).click();
          await expectSelectedTab(page, tab.id);
          const panel = page.locator(`#dashboard-panel-${tab.id}`);
          for (const heading of headingsByTab[tab.id]) {
            expect(await panel.getByRole('heading', { name: heading, exact: true }).count()).toBe(1);
          }
        }
      }
    } finally {
      await page.close();
    }
  });
});
