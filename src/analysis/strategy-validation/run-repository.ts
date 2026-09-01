import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { dexterPath } from '../../utils/paths.js';
import { canonicalJsonV1, type CanonicalJsonValue, type SnapshotDigest } from '../snapshot/canonical-json.js';
import {
  aggregateStrategyValidationCasesV1,
  type StrategyValidationRequestedAnchorV1,
} from './aggregation.js';
import {
  compareStrategyValidationCasesV1,
  digestStrategyValidationCaseV1,
  strategyValidationOutcomeHorizonDatesV1,
  strategyValidationOutcomeSessionFactsV1,
  strategyValidationOutcomeTickDatesV1,
  STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
  StrategyValidationCaseV1Schema,
  STRATEGY_VALIDATION_UUID_V4_PATTERN,
  type StrategyValidationCandidateCaseV1,
  type StrategyValidationCaseV1,
} from './artifacts.js';
import {
  digestStrategyValidationRunV1,
  StrategyValidationRunV1Schema,
  type StrategyValidationRunV1,
} from './run-artifact.js';
import {
  POINT_IN_TIME_SOURCE_ENVELOPE_VERSION,
  validatePointInTimeSourceEnvelopeV1,
  type PointInTimeSourceEnvelopeV1,
} from './source-envelope.js';
import {
  sourceManifestDigestsV1,
  validateStrategyValidationSourceBindingV1,
  validateStrategyValidationSourceCompletenessV1,
  type BoundStrategyValidationSourceV1,
} from './source-manifest.js';
import { parseStrictJsonBytesV1 } from './strict-json.js';

export type StrategyValidationRunRepositoryErrorKindV1 =
  | 'unsafe_run_id'
  | 'unsafe_case_id'
  | 'missing_run'
  | 'missing_case'
  | 'run_id_collision'
  | 'malformed_json'
  | 'unsupported_version'
  | 'schema_validation_failed'
  | 'identity_mismatch'
  | 'digest_mismatch'
  | 'artifact_incomplete'
  | 'artifact_corrupt'
  | 'publish_unsupported'
  | 'filesystem_error'
  | 'cleanup_failed';

export class StrategyValidationRunRepositoryErrorV1 extends Error {
  constructor(
    public readonly kind: StrategyValidationRunRepositoryErrorKindV1,
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'StrategyValidationRunRepositoryErrorV1';
  }
}

export type PromoteStrategyValidationRunDirectoryV1 = (
  temporaryDirectory: string,
  finalDirectory: string,
) => Promise<void>;

export type StrategyValidationRunPublicationV1 = Readonly<{
  run: StrategyValidationRunV1;
  cases: readonly StrategyValidationCaseV1[];
  sources: readonly PointInTimeSourceEnvelopeV1[];
}>;

export type StrategyValidationRunPublishOptionsV1 = Readonly<{
  assertCanPromote?: () => void;
  beforePromote?: (prepared: Readonly<{
    runId: string;
    runPayloadDigest: SnapshotDigest;
  }>) => void | Promise<void>;
}>;

export type LoadedStrategyValidationRunV1 = StrategyValidationRunPublicationV1 & Readonly<{
  runPayloadDigest: SnapshotDigest;
}>;

export interface StrategyValidationRunRepositoryOptionsV1 {
  readonly promoteDirectory?: PromoteStrategyValidationRunDirectoryV1;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, error => {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  });
}

async function defaultPromoteDirectory(
  temporaryDirectory: string,
  finalDirectory: string,
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new StrategyValidationRunRepositoryErrorV1(
      'publish_unsupported',
      'Atomic no-replace run publication is not supported on this platform.',
    );
  }
  await rename(temporaryDirectory, finalDirectory);
}

function assertUuid(value: string, kind: 'run' | 'case'): string {
  if (!STRATEGY_VALIDATION_UUID_V4_PATTERN.test(value)) {
    throw new StrategyValidationRunRepositoryErrorV1(
      kind === 'run' ? 'unsafe_run_id' : 'unsafe_case_id',
      `Unsafe Strategy-validation ${kind} ID.`,
    );
  }
  return value;
}

function parseJson(bytes: Uint8Array, source: string): unknown {
  try {
    return parseStrictJsonBytesV1(bytes, Number.MAX_SAFE_INTEGER);
  } catch (error) {
    throw new StrategyValidationRunRepositoryErrorV1(
      'malformed_json', `Strategy-validation JSON is malformed: ${source}.`, error,
    );
  }
}

export function createStrategyValidationRunIdV1(): string {
  return randomUUID();
}

export function createStrategyValidationCaseIdV1(): string {
  return randomUUID();
}

export class StrategyValidationRunRepositoryV1 {
  readonly rootDirectory: string;
  readonly runsDirectory: string;
  private readonly promoteDirectory: PromoteStrategyValidationRunDirectoryV1;

  constructor(
    rootDirectory: string = dexterPath('research', 'strategy-validation'),
    options: StrategyValidationRunRepositoryOptionsV1 = {},
  ) {
    this.rootDirectory = resolve(rootDirectory);
    this.runsDirectory = resolve(this.rootDirectory, 'runs');
    this.assertContained(this.runsDirectory);
    this.promoteDirectory = options.promoteDirectory ?? defaultPromoteDirectory;
  }

  async publish(
    rawPublication: StrategyValidationRunPublicationV1,
    options: StrategyValidationRunPublishOptionsV1 = {},
  ): Promise<Readonly<{
    state: 'created';
    runId: string;
    runPayloadDigest: SnapshotDigest;
  }>> {
    const publication = this.validatePublication(rawPublication);
    const runId = assertUuid(publication.run.runId, 'run');
    const finalDirectory = this.runDirectory(runId);
    await this.ensureRunsDirectory();
    if (await pathExists(finalDirectory)) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'run_id_collision', 'The reserved Strategy-validation run ID already exists.',
      );
    }
    const temporaryDirectory = resolve(
      this.runsDirectory,
      `.run-${runId}-${randomUUID()}.tmp`,
    );
    this.assertContained(temporaryDirectory);
    let promoted = false;
    let promotionGuardFailed = false;
    let failure: unknown;
    try {
      await mkdir(temporaryDirectory);
      await mkdir(resolve(temporaryDirectory, 'cases'));
      await mkdir(resolve(temporaryDirectory, 'sources'));
      await this.writePublication(temporaryDirectory, publication);
      const reread = await this.loadFromDirectory(temporaryDirectory, runId, 'temporary run');
      this.assertEqualPublication(publication, reread);
      try {
        options.assertCanPromote?.();
        await options.beforePromote?.(Object.freeze({
          runId,
          runPayloadDigest: reread.runPayloadDigest,
        }));
      } catch (error) {
        promotionGuardFailed = true;
        throw error;
      }
      try {
        await this.promoteDirectory(temporaryDirectory, finalDirectory);
        promoted = true;
      } catch (error) {
        if (error instanceof StrategyValidationRunRepositoryErrorV1) throw error;
        if (isNodeError(error) && ['EEXIST', 'ENOTEMPTY'].includes(error.code ?? '')) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'run_id_collision', 'The reserved Strategy-validation run ID already exists.', error,
          );
        }
        if (isNodeError(error) && ['EXDEV', 'ENOSYS'].includes(error.code ?? '')) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'publish_unsupported', 'Atomic no-replace run publication is unavailable.', error,
          );
        }
        if (await pathExists(finalDirectory).catch(() => false)) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'run_id_collision', 'The reserved Strategy-validation run ID already exists.', error,
          );
        }
        throw error;
      }
      const final = await this.loadFromDirectory(finalDirectory, runId, 'published run');
      this.assertEqualPublication(publication, final);
      return Object.freeze({
        state: 'created', runId, runPayloadDigest: final.runPayloadDigest,
      });
    } catch (error) {
      failure = error;
    }

    if (!promoted) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'cleanup_failed', 'Could not clean the temporary run directory.', {
            cleanupError,
            publicationError: failure,
          },
        );
      }
    }
    if (failure instanceof StrategyValidationRunRepositoryErrorV1) throw failure;
    if (promotionGuardFailed) throw failure;
    throw new StrategyValidationRunRepositoryErrorV1(
      'filesystem_error', 'Could not publish the Strategy-validation run.', failure,
    );
  }

  async load(runIdValue: string): Promise<LoadedStrategyValidationRunV1> {
    const runId = assertUuid(runIdValue, 'run');
    return this.loadFromDirectory(this.runDirectory(runId), runId, `run ${runId}`);
  }

  async loadCase(runIdValue: string, caseIdValue: string): Promise<StrategyValidationCaseV1> {
    const runId = assertUuid(runIdValue, 'run');
    const caseId = assertUuid(caseIdValue, 'case');
    const loaded = await this.load(runId);
    const result = loaded.cases.find(value => value.caseId === caseId);
    if (result === undefined) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'missing_case', 'The Strategy-validation case does not exist in the selected run.',
      );
    }
    return result;
  }

  async list(): Promise<readonly LoadedStrategyValidationRunV1[]> {
    await this.ensureRunsDirectory();
    let entries;
    try {
      entries = await readdir(this.runsDirectory, { withFileTypes: true });
    } catch (error) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', 'Could not list Strategy-validation runs.', error,
      );
    }
    const runIds: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && this.isTemporaryRunDirectory(entry.name)) continue;
      if (!entry.isDirectory() || !STRATEGY_VALIDATION_UUID_V4_PATTERN.test(entry.name)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_corrupt', 'The Strategy-validation runs directory contains an invalid entry.',
        );
      }
      runIds.push(entry.name);
    }
    const loaded: LoadedStrategyValidationRunV1[] = [];
    for (const runId of runIds.sort()) loaded.push(await this.load(runId));
    return Object.freeze(loaded.sort((left, right) => (
      (right.run.completedAt < left.run.completedAt
        ? -1 : right.run.completedAt > left.run.completedAt ? 1 : 0)
      || (left.run.runId < right.run.runId ? -1 : left.run.runId > right.run.runId ? 1 : 0)
    )));
  }

  async hasRun(runIdValue: string): Promise<boolean> {
    const runId = assertUuid(runIdValue, 'run');
    try {
      return await pathExists(this.runDirectory(runId));
    } catch (error) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', 'Could not inspect the Strategy-validation run.', error,
      );
    }
  }

  async cleanupTemporaryRun(runIdValue: string): Promise<void> {
    const runId = assertUuid(runIdValue, 'run');
    await this.ensureRunsDirectory();
    let entries;
    try {
      entries = await readdir(this.runsDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !this.isTemporaryRunDirectory(entry.name, runId)) continue;
        const target = resolve(this.runsDirectory, entry.name);
        this.assertContained(target);
        await rm(target, { recursive: true, force: true });
      }
    } catch (error) {
      if (error instanceof StrategyValidationRunRepositoryErrorV1) throw error;
      throw new StrategyValidationRunRepositoryErrorV1(
        'cleanup_failed', 'Could not clean the temporary run directory.', error,
      );
    }
  }

  private validatePublication(
    raw: StrategyValidationRunPublicationV1,
  ): StrategyValidationRunPublicationV1 {
    const runResult = StrategyValidationRunV1Schema.safeParse(raw.run);
    if (!runResult.success) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'schema_validation_failed', 'The Strategy-validation run schema is invalid.',
      );
    }
    const cases = raw.cases.map(value => {
      const parsed = StrategyValidationCaseV1Schema.safeParse(value);
      if (!parsed.success) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'schema_validation_failed', 'A Strategy-validation case schema is invalid.',
        );
      }
      return parsed.data;
    });
    const sources = raw.sources.map(value => {
      try {
        return validatePointInTimeSourceEnvelopeV1(value);
      } catch (error) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'schema_validation_failed', 'A Strategy-validation source envelope is invalid.', error,
        );
      }
    });
    const publication = Object.freeze({
      run: runResult.data,
      cases: Object.freeze(cases.sort(compareStrategyValidationCasesV1)),
      sources: Object.freeze(sources.sort((left, right) => (
        left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0
      ))),
    });
    this.validateInternalReferences(publication);
    return publication;
  }

  private validateInternalReferences(publication: StrategyValidationRunPublicationV1): void {
    const { run } = publication;
    const sortedCases = [...publication.cases].sort(compareStrategyValidationCasesV1);
    if (sortedCases.length !== run.caseReferences.length) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'artifact_incomplete', 'Run case-reference count does not match its cases.',
      );
    }
    for (let index = 0; index < sortedCases.length; index += 1) {
      const value = sortedCases[index]!;
      const reference = run.caseReferences[index]!;
      if (value.caseId !== reference.caseId
        || digestStrategyValidationCaseV1(value) !== reference.caseDigest
        || value.runId !== run.runId
        || value.mode !== run.mode
        || value.confidence !== run.confidence
        || value.startedAt !== run.startedAt
        || value.outcomeAsOfSession !== run.outcomeAsOfSession
        || canonicalJsonV1(value.selector as CanonicalJsonValue)
          !== canonicalJsonV1(run.selector as CanonicalJsonValue)
        || canonicalJsonV1(value.versions as CanonicalJsonValue)
          !== canonicalJsonV1(run.versions as CanonicalJsonValue)
        || value.candidateGenerationPolicy !== run.candidateGenerationPolicy
        || !run.aggregationScope.tickers.includes(value.ticker)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'identity_mismatch', 'A case does not match its run identity or reference.',
        );
      }
    }
    const sourceByDigest = new Map<string, PointInTimeSourceEnvelopeV1>(
      publication.sources.map(source => [source.digest, source]),
    );
    if (sourceByDigest.size !== publication.sources.length) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'identity_mismatch', 'Source envelope digests must be unique within a run.',
      );
    }
    const referencedSources = new Set(sortedCases.flatMap(value => (
      sourceManifestDigestsV1(value.sourceManifest)
    )));
    if (referencedSources.size !== sourceByDigest.size
      || [...referencedSources].some(digest => !sourceByDigest.has(digest))) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'artifact_incomplete', 'Run source envelopes do not exactly match case references.',
      );
    }
    if (run.mode === 'campaign') {
      const planningDigests = sortedCases.map(value => value.sourceManifest.sources.filter(
        reference => reference.role === 'outcome_calendar',
      ));
      if (planningDigests.some(references => references.length !== 1)
        || new Set(planningDigests.map(references => references[0]!.digest)).size !== 1) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_incomplete', 'Campaign cases do not share one planning calendar.',
        );
      }
    }
    if (run.outcomeAsOfSession === null) {
      const casesAreSourceFreeLocal = sortedCases.every(value => (
        value.sourceManifest.sources.length === 0
      ));
      const executionIsSourceFreeLocal = run.mode === 'snapshot'
        && run.execution.controls.estimatedMinimumAttempts === 0
        && run.execution.attemptCount === 0
        && run.execution.cacheHitCount === 0;
      if (casesAreSourceFreeLocal !== executionIsSourceFreeLocal) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_incomplete',
          'Null-boundary case evidence does not match the recorded execution stage.',
        );
      }
    }
    for (const source of publication.sources) {
      const ticker = source.request.ticker;
      if (ticker !== null && !run.aggregationScope.tickers.includes(ticker)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'identity_mismatch', 'A source envelope ticker is outside the run scope.',
        );
      }
    }
    for (const value of sortedCases) {
      const bindings: BoundStrategyValidationSourceV1[] = [];
      for (const reference of value.sourceManifest.sources) {
        const source = sourceByDigest.get(reference.digest);
        if (source === undefined) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'artifact_incomplete', 'A case source manifest references a missing envelope.',
          );
        }
        try {
          validateStrategyValidationSourceBindingV1(reference, source, {
            mode: value.mode,
            caseKind: value.caseKind,
            ticker: value.ticker,
            anchorDate: value.anchorDate,
            decisionDate: value.decisionDate,
            strategyDataDate: value.strategyDataDate,
            initialTickDate: value.caseKind === 'candidate'
              ? value.tickEvidence.effectiveDate
              : null,
            startedAt: value.startedAt,
            outcomeAsOfSession: value.outcomeAsOfSession,
          });
        } catch (error) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'identity_mismatch', 'A case source manifest does not match its envelope.', error,
          );
        }
        bindings.push({ reference, envelope: source });
      }
      if (value.outcomeAsOfSession === null) {
        if (value.sourceManifest.sources.length === 0) continue;
        const calendarIncomplete = value.caseKind === 'anchor_unavailable'
          && value.unavailableReason === 'calendar_incomplete'
          && bindings.length === 1
          && bindings[0]!.reference.role === 'candidate_calendar'
          && bindings[0]!.envelope.result.state === 'unavailable'
          && bindings[0]!.envelope.result.reason === 'calendar_incomplete';
        if (!calendarIncomplete) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'artifact_incomplete',
            'A null outcome boundary lacks exact local or calendar-incomplete evidence.',
          );
        }
        continue;
      }
      try {
        validateStrategyValidationSourceCompletenessV1(bindings, {
          mode: value.mode,
          caseKind: value.caseKind,
          ticker: value.ticker,
          anchorDate: value.anchorDate,
          decisionDate: value.decisionDate,
          strategyDataDate: value.strategyDataDate,
          initialTickDate: value.caseKind === 'candidate'
            ? value.tickEvidence.effectiveDate
            : null,
          startedAt: value.startedAt,
          outcomeAsOfSession: value.outcomeAsOfSession,
          entryWaitSessions: value.entryWaitSessions,
          holdingSessions: value.holdingSessions,
          unavailableReason: value.caseKind === 'anchor_unavailable'
            ? value.unavailableReason
            : null,
          candidate: value.caseKind === 'candidate' ? value.candidate : null,
          persistedOutcome: value.caseKind === 'candidate' ? value.outcome : null,
          initialTickEvidence: value.caseKind === 'candidate'
            ? {
              effectiveDate: value.tickEvidence.effectiveDate,
              category: value.tickEvidence.category,
              unavailableReason: value.tickEvidence.unavailableReason,
              levels: {
                entry: {
                  price: value.candidate.entry.price,
                  ...value.tickEvidence.levels.entry,
                },
                stop: {
                  price: value.candidate.stop.price,
                  ...value.tickEvidence.levels.stop,
                },
                target: {
                  price: value.candidate.target.price,
                  ...value.tickEvidence.levels.target,
                },
              },
            }
            : null,
          outcome: value.caseKind === 'candidate'
            ? {
              kind: value.outcome.kind,
              unavailableReason: value.outcome.kind === 'unavailable'
                ? value.outcome.reason
                : null,
              evaluationEndDate: value.outcome.evaluationEndDate,
              tickEvidenceDates: strategyValidationOutcomeTickDatesV1(value.outcome),
              sessionFacts: strategyValidationOutcomeSessionFactsV1(value.outcome),
              horizonDates: strategyValidationOutcomeHorizonDatesV1(value.outcome),
              terminalCompletionDate: value.outcome.kind === 'stop_hit'
                || value.outcome.kind === 'target_hit'
                ? value.outcome.exitFill.date
                : null,
            }
            : null,
        });
      } catch (error) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_incomplete', 'A case source manifest is incomplete for its result.', error,
        );
      }
    }
    const requestedAnchors: StrategyValidationRequestedAnchorV1[] = [];
    const seenAnchors = new Set<string>();
    for (const value of sortedCases) {
      const identity = `${value.ticker}\u0000${value.anchorDate}`;
      if (!seenAnchors.has(identity)) {
        seenAnchors.add(identity);
        requestedAnchors.push({ ticker: value.ticker, anchorDate: value.anchorDate });
      }
    }
    const recomputed = aggregateStrategyValidationCasesV1(
      run.aggregationScope,
      requestedAnchors,
      sortedCases,
    );
    if (canonicalJsonV1(recomputed as CanonicalJsonValue)
      !== canonicalJsonV1(run.aggregation as CanonicalJsonValue)) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'digest_mismatch', 'Persisted aggregation does not match the referenced cases.',
      );
    }
  }

  private async writePublication(
    directory: string,
    publication: StrategyValidationRunPublicationV1,
  ): Promise<void> {
    await writeFile(
      resolve(directory, 'run.json'),
      canonicalJsonV1(publication.run as CanonicalJsonValue),
      { encoding: 'utf8', flag: 'wx' },
    );
    for (const value of publication.cases) {
      await writeFile(
        resolve(directory, 'cases', `${value.caseId}.json`),
        canonicalJsonV1(value as CanonicalJsonValue),
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    for (const source of publication.sources) {
      await writeFile(
        resolve(directory, 'sources', `${source.digest.slice('sha256:'.length)}.json`),
        canonicalJsonV1(source as CanonicalJsonValue),
        { encoding: 'utf8', flag: 'wx' },
      );
    }
  }

  private async loadFromDirectory(
    directory: string,
    runId: string,
    source: string,
  ): Promise<LoadedStrategyValidationRunV1> {
    try {
      await this.assertRealPathContained(directory);
      const expectedRootEntries = ['cases', 'run.json', 'sources'];
      const rootEntries = (await readdir(directory)).sort();
      if (JSON.stringify(rootEntries) !== JSON.stringify(expectedRootEntries)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_corrupt', `Run directory shape is invalid: ${source}.`,
        );
      }
      const casesDirectory = resolve(directory, 'cases');
      const sourcesDirectory = resolve(directory, 'sources');
      const runPath = resolve(directory, 'run.json');
      await Promise.all([
        this.assertRealPathContained(casesDirectory),
        this.assertRealPathContained(sourcesDirectory),
        this.assertRealPathContained(runPath),
      ]);
      const runRaw = parseJson(await readFile(runPath), `${source}/run.json`);
      if (typeof runRaw === 'object' && runRaw !== null && 'schemaVersion' in runRaw
        && (runRaw as { schemaVersion?: unknown }).schemaVersion !== 'strategy_validation_run_v1') {
        throw new StrategyValidationRunRepositoryErrorV1(
          'unsupported_version', `Run version is unsupported: ${source}.`,
        );
      }
      const runResult = StrategyValidationRunV1Schema.safeParse(runRaw);
      if (!runResult.success) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'schema_validation_failed', `Run schema is invalid: ${source}.`,
        );
      }
      const run = runResult.data;
      if (run.runId !== runId) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'identity_mismatch', `Run identity does not match its directory: ${source}.`,
        );
      }
      const caseFiles = (await readdir(casesDirectory)).sort();
      const expectedCaseFiles = [...run.caseReferences]
        .map(reference => `${reference.caseId}.json`)
        .sort();
      if (JSON.stringify(caseFiles) !== JSON.stringify(expectedCaseFiles)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_incomplete', `Run case files do not match run.json: ${source}.`,
        );
      }
      const cases: StrategyValidationCaseV1[] = [];
      for (const filename of caseFiles) {
        const casePath = resolve(casesDirectory, filename);
        await this.assertRealPathContained(casePath);
        const caseRaw = parseJson(
          await readFile(casePath),
          `${source}/cases/${filename}`,
        );
        if (typeof caseRaw === 'object' && caseRaw !== null && 'schemaVersion' in caseRaw
          && (caseRaw as { schemaVersion?: unknown }).schemaVersion
            !== STRATEGY_VALIDATION_CASE_SCHEMA_VERSION) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'unsupported_version', `Case version is unsupported: ${source}/${filename}.`,
          );
        }
        const parsed = StrategyValidationCaseV1Schema.safeParse(caseRaw);
        if (!parsed.success) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'schema_validation_failed', `Case schema is invalid: ${source}/${filename}.`,
          );
        }
        if (`${parsed.data.caseId}.json` !== filename) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'identity_mismatch', `Case identity does not match its filename: ${source}/${filename}.`,
          );
        }
        cases.push(parsed.data);
      }
      const referenced = new Set(cases.flatMap(value => (
        sourceManifestDigestsV1(value.sourceManifest)
      )));
      const sourceFiles = (await readdir(sourcesDirectory)).sort();
      const expectedSourceFiles = [...referenced]
        .map(digest => `${digest.slice('sha256:'.length)}.json`)
        .sort();
      if (JSON.stringify(sourceFiles) !== JSON.stringify(expectedSourceFiles)) {
        throw new StrategyValidationRunRepositoryErrorV1(
          'artifact_incomplete', `Run source files do not match case references: ${source}.`,
        );
      }
      const sources: PointInTimeSourceEnvelopeV1[] = [];
      for (const filename of sourceFiles) {
        const sourcePath = resolve(sourcesDirectory, filename);
        await this.assertRealPathContained(sourcePath);
        const raw = parseJson(
          await readFile(sourcePath),
          `${source}/sources/${filename}`,
        );
        if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
          && (raw as { schemaVersion?: unknown }).schemaVersion
            !== POINT_IN_TIME_SOURCE_ENVELOPE_VERSION) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'unsupported_version', `Source version is unsupported: ${source}/${filename}.`,
          );
        }
        let envelope;
        try {
          envelope = validatePointInTimeSourceEnvelopeV1(raw);
        } catch (error) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'schema_validation_failed', `Source envelope is invalid: ${source}/${filename}.`, error,
          );
        }
        if (`${envelope.digest.slice('sha256:'.length)}.json` !== filename) {
          throw new StrategyValidationRunRepositoryErrorV1(
            'digest_mismatch', `Source digest does not match its filename: ${source}/${filename}.`,
          );
        }
        sources.push(envelope);
      }
      const publication = this.validatePublication({ run, cases, sources });
      return Object.freeze({
        ...publication,
        runPayloadDigest: digestStrategyValidationRunV1(publication.run),
      });
    } catch (error) {
      if (error instanceof StrategyValidationRunRepositoryErrorV1) throw error;
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new StrategyValidationRunRepositoryErrorV1(
          'missing_run', `Strategy-validation run not found: ${source}.`, error,
        );
      }
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', `Could not load Strategy-validation artifacts: ${source}.`, error,
      );
    }
  }

  private assertEqualPublication(
    expected: StrategyValidationRunPublicationV1,
    actual: LoadedStrategyValidationRunV1,
  ): void {
    if (canonicalJsonV1(expected as unknown as CanonicalJsonValue)
      !== canonicalJsonV1({
        run: actual.run,
        cases: actual.cases,
        sources: actual.sources,
      } as CanonicalJsonValue)) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'digest_mismatch', 'Reread Strategy-validation artifacts differ from publication input.',
      );
    }
  }

  private runDirectory(runId: string): string {
    const directory = resolve(this.runsDirectory, runId);
    this.assertContained(directory);
    return directory;
  }

  private isTemporaryRunDirectory(name: string, runId?: string): boolean {
    const match = /^\.run-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/.exec(name);
    return match !== null && (runId === undefined || match[1] === runId);
  }

  private assertContained(target: string): void {
    const rel = relative(this.rootDirectory, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', 'Resolved Strategy-validation path is outside its repository root.',
      );
    }
  }

  private async ensureRunsDirectory(): Promise<void> {
    try {
      await mkdir(this.runsDirectory, { recursive: true });
      await this.assertRealPathContained(this.runsDirectory);
    } catch (error) {
      if (error instanceof StrategyValidationRunRepositoryErrorV1) throw error;
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', 'Could not initialize the Strategy-validation repository.', error,
      );
    }
  }

  private async assertRealPathContained(target: string): Promise<void> {
    const [realRoot, realTarget] = await Promise.all([
      realpath(this.rootDirectory),
      realpath(target),
    ]);
    const rel = relative(realRoot, realTarget);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new StrategyValidationRunRepositoryErrorV1(
        'filesystem_error', 'Resolved Strategy-validation path escapes its real repository root.',
      );
    }
  }
}
