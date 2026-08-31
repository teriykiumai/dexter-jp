import { z } from 'zod';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import type { SnapshotDigest } from '../snapshot/canonical-json.js';
import {
  isStrictGregorianDate,
  parseAsOfCutoff,
  tokyoEndOfDayV1,
} from './date.js';
import { createTseSessionCalendarV1 } from './calendar.js';
import { parseDailyBarV1 } from './daily-bar.js';
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
  outcomeAsOfSession: strictDate,
  sources: z.array(PointInTimeSourceManifestReferenceV1Schema).max(250),
}).strict().superRefine((value, context) => {
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
  outcomeAsOfSession: string;
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
  startedAt: string;
  outcomeAsOfSession: string;
}>;

export type StrategyValidationSourceCompletenessContextV1 = Readonly<{
  mode: 'snapshot' | 'campaign';
  caseKind: 'anchor_unavailable' | 'candidate';
  ticker: string;
  anchorDate: string;
  decisionDate: string;
  strategyDataDate: string | null;
  entryWaitSessions: number;
  holdingSessions: number;
  unavailableReason: string | null;
  tickEvidenceUnavailableReason:
    | 'tick_rule_period_unsupported'
    | 'tick_category_unavailable'
    | 'invalid_candidate'
    | null;
  outcome: Readonly<{
    kind: string;
    unavailableReason: string | null;
    evaluationEndDate: string | null;
    tickValidationDates: readonly string[];
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
  if (reference.digest !== envelope.digest
    || envelope.endpoint !== expectedEndpoint(reference.role)
    || (envelope.endpoint === '/v2/markets/calendar'
      ? envelope.request.ticker !== null
      : envelope.request.ticker !== context.ticker)
    || (context.caseKind === 'anchor_unavailable' && !candidateRole)) {
    failBinding();
  }

  const expectedCutoff = candidateRole && context.mode === 'campaign'
    ? tokyoEndOfDayV1(context.anchorDate)
    : context.startedAt;
  if (envelope.request.asOfCutoff !== expectedCutoff) failBinding();

  switch (reference.role) {
    case 'candidate_calendar': {
      const earliest = context.mode === 'snapshot' && context.strategyDataDate !== null
        ? context.strategyDataDate
        : context.anchorDate;
      if (!covers(envelope, earliest) || !covers(envelope, context.decisionDate)) failBinding();
      return;
    }
    case 'candidate_master':
      if (envelope.request.dateFrom !== context.decisionDate
        || envelope.request.dateTo !== context.decisionDate) failBinding();
      return;
    case 'candidate_daily_bars':
      if (context.mode !== 'campaign'
        || envelope.request.dateFrom > context.anchorDate
        || envelope.request.dateTo !== context.anchorDate) failBinding();
      return;
    case 'outcome_calendar': {
      const lastBoundary = context.decisionDate > context.outcomeAsOfSession
        ? context.decisionDate
        : context.outcomeAsOfSession;
      if (!covers(envelope, context.decisionDate) || !covers(envelope, lastBoundary)) failBinding();
      return;
    }
    case 'outcome_master':
      if (envelope.request.dateFrom !== envelope.request.dateTo
        || envelope.request.dateFrom <= context.decisionDate
        || envelope.request.dateTo > context.outcomeAsOfSession) failBinding();
      return;
    case 'outcome_daily_bars':
      if (envelope.request.dateFrom <= context.decisionDate
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
  const requireMatchingUnavailable = (
    roles: readonly StrategyValidationSourceRoleV1[],
    reason: PointInTimeSourceUnavailableReasonV1,
  ): void => {
    if (!roles.some(role => unavailableForRole(role).some(value => (
      value.envelope.result.state === 'unavailable'
      && value.envelope.result.reason === reason
    )))) failCompleteness();
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
  const campaignCandidateSessions = (): readonly string[] => {
    const calendar = completeCalendar('candidate_calendar');
    const sessions = calendar.sessions.map(String);
    if (sessions.length !== 251 || sessions.at(-1) !== context.anchorDate) {
      failCompleteness();
    }
    return sessions;
  };
  const requireCampaignCandidateGeometry = (completeDaily: boolean): void => {
    const sessions = campaignCandidateSessions();
    requirePresent('candidate_daily_bars');
    if (completeDaily) {
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

  if (context.caseKind === 'anchor_unavailable') {
    switch (context.unavailableReason) {
      case 'source_plan_unavailable':
      case 'source_history_unavailable':
      case 'source_response_invalid':
        requireMatchingUnavailable(
          ['candidate_calendar', 'candidate_master', 'candidate_daily_bars'],
          context.unavailableReason,
        );
        return;
      case 'calendar_incomplete':
        requireMatchingUnavailable(['candidate_calendar'], 'calendar_incomplete');
        return;
      case 'price_history_incomplete':
        if (context.mode !== 'campaign') failCompleteness();
        requireCampaignCandidateGeometry(false);
        return;
      case 'tick_category_unavailable':
        if (context.mode === 'campaign') requireCampaignCandidateGeometry(true);
        requireAvailableDates('candidate_master', [context.decisionDate]);
        return;
      case 'non_executable_tick':
      case 'tick_rule_period_unsupported':
        if (context.mode === 'campaign') requireCampaignCandidateGeometry(true);
        requireAvailableDates('candidate_master', [context.decisionDate]);
        return;
      case 'invalid_candidate':
        if (context.mode === 'campaign') requireCampaignCandidateGeometry(true);
        return;
      default:
        return;
    }
  }

  if (context.outcome === null) failCompleteness();
  if (context.mode === 'campaign') {
    requireCampaignCandidateGeometry(true);
    requireAvailableDates('candidate_master', [context.decisionDate]);
  } else {
    const candidateCalendar = completeCalendar('candidate_calendar');
    if (![context.strategyDataDate ?? context.anchorDate, context.decisionDate]
      .every(date => candidateCalendar.hasCalendarDate(date))) failCompleteness();
    if (context.tickEvidenceUnavailableReason !== 'invalid_candidate') {
      requireAvailableDates('candidate_master', [context.decisionDate]);
    }
  }

  if (context.outcome.kind === 'unavailable') {
    switch (context.outcome.unavailableReason) {
      case 'source_plan_unavailable':
      case 'source_history_unavailable':
      case 'source_response_invalid':
        requireMatchingUnavailable(
          ['outcome_calendar', 'outcome_master', 'outcome_daily_bars'],
          context.outcome.unavailableReason,
        );
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
        return;
      }
    }
  }

  const evaluationEndDate = context.outcome.evaluationEndDate;
  if (evaluationEndDate === null) {
    if (context.outcome.kind !== 'unavailable') failCompleteness();
    return;
  }
  const sessions = outcomeSessionsThrough(evaluationEndDate);
  requireAvailableDates('outcome_daily_bars', sessions);
  requireAvailableDates('outcome_master', context.outcome.tickValidationDates);
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
}

export function sourceManifestDigestsV1(
  manifest: PointInTimeSourceManifestV1,
): readonly SnapshotDigest[] {
  return Object.freeze(manifest.sources.map(reference => reference.digest as SnapshotDigest));
}
