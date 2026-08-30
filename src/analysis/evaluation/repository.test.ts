import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comparisonSnapshot } from '../comparison/test-fixtures.js';
import { digestValidatedAnalysisSnapshot } from '../snapshot/canonical-json.js';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { buildEvidenceManifestV1, digestEvidenceManifestV1 } from './manifest.js';
import {
  digestArtifactInputV1,
  EvaluationRepository,
  EvaluationRepositoryError,
} from './repository.js';
import {
  EvaluationSidecarV1Schema,
  type EvaluationSidecarV1,
} from './schema.js';

const temporaryDirectories: string[] = [];

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dexter-evaluation-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

function evaluationSidecar(
  snapshot: ReturnType<typeof comparisonSnapshot>,
  snapshotId: string,
): EvaluationSidecarV1 {
  const evidenceManifest = buildEvidenceManifestV1(snapshot);
  const raw = {
    version: 1,
    evaluationId: '123e4567-e89b-42d3-a456-426614174000',
    target: {
      canonicalTicker: snapshot.canonicalTicker,
      snapshotId,
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      snapshotDigest: digestValidatedAnalysisSnapshot(snapshot),
    },
    artifactInputDigest: `sha256:${'0'.repeat(64)}`,
    evidenceManifest,
    evidenceManifestDigest: digestEvidenceManifestV1(evidenceManifest),
    evaluatorSchemaVersion: 1,
    evidenceManifestVersion: 1,
    rubricVersion: 1,
    promptVersion: 1,
    safetyPolicyVersion: 1,
    qualityGateId: 'qg_v1_terra_high',
    gateManifestDigest: `sha256:${'2'.repeat(64)}`,
    gateAttestationDigest: `sha256:${'3'.repeat(64)}`,
    evaluatorSourceDigest: `sha256:${'4'.repeat(64)}`,
    gateEvaluatedCommitSha: 'a'.repeat(40),
    executionEnvironment: {
      bunVersion: '1.3.14', bunRevision: '1.3.14+0d9b296af',
      platform: 'win32', arch: 'x64', dependencyManifestDigest: `sha256:${'5'.repeat(64)}`,
    },
    createdAt: '2026-08-30T01:00:00.000Z',
    completedAt: '2026-08-30T01:00:01.000Z',
    runtime: {
      providerId: 'openai', modelId: 'gpt-5.6-terra', taskProfile: 'deep_analysis',
      reasoningEffort: 'high',
      providerBoundary: {
        baseUrl: 'https://api.openai.com/v1', organizationId: null, projectId: null,
        adapterMaxRetries: 0, sdkMaxRetries: 0,
      },
    },
    attemptCount: 1,
    timeoutMs: 180_000,
    durationMs: 1_000,
    tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    result: { state: 'available', findings: [] },
  };
  const provisional = EvaluationSidecarV1Schema.parse(raw) as EvaluationSidecarV1;
  return EvaluationSidecarV1Schema.parse({
    ...provisional,
    artifactInputDigest: digestArtifactInputV1(provisional),
  }) as EvaluationSidecarV1;
}

async function repositories() {
  const directory = await createDirectory();
  const snapshotRepository = new AnalysisSnapshotRepository(join(directory, 'analysis'));
  const evaluationRepository = new EvaluationRepository(join(directory, 'evaluations'), {
    snapshotRepository,
  });
  return { directory, snapshotRepository, evaluationRepository };
}

describe('EvaluationRepository', () => {
  test('hashes the exact reviewed ArtifactInputEnvelope V1 golden vector', () => {
    const snapshot = comparisonSnapshot();
    const sidecar = evaluationSidecar(snapshot, '2026-08-22T01-00-00-000Z');
    const golden = {
      ...sidecar,
      target: { ...sidecar.target, snapshotDigest: `sha256:${'0'.repeat(64)}` },
      evidenceManifestDigest: `sha256:${'1'.repeat(64)}`,
    } as EvaluationSidecarV1;
    expect(digestArtifactInputV1(golden)).toBe(
      'sha256:7a0fd8c7bd15c3b9a197bc316e6ba1d63a7f094682a8b80ba9df88433cfcc86e',
    );
  });

  test('publishes and loads one canonical create-only sidecar bound to its target Snapshot', async () => {
    const { directory, snapshotRepository, evaluationRepository } = await repositories();
    const snapshot = comparisonSnapshot();
    const saved = await snapshotRepository.save(snapshot);
    const sidecar = evaluationSidecar(snapshot, saved.snapshotId);

    expect(await evaluationRepository.save(sidecar)).toBe('created');
    expect(await evaluationRepository.load(
      saved.canonicalTicker, saved.snapshotId, sidecar.evaluationId,
    )).toEqual(sidecar);

    const path = join(
      directory, 'evaluations', saved.canonicalTicker, saved.snapshotId,
      `${sidecar.evaluationId}.json`,
    );
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(sidecar);
    expect(await readdir(join(directory, 'evaluations', saved.canonicalTicker, saved.snapshotId)))
      .toEqual([`${sidecar.evaluationId}.json`]);
  });

  test('rejects every existing Evaluation ID instead of replacing or treating it as idempotent', async () => {
    const { directory, snapshotRepository, evaluationRepository } = await repositories();
    const snapshot = comparisonSnapshot();
    const saved = await snapshotRepository.save(snapshot);
    const sidecar = evaluationSidecar(snapshot, saved.snapshotId);
    await evaluationRepository.save(sidecar);

    await expect(evaluationRepository.save(sidecar)).rejects.toMatchObject({
      kind: 'evaluation_id_collision',
    });
    expect(await readdir(join(directory, 'evaluations', saved.canonicalTicker, saved.snapshotId)))
      .toEqual([`${sidecar.evaluationId}.json`]);
  });

  test('fails before publication for a missing target or mismatched manifest/input digest', async () => {
    const { directory, snapshotRepository, evaluationRepository } = await repositories();
    const snapshot = comparisonSnapshot();
    const saved = await snapshotRepository.save(snapshot);
    const sidecar = evaluationSidecar(snapshot, saved.snapshotId);

    await expect(evaluationRepository.save({
      ...sidecar,
      evidenceManifestDigest: `sha256:${'f'.repeat(64)}`,
    })).rejects.toMatchObject({ kind: 'manifest_digest_mismatch' });

    await expect(evaluationRepository.save({
      ...sidecar,
      artifactInputDigest: `sha256:${'f'.repeat(64)}`,
    })).rejects.toMatchObject({ kind: 'artifact_input_digest_mismatch' });

    const missing = evaluationSidecar(snapshot, '2026-08-31T00-00-00-000Z');
    await expect(evaluationRepository.save(missing)).rejects.toMatchObject({
      kind: 'target_snapshot_mismatch',
    });
    expect(await readdir(join(directory, 'evaluations')).catch(() => [])).toEqual([]);
  });

  test('maps unsupported hard-link publication and cleans the temporary sidecar', async () => {
    const { directory, snapshotRepository } = await repositories();
    const snapshot = comparisonSnapshot();
    const saved = await snapshotRepository.save(snapshot);
    const repository = new EvaluationRepository(join(directory, 'evaluations-unsupported'), {
      snapshotRepository,
      linkFile: async () => {
        throw Object.assign(new Error('unsupported'), { code: 'EXDEV' });
      },
    });
    const sidecar = evaluationSidecar(snapshot, saved.snapshotId);

    await expect(repository.save(sidecar)).rejects.toMatchObject({
      kind: 'create_only_publish_unsupported',
    });
    expect(await readdir(join(
      directory, 'evaluations-unsupported', saved.canonicalTicker, saved.snapshotId,
    ))).toEqual([]);
  });

  test('rejects unsafe selectors and missing sidecars with typed failures', async () => {
    const { evaluationRepository } = await repositories();
    await expect(evaluationRepository.load(
      '../7203', '2026-08-30T00-00-00-000Z', '123e4567-e89b-42d3-a456-426614174000',
    )).rejects.toMatchObject({ kind: 'unsafe_ticker' });
    await expect(evaluationRepository.load(
      '7203', 'latest', '123e4567-e89b-42d3-a456-426614174000',
    )).rejects.toMatchObject({ kind: 'unsafe_snapshot_id' });
    await expect(evaluationRepository.load(
      '7203', '2026-08-30T00-00-00-000Z', 'latest',
    )).rejects.toMatchObject({ kind: 'unsafe_evaluation_id' });
    await expect(evaluationRepository.load(
      '7203', '2026-08-30T00-00-00-000Z', '123e4567-e89b-42d3-a456-426614174000',
    )).rejects.toBeInstanceOf(EvaluationRepositoryError);
  });
});
