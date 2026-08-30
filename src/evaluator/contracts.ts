import { z } from 'zod';
import { EvaluatorProviderBoundaryV1Schema } from '../analysis/evaluation/schema.js';

export const EVALUATOR_PROMPT_VERSION = 1 as const;
export const EVALUATOR_RUBRIC_VERSION = 1 as const;
export const EVALUATOR_TIMEOUT_MS = 180_000 as const;
export const EVALUATOR_MAX_OUTPUT_TOKENS = 16_384 as const;
export const EVALUATOR_ATTEMPT_LIMIT = 1 as const;
export const EVALUATOR_HTTP_REQUEST_LIMIT = 1 as const;
export const EVALUATOR_HTTP_REQUEST_MAX_UTF8_BYTES = 1_000_000 as const;
export const EVALUATOR_GOLD_SET_VERSION = 1 as const;
export const EVALUATOR_GOLD_CASE_COUNT = 64 as const;
export const EVALUATOR_GOLD_DEV_COUNT = 16 as const;
export const EVALUATOR_GOLD_HOLDOUT_COUNT = 48 as const;
export const EVALUATOR_GOLD_COST_CAP_USD = 25 as const;
export const INITIAL_QUALITY_GATE_ID = 'qg_v1_terra_high' as const;

export const INITIAL_PROVIDER_BOUNDARY_V1 = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  organizationId: null,
  projectId: null,
  adapterMaxRetries: 0,
  sdkMaxRetries: 0,
} as const);

export const ROUTING_ENV_NAMES = [
  'OPENAI_BASE_URL',
  'OPENAI_ORGANIZATION',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
] as const;

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const utcDateTimeSchema = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'));
const qualityGateIdSchema = z.string().regex(/^qg_[a-z0-9][a-z0-9_-]{0,63}$/);
const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const EvaluatorSourceManifestV1Schema = z.object({
  kind: z.literal('dexter_evaluator_source'),
  version: z.literal(1),
  files: z.array(z.object({
    path: z.string().min(1),
    blobDigest: digestSchema,
  }).strict()).min(1),
}).strict();
export type EvaluatorSourceManifestV1 = z.infer<typeof EvaluatorSourceManifestV1Schema>;

export const EvaluatorDependencyManifestV1Schema = z.object({
  kind: z.literal('dexter_evaluator_dependencies'),
  version: z.literal(1),
  packages: z.array(z.object({
    packageName: z.string().min(1),
    packageVersion: z.string().min(1),
    lockfilePackageKey: z.string().min(1),
    files: z.array(z.object({
      packageRelativePath: z.string().min(1),
      byteDigest: digestSchema,
    }).strict()).min(1),
  }).strict()),
}).strict();
export type EvaluatorDependencyManifestV1 = z.infer<
  typeof EvaluatorDependencyManifestV1Schema
>;

export const EvaluatorVersionsV1Schema = z.object({
  evaluatorSchemaVersion: z.literal(1),
  evidenceManifestVersion: z.literal(1),
  rubricVersion: z.literal(EVALUATOR_RUBRIC_VERSION),
  promptVersion: z.literal(EVALUATOR_PROMPT_VERSION),
  safetyPolicyVersion: z.literal(1),
  goldSetVersion: z.literal(EVALUATOR_GOLD_SET_VERSION),
}).strict();
export type EvaluatorVersionsV1 = z.infer<typeof EvaluatorVersionsV1Schema>;

export const EvaluatorRuntimeTupleV1Schema = z.object({
  providerId: z.literal('openai'),
  modelId: z.literal('gpt-5.6-terra'),
  taskProfile: z.literal('deep_analysis'),
  reasoningEffort: z.literal('high'),
  providerBoundary: EvaluatorProviderBoundaryV1Schema,
}).strict();
export type EvaluatorRuntimeTupleV1 = z.infer<typeof EvaluatorRuntimeTupleV1Schema>;

export const EvaluatorExecutionTupleV1Schema = z.object({
  bunVersion: z.literal('1.3.14'),
  bunRevision: z.literal('1.3.14+0d9b296af'),
  platform: z.literal('win32'),
  arch: z.literal('x64'),
}).strict();
export type EvaluatorExecutionTupleV1 = z.infer<typeof EvaluatorExecutionTupleV1Schema>;

const goldSetBindingSchema = z.object({
  version: z.literal(EVALUATOR_GOLD_SET_VERSION),
  digest: digestSchema,
  caseCount: z.literal(EVALUATOR_GOLD_CASE_COUNT),
  devCount: z.literal(EVALUATOR_GOLD_DEV_COUNT),
  lockedHoldoutCount: z.literal(EVALUATOR_GOLD_HOLDOUT_COUNT),
  stabilityCaseIds: z.array(z.string().regex(/^gold_v1_holdout_\d{2}$/)).length(12),
  injectionPairIds: z.array(z.string().regex(/^injection_v1_\d{2}$/)).length(8),
  annotationState: z.literal('adjudicated'),
  independentAnnotatorCount: z.literal(2),
}).strict();

const campaignConfigSchema = z.object({
  currency: z.literal('USD'),
  hardCap: z.literal(EVALUATOR_GOLD_COST_CAP_USD),
  inputUsdPerMillionTokens: z.number().positive(),
  outputUsdPerMillionTokens: z.number().positive(),
  pricingSource: z.string().url(),
  pricingVerifiedAt: utcDateTimeSchema,
  timeoutMs: z.literal(EVALUATOR_TIMEOUT_MS),
  maxOutputTokens: z.literal(EVALUATOR_MAX_OUTPUT_TOKENS),
  attemptLimit: z.literal(EVALUATOR_ATTEMPT_LIMIT),
  stabilityRuns: z.literal(3),
}).strict();

export const QualityGateManifestV1Schema = z.object({
  version: z.literal(1),
  state: z.literal('pending'),
  qualityGateId: qualityGateIdSchema,
  evaluatedCommitSha: commitShaSchema,
  evaluatorSourceManifest: EvaluatorSourceManifestV1Schema,
  evaluatorSourceDigest: digestSchema,
  dependencyManifest: EvaluatorDependencyManifestV1Schema,
  dependencyManifestDigest: digestSchema,
  execution: EvaluatorExecutionTupleV1Schema,
  runtime: EvaluatorRuntimeTupleV1Schema,
  versions: EvaluatorVersionsV1Schema,
  goldSet: goldSetBindingSchema,
  campaign: campaignConfigSchema,
}).strict();
export type QualityGateManifestV1 = z.infer<typeof QualityGateManifestV1Schema>;

export const GoldGateMetricsV1Schema = z.object({
  validatedAvailable: z.number().int().min(0).max(48),
  materialPrecision: z.number().min(0).max(1),
  materialRecall: z.number().min(0).max(1),
  perCategoryRecall: z.object({
    unsupported_claim: z.number().min(0).max(1),
    not_verifiable_from_snapshot: z.number().min(0).max(1),
    not_verifiable_by_evaluator: z.number().min(0).max(1),
    internal_inconsistency: z.number().min(0).max(1),
    unclear_reasoning: z.number().min(0).max(1),
    missing_caveat: z.number().min(0).max(1),
  }).strict(),
  unsupportedPrecision: z.number().min(0).max(1),
  unsupportedRecall: z.number().min(0).max(1),
  notVerifiableFromSnapshotPrecision: z.number().min(0).max(1),
  notVerifiableFromSnapshotRecall: z.number().min(0).max(1),
  notVerifiableByEvaluatorPrecision: z.number().min(0).max(1),
  notVerifiableByEvaluatorRecall: z.number().min(0).max(1),
  missingCaveatRecall: z.number().min(0).max(1),
  availableFactBasisAccuracy: z.number().min(0).max(1),
  nonAvailableFactBasisAccuracy: z.number().min(0).max(1),
  manifestAbsenceBasisAccuracy: z.number().min(0).max(1),
  reportContradictionBasisAccuracy: z.number().min(0).max(1),
  matchedLocationAccuracy: z.number().min(0).max(1),
  refLocationIntegrity: z.number().min(0).max(1),
  cleanMaterialFalsePositives: z.number().int().nonnegative(),
  cleanAdvisoryFalsePositiveCases: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  successfulP95LatencyMs: z.number().nonnegative(),
  stableMaterialFindingRate: z.number().min(0).max(1),
  stabilityCleanMaterialFalsePositives: z.number().int().nonnegative(),
  injectionSeededDetectionCount: z.number().int().min(0).max(8),
  injectionIntegrityFailures: z.number().int().nonnegative(),
}).strict();
export type GoldGateMetricsV1 = z.infer<typeof GoldGateMetricsV1Schema>;

export const QualityGateAttestationV1Schema = z.object({
  version: z.literal(1),
  state: z.literal('passed'),
  qualityGateId: qualityGateIdSchema,
  gateManifestDigest: digestSchema,
  evaluatorSourceDigest: digestSchema,
  dependencyManifestDigest: digestSchema,
  evaluatedCommitSha: commitShaSchema,
  execution: EvaluatorExecutionTupleV1Schema,
  runtime: EvaluatorRuntimeTupleV1Schema,
  versions: EvaluatorVersionsV1Schema,
  startedAt: utcDateTimeSchema,
  completedAt: utcDateTimeSchema,
  metrics: GoldGateMetricsV1Schema,
  caseResultDigests: z.array(z.object({
    caseId: z.string().regex(/^gold_v1_holdout_\d{2}$/),
    digest: digestSchema,
  }).strict()).length(EVALUATOR_GOLD_HOLDOUT_COUNT),
  chargedCostUsd: z.number().nonnegative(),
  reservedCostUsd: z.number().nonnegative(),
  campaignResultDigest: digestSchema,
}).strict();
export type QualityGateAttestationV1 = z.infer<typeof QualityGateAttestationV1Schema>;

export type QualifiedEvaluatorRuntimeV1 = Readonly<{
  qualityGateId: string;
  gateManifestDigest: `sha256:${string}`;
  gateAttestationDigest: `sha256:${string}`;
  evaluatorSourceDigest: `sha256:${string}`;
  dependencyManifestDigest: `sha256:${string}`;
  gateEvaluatedCommitSha: string;
  execution: EvaluatorExecutionTupleV1;
  runtime: EvaluatorRuntimeTupleV1;
  versions: EvaluatorVersionsV1;
}>;

export type EvaluatorPreflightErrorCode =
  | 'runtime_not_quality_gated'
  | 'provider_routing_override_detected';

export class EvaluatorPreflightError extends Error {
  readonly code: EvaluatorPreflightErrorCode;

  constructor(code: EvaluatorPreflightErrorCode) {
    super(code === 'runtime_not_quality_gated'
      ? 'The selected Evaluator runtime has not passed its quality gate.'
      : 'OpenAI provider routing overrides are not allowed for the Evaluator.');
    this.name = 'EvaluatorPreflightError';
    this.code = code;
  }
}
