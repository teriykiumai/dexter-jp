import { describe, expect, test } from 'bun:test';
import {
  analyzePeerComparison,
  calculateMedian,
  calculatePeerPercentile,
  PEER_COMPARISON_DEFAULTS,
  selectPeers,
  type PeerCompany,
  type PeerMetric,
} from './peer-comparison-engine.js';

function company(
  id: string,
  marketCap: number | null,
  metrics: Partial<Record<PeerMetric, number | null>> = {},
  sector = '輸送用機器',
): PeerCompany {
  return { id, name: `Company ${id}`, sector, marketCap, metrics };
}

describe('calculateMedian', () => {
  test('calculates odd and even medians without using a mean as a substitute', () => {
    expect(calculateMedian([3, 1, 2])).toBe(2);
    expect(calculateMedian([4, 1, 3, 2])).toBe(2.5);
  });

  test('uses only available finite values', () => {
    expect(calculateMedian([1, null, Number.NaN, undefined, 3])).toBe(2);
    expect(calculateMedian([null, Number.POSITIVE_INFINITY])).toBeNull();
  });
});

describe('calculatePeerPercentile', () => {
  test('ranks higher profitability values toward one', () => {
    expect(calculatePeerPercentile([10, 20, 30], 30, 'higher_is_better')).toBe(1);
    expect(calculatePeerPercentile([10, 20, 30], 10, 'higher_is_better')).toBe(0);
  });

  test('ranks lower valuation values toward one', () => {
    expect(calculatePeerPercentile([10, 20, 30], 10, 'lower_is_better')).toBe(1);
    expect(calculatePeerPercentile([10, 20, 30], 30, 'lower_is_better')).toBe(0);
  });

  test('uses average rank for ties', () => {
    expect(calculatePeerPercentile([10, 20, 20, 30], 20, 'higher_is_better')).toBe(0.5);
  });

  test('requires a comparison value and an observed target', () => {
    expect(calculatePeerPercentile([10], 10, 'higher_is_better')).toBeNull();
    expect(calculatePeerPercentile([10, 20], 15, 'higher_is_better')).toBeNull();
  });
});

describe('selectPeers', () => {
  const target = company('target', 100);

  test('keeps only unique same-sector companies and always excludes the target', () => {
    const duplicate = company('p1', 100);
    const result = selectPeers(target, [
      target,
      { ...target },
      duplicate,
      { ...duplicate },
      company('other-sector', 100, {}, '銀行業'),
    ]);

    expect(result.peers.map((peer) => peer.id)).toEqual(['p1']);
    expect(result.sameSectorCandidateCount).toBe(1);
    expect(result.tooFewPeers).toBeTrue();
  });

  test('treats the 0.3x and 3x market-cap boundaries as prioritized', () => {
    const result = selectPeers(target, [
      company('lower-bound', 30),
      company('upper-bound', 300),
      company('below', 29),
      company('above', 301),
      company('near', 90),
    ]);

    expect(result.marketCapPrioritizedPeerCount).toBe(3);
    expect(result.peers.slice(0, 3).map((peer) => peer.id)).toEqual([
      'near',
      'upper-bound',
      'lower-bound',
    ]);
  });

  test('limits the peer set to ten', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => (
      company(`p${String(index).padStart(2, '0')}`, 90 + index)
    ));
    expect(selectPeers(target, candidates).peers).toHaveLength(
      PEER_COMPARISON_DEFAULTS.maximumPeers,
    );
  });

  test('includes the sector leader even when it is outside the priority range', () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, index) => company(`p${index}`, 90 + index)),
      company('leader', 1_000),
    ];
    const result = selectPeers(target, candidates);

    expect(result.peers).toHaveLength(10);
    expect(result.peers.map((peer) => peer.id)).toContain('leader');
    expect(result.sectorLeaderId).toBe('leader');
    expect(result.sectorLeaderIncluded).toBeTrue();
  });

  test('reports too few peers without fabricating companies', () => {
    const result = selectPeers(target, [company('p1', 100), company('p2', 110)]);
    expect(result.peers).toHaveLength(2);
    expect(result.tooFewPeers).toBeTrue();
  });
});

describe('analyzePeerComparison', () => {
  test('returns structured median, rank, and percentile for all MVP metrics', () => {
    const metrics: Record<PeerMetric, number> = {
      per: 10,
      pbr: 1,
      roe: 20,
      roic: 15,
      operatingMargin: 12,
      revenueGrowth: 8,
      dividendYield: 3,
    };
    const target = company('target', 100, metrics);
    const peers = [
      company('p1', 90, {
        per: 20, pbr: 2, roe: 10, roic: 5,
        operatingMargin: 8, revenueGrowth: 4, dividendYield: 2,
      }),
      company('p2', 110, {
        per: 30, pbr: 3, roe: 15, roic: 10,
        operatingMargin: 10, revenueGrowth: 6, dividendYield: 2.5,
      }),
    ];

    const result = analyzePeerComparison(target, peers);
    expect(result.targetIncludedInStatistics).toBeTrue();
    expect(result.positions.per).toMatchObject({
      targetValue: 10,
      median: 20,
      rank: 1,
      percentile: 1,
      peerSampleSize: 2,
      cohortSize: 3,
    });
    expect(result.positions.roe).toMatchObject({
      targetValue: 20,
      median: 15,
      rank: 1,
      percentile: 1,
    });
    expect(result.unavailable).toEqual([]);
  });

  test('uses the target exactly once when candidates also contain it', () => {
    const target = company('target', 100, { roe: 20 });
    const result = analyzePeerComparison(target, [
      { ...target },
      company('p1', 90, { roe: 10 }),
      company('p2', 110, { roe: 30 }),
    ]);

    expect(result.selection.peers.map((peer) => peer.id)).not.toContain('target');
    expect(result.positions.roe.cohortSize).toBe(3);
    expect(result.positions.roe.median).toBe(20);
    expect(result.positions.roe.rank).toBe(2);
    expect(result.positions.roe.percentile).toBe(0.5);
  });

  test('excludes missing peer values per metric instead of filling them', () => {
    const target = company('target', 100, { roe: 20, per: 15 });
    const result = analyzePeerComparison(target, [
      company('p1', 90, { roe: null, per: 10 }),
      company('p2', 110, { roe: 30, per: Number.NaN }),
    ]);

    expect(result.positions.roe).toMatchObject({
      peerSampleSize: 1,
      cohortSize: 2,
      median: 25,
      rank: 2,
      percentile: 0,
    });
    expect(result.positions.per).toMatchObject({
      peerSampleSize: 1,
      cohortSize: 2,
      median: 12.5,
      rank: 2,
      percentile: 0,
    });
  });

  test('marks a missing target metric unavailable', () => {
    const result = analyzePeerComparison(
      company('target', 100, { roe: null }),
      [company('p1', 90, { roe: 10 })],
    );

    expect(result.positions.roe).toMatchObject({
      targetValue: null,
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: 1,
      cohortSize: 0,
    });
    expect(result.unavailable).toContainEqual({
      metric: 'roe',
      reason: 'missing_target_metric',
    });
  });

  test('marks a metric unavailable when no selected peer has it', () => {
    const result = analyzePeerComparison(
      company('target', 100, { roe: 20 }),
      [company('p1', 90, { roe: null })],
    );

    expect(result.positions.roe).toMatchObject({
      targetValue: 20,
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: 0,
      cohortSize: 1,
    });
    expect(result.unavailable).toContainEqual({
      metric: 'roe',
      reason: 'insufficient_peer_data',
    });
  });
});
