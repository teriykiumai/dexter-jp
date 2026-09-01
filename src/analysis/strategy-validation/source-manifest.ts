import { z } from 'zod';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import {
  canonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import {
  isStrictGregorianDate,
  parseAsOfCutoff,
  parseTseSessionDate,
  tokyoEndOfDayV1,
  type OutcomeAsOfSession,
} from './date.js';
import {
  createTseSessionCalendarV1,
  deriveOutcomeAsOfSessionV1,
} from './calendar.js';
import { parseDailyBarV1, type TseDailyBarV1 } from './daily-bar.js';
import {
  STRATEGY_WORST_CASE_EVALUATION_SESSION_V1,
  resolveLongStrategyInitialFailureWithoutMasterV1,
  validateLongStrategyOutcomeV1,
  type StrategyOutcomeCandidateV1,
  type StrategyOutcomeResultV1,
  type StrategyTickCategoryEvidenceV1,
} from './outcome-validator.js';
import {
  isExecutableTsePriceV1,
  jQuantsScaleCategoryToTseTickCategoryV1,
  type TseTickCategoryV1,
} from './tick.js';
import type {
  PointInTimeSourceEnvelopeV1,
  PointInTimeSourceUnavailableReasonV1,
} from './source-envelope.js';

export const POINT_IN_TIME_SOURCE_MANIFEST_VERSION =
  'point_in_time_source_manifest_v1' as const;
export const STRATEGY_VALIDATION_SOURCE_ROLE_VERSION =
  'strategy_validation_source_role_v1' as const;

export const STRATEGY_VALIDATION_SOURCE_ROLES_V1 = Object.freeze([
  'candidate_calendar',
  'candidate_master',
  'candidate_daily_bars',
  'outcome_calendar',
  'outcome_master',
  'outcome_daily_bars',
] as const);
export type StrategyValidationSourceRoleV1 =
  (typeof STRATEGY_VALIDATION_SOURCE_ROLES_V1)[number];

const SOURCE_FAILURE_REASONS_V1 = Object.freeze([
  'source_plan_unavailable',
  'source_history_unavailable',
  'source_response_invalid',
] as const);
type SourceFailureReasonV1 = (typeof SOURCE_FAILURE_REASONS_V1)[number];

function isSourceFailureReasonV1(value: unknown): value is SourceFailureReasonV1 {
  return SOURCE_FAILURE_REASONS_V1.includes(value as SourceFailureReasonV1);
}

const roleOrder = new Map<StrategyValidationSourceRoleV1, number>(
  STRATEGY_VALIDATION_SOURCE_ROLES_V1.map((role, index) => [role, index]),
);
const canonicalUtcInstant = z.string().refine(value => {
  try {
    return parseAsOfCutoff(value) === value;
  } catch {
    return false;
  }
});
const strictDate = z.string().refine(isStrictGregorianDate);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const PointInTimeSourceManifestReferenceV1Schema = z.object({
  role: z.enum(STRATEGY_VALIDATION_SOURCE_ROLES_V1),
  digest,
}).strict();

export const PointInTimeSourceManifestV1Schema = z.object({
  schemaVersion: z.literal(POINT_IN_TIME_SOURCE_MANIFEST_VERSION),
  roleVersion: z.literal(STRATEGY_VALIDATION_SOURCE_ROLE_VERSION),
  startedAt: canonicalUtcInstant,
  outcomeAsOfSession: strictDate.nullable(),
  sources: z.array(PointInTimeSourceManifestReferenceV1Schema).max(250),
}).strict().superRefine((value, context) => {
  const hasCalendarIncompleteBoundaryShape = value.sources.length === 1
    && value.sources[0]!.role === 'candidate_calendar';
  if (value.outcomeAsOfSession === null
    && value.sources.length !== 0
    && !hasCalendarIncompleteBoundaryShape) {
    context.addIssue({
      code: 'custom',
      message: 'A null outcome boundary permits only one candidate-calendar reference.',
    });
    return;
  }
  const digests = new Set<string>();
  for (let index = 0; index < value.sources.length; index += 1) {
    const current = value.sources[index]!;
    if (digests.has(current.digest)) {
      context.addIssue({ code: 'custom', message: 'Source-manifest digests must be unique.' });
      return;
    }
    digests.add(current.digest);
    if (index === 0) continue;
    const previous = value.sources[index - 1]!;
    const roleComparison = roleOrder.get(previous.role)! - roleOrder.get(current.role)!;
    if (roleComparison > 0
      || (roleComparison === 0 && previous.digest >= current.digest)) {
      context.addIssue({
        code: 'custom', message: 'Source-manifest references are not canonically ordered.',
      });
      return;
    }
  }
});

export type PointInTimeSourceManifestReferenceV1 = z.infer<
  typeof PointInTimeSourceManifestReferenceV1Schema
>;
export type PointInTimeSourceManifestV1 = z.infer<typeof PointInTimeSourceManifestV1Schema>;

export function createPointInTimeSourceManifestV1(input: Readonly<{
  startedAt: string;
  outcomeAsOfSession: string | null;
  sources: readonly PointInTimeSourceManifestReferenceV1[];
}>): PointInTimeSourceManifestV1 {
  return PointInTimeSourceManifestV1Schema.parse({
    schemaVersion: POINT_IN_TIME_SOURCE_MANIFEST_VERSION,
    roleVersion: STRATEGY_VALIDATION_SOURCE_ROLE_VERSION,
    startedAt: input.startedAt,
    outcomeAsOfSession: input.outcomeAsOfSession,
    sources: [...input.sources].sort((left, right) => (
      roleOrder.get(left.role)! - roleOrder.get(right.role)!
      || (left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0)
    )),
  });
}

export type StrategyValidationSourceBindingContextV1 = Readonly<{
  mode: 'snapshot' | 'campaign';
  caseKind: 'anchor_unavailable' | 'candidate';
  ticker: string;
  anchorDate: string;
  decisionDate: string;
  strategyDataDate: string | null;
  initialTickDate: string | null;
  startedAt: string;
  outcomeAsOfSession: string | null;
}>;

export type StrategyValidationInitialTickEvidenceContextV1 = Readonly<{
  effectiveDate: string;
  category: TseTickCategoryV1 | null;
  unavailableReason:
    | 'source_plan_unavailable'
    | 'source_history_unavailable'
    | 'source_response_invalid'
    | 'tick_rule_period_unsupported'
    | 'tick_category_unavailable'
    | 'invalid_candidate'
    | null;
  levels: Readonly<{
    entry: Readonly<{ price: number; tick: number | null; executable: boolean | null }>;
    stop: Readonly<{ price: number; tick: number | null; executable: boolean | null }>;
    target: Readonly<{ price: number; tick: number | null; executable: boolean | null }>;
  }>;
}>;

export type StrategyValidationSourceCompletenessContextV1 = Readonly<{
  mode: 'snapshot' | 'campaign';
  caseKind: 'anchor_unavailable' | 'candidate';
  ticker: string;
  anchorDate: string;
  decisionDate: string;
  strategyDataDate: string | null;
  initialTickDate: string | null;
  startedAt: string;
  outcomeAsOfSession: string;
  entryWaitSessions: number;
  holdingSessions: number;
  unavailableReason: string | null;
  candidate: StrategyOutcomeCandidateV1 | null;
  persistedOutcome: StrategyOutcomeResultV1 | null;
  initialTickEvidence: StrategyValidationInitialTickEvidenceContextV1 | null;
  outcome: Readonly<{
    kind: string;
    unavailableReason: string | null;
    evaluationEndDate: string | null;
    tickEvidenceDates: readonly string[];
    sessionFacts: readonly Readonly<{ date: string; evaluationSession: number }>[];
    horizonDates: readonly string[];
    terminalCompletionDate: string | null;
  }> | null;
}>;

export type BoundStrategyValidationSourceV1 = Readonly<{
  reference: PointInTimeSourceManifestReferenceV1;
  envelope: PointInTimeSourceEnvelopeV1;
}>;

function failBinding(): never {
  throw new TypeError('A source-manifest role does not match its envelope or case.');
}

function failCompleteness(): never {
  throw new TypeError('A source manifest is incomplete for its case stage or result.');
}

function expectedEndpoint(role: StrategyValidationSourceRoleV1) {
  if (role.endsWith('_calendar')) return '/v2/markets/calendar' as const;
  if (role.endsWith('_master')) return '/v2/equities/master' as const;
  return '/v2/equities/bars/daily' as const;
}

function covers(envelope: PointInTimeSourceEnvelopeV1, date: string): boolean {
  return envelope.request.dateFrom <= date && envelope.request.dateTo >= date;
}

export function validateStrategyValidationSourceBindingV1(
  reference: PointInTimeSourceManifestReferenceV1,
  envelope: PointInTimeSourceEnvelopeV1,
  context: StrategyValidationSourceBindingContextV1,
): void {
  const candidateRole = reference.role.startsWith('candidate_');
  const campaignPlanningRole = context.mode === 'campaign'
    && reference.role === 'outcome_calendar';
  if (reference.digest !== envelope.digest
    || envelope.endpoint !== expectedEndpoint(reference.role)
    || (envelope.endpoint === '/v2/markets/calendar'
      ? envelope.request.ticker !== null
      : envelope.request.ticker !== context.ticker)
    || (context.caseKind === 'anchor_unavailable'
      && !candidateRole
      && !campaignPlanningRole)) {
    failBinding();
  }

  const expectedCutoff = candidateRole && context.mode === 'campaign'
    ? tokyoEndOfDayV1(context.anchorDate)
    : context.startedAt;
  if (envelope.request.asOfCutoff !== expectedCutoff) failBinding();

  switch (reference.role) {
    case 'candidate_calendar': {
      const earliest = [
        context.mode === 'snapshot' && context.strategyDataDate !== null
          ? context.strategyDataDate
          : context.anchorDate,
        context.initialTickDate,
      ].filter((date): date is string => date !== null).sort()[0]!;
      if (!covers(envelope, earliest) || !covers(envelope, context.decisionDate)) failBinding();
      return;
    }
    case 'candidate_master': {
      const expectedDate = context.initialTickDate ?? context.decisionDate;
      if (envelope.request.dateFrom !== expectedDate
        || envelope.request.dateTo !== expectedDate) failBinding();
      return;
    }
    case 'candidate_daily_bars':
      if (context.mode !== 'campaign'
        || envelope.request.dateFrom > context.anchorDate
        || envelope.request.dateTo !== context.anchorDate) failBinding();
      return;
    case 'outcome_calendar': {
      if (context.outcomeAsOfSession === null) failBinding();
      const lastBoundary = context.decisionDate > context.outcomeAsOfSession
        ? context.decisionDate
        : context.outcomeAsOfSession;
      if (!covers(envelope, context.decisionDate) || !covers(envelope, lastBoundary)) failBinding();
      return;
    }
    case 'outcome_master':
      if (context.outcomeAsOfSession === null
        || envelope.request.dateFrom !== envelope.request.dateTo
        || envelope.request.dateFrom <= context.decisionDate
        || envelope.request.dateTo > context.outcomeAsOfSession) failBinding();
      return;
    case 'outcome_daily_bars':
      if (context.outcomeAsOfSession === null
        || envelope.request.dateFrom <= context.decisionDate
        || envelope.request.dateTo > context.outcomeAsOfSession) failBinding();
  }
}

export function validateStrategyValidationSourceCompletenessV1(
  bindings: readonly BoundStrategyValidationSourceV1[],
  context: StrategyValidationSourceCompletenessContextV1,
): void {
  const forRole = (role: StrategyValidationSourceRoleV1) => bindings.filter(
    value => value.reference.role === role,
  );
  const availableForRole = (role: StrategyValidationSourceRoleV1) => forRole(role).filter(
    value => value.envelope.result.state === 'available',
  );
  const unavailableForRole = (role: StrategyValidationSourceRoleV1) => forRole(role).filter(
    value => value.envelope.result.state === 'unavailable',
  );
  const requirePresent = (role: StrategyValidationSourceRoleV1): void => {
    if (forRole(role).length === 0) failCompleteness();
  };
  const exactRowKeys = (
    row: Readonly<Record<string, unknown>>,
    expected: readonly string[],
  ): boolean => Object.keys(row).sort().join('\u0000') === [...expected].sort().join('\u0000');
  const validateAvailableRow = (
    role: StrategyValidationSourceRoleV1,
    envelope: PointInTimeSourceEnvelopeV1,
    row: Readonly<Record<string, unknown>>,
  ): string => {
    const date = row.Date;
    if (typeof date !== 'string' || !isStrictGregorianDate(date) || !covers(envelope, date)) {
      return failCompleteness();
    }
    if (role.endsWith('_calendar')) {
      if (!exactRowKeys(row, ['Date', 'HolDiv'])
        || !['0', '1', '2', '3'].includes(String(row.HolDiv))) failCompleteness();
    } else if (role.endsWith('_master')) {
      if (!exactRowKeys(row, ['Date', 'Code', 'ScaleCat', 'Mkt', 'ProdCat'])
        || row.Code !== toJQuantsSecuritiesCode(context.ticker)
        || (row.ScaleCat !== null && typeof row.ScaleCat !== 'string')
        || typeof row.Mkt !== 'string' || row.Mkt.length === 0
        || row.ProdCat !== '011') failCompleteness();
    } else {
      if (!exactRowKeys(row, [
        'Date', 'Code', 'O', 'H', 'L', 'C', 'UL', 'LL', 'AdjFactor', 'ExRT',
      ]) || row.Code !== toJQuantsSecuritiesCode(context.ticker)) failCompleteness();
      try {
        parseDailyBarV1({
          date: row.Date,
          open: row.O,
          high: row.H,
          low: row.L,
          close: row.C,
          upperLimitFlag: row.UL,
          lowerLimitFlag: row.LL,
          adjustmentFactor: row.AdjFactor,
          exRightsType: row.ExRT,
        });
      } catch {
        return failCompleteness();
      }
    }
    return date;
  };
  const availableDates = (role: StrategyValidationSourceRoleV1): ReadonlySet<string> => {
    const dates = new Set<string>();
    for (const binding of availableForRole(role)) {
      if (binding.envelope.result.state !== 'available') failCompleteness();
      for (const row of binding.envelope.result.rows) {
        const date = validateAvailableRow(role, binding.envelope, row);
        if (dates.has(date)) failCompleteness();
        dates.add(date);
      }
    }
    return dates;
  };
  const requireAvailableDates = (
    role: StrategyValidationSourceRoleV1,
    dates: readonly string[],
  ): void => {
    const available = availableDates(role);
    if (dates.some(date => !available.has(date))) failCompleteness();
  };
  const masterCategoryAt = (
    role: 'candidate_master' | 'outcome_master',
    date: string,
  ): TseTickCategoryV1 | null => {
    let matchingRow: Readonly<Record<string, unknown>> | null = null;
    for (const binding of availableForRole(role)) {
      if (binding.envelope.result.state !== 'available') failCompleteness();
      for (const row of binding.envelope.result.rows) {
        if (validateAvailableRow(role, binding.envelope, row) !== date) continue;
        if (matchingRow !== null) failCompleteness();
        matchingRow = row;
      }
    }
    if (matchingRow === null) return failCompleteness();
    return jQuantsScaleCategoryToTseTickCategoryV1(
      matchingRow.ScaleCat as string | null,
    );
  };
  const requireMatchingUnavailable = (
    roles: readonly StrategyValidationSourceRoleV1[],
    reason: PointInTimeSourceUnavailableReasonV1,
  ): void => {
    if (!roles.some(role => unavailableForRole(role).some(value => (
      value.envelope.result.state === 'unavailable'
      && value.envelope.result.reason === reason
    )))) failCompleteness();
  };
  const verifyInitialTickEvidence = (
    evidence: StrategyValidationInitialTickEvidenceContextV1,
  ): void => {
    if (evidence.effectiveDate !== context.initialTickDate) failCompleteness();
    if (evidence.unavailableReason === 'invalid_candidate') return;
    if (isSourceFailureReasonV1(evidence.unavailableReason)) {
      requireMatchingUnavailable(['candidate_master'], evidence.unavailableReason);
      return;
    }
    requireAvailableDates('candidate_master', [evidence.effectiveDate]);
    const category = masterCategoryAt('candidate_master', evidence.effectiveDate);
    if (category !== evidence.category) failCompleteness();
    const categories = category === null ? [] : [category];
    for (const level of Object.values(evidence.levels)) {
      const result = isExecutableTsePriceV1(evidence.effectiveDate, categories, level.price);
      if (evidence.unavailableReason === null) {
        if (result.state !== 'available'
          || result.tick !== level.tick
          || result.executable !== level.executable) failCompleteness();
      } else if (result.state !== 'unavailable'
        || result.reason !== evidence.unavailableReason
        || level.tick !== null
        || level.executable !== null) failCompleteness();
    }
  };
  const completeCalendar = (role: 'candidate_calendar' | 'outcome_calendar') => {
    const available = availableForRole(role);
    if (available.length !== 1 || available[0]!.envelope.result.state !== 'available') {
      return failCompleteness();
    }
    const envelope = available[0]!.envelope;
    try {
      for (const row of envelope.result.rows) validateAvailableRow(role, envelope, row);
      return createTseSessionCalendarV1(
        envelope.result.rows,
        envelope.request.dateFrom,
        envelope.request.dateTo,
      );
    } catch {
      return failCompleteness();
    }
  };
  const replayCalendar = () => {
    completeCalendar('candidate_calendar');
    completeCalendar('outcome_calendar');
    if (context.initialTickDate === null) return failCompleteness();
    const requiredFrom = [
      context.initialTickDate,
      context.decisionDate,
      context.outcomeAsOfSession,
    ].sort()[0]!;
    const requiredTo = context.decisionDate > context.outcomeAsOfSession
      ? context.decisionDate
      : context.outcomeAsOfSession;
    const rowsByDate = new Map<string, Readonly<{ Date: string; HolDiv: unknown }>>();
    for (const role of ['candidate_calendar', 'outcome_calendar'] as const) {
      for (const binding of availableForRole(role)) {
        if (binding.envelope.result.state !== 'available') failCompleteness();
        for (const row of binding.envelope.result.rows) {
          const date = validateAvailableRow(role, binding.envelope, row);
          if (date < requiredFrom || date > requiredTo) continue;
          const previous = rowsByDate.get(date);
          if (previous !== undefined && previous.HolDiv !== row.HolDiv) failCompleteness();
          rowsByDate.set(date, Object.freeze({ Date: date, HolDiv: row.HolDiv }));
        }
      }
    }
    try {
      return createTseSessionCalendarV1(
        [...rowsByDate.values()].sort((left, right) => left.Date.localeCompare(right.Date)),
        requiredFrom,
        requiredTo,
      );
    } catch {
      return failCompleteness();
    }
  };
  const replayBars = (allowedDates: ReadonlySet<string>): readonly TseDailyBarV1[] => {
    const bars: TseDailyBarV1[] = [];
    const dates = new Set<string>();
    for (const binding of availableForRole('outcome_daily_bars')) {
      if (binding.envelope.result.state !== 'available') failCompleteness();
      for (const row of binding.envelope.result.rows) {
        const date = validateAvailableRow('outcome_daily_bars', binding.envelope, row);
        if (dates.has(date)) failCompleteness();
        dates.add(date);
        if (!allowedDates.has(date)) continue;
        bars.push(parseDailyBarV1({
          date: row.Date,
          open: row.O,
          high: row.H,
          low: row.L,
          close: row.C,
          upperLimitFlag: row.UL,
          lowerLimitFlag: row.LL,
          adjustmentFactor: row.AdjFactor,
          exRightsType: row.ExRT,
        }));
      }
    }
    return Object.freeze(bars.sort((left, right) => left.date.localeCompare(right.date)));
  };
  const replayTickEvidence = (): readonly StrategyTickCategoryEvidenceV1[] => {
    const evidence = new Map<string, StrategyTickCategoryEvidenceV1>();
    for (const role of ['candidate_master', 'outcome_master'] as const) {
      for (const binding of availableForRole(role)) {
        if (binding.envelope.result.state !== 'available') failCompleteness();
        for (const row of binding.envelope.result.rows) {
          const date = validateAvailableRow(role, binding.envelope, row);
          if (evidence.has(date)) failCompleteness();
          const category = jQuantsScaleCategoryToTseTickCategoryV1(
            row.ScaleCat as string | null,
          );
          evidence.set(date, Object.freeze({
            date: parseTseSessionDate(date),
            categories: Object.freeze(category === null ? [] : [category]),
          }));
        }
      }
    }
    return Object.freeze([...evidence.values()].sort((left, right) => (
      left.date.localeCompare(right.date)
    )));
  };
  const replayOutcome = (): StrategyOutcomeResultV1 => {
    if (context.candidate === null
      || context.persistedOutcome === null
      || context.initialTickDate === null
      || context.outcome === null) failCompleteness();
    const calendar = replayCalendar();
    const allowedDates = new Set<string>(calendar.sessions
      .filter(date => date > context.decisionDate && date <= context.outcomeAsOfSession)
      .slice(0, STRATEGY_WORST_CASE_EVALUATION_SESSION_V1));
    return validateLongStrategyOutcomeV1({
      candidate: context.candidate,
      decisionDate: parseTseSessionDate(context.decisionDate),
      outcomeAsOfSession: parseTseSessionDate(
        context.outcomeAsOfSession,
      ) as OutcomeAsOfSession,
      initialTickDate: parseTseSessionDate(context.initialTickDate),
      tickCategoryEvidence: replayTickEvidence(),
      calendar,
      bars: replayBars(allowedDates),
    });
  };
  const requireOutcomeMatch = (replayed: StrategyOutcomeResultV1): void => {
    if (context.persistedOutcome === null) failCompleteness();
    if (canonicalJsonV1(replayed as unknown as CanonicalJsonValue)
      !== canonicalJsonV1(context.persistedOutcome as unknown as CanonicalJsonValue)) {
      failCompleteness();
    }
  };
  const verifyPersistedOutcome = (): void => {
    if (context.outcome === null) failCompleteness();
    requireAvailableDates('outcome_master', context.outcome.tickEvidenceDates);
    requireOutcomeMatch(replayOutcome());
  };
  const requireExactAvailableDates = (
    role: StrategyValidationSourceRoleV1,
    dates: readonly string[],
  ): void => {
    const available = availableDates(role);
    if (available.size !== dates.length || dates.some(date => !available.has(date))) {
      failCompleteness();
    }
  };
  const provesMissingDate = (
    role: StrategyValidationSourceRoleV1,
    date: string,
  ): boolean => forRole(role).some(value => {
    if (!covers(value.envelope, date)) return false;
    if (value.envelope.result.state === 'unavailable') {
      return value.envelope.result.reason === 'price_history_incomplete';
    }
    return !value.envelope.result.rows.some(row => row.Date === date);
  });
  const campaignPlanningSessions = (): readonly string[] => {
    if (context.mode !== 'campaign' || forRole('outcome_calendar').length !== 1) {
      return failCompleteness();
    }
    const calendar = completeCalendar('outcome_calendar');
    let derivedBoundary: string;
    try {
      derivedBoundary = deriveOutcomeAsOfSessionV1(calendar, context.startedAt);
    } catch {
      return failCompleteness();
    }
    if (derivedBoundary !== context.outcomeAsOfSession
      || !calendar.isSession(context.anchorDate)) failCompleteness();
    const sessions = calendar.sessions.filter(date => date <= context.anchorDate).slice(-251);
    if (sessions.length !== 251 || sessions.at(-1) !== context.anchorDate) {
      failCompleteness();
    }
    return sessions.map(String);
  };
  const campaignCandidateRequestSessions = (): readonly string[] => {
    const planned = campaignPlanningSessions();
    const bindings = forRole('candidate_calendar');
    if (bindings.length !== 1
      || bindings[0]!.envelope.request.dateFrom !== planned[0]
      || bindings[0]!.envelope.request.dateTo !== context.anchorDate) {
      failCompleteness();
    }
    return planned;
  };
  const campaignCandidateSessions = (): readonly string[] => {
    const planned = campaignCandidateRequestSessions();
    const sessions = completeCalendar('candidate_calendar').sessions.map(String);
    if (sessions.length !== planned.length
      || sessions.some((date, index) => date !== planned[index])) failCompleteness();
    return sessions;
  };
  const campaignCandidateDailyBinding = (
    sessions: readonly string[],
  ): BoundStrategyValidationSourceV1 => {
    const bindings = forRole('candidate_daily_bars');
    if (bindings.length !== 1
      || bindings[0]!.envelope.request.dateFrom !== sessions[0]
      || bindings[0]!.envelope.request.dateTo !== context.anchorDate) {
      return failCompleteness();
    }
    return bindings[0]!;
  };
  const requireCampaignCandidateGeometry = (completeDaily: boolean): void => {
    const sessions = campaignCandidateSessions();
    const daily = campaignCandidateDailyBinding(sessions);
    if (completeDaily) {
      if (daily.envelope.result.state !== 'available') failCompleteness();
      requireExactAvailableDates('candidate_daily_bars', sessions);
      return;
    }
    const available = availableDates('candidate_daily_bars');
    if ([...available].some(date => !sessions.includes(date))) failCompleteness();
    const missing = sessions.filter(date => !available.has(date));
    if (missing.length === 0 || missing.some(date => !provesMissingDate(
      'candidate_daily_bars', date,
    ))) failCompleteness();
  };
  const verifyCampaignAnchorSourceFailure = (
    reason: SourceFailureReasonV1,
  ): void => {
    if (reason === 'source_response_invalid') failCompleteness();
    const candidateRoles = [
      'candidate_calendar', 'candidate_daily_bars', 'candidate_master',
    ] as const;
    const unavailable = candidateRoles.flatMap(role => unavailableForRole(role).map(binding => ({
      role,
      binding,
    })));
    if (unavailable.length !== 1
      || unavailable[0]!.binding.envelope.result.state !== 'unavailable'
      || unavailable[0]!.binding.envelope.result.reason !== reason
      || forRole('outcome_master').length !== 0
      || forRole('outcome_daily_bars').length !== 0) failCompleteness();

    switch (unavailable[0]!.role) {
      case 'candidate_calendar':
        campaignCandidateRequestSessions();
        if (forRole('candidate_master').length !== 0
          || forRole('candidate_daily_bars').length !== 0) failCompleteness();
        return;
      case 'candidate_daily_bars': {
        const sessions = campaignCandidateSessions();
        const daily = campaignCandidateDailyBinding(sessions);
        if (daily.envelope.result.state !== 'unavailable'
          || forRole('candidate_master').length !== 0) failCompleteness();
        return;
      }
      case 'candidate_master':
        campaignCandidateSessions();
        requireCampaignCandidateGeometry(true);
        if (forRole('candidate_master').length !== 1) failCompleteness();
    }
  };
  const outcomeSessionsThrough = (evaluationEndDate: string): readonly string[] => {
    const calendar = completeCalendar('outcome_calendar');
    const sessions = calendar.sessions
      .map(String)
      .filter(date => date > context.decisionDate && date <= evaluationEndDate);
    if (sessions.length === 0 || sessions.at(-1) !== evaluationEndDate) {
      failCompleteness();
    }
    return sessions;
  };
  const verifyOutcomeSourceFailure = (reason: SourceFailureReasonV1): void => {
    if (context.outcome === null || context.persistedOutcome === null) failCompleteness();
    const outcomeRoles = [
      'outcome_calendar', 'outcome_master', 'outcome_daily_bars',
    ] as const;
    const unavailable = outcomeRoles.flatMap(role => unavailableForRole(role).map(binding => ({
      role,
      binding,
    })));
    const matching = unavailable.filter(value => (
      value.binding.envelope.result.state === 'unavailable'
      && value.binding.envelope.result.reason === reason
    ));
    if (unavailable.length !== 1 || matching.length !== 1) failCompleteness();
    const failure = matching[0]!;

    if (failure.role === 'outcome_calendar') {
      if (forRole('outcome_calendar').length !== 1
        || forRole('outcome_master').length !== 0
        || forRole('outcome_daily_bars').length !== 0
        || context.persistedOutcome.kind !== 'unavailable'
        || context.persistedOutcome.reason !== reason
        || context.persistedOutcome.evaluationEndDate !== null
        || context.persistedOutcome.entryProven
        || context.persistedOutcome.entryFill !== null
        || context.persistedOutcome.actualRisk !== null
        || context.outcome.sessionFacts.length !== 0
        || context.outcome.tickEvidenceDates.length !== 0
        || context.outcome.horizonDates.length !== 0
        || context.outcome.terminalCompletionDate !== null) failCompleteness();
      return;
    }

    requireAvailableDates('outcome_master', context.outcome.tickEvidenceDates);
    const replayed = replayOutcome();
    if (replayed.kind !== 'unavailable') failCompleteness();
    if (failure.role === 'outcome_daily_bars') {
      if (replayed.reason !== 'price_history_incomplete'
        || replayed.evaluationEndDate === null
        || !covers(failure.binding.envelope, replayed.evaluationEndDate)) failCompleteness();
    } else if (replayed.reason !== 'tick_category_unavailable'
      || replayed.evaluationEndDate === null
      || String(failure.binding.envelope.request.dateFrom) !== replayed.evaluationEndDate
      || availableDates('outcome_master').has(replayed.evaluationEndDate)) {
      failCompleteness();
    }
    requireOutcomeMatch(Object.freeze({ ...replayed, reason }) as StrategyOutcomeResultV1);
  };

  if (context.mode === 'campaign') campaignPlanningSessions();

  if (context.caseKind === 'anchor_unavailable') {
    switch (context.unavailableReason) {
      case 'source_plan_unavailable':
      case 'source_history_unavailable':
      case 'source_response_invalid': {
        if (context.mode === 'snapshot') {
          const calendar = forRole('candidate_calendar');
          if (calendar.length !== 1
            || calendar[0]!.envelope.result.state !== 'unavailable'
            || calendar[0]!.envelope.result.reason !== context.unavailableReason
            || forRole('candidate_master').length !== 0
            || forRole('candidate_daily_bars').length !== 0) failCompleteness();
          return;
        }
        verifyCampaignAnchorSourceFailure(context.unavailableReason);
        return;
      }
      case 'calendar_incomplete': {
        const calendar = forRole('candidate_calendar');
        if (calendar.length !== 1
          || calendar[0]!.envelope.result.state !== 'unavailable'
          || calendar[0]!.envelope.result.reason !== 'calendar_incomplete'
          || (['candidate_master', 'candidate_daily_bars',
            'outcome_master', 'outcome_daily_bars'] as const).some(role => (
            forRole(role).length !== 0
          ))) failCompleteness();
        if (context.mode === 'campaign') {
          campaignCandidateRequestSessions();
        } else if (forRole('outcome_calendar').length !== 0) {
          failCompleteness();
        }
        return;
      }
      case 'price_history_incomplete':
        if (context.mode !== 'campaign') failCompleteness();
        requireCampaignCandidateGeometry(false);
        return;
      case 'tick_category_unavailable':
        if (context.mode === 'campaign') requireCampaignCandidateGeometry(true);
        requireAvailableDates('candidate_master', [context.initialTickDate ?? context.decisionDate]);
        if (masterCategoryAt(
          'candidate_master', context.initialTickDate ?? context.decisionDate,
        ) !== null) failCompleteness();
        return;
      case 'non_executable_tick':
      case 'tick_rule_period_unsupported':
        if (context.mode === 'campaign') requireCampaignCandidateGeometry(true);
        requireAvailableDates('candidate_master', [context.initialTickDate ?? context.decisionDate]);
        if (context.unavailableReason === 'tick_rule_period_unsupported') {
          const date = context.initialTickDate ?? context.decisionDate;
          const category = masterCategoryAt('candidate_master', date);
          const result = isExecutableTsePriceV1(
            date, category === null ? [] : [category], 1,
          );
          if (result.state !== 'unavailable'
            || result.reason !== 'tick_rule_period_unsupported') failCompleteness();
        }
        return;
      case 'invalid_candidate':
        if (context.mode === 'campaign') {
          requireCampaignCandidateGeometry(true);
          return;
        }
        if (context.strategyDataDate === null) failCompleteness();
        if (!completeCalendar('candidate_calendar').isSession(context.strategyDataDate)) {
          failCompleteness();
        }
        return;
      case 'strategy_data_date_invalid': {
        if (context.mode !== 'snapshot' || context.strategyDataDate === null) {
          failCompleteness();
        }
        const calendar = completeCalendar('candidate_calendar');
        if (!calendar.hasCalendarDate(context.strategyDataDate)
          || calendar.isSession(context.strategyDataDate)) failCompleteness();
        return;
      }
      case 'future_strategy_data':
        return failCompleteness();
      default:
        return;
    }
  }

  if (context.outcome === null) failCompleteness();
  if (context.initialTickDate === null || context.initialTickEvidence === null) failCompleteness();
  if (context.mode === 'campaign') {
    requireCampaignCandidateGeometry(true);
  } else {
    const candidateCalendar = completeCalendar('candidate_calendar');
    if (![context.strategyDataDate ?? context.anchorDate, context.decisionDate]
      .every(date => candidateCalendar.hasCalendarDate(date))
      || !candidateCalendar.isSession(context.initialTickDate)
      || context.initialTickDate > context.decisionDate) failCompleteness();
  }
  verifyInitialTickEvidence(context.initialTickEvidence);

  const initialFailure = context.initialTickEvidence.unavailableReason === 'invalid_candidate'
    ? 'invalid_candidate'
    : context.initialTickEvidence.unavailableReason
      ?? (Object.values(context.initialTickEvidence.levels).some(level => (
        level.executable === false
      )) ? 'non_executable_tick' : null);
  if (initialFailure !== null
    && (context.outcome.kind !== 'unavailable'
      || context.outcome.unavailableReason !== initialFailure
      || context.outcome.evaluationEndDate !== null)) failCompleteness();

  if (isSourceFailureReasonV1(initialFailure)) {
    const candidateMaster = forRole('candidate_master');
    if (context.mode !== 'snapshot'
      || context.candidate === null
      || resolveLongStrategyInitialFailureWithoutMasterV1(
        context.candidate,
        parseTseSessionDate(context.initialTickDate),
      ) !== 'tick_category_unavailable'
      || candidateMaster.length !== 1
      || candidateMaster[0]!.envelope.result.state !== 'unavailable'
      || candidateMaster[0]!.envelope.result.reason !== initialFailure
      || (['outcome_calendar', 'outcome_master', 'outcome_daily_bars'] as const).some(role => (
        forRole(role).length !== 0
      ))
      || context.persistedOutcome === null
      || context.persistedOutcome.kind !== 'unavailable'
      || context.persistedOutcome.reason !== initialFailure
      || context.persistedOutcome.entryProven
      || context.persistedOutcome.entryFill !== null
      || context.persistedOutcome.actualRisk !== null
      || context.outcome.sessionFacts.length !== 0
      || context.outcome.tickEvidenceDates.length !== 0
      || context.outcome.horizonDates.length !== 0
      || context.outcome.terminalCompletionDate !== null) failCompleteness();
    return;
  }

  if (context.outcome.kind === 'unavailable'
    && context.outcome.evaluationEndDate === null
    && ['tick_rule_period_unsupported', 'tick_category_unavailable', 'non_executable_tick']
      .includes(context.outcome.unavailableReason ?? '')
    && context.outcome.unavailableReason !== initialFailure) failCompleteness();

  if (context.outcome.kind === 'unavailable') {
    switch (context.outcome.unavailableReason) {
      case 'source_plan_unavailable':
      case 'source_history_unavailable':
      case 'source_response_invalid':
        verifyOutcomeSourceFailure(context.outcome.unavailableReason);
        return;
      case 'calendar_incomplete':
        requireMatchingUnavailable(['outcome_calendar'], 'calendar_incomplete');
        return;
      case 'price_history_incomplete': {
        const missingDate = context.outcome.evaluationEndDate;
        if (missingDate === null) failCompleteness();
        const sessions = outcomeSessionsThrough(missingDate);
        const priorSessions = sessions.slice(0, -1);
        requirePresent('outcome_daily_bars');
        requireAvailableDates('outcome_daily_bars', priorSessions);
        const available = availableDates('outcome_daily_bars');
        if (available.has(missingDate)
          || !provesMissingDate('outcome_daily_bars', missingDate)) failCompleteness();
        verifyPersistedOutcome();
        return;
      }
    }
  }

  const evaluationEndDate = context.outcome.evaluationEndDate;
  if (evaluationEndDate === null) {
    if (context.outcome.kind !== 'unavailable'
      || context.outcome.sessionFacts.length > 0
      || context.outcome.tickEvidenceDates.length > 0
      || context.outcome.horizonDates.length > 0
      || context.outcome.terminalCompletionDate !== null) failCompleteness();
    if (context.outcome.unavailableReason === 'outcome_not_matured') {
      const calendar = completeCalendar('outcome_calendar');
      if (calendar.sessions.some(date => (
        date > context.decisionDate && date <= context.outcomeAsOfSession
      ))) failCompleteness();
      verifyPersistedOutcome();
    }
    return;
  }
  const sessions = outcomeSessionsThrough(evaluationEndDate);
  requireAvailableDates('outcome_daily_bars', sessions);
  const sessionNumber = new Map(sessions.map((date, index) => [date, index + 1]));
  if (context.outcome.sessionFacts.some(fact => (
    sessionNumber.get(fact.date) !== fact.evaluationSession
  ))) failCompleteness();
  if (context.outcome.kind === 'not_triggered'
    && sessions.length !== context.entryWaitSessions) failCompleteness();
  if (context.outcome.terminalCompletionDate !== null
    && context.outcome.terminalCompletionDate !== evaluationEndDate) failCompleteness();
  if (context.outcome.horizonDates.length > 0) {
    const entry = context.outcome.sessionFacts[0];
    if (entry === undefined || context.outcome.horizonDates.some(date => (
      date !== evaluationEndDate
      || sessionNumber.get(date) === undefined
      || sessionNumber.get(date)! - entry.evaluationSession + 1 !== context.holdingSessions
    ))) failCompleteness();
  }
  verifyPersistedOutcome();
}

export function sourceManifestDigestsV1(
  manifest: PointInTimeSourceManifestV1,
): readonly SnapshotDigest[] {
  return Object.freeze(manifest.sources.map(reference => reference.digest as SnapshotDigest));
}
