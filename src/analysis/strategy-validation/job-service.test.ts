import { afterEach, describe, expect, test } from 'bun:test';
import { access, link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comparisonSnapshot } from '../comparison/test-fixtures.js';
import { AnalysisSnapshotRepository, AnalysisSnapshotSchema } from '../snapshot/index.js';
import {
  anchorUnavailableCase,
  snapshotCandidateCase,
  TEST_ACCEPTED_AT,
  TEST_DEADLINE,
  TEST_RUN_ID,
  TEST_STARTED_AT,
  validationRun,
  validationSource,
} from './artifact-test-fixtures.js';
import { StrategyValidationCaseV1Schema } from './artifacts.js';
import { StrategyValidationJobRepositoryV1, StrategyValidationJobV1Schema } from './job-artifact.js';
import {
  STRATEGY_VALIDATION_PREFLIGHT_MAX_ENTRIES,
  STRATEGY_VALIDATION_PREFLIGHT_TTL_MS,
  StrategyValidationJobServiceV1,
} from './job-service.js';
import type { JQuantsExecutionEnvironmentV1 } from './jquants-execution.js';
import { StrategyValidationRunRepositoryV1 } from './run-repository.js';
import { createPointInTimeSourceManifestV1 } from './source-manifest.js';
import { DashboardJobCoordinatorErrorV1 } from '../dashboard-jobs/coordinator.js';

const roots: string[] = [];
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const INPUT_DIGEST = `sha256:${'3'.repeat(64)}`;
const PUBLISHING_DIGEST = `sha256:${'4'.repeat(64)}`;

async function stores() {
  const root = await mkdtemp(join(tmpdir(), 'dexter-strategy-job-service-'));
  roots.push(root);
  return {
    root,
    snapshots: new AnalysisSnapshotRepository(join(root, 'analysis')),
    runs: new StrategyValidationRunRepositoryV1(join(root, 'research'), {
      promoteDirectory: rename,
    }),
    jobs: new StrategyValidationJobRepositoryV1(join(root, 'research')),
  };
}

function environment(initial = '2026-12-01T00:00:00.000Z') {
  let wall = Date.parse(initial);
  let monotonic = 0;
  const value: JQuantsExecutionEnvironmentV1 = Object.freeze({
    fetch: async () => { throw new Error('unexpected external request'); },
    wallNowMs: () => wall,
    monotonicNowMs: () => monotonic,
    sleep: async durationMs => {
      wall += durationMs;
      monotonic += durationMs;
    },
    apiKey: () => undefined,
  });
  return {
    value,
    advance(durationMs: number) {
      wall += durationMs;
      monotonic += durationMs;
    },
  };
}

function persistedJob(
  status: 'preparing' | 'collecting' | 'publishing' | 'completed',
  expectedRunPayloadDigest = PUBLISHING_DIGEST,
  run = validationRun([snapshotCandidateCase(validationSource().digest)]),
) {
  const terminal = status === 'completed';
  return StrategyValidationJobV1Schema.parse({
    schemaVersion: 'strategy_validation_job_v1',
    jobId: JOB_ID,
    runId: TEST_RUN_ID,
    mode: 'snapshot',
    inputDigest: INPUT_DIGEST,
    selector: run.selector,
    startedAt: run.startedAt,
    acceptedAt: run.acceptedAt,
    executionDeadline: run.executionDeadline,
    executionControls: run.execution.controls,
    status,
    createdAt: TEST_ACCEPTED_AT,
    updatedAt: terminal ? '2025-04-01T00:00:03.000Z' : '2025-04-01T00:00:02.000Z',
    finishedAt: terminal ? '2025-04-01T00:00:03.000Z' : null,
    cancellationRequestedAt: null,
    outcomeAsOfSession: run.outcomeAsOfSession,
    expectedRunPayloadDigest: status === 'publishing' || status === 'completed'
      ? expectedRunPayloadDigest
      : null,
    progress: {
      attemptCount: run.execution.attemptCount,
      caseCount: run.caseReferences.length,
    },
    failure: null,
  });
}

async function publishFixture(runs: StrategyValidationRunRepositoryV1) {
  const seedSource = validationSource();
  const seed = anchorUnavailableCase(seedSource.digest, {
    caseId: '77777777-7777-4777-8777-777777777777',
    ticker: '7203',
    anchorDate: '2025-01-02',
  });
  const snapshot = snapshotCandidateCase(seedSource.digest);
  const item = StrategyValidationCaseV1Schema.parse({
    ...seed,
    mode: 'snapshot',
    confidence: 'precommitted',
    selector: snapshot.selector,
    candidateGenerationPolicy: null,
    unavailableReason: 'strategy_data_date_invalid',
    outcomeAsOfSession: null,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: null,
      sources: [],
    }),
  });
  const run = validationRun([item]);
  const published = await runs.publish({ run, cases: [item], sources: [] });
  return { ...published, run };
}

async function localSnapshot(snapshots: AnalysisSnapshotRepository) {
  const snapshot = AnalysisSnapshotSchema.parse({
    ...comparisonSnapshot('2026-08-22T01:00:00.000Z'),
    strategy: null,
  });
  return snapshots.save(snapshot);
}

async function waitForTerminal(service: StrategyValidationJobServiceV1, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await service.getJob(jobId);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await Bun.sleep(5);
  }
  throw new Error('job did not become terminal');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Strategy-validation Dashboard job service', () => {
  test('definitely-unpublished create preserves preflight; retry publishes and enqueues exactly once', async () => {
    const store = await stores(); const clock = environment(); const saved = await localSnapshot(store.snapshots);
    let fail = true; let queues = 0;
    const jobs = new StrategyValidationJobRepositoryV1(store.jobs.rootDirectory, { io: {
      writeFile: async (...args) => { if (fail) throw new Error('before promotion'); return writeFile(...args); },
    } });
    const service = new StrategyValidationJobServiceV1({ snapshotRepository: store.snapshots, runRepository: store.runs,
      jobRepository: jobs, executionEnvironment: clock.value, marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      enqueue: work => { queues++; queueMicrotask(work); } });
    const preflight = await service.createPreflight({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId });
    await expect(service.acceptPreflight(preflight.preflightId, true)).rejects.toMatchObject({ reason: 'publication_failed' });
    expect(await service.activeJob()).toBeNull(); expect(await jobs.list()).toEqual([]); expect(queues).toBe(0);
    fail = false;
    const accepted = await service.acceptPreflight(preflight.preflightId, true);
    expect((await waitForTerminal(service, accepted.job.jobId)).status).toBe('completed'); expect(queues).toBe(1);
    await expect(service.acceptPreflight(preflight.preflightId, true)).rejects.toMatchObject({ kind: 'preflight_consumed' });
  });

  test('uncertain create cannot dispatch or consume/reuse a preflight; restart interrupts the actual saved job', async () => {
    const store = await stores(); const clock = environment(); const saved = await localSnapshot(store.snapshots); let queues = 0;
    const jobs = new StrategyValidationJobRepositoryV1(store.jobs.rootDirectory, { io: {
      link: async (...args) => { await link(...args); throw new Error('after actual link'); },
    } });
    const options = { snapshotRepository: store.snapshots, runRepository: store.runs,
      jobRepository: jobs, executionEnvironment: clock.value, marketDataJobsDirectory: join(store.root, 'market-data', 'jobs') };
    const service = new StrategyValidationJobServiceV1({ ...options, enqueue: () => { queues++; } });
    const preflight = await service.createPreflight({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId });
    await expect(service.acceptPreflight(preflight.preflightId, true)).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(queues).toBe(0); const [savedJob] = await store.jobs.list(); expect(savedJob.status).toBe('preparing');
    await expect(service.getJob(savedJob.jobId)).rejects.toMatchObject({ reason: 'recovery_required' });
    await expect(service.acceptPreflight(preflight.preflightId, true)).rejects.toMatchObject({ reason: 'recovery_required' });
    const restarted = new StrategyValidationJobServiceV1({ ...options, jobRepository: store.jobs });
    await restarted.initialize(); expect((await restarted.getJob(savedJob.jobId)).status).toBe('interrupted');
    await expect(service.activeJob()).rejects.toMatchObject({ reason: 'recovery_required' });
  });

  test('unpublished cancellation replacement latches and late queued worker performs no further writes', async () => {
    const store = await stores(); const clock = environment(); const saved = await localSnapshot(store.snapshots);
    let work: (() => void) | undefined; let writes = 0;
    const jobs = new StrategyValidationJobRepositoryV1(store.jobs.rootDirectory, { io: {
      writeFile: async (...args) => { writes++; if (writes > 1) throw new Error('cancel write failed'); return writeFile(...args); },
    } });
    const service = new StrategyValidationJobServiceV1({ snapshotRepository: store.snapshots, runRepository: store.runs,
      jobRepository: jobs, executionEnvironment: clock.value, marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      enqueue: callback => { work = callback; } });
    const preflight = await service.createPreflight({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId });
    const accepted = await service.acceptPreflight(preflight.preflightId, true);
    await expect(service.cancelJob(accepted.job.jobId)).rejects.toMatchObject({ reason: 'recovery_required' });
    work!(); await Bun.sleep(10);
    expect(writes).toBe(2); expect((await store.jobs.load(accepted.job.jobId)).status).toBe('preparing');
    await expect(service.activeJob()).rejects.toMatchObject({ reason: 'recovery_required' });
  });

  test('post-terminal-rename read failure remains blocked; a fresh process preserves completed and its exact run', async () => {
    const store = await stores(); const clock = environment(); const saved = await localSnapshot(store.snapshots);
    let failRead = false;
    const jobs = new StrategyValidationJobRepositoryV1(store.jobs.rootDirectory, { io: {
      rename: async (from, to) => {
        const payload = JSON.parse(await readFile(from, 'utf8'));
        await rename(from, to); if (payload.status === 'completed') failRead = true;
      },
      readFile: ((...args: Parameters<typeof readFile>) => {
        if (failRead) throw new Error('read after completed rename'); return readFile(...args);
      }) as typeof readFile,
    } });
    const options = { snapshotRepository: store.snapshots, runRepository: store.runs,
      executionEnvironment: clock.value, marketDataJobsDirectory: join(store.root, 'market-data', 'jobs') };
    const service = new StrategyValidationJobServiceV1({ ...options, jobRepository: jobs });
    const preflight = await service.createPreflight({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId });
    const accepted = await service.acceptPreflight(preflight.preflightId, true);
    for (let i = 0; i < 200 && !failRead; i++) await Bun.sleep(5);
    expect(failRead).toBe(true); await Bun.sleep(10);
    expect((await store.jobs.load(accepted.job.jobId)).status).toBe('completed');
    failRead = false;
    expect((await service.getJob(accepted.job.jobId)).status).toBe('completed');
    await expect(service.activeJob()).rejects.toMatchObject({ reason: 'recovery_required' });
    const restarted = new StrategyValidationJobServiceV1({ ...options, jobRepository: store.jobs });
    await restarted.initialize(); expect((await restarted.getJob(accepted.job.jobId)).status).toBe('completed');
    expect((await restarted.loadRun(accepted.job.runId)).run.runId).toBe(accepted.job.runId);
  });

  test('a nonempty unimplemented Market Data slot prevents Phase 4 startup rewrites', async () => {
    const store = await stores(); const original = persistedJob('collecting'); await store.jobs.create(original);
    const marketJobs = join(store.root, 'market-data', 'jobs'); await mkdir(marketJobs, { recursive: true });
    await writeFile(join(marketJobs, 'unknown-record.json'), '{}');
    const service = new StrategyValidationJobServiceV1({ snapshotRepository: store.snapshots, runRepository: store.runs,
      jobRepository: store.jobs, marketDataJobsDirectory: marketJobs });
    await expect(service.initialize()).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(await store.jobs.load(original.jobId)).toEqual(original);
    expect(await readFile(join(marketJobs, 'unknown-record.json'), 'utf8')).toBe('{}');
  });

  test('accepts a one-time local preflight and completes one validated immutable run', async () => {
    const store = await stores();
    const clock = environment();
    const saved = await localSnapshot(store.snapshots);
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      executionEnvironment: clock.value,
    });
    const preflight = await service.createPreflight({
      mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
    });
    expect(preflight.estimatedMinimumAttempts).toBe(0);
    expect(preflight.expiresAt).toBe('2026-12-01T00:10:00.000Z');

    const accepted = await service.acceptPreflight(preflight.preflightId, true);
    await expect(service.acceptPreflight(preflight.preflightId, true)).rejects.toMatchObject({
      kind: 'preflight_consumed',
    });
    const completed = await waitForTerminal(service, accepted.job.jobId);
    expect(completed.status).toBe('completed');
    expect(completed.runId).toBe(accepted.job.runId);
    expect(completed.expectedRunPayloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await store.runs.load(completed.runId)).run.selector).toEqual(completed.selector);
    expect(await service.activeJob()).toBeNull();

    const restarted = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      executionEnvironment: clock.value,
    });
    await restarted.initialize();
    expect(await restarted.getJob(completed.jobId)).toEqual(completed);
  });

  test('expires process-memory preflights and enforces one global active job', async () => {
    const store = await stores();
    const clock = environment();
    const saved = await localSnapshot(store.snapshots);
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      executionEnvironment: clock.value,
    });
    await service.initialize();
    const expired = await service.createPreflight({
      mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
    });
    clock.advance(STRATEGY_VALIDATION_PREFLIGHT_TTL_MS);
    await expect(service.acceptPreflight(expired.preflightId, true)).rejects.toMatchObject({
      kind: 'preflight_expired',
    });

    const active = persistedJob('preparing');
    await store.jobs.create(active);
    const fresh = await service.createPreflight({
      mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
    });
    await expect(service.acceptPreflight(fresh.preflightId, true)).rejects.toMatchObject({
      reason: 'recovery_required', // unexpected durable job has no healthy in-process owner
    });
  });

  test('never evicts a successful unexpired preflight at the bounded-capacity edge', async () => {
    const store = await stores();
    const clock = environment();
    const saved = await localSnapshot(store.snapshots);
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      executionEnvironment: clock.value,
    });
    const preflights = [];
    for (let index = 0; index < STRATEGY_VALIDATION_PREFLIGHT_MAX_ENTRIES; index += 1) {
      preflights.push(await service.createPreflight({
        mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
      }));
    }
    expect(new Set(preflights.map(value => value.preflightId)).size)
      .toBe(STRATEGY_VALIDATION_PREFLIGHT_MAX_ENTRIES);
    await expect(service.createPreflight({
      mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
    })).rejects.toMatchObject({ kind: 'internal_failure' });

    for (const preflight of preflights) {
      const accepted = await service.acceptPreflight(preflight.preflightId, true);
      expect((await waitForTerminal(service, accepted.job.jobId)).status).toBe('completed');
    }
  }, 30_000);

  test('reconciles collecting crashes as interrupted and post-promotion crashes as completed', async () => {
    {
      const store = await stores();
      await store.jobs.create(persistedJob('collecting'));
      const service = new StrategyValidationJobServiceV1({
        snapshotRepository: store.snapshots,
        runRepository: store.runs,
        jobRepository: store.jobs,
        marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      });
      await service.initialize();
      expect((await store.jobs.load(JOB_ID)).status).toBe('interrupted');
      expect(await store.runs.hasRun(TEST_RUN_ID)).toBeFalse();
    }
    {
      const store = await stores();
      const published = await publishFixture(store.runs);
      await store.jobs.create(persistedJob(
        'publishing', published.runPayloadDigest, published.run,
      ));
      const service = new StrategyValidationJobServiceV1({
        snapshotRepository: store.snapshots,
        runRepository: store.runs,
        jobRepository: store.jobs,
        marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      });
      await service.initialize();
      const completed = await store.jobs.load(JOB_ID);
      expect(completed.status).toBe('completed');
      expect(completed.expectedRunPayloadDigest).toBe(published.runPayloadDigest);
    }
  });

  test('reconciles a publishing crash before promotion as interrupted and cleans its temp run', async () => {
    const store = await stores();
    const temporaryDirectory = join(
      store.runs.runsDirectory,
      `.run-${TEST_RUN_ID}-88888888-8888-4888-8888-888888888888.tmp`,
    );
    await mkdir(temporaryDirectory, { recursive: true });
    await store.jobs.create(persistedJob('publishing'));

    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
    });
    await service.initialize();

    expect((await store.jobs.load(JOB_ID)).status).toBe('interrupted');
    expect(await store.runs.hasRun(TEST_RUN_ID)).toBeFalse();
    await expect(access(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await service.listRuns()).toEqual([]);
  });

  test('retains a suspect promoted run and marks its publishing job failed', async () => {
    const store = await stores();
    const published = await publishFixture(store.runs);
    await store.jobs.create(persistedJob('publishing', PUBLISHING_DIGEST, published.run));
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
    });
    await expect(service.initialize()).rejects.toBeInstanceOf(DashboardJobCoordinatorErrorV1);
    expect((await store.jobs.load(JOB_ID))).toMatchObject({
      status: 'failed',
      failure: { code: 'artifact_unavailable' },
    });
    expect(await store.runs.hasRun(TEST_RUN_ID)).toBeTrue();
    const restarted = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
    });
    await restarted.initialize();
    await expect(restarted.listRuns()).rejects.toMatchObject({
      kind: 'artifact_unavailable',
    });
  });

  test('rejects schema-valid publishing and completed metadata tampering', async () => {
    {
      const store = await stores();
      const published = await publishFixture(store.runs);
      const publishing = persistedJob('publishing', published.runPayloadDigest, published.run);
      await store.jobs.create(StrategyValidationJobV1Schema.parse({
        ...publishing,
        progress: {
          ...publishing.progress,
          caseCount: publishing.progress.caseCount + 1,
        },
      }));
      const service = new StrategyValidationJobServiceV1({
        snapshotRepository: store.snapshots,
        runRepository: store.runs,
        jobRepository: store.jobs,
        marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
      });
      await expect(service.initialize()).rejects.toMatchObject({
        reason: 'recovery_required',
      });
      expect(await store.jobs.load(publishing.jobId)).toMatchObject({
        status: 'failed',
        failure: { code: 'artifact_unavailable' },
      });
    }

    const store = await stores();
    const published = await publishFixture(store.runs);
    const completed = persistedJob('completed', published.runPayloadDigest, published.run);
    await store.jobs.create(completed);
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
      marketDataJobsDirectory: join(store.root, 'market-data', 'jobs'),
    });
    await service.initialize();

    const variants = [
      StrategyValidationJobV1Schema.parse({
        ...completed,
        outcomeAsOfSession: '2025-03-28',
      }),
      StrategyValidationJobV1Schema.parse({
        ...completed,
        progress: {
          ...completed.progress,
          attemptCount: completed.progress.attemptCount + 1,
        },
      }),
      StrategyValidationJobV1Schema.parse({
        ...completed,
        progress: {
          ...completed.progress,
          caseCount: completed.progress.caseCount + 1,
        },
      }),
    ];
    for (const tampered of variants) {
      await store.jobs.replace(tampered);
      await expect(service.getJob(completed.jobId)).rejects.toMatchObject({
        reason: 'recovery_required',
      });
      await store.jobs.replace(completed);
    }
  });
});
