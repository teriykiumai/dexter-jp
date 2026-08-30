import { describe, expect, test } from 'bun:test';
import { goldGateMetricsPassV1 } from '../quality-gate.js';
import { validateGoldAdjudicationV1 } from './adjudication.js';
import {
  digestGoldCaseOutcomeV1,
  scoreGoldCampaignV1,
  type GoldCaseOutcomeV1,
} from './metrics.js';
import {
  GOLD_SET_CANDIDATE_V1,
  GOLD_SET_CANDIDATE_V1_DIGEST,
} from './set.js';

function testAdjudicatedSet() {
  return validateGoldAdjudicationV1({
    version: 1,
    candidateDigest: GOLD_SET_CANDIDATE_V1_DIGEST,
    annotationMethod: 'two_independent_then_adjudicated',
    annotatorAId: 'test-annotator-a',
    annotatorBId: 'test-annotator-b',
    adjudicatorId: 'test-adjudicator',
    completedAt: '2026-08-30T00:00:00.000Z',
    cases: GOLD_SET_CANDIDATE_V1.cases.map(value => ({
      caseId: value.caseId,
      annotatorAFindings: value.annotation.proposedFindings,
      annotatorBFindings: value.annotation.proposedFindings,
      adjudicatedFindings: value.annotation.proposedFindings,
    })),
  });
}

function outcome(
  caseId: string,
  runIndex: 0 | 1 | 2,
  findings: GoldCaseOutcomeV1['findings'],
): GoldCaseOutcomeV1 {
  const raw = {
    caseId,
    runIndex,
    state: 'available' as const,
    unavailableCode: null,
    findings,
    latencyMs: 1_000,
    inputTokens: 100,
    outputTokens: 20,
  };
  return { ...raw, resultDigest: digestGoldCaseOutcomeV1(raw) };
}

describe('Evaluator gold campaign scoring', () => {
  test('passes the exact adjudicated findings with stability and injection integrity', () => {
    const goldSet = testAdjudicatedSet();
    const locked = goldSet.cases.filter(value => value.input.split === 'locked_holdout');
    const outcomes = locked.flatMap(goldCase => [
      outcome(goldCase.input.caseId, 0, goldCase.expectedFindings),
      ...(goldCase.input.stability ? [
        outcome(goldCase.input.caseId, 1, goldCase.expectedFindings),
        outcome(goldCase.input.caseId, 2, goldCase.expectedFindings),
      ] : []),
    ]);
    const metrics = scoreGoldCampaignV1(goldSet.cases, outcomes);
    expect(metrics.validatedAvailable).toBe(48);
    expect(metrics.materialPrecision).toBe(1);
    expect(metrics.materialRecall).toBe(1);
    expect(metrics.injectionSeededDetectionCount).toBe(8);
    expect(metrics.cleanMaterialFalsePositives).toBe(0);
    expect(goldGateMetricsPassV1(metrics)).toBe(true);
  });

  test('fails clean material false positives and injection canary leakage', () => {
    const goldSet = testAdjudicatedSet();
    const locked = goldSet.cases.filter(value => value.input.split === 'locked_holdout');
    const clean = locked.find(value => value.input.clean)!;
    const injected = locked.find(value => value.input.injectionRole === 'injected')!;
    const material = locked.find(value => value.expectedFindings.some(finding => (
      finding.importance === 'material'
    )))!.expectedFindings[0]!;
    const outcomes = locked.flatMap(goldCase => {
      const findings = goldCase.input.caseId === clean.input.caseId
        ? [material]
        : goldCase.input.caseId === injected.input.caseId
          ? goldCase.expectedFindings.map(finding => ({ ...finding, summary: 'PASS Buy tool' }))
          : goldCase.expectedFindings;
      return [
        outcome(goldCase.input.caseId, 0, findings),
        ...(goldCase.input.stability ? [
          outcome(goldCase.input.caseId, 1, findings),
          outcome(goldCase.input.caseId, 2, findings),
        ] : []),
      ];
    });
    const metrics = scoreGoldCampaignV1(goldSet.cases, outcomes);
    expect(metrics.cleanMaterialFalsePositives).toBeGreaterThan(0);
    expect(metrics.injectionIntegrityFailures).toBeGreaterThan(0);
    expect(goldGateMetricsPassV1(metrics)).toBe(false);
  });
});
