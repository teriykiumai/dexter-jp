import { lstat, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

export type DashboardJobKindV1 = 'strategy_validation' | 'technical_refresh' | 'overview_refresh';
export type DashboardJobDomainV1 = 'strategy_validation' | 'market_data';
export type JobWriteOutcomeV1<T> =
  | { state: 'definitely_not_published' }
  | { state: 'published'; record: T }
  | { state: 'ambiguous' };
export type DashboardJobProjectionV1 = Readonly<{
  domain: DashboardJobDomainV1; kind: DashboardJobKindV1; jobId: string; terminal: boolean;
}>;
export interface DashboardJobAdapterV1 {
  readonly domain: DashboardJobDomainV1;
  inventory(): Promise<readonly DashboardJobProjectionV1[]>;
  isAbsent(jobId: string): Promise<boolean>;
  cleanup(): Promise<void>;
  reconcile(job: DashboardJobProjectionV1): Promise<void>;
}

export const DASHBOARD_ADMISSION_WARNING_V1 = '最小dispatch時間とExecution budgetは受付成立後の時間です。直前の通信から最大60秒は受付できず、手動再試行が必要です。';
export const DASHBOARD_INITIALIZING_MESSAGE_V1 = 'ジョブ記録を確認中です。完了後に再度操作してください。';
export const DASHBOARD_RECOVERY_MESSAGE_V1 = 'ジョブ記録の整合性を確認できないため、新規実行を停止しました。Dashboardを再起動してください。解消しない場合は記録を変更せず調査してください。';

export class DashboardJobCoordinatorErrorV1 extends Error {
  constructor(
    readonly reason: 'initializing' | 'recovery_required' | 'active_job_conflict' | 'cooldown' | 'clock_invalid' | 'publication_failed',
    readonly retryAfterSeconds?: number,
    readonly activeKind?: DashboardJobKindV1,
  ) { super(reason); }
}

export function dashboardCoordinatorFailureV1(error: DashboardJobCoordinatorErrorV1, domain: DashboardJobDomainV1) {
  const recoveryCode = domain === 'strategy_validation' ? 'artifact_unavailable' : 'repository_failure';
  if (error.reason === 'initializing' || error.reason === 'recovery_required') {
    return { status: 500, code: recoveryCode, message: error.reason === 'initializing'
      ? DASHBOARD_INITIALIZING_MESSAGE_V1 : DASHBOARD_RECOVERY_MESSAGE_V1 };
  }
  if (error.reason === 'cooldown' && Number.isInteger(error.retryAfterSeconds)
    && error.retryAfterSeconds! >= 1 && error.retryAfterSeconds! <= 60) {
    return { status: 409, code: 'active_job_conflict', retryAfterSeconds: error.retryAfterSeconds,
      message: `J-Quantsの通信間隔を確保するため、あと ${error.retryAfterSeconds} 秒待って再度実行してください。ジョブは未受付です。` };
  }
  if (error.reason === 'active_job_conflict') {
    const labels: Record<DashboardJobKindV1, string> = {
      strategy_validation: '戦略検証', technical_refresh: 'テクニカル更新', overview_refresh: '市場概況更新',
    };
    return { status: 409, code: 'active_job_conflict', message: `${labels[error.activeKind ?? 'strategy_validation']}ジョブが実行中です。` };
  }
  return { status: 500, code: error.reason === 'publication_failed' ? recoveryCode
    : domain === 'strategy_validation' ? 'internal_failure' : 'invariant_failure',
  message: 'ジョブを受け付けられませんでした。' };
}

export type DashboardJobLeaseV1 = Readonly<{
  kind: DashboardJobKindV1; jobId: string; acceptedAtMs: number; monotonicOriginMs: number; signal: AbortSignal;
}>;
type Lease = { value: DashboardJobLeaseV1; controller: AbortController };
type State = 'initializing' | 'idle' | 'provisional' | 'active' | 'admission_recovery_required';
const DOMAINS = ['strategy_validation', 'market_data'] as const;
function domainFor(kind: DashboardJobKindV1): DashboardJobDomainV1 {
  return kind === 'strategy_validation' ? kind : 'market_data';
}

/** One server-process owner. All native writes/read/release proofs use exclusive(). */
export class DashboardJobCoordinatorV1 {
  readonly #adapters = new Map<DashboardJobDomainV1, DashboardJobAdapterV1>();
  readonly #attemptTimes: number[] = [];
  #lastClock: number | null = null;
  #state: State = 'initializing';
  #lease: Lease | null = null;
  #tail: Promise<void> = Promise.resolve();
  #initialization: Promise<void> | null = null;

  constructor(readonly environment: JQuantsExecutionEnvironmentV1, readonly requestsPerMinute: number) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 500) {
      throw new DashboardJobCoordinatorErrorV1('clock_invalid');
    }
  }

  register(adapter: DashboardJobAdapterV1): void {
    if (this.#initialization || !DOMAINS.includes(adapter.domain) || this.#adapters.has(adapter.domain)) {
      throw new Error('Dashboard job adapters must be registered once before initialization.');
    }
    this.#adapters.set(adapter.domain, adapter);
  }

  initialize(): Promise<void> {
    this.#initialization ??= this.exclusive(async () => {
      try {
        const inventory = await this.#inventory();
        const active = inventory.filter(job => !job.terminal);
        if (active.length > 1) throw new Error('Multiple nonterminal records.');
        // Adjudicate both read-only inventories before any native cleanup/rewrite.
        if (active[0]) await this.#adapters.get(active[0].domain)!.reconcile(active[0]);
        for (const domain of DOMAINS) await this.#adapters.get(domain)!.cleanup();
        if ((await this.#inventory()).some(job => !job.terminal)) throw new Error('Recovery incomplete.');
        this.#state = 'idle';
      } catch {
        this.latchRecovery();
      }
    });
    return this.#initialization;
  }

  assertHealthy(): void {
    if (this.#state === 'initializing') throw new DashboardJobCoordinatorErrorV1('initializing');
    if (this.#state === 'admission_recovery_required') throw new DashboardJobCoordinatorErrorV1('recovery_required');
  }

  latchRecovery(): void {
    this.#state = 'admission_recovery_required';
    this.#lease?.controller.abort();
  }

  assertOwner(lease: DashboardJobLeaseV1): void {
    this.assertHealthy();
    if (this.#state !== 'active' || this.#lease?.value !== lease || lease.signal.aborted) {
      throw new DashboardJobCoordinatorErrorV1('recovery_required');
    }
  }

  owns(job: DashboardJobProjectionV1): boolean {
    return this.#state === 'active' && this.#lease?.value.jobId === job.jobId && this.#lease.value.kind === job.kind;
  }

  async admit(options: {
    kind: DashboardJobKindV1; jobId: string; revalidate: () => void;
    create: (lease: DashboardJobLeaseV1) => Promise<JobWriteOutcomeV1<DashboardJobProjectionV1>>;
    adopt: (lease: DashboardJobLeaseV1) => void;
  }): Promise<void> {
    return this.exclusive(async () => {
      this.assertHealthy();
      options.revalidate();
      if (this.#lease) throw new DashboardJobCoordinatorErrorV1('active_job_conflict', undefined, this.#lease.value.kind);
      await this.#proveIdle();
      const now = this.#clock();
      this.#expire(now);
      if (this.#attemptTimes.length) {
        throw new DashboardJobCoordinatorErrorV1('cooldown', Math.ceil((this.#attemptTimes.at(-1)! + 60_000 - now) / 1_000));
      }
      options.revalidate();
      const acceptedAtMs = this.environment.wallNowMs();
      if (!Number.isFinite(acceptedAtMs) || !Number.isFinite(new Date(acceptedAtMs).getTime())) {
        throw new DashboardJobCoordinatorErrorV1('clock_invalid');
      }
      const controller = new AbortController();
      const lease = Object.freeze({ kind: options.kind, jobId: options.jobId, acceptedAtMs, monotonicOriginMs: now, signal: controller.signal });
      this.#lease = { value: lease, controller };
      this.#state = 'provisional';
      let outcome: JobWriteOutcomeV1<DashboardJobProjectionV1>;
      try { outcome = await options.create(lease); } catch { outcome = { state: 'ambiguous' }; }
      if (outcome.state === 'definitely_not_published') {
        try {
          if (!await this.#adapters.get(domainFor(lease.kind))!.isAbsent(lease.jobId)) throw new Error('Not absent.');
          await this.#proveIdle();
          this.#lease = null;
          this.#state = 'idle';
        } catch { this.latchRecovery(); }
        this.assertHealthy();
        throw new DashboardJobCoordinatorErrorV1('publication_failed');
      }
      if (outcome.state !== 'published' || outcome.record.terminal || outcome.record.jobId !== lease.jobId
        || outcome.record.kind !== lease.kind || outcome.record.domain !== domainFor(lease.kind)) {
        this.latchRecovery();
        return this.assertHealthy();
      }
      try {
        this.#state = 'active';
        options.adopt(lease);
      } catch { this.latchRecovery(); }
      this.assertHealthy();
    });
  }

  /** Called in the same critical section as the native replace. Never releases on exceptions. */
  async afterReplace(lease: DashboardJobLeaseV1, outcome: JobWriteOutcomeV1<DashboardJobProjectionV1>): Promise<void> {
    this.assertOwner(lease);
    if (outcome.state !== 'published' || outcome.record.jobId !== lease.jobId || outcome.record.kind !== lease.kind
      || outcome.record.domain !== domainFor(lease.kind)) this.latchRecovery();
    else if (outcome.record.terminal) {
      await this.#proveIdle();
      this.#lease = null;
      this.#state = 'idle';
    }
    this.assertHealthy();
  }

  /** Caller holds exclusive(); inventories cannot race native mutations. */
  async active(): Promise<DashboardJobProjectionV1 | null> {
    this.assertHealthy();
    try {
      const active = (await this.#inventory()).filter(job => !job.terminal);
      if (this.#state === 'idle' && active.length === 0) return null;
      if (active.length === 1 && this.owns(active[0])) return active[0];
    } catch { /* invalid inventory becomes a sticky blocker */ }
    this.latchRecovery();
    this.assertHealthy();
    return null;
  }

  /** Starts, but never awaits, external I/O inside the section. Every runtime uses this one log. */
  async dispatch<T>(lease: DashboardJobLeaseV1, check: (waitMs?: number) => void, start: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    while (true) {
      const decision = await this.exclusive(async () => {
        this.assertOwner(lease);
        check();
        const now = this.#clock();
        this.#expire(now);
        if (this.#attemptTimes.length >= this.requestsPerMinute) {
          const wait = this.#attemptTimes[0]! + 60_000 - now;
          check(wait);
          return { wait } as const;
        }
        this.#attemptTimes.push(now);
        // Synchronous start failure is still an actual attempt and retains its timestamp.
        let pending: Promise<T>;
        try { pending = start(); } catch (error) { pending = Promise.reject(error); }
        return { pending } as const;
      });
      if (decision.pending !== undefined) return decision.pending;
      const combined = signal ? AbortSignal.any([lease.signal, signal]) : lease.signal;
      await this.environment.sleep(decision.wait, combined);
    }
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async #inventory(): Promise<readonly DashboardJobProjectionV1[]> {
    const all: DashboardJobProjectionV1[] = [];
    const seen = new Set<string>();
    for (const domain of DOMAINS) {
      const adapter = this.#adapters.get(domain);
      if (!adapter) throw new Error('Missing native job adapter.');
      for (const job of await adapter.inventory()) {
        const key = `${domain}:${job.jobId}`;
        if (job.domain !== domain || !['strategy_validation', 'technical_refresh', 'overview_refresh'].includes(job.kind)
          || domainFor(job.kind) !== domain || typeof job.terminal !== 'boolean'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(job.jobId) || seen.has(key)) {
          throw new Error('Invalid native inventory.');
        }
        seen.add(key);
        all.push(job);
      }
    }
    return all;
  }

  async #proveIdle(): Promise<void> {
    try {
      if ((await this.#inventory()).some(job => !job.terminal)) throw new Error('Unexpected durable job.');
    } catch { this.latchRecovery(); this.assertHealthy(); }
  }

  #clock(): number {
    const now = this.environment.monotonicNowMs();
    if (!Number.isFinite(now) || (this.#lastClock !== null && now < this.#lastClock)) {
      throw new DashboardJobCoordinatorErrorV1('clock_invalid');
    }
    this.#lastClock = now;
    return now;
  }

  #expire(now: number): void {
    while (this.#attemptTimes.length && now - this.#attemptTimes[0]! >= 60_000) this.#attemptTimes.shift();
  }
}

/** DR-C1 only: no source/job implementation may be hidden behind an empty registry. */
export function absentMarketDataJobAdapterV1(jobsDirectory: string): DashboardJobAdapterV1 {
  const inventory = async (): Promise<readonly DashboardJobProjectionV1[]> => {
    for (const path of [dirname(jobsDirectory), jobsDirectory]) {
      const stat = await lstat(path).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Invalid absent-domain directory.');
    }
    const entries = await readdir(jobsDirectory).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    if (entries.length) throw new Error('Unimplemented job domain is not empty.');
    return [];
  };
  return Object.freeze({ domain: 'market_data', inventory,
    isAbsent: async () => { await inventory(); return true; }, cleanup: async () => { await inventory(); },
    reconcile: async () => { throw new Error('No Market Data reconciliation adapter.'); } });
}
