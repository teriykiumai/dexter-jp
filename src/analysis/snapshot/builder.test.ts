import { describe, expect, test } from 'bun:test';
import { buildAnalysisSnapshot, REQUIRED_ANALYSIS_SNAPSHOT_SECTIONS } from './builder.js';
import { normalizeCanonicalTicker, type AnalysisSnapshotInput } from './schema.js';

function completeInput(): AnalysisSnapshotInput {
  const position = (metric: 'per' | 'pbr' | 'roe' | 'roic' | 'operatingMargin' | 'revenueGrowth' | 'dividendYield') => ({
    metric,
    direction: metric === 'per' || metric === 'pbr' ? 'lower_is_better' as const : 'higher_is_better' as const,
    targetValue: 10,
    median: 12,
    rank: 1,
    percentile: 100,
    peerSampleSize: 2,
    cohortSize: 2,
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
    generatedAt: '2026-08-23T01:02:03.000Z',
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
      dividendYieldPercent: null,
      revenueCagrPercent: 5,
      cagrStartFiscalYear: 2021,
      cagrEndFiscalYear: 2026,
      cagrPeriods: 5,
      unavailable: [{ metric: 'dividendYieldPercent', reason: 'missing_or_invalid_dividend' }],
    },
    peerComparison: {
      target: {
        id: '7203',
        name: 'トヨタ自動車',
        sector: '輸送用機器',
        marketCap: 40_000,
        dataDate: '2026-06-10',
        metrics: { per: 15 },
      },
      selection: {
        peers: [{
          id: '7267',
          name: '本田技研工業',
          sector: '輸送用機器',
          marketCap: 8_000,
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
        per: position('per'),
        pbr: position('pbr'),
        roe: position('roe'),
        roic: position('roic'),
        operatingMargin: position('operatingMargin'),
        revenueGrowth: position('revenueGrowth'),
        dividendYield: position('dividendYield'),
      },
      unavailable: [{ metric: 'pbr', reason: 'insufficient_peer_data' }],
    },
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
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
      buyingBalance: 10_000,
      sellingBalance: 2_000,
      marginRatio: 5,
      buyingBalanceWeeklyChange: 100,
      sellingBalanceWeeklyChange: -100,
      mean13w: 9_000,
      mean52w: 8_000,
      deviation52w: 0.25,
      percentile52w: 80,
      averageDailyVolume20: 20_000_000,
      digestionDays: 0.0005,
      unavailable: [],
    },
    marketCorrelation: {
      benchmark: 'TOPIX',
      dataDate: '2026-08-21',
      alignedPriceCount: 251,
      windows: [],
    },
    strategy: {
      dataDate: '2026-08-21',
      entry: {
        triggerPrice: 3_050,
        price: null,
        reason: 'breakout_above_swing_high',
        trigger: 'strictly_above',
        tickSizeApplied: null,
      },
      candidates: [],
      unavailable: [{ candidate: 'entry', reason: 'missing_tick_size_for_executable_entry' }],
    },
    priceHistory: [
      { date: '2026-08-20', open: 2_980, high: 3_020, low: 2_970, close: 3_000, volume: 10_000 },
      { date: '2026-08-21', open: 3_000, high: 3_050, low: 2_990, close: 3_040, volume: 11_000 },
    ],
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: ['https://example.test/prices'],
    peerSourceUrls: ['https://example.test/peers'],
    sourceUsage: {
      valuation: { priceFromJQuants: true, financialsFromEdinetDb: true },
      technical: { priceFromJQuants: true },
      supplyDemand: { marginFromJQuants: true, volumeFromJQuants: true },
      marketCorrelation: { stockFromJQuants: true, benchmarkFromJQuants: true },
    },
    additionalUnavailable: [],
  };
}

describe('buildAnalysisSnapshot', () => {
  test('uses an explicit required-section contract and remains complete for metric-level unavailable states', () => {
    const snapshot = buildAnalysisSnapshot(completeInput());

    expect(REQUIRED_ANALYSIS_SNAPSHOT_SECTIONS).toEqual([
      'identity',
      'fundamental',
      'valuation',
      'peerComparison',
      'technical',
      'supplyDemand',
      'marketCorrelation',
      'strategy',
      'priceHistory',
    ]);
    expect(snapshot.status).toBe('complete');
    expect(snapshot.unavailable).toContainEqual({
      section: 'strategy',
      metric: 'entry',
      reason: 'missing_tick_size_for_executable_entry',
    });
    expect(snapshot.provenance.priceHistory[0]).toMatchObject({
      source: 'jquants',
      role: 'price_data',
    });
    expect(snapshot.provenance.valuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'financial_metrics_engine', role: 'calculation' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
      expect.objectContaining({ source: 'edinet_db', role: 'financial_data' }),
    ]));
    expect(snapshot.provenance.technical).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'technical_engine', role: 'calculation' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
    ]));
    expect(snapshot.provenance.supplyDemand).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'jquants', role: 'margin_data' }),
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
    ]));
    expect(snapshot.provenance.marketCorrelation).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'jquants', role: 'price_data' }),
      expect.objectContaining({ source: 'jquants', role: 'benchmark_data' }),
    ]));
    expect(snapshot.units.valuation.per).toBe('multiple');
    expect(snapshot.units.peerComparison.percentile).toBe('ratio');
    expect(snapshot.units.supplyDemand.percentile52w).toBe('ratio');
  });

  test('marks a normally completed snapshot partial when a required section is absent', () => {
    const input = completeInput();
    input.marketCorrelation = null;

    const snapshot = buildAnalysisSnapshot(input);

    expect(snapshot.status).toBe('partial');
    expect(snapshot.unavailable).toContainEqual({
      section: 'marketCorrelation',
      reason: 'missing_required_section',
    });
  });

  test('does not claim market-cap prioritization when a selected peer lacks market cap', () => {
    const input = completeInput();
    input.peerComparison!.selection.peers[0].marketCap = null;

    const snapshot = buildAnalysisSnapshot(input);

    expect(snapshot.peerComparison).toMatchObject({
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap',
    });
  });

  test('normalizes numeric and JPX alphanumeric canonical/J-Quants securities codes', () => {
    expect(normalizeCanonicalTicker('7203')).toBe('7203');
    expect(normalizeCanonicalTicker('72030')).toBe('7203');
    expect(normalizeCanonicalTicker('130A')).toBe('130A');
    expect(normalizeCanonicalTicker('130A0')).toBe('130A');
    expect(normalizeCanonicalTicker('130a')).toBe('130A');
    expect(normalizeCanonicalTicker('1A00')).toBe('1A00');
    expect(normalizeCanonicalTicker('9A7A0')).toBe('9A7A');
    expect(() => normalizeCanonicalTicker('E02144')).toThrow();
    expect(() => normalizeCanonicalTicker('130B')).toThrow();

    const input = completeInput();
    input.identity.canonicalTicker = '130A';
    expect(buildAnalysisSnapshot(input).canonicalTicker).toBe('130A');
  });

  test('rejects malformed typed input instead of repairing it', () => {
    const input = completeInput();
    input.priceHistory = [
      { date: '2026-08-21', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: '2026-08-20', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];

    expect(() => buildAnalysisSnapshot(input)).toThrow('Price history must be strictly chronological.');
  });

  test('keeps final Markdown for display without parsing financial values from it', () => {
    const input = completeInput();
    input.valuation = null;
    input.finalReportMarkdown = 'PER: 99.9倍';

    const snapshot = buildAnalysisSnapshot(input);

    expect(snapshot.valuation).toBeNull();
    expect(snapshot.finalReportMarkdown).toBe('PER: 99.9倍');
  });

  test('does not carry extraneous secret-like input into the canonical snapshot', () => {
    const input = {
      ...completeInput(),
      apiKey: 'must-not-survive',
    } as AnalysisSnapshotInput;

    const snapshot = buildAnalysisSnapshot(input);

    expect(JSON.stringify(snapshot)).not.toContain('must-not-survive');
    expect('apiKey' in snapshot).toBeFalse();
  });
});
