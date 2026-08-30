import { describe, expect, test } from 'bun:test';
import {
  AnalysisSnapshotSchema,
  type AnalysisSnapshotV9,
  type SnapshotPeerComparison,
} from '../../analysis/snapshot/schema.js';
import { comparisonSnapshot, snapshotAtVersion } from '../../analysis/comparison/test-fixtures.js';
import type { PeerMetric } from '../../tools/finance/peer-comparison-engine.js';
import { buildPeerRadarModel, PEER_RADAR_AXES } from './peer-radar.js';

const TARGET_METRICS: Readonly<Record<PeerMetric, number>> = {
  per: 12,
  pbr: 1.2,
  roe: 0.11,
  roic: 0.09,
  operatingMargin: 0.08,
  revenueGrowth: 0.05,
  dividendYield: 0.025,
};

function peerFixture(): SnapshotPeerComparison {
  const peers = Array.from({ length: 5 }, (_, index) => ({
    id: `72${index + 10}`,
    name: `比較企業${index + 1}`,
    sector: '輸送用機器',
    marketCap: 20_000 - index * 1_000,
    dataDate: '2026-08-21',
    metrics: { per: 10 + index },
  }));
  const position = (metric: PeerMetric, index: number) => {
    const peerSampleSize = metric === 'per' ? 1 : metric === 'pbr' ? 4 : 5;
    return {
      metric,
      direction: metric === 'per' || metric === 'pbr'
        ? 'lower_is_better' as const
        : 'higher_is_better' as const,
      targetValue: TARGET_METRICS[metric],
      median: TARGET_METRICS[metric] + 0.5,
      rank: metric === 'pbr' ? 2.5 : 1,
      percentile: index === 0 ? 0 : index === 1 ? 1 : index / (PEER_RADAR_AXES.length - 1),
      peerSampleSize,
      cohortSize: peerSampleSize + 1,
    };
  };
  return {
    result: {
      target: {
        id: '7203',
        name: 'トヨタ自動車株式会社',
        sector: '輸送用機器',
        marketCap: 50_000,
        dataDate: '2026-08-21',
        metrics: { ...TARGET_METRICS },
      },
      selection: {
        peers,
        sameSectorCandidateCount: 5,
        marketCapPrioritizedPeerCount: 5,
        sectorLeaderId: '7203',
        sectorLeaderIncluded: true,
        tooFewPeers: false,
      },
      targetIncludedInStatistics: true,
      positions: Object.fromEntries(PEER_RADAR_AXES.map((axis, index) => [
        axis.metric,
        position(axis.metric, index),
      ])) as SnapshotPeerComparison['result']['positions'],
      unavailable: [],
    },
    marketCapPriorityApplied: false,
    marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap',
  };
}

describe('Peer Radar stored-position validation', () => {
  test('accepts boundary percentiles, fractional ranks, and sparse stored samples', () => {
    const model = buildPeerRadarModel('7203', peerFixture());

    expect(model.selectionState).toBe('available');
    expect(model.polygonPercentiles).toHaveLength(7);
    expect(model.polygonPercentiles?.[0]).toBe(0);
    expect(model.polygonPercentiles?.[1]).toBe(1);
    expect(model.axes.find(axis => axis.metric === 'per')?.peerSampleSize).toBe(1);
    expect(model.axes.find(axis => axis.metric === 'pbr')).toMatchObject({
      rank: 2.5,
      peerSampleSize: 4,
      state: 'available',
    });
    expect(model.marketCapPriorityApplied).toBeFalse();
    expect(model.marketCapPriorityUnavailableReason).toBe('incomplete_peer_market_cap');
  });

  test('suppresses the polygon for every invalid stored position boundary', () => {
    const cases: ReadonlyArray<Readonly<{
      name: string;
      mutate: (peer: SnapshotPeerComparison) => void;
    }>> = [
      { name: 'missing percentile', mutate: peer => { peer.result.positions.roe.percentile = null; } },
      { name: 'percentile below zero', mutate: peer => { peer.result.positions.roe.percentile = -0.01; } },
      { name: 'percentile above one', mutate: peer => { peer.result.positions.roe.percentile = 1.01; } },
      {
        name: 'direction mismatch',
        mutate: peer => { peer.result.positions.roe.direction = 'lower_is_better'; },
      },
      { name: 'target mismatch', mutate: peer => { peer.result.positions.roe.targetValue = 999; } },
      { name: 'missing median', mutate: peer => { peer.result.positions.roe.median = null; } },
      { name: 'zero sample', mutate: peer => { peer.result.positions.roe.peerSampleSize = 0; } },
      { name: 'fractional sample', mutate: peer => { peer.result.positions.roe.peerSampleSize = 1.5; } },
      { name: 'sample above selection', mutate: peer => { peer.result.positions.roe.peerSampleSize = 6; } },
      { name: 'cohort mismatch', mutate: peer => { peer.result.positions.roe.cohortSize = 9; } },
      { name: 'rank below one', mutate: peer => { peer.result.positions.roe.rank = 0.5; } },
      { name: 'rank above cohort', mutate: peer => { peer.result.positions.roe.rank = 7; } },
    ];

    for (const item of cases) {
      const peer = peerFixture();
      item.mutate(peer);
      const model = buildPeerRadarModel('7203', peer);
      expect(model.polygonPercentiles, item.name).toBeNull();
      expect(model.axes.find(axis => axis.metric === 'roe')?.state, item.name).toBe('invalid');
    }
  });

  test('validates selected-peer identity, sector, count, and tooFewPeers without metric replay', () => {
    const invalidSelections: ReadonlyArray<Readonly<{
      name: string;
      ticker?: string;
      mutate: (peer: SnapshotPeerComparison) => void;
    }>> = [
      { name: 'target ticker', ticker: '9999', mutate: () => {} },
      {
        name: 'duplicate peer',
        mutate: peer => { peer.result.selection.peers[1]!.id = peer.result.selection.peers[0]!.id; },
      },
      {
        name: 'target selected',
        mutate: peer => { peer.result.selection.peers[0]!.id = peer.result.target.id; },
      },
      {
        name: 'sector mismatch',
        mutate: peer => { peer.result.selection.peers[0]!.sector = '電気機器'; },
      },
      {
        name: 'tooFew mismatch',
        mutate: peer => { peer.result.selection.tooFewPeers = true; },
      },
      {
        name: 'above maximum count',
        mutate: peer => {
          for (let index = 0; index < 6; index += 1) {
            peer.result.selection.peers.push({
              ...structuredClone(peer.result.selection.peers[0]!),
              id: `98${index}0`,
            });
          }
        },
      },
    ];

    for (const item of invalidSelections) {
      const peer = peerFixture();
      item.mutate(peer);
      const model = buildPeerRadarModel(item.ticker ?? '7203', peer);
      expect(model.selectionState, item.name).toBe('invalid');
      expect(model.polygonPercentiles, item.name).toBeNull();
    }

    const sparseSelection = peerFixture();
    sparseSelection.result.selection.peers.splice(4);
    sparseSelection.result.selection.tooFewPeers = true;
    for (const axis of PEER_RADAR_AXES) {
      const position = sparseSelection.result.positions[axis.metric];
      position.peerSampleSize = Math.min(position.peerSampleSize, 4);
      position.cohortSize = position.peerSampleSize + 1;
    }
    const sparseModel = buildPeerRadarModel('7203', sparseSelection);
    expect(sparseModel.selectionState).toBe('unavailable');
    expect(sparseModel.axes.every(axis => axis.state === 'available')).toBeTrue();
    expect(sparseModel.polygonPercentiles).toBeNull();
  });

  test('preserves exact unavailable states and rejects inconsistent unavailable shapes', () => {
    const missingTarget = peerFixture();
    missingTarget.result.unavailable.push({ metric: 'roe', reason: 'missing_target_metric' });
    Object.assign(missingTarget.result.positions.roe, {
      targetValue: null,
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: 4,
      cohortSize: 0,
    });
    expect(buildPeerRadarModel('7203', missingTarget).axes.find(axis => axis.metric === 'roe')).toMatchObject({
      state: 'unavailable',
      stateReason: 'missing_target_metric',
    });

    const zeroSample = peerFixture();
    zeroSample.result.unavailable.push({ metric: 'roe', reason: 'insufficient_peer_data' });
    Object.assign(zeroSample.result.positions.roe, {
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: 0,
      cohortSize: 1,
    });
    const zeroModel = buildPeerRadarModel('7203', zeroSample);
    expect(zeroModel.polygonPercentiles).toBeNull();
    expect(zeroModel.axes.find(axis => axis.metric === 'roe')).toMatchObject({
      peerSampleSize: 0,
      state: 'unavailable',
      stateReason: 'insufficient_peer_data',
    });

    zeroSample.result.positions.roe.peerSampleSize = 1;
    expect(buildPeerRadarModel('7203', zeroSample).axes.find(axis => axis.metric === 'roe')?.state)
      .toBe('invalid');
  });

  test('does not replay selected-peer metric eligibility', () => {
    const first = peerFixture();
    const second = structuredClone(first);
    for (const peer of first.result.selection.peers) peer.metrics = { per: -10, roe: null };
    for (const peer of second.result.selection.peers) peer.metrics = { per: 100, roe: 100 };

    expect(buildPeerRadarModel('7203', first)).toEqual(buildPeerRadarModel('7203', second));
  });

  test('keeps the same sparse Radar model in every V1-V9 envelope', () => {
    const v9 = structuredClone(comparisonSnapshot());
    v9.peerComparison = peerFixture();
    v9.dataDates.peerComparison = '2026-08-21';
    v9.unavailable = v9.unavailable.filter(item => item.section !== 'peerComparison');
    const parsed = AnalysisSnapshotSchema.parse(v9) as AnalysisSnapshotV9;
    const expected = buildPeerRadarModel('7203', parsed.peerComparison!);

    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const snapshot = snapshotAtVersion(parsed, version);
      expect(buildPeerRadarModel(snapshot.canonicalTicker, snapshot.peerComparison!)).toEqual(expected);
    }
  });

  test('keeps the Dashboard module boundary free of the Engine eligibility predicate', async () => {
    const source = await Bun.file(new URL('./peer-radar.ts', import.meta.url)).text();
    expect(source).not.toContain('isAvailableMetricValue');
    expect(source.match(/\.metrics/g)).toHaveLength(2);
    expect(source).toContain('result.target.metrics');
  });
});
