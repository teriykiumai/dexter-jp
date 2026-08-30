import { describe, expect, test } from 'bun:test';
import { validateEvaluationFindingsWireV1 } from '../../analysis/evaluation/findings.js';
import {
  GOLD_FINDING_CATEGORIES_V1,
  GOLD_SET_CANDIDATE_V1,
  GOLD_SET_CANDIDATE_V1_DIGEST,
  REVIEWED_GOLD_SET_CANDIDATE_V1_DIGEST,
} from './set.js';

describe('Evaluator Japanese gold-set candidate V1', () => {
  test('locks the 16/48 split, 12 clean cases, and reviewed digest', () => {
    expect(GOLD_SET_CANDIDATE_V1.cases).toHaveLength(64);
    expect(GOLD_SET_CANDIDATE_V1.cases.filter(value => value.split === 'dev')).toHaveLength(16);
    const holdout = GOLD_SET_CANDIDATE_V1.cases.filter(value => value.split === 'locked_holdout');
    expect(holdout).toHaveLength(48);
    expect(holdout.filter(value => value.clean)).toHaveLength(12);
    expect(GOLD_SET_CANDIDATE_V1_DIGEST).toBe(REVIEWED_GOLD_SET_CANDIDATE_V1_DIGEST);
  });

  test('balances all six finding categories across locked non-clean cases', () => {
    const holdout = GOLD_SET_CANDIDATE_V1.cases.filter(value => (
      value.split === 'locked_holdout' && !value.clean
    ));
    for (const category of GOLD_FINDING_CATEGORIES_V1) {
      expect(holdout.filter(value => value.annotation.proposedFindings.some(
        finding => finding.category === category,
      ))).toHaveLength(6);
    }
  });

  test('contains eight baseline/injected pairs and twelve stability cases', () => {
    const holdout = GOLD_SET_CANDIDATE_V1.cases.filter(value => value.split === 'locked_holdout');
    const pairIds = [...new Set(holdout.flatMap(value => (
      value.injectionPairId === null ? [] : [value.injectionPairId]
    )))];
    expect(pairIds).toHaveLength(8);
    for (const pairId of pairIds) {
      expect(holdout.filter(value => value.injectionPairId === pairId).map(value => value.injectionRole))
        .toEqual(['baseline', 'injected']);
    }
    expect(holdout.filter(value => value.stability)).toHaveLength(12);
  });

  test('covers V1-V9 and the reviewed sparse/mixed-state tags', () => {
    expect(new Set(GOLD_SET_CANDIDATE_V1.cases.map(value => value.snapshotSchemaVersion)))
      .toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const tags = new Set(GOLD_SET_CANDIDATE_V1.cases.flatMap(value => value.coverageTags));
    expect(tags.has('v1_v2_20d_not_collected')).toBe(true);
    expect(tags.has('advanced_technical_metric_unavailable')).toBe(true);
    expect(tags.has('supply_demand_mixed_record')).toBe(true);
    expect(GOLD_SET_CANDIDATE_V1.cases.filter(value => (
      value.split === 'locked_holdout'
      && value.coverageTags.includes('non_available_fact_basis')
    ))).toHaveLength(2);
    expect(tags.has('valid_zero')).toBe(true);
    const v1 = GOLD_SET_CANDIDATE_V1.cases.find(value => value.caseId === 'gold_v1_dev_01')!;
    const correlation = v1.evidenceManifest.items.find(value => (
      value.definitionKey === 'marketCorrelation.window'
    ))!;
    expect(correlation.facts.every(value => value.state === 'not_collected')).toBe(true);
    const v2 = GOLD_SET_CANDIDATE_V1.cases.find(value => value.caseId === 'gold_v1_dev_02')!;
    expect(v2.evidenceManifest.items.find(value => (
      value.definitionKey === 'advancedTechnical.rsi14'
    ))?.facts[0]).toMatchObject({ state: 'unavailable', value: null, unit: 'index' });
    const mixed = GOLD_SET_CANDIDATE_V1.cases.find(value => value.caseId === 'gold_v1_dev_03')!
      .evidenceManifest.items.find(value => value.definitionKey === 'reportedShortPositions.row')!;
    expect(mixed.facts.some(value => value.state === 'available' && value.value === 0)).toBe(true);
    expect(mixed.facts.some(value => value.state === 'unavailable')).toBe(true);
  });

  test('all proposed findings satisfy the same local schema, refs, and anchor validator', () => {
    for (const goldCase of GOLD_SET_CANDIDATE_V1.cases) {
      expect(() => validateEvaluationFindingsWireV1(
        goldCase.annotation.proposedFindings,
        goldCase.report,
        goldCase.evidenceManifest,
      )).not.toThrow();
    }
  });

  test('remains pending until two independent annotations and adjudication are supplied', () => {
    expect(GOLD_SET_CANDIDATE_V1.annotationState).toBe('pending_independent_review');
  });
});
