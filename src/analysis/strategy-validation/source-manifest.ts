import { z } from 'zod';
import type { SnapshotDigest } from '../snapshot/canonical-json.js';
import {
  isStrictGregorianDate,
  parseAsOfCutoff,
  tokyoEndOfDayV1,
} from './date.js';
import type { PointInTimeSourceEnvelopeV1 } from './source-envelope.js';

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
  anchorDate: string;
  decisionDate: string;
  strategyDataDate: string | null;
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
    evidenceDates: readonly string[];
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
  const requirePresent = (role: StrategyValidationSourceRoleV1): void => {
    if (forRole(role).length === 0) failCompleteness();
  };
  const requireAvailable = (role: StrategyValidationSourceRoleV1): void => {
    if (availableForRole(role).length === 0) failCompleteness();
  };
  const requireAvailableDates = (
    role: StrategyValidationSourceRoleV1,
    dates: readonly string[],
  ): void => {
    const available = availableForRole(role);
    if (available.length === 0 || dates.some(date => !available.some(value => (
      covers(value.envelope, date)
      && value.envelope.result.state === 'available'
      && value.envelope.result.rows.some(row => row.Date === date)
    )))) {
      failCompleteness();
    }
  };
  const requireAnyPresent = (roles: readonly StrategyValidationSourceRoleV1[]): void => {
    if (!roles.some(role => forRole(role).length > 0)) failCompleteness();
  };

  if (context.caseKind === 'anchor_unavailable') {
    switch (context.unavailableReason) {
      case 'source_plan_unavailable':
      case 'source_history_unavailable':
      case 'source_response_invalid':
        requireAnyPresent(['candidate_calendar', 'candidate_master', 'candidate_daily_bars']);
        return;
      case 'calendar_incomplete':
        requirePresent('candidate_calendar');
        return;
      case 'price_history_incomplete':
        requireAvailable('candidate_calendar');
        requirePresent('candidate_daily_bars');
        return;
      case 'tick_category_unavailable':
        requirePresent('candidate_master');
        return;
      case 'non_executable_tick':
        requireAvailable('candidate_master');
        if (context.mode === 'campaign') {
          requireAvailable('candidate_calendar');
          requireAvailable('candidate_daily_bars');
        }
        return;
      case 'tick_rule_period_unsupported':
      case 'invalid_candidate':
        if (context.mode === 'campaign') {
          requireAvailable('candidate_calendar');
          requireAvailable('candidate_daily_bars');
        }
        return;
      default:
        return;
    }
  }

  if (context.outcome === null) failCompleteness();
  if (context.mode === 'campaign') {
    requireAvailableDates('candidate_calendar', [context.anchorDate]);
    requireAvailableDates('candidate_master', [context.decisionDate]);
    requireAvailableDates('candidate_daily_bars', [context.anchorDate]);
  } else {
    requireAvailableDates('candidate_calendar', [
      context.strategyDataDate ?? context.anchorDate,
      context.decisionDate,
    ]);
    if (context.tickEvidenceUnavailableReason === null
      || context.tickEvidenceUnavailableReason === 'tick_category_unavailable') {
      requireAvailableDates('candidate_master', [context.decisionDate]);
    }
  }

  const outcomeDates = [...new Set([
    ...context.outcome.evidenceDates,
    ...(context.outcome.evaluationEndDate === null
      ? []
      : [context.outcome.evaluationEndDate]),
  ])];
  if (outcomeDates.length > 0) {
    requireAvailableDates('outcome_calendar', [context.decisionDate, ...outcomeDates]);
    requireAvailableDates('outcome_daily_bars', outcomeDates);
    return;
  }

  if (context.outcome.kind !== 'unavailable') failCompleteness();
  switch (context.outcome.unavailableReason) {
    case 'source_plan_unavailable':
    case 'source_history_unavailable':
    case 'source_response_invalid':
      requireAnyPresent(['outcome_calendar', 'outcome_master', 'outcome_daily_bars']);
      return;
    case 'calendar_incomplete':
      requirePresent('outcome_calendar');
      return;
    case 'price_history_incomplete':
      requireAvailable('outcome_calendar');
      requirePresent('outcome_daily_bars');
  }
}

export function sourceManifestDigestsV1(
  manifest: PointInTimeSourceManifestV1,
): readonly SnapshotDigest[] {
  return Object.freeze(manifest.sources.map(reference => reference.digest as SnapshotDigest));
}
