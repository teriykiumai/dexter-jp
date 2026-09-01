import type { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import {
  digestValidatedAnalysisSnapshot,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import type { AnalysisSnapshot } from '../snapshot/schema.js';
import {
  aggregateStrategyValidationCasesV1,
  buildStrategyValidationAggregationScopeV1,
} from './aggregation.js';
import {
  assignSnapshotCandidateIdentitiesV1,
  compareStrategyValidationCasesV1,
  digestStrategyValidationCaseV1,
  STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
  STRATEGY_VALIDATION_VERSIONS_V1,
  StrategyValidationCandidateV1Schema,
  StrategyValidationCaseV1Schema,
  type AssignedSnapshotCandidateIdentityV1,
  type StrategyValidationCandidateCaseV1,
  type StrategyValidationCaseV1,
} from './artifacts.js';
import {
  deriveOutcomeAsOfSessionV1,
  type TseSessionCalendarV1,
} from './calendar.js';
import {
  isStrictGregorianDate,
  parseAsOfCutoff,
  parseTseSessionDate,
  previousGregorianDateV1,
  tokyoDateFromUtcInstantV1,
  type AsOfCutoff,
  type OutcomeAsOfSession,
  type TseSessionDate,
} from './date.js';
import {
  type AcceptedJQuantsExecutionV1,
  type JQuantsExecutionPlanV1,
  JQuantsExecutionRuntimeV1,
  planJQuantsExecutionV1,
  resolveJQuantsRequestsPerMinuteV1,
} from './jquants-execution.js';
import {
  type JQuantsCalendarResultV1,
  type JQuantsDailyBarsResultV1,
  type JQuantsMasterResultV1,
  JQuantsValidationAdapterV1,
} from './jquants-validation-adapter.js';
import { validateStrategyValidationInputV1 } from './manifest.js';
import {
  STRATEGY_ENTRY_WAIT_SESSIONS_V1,
  STRATEGY_HOLDING_SESSIONS_V1,
  STRATEGY_LIMIT_QUEUE_VERSION_V1,
  STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
  STRATEGY_WORST_CASE_EVALUATION_SESSION_V1,
  resolveLongStrategyInitialFailureWithoutMasterV1,
  validateLongStrategyOutcomeV1,
  type StrategyOutcomeCandidateV1,
  type StrategyOutcomeResultV1,
  type StrategyTickCategoryEvidenceV1,
} from './outcome-validator.js';
import {
  createStrategyValidationCaseIdV1,
  createStrategyValidationRunIdV1,
  type StrategyValidationRunRepositoryV1,
} from './run-repository.js';
import {
  STRATEGY_VALIDATION_RUN_SCHEMA_VERSION,
  StrategyValidationRunV1Schema,
} from './run-artifact.js';
import type { PointInTimeSourceEnvelopeV1 } from './source-envelope.js';
import {
  createPointInTimeSourceManifestV1,
  type PointInTimeSourceManifestReferenceV1,
} from './source-manifest.js';
import { isExecutableTsePriceV1 } from './tick.js';

export const SNAPSHOT_AUDIT_ESTIMATED_LOCAL_ATTEMPTS_V1 = 1 as const;
export const SNAPSHOT_AUDIT_ESTIMATED_CANDIDATE_ATTEMPTS_V1 = 2 as const;
export const SNAPSHOT_AUDIT_CALENDAR_LOOKBACK_DAYS_V1 = 370 as const;

type SnapshotAnchorUnavailableReasonV1 =
  | 'strategy_data_date_invalid'
  | 'future_strategy_data'
  | 'invalid_candidate';

type SnapshotSelectorV1 = Readonly<{
  mode: 'snapshot';
  snapshotId: string;
  snapshotSchemaVersion: AnalysisSnapshot['schemaVersion'];
  snapshotDigest: SnapshotDigest;
}>;

export type SnapshotAuditPreflightV1 = Readonly<{
  mode: 'snapshot';
  ticker: string;
  snapshotId: string;
  selector: SnapshotSelectorV1;
  startedAt: AsOfCutoff;
  generatedTokyoDate: TseSessionDate;
  anchorDate: TseSessionDate;
  decisionDate: TseSessionDate;
  strategyDataDate: TseSessionDate | null;
  localUnavailableReason: SnapshotAnchorUnavailableReasonV1 | null;
  candidates: readonly StrategyOutcomeCandidateV1[];
  calendarDateFrom: TseSessionDate;
  calendarDateTo: TseSessionDate;
  executionPlan: JQuantsExecutionPlanV1;
}>;

export type SnapshotAuditExecutionResultV1 = Readonly<{
  state: 'created';
  runId: string;
  runPayloadDigest: SnapshotDigest;
  caseCount: number;
  attemptCount: number;
}>;

export type SnapshotAuditSourceV1 = Pick<
  JQuantsValidationAdapterV1,
  'fetchCalendar' | 'fetchMaster' | 'fetchDailyBars'
>;

export type SnapshotAuditPreflightOptionsV1 = Readonly<{
  snapshotRepository: AnalysisSnapshotRepository;
  startedAt?: string;
  requestsPerMinute?: number;
}>;

export type SnapshotAuditExecutionOptionsV1 = Readonly<{
  source: SnapshotAuditSourceV1;
  runtime: JQuantsExecutionRuntimeV1;
  accepted: AcceptedJQuantsExecutionV1;
  runRepository: StrategyValidationRunRepositoryV1;
  signal?: AbortSignal;
}>;

function earlier(left: TseSessionDate, right: TseSessionDate): TseSessionDate {
  return left < right ? left : right;
}

function later(left: TseSessionDate, right: TseSessionDate): TseSessionDate {
  return left > right ? left : right;
}

function calendarLookback(startedTokyoDate: TseSessionDate): TseSessionDate {
  let cursor: string = startedTokyoDate;
  for (let index = 0; index < SNAPSHOT_AUDIT_CALENDAR_LOOKBACK_DAYS_V1; index += 1) {
    cursor = previousGregorianDateV1(cursor);
  }
  return parseTseSessionDate(cursor);
}

function snapshotCandidate(
  value: NonNullable<AnalysisSnapshot['strategy']>['candidates'][number],
): StrategyOutcomeCandidateV1 | null {
  const parsed = StrategyValidationCandidateV1Schema.safeParse({
    entry: { price: value.entry.price, reason: value.entry.reason },
    stop: value.stop,
    target: value.target,
  });
  if (!parsed.success) return null;
  return Object.freeze({
    entry: Object.freeze(parsed.data.entry),
    stop: Object.freeze(parsed.data.stop),
    target: Object.freeze(parsed.data.target),
  });
}

export async function createSnapshotAuditPreflightV1(
  inputValue: Readonly<{ ticker: string; snapshotId: string }>,
  options: SnapshotAuditPreflightOptionsV1,
): Promise<SnapshotAuditPreflightV1> {
  const input = validateStrategyValidationInputV1({
    mode: 'snapshot',
    ticker: inputValue.ticker,
    snapshotId: inputValue.snapshotId,
  });
  if (input.mode !== 'snapshot') throw new TypeError('Expected Snapshot validation input.');
  const startedAt = parseAsOfCutoff(options.startedAt ?? new Date().toISOString());
  const requestsPerMinute = options.requestsPerMinute
    ?? resolveJQuantsRequestsPerMinuteV1();
  const snapshot = await options.snapshotRepository.loadHistory(input.ticker, input.snapshotId);
  const snapshotDigest = digestValidatedAnalysisSnapshot(snapshot);
  const generatedTokyoDate = parseTseSessionDate(tokyoDateFromUtcInstantV1(snapshot.generatedAt));
  const startedTokyoDate = parseTseSessionDate(tokyoDateFromUtcInstantV1(startedAt));
  const strategy = snapshot.strategy;
  let localUnavailableReason: SnapshotAnchorUnavailableReasonV1 | null = null;
  let strategyDataDate: TseSessionDate | null = null;
  let candidates: readonly StrategyOutcomeCandidateV1[] = Object.freeze([]);

  if (strategy === null || strategy.candidates.length === 0) {
    localUnavailableReason = 'invalid_candidate';
  } else if (!isStrictGregorianDate(strategy.dataDate)) {
    localUnavailableReason = 'strategy_data_date_invalid';
  } else {
    strategyDataDate = parseTseSessionDate(strategy.dataDate);
    if (strategyDataDate > generatedTokyoDate) {
      localUnavailableReason = 'future_strategy_data';
    } else {
      const normalized = strategy.candidates.map(snapshotCandidate);
      if (normalized.some(value => value === null)) {
        localUnavailableReason = 'invalid_candidate';
      } else {
        candidates = Object.freeze(normalized as StrategyOutcomeCandidateV1[]);
      }
    }
  }

  const anchorDate = strategyDataDate ?? generatedTokyoDate;
  const decisionDate = strategyDataDate === null
    ? generatedTokyoDate
    : later(strategyDataDate, generatedTokyoDate);
  const rangeAnchor = earlier(anchorDate, decisionDate);
  const calendarDateFrom = earlier(rangeAnchor, calendarLookback(startedTokyoDate));
  const calendarDateTo = later(later(anchorDate, decisionDate), startedTokyoDate);
  const candidateMasterRequired = localUnavailableReason === null
    && strategyDataDate !== null
    && candidates.some(candidate => (
      resolveLongStrategyInitialFailureWithoutMasterV1(candidate, strategyDataDate)
        !== 'invalid_candidate'
    ));
  const estimatedMinimumAttempts = candidateMasterRequired
    ? SNAPSHOT_AUDIT_ESTIMATED_CANDIDATE_ATTEMPTS_V1
    : SNAPSHOT_AUDIT_ESTIMATED_LOCAL_ATTEMPTS_V1;

  return Object.freeze({
    mode: 'snapshot',
    ticker: input.ticker,
    snapshotId: input.snapshotId,
    selector: Object.freeze({
      mode: 'snapshot',
      snapshotId: input.snapshotId,
      snapshotSchemaVersion: snapshot.schemaVersion,
      snapshotDigest,
    }),
    startedAt,
    generatedTokyoDate,
    anchorDate,
    decisionDate,
    strategyDataDate,
    localUnavailableReason,
    candidates,
    calendarDateFrom,
    calendarDateTo,
    executionPlan: planJQuantsExecutionV1(estimatedMinimumAttempts, requestsPerMinute),
  });
}

function sourceReference(
  role: PointInTimeSourceManifestReferenceV1['role'],
  source: PointInTimeSourceEnvelopeV1,
): PointInTimeSourceManifestReferenceV1 {
  return Object.freeze({ role, digest: source.digest });
}

function unavailableOutcome(
  candidate: StrategyOutcomeCandidateV1,
  reason: Exclude<
    Extract<StrategyOutcomeResultV1, { kind: 'unavailable' }>['reason'],
    'limit_queue_ambiguous'
  >,
  evaluationEndDate: TseSessionDate | null = null,
): StrategyOutcomeResultV1 {
  const pricesAreValid = candidate.stop.price < candidate.entry.price
    && candidate.entry.price < candidate.target.price;
  return Object.freeze({
    algorithmVersion: STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
    limitQueueVersion: STRATEGY_LIMIT_QUEUE_VERSION_V1,
    plannedRisk: pricesAreValid ? candidate.entry.price - candidate.stop.price : null,
    evaluationEndDate,
    kind: 'unavailable',
    reason,
    entryProven: false,
    entryFill: null,
    actualRisk: null,
  });
}

function replaceUnavailableReason(
  outcome: Extract<StrategyOutcomeResultV1, { kind: 'unavailable' }>,
  reason: 'source_plan_unavailable' | 'source_history_unavailable',
): StrategyOutcomeResultV1 {
  return Object.freeze({
    algorithmVersion: outcome.algorithmVersion,
    limitQueueVersion: outcome.limitQueueVersion,
    plannedRisk: outcome.plannedRisk,
    evaluationEndDate: outcome.evaluationEndDate,
    kind: 'unavailable',
    reason,
    entryProven: outcome.entryProven,
    entryFill: outcome.entryFill,
    actualRisk: outcome.actualRisk,
  });
}

function nullTickLevels() {
  return Object.freeze({
    entry: Object.freeze({ tick: null, executable: null }),
    stop: Object.freeze({ tick: null, executable: null }),
    target: Object.freeze({ tick: null, executable: null }),
  });
}

function initialTickEvidence(
  candidate: StrategyOutcomeCandidateV1,
  date: TseSessionDate,
  master: JQuantsMasterResultV1 | null,
): StrategyValidationCandidateCaseV1['tickEvidence'] {
  const geometryFailure = resolveLongStrategyInitialFailureWithoutMasterV1(candidate, date);
  if (geometryFailure === 'invalid_candidate') {
    return Object.freeze({
      effectiveDate: date,
      category: null,
      unavailableReason: 'invalid_candidate',
      levels: nullTickLevels(),
    });
  }
  if (master === null || master.state === 'unavailable') {
    return Object.freeze({
      effectiveDate: date,
      category: null,
      unavailableReason: master?.reason ?? 'source_response_invalid',
      levels: nullTickLevels(),
    });
  }
  const category = master.observation.tickCategory;
  const categories = category === null ? [] : [category];
  const results = {
    entry: isExecutableTsePriceV1(date, categories, candidate.entry.price),
    stop: isExecutableTsePriceV1(date, categories, candidate.stop.price),
    target: isExecutableTsePriceV1(date, categories, candidate.target.price),
  };
  const unavailableResult = Object.values(results).find(result => result.state === 'unavailable');
  if (unavailableResult?.state === 'unavailable') {
    return Object.freeze({
      effectiveDate: date,
      category,
      unavailableReason: unavailableResult.reason,
      levels: nullTickLevels(),
    });
  }
  return Object.freeze({
    effectiveDate: date,
    category,
    unavailableReason: null,
    levels: Object.freeze({
      entry: Object.freeze({
        tick: results.entry.state === 'available' ? results.entry.tick : null,
        executable: results.entry.state === 'available' ? results.entry.executable : null,
      }),
      stop: Object.freeze({
        tick: results.stop.state === 'available' ? results.stop.tick : null,
        executable: results.stop.state === 'available' ? results.stop.executable : null,
      }),
      target: Object.freeze({
        tick: results.target.state === 'available' ? results.target.tick : null,
        executable: results.target.state === 'available' ? results.target.executable : null,
      }),
    }),
  });
}

function tickCategoryEvidence(
  result: JQuantsMasterResultV1,
): StrategyTickCategoryEvidenceV1 | null {
  if (result.state === 'unavailable') return null;
  return Object.freeze({
    date: result.observation.date,
    categories: Object.freeze(result.observation.tickCategory === null
      ? []
      : [result.observation.tickCategory]),
  });
}

function manifest(
  preflight: SnapshotAuditPreflightV1,
  outcomeAsOfSession: OutcomeAsOfSession,
  references: readonly PointInTimeSourceManifestReferenceV1[],
) {
  return createPointInTimeSourceManifestV1({
    startedAt: preflight.startedAt,
    outcomeAsOfSession,
    sources: references,
  });
}

function anchorUnavailableCase(
  preflight: SnapshotAuditPreflightV1,
  runId: string,
  outcomeAsOfSession: OutcomeAsOfSession,
  reason: SnapshotAnchorUnavailableReasonV1 | 'calendar_incomplete',
  references: readonly PointInTimeSourceManifestReferenceV1[],
): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: createStrategyValidationCaseIdV1(),
    runId,
    mode: 'snapshot',
    confidence: 'precommitted',
    ticker: preflight.ticker,
    anchorDate: preflight.anchorDate,
    decisionDate: preflight.decisionDate,
    strategyDataDate: preflight.strategyDataDate,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: null,
    startedAt: preflight.startedAt,
    outcomeAsOfSession,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: manifest(preflight, outcomeAsOfSession, references),
    caseKind: 'anchor_unavailable',
    unavailableReason: reason,
  });
}

function candidateCase(
  preflight: SnapshotAuditPreflightV1,
  runId: string,
  outcomeAsOfSession: OutcomeAsOfSession,
  assigned: AssignedSnapshotCandidateIdentityV1,
  tickEvidence: StrategyValidationCandidateCaseV1['tickEvidence'],
  outcome: StrategyOutcomeResultV1,
  references: readonly PointInTimeSourceManifestReferenceV1[],
): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: createStrategyValidationCaseIdV1(),
    runId,
    mode: 'snapshot',
    confidence: 'precommitted',
    ticker: preflight.ticker,
    anchorDate: preflight.anchorDate,
    decisionDate: preflight.decisionDate,
    strategyDataDate: preflight.strategyDataDate,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: null,
    startedAt: preflight.startedAt,
    outcomeAsOfSession,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: manifest(preflight, outcomeAsOfSession, references),
    caseKind: 'candidate',
    candidateIdentityVersion: 'snapshot_candidate_identity_v1',
    candidateId: assigned.candidateId,
    duplicateOrdinal: assigned.duplicateOrdinal,
    candidate: assigned.candidate,
    tickEvidence,
    resistanceEvidenceTier: assigned.candidate.target.reason === 'risk_reward_2R'
      ? 'none'
      : 'precommitted_source_unknown',
    resistanceEvidenceSnapshotDigests: [],
    outcome,
  });
}

function firstOutcomeSessions(
  calendar: TseSessionCalendarV1,
  decisionDate: TseSessionDate,
  outcomeAsOfSession: OutcomeAsOfSession,
): readonly TseSessionDate[] {
  return Object.freeze(calendar.sessions
    .filter(date => date > decisionDate && date <= outcomeAsOfSession)
    .slice(0, STRATEGY_WORST_CASE_EVALUATION_SESSION_V1));
}

function addSource(
  sources: Map<SnapshotDigest, PointInTimeSourceEnvelopeV1>,
  source: PointInTimeSourceEnvelopeV1,
): void {
  sources.set(source.digest, source);
}

export async function executeSnapshotAuditV1(
  preflight: SnapshotAuditPreflightV1,
  options: SnapshotAuditExecutionOptionsV1,
): Promise<SnapshotAuditExecutionResultV1> {
  if (options.accepted.controls !== preflight.executionPlan
    && JSON.stringify(options.accepted.controls) !== JSON.stringify(preflight.executionPlan)) {
    throw new TypeError('Accepted execution controls differ from the Snapshot preflight.');
  }
  options.runtime.assertCanContinue(options.signal);
  const runId = createStrategyValidationRunIdV1();
  const sources = new Map<SnapshotDigest, PointInTimeSourceEnvelopeV1>();
  const candidateCalendarResult: JQuantsCalendarResultV1 = await options.source.fetchCalendar({
    dateFrom: preflight.calendarDateFrom,
    dateTo: preflight.calendarDateTo,
    asOfCutoff: preflight.startedAt,
    signal: options.signal,
  });
  addSource(sources, candidateCalendarResult.envelope);
  if (candidateCalendarResult.state === 'unavailable') {
    throw new TypeError('The official calendar cannot derive the frozen outcome boundary.');
  }
  const candidateCalendar = candidateCalendarResult.calendar;
  const outcomeAsOfSession = deriveOutcomeAsOfSessionV1(
    candidateCalendar,
    preflight.startedAt,
  );
  const candidateCalendarReference = sourceReference(
    'candidate_calendar',
    candidateCalendarResult.envelope,
  );
  let cases: readonly StrategyValidationCaseV1[];

  if (preflight.localUnavailableReason !== null) {
    cases = Object.freeze([anchorUnavailableCase(
      preflight,
      runId,
      outcomeAsOfSession,
      preflight.localUnavailableReason,
      [candidateCalendarReference],
    )]);
  } else if (preflight.strategyDataDate === null) {
    throw new TypeError('A candidate-bearing Snapshot has no validated Strategy date.');
  } else if (!candidateCalendar.isSession(preflight.strategyDataDate)) {
    cases = Object.freeze([anchorUnavailableCase(
      preflight,
      runId,
      outcomeAsOfSession,
      'strategy_data_date_invalid',
      [candidateCalendarReference],
    )]);
  } else {
    const assigned = assignSnapshotCandidateIdentitiesV1({
      snapshotDigest: preflight.selector.snapshotDigest,
      strategyDataDate: preflight.strategyDataDate,
      candidates: preflight.candidates,
    });
    const needsMaster = assigned.some(value => (
      resolveLongStrategyInitialFailureWithoutMasterV1(
        value.candidate,
        preflight.strategyDataDate!,
      ) !== 'invalid_candidate'
    ));
    const candidateMaster = needsMaster
      ? await options.source.fetchMaster({
        ticker: preflight.ticker,
        date: preflight.strategyDataDate,
        asOfCutoff: preflight.startedAt,
        signal: options.signal,
      })
      : null;
    if (candidateMaster !== null) addSource(sources, candidateMaster.envelope);
    const candidateMasterReference = candidateMaster === null
      ? null
      : sourceReference('candidate_master', candidateMaster.envelope);
    const initial = assigned.map(value => ({
      assigned: value,
      tickEvidence: initialTickEvidence(
        value.candidate,
        preflight.strategyDataDate!,
        candidateMaster,
      ),
    }));
    const outcomeReady = initial.filter(value => (
      value.tickEvidence.unavailableReason === null
      && Object.values(value.tickEvidence.levels).every(level => level.executable === true)
    ));
    let outcomeCalendarResult: JQuantsCalendarResultV1 | null = null;
    let dailyResult: JQuantsDailyBarsResultV1 | null = null;
    const outcomeMasterByDate = new Map<string, JQuantsMasterResultV1>();

    if (outcomeReady.length > 0) {
      const outcomeFrom = earlier(preflight.decisionDate, outcomeAsOfSession);
      const outcomeTo = later(preflight.decisionDate, outcomeAsOfSession);
      outcomeCalendarResult = await options.source.fetchCalendar({
        dateFrom: outcomeFrom,
        dateTo: outcomeTo,
        asOfCutoff: preflight.startedAt,
        signal: options.signal,
      });
      addSource(sources, outcomeCalendarResult.envelope);
      if (outcomeCalendarResult.state === 'available') {
        const sessions = firstOutcomeSessions(
          outcomeCalendarResult.calendar,
          preflight.decisionDate,
          outcomeAsOfSession,
        );
        if (sessions.length > 0) {
          dailyResult = await options.source.fetchDailyBars({
            ticker: preflight.ticker,
            dateFrom: sessions[0]!,
            dateTo: sessions.at(-1)!,
            asOfCutoff: preflight.startedAt,
            signal: options.signal,
          });
          addSource(sources, dailyResult.envelope);
        }
      }
    }

    const builtCases: StrategyValidationCaseV1[] = [];
    for (const value of initial) {
      const references: PointInTimeSourceManifestReferenceV1[] = [candidateCalendarReference];
      if (candidateMasterReference !== null
        && value.tickEvidence.unavailableReason !== 'invalid_candidate') {
        references.push(candidateMasterReference);
      }
      let outcome: StrategyOutcomeResultV1;
      if (value.tickEvidence.unavailableReason !== null
        || Object.values(value.tickEvidence.levels).some(level => level.executable === false)) {
        const tickEvidence = candidateMaster === null
          ? null
          : tickCategoryEvidence(candidateMaster);
        outcome = validateLongStrategyOutcomeV1({
          candidate: value.assigned.candidate,
          decisionDate: preflight.decisionDate,
          outcomeAsOfSession,
          initialTickDate: preflight.strategyDataDate,
          tickCategoryEvidence: tickEvidence === null ? [] : [tickEvidence],
          calendar: candidateCalendar,
          bars: [],
        });
        if (candidateMaster?.state === 'unavailable'
          && outcome.kind === 'unavailable'
          && outcome.reason === 'tick_category_unavailable') {
          outcome = Object.freeze({ ...outcome, reason: candidateMaster.reason });
        }
      } else if (outcomeCalendarResult === null) {
        throw new TypeError('Outcome calendar collection was not planned.');
      } else if (outcomeCalendarResult.state === 'unavailable') {
        references.push(sourceReference('outcome_calendar', outcomeCalendarResult.envelope));
        outcome = unavailableOutcome(value.assigned.candidate, outcomeCalendarResult.reason);
      } else {
        references.push(sourceReference('outcome_calendar', outcomeCalendarResult.envelope));
        const outcomeCalendar = outcomeCalendarResult.calendar;
        const sessions = firstOutcomeSessions(
          outcomeCalendar,
          preflight.decisionDate,
          outcomeAsOfSession,
        );
        if (sessions.length === 0) {
          outcome = validateLongStrategyOutcomeV1({
            candidate: value.assigned.candidate,
            decisionDate: preflight.decisionDate,
            outcomeAsOfSession,
            initialTickDate: preflight.strategyDataDate,
            tickCategoryEvidence: [tickCategoryEvidence(candidateMaster!)!],
            calendar: candidateCalendar,
            bars: [],
          });
        } else if (dailyResult === null) {
          throw new TypeError('Outcome daily-bar collection was not completed.');
        } else if (dailyResult.state === 'unavailable') {
          references.push(sourceReference('outcome_daily_bars', dailyResult.envelope));
          const replayed = validateLongStrategyOutcomeV1({
            candidate: value.assigned.candidate,
            decisionDate: preflight.decisionDate,
            outcomeAsOfSession,
            initialTickDate: preflight.strategyDataDate,
            tickCategoryEvidence: [tickCategoryEvidence(candidateMaster!)!],
            calendar: candidateCalendar,
            bars: [],
          });
          outcome = replayed.kind === 'unavailable'
            ? replaceUnavailableReason(replayed, dailyResult.reason)
            : unavailableOutcome(value.assigned.candidate, dailyResult.reason);
        } else {
          references.push(sourceReference('outcome_daily_bars', dailyResult.envelope));
          const masterEvidence: StrategyTickCategoryEvidenceV1[] = [
            tickCategoryEvidence(candidateMaster!)!,
          ];
          const masterReferences = new Map<string, PointInTimeSourceManifestReferenceV1>();
          while (true) {
            outcome = validateLongStrategyOutcomeV1({
              candidate: value.assigned.candidate,
              decisionDate: preflight.decisionDate,
              outcomeAsOfSession,
              initialTickDate: preflight.strategyDataDate,
              tickCategoryEvidence: [...masterEvidence].sort((left, right) => (
                left.date < right.date ? -1 : left.date > right.date ? 1 : 0
              )),
              calendar: candidateCalendar,
              bars: dailyResult.bars,
            });
            if (outcome.kind !== 'unavailable'
              || outcome.reason !== 'tick_category_unavailable'
              || outcome.evaluationEndDate === null) break;
            const date = outcome.evaluationEndDate;
            const existing = outcomeMasterByDate.get(date);
            if (existing !== undefined) {
              masterReferences.set(date, sourceReference('outcome_master', existing.envelope));
              if (existing.state === 'unavailable') {
                outcome = replaceUnavailableReason(outcome, existing.reason);
                break;
              }
              if (masterEvidence.some(evidence => evidence.date === date)) break;
              const evidence = tickCategoryEvidence(existing);
              if (evidence === null) break;
              masterEvidence.push(evidence);
              continue;
            }
            const master = await options.source.fetchMaster({
              ticker: preflight.ticker,
              date,
              asOfCutoff: preflight.startedAt,
              signal: options.signal,
            });
            outcomeMasterByDate.set(date, master);
            addSource(sources, master.envelope);
            masterReferences.set(date, sourceReference('outcome_master', master.envelope));
            if (master.state === 'unavailable') {
              outcome = replaceUnavailableReason(outcome, master.reason);
              break;
            }
            const evidence = tickCategoryEvidence(master);
            if (evidence === null) throw new TypeError('Available Master evidence was not normalized.');
            masterEvidence.push(evidence);
          }
          references.push(...[...masterReferences.values()]);
        }
      }
      builtCases.push(candidateCase(
        preflight,
        runId,
        outcomeAsOfSession,
        value.assigned,
        value.tickEvidence,
        outcome,
        references,
      ));
    }
    cases = Object.freeze(builtCases);
  }

  options.runtime.assertCanContinue(options.signal);
  const anchors = [{ ticker: preflight.ticker, anchorDate: preflight.anchorDate }];
  const aggregationScope = buildStrategyValidationAggregationScopeV1('snapshot', anchors);
  const aggregation = aggregateStrategyValidationCasesV1(aggregationScope, anchors, cases);
  const sortedCases = [...cases].sort(compareStrategyValidationCasesV1);
  const completedAt = options.runtime.nowUtc();
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(options.accepted.acceptedAt));
  const run = StrategyValidationRunV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_RUN_SCHEMA_VERSION,
    runId,
    mode: 'snapshot',
    confidence: 'precommitted',
    campaignName: null,
    startedAt: preflight.startedAt,
    acceptedAt: options.accepted.acceptedAt,
    executionDeadline: options.accepted.executionDeadline,
    completedAt,
    outcomeAsOfSession,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: null,
    aggregationScope,
    caseReferences: sortedCases.map(value => ({
      caseId: value.caseId,
      caseDigest: digestStrategyValidationCaseV1(value),
    })),
    aggregation,
    execution: {
      attemptCount: options.runtime.attempts.length,
      cacheHitCount: options.runtime.cacheHitCount,
      durationMs,
      controls: options.accepted.controls,
    },
    terminationState: 'completed',
    warnings: [],
  });
  const referencedDigests = new Set(cases.flatMap(value => (
    value.sourceManifest.sources.map(reference => reference.digest)
  )));
  const publicationSources = [...sources.values()]
    .filter(source => referencedDigests.has(source.digest));
  const published = await options.runRepository.publish({
    run,
    cases,
    sources: publicationSources,
  });
  return Object.freeze({
    state: 'created',
    runId: published.runId,
    runPayloadDigest: published.runPayloadDigest,
    caseCount: cases.length,
    attemptCount: options.runtime.attempts.length,
  });
}

export function createSnapshotAuditSourceV1(
  runtime: JQuantsExecutionRuntimeV1,
): SnapshotAuditSourceV1 {
  return new JQuantsValidationAdapterV1(runtime);
}
