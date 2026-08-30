import { mkdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { dexterPath } from '../../utils/paths.js';
import {
  canonicalJsonV1,
  digestValidatedAnalysisSnapshot,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../snapshot/canonical-json.js';
import {
  CreateOnlyFilePublicationError,
  publishCreateOnlyFile,
  type CreateOnlyLinkFile,
} from '../snapshot/create-only-file.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { validatePersistedEvaluationFindingsV1 } from './findings.js';
import { digestEvidenceManifestV1, validateEvidenceManifestV1 } from './manifest.js';
import {
  EvaluationIdV1Schema,
  EvaluationSidecarV1Schema,
  type ArtifactInputEnvelopeV1,
  type EvaluationSidecarV1,
} from './schema.js';

export type EvaluationRepositoryErrorKind =
  | 'unsafe_ticker'
  | 'unsafe_snapshot_id'
  | 'unsafe_evaluation_id'
  | 'missing_evaluation'
  | 'malformed_json'
  | 'unsupported_version'
  | 'schema_validation_failed'
  | 'evaluation_identity_mismatch'
  | 'target_snapshot_mismatch'
  | 'manifest_digest_mismatch'
  | 'artifact_input_digest_mismatch'
  | 'evaluation_id_collision'
  | 'create_only_publish_unsupported'
  | 'filesystem_error';

export class EvaluationRepositoryError extends Error {
  readonly kind: EvaluationRepositoryErrorKind;
  readonly causeValue: unknown;

  constructor(kind: EvaluationRepositoryErrorKind, message: string, causeValue?: unknown) {
    super(message);
    this.name = 'EvaluationRepositoryError';
    this.kind = kind;
    this.causeValue = causeValue;
  }
}

export interface EvaluationRepositoryOptions {
  readonly snapshotRepository?: AnalysisSnapshotRepository;
  readonly linkFile?: CreateOnlyLinkFile;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function assertTicker(value: string): string {
  const parsed = CanonicalTickerSchema.safeParse(value);
  if (!parsed.success) {
    throw new EvaluationRepositoryError('unsafe_ticker', 'Unsafe Evaluation ticker.', parsed.error);
  }
  return parsed.data;
}

function assertSnapshotId(value: string): string {
  const parsed = SnapshotIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new EvaluationRepositoryError(
      'unsafe_snapshot_id', 'Unsafe Evaluation Snapshot ID.', parsed.error,
    );
  }
  return parsed.data;
}

function assertEvaluationId(value: string): string {
  const parsed = EvaluationIdV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new EvaluationRepositoryError(
      'unsafe_evaluation_id', 'Unsafe Evaluation ID.', parsed.error,
    );
  }
  return parsed.data;
}

export function artifactInputEnvelopeV1(sidecar: EvaluationSidecarV1): ArtifactInputEnvelopeV1 {
  return {
    kind: 'dexter_evaluator_input',
    version: 1,
    snapshotDigest: sidecar.target.snapshotDigest,
    evidenceManifestDigest: sidecar.evidenceManifestDigest,
    evaluatorSchemaVersion: sidecar.evaluatorSchemaVersion,
    evidenceManifestVersion: sidecar.evidenceManifestVersion,
    rubricVersion: sidecar.rubricVersion,
    promptVersion: sidecar.promptVersion,
    safetyPolicyVersion: sidecar.safetyPolicyVersion,
    qualityGateId: sidecar.qualityGateId,
    gateManifestDigest: sidecar.gateManifestDigest as `sha256:${string}`,
    gateAttestationDigest: sidecar.gateAttestationDigest as `sha256:${string}`,
    evaluatorSourceDigest: sidecar.evaluatorSourceDigest as `sha256:${string}`,
    gateEvaluatedCommitSha: sidecar.gateEvaluatedCommitSha,
    executionEnvironment: sidecar.executionEnvironment,
    runtime: {
      providerId: sidecar.runtime.providerId,
      modelId: sidecar.runtime.modelId,
      reasoningEffort: sidecar.runtime.reasoningEffort,
      providerBoundary: sidecar.runtime.providerBoundary,
    },
  };
}

export function digestArtifactInputV1(sidecar: EvaluationSidecarV1): `sha256:${string}` {
  return sha256CanonicalJsonV1(
    artifactInputEnvelopeV1(sidecar) as CanonicalJsonValue,
  );
}

function parseSidecarJson(contents: string, source: string): EvaluationSidecarV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    throw new EvaluationRepositoryError(
      'malformed_json', `Evaluation sidecar contains malformed JSON: ${source}`, error,
    );
  }
  if (
    raw !== null
    && typeof raw === 'object'
    && 'version' in raw
    && (raw as { version?: unknown }).version !== 1
  ) {
    throw new EvaluationRepositoryError(
      'unsupported_version', `Unsupported Evaluation sidecar version: ${source}`,
    );
  }
  const parsed = EvaluationSidecarV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new EvaluationRepositoryError(
      'schema_validation_failed', `Evaluation sidecar schema validation failed: ${source}`,
      parsed.error,
    );
  }
  return parsed.data as EvaluationSidecarV1;
}

export class EvaluationRepository {
  readonly rootDirectory: string;
  private readonly snapshotRepository: AnalysisSnapshotRepository;
  private readonly linkFile: CreateOnlyLinkFile | undefined;

  constructor(
    rootDirectory: string = dexterPath('evaluations'),
    options: EvaluationRepositoryOptions = {},
  ) {
    this.rootDirectory = resolve(rootDirectory);
    this.snapshotRepository = options.snapshotRepository ?? new AnalysisSnapshotRepository();
    this.linkFile = options.linkFile;
  }

  async save(rawSidecar: unknown): Promise<'created'> {
    const parsed = EvaluationSidecarV1Schema.safeParse(rawSidecar);
    if (!parsed.success) {
      throw new EvaluationRepositoryError(
        'schema_validation_failed', 'Evaluation sidecar schema validation failed.', parsed.error,
      );
    }
    const sidecar = parsed.data as EvaluationSidecarV1;
    const ticker = assertTicker(sidecar.target.canonicalTicker);
    const snapshotId = assertSnapshotId(sidecar.target.snapshotId);
    const evaluationId = assertEvaluationId(sidecar.evaluationId);
    await this.validateSidecar(sidecar, ticker, snapshotId, evaluationId);

    const directory = this.resolveEvaluationDirectory(ticker, snapshotId);
    const finalPath = this.resolveEvaluationPath(ticker, snapshotId, evaluationId);
    try {
      await mkdir(directory, { recursive: true });
      await this.assertRealPathContained(directory);
      const result = await publishCreateOnlyFile({
        finalPath,
        canonicalPayload: canonicalJsonV1(sidecar as CanonicalJsonValue),
        assertTemporaryPath: temporaryPath => this.assertContained(temporaryPath),
        validateTemporary: async temporaryPath => {
          const temporary = await this.readSidecar(temporaryPath, 'temporary Evaluation sidecar');
          await this.validateSidecar(temporary, ticker, snapshotId, evaluationId);
        },
        resolveExisting: async () => {
          throw new EvaluationRepositoryError(
            'evaluation_id_collision', 'The Evaluation ID already exists.',
          );
        },
        linkFile: this.linkFile,
      });
      if (result !== 'created') {
        throw new EvaluationRepositoryError('filesystem_error', 'Unexpected publication result.');
      }
      return 'created';
    } catch (error) {
      if (error instanceof EvaluationRepositoryError) throw error;
      if (
        error instanceof CreateOnlyFilePublicationError
        && error.kind === 'publish_unsupported'
      ) {
        throw new EvaluationRepositoryError(
          'create_only_publish_unsupported',
          'Create-only Evaluation publication is not supported by this filesystem.',
          error,
        );
      }
      throw new EvaluationRepositoryError(
        'filesystem_error', 'Could not publish Evaluation sidecar.', error,
      );
    }
  }

  async load(tickerValue: string, snapshotIdValue: string, evaluationIdValue: string): Promise<EvaluationSidecarV1> {
    const ticker = assertTicker(tickerValue);
    const snapshotId = assertSnapshotId(snapshotIdValue);
    const evaluationId = assertEvaluationId(evaluationIdValue);
    const path = this.resolveEvaluationPath(ticker, snapshotId, evaluationId);
    const sidecar = await this.readSidecar(path, `${ticker}/${snapshotId}/${evaluationId}.json`);
    await this.validateSidecar(sidecar, ticker, snapshotId, evaluationId);
    return sidecar;
  }

  private async validateSidecar(
    sidecar: EvaluationSidecarV1,
    ticker: string,
    snapshotId: string,
    evaluationId: string,
  ): Promise<void> {
    if (
      sidecar.target.canonicalTicker !== ticker
      || sidecar.target.snapshotId !== snapshotId
      || sidecar.evaluationId !== evaluationId
    ) {
      throw new EvaluationRepositoryError(
        'evaluation_identity_mismatch', 'Evaluation identity does not match its repository path.',
      );
    }
    const manifest = validateEvidenceManifestV1(sidecar.evidenceManifest);
    if (digestEvidenceManifestV1(manifest) !== sidecar.evidenceManifestDigest) {
      throw new EvaluationRepositoryError(
        'manifest_digest_mismatch', 'Stored Evidence manifest digest does not match.',
      );
    }
    if (digestArtifactInputV1(sidecar) !== sidecar.artifactInputDigest) {
      throw new EvaluationRepositoryError(
        'artifact_input_digest_mismatch', 'Stored Evaluator input digest does not match.',
      );
    }
    let snapshot;
    try {
      snapshot = await this.snapshotRepository.loadHistory(ticker, snapshotId);
    } catch (error) {
      throw new EvaluationRepositoryError(
        'target_snapshot_mismatch', 'The target Snapshot could not be verified.', error,
      );
    }
    if (
      snapshot.canonicalTicker !== ticker
      || snapshot.generatedAt !== sidecar.target.generatedAt
      || snapshot.schemaVersion !== sidecar.target.schemaVersion
      || digestValidatedAnalysisSnapshot(snapshot) !== sidecar.target.snapshotDigest
    ) {
      throw new EvaluationRepositoryError(
        'target_snapshot_mismatch', 'The target Snapshot no longer matches the Evaluation sidecar.',
      );
    }
    if (sidecar.result.state === 'available') {
      validatePersistedEvaluationFindingsV1(
        sidecar.result.findings,
        snapshot.finalReportMarkdown,
        manifest,
      );
    }
  }

  private resolveEvaluationDirectory(ticker: string, snapshotId: string): string {
    const target = resolve(this.rootDirectory, ticker, snapshotId);
    this.assertContained(target);
    return target;
  }

  private resolveEvaluationPath(ticker: string, snapshotId: string, evaluationId: string): string {
    const target = resolve(this.resolveEvaluationDirectory(ticker, snapshotId), `${evaluationId}.json`);
    this.assertContained(target);
    return target;
  }

  private assertContained(target: string): void {
    const rel = relative(this.rootDirectory, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new EvaluationRepositoryError(
        'filesystem_error', 'Resolved Evaluation path is outside its repository root.', target,
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
      throw new EvaluationRepositoryError(
        'filesystem_error', 'Resolved Evaluation path is outside its repository root.', target,
      );
    }
  }

  private async readSidecar(path: string, source: string): Promise<EvaluationSidecarV1> {
    let contents: string;
    try {
      await this.assertRealPathContained(path);
      contents = await readFile(path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new EvaluationRepositoryError(
          'missing_evaluation', `Evaluation sidecar not found: ${source}`, error,
        );
      }
      if (error instanceof EvaluationRepositoryError) throw error;
      throw new EvaluationRepositoryError(
        'filesystem_error', `Could not read Evaluation sidecar: ${source}`, error,
      );
    }
    return parseSidecarJson(contents, source);
  }
}
