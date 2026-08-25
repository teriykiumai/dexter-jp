import { describe, expect, test } from 'bun:test';
import {
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  AnalysisSnapshotV4Schema,
  buildAnalysisSnapshot,
  buildAnalysisSnapshotLatestItem,
  type AnalysisSnapshot,
  type AnalysisSnapshotV2,
  type AnalysisSnapshotV3,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotV5,
  type AnalysisSnapshotInput,
} from '../../analysis/snapshot/index.js';
import {
  UNAVAILABLE_TEXT,
  INVESTOR_TYPE_FLOW_CONTEXT_NOTE,
  REPORTED_SHORT_POSITION_DISCLOSURE_NOTE,
  WATCHLIST_STALE_AFTER_DAYS,
  buildDetailPath,
  displayText,
  formatMetric,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  parseDetailTicker,
  sortWatchlistItems,
} from './presentation.js';

function v5Snapshot(): AnalysisSnapshotV5 {
  const input: AnalysisSnapshotInput = {
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
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
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
        metrics: { per: 12 },
      },
      selection: {
        peers: [{
          id: '7267',
          name: '本田技研工業株式会社',
          sector: '輸送用機器',
          marketCap: 20_000,
          dataDate: '2026-08-21',
          metrics: { per: 10 },
        }],
        sameSectorCandidateCount: 5,
        marketCapPrioritizedPeerCount: 1,
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
      { label: 'MACD Signal', value: { text: '¥40.25', available: true } },
      { label: 'MACD Histogram', value: { text: '¥5.25', available: true } },
      { label: 'Bollinger Middle', value: { text: '¥2,950', available: true } },
      { label: 'Bollinger Upper', value: { text: '¥3,150.5', available: true } },
      { label: 'Bollinger Lower', value: { text: '¥2,749.5', available: true } },
    ]);
    expect(view.advancedTechnical?.metrics.map(metric => metric.label)).not.toContain('Buy');
    expect(view.advancedTechnical?.metrics.map(metric => metric.label)).not.toContain('Sell');
    expect(view.dataDates).toContainEqual({
      label: 'Advanced Technical',
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
    expect(REPORTED_SHORT_POSITION_DISCLOSURE_NOTE).toContain('市場全体のshort interest');
  });

  test('treats V1, V2, V3, and a null V4 report section as not collected', () => {
    for (const snapshot of [v1Snapshot(), v2Snapshot(), v3Snapshot(), baseSnapshot()]) {
      const view = mapSnapshotToDashboard(snapshot);
      expect(view.reportedShortPositions).toEqual({
        state: 'not_collected',
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
    const snapshot: AnalysisSnapshot = {
      ...baseSnapshot(),
      peerComparison: peerComparison(false),
    };

    const view = mapSnapshotToDashboard(snapshot);

    expect(view.peer?.marketCapPriority).toEqual({ text: '未適用', available: false });
    expect(view.peer?.marketCapPriorityReason).toBe('incomplete peer market cap');
    expect(view.peer?.rows[0].rank.text).toBe('2.5 / 5');
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
    expect(view.chart.priceLines.map(line => [line.label, line.price])).toEqual([
      ['SMA 20', 2_800],
      ['Swing High', 2_900],
      ['Swing Low', 2_650],
    ]);
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
    expect(buildDetailPath('130A')).toBe('/?ticker=130A');
    expect(parseDetailTicker('?ticker=7203')).toBe('7203');
    expect(parseDetailTicker('?ticker=130A')).toBe('130A');
    expect(parseDetailTicker('?ticker=../7203')).toBeNull();
    expect(parseDetailTicker('?ticker=72030')).toBeNull();
  });
});
