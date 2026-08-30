import type { SnapshotPeerComparison } from '../../analysis/snapshot/schema.js';
import {
  PEER_COMPARISON_DEFAULTS,
  PEER_METRIC_DIRECTIONS,
  type PeerMetric,
  type PeerMetricDirection,
  type PeerMetricUnavailableReason,
} from '../../tools/finance/peer-comparison-engine.js';

export const PEER_RADAR_AXES = [
  { metric: 'per', label: 'PER' },
  { metric: 'pbr', label: 'PBR' },
  { metric: 'roe', label: 'ROE' },
  { metric: 'roic', label: 'ROIC' },
  { metric: 'operatingMargin', label: '営業利益率' },
  { metric: 'revenueGrowth', label: '売上成長率' },
  { metric: 'dividendYield', label: '配当利回り' },
] as const satisfies readonly Readonly<{ metric: PeerMetric; label: string }>[];

export type PeerRadarAxisState = 'available' | 'unavailable' | 'invalid';
export type PeerRadarSelectionState = 'available' | 'unavailable' | 'invalid';

export interface PeerRadarAxisModel {
  metric: PeerMetric;
  label: string;
  direction: PeerMetricDirection;
  targetValue: number | null;
  median: number | null;
  rank: number | null;
  percentile: number | null;
  peerSampleSize: number;
  cohortSize: number;
  state: PeerRadarAxisState;
  stateReason: PeerMetricUnavailableReason | string | null;
}

export interface PeerRadarModel {
  axes: readonly PeerRadarAxisModel[];
  polygonPercentiles: readonly number[] | null;
  selectedPeerCount: number;
  tooFewPeers: boolean;
  selectionState: PeerRadarSelectionState;
  selectionStateReason: string | null;
  marketCapPriorityApplied: boolean;
  marketCapPriorityUnavailableReason: SnapshotPeerComparison['marketCapPriorityUnavailableReason'];
}

interface PeerRadarSnapshotUnavailable {
  section: string;
  metric?: string;
  reason: string;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function exactNumber(left: number | null | undefined, right: number | null | undefined): boolean {
  return isFiniteNumber(left) && isFiniteNumber(right) && left === right;
}

function validateSelection(
  canonicalTicker: string,
  peer: SnapshotPeerComparison,
): Readonly<{ state: PeerRadarSelectionState; reason: string | null }> {
  const { target, selection } = peer.result;
  const peers = selection.peers;
  const peerIds = new Set(peers.map(item => item.id));

  if (target.id !== canonicalTicker) return { state: 'invalid', reason: 'target_ticker_mismatch' };
  if (peerIds.size !== peers.length) return { state: 'invalid', reason: 'duplicate_peer_id' };
  if (peerIds.has(target.id)) return { state: 'invalid', reason: 'target_in_peer_selection' };
  if (peers.some(item => item.sector !== target.sector)) {
    return { state: 'invalid', reason: 'peer_sector_mismatch' };
  }
  const expectedTooFew = peers.length < PEER_COMPARISON_DEFAULTS.minimumPeers;
  if (selection.tooFewPeers !== expectedTooFew) {
    return { state: 'invalid', reason: 'too_few_peers_mismatch' };
  }
  if (peers.length > PEER_COMPARISON_DEFAULTS.maximumPeers) {
    return { state: 'invalid', reason: 'selected_peer_count_out_of_range' };
  }
  if (expectedTooFew) return { state: 'unavailable', reason: 'too_few_selected_peers' };
  return { state: 'available', reason: null };
}

function unavailableAxisState(
  metric: PeerMetric,
  peer: SnapshotPeerComparison,
  unavailableReason: PeerMetricUnavailableReason,
): Readonly<{ state: PeerRadarAxisState; reason: string }> {
  const position = peer.result.positions[metric];
  const selectedPeerCount = peer.result.selection.peers.length;
  const commonValid = position.metric === metric
    && position.direction === PEER_METRIC_DIRECTIONS[metric]
    && position.median === null
    && position.rank === null
    && position.percentile === null
    && Number.isInteger(position.peerSampleSize)
    && position.peerSampleSize >= 0
    && position.peerSampleSize <= selectedPeerCount
    && Number.isInteger(position.cohortSize);
  const shapeValid = unavailableReason === 'missing_target_metric'
    ? commonValid && position.targetValue === null && position.cohortSize === 0
    : commonValid
      && exactNumber(position.targetValue, peer.result.target.metrics[metric])
      && position.peerSampleSize === 0
      && position.cohortSize === 1;
  return shapeValid
    ? { state: 'unavailable', reason: unavailableReason }
    : { state: 'invalid', reason: 'unavailable_position_mismatch' };
}

function axisModel(
  metric: PeerMetric,
  label: string,
  peer: SnapshotPeerComparison,
  snapshotUnavailable: readonly PeerRadarSnapshotUnavailable[],
): PeerRadarAxisModel {
  const position = peer.result.positions[metric];
  const expectedDirection = PEER_METRIC_DIRECTIONS[metric];
  const selectedPeerCount = peer.result.selection.peers.length;
  const unavailable = peer.result.unavailable.filter(item => item.metric === metric);
  const topLevelUnavailable = snapshotUnavailable.filter(item => (
    item.section === 'peerComparison' && item.metric === metric
  ));

  let state: PeerRadarAxisState = 'available';
  let stateReason: string | null = null;
  if (topLevelUnavailable.length > 1) {
    state = 'invalid';
    stateReason = 'duplicate_snapshot_unavailable_metric';
  } else if (unavailable.length > 1) {
    state = 'invalid';
    stateReason = 'duplicate_unavailable_metric';
  } else if (topLevelUnavailable[0] && !unavailable[0]) {
    state = 'invalid';
    stateReason = 'snapshot_unavailable_conflict';
  } else if (
    topLevelUnavailable[0]
    && unavailable[0]
    && topLevelUnavailable[0].reason !== unavailable[0].reason
  ) {
    state = 'invalid';
    stateReason = 'unavailable_reason_mismatch';
  } else if (unavailable[0]) {
    const unavailableState = unavailableAxisState(metric, peer, unavailable[0].reason);
    state = unavailableState.state;
    stateReason = unavailableState.reason;
  } else {
    const targetMetric = peer.result.target.metrics[metric];
    const valid = position.metric === metric
      && position.direction === expectedDirection
      && exactNumber(position.targetValue, targetMetric)
      && isFiniteNumber(position.median)
      && isFiniteNumber(position.percentile)
      && position.percentile >= 0
      && position.percentile <= 1
      && Number.isInteger(position.peerSampleSize)
      && position.peerSampleSize >= 1
      && position.peerSampleSize <= selectedPeerCount
      && position.cohortSize === position.peerSampleSize + 1
      && isFiniteNumber(position.rank)
      && position.rank >= 1
      && position.rank <= position.cohortSize;
    if (!valid) {
      state = 'invalid';
      stateReason = 'position_structure_mismatch';
    }
  }

  return {
    metric,
    label,
    direction: position.direction,
    targetValue: position.targetValue,
    median: position.median,
    rank: position.rank,
    percentile: position.percentile,
    peerSampleSize: position.peerSampleSize,
    cohortSize: position.cohortSize,
    state,
    stateReason,
  };
}

export function buildPeerRadarModel(
  canonicalTicker: string,
  peer: SnapshotPeerComparison,
  snapshotUnavailable: readonly PeerRadarSnapshotUnavailable[],
): PeerRadarModel {
  const selection = validateSelection(canonicalTicker, peer);
  const axes = PEER_RADAR_AXES.map(axis => (
    axisModel(axis.metric, axis.label, peer, snapshotUnavailable)
  ));
  const polygonPercentiles = selection.state === 'available'
    && axes.every(axis => axis.state === 'available' && axis.percentile !== null)
    ? axes.map(axis => axis.percentile as number)
    : null;

  return {
    axes,
    polygonPercentiles,
    selectedPeerCount: peer.result.selection.peers.length,
    tooFewPeers: peer.result.selection.tooFewPeers,
    selectionState: selection.state,
    selectionStateReason: selection.reason,
    marketCapPriorityApplied: peer.marketCapPriorityApplied,
    marketCapPriorityUnavailableReason: peer.marketCapPriorityUnavailableReason,
  };
}
