import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { WorkspaceRepository } from './repository.js';
import { parse, fail, json, digest, objectKey, ObjectRefSchema, Id, type ObjectRef } from './contracts.js';
import { objectRow, rowRef, resolveReference, retainVerifiedObject, referencePath } from './references.js';
import { workspaceDataCodecs, retainValidatedWorkspaceBytes } from './data-objects.js';
import { writeExclusive, readBytes } from './files.js';
import { AiInputSchema, AiJobViewSchema, AiHistorySchema, AiDetailSchema, AiStateSchema, AiErrorSchema, AiProfileSchema,
  type AiProfile, type AiInput, type AiJobView, type AiState, type AiHistory, type AiDetail, type AnalysisRunArtifactV1 } from './ai-contracts.js';
import { aiCodecs, aiAsOf, validateAiResult, validateInterpretation } from './ai-objects.js';
import { selectAiInputs, aiHasInputs } from './ai-input.js';
import { createWorkspaceAiModel, AI_TIMEOUT_MS, type AiModel } from './ai-model.js';
import { runAiRead } from './ai-worker.js';

const JobSchema = z.object({ job_id: Id, instrument_id: Id, profile: AiProfileSchema, input_object: z.string(), result_object: z.string().nullable(),
  state: AiStateSchema, accepted_at: z.iso.datetime().nullable(), publication: z.string().nullable(), error: AiErrorSchema.nullable() }).strict();
export type AiJob = z.infer<typeof JobSchema>;
type Phase = 'before_admission' | 'before_invoke' | 'after_invoke' | 'before_result_write' | 'after_result_write' | 'after_result_register';

/** AI admission is separate from the J-Quants rate lease: one bounded, tool-free
 * model call per process. Durable SQLite admission also rejects competing callers. */
export class WorkspaceAiJobs {
  private admitting = false;
  private recovering: Promise<void> | null = null;
  private initialized = false;
  private blocked = false;
  private pending = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private reads = 0;
  constructor(readonly repository: WorkspaceRepository, readonly model: AiModel = createWorkspaceAiModel(),
    readonly checkpoint?: (phase: Phase, jobId: string) => Promise<void>) {}
  private row(id: string): AiJob {
    parse(Id, id); this.repository.db.assertAvailable();
    return parse(JobSchema, this.repository.db.sqlite.query<AiJob, [string]>('SELECT * FROM analysis_jobs WHERE job_id=?').get(id) ?? fail('not_found'));
  }
  get(instrumentId: string, id: string): AiJobView {
    const row = this.row(id); if (row.instrument_id !== instrumentId || row.accepted_at === null) fail('not_found');
    return this.view(row);
  }
  private view(row: AiJob): AiJobView {
    const db = this.repository.db;
    return parse(AiJobViewSchema, { schemaVersion: 'workspace_ai_job_v1', id: row.job_id, instrumentId: row.instrument_id, profile: row.profile,
      createdAt: row.accepted_at, state: row.state, error: row.error, input: rowRef(objectRow(db, row.input_object)),
      result: row.result_object ? rowRef(objectRow(db, row.result_object)) : null });
  }
  private active(): AiJob | null {
    return this.repository.db.sqlite.query<AiJob, []>(`SELECT * FROM analysis_jobs WHERE accepted_at IS NOT NULL AND state IN ('prepared','running','publishing') LIMIT 1`).get();
  }
  async initialize(): Promise<void> {
    this.repository.db.assertAvailable();
    if (this.initialized) return;
    if (this.recovering) return this.recovering;
    this.recovering = (async () => {
      try {
        const active = this.active();
        if (active?.state === 'publishing') await this.finalize(active);
        else if (active) this.set(active.job_id, 'interrupted', 'interrupted');
        this.initialized = true;
      } catch { this.blocked = true; this.initialized = true; }
    })();
    await this.recovering;
  }
  async start(instrumentId: string, profile: AiProfile): Promise<AiJobView> {
    parse(Id, instrumentId); parse(AiProfileSchema, profile); await this.initialize();
    if (this.blocked || this.admitting || this.pending.size || this.active()) fail('database_busy');
    if (!this.model.configured() || !this.model.runtime) throw new Error('model_unavailable');
    this.admitting = true;
    const id = randomUUID(), createdAt = new Date().toISOString(), db = this.repository.db;
    try {
      const selection = db.transaction(() => selectAiInputs(this.repository, instrumentId, profile));
      const input = parse(AiInputSchema, await runAiRead({ operation: 'build', root: db.root, selection, profile, runId: id, createdAt, runtime: this.model.runtime }));
      const ref = retainValidatedWorkspaceBytes(db, input.version, json(input), aiCodecs.get(input.version)!(input));
      await this.checkpoint?.('before_admission', id);
      db.transaction(() => {
        if (this.active() || json(selection) !== json(selectAiInputs(this.repository, instrumentId, profile))) fail('revision_conflict');
        const enough = aiHasInputs(input);
        db.sqlite.run('INSERT INTO analysis_jobs VALUES (?,?,?,?,NULL,?,?,NULL,?)',
          [id, instrumentId, profile, objectKey(ref), enough ? 'prepared' : 'insufficient_inputs', createdAt, enough ? null : 'insufficient_inputs']);
      });
      if (aiHasInputs(input)) {
        const pending = Promise.resolve().then(() => this.run(id)); this.pending.set(id, pending);
        void pending.finally(() => this.pending.delete(id));
      }
      return this.get(instrumentId, id);
    } finally { this.admitting = false; }
  }
  private set(id: string, state: AiState, error: AiJob['error'] = null): void {
    this.repository.db.transaction(() => this.repository.db.sqlite.run('UPDATE analysis_jobs SET state=?,error=? WHERE job_id=?', [state, error, id]));
  }
  private async run(id: string): Promise<void> {
    const controller = new AbortController(), db = this.repository.db;
    this.controllers.set(id, controller);
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let failure: 'model_failed' | 'invalid_result' = 'invalid_result';
    try {
      const row = this.row(id), ref = rowRef(objectRow(db, row.input_object));
      if (row.state !== 'prepared') return;
      const input = parse(AiInputSchema, await runAiRead({ operation: 'verify', root: db.root, input: ref }, controller.signal));
      await this.checkpoint?.('before_invoke', id);
      if (this.row(id).state !== 'prepared') return;
      if (controller.signal.aborted) { this.set(id, 'interrupted', 'interrupted'); return; }
      this.set(id, 'running'); failure = 'model_failed';
      const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      const output = await Promise.race([this.model.invoke(structuredClone(input), controller.signal), abort]);
      failure = 'invalid_result';
      await this.checkpoint?.('after_invoke', id);
      if (this.row(id).state !== 'running') return;
      if (controller.signal.aborted) { this.set(id, 'interrupted', 'interrupted'); return; }
      const result: AnalysisRunArtifactV1 = { version: 'analysis_run_artifact_v1', runId: id, instrumentId: row.instrument_id,
        profile: input.profile, profileVersion: input.profileVersion, input: ref, runtime: input.runtime, createdAt: input.createdAt,
        completedAt: new Date().toISOString(), asOf: aiAsOf(input), interpretation: validateInterpretation(input, output) };
      validateAiResult(input, ref, result);
      const bytes = json(result), candidate: ObjectRef = { path: `${id}.json`, codec: result.version, digest: digest(bytes) };
      db.transaction(() => db.sqlite.run("UPDATE analysis_jobs SET state='publishing',publication=? WHERE job_id=? AND state='running'", [json(candidate), id]));
      await this.checkpoint?.('before_result_write', id);
      db.assertAvailable();
      writeExclusive(resolve(db.root, 'ai-publications', candidate.path), bytes);
      await this.checkpoint?.('after_result_write', id);
      await this.finalize(this.row(id));
    } catch {
      try {
        const state = this.row(id).state;
        if (state === 'publishing') { this.blocked = true; this.set(id, 'publishing', 'publication_unresolved'); }
        else if (state !== 'published' && state !== 'cancelled') this.set(id, controller.signal.aborted ? 'interrupted' : 'failed',
          controller.signal.aborted ? 'interrupted' : failure);
      } catch { this.blocked = true; }
    } finally { clearTimeout(timer); this.controllers.delete(id); }
  }
  private async finalize(row: AiJob): Promise<void> {
    const db = this.repository.db, inputRef = rowRef(objectRow(db, row.input_object));
    const candidate = parse(ObjectRefSchema, row.publication ? JSON.parse(row.publication) : null);
    if (candidate.codec !== 'analysis_run_artifact_v1' || candidate.path !== `${row.job_id}.json`) fail('reference_conflict');
    const registered = db.sqlite.query('SELECT object_key FROM immutable_objects WHERE object_key=?').get(objectKey(candidate));
    const path = registered ? referencePath(db.root, candidate) : resolve(db.root, 'ai-publications', candidate.path);
    if (!existsSync(path) && !registered) { this.set(row.job_id, 'interrupted', 'interrupted'); return; }
    const bytes = readBytes(path, 32 * 1024); if (digest(bytes) !== candidate.digest) fail('reference_conflict');
    const input = parse(AiInputSchema, await runAiRead({ operation: 'verify', root: db.root, input: inputRef }));
    const result = validateAiResult(input, inputRef, JSON.parse(new TextDecoder().decode(bytes)));
    if (input.runId !== row.job_id || input.profile !== row.profile || input.selection.identity.instrumentId !== row.instrument_id) fail('reference_conflict');
    retainVerifiedObject(db, { ref: candidate, bytes, metadata: aiCodecs.get(candidate.codec)!(result) });
    await this.checkpoint?.('after_result_register', row.job_id);
    db.transaction(() => {
      const current = this.row(row.job_id);
      if (current.state !== 'publishing' || current.input_object !== row.input_object || current.publication !== row.publication) fail('reference_conflict');
      db.sqlite.run("UPDATE analysis_jobs SET state='published',result_object=?,error=NULL WHERE job_id=?", [objectKey(candidate), row.job_id]);
    });
  }
  cancel(instrumentId: string, id: string): AiJobView {
    const job = this.get(instrumentId, id);
    if (!['prepared', 'running'].includes(job.state)) fail('revision_conflict');
    this.set(id, 'cancelled', 'cancelled'); this.controllers.get(id)?.abort(); return this.get(instrumentId, id);
  }
  async wait(id: string): Promise<void> { await this.pending.get(id); }
  async history(instrumentId: string, before: string | null = null): Promise<AiHistory> {
    parse(Id, instrumentId); await this.initialize();
    const db = this.repository.db;
    if (!db.sqlite.query('SELECT instrument_id FROM workspaces WHERE instrument_id=?').get(instrumentId)) fail('not_found');
    const cursor = before ? this.get(instrumentId, parse(Id, before)) : null;
    const rows = db.sqlite.query<AiJob, [string, string, string, string]>(`SELECT * FROM analysis_jobs WHERE instrument_id=? AND accepted_at IS NOT NULL
      AND (accepted_at < ? OR (accepted_at=? AND job_id < ?)) ORDER BY accepted_at DESC,job_id DESC LIMIT 21`)
      .all(instrumentId, cursor?.createdAt ?? '9999', cursor?.createdAt ?? '9999', cursor?.id ?? '');
    const active = this.active();
    return parse(AiHistorySchema, { schemaVersion: 'workspace_ai_history_v1', instrumentId, items: rows.slice(0, 20).map(row => this.view(row)),
      next: rows.length > 20 ? rows[19]!.job_id : null, active: active?.instrument_id === instrumentId ? this.view(active) : null,
      busy: this.blocked || this.admitting || active !== null || this.pending.size > 0, configured: this.model.configured(), runtime: this.model.runtime });
  }
  async detail(instrumentId: string, id: string): Promise<AiDetail> {
    if (this.reads >= 2) fail('database_busy');
    const job = this.get(instrumentId, id); this.reads++;
    try {
      const input = parse(AiInputSchema, await runAiRead({ operation: 'verify', root: this.repository.db.root, input: job.input }));
      const result = job.result ? validateAiResult(input, job.input, JSON.parse(new TextDecoder().decode(resolveReference(this.repository.db, job.result, workspaceDataCodecs).bytes))) : null;
      return parse(AiDetailSchema, { schemaVersion: 'workspace_ai_detail_v1', job, input, result });
    } finally { this.reads--; }
  }
}
