import type { AnalysisSnapshot } from './schema.js';

export interface LatestSnapshotOrderItemV1 {
  readonly snapshot: AnalysisSnapshot;
}

export function generatedAtEpochMs(snapshot: AnalysisSnapshot): number {
  return Date.parse(snapshot.generatedAt);
}

export function compareLatestSnapshotOrderV1(
  left: LatestSnapshotOrderItemV1,
  right: LatestSnapshotOrderItemV1,
): number {
  return generatedAtEpochMs(left.snapshot) - generatedAtEpochMs(right.snapshot);
}

export function resolveLatestSnapshotV1<T extends LatestSnapshotOrderItemV1>(
  candidates: readonly T[],
): T | null {
  if (candidates.length === 0) return null;
  return candidates.slice(1).reduce((latest, candidate) => {
    const comparison = compareLatestSnapshotOrderV1(candidate, latest);
    if (comparison === 0) {
      throw new RangeError('LatestSnapshotOrderV1 does not define an equal-epoch tie-breaker.');
    }
    return comparison > 0 ? candidate : latest;
  }, candidates[0]);
}
