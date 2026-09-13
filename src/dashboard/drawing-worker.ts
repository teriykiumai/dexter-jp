import { drawingProjections, fibonacciLevels } from './drawing-projection.js';
import { BasisAcceptSchema, type BasisAccept } from './drawing-contracts.js';
import { drawingCandidate } from './drawing-candidate.js';
import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { objectRow, rowRef, type VerifiedObject } from '../analysis/workspace/references.js';
import { objectKey, scopeKey, fail, WorkspaceError, json, type ObjectRef, type StoredDrawing } from '../analysis/workspace/contracts.js';
import { verifiedTechnical } from '../analysis/workspace/verified-technical.js';
import { compareVerifiedDrawingBasis } from '../analysis/workspace/technical-input.js';
import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import { DrawingWriteSchema, type DrawingWrite, type DrawingPage, type DrawingView } from './drawing-contracts.js';

export type DrawingWork = { root: string; instrumentId: string; after?: string; write?: DrawingWrite; restore?: StoredDrawing; accept?: BasisAccept & { id: string }; chartDigest?: string };
export type DrawingProof = { instrumentId: string; artifact: string; receipt: string; chartDigest: string; dates: string[];
  basisObject: ObjectRef; originals: StoredDrawing[]; compatible: string[];
  objects: { ref: ObjectRef; metadata: string }[] };
export type DrawingResult = { page: DrawingPage; proof: DrawingProof | null } | { drawing: StoredDrawing; artifact: string; receipt: string; before?: StoredDrawing };
export function drawingWork(request: DrawingWork): DrawingResult {
  const db = new WorkspaceDatabase(request.root, { readonly: true });
  try {
    const repository = new WorkspaceRepository(db), id = request.instrumentId;
    const binding = db.sqlite.query<{ artifact: string; receipt: string }, [string]>(`SELECT b.artifact,b.receipt
      FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset='technical'`).get(scopeKey({ kind: 'instrument-owned', instrumentId: id }));
    const objects = new Map<string, VerifiedObject>();
    const verified = new Map<string, TechnicalArtifactV2>();
    const load = (artifact: string, receipt: string) => {
      const key = `${artifact}:${receipt}`;
      if (!verified.has(key)) verified.set(key, verifiedTechnical(db, id, rowRef(objectRow(db, artifact)), rowRef(objectRow(db, receipt)), objects));
      return verified.get(key)!;
    };
    const current = binding ? load(binding.artifact, binding.receipt) : null;
    const originalBasis = (drawing: StoredDrawing, ref = drawing.basisObject) => {
      if (drawing.instrumentId !== id) fail('identity_review_required');
      const old = db.sqlite.query<{ receipt: string }, [string, string]>(`SELECT receipt FROM artifact_bindings
        WHERE artifact=? AND scope=? AND dataset='technical' ORDER BY binding_id LIMIT 1`)
        .get(objectKey(ref), scopeKey({ kind: 'instrument-owned', instrumentId: id }));
      if (!old) fail('reference_conflict');
      return load(objectKey(ref), old.receipt);
    };
    const compatibility = (drawing: StoredDrawing): DrawingView['state'] => {
      if (!current) return 'basis_review_required';
      try {
        const original = originalBasis(drawing);
        const basis = drawing.acceptedBasis ? originalBasis(drawing, drawing.acceptedBasis.object) : original;
        return compareVerifiedDrawingBasis(basis, current, drawing.evidenceFrom, drawing.evidenceThrough);
      } catch { return 'basis_review_required'; }
    };
    if (request.accept) {
      const { id: drawingId, ...raw } = request.accept, accept = BasisAcceptSchema.parse(raw);
      if (!current || !binding || accept.chartDigest !== current.artifactDigest) fail('revision_conflict');
      const drawing = repository.drawing(id, drawingId);
      if (!drawing || drawing.revision !== accept.revision) fail('revision_conflict');
      const original = originalBasis(drawing);
      if (drawing.acceptedBasis) originalBasis(drawing, drawing.acceptedBasis.object);
      if (original.input.identity.code !== current.input.identity.code || original.input.adjustmentMethod !== current.input.adjustmentMethod
        || drawing.evidenceFrom < current.input.eligibilityFrom
        || compareVerifiedDrawingBasis(current, current, drawing.evidenceFrom, drawing.evidenceThrough) !== 'compatible') fail('identity_review_required');
      const dates = current.result.intervals.day.map(row => row.displayDate);
      if (!dates.includes(drawing.time) || (drawing.kind !== 'horizontal' && !dates.includes(drawing.endTime))) fail('identity_review_required');
      return { before: drawing, drawing: { ...drawing, revision: drawing.revision + 1,
        acceptedBasis: { object: rowRef(objectRow(db, binding.artifact)), revision: drawing.revision + 1 } }, ...binding };
    }
    if (request.restore) {
      const drawing = request.restore;
      if (!current || !binding || request.chartDigest !== current.artifactDigest) fail('revision_conflict');
      // Exact historical ownership/closure must verify even when the current basis differs.
      const original = originalBasis(drawing);
      if (drawing.acceptedBasis) originalBasis(drawing, drawing.acceptedBasis.object);
      const dates = original.result.intervals.day.map(row => row.displayDate);
      if (!dates.includes(drawing.time) || (drawing.kind !== 'horizontal' && !dates.includes(drawing.endTime))) fail('invalid_input');
      return { drawing, ...binding };
    }
    if (request.write) {
      const write = DrawingWriteSchema.parse(request.write);
      if (!binding || !current || write.chartDigest !== current.artifactDigest) fail('revision_conflict');
      const existing = repository.drawing(id, write.id);
      if (write.revision === 0 ? existing !== null : existing?.revision !== write.revision) fail('revision_conflict');
      if (existing && compatibility(existing) !== 'compatible') fail('identity_review_required');
      const drawing = drawingCandidate(id, write, existing, current.result.intervals.day.map(row => row.displayDate),
        rowRef(objectRow(db, binding.artifact)));
      if (compatibility(drawing) !== 'compatible') fail('identity_review_required');
      return { drawing, artifact: binding.artifact, receipt: binding.receipt };
    }
    const rows = repository.drawings(id, request.after ?? '', 101), pageRows = rows.slice(0, 100);
    const items: DrawingView[] = pageRows.map(drawing => { const state = compatibility(drawing); return ({ id: drawing.id, instrumentId: id, kind: drawing.kind, family: 'swing',
        adjustmentMode: 'jquants_adjusted_ohlcv_not_total_return', revision: drawing.revision, price: drawing.price,
        time: drawing.time, evidenceFrom: drawing.evidenceFrom, evidenceThrough: drawing.evidenceThrough,
        basisDigest: drawing.basisObject.digest, state,
        acceptedBasis: drawing.acceptedBasis ? { digest: drawing.acceptedBasis.object.digest, revision: drawing.acceptedBasis.revision } : null,
        projections: drawingProjections(drawing, current, state),
        ...(drawing.kind === 'fibonacci' ? { levels: fibonacciLevels(drawing.price, drawing.endPrice) } : {}),
        ...(drawing.kind !== 'horizontal' ? { endTime: drawing.endTime, endPrice: drawing.endPrice } : {}) } as DrawingView); });
    return { page: { schemaVersion: 'workspace_drawings_v3', instrumentId: id, chartDigest: current?.artifactDigest ?? null,
      items, next: rows.length > 100 ? pageRows.at(-1)!.id : null }, proof: current && binding
        && [...objects.values()].reduce((bytes, object) => bytes + object.bytes.byteLength, 0) <= 8 * 1024 * 1024 ? {
        instrumentId: id, ...binding, chartDigest: current.artifactDigest, dates: current.result.intervals.day.map(row => row.displayDate),
        basisObject: rowRef(objectRow(db, binding.artifact)), originals: pageRows,
        compatible: items.filter(item => item.state === 'compatible').map(item => item.id),
        objects: [...objects.values()].map(object => ({ ref: object.ref, metadata: json(object.metadata) })),
      } : null };
  } finally { db.close(); }
}
if (typeof self !== 'undefined' && 'postMessage' in self) self.onmessage = (event: MessageEvent<DrawingWork>) => {
  try { self.postMessage({ ok: true, result: drawingWork(event.data) }); }
  catch (error) { self.postMessage({ ok: false, code: error instanceof WorkspaceError ? error.code : 'reference_conflict' }); }
};
