import { randomUUID } from 'node:crypto';
import { link, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dexterPath } from '../../utils/paths.js';
import { canonicalJsonV1 } from '../snapshot/canonical-json.js';
import type { JobWriteOutcomeV1 } from '../dashboard-jobs/coordinator.js';
import { StrategyValidationUuidV4Schema } from '../strategy-validation/artifacts.js';
import { MarketDataFilesV1, nodeErrorCode } from './repository-files.js';
import { MarketDataRepositoryErrorV1 } from './contracts.js';
import { assertMarketDataJobReplacementV1, MARKET_DATA_JOB_MAX_BYTES_V1,
  MarketDataJobViewV1Schema, type MarketDataJobViewV1 } from './job-schema.js';

export class MarketDataJobRepositoryErrorV1 extends Error {
  constructor(readonly code: 'missing_job' | 'invalid_job' | 'repository_failure') { super(code); }
}
const tempPattern = /^\.job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
type JobIO = Pick<typeof import('node:fs/promises'), 'writeFile' | 'link' | 'rename' | 'rm'>;

/** Native Market Data payload only. The shared coordinator owns mutation ordering. */
export class MarketDataJobRepositoryV1 {
  readonly jobsDirectory: string;
  private readonly files: MarketDataFilesV1;
  private readonly io: JobIO;
  private readonly readRecord: (path: string) => Promise<unknown>;
  constructor(root = dexterPath('market-data'), options: {
    io?: Partial<JobIO>; readRecord?: (path: string) => Promise<unknown>;
  } = {}) {
    this.files = new MarketDataFilesV1(root);
    this.jobsDirectory = this.files.path('jobs');
    this.io = { writeFile, link, rename, rm, ...options.io };
    this.readRecord = options.readRecord ?? (path => this.files.read(path, undefined, MARKET_DATA_JOB_MAX_BYTES_V1));
  }
  private path(id: string) {
    if (!StrategyValidationUuidV4Schema.safeParse(id).success) throw new MarketDataJobRepositoryErrorV1('invalid_job');
    return this.files.path(`jobs/${id}.json`);
  }
  async load(id: string): Promise<MarketDataJobViewV1> { return this.read(this.path(id), id); }
  private async read(path: string, id: string): Promise<MarketDataJobViewV1> {
    try {
      if (!await this.files.directory(this.jobsDirectory)) throw new MarketDataJobRepositoryErrorV1('missing_job');
      const raw = await this.readRecord(path);
      const job = MarketDataJobViewV1Schema.parse(raw);
      if (job.jobId !== id) throw new Error('Invalid identity.');
      return job;
    } catch (error) {
      if (error instanceof MarketDataJobRepositoryErrorV1) throw error;
      if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_not_found') {
        throw new MarketDataJobRepositoryErrorV1('missing_job');
      }
      throw new MarketDataJobRepositoryErrorV1(nodeErrorCode(error) === 'ENOENT' ? 'missing_job' : 'repository_failure');
    }
  }
  async list(): Promise<MarketDataJobViewV1[]> {
    try {
      if (!await this.files.directory(this.jobsDirectory)) return [];
      const entries = await readdir(this.jobsDirectory, { withFileTypes: true });
      const jobs: MarketDataJobViewV1[] = [];
      for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid job entry.');
        if (tempPattern.test(entry.name)) continue;
        if (!entry.name.endsWith('.json')) throw new Error('Invalid filename.');
        jobs.push(await this.load(entry.name.slice(0, -5)));
      }
      return jobs;
    } catch { throw new MarketDataJobRepositoryErrorV1('repository_failure'); }
  }
  async cleanup(): Promise<void> {
    try {
      if (!await this.files.directory(this.jobsDirectory)) return;
      for (const entry of await readdir(this.jobsDirectory, { withFileTypes: true })) {
        if (entry.isFile() && !entry.isSymbolicLink() && tempPattern.test(entry.name)) {
          await this.io.rm(resolve(this.jobsDirectory, entry.name), { force: true });
        }
      }
    } catch { throw new MarketDataJobRepositoryErrorV1('repository_failure'); }
  }
  create(job: MarketDataJobViewV1): Promise<JobWriteOutcomeV1<MarketDataJobViewV1>> { return this.write(job, false); }
  replace(job: MarketDataJobViewV1): Promise<JobWriteOutcomeV1<MarketDataJobViewV1>> { return this.write(job, true); }
  private async write(raw: MarketDataJobViewV1, replace: boolean): Promise<JobWriteOutcomeV1<MarketDataJobViewV1>> {
    let attemptedPromotion = false, owned = false;
    let temporary: string | undefined;
    try {
      const job = MarketDataJobViewV1Schema.parse(raw), payload = canonicalJsonV1(job);
      if (Buffer.byteLength(payload, 'utf8') > MARKET_DATA_JOB_MAX_BYTES_V1) throw new Error('Job too large.');
      const path = this.path(job.jobId);
      await this.files.directory(this.jobsDirectory, true);
      if (replace) assertMarketDataJobReplacementV1(await this.load(job.jobId), job);
      temporary = resolve(this.jobsDirectory, `.job-${job.jobId}-${randomUUID()}.tmp`);
      await this.io.writeFile(temporary, payload, { encoding: 'utf8', flag: 'wx' }); owned = true;
      if (canonicalJsonV1(await this.read(temporary, job.jobId)) !== payload) throw new Error('Invalid temporary payload.');
      if (!await this.files.directory(this.jobsDirectory)) throw new Error('Missing directory.');
      attemptedPromotion = true;
      if (replace) await this.io.rename(temporary, path); else await this.io.link(temporary, path);
      await this.io.rm(temporary, { force: true }); owned = false;
      const record = await this.load(job.jobId);
      if (canonicalJsonV1(record) !== payload) throw new Error('Mismatched final payload.');
      return { state: 'published', record };
    } catch {
      if (owned && temporary && !attemptedPromotion) await this.io.rm(temporary, { force: true }).catch(() => undefined);
      return { state: attemptedPromotion ? 'ambiguous' : 'definitely_not_published' };
    }
  }
}
