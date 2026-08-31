import { z } from 'zod';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import {
  STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1,
  type StrategyAmbiguityBoundV1,
} from './outcome-validator.js';
import {
  STRATEGY_VALIDATION_AGGREGATION_VERSION,
  StrategyValidationCaseV1Schema,
  type StrategyValidationCandidateCaseV1,
  type StrategyValidationCaseV1,
} from './artifacts.js';
import { isStrictGregorianDate } from './date.js';

export const STRATEGY_VALIDATION_AGGREGATION_SCOPE_VERSION =
  'strategy_validation_aggregation_scope_v1' as const;

const finite = z.number().finite();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();

const SnapshotAggregationScopeSchema = z.object({
  scopeVersion: z.literal(STRATEGY_VALIDATION_AGGREGATION_SCOPE_VERSION),
  kind: z.literal('snapshot_ticker'),
  tickers: z.tuple([CanonicalTickerSchema]),
  tickerCount: z.literal(1),
  requestedAnchorCount: z.literal(1),
}).strict();
const CampaignAggregationScopeSchema = z.object({
  scopeVersion: z.literal(STRATEGY_VALIDATION_AGGREGATION_SCOPE_VERSION),
  kind: z.literal('campaign_global'),
  tickers: z.array(CanonicalTickerSchema).min(1).max(500),
  tickerCount: positiveSafeInteger.max(500),
  requestedAnchorCount: positiveSafeInteger.max(500),
}).strict().superRefine((value, context) => {
  if (value.tickerCount !== value.tickers.length) {
    context.addIssue({ code: 'custom', message: 'tickerCount does not match tickers.' });
  }
  for (let index = 1; index < value.tickers.length; index += 1) {
    if (value.tickers[index - 1]! >= value.tickers[index]!) {
      context.addIssue({ code: 'custom', message: 'Campaign tickers must be sorted and unique.' });
      return;
    }
  }
});

export const StrategyValidationAggregationScopeV1Schema = z.discriminatedUnion('kind', [
  SnapshotAggregationScopeSchema,
  CampaignAggregationScopeSchema,
]);
export type StrategyValidationAggregationScopeV1 = z.infer<
  typeof StrategyValidationAggregationScopeV1Schema
>;

const denominatorMetricSchema = z.enum([
  'requestedAnchorCount',
  'candidateBearingAnchorCount',
  'candidateAnchorCount',
  'candidateCount',
]);
export const StrategyValidationRateV1Schema = z.union([
  z.object({
    state: z.literal('available'),
    numerator: nonnegativeSafeInteger,
    denominator: positiveSafeInteger,
    denominatorMetric: denominatorMetricSchema,
    value: finite.min(0).max(1),
  }).strict(),
  z.object({
    state: z.literal('unavailable'),
    numerator: z.literal(0),
    denominator: z.literal(0),
    denominatorMetric: denominatorMetricSchema,
    reason: z.literal('zero_denominator'),
  }).strict(),
]);
export type StrategyValidationRateV1 = z.infer<typeof StrategyValidationRateV1Schema>;

export const StrategyValidationNumericSummaryV1Schema = z.union([
  z.object({
    state: z.literal('available'),
    count: positiveSafeInteger,
    mean: finite,
    median: finite,
  }).strict(),
  z.object({
    state: z.literal('unavailable'),
    count: z.literal(0),
    reason: z.literal('no_values'),
  }).strict(),
]);
export type StrategyValidationNumericSummaryV1 = z.infer<
  typeof StrategyValidationNumericSummaryV1Schema
>;

const CountRateSchema = z.object({
  count: nonnegativeSafeInteger,
  rate: StrategyValidationRateV1Schema,
}).strict();

const AnchorUnavailableMetricSchema = z.object({
  reason: z.enum(STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1),
  count: nonnegativeSafeInteger,
  rate: StrategyValidationRateV1Schema,
}).strict();

export const StrategyValidationTrackMetricsV1Schema = z.object({
  requestedAnchorCount: positiveSafeInteger.max(500),
  anchorUnavailableCount: nonnegativeSafeInteger,
  candidateBearingAnchorCount: nonnegativeSafeInteger,
  enteredAnchorCount: nonnegativeSafeInteger,
  anchorCoverage: StrategyValidationRateV1Schema,
  eligibleAnchorEntryRate: StrategyValidationRateV1Schema,
  requestedAnchorEntryRate: StrategyValidationRateV1Schema,
  anchorUnavailableByReason: z.array(AnchorUnavailableMetricSchema)
    .length(STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1.length),
}).strict();

export const StrategyValidationCandidateStratumV1Schema = z.object({
  confidence: z.enum(['precommitted', 'reconstructed_251_as_of']),
  targetReason: z.enum(['risk_reward_2R', 'resistance_level']),
  stopReason: z.enum(['latest_swing_low', 'entry_minus_1_5_atr']),
  resistanceEvidenceTier: z.enum(['none', 'precommitted_source_unknown']),
  candidateAnchorCount: positiveSafeInteger,
  enteredCandidateAnchorCount: nonnegativeSafeInteger,
  stratumAnchorEntryRate: StrategyValidationRateV1Schema,
  candidateCount: positiveSafeInteger,
  enteredCandidateCount: nonnegativeSafeInteger,
  candidateEntryRate: StrategyValidationRateV1Schema,
  duplicateCandidateCount: nonnegativeSafeInteger,
  outcomes: z.object({
    notTriggered: CountRateSchema,
    stopHit: CountRateSchema,
    targetHit: CountRateSchema,
    horizonExpired: CountRateSchema,
    ambiguousIntraday: CountRateSchema,
    unavailable: CountRateSchema,
  }).strict(),
  exactRealizedR: StrategyValidationNumericSummaryV1Schema,
  horizonMarkR: StrategyValidationNumericSummaryV1Schema,
  pessimisticAmbiguousR: StrategyValidationNumericSummaryV1Schema,
  optimisticAmbiguousR: StrategyValidationNumericSummaryV1Schema,
}).strict();

export const StrategyValidationAggregationV1Schema = z.object({
  aggregationVersion: z.literal(STRATEGY_VALIDATION_AGGREGATION_VERSION),
  track: StrategyValidationTrackMetricsV1Schema,
  candidateStrata: z.array(StrategyValidationCandidateStratumV1Schema),
}).strict();
export type StrategyValidationAggregationV1 = z.infer<
  typeof StrategyValidationAggregationV1Schema
>;

export type StrategyValidationRequestedAnchorV1 = Readonly<{
  ticker: string;
  anchorDate: string;
}>;

function anchorIdentity(anchor: StrategyValidationRequestedAnchorV1): string {
  return `${anchor.ticker}\u0000${anchor.anchorDate}`;
}

export function buildStrategyValidationAggregationScopeV1(
  mode: 'snapshot' | 'campaign',
  anchors: readonly StrategyValidationRequestedAnchorV1[],
): StrategyValidationAggregationScopeV1 {
  if (anchors.length < 1 || anchors.length > 500) {
    throw new TypeError('Requested anchor count is outside the V1 limit.');
  }
  const identities = new Set<string>();
  const tickers = new Set<string>();
  for (const anchor of anchors) {
    const ticker = CanonicalTickerSchema.safeParse(anchor.ticker);
    if (!ticker.success || !isStrictGregorianDate(anchor.anchorDate)) {
      throw new TypeError('A requested anchor is invalid.');
    }
    const identity = anchorIdentity(anchor);
    if (identities.has(identity)) throw new TypeError('Requested anchors must be unique.');
    identities.add(identity);
    tickers.add(ticker.data);
  }
  const sortedTickers = [...tickers].sort();
  if (mode === 'snapshot') {
    if (anchors.length !== 1 || sortedTickers.length !== 1) {
      throw new TypeError('Snapshot aggregation requires exactly one anchor and ticker.');
    }
    return StrategyValidationAggregationScopeV1Schema.parse({
      scopeVersion: STRATEGY_VALIDATION_AGGREGATION_SCOPE_VERSION,
      kind: 'snapshot_ticker',
      tickers: [sortedTickers[0]],
      tickerCount: 1,
      requestedAnchorCount: 1,
    });
  }
  return StrategyValidationAggregationScopeV1Schema.parse({
    scopeVersion: STRATEGY_VALIDATION_AGGREGATION_SCOPE_VERSION,
    kind: 'campaign_global',
    tickers: sortedTickers,
    tickerCount: sortedTickers.length,
    requestedAnchorCount: anchors.length,
  });
}

function rate(
  numerator: number,
  denominator: number,
  denominatorMetric: z.infer<typeof denominatorMetricSchema>,
): StrategyValidationRateV1 {
  if (denominator === 0) {
    return Object.freeze({
      state: 'unavailable', numerator: 0, denominator: 0, denominatorMetric,
      reason: 'zero_denominator',
    });
  }
  const value = numerator / denominator;
  if (!Number.isFinite(value)) throw new TypeError('An aggregate rate is not finite.');
  return Object.freeze({ state: 'available', numerator, denominator, denominatorMetric, value });
}

function numericSummary(values: readonly number[]): StrategyValidationNumericSummaryV1 {
  if (values.length === 0) return Object.freeze({ state: 'unavailable', count: 0, reason: 'no_values' });
  const sorted = [...values].sort((left, right) => left - right);
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new TypeError('An aggregate input is not finite.');
    sum += value;
  }
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const mean = sum / values.length;
  if (!Number.isFinite(mean) || !Number.isFinite(median)) {
    throw new TypeError('An aggregate output is not finite.');
  }
  return Object.freeze({
    state: 'available',
    count: values.length,
    mean: Object.is(mean, -0) ? 0 : mean,
    median: Object.is(median, -0) ? 0 : median,
  });
}

function ambiguousR(bound: StrategyAmbiguityBoundV1): number | null {
  if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') return bound.realizedR;
  if (bound.kind === 'horizon_expired' && bound.mark.state === 'available') return bound.mark.markR;
  return null;
}

const confidenceOrder = ['precommitted', 'reconstructed_251_as_of'] as const;
const targetOrder = ['risk_reward_2R', 'resistance_level'] as const;
const stopOrder = ['latest_swing_low', 'entry_minus_1_5_atr'] as const;
const tierOrder = ['none', 'precommitted_source_unknown'] as const;

function stratumKey(value: StrategyValidationCandidateCaseV1): string {
  return [
    value.confidence,
    value.candidate.target.reason,
    value.candidate.stop.reason,
    value.resistanceEvidenceTier,
  ].join('\u0000');
}

function compareStrata(
  left: StrategyValidationCandidateCaseV1,
  right: StrategyValidationCandidateCaseV1,
): number {
  return confidenceOrder.indexOf(left.confidence) - confidenceOrder.indexOf(right.confidence)
    || targetOrder.indexOf(left.candidate.target.reason) - targetOrder.indexOf(right.candidate.target.reason)
    || stopOrder.indexOf(left.candidate.stop.reason) - stopOrder.indexOf(right.candidate.stop.reason)
    || tierOrder.indexOf(left.resistanceEvidenceTier) - tierOrder.indexOf(right.resistanceEvidenceTier);
}

function outcomeMetric(count: number, candidateCount: number) {
  return Object.freeze({ count, rate: rate(count, candidateCount, 'candidateCount') });
}

function buildStratum(cases: readonly StrategyValidationCandidateCaseV1[]) {
  const sorted = [...cases].sort((left, right) => (
    left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0
  ));
  const first = sorted[0]!;
  const anchors = new Set(sorted.map(anchorIdentity));
  const enteredAnchors = new Set(sorted.filter(value => value.outcome.entryProven).map(anchorIdentity));
  const outcomeCount = (kind: StrategyValidationCandidateCaseV1['outcome']['kind']) => (
    sorted.filter(value => value.outcome.kind === kind).length
  );
  const realized = sorted.flatMap(value => (
    value.outcome.kind === 'stop_hit' || value.outcome.kind === 'target_hit'
      ? [value.outcome.realizedR]
      : []
  ));
  const marks = sorted.flatMap(value => (
    value.outcome.kind === 'horizon_expired' && value.outcome.mark.state === 'available'
      ? [value.outcome.mark.markR]
      : []
  ));
  const pessimistic = sorted.flatMap(value => {
    if (value.outcome.kind !== 'ambiguous_intraday') return [];
    const result = ambiguousR(value.outcome.pessimistic);
    return result === null ? [] : [result];
  });
  const optimistic = sorted.flatMap(value => {
    if (value.outcome.kind !== 'ambiguous_intraday') return [];
    const result = ambiguousR(value.outcome.optimistic);
    return result === null ? [] : [result];
  });
  const candidateCount = sorted.length;
  const enteredCandidateCount = sorted.filter(value => value.outcome.entryProven).length;
  return Object.freeze({
    confidence: first.confidence,
    targetReason: first.candidate.target.reason,
    stopReason: first.candidate.stop.reason,
    resistanceEvidenceTier: first.resistanceEvidenceTier,
    candidateAnchorCount: anchors.size,
    enteredCandidateAnchorCount: enteredAnchors.size,
    stratumAnchorEntryRate: rate(enteredAnchors.size, anchors.size, 'candidateAnchorCount'),
    candidateCount,
    enteredCandidateCount,
    candidateEntryRate: rate(enteredCandidateCount, candidateCount, 'candidateCount'),
    duplicateCandidateCount: sorted.filter(value => value.duplicateOrdinal > 0).length,
    outcomes: Object.freeze({
      notTriggered: outcomeMetric(outcomeCount('not_triggered'), candidateCount),
      stopHit: outcomeMetric(outcomeCount('stop_hit'), candidateCount),
      targetHit: outcomeMetric(outcomeCount('target_hit'), candidateCount),
      horizonExpired: outcomeMetric(outcomeCount('horizon_expired'), candidateCount),
      ambiguousIntraday: outcomeMetric(outcomeCount('ambiguous_intraday'), candidateCount),
      unavailable: outcomeMetric(outcomeCount('unavailable'), candidateCount),
    }),
    exactRealizedR: numericSummary(realized),
    horizonMarkR: numericSummary(marks),
    pessimisticAmbiguousR: numericSummary(pessimistic),
    optimisticAmbiguousR: numericSummary(optimistic),
  });
}

export function aggregateStrategyValidationCasesV1(
  scopeValue: StrategyValidationAggregationScopeV1,
  requestedAnchors: readonly StrategyValidationRequestedAnchorV1[],
  rawCases: readonly unknown[],
): StrategyValidationAggregationV1 {
  const scope = StrategyValidationAggregationScopeV1Schema.parse(scopeValue);
  const expectedScope = buildStrategyValidationAggregationScopeV1(
    scope.kind === 'snapshot_ticker' ? 'snapshot' : 'campaign',
    requestedAnchors,
  );
  if (JSON.stringify(scope) !== JSON.stringify(expectedScope)) {
    throw new TypeError('Aggregation scope does not match requested anchors.');
  }
  const cases = rawCases.map(value => StrategyValidationCaseV1Schema.parse(value));
  const expectedAnchors = new Set(requestedAnchors.map(anchorIdentity));
  const byAnchor = new Map<string, StrategyValidationCaseV1[]>();
  const caseIds = new Set<string>();
  const candidateIds = new Set<string>();
  for (const value of cases) {
    const identity = anchorIdentity(value);
    if (!expectedAnchors.has(identity)) throw new TypeError('A case is outside the requested anchors.');
    if (caseIds.has(value.caseId)) throw new TypeError('Case IDs must be unique.');
    caseIds.add(value.caseId);
    if (value.caseKind === 'candidate') {
      if (candidateIds.has(value.candidateId)) throw new TypeError('Candidate IDs must be unique.');
      candidateIds.add(value.candidateId);
    }
    const group = byAnchor.get(identity) ?? [];
    group.push(value);
    byAnchor.set(identity, group);
  }
  for (const identity of expectedAnchors) {
    const group = byAnchor.get(identity);
    if (group === undefined || group.length === 0) throw new TypeError('A requested anchor has no case.');
    const unavailableCount = group.filter(value => value.caseKind === 'anchor_unavailable').length;
    if (unavailableCount > 1 || (unavailableCount === 1 && group.length !== 1)) {
      throw new TypeError('An anchor mixes unavailable and candidate cases.');
    }
  }
  const unavailableCases = cases.filter((value): value is Extract<StrategyValidationCaseV1, {
    caseKind: 'anchor_unavailable';
  }> => value.caseKind === 'anchor_unavailable');
  const candidateCases = cases.filter((value): value is StrategyValidationCandidateCaseV1 => (
    value.caseKind === 'candidate'
  ));
  const candidateAnchors = new Set(candidateCases.map(anchorIdentity));
  const enteredAnchors = new Set(
    candidateCases.filter(value => value.outcome.entryProven).map(anchorIdentity),
  );
  const requestedCount = requestedAnchors.length;
  const unavailableByReason = STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1.map(reason => {
    const count = unavailableCases.filter(value => value.unavailableReason === reason).length;
    return Object.freeze({
      reason,
      count,
      rate: rate(count, requestedCount, 'requestedAnchorCount'),
    });
  });

  const groups = new Map<string, StrategyValidationCandidateCaseV1[]>();
  for (const candidate of candidateCases) {
    const key = stratumKey(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const strata = [...groups.values()]
    .sort((left, right) => compareStrata(left[0]!, right[0]!))
    .map(buildStratum);
  const result = {
    aggregationVersion: STRATEGY_VALIDATION_AGGREGATION_VERSION,
    track: {
      requestedAnchorCount: requestedCount,
      anchorUnavailableCount: unavailableCases.length,
      candidateBearingAnchorCount: candidateAnchors.size,
      enteredAnchorCount: enteredAnchors.size,
      anchorCoverage: rate(candidateAnchors.size, requestedCount, 'requestedAnchorCount'),
      eligibleAnchorEntryRate: rate(
        enteredAnchors.size,
        candidateAnchors.size,
        'candidateBearingAnchorCount',
      ),
      requestedAnchorEntryRate: rate(enteredAnchors.size, requestedCount, 'requestedAnchorCount'),
      anchorUnavailableByReason: unavailableByReason,
    },
    candidateStrata: strata,
  };
  return StrategyValidationAggregationV1Schema.parse(result);
}
