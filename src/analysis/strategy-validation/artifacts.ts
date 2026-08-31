import { z } from 'zod';
import type {
  StrategyEntryReason,
  StrategyStopReason,
  StrategyTargetReason,
} from '../../tools/finance/strategy-engine.js';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import {
  isStrictGregorianDate,
  parseAsOfCutoff,
  tokyoDateFromUtcInstantV1,
  type TseSessionDate,
} from './date.js';
import {
  STRATEGY_ENTRY_WAIT_SESSIONS_V1,
  STRATEGY_HOLDING_SESSIONS_V1,
  STRATEGY_LIMIT_QUEUE_VERSION_V1,
  STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
  type StrategyOutcomeCandidateV1,
  type StrategyOutcomeResultV1,
} from './outcome-validator.js';
import { TSE_TICK_CATEGORIES_V1, TSE_TICK_RULE_VERSION } from './tick.js';
import {
  PointInTimeSourceManifestV1Schema,
} from './source-manifest.js';

export const STRATEGY_VALIDATION_CASE_SCHEMA_VERSION =
  'strategy_validation_case_v1' as const;
export const STRATEGY_VALIDATION_PRODUCER_VERSION =
  'strategy_validation_producer_v1' as const;
export const STRATEGY_VALIDATION_SOURCE_CONTRACT_VERSION =
  'point_in_time_source_contract_v1' as const;
export const STRATEGY_VALIDATION_TECHNICAL_VERSION = 'technical_engine_v1' as const;
export const STRATEGY_VALIDATION_STRATEGY_VERSION = 'strategy_engine_v1' as const;
export const STRATEGY_VALIDATION_AGGREGATION_VERSION =
  'strategy_validation_aggregation_v1' as const;
export const STRATEGY_VALIDATION_CAMPAIGN_POLICY = 'technical_251_strategy_v1' as const;

export const STRATEGY_VALIDATION_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const STRATEGY_VALIDATION_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const StrategyValidationUuidV4Schema = z.string().regex(
  STRATEGY_VALIDATION_UUID_V4_PATTERN,
);
export const StrategyValidationDigestSchema = z.string().regex(
  STRATEGY_VALIDATION_DIGEST_PATTERN,
);
export const StrategyValidationCandidateIdSchema = StrategyValidationDigestSchema;

const finite = z.number().finite();
const positiveFinite = finite.positive();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const strictDate = z.string().refine(isStrictGregorianDate);
const canonicalUtcInstant = z.string().refine(value => {
  try {
    return parseAsOfCutoff(value) === value;
  } catch {
    return false;
  }
});
const digestArray = z.array(StrategyValidationDigestSchema).superRefine((values, context) => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      context.addIssue({ code: 'custom', message: 'Digests must be sorted and unique.' });
      return;
    }
  }
});

export const StrategyValidationVersionsV1Schema = z.object({
  producer: z.literal(STRATEGY_VALIDATION_PRODUCER_VERSION),
  sourceContract: z.literal(STRATEGY_VALIDATION_SOURCE_CONTRACT_VERSION),
  technical: z.literal(STRATEGY_VALIDATION_TECHNICAL_VERSION),
  strategy: z.literal(STRATEGY_VALIDATION_STRATEGY_VERSION),
  outcome: z.literal(STRATEGY_OUTCOME_ALGORITHM_VERSION_V1),
  limitQueue: z.literal(STRATEGY_LIMIT_QUEUE_VERSION_V1),
  tick: z.literal(TSE_TICK_RULE_VERSION),
  aggregation: z.literal(STRATEGY_VALIDATION_AGGREGATION_VERSION),
}).strict();
export type StrategyValidationVersionsV1 = z.infer<typeof StrategyValidationVersionsV1Schema>;

export const STRATEGY_VALIDATION_VERSIONS_V1: StrategyValidationVersionsV1 = Object.freeze({
  producer: STRATEGY_VALIDATION_PRODUCER_VERSION,
  sourceContract: STRATEGY_VALIDATION_SOURCE_CONTRACT_VERSION,
  technical: STRATEGY_VALIDATION_TECHNICAL_VERSION,
  strategy: STRATEGY_VALIDATION_STRATEGY_VERSION,
  outcome: STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
  limitQueue: STRATEGY_LIMIT_QUEUE_VERSION_V1,
  tick: TSE_TICK_RULE_VERSION,
  aggregation: STRATEGY_VALIDATION_AGGREGATION_VERSION,
});

const EntrySchema = z.object({
  price: positiveFinite,
  reason: z.literal('breakout_above_swing_high'),
}).strict();
const StopSchema = z.object({
  price: positiveFinite,
  reason: z.enum(['latest_swing_low', 'entry_minus_1_5_atr']),
}).strict();
const TargetSchema = z.object({
  price: positiveFinite,
  reason: z.enum(['risk_reward_2R', 'resistance_level']),
}).strict();
export const StrategyValidationCandidateV1Schema = z.object({
  entry: EntrySchema,
  stop: StopSchema,
  target: TargetSchema,
}).strict();

const FillSchema = z.object({
  date: strictDate,
  evaluationSession: z.number().int().min(1).max(79),
  holdingDay: z.number().int().min(1).max(60),
  order: z.enum(['entry', 'stop', 'target']),
  method: z.enum(['open', 'entry_level', 'stop_level', 'target_level']),
  price: positiveFinite,
}).strict();

const MarkSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), date: strictDate, price: positiveFinite, markR: finite }).strict(),
  z.object({ state: z.literal('unavailable'), date: strictDate }).strict(),
]);

const LimitQueueEvidenceSchema = z.object({
  date: strictDate,
  orderSide: z.enum(['buy', 'sell']),
  fillKind: z.enum(['entry', 'stop']),
  selectedFillPrice: positiveFinite,
  boundaryKind: z.enum(['upper', 'lower']),
  boundaryPrice: positiveFinite,
  sourceFlag: z.enum(['UL', 'LL']),
}).strict().superRefine((value, context) => {
  const buy = value.orderSide === 'buy' && value.fillKind === 'entry'
    && value.boundaryKind === 'upper' && value.sourceFlag === 'UL';
  const sell = value.orderSide === 'sell' && value.fillKind === 'stop'
    && value.boundaryKind === 'lower' && value.sourceFlag === 'LL';
  if (!buy && !sell) context.addIssue({ code: 'custom', message: 'Limit queue evidence is inconsistent.' });
  if (value.selectedFillPrice !== value.boundaryPrice) {
    context.addIssue({ code: 'custom', message: 'A limit-bound fill must equal its boundary.' });
  }
});

const TerminalBoundSchema = z.union([
  z.object({
    kind: z.enum(['stop_hit', 'target_hit']),
    exitFill: FillSchema,
    realizedR: finite,
  }).strict(),
  z.object({ kind: z.literal('horizon_expired'), mark: MarkSchema }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.literal('outcome_not_matured') }).strict(),
]);

const outcomeBaseShape = {
  algorithmVersion: z.literal(STRATEGY_OUTCOME_ALGORITHM_VERSION_V1),
  limitQueueVersion: z.literal(STRATEGY_LIMIT_QUEUE_VERSION_V1),
  plannedRisk: positiveFinite.nullable(),
  evaluationEndDate: strictDate.nullable(),
} as const;

const OutcomeNotTriggeredSchema = z.object({
  ...outcomeBaseShape,
  kind: z.literal('not_triggered'),
  entryProven: z.literal(false),
  entryFill: z.null(),
  actualRisk: z.null(),
}).strict();
const OutcomeTerminalSchema = z.object({
  ...outcomeBaseShape,
  kind: z.enum(['stop_hit', 'target_hit']),
  entryProven: z.literal(true),
  entryFill: FillSchema,
  actualRisk: positiveFinite,
  exitFill: FillSchema,
  realizedR: finite,
}).strict();
const OutcomeHorizonSchema = z.object({
  ...outcomeBaseShape,
  kind: z.literal('horizon_expired'),
  entryProven: z.literal(true),
  entryFill: FillSchema,
  actualRisk: positiveFinite,
  mark: MarkSchema,
}).strict();
const OutcomeAmbiguousSchema = z.object({
  ...outcomeBaseShape,
  kind: z.literal('ambiguous_intraday'),
  entryProven: z.literal(true),
  entryFill: FillSchema,
  actualRisk: positiveFinite,
  ambiguityDate: strictDate,
  pessimistic: TerminalBoundSchema,
  optimistic: TerminalBoundSchema,
}).strict().superRefine((value, context) => {
  const numeric = (bound: z.infer<typeof TerminalBoundSchema>): number | null => {
    if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') return bound.realizedR;
    if (bound.kind === 'horizon_expired' && bound.mark.state === 'available') return bound.mark.markR;
    return null;
  };
  const lower = numeric(value.pessimistic);
  const upper = numeric(value.optimistic);
  if (lower !== null && upper !== null && lower > upper) {
    context.addIssue({ code: 'custom', message: 'Ambiguity bounds are reversed.' });
  }
});
export const STRATEGY_VALIDATION_CANDIDATE_UNAVAILABLE_REASONS_V1 = Object.freeze(
  [
    'outcome_not_matured',
    'source_plan_unavailable',
    'source_history_unavailable',
    'source_response_invalid',
    'calendar_incomplete',
    'price_history_incomplete',
    'corporate_action_in_outcome_window',
    'tick_rule_period_unsupported',
    'tick_category_unavailable',
    'non_executable_tick',
    'entry_gap_beyond_target',
    'invalid_candidate',
    'limit_queue_ambiguous',
  ] as const,
);
const nonQueueUnavailableReasons = STRATEGY_VALIDATION_CANDIDATE_UNAVAILABLE_REASONS_V1.filter(
  reason => reason !== 'limit_queue_ambiguous',
);
export const STRATEGY_VALIDATION_SNAPSHOT_ANCHOR_UNAVAILABLE_REASONS_V1 = Object.freeze([
  'source_plan_unavailable',
  'source_history_unavailable',
  'source_response_invalid',
  'calendar_incomplete',
  'strategy_data_date_invalid',
  'future_strategy_data',
  'invalid_candidate',
] as const);
export const STRATEGY_VALIDATION_CAMPAIGN_ANCHOR_UNAVAILABLE_REASONS_V1 = Object.freeze([
  'source_plan_unavailable',
  'source_history_unavailable',
  'source_response_invalid',
  'calendar_incomplete',
  'price_history_incomplete',
  'tick_rule_period_unsupported',
  'tick_category_unavailable',
  'non_executable_tick',
  'invalid_candidate',
  'resistance_evidence_invalid',
] as const);
export const STRATEGY_VALIDATION_ANCHOR_UNAVAILABLE_REASONS_V1 = Object.freeze([
  'source_plan_unavailable',
  'source_history_unavailable',
  'source_response_invalid',
  'calendar_incomplete',
  'price_history_incomplete',
  'tick_rule_period_unsupported',
  'tick_category_unavailable',
  'non_executable_tick',
  'strategy_data_date_invalid',
  'future_strategy_data',
  'invalid_candidate',
  'resistance_evidence_invalid',
] as const);
const OutcomeUnavailableSchema = z.union([
  z.object({
    ...outcomeBaseShape,
    kind: z.literal('unavailable'),
    reason: z.enum(nonQueueUnavailableReasons as [string, ...string[]]),
    entryProven: z.boolean(),
    entryFill: FillSchema.nullable(),
    actualRisk: positiveFinite.nullable(),
  }).strict(),
  z.object({
    ...outcomeBaseShape,
    kind: z.literal('unavailable'),
    reason: z.literal('limit_queue_ambiguous'),
    entryProven: z.boolean(),
    entryFill: FillSchema.nullable(),
    actualRisk: positiveFinite.nullable(),
    limitQueueEvidence: LimitQueueEvidenceSchema,
  }).strict(),
]).superRefine((value, context) => {
  if (value.entryProven !== (value.entryFill !== null && value.actualRisk !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable entry state is inconsistent.' });
  }
});

export const StrategyOutcomeResultArtifactV1Schema = z.union([
  OutcomeNotTriggeredSchema,
  OutcomeTerminalSchema,
  OutcomeHorizonSchema,
  OutcomeAmbiguousSchema,
  OutcomeUnavailableSchema,
]) as z.ZodType<StrategyOutcomeResultV1>;

export function strategyValidationOutcomeEvidenceDatesV1(
  outcome: StrategyOutcomeResultV1,
): readonly string[] {
  const dates: string[] = outcome.evaluationEndDate === null
    ? []
    : [outcome.evaluationEndDate];
  if (outcome.entryFill !== null) dates.push(outcome.entryFill.date);
  if (outcome.kind === 'stop_hit' || outcome.kind === 'target_hit') {
    dates.push(outcome.exitFill.date);
  } else if (outcome.kind === 'horizon_expired') {
    dates.push(outcome.mark.date);
  } else if (outcome.kind === 'ambiguous_intraday') {
    dates.push(outcome.ambiguityDate);
    for (const bound of [outcome.pessimistic, outcome.optimistic]) {
      if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') {
        dates.push(bound.exitFill.date);
      } else if (bound.kind === 'horizon_expired') {
        dates.push(bound.mark.date);
      }
    }
  } else if (outcome.kind === 'unavailable'
    && outcome.reason === 'limit_queue_ambiguous') {
    dates.push(outcome.limitQueueEvidence.date);
  }
  return Object.freeze([...new Set(dates)].sort());
}

export function strategyValidationOutcomeTickDatesV1(
  outcome: StrategyOutcomeResultV1,
): readonly string[] {
  const dates: string[] = [];
  if (outcome.entryFill !== null) dates.push(outcome.entryFill.date);
  if (outcome.kind === 'stop_hit' || outcome.kind === 'target_hit') {
    dates.push(outcome.exitFill.date);
  } else if (outcome.kind === 'ambiguous_intraday') {
    for (const bound of [outcome.pessimistic, outcome.optimistic]) {
      if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') {
        dates.push(bound.exitFill.date);
      }
    }
  } else if (outcome.kind === 'unavailable') {
    if (outcome.reason === 'limit_queue_ambiguous') {
      dates.push(outcome.limitQueueEvidence.date);
    } else if (outcome.evaluationEndDate !== null && [
      'tick_rule_period_unsupported',
      'tick_category_unavailable',
      'non_executable_tick',
      'invalid_candidate',
    ].includes(outcome.reason)) {
      dates.push(outcome.evaluationEndDate);
    }
  }
  return Object.freeze([...new Set(dates)].sort());
}

export function strategyValidationOutcomeSessionFactsV1(
  outcome: StrategyOutcomeResultV1,
): readonly Readonly<{ date: string; evaluationSession: number }>[] {
  const facts: Array<Readonly<{ date: string; evaluationSession: number }>> = [];
  if (outcome.entryFill !== null) {
    facts.push({
      date: outcome.entryFill.date,
      evaluationSession: outcome.entryFill.evaluationSession,
    });
  }
  if (outcome.kind === 'stop_hit' || outcome.kind === 'target_hit') {
    facts.push({
      date: outcome.exitFill.date,
      evaluationSession: outcome.exitFill.evaluationSession,
    });
  } else if (outcome.kind === 'ambiguous_intraday') {
    for (const bound of [outcome.pessimistic, outcome.optimistic]) {
      if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') {
        facts.push({
          date: bound.exitFill.date,
          evaluationSession: bound.exitFill.evaluationSession,
        });
      }
    }
  }
  return Object.freeze(facts.map(value => Object.freeze(value)));
}

export function strategyValidationOutcomeHorizonDatesV1(
  outcome: StrategyOutcomeResultV1,
): readonly string[] {
  const dates: string[] = [];
  if (outcome.kind === 'horizon_expired') dates.push(outcome.mark.date);
  if (outcome.kind === 'ambiguous_intraday') {
    for (const bound of [outcome.pessimistic, outcome.optimistic]) {
      if (bound.kind === 'horizon_expired') dates.push(bound.mark.date);
    }
  }
  return Object.freeze([...new Set(dates)].sort());
}

const TickLevelSchema = z.object({
  tick: positiveFinite.nullable(),
  executable: z.boolean().nullable(),
}).strict();
export const StrategyValidationTickEvidenceV1Schema = z.object({
  effectiveDate: strictDate,
  category: z.enum(TSE_TICK_CATEGORIES_V1).nullable(),
  unavailableReason: z.enum([
    'source_plan_unavailable',
    'source_history_unavailable',
    'source_response_invalid',
    'tick_rule_period_unsupported',
    'tick_category_unavailable',
    'invalid_candidate',
  ]).nullable(),
  levels: z.object({
    entry: TickLevelSchema,
    stop: TickLevelSchema,
    target: TickLevelSchema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const levels = Object.values(value.levels);
  if (value.unavailableReason === null) {
    if (value.category === null || levels.some(level => level.tick === null || level.executable === null)) {
      context.addIssue({ code: 'custom', message: 'Available tick evidence is incomplete.' });
    }
  } else if (levels.some(level => level.tick !== null || level.executable !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable tick evidence must not contain level results.' });
  }
  if (value.unavailableReason !== null && [
    'source_plan_unavailable',
    'source_history_unavailable',
    'source_response_invalid',
    'tick_category_unavailable',
  ].includes(value.unavailableReason) && value.category !== null) {
    context.addIssue({ code: 'custom', message: 'Unavailable tick category evidence is inconsistent.' });
  }
});

const SnapshotSelectorSchema = z.object({
  mode: z.literal('snapshot'),
  snapshotId: SnapshotIdSchema,
  snapshotSchemaVersion: z.number().int().min(1).max(9),
  snapshotDigest: StrategyValidationDigestSchema,
}).strict();
const CampaignSelectorSchema = z.object({
  mode: z.literal('campaign'),
  manifestDigest: StrategyValidationDigestSchema,
}).strict();
export const StrategyValidationSelectorV1Schema = z.discriminatedUnion('mode', [
  SnapshotSelectorSchema,
  CampaignSelectorSchema,
]);

const caseCommonShape = {
  schemaVersion: z.literal(STRATEGY_VALIDATION_CASE_SCHEMA_VERSION),
  caseId: StrategyValidationUuidV4Schema,
  runId: StrategyValidationUuidV4Schema,
  mode: z.enum(['snapshot', 'campaign']),
  confidence: z.enum(['precommitted', 'reconstructed_251_as_of']),
  ticker: CanonicalTickerSchema,
  anchorDate: strictDate,
  decisionDate: strictDate,
  strategyDataDate: strictDate.nullable(),
  selector: StrategyValidationSelectorV1Schema,
  versions: StrategyValidationVersionsV1Schema,
  candidateGenerationPolicy: z.literal(STRATEGY_VALIDATION_CAMPAIGN_POLICY).nullable(),
  startedAt: canonicalUtcInstant,
  outcomeAsOfSession: strictDate,
  entryWaitSessions: z.literal(STRATEGY_ENTRY_WAIT_SESSIONS_V1),
  holdingSessions: z.literal(STRATEGY_HOLDING_SESSIONS_V1),
  sourceManifest: PointInTimeSourceManifestV1Schema,
} as const;

const AnchorUnavailableCaseSchema = z.object({
  ...caseCommonShape,
  caseKind: z.literal('anchor_unavailable'),
  unavailableReason: z.enum(STRATEGY_VALIDATION_ANCHOR_UNAVAILABLE_REASONS_V1),
}).strict();

const CandidateCaseSchema = z.object({
  ...caseCommonShape,
  caseKind: z.literal('candidate'),
  candidateIdentityVersion: z.enum([
    'snapshot_candidate_identity_v1',
    'campaign_candidate_identity_v1',
  ]),
  candidateId: StrategyValidationCandidateIdSchema,
  duplicateOrdinal: nonnegativeSafeInteger,
  candidate: StrategyValidationCandidateV1Schema,
  tickEvidence: StrategyValidationTickEvidenceV1Schema,
  resistanceEvidenceTier: z.enum(['none', 'precommitted_source_unknown']),
  resistanceEvidenceSnapshotDigests: digestArray.max(8),
  outcome: StrategyOutcomeResultArtifactV1Schema,
}).strict();

export const StrategyValidationCaseV1Schema = z.discriminatedUnion('caseKind', [
  AnchorUnavailableCaseSchema,
  CandidateCaseSchema,
]).superRefine((value, context) => {
  if (value.decisionDate < value.anchorDate) {
    context.addIssue({ code: 'custom', message: 'decisionDate precedes anchorDate.' });
  }
  if (value.outcomeAsOfSession >= tokyoDateFromUtcInstantV1(value.startedAt)) {
    context.addIssue({
      code: 'custom', message: 'outcomeAsOfSession is not before the Tokyo start date.',
    });
  }
  const snapshotMode = value.mode === 'snapshot';
  if (snapshotMode !== (value.selector.mode === 'snapshot')
    || (snapshotMode ? value.confidence !== 'precommitted' : value.confidence !== 'reconstructed_251_as_of')
    || (snapshotMode ? value.candidateGenerationPolicy !== null : value.candidateGenerationPolicy !== STRATEGY_VALIDATION_CAMPAIGN_POLICY)
    || (!snapshotMode && value.strategyDataDate !== null)) {
    context.addIssue({ code: 'custom', message: 'Case mode fields are inconsistent.' });
    return;
  }
  if (!snapshotMode && value.decisionDate !== value.anchorDate) {
    context.addIssue({ code: 'custom', message: 'Campaign decisionDate must equal anchorDate.' });
  }
  if (value.sourceManifest.startedAt !== value.startedAt
    || value.sourceManifest.outcomeAsOfSession !== value.outcomeAsOfSession) {
    context.addIssue({ code: 'custom', message: 'Source manifest does not match case time identity.' });
  }
  if (value.caseKind !== 'candidate') {
    const allowed = snapshotMode
      ? STRATEGY_VALIDATION_SNAPSHOT_ANCHOR_UNAVAILABLE_REASONS_V1
      : STRATEGY_VALIDATION_CAMPAIGN_ANCHOR_UNAVAILABLE_REASONS_V1;
    if (!allowed.includes(value.unavailableReason as never)) {
      context.addIssue({ code: 'custom', message: 'Anchor unavailable reason is invalid for its mode.' });
    }
    return;
  }
  if (snapshotMode && value.strategyDataDate === null) {
    context.addIssue({ code: 'custom', message: 'A Snapshot candidate requires strategyDataDate.' });
    return;
  }
  if (snapshotMode !== (value.candidateIdentityVersion === 'snapshot_candidate_identity_v1')) {
    context.addIssue({ code: 'custom', message: 'Candidate identity version does not match mode.' });
  }
  if (value.candidate.target.reason === 'risk_reward_2R'
    && (value.resistanceEvidenceTier !== 'none'
      || value.resistanceEvidenceSnapshotDigests.length !== 0)) {
    context.addIssue({ code: 'custom', message: 'A 2R candidate cannot carry resistance evidence.' });
  }
  if (snapshotMode && value.resistanceEvidenceSnapshotDigests.length !== 0) {
    context.addIssue({ code: 'custom', message: 'Snapshot candidates have no resistance source identity.' });
  }
  if (!snapshotMode && value.candidate.target.reason === 'resistance_level'
    && (value.resistanceEvidenceTier !== 'precommitted_source_unknown'
      || value.resistanceEvidenceSnapshotDigests.length === 0)) {
    context.addIssue({ code: 'custom', message: 'A campaign resistance candidate requires evidence.' });
  }
  if ((!snapshotMode && value.tickEvidence.effectiveDate !== value.anchorDate)
    || (snapshotMode && value.tickEvidence.effectiveDate > value.decisionDate)) {
    context.addIssue({ code: 'custom', message: 'Tick evidence date is invalid for its mode.' });
  }
  const outcomeDates = strategyValidationOutcomeEvidenceDatesV1(value.outcome);
  if (outcomeDates.some(date => date <= value.decisionDate || date > value.outcomeAsOfSession)) {
    context.addIssue({ code: 'custom', message: 'Outcome evidence date is outside its frozen window.' });
  }
  const candidateIsValid = value.candidate.stop.price < value.candidate.entry.price
    && value.candidate.entry.price < value.candidate.target.price;
  const expectedPlannedRisk = candidateIsValid
    ? normalizeArtifactNumber(value.candidate.entry.price - value.candidate.stop.price)
    : null;
  if (value.outcome.plannedRisk !== expectedPlannedRisk) {
    context.addIssue({ code: 'custom', message: 'Outcome planned risk is inconsistent.' });
  }
  if (value.outcome.entryProven
    && value.outcome.entryFill !== null
    && value.outcome.actualRisk !== null) {
    if (value.outcome.entryFill.order !== 'entry') {
      context.addIssue({ code: 'custom', message: 'Entry fill has the wrong order kind.' });
    }
    if (value.outcome.entryFill.holdingDay !== 1
      || value.outcome.entryFill.evaluationSession > STRATEGY_ENTRY_WAIT_SESSIONS_V1) {
      context.addIssue({ code: 'custom', message: 'Entry fill session identity is inconsistent.' });
    }
    const expectedActualRisk = normalizeArtifactNumber(
      value.outcome.entryFill.price - value.candidate.stop.price,
    );
    if (!(expectedActualRisk > 0) || value.outcome.actualRisk !== expectedActualRisk) {
      context.addIssue({ code: 'custom', message: 'Outcome actual risk is inconsistent.' });
    }
  }
  validateOutcomeNumbers(value, context);
  const expected = snapshotMode
    ? digestSnapshotCandidateIdentityV1({
      snapshotDigest: value.selector.mode === 'snapshot'
        ? value.selector.snapshotDigest as SnapshotDigest
        : '' as SnapshotDigest,
      strategyDataDate: value.strategyDataDate as TseSessionDate,
      ...value.candidate,
      duplicateOrdinal: value.duplicateOrdinal,
    })
    : digestCampaignCandidateIdentityV1({
      ticker: value.ticker,
      anchorDate: value.anchorDate as TseSessionDate,
      candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
      resistanceEvidenceTier: value.resistanceEvidenceTier,
      resistanceEvidenceSnapshotDigests: value.resistanceEvidenceSnapshotDigests as SnapshotDigest[],
      ...value.candidate,
      duplicateOrdinal: value.duplicateOrdinal,
    });
  if (value.candidateId !== expected) {
    context.addIssue({ code: 'custom', message: 'candidateId does not match its identity envelope.' });
  }
});

function normalizeArtifactNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function expectedArtifactR(exitPrice: number, entryPrice: number, actualRisk: number): number {
  return normalizeArtifactNumber((exitPrice - entryPrice) / actualRisk);
}

function validateOutcomeNumbers(
  value: z.infer<typeof CandidateCaseSchema>,
  context: z.RefinementCtx,
): void {
  const { outcome } = value;
  if (!outcome.entryProven || outcome.entryFill === null || outcome.actualRisk === null) return;
  const entryFill = outcome.entryFill;
  const actualRisk = outcome.actualRisk;
  const expectedR = (price: number): number => expectedArtifactR(
    price,
    entryFill.price,
    actualRisk,
  );
  const validateTerminal = (
    terminal: Extract<z.infer<typeof TerminalBoundSchema>, { kind: 'stop_hit' | 'target_hit' }>,
  ): void => {
    const expectedOrder = terminal.kind === 'stop_hit' ? 'stop' : 'target';
    if (terminal.exitFill.order !== expectedOrder
      || terminal.exitFill.date < entryFill.date
      || terminal.exitFill.evaluationSession < entryFill.evaluationSession
      || terminal.exitFill.holdingDay
        !== terminal.exitFill.evaluationSession - entryFill.evaluationSession + 1
      || terminal.realizedR !== expectedR(terminal.exitFill.price)) {
      context.addIssue({ code: 'custom', message: 'Terminal outcome evidence is inconsistent.' });
    }
  };
  if (outcome.kind === 'stop_hit' || outcome.kind === 'target_hit') {
    validateTerminal(outcome);
  } else if (outcome.kind === 'horizon_expired') {
    if (outcome.mark.date < entryFill.date
      || (outcome.mark.state === 'available'
        && outcome.mark.markR !== expectedR(outcome.mark.price))) {
      context.addIssue({ code: 'custom', message: 'Horizon mark evidence is inconsistent.' });
    }
  } else if (outcome.kind === 'ambiguous_intraday') {
    if (outcome.ambiguityDate < entryFill.date) {
      context.addIssue({ code: 'custom', message: 'Ambiguity date precedes the entry fill.' });
    }
    for (const bound of [outcome.pessimistic, outcome.optimistic]) {
      if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') validateTerminal(bound);
      else if (bound.kind === 'horizon_expired'
        && (bound.mark.date < entryFill.date
          || (bound.mark.state === 'available'
            && bound.mark.markR !== expectedR(bound.mark.price)))) {
        context.addIssue({ code: 'custom', message: 'Ambiguous mark evidence is inconsistent.' });
      }
    }
  } else if (outcome.kind === 'unavailable' && outcome.reason === 'limit_queue_ambiguous') {
    const expectedEntryState = outcome.limitQueueEvidence.fillKind === 'stop';
    if (outcome.entryProven !== expectedEntryState) {
      context.addIssue({ code: 'custom', message: 'Limit-queue entry state is inconsistent.' });
    }
  }
}

export type StrategyValidationCaseV1 = z.infer<typeof StrategyValidationCaseV1Schema>;
export type StrategyValidationCandidateCaseV1 = Extract<
  StrategyValidationCaseV1,
  { caseKind: 'candidate' }
>;
export type StrategyValidationAnchorUnavailableCaseV1 = Extract<
  StrategyValidationCaseV1,
  { caseKind: 'anchor_unavailable' }
>;

export type SnapshotCandidateIdentityEnvelopeV1 = Readonly<{
  candidateIdentityVersion: 'snapshot_candidate_identity_v1';
  snapshotDigest: SnapshotDigest;
  strategyDataDate: TseSessionDate;
  entry: Readonly<{ reason: StrategyEntryReason; price: number }>;
  stop: Readonly<{ reason: StrategyStopReason; price: number }>;
  target: Readonly<{ reason: StrategyTargetReason; price: number }>;
  duplicateOrdinal: number;
}>;

export type CampaignCandidateIdentityEnvelopeV1 = Readonly<{
  candidateIdentityVersion: 'campaign_candidate_identity_v1';
  ticker: string;
  anchorDate: TseSessionDate;
  candidateGenerationPolicy: typeof STRATEGY_VALIDATION_CAMPAIGN_POLICY;
  resistanceEvidenceTier: 'none' | 'precommitted_source_unknown';
  resistanceEvidenceSnapshotDigests: readonly SnapshotDigest[];
  entry: Readonly<{ reason: StrategyEntryReason; price: number }>;
  stop: Readonly<{ reason: StrategyStopReason; price: number }>;
  target: Readonly<{ reason: StrategyTargetReason; price: number }>;
  duplicateOrdinal: number;
}>;

type SnapshotCandidateIdentityInputV1 = Omit<
  SnapshotCandidateIdentityEnvelopeV1,
  'candidateIdentityVersion'
>;
type CampaignCandidateIdentityInputV1 = Omit<
  CampaignCandidateIdentityEnvelopeV1,
  'candidateIdentityVersion'
>;

function validatedIdentityCandidate(
  candidate: StrategyOutcomeCandidateV1,
  duplicateOrdinal: number,
): StrategyOutcomeCandidateV1 {
  const parsed = StrategyValidationCandidateV1Schema.safeParse(candidate);
  if (!parsed.success || !Number.isSafeInteger(duplicateOrdinal) || duplicateOrdinal < 0) {
    throw new TypeError('Candidate identity input is invalid.');
  }
  return Object.freeze({
    entry: Object.freeze(parsed.data.entry),
    stop: Object.freeze(parsed.data.stop),
    target: Object.freeze(parsed.data.target),
  });
}

function identityCandidate(input: Readonly<{
  entry: StrategyOutcomeCandidateV1['entry'];
  stop: StrategyOutcomeCandidateV1['stop'];
  target: StrategyOutcomeCandidateV1['target'];
}>): StrategyOutcomeCandidateV1 {
  return { entry: input.entry, stop: input.stop, target: input.target };
}

export function snapshotCandidateIdentityEnvelopeV1(
  input: SnapshotCandidateIdentityInputV1,
): SnapshotCandidateIdentityEnvelopeV1 {
  const candidate = validatedIdentityCandidate(identityCandidate(input), input.duplicateOrdinal);
  if (!STRATEGY_VALIDATION_DIGEST_PATTERN.test(input.snapshotDigest)
    || !isStrictGregorianDate(input.strategyDataDate)) {
    throw new TypeError('Snapshot candidate identity input is invalid.');
  }
  return Object.freeze({
    candidateIdentityVersion: 'snapshot_candidate_identity_v1',
    snapshotDigest: input.snapshotDigest,
    strategyDataDate: input.strategyDataDate,
    ...candidate,
    duplicateOrdinal: input.duplicateOrdinal,
  });
}

export function campaignCandidateIdentityEnvelopeV1(
  input: CampaignCandidateIdentityInputV1,
): CampaignCandidateIdentityEnvelopeV1 {
  const candidate = validatedIdentityCandidate(identityCandidate(input), input.duplicateOrdinal);
  const ticker = CanonicalTickerSchema.safeParse(input.ticker);
  const digests = [...input.resistanceEvidenceSnapshotDigests].sort();
  const riskRewardEvidenceIsValid = input.target.reason === 'risk_reward_2R'
    && input.resistanceEvidenceTier === 'none'
    && digests.length === 0;
  const resistanceEvidenceIsValid = input.target.reason === 'resistance_level'
    && input.resistanceEvidenceTier === 'precommitted_source_unknown'
    && digests.length >= 1
    && digests.length <= 8;
  if (!ticker.success || !isStrictGregorianDate(input.anchorDate)
    || input.candidateGenerationPolicy !== STRATEGY_VALIDATION_CAMPAIGN_POLICY
    || (!riskRewardEvidenceIsValid && !resistanceEvidenceIsValid)
    || digests.some((digest, index) => !STRATEGY_VALIDATION_DIGEST_PATTERN.test(digest)
      || (index > 0 && digest === digests[index - 1]))) {
    throw new TypeError('Campaign candidate identity input is invalid.');
  }
  return Object.freeze({
    candidateIdentityVersion: 'campaign_candidate_identity_v1',
    ticker: ticker.data,
    anchorDate: input.anchorDate,
    candidateGenerationPolicy: input.candidateGenerationPolicy,
    resistanceEvidenceTier: input.resistanceEvidenceTier,
    resistanceEvidenceSnapshotDigests: Object.freeze(digests),
    ...candidate,
    duplicateOrdinal: input.duplicateOrdinal,
  });
}

export function digestSnapshotCandidateIdentityV1(
  input: SnapshotCandidateIdentityInputV1,
): SnapshotDigest {
  return sha256CanonicalJsonV1(
    snapshotCandidateIdentityEnvelopeV1(input) as CanonicalJsonValue,
  );
}

export function digestCampaignCandidateIdentityV1(
  input: CampaignCandidateIdentityInputV1,
): SnapshotDigest {
  return sha256CanonicalJsonV1(
    campaignCandidateIdentityEnvelopeV1(input) as CanonicalJsonValue,
  );
}

export function digestStrategyValidationCaseV1(value: unknown): SnapshotDigest {
  const parsed = StrategyValidationCaseV1Schema.parse(value);
  return sha256CanonicalJsonV1(parsed as CanonicalJsonValue);
}

export function validateStrategyValidationCaseV1(value: unknown): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse(value);
}

export function compareStrategyValidationCasesV1(
  left: StrategyValidationCaseV1,
  right: StrategyValidationCaseV1,
): number {
  const leftCandidate = left.caseKind === 'candidate' ? left.candidateId : '';
  const rightCandidate = right.caseKind === 'candidate' ? right.candidateId : '';
  const kindOrder = left.caseKind === right.caseKind
    ? 0
    : left.caseKind === 'anchor_unavailable' ? -1 : 1;
  return compareCodeUnits(left.ticker, right.ticker)
    || compareCodeUnits(left.anchorDate, right.anchorDate)
    || kindOrder
    || compareCodeUnits(leftCandidate, rightCandidate);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalIdentityBytesV1(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJsonV1(value));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

export type AssignedSnapshotCandidateIdentityV1 = Readonly<{
  candidate: StrategyOutcomeCandidateV1;
  duplicateOrdinal: number;
  candidateId: SnapshotDigest;
  envelope: SnapshotCandidateIdentityEnvelopeV1;
}>;

export function assignSnapshotCandidateIdentitiesV1(
  input: Readonly<{
    snapshotDigest: SnapshotDigest;
    strategyDataDate: TseSessionDate;
    candidates: readonly StrategyOutcomeCandidateV1[];
  }>,
): readonly AssignedSnapshotCandidateIdentityV1[] {
  const bases = input.candidates.map(candidateInput => {
    const candidate = validatedIdentityCandidate(candidateInput, 0);
    const base = {
      candidateIdentityVersion: 'snapshot_candidate_identity_v1' as const,
      snapshotDigest: input.snapshotDigest,
      strategyDataDate: input.strategyDataDate,
      ...candidate,
    };
    return { candidate, base, bytes: canonicalIdentityBytesV1(base as CanonicalJsonValue) };
  }).sort((left, right) => compareBytes(left.bytes, right.bytes));
  let previous = '';
  let ordinal = -1;
  const assigned = bases.map(item => {
    const canonical = canonicalJsonV1(item.base as CanonicalJsonValue);
    ordinal = canonical === previous ? ordinal + 1 : 0;
    previous = canonical;
    const envelope = snapshotCandidateIdentityEnvelopeV1({
      snapshotDigest: input.snapshotDigest,
      strategyDataDate: input.strategyDataDate,
      ...item.candidate,
      duplicateOrdinal: ordinal,
    });
    return Object.freeze({
      candidate: item.candidate,
      duplicateOrdinal: ordinal,
      candidateId: sha256CanonicalJsonV1(envelope as CanonicalJsonValue),
      envelope,
    });
  });
  return Object.freeze(assigned.sort((left, right) => (
    compareCodeUnits(left.candidateId, right.candidateId)
  )));
}

export type CampaignCandidateIdentityBaseInputV1 = Readonly<{
  ticker: string;
  anchorDate: TseSessionDate;
  resistanceEvidenceTier: 'none' | 'precommitted_source_unknown';
  resistanceEvidenceSnapshotDigests: readonly SnapshotDigest[];
  candidate: StrategyOutcomeCandidateV1;
}>;

export type AssignedCampaignCandidateIdentityV1 = Readonly<{
  candidate: StrategyOutcomeCandidateV1;
  resistanceEvidenceTier: 'none' | 'precommitted_source_unknown';
  resistanceEvidenceSnapshotDigests: readonly SnapshotDigest[];
  duplicateOrdinal: number;
  candidateId: SnapshotDigest;
  envelope: CampaignCandidateIdentityEnvelopeV1;
}>;

export function assignCampaignCandidateIdentitiesV1(
  input: readonly CampaignCandidateIdentityBaseInputV1[],
): readonly AssignedCampaignCandidateIdentityV1[] {
  const bases = input.map(value => {
    const candidate = validatedIdentityCandidate(value.candidate, 0);
    const normalized = campaignCandidateIdentityEnvelopeV1({
      ticker: value.ticker,
      anchorDate: value.anchorDate,
      candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
      resistanceEvidenceTier: value.resistanceEvidenceTier,
      resistanceEvidenceSnapshotDigests: value.resistanceEvidenceSnapshotDigests,
      ...candidate,
      duplicateOrdinal: 0,
    });
    const { duplicateOrdinal: _ignored, ...base } = normalized;
    return {
      value: Object.freeze({ ...value, candidate }),
      base,
      bytes: canonicalIdentityBytesV1(base as CanonicalJsonValue),
    };
  }).sort((left, right) => compareBytes(left.bytes, right.bytes));
  let previous = '';
  let ordinal = -1;
  const assigned = bases.map(item => {
    const canonical = canonicalJsonV1(item.base as CanonicalJsonValue);
    ordinal = canonical === previous ? ordinal + 1 : 0;
    previous = canonical;
    const envelope = campaignCandidateIdentityEnvelopeV1({
      ticker: item.value.ticker,
      anchorDate: item.value.anchorDate,
      candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
      resistanceEvidenceTier: item.value.resistanceEvidenceTier,
      resistanceEvidenceSnapshotDigests: item.value.resistanceEvidenceSnapshotDigests,
      ...item.value.candidate,
      duplicateOrdinal: ordinal,
    });
    return Object.freeze({
      candidate: item.value.candidate,
      resistanceEvidenceTier: envelope.resistanceEvidenceTier,
      resistanceEvidenceSnapshotDigests: envelope.resistanceEvidenceSnapshotDigests,
      duplicateOrdinal: ordinal,
      candidateId: sha256CanonicalJsonV1(envelope as CanonicalJsonValue),
      envelope,
    });
  });
  return Object.freeze(assigned.sort((left, right) => (
    compareCodeUnits(left.candidateId, right.candidateId)
  )));
}
