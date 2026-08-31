import { describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import {
  digestStrategyValidationCaseV1,
  digestStrategyValidationRunV1,
  StrategyValidationRunRepositoryErrorV1,
  StrategyValidationRunRepositoryV1,
  type PromoteStrategyValidationRunDirectoryV1,
} from './index.js';
import {
  snapshotCandidateCase,
  validationRun,
  validationSource,
} from './artifact-test-fixtures.js';

const RUN_2 = '33333333-3333-4333-8333-333333333333';
const CASE_2 = '44444444-4444-4444-8444-444444444444';

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const noReplacePromotion: PromoteStrategyValidationRunDirectoryV1 = async (
  temporaryDirectory,
  finalDirectory,
) => {
  try {
    await access(finalDirectory);
    throw nodeError('EEXIST');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)
      || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(temporaryDirectory, finalDirectory);
};

async function temporaryRepository(
  promoteDirectory: PromoteStrategyValidationRunDirectoryV1 = noReplacePromotion,
) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dexter-p4-r1-'));
  const repositoryRoot = resolve(temporaryRoot, 'research');
  return {
    temporaryRoot,
    repository: new StrategyValidationRunRepositoryV1(repositoryRoot, { promoteDirectory }),
  };
}

function publication(overrides: { runId?: string; caseId?: string } = {}) {
  const source = validationSource();
  const candidate = snapshotCandidateCase(source.digest, {
    runId: overrides.runId,
    caseId: overrides.caseId,
  });
  return Object.freeze({
    run: validationRun([candidate]),
    cases: Object.freeze([candidate]),
    sources: Object.freeze([source]),
  });
}

async function expectRepositoryKind(
  operation: Promise<unknown>,
  kind: StrategyValidationRunRepositoryErrorV1['kind'],
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected repository error: ${kind}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StrategyValidationRunRepositoryErrorV1);
    expect((error as StrategyValidationRunRepositoryErrorV1).kind).toBe(kind);
  }
}

describe('Strategy-validation immutable run repository V1', () => {
  test('publishes one self-contained canonical run and rereads every digest', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const value = publication();
      const result = await repository.publish(value);
      expect(result).toEqual({
        state: 'created',
        runId: value.run.runId,
        runPayloadDigest: digestStrategyValidationRunV1(value.run),
      });
      const runDirectory = resolve(repository.runsDirectory, value.run.runId);
      expect((await readdir(runDirectory)).sort()).toEqual(['cases', 'run.json', 'sources']);
      expect(await readdir(resolve(runDirectory, 'cases'))).toEqual([
        `${value.cases[0]!.caseId}.json`,
      ]);
      expect(await readdir(resolve(runDirectory, 'sources'))).toEqual([
        `${value.sources[0]!.digest.slice('sha256:'.length)}.json`,
      ]);
      const loaded = await repository.load(value.run.runId);
      expect(loaded.runPayloadDigest).toBe(result.runPayloadDigest);
      expect(loaded.run).toEqual(value.run);
      expect(loaded.cases).toEqual(value.cases);
      expect(loaded.sources).toEqual(value.sources);
      expect(await repository.loadCase(value.run.runId, value.cases[0]!.caseId))
        .toEqual(value.cases[0]);
      expect(await repository.list()).toHaveLength(1);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('is create-only and equal reruns require new publication UUIDs', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const first = publication();
      await repository.publish(first);
      await expectRepositoryKind(repository.publish(first), 'run_id_collision');

      const second = publication({ runId: RUN_2, caseId: CASE_2 });
      await repository.publish(second);
      expect(second.run.runId).not.toBe(first.run.runId);
      expect(second.cases[0]!.caseId).not.toBe(first.cases[0]!.caseId);
      if (first.cases[0]?.caseKind !== 'candidate' || second.cases[0]?.caseKind !== 'candidate') {
        throw new TypeError('Expected candidate fixtures.');
      }
      expect(second.cases[0].candidateId).toBe(first.cases[0].candidateId);
      expect(digestStrategyValidationCaseV1(second.cases[0]))
        .not.toBe(digestStrategyValidationCaseV1(first.cases[0]));
      expect((await repository.list()).map(value => value.run.runId)).toEqual([
        first.run.runId, second.run.runId,
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('maps unsupported atomic promotion and removes its attributable temp directory', async () => {
    const unsupported: PromoteStrategyValidationRunDirectoryV1 = async () => {
      throw nodeError('EXDEV');
    };
    const { temporaryRoot, repository } = await temporaryRepository(unsupported);
    try {
      await expectRepositoryKind(repository.publish(publication()), 'publish_unsupported');
      expect(await readdir(repository.runsDirectory)).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects malformed versions and never skips a corrupt run during listing', async () => {
    const mutators: readonly ((repository: StrategyValidationRunRepositoryV1, value: ReturnType<typeof publication>) => Promise<void>)[] = [
      async (repository, value) => {
        const path = resolve(repository.runsDirectory, value.run.runId, 'run.json');
        const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        await writeFile(path, canonicalJsonV1({
          ...raw, schemaVersion: 'strategy_validation_run_v2',
        } as CanonicalJsonValue));
      },
      async (repository, value) => {
        const path = resolve(
          repository.runsDirectory, value.run.runId, 'cases', `${value.cases[0]!.caseId}.json`,
        );
        const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        await writeFile(path, canonicalJsonV1({
          ...raw, schemaVersion: 'strategy_validation_case_v2',
        } as CanonicalJsonValue));
      },
      async (repository, value) => {
        const path = resolve(
          repository.runsDirectory,
          value.run.runId,
          'sources',
          `${value.sources[0]!.digest.slice('sha256:'.length)}.json`,
        );
        const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        await writeFile(path, canonicalJsonV1({ ...raw, schemaVersion: 2 } as CanonicalJsonValue));
      },
    ];
    for (const mutate of mutators) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const value = publication();
        await repository.publish(value);
        await mutate(repository, value);
        await expectRepositoryKind(repository.load(value.run.runId), 'unsupported_version');
        await expectRepositoryKind(repository.list(), 'unsupported_version');
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('fails closed on missing cases, source filename/body digest mismatch, and extra entries', async () => {
    const scenarios: readonly ((repository: StrategyValidationRunRepositoryV1, value: ReturnType<typeof publication>) => Promise<void>)[] = [
      async (repository, value) => {
        await rm(resolve(
          repository.runsDirectory, value.run.runId, 'cases', `${value.cases[0]!.caseId}.json`,
        ));
      },
      async (repository, value) => {
        const other = validationSource('7203');
        await writeFile(resolve(
          repository.runsDirectory,
          value.run.runId,
          'sources',
          `${value.sources[0]!.digest.slice('sha256:'.length)}.json`,
        ), canonicalJsonV1(other as CanonicalJsonValue));
      },
      async (repository, value) => {
        await writeFile(resolve(repository.runsDirectory, value.run.runId, 'unexpected.json'), '{}');
      },
    ];
    for (const corrupt of scenarios) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const value = publication();
        await repository.publish(value);
        await corrupt(repository, value);
        await expect(repository.list()).rejects.toBeInstanceOf(
          StrategyValidationRunRepositoryErrorV1,
        );
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('rejects traversal, mixed-case, and noncanonical IDs before path resolution', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      for (const runId of [
        '../11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-11111111111A',
        'not-a-uuid',
      ]) {
        await expectRepositoryKind(repository.load(runId), 'unsafe_run_id');
      }
      await expectRepositoryKind(repository.loadCase(
        '11111111-1111-4111-8111-111111111111',
        '..%2f22222222-2222-4222-8222-222222222222',
      ), 'unsafe_case_id');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
