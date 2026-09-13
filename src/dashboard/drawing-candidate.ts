import { DrawingSchema, fail, parse, type ObjectRef, type StoredDrawing } from '../analysis/workspace/contracts.js';
import type { DrawingWrite } from './drawing-contracts.js';

// Both cold worker validation and warm proof writes use the same anchor predicate.
export function drawingCandidate(instrumentId: string, write: DrawingWrite, existing: StoredDrawing | null,
  dates: readonly string[], basisObject: ObjectRef): StoredDrawing {
  const kind = 'kind' in write ? write.kind : 'horizontal';
  if (existing && existing.kind !== kind) fail('invalid_input');
  if (!dates.includes(write.time) || ('endTime' in write && !dates.includes(write.endTime))) fail('invalid_input');
  const common = { id: write.id, instrumentId, price: write.price, time: write.time, revision: write.revision + 1,
    basisObject: existing?.basisObject ?? basisObject, ...(existing?.acceptedBasis ? { acceptedBasis: existing.acceptedBasis } : {}), evidenceFrom: existing?.evidenceFrom ?? dates[0],
    evidenceThrough: existing?.evidenceThrough ?? dates.at(-1) };
  return parse(DrawingSchema, 'endTime' in write
    ? { ...common, kind, endTime: write.endTime, endPrice: write.endPrice, ...(kind === 'fibonacci' ? { levelsVersion: 'retracement_v1' } : {}) } : { ...common, kind });
}
