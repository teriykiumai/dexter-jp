import { z } from 'zod';
import { Id, DrawingSchema, WorkspaceError, fail, parse, scopeKey, objectKey, json, digest, type StoredDrawing } from '../analysis/workspace/contracts.js';
import { objectRow, rowRef, referencePath } from '../analysis/workspace/references.js';
import { readBytes } from '../analysis/workspace/files.js';
import type { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { DashboardSessionV1, requireDashboardJsonMediaType, readDashboardBody } from './session.js';
import { parseStrictJsonBytesV1 } from '../analysis/strategy-validation/strict-json.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, HorizontalWriteSchema, type HorizontalWrite } from './drawing-contracts.js';
import type { DrawingWork, DrawingResult, DrawingProof } from './drawing-worker.js';

export class DrawingApi {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private proof: DrawingProof | null = null;
  constructor(readonly repository: WorkspaceRepository, readonly session: DashboardSessionV1) {}
  private prepared(instrumentId: string, write: HorizontalWrite): Extract<DrawingResult, { drawing: StoredDrawing }> | null {
    const proof = this.proof, db = this.repository.db;
    if (!proof || proof.instrumentId !== instrumentId || proof.chartDigest !== write.chartDigest) return null;
    const existing = this.repository.drawing(instrumentId, write.id);
    if (existing && (!proof.compatible.includes(existing.id) || !proof.originals.some(item => json(item) === json(existing)))) return null;
    if (write.revision === 0 ? existing !== null : existing?.revision !== write.revision) fail('revision_conflict');
    // Reuse calculations only after re-reading EVERY exact dependency through the
    // guarded file reader and authenticating its bytes and registered metadata.
    // No mtime/latest cache, and no persisted proof survives a server restart.
    for (const object of proof.objects) {
      const row = objectRow(db, objectKey(object.ref));
      if (json(rowRef(row)) !== json(object.ref) || row.metadata !== object.metadata
        || digest(readBytes(referencePath(db.root, object.ref))) !== object.ref.digest) fail('reference_conflict');
    }
    if (!proof.dates.includes(write.time)) fail('invalid_input');
    const drawing: StoredDrawing = existing ? { ...existing, time: write.time, price: write.price, revision: write.revision + 1 }
      : { id: write.id, instrumentId, kind: 'horizontal', time: write.time, price: write.price, revision: 1,
        basisObject: proof.basisObject, evidenceFrom: proof.dates[0]!, evidenceThrough: proof.dates.at(-1)! };
    return { drawing: parse(DrawingSchema, drawing), artifact: proof.artifact, receipt: proof.receipt };
  }
  private async work(request: DrawingWork): Promise<DrawingResult> {
    if (this.pending >= 8) fail('database_busy');
    this.pending++;
    const task = this.queue.then(() => new Promise<DrawingResult>((resolve, reject) => {
      const worker = new Worker(new URL('./drawing-worker.ts', import.meta.url).href);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      const timer = setTimeout(() => { finish(); reject(new WorkspaceError('reference_conflict')); }, 60_000);
      worker.onerror = () => { finish(); reject(new WorkspaceError('reference_conflict')); };
      worker.onmessage = (event: MessageEvent<{ ok: boolean; result: DrawingResult; code: WorkspaceError['code'] }>) => {
        finish(); if (event.data.ok) resolve(event.data.result); else reject(new WorkspaceError(event.data.code));
      };
      worker.postMessage(request);
    }));
    this.queue = task.catch(() => undefined);
    try { return await task; } finally { this.pending--; }
  }
  async handle(request: Request, url: URL, segments: readonly string[]): Promise<Response> {
    const item = segments.length === 6;
    const allowed = item ? 'PUT, DELETE' : 'GET, POST';
    const send = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
    if (!allowed.split(', ').includes(request.method)) return send({ schemaVersion: 'workspace_error_v1', error: { code: 'method_not_allowed' } }, 405, { Allow: allowed });
    const instrumentId = parse(Id, segments[3]), id = item ? parse(Id, segments[5]) : undefined;
    const db = this.repository.db; db.assertAvailable();
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].some(key => key !== 'after') || url.searchParams.getAll('after').length > 1) fail('invalid_input');
      const after = url.searchParams.has('after') ? parse(Id, url.searchParams.get('after')) : undefined;
      const result = await this.work({ root: db.root, instrumentId, after });
      if (!('page' in result)) fail('reference_conflict');
      this.proof = result.proof;
      return send(DrawingPageSchema.parse(result.page));
    }
    this.session.requireMutation(request, url);
    if ([...url.searchParams].length) fail('invalid_input');
    requireDashboardJsonMediaType(request);
    const raw = parseStrictJsonBytesV1(await readDashboardBody(request, 4096), 4096);
    if (request.method === 'DELETE') {
      const body = parse(z.object({ revision: z.number().int().positive() }).strict(), raw);
      this.repository.deleteDrawing(instrumentId, id!, body.revision);
      return send(DrawingDeletedSchema.parse({ schemaVersion: 'workspace_drawing_deleted_v1', instrumentId, id }));
    }
    const write = parse(HorizontalWriteSchema, raw);
    if (item ? id !== write.id || write.revision === 0 : write.revision !== 0) fail('invalid_input');
    const result = this.prepared(instrumentId, write) ?? await this.work({ root: db.root, instrumentId, write });
    if (!('drawing' in result)) fail('reference_conflict');
    const drawing = parse(DrawingSchema, result.drawing);
    db.transaction(() => {
      const current = db.sqlite.query<{ artifact: string; receipt: string }, [string]>(`SELECT b.artifact,b.receipt
        FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset='technical'`)
        .get(scopeKey({ kind: 'instrument-owned', instrumentId }));
      // Worker validation precedes the transaction. A concurrent refresh must not
      // commit a Drawing against a different chart, even with identical prices.
      if (!current || current.artifact !== result.artifact || current.receipt !== result.receipt) fail('revision_conflict');
      // A read-only deep link may not have registered a Workspace yet. The
      // explicit save creates it atomically; failed writes leave no new record.
      if (!db.sqlite.query('SELECT instrument_id FROM workspaces WHERE instrument_id=?').get(instrumentId)) this.repository.openWorkspace(instrumentId);
      this.repository.saveDrawing(drawing, write.revision);
    });
    return send(DrawingSavedSchema.parse({ schemaVersion: 'workspace_drawing_saved_v1', instrumentId, id: drawing.id, revision: drawing.revision }));
  }
}
