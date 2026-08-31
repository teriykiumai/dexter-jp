import { describe, expect, test } from 'bun:test';
import type { SnapshotDigest } from '../snapshot/canonical-json.js';
import {
  assignCampaignCandidateIdentitiesV1,
  assignSnapshotCandidateIdentitiesV1,
  digestCampaignCandidateIdentityV1,
  digestSnapshotCandidateIdentityV1,
  digestStrategyValidationCaseV1,
  normalizeStrategyValidationResistanceLevelsV1,
  parseTseSessionDate,
  StrategyValidationCaseV1Schema,
} from './index.js';
import {
  TEST_SNAPSHOT_DIGEST,
  snapshotCandidateCase,
  validationSource,
} from './artifact-test-fixtures.js';

const OTHER_DIGEST = `sha256:${'3'.repeat(64)}` as SnapshotDigest;
const CANDIDATE = Object.freeze({
  entry: Object.freeze({ price: 100, reason: 'breakout_above_swing_high' as const }),
  stop: Object.freeze({ price: 90, reason: 'latest_swing_low' as const }),
  target: Object.freeze({ price: 120, reason: 'risk_reward_2R' as const }),
});

describe('Strategy-validation V1 artifacts and identity', () => {
  test('uses fixed canonical candidate identity envelopes and digest goldens', () => {
    const snapshot = digestSnapshotCandidateIdentityV1({
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
      strategyDataDate: parseTseSessionDate('2025-01-02'),
      ...CANDIDATE,
      duplicateOrdinal: 0,
    });
    const campaign = digestCampaignCandidateIdentityV1({
      ticker: '7203',
      anchorDate: parseTseSessionDate('2025-01-02'),
      candidateGenerationPolicy: 'technical_251_strategy_v1',
      resistanceEvidenceTier: 'none',
      resistanceEvidenceSnapshotDigests: [],
      ...CANDIDATE,
      duplicateOrdinal: 0,
    });
    expect(snapshot).toBe(
      'sha256:03392eadcc061e0dfbc3a7d95cfbb8f744e2b0031d14743798aff7005e6202e5',
    );
    expect(campaign).toBe(
      'sha256:a823ba3f925504f57dd6cb74559ddf146f53775d4a8969ad88345c52fc8be969',
    );
    expect(snapshot).not.toBe(campaign);
  });

  test('assigns stable duplicate ordinals and IDs independent of input and publication UUID order', () => {
    const first = assignSnapshotCandidateIdentitiesV1({
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
      strategyDataDate: parseTseSessionDate('2025-01-02'),
      candidates: [CANDIDATE, CANDIDATE, {
        ...CANDIDATE,
        target: { price: 130, reason: 'risk_reward_2R' },
      }],
    });
    const rerun = assignSnapshotCandidateIdentitiesV1({
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
      strategyDataDate: parseTseSessionDate('2025-01-02'),
      candidates: [{ ...CANDIDATE, target: { price: 130, reason: 'risk_reward_2R' } }, CANDIDATE, CANDIDATE],
    });
    expect(first.map(value => value.candidateId)).toEqual(rerun.map(value => value.candidateId));
    expect(first.map(value => value.duplicateOrdinal).sort()).toEqual([0, 0, 1]);

    const source = validationSource();
    const caseA = snapshotCandidateCase(source.digest, {
      runId: '11111111-1111-4111-8111-111111111111',
      caseId: '22222222-2222-4222-8222-222222222222',
    });
    const caseB = snapshotCandidateCase(source.digest, {
      runId: '33333333-3333-4333-8333-333333333333',
      caseId: '44444444-4444-4444-8444-444444444444',
    });
    expect(caseA.caseKind).toBe('candidate');
    expect(caseB.caseKind).toBe('candidate');
    if (caseA.caseKind === 'candidate' && caseB.caseKind === 'candidate') {
      expect(caseA.candidateId).toBe(caseB.candidateId);
    }
    expect(digestStrategyValidationCaseV1(caseA)).not.toBe(digestStrategyValidationCaseV1(caseB));
  });

  test('copies identity inputs so later caller mutation cannot change an assigned tuple', () => {
    const mutable = {
      entry: { price: 100, reason: 'breakout_above_swing_high' as const },
      stop: { price: 90, reason: 'latest_swing_low' as const },
      target: { price: 120, reason: 'risk_reward_2R' as const },
    };
    const assigned = assignSnapshotCandidateIdentitiesV1({
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
      strategyDataDate: parseTseSessionDate('2025-01-02'),
      candidates: [mutable],
    });
    const candidateId = assigned[0]!.candidateId;
    mutable.target.price = 130;
    expect(assigned[0]!.candidate.target.price).toBe(120);
    expect(assigned[0]!.envelope.target.price).toBe(120);
    expect(assigned[0]!.candidateId).toBe(candidateId);
  });

  test('separates equal campaign tuples across ticker, anchor, and evidence identity', () => {
    const assigned = assignCampaignCandidateIdentitiesV1([
      {
        ticker: '7203', anchorDate: parseTseSessionDate('2025-01-02'),
        resistanceEvidenceTier: 'none', resistanceEvidenceSnapshotDigests: [], candidate: CANDIDATE,
      },
      {
        ticker: '6758', anchorDate: parseTseSessionDate('2025-01-02'),
        resistanceEvidenceTier: 'none', resistanceEvidenceSnapshotDigests: [], candidate: CANDIDATE,
      },
      {
        ticker: '7203', anchorDate: parseTseSessionDate('2025-01-03'),
        resistanceEvidenceTier: 'none', resistanceEvidenceSnapshotDigests: [], candidate: CANDIDATE,
      },
    ]);
    expect(new Set(assigned.map(value => value.candidateId)).size).toBe(3);

    const resistance = { ...CANDIDATE, target: { price: 115, reason: 'resistance_level' as const } };
    const oneEvidence = digestCampaignCandidateIdentityV1({
      ticker: '7203', anchorDate: parseTseSessionDate('2025-01-02'),
      candidateGenerationPolicy: 'technical_251_strategy_v1',
      resistanceEvidenceTier: 'precommitted_source_unknown',
      resistanceEvidenceSnapshotDigests: [TEST_SNAPSHOT_DIGEST],
      ...resistance, duplicateOrdinal: 0,
    });
    const otherEvidence = digestCampaignCandidateIdentityV1({
      ticker: '7203', anchorDate: parseTseSessionDate('2025-01-02'),
      candidateGenerationPolicy: 'technical_251_strategy_v1',
      resistanceEvidenceTier: 'precommitted_source_unknown',
      resistanceEvidenceSnapshotDigests: [OTHER_DIGEST],
      ...resistance, duplicateOrdinal: 0,
    });
    expect(oneEvidence).not.toBe(otherEvidence);
  });

  test('requires exact limit-queue evidence only for limit_queue_ambiguous', () => {
    const source = validationSource();
    const base = snapshotCandidateCase(source.digest);
    if (base.caseKind !== 'candidate') throw new TypeError('Expected candidate fixture.');
    const common = {
      algorithmVersion: 'daily_long_fill_v1' as const,
      limitQueueVersion: 'adverse_flagged_boundary_v1' as const,
      plannedRisk: 10,
      evaluationEndDate: '2025-01-03',
      kind: 'unavailable' as const,
      reason: 'limit_queue_ambiguous' as const,
      entryProven: false,
      entryFill: null,
      actualRisk: null,
    };
    const evidence = {
      date: '2025-01-03', orderSide: 'buy' as const, fillKind: 'entry' as const,
      selectedFillPrice: 100, boundaryKind: 'upper' as const, boundaryPrice: 100,
      sourceFlag: 'UL' as const,
    };
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base, outcome: { ...common, limitQueueEvidence: evidence },
    }).success).toBe(true);
    expect(StrategyValidationCaseV1Schema.safeParse({ ...base, outcome: common }).success).toBe(false);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base,
      outcome: { ...common, limitQueueEvidence: { ...evidence, boundaryPrice: 101 } },
    }).success).toBe(false);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base,
      outcome: { ...base.outcome, limitQueueEvidence: evidence },
    }).success).toBe(false);
  });

  test('rejects internally inconsistent R, fill identity, and look-ahead boundary fields', () => {
    const source = validationSource();
    const base = snapshotCandidateCase(source.digest);
    if (base.caseKind !== 'candidate' || base.outcome.kind !== 'target_hit') {
      throw new TypeError('Expected terminal candidate fixture.');
    }
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base, outcome: { ...base.outcome, realizedR: 99 },
    }).success).toBe(false);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base, outcome: {
        ...base.outcome,
        exitFill: { ...base.outcome.exitFill, order: 'stop' },
      },
    }).success).toBe(false);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base, outcomeAsOfSession: '2025-04-01',
    }).success).toBe(false);
    expect(() => StrategyValidationCaseV1Schema.safeParse({
      ...base, strategyDataDate: null,
    })).not.toThrow();
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...base, strategyDataDate: null,
    }).success).toBe(false);
  });

  test('keeps unavailable reasons closed and anchor failures free of candidate fields', () => {
    const source = validationSource();
    const candidate = snapshotCandidateCase(source.digest);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...candidate,
      caseKind: 'anchor_unavailable',
      unavailableReason: 'strategy_data_date_invalid',
    }).success).toBe(false);
    expect(StrategyValidationCaseV1Schema.safeParse({
      ...candidate,
      outcome: { ...('outcome' in candidate ? candidate.outcome : {}), reason: 'future_reason' },
    }).success).toBe(false);
  });

  test('deduplicates at most 16 finite positive resistance levels without rounding', () => {
    const levels = Array.from({ length: 16 }, (_, index) => index + 0.25);
    expect(normalizeStrategyValidationResistanceLevelsV1([...levels, levels[0]])).toEqual(levels);
    expect(normalizeStrategyValidationResistanceLevelsV1([1.0000000000001, 1])).toEqual([
      1, 1.0000000000001,
    ]);
    expect(() => normalizeStrategyValidationResistanceLevelsV1([...levels, 99])).toThrow();
    for (const invalid of [[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      expect(() => normalizeStrategyValidationResistanceLevelsV1(invalid)).toThrow();
    }
  });
});
