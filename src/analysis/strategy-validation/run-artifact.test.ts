import { describe, expect, test } from 'bun:test';
import {
  digestStrategyValidationRunV1,
  planJQuantsExecutionV1,
  StrategyValidationRunV1Schema,
} from './index.js';
import {
  campaignCandidateCase,
  snapshotCandidateCase,
  validationRun,
  validationSource,
} from './artifact-test-fixtures.js';

describe('Strategy-validation run artifact V1', () => {
  test('validates canonical Snapshot and campaign runs with stable payload digests', () => {
    const source = validationSource();
    const snapshot = validationRun([snapshotCandidateCase(source.digest)]);
    const campaign = validationRun([campaignCandidateCase(source.digest, {
      caseId: '33333333-3333-4333-8333-333333333333',
      ticker: '7203',
      anchorDate: '2025-01-02',
    })]);
    expect(StrategyValidationRunV1Schema.safeParse(snapshot).success).toBe(true);
    expect(StrategyValidationRunV1Schema.safeParse(campaign).success).toBe(true);
    expect(digestStrategyValidationRunV1(snapshot)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestStrategyValidationRunV1({
      warnings: snapshot.warnings,
      terminationState: snapshot.terminationState,
      execution: snapshot.execution,
      aggregation: snapshot.aggregation,
      caseReferences: snapshot.caseReferences,
      aggregationScope: snapshot.aggregationScope,
      candidateGenerationPolicy: snapshot.candidateGenerationPolicy,
      versions: snapshot.versions,
      selector: snapshot.selector,
      outcomeAsOfSession: snapshot.outcomeAsOfSession,
      completedAt: snapshot.completedAt,
      executionDeadline: snapshot.executionDeadline,
      acceptedAt: snapshot.acceptedAt,
      startedAt: snapshot.startedAt,
      campaignName: snapshot.campaignName,
      confidence: snapshot.confidence,
      mode: snapshot.mode,
      runId: snapshot.runId,
      schemaVersion: snapshot.schemaVersion,
    })).toBe(digestStrategyValidationRunV1(snapshot));
  });

  test('rejects unsafe campaign names and inconsistent mode, version, or time fields', () => {
    const source = validationSource();
    const campaign = validationRun([campaignCandidateCase(source.digest, {
      caseId: '33333333-3333-4333-8333-333333333333',
      ticker: '7203',
      anchorDate: '2025-01-02',
    })]);
    for (const campaignName of ['.', 'C:secret', 'sk-proj-abcdefghijklmnop', 'not/nfc']) {
      expect(StrategyValidationRunV1Schema.safeParse({ ...campaign, campaignName }).success)
        .toBe(false);
    }
    expect(StrategyValidationRunV1Schema.safeParse({
      ...campaign, mode: 'snapshot',
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...campaign, versions: { ...campaign.versions, aggregation: 'future_v2' },
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...campaign, acceptedAt: '2025-03-31T23:59:59.000Z',
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...campaign, outcomeAsOfSession: '2025-04-01',
    }).success).toBe(false);
  });

  test('rejects duplicate case references and aggregate/scope count mismatches', () => {
    const source = validationSource();
    const run = validationRun([snapshotCandidateCase(source.digest)]);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...run,
      caseReferences: [run.caseReferences[0], run.caseReferences[0]],
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...run,
      aggregation: {
        ...run.aggregation,
        track: { ...run.aggregation.track, requestedAnchorCount: 2 },
      },
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...run,
      execution: {
        ...run.execution,
        controls: { ...run.execution.controls, minimumDispatchDurationMs: 123 },
      },
    }).success).toBe(false);
  });

  test('uses a null boundary only for a zero-source local Snapshot run', () => {
    const source = validationSource();
    const snapshot = validationRun([snapshotCandidateCase(source.digest)]);
    const local = {
      ...snapshot,
      outcomeAsOfSession: null,
      execution: {
        attemptCount: 0,
        cacheHitCount: 0,
        durationMs: 0,
        controls: planJQuantsExecutionV1(0, 5),
      },
    };
    expect(StrategyValidationRunV1Schema.safeParse(local).success).toBe(true);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...local,
      outcomeAsOfSession: snapshot.outcomeAsOfSession,
    }).success).toBe(false);
    expect(StrategyValidationRunV1Schema.safeParse({
      ...snapshot,
      outcomeAsOfSession: null,
    }).success).toBe(false);
  });
});
