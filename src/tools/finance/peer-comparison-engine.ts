export const PEER_COMPARISON_DEFAULTS = {
  minimumPeers: 5,
  maximumPeers: 10,
  minimumMarketCapRatio: 0.3,
  maximumMarketCapRatio: 3,
} as const;

export const PEER_METRICS = [
  'per',
  'pbr',
  'roe',
  'roic',
  'operatingMargin',
  'revenueGrowth',
  'dividendYield',
] as const;

export type PeerMetric = typeof PEER_METRICS[number];
export type PeerMetricDirection = 'higher_is_better' | 'lower_is_better';

export const PEER_METRIC_DIRECTIONS: Readonly<Record<PeerMetric, PeerMetricDirection>> = {
  per: 'lower_is_better',
  pbr: 'lower_is_better',
  roe: 'higher_is_better',
  roic: 'higher_is_better',
  operatingMargin: 'higher_is_better',
  revenueGrowth: 'higher_is_better',
  dividendYield: 'higher_is_better',
};

export interface PeerCompany {
  id: string;
  name: string;
  sector: string;
  marketCap?: number | null;
  dataDate?: string | null;
  metrics: Partial<Record<PeerMetric, number | null>>;
}

export type PeerMetricUnavailableReason =
  | 'missing_target_metric'
  | 'insufficient_peer_data';

export interface UnavailablePeerMetric {
  metric: PeerMetric;
  reason: PeerMetricUnavailableReason;
}

export interface PeerMetricPosition {
  metric: PeerMetric;
  direction: PeerMetricDirection;
  targetValue: number | null;
  median: number | null;
  rank: number | null;
  percentile: number | null;
  peerSampleSize: number;
  cohortSize: number;
}

export interface PeerSelectionSummary {
  peers: PeerCompany[];
  sameSectorCandidateCount: number;
  marketCapPrioritizedPeerCount: number;
  sectorLeaderId: string | null;
  sectorLeaderIncluded: boolean;
  tooFewPeers: boolean;
}

export interface PeerComparisonResult {
  target: PeerCompany;
  selection: PeerSelectionSummary;
  targetIncludedInStatistics: true;
  positions: Record<PeerMetric, PeerMetricPosition>;
  unavailable: UnavailablePeerMetric[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAvailableMetricValue(
  metric: PeerMetric,
  value: number | null | undefined,
): value is number {
  if (!isFiniteNumber(value)) return false;
  // Non-positive valuation multiples do not express meaningful relative value.
  if (metric === 'per' || metric === 'pbr') return value > 0;
  if (metric === 'dividendYield') return value >= 0;
  return true;
}

function asPositiveNumber(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

/** Calculate a median from available finite values only. */
export function calculateMedian(
  values: readonly (number | null | undefined)[],
): number | null {
  const available = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (available.length === 0) return null;

  const middle = Math.floor(available.length / 2);
  return available.length % 2 === 1
    ? available[middle]
    : (available[middle - 1] + available[middle]) / 2;
}

/**
 * Return a directional percentile from zero (worst) to one (best).
 * The target must occur in the cohort; ties use their average rank.
 */
export function calculatePeerPercentile(
  cohort: readonly number[],
  target: number,
  direction: PeerMetricDirection,
): number | null {
  if (cohort.length < 2 || !cohort.every(isFiniteNumber) || !isFiniteNumber(target)) {
    return null;
  }

  const equalCount = cohort.filter((value) => value === target).length;
  if (equalCount === 0) return null;

  const worseCount = cohort.filter((value) => direction === 'higher_is_better'
    ? value < target
    : value > target).length;
  return (worseCount + (equalCount - 1) / 2) / (cohort.length - 1);
}

function calculateRank(
  cohort: readonly number[],
  target: number,
  direction: PeerMetricDirection,
): number | null {
  if (cohort.length < 2) return null;

  const equalCount = cohort.filter((value) => value === target).length;
  if (equalCount === 0) return null;
  const betterCount = cohort.filter((value) => direction === 'higher_is_better'
    ? value > target
    : value < target).length;
  return betterCount + (equalCount + 1) / 2;
}

function compareIds(left: PeerCompany, right: PeerCompany): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function compareByTargetMarketCap(
  left: PeerCompany,
  right: PeerCompany,
  targetMarketCap: number | null,
): number {
  const leftCap = asPositiveNumber(left.marketCap);
  const rightCap = asPositiveNumber(right.marketCap);

  if (targetMarketCap !== null) {
    const leftDistance = leftCap === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(Math.log(leftCap / targetMarketCap));
    const rightDistance = rightCap === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(Math.log(rightCap / targetMarketCap));
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  } else {
    if (leftCap !== null && rightCap !== null && leftCap !== rightCap) {
      return rightCap - leftCap;
    }
    if (leftCap !== null && rightCap === null) return -1;
    if (leftCap === null && rightCap !== null) return 1;
  }

  return compareIds(left, right);
}

function marketCapIsPrioritized(
  company: PeerCompany,
  targetMarketCap: number | null,
): boolean {
  const marketCap = asPositiveNumber(company.marketCap);
  if (marketCap === null || targetMarketCap === null) return false;
  const ratio = marketCap / targetMarketCap;
  return ratio >= PEER_COMPARISON_DEFAULTS.minimumMarketCapRatio
    && ratio <= PEER_COMPARISON_DEFAULTS.maximumMarketCapRatio;
}

function findSectorLeader(companies: readonly PeerCompany[]): PeerCompany | null {
  return companies.reduce<PeerCompany | null>((leader, company) => {
    const marketCap = asPositiveNumber(company.marketCap);
    if (marketCap === null) return leader;
    if (leader === null) return company;

    const leaderMarketCap = asPositiveNumber(leader.marketCap);
    if (leaderMarketCap === null || marketCap > leaderMarketCap) return company;
    if (marketCap === leaderMarketCap && compareIds(company, leader) < 0) return company;
    return leader;
  }, null);
}

/** Select 5-10 same-sector peers, prioritizing the 0.3x-3x market-cap range. */
export function selectPeers(
  target: PeerCompany,
  candidates: readonly PeerCompany[],
): PeerSelectionSummary {
  const uniqueCandidates = new Map<string, PeerCompany>();
  for (const candidate of candidates) {
    if (candidate.id === target.id || candidate.sector !== target.sector) continue;
    if (!uniqueCandidates.has(candidate.id)) uniqueCandidates.set(candidate.id, candidate);
  }

  const sameSectorCandidates = [...uniqueCandidates.values()];
  const targetMarketCap = asPositiveNumber(target.marketCap);
  const prioritized = sameSectorCandidates
    .filter((company) => marketCapIsPrioritized(company, targetMarketCap))
    .sort((left, right) => compareByTargetMarketCap(left, right, targetMarketCap));
  const remaining = sameSectorCandidates
    .filter((company) => !marketCapIsPrioritized(company, targetMarketCap))
    .sort((left, right) => compareByTargetMarketCap(left, right, targetMarketCap));

  const selected = [...prioritized, ...remaining]
    .slice(0, PEER_COMPARISON_DEFAULTS.maximumPeers);
  const sectorLeader = findSectorLeader([target, ...sameSectorCandidates]);

  if (
    sectorLeader !== null
    && sectorLeader.id !== target.id
    && !selected.some((company) => company.id === sectorLeader.id)
  ) {
    if (selected.length === PEER_COMPARISON_DEFAULTS.maximumPeers) {
      selected[selected.length - 1] = sectorLeader;
    } else {
      selected.push(sectorLeader);
    }
  }

  return {
    peers: selected,
    sameSectorCandidateCount: sameSectorCandidates.length,
    marketCapPrioritizedPeerCount: selected.filter((company) => (
      marketCapIsPrioritized(company, targetMarketCap)
    )).length,
    sectorLeaderId: sectorLeader?.id ?? null,
    sectorLeaderIncluded: sectorLeader !== null && (
      sectorLeader.id === target.id
      || selected.some((company) => company.id === sectorLeader.id)
    ),
    tooFewPeers: selected.length < PEER_COMPARISON_DEFAULTS.minimumPeers,
  };
}

function buildPosition(
  metric: PeerMetric,
  target: PeerCompany,
  peers: readonly PeerCompany[],
): { position: PeerMetricPosition; unavailable: UnavailablePeerMetric | null } {
  const direction = PEER_METRIC_DIRECTIONS[metric];
  const rawTargetValue = target.metrics[metric];
  const targetValue = isAvailableMetricValue(metric, rawTargetValue)
    ? rawTargetValue
    : null;
  const peerValues = peers
    .map((peer) => peer.metrics[metric])
    .filter((value): value is number => isAvailableMetricValue(metric, value));

  const unavailablePosition = (
    reason: PeerMetricUnavailableReason,
  ): { position: PeerMetricPosition; unavailable: UnavailablePeerMetric } => ({
    position: {
      metric,
      direction,
      targetValue,
      median: null,
      rank: null,
      percentile: null,
      peerSampleSize: peerValues.length,
      cohortSize: targetValue === null ? 0 : 1,
    },
    unavailable: { metric, reason },
  });

  if (targetValue === null) return unavailablePosition('missing_target_metric');
  if (peerValues.length === 0) return unavailablePosition('insufficient_peer_data');

  // The selected peer list excludes the target; every metric cohort adds it once.
  const cohort = [targetValue, ...peerValues];
  return {
    position: {
      metric,
      direction,
      targetValue,
      median: calculateMedian(cohort),
      rank: calculateRank(cohort, targetValue, direction),
      percentile: calculatePeerPercentile(cohort, targetValue, direction),
      peerSampleSize: peerValues.length,
      cohortSize: cohort.length,
    },
    unavailable: null,
  };
}

/** Build a deterministic structured position for the target within selected peers. */
export function analyzePeerComparison(
  target: PeerCompany,
  candidates: readonly PeerCompany[],
): PeerComparisonResult {
  const selection = selectPeers(target, candidates);
  const positions = {} as Record<PeerMetric, PeerMetricPosition>;
  const unavailable: UnavailablePeerMetric[] = [];

  for (const metric of PEER_METRICS) {
    const result = buildPosition(metric, target, selection.peers);
    positions[metric] = result.position;
    if (result.unavailable !== null) unavailable.push(result.unavailable);
  }

  return {
    target,
    selection,
    targetIncludedInStatistics: true,
    positions,
    unavailable,
  };
}
