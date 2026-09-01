import type { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { AnalysisSnapshotPersistenceError } from '../snapshot/errors.js';
import {
  digestValidatedAnalysisSnapshot,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import { analyzeStrategy } from '../../tools/finance/strategy-engine.js';
import { analyzeTechnical } from '../../tools/finance/technical-engine.js';
import {
  aggregateStrategyValidationCasesV1,
  buildStrategyValidationAggregationScopeV1,
} from './aggregation.js';
import { adjustDailyBarsToT0V1 } from './adjustment.js';
import {
  assignCampaignCandidateIdentitiesV1,
  compareStrategyValidationCasesV1,
  digestStrategyValidationCaseV1,
  STRATEGY_VALIDATION_CAMPAIGN_POLICY,
  STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
  STRATEGY_VALIDATION_VERSIONS_V1,
  StrategyValidationCaseV1Schema,
  type AssignedCampaignCandidateIdentityV1,
  type StrategyValidationCandidateCaseV1,
  type StrategyValidationCaseV1,
} from './artifacts.js';
import {
  deriveOutcomeAsOfSessionV1,
  type TseSessionCalendarV1,
} from './calendar.js';
import {
  parseAsOfCutoff,
  parseTseSessionDate,
  previousGregorianDateV1,
  tokyoDateFromUtcInstantV1,
  tokyoEndOfDayV1,
  type AsOfCutoff,
  type OutcomeAsOfSession,
  type TseSessionDate,
} from './date.js';
import { requireDailyBarsForSessionsV1, type TseDailyBarV1 } from './daily-bar.js';
import { PointInTimeErrorV1 } from './errors.js';
import {
  type AcceptedJQuantsExecutionV1,
  type JQuantsExecutionPlanV1,
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  planJQuantsExecutionV1,
  resolveJQuantsRequestsPerMinuteV1,
} from './jquants-execution.js';
import {
  type JQuantsDailyBarsResultV1,
  type JQuantsMasterResultV1,
  JQuantsValidationAdapterV1,
} from './jquants-validation-adapter.js';
import {
  digestStrategyValidationCampaignManifestV1,
  normalizeStrategyValidationResistanceLevelsV1,
  validateStrategyValidationInputV1,
  type StrategyValidationCampaignAnchorV1,
  type StrategyValidationCampaignManifestV1,
} from './manifest.js';
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
import { isExecutableTsePriceV1, nextTseQuoteAboveV1 } from './tick.js';

export const CAMPAIGN_TECHNICAL_SESSION_COUNT_V1 = 251 as const;
export const CAMPAIGN_CALENDAR_LOOKBACK_DAYS_V1 = 550 as const;
export const CAMPAIGN_RECONSTRUCTION_WARNING_V1 =
  'reconstructed_251_as_of: technical_251_strategy_v1 is a standardized retrospective policy and is not production-pipeline parity.' as const;

type CampaignAnchorUnavailableReasonV1 =
  | 'source_plan_unavailable'
  | 'source_history_unavailable'
  | 'calendar_incomplete'
  | 'price_history_incomplete'
  | 'tick_rule_period_unsupported'
  | 'tick_category_unavailable'
  | 'invalid_candidate'
  | 'resistance_evidence_invalid';

export type CampaignResistanceEvidenceV1 = Readonly<{
  state: 'available';
  levels: readonly Readonly<{
    price: number;
    snapshotDigests: readonly SnapshotDigest[];
  }>[];
}> | Readonly<{
  state: 'unavailable';
  reason: 'resistance_evidence_invalid';
}>;

export type CampaignReconstructionAnchorPreflightV1 = Readonly<{
  ticker: string;
  anchorDate: TseSessionDate;
  resistanceEvidence: CampaignResistanceEvidenceV1;
}>;

export type CampaignReconstructionPreflightV1 = Readonly<{
  mode: 'campaign';
  manifest: StrategyValidationCampaignManifestV1;
  selector: Readonly<{ mode: 'campaign'; manifestDigest: SnapshotDigest }>;
  startedAt: AsOfCutoff;
  anchors: readonly CampaignReconstructionAnchorPreflightV1[];
  calendarDateFrom: TseSessionDate;
  calendarDateTo: TseSessionDate;
  executionPlan: JQuantsExecutionPlanV1;
}>;

export type CampaignReconstructionExecutionResultV1 = Readonly<{
  state: 'created';
  runId: string;
  runPayloadDigest: SnapshotDigest;
  caseCount: number;
  attemptCount: number;
}>;

export type CampaignReconstructionSourceV1 = Pick<
  JQuantsValidationAdapterV1,
  'fetchCalendar' | 'fetchMaster' | 'fetchDailyBars'
>;

export type CampaignReconstructionPreflightOptionsV1 = Readonly<{
  snapshotRepository: AnalysisSnapshotRepository;
  startedAt?: string;
  requestsPerMinute?: number;
}>;

export type CampaignReconstructionExecutionOptionsV1 = Readonly<{
  source: CampaignReconstructionSourceV1;
  runtime: JQuantsExecutionRuntimeV1;
  accepted: AcceptedJQuantsExecutionV1;
  runRepository: StrategyValidationRunRepositoryV1;
  signal?: AbortSignal;
  runId?: string;
  onOutcomeAsOfSession?: (outcomeAsOfSession: OutcomeAsOfSession) => void | Promise<void>;
  onValidating?: (progress: Readonly<{
    outcomeAsOfSession: OutcomeAsOfSession;
    caseCount: number;
    attemptCount: number;
  }>) => void | Promise<void>;
  beforePromote?: (prepared: Readonly<{
    runId: string;
    runPayloadDigest: SnapshotDigest;
  }>) => void | Promise<void>;
}>;

function earlier(left: TseSessionDate, right: TseSessionDate): TseSessionDate {
  return left < right ? left : right;
}

function later(left: TseSessionDate, right: TseSessionDate): TseSessionDate {
  return left > right ? left : right;
}

function lookback(date: TseSessionDate): TseSessionDate {
  let cursor: string = date;
  for (let index = 0; index < CAMPAIGN_CALENDAR_LOOKBACK_DAYS_V1; index += 1) {
    cursor = previousGregorianDateV1(cursor);
  }
  return parseTseSessionDate(cursor);
}

async function loadResistanceEvidence(
  anchor: StrategyValidationCampaignAnchorV1,
  repository: AnalysisSnapshotRepository,
): Promise<CampaignResistanceEvidenceV1> {
  if (anchor.resistanceEvidence.length === 0) {
    return Object.freeze({ state: 'available', levels: Object.freeze([]) });
  }
  const byPrice = new Map<number, Set<SnapshotDigest>>();
  try {
    for (const reference of anchor.resistanceEvidence) {
      const snapshot = await repository.loadHistory(anchor.ticker, reference.snapshotId);
      const digest = digestValidatedAnalysisSnapshot(snapshot);
      const generatedTokyoDate = tokyoDateFromUtcInstantV1(snapshot.generatedAt);
      const strategy = snapshot.strategy;
      if (Date.parse(snapshot.generatedAt) > Date.parse(tokyoEndOfDayV1(anchor.anchorDate))
        || strategy === null
        || strategy.dataDate !== anchor.anchorDate
        || anchor.anchorDate > generatedTokyoDate) {
        throw new TypeError('Resistance evidence identity is invalid.');
      }
      const prices = strategy.candidates
        .filter(candidate => candidate.target.reason === 'resistance_level')
        .map(candidate => candidate.target.price);
      if (prices.length === 0) throw new TypeError('Resistance evidence has no persisted level.');
      const normalized = normalizeStrategyValidationResistanceLevelsV1(prices);
      for (const price of normalized) {
        const digests = byPrice.get(price) ?? new Set<SnapshotDigest>();
        digests.add(digest);
        byPrice.set(price, digests);
      }
    }
    const levels = normalizeStrategyValidationResistanceLevelsV1([...byPrice.keys()]).map(price => (
      Object.freeze({
        price,
        snapshotDigests: Object.freeze([...byPrice.get(price)!].sort()),
      })
    ));
    return Object.freeze({ state: 'available', levels: Object.freeze(levels) });
  } catch (error) {
    if (error instanceof AnalysisSnapshotPersistenceError
      && error.kind === 'filesystem_error') throw error;
    return Object.freeze({ state: 'unavailable', reason: 'resistance_evidence_invalid' });
  }
}

function estimatedMinimumAttempts(
  anchors: readonly CampaignReconstructionAnchorPreflightV1[],
): number {
  const valid = anchors.filter(anchor => anchor.resistanceEvidence.state === 'available');
  const anchorDates = new Set(valid.map(anchor => anchor.anchorDate));
  // One shared calendar plans the frozen outcome boundary and each 251-session start.
  return 1 + anchorDates.size + valid.length;
}

export async function createCampaignReconstructionPreflightV1(
  manifestValue: StrategyValidationCampaignManifestV1,
  options: CampaignReconstructionPreflightOptionsV1,
): Promise<CampaignReconstructionPreflightV1> {
  const input = validateStrategyValidationInputV1({ mode: 'campaign', manifest: manifestValue });
  if (input.mode !== 'campaign') throw new TypeError('Expected campaign validation input.');
  const startedAt = parseAsOfCutoff(options.startedAt ?? new Date().toISOString());
  const requestsPerMinute = options.requestsPerMinute
    ?? resolveJQuantsRequestsPerMinuteV1();
  const anchors = await Promise.all(input.manifest.anchors.map(async anchor => Object.freeze({
    ticker: anchor.ticker,
    anchorDate: parseTseSessionDate(anchor.anchorDate),
    resistanceEvidence: await loadResistanceEvidence(anchor, options.snapshotRepository),
  })));
  const earliestAnchor = anchors.reduce((value, anchor) => earlier(value, anchor.anchorDate), anchors[0]!.anchorDate);
  const latestAnchor = anchors.reduce((value, anchor) => later(value, anchor.anchorDate), anchors[0]!.anchorDate);
  const startedTokyoDate = parseTseSessionDate(tokyoDateFromUtcInstantV1(startedAt));
  const manifestDigest = digestStrategyValidationCampaignManifestV1(input.manifest);
  return Object.freeze({
    mode: 'campaign',
    manifest: input.manifest,
    selector: Object.freeze({ mode: 'campaign', manifestDigest }),
    startedAt,
    anchors: Object.freeze(anchors),
    calendarDateFrom: lookback(earliestAnchor),
    calendarDateTo: later(latestAnchor, startedTokyoDate),
    executionPlan: planJQuantsExecutionV1(
      estimatedMinimumAttempts(anchors),
      requestsPerMinute,
    ),
  });
}

export function selectCampaignCandidateSessionsV1(
  calendar: TseSessionCalendarV1,
  anchorDateValue: unknown,
): readonly TseSessionDate[] {
  const anchorDate = parseTseSessionDate(anchorDateValue);
  if (!calendar.isSession(anchorDate)) {
    throw new PointInTimeErrorV1('calendar_incomplete', 'The campaign anchor is not an official TSE session.');
  }
  const sessions = calendar.sessions.filter(date => date <= anchorDate)
    .slice(-CAMPAIGN_TECHNICAL_SESSION_COUNT_V1);
  if (sessions.length !== CAMPAIGN_TECHNICAL_SESSION_COUNT_V1
    || sessions.at(-1) !== anchorDate) {
    throw new PointInTimeErrorV1('calendar_incomplete', 'The exact 251-session campaign window is unavailable.');
  }
  return Object.freeze(sessions);
}

type ReconstructedCampaignCandidateV1 = Readonly<{
  candidate: StrategyOutcomeCandidateV1;
  resistanceEvidenceTier: 'none' | 'precommitted_source_unknown';
  resistanceEvidenceSnapshotDigests: readonly SnapshotDigest[];
}>;

export function reconstructCampaignCandidatesV1(input: Readonly<{
  ticker: string;
  anchorDate: TseSessionDate;
  sessions: readonly TseSessionDate[];
  bars: readonly TseDailyBarV1[];
  master: JQuantsMasterResultV1;
  resistanceEvidence: Extract<CampaignResistanceEvidenceV1, { state: 'available' }>;
}>): Readonly<{
  state: 'available';
  candidates: readonly ReconstructedCampaignCandidateV1[];
}> | Readonly<{
  state: 'unavailable';
  reason: CampaignAnchorUnavailableReasonV1;
}> {
  if (input.sessions.length !== CAMPAIGN_TECHNICAL_SESSION_COUNT_V1
    || input.sessions.at(-1) !== input.anchorDate) {
    return Object.freeze({ state: 'unavailable', reason: 'price_history_incomplete' });
  }
  let requiredBars: readonly TseDailyBarV1[];
  try {
    requiredBars = requireDailyBarsForSessionsV1(input.bars, input.sessions);
  } catch (error) {
    if (error instanceof PointInTimeErrorV1 && error.code === 'price_history_incomplete') {
      return Object.freeze({ state: 'unavailable', reason: 'price_history_incomplete' });
    }
    throw error;
  }
  if (requiredBars.some(bar => bar.open === null || bar.high === null
    || bar.low === null || bar.close === null)) {
    return Object.freeze({ state: 'unavailable', reason: 'invalid_candidate' });
  }
  const technical = analyzeTechnical(adjustDailyBarsToT0V1(requiredBars, input.anchorDate));
  if (technical.dataDate !== input.anchorDate
    || technical.latestSwingHigh === null
    || technical.latestSwingLow === null
    || technical.atr14 === null) {
    return Object.freeze({ state: 'unavailable', reason: 'invalid_candidate' });
  }
  if (input.master.state === 'unavailable') {
    return Object.freeze({ state: 'unavailable', reason: input.master.reason });
  }
  const category = input.master.observation.tickCategory;
  const categories = category === null ? [] : [category];
  const entryQuote = nextTseQuoteAboveV1(input.anchorDate, categories, technical.latestSwingHigh);
  if (entryQuote.state === 'unavailable') {
    return Object.freeze({ state: 'unavailable', reason: entryQuote.reason });
  }
  const rawLevels = input.resistanceEvidence.levels.map(level => level.price);
  const strategy = analyzeStrategy(technical, {
    tickSize: entryQuote.tick,
    resistanceLevels: rawLevels,
  });
  if (strategy.entry?.price !== entryQuote.price || strategy.candidates.length === 0) {
    return Object.freeze({ state: 'unavailable', reason: 'invalid_candidate' });
  }
  const digestsByTarget = new Map<number, Set<SnapshotDigest>>();
  for (const level of input.resistanceEvidence.levels) {
    const mapped = analyzeStrategy(technical, {
      tickSize: entryQuote.tick,
      resistanceLevels: [level.price],
    }).candidates.filter(candidate => candidate.target.reason === 'resistance_level');
    for (const candidate of mapped) {
      const digests = digestsByTarget.get(candidate.target.price) ?? new Set<SnapshotDigest>();
      for (const digest of level.snapshotDigests) digests.add(digest);
      digestsByTarget.set(candidate.target.price, digests);
    }
  }
  const candidates = strategy.candidates.map(candidate => {
    const normalized: StrategyOutcomeCandidateV1 = Object.freeze({
      entry: Object.freeze({ price: candidate.entry.price, reason: candidate.entry.reason }),
      stop: Object.freeze({ ...candidate.stop }),
      target: Object.freeze({ ...candidate.target }),
    });
    const resistance = candidate.target.reason === 'resistance_level';
    return Object.freeze({
      candidate: normalized,
      resistanceEvidenceTier: resistance ? 'precommitted_source_unknown' : 'none',
      resistanceEvidenceSnapshotDigests: resistance
        ? Object.freeze([...(digestsByTarget.get(candidate.target.price) ?? [])].sort())
        : Object.freeze([]),
    });
  });
  if (candidates.some(candidate => candidate.candidate.target.reason === 'resistance_level'
    && candidate.resistanceEvidenceSnapshotDigests.length === 0)) {
    return Object.freeze({ state: 'unavailable', reason: 'resistance_evidence_invalid' });
  }
  return Object.freeze({ state: 'available', candidates: Object.freeze(candidates) });
}

function sourceReference(
  role: PointInTimeSourceManifestReferenceV1['role'],
  source: PointInTimeSourceEnvelopeV1,
): PointInTimeSourceManifestReferenceV1 {
  return Object.freeze({ role, digest: source.digest });
}

function addSource(
  sources: Map<SnapshotDigest, PointInTimeSourceEnvelopeV1>,
  source: PointInTimeSourceEnvelopeV1,
): void {
  sources.set(source.digest, source);
}

function manifest(
  preflight: CampaignReconstructionPreflightV1,
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
  preflight: CampaignReconstructionPreflightV1,
  anchor: CampaignReconstructionAnchorPreflightV1,
  runId: string,
  outcomeAsOfSession: OutcomeAsOfSession,
  reason: CampaignAnchorUnavailableReasonV1,
  references: readonly PointInTimeSourceManifestReferenceV1[],
): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: createStrategyValidationCaseIdV1(),
    runId,
    mode: 'campaign',
    confidence: 'reconstructed_251_as_of',
    ticker: anchor.ticker,
    anchorDate: anchor.anchorDate,
    decisionDate: anchor.anchorDate,
    strategyDataDate: null,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
    startedAt: preflight.startedAt,
    outcomeAsOfSession,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: manifest(preflight, outcomeAsOfSession, references),
    caseKind: 'anchor_unavailable',
    unavailableReason: reason,
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
  master: JQuantsMasterResultV1,
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
  if (master.state === 'unavailable') {
    return Object.freeze({
      effectiveDate: date,
      category: null,
      unavailableReason: master.reason,
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
  const unavailable = Object.values(results).find(result => result.state === 'unavailable');
  if (unavailable?.state === 'unavailable') {
    return Object.freeze({
      effectiveDate: date,
      category,
      unavailableReason: unavailable.reason,
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

function tickCategoryEvidence(result: JQuantsMasterResultV1): StrategyTickCategoryEvidenceV1 | null {
  if (result.state === 'unavailable') return null;
  return Object.freeze({
    date: result.observation.date,
    categories: Object.freeze(result.observation.tickCategory === null
      ? []
      : [result.observation.tickCategory]),
  });
}

function unavailableOutcome(
  candidate: StrategyOutcomeCandidateV1,
  reason: Exclude<
    Extract<StrategyOutcomeResultV1, { kind: 'unavailable' }>['reason'],
    'limit_queue_ambiguous'
  >,
  evaluationEndDate: TseSessionDate | null = null,
): StrategyOutcomeResultV1 {
  return Object.freeze({
    algorithmVersion: STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
    limitQueueVersion: STRATEGY_LIMIT_QUEUE_VERSION_V1,
    plannedRisk: candidate.stop.price < candidate.entry.price
      && candidate.entry.price < candidate.target.price
      ? candidate.entry.price - candidate.stop.price
      : null,
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

function firstOutcomeSessions(
  calendar: TseSessionCalendarV1,
  decisionDate: TseSessionDate,
  outcomeAsOfSession: OutcomeAsOfSession,
): readonly TseSessionDate[] {
  return Object.freeze(calendar.sessions
    .filter(date => date > decisionDate && date <= outcomeAsOfSession)
    .slice(0, STRATEGY_WORST_CASE_EVALUATION_SESSION_V1));
}

function candidateCase(
  preflight: CampaignReconstructionPreflightV1,
  anchor: CampaignReconstructionAnchorPreflightV1,
  runId: string,
  outcomeAsOfSession: OutcomeAsOfSession,
  assigned: AssignedCampaignCandidateIdentityV1,
  tickEvidence: StrategyValidationCandidateCaseV1['tickEvidence'],
  outcome: StrategyOutcomeResultV1,
  references: readonly PointInTimeSourceManifestReferenceV1[],
): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: createStrategyValidationCaseIdV1(),
    runId,
    mode: 'campaign',
    confidence: 'reconstructed_251_as_of',
    ticker: anchor.ticker,
    anchorDate: anchor.anchorDate,
    decisionDate: anchor.anchorDate,
    strategyDataDate: null,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
    startedAt: preflight.startedAt,
    outcomeAsOfSession,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: manifest(preflight, outcomeAsOfSession, references),
    caseKind: 'candidate',
    candidateIdentityVersion: 'campaign_candidate_identity_v1',
    candidateId: assigned.candidateId,
    duplicateOrdinal: assigned.duplicateOrdinal,
    candidate: assigned.candidate,
    tickEvidence,
    resistanceEvidenceTier: assigned.resistanceEvidenceTier,
    resistanceEvidenceSnapshotDigests: assigned.resistanceEvidenceSnapshotDigests,
    outcome,
  });
}

async function collectCandidateCases(
  preflight: CampaignReconstructionPreflightV1,
  anchor: CampaignReconstructionAnchorPreflightV1,
  runId: string,
  outcomeAsOfSession: OutcomeAsOfSession,
  outcomeCalendar: TseSessionCalendarV1,
  outcomeCalendarEnvelope: PointInTimeSourceEnvelopeV1,
  candidateCalendarEnvelope: PointInTimeSourceEnvelopeV1,
  candidateDailyEnvelope: PointInTimeSourceEnvelopeV1,
  master: JQuantsMasterResultV1,
  reconstructed: readonly ReconstructedCampaignCandidateV1[],
  options: CampaignReconstructionExecutionOptionsV1,
  sources: Map<SnapshotDigest, PointInTimeSourceEnvelopeV1>,
): Promise<readonly StrategyValidationCaseV1[]> {
  const assigned = assignCampaignCandidateIdentitiesV1(reconstructed.map(value => ({
    ticker: anchor.ticker,
    anchorDate: anchor.anchorDate,
    resistanceEvidenceTier: value.resistanceEvidenceTier,
    resistanceEvidenceSnapshotDigests: value.resistanceEvidenceSnapshotDigests,
    candidate: value.candidate,
  })));
  const initial = assigned.map(value => ({
    assigned: value,
    tickEvidence: initialTickEvidence(value.candidate, anchor.anchorDate, master),
  }));
  const outcomeReady = initial.filter(value => value.tickEvidence.unavailableReason === null
    && Object.values(value.tickEvidence.levels).every(level => level.executable === true));
  const outcomeSessions = firstOutcomeSessions(outcomeCalendar, anchor.anchorDate, outcomeAsOfSession);
  let dailyResult: JQuantsDailyBarsResultV1 | null = null;
  if (outcomeReady.length > 0 && outcomeSessions.length > 0) {
    dailyResult = await options.source.fetchDailyBars({
      ticker: anchor.ticker,
      dateFrom: outcomeSessions[0]!,
      dateTo: outcomeSessions.at(-1)!,
      asOfCutoff: preflight.startedAt,
      signal: options.signal,
    });
    addSource(sources, dailyResult.envelope);
  }
  const outcomeMasterByDate = new Map<string, JQuantsMasterResultV1>();
  const built: StrategyValidationCaseV1[] = [];
  for (const value of initial) {
    const references: PointInTimeSourceManifestReferenceV1[] = [
      sourceReference('candidate_calendar', candidateCalendarEnvelope),
      sourceReference('candidate_master', master.envelope),
      sourceReference('candidate_daily_bars', candidateDailyEnvelope),
      sourceReference('outcome_calendar', outcomeCalendarEnvelope),
    ];
    let outcome: StrategyOutcomeResultV1;
    if (value.tickEvidence.unavailableReason !== null
      || Object.values(value.tickEvidence.levels).some(level => level.executable === false)) {
      outcome = validateLongStrategyOutcomeV1({
        candidate: value.assigned.candidate,
        decisionDate: anchor.anchorDate,
        outcomeAsOfSession,
        initialTickDate: anchor.anchorDate,
        tickCategoryEvidence: [tickCategoryEvidence(master)!],
        calendar: outcomeCalendar,
        bars: [],
      });
    } else {
      if (outcomeSessions.length === 0) {
        outcome = validateLongStrategyOutcomeV1({
          candidate: value.assigned.candidate,
          decisionDate: anchor.anchorDate,
          outcomeAsOfSession,
          initialTickDate: anchor.anchorDate,
          tickCategoryEvidence: [tickCategoryEvidence(master)!],
          calendar: outcomeCalendar,
          bars: [],
        });
      } else if (dailyResult === null) {
        throw new TypeError('Campaign outcome daily-bar collection was not completed.');
      } else if (dailyResult.state === 'unavailable') {
        references.push(sourceReference('outcome_daily_bars', dailyResult.envelope));
        const replayed = validateLongStrategyOutcomeV1({
          candidate: value.assigned.candidate,
          decisionDate: anchor.anchorDate,
          outcomeAsOfSession,
          initialTickDate: anchor.anchorDate,
          tickCategoryEvidence: [tickCategoryEvidence(master)!],
          calendar: outcomeCalendar,
          bars: [],
        });
        outcome = replayed.kind === 'unavailable'
          ? replaceUnavailableReason(replayed, dailyResult.reason)
          : unavailableOutcome(value.assigned.candidate, dailyResult.reason);
      } else {
        references.push(sourceReference('outcome_daily_bars', dailyResult.envelope));
        const masterEvidence: StrategyTickCategoryEvidenceV1[] = [tickCategoryEvidence(master)!];
        const masterReferences = new Map<string, PointInTimeSourceManifestReferenceV1>();
        while (true) {
          outcome = validateLongStrategyOutcomeV1({
            candidate: value.assigned.candidate,
            decisionDate: anchor.anchorDate,
            outcomeAsOfSession,
            initialTickDate: anchor.anchorDate,
            tickCategoryEvidence: [...masterEvidence].sort((left, right) => (
              left.date < right.date ? -1 : left.date > right.date ? 1 : 0
            )),
            calendar: outcomeCalendar,
            bars: dailyResult.bars,
          });
          if (outcome.kind !== 'unavailable'
            || outcome.reason !== 'tick_category_unavailable'
            || outcome.evaluationEndDate === null) break;
          const date = outcome.evaluationEndDate;
          const existing = outcomeMasterByDate.get(date);
          const datedMaster = existing ?? await options.source.fetchMaster({
            ticker: anchor.ticker,
            date,
            asOfCutoff: preflight.startedAt,
            signal: options.signal,
          });
          if (existing === undefined) {
            outcomeMasterByDate.set(date, datedMaster);
            addSource(sources, datedMaster.envelope);
          }
          masterReferences.set(date, sourceReference('outcome_master', datedMaster.envelope));
          if (datedMaster.state === 'unavailable') {
            outcome = replaceUnavailableReason(outcome, datedMaster.reason);
            break;
          }
          if (masterEvidence.some(evidence => evidence.date === date)) break;
          masterEvidence.push(tickCategoryEvidence(datedMaster)!);
        }
        references.push(...masterReferences.values());
      }
    }
    built.push(candidateCase(
      preflight,
      anchor,
      runId,
      outcomeAsOfSession,
      value.assigned,
      value.tickEvidence,
      outcome,
      references,
    ));
  }
  return Object.freeze(built);
}

export async function executeCampaignReconstructionV1(
  preflight: CampaignReconstructionPreflightV1,
  options: CampaignReconstructionExecutionOptionsV1,
): Promise<CampaignReconstructionExecutionResultV1> {
  if (options.accepted.controls !== preflight.executionPlan
    && JSON.stringify(options.accepted.controls) !== JSON.stringify(preflight.executionPlan)) {
    throw new TypeError('Accepted execution controls differ from the campaign preflight.');
  }
  options.runtime.assertCanContinue(options.signal);
  const runId = options.runId ?? createStrategyValidationRunIdV1();
  const sources = new Map<SnapshotDigest, PointInTimeSourceEnvelopeV1>();
  const globalCalendarResult = await options.source.fetchCalendar({
    dateFrom: preflight.calendarDateFrom,
    dateTo: preflight.calendarDateTo,
    asOfCutoff: preflight.startedAt,
    signal: options.signal,
  });
  if (globalCalendarResult.state === 'unavailable') {
    if (globalCalendarResult.reason === 'calendar_incomplete') {
      throw new PointInTimeErrorV1(
        'calendar_incomplete',
        'The official calendar cannot derive the campaign outcome boundary.',
      );
    }
    throw new JQuantsValidationErrorV1(
      globalCalendarResult.reason,
      'The official calendar cannot derive the campaign outcome boundary.',
    );
  }
  addSource(sources, globalCalendarResult.envelope);
  const outcomeAsOfSession = deriveOutcomeAsOfSessionV1(
    globalCalendarResult.calendar,
    preflight.startedAt,
  );
  await options.onOutcomeAsOfSession?.(outcomeAsOfSession);
  const outcomeCalendarReference = sourceReference(
    'outcome_calendar', globalCalendarResult.envelope,
  );
  const cases: StrategyValidationCaseV1[] = [];

  for (const anchor of preflight.anchors) {
    options.runtime.assertCanContinue(options.signal);
    const sessions = selectCampaignCandidateSessionsV1(
      globalCalendarResult.calendar,
      anchor.anchorDate,
    );
    if (anchor.resistanceEvidence.state === 'unavailable') {
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        anchor.resistanceEvidence.reason,
        [outcomeCalendarReference],
      ));
      continue;
    }
    const candidateCalendarResult = await options.source.fetchCalendar({
      dateFrom: sessions[0]!,
      dateTo: anchor.anchorDate,
      asOfCutoff: tokyoEndOfDayV1(anchor.anchorDate),
      signal: options.signal,
    });
    addSource(sources, candidateCalendarResult.envelope);
    const candidateCalendarReference = sourceReference(
      'candidate_calendar', candidateCalendarResult.envelope,
    );
    if (candidateCalendarResult.state === 'unavailable') {
      if (candidateCalendarResult.reason === 'calendar_incomplete') {
        cases.push(anchorUnavailableCase(
          preflight,
          anchor,
          runId,
          outcomeAsOfSession,
          'calendar_incomplete',
          [candidateCalendarReference, outcomeCalendarReference],
        ));
        continue;
      }
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        candidateCalendarResult.reason,
        [candidateCalendarReference, outcomeCalendarReference],
      ));
      continue;
    }
    const exactSessions = candidateCalendarResult.calendar.sessions;
    if (exactSessions.length !== CAMPAIGN_TECHNICAL_SESSION_COUNT_V1
      || exactSessions.at(-1) !== anchor.anchorDate) {
      throw new PointInTimeErrorV1(
        'calendar_incomplete',
        'The exact campaign calendar window does not contain 251 sessions.',
      );
    }
    const candidateDailyResult = await options.source.fetchDailyBars({
      ticker: anchor.ticker,
      dateFrom: exactSessions[0]!,
      dateTo: anchor.anchorDate,
      asOfCutoff: tokyoEndOfDayV1(anchor.anchorDate),
      signal: options.signal,
    });
    addSource(sources, candidateDailyResult.envelope);
    const candidateDailyReference = sourceReference(
      'candidate_daily_bars', candidateDailyResult.envelope,
    );
    if (candidateDailyResult.state === 'unavailable') {
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        candidateDailyResult.reason,
        [candidateCalendarReference, candidateDailyReference, outcomeCalendarReference],
      ));
      continue;
    }
    let normalizedBars: readonly TseDailyBarV1[];
    try {
      normalizedBars = requireDailyBarsForSessionsV1(candidateDailyResult.bars, exactSessions);
    } catch (error) {
      if (!(error instanceof PointInTimeErrorV1) || error.code !== 'price_history_incomplete') {
        throw error;
      }
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        'price_history_incomplete',
        [candidateCalendarReference, candidateDailyReference, outcomeCalendarReference],
      ));
      continue;
    }
    const barsHaveOhlc = normalizedBars.every(bar => bar.open !== null && bar.high !== null
      && bar.low !== null && bar.close !== null);
    if (!barsHaveOhlc) {
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        'invalid_candidate',
        [candidateCalendarReference, candidateDailyReference, outcomeCalendarReference],
      ));
      continue;
    }
    const technical = analyzeTechnical(adjustDailyBarsToT0V1(normalizedBars, anchor.anchorDate));
    if (technical.latestSwingHigh === null || technical.latestSwingLow === null
      || technical.atr14 === null) {
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        'invalid_candidate',
        [candidateCalendarReference, candidateDailyReference, outcomeCalendarReference],
      ));
      continue;
    }
    const master = await options.source.fetchMaster({
      ticker: anchor.ticker,
      date: anchor.anchorDate,
      asOfCutoff: tokyoEndOfDayV1(anchor.anchorDate),
      signal: options.signal,
    });
    addSource(sources, master.envelope);
    const masterReference = sourceReference('candidate_master', master.envelope);
    const reconstructed = reconstructCampaignCandidatesV1({
      ticker: anchor.ticker,
      anchorDate: anchor.anchorDate,
      sessions: exactSessions,
      bars: normalizedBars,
      master,
      resistanceEvidence: anchor.resistanceEvidence,
    });
    if (reconstructed.state === 'unavailable') {
      cases.push(anchorUnavailableCase(
        preflight,
        anchor,
        runId,
        outcomeAsOfSession,
        reconstructed.reason,
        [
          candidateCalendarReference,
          masterReference,
          candidateDailyReference,
          outcomeCalendarReference,
        ],
      ));
      continue;
    }
    cases.push(...await collectCandidateCases(
      preflight,
      anchor,
      runId,
      outcomeAsOfSession,
      globalCalendarResult.calendar,
      globalCalendarResult.envelope,
      candidateCalendarResult.envelope,
      candidateDailyResult.envelope,
      master,
      reconstructed.candidates,
      options,
      sources,
    ));
  }

  await options.onValidating?.(Object.freeze({
    outcomeAsOfSession,
    caseCount: cases.length,
    attemptCount: options.runtime.attempts.length,
  }));
  options.runtime.assertCanContinue(options.signal);
  const anchorIdentities = preflight.anchors.map(anchor => ({
    ticker: anchor.ticker,
    anchorDate: anchor.anchorDate,
  }));
  const aggregationScope = buildStrategyValidationAggregationScopeV1('campaign', anchorIdentities);
  const aggregation = aggregateStrategyValidationCasesV1(
    aggregationScope,
    anchorIdentities,
    cases,
  );
  const sortedCases = [...cases].sort(compareStrategyValidationCasesV1);
  const completedAt = options.runtime.nowUtc();
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(options.accepted.acceptedAt));
  const run = StrategyValidationRunV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_RUN_SCHEMA_VERSION,
    runId,
    mode: 'campaign',
    confidence: 'reconstructed_251_as_of',
    campaignName: preflight.manifest.name,
    startedAt: preflight.startedAt,
    acceptedAt: options.accepted.acceptedAt,
    executionDeadline: options.accepted.executionDeadline,
    completedAt,
    outcomeAsOfSession,
    selector: preflight.selector,
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
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
    warnings: [CAMPAIGN_RECONSTRUCTION_WARNING_V1],
  });
  const referenced = new Set(cases.flatMap(value => (
    value.sourceManifest.sources.map(reference => reference.digest)
  )));
  const publicationSources = [...sources.values()].filter(source => referenced.has(source.digest));
  const published = await options.runRepository.publish({
    run,
    cases,
    sources: publicationSources,
  }, {
    assertCanPromote: () => options.runtime.assertCanContinue(options.signal),
    beforePromote: options.beforePromote,
  });
  return Object.freeze({
    state: 'created',
    runId: published.runId,
    runPayloadDigest: published.runPayloadDigest,
    caseCount: cases.length,
    attemptCount: options.runtime.attempts.length,
  });
}

export function createCampaignReconstructionSourceV1(
  runtime: JQuantsExecutionRuntimeV1,
): CampaignReconstructionSourceV1 {
  return new JQuantsValidationAdapterV1(runtime);
}
