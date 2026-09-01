import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
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
  StrategyValidationJobServiceErrorV1,
  StrategyValidationJobServiceV1,
} from './job-service.js';
import type { JQuantsExecutionEnvironmentV1 } from './jquants-execution.js';
import { StrategyValidationRunRepositoryV1 } from './run-repository.js';
import { createPointInTimeSourceManifestV1 } from './source-manifest.js';

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
  test('accepts a one-time local preflight and completes one validated immutable run', async () => {
    const store = await stores();
    const clock = environment();
    const saved = await localSnapshot(store.snapshots);
    const service = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
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
      kind: 'active_job_conflict',
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
    });
    await expect(service.initialize()).rejects.toBeInstanceOf(StrategyValidationJobServiceErrorV1);
    expect((await store.jobs.load(JOB_ID))).toMatchObject({
      status: 'failed',
      failure: { code: 'artifact_unavailable' },
    });
    expect(await store.runs.hasRun(TEST_RUN_ID)).toBeTrue();
    const restarted = new StrategyValidationJobServiceV1({
      snapshotRepository: store.snapshots,
      runRepository: store.runs,
      jobRepository: store.jobs,
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
      });
      await expect(service.initialize()).rejects.toMatchObject({
        kind: 'artifact_unavailable',
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
        kind: 'artifact_unavailable',
      });
      await store.jobs.replace(completed);
    }
  });
});
