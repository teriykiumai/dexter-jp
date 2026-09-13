import { test, expect } from 'bun:test';
import { drawingProjections, fibonacciLevels } from './drawing-projection.js';
import { readStep2aTechnicalFixture } from '../analysis/workspace/technical-test-fixtures.js';
import type { StoredDrawing } from '../analysis/workspace/contracts.js';

test('Fibonacci fixed levels preserve direction, equal anchors and numeric boundaries', () => {
  fibonacciLevels(100, 200).forEach((row, i) => expect(row.price).toBeCloseTo([100, 123.6, 138.2, 150, 161.8, 178.6, 200][i]!, 10));
  fibonacciLevels(200, 100).forEach((row, i) => expect(row.price).toBeCloseTo([200, 176.4, 161.8, 150, 138.2, 121.4, 100][i]!, 10));
  expect(fibonacciLevels(10, 10).every(row => row.price === 10)).toBe(true);
  expect(fibonacciLevels(Number.MAX_VALUE, Number.MIN_VALUE).at(-1)!.price).toBe(Number.MIN_VALUE);
  for (const invalid of [0, -1, NaN, Infinity]) expect(() => fibonacciLevels(invalid, 1)).toThrow();
});

test('daily anchors project to containing periods without rewriting or inventing same-period positions', () => {
  const current = readStep2aTechnicalFixture().artifact;
  const drawing: StoredDrawing = { id: crypto.randomUUID(), instrumentId: current.input.identity.instrumentId,
    kind: 'trendline', price: 100, endPrice: 110, time: '2026-08-10', endTime: '2026-09-11',
    evidenceFrom: '2022-01-03', evidenceThrough: '2026-09-11', revision: 1,
    basisObject: { codec: 'workspace_technical_v2', digest: current.artifactDigest, path: 'original.json' } };
  const original = structuredClone(drawing), result = drawingProjections(drawing, current, 'compatible');
  for (const interval of ['day', 'week', 'month'] as const) {
    const first = current.result.intervals[interval].find(row => row.periodStart <= drawing.time && drawing.time <= row.periodEnd)!;
    expect(result[interval]).toMatchObject({ state: 'available', time: first.displayDate });
  }
  expect(drawing).toEqual(original);
  expect(drawingProjections({ ...drawing, time: '2026-09-10' }, current, 'compatible').week)
    .toEqual({ state: 'unavailable', reason: 'same_period' });
  expect(drawingProjections({ ...drawing, time: '2000-01-01' }, current, 'compatible').month)
    .toEqual({ state: 'unavailable', reason: 'missing_period' });
  expect(drawingProjections(drawing, current, 'basis_review_required').day)
    .toEqual({ state: 'unavailable', reason: 'basis_review_required' });
});
