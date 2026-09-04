import { afterEach, describe, expect, test } from 'bun:test';
import { link, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { DashboardJobCoordinatorV1, type DashboardJobAdapterV1 } from '../dashboard-jobs/coordinator.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { fixtureCodec, fixtureDraft, fixtureOverviewCodec, fixtureOverviewDraft,
  type FixtureArtifact } from './repository-test-fixtures.js';
import { MarketDataRepositoryV1 } from './repository.js';
import { MarketDataJobRepositoryV1 } from './job-repository.js';
import { MarketDataJobViewV1Schema, type MarketDataModuleFailureCodeV1,
  type MarketDataWarningV1 } from './job-schema.js';
import { MarketDataSourceFailureV1 } from './job-schema.js';
import { MarketDataJobServiceV1, type MarketDataJobLimitsV1 } from './job-service.js';
import { OverviewModuleRegistryV1, createOverviewModuleAdapterV1,
  type OverviewModuleAdapterV1 } from './overview-registry.js';
import type { MarketDataModuleIdV1 } from './contracts.js';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function harness(options: { configured?: boolean; fail?: () => boolean;
  sourceFailure?: () => MarketDataModuleFailureCodeV1 | null; dispatches?: number;
  swallowDispatchStop?: boolean;
  enqueue?: (work: () => void) => void; ambiguousTerminalWrite?: boolean;
  partial?: boolean; shared?: boolean; exhaustBudget?: boolean;
  pendingDispatch?: boolean; dispatchStarted?: () => void; latestGate?: () => Promise<void>;
  warnings?: readonly MarketDataWarningV1[]; limits?: MarketDataJobLimitsV1;
  observationProbeFailure?: () => boolean;
  linkFailure?: { moduleId: MarketDataModuleIdV1; active: () => boolean; code: 'ENOSYS' | 'EXDEV' | 'EPERM';
    timing?: 'before_link' | 'after_receipt_link'; failFirstProofRead?: boolean } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-market-service-')); roots.push(root);
  const clock = environment();
  const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
  const strategy: DashboardJobAdapterV1 = { domain: 'strategy_validation', inventory: async () => [],
    isAbsent: async () => true, cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } };
  coordinator.register(strategy);
  const moduleLink = (moduleId: MarketDataModuleIdV1) => async (source: string, destination: string) => {
    if (options.linkFailure?.moduleId === moduleId && options.linkFailure.active()) {
      if (options.linkFailure.timing === 'after_receipt_link'
        && destination.includes(join('observations', 'overview'))) {
        await link(source, destination);
        throw Object.assign(new Error('synthetic post-link create-only failure'), { code: options.linkFailure.code });
      }
      if (options.linkFailure.timing === 'after_receipt_link') {
        await link(source, destination);
        return;
      }
      throw Object.assign(new Error('synthetic unsupported create-only publication'), { code: options.linkFailure.code });
    }
    await link(source, destination);
  };
  const proofReader = (moduleId: MarketDataModuleIdV1) => {
    let failed = false;
    return async (path: string, read: () => Promise<unknown>) => {
      if (!failed && options.linkFailure?.moduleId === moduleId && options.linkFailure.active()
        && options.linkFailure.failFirstProofRead && path.includes(join('observations', 'overview'))) {
        failed = true;
        throw Object.assign(new Error('synthetic first proof read failure'), { code: 'EIO' });
      }
      return read();
    };
  };
  const repository = new MarketDataRepositoryV1(fixtureCodec(false, {}), root,
    { linkFile: moduleLink('market_short_ratio'), readForPublicationProof: proofReader('market_short_ratio') });
  const module = createOverviewModuleAdapterV1<FixtureArtifact>({ repository,
    collect: async context => {
      const sourceFailure = options.sourceFailure?.();
      if (sourceFailure) throw new MarketDataSourceFailureV1(sourceFailure);
      if (options.fail?.()) throw new Error('synthetic source schema failure');
      const load = async () => {
        let result = { synthetic: true };
        for (let attempt = 0; attempt < (options.dispatches ?? 1); attempt++) {
          try { result = await context.dispatch(async signal => {
            if (options.exhaustBudget) clock.advance((options.limits ?? limits).executionBudgetMs);
            if (options.pendingDispatch) {
              options.dispatchStarted?.();
              return new Promise<never>((_resolve, reject) => {
                const abort = () => reject(new Error('synthetic source observed abort'));
                if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
              });
            }
            return { synthetic: true };
          }); } catch (error) {
            if (options.swallowDispatchStop) break;
            throw error;
          }
        }
        context.recordProgress({ pages: 1, acceptedRows: 1, responseBytes: 64 });
        return result;
      };
      if (options.shared) await context.shareSource('synthetic_shared_source_v1', load); else await load();
      return { artifact: fixtureCodec(false, {}).build(fixtureDraft(context.acceptedAt, 0)),
        attempts: options.swallowDispatchStop
          ? Math.min(options.dispatches ?? 1, (options.limits ?? limits).maximumAttempts)
          : options.dispatches ?? 1,
        pages: 1, acceptedRows: 1, responseBytes: 64 };
    },
    project: artifact => ({ state: 'available', payload: artifact.syntheticResult,
      warnings: options.warnings ?? [] }),
    environment: {},
  });
  const registeredModule: OverviewModuleAdapterV1 = options.latestGate || options.observationProbeFailure
    ? Object.freeze({ ...module,
      latest: async () => { await options.latestGate?.(); return module.latest(); },
      findObservation: async (jobId: string, acceptedAt: string) => {
        if (options.observationProbeFailure?.()) throw new Error('synthetic observation proof failure');
        return module.findObservation(jobId, acceptedAt);
      } })
    : module;
  const secondCodec = fixtureOverviewCodec('margin_1570', {});
  let secondCollects = 0;
  const second = createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(secondCodec, root,
    { linkFile: moduleLink('margin_1570'), readForPublicationProof: proofReader('margin_1570') }),
    collect: async context => {
      secondCollects++;
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
    : options.partial || options.shared ? [registeredModule, second] : [registeredModule]);
  let renameCount = 0;
  const jobRepository = new MarketDataJobRepositoryV1(root, options.ambiguousTerminalWrite ? { io: {
    rename: async (source, destination) => {
      await rename(source, destination);
      if (++renameCount === 4) throw new Error('synthetic post-terminal-rename failure');
    },
  } } : {});
  const service = new MarketDataJobServiceV1({ coordinator,
    jobRepository, overviewRegistry: registry,
    limits: options.configured === false ? undefined : options.limits ?? limits, enqueue: options.enqueue });
  await service.initialize();
  return { root, clock, coordinator, repository, module: registeredModule,
    secondCollects: () => secondCollects, service };
}

async function terminal(service: MarketDataJobServiceV1, jobId: string) {
  for (let count = 0; count < 1000; count++) {
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

  test('derives persisted warning codes for publish, reuse, and retained previous results', async () => {
    let fail = false;
    const warnings: MarketDataWarningV1[] = [
      { code: 'basis_break', message: 'Synthetic basis boundary.',
        moduleId: 'market_short_ratio', artifactIdentity: null },
      { code: 'cadence_changed', message: 'Synthetic cadence boundary.',
        moduleId: 'market_short_ratio', artifactIdentity: null },
    ];
    const h = await harness({ fail: () => fail, warnings });
    const first = await h.service.acceptOverview();
    const published = await terminal(h.service, first.jobId);
    if (published.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(published.result.moduleResults[0]).toMatchObject({ state: 'published',
      warningCodes: ['cadence_changed', 'basis_break'] });

    h.clock.advance(60_000);
    const second = await h.service.acceptOverview();
    const reused = await terminal(h.service, second.jobId);
    if (reused.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(reused.result.moduleResults[0]).toMatchObject({ state: 'idempotent_reuse',
      warningCodes: ['cadence_changed', 'basis_break'] });

    h.clock.advance(60_000); fail = true;
    const third = await h.service.acceptOverview();
    const retained = await terminal(h.service, third.jobId);
    if (retained.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(retained.result.moduleResults[0]).toMatchObject({ state: 'retained_previous',
      warningCodes: ['cadence_changed', 'basis_break', 'source_refresh_failed'] });
  });

  test('retained previous preserves repository fallback and persisted warning codes', async () => {
    let fail = false;
    const warnings: MarketDataWarningV1[] = [{ code: 'source_gap', message: 'Synthetic source gap.',
      moduleId: 'market_short_ratio', artifactIdentity: null }];
    const h = await harness({ fail: () => fail, warnings });
    const first = await h.service.acceptOverview(); await terminal(h.service, first.jobId);
    const newerArtifact = fixtureCodec(false, {}).build(fixtureDraft('2026-09-04T00:01:00.000Z', 1));
    const newer = await h.repository.publish(newerArtifact, {
      jobId: randomUUID(), acceptedAt: newerArtifact.asOfCutoff,
      checkedAt: new Date(Date.parse(newerArtifact.fetchedAt) + 1000).toISOString(),
    });
    await writeFile(join(h.root, newer.observationReceiptIdentity.rootRelativeIdentity), '{broken');
    h.clock.advance(120_000); fail = true;
    const accepted = await h.service.acceptOverview();
    const retained = await terminal(h.service, accepted.jobId);
    if (retained.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(retained.result.moduleResults[0]).toMatchObject({ state: 'retained_previous',
      warningCodes: ['artifact_corrupt_fallback', 'source_gap', 'source_refresh_failed'] });
  });

  for (const change of ['missing', 'extra'] as const) {
    test(`rejects a terminal job with ${change} derived artifact warning codes`, async () => {
      const warnings: MarketDataWarningV1[] = change === 'missing' ? [{
        code: 'basis_break', message: 'Synthetic basis boundary.',
        moduleId: 'market_short_ratio', artifactIdentity: null,
      }] : [];
      const h = await harness({ warnings });
      const accepted = await h.service.acceptOverview();
      const job = await terminal(h.service, accepted.jobId);
      if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
      const warningCodes = change === 'missing' ? [] : ['basis_break'] as const;
      const tampered = MarketDataJobViewV1Schema.parse({ ...job, result: { ...job.result,
        moduleResults: job.result.moduleResults.map(result => ({ ...result, warningCodes })) } });
      const path = join(h.root, 'jobs', `${accepted.jobId}.json`);
      await writeFile(path, canonicalJsonV1(tampered as unknown as CanonicalJsonValue));
      const restartedClock = environment();
      const restartedCoordinator = new DashboardJobCoordinatorV1(restartedClock.value, 5);
      restartedCoordinator.register({ domain: 'strategy_validation', inventory: async () => [],
        isAbsent: async () => true, cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
      const restarted = new MarketDataJobServiceV1({ coordinator: restartedCoordinator,
        jobRepository: new MarketDataJobRepositoryV1(h.root),
        overviewRegistry: new OverviewModuleRegistryV1([h.module]), limits });
      await expect(restarted.initialize()).rejects.toMatchObject({ reason: 'recovery_required' });
    });
  }

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

  test('maps a proved pre-receipt ENOSYS publication failure to a normal failed job', async () => {
    const h = await harness({ linkFailure: { moduleId: 'market_short_ratio', active: () => true, code: 'ENOSYS' } });
    const accepted = await h.service.acceptOverview();
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('failed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'failed', failureCode: 'artifact_write_failed' });
    expect(await h.service.activeJob()).toEqual({ schemaVersion: 'market_data_active_job_v1',
      marketJob: null, blockingKind: null });
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  test('keeps a successful sibling when an EXDEV publication is proved receipt-free', async () => {
    const h = await harness({ shared: true,
      linkFailure: { moduleId: 'margin_1570', active: () => true, code: 'EXDEV' } });
    const accepted = await h.service.acceptOverview();
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('completed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => [result.moduleId, result.state,
      'failureCode' in result ? result.failureCode : null])).toEqual([
      ['market_short_ratio', 'published', null],
      ['margin_1570', 'failed', 'artifact_write_failed'],
    ]);
    expect(await h.service.activeJob()).toMatchObject({ marketJob: null, blockingKind: null });
  });

  test('retains a prior observation after a proved receipt-free EPERM publication failure', async () => {
    let unsupported = false;
    const h = await harness({ linkFailure: {
      moduleId: 'market_short_ratio', active: () => unsupported, code: 'EPERM',
    } });
    const first = await h.service.acceptOverview(); await terminal(h.service, first.jobId);
    h.clock.advance(60_000); unsupported = true;
    const second = await h.service.acceptOverview();
    const job = await terminal(h.service, second.jobId);
    expect(job.status).toBe('failed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'retained_previous',
      failureCode: 'artifact_write_failed', warningCodes: ['source_refresh_failed'] });
    expect((await h.repository.latest()).observationReceiptIdentity.jobId).toBe(first.jobId);
    expect(await h.service.activeJob()).toMatchObject({ marketJob: null, blockingKind: null });
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

  for (const boundary of [
    { name: 'pages', key: 'pages', delta: { pages: 2, acceptedRows: 0, responseBytes: 0 } },
    { name: 'rows', key: 'acceptedRows', delta: { pages: 0, acceptedRows: 2, responseBytes: 0 } },
    { name: 'response bytes', key: 'responseBytes', delta: { pages: 0, acceptedRows: 0, responseBytes: 2 } },
  ] as const) {
    test(`stops the whole job and records the first exceeded ${boundary.name} ceiling`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'dexter-market-progress-bound-')); roots.push(root);
      const clock = environment(); const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
      coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
        cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
      const latestReads: (() => Promise<unknown>)[] = [];
      let finalCollects = 0;
      const moduleIds = ['tse_margin_quantities', 'market_short_ratio', 'margin_1570'] as const;
      const modules = moduleIds.map((moduleId, index) => {
        const codec = fixtureOverviewCodec(moduleId, {});
        const repository = new MarketDataRepositoryV1(codec, root);
        latestReads.push(() => repository.latest());
        return createOverviewModuleAdapterV1({ repository,
          collect: async context => {
            if (index === 2) finalCollects++;
            const progress = index === 0
              ? { pages: 1, acceptedRows: 1, responseBytes: 1 }
              : boundary.delta;
            context.recordProgress(progress);
            return { artifact: codec.build(fixtureOverviewDraft(moduleId, context.acceptedAt, index)),
              attempts: 0, ...progress };
          },
          project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }),
          environment: {},
        });
      });
      const service = new MarketDataJobServiceV1({ coordinator,
        jobRepository: new MarketDataJobRepositoryV1(root),
        overviewRegistry: new OverviewModuleRegistryV1(modules),
        limits: { estimatedMinimumAttempts: 1, maximumAttempts: 3,
          maximumPages: 2, maximumRows: 2, maximumResponseBytes: 2, executionBudgetMs: 120_000 } });
      await service.initialize();
      const accepted = await service.acceptOverview(); const job = await terminal(service, accepted.jobId);
      expect(job.status).toBe('failed');
      expect(job.progress[boundary.key]).toBe(3);
      expect(finalCollects).toBe(0);
      if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
      expect(job.result.moduleResults.map(result => 'failureCode' in result ? result.failureCode : null))
        .toEqual(['source_response_too_large', 'source_response_too_large', 'source_response_too_large']);
      for (const latest of latestReads) {
        await expect(latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
      }
    });
  }

  for (const boundary of [
    { name: 'pages', delta: { pages: 2, acceptedRows: 0, responseBytes: 0 } },
    { name: 'rows', delta: { pages: 0, acceptedRows: 2, responseBytes: 0 } },
    { name: 'response bytes', delta: { pages: 0, acceptedRows: 0, responseBytes: 2 } },
  ] as const) {
    test(`keeps the ${boundary.name} whole-job stop sticky when a module catches it`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'dexter-market-sticky-bound-')); roots.push(root);
      const clock = environment(); const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
      coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
        cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
      let finalCollects = 0;
      const repositories: { latest(): Promise<unknown> }[] = [];
      const modules = (['tse_margin_quantities', 'market_short_ratio', 'margin_1570'] as const)
        .map((moduleId, index) => {
          const codec = fixtureOverviewCodec(moduleId, {});
          const repository = new MarketDataRepositoryV1(codec, root); repositories.push(repository);
          return createOverviewModuleAdapterV1({ repository,
            collect: async context => {
              if (index === 2) finalCollects++;
              const progress = index === 0
                ? { pages: 1, acceptedRows: 1, responseBytes: 1 }
                : boundary.delta;
              if (index === 1) {
                try { context.recordProgress(progress); } catch { /* Simulate a source-wrapper remap. */ }
              } else context.recordProgress(progress);
              return { artifact: codec.build(fixtureOverviewDraft(moduleId, context.acceptedAt, index)),
                attempts: 0, ...progress };
            }, project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }),
            environment: {},
          });
        });
      const service = new MarketDataJobServiceV1({ coordinator,
        jobRepository: new MarketDataJobRepositoryV1(root),
        overviewRegistry: new OverviewModuleRegistryV1(modules),
        limits: { estimatedMinimumAttempts: 1, maximumAttempts: 3,
          maximumPages: 2, maximumRows: 2, maximumResponseBytes: 2, executionBudgetMs: 120_000 } });
      await service.initialize();
      const accepted = await service.acceptOverview(); const job = await terminal(service, accepted.jobId);
      expect(finalCollects).toBe(0);
      if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
      expect(job.result.moduleResults.map(result => 'failureCode' in result ? result.failureCode : null))
        .toEqual(['source_response_too_large', 'source_response_too_large', 'source_response_too_large']);
      for (const repository of repositories) {
        await expect(repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
      }
    });
  }

  test('classifies a real execution-budget abort as a whole-job timeout', async () => {
    const started = deferred();
    const h = await harness({ partial: true, pendingDispatch: true,
      dispatchStarted: started.resolve,
      limits: { ...limits, executionBudgetMs: 100 } });
    const accepted = await h.service.acceptOverview();
    await started.promise;
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('failed');
    expect(job.progress.attempts).toBe(1);
    expect(h.secondCollects()).toBe(0);
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => 'failureCode' in result ? result.failureCode : null))
      .toEqual(['source_timeout', 'source_timeout']);
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  test('preserves an earlier module failure when a later timeout stops remaining modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-market-failure-order-')); roots.push(root);
    const clock = environment();
    const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
      cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
    const firstCodec = fixtureOverviewCodec('tse_margin_quantities', {});
    const first = createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(firstCodec, root),
      collect: async () => { throw new MarketDataSourceFailureV1('source_entitlement_required'); },
      project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }), environment: {} });
    const secondCodec = fixtureOverviewCodec('market_short_ratio', {});
    const second = createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(secondCodec, root),
      collect: async context => {
        await context.dispatch(async () => { clock.advance(limits.executionBudgetMs); return null; });
        context.recordProgress({ pages: 1, acceptedRows: 1, responseBytes: 8 });
        return { artifact: secondCodec.build(fixtureOverviewDraft('market_short_ratio', context.acceptedAt)),
          attempts: 1, pages: 1, acceptedRows: 1, responseBytes: 8 };
      }, project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }), environment: {} });
    let thirdCalls = 0;
    const thirdCodec = fixtureOverviewCodec('margin_1570', {});
    const third = createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(thirdCodec, root),
      collect: async context => {
        thirdCalls++;
        return { artifact: thirdCodec.build(fixtureOverviewDraft('margin_1570', context.acceptedAt)),
          attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0 };
      }, project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }), environment: {} });
    const service = new MarketDataJobServiceV1({ coordinator, jobRepository: new MarketDataJobRepositoryV1(root),
      overviewRegistry: new OverviewModuleRegistryV1([third, second, first]), limits });
    await service.initialize();
    const accepted = await service.acceptOverview();
    const job = await terminal(service, accepted.jobId);
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => [result.moduleId,
      'failureCode' in result ? result.failureCode : null])).toEqual([
      ['tse_margin_quantities', 'source_entitlement_required'],
      ['market_short_ratio', 'source_timeout'],
      ['margin_1570', 'source_timeout'],
    ]);
    expect(job.progress.attempts).toBe(1);
    expect(thirdCalls).toBe(0);
  });

  test('accepts an infeasible fixed schedule and terminates it without dispatch', async () => {
    const h = await harness({ limits: { ...limits, estimatedMinimumAttempts: 11, maximumAttempts: 11 } });
    const accepted = await h.service.acceptOverview();
    const job = await terminal(h.service, accepted.jobId);
    expect(job.status).toBe('failed');
    expect(job.progress).toMatchObject({ attempts: 0, completedModules: 1, totalModules: 1 });
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'failed',
      failureCode: 'external_schedule_infeasible' });
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  test('an infeasible schedule retains the prior fallback observation and warnings', async () => {
    const h = await harness();
    const first = await h.service.acceptOverview(); await terminal(h.service, first.jobId);
    const newerArtifact = fixtureCodec(false, {}).build(fixtureDraft('2026-09-04T00:01:00.000Z', 1));
    const newer = await h.repository.publish(newerArtifact, {
      jobId: randomUUID(), acceptedAt: newerArtifact.asOfCutoff,
      checkedAt: new Date(Date.parse(newerArtifact.fetchedAt) + 1000).toISOString(),
    });
    await writeFile(join(h.root, newer.observationReceiptIdentity.rootRelativeIdentity), '{broken');

    const clock = environment(); clock.advance(120_000);
    const coordinator = new DashboardJobCoordinatorV1(clock.value, 5);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
      cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
    const service = new MarketDataJobServiceV1({ coordinator,
      jobRepository: new MarketDataJobRepositoryV1(h.root),
      overviewRegistry: new OverviewModuleRegistryV1([h.module]),
      limits: { ...limits, estimatedMinimumAttempts: 11, maximumAttempts: 11 } });
    await service.initialize();
    const accepted = await service.acceptOverview(); const job = await terminal(service, accepted.jobId);
    expect(job.status).toBe('failed');
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'retained_previous',
      failureCode: 'external_schedule_infeasible',
      observationReceiptIdentity: { jobId: first.jobId },
      warningCodes: ['artifact_corrupt_fallback', 'source_refresh_failed'] });
  });

  for (const race of ['schedule infeasible', 'all-source-failed'] as const) {
    test(`${race} terminalization serializes safely with cancellation`, async () => {
      const entered = deferred(); const release = deferred();
      const h = await harness({
        ...(race === 'schedule infeasible'
          ? { limits: { ...limits, estimatedMinimumAttempts: 11, maximumAttempts: 11 } }
          : { sourceFailure: () => 'source_entitlement_required' as const }),
        latestGate: async () => { entered.resolve(); await release.promise; },
      });
      const accepted = await h.service.acceptOverview();
      await entered.promise;
      expect((await h.service.cancelJob(accepted.jobId)).status).toBe(202);
      release.resolve();
      expect((await terminal(h.service, accepted.jobId)).status).toBe('cancelled');
      expect(await h.service.activeJob()).toEqual({ schemaVersion: 'market_data_active_job_v1',
        marketJob: null, blockingKind: null });
      await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
    });
  }

  test('keeps provider rate limiting distinct from the local attempt ceiling', async () => {
    const provider = await harness({ sourceFailure: () => 'source_rate_limited' });
    const providerAccepted = await provider.service.acceptOverview();
    const providerJob = await terminal(provider.service, providerAccepted.jobId);
    if (providerJob.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(providerJob.result.moduleResults[0]).toMatchObject({ failureCode: 'source_rate_limited' });
    expect(providerJob.progress.attempts).toBe(0);

    const local = await harness({ dispatches: limits.maximumAttempts + 1 });
    const localAccepted = await local.service.acceptOverview();
    const localJob = await terminal(local.service, localAccepted.jobId);
    if (localJob.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(localJob.result.moduleResults[0]).toMatchObject({ failureCode: 'source_response_too_large' });
    expect(localJob.progress.attempts).toBe(limits.maximumAttempts);
  });

  test('keeps a rejected maximum-attempt dispatch sticky when the module catches it', async () => {
    const h = await harness({ partial: true, dispatches: limits.maximumAttempts + 1,
      swallowDispatchStop: true });
    const accepted = await h.service.acceptOverview(); const job = await terminal(h.service, accepted.jobId);
    expect(job.progress.attempts).toBe(limits.maximumAttempts);
    expect(h.secondCollects()).toBe(0);
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults.map(result => 'failureCode' in result ? result.failureCode : null))
      .toEqual(['source_response_too_large', 'source_response_too_large']);
    await expect(h.repository.latest()).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  for (const code of ['ENOSYS', 'EXDEV', 'EPERM'] as const) {
    test(`recovers a committed receipt after a post-link ${code} and preserves published state`, async () => {
      const h = await harness({ linkFailure: { moduleId: 'market_short_ratio', active: () => true,
        code, timing: 'after_receipt_link', failFirstProofRead: true } });
      const accepted = await h.service.acceptOverview(); const job = await terminal(h.service, accepted.jobId);
      if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
      expect(job.result.moduleResults[0]).toMatchObject({ state: 'published' });
      expect((await h.repository.latest()).observationReceiptIdentity.jobId).toBe(accepted.jobId);
    });
  }

  test('preserves idempotent reuse when the exact probe recovers a committed receipt', async () => {
    let ambiguous = false;
    const h = await harness({ linkFailure: { moduleId: 'market_short_ratio', active: () => ambiguous,
      code: 'ENOSYS', timing: 'after_receipt_link', failFirstProofRead: true } });
    const first = await h.service.acceptOverview(); await terminal(h.service, first.jobId);
    h.clock.advance(60_000); ambiguous = true;
    const second = await h.service.acceptOverview(); const job = await terminal(h.service, second.jobId);
    if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
    expect(job.result.moduleResults[0]).toMatchObject({ state: 'idempotent_reuse' });
    expect((await h.repository.latest()).observationReceiptIdentity.jobId).toBe(second.jobId);
  });

  test('latches recovery when receipt publication remains unprovable after an exact probe', async () => {
    const h = await harness({ observationProbeFailure: () => true,
      linkFailure: { moduleId: 'market_short_ratio', active: () => true,
        code: 'ENOSYS', timing: 'after_receipt_link', failFirstProofRead: true } });
    const accepted = await h.service.acceptOverview();
    for (let count = 0; count < 100; count++) {
      try { await h.service.activeJob(); }
      catch (error) {
        expect(error).toMatchObject({ reason: 'recovery_required' });
        expect((await new MarketDataJobRepositoryV1(h.root).load(accepted.jobId)).status).toBe('publishing');
        expect((await h.repository.latest()).observationReceiptIdentity.jobId).toBe(accepted.jobId);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error('Ambiguous receipt did not latch recovery.');
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
