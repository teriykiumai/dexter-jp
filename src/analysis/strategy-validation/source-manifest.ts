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

function failBinding(): never {
  throw new TypeError('A source-manifest role does not match its envelope or case.');
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

export function sourceManifestDigestsV1(
  manifest: PointInTimeSourceManifestV1,
): readonly SnapshotDigest[] {
  return Object.freeze(manifest.sources.map(reference => reference.digest as SnapshotDigest));
}
