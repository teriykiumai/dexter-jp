import type { StoredDrawing } from '../analysis/workspace/contracts.js';
import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { DrawingView } from './drawing-contracts.js';

export const FIBONACCI_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export function fibonacciLevels(start: number, end: number) {
  if (![start, end].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid Fibonacci anchors');
  return FIBONACCI_RATIOS.map(ratio => ({ ratio, price: ratio === 0 ? start : ratio === 1 ? end : start + (end - start) * ratio }));
}

/** Map canonical anchors to existing containing candles; never invent positions. */
export function drawingProjections(drawing: StoredDrawing, current: TechnicalArtifactV2 | null,
  state: DrawingView['state']): DrawingView['projections'] {
  const project = (interval: 'day' | 'week' | 'month'): DrawingView['projections']['day'] => {
    if (!current || state !== 'compatible') return { state: 'unavailable', reason: 'basis_review_required' };
    const candles = current.result.intervals[interval];
    const start = candles.find(row => row.periodStart <= drawing.time && drawing.time <= row.periodEnd);
    const endTime = drawing.kind === 'horizontal' ? drawing.time : drawing.endTime;
    const end = candles.find(row => row.periodStart <= endTime && endTime <= row.periodEnd);
    if (!start || !end) return { state: 'unavailable', reason: 'missing_period' };
    if (drawing.kind !== 'horizontal' && start.displayDate === end.displayDate) return { state: 'unavailable', reason: 'same_period' };
    return { state: 'available', time: start.displayDate, endTime: end.displayDate };
  };
  return { day: project('day'), week: project('week'), month: project('month') };
}
