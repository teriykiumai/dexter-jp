import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DashboardJobCoordinatorV1, DashboardJobLeaseV1, DashboardJobProjectionV1 } from '../dashboard-jobs/coordinator.js';
import { fetchTechnicalInputsV1, TECHNICAL_JOB_LIMITS_V1, type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { createTechnicalSourceRequestWindowV1 } from '../market-data/technical-source-gate.js';
import { WorkspaceRepository } from './repository.js';
import { FrozenIdentitySchema, Id, json, parse, fail, objectKey, scopeKey, type FrozenIdentity, type ObjectRef, WorkspaceError } from './contracts.js';
import { objectRow, rowRef, resolveReference, referencePath } from './references.js';
import { readBytes } from './files.js';
import { ReceiptObjectSchema, workspaceDataCodecs, retainValidatedWorkspaceBytes } from './data-objects.js';
import { collectWorkspaceCatalog, activateWorkspaceCatalog } from './data-source.js';
import { runEodWorker, type EodWorkerResult } from './eod-worker-client.js';

type State = 'queued' | 'running' | 'publishing' | 'published' | 'failed' | 'interrupted' | 'identity_review_required';
export type WorkspaceDataJob = { job_id: string; kind: 'catalog' | 'technical'; accepted_at: string; state: State;
  identity: string | null; master_object: string | null; input_object: string | null; result_object: string | null;
  generation: number | null; error: string | null };
const terminal = (state: State) => ['published', 'failed', 'interrupted', 'identity_review_required'].includes(state);
const JobSchema = z.object({ job_id: Id, kind: z.enum(['catalog', 'technical']), accepted_at: z.iso.datetime(),
  state: z.enum(['queued', 'running', 'publishing', 'published', 'failed', 'interrupted', 'identity_review_required']),
  identity: z.string().nullable(), master_object: z.string().nullable(), input_object: z.string().nullable(), result_object: z.string().nullable(),
  generation: z.number().int().positive().nullable(), error: z.string().max(80).nullable() }).strict();
const projection = (job: WorkspaceDataJob): DashboardJobProjectionV1 => ({ domain: 'workspace',
  kind: job.kind === 'catalog' ? 'workspace_catalog' : 'workspace_technical', jobId: job.job_id, terminal: terminal(job.state) });

/** Server library only; Step 3 supplies guarded HTTP/Browser entry points. */
export class WorkspaceDataJobs {
  readonly repository: WorkspaceRepository;
  private pending = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  constructor(readonly coordinator: DashboardJobCoordinatorV1, repository: WorkspaceRepository,
    readonly artifactRoot: string, readonly checkpoint?: (phase: 'before_publish' | 'after_publish' | 'before_binding', job: WorkspaceDataJob) => Promise<void>) {
    this.repository = repository;
    coordinator.register({ domain: 'workspace', inventory: async () => this.inventory().map(projection),
      isAbsent: async id => !this.repository.db.sqlite.query('SELECT job_id FROM workspace_data_jobs WHERE job_id=?').get(id),
      cleanup: async () => {}, reconcile: async job => { await this.recover(job.jobId); } });
  }
  inventory(): WorkspaceDataJob[] {
    this.repository.db.assertAvailable();
    return this.repository.db.sqlite.query<WorkspaceDataJob, []>('SELECT * FROM workspace_data_jobs ORDER BY accepted_at,job_id').all().map(job => parse(JobSchema, job));
  }
  get(id: string): WorkspaceDataJob {
    parse(Id, id); this.repository.db.assertAvailable();
    return parse(JobSchema, this.repository.db.sqlite.query<WorkspaceDataJob, [string]>('SELECT * FROM workspace_data_jobs WHERE job_id=?').get(id) ?? fail('not_found'));
  }
  async start(kind: 'catalog' | 'technical', instrumentId?: string): Promise<string> {
    if (!['catalog', 'technical'].includes(kind) || kind === 'technical' && !instrumentId) fail('invalid_input');
    const id = randomUUID();
    await this.coordinator.admit({ kind: kind === 'catalog' ? 'workspace_catalog' : 'workspace_technical', jobId: id,
      revalidate: () => { if (!this.coordinator.environment.apiKey()) fail('invalid_input'); if (instrumentId) this.repository.freezeIdentity(instrumentId); },
      create: async lease => {
        this.repository.db.transaction(() => {
          const identity = kind === 'technical' ? this.repository.freezeIdentity(instrumentId!) : null;
          const master = identity ? this.repository.db.sqlite.query<{ evidence: string }, [number, string]>(
            'SELECT evidence FROM catalog_rows WHERE generation=? AND instrument_id=?').get(identity.catalogGeneration, identity.instrumentId)!.evidence : null;
          const accepted = new Date(lease.acceptedAtMs).toISOString();
          const generation = kind === 'catalog' ? this.repository.requestCatalog(createTechnicalSourceRequestWindowV1(accepted).calculationDate) : null;
          this.repository.db.sqlite.run('INSERT INTO workspace_data_jobs VALUES (?,?,?,\'queued\',?,?,NULL,NULL,?,NULL)',
            [id, kind, accepted, identity ? json(identity) : null, master, generation]);
        });
        return { state: 'published', record: projection(this.get(id)) };
      },
      adopt: lease => { const work = Promise.resolve().then(() => this.run(lease)); this.pending.set(id, work); },
    });
    return id;
  }
  async wait(id: string): Promise<WorkspaceDataJob> { await this.pending.get(id); return this.get(id); }
  cancel(id: string): void {
    const job = this.get(id);
    if (terminal(job.state)) return;
    if (job.state === 'publishing') fail('revision_conflict');
    this.controllers.get(id)?.abort();
  }
  private set(id: string, state: State, error: string | null = null) {
    this.repository.db.sqlite.run('UPDATE workspace_data_jobs SET state=?,error=? WHERE job_id=?', [state, error, id]);
  }
  private context(lease: DashboardJobLeaseV1, controller: AbortController): TechnicalCollectionContextV1 {
    const limits = TECHNICAL_JOB_LIMITS_V1, env = this.coordinator.environment;
    let attempts = 0, pages = 0, rows = 0, bytes = 0;
    const signal = AbortSignal.any([lease.signal, controller.signal]);
    const check = (wait = 0) => {
      if (signal.aborted || env.monotonicNowMs() - lease.monotonicOriginMs + wait >= limits.executionBudgetMs) fail('invalid_input');
    };
    return { jobId: lease.jobId, acceptedAt: new Date(lease.acceptedAtMs).toISOString(), signal,
      shareSource: async (_key, load) => load(),
      waitBeforeRetry: async delay => { check(delay); await env.sleep(delay, signal); },
      recordProgress: p => { pages += p.pages; rows += p.acceptedRows; bytes += p.responseBytes;
        if (pages > limits.maximumPages || rows > limits.maximumRows || bytes > limits.maximumResponseBytes) fail('invalid_input'); },
      dispatch: async start => this.coordinator.dispatch(lease, check, async () => {
        check(); if (++attempts > limits.maximumAttempts) fail('invalid_input');
        const deadline = AbortSignal.timeout(30_000); return start(AbortSignal.any([signal, deadline]));
      }, signal),
    };
  }
  private async run(lease: DashboardJobLeaseV1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TECHNICAL_JOB_LIMITS_V1.executionBudgetMs);
    this.controllers.set(lease.jobId, controller);
    try {
      this.repository.db.transaction(() => this.set(lease.jobId, 'running'));
      const job = this.get(lease.jobId), context = this.context(lease, controller);
      if (job.kind === 'catalog') {
        const catalog = await collectWorkspaceCatalog(context, this.coordinator.environment);
        if (context.signal.aborted) fail('invalid_input');
        const ref = await activateWorkspaceCatalog(this.repository, job.generation!, catalog);
        this.repository.db.transaction(() => {
          this.repository.db.sqlite.run('UPDATE workspace_data_jobs SET result_object=? WHERE job_id=?', [objectKey(ref), job.job_id]); this.set(job.job_id, 'published');
        });
      } else {
        const identity = parse(FrozenIdentitySchema, JSON.parse(job.identity!));
        const fetched = await fetchTechnicalInputsV1(identity.code.slice(0, 4), context, this.coordinator.environment);
        const prepared = await runEodWorker({ operation: 'prepare', root: this.repository.db.root, artifactRoot: this.artifactRoot, identity,
          master: rowRef(objectRow(this.repository.db, job.master_object!)), fetched }, context.signal) ?? fail('reference_missing');
        const input = retainValidatedWorkspaceBytes(this.repository.db, 'workspace_technical_v2', prepared.artifactBytes,
          { scope: { kind: 'instrument-owned', instrumentId: identity.instrumentId }, effectiveDate: prepared.dataDate,
            dependencies: [rowRef(objectRow(this.repository.db, job.master_object!))], sourceDefinition: 'workspace_jquants_eod_v1', calculationVersion: 'technical_chart_calculation_v2' });
        this.repository.db.transaction(() => { this.repository.db.sqlite.run('UPDATE workspace_data_jobs SET input_object=? WHERE job_id=?', [objectKey(input), job.job_id]); });
        await this.checkpoint?.('before_publish', this.get(job.job_id));
        if (context.signal.aborted) fail('invalid_input');
        if (!this.matches(job, identity)) fail('identity_review_required');
        this.coordinator.assertOwner(lease);
        this.repository.db.transaction(() => this.set(job.job_id, 'publishing'));
        const candidateBytes = new TextDecoder().decode(readBytes(referencePath(this.repository.db.root, input)));
        const published = await runEodWorker({ operation: 'publish', root: this.repository.db.root, artifactRoot: this.artifactRoot, identity,
          preparedBytes: candidateBytes, jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt: new Date(this.coordinator.environment.wallNowMs()).toISOString() }, context.signal);
        await this.checkpoint?.('after_publish', this.get(job.job_id));
        await this.finalize(job.job_id, published ?? undefined);
      }
      await this.coordinator.exclusive(async () => this.coordinator.afterReplace(lease, { state: 'published', record: projection(this.get(lease.jobId)) }));
    } catch (error) {
      // Publishing may have committed a receipt. Leave its durable state for exact recovery.
      try {
        const current = this.get(lease.jobId);
        if (current.state === 'publishing' || terminal(current.state)) { this.coordinator.latchRecovery(); return; }
        this.repository.db.transaction(() => {
          const job = this.get(lease.jobId); if (job.generation) this.repository.failCatalog(job.generation);
          this.set(lease.jobId, error instanceof WorkspaceError && error.code === 'identity_review_required' ? 'identity_review_required' : 'failed',
            error instanceof WorkspaceError ? error.code : 'source_failed');
        });
        await this.coordinator.exclusive(async () => this.coordinator.afterReplace(lease, { state: 'published', record: projection(this.get(lease.jobId)) }));
      } catch { this.coordinator.latchRecovery(); }
    } finally { clearTimeout(timer); this.pending.delete(lease.jobId); this.controllers.delete(lease.jobId); }
  }
  private async finalize(id: string, published?: EodWorkerResult) {
    const job = this.get(id), identity = parse(FrozenIdentitySchema, JSON.parse(job.identity!));
    if (!job.input_object) fail('reference_missing');
    const preparedRef = rowRef(objectRow(this.repository.db, job.input_object));
    const preparedBytes = new TextDecoder().decode(readBytes(referencePath(this.repository.db.root, preparedRef)));
    const receipt = published ?? await runEodWorker({ operation: 'recover', root: this.repository.db.root, artifactRoot: this.artifactRoot, identity,
      preparedBytes, jobId: id, acceptedAt: job.accepted_at,
      checkedAt: new Date(this.coordinator.environment.wallNowMs()).toISOString() });
    if (!receipt) { this.repository.db.transaction(() => this.set(id, 'interrupted')); return; }
    const artifactRef = retainValidatedWorkspaceBytes(this.repository.db, 'workspace_technical_v2', receipt.artifactBytes,
      { scope: { kind: 'instrument-owned', instrumentId: identity.instrumentId }, effectiveDate: receipt.dataDate,
        dependencies: [rowRef(objectRow(this.repository.db, job.master_object!))], sourceDefinition: 'workspace_jquants_eod_v1', calculationVersion: 'technical_chart_calculation_v2' });
    const receiptRef = retainValidatedWorkspaceBytes(this.repository.db, 'workspace_receipt_v1', json({ version: 'workspace_receipt_v1', identity, artifact: artifactRef, receipt: receipt.receipt }),
      { scope: { kind: 'instrument-owned', instrumentId: identity.instrumentId }, effectiveDate: receipt.dataDate,
        dependencies: [artifactRef], sourceDefinition: 'workspace_jquants_eod_v1', calculationVersion: 'technical_chart_calculation_v2' });
    const observed = parse(ReceiptObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(this.repository.db, receiptRef, workspaceDataCodecs).bytes)));
    if (json(observed.identity) !== json(identity) || observed.receipt.jobId !== id || observed.receipt.acceptedAt !== job.accepted_at) fail('reference_conflict');
    const artifact = observed.artifact;
    await this.checkpoint?.('before_binding', job);
    this.repository.db.transaction(() => {
      try {
        if (!this.matches(job, identity)) fail('identity_review_required');
        const scope = scopeKey({ kind: 'instrument-owned', instrumentId: identity.instrumentId });
        const old = this.repository.db.sqlite.query<{ binding_id: string; receipt: string }, [string]>(
          "SELECT b.binding_id,b.receipt FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset='technical'").get(scope);
        let keepOld = false;
        if (old) {
          const previous = parse(ReceiptObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(this.repository.db,
            rowRef(objectRow(this.repository.db, old.receipt)), workspaceDataCodecs).bytes))).receipt;
          if (previous.acceptedAt === observed.receipt.acceptedAt && previous.artifactIdentity.artifactDigest !== observed.receipt.artifactIdentity.artifactDigest) fail('reference_conflict');
          keepOld = previous.acceptedAt > observed.receipt.acceptedAt || previous.acceptedAt === observed.receipt.acceptedAt && previous.jobId < observed.receipt.jobId;
        }
        this.repository.bind(identity, artifactRef, receiptRef, 'technical');
        if (keepOld) this.repository.db.sqlite.run("UPDATE data_sync_state SET binding_id=? WHERE scope=? AND dataset='technical'", [old!.binding_id, scope]);
        this.repository.db.sqlite.run('UPDATE workspace_data_jobs SET result_object=? WHERE job_id=?', [objectKey(receiptRef), id]); this.set(id, 'published');
      } catch (error) {
        if (!(error instanceof WorkspaceError) || error.code !== 'identity_review_required') throw error;
        this.repository.db.sqlite.run('UPDATE workspace_data_jobs SET result_object=? WHERE job_id=?', [objectKey(receiptRef), id]);
        this.set(id, 'identity_review_required', error.code);
      }
    });
  }
  private matches(job: WorkspaceDataJob, identity: FrozenIdentity): boolean {
    return this.repository.identityMatches(identity) && this.repository.db.sqlite.query<{ evidence: string }, [number, string]>(
      'SELECT evidence FROM catalog_rows WHERE generation=? AND instrument_id=?').get(identity.catalogGeneration, identity.instrumentId)?.evidence === job.master_object;
  }
  async recover(id: string) {
    const job = this.get(id); if (terminal(job.state)) return;
    if (job.kind === 'technical' && job.state === 'publishing') await this.finalize(id);
    else this.repository.db.transaction(() => {
      if (job.generation) this.repository.failCatalog(job.generation); this.set(id, 'interrupted');
    });
  }
}
