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

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(dateFrom: string, dateTo: string): readonly string[] {
  const dates: string[] = [];
  for (let date = dateFrom; date <= dateTo; date = shiftDate(date, 1)) dates.push(date);
  return Object.freeze(dates);
}

function calendarRows(
  dateFrom: string,
  dateTo: string,
  nonSessionDates: readonly string[] = [],
) {
  const nonSessions = new Set(nonSessionDates);
  return dateRange(dateFrom, dateTo).map(Date => Object.freeze({
    Date, HolDiv: nonSessions.has(Date) ? '0' : '1',
  }));
}

function masterRow(date: string, ticker: string, scaleCategory: string | null = 'TOPIX Core30') {
  return Object.freeze({
    Date: date,
    Code: `${ticker}0`,
    ScaleCat: scaleCategory,
    Mkt: '0111',
    ProdCat: '011',
  });
}

type DailyRowValues = Readonly<{
  O: number;
  H: number;
  L: number;
  C: number;
  UL: '0' | '1';
  LL: '0' | '1';
  AdjFactor: number;
  ExRT: '1' | '2' | '3' | null;
}>;

const TARGET_HIT_DAILY_VALUES: DailyRowValues = Object.freeze({
  O: 95,
  H: 120,
  L: 95,
  C: 110,
  UL: '0',
  LL: '0',
  AdjFactor: 1,
  ExRT: null,
});

const NO_ENTRY_DAILY_VALUES: DailyRowValues = Object.freeze({
  O: 95,
  H: 99,
  L: 94,
  C: 98,
  UL: '0',
  LL: '0',
  AdjFactor: 1,
  ExRT: null,
});

const OPEN_POSITION_DAILY_VALUES: DailyRowValues = Object.freeze({
  O: 100,
  H: 110,
  L: 95,
  C: 100,
  UL: '0',
  LL: '0',
  AdjFactor: 1,
  ExRT: null,
});

function dailyRows(
  dates: readonly string[],
  ticker: string,
  valuesForDate: (date: string) => DailyRowValues = () => TARGET_HIT_DAILY_VALUES,
) {
  return dates.map(Date => Object.freeze({
    Date,
    Code: `${ticker}0`,
    ...valuesForDate(Date),
  }));
}

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
  decisionDate?: string;
  initialTickDate?: string;
  evaluationDate: string;
  outcomeDailyDateFrom?: string;
  omitDates?: readonly string[];
  candidateDateFrom?: string;
  nonSessionDates?: readonly string[];
  scaleCategory?: string | null;
  dailyValuesForDate?: (date: string) => DailyRowValues;
  unavailableReason?:
    | 'source_plan_unavailable'
    | 'source_history_unavailable'
    | 'source_response_invalid'
    | 'calendar_incomplete'
    | 'price_history_incomplete';
}>) {
  const candidateRole = input.role.startsWith('candidate_');
  const calendarRole = input.role.endsWith('_calendar');
  const masterRole = input.role.endsWith('_master');
  const decisionDate = input.decisionDate ?? input.anchorDate;
  const initialTickDate = input.initialTickDate ?? input.anchorDate;
  const campaignStart = input.candidateDateFrom ?? shiftDate(input.anchorDate, -250);
  const dateFrom = input.role === 'candidate_calendar' || input.role === 'candidate_daily_bars'
    ? (input.mode === 'campaign'
      ? campaignStart
      : [input.anchorDate, initialTickDate].sort()[0]!)
    : input.role === 'candidate_master'
      ? initialTickDate
    : input.role === 'outcome_calendar'
      ? decisionDate
      : input.role === 'outcome_master'
        ? input.evaluationDate
        : input.role === 'outcome_daily_bars'
          ? (input.outcomeDailyDateFrom ?? shiftDate(decisionDate, 1))
          : initialTickDate;
  const dateTo = input.role === 'outcome_calendar'
    ? TEST_OUTCOME_AS_OF
    : input.role === 'outcome_daily_bars'
      ? (input.outcomeDailyDateFrom === undefined ? input.evaluationDate : TEST_OUTCOME_AS_OF)
      : input.role === 'outcome_master'
        ? input.evaluationDate
        : input.role === 'candidate_master'
          ? initialTickDate
          : input.role === 'candidate_calendar'
            ? decisionDate
            : input.anchorDate;
  const omitted = new Set(input.omitDates ?? []);
  const rows = calendarRole
    ? calendarRows(dateFrom, dateTo, input.nonSessionDates)
    : masterRole
      ? [masterRow(
        dateFrom,
        input.ticker,
        input.scaleCategory === undefined ? 'TOPIX Core30' : input.scaleCategory,
      )]
      : dailyRows(
        dateRange(dateFrom, dateTo).filter(date => !omitted.has(date)),
        input.ticker,
        input.dailyValuesForDate,
      );
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
    result: input.unavailableReason === undefined
      ? { state: 'available', rows }
      : { state: 'unavailable', reason: input.unavailableReason, rows: [] },
  });
}

function completeCandidateSources(
  mode: 'snapshot' | 'campaign',
  ticker: string,
  anchorDate: string,
  evaluationDate: string,
  outcomeDailyDateFrom?: string,
  omitOutcomeDailyDates: readonly string[] = [],
  options: Readonly<{
    decisionDate?: string;
    initialTickDate?: string;
    nonSessionDates?: readonly string[];
    candidateScaleCategory?: string | null;
    outcomeScaleCategory?: string | null;
    outcomeDailyValuesForDate?: (date: string) => DailyRowValues;
  }> = {},
) {
  const roles: StrategyValidationSourceRoleV1[] = [
    'candidate_calendar',
    'candidate_master',
    ...(mode === 'campaign' ? ['candidate_daily_bars' as const] : []),
    'outcome_calendar',
    'outcome_master',
    'outcome_daily_bars',
  ];
  const roleSources = roles.map(role => ({
    role,
    source: roleSource({
      role, mode, ticker, anchorDate, evaluationDate, outcomeDailyDateFrom,
      decisionDate: options.decisionDate,
      initialTickDate: options.initialTickDate,
      nonSessionDates: options.nonSessionDates,
      scaleCategory: role === 'candidate_master'
        ? options.candidateScaleCategory
        : role === 'outcome_master'
          ? options.outcomeScaleCategory
          : undefined,
      omitDates: role === 'outcome_daily_bars' ? omitOutcomeDailyDates : [],
      dailyValuesForDate: role === 'outcome_daily_bars'
        ? options.outcomeDailyValuesForDate
        : undefined,
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

function replaceRoleSource(
  evidence: ReturnType<typeof completeCandidateSources>,
  role: StrategyValidationSourceRoleV1,
  source: ReturnType<typeof roleSource> | null,
) {
  return replaceRoleSources(evidence, role, source === null ? [] : [source]);
}

function replaceRoleSources(
  evidence: ReturnType<typeof completeCandidateSources>,
  role: StrategyValidationSourceRoleV1,
  replacements: readonly ReturnType<typeof roleSource>[],
) {
  const references = evidence.references.filter(value => value.role !== role);
  const sources = evidence.sources.filter(value => (
    !evidence.references.some(reference => reference.role === role && reference.digest === value.digest)
  ));
  for (const source of replacements) {
    references.push({ role, digest: source.digest });
    sources.push(source);
  }
  return Object.freeze({
    references: Object.freeze(references),
    sources: Object.freeze(sources.sort((left, right) => (
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

  test('keeps a Snapshot initial tick session distinct from a later non-session decision date', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const anchorDate = '2025-01-03';
      const decisionDate = '2025-01-04';
      const evaluationDate = '2025-01-05';
      const evidence = completeCandidateSources(
        'snapshot',
        '7203',
        anchorDate,
        evaluationDate,
        undefined,
        [],
        { decisionDate, nonSessionDates: [decisionDate] },
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest, { anchorDate });
      if (base.caseKind !== 'candidate' || base.outcome.kind !== 'target_hit') {
        throw new TypeError('Expected terminal Snapshot fixture.');
      }
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        decisionDate,
        outcome: {
          ...base.outcome,
          evaluationEndDate: evaluationDate,
          entryFill: { ...base.outcome.entryFill, date: evaluationDate },
          exitFill: { ...base.outcome.exitFill, date: evaluationDate },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      if (candidate.caseKind !== 'candidate') throw new TypeError('Expected candidate case.');
      expect(candidate.tickEvidence.effectiveDate).toBe(anchorDate);
      await expect(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      })).resolves.toMatchObject({ state: 'created' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects a Snapshot initial tick date that is not an official session', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const anchorDate = '2025-01-03';
      const decisionDate = '2025-01-04';
      const evaluationDate = '2025-01-05';
      const evidence = completeCandidateSources(
        'snapshot',
        '7203',
        anchorDate,
        evaluationDate,
        undefined,
        [],
        {
          decisionDate,
          initialTickDate: decisionDate,
          nonSessionDates: [decisionDate],
        },
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest, { anchorDate });
      if (base.caseKind !== 'candidate' || base.outcome.kind !== 'target_hit') {
        throw new TypeError('Expected terminal Snapshot fixture.');
      }
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        decisionDate,
        tickEvidence: { ...base.tickEvidence, effectiveDate: decisionDate },
        outcome: {
          ...base.outcome,
          evaluationEndDate: evaluationDate,
          entryFill: { ...base.outcome.entryFill, date: evaluationDate },
          exitFill: { ...base.outcome.exitFill, date: evaluationDate },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
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

  test('allows only a calendar-stage source failure to erase a Snapshot anchor', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const anchorCaseFor = (
        role: 'candidate_calendar' | 'candidate_master',
        source: ReturnType<typeof roleSource>,
      ) => {
        const seed = anchorUnavailableCase(source.digest, {
          caseId: '77777777-7777-4777-8777-777777777777',
          ticker: '7203',
          anchorDate: '2025-01-02',
          reason: 'source_history_unavailable',
        });
        const snapshot = snapshotCandidateCase(source.digest);
        return StrategyValidationCaseV1Schema.parse({
          ...seed,
          mode: 'snapshot',
          confidence: 'precommitted',
          strategyDataDate: '2025-01-02',
          selector: snapshot.selector,
          candidateGenerationPolicy: null,
          unavailableReason: 'source_plan_unavailable',
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: [{ role, digest: source.digest }],
          }),
        });
      };
      const failedMaster = roleSource({
        role: 'candidate_master', mode: 'snapshot', ticker: '7203',
        anchorDate: '2025-01-02', evaluationDate: '2025-01-03',
        unavailableReason: 'source_plan_unavailable',
      });
      const erasedCandidate = anchorCaseFor('candidate_master', failedMaster);
      await expectRepositoryKind(repository.publish({
        run: validationRun([erasedCandidate]),
        cases: [erasedCandidate],
        sources: [failedMaster],
      }), 'artifact_incomplete');

      const failedCalendar = roleSource({
        role: 'candidate_calendar', mode: 'snapshot', ticker: '7203',
        anchorDate: '2025-01-02', evaluationDate: '2025-01-03',
        unavailableReason: 'source_plan_unavailable',
      });
      const preCandidateFailure = anchorCaseFor('candidate_calendar', failedCalendar);
      await expect(repository.publish({
        run: validationRun([preCandidateFailure]),
        cases: [preCandidateFailure],
        sources: [failedCalendar],
      })).resolves.toMatchObject({ state: 'created' });
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

  test('rejects campaign reconstruction evidence missing one of the exact 251 sessions', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const anchorDate = '2025-01-02';
      const complete = completeCandidateSources('campaign', '7203', anchorDate, '2025-01-03');
      const missingDaily = roleSource({
        role: 'candidate_daily_bars',
        mode: 'campaign',
        ticker: '7203',
        anchorDate,
        evaluationDate: '2025-01-03',
        omitDates: [shiftDate(anchorDate, -100)],
      });
      const evidence = replaceRoleSource(complete, 'candidate_daily_bars', missingDaily);
      const base = campaignCandidateCase(evidence.sources[0]!.digest, {
        caseId: '77777777-7777-4777-8777-777777777777',
        ticker: '7203',
        anchorDate,
      });
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects a campaign calendar that proves only 250 reconstruction sessions', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const anchorDate = '2025-01-02';
      const complete = completeCandidateSources('campaign', '7203', anchorDate, '2025-01-03');
      const shortCalendar = roleSource({
        role: 'candidate_calendar',
        mode: 'campaign',
        ticker: '7203',
        anchorDate,
        evaluationDate: '2025-01-03',
        candidateDateFrom: shiftDate(anchorDate, -249),
      });
      const evidence = replaceRoleSource(complete, 'candidate_calendar', shortCalendar);
      const base = campaignCandidateCase(evidence.sources[0]!.digest, {
        caseId: '99999999-9999-4999-8999-999999999999',
        ticker: '7203',
        anchorDate,
      });
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects an outcome whose daily evidence skips an intermediate official session', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evaluationDate = '2025-01-05';
      const evidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', evaluationDate, undefined, ['2025-01-04'],
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest);
      if (base.caseKind !== 'candidate' || base.outcome.kind !== 'target_hit') {
        throw new TypeError('Expected terminal Snapshot fixture.');
      }
      const entryFill = {
        ...base.outcome.entryFill,
        date: evaluationDate,
        evaluationSession: 3,
      };
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        outcome: {
          ...base.outcome,
          evaluationEndDate: evaluationDate,
          entryFill,
          exitFill: {
            ...base.outcome.exitFill,
            date: evaluationDate,
            evaluationSession: 3,
          },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('requires not_triggered evidence through the exact t20 session', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const candidateFor = (evaluationDate: string) => {
        const complete = completeCandidateSources(
          'snapshot', '7203', '2025-01-02', evaluationDate, undefined, [], {
            outcomeDailyValuesForDate: () => NO_ENTRY_DAILY_VALUES,
          },
        );
        const evidence = replaceRoleSource(complete, 'outcome_master', null);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: evaluationDate,
            kind: 'not_triggered',
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        return { candidate, evidence };
      };
      const premature = candidateFor('2025-01-03');
      await expectRepositoryKind(repository.publish({
        run: validationRun([premature.candidate]),
        cases: [premature.candidate],
        sources: premature.evidence.sources,
      }), 'artifact_incomplete');

      const t20 = candidateFor('2025-01-22');
      await expect(repository.publish({
        run: validationRun([t20.candidate]),
        cases: [t20.candidate],
        sources: t20.evidence.sources,
      })).resolves.toMatchObject({ state: 'created' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('requires horizon evidence through holding day 60', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const candidateFor = (evaluationDate: string) => {
        const complete = completeCandidateSources(
          'snapshot', '7203', '2025-01-02', evaluationDate, undefined, [], {
            outcomeDailyValuesForDate: date => date === evaluationDate
              ? { ...OPEN_POSITION_DAILY_VALUES, C: 110 }
              : date === '2025-01-03'
                ? { ...OPEN_POSITION_DAILY_VALUES, O: 95, L: 95 }
                : OPEN_POSITION_DAILY_VALUES,
          },
        );
        const entryMaster = roleSource({
          role: 'outcome_master',
          mode: 'snapshot',
          ticker: '7203',
          anchorDate: '2025-01-02',
          evaluationDate: '2025-01-03',
        });
        const evidence = replaceRoleSource(complete, 'outcome_master', entryMaster);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: evaluationDate,
            kind: 'horizon_expired',
            entryProven: true,
            entryFill: {
              date: '2025-01-03',
              evaluationSession: 1,
              holdingDay: 1,
              order: 'entry',
              method: 'entry_level',
              price: 100,
            },
            actualRisk: 10,
            mark: { state: 'available', date: evaluationDate, price: 110, markR: 1 },
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        return { candidate, evidence };
      };
      const premature = candidateFor('2025-01-03');
      await expectRepositoryKind(repository.publish({
        run: validationRun([premature.candidate]),
        cases: [premature.candidate],
        sources: premature.evidence.sources,
      }), 'artifact_incomplete');

      const day60 = candidateFor('2025-03-03');
      await expect(repository.publish({
        run: validationRun([day60.candidate]),
        cases: [day60.candidate],
        sources: day60.evidence.sources,
      })).resolves.toMatchObject({ state: 'created' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects outcome_not_matured once the no-entry or entered branch is mature', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const noEntry = (evaluationDate: string) => {
        const evidence = replaceRoleSource(completeCandidateSources(
          'snapshot', '7203', '2025-01-02', evaluationDate, undefined, [], {
            outcomeDailyValuesForDate: () => NO_ENTRY_DAILY_VALUES,
          },
        ), 'outcome_master', null);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: evaluationDate,
            kind: 'unavailable',
            reason: 'outcome_not_matured',
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        return { candidate, evidence };
      };
      const t20 = noEntry('2025-01-22');
      await expectRepositoryKind(repository.publish({
        run: validationRun([t20.candidate]),
        cases: [t20.candidate],
        sources: t20.evidence.sources,
      }), 'artifact_incomplete');

      if (t20.candidate.caseKind !== 'candidate') throw new TypeError('Expected candidate case.');
      const nullBoundary = StrategyValidationCaseV1Schema.parse({
        ...t20.candidate,
        outcome: { ...t20.candidate.outcome, evaluationEndDate: null },
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([nullBoundary]),
        cases: [nullBoundary],
        sources: t20.evidence.sources,
      }), 'artifact_incomplete');

      const t19 = noEntry('2025-01-21');
      await expectRepositoryKind(repository.publish({
        run: validationRun([t19.candidate]),
        cases: [t19.candidate],
        sources: t19.evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }

    for (const scenario of [
      { ambiguous: false, evaluationDate: '2025-03-03' },
      { ambiguous: false, evaluationDate: '2025-03-02' },
      { ambiguous: true, evaluationDate: '2025-03-03' },
    ]) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const { evaluationDate } = scenario;
        const complete = completeCandidateSources(
          'snapshot', '7203', '2025-01-02', evaluationDate, undefined, [], {
            outcomeDailyValuesForDate: date => date === '2025-01-03'
              ? {
                ...OPEN_POSITION_DAILY_VALUES,
                O: 95,
                L: scenario.ambiguous ? 90 : 95,
              }
              : OPEN_POSITION_DAILY_VALUES,
          },
        );
        const entryMaster = roleSource({
          role: 'outcome_master',
          mode: 'snapshot',
          ticker: '7203',
          anchorDate: '2025-01-02',
          evaluationDate: '2025-01-03',
        });
        const evidence = replaceRoleSource(complete, 'outcome_master', entryMaster);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const entryFill = {
          date: '2025-01-03',
          evaluationSession: 1,
          holdingDay: 1,
          order: 'entry' as const,
          method: 'entry_level' as const,
          price: 100,
        };
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: scenario.ambiguous
            ? {
              algorithmVersion: base.outcome.algorithmVersion,
              limitQueueVersion: base.outcome.limitQueueVersion,
              plannedRisk: 10,
              evaluationEndDate: evaluationDate,
              kind: 'ambiguous_intraday',
              entryProven: true,
              entryFill,
              actualRisk: 10,
              ambiguityDate: '2025-01-03',
              pessimistic: {
                kind: 'stop_hit',
                exitFill: {
                  date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
                  order: 'stop', method: 'stop_level', price: 90,
                },
                realizedR: -1,
              },
              optimistic: { kind: 'unavailable', reason: 'outcome_not_matured' },
            }
            : {
              algorithmVersion: base.outcome.algorithmVersion,
              limitQueueVersion: base.outcome.limitQueueVersion,
              plannedRisk: 10,
              evaluationEndDate: evaluationDate,
              kind: 'unavailable',
              reason: 'outcome_not_matured',
              entryProven: true,
              entryFill,
              actualRisk: 10,
            },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        const value = {
          run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
        };
        await expectRepositoryKind(repository.publish(value), 'artifact_incomplete');
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('rejects a terminal fill without dated outcome master evidence', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const complete = completeCandidateSources('snapshot', '7203', '2025-01-02', '2025-01-03');
      const evidence = replaceRoleSource(complete, 'outcome_master', null);
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
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects candidate master evidence that contradicts persisted initial tick evidence', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evidence = completeCandidateSources(
        'snapshot',
        '7203',
        '2025-01-02',
        '2025-01-03',
        undefined,
        [],
        { candidateScaleCategory: 'その他' },
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
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');

      const unknownEvidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', '2025-01-03', undefined, [],
        { candidateScaleCategory: 'TOPIX Core3O' },
      );
      const unknownBase = snapshotCandidateCase(unknownEvidence.sources[0]!.digest);
      if (unknownBase.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
      const silentlyOrdinary = StrategyValidationCaseV1Schema.parse({
        ...unknownBase,
        tickEvidence: {
          effectiveDate: '2025-01-02',
          category: 'other',
          unavailableReason: null,
          levels: {
            entry: { tick: 1, executable: true },
            stop: { tick: 1, executable: true },
            target: { tick: 1, executable: true },
          },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: unknownEvidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([silentlyOrdinary]),
        cases: [silentlyOrdinary],
        sources: unknownEvidence.sources,
      }), 'artifact_incomplete');

      const exactEvidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', '2025-01-03',
      );
      const exactBase = snapshotCandidateCase(exactEvidence.sources[0]!.digest);
      if (exactBase.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
      const wrongTick = StrategyValidationCaseV1Schema.parse({
        ...exactBase,
        tickEvidence: {
          ...exactBase.tickEvidence,
          levels: {
            ...exactBase.tickEvidence.levels,
            entry: { tick: 1, executable: true },
          },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: exactEvidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([wrongTick]), cases: [wrongTick], sources: exactEvidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects a persisted target hit that the bound OHLC rows cannot reproduce', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', '2025-01-03', undefined, [], {
          outcomeDailyValuesForDate: () => ({
            ...NO_ENTRY_DAILY_VALUES,
            H: 105,
            C: 100,
          }),
        },
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
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('does not justify a touched stop with an untouched non-executable target', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evidence = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', '2025-01-03', undefined, [], {
          outcomeScaleCategory: 'その他',
          outcomeDailyValuesForDate: () => ({
            ...OPEN_POSITION_DAILY_VALUES,
            O: 95,
            H: 110,
            L: 89,
            C: 95,
          }),
        },
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest, {
        targetReason: 'resistance_level',
      });
      if (base.caseKind !== 'candidate' || base.selector.mode !== 'snapshot') {
        throw new TypeError('Expected Snapshot candidate fixture.');
      }
      const candidateLevels = {
        ...base.candidate,
        target: { price: 120.5, reason: 'resistance_level' as const },
      };
      const candidate = StrategyValidationCaseV1Schema.parse({
        ...base,
        candidate: candidateLevels,
        candidateId: digestSnapshotCandidateIdentityV1({
          snapshotDigest: base.selector.snapshotDigest as SnapshotDigest,
          strategyDataDate: parseTseSessionDate(base.strategyDataDate),
          ...candidateLevels,
          duplicateOrdinal: base.duplicateOrdinal,
        }),
        tickEvidence: {
          ...base.tickEvidence,
          levels: {
            ...base.tickEvidence.levels,
            target: { tick: 0.1, executable: true },
          },
        },
        outcome: {
          algorithmVersion: base.outcome.algorithmVersion,
          limitQueueVersion: base.outcome.limitQueueVersion,
          plannedRisk: 10,
          evaluationEndDate: '2025-01-03',
          kind: 'unavailable',
          reason: 'non_executable_tick',
          entryProven: true,
          entryFill: {
            date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
            order: 'entry', method: 'entry_level', price: 100,
          },
          actualRisk: 10,
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('binds persisted fills and tick failures to the dated outcome master category', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const evidence = completeCandidateSources(
        'snapshot',
        '7203',
        '2025-01-02',
        '2025-01-03',
        undefined,
        [],
        { outcomeScaleCategory: 'その他' },
      );
      const base = snapshotCandidateCase(evidence.sources[0]!.digest);
      if (base.caseKind !== 'candidate' || base.selector.mode !== 'snapshot') {
        throw new TypeError('Expected Snapshot candidate fixture.');
      }
      const candidateLevels = {
        entry: { price: 100.5, reason: base.candidate.entry.reason },
        stop: { price: 90.5, reason: base.candidate.stop.reason },
        target: { price: 120.5, reason: base.candidate.target.reason },
      };
      const common = {
        ...base,
        candidate: candidateLevels,
        candidateId: digestSnapshotCandidateIdentityV1({
          snapshotDigest: base.selector.snapshotDigest as SnapshotDigest,
          strategyDataDate: parseTseSessionDate(base.strategyDataDate),
          ...candidateLevels,
          duplicateOrdinal: base.duplicateOrdinal,
        }),
        tickEvidence: {
          ...base.tickEvidence,
          levels: {
            entry: { tick: 0.1, executable: true },
            stop: { tick: 0.1, executable: true },
            target: { tick: 0.1, executable: true },
          },
        },
        sourceManifest: createPointInTimeSourceManifestV1({
          startedAt: TEST_STARTED_AT,
          outcomeAsOfSession: TEST_OUTCOME_AS_OF,
          sources: evidence.references,
        }),
      };
      const contradictory = StrategyValidationCaseV1Schema.parse({
        ...common,
        outcome: {
          algorithmVersion: base.outcome.algorithmVersion,
          limitQueueVersion: base.outcome.limitQueueVersion,
          plannedRisk: 10,
          evaluationEndDate: '2025-01-03',
          kind: 'target_hit',
          entryProven: true,
          entryFill: {
            date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
            order: 'entry', method: 'entry_level', price: 100.5,
          },
          actualRisk: 10,
          exitFill: {
            date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
            order: 'target', method: 'target_level', price: 120.5,
          },
          realizedR: 2,
        },
      });
      await expectRepositoryKind(repository.publish({
        run: validationRun([contradictory]),
        cases: [contradictory],
        sources: evidence.sources,
      }), 'artifact_incomplete');

      const unavailable = StrategyValidationCaseV1Schema.parse({
        ...common,
        outcome: {
          algorithmVersion: base.outcome.algorithmVersion,
          limitQueueVersion: base.outcome.limitQueueVersion,
          plannedRisk: 10,
          evaluationEndDate: '2025-01-03',
          kind: 'unavailable',
          reason: 'non_executable_tick',
          entryProven: false,
          entryFill: null,
          actualRisk: null,
        },
      });
      await expect(repository.publish({
        run: validationRun([unavailable]),
        cases: [unavailable],
        sources: evidence.sources,
      })).resolves.toMatchObject({ state: 'created' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('rejects date-only rows that cannot reproduce normalized daily inputs', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const complete = completeCandidateSources('snapshot', '7203', '2025-01-02', '2025-01-03');
      const dateOnly = createPointInTimeSourceEnvelopeV1({
        sourceMappingVersion: 'test_outcome_daily_bars_v1',
        endpoint: '/v2/equities/bars/daily',
        query: [{ name: 'from', value: '2025-01-03' }, { name: 'to', value: '2025-01-03' }],
        request: {
          ticker: '7203',
          dateFrom: '2025-01-03',
          dateTo: '2025-01-03',
          asOfCutoff: TEST_STARTED_AT,
        },
        fetchedAt: '2025-04-01T00:00:01.000Z',
        result: { state: 'available', rows: [{ Date: '2025-01-03' }] },
      });
      const evidence = replaceRoleSource(complete, 'outcome_daily_bars', dateOnly);
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
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      }), 'artifact_incomplete');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('publishes price_history_incomplete only when the named official session is absent', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const missingDate = '2025-01-04';
      const candidateFor = (evidence: ReturnType<typeof completeCandidateSources>) => {
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        return StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: missingDate,
            kind: 'unavailable',
            reason: 'price_history_incomplete',
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
      };
      const contradictory = replaceRoleSource(
        completeCandidateSources('snapshot', '7203', '2025-01-02', missingDate),
        'outcome_master',
        null,
      );
      const contradictoryCandidate = candidateFor(contradictory);
      await expectRepositoryKind(repository.publish({
        run: validationRun([contradictoryCandidate]),
        cases: [contradictoryCandidate],
        sources: contradictory.sources,
      }), 'artifact_incomplete');

      const evidence = replaceRoleSource(completeCandidateSources(
        'snapshot', '7203', '2025-01-02', missingDate, undefined, [missingDate], {
          outcomeDailyValuesForDate: () => NO_ENTRY_DAILY_VALUES,
        },
      ), 'outcome_master', null);
      const candidate = candidateFor(evidence);
      const value = {
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      };
      await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
      await expect(repository.loadCase(value.run.runId, candidate.caseId)).resolves.toEqual(candidate);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('persists an initial Master source failure on each frozen Snapshot candidate', async () => {
    for (const reason of [
      'source_plan_unavailable',
      'source_history_unavailable',
      'source_response_invalid',
    ] as const) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const complete = completeCandidateSources(
          'snapshot', '7203', '2025-01-02', '2025-01-03',
        );
        const candidateMaster = roleSource({
          role: 'candidate_master',
          mode: 'snapshot',
          ticker: '7203',
          anchorDate: '2025-01-02',
          evaluationDate: '2025-01-03',
          unavailableReason: reason,
        });
        let evidence = replaceRoleSource(complete, 'candidate_master', candidateMaster);
        evidence = replaceRoleSource(evidence, 'outcome_calendar', null);
        evidence = replaceRoleSource(evidence, 'outcome_master', null);
        evidence = replaceRoleSource(evidence, 'outcome_daily_bars', null);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          tickEvidence: {
            effectiveDate: '2025-01-02',
            category: null,
            unavailableReason: reason,
            levels: {
              entry: { tick: null, executable: null },
              stop: { tick: null, executable: null },
              target: { tick: null, executable: null },
            },
          },
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: null,
            kind: 'unavailable',
            reason,
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        await expect(repository.publish({
          run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
        })).resolves.toMatchObject({ state: 'created' });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('does not let an initial Master failure override deterministic candidate or date failures', async () => {
    for (const scenario of [
      { anchorDate: '2025-01-02', relationallyInvalid: true },
      { anchorDate: '2015-09-23', relationallyInvalid: false },
    ] as const) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const candidateCalendar = roleSource({
          role: 'candidate_calendar', mode: 'snapshot', ticker: '7203',
          anchorDate: scenario.anchorDate, evaluationDate: shiftDate(scenario.anchorDate, 1),
        });
        const candidateMaster = roleSource({
          role: 'candidate_master', mode: 'snapshot', ticker: '7203',
          anchorDate: scenario.anchorDate, evaluationDate: shiftDate(scenario.anchorDate, 1),
          unavailableReason: 'source_plan_unavailable',
        });
        const sources = [candidateCalendar, candidateMaster].sort((left, right) => (
          left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0
        ));
        const base = snapshotCandidateCase(sources[0]!.digest, {
          anchorDate: scenario.anchorDate,
        });
        if (base.caseKind !== 'candidate' || base.selector.mode !== 'snapshot') {
          throw new TypeError('Expected Snapshot candidate fixture.');
        }
        const candidate = scenario.relationallyInvalid
          ? {
            entry: { price: 100, reason: 'breakout_above_swing_high' as const },
            stop: { price: 110, reason: 'latest_swing_low' as const },
            target: { price: 120, reason: 'risk_reward_2R' as const },
          }
          : base.candidate;
        const plannedRisk = scenario.relationallyInvalid ? null : 10;
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
            effectiveDate: scenario.anchorDate,
            category: null,
            unavailableReason: 'source_plan_unavailable',
            levels: {
              entry: { tick: null, executable: null },
              stop: { tick: null, executable: null },
              target: { tick: null, executable: null },
            },
          },
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk,
            evaluationEndDate: null,
            kind: 'unavailable',
            reason: 'source_plan_unavailable',
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: [
              { role: 'candidate_calendar', digest: candidateCalendar.digest },
              { role: 'candidate_master', digest: candidateMaster.digest },
            ],
          }),
        });
        await expectRepositoryKind(repository.publish({
          run: validationRun([invalid]), cases: [invalid], sources,
        }), 'artifact_incomplete');
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('replays prior outcome progress before accepting a later Master source failure', async () => {
    const { temporaryRoot, repository } = await temporaryRepository();
    try {
      const failureDate = '2025-01-04';
      const complete = completeCandidateSources(
        'snapshot', '7203', '2025-01-02', failureDate, undefined, [], {
          outcomeDailyValuesForDate: date => date === '2025-01-03'
            ? { ...OPEN_POSITION_DAILY_VALUES, O: 95, L: 95, H: 105 }
            : { ...OPEN_POSITION_DAILY_VALUES, L: 89 },
        },
      );
      const entryMaster = roleSource({
        role: 'outcome_master', mode: 'snapshot', ticker: '7203',
        anchorDate: '2025-01-02', evaluationDate: '2025-01-03',
      });
      const failedMaster = roleSource({
        role: 'outcome_master', mode: 'snapshot', ticker: '7203',
        anchorDate: '2025-01-02', evaluationDate: failureDate,
        unavailableReason: 'source_plan_unavailable',
      });
      const evidence = replaceRoleSources(
        complete, 'outcome_master', [entryMaster, failedMaster],
      );
      const candidateFor = (candidateEvidence: typeof evidence) => {
        const base = snapshotCandidateCase(candidateEvidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        return StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: failureDate,
            kind: 'unavailable',
            reason: 'source_plan_unavailable',
            entryProven: true,
            entryFill: {
              date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
              order: 'entry', method: 'entry_level', price: 100,
            },
            actualRisk: 10,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: candidateEvidence.references,
          }),
        });
      };

      const fabricated = replaceRoleSource(evidence, 'outcome_daily_bars', null);
      const fabricatedCandidate = candidateFor(fabricated);
      await expectRepositoryKind(repository.publish({
        run: validationRun([fabricatedCandidate]),
        cases: [fabricatedCandidate],
        sources: fabricated.sources,
      }), 'artifact_incomplete');

      const candidate = candidateFor(evidence);
      await expect(repository.publish({
        run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
      })).resolves.toMatchObject({ state: 'created' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('binds outcome source failures to matching unavailable envelopes', async () => {
    for (const matching of [false, true]) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const complete = completeCandidateSources('snapshot', '7203', '2025-01-02', '2025-01-03');
        const outcomeCalendar = roleSource({
          role: 'outcome_calendar',
          mode: 'snapshot',
          ticker: '7203',
          anchorDate: '2025-01-02',
          evaluationDate: '2025-01-03',
          unavailableReason: matching ? 'source_history_unavailable' : undefined,
        });
        let evidence = replaceRoleSource(complete, 'outcome_calendar', outcomeCalendar);
        evidence = replaceRoleSource(evidence, 'outcome_master', null);
        evidence = replaceRoleSource(evidence, 'outcome_daily_bars', null);
        const base = snapshotCandidateCase(evidence.sources[0]!.digest);
        if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
        const candidate = StrategyValidationCaseV1Schema.parse({
          ...base,
          outcome: {
            algorithmVersion: base.outcome.algorithmVersion,
            limitQueueVersion: base.outcome.limitQueueVersion,
            plannedRisk: 10,
            evaluationEndDate: null,
            kind: 'unavailable',
            reason: 'source_history_unavailable',
            entryProven: false,
            entryFill: null,
            actualRisk: null,
          },
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: evidence.references,
          }),
        });
        const value = {
          run: validationRun([candidate]), cases: [candidate], sources: evidence.sources,
        };
        if (matching) {
          await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
        } else {
          await expectRepositoryKind(repository.publish(value), 'artifact_incomplete');
        }
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  });

  test('binds source-derived unavailable reasons to matching unavailable envelopes', async () => {
    for (const matching of [false, true]) {
      const { temporaryRoot, repository } = await temporaryRepository();
      try {
        const source = roleSource({
          role: 'candidate_calendar',
          mode: 'campaign',
          ticker: '7203',
          anchorDate: '2025-01-02',
          evaluationDate: '2025-01-03',
          unavailableReason: matching ? 'source_history_unavailable' : undefined,
        });
        const base = anchorUnavailableCase(source.digest, {
          caseId: '88888888-8888-4888-8888-888888888888',
          ticker: '7203',
          anchorDate: '2025-01-02',
          reason: 'source_history_unavailable',
        });
        const unavailable = StrategyValidationCaseV1Schema.parse({
          ...base,
          sourceManifest: createPointInTimeSourceManifestV1({
            startedAt: TEST_STARTED_AT,
            outcomeAsOfSession: TEST_OUTCOME_AS_OF,
            sources: [{ role: 'candidate_calendar', digest: source.digest }],
          }),
        });
        const value = {
          run: validationRun([unavailable]), cases: [unavailable], sources: [source],
        };
        if (matching) {
          await expect(repository.publish(value)).resolves.toMatchObject({ state: 'created' });
        } else {
          await expectRepositoryKind(repository.publish(value), 'artifact_incomplete');
        }
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
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
