import { describe, expect, test } from 'bun:test';
import {
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
} from '../../analysis/snapshot/index.js';
import {
  UNAVAILABLE_TEXT,
  displayText,
  formatMetric,
  mapSnapshotToDashboard,
} from './presentation.js';

function baseSnapshot(): AnalysisSnapshot {
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
  });
});

describe('snapshot presentation mapping', () => {
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
