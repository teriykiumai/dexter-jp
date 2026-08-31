import type {
  StrategyEntryReason,
  StrategyStopReason,
  StrategyTargetReason,
} from '../../tools/finance/strategy-engine.js';
import type { TseSessionCalendarV1 } from './calendar.js';
import {
  parseTseSessionDate,
  type OutcomeAsOfSession,
  type TseSessionDate,
} from './date.js';
import { parseDailyBarV1, hasCorporateActionV1, type TseDailyBarV1 } from './daily-bar.js';
import { PointInTimeErrorV1 } from './errors.js';
import { isExecutableTsePriceV1, type TseTickCategoryV1 } from './tick.js';

export const STRATEGY_OUTCOME_ALGORITHM_VERSION_V1 = 'daily_long_fill_v1' as const;
export const STRATEGY_LIMIT_QUEUE_VERSION_V1 = 'adverse_flagged_boundary_v1' as const;
export const STRATEGY_ENTRY_WAIT_SESSIONS_V1 = 20 as const;
export const STRATEGY_HOLDING_SESSIONS_V1 = 60 as const;
export const STRATEGY_WORST_CASE_EVALUATION_SESSION_V1 = 79 as const;

export const STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1 = Object.freeze([
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
  'strategy_data_date_invalid',
  'future_strategy_data',
  'invalid_candidate',
  'resistance_evidence_invalid',
  'limit_queue_ambiguous',
] as const);

export type StrategyOutcomeUnavailableReasonV1 =
  (typeof STRATEGY_OUTCOME_UNAVAILABLE_REASONS_V1)[number];

type StrategyOutcomeNonQueueUnavailableReasonV1 = Exclude<
  StrategyOutcomeUnavailableReasonV1,
  'limit_queue_ambiguous'
>;

export type StrategyOutcomeCandidateV1 = Readonly<{
  entry: Readonly<{ price: number; reason: StrategyEntryReason }>;
  stop: Readonly<{ price: number; reason: StrategyStopReason }>;
  target: Readonly<{ price: number; reason: StrategyTargetReason }>;
}>;

export type StrategyTickCategoryEvidenceV1 = Readonly<{
  date: TseSessionDate;
  categories: readonly TseTickCategoryV1[];
}>;

export type StrategyOutcomeFillV1 = Readonly<{
  date: TseSessionDate;
  evaluationSession: number;
  holdingDay: number;
  order: 'entry' | 'stop' | 'target';
  method: 'open' | 'entry_level' | 'stop_level' | 'target_level';
  price: number;
}>;

export type StrategyOutcomeMarkV1 = Readonly<{
  state: 'available';
  date: TseSessionDate;
  price: number;
  markR: number;
}> | Readonly<{
  state: 'unavailable';
  date: TseSessionDate;
}>;

export type StrategyLimitQueueEvidenceV1 = Readonly<{
  date: TseSessionDate;
  orderSide: 'buy' | 'sell';
  fillKind: 'entry' | 'stop';
  selectedFillPrice: number;
  boundaryKind: 'upper' | 'lower';
  boundaryPrice: number;
  sourceFlag: 'UL' | 'LL';
}>;

export type StrategyAmbiguityBoundV1 = Readonly<{
  kind: 'stop_hit' | 'target_hit';
  exitFill: StrategyOutcomeFillV1;
  realizedR: number;
}> | Readonly<{
  kind: 'horizon_expired';
  mark: StrategyOutcomeMarkV1;
}> | Readonly<{
  kind: 'unavailable';
  reason: 'outcome_not_matured';
}>;

type StrategyOutcomeBaseV1 = Readonly<{
  algorithmVersion: typeof STRATEGY_OUTCOME_ALGORITHM_VERSION_V1;
  limitQueueVersion: typeof STRATEGY_LIMIT_QUEUE_VERSION_V1;
  plannedRisk: number | null;
  evaluationEndDate: TseSessionDate | null;
  entryProven: boolean;
  entryFill: StrategyOutcomeFillV1 | null;
  actualRisk: number | null;
}>;

export type StrategyOutcomeResultV1 =
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'not_triggered';
    entryProven: false;
    entryFill: null;
    actualRisk: null;
  }>)
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'stop_hit' | 'target_hit';
    entryProven: true;
    entryFill: StrategyOutcomeFillV1;
    actualRisk: number;
    exitFill: StrategyOutcomeFillV1;
    realizedR: number;
  }>)
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'horizon_expired';
    entryProven: true;
    entryFill: StrategyOutcomeFillV1;
    actualRisk: number;
    mark: StrategyOutcomeMarkV1;
  }>)
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'ambiguous_intraday';
    entryProven: true;
    entryFill: StrategyOutcomeFillV1;
    actualRisk: number;
    ambiguityDate: TseSessionDate;
    pessimistic: StrategyAmbiguityBoundV1;
    optimistic: StrategyAmbiguityBoundV1;
  }>)
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'unavailable';
    reason: StrategyOutcomeNonQueueUnavailableReasonV1;
    limitQueueEvidence?: never;
  }>)
  | (StrategyOutcomeBaseV1 & Readonly<{
    kind: 'unavailable';
    reason: 'limit_queue_ambiguous';
    limitQueueEvidence: StrategyLimitQueueEvidenceV1;
  }>);

export type StrategyOutcomeInputV1 = Readonly<{
  candidate: StrategyOutcomeCandidateV1;
  decisionDate: TseSessionDate;
  outcomeAsOfSession: OutcomeAsOfSession;
  initialTickDate: TseSessionDate;
  tickCategoryEvidence: readonly StrategyTickCategoryEvidenceV1[];
  calendar: TseSessionCalendarV1;
  bars: readonly TseDailyBarV1[];
}>;

type RuntimeContext = {
  plannedRisk: number | null;
  evaluationEndDate: TseSessionDate | null;
  entryFill: StrategyOutcomeFillV1 | null;
  actualRisk: number | null;
};

type ExactTerminal = Readonly<{
  kind: 'stop_hit' | 'target_hit';
  fill: StrategyOutcomeFillV1;
}>;

type OpenEvaluation =
  | Readonly<{ state: 'open' }>
  | Readonly<{ state: 'terminal'; terminal: ExactTerminal }>
  | Readonly<{
    state: 'ambiguous';
    pessimistic: ExactTerminal;
    optimistic: ExactTerminal | null;
  }>
  | Readonly<{
    state: 'unavailable';
    reason: StrategyOutcomeNonQueueUnavailableReasonV1;
    limitQueueEvidence?: never;
  }>
  | Readonly<{
    state: 'unavailable';
    reason: 'limit_queue_ambiguous';
    limitQueueEvidence: StrategyLimitQueueEvidenceV1;
  }>;

const SUPPORTED_ENTRY_REASONS = new Set<unknown>(['breakout_above_swing_high']);
const SUPPORTED_STOP_REASONS = new Set<unknown>(['latest_swing_low', 'entry_minus_1_5_atr']);
const SUPPORTED_TARGET_REASONS = new Set<unknown>(['risk_reward_2R', 'resistance_level']);

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizedNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'An outcome calculation is not finite.');
  }
  return Object.is(value, -0) ? 0 : value;
}

function base(context: RuntimeContext): StrategyOutcomeBaseV1 {
  return {
    algorithmVersion: STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
    limitQueueVersion: STRATEGY_LIMIT_QUEUE_VERSION_V1,
    plannedRisk: context.plannedRisk,
    evaluationEndDate: context.evaluationEndDate,
    entryProven: context.entryFill !== null,
    entryFill: context.entryFill,
    actualRisk: context.actualRisk,
  };
}

function unavailable(
  context: RuntimeContext,
  reason: StrategyOutcomeNonQueueUnavailableReasonV1,
): StrategyOutcomeResultV1 {
  return Object.freeze({
    ...base(context),
    kind: 'unavailable',
    reason,
  });
}

function limitQueueUnavailable(
  context: RuntimeContext,
  limitQueueEvidence: StrategyLimitQueueEvidenceV1,
): StrategyOutcomeResultV1 {
  return Object.freeze({
    ...base(context),
    kind: 'unavailable',
    reason: 'limit_queue_ambiguous',
    limitQueueEvidence,
  });
}

function exactR(exitPrice: number, entryFill: StrategyOutcomeFillV1, actualRisk: number): number {
  return normalizedNumber((exitPrice - entryFill.price) / actualRisk);
}

function exactTerminalResult(
  context: RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
  terminal: ExactTerminal,
): StrategyOutcomeResultV1 {
  return Object.freeze({
    ...base(context),
    kind: terminal.kind,
    entryProven: true,
    entryFill: context.entryFill,
    actualRisk: context.actualRisk,
    exitFill: terminal.fill,
    realizedR: exactR(terminal.fill.price, context.entryFill, context.actualRisk),
  });
}

function terminalBound(
  terminal: ExactTerminal,
  entryFill: StrategyOutcomeFillV1,
  actualRisk: number,
): StrategyAmbiguityBoundV1 {
  return Object.freeze({
    kind: terminal.kind,
    exitFill: terminal.fill,
    realizedR: exactR(terminal.fill.price, entryFill, actualRisk),
  });
}

function outcomeErrorReason(error: PointInTimeErrorV1): StrategyOutcomeNonQueueUnavailableReasonV1 {
  if (error.code === 'calendar_incomplete') return 'calendar_incomplete';
  if (error.code === 'price_history_incomplete') return 'price_history_incomplete';
  return 'source_response_invalid';
}

function candidatePlannedRisk(candidate: StrategyOutcomeCandidateV1): number | null {
  if (typeof candidate !== 'object' || candidate === null
    || typeof candidate.entry !== 'object' || candidate.entry === null
    || typeof candidate.stop !== 'object' || candidate.stop === null
    || typeof candidate.target !== 'object' || candidate.target === null
    || !finitePositive(candidate.entry.price)
    || !finitePositive(candidate.stop.price)
    || !finitePositive(candidate.target.price)
    || !SUPPORTED_ENTRY_REASONS.has(candidate.entry.reason)
    || !SUPPORTED_STOP_REASONS.has(candidate.stop.reason)
    || !SUPPORTED_TARGET_REASONS.has(candidate.target.reason)
    || !(candidate.stop.price < candidate.entry.price
      && candidate.entry.price < candidate.target.price)) {
    return null;
  }
  const plannedRisk = normalizedNumber(candidate.entry.price - candidate.stop.price);
  return plannedRisk > 0 ? plannedRisk : null;
}

function tickEvidenceByDate(
  evidence: readonly StrategyTickCategoryEvidenceV1[],
): ReadonlyMap<string, readonly TseTickCategoryV1[]> {
  const result = new Map<string, readonly TseTickCategoryV1[]>();
  let previous: string | null = null;
  for (const item of evidence) {
    if (typeof item !== 'object' || item === null || !Array.isArray(item.categories)) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Tick category evidence is invalid.');
    }
    const date = parseTseSessionDate(item.date);
    if (previous !== null && date <= previous) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Tick category evidence must be strictly increasing and unique.');
    }
    previous = date;
    result.set(date, Object.freeze([...item.categories]));
  }
  return result;
}

function levelTickReason(
  date: TseSessionDate,
  price: number,
  evidence: ReadonlyMap<string, readonly TseTickCategoryV1[]>,
): 'tick_rule_period_unsupported' | 'tick_category_unavailable' | 'non_executable_tick' | null {
  const categories = evidence.get(date) ?? [];
  const executable = isExecutableTsePriceV1(date, categories, price);
  if (executable.state === 'unavailable') return executable.reason;
  return executable.executable ? null : 'non_executable_tick';
}

function validateCandidateTicks(
  candidate: StrategyOutcomeCandidateV1,
  initialTickDate: TseSessionDate,
  evidence: ReadonlyMap<string, readonly TseTickCategoryV1[]>,
): 'tick_rule_period_unsupported' | 'tick_category_unavailable' | 'non_executable_tick' | null {
  for (const price of [candidate.entry.price, candidate.stop.price, candidate.target.price]) {
    const reason = levelTickReason(initialTickDate, price, evidence);
    if (reason !== null) return reason;
  }
  return null;
}

export function resolveLongStrategyInitialFailureWithoutMasterV1(
  candidate: StrategyOutcomeCandidateV1,
  initialTickDate: TseSessionDate,
): 'invalid_candidate' | 'tick_rule_period_unsupported' | 'tick_category_unavailable' {
  if (candidatePlannedRisk(candidate) === null) return 'invalid_candidate';
  const reason = validateCandidateTicks(candidate, initialTickDate, new Map());
  if (reason === 'non_executable_tick' || reason === null) {
    throw new TypeError('Missing Master evidence unexpectedly resolved an executable tick.');
  }
  return reason;
}

function fill(
  date: TseSessionDate,
  evaluationSession: number,
  holdingDay: number,
  order: StrategyOutcomeFillV1['order'],
  method: StrategyOutcomeFillV1['method'],
  price: number,
): StrategyOutcomeFillV1 {
  return Object.freeze({ date, evaluationSession, holdingDay, order, method, price });
}

function upperEntryQueueEvidence(
  bar: TseDailyBarV1,
  selectedFillPrice: number,
): StrategyLimitQueueEvidenceV1 | null {
  if (bar.upperLimitFlag !== '1' || bar.high !== selectedFillPrice) return null;
  return Object.freeze({
    date: bar.date,
    orderSide: 'buy',
    fillKind: 'entry',
    selectedFillPrice,
    boundaryKind: 'upper',
    boundaryPrice: bar.high,
    sourceFlag: 'UL',
  });
}

function lowerStopQueueEvidence(
  bar: TseDailyBarV1,
  selectedFillPrice: number,
): StrategyLimitQueueEvidenceV1 | null {
  if (bar.lowerLimitFlag !== '1' || bar.low !== selectedFillPrice) return null;
  return Object.freeze({
    date: bar.date,
    orderSide: 'sell',
    fillKind: 'stop',
    selectedFillPrice,
    boundaryKind: 'lower',
    boundaryPrice: bar.low,
    sourceFlag: 'LL',
  });
}

function stopTerminal(
  bar: TseDailyBarV1,
  evaluationSession: number,
  holdingDay: number,
  method: 'open' | 'stop_level',
  price: number,
): ExactTerminal {
  return Object.freeze({
    kind: 'stop_hit',
    fill: fill(bar.date, evaluationSession, holdingDay, 'stop', method, price),
  });
}

function targetTerminal(
  bar: TseDailyBarV1,
  evaluationSession: number,
  holdingDay: number,
  price: number,
): ExactTerminal {
  return Object.freeze({
    kind: 'target_hit',
    fill: fill(bar.date, evaluationSession, holdingDay, 'target', 'target_level', price),
  });
}

function unavailableEvaluation(
  reason: StrategyOutcomeNonQueueUnavailableReasonV1,
): OpenEvaluation {
  return Object.freeze({
    state: 'unavailable',
    reason,
  });
}


function limitQueueUnavailableEvaluation(
  limitQueueEvidence: StrategyLimitQueueEvidenceV1,
): OpenEvaluation {
  return Object.freeze({
    state: 'unavailable',
    reason: 'limit_queue_ambiguous',
    limitQueueEvidence,
  });
}

function validateFillLevel(
  date: TseSessionDate,
  price: number,
  evidence: ReadonlyMap<string, readonly TseTickCategoryV1[]>,
): OpenEvaluation | null {
  const reason = levelTickReason(date, price, evidence);
  return reason === null ? null : unavailableEvaluation(reason);
}

function evaluateOpenPosition(
  bar: TseDailyBarV1,
  evaluationSession: number,
  holdingDay: number,
  candidate: StrategyOutcomeCandidateV1,
  evidence: ReadonlyMap<string, readonly TseTickCategoryV1[]>,
): OpenEvaluation {
  if (bar.open === null || bar.high === null || bar.low === null) {
    return Object.freeze({ state: 'open' });
  }
  if (bar.open <= candidate.stop.price) {
    const tickFailure = validateFillLevel(bar.date, candidate.stop.price, evidence);
    if (tickFailure !== null) return tickFailure;
    const queue = lowerStopQueueEvidence(bar, bar.open);
    return queue === null
      ? Object.freeze({
        state: 'terminal',
        terminal: stopTerminal(bar, evaluationSession, holdingDay, 'open', bar.open),
      })
      : limitQueueUnavailableEvaluation(queue);
  }
  if (bar.open >= candidate.target.price) {
    const tickFailure = validateFillLevel(bar.date, candidate.target.price, evidence);
    if (tickFailure !== null) return tickFailure;
    return Object.freeze({
      state: 'terminal',
      terminal: targetTerminal(bar, evaluationSession, holdingDay, candidate.target.price),
    });
  }

  const stopTouched = bar.low <= candidate.stop.price;
  const targetTouched = bar.high >= candidate.target.price;
  if (stopTouched) {
    const tickFailure = validateFillLevel(bar.date, candidate.stop.price, evidence);
    if (tickFailure !== null) return tickFailure;
    const queue = lowerStopQueueEvidence(bar, candidate.stop.price);
    if (queue !== null) return limitQueueUnavailableEvaluation(queue);
  }
  if (targetTouched) {
    const tickFailure = validateFillLevel(bar.date, candidate.target.price, evidence);
    if (tickFailure !== null) return tickFailure;
  }
  if (stopTouched && targetTouched) {
    return Object.freeze({
      state: 'ambiguous',
      pessimistic: stopTerminal(bar, evaluationSession, holdingDay, 'stop_level', candidate.stop.price),
      optimistic: targetTerminal(bar, evaluationSession, holdingDay, candidate.target.price),
    });
  }
  if (stopTouched) {
    return Object.freeze({
      state: 'terminal',
      terminal: stopTerminal(bar, evaluationSession, holdingDay, 'stop_level', candidate.stop.price),
    });
  }
  if (targetTouched) {
    return Object.freeze({
      state: 'terminal',
      terminal: targetTerminal(bar, evaluationSession, holdingDay, candidate.target.price),
    });
  }
  return Object.freeze({ state: 'open' });
}

function evaluateThresholdEntryBar(
  bar: TseDailyBarV1,
  evaluationSession: number,
  candidate: StrategyOutcomeCandidateV1,
  evidence: ReadonlyMap<string, readonly TseTickCategoryV1[]>,
): OpenEvaluation {
  if (bar.high === null || bar.low === null || bar.close === null) {
    throw new PointInTimeErrorV1('source_response_invalid', 'A traded entry bar is incomplete.');
  }
  const stopTouched = bar.low <= candidate.stop.price;
  const targetTouched = bar.high >= candidate.target.price;
  if (stopTouched) {
    const tickFailure = validateFillLevel(bar.date, candidate.stop.price, evidence);
    if (tickFailure !== null) return tickFailure;
    const queue = lowerStopQueueEvidence(bar, candidate.stop.price);
    if (queue !== null) return limitQueueUnavailableEvaluation(queue);
  }
  if (targetTouched) {
    const tickFailure = validateFillLevel(bar.date, candidate.target.price, evidence);
    if (tickFailure !== null) return tickFailure;
  }
  if (targetTouched && stopTouched) {
    return Object.freeze({
      state: 'ambiguous',
      pessimistic: stopTerminal(bar, evaluationSession, 1, 'stop_level', candidate.stop.price),
      optimistic: targetTerminal(bar, evaluationSession, 1, candidate.target.price),
    });
  }
  if (targetTouched) {
    return Object.freeze({
      state: 'terminal',
      terminal: targetTerminal(bar, evaluationSession, 1, candidate.target.price),
    });
  }
  if (!stopTouched) return Object.freeze({ state: 'open' });
  const pessimistic = stopTerminal(bar, evaluationSession, 1, 'stop_level', candidate.stop.price);
  return bar.close <= candidate.stop.price
    ? Object.freeze({ state: 'terminal', terminal: pessimistic })
    : Object.freeze({ state: 'ambiguous', pessimistic, optimistic: null });
}

function markAtHorizon(
  bar: TseDailyBarV1,
  entryFill: StrategyOutcomeFillV1,
  actualRisk: number,
): StrategyOutcomeMarkV1 {
  return bar.close === null
    ? Object.freeze({ state: 'unavailable', date: bar.date })
    : Object.freeze({
      state: 'available',
      date: bar.date,
      price: bar.close,
      markR: exactR(bar.close, entryFill, actualRisk),
    });
}

function ambiguityBoundR(bound: StrategyAmbiguityBoundV1): number | null {
  if (bound.kind === 'stop_hit' || bound.kind === 'target_hit') return bound.realizedR;
  if (bound.kind === 'horizon_expired' && bound.mark.state === 'available') {
    return bound.mark.markR;
  }
  return null;
}

function orderNumericAmbiguityBounds(
  first: StrategyAmbiguityBoundV1,
  second: StrategyAmbiguityBoundV1,
): readonly [StrategyAmbiguityBoundV1, StrategyAmbiguityBoundV1] {
  const firstR = ambiguityBoundR(first);
  const secondR = ambiguityBoundR(second);
  return firstR !== null && secondR !== null && secondR < firstR
    ? Object.freeze([second, first])
    : Object.freeze([first, second]);
}

function ambiguityResult(
  context: RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
  ambiguityDate: TseSessionDate,
  initialPessimistic: ExactTerminal,
  survivingBranch: StrategyAmbiguityBoundV1,
): StrategyOutcomeResultV1 {
  const initialBound = terminalBound(initialPessimistic, context.entryFill, context.actualRisk);
  const [pessimistic, optimistic] = orderNumericAmbiguityBounds(initialBound, survivingBranch);
  return Object.freeze({
    ...base(context),
    kind: 'ambiguous_intraday',
    entryProven: true,
    entryFill: context.entryFill,
    actualRisk: context.actualRisk,
    ambiguityDate,
    pessimistic,
    optimistic,
  });
}

function validateOutcome(input: StrategyOutcomeInputV1, context: RuntimeContext): StrategyOutcomeResultV1 {
  const plannedRisk = candidatePlannedRisk(input.candidate);
  if (plannedRisk === null) return unavailable(context, 'invalid_candidate');
  context.plannedRisk = plannedRisk;

  const decisionDate = parseTseSessionDate(input.decisionDate);
  const outcomeAsOfSession = parseTseSessionDate(input.outcomeAsOfSession);
  const initialTickDate = parseTseSessionDate(input.initialTickDate);
  if (!input.calendar.hasCalendarDate(decisionDate)
    || !input.calendar.hasCalendarDate(initialTickDate)
    || !input.calendar.isSession(outcomeAsOfSession)) {
    return unavailable(context, 'calendar_incomplete');
  }
  if (!input.calendar.isSession(initialTickDate) || initialTickDate > decisionDate) {
    return unavailable(context, 'source_response_invalid');
  }

  const tickEvidence = tickEvidenceByDate(input.tickCategoryEvidence);
  const initialTickFailure = validateCandidateTicks(input.candidate, initialTickDate, tickEvidence);
  if (initialTickFailure !== null) return unavailable(context, initialTickFailure);

  const evaluationSessions = input.calendar.sessions
    .filter(date => date > decisionDate && date <= outcomeAsOfSession)
    .slice(0, STRATEGY_WORST_CASE_EVALUATION_SESSION_V1);
  const allowedSessions = new Set<string>(evaluationSessions);
  const bars = new Map<string, TseDailyBarV1>();
  let previousBarDate: string | null = null;
  for (const bar of input.bars) {
    const date = parseTseSessionDate(bar.date);
    if (previousBarDate !== null && date <= previousBarDate) {
      return unavailable(context, 'source_response_invalid');
    }
    if (!allowedSessions.has(date) || bars.has(date)) {
      return unavailable(context, 'source_response_invalid');
    }
    previousBarDate = date;
    bars.set(date, bar);
  }

  let ambiguousPessimistic: ExactTerminal | null = null;
  let ambiguityDate: TseSessionDate | null = null;
  for (let index = 0; index < evaluationSessions.length; index += 1) {
    const date = evaluationSessions[index]!;
    const evaluationSession = index + 1;
    context.evaluationEndDate = date;
    const sourceBar = bars.get(date);
    if (sourceBar === undefined) return unavailable(context, 'price_history_incomplete');
    const bar = parseDailyBarV1(sourceBar);
    if (hasCorporateActionV1(bar)) {
      return unavailable(context, 'corporate_action_in_outcome_window');
    }

    if (context.entryFill === null) {
      if (bar.open === null || bar.high === null) {
        if (evaluationSession === STRATEGY_ENTRY_WAIT_SESSIONS_V1) {
          return Object.freeze({
            ...base(context), kind: 'not_triggered', entryProven: false, entryFill: null, actualRisk: null,
          });
        }
        continue;
      }
      if (bar.high < input.candidate.entry.price) {
        if (evaluationSession === STRATEGY_ENTRY_WAIT_SESSIONS_V1) {
          return Object.freeze({
            ...base(context), kind: 'not_triggered', entryProven: false, entryFill: null, actualRisk: null,
          });
        }
        continue;
      }
      if (bar.open >= input.candidate.target.price) {
        return unavailable(context, 'entry_gap_beyond_target');
      }

      const entryAtOpen = bar.open >= input.candidate.entry.price;
      const selectedEntryPrice = entryAtOpen ? bar.open : input.candidate.entry.price;
      const entryTickFailure = levelTickReason(bar.date, input.candidate.entry.price, tickEvidence);
      if (entryTickFailure !== null) return unavailable(context, entryTickFailure);
      const queue = upperEntryQueueEvidence(bar, selectedEntryPrice);
      if (queue !== null) return limitQueueUnavailable(context, queue);
      const entryFill = fill(
        bar.date,
        evaluationSession,
        1,
        'entry',
        entryAtOpen ? 'open' : 'entry_level',
        selectedEntryPrice,
      );
      const actualRisk = normalizedNumber(entryFill.price - input.candidate.stop.price);
      if (!(actualRisk > 0)) return unavailable(context, 'invalid_candidate');
      context.entryFill = entryFill;
      context.actualRisk = actualRisk;

      const evaluated = entryAtOpen
        ? evaluateOpenPosition(bar, evaluationSession, 1, input.candidate, tickEvidence)
        : evaluateThresholdEntryBar(bar, evaluationSession, input.candidate, tickEvidence);
      if (evaluated.state === 'unavailable') {
        return evaluated.reason === 'limit_queue_ambiguous'
          ? limitQueueUnavailable(context, evaluated.limitQueueEvidence)
          : unavailable(context, evaluated.reason);
      }
      if (evaluated.state === 'terminal') return exactTerminalResult(
        context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
        evaluated.terminal,
      );
      if (evaluated.state === 'ambiguous') {
        if (evaluated.optimistic !== null) {
          return ambiguityResult(
            context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
            bar.date,
            evaluated.pessimistic,
            terminalBound(evaluated.optimistic, entryFill, actualRisk),
          );
        }
        ambiguousPessimistic = evaluated.pessimistic;
        ambiguityDate = bar.date;
      }
    } else {
      const holdingDay = evaluationSession - context.entryFill.evaluationSession + 1;
      const evaluated = evaluateOpenPosition(
        bar,
        evaluationSession,
        holdingDay,
        input.candidate,
        tickEvidence,
      );
      if (evaluated.state === 'unavailable') {
        return evaluated.reason === 'limit_queue_ambiguous'
          ? limitQueueUnavailable(context, evaluated.limitQueueEvidence)
          : unavailable(context, evaluated.reason);
      }
      if (evaluated.state === 'terminal') {
        if (ambiguousPessimistic === null) {
          return exactTerminalResult(
            context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
            evaluated.terminal,
          );
        }
        return ambiguityResult(
          context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
          ambiguityDate!,
          ambiguousPessimistic,
          terminalBound(evaluated.terminal, context.entryFill, context.actualRisk!),
        );
      }
      if (evaluated.state === 'ambiguous') {
        if (ambiguousPessimistic === null) {
          return ambiguityResult(
            context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
            bar.date,
            evaluated.pessimistic,
            terminalBound(evaluated.optimistic!, context.entryFill, context.actualRisk!),
          );
        }
        return ambiguityResult(
          context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
          ambiguityDate!,
          ambiguousPessimistic,
          terminalBound(evaluated.optimistic!, context.entryFill, context.actualRisk!),
        );
      }
    }

    if (context.entryFill !== null) {
      const holdingDay = evaluationSession - context.entryFill.evaluationSession + 1;
      if (holdingDay === STRATEGY_HOLDING_SESSIONS_V1) {
        const mark = markAtHorizon(bar, context.entryFill, context.actualRisk!);
        if (ambiguousPessimistic !== null) {
          return ambiguityResult(
            context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
            ambiguityDate!,
            ambiguousPessimistic,
            Object.freeze({ kind: 'horizon_expired', mark }),
          );
        }
        return Object.freeze({
          ...base(context),
          kind: 'horizon_expired',
          entryProven: true,
          entryFill: context.entryFill,
          actualRisk: context.actualRisk!,
          mark,
        });
      }
    }
  }

  if (ambiguousPessimistic !== null && context.entryFill !== null && context.actualRisk !== null) {
    return ambiguityResult(
      context as RuntimeContext & { entryFill: StrategyOutcomeFillV1; actualRisk: number },
      ambiguityDate!,
      ambiguousPessimistic,
      Object.freeze({ kind: 'unavailable', reason: 'outcome_not_matured' }),
    );
  }
  return unavailable(context, 'outcome_not_matured');
}

export function validateLongStrategyOutcomeV1(input: StrategyOutcomeInputV1): StrategyOutcomeResultV1 {
  const context: RuntimeContext = {
    plannedRisk: null,
    evaluationEndDate: null,
    entryFill: null,
    actualRisk: null,
  };
  try {
    return validateOutcome(input, context);
  } catch (error) {
    if (error instanceof PointInTimeErrorV1) {
      return unavailable(context, outcomeErrorReason(error));
    }
    throw error;
  }
}
