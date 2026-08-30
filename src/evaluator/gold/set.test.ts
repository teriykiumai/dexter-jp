import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { validateEvaluationFindingsWireV1 } from '../../analysis/evaluation/findings.js';
import { validateGoldAdjudicationV1 } from './adjudication.js';
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

  test('uses category-specific claims that an independent annotator can classify', () => {
    const nonClean = GOLD_SET_CANDIDATE_V1.cases.filter(value => !value.clean);
    const reportsFor = (category: (typeof GOLD_FINDING_CATEGORIES_V1)[number]) => nonClean
      .filter(value => value.annotation.proposedFindings[0]?.category === category)
      .map(value => value.report);

    expect(reportsFor('unsupported_claim').every(report => report.includes('保存済みPERは8倍'))).toBe(true);
    expect(reportsFor('not_verifiable_from_snapshot').every(report => (
      report.includes('日銀は次回会合で政策金利を引き上げます')
      || report.includes('保存済みSnapshotのRSI14')
    ))).toBe(true);
    expect(reportsFor('not_verifiable_by_evaluator').every(report => (
      report.includes('過去60営業日終値')
    ))).toBe(true);
    expect(reportsFor('internal_inconsistency').every(report => (
      report.includes('上昇します') && report.includes('低下します')
    ))).toBe(true);
    expect(reportsFor('unclear_reasoning').every(report => report.includes('因果説明を示さず'))).toBe(true);
    expect(reportsFor('missing_caveat').every(report => report.includes('留保を示さず'))).toBe(true);
    const caveatCases = nonClean.filter(value => (
      value.annotation.proposedFindings[0]?.category === 'missing_caveat'
    ));
    expect(caveatCases.every(value => (
      (value.evidenceManifest.items[0]?.facts[0]?.dataDates.length ?? 0) > 0
    ))).toBe(true);
    expect(nonClean.some(value => value.report.includes('検証対象の主張'))).toBe(false);
  });

  test('remains pending until two independent annotations and adjudication are supplied', () => {
    expect(GOLD_SET_CANDIDATE_V1.annotationState).toBe('pending_independent_review');
  });

  test('loads the tracked two-annotator adjudication with matching critical labels', async () => {
    const raw = JSON.parse(await readFile(
      new URL('./adjudicated-v1.json', import.meta.url),
      'utf8',
    )) as {
      annotatorAId: string;
      annotatorBId: string;
      cases: Array<{
        annotatorAFindings: Array<{ summary: string; location: unknown; [key: string]: unknown }>;
      annotatorBFindings: Array<{ summary: string; location: unknown; [key: string]: unknown }>;
        adjudicatedFindings: unknown[];
      }>;
    };
    const validated = validateGoldAdjudicationV1(raw);
    expect(raw.annotatorAId).not.toBe(raw.annotatorBId);
    expect(validated.cases).toHaveLength(64);
    expect(validated.cases.reduce((count, value) => count + value.expectedFindings.length, 0)).toBe(52);

    const withoutSummaryAndLocation = ({
      summary: _summary,
      location: _location,
      ...finding
    }: { summary: string; location: unknown; [key: string]: unknown }) => finding;
    const anchorIoU = (
      left: { start: number; end: number },
      right: { start: number; end: number },
    ) => Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start))
      / (Math.max(left.end, right.end) - Math.min(left.start, right.start));
    for (const [index, annotation] of raw.cases.entries()) {
      expect(annotation.annotatorAFindings.map(withoutSummaryAndLocation))
        .toEqual(annotation.annotatorBFindings.map(withoutSummaryAndLocation));
      for (const [findingIndex, left] of annotation.annotatorAFindings.entries()) {
        const right = annotation.annotatorBFindings[findingIndex]!;
        const leftLocation = left.location as {
          kind: 'single_anchor' | 'report_anchor_set';
          anchor?: { start: number; end: number };
          anchors?: Array<{ start: number; end: number }>;
        };
        const rightLocation = right.location as typeof leftLocation;
        expect(leftLocation.kind).toBe(rightLocation.kind);
        if (leftLocation.kind === 'single_anchor') {
          expect(anchorIoU(leftLocation.anchor!, rightLocation.anchor!)).toBeGreaterThanOrEqual(0.5);
        } else {
          expect(leftLocation.anchors).toHaveLength(rightLocation.anchors!.length);
          leftLocation.anchors!.forEach((anchor, anchorIndex) => {
            expect(anchorIoU(anchor, rightLocation.anchors![anchorIndex]!)).toBeGreaterThanOrEqual(0.5);
          });
        }
      }
      expect(annotation.adjudicatedFindings)
        .toEqual(GOLD_SET_CANDIDATE_V1.cases[index]!.annotation.proposedFindings);
    }
  });
});
