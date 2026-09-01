import { randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { dexterPath } from '../../utils/paths.js';
import { canonicalJsonV1, type SnapshotDigest } from '../snapshot/canonical-json.js';
import { isStrictGregorianDate, parseAsOfCutoff } from './date.js';
import { StrategyValidationExecutionControlsV1Schema } from './run-artifact.js';
import {
  StrategyValidationDigestSchema,
  StrategyValidationSelectorV1Schema,
  StrategyValidationUuidV4Schema,
} from './artifacts.js';
import { parseStrictJsonBytesV1 } from './strict-json.js';

export const STRATEGY_VALIDATION_JOB_SCHEMA_VERSION = 'strategy_validation_job_v1' as const;
export const STRATEGY_VALIDATION_JOB_VIEW_SCHEMA_VERSION =
  'strategy_validation_job_view_v1' as const;
export const STRATEGY_VALIDATION_JOB_MAX_BYTES = 65_536 as const;

export const STRATEGY_VALIDATION_JOB_STATUSES_V1 = Object.freeze([
  'preparing',
  'collecting',
  'validating',
  'publishing',
  'completed',
  'failed',
  'cancel_requested',
  'cancelled',
  'interrupted',
] as const);

export type StrategyValidationJobStatusV1 =
  (typeof STRATEGY_VALIDATION_JOB_STATUSES_V1)[number];

const terminalStatuses = new Set<StrategyValidationJobStatusV1>([
  'completed', 'failed', 'cancelled', 'interrupted',
]);

const utcInstant = z.string().refine(value => {
  try {
    return parseAsOfCutoff(value) === value;
  } catch {
    return false;
  }
});
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();

export const StrategyValidationJobFailureV1Schema = z.object({
  code: z.enum(['artifact_unavailable', 'internal_failure']),
  message: z.enum([
    'The Strategy-validation artifact is unavailable.',
    'The Strategy-validation job failed.',
  ]),
}).strict();

export const StrategyValidationJobV1Schema = z.object({
  schemaVersion: z.literal(STRATEGY_VALIDATION_JOB_SCHEMA_VERSION),
  jobId: StrategyValidationUuidV4Schema,
  runId: StrategyValidationUuidV4Schema,
  mode: z.enum(['snapshot', 'campaign']),
  inputDigest: StrategyValidationDigestSchema,
  selector: StrategyValidationSelectorV1Schema,
  startedAt: utcInstant,
  acceptedAt: utcInstant,
  executionDeadline: utcInstant,
  executionControls: StrategyValidationExecutionControlsV1Schema,
  status: z.enum(STRATEGY_VALIDATION_JOB_STATUSES_V1),
  createdAt: utcInstant,
  updatedAt: utcInstant,
  finishedAt: utcInstant.nullable(),
  cancellationRequestedAt: utcInstant.nullable(),
  outcomeAsOfSession: z.string().refine(isStrictGregorianDate).nullable(),
  expectedRunPayloadDigest: StrategyValidationDigestSchema.nullable(),
  progress: z.object({
    attemptCount: nonnegativeSafeInteger,
    caseCount: nonnegativeSafeInteger,
  }).strict(),
  failure: StrategyValidationJobFailureV1Schema.nullable(),
}).strict().superRefine((value, context) => {
  const terminal = terminalStatuses.has(value.status);
  if ((terminal && value.finishedAt === null) || (!terminal && value.finishedAt !== null)) {
    context.addIssue({ code: 'custom', message: 'Job terminal timestamp is inconsistent.' });
  }
  if ((value.status === 'publishing' || value.status === 'completed')
    !== (value.expectedRunPayloadDigest !== null)) {
    context.addIssue({ code: 'custom', message: 'Job publication digest is inconsistent.' });
  }
  if ((value.status === 'failed') !== (value.failure !== null)) {
    context.addIssue({ code: 'custom', message: 'Job failure detail is inconsistent.' });
  }
  if ((value.status === 'cancel_requested' || value.status === 'cancelled')
    && value.cancellationRequestedAt === null) {
    context.addIssue({ code: 'custom', message: 'Job cancellation timestamp is inconsistent.' });
  }
  if ((value.mode === 'snapshot') !== (value.selector.mode === 'snapshot')) {
    context.addIssue({ code: 'custom', message: 'Job mode and selector are inconsistent.' });
  }
  if (Date.parse(value.acceptedAt) < Date.parse(value.startedAt)
    || Date.parse(value.executionDeadline) !== Date.parse(value.acceptedAt)
      + value.executionControls.executionBudgetMs
    || Date.parse(value.createdAt) !== Date.parse(value.acceptedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || (value.finishedAt !== null && Date.parse(value.finishedAt) < Date.parse(value.createdAt))
    || (value.cancellationRequestedAt !== null
      && Date.parse(value.cancellationRequestedAt) < Date.parse(value.createdAt))) {
    context.addIssue({ code: 'custom', message: 'Job timestamps are inconsistent.' });
  }
  if (value.progress.attemptCount > value.executionControls.hardMaximumAttempts) {
    context.addIssue({ code: 'custom', message: 'Job attempt count exceeds the hard maximum.' });
  }
});

export type StrategyValidationJobV1 = z.infer<typeof StrategyValidationJobV1Schema>;
export type StrategyValidationJobFailureV1 = z.infer<
  typeof StrategyValidationJobFailureV1Schema
>;

export type StrategyValidationJobViewV1 = Readonly<{
  schemaVersion: typeof STRATEGY_VALIDATION_JOB_VIEW_SCHEMA_VERSION;
  jobId: string;
  runId: string;
  mode: 'snapshot' | 'campaign';
  inputDigest: SnapshotDigest;
  selector: StrategyValidationJobV1['selector'];
  startedAt: string;
  acceptedAt: string;
  executionDeadline: string;
  executionControls: StrategyValidationJobV1['executionControls'];
  status: StrategyValidationJobStatusV1;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  cancellationRequestedAt: string | null;
  outcomeAsOfSession: string | null;
  expectedRunPayloadDigest: SnapshotDigest | null;
  progress: StrategyValidationJobV1['progress'];
  failure: StrategyValidationJobFailureV1 | null;
}>;

export function strategyValidationJobViewV1(
  value: StrategyValidationJobV1,
): StrategyValidationJobViewV1 {
  const job = StrategyValidationJobV1Schema.parse(value);
  return Object.freeze({
    schemaVersion: STRATEGY_VALIDATION_JOB_VIEW_SCHEMA_VERSION,
    jobId: job.jobId,
    runId: job.runId,
    mode: job.mode,
    inputDigest: job.inputDigest as SnapshotDigest,
    selector: Object.freeze({ ...job.selector }),
    startedAt: job.startedAt,
    acceptedAt: job.acceptedAt,
    executionDeadline: job.executionDeadline,
    executionControls: Object.freeze({ ...job.executionControls }),
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    cancellationRequestedAt: job.cancellationRequestedAt,
    outcomeAsOfSession: job.outcomeAsOfSession,
    expectedRunPayloadDigest: job.expectedRunPayloadDigest as SnapshotDigest | null,
    progress: Object.freeze({ ...job.progress }),
    failure: job.failure === null ? null : Object.freeze({ ...job.failure }),
  });
}

const allowedTransitions: Readonly<Record<StrategyValidationJobStatusV1, ReadonlySet<
  StrategyValidationJobStatusV1
>>> = Object.freeze({
  preparing: new Set<StrategyValidationJobStatusV1>([
    'collecting', 'cancel_requested', 'failed', 'interrupted',
  ]),
  collecting: new Set<StrategyValidationJobStatusV1>([
    'validating', 'cancel_requested', 'failed', 'interrupted',
  ]),
  validating: new Set<StrategyValidationJobStatusV1>([
    'publishing', 'cancel_requested', 'failed', 'interrupted',
  ]),
  publishing: new Set<StrategyValidationJobStatusV1>(['completed', 'failed', 'interrupted']),
  completed: new Set<StrategyValidationJobStatusV1>(),
  failed: new Set<StrategyValidationJobStatusV1>(),
  cancel_requested: new Set<StrategyValidationJobStatusV1>([
    'cancelled', 'failed', 'interrupted',
  ]),
  cancelled: new Set<StrategyValidationJobStatusV1>(),
  interrupted: new Set<StrategyValidationJobStatusV1>(),
});

export function isStrategyValidationJobTerminalV1(status: StrategyValidationJobStatusV1): boolean {
  return terminalStatuses.has(status);
}

export function assertStrategyValidationJobTransitionV1(
  from: StrategyValidationJobStatusV1,
  to: StrategyValidationJobStatusV1,
): void {
  if (!allowedTransitions[from].has(to)) {
    throw new StrategyValidationJobRepositoryErrorV1(
      'invalid_transition', 'The Strategy-validation job transition is invalid.',
    );
  }
}

export type StrategyValidationJobRepositoryErrorKindV1 =
  | 'unsafe_job_id'
  | 'missing_job'
  | 'job_id_collision'
  | 'invalid_transition'
  | 'malformed_json'
  | 'schema_validation_failed'
  | 'artifact_corrupt'
  | 'filesystem_error';

export class StrategyValidationJobRepositoryErrorV1 extends Error {
  constructor(
    public readonly kind: StrategyValidationJobRepositoryErrorKindV1,
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'StrategyValidationJobRepositoryErrorV1';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, error => {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  });
}

function canonicalJobId(value: string): string {
  const parsed = StrategyValidationUuidV4Schema.safeParse(value);
  if (!parsed.success) {
    throw new StrategyValidationJobRepositoryErrorV1(
      'unsafe_job_id', 'The Strategy-validation job ID is invalid.',
    );
  }
  return parsed.data;
}

export function createStrategyValidationJobIdV1(): string {
  return randomUUID();
}

export class StrategyValidationJobRepositoryV1 {
  readonly rootDirectory: string;
  readonly jobsDirectory: string;

  constructor(rootDirectory: string = dexterPath('research', 'strategy-validation')) {
    this.rootDirectory = resolve(rootDirectory);
    this.jobsDirectory = resolve(this.rootDirectory, 'jobs');
    this.assertContained(this.jobsDirectory);
  }

  async create(value: StrategyValidationJobV1): Promise<StrategyValidationJobV1> {
    const job = StrategyValidationJobV1Schema.parse(value);
    const path = this.jobPath(job.jobId);
    await this.ensureJobsDirectory();
    const temporaryPath = resolve(
      this.jobsDirectory,
      `.job-${job.jobId}-${randomUUID()}.tmp`,
    );
    this.assertContained(temporaryPath);
    let failure: unknown;
    try {
      await writeFile(temporaryPath, canonicalJsonV1(job), { encoding: 'utf8', flag: 'wx' });
      await this.loadFromPath(temporaryPath, job.jobId);
      await link(temporaryPath, path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        failure = new StrategyValidationJobRepositoryErrorV1(
          'job_id_collision', 'The Strategy-validation job ID already exists.', error,
        );
      } else if (error instanceof StrategyValidationJobRepositoryErrorV1) {
        failure = error;
      } else {
        failure = new StrategyValidationJobRepositoryErrorV1(
          'filesystem_error', 'Could not create the Strategy-validation job.', error,
        );
      }
    }
    try {
      await rm(temporaryPath, { force: true });
    } catch (error) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not clean the temporary Strategy-validation job.', {
          cleanupError: error,
          publicationError: failure,
        },
      );
    }
    if (failure !== undefined) throw failure;
    return this.load(job.jobId);
  }

  async replace(value: StrategyValidationJobV1): Promise<StrategyValidationJobV1> {
    const job = StrategyValidationJobV1Schema.parse(value);
    const path = this.jobPath(job.jobId);
    await this.ensureJobsDirectory();
    if (!await pathExists(path)) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'missing_job', 'The Strategy-validation job was not found.',
      );
    }
    const temporaryPath = resolve(
      this.jobsDirectory,
      `.job-${job.jobId}-${randomUUID()}.tmp`,
    );
    this.assertContained(temporaryPath);
    try {
      await writeFile(temporaryPath, canonicalJsonV1(job), { encoding: 'utf8', flag: 'wx' });
      await this.loadFromPath(temporaryPath, job.jobId);
      await rename(temporaryPath, path);
      return await this.load(job.jobId);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof StrategyValidationJobRepositoryErrorV1) throw error;
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not rewrite the Strategy-validation job.', error,
      );
    }
  }

  async load(jobIdValue: string): Promise<StrategyValidationJobV1> {
    const jobId = canonicalJobId(jobIdValue);
    return this.loadFromPath(this.jobPath(jobId), jobId);
  }

  async list(): Promise<readonly StrategyValidationJobV1[]> {
    await this.ensureJobsDirectory();
    let entries;
    try {
      entries = await readdir(this.jobsDirectory, { withFileTypes: true });
    } catch (error) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not list Strategy-validation jobs.', error,
      );
    }
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && this.isTemporaryJobFile(entry.name)) continue;
      const match = /^([0-9a-f-]+)\.json$/.exec(entry.name);
      if (!entry.isFile() || match === null
        || !StrategyValidationUuidV4Schema.safeParse(match[1]).success) {
        throw new StrategyValidationJobRepositoryErrorV1(
          'artifact_corrupt', 'The Strategy-validation jobs directory contains an invalid entry.',
        );
      }
      ids.push(match[1]!);
    }
    const jobs: StrategyValidationJobV1[] = [];
    for (const id of ids.sort()) jobs.push(await this.load(id));
    return Object.freeze(jobs.sort((left, right) => (
      left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1
        : left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0
    )));
  }

  async cleanupTemporaryFiles(): Promise<void> {
    await this.ensureJobsDirectory();
    try {
      const entries = await readdir(this.jobsDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !this.isTemporaryJobFile(entry.name)) continue;
        await rm(resolve(this.jobsDirectory, entry.name), { force: true });
      }
    } catch (error) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not clean temporary Strategy-validation job files.', error,
      );
    }
  }

  private async loadFromPath(path: string, expectedJobId: string): Promise<StrategyValidationJobV1> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new StrategyValidationJobRepositoryErrorV1(
          'missing_job', 'The Strategy-validation job was not found.', error,
        );
      }
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not read the Strategy-validation job.', error,
      );
    }
    let raw: unknown;
    try {
      raw = parseStrictJsonBytesV1(bytes, STRATEGY_VALIDATION_JOB_MAX_BYTES);
    } catch (error) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'malformed_json', 'The Strategy-validation job JSON is malformed.', error,
      );
    }
    const parsed = StrategyValidationJobV1Schema.safeParse(raw);
    if (!parsed.success) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'schema_validation_failed', 'The Strategy-validation job schema is invalid.', parsed.error,
      );
    }
    if (parsed.data.jobId !== expectedJobId) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'artifact_corrupt', 'The Strategy-validation job identity is inconsistent.',
      );
    }
    return Object.freeze(parsed.data);
  }

  private jobPath(jobId: string): string {
    const path = resolve(this.jobsDirectory, `${canonicalJobId(jobId)}.json`);
    this.assertContained(path);
    return path;
  }

  private isTemporaryJobFile(name: string): boolean {
    return /^\.job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(name);
  }

  private assertContained(target: string): void {
    const difference = relative(this.rootDirectory, target);
    if (difference === '..' || difference.startsWith(`..${sep}`) || resolve(target) === this.rootDirectory) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'unsafe_job_id', 'The Strategy-validation job path escapes its repository.',
      );
    }
  }

  private async ensureJobsDirectory(): Promise<void> {
    try {
      await mkdir(this.jobsDirectory, { recursive: true });
    } catch (error) {
      throw new StrategyValidationJobRepositoryErrorV1(
        'filesystem_error', 'Could not create the Strategy-validation jobs directory.', error,
      );
    }
  }
}
