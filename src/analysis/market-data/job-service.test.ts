import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DashboardJobCoordinatorV1, type DashboardJobAdapterV1 } from '../dashboard-jobs/coordinator.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { fixtureCodec, fixtureDraft, fixtureOverviewCodec, fixtureOverviewDraft,
  type FixtureArtifact } from './repository-test-fixtures.js';
import { MarketDataRepositoryV1 } from './repository.js';
import { MarketDataJobRepositoryV1 } from './job-repository.js';
import { MarketDataJobViewV1Schema } from './job-schema.js';
import { MarketDataSourceFailureV1 } from './job-schema.js';
import { MarketDataJobServiceV1, type MarketDataJobLimitsV1 } from './job-service.js';
import { OverviewModuleRegistryV1, createOverviewModuleAdapterV1 } from './overview-registry.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function environment() {
  let monotonic = 0, wall = Date.parse('2026-09-04T00:00:00.000Z');
  const value: JQuantsExecutionEnvironmentV1 = {
    monotonicNowMs: () => monotonic, wallNowMs: () => wall, apiKey: () => 'synthetic',
    fetch: async () => { throw new Error('No external fetch in DR-O1 tests.'); },
    sleep: async (duration, signal) => {
      if (signal?.aborted) throw new Error('cancelled');
      monotonic += duration; wall += duration;
    },
  };
  return { value, advance(ms: number) { monotonic += ms; wall += ms; } };
}

const limits: MarketDataJobLimitsV1 = { estimatedMinimumAttempts: 1, maximumAttempts: 3,
  maximumPages: 3, maximumRows: 10, maximumResponseBytes: 1024, executionBudgetMs: 120_000 };

async function harness(options: { configured?: boolean; fail?: () => boolean; enqueue?: (work: () => void) => void;
  ambiguousTerminalWrite?: boolean; partial?: boolean; shared?: boolean; exhaustBudget?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-market-service-')); roots.push(root);
  const clock = environment();
  const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
  const strategy: DashboardJobAdapterV1 = { domain: 'strategy_validation', inventory: async () => [],
    isAbsent: async () => true, cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } };
  coordinator.register(strategy);
  const repository = new MarketDataRepositoryV1(fixtureCodec(false, {}), root);
  const module = createOverviewModuleAdapterV1<FixtureArtifact>({ repository,
    collect: async context => {
      if (options.fail?.()) throw new Error('synthetic source schema failure');
      const load = async () => {
        const result = await context.dispatch(async () => {
          if (options.exhaustBudget) clock.advance(limits.executionBudgetMs);
          return { synthetic: true };
        });
        context.recordProgress({ pages: 1, acceptedRows: 1, responseBytes: 64 });
        return result;
      };
      if (options.shared) await context.shareSource('synthetic_shared_source_v1', load); else await load();
      return { artifact: fixtureCodec(false, {}).build(fixtureDraft(context.acceptedAt, 0)),
        attempts: 1, pages: 1, acceptedRows: 1, responseBytes: 64 };
    },
    project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }),
    environment: {},
  });
  const secondCodec = fixtureOverviewCodec('margin_1570', {});
  const second = createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(secondCodec, root),
    collect: async context => {
      if (options.shared) {
        await context.shareSource('synthetic_shared_source_v1', async () => { throw new Error('must reuse'); });
        return { artifact: secondCodec.build(fixtureOverviewDraft('margin_1570', context.acceptedAt, 1)),
          attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0 };
      }
      throw new MarketDataSourceFailureV1('source_timeout');
    },
    project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }),
    environment: {},
  });
  const registry = new OverviewModuleRegistryV1(options.configured === false ? []
    : options.partial || options.shared ? [module, second] : [module]);
  let renameCount = 0;
  const jobRepository = new MarketDataJobRepositoryV1(root, options.ambiguousTerminalWrite ? { io: {
    rename: async (source, destination) => {
      await rename(source, destination);
      if (++renameCount === 4) throw new Error('synthetic post-terminal-rename failure');
    },
  } } : {});
  const service = new MarketDataJobServiceV1({ coordinator,
    jobRepository, overviewRegistry: registry,
    limits: options.configured === false ? undefined : limits, enqueue: options.enqueue });
  await service.initialize();
  return { root, clock, coordinator, repository, module, service };
}

async function terminal(service: MarketDataJobServiceV1, jobId: string) {
  for (let count = 0; count < 100; count++) {
    const job = await service.getJob(jobId);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Job did not finish.');
}

describe('Market Data Overview job service', () => {
  test('zero registered modules is a read miss and refuses admission without a job', async () => {
    const h = await harness({ configured: false });
    await expect(h.service.readOverview()).rejects.toMatchObject({ code: 'artifact_not_found' });
    await expect(h.service.acceptOverview()).rejects.toMatchObject({ code: 'source_configuration_missing' });
    expect(await new MarketDataJobRepositoryV1(h.root).list()).toEqual([]);
  });

  test('publishes one receipt, completes the native job, and composes the fixed six-module view', async () => {
    const h = await harness();
    const accepted = await h.service.acceptOverview();
    expect(accepted.statusUrl).toBe(`/api/market-data/jobs/${accepted.jobId}`);
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('completed');
    expect(job.progress).toEqual({ attempts: 1, pages: 1, acceptedRows: 1,
      responseBytes: 64, completedModules: 1, totalModules: 1 });
    expect(job.result?.kind).toBe('overview');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]?.state).toBe('published');
    expect(job.result.moduleResults[0]?.checkedAt).toBe(job.result.checkedAt);
    const overview = await h.service.readOverview();
    expect(overview.modules.map(module => module.moduleId)).toEqual([
      'tse_margin_quantities', 'market_short_ratio', 'margin_1570',
      'tokyo_nagoya_foreign_flow', 'etf_1321_eod', 'etf_1321_2633_relative',
    ]);
    expect(overview.modules[1]).toMatchObject({ state: 'available', payload: { identity: 'synthetic', value: 0 } });
    expect(overview.modules.filter(module => module.state === 'not_implemented')).toHaveLength(5);
    expect(await h.service.activeJob()).toEqual({ schemaVersion: 'market_data_active_job_v1',
      marketJob: null, blockingKind: null });
  });

  test('a failed refresh retains the prior authoritative observation but does not count it as a new success', async () => {
    let fail = false;
    const h = await harness({ fail: () => fail });
    const first = await h.service.acceptOverview(); await terminal(h.service, first.jobId);
    h.clock.advance(60_000); fail = true;
    const second = await h.service.acceptOverview(); const job = await terminal(h.service, second.jobId);
    expect(job.status).toBe('failed');
    expect(job.failure?.code).toBe('all_modules_failed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'retained_previous',
      failureCode: 'source_invalid_response', warningCodes: ['source_refresh_failed'] });
    expect((await h.service.readOverview()).modules[1]).toMatchObject({ state: 'available' });
  });

  test('commits successful siblings once after all module attempts and reports a partial completion', async () => {
    const h = await harness({ partial: true });
    const accepted = await h.service.acceptOverview(); const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('completed');
    expect(job.progress.totalModules).toBe(2);
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => [result.moduleId, result.state])).toEqual([
      ['market_short_ratio', 'published'], ['margin_1570', 'failed'],
    ]);
    expect(new Set(job.result.moduleResults.map(result => result.checkedAt)).size).toBe(1);
    const view = await h.service.readOverview();
    expect(view.modules[1]?.state).toBe('available');
    expect(view.modules[2]).toMatchObject({ state: 'unavailable', reason: 'not_collected' });
  });

  test('shares one job-scoped source promise across module artifacts without a second dispatch', async () => {
    const h = await harness({ shared: true });
    const accepted = await h.service.acceptOverview(); const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('completed');
    expect(job.progress).toMatchObject({ attempts: 1, pages: 1, acceptedRows: 1, responseBytes: 64,
      completedModules: 2, totalModules: 2 });
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => result.state)).toEqual(['published', 'published']);
  });

  test('a job-wide execution deadline publishes no prepared module receipt', async () => {
    const h = await harness({ exhaustBudget: true });
    const accepted = await h.service.acceptOverview(); const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('failed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'failed', failureCode: 'source_timeout' });
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  test('startup interrupts one abandoned Market Data job without replaying collection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-market-recovery-')); roots.push(root);
    const repository = new MarketDataJobRepositoryV1(root);
    const job = MarketDataJobViewV1Schema.parse({ schemaVersion: 'market_data_job_view_v1', jobId: randomUUID(),
      kind: 'technical_refresh', target: { kind: 'technical', ticker: '7203' }, status: 'running',
      acceptedAt: '2026-09-04T00:00:00.000Z', startedAt: '2026-09-04T00:00:00.000Z', completedAt: null,
      progress: { attempts: 1, pages: 1, acceptedRows: 1, responseBytes: 1,
        completedModules: 0, totalModules: 1 }, failure: null, result: null });
    expect((await repository.create(job)).state).toBe('published');
    const clock = environment(); const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
      cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
    const service = new MarketDataJobServiceV1({ coordinator, jobRepository: repository });
    await service.initialize();
    expect((await service.getJob(job.jobId)).status).toBe('interrupted');
  });

  test('startup preserves two nonterminal records and chooses no recovery winner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-market-multiple-')); roots.push(root);
    const repository = new MarketDataJobRepositoryV1(root);
    const jobs = [randomUUID(), randomUUID()].map(jobId => MarketDataJobViewV1Schema.parse({
      schemaVersion: 'market_data_job_view_v1', jobId, kind: 'overview_refresh', target: { kind: 'overview' },
      status: 'accepted', acceptedAt: '2026-09-04T00:00:00.000Z', startedAt: null, completedAt: null,
      progress: { attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0,
        completedModules: 0, totalModules: 1 }, failure: null, result: null,
    }));
    for (const job of jobs) expect((await repository.create(job)).state).toBe('published');
    const clock = environment(); const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
      cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
    const service = new MarketDataJobServiceV1({ coordinator, jobRepository: repository });
    await expect(service.initialize()).rejects.toMatchObject({ reason: 'recovery_required' });
    expect((await repository.list()).map(job => job.status)).toEqual(['accepted', 'accepted']);
  });

  test('cancellation before worker start writes no receipt and finishes cancelled', async () => {
    let queued: (() => void) | undefined;
    const h = await harness({ enqueue: work => { queued = work; } });
    const accepted = await h.service.acceptOverview();
    expect((await h.service.cancelJob(accepted.jobId)).status).toBe(202);
    queued?.();
    expect((await terminal(h.service, accepted.jobId)).status).toBe('cancelled');
    expect((await h.service.cancelJob(accepted.jobId)).status).toBe(200);
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  test('a missing reserved native record is recovery failure on the first exact read', async () => {
    let queued: (() => void) | undefined;
    const h = await harness({ enqueue: work => { queued = work; } });
    const accepted = await h.service.acceptOverview();
    await unlink(join(h.root, 'jobs', `${accepted.jobId}.json`));
    await expect(h.service.getJob(accepted.jobId)).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(queued).toBeDefined();
  });

  test('serves a validated in-memory completion and blocks admission after an ambiguous terminal write', async () => {
    const h = await harness({ ambiguousTerminalWrite: true });
    const accepted = await h.service.acceptOverview();
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('completed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]?.warningCodes).toContain('job_record_write_failed');
    await expect(h.service.activeJob()).rejects.toMatchObject({ reason: 'recovery_required' });
    await expect(h.service.acceptOverview()).rejects.toMatchObject({ reason: 'recovery_required' });
    expect((await h.repository.latest()).observationReceiptIdentity.jobId).toBe(accepted.jobId);
  });
});
