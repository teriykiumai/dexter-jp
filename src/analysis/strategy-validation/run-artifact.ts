import { z } from 'zod';
import {
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import {
  JQUANTS_EXECUTION_BUDGET_MS_V1,
  JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1,
  JQUANTS_RATE_LIMIT_VERSION_V1,
  JQUANTS_REQUEST_TIMEOUT_MS_V1,
  planJQuantsExecutionV1,
} from './jquants-execution.js';
import { isStrictGregorianDate, parseAsOfCutoff, tokyoDateFromUtcInstantV1 } from './date.js';
import {
  STRATEGY_VALIDATION_CAMPAIGN_POLICY,
  STRATEGY_VALIDATION_VERSIONS_V1,
  StrategyValidationDigestSchema,
  StrategyValidationSelectorV1Schema,
  StrategyValidationUuidV4Schema,
  StrategyValidationVersionsV1Schema,
} from './artifacts.js';
import {
  StrategyValidationAggregationScopeV1Schema,
  StrategyValidationAggregationV1Schema,
} from './aggregation.js';
import { normalizeStrategyValidationCampaignNameV1 } from './manifest.js';

export const STRATEGY_VALIDATION_RUN_SCHEMA_VERSION =
  'strategy_validation_run_v1' as const;

const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const strictDate = z.string().refine(isStrictGregorianDate);
const canonicalUtcInstant = z.string().refine(value => {
  try {
    return parseAsOfCutoff(value) === value;
  } catch {
    return false;
  }
});
const campaignName = z.string().refine(value => {
  try {
    return normalizeStrategyValidationCampaignNameV1(value, {}) === value;
  } catch {
    return false;
  }
});

export const StrategyValidationRunCaseReferenceV1Schema = z.object({
  caseId: StrategyValidationUuidV4Schema,
  caseDigest: StrategyValidationDigestSchema,
}).strict();

export const StrategyValidationExecutionControlsV1Schema = z.object({
  rateLimitVersion: z.literal(JQUANTS_RATE_LIMIT_VERSION_V1),
  requestsPerMinute: z.number().int().min(1).max(500),
  estimatedMinimumAttempts: nonnegativeSafeInteger.max(JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1),
  minimumDispatchDurationMs: nonnegativeSafeInteger,
  minimumScheduleFeasible: z.literal(true),
  requestTimeoutMs: z.literal(JQUANTS_REQUEST_TIMEOUT_MS_V1),
  executionBudgetMs: z.literal(JQUANTS_EXECUTION_BUDGET_MS_V1),
  hardMaximumAttempts: z.literal(JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1),
}).strict().superRefine((value, context) => {
  const expected = planJQuantsExecutionV1(
    value.estimatedMinimumAttempts,
    value.requestsPerMinute,
  );
  if (!expected.minimumScheduleFeasible
    || expected.minimumDispatchDurationMs !== value.minimumDispatchDurationMs) {
    context.addIssue({ code: 'custom', message: 'Execution controls are inconsistent.' });
  }
});

export const StrategyValidationRunV1Schema = z.object({
  schemaVersion: z.literal(STRATEGY_VALIDATION_RUN_SCHEMA_VERSION),
  runId: StrategyValidationUuidV4Schema,
  mode: z.enum(['snapshot', 'campaign']),
  confidence: z.enum(['precommitted', 'reconstructed_251_as_of']),
  campaignName: campaignName.nullable(),
  startedAt: canonicalUtcInstant,
  acceptedAt: canonicalUtcInstant,
  executionDeadline: canonicalUtcInstant,
  completedAt: canonicalUtcInstant,
  outcomeAsOfSession: strictDate.nullable(),
  selector: StrategyValidationSelectorV1Schema,
  versions: StrategyValidationVersionsV1Schema,
  candidateGenerationPolicy: z.literal(STRATEGY_VALIDATION_CAMPAIGN_POLICY).nullable(),
  aggregationScope: StrategyValidationAggregationScopeV1Schema,
  caseReferences: z.array(StrategyValidationRunCaseReferenceV1Schema).min(1),
  aggregation: StrategyValidationAggregationV1Schema,
  execution: z.object({
    attemptCount: nonnegativeSafeInteger.max(JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1),
    cacheHitCount: nonnegativeSafeInteger,
    durationMs: nonnegativeSafeInteger,
    controls: StrategyValidationExecutionControlsV1Schema,
  }).strict(),
  terminationState: z.literal('completed'),
  warnings: z.array(z.string().min(1).max(1_000)).max(32),
}).strict().superRefine((value, context) => {
  const snapshotMode = value.mode === 'snapshot';
  if (snapshotMode !== (value.selector.mode === 'snapshot')
    || (snapshotMode ? value.confidence !== 'precommitted' : value.confidence !== 'reconstructed_251_as_of')
    || (snapshotMode ? value.campaignName !== null : value.campaignName === null)
    || (snapshotMode ? value.candidateGenerationPolicy !== null : value.candidateGenerationPolicy !== STRATEGY_VALIDATION_CAMPAIGN_POLICY)
    || (snapshotMode ? value.aggregationScope.kind !== 'snapshot_ticker' : value.aggregationScope.kind !== 'campaign_global')) {
    context.addIssue({ code: 'custom', message: 'Run mode fields are inconsistent.' });
  }
  if (Date.parse(value.acceptedAt) < Date.parse(value.startedAt)
    || Date.parse(value.completedAt) < Date.parse(value.acceptedAt)
    || Date.parse(value.executionDeadline) !== Date.parse(value.acceptedAt)
      + JQUANTS_EXECUTION_BUDGET_MS_V1) {
    context.addIssue({ code: 'custom', message: 'Run timestamps are inconsistent.' });
  }
  if (value.outcomeAsOfSession !== null
    && value.outcomeAsOfSession >= tokyoDateFromUtcInstantV1(value.startedAt)) {
    context.addIssue({
      code: 'custom', message: 'outcomeAsOfSession is not before the Tokyo start date.',
    });
  }
  const sourceFreeLocalSnapshotFailure = snapshotMode
    && value.execution.controls.estimatedMinimumAttempts === 0
    && value.execution.attemptCount === 0
    && value.execution.cacheHitCount === 0;
  if ((value.outcomeAsOfSession === null) !== sourceFreeLocalSnapshotFailure) {
    context.addIssue({
      code: 'custom',
      message: 'Only a source-free local Snapshot run has a null outcome boundary.',
    });
  }
  if (value.execution.attemptCount > value.execution.controls.hardMaximumAttempts) {
    context.addIssue({ code: 'custom', message: 'Attempt count exceeds the hard maximum.' });
  }
  if (value.aggregation.track.requestedAnchorCount
    !== value.aggregationScope.requestedAnchorCount) {
    context.addIssue({ code: 'custom', message: 'Aggregation scope and track count differ.' });
  }
  const seen = new Set<string>();
  for (const reference of value.caseReferences) {
    if (seen.has(reference.caseId)) {
      context.addIssue({ code: 'custom', message: 'Run case references must be unique.' });
      break;
    }
    seen.add(reference.caseId);
  }
});

export type StrategyValidationRunV1 = z.infer<typeof StrategyValidationRunV1Schema>;
export type StrategyValidationRunCaseReferenceV1 = z.infer<
  typeof StrategyValidationRunCaseReferenceV1Schema
>;

export function validateStrategyValidationRunV1(value: unknown): StrategyValidationRunV1 {
  return StrategyValidationRunV1Schema.parse(value);
}

export function digestStrategyValidationRunV1(value: unknown): SnapshotDigest {
  const run = validateStrategyValidationRunV1(value);
  return sha256CanonicalJsonV1(run as CanonicalJsonValue);
}

export function strategyValidationDefaultVersionsV1() {
  return STRATEGY_VALIDATION_VERSIONS_V1;
}
