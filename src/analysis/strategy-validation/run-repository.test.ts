import { describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import {
  createPointInTimeSourceEnvelopeV1,
  createPointInTimeSourceManifestV1,
  digestSnapshotCandidateIdentityV1,
  digestStrategyValidationCaseV1,
  digestStrategyValidationRunV1,
  parseTseSessionDate,
  StrategyValidationCaseV1Schema,
  StrategyValidationRunRepositoryErrorV1,
  StrategyValidationRunRepositoryV1,
  tokyoEndOfDayV1,
  type PointInTimeSourceEndpointV1,
  type PromoteStrategyValidationRunDirectoryV1,
  type StrategyValidationSourceRoleV1,
} from './index.js';
import {
  TEST_OUTCOME_AS_OF,
  TEST_STARTED_AT,
  anchorUnavailableCase,
  campaignCandidateCase,
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
  const evidence = completeCandidateSources('snapshot', '7203', '2025-01-02', '2025-01-03');
  const base = snapshotCandidateCase(evidence.sources[0]!.digest, {
    runId: overrides.runId,
    caseId: overrides.caseId,
  });
  const candidate = StrategyValidationCaseV1Schema.parse({
    ...base,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: evidence.references,
    }),
  });
  return Object.freeze({
    run: validationRun([candidate]),
    cases: Object.freeze([candidate]),
    sources: evidence.sources,
  });
}

function endpointForRole(role: StrategyValidationSourceRoleV1): PointInTimeSourceEndpointV1 {
  if (role.endsWith('_calendar')) return '/v2/markets/calendar';
  if (role.endsWith('_master')) return '/v2/equities/master';
  return '/v2/equities/bars/daily';
}

function roleSource(input: Readonly<{
  role: StrategyValidationSourceRoleV1;
  mode: 'snapshot' | 'campaign';
  ticker: string;
  anchorDate: string;
  evaluationDate: string;
  outcomeDailyDateFrom?: string;
}>) {
  const candidateRole = input.role.startsWith('candidate_');
  const calendarRole = input.role.endsWith('_calendar');
  const masterRole = input.role.endsWith('_master');
  const dateFrom = input.role === 'outcome_daily_bars'
    ? (input.outcomeDailyDateFrom ?? input.evaluationDate)
    : input.anchorDate;
  const dateTo = input.role === 'outcome_calendar'
    ? TEST_OUTCOME_AS_OF
    : input.role === 'outcome_daily_bars'
      ? (input.outcomeDailyDateFrom === undefined ? input.evaluationDate : TEST_OUTCOME_AS_OF)
      : input.anchorDate;
  const rows = input.role === 'outcome_calendar'
    ? [{ Date: input.anchorDate }, { Date: input.evaluationDate }]
    : [{ Date: masterRole ? input.anchorDate : dateFrom }];
  return createPointInTimeSourceEnvelopeV1({
    sourceMappingVersion: `test_${input.role}_v1`,
    endpoint: endpointForRole(input.role),
    query: [{ name: 'from', value: dateFrom }, { name: 'to', value: dateTo }],
    request: {
      ticker: calendarRole ? null : input.ticker,
      dateFrom,
      dateTo,
      asOfCutoff: candidateRole && input.mode === 'campaign'
        ? tokyoEndOfDayV1(input.anchorDate)
        : TEST_STARTED_AT,
    },
    fetchedAt: '2025-04-01T00:00:01.000Z',
    result: {
      state: 'available',
      rows,
    },
  });
}

function completeCandidateSources(
  mode: 'snapshot' | 'campaign',
  ticker: string,
  anchorDate: string,
  evaluationDate: string,
  outcomeDailyDateFrom?: string,
) {
  const roles: StrategyValidationSourceRoleV1[] = [
    'candidate_calendar',
    'candidate_master',
    ...(mode === 'campaign' ? ['candidate_daily_bars' as const] : []),
    'outcome_calendar',
    'outcome_daily_bars',
  ];
  const roleSources = roles.map(role => ({
    role,
    source: roleSource({
      role, mode, ticker, anchorDate, evaluationDate, outcomeDailyDateFrom,
    }),
  }));
  return Object.freeze({
    references: Object.freeze(roleSources.map(value => ({
      role: value.role,
      digest: value.source.digest,
    }))),
    sources: Object.freeze(roleSources.map(value => value.source).sort((left, right) => (
      left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0
    ))),
  });
}

function twoTickerCampaignPublication(swapSources: boolean) {
  const firstEvidence = completeCandidateSources('campaign', '7203', '2025-01-02', '2025-01-03');
  const secondEvidence = completeCandidateSources('campaign', '6758', '2025-01-03', '2025-01-04');
  const firstBase = campaignCandidateCase(firstEvidence.sources[0]!.digest, {
    caseId: '55555555-5555-4555-8555-555555555555',
    ticker: '7203',
    anchorDate: '2025-01-02',
  });
  const secondBase = campaignCandidateCase(secondEvidence.sources[0]!.digest, {
    caseId: '66666666-6666-4666-8666-666666666666',
    ticker: '6758',
    anchorDate: '2025-01-03',
  });
  const firstOutcomeDaily = firstEvidence.references.find(
    value => value.role === 'outcome_daily_bars',
  )!;
  const secondOutcomeDaily = secondEvidence.references.find(
    value => value.role === 'outcome_daily_bars',
  )!;
  const swappedReferences = (
    references: typeof firstEvidence.references,
    replacementDigest: string,
  ) => references.map(value => value.role === 'outcome_daily_bars'
    ? { ...value, digest: replacementDigest }
    : value);
  const first = StrategyValidationCaseV1Schema.parse({
    ...firstBase,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: swapSources
        ? swappedReferences(firstEvidence.references, secondOutcomeDaily.digest)
        : firstEvidence.references,
    }),
  });
  const second = StrategyValidationCaseV1Schema.parse({
    ...secondBase,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: swapSources
        ? swappedReferences(secondEvidence.references, firstOutcomeDaily.digest)
        : secondEvidence.references,
    }),
  });
  const sources = [...firstEvidence.sources, ...secondEvidence.sources]
    .filter((value, index, values) => values.findIndex(other => other.digest === value.digest) === index)
    .sort((left, right) => left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0);
  return Object.freeze({
    run: validationRun([first, second]),
    cases: Object.freeze([first, second]),
    sources: Object.freeze(sources),
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
      expect((await readdir(resolve(runDirectory, 'sources'))).sort()).toEqual(
        value.sources.map(source => (
          `${source.digest.slice('sha256:'.length)}.json`
        )).sort(),
      );
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

  test('rejects a terminal result with only calendar evidence', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const complete = publication();
      const candidate = complete.cases[0]!;
      const calendarReference = candidate.sourceManifest.sources.find(
        value => value.role === 'outcome_calendar',
      )!;
      const calendarSource = complete.sources.find(
        value => value.digest === calendarReference.digest,
      )!;
      const incomplete = StrategyValidationCaseV1Schema.parse({
        ...candidate,
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: [calendarReference],
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([incomplete]),
        cases: [incomplete],
        sources: [calendarSource],
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects outcome daily evidence that starts after the persisted terminal fill', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', '2025-01-03', '2025-01-04',
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest);
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]),
        cases: [candidate],
        sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('allows a local pre-source anchor failure with an empty source subset', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const seedSource = validationSource();
      const seed = anchorUnavailableCase(seedSource.digest, {
        caseId: '77777777-7777-4777-8777-777777777777',
        ticker: '7203',
        anchorDate: '2025-01-02',
      });
      const snapshot = snapshotCandidateCase(seedSource.digest);
      const unavailable = StrategyValidationCaseV1Schema.parse({
        ...seed,
        mode: 'snapshot',
        confidence: 'precommitted',
        selector: snapshot.selector,
        candidateGenerationPolicy: null,
        unavailableReason: 'strategy_data_date_invalid',
      });
      const value = {
        run: validationRun([unavailable]),
        cases: [unavailable],
        sources: [],
      };
      await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
      await expect(repository.load(value.run.runId)).resolves.toMatchObject({
        cases: [unavailable], sources: [],
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('publishes a frozen relationally-invalid candidate as invalid_candidate', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const calendar = roleSource({
        role: 'candidate_calendar',
        mode: 'snapshot',
        ticker: '7203',
        anchorDate: '2025-01-02',
        evaluationDate: '2025-01-03',
      });
      const base = snapshotCandidateCase(calendar.digest);
      if (base.caseKind !== 'candidate' || base.selector.mode !== 'snapshot') {
        throw new TypeError('Expected Snapshot candidate fixture.');
      }
      const candidate = {
        entry: { price: 100, reason: 'breakout_above_swing_high' as const },
        stop: { price: 110, reason: 'latest_swing_low' as const },
        target: { price: 120, reason: 'risk_reward_2R' as const },
      };
      const invalid = StrategyValidationCaseV1Schema.parse({
        ...base,
        candidate,
        candidateId: digestSnapshotCandidateIdentityV1({
          snapshotDigest: base.selector.snapshotDigest as SnapshotDigest,
          strategyDataDate: parseTseSessionDate(base.strategyDataDate),
          ...candidate,
          duplicateOrdinal: 0,
        }),
        tickEvidence: {
          effectiveDate: base.decisionDate,
          category: null,
          unavailableReason: 'invalid_candidate',
          levels: {
            entry: { tick: null, executable: null },
            stop: { tick: null, executable: null },
            target: { tick: null, executable: null },
          },
        },
        outcome: {
          algorithmVersion: base.outcome.algorithmVersion,
          limitQueueVersion: base.outcome.limitQueueVersion,
          plannedRisk: null,
          evaluationEndDate: null,
          kind: 'unavailable',
          reason: 'invalid_candidate',
          entryProven: false,
          entryFill: null,
          actualRisk: null,
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: [{ role: 'candidate_calendar', digest: calendar.digest }],
        }),
      });
      const value = {
        run: validationRun([invalid]),
        cases: [invalid],
        sources: [calendar],
      };
      await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
      await expect(repository.loadCase(value.run.runId, invalid.caseId)).resolves.toEqual(invalid);
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

  test('accepts exact case source roles and rejects a cross-ticker digest swap', async () => {
    for (const swapSources of [false, true]) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const value = twoTickerCampaignPublication(swapSources);
        if (swapSources) {
          await expectRepositoryKind(repository.publish(value), 'identity_mismatch');
        } else {
          await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
          const loaded = await repository.load(value.run.runId);
          expect(new Set(loaded.cases.map(item => item.caseId))).toEqual(
            new Set(value.cases.map(item => item.caseId)),
          );
          expect(new Set(loaded.sources.map(item => item.digest))).toEqual(
            new Set(value.sources.map(item => item.digest)),
          );
        }
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
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
