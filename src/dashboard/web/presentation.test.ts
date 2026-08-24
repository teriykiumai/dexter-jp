import { describe, expect, test } from 'bun:test';
import {
  AnalysisSnapshotV1Schema,
  buildAnalysisSnapshot,
  buildAnalysisSnapshotLatestItem,
  type AnalysisSnapshot,
  type AnalysisSnapshotV3,
  type AnalysisSnapshotInput,
} from '../../analysis/snapshot/index.js';
import {
  UNAVAILABLE_TEXT,
  WATCHLIST_STALE_AFTER_DAYS,
  buildDetailPath,
  displayText,
  formatMetric,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  parseDetailTicker,
  sortWatchlistItems,
} from './presentation.js';

function baseSnapshot(): AnalysisSnapshotV3 {
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
    marketCorrelation: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis\n\nSafe text.',
    priceSourceUrls: [],
    peerSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

function v1Snapshot(): AnalysisSnapshot {
  const v2 = baseSnapshot();
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
    unavailable: v2Unavailable.filter(item => item.section !== 'advancedTechnical'),
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
): AnalysisSnapshotV3 {
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
  });
});

describe('snapshot presentation mapping', () => {
  test('passes through and formats the seven latest Advanced Technical values', () => {
    const snapshot: AnalysisSnapshotV3 = {
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
    const snapshot: AnalysisSnapshotV3 = {
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

    const unavailableSnapshot: AnalysisSnapshotV3 = {
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
    const missingSnapshot: AnalysisSnapshotV3 = {
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
