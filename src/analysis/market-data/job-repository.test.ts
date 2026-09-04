import { afterEach, describe, expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MarketDataJobRepositoryV1, MarketDataJobRepositoryErrorV1 } from './job-repository.js';
import { MarketDataJobViewV1Schema } from './job-schema.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'dexter-market-jobs-')); roots.push(value); return value; }
function job(id = randomUUID()) {
  return MarketDataJobViewV1Schema.parse({ schemaVersion: 'market_data_job_view_v1', jobId: id,
    kind: 'overview_refresh', target: { kind: 'overview' }, status: 'accepted',
    acceptedAt: '2026-09-04T00:00:00.000Z', startedAt: null, completedAt: null,
    progress: { attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0,
      completedModules: 0, totalModules: 1 }, failure: null, result: null });
}

describe('Market Data native job repository', () => {
  test('creates and replaces only the exact strict native payload', async () => {
    const dir = await root(); const repository = new MarketDataJobRepositoryV1(dir); const initial = job();
    expect((await repository.create(initial)).state).toBe('published');
    expect(await repository.load(initial.jobId)).toEqual(initial);
    expect((await repository.create(initial)).state).toBe('ambiguous');
    const running = MarketDataJobViewV1Schema.parse({ ...initial, status: 'running',
      startedAt: '2026-09-04T00:00:01.000Z' });
    expect((await repository.replace(running)).state).toBe('published');
    expect(await repository.list()).toEqual([running]);
  });

  test('classifies pre-promotion failure separately from every attempted promotion', async () => {
    const before = new MarketDataJobRepositoryV1(await root(), {
      io: { writeFile: async () => { throw new Error('synthetic before promotion'); } },
    });
    expect((await before.create(job())).state).toBe('definitely_not_published');

    const dir = await root();
    const after = new MarketDataJobRepositoryV1(dir, { io: { link: async (source, destination) => {
      await link(source, destination); throw new Error('synthetic after promotion');
    } } });
    const value = job();
    expect((await after.create(value)).state).toBe('ambiguous');
    expect(await new MarketDataJobRepositoryV1(dir).load(value.jobId)).toEqual(value);
  });

  test('fails closed for duplicate JSON, unknown entries, and oversized records', async () => {
    const dir = await root(); const jobs = join(dir, 'jobs'); await mkdir(jobs);
    const id = randomUUID();
    await writeFile(join(jobs, `${id}.json`), `{"schemaVersion":"market_data_job_view_v1","jobId":"${id}","jobId":"${id}"}`);
    await expect(new MarketDataJobRepositoryV1(dir).load(id)).rejects.toBeInstanceOf(MarketDataJobRepositoryErrorV1);
    await rm(join(jobs, `${id}.json`)); await writeFile(join(jobs, 'unknown.txt'), 'x');
    await expect(new MarketDataJobRepositoryV1(dir).list()).rejects.toMatchObject({ code: 'repository_failure' });
    await rm(join(jobs, 'unknown.txt')); await writeFile(join(jobs, `${id}.json`), Buffer.alloc(65_537, 0x20));
    await expect(new MarketDataJobRepositoryV1(dir).load(id)).rejects.toMatchObject({ code: 'repository_failure' });
  });

  test('startup cleanup removes only attributable private job temps', async () => {
    const dir = await root(); const jobs = join(dir, 'jobs'); await mkdir(jobs);
    const attributable = `.job-${randomUUID()}-${randomUUID()}.tmp`;
    const unrelated = `.${randomUUID()}.tmp`;
    await writeFile(join(jobs, attributable), 'private'); await writeFile(join(jobs, unrelated), 'artifact-temp');
    await new MarketDataJobRepositoryV1(dir).cleanup();
    await expect(readFile(join(jobs, attributable))).rejects.toBeDefined();
    expect(await readFile(join(jobs, unrelated), 'utf8')).toBe('artifact-temp');
  });
});
