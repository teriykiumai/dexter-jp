import { randomUUID } from 'node:crypto';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import {
  DashboardJobCoordinatorErrorV1,
  type DashboardJobCoordinatorV1,
  type DashboardJobLeaseV1,
  type DashboardJobProjectionV1,
  type JobWriteOutcomeV1,
} from '../dashboard-jobs/coordinator.js';
import { JQUANTS_REQUEST_TIMEOUT_MS_V1, type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { StrategyValidationUuidV4Schema } from '../strategy-validation/artifacts.js';
import { MarketDataRepositoryErrorV1, MARKET_DATA_MODULE_IDS_V1,
  type MarketDataArtifactIdentityV1, type MarketDataModuleIdV1,
  type MarketDataObservationReceiptIdentityV1 } from './contracts.js';
import { MarketDataJobRepositoryErrorV1, MarketDataJobRepositoryV1 } from './job-repository.js';
import {
  MarketDataJobViewV1Schema,
  MarketDataSourceFailureV1,
  isMarketDataJobTerminalV1,
  marketDataJobFailureV1,
  marketDataWarningCodesV1,
  moduleOrderV1,
  type MarketDataJobFailureCodeV1,
  type MarketDataJobViewV1,
  type MarketDataModuleFailureCodeV1,
  type MarketDataModuleResultV1,
  type MarketDataWarningCodeV1,
} from './job-schema.js';
import {
  OverviewModuleRegistryV1,
  type MarketDataModuleViewV1,
  type MarketOverviewResponseV1,
  type OverviewModuleAdapterV1,
} from './overview-registry.js';
import type { LatestMarketDataV1 } from './repository.js';

export type MarketDataJobAcceptedV1 = Readonly<{
  schemaVersion: 'market_data_job_accepted_v1'; jobId: string;
  kind: 'overview_refresh'; acceptedAt: string; statusUrl: string;
}>;
export type MarketDataActiveJobV1 = Readonly<{
  schemaVersion: 'market_data_active_job_v1';
  marketJob: MarketDataJobViewV1 | null;
  blockingKind: 'strategy_validation' | null;
}>;
export type MarketDataCancellationResultV1 = Readonly<{ status: 200 | 202; job: MarketDataJobViewV1 }>;

export class MarketDataJobServiceErrorV1 extends Error {
  constructor(readonly code:
    | 'source_configuration_missing' | 'artifact_not_found' | 'job_not_found'
    | 'invalid_job_state' | 'artifact_corrupt' | 'artifact_recovery_bound_exceeded'
    | 'latest_resolution_failed' | 'repository_failure' | 'invariant_failure') { super(code); }
}

export type MarketDataJobLimitsV1 = Readonly<{
  estimatedMinimumAttempts: number;
  maximumAttempts: number;
  maximumPages: number;
  maximumRows: number;
  maximumResponseBytes: number;
  executionBudgetMs: number;
}>;

export interface TechnicalObservationPortV1 {
  loadObservation(identity: MarketDataObservationReceiptIdentityV1): Promise<{
    artifactIdentity: MarketDataArtifactIdentityV1;
    observationReceiptIdentity: MarketDataObservationReceiptIdentityV1;
    checkedAt: string;
  }>;
}

export interface MarketDataJobServiceOptionsV1 {
  coordinator: DashboardJobCoordinatorV1;
  jobRepository?: MarketDataJobRepositoryV1;
  overviewRegistry?: OverviewModuleRegistryV1;
  technicalObservation?: TechnicalObservationPortV1;
  limits?: MarketDataJobLimitsV1;
  enqueue?: (work: () => void) => void;
}

type Attempt =
  | { state: 'prepared'; module: OverviewModuleAdapterV1; artifact: ReturnType<OverviewModuleAdapterV1['validate']> }
  | { state: 'failed'; module: OverviewModuleAdapterV1; code: MarketDataModuleFailureCodeV1 };
class MarketDataJobStopV1 extends Error {
  constructor(readonly code: 'source_timeout' | 'source_response_too_large') { super(code); }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJsonV1(left as CanonicalJsonValue) === canonicalJsonV1(right as CanonicalJsonValue);
}
function projection(job: MarketDataJobViewV1): DashboardJobProjectionV1 {
  return { domain: 'market_data', kind: job.kind, jobId: job.jobId,
    terminal: isMarketDataJobTerminalV1(job.status) };
}
function projected(outcome: JobWriteOutcomeV1<MarketDataJobViewV1>): JobWriteOutcomeV1<DashboardJobProjectionV1> {
  return outcome.state === 'published' ? { state: 'published', record: projection(outcome.record) } : outcome;
}
function safeInstant(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new MarketDataJobServiceErrorV1('invariant_failure');
  return new Date(milliseconds).toISOString();
}
function mapRepository(error: unknown): MarketDataJobServiceErrorV1 {
  if (error instanceof MarketDataRepositoryErrorV1) {
    if (error.code === 'artifact_not_found') return new MarketDataJobServiceErrorV1('artifact_not_found');
    if (error.code === 'artifact_corrupt' || error.code === 'invalid_artifact') return new MarketDataJobServiceErrorV1('artifact_corrupt');
    if (error.code === 'artifact_recovery_bound_exceeded') return new MarketDataJobServiceErrorV1(error.code);
    if (error.code === 'latest_resolution_failed') return new MarketDataJobServiceErrorV1(error.code);
    if (error.code === 'repository_unavailable' || error.code === 'repository_unsafe') {
      return new MarketDataJobServiceErrorV1('repository_failure');
    }
  }
  return new MarketDataJobServiceErrorV1('invariant_failure');
}

function validateLimits(limits: MarketDataJobLimitsV1 | undefined, rate: number): Readonly<{
  limits: MarketDataJobLimitsV1 | null;
  scheduleInfeasible: boolean;
}> {
  if (!limits) return { limits: null, scheduleInfeasible: false };
  const values = Object.values(limits);
  if (values.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError('Invalid Market Data job limits.');
  }
  const minimumDuration = Math.floor((limits.estimatedMinimumAttempts - 1) / rate) * 60_000;
  return Object.freeze({ limits: Object.freeze({ ...limits }),
    scheduleInfeasible: limits.estimatedMinimumAttempts > limits.maximumAttempts
      || minimumDuration >= limits.executionBudgetMs });
}

/** Common durable owner for both Market Data job kinds. DR-O1 exposes only
 * Overview admission; DR-T2 later supplies the Technical source/route adapter.
 */
export class MarketDataJobServiceV1 {
  readonly coordinator: DashboardJobCoordinatorV1;
  readonly jobRepository: MarketDataJobRepositoryV1;
  readonly overviewRegistry: OverviewModuleRegistryV1;
  readonly #environment: JQuantsExecutionEnvironmentV1;
  readonly #limits: MarketDataJobLimitsV1 | null;
  readonly #scheduleInfeasible: boolean;
  readonly #technical?: TechnicalObservationPortV1;
  readonly #enqueue: (work: () => void) => void;
  readonly #leases = new Map<string, DashboardJobLeaseV1>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #memoryCompletions = new Map<string, MarketDataJobViewV1>();
  #recovering = false;

  constructor(options: MarketDataJobServiceOptionsV1) {
    this.coordinator = options.coordinator;
    this.jobRepository = options.jobRepository ?? new MarketDataJobRepositoryV1();
    this.overviewRegistry = options.overviewRegistry ?? new OverviewModuleRegistryV1();
    this.#technical = options.technicalObservation;
    this.#environment = options.coordinator.environment;
    const validatedLimits = validateLimits(options.limits, options.coordinator.requestsPerMinute);
    this.#limits = validatedLimits.limits;
    this.#scheduleInfeasible = validatedLimits.scheduleInfeasible;
    if (this.overviewRegistry.size && !this.#limits) {
      throw new TypeError('Registered Overview modules require fixed job limits.');
    }
    this.#enqueue = options.enqueue ?? queueMicrotask;
    this.coordinator.register({
      domain: 'market_data',
      inventory: async () => {
        const jobs = await this.jobRepository.list();
        for (const job of jobs) await this.#validateTerminalJob(job, false);
        return jobs.map(projection);
      },
      isAbsent: async jobId => {
        try { await this.jobRepository.load(jobId); return false; }
        catch (error) {
          if (error instanceof MarketDataJobRepositoryErrorV1 && error.code === 'missing_job') return true;
          throw error;
        }
      },
      cleanup: () => this.jobRepository.cleanup(),
      reconcile: async item => {
        this.#recovering = true;
        try {
          const job = await this.jobRepository.load(item.jobId);
          if (!isMarketDataJobTerminalV1(job.status)) await this.#interrupt(job);
          else await this.#validateTerminalJob(job, false);
        } finally { this.#recovering = false; }
      },
    });
  }

  async initialize(): Promise<void> {
    await this.coordinator.initialize();
    this.coordinator.assertHealthy();
  }

  async readOverview(): Promise<MarketOverviewResponseV1> {
    const implemented = this.overviewRegistry.implemented();
    if (!implemented.length) throw new MarketDataJobServiceErrorV1('artifact_not_found');
    const resolved: ({ module: OverviewModuleAdapterV1; latest: LatestMarketDataV1<ReturnType<OverviewModuleAdapterV1['validate']>> }
      | { module: OverviewModuleAdapterV1; error: MarketDataJobServiceErrorV1 })[] = await Promise.all(implemented.map(async module => {
      try { return { module, latest: await module.latest() } as const; }
      catch (error) { return { module, error: mapRepository(error) } as const; }
    }));
    const valid = resolved.filter((entry): entry is Extract<typeof entry, { latest: unknown }> => 'latest' in entry);
    const errors = resolved.filter((entry): entry is Extract<typeof entry, { error: unknown }> => 'error' in entry);
    const corrupt = errors.filter(entry => entry.error.code === 'artifact_corrupt');
    const missing = errors.filter(entry => entry.error.code === 'artifact_not_found');
    const fatal = errors.find(entry => entry.error.code !== 'artifact_corrupt' && entry.error.code !== 'artifact_not_found');
    if (fatal) throw fatal.error;
    if (!valid.length && corrupt.length) throw new MarketDataJobServiceErrorV1('artifact_corrupt');
    if (!valid.length && missing.length === implemented.length) throw new MarketDataJobServiceErrorV1('artifact_not_found');

    const byId = new Map<MarketDataModuleIdV1, MarketDataModuleViewV1>();
    for (const entry of resolved) {
      if ('latest' in entry) {
        const projected = entry.module.project(entry.latest.artifact);
        const base = { moduleId: entry.module.moduleId,
          artifactIdentity: entry.latest.artifactIdentity,
          observationReceiptIdentity: entry.latest.observationReceiptIdentity,
          checkedAt: entry.latest.checkedAt, payload: projected.payload,
          warnings: Object.freeze([...projected.warnings, ...entry.latest.warnings]) } as const;
        byId.set(entry.module.moduleId, entry.latest.state === 'fallback'
          ? Object.freeze({ ...base, state: 'fallback' })
          : projected.state === 'available'
            ? Object.freeze({ ...base, state: 'available' })
            : Object.freeze({ ...base, state: 'unavailable', reason: projected.reason }));
      } else if (entry.error.code === 'artifact_not_found') {
        byId.set(entry.module.moduleId, Object.freeze({ moduleId: entry.module.moduleId,
          state: 'unavailable', artifactIdentity: null, observationReceiptIdentity: null,
          checkedAt: null, payload: null, reason: 'not_collected', warnings: Object.freeze([]) }));
      } else {
        byId.set(entry.module.moduleId, Object.freeze({ moduleId: entry.module.moduleId,
          state: 'unavailable', artifactIdentity: null, observationReceiptIdentity: null,
          checkedAt: null, payload: null, reason: 'artifact_corrupt', warnings: Object.freeze([{
            code: 'artifact_corrupt_no_fallback' as const, message: '保存済みデータを検証できませんでした。',
            moduleId: entry.module.moduleId, artifactIdentity: null,
          }]) }));
      }
    }
    return Object.freeze({ schemaVersion: 'market_overview_response_v1',
      modules: Object.freeze(MARKET_DATA_MODULE_IDS_V1.map(moduleId => byId.get(moduleId)
        ?? Object.freeze({ moduleId, state: 'not_implemented' as const }))) });
  }

  async acceptOverview(): Promise<MarketDataJobAcceptedV1> {
    this.#requireRunnableConfiguration();
    await this.initialize();
    const jobId = randomUUID();
    let created!: MarketDataJobViewV1;
    const revalidate = () => this.#requireRunnableConfiguration();
    await this.coordinator.admit({ kind: 'overview_refresh', jobId, revalidate,
      create: async lease => {
        const acceptedAt = safeInstant(lease.acceptedAtMs);
        created = MarketDataJobViewV1Schema.parse({
          schemaVersion: 'market_data_job_view_v1', jobId, kind: 'overview_refresh',
          target: { kind: 'overview' }, status: 'accepted', acceptedAt,
          startedAt: null, completedAt: null,
          progress: { attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0,
            completedModules: 0, totalModules: this.overviewRegistry.size },
          failure: null, result: null,
        });
        return projected(await this.jobRepository.create(created));
      },
      adopt: lease => {
        this.#leases.set(jobId, lease);
        this.#controllers.set(jobId, new AbortController());
        this.#enqueue(() => { void this.#execute(created).catch(() => undefined); });
      },
    });
    return Object.freeze({ schemaVersion: 'market_data_job_accepted_v1', jobId,
      kind: 'overview_refresh', acceptedAt: created.acceptedAt,
      statusUrl: `/api/market-data/jobs/${jobId}` });
  }

  async activeJob(): Promise<MarketDataActiveJobV1> {
    await this.initialize();
    return this.coordinator.exclusive(async () => {
      const active = await this.coordinator.active();
      if (!active) return { schemaVersion: 'market_data_active_job_v1', marketJob: null, blockingKind: null };
      if (active.domain === 'strategy_validation') {
        return { schemaVersion: 'market_data_active_job_v1', marketJob: null, blockingKind: 'strategy_validation' };
      }
      try {
        const job = await this.jobRepository.load(active.jobId);
        if (isMarketDataJobTerminalV1(job.status) || job.kind !== active.kind) throw new Error('Active job changed.');
        return { schemaVersion: 'market_data_active_job_v1', marketJob: job, blockingKind: null };
      } catch {
        this.coordinator.latchRecovery();
        throw new DashboardJobCoordinatorErrorV1('recovery_required');
      }
    });
  }

  async getJob(jobId: string): Promise<MarketDataJobViewV1> {
    if (!StrategyValidationUuidV4Schema.safeParse(jobId).success) throw new MarketDataJobServiceErrorV1('job_not_found');
    void this.coordinator.initialize();
    return this.coordinator.exclusive(async () => {
      const memory = this.#memoryCompletions.get(jobId);
      if (memory) {
        try { await this.#validateTerminalJob(memory, true); return memory; }
        catch {
          this.coordinator.latchRecovery();
          throw new DashboardJobCoordinatorErrorV1('recovery_required');
        }
      }
      let job: MarketDataJobViewV1;
      try { job = await this.jobRepository.load(jobId); }
      catch (error) {
        if (error instanceof MarketDataJobRepositoryErrorV1 && error.code === 'missing_job') {
          for (const kind of ['technical_refresh', 'overview_refresh'] as const) {
            if (this.coordinator.reserves({ domain: 'market_data', kind, jobId, terminal: false })) {
              this.coordinator.latchRecovery();
              throw new DashboardJobCoordinatorErrorV1('recovery_required');
            }
          }
          throw new MarketDataJobServiceErrorV1('job_not_found');
        }
        this.coordinator.latchRecovery();
        throw new DashboardJobCoordinatorErrorV1('recovery_required');
      }
      if (isMarketDataJobTerminalV1(job.status)) {
        try { await this.#validateTerminalJob(job, false); return job; }
        catch {
          this.coordinator.latchRecovery();
          throw new DashboardJobCoordinatorErrorV1('recovery_required');
        }
      }
      if (!this.coordinator.owns(projection(job))) {
        this.coordinator.latchRecovery();
        throw new DashboardJobCoordinatorErrorV1('recovery_required');
      }
      return job;
    });
  }

  async cancelJob(jobId: string): Promise<MarketDataCancellationResultV1> {
    await this.initialize();
    if (!StrategyValidationUuidV4Schema.safeParse(jobId).success) throw new MarketDataJobServiceErrorV1('job_not_found');
    return this.coordinator.exclusive(async () => {
      let job: MarketDataJobViewV1;
      try { job = await this.jobRepository.load(jobId); }
      catch (error) {
        if (error instanceof MarketDataJobRepositoryErrorV1 && error.code === 'missing_job') {
          for (const kind of ['technical_refresh', 'overview_refresh'] as const) {
            if (this.coordinator.reserves({ domain: 'market_data', kind, jobId, terminal: false })) {
              this.coordinator.latchRecovery();
              throw new DashboardJobCoordinatorErrorV1('recovery_required');
            }
          }
          throw new MarketDataJobServiceErrorV1('job_not_found');
        }
        this.coordinator.latchRecovery();
        throw new DashboardJobCoordinatorErrorV1('recovery_required');
      }
      if (isMarketDataJobTerminalV1(job.status)) {
        try { await this.#validateTerminalJob(job, false); }
        catch {
          this.coordinator.latchRecovery();
          throw new DashboardJobCoordinatorErrorV1('recovery_required');
        }
      }
      if (job.status === 'cancelled') return { status: 200, job };
      if (job.status !== 'accepted' && job.status !== 'running' && job.status !== 'cancel_requested') {
        throw new MarketDataJobServiceErrorV1('invalid_job_state');
      }
      this.coordinator.assertOwner(this.#requireLease(jobId));
      if (job.status === 'cancel_requested') return { status: 202, job };
      const next = await this.#replace(job, { ...job, status: 'cancel_requested' });
      this.#controllers.get(jobId)?.abort();
      return { status: 202, job: next };
    });
  }

  async #execute(initial: MarketDataJobViewV1): Promise<void> {
    const lease = this.#requireLease(initial.jobId);
    const controller = this.#controllers.get(initial.jobId)!;
    const budget = new AbortController();
    const remainingBudget = this.#limits!.executionBudgetMs
      - (this.#environment.monotonicNowMs() - lease.monotonicOriginMs);
    if (!Number.isFinite(remainingBudget) || remainingBudget <= 0) budget.abort();
    const budgetTimer = remainingBudget > 0 ? setTimeout(() => budget.abort(), remainingBudget) : undefined;
    budgetTimer?.unref?.();
    const signal = AbortSignal.any([lease.signal, controller.signal, budget.signal]);
    let current = initial;
    try {
      current = await this.coordinator.exclusive(async () => {
        const durable = await this.jobRepository.load(current.jobId);
        if (durable.status === 'cancel_requested') return durable;
        if (durable.status !== 'accepted') throw new Error('Unexpected initial job state.');
        return this.#replace(durable, { ...durable, status: 'running',
          startedAt: this.#nowAtLeast(Date.parse(durable.acceptedAt)) });
      });
      if (current.status === 'cancel_requested') { await this.#finishCancellation(current); return; }
      if (this.#scheduleInfeasible) {
        await this.#finishScheduleInfeasible(current);
        return;
      }
      const attempts: Attempt[] = [];
      const sharedSources = new Map<string, Promise<unknown>>();
      let jobWideFailure: MarketDataJobStopV1['code'] | null = null;
      for (const module of this.overviewRegistry.implemented()) {
        if (signal.aborted) break;
        const beforeAttempts = current.progress.attempts;
        let actualAttempts = 0;
        let actualPages = 0, actualRows = 0, actualBytes = 0;
        try {
          const prepared = await module.collect({ jobId: current.jobId, acceptedAt: current.acceptedAt, signal,
            dispatch: async <T>(start: (signal: AbortSignal) => Promise<T>, extra?: AbortSignal) => {
              if (signal.aborted || extra?.aborted) throw new MarketDataJobStopV1('source_timeout');
              this.#checkExecution(lease, current, actualAttempts, 0, true);
              const attempt = new AbortController();
              let attemptTimer: ReturnType<typeof setTimeout> | undefined;
              const combined = AbortSignal.any(extra ? [signal, extra, attempt.signal] : [signal, attempt.signal]);
              let rejectAbort!: () => void;
              const aborted = new Promise<never>((_, reject) => {
                rejectAbort = () => reject(new Error('Market Data dispatch aborted.'));
                if (combined.aborted) rejectAbort();
                else combined.addEventListener('abort', rejectAbort, { once: true });
              });
              try {
                const dispatched = this.coordinator.dispatch(lease, wait => {
                  if (signal.aborted || extra?.aborted) throw new MarketDataJobStopV1('source_timeout');
                  this.#checkExecution(lease, current, actualAttempts, wait ?? 0, true);
                }, () => {
                  actualAttempts++;
                  attemptTimer = setTimeout(() => attempt.abort(), JQUANTS_REQUEST_TIMEOUT_MS_V1);
                  attemptTimer.unref?.();
                  return start(combined);
                }, extra ? AbortSignal.any([signal, extra]) : signal);
                return await Promise.race([dispatched, aborted]);
              } catch (error) {
                if (attempt.signal.aborted && !signal.aborted && !extra?.aborted) {
                  throw new MarketDataSourceFailureV1('source_timeout');
                }
                throw error;
              } finally {
                combined.removeEventListener('abort', rejectAbort);
                if (attemptTimer) clearTimeout(attemptTimer);
              }
            },
            shareSource: <T>(sourceKey: string, load: () => Promise<T>) => {
              if (!/^[a-z0-9_.:-]{1,160}$/.test(sourceKey) || signal.aborted) {
                throw new MarketDataSourceFailureV1('source_invalid_response');
              }
              const existing = sharedSources.get(sourceKey);
              if (existing) return existing as Promise<T>;
              const pending = Promise.resolve().then(load);
              sharedSources.set(sourceKey, pending);
              return pending;
            },
            recordProgress: progress => {
              this.#checkProgress(current, actualPages + progress.pages, actualRows + progress.acceptedRows,
                actualBytes + progress.responseBytes, actualAttempts);
              actualPages += progress.pages; actualRows += progress.acceptedRows; actualBytes += progress.responseBytes;
            } });
          if (prepared.attempts !== actualAttempts || prepared.pages !== actualPages
            || prepared.acceptedRows !== actualRows || prepared.responseBytes !== actualBytes) {
            throw new Error('Collection accounting mismatch.');
          }
          this.#checkExecution(lease, current, actualAttempts, 0, false);
          attempts.push({ state: 'prepared', module, artifact: module.validate(prepared.artifact) });
        } catch (error) {
          if (error instanceof DashboardJobCoordinatorErrorV1
            || error instanceof MarketDataJobServiceErrorV1) throw error;
          if (error instanceof MarketDataJobStopV1) jobWideFailure = error.code;
          attempts.push({ state: 'failed', module, code: this.#failureCode(error) });
        }
        current = await this.coordinator.exclusive(() => this.#updateProgress(current, {
          attempts: beforeAttempts + actualAttempts,
          pages: current.progress.pages + actualPages,
          acceptedRows: current.progress.acceptedRows + actualRows,
          responseBytes: current.progress.responseBytes + actualBytes,
        }));
        if (current.status === 'cancel_requested') break;
        if (jobWideFailure) break;
      }
      if (controller.signal.aborted) {
        await this.#finishCancellation(current);
        return;
      }
      if (lease.signal.aborted) return;
      if (budget.signal.aborted) jobWideFailure = 'source_timeout';
      const byId = new Map(attempts.map(attempt => [attempt.module.moduleId,
        jobWideFailure && attempt.state === 'prepared'
          ? { state: 'failed' as const, module: attempt.module, code: jobWideFailure }
          : attempt]));
      for (const module of this.overviewRegistry.implemented()) {
        if (!byId.has(module.moduleId)) byId.set(module.moduleId, { state: 'failed', module,
          code: jobWideFailure ?? 'source_timeout' });
      }
      const fetched = [...byId.values()].flatMap(attempt => attempt.state === 'prepared'
        ? [Date.parse(attempt.artifact.fetchedAt)] : []);
      const checkedAt = this.#nowAtLeast(Math.max(Date.parse(current.acceptedAt), ...fetched));
      const hasPrepared = [...byId.values()].some(attempt => attempt.state === 'prepared');
      if (hasPrepared) current = await this.coordinator.exclusive(async () => {
        const durable = await this.jobRepository.load(current.jobId);
        if (durable.status === 'cancel_requested') return durable;
        if (durable.status !== 'running') throw new Error('Unexpected pre-publication state.');
        return this.#replace(durable, { ...durable, status: 'publishing' });
      });
      if (current.status === 'cancel_requested') { await this.#finishCancellation(current); return; }
      const moduleResults: MarketDataModuleResultV1[] = [];
      for (const module of this.overviewRegistry.implemented()) {
        const attempt = byId.get(module.moduleId)!;
        if (attempt.state === 'failed') {
          moduleResults.push(await this.#failedModule(module, attempt.code, checkedAt,
            current.jobId));
          continue;
        }
        this.coordinator.assertOwner(lease);
        try {
          let observed;
          let publicationState: 'published' | 'idempotent_reuse';
          try { observed = await module.publish(attempt.artifact,
            { jobId: current.jobId, acceptedAt: current.acceptedAt, checkedAt }); publicationState = observed.state; }
          catch (error) {
            if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_write_failed') {
              observed = await module.findObservation(current.jobId, current.acceptedAt);
              if (!observed) throw error;
              if (observed.checkedAt !== checkedAt) throw new Error('Unexpected committed receipt.');
              publicationState = 'idempotent_reuse';
            } else throw error;
          }
          moduleResults.push({ moduleId: module.moduleId,
            state: publicationState, checkedAt,
            artifactIdentity: observed.artifactIdentity,
            observationReceiptIdentity: observed.observationReceiptIdentity,
            warningCodes: this.#artifactWarningCodes(module, observed.artifact) });
        } catch (error) {
          if (error instanceof MarketDataRepositoryErrorV1
            && (error.code === 'artifact_write_failed' || error.code === 'create_only_publish_unsupported')) {
            moduleResults.push(await this.#failedModule(module, 'artifact_write_failed', checkedAt,
              current.jobId));
          } else if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_collision') {
            moduleResults.push(await this.#failedModule(module, 'artifact_collision', checkedAt,
              current.jobId));
          } else {
            this.coordinator.latchRecovery();
            return;
          }
        }
      }
      moduleResults.sort((a, b) => moduleOrderV1(a.moduleId) - moduleOrderV1(b.moduleId));
      const successful = moduleResults.filter(result => result.state === 'published' || result.state === 'idempotent_reuse').length;
      const terminal = MarketDataJobViewV1Schema.parse({ ...current,
        status: successful ? 'completed' : 'failed', completedAt: this.#nowAtLeast(Date.parse(checkedAt)),
        progress: { ...current.progress, completedModules: current.progress.totalModules },
        failure: successful ? null : marketDataJobFailureV1('all_modules_failed'),
        result: { kind: 'overview', checkedAt, moduleResults },
      });
      await this.coordinator.exclusive(() => this.#terminalReplace(current, terminal, successful > 0));
    } catch {
      if (controller.signal.aborted) await this.#finishCancellation(current).catch(() => undefined);
      else this.coordinator.latchRecovery();
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      this.#controllers.delete(initial.jobId);
    }
  }

  async #failedModule(module: OverviewModuleAdapterV1, code: MarketDataModuleFailureCodeV1,
    checkedAt: string, jobId: string): Promise<MarketDataModuleResultV1> {
    let latest: LatestMarketDataV1<ReturnType<OverviewModuleAdapterV1['validate']>>;
    try {
      latest = await module.latest();
    } catch (error) {
      if (error instanceof MarketDataJobServiceErrorV1) throw error;
      return { moduleId: module.moduleId, state: 'failed', checkedAt,
        artifactIdentity: null, observationReceiptIdentity: null, failureCode: code, warningCodes: [] };
    }
    if (latest.receipt.jobId === jobId) throw new MarketDataJobServiceErrorV1('invariant_failure');
    return { moduleId: module.moduleId, state: 'retained_previous', checkedAt,
      artifactIdentity: latest.artifactIdentity, observationReceiptIdentity: latest.observationReceiptIdentity,
      failureCode: code, warningCodes: marketDataWarningCodesV1([
        ...this.#artifactWarningCodes(module, latest.artifact),
        ...latest.warnings.map(warning => warning.code), 'source_refresh_failed',
      ]) };
  }

  async #finishScheduleInfeasible(current: MarketDataJobViewV1): Promise<void> {
    const checkedAt = this.#nowAtLeast(Date.parse(current.acceptedAt));
    const moduleResults: MarketDataModuleResultV1[] = this.overviewRegistry.implemented().map(module => ({
      moduleId: module.moduleId, state: 'failed', checkedAt,
      artifactIdentity: null, observationReceiptIdentity: null,
      failureCode: 'external_schedule_infeasible', warningCodes: [],
    }));
    const terminal = MarketDataJobViewV1Schema.parse({ ...current,
      status: 'failed', completedAt: checkedAt,
      progress: { ...current.progress, completedModules: current.progress.totalModules },
      failure: marketDataJobFailureV1('all_modules_failed'),
      result: { kind: 'overview', checkedAt, moduleResults },
    });
    await this.coordinator.exclusive(() => this.#terminalReplace(current, terminal, false));
  }

  #artifactWarningCodes(module: OverviewModuleAdapterV1,
    artifact: ReturnType<OverviewModuleAdapterV1['validate']>): MarketDataWarningCodeV1[] {
    return marketDataWarningCodesV1(module.project(artifact).warnings.map(warning => warning.code));
  }

  async #finishCancellation(current: MarketDataJobViewV1): Promise<void> {
    if (!this.coordinator.owns(projection(current))) return;
    await this.coordinator.exclusive(async () => {
      let durable = await this.jobRepository.load(current.jobId);
      if (durable.status === 'accepted' || durable.status === 'running') {
        durable = await this.#replace(durable, { ...durable, status: 'cancel_requested' });
      }
      if (durable.status === 'cancel_requested') await this.#replace(durable, { ...durable,
        status: 'cancelled', completedAt: this.#nowAtLeast(Date.parse(durable.acceptedAt)) });
      this.#leases.delete(current.jobId);
    });
  }

  async #updateProgress(current: MarketDataJobViewV1,
    progress: Pick<MarketDataJobViewV1['progress'], 'attempts' | 'pages' | 'acceptedRows' | 'responseBytes'>): Promise<MarketDataJobViewV1> {
    const durable = await this.jobRepository.load(current.jobId);
    if (durable.status !== 'running' && durable.status !== 'cancel_requested') {
      throw new Error('Unexpected progress state.');
    }
    return this.#replace(durable, { ...durable, progress: { ...durable.progress, ...progress } });
  }

  async #interrupt(job: MarketDataJobViewV1): Promise<void> {
    const next = MarketDataJobViewV1Schema.parse({ ...job, status: 'interrupted', completedAt: this.#nowAtLeast(Date.parse(job.acceptedAt)),
      failure: null, result: null });
    const outcome = await this.jobRepository.replace(next);
    if (outcome.state !== 'published') throw new Error('Ambiguous recovery write.');
  }

  async #terminalReplace(current: MarketDataJobViewV1, terminal: MarketDataJobViewV1,
    hasCommittedReceipt: boolean): Promise<void> {
    const lease = this.#requireLease(current.jobId);
    let outcome: JobWriteOutcomeV1<MarketDataJobViewV1>;
    try { outcome = await this.jobRepository.replace(terminal); }
    catch { outcome = { state: 'ambiguous' }; }
    if (outcome.state !== 'published' && hasCommittedReceipt && terminal.status === 'completed'
      && terminal.result?.kind === 'overview') {
      const memory = MarketDataJobViewV1Schema.parse({ ...terminal, result: { ...terminal.result,
        moduleResults: terminal.result.moduleResults.map(result =>
          result.state === 'published' || result.state === 'idempotent_reuse'
            ? { ...result, warningCodes: marketDataWarningCodesV1([
              ...result.warningCodes, 'job_record_write_failed',
            ]) }
            : result) } });
      await this.#validateTerminalJob(memory, true);
      this.#memoryCompletions.set(memory.jobId, memory);
      this.coordinator.latchRecovery();
      return;
    }
    await this.coordinator.afterReplace(lease, projected(outcome));
    this.#leases.delete(current.jobId);
  }

  async #replace(current: MarketDataJobViewV1, raw: unknown): Promise<MarketDataJobViewV1> {
    const next = MarketDataJobViewV1Schema.parse(raw);
    const lease = this.#recovering ? null : this.#requireLease(next.jobId);
    const outcome = await this.jobRepository.replace(next);
    if (lease) await this.coordinator.afterReplace(lease, projected(outcome));
    if (outcome.state !== 'published') {
      this.coordinator.latchRecovery();
      throw new DashboardJobCoordinatorErrorV1('recovery_required');
    }
    return outcome.record;
  }

  async #validateTerminalJob(job: MarketDataJobViewV1, allowMemoryWarning: boolean): Promise<void> {
    if (!isMarketDataJobTerminalV1(job.status)) return;
    if (!job.result) return;
    if (job.result.kind === 'technical') {
      if (!allowMemoryWarning && job.result.warningCodes.includes('job_record_write_failed')) {
        throw new Error('Invalid durable warning.');
      }
      if (!this.#technical) throw new Error('Missing Technical association adapter.');
      const observed = await this.#technical.loadObservation(job.result.observationReceiptIdentity);
      if (!same(observed.artifactIdentity, job.result.artifactIdentity)
        || !same(observed.observationReceiptIdentity, job.result.observationReceiptIdentity)
        || observed.checkedAt !== job.result.checkedAt) throw new Error('Invalid Technical association.');
      return;
    }
    for (const result of job.result.moduleResults) {
      if (!allowMemoryWarning && result.warningCodes.includes('job_record_write_failed')) throw new Error('Invalid durable warning.');
      const module = this.overviewRegistry.get(result.moduleId);
      if (!module) throw new Error('Missing module association adapter.');
      const currentObservation = await module.findObservation(job.jobId, job.acceptedAt);
      if (result.state === 'published' || result.state === 'idempotent_reuse') {
        if (!currentObservation
          || !same(currentObservation.artifactIdentity, result.artifactIdentity)
          || !same(currentObservation.observationReceiptIdentity, result.observationReceiptIdentity)
          || currentObservation.checkedAt !== result.checkedAt) {
          throw new Error('Missing current receipt association.');
        }
      } else if (currentObservation) throw new Error('Unexpected current receipt association.');
      if (result.state === 'failed') continue;
      const observed = await module.loadObservation(result.observationReceiptIdentity);
      if (!same(observed.artifactIdentity, result.artifactIdentity)
        || !same(observed.observationReceiptIdentity, result.observationReceiptIdentity)
        || observed.checkedAt !== (result.state === 'retained_previous' ? observed.checkedAt : result.checkedAt)) {
        throw new Error('Invalid module association.');
      }
      if ((result.state === 'published' || result.state === 'idempotent_reuse')
        && (observed.receipt.jobId !== job.jobId || observed.receipt.acceptedAt !== job.acceptedAt
          || observed.checkedAt !== result.checkedAt)) throw new Error('Invalid current receipt association.');
      if (result.state === 'retained_previous' && observed.receipt.jobId === job.jobId) {
        throw new Error('Retained observation is not prior.');
      }
      const transient: MarketDataWarningCodeV1[] = result.state === 'retained_previous'
        ? [
          ...(result.warningCodes.includes('artifact_corrupt_fallback') ? ['artifact_corrupt_fallback' as const] : []),
          'source_refresh_failed',
        ]
        : allowMemoryWarning ? ['job_record_write_failed'] : [];
      const expectedWarnings = marketDataWarningCodesV1([
        ...this.#artifactWarningCodes(module, observed.artifact), ...transient,
      ]);
      if (!same(result.warningCodes, expectedWarnings)) throw new Error('Invalid module warning association.');
    }
  }

  #requireRunnableConfiguration(): void {
    if (!this.overviewRegistry.size || !this.#limits) throw new MarketDataJobServiceErrorV1('source_configuration_missing');
  }
  #requireLease(jobId: string): DashboardJobLeaseV1 {
    const lease = this.#leases.get(jobId);
    if (!lease) throw new DashboardJobCoordinatorErrorV1('recovery_required');
    this.coordinator.assertOwner(lease);
    return lease;
  }
  #nowAtLeast(minimum: number): string {
    return safeInstant(Math.max(minimum, this.#environment.wallNowMs()));
  }
  #checkExecution(lease: DashboardJobLeaseV1, current: MarketDataJobViewV1,
    pendingAttempts: number, pendingWait: number, starting: boolean): void {
    if (!this.#limits || lease.signal.aborted) throw new MarketDataJobStopV1('source_timeout');
    const elapsed = this.#environment.monotonicNowMs() - lease.monotonicOriginMs;
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new MarketDataJobServiceErrorV1('invariant_failure');
    if (elapsed + pendingWait >= this.#limits.executionBudgetMs) throw new MarketDataJobStopV1('source_timeout');
    if (starting ? current.progress.attempts + pendingAttempts >= this.#limits.maximumAttempts
      : current.progress.attempts + pendingAttempts > this.#limits.maximumAttempts) {
      throw new MarketDataJobStopV1('source_response_too_large');
    }
  }
  #checkProgress(current: MarketDataJobViewV1, pages: number, rows: number, bytes: number, attempts: number): void {
    if (!this.#limits || [pages, rows, bytes, attempts].some(value => !Number.isSafeInteger(value) || value < 0)
      || current.progress.pages + pages > this.#limits.maximumPages
      || current.progress.acceptedRows + rows > this.#limits.maximumRows
      || current.progress.responseBytes + bytes > this.#limits.maximumResponseBytes) {
      throw new MarketDataSourceFailureV1('source_response_too_large');
    }
  }
  #failureCode(error: unknown): MarketDataModuleFailureCodeV1 {
    if (error instanceof MarketDataJobStopV1) return error.code;
    if (error instanceof MarketDataSourceFailureV1) return error.code;
    if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_collision') return 'artifact_collision';
    return 'source_invalid_response';
  }
}
