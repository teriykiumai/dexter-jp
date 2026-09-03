import { randomUUID } from 'node:crypto';
import { dexterPath } from '../../utils/paths.js';
import {
  absentMarketDataJobAdapterV1, DASHBOARD_ADMISSION_WARNING_V1, DashboardJobCoordinatorErrorV1,
  DashboardJobCoordinatorV1, type DashboardJobLeaseV1, type DashboardJobProjectionV1,
  type JobWriteOutcomeV1,
} from '../dashboard-jobs/coordinator.js';
import type { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import {
  CAMPAIGN_RECONSTRUCTION_WARNING_V1,
  createCampaignReconstructionPreflightV1,
  createCampaignReconstructionSourceV1,
  executeCampaignReconstructionV1,
  type CampaignReconstructionPreflightV1,
} from './campaign-reconstruction.js';
import {
  acceptJQuantsExecutionV1,
  DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1,
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  requireFeasibleJQuantsExecutionV1,
  resolveJQuantsRequestsPerMinuteV1,
  type AcceptedJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
  type JQuantsExecutionPlanV1,
} from './jquants-execution.js';
import {
  assertStrategyValidationJobTransitionV1,
  createStrategyValidationJobIdV1,
  isStrategyValidationJobTerminalV1,
  strategyValidationJobViewV1,
  StrategyValidationJobRepositoryErrorV1,
  StrategyValidationJobRepositoryV1,
  StrategyValidationJobV1Schema,
  type StrategyValidationJobStatusV1,
  type StrategyValidationJobV1,
  type StrategyValidationJobViewV1,
} from './job-artifact.js';
import {
  digestStrategyValidationInputV1,
  validateStrategyValidationInputV1,
  type StrategyValidationInputV1,
} from './manifest.js';
import {
  createStrategyValidationRunIdV1,
  StrategyValidationRunRepositoryErrorV1,
  StrategyValidationRunRepositoryV1,
  type LoadedStrategyValidationRunV1,
} from './run-repository.js';
import type { StrategyValidationCaseV1 } from './artifacts.js';
import {
  createSnapshotAuditPreflightV1,
  createSnapshotAuditSourceV1,
  executeSnapshotAuditV1,
  type SnapshotAuditPreflightV1,
} from './snapshot-audit.js';

export const STRATEGY_VALIDATION_PREFLIGHT_SCHEMA_VERSION =
  'strategy_validation_preflight_v1' as const;
export const STRATEGY_VALIDATION_PREFLIGHT_TTL_MS = 600_000 as const;
export const STRATEGY_VALIDATION_PREFLIGHT_MAX_ENTRIES = 64 as const;
export const STRATEGY_VALIDATION_OUTCOME_SESSION_RULE_V1 =
  'last_official_tse_session_strictly_before_started_tokyo_date' as const;

type StrategyValidationPreparedPreflightV1 =
  | SnapshotAuditPreflightV1
  | CampaignReconstructionPreflightV1;

export type StrategyValidationPreflightViewV1 = Readonly<{
  schemaVersion: typeof STRATEGY_VALIDATION_PREFLIGHT_SCHEMA_VERSION;
  preflightId: string;
  mode: 'snapshot' | 'campaign';
  startedAt: string;
  expiresAt: string;
  outcomeSessionRule: typeof STRATEGY_VALIDATION_OUTCOME_SESSION_RULE_V1;
  inputDigest: string;
  tickerCount: number;
  anchorCount: number;
  estimatedMinimumAttempts: number;
  minimumDispatchDurationMs: number;
  rateLimitVersion: string;
  requestsPerMinute: number;
  hardMaximumAttempts: number;
  requestTimeoutMs: number;
  executionBudgetMs: number;
  warnings: readonly string[];
}>;

type PreflightEntryV1 = Readonly<{
  view: StrategyValidationPreflightViewV1;
  input: StrategyValidationInputV1;
  prepared: StrategyValidationPreparedPreflightV1;
  consumed: boolean;
}>;

export type StrategyValidationJobAcceptedV1 = Readonly<{
  schemaVersion: 'strategy_validation_job_accepted_v1';
  job: StrategyValidationJobViewV1;
  statusUrl: string;
}>;

export type StrategyValidationCancellationResultV1 = Readonly<{
  status: 200 | 202;
  job: StrategyValidationJobViewV1;
}>;

export type StrategyValidationJobServiceErrorKindV1 =
  | 'invalid_preflight_id'
  | 'preflight_expired'
  | 'preflight_consumed'
  | 'preflight_mismatch'
  | 'active_job_conflict'
  | 'job_not_found'
  | 'invalid_job_transition'
  | 'artifact_unavailable'
  | 'internal_failure';

export class StrategyValidationJobServiceErrorV1 extends Error {
  constructor(
    public readonly kind: StrategyValidationJobServiceErrorKindV1,
    public readonly causeValue?: unknown,
  ) {
    super(kind);
    this.name = 'StrategyValidationJobServiceErrorV1';
  }
}

export interface StrategyValidationJobServiceOptionsV1 {
  readonly snapshotRepository: AnalysisSnapshotRepository;
  readonly runRepository?: StrategyValidationRunRepositoryV1;
  readonly jobRepository?: StrategyValidationJobRepositoryV1;
  readonly executionEnvironment?: JQuantsExecutionEnvironmentV1;
  readonly requestsPerMinute?: number;
  readonly coordinator?: DashboardJobCoordinatorV1;
  readonly marketDataJobsDirectory?: string;
  readonly enqueue?: (work: () => void) => void;
}

function utcFromMilliseconds(value: number): string {
  if (!Number.isFinite(value)) throw new StrategyValidationJobServiceErrorV1('internal_failure');
  return new Date(value).toISOString();
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJsonV1(left as CanonicalJsonValue)
    === canonicalJsonV1(right as CanonicalJsonValue);
}

function publicFailure(code: 'artifact_unavailable' | 'internal_failure') {
  return Object.freeze({
    code,
    message: code === 'artifact_unavailable'
      ? 'The Strategy-validation artifact is unavailable.' as const
      : 'The Strategy-validation job failed.' as const,
  });
}

export class StrategyValidationJobServiceV1 {
  readonly runRepository: StrategyValidationRunRepositoryV1;
  readonly jobRepository: StrategyValidationJobRepositoryV1;
  readonly #snapshotRepository: AnalysisSnapshotRepository;
  readonly #environment: JQuantsExecutionEnvironmentV1;
  readonly #requestsPerMinute: number;
  readonly #preflights = new Map<string, PreflightEntryV1>();
  readonly #controllers = new Map<string, AbortController>();
  readonly coordinator: DashboardJobCoordinatorV1;
  readonly #leases = new Map<string, DashboardJobLeaseV1>();
  readonly #enqueue: (work: () => void) => void;
  #recovering = false;

  constructor(options: StrategyValidationJobServiceOptionsV1) {
    this.#snapshotRepository = options.snapshotRepository;
    this.runRepository = options.runRepository ?? new StrategyValidationRunRepositoryV1();
    this.jobRepository = options.jobRepository ?? new StrategyValidationJobRepositoryV1();
    this.#environment = options.coordinator?.environment ?? options.executionEnvironment ?? DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1;
    this.#requestsPerMinute = options.coordinator?.requestsPerMinute ?? options.requestsPerMinute ?? resolveJQuantsRequestsPerMinuteV1();
    this.#enqueue = options.enqueue ?? queueMicrotask;
    this.coordinator = options.coordinator ?? new DashboardJobCoordinatorV1(this.#environment, this.#requestsPerMinute);
    if (!options.coordinator) this.coordinator.register(absentMarketDataJobAdapterV1(
      options.marketDataJobsDirectory ?? dexterPath('market-data', 'jobs'),
    ));
    this.coordinator.register({
      domain: 'strategy_validation',
      inventory: async () => {
        const jobs = await this.jobRepository.list();
        for (const job of jobs) {
          await this.#validateTerminalJob(job);
          if (!isStrategyValidationJobTerminalV1(job.status) && job.status !== 'publishing'
            && await this.runRepository.hasRun(job.runId)) throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
        }
        return jobs.map(job => this.#projection(job));
      },
      isAbsent: async jobId => {
        try { await this.jobRepository.load(jobId); return false; } catch (error) {
          if (error instanceof StrategyValidationJobRepositoryErrorV1 && error.kind === 'missing_job') return true;
          throw error;
        }
      },
      cleanup: async () => {
        await this.jobRepository.cleanupTemporaryFiles();
        for (const job of await this.jobRepository.list()) {
          if (isStrategyValidationJobTerminalV1(job.status)) await this.runRepository.cleanupTemporaryRun(job.runId);
        }
      },
      reconcile: async projection => {
        this.#recovering = true;
        try { await this.#reconcileJob(await this.jobRepository.load(projection.jobId)); }
        finally { this.#recovering = false; }
      },
    });
  }

  async initialize(): Promise<void> {
    await this.coordinator.initialize();
    this.coordinator.assertHealthy();
  }

  async createPreflight(value: unknown): Promise<StrategyValidationPreflightViewV1> {
    await this.initialize();
    const input = validateStrategyValidationInputV1(value);
    const startedAt = utcFromMilliseconds(this.#environment.wallNowMs());
    const prepared = input.mode === 'snapshot'
      ? await createSnapshotAuditPreflightV1(input, {
        snapshotRepository: this.#snapshotRepository,
        startedAt,
        requestsPerMinute: this.#requestsPerMinute,
      })
      : await createCampaignReconstructionPreflightV1(input.manifest, {
        snapshotRepository: this.#snapshotRepository,
        startedAt,
        requestsPerMinute: this.#requestsPerMinute,
      });
    const controls = requireFeasibleJQuantsExecutionV1(prepared.executionPlan);
    const preflightId = randomUUID();
    const expiresAt = utcFromMilliseconds(Date.parse(startedAt) + STRATEGY_VALIDATION_PREFLIGHT_TTL_MS);
    const tickers = input.mode === 'snapshot'
      ? [input.ticker]
      : [...new Set(input.manifest.anchors.map(anchor => anchor.ticker))];
    const anchorCount = input.mode === 'snapshot' ? 1 : input.manifest.anchors.length;
    const warnings = input.mode === 'campaign'
      ? Object.freeze([
        CAMPAIGN_RECONSTRUCTION_WARNING_V1,
        'Pagination, retries, response latency, validation, and persistence can still exhaust the fixed execution budget.',
        DASHBOARD_ADMISSION_WARNING_V1,
      ])
      : Object.freeze([
        'Pagination, retries, response latency, validation, and persistence can still exhaust the fixed execution budget.',
        DASHBOARD_ADMISSION_WARNING_V1,
      ]);
    const view: StrategyValidationPreflightViewV1 = Object.freeze({
      schemaVersion: STRATEGY_VALIDATION_PREFLIGHT_SCHEMA_VERSION,
      preflightId,
      mode: input.mode,
      startedAt,
      expiresAt,
      outcomeSessionRule: STRATEGY_VALIDATION_OUTCOME_SESSION_RULE_V1,
      inputDigest: digestStrategyValidationInputV1(input),
      tickerCount: tickers.length,
      anchorCount,
      estimatedMinimumAttempts: controls.estimatedMinimumAttempts,
      minimumDispatchDurationMs: controls.minimumDispatchDurationMs,
      rateLimitVersion: controls.rateLimitVersion,
      requestsPerMinute: controls.requestsPerMinute,
      hardMaximumAttempts: controls.hardMaximumAttempts,
      requestTimeoutMs: controls.requestTimeoutMs,
      executionBudgetMs: controls.executionBudgetMs,
      warnings,
    });
    return this.#exclusive(async () => {
      this.coordinator.assertHealthy();
      this.#prunePreflights();
      // Keep capability capacity atomic even when local preflights finish concurrently.
      if (this.#preflights.size >= STRATEGY_VALIDATION_PREFLIGHT_MAX_ENTRIES) {
        throw new StrategyValidationJobServiceErrorV1('internal_failure');
      }
      this.#preflights.set(preflightId, Object.freeze({ view, input, prepared, consumed: false }));
      return view;
    });
  }

  async acceptPreflight(
    preflightId: string,
    confirmExternalFetch: true,
  ): Promise<StrategyValidationJobAcceptedV1> {
    await this.initialize();
    if (confirmExternalFetch !== true) {
      throw new StrategyValidationJobServiceErrorV1('preflight_mismatch');
    }
    const jobId = createStrategyValidationJobIdV1();
    let created!: StrategyValidationJobV1;
    let prepared!: StrategyValidationPreparedPreflightV1;
    let accepted!: AcceptedJQuantsExecutionV1;
    let entry!: PreflightEntryV1;
    const revalidate = () => {
      entry = this.#preflight(preflightId);
      const now = this.#environment.wallNowMs();
      if (now >= Date.parse(entry.view.expiresAt)) {
        this.#preflights.delete(preflightId);
        throw new StrategyValidationJobServiceErrorV1('preflight_expired');
      }
      if (entry.consumed) throw new StrategyValidationJobServiceErrorV1('preflight_consumed');
      if (digestStrategyValidationInputV1(entry.input) !== entry.view.inputDigest) {
        throw new StrategyValidationJobServiceErrorV1('preflight_mismatch');
      }
      requireFeasibleJQuantsExecutionV1(entry.prepared.executionPlan);
    };
    await this.coordinator.admit({ kind: 'strategy_validation', jobId, revalidate,
      create: async lease => {
        prepared = entry.prepared;
        accepted = acceptJQuantsExecutionV1(prepared.executionPlan, {
          ...this.#environment, wallNowMs: () => lease.acceptedAtMs, monotonicNowMs: () => lease.monotonicOriginMs,
        });
        const runId = createStrategyValidationRunIdV1();
        const job = StrategyValidationJobV1Schema.parse({
          schemaVersion: 'strategy_validation_job_v1',
          jobId,
          runId,
          mode: entry.input.mode,
          inputDigest: entry.view.inputDigest,
          selector: entry.prepared.selector,
          startedAt: entry.prepared.startedAt,
          acceptedAt: accepted.acceptedAt,
          executionDeadline: accepted.executionDeadline,
          executionControls: accepted.controls,
          status: 'preparing',
          createdAt: accepted.acceptedAt,
          updatedAt: accepted.acceptedAt,
          finishedAt: null,
          cancellationRequestedAt: null,
          outcomeAsOfSession: null,
          expectedRunPayloadDigest: null,
          progress: { attemptCount: 0, caseCount: 0 },
          failure: null,
        });
        const outcome = await this.jobRepository.createWithOutcome(job);
        if (outcome.state === 'published') created = outcome.record;
        return this.#projectOutcome(outcome);
      },
      adopt: lease => {
        this.#leases.set(jobId, lease);
        this.#preflights.set(preflightId, Object.freeze({ ...entry, consumed: true }));
        this.#enqueue(() => {
          void this.#execute(created, prepared, accepted);
        });
      },
    });
    return Object.freeze({
      schemaVersion: 'strategy_validation_job_accepted_v1',
      job: strategyValidationJobViewV1(created),
      statusUrl: `/api/strategy-validation/jobs/${jobId}`,
    });
  }

  async activeJob(): Promise<StrategyValidationJobViewV1 | null> {
    await this.initialize();
    return this.#exclusive(async () => {
      const active = await this.coordinator.active();
      if (!active) return null;
      if (active.kind !== 'strategy_validation') throw new DashboardJobCoordinatorErrorV1('active_job_conflict', undefined, active.kind);
      try {
        const job = await this.jobRepository.load(active.jobId);
        if (isStrategyValidationJobTerminalV1(job.status)) throw new Error('Active record changed.');
        return strategyValidationJobViewV1(job);
      } catch {
        this.coordinator.latchRecovery();
        this.coordinator.assertHealthy();
        return null;
      }
    });
  }

  async getJob(jobId: string): Promise<StrategyValidationJobViewV1> {
    void this.initialize().catch(() => undefined);
    return this.#exclusive(async () => {
      let job: StrategyValidationJobV1;
      try {
        job = await this.jobRepository.load(jobId);
      } catch (error) {
        if (!(error instanceof StrategyValidationJobRepositoryErrorV1) || error.kind !== 'missing_job'
          || this.coordinator.reserves({ domain: 'strategy_validation', kind: 'strategy_validation', jobId, terminal: false })) {
          this.coordinator.latchRecovery();
          this.coordinator.assertHealthy();
        }
        throw this.#mapJobRepositoryError(error);
      }
      try { await this.#validateTerminalJob(job); } catch {
        this.coordinator.latchRecovery();
        this.coordinator.assertHealthy();
      }
      if (!isStrategyValidationJobTerminalV1(job.status)) {
        this.coordinator.assertHealthy();
        if (!this.coordinator.owns(this.#projection(job))) {
          this.coordinator.latchRecovery();
          this.coordinator.assertHealthy();
        }
      }
      return strategyValidationJobViewV1(job);
    });
  }

  async listRuns(): Promise<readonly LoadedStrategyValidationRunV1[]> {
    void this.initialize().catch(() => undefined);
    return this.#exclusive(async () => {
      const runs = await this.runRepository.list();
      const jobs = await this.#jobsForRunValidation();
      for (const run of runs) await this.#validateRunJobAssociation(run, jobs);
      return runs;
    });
  }

  async loadRun(runId: string): Promise<LoadedStrategyValidationRunV1> {
    void this.initialize().catch(() => undefined);
    return this.#exclusive(async () => {
      const run = await this.runRepository.load(runId);
      await this.#validateRunJobAssociation(run, await this.#jobsForRunValidation());
      return run;
    });
  }

  async loadCase(runId: string, caseId: string): Promise<StrategyValidationCaseV1> {
    const loaded = await this.loadRun(runId);
    const result = loaded.cases.find(value => value.caseId === caseId);
    if (result === undefined) return this.runRepository.loadCase(runId, caseId);
    return result;
  }

  async cancelJob(jobId: string): Promise<StrategyValidationCancellationResultV1> {
    await this.initialize();
    return this.#exclusive(async () => {
      this.coordinator.assertHealthy();
      let job: StrategyValidationJobV1;
      try {
        job = await this.jobRepository.load(jobId);
      } catch (error) {
        if (!(error instanceof StrategyValidationJobRepositoryErrorV1) || error.kind !== 'missing_job'
          || this.coordinator.reserves({ domain: 'strategy_validation', kind: 'strategy_validation', jobId, terminal: false })) {
          this.coordinator.latchRecovery();
          this.coordinator.assertHealthy();
        }
        throw this.#mapJobRepositoryError(error);
      }
      if (job.status === 'cancelled') {
        try { await this.#validateTerminalJob(job); } catch {
          this.coordinator.latchRecovery();
          this.coordinator.assertHealthy();
        }
        return Object.freeze({ status: 200, job: strategyValidationJobViewV1(job) });
      }
      if (job.status === 'cancel_requested') {
        this.#requireLease(job.jobId);
        return Object.freeze({ status: 202, job: strategyValidationJobViewV1(job) });
      }
      if (!['preparing', 'collecting', 'validating'].includes(job.status)) {
        throw new StrategyValidationJobServiceErrorV1('invalid_job_transition');
      }
      const requested = await this.#transition(job, 'cancel_requested', {
        cancellationRequestedAt: utcFromMilliseconds(this.#environment.wallNowMs()),
      });
      this.#controllers.get(job.jobId)?.abort();
      return Object.freeze({ status: 202, job: strategyValidationJobViewV1(requested) });
    });
  }

  async #execute(
    initial: StrategyValidationJobV1,
    preflight: StrategyValidationPreparedPreflightV1,
    accepted: AcceptedJQuantsExecutionV1,
  ): Promise<void> {
    const controller = new AbortController();
    let runtime: JQuantsExecutionRuntimeV1 | null = null;
    this.#controllers.set(initial.jobId, controller);
    try {
      const collecting = await this.#exclusive(async () => {
        this.#requireLease(initial.jobId);
        const current = await this.jobRepository.load(initial.jobId);
        if (current.status === 'cancel_requested') {
          controller.abort();
          throw new JQuantsValidationErrorV1('cancelled', 'The job was cancelled.');
        }
        return this.#transition(current, 'collecting');
      });
      const activeRuntime = new JQuantsExecutionRuntimeV1(accepted, {
        environment: this.#environment,
        signal: AbortSignal.any([controller.signal, this.#requireLease(initial.jobId).signal]),
        dashboardDispatch: {
          assertCanContinue: () => { this.#requireLease(initial.jobId); },
          dispatch: (check, start, signal) => this.coordinator.dispatch(this.#requireLease(initial.jobId), check, start, signal),
        },
      });
      runtime = activeRuntime;
      const onOutcomeAsOfSession = async (outcomeAsOfSession: string): Promise<void> => {
        await this.#exclusive(async () => {
          this.#requireLease(initial.jobId);
          const current = await this.jobRepository.load(collecting.jobId);
          if (current.status !== 'collecting' && current.status !== 'cancel_requested') {
            controller.abort();
            throw new JQuantsValidationErrorV1('cancelled', 'The job was cancelled.');
          }
          if (current.outcomeAsOfSession !== null
            && current.outcomeAsOfSession !== outcomeAsOfSession) {
            throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
          }
          if (current.outcomeAsOfSession !== outcomeAsOfSession) {
            await this.#rewriteJob(current, { outcomeAsOfSession });
          }
          if (current.status === 'cancel_requested') {
            controller.abort();
            throw new JQuantsValidationErrorV1('cancelled', 'The job was cancelled.');
          }
        });
      };
      const onValidating = async (progress: Readonly<{
        outcomeAsOfSession: string | null;
        caseCount: number;
        attemptCount: number;
      }>): Promise<void> => {
        await this.#exclusive(async () => {
          this.#requireLease(initial.jobId);
          const current = await this.jobRepository.load(collecting.jobId);
          if (current.status !== 'collecting') {
            controller.abort();
            throw new JQuantsValidationErrorV1('cancelled', 'The job was cancelled.');
          }
          await this.#transition(current, 'validating', {
            outcomeAsOfSession: progress.outcomeAsOfSession,
            progress: Object.freeze({
              attemptCount: progress.attemptCount,
              caseCount: progress.caseCount,
            }),
          });
        });
      };
      const beforePromote = async (prepared: Readonly<{
        runId: string;
        runPayloadDigest: string;
      }>): Promise<void> => {
        await this.#exclusive(async () => {
          activeRuntime.assertCanContinue(controller.signal);
          const current = await this.jobRepository.load(collecting.jobId);
          if (current.status !== 'validating' || prepared.runId !== current.runId) {
            throw new StrategyValidationJobServiceErrorV1('invalid_job_transition');
          }
          await this.#transition(current, 'publishing', {
            expectedRunPayloadDigest: prepared.runPayloadDigest,
          });
        });
      };
      const result = preflight.mode === 'snapshot'
        ? await executeSnapshotAuditV1(preflight, {
          source: createSnapshotAuditSourceV1(activeRuntime),
          runtime: activeRuntime,
          accepted,
          runRepository: this.runRepository,
          signal: controller.signal,
          runId: initial.runId,
          onOutcomeAsOfSession,
          onValidating,
          beforePromote,
        })
        : await executeCampaignReconstructionV1(preflight, {
          source: createCampaignReconstructionSourceV1(activeRuntime),
          runtime: activeRuntime,
          accepted,
          runRepository: this.runRepository,
          signal: controller.signal,
          runId: initial.runId,
          onOutcomeAsOfSession,
          onValidating: progress => onValidating(progress),
          beforePromote,
        });
      await this.#exclusive(async () => {
        this.#requireLease(initial.jobId);
        const current = await this.jobRepository.load(initial.jobId);
        const loaded = await this.runRepository.load(initial.runId);
        if (current.status !== 'publishing'
          || current.expectedRunPayloadDigest !== result.runPayloadDigest
          || loaded.runPayloadDigest !== result.runPayloadDigest
          || !this.#runMatchesCompletedJob(loaded, current)) {
          throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
        }
        await this.#transition(current, 'completed', {
          outcomeAsOfSession: loaded.run.outcomeAsOfSession,
          progress: Object.freeze({
            attemptCount: result.attemptCount,
            caseCount: result.caseCount,
          }),
        });
      });
    } catch (error) {
      await this.#handleExecutionFailure(
        initial.jobId,
        controller.signal,
        error,
        runtime?.attempts.length ?? 0,
      );
    } finally {
      this.#controllers.delete(initial.jobId);
      this.#leases.delete(initial.jobId);
    }
  }

  async #handleExecutionFailure(
    jobId: string,
    signal: AbortSignal,
    error: unknown,
    attemptCount: number,
  ): Promise<void> {
    await this.#exclusive(async () => {
      try { this.#requireLease(jobId); } catch { return; }
      let current: StrategyValidationJobV1;
      try {
        current = await this.jobRepository.load(jobId);
      } catch {
        this.coordinator.latchRecovery();
        return;
      }
      if (isStrategyValidationJobTerminalV1(current.status)) {
        this.coordinator.latchRecovery();
        return;
      }
      const cancelled = signal.aborted
        || current.status === 'cancel_requested'
        || (error instanceof JQuantsValidationErrorV1 && error.code === 'cancelled');
      if (cancelled && current.status !== 'publishing') {
        try {
          await this.runRepository.cleanupTemporaryRun(current.runId);
          if (!await this.runRepository.hasRun(current.runId)) {
            const cancelRequested = current.status === 'cancel_requested'
              ? current
              : await this.#transition(current, 'cancel_requested', {
                cancellationRequestedAt: utcFromMilliseconds(this.#environment.wallNowMs()),
              });
            await this.#transition(cancelRequested, 'cancelled', {
              progress: Object.freeze({ ...cancelRequested.progress, attemptCount }),
            });
            return;
          }
          await this.#transition(current, 'failed', {
            failure: publicFailure('artifact_unavailable'),
            progress: Object.freeze({ ...current.progress, attemptCount }),
          });
        } catch {
          await this.#transition(current, 'failed', {
            failure: publicFailure('artifact_unavailable'),
            progress: Object.freeze({ ...current.progress, attemptCount }),
          });
        }
        return;
      }
      let finalRunExists = false;
      try {
        finalRunExists = current.status === 'publishing'
          && await this.runRepository.hasRun(current.runId);
      } catch {
        if (current.status === 'publishing') {
          await this.#transition(current, 'failed', {
            failure: publicFailure('artifact_unavailable'),
            progress: Object.freeze({ ...current.progress, attemptCount }),
          });
          return;
        }
      }
      if (current.status === 'publishing' && finalRunExists) {
        try {
          const loaded = await this.runRepository.load(current.runId);
          if (loaded.runPayloadDigest === current.expectedRunPayloadDigest
            && this.#runMatchesCompletedJob(loaded, current)) {
            await this.#transition(current, 'completed', {
              outcomeAsOfSession: loaded.run.outcomeAsOfSession,
              progress: Object.freeze({
                attemptCount: loaded.run.execution.attemptCount,
                caseCount: loaded.cases.length,
              }),
            });
            return;
          }
        } catch {
          // The suspect final directory is retained and the public failure stays sanitized.
        }
        await this.#transition(current, 'failed', {
          failure: publicFailure('artifact_unavailable'),
          progress: Object.freeze({ ...current.progress, attemptCount }),
        });
        return;
      }
      try {
        await this.runRepository.cleanupTemporaryRun(current.runId);
        await this.#transition(current, 'failed', {
          failure: publicFailure(error instanceof StrategyValidationRunRepositoryErrorV1
            ? 'artifact_unavailable'
            : 'internal_failure'),
          progress: Object.freeze({ ...current.progress, attemptCount }),
        });
      } catch {
        await this.#transition(current, 'failed', {
          failure: publicFailure('artifact_unavailable'),
          progress: Object.freeze({ ...current.progress, attemptCount }),
        });
      }
    }).catch(() => { this.coordinator.latchRecovery(); });
  }

  async #reconcileJob(job: StrategyValidationJobV1): Promise<void> {
    if (['preparing', 'collecting', 'validating', 'cancel_requested'].includes(job.status)) {
      const finalExists = await this.runRepository.hasRun(job.runId);
      await this.runRepository.cleanupTemporaryRun(job.runId);
      await this.#transition(job, 'interrupted');
      if (finalExists) throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
      return;
    }
    if (job.status === 'publishing') {
      if (!await this.runRepository.hasRun(job.runId)) {
        await this.runRepository.cleanupTemporaryRun(job.runId);
        await this.#transition(job, 'interrupted');
        return;
      }
      try {
        const loaded = await this.runRepository.load(job.runId);
        if (loaded.runPayloadDigest !== job.expectedRunPayloadDigest
          || !this.#runMatchesCompletedJob(loaded, job)) {
          throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
        }
        await this.#transition(job, 'completed', {
          outcomeAsOfSession: loaded.run.outcomeAsOfSession,
          progress: Object.freeze({
            attemptCount: loaded.run.execution.attemptCount,
            caseCount: loaded.cases.length,
          }),
        });
      } catch (error) {
        if (error instanceof DashboardJobCoordinatorErrorV1) throw error;
        await this.#transition(job, 'failed', {
          failure: publicFailure('artifact_unavailable'),
        });
        throw error instanceof StrategyValidationJobServiceErrorV1
          ? error
          : new StrategyValidationJobServiceErrorV1('artifact_unavailable', error);
      }
      return;
    }
    if (isStrategyValidationJobTerminalV1(job.status)) {
      await this.runRepository.cleanupTemporaryRun(job.runId);
      await this.#validateTerminalJob(job);
    }
  }

  async #validateTerminalJob(job: StrategyValidationJobV1): Promise<void> {
    if (!isStrategyValidationJobTerminalV1(job.status)) return;
    if (job.status === 'completed') {
      await this.#validateCompletedJob(job);
      return;
    }
    let finalExists: boolean;
    try {
      finalExists = await this.runRepository.hasRun(job.runId);
    } catch (error) {
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable', error);
    }
    if ((job.status === 'cancelled' || job.status === 'interrupted') && finalExists) {
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
    }
    if (job.status === 'failed' && finalExists && job.failure?.code !== 'artifact_unavailable') {
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
    }
  }

  async #validateCompletedJob(job: StrategyValidationJobV1): Promise<void> {
    try {
      const loaded = await this.runRepository.load(job.runId);
      if (loaded.runPayloadDigest !== job.expectedRunPayloadDigest
        || !this.#runMatchesCompletedJob(loaded, job)) {
        throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
      }
    } catch (error) {
      if (error instanceof StrategyValidationJobServiceErrorV1) throw error;
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable', error);
    }
  }

  #runMatchesJob(run: Readonly<{
    runId: string;
    mode: string;
    selector: unknown;
    startedAt: string;
    acceptedAt: string;
    executionDeadline: string;
    execution: Readonly<{ controls: JQuantsExecutionPlanV1 }>;
  }>, job: StrategyValidationJobV1): boolean {
    return run.runId === job.runId
      && run.mode === job.mode
      && sameCanonicalValue(run.selector, job.selector)
      && run.startedAt === job.startedAt
      && run.acceptedAt === job.acceptedAt
      && run.executionDeadline === job.executionDeadline
      && sameCanonicalValue(run.execution.controls, job.executionControls);
  }

  #runMatchesCompletedJob(
    loaded: LoadedStrategyValidationRunV1,
    job: StrategyValidationJobV1,
  ): boolean {
    return this.#runMatchesJob(loaded.run, job)
      && job.outcomeAsOfSession === loaded.run.outcomeAsOfSession
      && job.progress.attemptCount === loaded.run.execution.attemptCount
      && job.progress.caseCount === loaded.cases.length
      && job.progress.caseCount === loaded.run.caseReferences.length;
  }

  async #jobsForRunValidation(): Promise<readonly StrategyValidationJobV1[]> {
    try {
      return await this.jobRepository.list();
    } catch (error) {
      this.coordinator.latchRecovery();
      throw this.#mapJobRepositoryError(error);
    }
  }

  async #validateRunJobAssociation(
    loaded: LoadedStrategyValidationRunV1,
    jobs: readonly StrategyValidationJobV1[],
  ): Promise<void> {
    const matching = jobs.filter(job => job.runId === loaded.run.runId);
    if (matching.length === 0) return;
    if (matching.length !== 1 || matching[0]!.status !== 'completed') {
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
    }
    const job = matching[0]!;
    if (loaded.runPayloadDigest !== job.expectedRunPayloadDigest
      || !this.#runMatchesCompletedJob(loaded, job)) {
      throw new StrategyValidationJobServiceErrorV1('artifact_unavailable');
    }
  }

  #preflight(preflightId: string): PreflightEntryV1 {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(preflightId)) {
      throw new StrategyValidationJobServiceErrorV1('invalid_preflight_id');
    }
    const entry = this.#preflights.get(preflightId);
    if (entry === undefined) throw new StrategyValidationJobServiceErrorV1('preflight_expired');
    return entry;
  }

  #prunePreflights(): void {
    const now = this.#environment.wallNowMs();
    for (const [id, entry] of this.#preflights) {
      if (now >= Date.parse(entry.view.expiresAt)) this.#preflights.delete(id);
    }
  }

  async #transition(
    current: StrategyValidationJobV1,
    status: StrategyValidationJobStatusV1,
    patch: Partial<Pick<StrategyValidationJobV1,
      | 'cancellationRequestedAt'
      | 'outcomeAsOfSession'
      | 'expectedRunPayloadDigest'
      | 'progress'
      | 'failure'>> = {},
  ): Promise<StrategyValidationJobV1> {
    assertStrategyValidationJobTransitionV1(current.status, status);
    const updatedAt = utcFromMilliseconds(this.#environment.wallNowMs());
    const terminal = isStrategyValidationJobTerminalV1(status);
    const next = StrategyValidationJobV1Schema.parse({
      ...current,
      ...patch,
      status,
      updatedAt,
      finishedAt: terminal ? updatedAt : null,
      expectedRunPayloadDigest: status === 'publishing' || status === 'completed'
        ? patch.expectedRunPayloadDigest ?? current.expectedRunPayloadDigest
        : null,
    });
    return this.#storeJob(next);
  }

  async #rewriteJob(
    current: StrategyValidationJobV1,
    patch: Pick<StrategyValidationJobV1, 'outcomeAsOfSession'>,
  ): Promise<StrategyValidationJobV1> {
    const next = StrategyValidationJobV1Schema.parse({
      ...current,
      ...patch,
      updatedAt: utcFromMilliseconds(this.#environment.wallNowMs()),
    });
    return this.#storeJob(next);
  }

  #projection(job: StrategyValidationJobV1): DashboardJobProjectionV1 {
    return { domain: 'strategy_validation', kind: 'strategy_validation', jobId: job.jobId,
      terminal: isStrategyValidationJobTerminalV1(job.status) };
  }

  #projectOutcome(outcome: JobWriteOutcomeV1<StrategyValidationJobV1>): JobWriteOutcomeV1<DashboardJobProjectionV1> {
    return outcome.state === 'published' ? { state: 'published', record: this.#projection(outcome.record) } : outcome;
  }

  #requireLease(jobId: string): DashboardJobLeaseV1 {
    this.coordinator.assertHealthy();
    const lease = this.#leases.get(jobId);
    if (!lease) throw new DashboardJobCoordinatorErrorV1('recovery_required');
    this.coordinator.assertOwner(lease);
    return lease;
  }

  async #storeJob(next: StrategyValidationJobV1): Promise<StrategyValidationJobV1> {
    const lease = this.#recovering ? null : this.#requireLease(next.jobId);
    let outcome: JobWriteOutcomeV1<StrategyValidationJobV1>;
    try { outcome = await this.jobRepository.replaceWithOutcome(next); } catch { outcome = { state: 'ambiguous' }; }
    if (lease) await this.coordinator.afterReplace(lease, this.#projectOutcome(outcome));
    if (outcome.state !== 'published') {
      this.coordinator.latchRecovery();
      throw new DashboardJobCoordinatorErrorV1('recovery_required');
    }
    return outcome.record;
  }

  #mapJobRepositoryError(error: unknown): StrategyValidationJobServiceErrorV1 {
    if (error instanceof StrategyValidationJobRepositoryErrorV1) {
      if (error.kind === 'unsafe_job_id' || error.kind === 'missing_job') {
        return new StrategyValidationJobServiceErrorV1('job_not_found', error);
      }
      if (error.kind === 'invalid_transition') {
        return new StrategyValidationJobServiceErrorV1('invalid_job_transition', error);
      }
      return new StrategyValidationJobServiceErrorV1('artifact_unavailable', error);
    }
    return new StrategyValidationJobServiceErrorV1('internal_failure', error);
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.coordinator.exclusive(operation);
  }
}
