import { afterEach, describe, expect, test } from 'bun:test';
import { link, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertStrategyValidationJobTransitionV1,
  StrategyValidationJobRepositoryErrorV1,
  StrategyValidationJobRepositoryV1,
  STRATEGY_VALIDATION_JOB_STATUSES_V1,
  StrategyValidationJobV1Schema,
  strategyValidationJobViewV1,
  type StrategyValidationJobStatusV1,
} from './job-artifact.js';
import { planJQuantsExecutionV1 } from './jquants-execution.js';
import { TEST_SNAPSHOT_DIGEST, TEST_SNAPSHOT_ID } from './artifact-test-fixtures.js';

const roots: string[] = [];
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const INPUT_DIGEST = `sha256:${'3'.repeat(64)}`;
const EXPECTED_DIGEST = `sha256:${'4'.repeat(64)}`;

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'dexter-strategy-job-'));
  roots.push(root);
  return new StrategyValidationJobRepositoryV1(root);
}

function job(status: StrategyValidationJobStatusV1 = 'preparing') {
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
  const cancellation = status === 'cancel_requested' || status === 'cancelled';
  return StrategyValidationJobV1Schema.parse({
    schemaVersion: 'strategy_validation_job_v1',
    jobId: JOB_ID,
    runId: RUN_ID,
    mode: 'snapshot',
    inputDigest: INPUT_DIGEST,
    selector: {
      mode: 'snapshot',
      snapshotId: TEST_SNAPSHOT_ID,
      snapshotSchemaVersion: 9,
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
    },
    startedAt: '2025-04-01T00:00:00.000Z',
    acceptedAt: '2025-04-01T00:00:01.000Z',
    executionDeadline: '2025-04-01T01:30:01.000Z',
    executionControls: planJQuantsExecutionV1(1, 5),
    status,
    createdAt: '2025-04-01T00:00:01.000Z',
    updatedAt: terminal ? '2025-04-01T00:00:03.000Z' : '2025-04-01T00:00:02.000Z',
    finishedAt: terminal ? '2025-04-01T00:00:03.000Z' : null,
    cancellationRequestedAt: cancellation ? '2025-04-01T00:00:02.000Z' : null,
    outcomeAsOfSession: status === 'preparing' ? null : '2025-03-31',
    expectedRunPayloadDigest: status === 'publishing' || status === 'completed'
      ? EXPECTED_DIGEST
      : null,
    progress: { attemptCount: status === 'preparing' ? 0 : 1, caseCount: 1 },
    failure: status === 'failed'
      ? { code: 'internal_failure', message: 'The Strategy-validation job failed.' }
      : null,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Strategy-validation mutable job artifact', () => {
  test.each(['before-promotion', 'after-link', 'cleanup', 'final-read', 'payload-mismatch', 'invalid-json', 'wrong-id'] as const)('create outcome proves the promotion boundary: %s', async fault => {
    const healthy = await repository();
    let promoted = false;
    const failing = new StrategyValidationJobRepositoryV1(healthy.rootDirectory, { io: {
      writeFile: async (...args) => { if (fault === 'before-promotion') throw new Error('private failure'); return writeFile(...args); },
      link: async (from, to) => {
        await link(from, to); promoted = true;
        if (fault === 'after-link') throw new Error('after actual promotion');
        if (fault === 'payload-mismatch') await writeFile(to, JSON.stringify({ ...job(), progress: { attemptCount: 0, caseCount: 2 } }));
        if (fault === 'invalid-json') await writeFile(to, '{');
        if (fault === 'wrong-id') await writeFile(to, JSON.stringify({ ...job(), jobId: RUN_ID }));
      },
      rm: async (...args) => { if (fault === 'cleanup' && promoted) throw new Error('private cleanup'); return rm(...args); },
      readFile: ((...args: Parameters<typeof readFile>) => {
        if (fault === 'final-read' && promoted) throw new Error('private read');
        return readFile(...args);
      }) as typeof readFile,
    } });
    expect(await failing.createWithOutcome(job())).toEqual({ state: fault === 'before-promotion' ? 'definitely_not_published' : 'ambiguous' });
    const names = await readdir(healthy.jobsDirectory);
    expect(names.includes(`${JOB_ID}.json`)).toBe(fault !== 'before-promotion');
    if (fault === 'cleanup') expect(names.some(name => name.endsWith('.tmp'))).toBe(true);
    if (fault === 'after-link' || fault === 'cleanup' || fault === 'final-read') expect(await healthy.load(JOB_ID)).toEqual(job());
  });

  test.each(['collecting', 'cancel_requested', 'completed'] as const)('replace %s after rename/read failure is ambiguous and retains actual final payload', async status => {
    const healthy = await repository(); await healthy.create(job());
    let promoted = false;
    const failing = new StrategyValidationJobRepositoryV1(healthy.rootDirectory, { io: {
      rename: async (from, to) => { await rename(from, to); promoted = true; },
      readFile: ((...args: Parameters<typeof readFile>) => {
        if (promoted) throw new Error('post-rename read failure');
        return readFile(...args);
      }) as typeof readFile,
    } });
    expect(await failing.replaceWithOutcome(job(status))).toEqual({ state: 'ambiguous' });
    expect(await healthy.load(JOB_ID)).toEqual(job(status));
  });

  test('definitely-unpublished replacement leaves the previous full payload; collision never adopts existing', async () => {
    const healthy = await repository(); await healthy.create(job());
    const failing = new StrategyValidationJobRepositoryV1(healthy.rootDirectory, { io: {
      writeFile: async () => { throw new Error('before promotion'); },
    } });
    expect(await failing.replaceWithOutcome(job('collecting'))).toEqual({ state: 'definitely_not_published' });
    expect(await healthy.load(JOB_ID)).toEqual(job());
    expect(await healthy.createWithOutcome(job())).toEqual({ state: 'ambiguous' });
    expect(await healthy.load(JOB_ID)).toEqual(job());
  });

  test('read-only inventory does not create absent storage and byte/identity corruption is not skipped', async () => {
    const healthy = await repository();
    expect(await healthy.list()).toEqual([]);
    expect(await readdir(healthy.rootDirectory)).toEqual([]);
    await healthy.create(job());
    await writeFile(join(healthy.jobsDirectory, `${JOB_ID}.json`), ' '.repeat(65_537));
    await expect(healthy.list()).rejects.toBeInstanceOf(StrategyValidationJobRepositoryErrorV1);
  });

  test('creates, strictly rereads, atomically replaces, and exposes only the safe view', async () => {
    const store = await repository();
    const created = await store.create(job());
    expect(created.status).toBe('preparing');

    const collecting = StrategyValidationJobV1Schema.parse({
      ...created,
      status: 'collecting',
      updatedAt: '2025-04-01T00:00:02.000Z',
      outcomeAsOfSession: '2025-03-31',
      progress: { attemptCount: 1, caseCount: 1 },
    });
    expect((await store.replace(collecting)).status).toBe('collecting');
    expect((await store.list()).map(value => value.jobId)).toEqual([JOB_ID]);

    const view = strategyValidationJobViewV1(collecting);
    expect(view.schemaVersion).toBe('strategy_validation_job_view_v1');
    expect(JSON.stringify(view)).not.toContain(store.rootDirectory);
    expect(JSON.stringify(view)).not.toContain('JQUANTS_API_KEY');
  });

  test('rejects collisions, unsafe IDs, corrupt JSON, and invalid lifecycle combinations', async () => {
    const store = await repository();
    await store.create(job());
    await expect(store.create(job())).rejects.toMatchObject({ kind: 'job_id_collision' });
    await expect(store.load('../job')).rejects.toMatchObject({ kind: 'unsafe_job_id' });

    await writeFile(join(store.jobsDirectory, `${JOB_ID}.json`), '{"jobId":"duplicate","jobId":"x"}', 'utf8');
    await expect(store.load(JOB_ID)).rejects.toBeInstanceOf(StrategyValidationJobRepositoryErrorV1);
    expect(StrategyValidationJobV1Schema.safeParse({
      ...job(),
      status: 'completed',
      finishedAt: null,
      expectedRunPayloadDigest: EXPECTED_DIGEST,
    }).success).toBeFalse();
  });

  test('accepts only the documented lifecycle transitions', () => {
    const allowed = new Set([
      'preparing:collecting', 'preparing:cancel_requested', 'preparing:failed',
      'preparing:interrupted', 'collecting:validating', 'collecting:cancel_requested',
      'collecting:failed', 'collecting:interrupted', 'validating:publishing',
      'validating:cancel_requested', 'validating:failed', 'validating:interrupted',
      'publishing:completed', 'publishing:failed', 'publishing:interrupted',
      'cancel_requested:cancelled', 'cancel_requested:failed',
      'cancel_requested:interrupted',
    ]);
    for (const status of STRATEGY_VALIDATION_JOB_STATUSES_V1) {
      expect(() => job(status)).not.toThrow();
    }
    for (const from of STRATEGY_VALIDATION_JOB_STATUSES_V1) {
      for (const to of STRATEGY_VALIDATION_JOB_STATUSES_V1) {
        const transition = () => assertStrategyValidationJobTransitionV1(from, to);
        if (allowed.has(`${from}:${to}`)) expect(transition).not.toThrow();
        else expect(transition).toThrow(StrategyValidationJobRepositoryErrorV1);
      }
    }
  });
});
