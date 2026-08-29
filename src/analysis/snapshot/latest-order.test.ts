import { describe, expect, test } from 'bun:test';
import type { AnalysisSnapshot } from './schema.js';
import {
  compareLatestSnapshotOrderV1,
  generatedAtEpochMs,
  resolveLatestSnapshotV1,
} from './latest-order.js';

function candidate(generatedAt: string) {
  return { snapshot: { generatedAt } as AnalysisSnapshot };
}

describe('LatestSnapshotOrderV1', () => {
  test('uses numeric epoch milliseconds rather than raw timestamp text', () => {
    const wholeSecond = candidate('2026-08-23T01:02:03Z');
    const fractionalSecond = candidate('2026-08-23T01:02:03.500Z');
    expect(generatedAtEpochMs(fractionalSecond.snapshot)).toBe(
      generatedAtEpochMs(wholeSecond.snapshot) + 500,
    );
    expect(compareLatestSnapshotOrderV1(fractionalSecond, wholeSecond)).toBe(500);
    expect(resolveLatestSnapshotV1([wholeSecond, fractionalSecond])).toBe(fractionalSecond);
  });

  test('returns null or the exact item for zero and one candidate without mutation', () => {
    const only = candidate('2026-08-23T01:02:03Z');
    const candidates = [only] as const;
    expect(resolveLatestSnapshotV1([])).toBeNull();
    expect(resolveLatestSnapshotV1(candidates)).toBe(only);
    expect(candidates).toEqual([only]);
  });

  test('fails rather than fabricating an equal-epoch tie-breaker', () => {
    expect(() => resolveLatestSnapshotV1([
      candidate('2026-08-23T01:02:03Z'),
      candidate('2026-08-23T01:02:03.000Z'),
    ])).toThrow('does not define an equal-epoch tie-breaker');
  });
});
