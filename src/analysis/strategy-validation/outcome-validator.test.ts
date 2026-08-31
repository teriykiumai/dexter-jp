import { describe, expect, test } from 'bun:test';
import {
  STRATEGY_ENTRY_WAIT_SESSIONS_V1,
  STRATEGY_HOLDING_SESSIONS_V1,
  STRATEGY_OUTCOME_ALGORITHM_VERSION_V1,
  STRATEGY_WORST_CASE_EVALUATION_SESSION_V1,
  createTseSessionCalendarV1,
  parseDailyBarV1,
  parseTseSessionDate,
  validateLongStrategyOutcomeV1,
  type DailyBarInputV1,
  type OutcomeAsOfSession,
  type StrategyOutcomeCandidateV1,
  type StrategyOutcomeInputV1,
  type StrategyTickCategoryEvidenceV1,
  type TseDailyBarV1,
  type TseSessionDate,
  type TseTickCategoryV1,
} from './index.js';

const BASE_CANDIDATE: StrategyOutcomeCandidateV1 = Object.freeze({
  entry: Object.freeze({ price: 100, reason: 'breakout_above_swing_high' }),
  stop: Object.freeze({ price: 90, reason: 'latest_swing_low' }),
  target: Object.freeze({ price: 120, reason: 'risk_reward_2R' }),
});

function dateOffset(start: string, offset: number): TseSessionDate {
  const instant = new Date(`${start}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + offset);
  return parseTseSessionDate(instant.toISOString().slice(0, 10));
}

function fixtureDates(start = '2025-01-01', count = 100): readonly TseSessionDate[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => dateOffset(start, index)));
}

const DATES = fixtureDates();
const CALENDAR = createTseSessionCalendarV1(
  DATES.map(date => ({ Date: date, HolDiv: '1' })),
  DATES[0],
  DATES.at(-1),
);

function traded(session: number, overrides: Partial<DailyBarInputV1> = {}): TseDailyBarV1 {
  return parseDailyBarV1({
    date: DATES[session],
    open: 95,
    high: 99,
    low: 91,
    close: 95,
    upperLimitFlag: '0',
    lowerLimitFlag: '0',
    adjustmentFactor: 1,
    exRightsType: null,
    ...overrides,
  });
}

function noTrade(session: number): TseDailyBarV1 {
  return traded(session, {
    open: null,
    high: null,
    low: null,
    close: null,
    upperLimitFlag: null,
    lowerLimitFlag: null,
  });
}

function barsThrough(
  sessionCount: number,
  replacements: Readonly<Record<number, TseDailyBarV1>> = {},
): readonly TseDailyBarV1[] {
  return Object.freeze(Array.from(
    { length: sessionCount },
    (_, index) => replacements[index + 1] ?? traded(index + 1),
  ));
}

function tickEvidence(
  throughSession: number,
  categories: TseTickCategoryV1 = 'topix_core30',
): readonly StrategyTickCategoryEvidenceV1[] {
  return Object.freeze(Array.from({ length: throughSession + 1 }, (_, session) => Object.freeze({
    date: DATES[session]!,
    categories: Object.freeze([categories]),
  })));
}

function input(
  bars: readonly TseDailyBarV1[],
  options: Readonly<{
    outcomeSession?: number;
    candidate?: StrategyOutcomeCandidateV1;
    evidence?: readonly StrategyTickCategoryEvidenceV1[];
  }> = {},
): StrategyOutcomeInputV1 {
  const outcomeSession = options.outcomeSession ?? bars.length;
  return Object.freeze({
    candidate: options.candidate ?? BASE_CANDIDATE,
    decisionDate: DATES[0]!,
    outcomeAsOfSession: DATES[outcomeSession]! as OutcomeAsOfSession,
    initialTickDate: DATES[0]!,
    tickCategoryEvidence: options.evidence ?? tickEvidence(outcomeSession),
    calendar: CALENDAR,
    bars,
  });
}

function thresholdEntry(session: number, overrides: Partial<DailyBarInputV1> = {}): TseDailyBarV1 {
  return traded(session, { open: 95, high: 105, low: 95, close: 100, ...overrides });
}

describe('daily_long_fill_v1 maturity and entry window', () => {
  test('fixes the t1/t20/t60/t79 boundaries', () => {
    expect(STRATEGY_OUTCOME_ALGORITHM_VERSION_V1).toBe('daily_long_fill_v1');
    expect(STRATEGY_ENTRY_WAIT_SESSIONS_V1).toBe(20);
    expect(STRATEGY_HOLDING_SESSIONS_V1).toBe(60);
    expect(STRATEGY_WORST_CASE_EVALUATION_SESSION_V1).toBe(79);

    const t19 = validateLongStrategyOutcomeV1(input(barsThrough(19)));
    expect(t19).toMatchObject({ kind: 'unavailable', reason: 'outcome_not_matured' });
    expect(t19.evaluationEndDate).toBe(DATES[19]);

    const t20 = validateLongStrategyOutcomeV1(input(barsThrough(20, { 20: noTrade(20) })));
    expect(t20).toMatchObject({ kind: 'not_triggered', entryProven: false });
    expect(t20.evaluationEndDate).toBe(DATES[20]);

    const t1Entry = validateLongStrategyOutcomeV1(input(
      barsThrough(60, { 1: thresholdEntry(1) }),
    ));
    expect(t1Entry).toMatchObject({
      kind: 'horizon_expired',
      entryFill: { evaluationSession: 1, holdingDay: 1 },
      mark: { state: 'available', date: DATES[60], price: 95, markR: -0.5 },
    });

    const t20Entry = validateLongStrategyOutcomeV1(input(
      barsThrough(79, { 20: thresholdEntry(20) }),
    ));
    expect(t20Entry).toMatchObject({
      kind: 'horizon_expired',
      entryFill: { evaluationSession: 20 },
      evaluationEndDate: DATES[79],
      mark: { date: DATES[79] },
    });
  });

  test('counts no-trade sessions without touch, fill, or close substitution', () => {
    const result = validateLongStrategyOutcomeV1(input(
      barsThrough(60, { 1: thresholdEntry(1), 60: noTrade(60) }),
    ));
    expect(result).toMatchObject({
      kind: 'horizon_expired',
      evaluationEndDate: DATES[60],
      mark: { state: 'unavailable', date: DATES[60] },
    });
  });
});

describe('daily long entry and exit fills', () => {
  test('implements every pre-entry branch without a latest-price fallback', () => {
    const below = validateLongStrategyOutcomeV1(input(barsThrough(1)));
    expect(below).toMatchObject({ kind: 'unavailable', reason: 'outcome_not_matured', entryProven: false });

    const beyondTarget = validateLongStrategyOutcomeV1(input([
      traded(1, { open: 125, high: 130, low: 124, close: 128 }),
    ]));
    expect(beyondTarget).toMatchObject({
      kind: 'unavailable', reason: 'entry_gap_beyond_target', entryProven: false,
    });

    const openFill = validateLongStrategyOutcomeV1(input([
      traded(1, { open: 105, high: 110, low: 100, close: 105 }),
    ]));
    expect(openFill).toMatchObject({
      kind: 'unavailable',
      reason: 'outcome_not_matured',
      entryFill: { method: 'open', price: 105, holdingDay: 1 },
      actualRisk: 15,
    });

    const thresholdFill = validateLongStrategyOutcomeV1(input([thresholdEntry(1)]));
    expect(thresholdFill).toMatchObject({
      kind: 'unavailable',
      reason: 'outcome_not_matured',
      entryFill: { method: 'entry_level', price: 100 },
      actualRisk: 10,
    });
  });

  test('handles post-entry gaps, one-sided touches, and dual-touch bounds', () => {
    const cases = [
      {
        bar: traded(2, { open: 85, high: 95, low: 80, close: 90 }),
        expected: { kind: 'stop_hit', exitFill: { method: 'open', price: 85 }, realizedR: -1.5 },
      },
      {
        bar: traded(2, { open: 125, high: 130, low: 121, close: 125 }),
        expected: { kind: 'target_hit', exitFill: { method: 'target_level', price: 120 }, realizedR: 2 },
      },
      {
        bar: traded(2, { open: 100, high: 110, low: 85, close: 95 }),
        expected: { kind: 'stop_hit', exitFill: { method: 'stop_level', price: 90 }, realizedR: -1 },
      },
      {
        bar: traded(2, { open: 100, high: 125, low: 95, close: 115 }),
        expected: { kind: 'target_hit', exitFill: { method: 'target_level', price: 120 }, realizedR: 2 },
      },
    ] as const;
    for (const item of cases) {
      expect(validateLongStrategyOutcomeV1(input([
        thresholdEntry(1),
        item.bar,
      ]))).toMatchObject(item.expected);
    }

    const dual = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 125, low: 85, close: 100 }),
    ]));
    expect(dual).toMatchObject({
      kind: 'ambiguous_intraday',
      ambiguityDate: DATES[2],
      pessimistic: { kind: 'stop_hit', realizedR: -1 },
      optimistic: { kind: 'target_hit', realizedR: 2 },
    });
  });

  test('uses all threshold-entry OHLC constraints, including the close proof', () => {
    const vectors = [
      {
        bar: thresholdEntry(1, { high: 125, low: 85, close: 100 }),
        expected: { kind: 'ambiguous_intraday', pessimistic: { kind: 'stop_hit' }, optimistic: { kind: 'target_hit' } },
      },
      {
        bar: thresholdEntry(1, { high: 125, low: 95, close: 120 }),
        expected: { kind: 'target_hit', realizedR: 2 },
      },
      {
        bar: thresholdEntry(1, { high: 105, low: 95, close: 100 }),
        expected: { kind: 'unavailable', reason: 'outcome_not_matured', entryProven: true },
      },
      {
        bar: thresholdEntry(1, { high: 105, low: 85, close: 90 }),
        expected: { kind: 'stop_hit', realizedR: -1 },
      },
      {
        bar: thresholdEntry(1, { high: 105, low: 85, close: 100 }),
        expected: {
          kind: 'ambiguous_intraday',
          pessimistic: { kind: 'stop_hit', realizedR: -1 },
          optimistic: { kind: 'unavailable', reason: 'outcome_not_matured' },
        },
      },
    ] as const;
    for (const vector of vectors) {
      expect(validateLongStrategyOutcomeV1(input([vector.bar]))).toMatchObject(vector.expected);
    }
  });
});

describe('adverse_flagged_boundary_v1', () => {
  test('rejects buy entries exactly at flagged highs but permits fills inside the boundary', () => {
    for (const bar of [
      thresholdEntry(1, { high: 100, close: 100, upperLimitFlag: '1' }),
      traded(1, { open: 105, high: 105, low: 100, close: 105, upperLimitFlag: '1' }),
    ]) {
      expect(validateLongStrategyOutcomeV1(input([bar]))).toMatchObject({
        kind: 'unavailable',
        reason: 'limit_queue_ambiguous',
        entryProven: false,
        limitQueueEvidence: {
          orderSide: 'buy', fillKind: 'entry', boundaryKind: 'upper', sourceFlag: 'UL',
        },
      });
    }

    expect(validateLongStrategyOutcomeV1(input([
      thresholdEntry(1, { high: 105, upperLimitFlag: '1' }),
    ]))).toMatchObject({
      kind: 'unavailable', reason: 'outcome_not_matured', entryProven: true,
    });
  });

  test('rejects sell stops exactly at flagged lows, including gap and entry-bar variants', () => {
    const laterStop = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 105, low: 90, close: 95, lowerLimitFlag: '1' }),
    ]));
    expect(laterStop).toMatchObject({
      kind: 'unavailable',
      reason: 'limit_queue_ambiguous',
      entryProven: true,
      limitQueueEvidence: {
        date: DATES[2], selectedFillPrice: 90, boundaryPrice: 90,
        orderSide: 'sell', fillKind: 'stop', boundaryKind: 'lower', sourceFlag: 'LL',
      },
    });

    const gapStop = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 85, high: 95, low: 85, close: 90, lowerLimitFlag: '1' }),
    ]));
    expect(gapStop).toMatchObject({
      kind: 'unavailable',
      reason: 'limit_queue_ambiguous',
      limitQueueEvidence: { selectedFillPrice: 85, boundaryPrice: 85 },
    });

    const entryBarStop = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1, { low: 90, close: 90, lowerLimitFlag: '1' }),
    ]));
    expect(entryBarStop).toMatchObject({
      kind: 'unavailable', reason: 'limit_queue_ambiguous', entryProven: true,
    });
  });

  test('does not censor opposite-side, target, or strictly inside fills', () => {
    const stopInside = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 110, low: 85, close: 95, lowerLimitFlag: '1' }),
    ]));
    expect(stopInside).toMatchObject({ kind: 'stop_hit', realizedR: -1 });

    const upperFlagStop = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 110, low: 90, close: 95, upperLimitFlag: '1' }),
    ]));
    expect(upperFlagStop).toMatchObject({ kind: 'stop_hit' });

    for (const flags of [
      { upperLimitFlag: '1' as const },
      { lowerLimitFlag: '1' as const },
    ]) {
      const target = validateLongStrategyOutcomeV1(input([
        thresholdEntry(1),
        traded(2, { open: 100, high: 120, low: 95, close: 115, ...flags }),
      ]));
      expect(target).toMatchObject({ kind: 'target_hit', realizedR: 2 });
    }
  });

  test('gives a non-executable stop boundary precedence over dual-touch bounds', () => {
    const result = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 125, low: 90, close: 100, lowerLimitFlag: '1' }),
    ]));
    expect(result).toMatchObject({
      kind: 'unavailable', reason: 'limit_queue_ambiguous', entryProven: true,
    });
    expect(result).not.toHaveProperty('pessimistic');
  });
});

describe('fail-closed outcome evidence', () => {
  test('rejects corporate actions through evaluation end but ignores later rows', () => {
    const beforeTerminal = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { adjustmentFactor: 0.5 }),
    ]));
    expect(beforeTerminal).toMatchObject({
      kind: 'unavailable', reason: 'corporate_action_in_outcome_window', entryProven: true,
    });

    const actionAtEntry = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1, { exRightsType: '1' }),
    ]));
    expect(actionAtEntry).toMatchObject({
      kind: 'unavailable', reason: 'corporate_action_in_outcome_window', entryProven: false,
    });

    const afterTerminal = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 110, low: 85, close: 95 }),
      traded(3, { adjustmentFactor: 0.5 }),
    ], { outcomeSession: 3 }));
    expect(afterTerminal).toMatchObject({ kind: 'stop_hit', evaluationEndDate: DATES[2] });
  });

  test('distinguishes invalid candidates, ticks, evidence, and missing price rows', () => {
    const invalidCandidates = [
      { ...BASE_CANDIDATE, entry: { ...BASE_CANDIDATE.entry, price: 0 } },
      { ...BASE_CANDIDATE, stop: { ...BASE_CANDIDATE.stop, price: 100 } },
      { ...BASE_CANDIDATE, target: { ...BASE_CANDIDATE.target, reason: 'unknown' } },
    ];
    for (const candidate of invalidCandidates) {
      expect(validateLongStrategyOutcomeV1(input([], {
        outcomeSession: 1,
        candidate: candidate as StrategyOutcomeCandidateV1,
      }))).toMatchObject({ kind: 'unavailable', reason: 'invalid_candidate' });
    }

    const nonExecutable = {
      ...BASE_CANDIDATE,
      entry: { ...BASE_CANDIDATE.entry, price: 100.05 },
    } as StrategyOutcomeCandidateV1;
    expect(validateLongStrategyOutcomeV1(input([], {
      outcomeSession: 1,
      candidate: nonExecutable,
    }))).toMatchObject({ kind: 'unavailable', reason: 'non_executable_tick' });

    expect(validateLongStrategyOutcomeV1(input([thresholdEntry(1)], {
      evidence: tickEvidence(0),
    }))).toMatchObject({ kind: 'unavailable', reason: 'tick_category_unavailable' });

    expect(validateLongStrategyOutcomeV1(input([], { outcomeSession: 1 }))).toMatchObject({
      kind: 'unavailable', reason: 'price_history_incomplete', evaluationEndDate: DATES[1],
    });
  });

  test('revalidates quote levels against dated category evidence', () => {
    const candidate = {
      ...BASE_CANDIDATE,
      entry: { ...BASE_CANDIDATE.entry, price: 100.5 },
    } as StrategyOutcomeCandidateV1;
    const evidence = [
      { date: DATES[0]!, categories: ['topix_core30'] as const },
      { date: DATES[1]!, categories: ['other'] as const },
    ];
    const result = validateLongStrategyOutcomeV1(input([
      thresholdEntry(1, { high: 101, close: 100.5 }),
    ], { candidate, evidence }));
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'non_executable_tick' });
  });

  test('returns the supported-period failure without reading bars', () => {
    const dates = fixtureDates('2027-03-01', 2);
    const calendar = createTseSessionCalendarV1(
      dates.map(date => ({ Date: date, HolDiv: '1' })),
      dates[0],
      dates[1],
    );
    const result = validateLongStrategyOutcomeV1({
      candidate: BASE_CANDIDATE,
      decisionDate: dates[0]!,
      outcomeAsOfSession: dates[1]! as OutcomeAsOfSession,
      initialTickDate: dates[0]!,
      tickCategoryEvidence: [{ date: dates[0]!, categories: ['topix_core30'] }],
      calendar,
      bars: [],
    });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'tick_rule_period_unsupported' });
  });

  test('does not mutate candidate, bars, or tick evidence', () => {
    const request = input([
      thresholdEntry(1),
      traded(2, { open: 100, high: 125, low: 85, close: 100 }),
    ]);
    const before = {
      candidate: structuredClone(request.candidate),
      bars: structuredClone(request.bars),
      evidence: structuredClone(request.tickCategoryEvidence),
    };
    validateLongStrategyOutcomeV1(request);
    expect(request.candidate).toEqual(before.candidate);
    expect(request.bars).toEqual(before.bars);
    expect(request.tickCategoryEvidence).toEqual(before.evidence);
  });
});
