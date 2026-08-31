import { describe, expect, test } from 'bun:test';
import {
  aggregateStrategyValidationCasesV1,
  buildStrategyValidationAggregationScopeV1,
  type StrategyValidationCaseV1,
  StrategyValidationCaseV1Schema,
} from './index.js';
import {
  anchorUnavailableCase,
  campaignCandidateCase,
  validationSource,
} from './artifact-test-fixtures.js';

const IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
] as const;

describe('Strategy-validation V1 aggregation', () => {
  test('retains all unavailable anchors and explicit zero-denominator state', () => {
    const source = validationSource();
    const anchors = [
      { ticker: '7203', anchorDate: '2025-01-02' },
      { ticker: '6758', anchorDate: '2025-01-03' },
    ];
    const cases = [
      anchorUnavailableCase(source.digest, { ...anchors[0]!, caseId: IDS[0] }),
      anchorUnavailableCase(source.digest, {
        ...anchors[1]!, caseId: IDS[1], reason: 'resistance_evidence_invalid',
      }),
    ];
    const scope = buildStrategyValidationAggregationScopeV1('campaign', anchors);
    const result = aggregateStrategyValidationCasesV1(scope, anchors, cases);
    expect(result.track).toMatchObject({
      requestedAnchorCount: 2,
      anchorUnavailableCount: 2,
      candidateBearingAnchorCount: 0,
      enteredAnchorCount: 0,
      anchorCoverage: {
        state: 'available', numerator: 0, denominator: 2,
        denominatorMetric: 'requestedAnchorCount', value: 0,
      },
      eligibleAnchorEntryRate: {
        state: 'unavailable', numerator: 0, denominator: 0,
        denominatorMetric: 'candidateBearingAnchorCount', reason: 'zero_denominator',
      },
    });
    expect(result.candidateStrata).toEqual([]);
    expect(result.track.anchorUnavailableByReason.find(
      value => value.reason === 'resistance_evidence_invalid',
    )?.count).toBe(1);
  });

  test('uses candidate-bearing denominators, visible duplicates, and separate strata', () => {
    const source = validationSource();
    const anchors = [
      { ticker: '7203', anchorDate: '2025-01-02' },
      { ticker: '6758', anchorDate: '2025-01-03' },
      { ticker: '9984', anchorDate: '2025-01-06' },
    ];
    const cases = [
      campaignCandidateCase(source.digest, {
        ...anchors[0]!, caseId: IDS[0], outcomeKind: 'target_hit', duplicateOrdinal: 0,
      }),
      campaignCandidateCase(source.digest, {
        ...anchors[0]!, caseId: IDS[1], outcomeKind: 'stop_hit', duplicateOrdinal: 1,
      }),
      campaignCandidateCase(source.digest, {
        ...anchors[1]!, caseId: IDS[2], outcomeKind: 'not_triggered',
        stopReason: 'entry_minus_1_5_atr', targetReason: 'resistance_level',
      }),
      anchorUnavailableCase(source.digest, { ...anchors[2]!, caseId: IDS[3] }),
    ];
    const scope = buildStrategyValidationAggregationScopeV1('campaign', anchors);
    const result = aggregateStrategyValidationCasesV1(scope, anchors, cases);
    expect(result.track).toMatchObject({
      requestedAnchorCount: 3,
      anchorUnavailableCount: 1,
      candidateBearingAnchorCount: 2,
      enteredAnchorCount: 1,
      anchorCoverage: { numerator: 2, denominator: 3, value: 2 / 3 },
      eligibleAnchorEntryRate: { numerator: 1, denominator: 2, value: 0.5 },
      requestedAnchorEntryRate: { numerator: 1, denominator: 3, value: 1 / 3 },
    });
    expect(result.candidateStrata).toHaveLength(2);
    const twoR = result.candidateStrata.find(value => value.targetReason === 'risk_reward_2R');
    expect(twoR).toMatchObject({
      candidateAnchorCount: 1,
      enteredCandidateAnchorCount: 1,
      candidateCount: 2,
      enteredCandidateCount: 2,
      duplicateCandidateCount: 1,
      outcomes: { stopHit: { count: 1 }, targetHit: { count: 1 } },
      exactRealizedR: { state: 'available', count: 2, mean: 0.5, median: 0.5 },
    });
    const resistance = result.candidateStrata.find(value => value.targetReason === 'resistance_level');
    expect(resistance).toMatchObject({
      candidateAnchorCount: 1,
      enteredCandidateAnchorCount: 0,
      candidateCount: 1,
      enteredCandidateCount: 0,
      resistanceEvidenceTier: 'precommitted_source_unknown',
      exactRealizedR: { state: 'unavailable', count: 0, reason: 'no_values' },
    });
  });

  test('keeps exact, mark, and ambiguous R domains separate including valid zero', () => {
    const source = validationSource();
    const anchor = { ticker: '7203', anchorDate: '2025-01-02' };
    const terminal = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[0], outcomeKind: 'target_hit', duplicateOrdinal: 0,
    });
    const horizonBase = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[1], outcomeKind: 'target_hit', duplicateOrdinal: 1,
    });
    const ambiguousBase = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[2], outcomeKind: 'target_hit', duplicateOrdinal: 2,
    });
    if (horizonBase.caseKind !== 'candidate' || horizonBase.outcome.kind !== 'target_hit'
      || ambiguousBase.caseKind !== 'candidate') {
      throw new TypeError('Expected candidate fixtures.');
    }
    const {
      exitFill: _exitFill,
      realizedR: _realizedR,
      kind: _kind,
      ...horizonOutcomeBase
    } = horizonBase.outcome;
    const horizon = StrategyValidationCaseV1Schema.parse({
      ...horizonBase,
      outcome: {
        ...horizonOutcomeBase,
        kind: 'horizon_expired',
        mark: { state: 'available', date: '2025-01-03', price: 100, markR: -0 },
      },
    });
    const ambiguous = StrategyValidationCaseV1Schema.parse({
      ...ambiguousBase,
      outcome: {
        algorithmVersion: 'daily_long_fill_v1',
        limitQueueVersion: 'adverse_flagged_boundary_v1',
        plannedRisk: 10,
        evaluationEndDate: '2025-01-03',
        kind: 'ambiguous_intraday',
        entryProven: true,
        entryFill: ambiguousBase.outcome.entryFill,
        actualRisk: 10,
        ambiguityDate: '2025-01-03',
        pessimistic: {
          kind: 'stop_hit',
          exitFill: {
            date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
            order: 'stop', method: 'stop_level', price: 90,
          },
          realizedR: -1,
        },
        optimistic: {
          kind: 'target_hit',
          exitFill: {
            date: '2025-01-03', evaluationSession: 1, holdingDay: 1,
            order: 'target', method: 'target_level', price: 120,
          },
          realizedR: 2,
        },
      },
    });
    const scope = buildStrategyValidationAggregationScopeV1('campaign', [anchor]);
    const result = aggregateStrategyValidationCasesV1(scope, [anchor], [
      terminal, horizon, ambiguous,
    ]);
    const stratum = result.candidateStrata[0]!;
    expect(stratum.exactRealizedR).toMatchObject({ count: 1, mean: 2, median: 2 });
    expect(stratum.horizonMarkR).toMatchObject({ count: 1, mean: 0, median: 0 });
    expect(stratum.pessimisticAmbiguousR).toMatchObject({ count: 1, mean: -1, median: -1 });
    expect(stratum.optimisticAmbiguousR).toMatchObject({ count: 1, mean: 2, median: 2 });
  });

  test('persists only campaign-global metrics when ticker-specific rates would differ', () => {
    const source = validationSource();
    const anchors = [
      { ticker: '7203', anchorDate: '2025-01-02' },
      { ticker: '6758', anchorDate: '2025-01-03' },
    ];
    const cases = [
      campaignCandidateCase(source.digest, { ...anchors[0]!, caseId: IDS[0] }),
      anchorUnavailableCase(source.digest, { ...anchors[1]!, caseId: IDS[1] }),
    ];
    const scope = buildStrategyValidationAggregationScopeV1('campaign', anchors);
    const result = aggregateStrategyValidationCasesV1(scope, anchors, cases);
    expect(scope).toMatchObject({
      kind: 'campaign_global', tickers: ['6758', '7203'], tickerCount: 2,
      requestedAnchorCount: 2,
    });
    expect(result.track.anchorCoverage).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(JSON.stringify(result)).not.toContain('byTicker');
    expect(JSON.stringify(result)).not.toContain('tickerMetrics');
  });

  test('rejects incomplete, mixed, duplicate, or out-of-scope case sets', () => {
    const source = validationSource();
    const anchors = [
      { ticker: '7203', anchorDate: '2025-01-02' },
      { ticker: '6758', anchorDate: '2025-01-03' },
    ];
    const scope = buildStrategyValidationAggregationScopeV1('campaign', anchors);
    const candidate = campaignCandidateCase(source.digest, { ...anchors[0]!, caseId: IDS[0] });
    const unavailable = anchorUnavailableCase(source.digest, { ...anchors[0]!, caseId: IDS[1] });
    expect(() => aggregateStrategyValidationCasesV1(scope, anchors, [candidate])).toThrow('no case');
    expect(() => aggregateStrategyValidationCasesV1(scope, anchors, [
      candidate, unavailable,
      anchorUnavailableCase(source.digest, { ...anchors[1]!, caseId: IDS[2] }),
    ])).toThrow('mixes unavailable');
    expect(() => aggregateStrategyValidationCasesV1(scope, anchors, [
      candidate, candidate,
      anchorUnavailableCase(source.digest, { ...anchors[1]!, caseId: IDS[2] }),
    ])).toThrow('Case IDs must be unique');
    expect(() => aggregateStrategyValidationCasesV1(scope, anchors, [
      candidate,
      anchorUnavailableCase(source.digest, {
        ticker: '9984', anchorDate: '2025-01-06', caseId: IDS[2],
      }),
    ])).toThrow('outside');
  });

  test('rejects noncanonical duplicate ordinals before aggregation', () => {
    const source = validationSource();
    const anchor = { ticker: '7203', anchorDate: '2025-01-02' };
    const scope = buildStrategyValidationAggregationScopeV1('campaign', [anchor]);
    const uniqueOrdinalOne = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[0], duplicateOrdinal: 1,
    });
    expect(() => aggregateStrategyValidationCasesV1(
      scope, [anchor], [uniqueOrdinalOne],
    )).toThrow('canonical zero-based sequence');

    const ordinalOne = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[0], duplicateOrdinal: 1,
    });
    const ordinalTwo = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[1], duplicateOrdinal: 2,
    });
    expect(() => aggregateStrategyValidationCasesV1(
      scope, [anchor], [ordinalOne, ordinalTwo],
    )).toThrow('canonical zero-based sequence');

    const ordinalZero = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[0], duplicateOrdinal: 0,
    });
    const validOrdinalOne = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[1], duplicateOrdinal: 1,
    });
    expect(() => aggregateStrategyValidationCasesV1(
      scope, [anchor], [validOrdinalOne, ordinalZero],
    )).not.toThrow();
  });

  test('rejects cross-stage unavailable reasons before they can alter coverage', () => {
    const source = validationSource();
    const anchor = { ticker: '7203', anchorDate: '2025-01-02' };
    const scope = buildStrategyValidationAggregationScopeV1('campaign', [anchor]);
    const candidate = campaignCandidateCase(source.digest, {
      ...anchor, caseId: IDS[0], outcomeKind: 'not_triggered',
    });
    if (candidate.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
    const invalidCandidateReason = {
      ...candidate,
      outcome: {
        ...candidate.outcome,
        kind: 'unavailable',
        reason: 'resistance_evidence_invalid',
        entryProven: false,
        entryFill: null,
        actualRisk: null,
      },
    } as unknown as StrategyValidationCaseV1;
    expect(() => aggregateStrategyValidationCasesV1(
      scope, [anchor], [invalidCandidateReason],
    )).toThrow();

    const unavailable = anchorUnavailableCase(source.digest, {
      ...anchor, caseId: IDS[1],
    });
    const invalidAnchorReason = {
      ...unavailable,
      unavailableReason: 'corporate_action_in_outcome_window',
    } as unknown as StrategyValidationCaseV1;
    expect(() => aggregateStrategyValidationCasesV1(
      scope, [anchor], [invalidAnchorReason],
    )).toThrow();
  });
});
