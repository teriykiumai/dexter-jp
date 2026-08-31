import type { SnapshotDigest } from '../snapshot/canonical-json.js';
import {
  aggregateStrategyValidationCasesV1,
  buildStrategyValidationAggregationScopeV1,
} from './aggregation.js';
import {
  compareStrategyValidationCasesV1,
  digestCampaignCandidateIdentityV1,
  digestSnapshotCandidateIdentityV1,
  digestStrategyValidationCaseV1,
  STRATEGY_VALIDATION_CAMPAIGN_POLICY,
  STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
  STRATEGY_VALIDATION_VERSIONS_V1,
  StrategyValidationCaseV1Schema,
  type StrategyValidationCaseV1,
} from './artifacts.js';
import { nextGregorianDateV1, parseTseSessionDate } from './date.js';
import { planJQuantsExecutionV1 } from './jquants-execution.js';
import { STRATEGY_ENTRY_WAIT_SESSIONS_V1, STRATEGY_HOLDING_SESSIONS_V1 } from './outcome-validator.js';
import { STRATEGY_VALIDATION_RUN_SCHEMA_VERSION, StrategyValidationRunV1Schema } from './run-artifact.js';
import { createPointInTimeSourceEnvelopeV1 } from './source-envelope.js';
import { createPointInTimeSourceManifestV1 } from './source-manifest.js';

export const TEST_RUN_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_CASE_ID = '22222222-2222-4222-8222-222222222222';
export const TEST_SNAPSHOT_ID = '2025-01-02T00-00-00-000Z';
export const TEST_SNAPSHOT_DIGEST = `sha256:${'1'.repeat(64)}` as SnapshotDigest;
export const TEST_MANIFEST_DIGEST = `sha256:${'2'.repeat(64)}` as SnapshotDigest;
export const TEST_STARTED_AT = '2025-04-01T00:00:00.000Z';
export const TEST_ACCEPTED_AT = '2025-04-01T00:00:01.000Z';
export const TEST_DEADLINE = '2025-04-01T01:30:01.000Z';
export const TEST_COMPLETED_AT = '2025-04-01T00:00:02.000Z';
export const TEST_OUTCOME_AS_OF = '2025-03-31';

export function validationSource(ticker: string | null = null) {
  return createPointInTimeSourceEnvelopeV1({
    sourceMappingVersion: 'jquants_calendar_v1',
    endpoint: '/v2/markets/calendar',
    query: [{ name: 'from', value: '2025-01-02' }, { name: 'to', value: '2025-03-31' }],
    request: {
      ticker,
      dateFrom: '2025-01-02',
      dateTo: '2025-03-31',
      asOfCutoff: '2025-04-01T00:00:00.000Z',
    },
    fetchedAt: '2025-04-01T00:00:01.000Z',
    result: { state: 'available', rows: [{ Date: '2025-01-02', HolDiv: '1' }] },
  });
}

export function snapshotCandidateCase(
  sourceDigest: SnapshotDigest,
  overrides: Readonly<{
    runId?: string;
    caseId?: string;
    ticker?: string;
    anchorDate?: string;
    stopReason?: 'latest_swing_low' | 'entry_minus_1_5_atr';
    targetReason?: 'risk_reward_2R' | 'resistance_level';
    outcomeKind?: 'target_hit' | 'stop_hit' | 'not_triggered' | 'unavailable';
    unavailableReason?: 'source_history_unavailable' | 'corporate_action_in_outcome_window';
    duplicateOrdinal?: number;
  }> = {},
): StrategyValidationCaseV1 {
  const ticker = overrides.ticker ?? '7203';
  const anchorDate = overrides.anchorDate ?? '2025-01-02';
  const stopReason = overrides.stopReason ?? 'latest_swing_low';
  const targetReason = overrides.targetReason ?? 'risk_reward_2R';
  const duplicateOrdinal = overrides.duplicateOrdinal ?? 0;
  const evaluationDate = nextGregorianDateV1(anchorDate);
  const candidate = {
    entry: { price: 100, reason: 'breakout_above_swing_high' as const },
    stop: { price: 90, reason: stopReason },
    target: { price: 120, reason: targetReason },
  };
  const entryFill = {
    date: evaluationDate, evaluationSession: 1, holdingDay: 1,
    order: 'entry' as const, method: 'entry_level' as const, price: 100,
  };
  const common = {
    algorithmVersion: 'daily_long_fill_v1' as const,
    limitQueueVersion: 'adverse_flagged_boundary_v1' as const,
    plannedRisk: 10,
    evaluationEndDate: evaluationDate,
  };
  let outcome;
  if (overrides.outcomeKind === 'not_triggered') {
    outcome = { ...common, kind: 'not_triggered' as const, entryProven: false as const, entryFill: null, actualRisk: null };
  } else if (overrides.outcomeKind === 'unavailable') {
    outcome = {
      ...common,
      kind: 'unavailable' as const,
      reason: overrides.unavailableReason ?? 'corporate_action_in_outcome_window',
      entryProven: true,
      entryFill,
      actualRisk: 10,
    };
  } else {
    const stop = overrides.outcomeKind === 'stop_hit';
    outcome = {
      ...common,
      kind: stop ? 'stop_hit' as const : 'target_hit' as const,
      entryProven: true as const,
      entryFill,
      actualRisk: 10,
      exitFill: {
        date: evaluationDate, evaluationSession: 1, holdingDay: 1,
        order: stop ? 'stop' as const : 'target' as const,
        method: stop ? 'stop_level' as const : 'target_level' as const,
        price: stop ? 90 : 120,
      },
      realizedR: stop ? -1 : 2,
    };
  }
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: overrides.caseId ?? TEST_CASE_ID,
    runId: overrides.runId ?? TEST_RUN_ID,
    mode: 'snapshot',
    confidence: 'precommitted',
    ticker,
    anchorDate,
    decisionDate: anchorDate,
    strategyDataDate: anchorDate,
    selector: {
      mode: 'snapshot', snapshotId: TEST_SNAPSHOT_ID,
      snapshotSchemaVersion: 9, snapshotDigest: TEST_SNAPSHOT_DIGEST,
    },
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: null,
    startedAt: TEST_STARTED_AT,
    outcomeAsOfSession: TEST_OUTCOME_AS_OF,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: [{ role: 'outcome_calendar', digest: sourceDigest }],
    }),
    caseKind: 'candidate',
    candidateIdentityVersion: 'snapshot_candidate_identity_v1',
    candidateId: digestSnapshotCandidateIdentityV1({
      snapshotDigest: TEST_SNAPSHOT_DIGEST,
      strategyDataDate: parseTseSessionDate(anchorDate),
      ...candidate,
      duplicateOrdinal,
    }),
    duplicateOrdinal,
    candidate,
    tickEvidence: {
      effectiveDate: anchorDate,
      category: 'topix_core30',
      unavailableReason: null,
      levels: {
        entry: { tick: 0.1, executable: true },
        stop: { tick: 0.1, executable: true },
        target: { tick: 0.1, executable: true },
      },
    },
    resistanceEvidenceTier: targetReason === 'risk_reward_2R'
      ? 'none'
      : 'precommitted_source_unknown',
    resistanceEvidenceSnapshotDigests: [],
    outcome,
  });
}

export function campaignCandidateCase(
  sourceDigest: SnapshotDigest,
  overrides: Readonly<{
    runId?: string;
    caseId: string;
    ticker: string;
    anchorDate: string;
    stopReason?: 'latest_swing_low' | 'entry_minus_1_5_atr';
    targetReason?: 'risk_reward_2R' | 'resistance_level';
    outcomeKind?: 'target_hit' | 'stop_hit' | 'not_triggered' | 'unavailable';
    duplicateOrdinal?: number;
  }>,
): StrategyValidationCaseV1 {
  const snapshot = snapshotCandidateCase(sourceDigest, {
    runId: overrides.runId,
    caseId: overrides.caseId,
    ticker: overrides.ticker,
    anchorDate: overrides.anchorDate,
    stopReason: overrides.stopReason,
    targetReason: overrides.targetReason,
    outcomeKind: overrides.outcomeKind,
    duplicateOrdinal: overrides.duplicateOrdinal,
  });
  if (snapshot.caseKind !== 'candidate') throw new TypeError('Expected a candidate fixture.');
  const resistanceEvidenceSnapshotDigests = snapshot.candidate.target.reason === 'resistance_level'
    ? [TEST_SNAPSHOT_DIGEST]
    : [];
  const resistanceEvidenceTier = snapshot.candidate.target.reason === 'resistance_level'
    ? 'precommitted_source_unknown' as const
    : 'none' as const;
  return StrategyValidationCaseV1Schema.parse({
    ...snapshot,
    mode: 'campaign',
    confidence: 'reconstructed_251_as_of',
    strategyDataDate: null,
    selector: { mode: 'campaign', manifestDigest: TEST_MANIFEST_DIGEST },
    candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
    candidateIdentityVersion: 'campaign_candidate_identity_v1',
    candidateId: digestCampaignCandidateIdentityV1({
      ticker: snapshot.ticker,
      anchorDate: parseTseSessionDate(snapshot.anchorDate),
      candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
      resistanceEvidenceTier,
      resistanceEvidenceSnapshotDigests,
      ...snapshot.candidate,
      duplicateOrdinal: snapshot.duplicateOrdinal,
    }),
    resistanceEvidenceTier,
    resistanceEvidenceSnapshotDigests,
  });
}

export function anchorUnavailableCase(
  _sourceDigest: SnapshotDigest,
  overrides: Readonly<{
    runId?: string;
    caseId: string;
    ticker: string;
    anchorDate: string;
    reason?: 'source_history_unavailable' | 'resistance_evidence_invalid';
  }>,
): StrategyValidationCaseV1 {
  return StrategyValidationCaseV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_CASE_SCHEMA_VERSION,
    caseId: overrides.caseId,
    runId: overrides.runId ?? TEST_RUN_ID,
    mode: 'campaign',
    confidence: 'reconstructed_251_as_of',
    ticker: overrides.ticker,
    anchorDate: overrides.anchorDate,
    decisionDate: overrides.anchorDate,
    strategyDataDate: null,
    selector: { mode: 'campaign', manifestDigest: TEST_MANIFEST_DIGEST },
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: STRATEGY_VALIDATION_CAMPAIGN_POLICY,
    startedAt: TEST_STARTED_AT,
    outcomeAsOfSession: TEST_OUTCOME_AS_OF,
    entryWaitSessions: STRATEGY_ENTRY_WAIT_SESSIONS_V1,
    holdingSessions: STRATEGY_HOLDING_SESSIONS_V1,
    sourceManifest: createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: [],
    }),
    caseKind: 'anchor_unavailable',
    unavailableReason: overrides.reason ?? 'source_history_unavailable',
  });
}

export function validationRun(
  cases: readonly StrategyValidationCaseV1[],
) {
  const anchors = [...new Map(cases.map(value => [
    `${value.ticker}\u0000${value.anchorDate}`,
    { ticker: value.ticker, anchorDate: value.anchorDate },
  ])).values()];
  const campaign = cases[0]?.mode === 'campaign';
  const scope = buildStrategyValidationAggregationScopeV1(
    campaign ? 'campaign' : 'snapshot',
    anchors,
  );
  const aggregation = aggregateStrategyValidationCasesV1(scope, anchors, cases);
  const sortedCases = [...cases].sort(compareStrategyValidationCasesV1);
  const controls = planJQuantsExecutionV1(1, 5);
  return StrategyValidationRunV1Schema.parse({
    schemaVersion: STRATEGY_VALIDATION_RUN_SCHEMA_VERSION,
    runId: cases[0]?.runId ?? TEST_RUN_ID,
    mode: campaign ? 'campaign' : 'snapshot',
    confidence: campaign ? 'reconstructed_251_as_of' : 'precommitted',
    campaignName: campaign ? '検証キャンペーン' : null,
    startedAt: TEST_STARTED_AT,
    acceptedAt: TEST_ACCEPTED_AT,
    executionDeadline: TEST_DEADLINE,
    completedAt: TEST_COMPLETED_AT,
    outcomeAsOfSession: TEST_OUTCOME_AS_OF,
    selector: campaign
      ? { mode: 'campaign', manifestDigest: TEST_MANIFEST_DIGEST }
      : {
        mode: 'snapshot', snapshotId: TEST_SNAPSHOT_ID,
        snapshotSchemaVersion: 9, snapshotDigest: TEST_SNAPSHOT_DIGEST,
      },
    versions: STRATEGY_VALIDATION_VERSIONS_V1,
    candidateGenerationPolicy: campaign ? STRATEGY_VALIDATION_CAMPAIGN_POLICY : null,
    aggregationScope: scope,
    caseReferences: sortedCases.map(value => ({
      caseId: value.caseId,
      caseDigest: digestStrategyValidationCaseV1(value),
    })),
    aggregation,
    execution: {
      attemptCount: 1,
      cacheHitCount: 0,
      durationMs: 1_000,
      controls,
    },
    terminationState: 'completed',
    warnings: campaign ? ['Standardized retrospective policy.'] : [],
  });
}
