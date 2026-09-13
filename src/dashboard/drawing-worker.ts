import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { objectRow, rowRef, type VerifiedObject } from '../analysis/workspace/references.js';
import { objectKey, scopeKey, fail, WorkspaceError, json, type ObjectRef, type StoredDrawing } from '../analysis/workspace/contracts.js';
import { verifiedTechnical } from '../analysis/workspace/verified-technical.js';
import { compareVerifiedDrawingBasis } from '../analysis/workspace/technical-input.js';
import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import { HorizontalWriteSchema, type HorizontalWrite, type DrawingPage, type HorizontalView } from './drawing-contracts.js';

export type DrawingWork = { root: string; instrumentId: string; after?: string; write?: HorizontalWrite };
export type DrawingProof = { instrumentId: string; artifact: string; receipt: string; chartDigest: string; dates: string[];
  basisObject: ObjectRef; originals: StoredDrawing[]; compatible: string[];
  objects: { ref: ObjectRef; metadata: string }[] };
export type DrawingResult = { page: DrawingPage; proof: DrawingProof | null } | { drawing: StoredDrawing; artifact: string; receipt: string };
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
    const compatibility = (drawing: StoredDrawing): HorizontalView['state'] => {
      if (!current) return 'basis_review_required';
      try {
        const old = db.sqlite.query<{ receipt: string }, [string, string]>(`SELECT receipt FROM artifact_bindings
          WHERE artifact=? AND scope=? AND dataset='technical' ORDER BY binding_id LIMIT 1`)
          .get(objectKey(drawing.basisObject), scopeKey({ kind: 'instrument-owned', instrumentId: id }));
        if (!old) return 'basis_review_required';
        const original = load(objectKey(drawing.basisObject), old.receipt);
        return compareVerifiedDrawingBasis(original, current, drawing.evidenceFrom, drawing.evidenceThrough);
      } catch { return 'basis_review_required'; }
    };
    if (request.write) {
      const write = HorizontalWriteSchema.parse(request.write);
      if (!binding || !current || write.chartDigest !== current.artifactDigest) fail('revision_conflict');
      const existing = repository.drawing(id, write.id);
      if (write.revision === 0 ? existing !== null : existing?.revision !== write.revision) fail('revision_conflict');
      if (existing && compatibility(existing) !== 'compatible') fail('identity_review_required');
      // A canonical daily anchor must exist, including when editing from week/month.
      if (!current.result.intervals.day.some(row => row.displayDate === write.time)) fail('invalid_input');
      const drawing: StoredDrawing = existing ? { ...existing, price: write.price, time: write.time, revision: write.revision + 1 }
        : { id: write.id, instrumentId: id, kind: 'horizontal', price: write.price, time: write.time, revision: 1,
          evidenceFrom: current.result.intervals.day[0]!.displayDate, evidenceThrough: current.result.intervals.day.at(-1)!.displayDate,
          basisObject: rowRef(objectRow(db, binding.artifact)) };
      // Edits preserve the original evidence window; accepting new basis is Step 4C.
      if (drawing.time < drawing.evidenceFrom || drawing.time > drawing.evidenceThrough) fail('invalid_input');
      if (compatibility(drawing) !== 'compatible') fail('identity_review_required');
      return { drawing, artifact: binding.artifact, receipt: binding.receipt };
    }
    const rows = repository.drawings(id, request.after ?? '', 101), pageRows = rows.slice(0, 100);
    const items: HorizontalView[] = pageRows.map(drawing => ({ id: drawing.id, instrumentId: id, kind: 'horizontal', family: 'swing',
        adjustmentMode: 'jquants_adjusted_ohlcv_not_total_return', revision: drawing.revision, price: drawing.price,
        time: drawing.time, evidenceFrom: drawing.evidenceFrom, evidenceThrough: drawing.evidenceThrough,
        basisDigest: drawing.basisObject.digest, state: compatibility(drawing) }));
    return { page: { schemaVersion: 'workspace_drawings_v1', instrumentId: id, chartDigest: current?.artifactDigest ?? null,
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
