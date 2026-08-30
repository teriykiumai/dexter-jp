import { z } from 'zod';
import {
  type ComparisonInstanceIdentityV1,
  type NamedDataDateV1,
} from '../comparison/schema.js';
import type { SnapshotDigest } from '../snapshot/canonical-json.js';

export const EVIDENCE_MANIFEST_VERSION = 1 as const;
export const EVALUATOR_SCHEMA_VERSION = 1 as const;
export const EVALUATION_SIDECAR_VERSION = 1 as const;

export const EVIDENCE_SCOPE_IDS = [
  'snapshot_identity',
  'valuation',
  'fundamental',
  'peer_comparison',
  'technical',
  'advanced_technical',
  'supply_demand',
  'market_correlation',
  'reported_short_positions',
  'investor_type_flows',
  'sector_benchmark',
  'sector_short_ratio',
  'advanced_dividend',
  'volume_profile_summary',
  'strategy',
  'price_history_series',
  'volume_profile_bins',
  'outside_filing_narrative',
  'outside_company_management_history',
  'outside_competitors_industry',
  'outside_macro_market_news',
  'outside_undeclared_financial_metric',
  'outside_source_totality',
  'outside_other_context',
] as const;

export type EvidenceScopeIdV1 = (typeof EVIDENCE_SCOPE_IDS)[number];

export const EVIDENCE_CLAIM_DOMAINS = [
  'snapshot_identity',
  'valuation_metrics',
  'fundamental_periods',
  'peer_positions',
  'technical_metrics',
  'advanced_technical_metrics',
  'supply_demand_metrics',
  'market_correlation_windows',
  'reported_short_persisted_rows',
  'investor_flow_tokyo_nagoya_period',
  'sector_benchmark_persisted_windows',
  'sector_short_persisted_observations',
  'advanced_dividend_persisted_facts',
  'volume_profile_summary',
  'strategy_persisted_candidates',
  'price_history_series',
  'volume_profile_bins',
  'outside_filing_narrative',
  'outside_company_management_history',
  'outside_competitors_industry',
  'outside_macro_market_news',
  'outside_undeclared_financial_metric',
  'outside_source_totality',
  'outside_other_context',
] as const;

export type EvidenceClaimDomainV1 = (typeof EVIDENCE_CLAIM_DOMAINS)[number];

export const EVIDENCE_SCOPE_DOMAIN_V1: Readonly<Record<EvidenceScopeIdV1, EvidenceClaimDomainV1>> = {
  snapshot_identity: 'snapshot_identity',
  valuation: 'valuation_metrics',
  fundamental: 'fundamental_periods',
  peer_comparison: 'peer_positions',
  technical: 'technical_metrics',
  advanced_technical: 'advanced_technical_metrics',
  supply_demand: 'supply_demand_metrics',
  market_correlation: 'market_correlation_windows',
  reported_short_positions: 'reported_short_persisted_rows',
  investor_type_flows: 'investor_flow_tokyo_nagoya_period',
  sector_benchmark: 'sector_benchmark_persisted_windows',
  sector_short_ratio: 'sector_short_persisted_observations',
  advanced_dividend: 'advanced_dividend_persisted_facts',
  volume_profile_summary: 'volume_profile_summary',
  strategy: 'strategy_persisted_candidates',
  price_history_series: 'price_history_series',
  volume_profile_bins: 'volume_profile_bins',
  outside_filing_narrative: 'outside_filing_narrative',
  outside_company_management_history: 'outside_company_management_history',
  outside_competitors_industry: 'outside_competitors_industry',
  outside_macro_market_news: 'outside_macro_market_news',
  outside_undeclared_financial_metric: 'outside_undeclared_financial_metric',
  outside_source_totality: 'outside_source_totality',
  outside_other_context: 'outside_other_context',
};

const shortString = z.string().max(2_000);
const nonEmptyShortString = shortString.min(1);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const utcDateTimeSchema = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'));
const uuidV4Schema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
export const EvaluationIdV1Schema = uuidV4Schema;
const evidenceIdentityValueSchema = z.union([
  shortString, z.number().finite(), z.boolean(), z.null(),
]);
const EvidenceInstanceIdentityV1Schema: z.ZodType<ComparisonInstanceIdentityV1> = z.array(
  z.object({ name: nonEmptyShortString, value: evidenceIdentityValueSchema }).strict(),
);
const EvidenceNamedDataDateV1Schema: z.ZodType<NamedDataDateV1> = z.object({
  role: z.enum([
    'section', 'price', 'financial', 'submit', 'volume', 'window_start', 'window_end',
    'analysis_as_of', 'source_eligible', 'disclosed', 'notified', 'record',
    'rights_record', 'ex', 'payment',
  ]),
  value: shortString.nullable(),
}).strict();

export const EvidenceScopeCoverageV1Schema = z.enum([
  'complete_for_domain',
  'partial',
  'excluded_from_manifest',
  'outside_snapshot_scope',
]);
export type EvidenceScopeCoverageV1 = z.infer<typeof EvidenceScopeCoverageV1Schema>;

export const EvidenceScopeStateV1Schema = z.enum([
  'available',
  'unavailable',
  'not_collected',
  'persisted_but_excluded',
  'outside_snapshot_scope',
]);
export type EvidenceScopeStateV1 = z.infer<typeof EvidenceScopeStateV1Schema>;

export const EvidenceScopeReasonV1Schema = z.enum([
  'schema_predates_scope',
  'stored_not_collected',
  'snapshot_section_unavailable',
  'volume_profile_bins_excluded',
  'raw_series_excluded',
  'domain_not_persisted',
]).nullable();
export type EvidenceScopeReasonV1 = z.infer<typeof EvidenceScopeReasonV1Schema>;

export const EvidenceScopeV1Schema = z.object({
  scopeId: z.enum(EVIDENCE_SCOPE_IDS),
  claimDomain: z.enum(EVIDENCE_CLAIM_DOMAINS),
  state: EvidenceScopeStateV1Schema,
  coverage: EvidenceScopeCoverageV1Schema,
  reason: EvidenceScopeReasonV1Schema,
}).strict();
export type EvidenceScopeV1 = z.infer<typeof EvidenceScopeV1Schema>;

export const EvidenceFactUnavailableReasonV1Schema = z.object({
  reason: nonEmptyShortString,
  detail: shortString.nullable(),
}).strict();
export type EvidenceFactUnavailableReasonV1 = z.infer<
  typeof EvidenceFactUnavailableReasonV1Schema
>;

const factContextShape = {
  factKey: nonEmptyShortString,
  dataDates: z.array(EvidenceNamedDataDateV1Schema),
} as const;

export const EvidenceFactV1Schema = z.discriminatedUnion('state', [
  z.object({
    ...factContextShape,
    state: z.literal('available'),
    value: z.union([z.number().finite(), shortString, z.boolean()]),
    unit: nonEmptyShortString.nullable(),
    unavailableReasons: z.tuple([]),
  }).strict(),
  z.object({
    ...factContextShape,
    state: z.literal('unavailable'),
    value: z.null(),
    unit: nonEmptyShortString.nullable(),
    unavailableReasons: z.array(EvidenceFactUnavailableReasonV1Schema).min(1),
  }).strict(),
  z.object({
    ...factContextShape,
    state: z.literal('not_collected'),
    value: z.null(),
    unit: z.null(),
    unavailableReasons: z.array(EvidenceFactUnavailableReasonV1Schema).min(1),
  }).strict(),
]);
export type EvidenceFactV1 = z.infer<typeof EvidenceFactV1Schema>;

export const EvidenceProvenanceV1Schema = z.object({
  source: nonEmptyShortString,
  role: nonEmptyShortString,
  asOfDate: shortString.nullable(),
  qualifiers: z.array(z.object({
    name: z.enum(['endpoint', 'section']),
    value: shortString.nullable(),
  }).strict()),
}).strict().superRefine((value, context) => {
  for (const [index, qualifier] of value.qualifiers.entries()) {
    if (
      qualifier.name === 'endpoint'
      && qualifier.value !== null
      && !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(qualifier.value)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Evidence endpoint qualifiers must be relative API paths.',
        path: ['qualifiers', index, 'value'],
      });
    }
  }
});
export type EvidenceProvenanceV1 = z.infer<typeof EvidenceProvenanceV1Schema>;

export const EvidenceItemV1Schema = z.object({
  itemId: z.string().regex(/^e_[0-9a-f]{24}$/),
  scopeId: z.enum(EVIDENCE_SCOPE_IDS),
  definitionKey: nonEmptyShortString,
  instanceIdentity: EvidenceInstanceIdentityV1Schema,
  facts: z.array(EvidenceFactV1Schema).min(1).max(64),
  provenance: z.array(EvidenceProvenanceV1Schema),
  method: shortString.nullable(),
  limitation: shortString.nullable(),
}).strict().superRefine((item, context) => {
  for (const [index, identity] of item.instanceIdentity.entries()) {
    if (identity.name.length > 2_000 || (typeof identity.value === 'string' && identity.value.length > 2_000)) {
      context.addIssue({
        code: 'custom', message: 'Evidence identity string exceeds the V1 limit.',
        path: ['instanceIdentity', index],
      });
    }
  }
  for (const [factIndex, fact] of item.facts.entries()) {
    for (const [dateIndex, dataDate] of fact.dataDates.entries()) {
      if (dataDate.value !== null && dataDate.value.length > 2_000) {
        context.addIssue({
          code: 'custom', message: 'Evidence data-date string exceeds the V1 limit.',
          path: ['facts', factIndex, 'dataDates', dateIndex, 'value'],
        });
      }
    }
  }
});
export type EvidenceItemV1 = z.infer<typeof EvidenceItemV1Schema>;

export const EvidenceManifestV1Schema = z.object({
  manifestVersion: z.literal(EVIDENCE_MANIFEST_VERSION),
  scopes: z.array(EvidenceScopeV1Schema).length(EVIDENCE_SCOPE_IDS.length),
  items: z.array(EvidenceItemV1Schema).max(343),
}).strict();
export type EvidenceManifestV1 = z.infer<typeof EvidenceManifestV1Schema>;

export type EvidenceManifestDigestV1 = `sha256:${string}`;

export type EvidenceItemIdEnvelopeV1 = Readonly<{
  kind: 'dexter_evidence_item_id';
  version: 1;
  manifestVersion: 1;
  scopeId: string;
  definitionKey: string;
  instanceIdentity: ComparisonInstanceIdentityV1;
}>;

export type EvidenceManifestDigestEnvelopeV1 = Readonly<{
  kind: 'dexter_evidence_manifest';
  version: 1;
  manifest: EvidenceManifestV1;
}>;

export const EvidenceFactRefV1Schema = z.object({
  itemId: z.string().regex(/^e_[0-9a-f]{24}$/),
  factKey: nonEmptyShortString,
}).strict();
export type EvidenceFactRefV1 = z.infer<typeof EvidenceFactRefV1Schema>;

export const ReportAnchorV1Schema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  excerpt: z.string().min(1).max(500),
}).strict();
export type ReportAnchorV1 = z.infer<typeof ReportAnchorV1Schema>;

export const SingleReportAnchorLocationV1Schema = z.object({
  kind: z.literal('single_anchor'),
  anchor: ReportAnchorV1Schema,
}).strict();
export type SingleReportAnchorLocationV1 = z.infer<typeof SingleReportAnchorLocationV1Schema>;

export const ReportAnchorSetLocationV1Schema = z.object({
  kind: z.literal('report_anchor_set'),
  anchors: z.array(ReportAnchorV1Schema).min(2).max(4),
}).strict();
export type ReportAnchorSetLocationV1 = z.infer<typeof ReportAnchorSetLocationV1Schema>;

export const AvailableFactRefsBasisV1Schema = z.object({
  kind: z.literal('available_fact_refs'),
  refs: z.array(EvidenceFactRefV1Schema).min(1).max(16),
}).strict();
export type AvailableFactRefsBasisV1 = z.infer<typeof AvailableFactRefsBasisV1Schema>;

export const NonAvailableFactRefsBasisV1Schema = z.object({
  kind: z.literal('non_available_fact_refs'),
  refs: z.array(EvidenceFactRefV1Schema).min(1).max(16),
}).strict();
export type NonAvailableFactRefsBasisV1 = z.infer<typeof NonAvailableFactRefsBasisV1Schema>;

const manifestAbsenceShape = {
  kind: z.literal('manifest_absence'),
  scopeRefs: z.array(z.enum(EVIDENCE_SCOPE_IDS)).min(1).max(8),
} as const;

export const ManifestAbsenceBasisV1Schema = z.object({
  ...manifestAbsenceShape,
  reason: z.enum([
    'no_matching_allowlisted_evidence',
    'relevant_evidence_unavailable',
    'persisted_evidence_not_sent',
    'outside_snapshot_scope',
  ]),
}).strict();
export type ManifestAbsenceBasisV1 = z.infer<typeof ManifestAbsenceBasisV1Schema>;

const NoMatchingEvidenceBasisV1Schema = z.object({
  ...manifestAbsenceShape,
  reason: z.literal('no_matching_allowlisted_evidence'),
}).strict();
const UnavailableOrOutsideBasisV1Schema = z.object({
  ...manifestAbsenceShape,
  reason: z.enum(['relevant_evidence_unavailable', 'outside_snapshot_scope']),
}).strict();
const PersistedEvidenceNotSentBasisV1Schema = z.object({
  ...manifestAbsenceShape,
  reason: z.literal('persisted_evidence_not_sent'),
}).strict();

export const ReportContradictionBasisV1Schema = z.object({
  kind: z.literal('report_contradiction'),
}).strict();
export type ReportContradictionBasisV1 = z.infer<typeof ReportContradictionBasisV1Schema>;

const findingContextShape = {
  claimDomains: z.array(z.enum(EVIDENCE_CLAIM_DOMAINS)).min(1).max(4),
  summary: z.string().min(1).max(1_000),
} as const;

const findingWireVariants = [
  z.object({
    ...findingContextShape,
    category: z.literal('unsupported_claim'),
    importance: z.enum(['material', 'advisory']),
    location: SingleReportAnchorLocationV1Schema,
    basis: NoMatchingEvidenceBasisV1Schema,
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('not_verifiable_from_snapshot'),
    importance: z.literal('advisory'),
    location: SingleReportAnchorLocationV1Schema,
    basis: z.union([NonAvailableFactRefsBasisV1Schema, UnavailableOrOutsideBasisV1Schema]),
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('not_verifiable_by_evaluator'),
    importance: z.literal('advisory'),
    location: SingleReportAnchorLocationV1Schema,
    basis: PersistedEvidenceNotSentBasisV1Schema,
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('internal_inconsistency'),
    importance: z.enum(['material', 'advisory']),
    location: SingleReportAnchorLocationV1Schema,
    basis: AvailableFactRefsBasisV1Schema,
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('internal_inconsistency'),
    importance: z.enum(['material', 'advisory']),
    location: ReportAnchorSetLocationV1Schema,
    basis: ReportContradictionBasisV1Schema,
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('unclear_reasoning'),
    importance: z.enum(['material', 'advisory']),
    location: SingleReportAnchorLocationV1Schema,
    basis: AvailableFactRefsBasisV1Schema,
  }).strict(),
  z.object({
    ...findingContextShape,
    category: z.literal('missing_caveat'),
    importance: z.enum(['material', 'advisory']),
    location: SingleReportAnchorLocationV1Schema,
    basis: z.union([
      AvailableFactRefsBasisV1Schema,
      NonAvailableFactRefsBasisV1Schema,
      ManifestAbsenceBasisV1Schema,
    ]),
  }).strict(),
] as const;

export const EvaluationFindingWireV1Schema = z.union(findingWireVariants);
export type EvaluationFindingWireV1 = z.infer<typeof EvaluationFindingWireV1Schema>;

export type EvaluationFindingV1 = EvaluationFindingWireV1 & Readonly<{ findingId: string }>;

export const EvaluationFindingV1Schema = z.union(
  findingWireVariants.map(schema => (
  schema.extend({ findingId: z.string().regex(/^f_[0-9a-f]{24}$/) })
)) as unknown as [
  ReturnType<(typeof findingWireVariants)[0]['extend']>,
  ReturnType<(typeof findingWireVariants)[1]['extend']>,
  ...ReturnType<(typeof findingWireVariants)[number]['extend']>[],
]) as unknown as z.ZodType<EvaluationFindingV1>;

export type EvaluationFindingIdEnvelopeV1 = Readonly<{
  kind: 'dexter_evaluation_finding_id';
  version: 1;
  category: EvaluationFindingV1['category'];
  claimDomains: readonly [EvidenceClaimDomainV1, ...EvidenceClaimDomainV1[]];
  importance: 'material' | 'advisory';
  location: SingleReportAnchorLocationV1 | ReportAnchorSetLocationV1;
  basis:
    | AvailableFactRefsBasisV1
    | NonAvailableFactRefsBasisV1
    | ManifestAbsenceBasisV1
    | ReportContradictionBasisV1;
}>;

export const EVALUATION_UNAVAILABLE_MESSAGES = {
  provider_timeout: 'The Evaluator provider timed out.',
  provider_failure: 'The Evaluator provider request failed.',
  output_schema_invalid: 'The Evaluator output did not match the required schema.',
  evidence_reference_invalid: 'The Evaluator output contained an invalid evidence reference.',
  report_anchor_invalid: 'The Evaluator output contained an invalid report anchor.',
} as const;

export const EvaluationUnavailableCodeV1Schema = z.enum([
  'provider_timeout',
  'provider_failure',
  'output_schema_invalid',
  'evidence_reference_invalid',
  'report_anchor_invalid',
]);
export type EvaluationUnavailableCodeV1 = z.infer<typeof EvaluationUnavailableCodeV1Schema>;

export const EvaluationResultV1Schema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    findings: z.array(EvaluationFindingV1Schema).max(20),
  }).strict(),
  z.object({
    state: z.literal('unavailable'),
    code: EvaluationUnavailableCodeV1Schema,
    message: nonEmptyShortString,
    findings: z.tuple([]),
  }).strict().superRefine((value, context) => {
    if (value.message !== EVALUATION_UNAVAILABLE_MESSAGES[value.code]) {
      context.addIssue({ code: 'custom', message: 'Unavailable message is not sanitized.' });
    }
  }),
]);
export type EvaluationResultV1 = z.infer<typeof EvaluationResultV1Schema>;

export const EvaluatorProviderBoundaryV1Schema = z.object({
  baseUrl: z.literal('https://api.openai.com/v1'),
  organizationId: z.null(),
  projectId: z.null(),
  adapterMaxRetries: z.literal(0),
  sdkMaxRetries: z.literal(0),
}).strict();
export type EvaluatorProviderBoundaryV1 = z.infer<typeof EvaluatorProviderBoundaryV1Schema>;

export const EvaluatorExecutionEnvironmentV1Schema = z.object({
  bunVersion: nonEmptyShortString,
  bunRevision: nonEmptyShortString,
  platform: nonEmptyShortString,
  arch: nonEmptyShortString,
  dependencyManifestDigest: digestSchema,
}).strict();
export type EvaluatorExecutionEnvironmentV1 = z.infer<
  typeof EvaluatorExecutionEnvironmentV1Schema
>;

export const EvaluationSidecarV1Schema = z.object({
  version: z.literal(EVALUATION_SIDECAR_VERSION),
  evaluationId: uuidV4Schema,
  target: z.object({
    canonicalTicker: nonEmptyShortString,
    snapshotId: nonEmptyShortString,
    schemaVersion: z.number().int().min(1).max(9),
    generatedAt: utcDateTimeSchema,
    snapshotDigest: digestSchema,
  }).strict(),
  artifactInputDigest: digestSchema,
  evidenceManifest: EvidenceManifestV1Schema,
  evidenceManifestDigest: digestSchema,
  evaluatorSchemaVersion: z.literal(1),
  evidenceManifestVersion: z.literal(1),
  rubricVersion: z.literal(1),
  promptVersion: z.literal(1),
  safetyPolicyVersion: z.literal(1),
  qualityGateId: z.string().regex(/^qg_[a-z0-9][a-z0-9_-]{0,63}$/),
  gateManifestDigest: digestSchema,
  gateAttestationDigest: digestSchema,
  evaluatorSourceDigest: digestSchema,
  gateEvaluatedCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
  executionEnvironment: EvaluatorExecutionEnvironmentV1Schema,
  createdAt: utcDateTimeSchema,
  completedAt: utcDateTimeSchema,
  runtime: z.object({
    providerId: nonEmptyShortString,
    modelId: nonEmptyShortString,
    taskProfile: z.literal('deep_analysis'),
    reasoningEffort: shortString.nullable(),
    providerBoundary: EvaluatorProviderBoundaryV1Schema,
  }).strict(),
  attemptCount: z.number().int().min(1).max(1),
  timeoutMs: z.literal(180_000),
  durationMs: z.number().int().nonnegative(),
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }).strict(),
  result: EvaluationResultV1Schema,
}).strict().superRefine((sidecar, context) => {
  if (Date.parse(sidecar.completedAt) < Date.parse(sidecar.createdAt)) {
    context.addIssue({
      code: 'custom', message: 'completedAt must not precede createdAt.', path: ['completedAt'],
    });
  }
  const usage = sidecar.tokenUsage;
  if (
    usage.inputTokens !== null
    && usage.outputTokens !== null
    && usage.totalTokens !== null
    && usage.totalTokens !== usage.inputTokens + usage.outputTokens
  ) {
    context.addIssue({
      code: 'custom', message: 'totalTokens must equal inputTokens plus outputTokens.',
      path: ['tokenUsage', 'totalTokens'],
    });
  }
});

export type EvaluationSidecarV1 = z.infer<typeof EvaluationSidecarV1Schema> & Readonly<{
  target: Readonly<{ snapshotDigest: SnapshotDigest }>;
  evidenceManifestDigest: EvidenceManifestDigestV1;
}>;

export type ArtifactInputEnvelopeV1 = Readonly<{
  kind: 'dexter_evaluator_input';
  version: 1;
  snapshotDigest: SnapshotDigest;
  evidenceManifestDigest: EvidenceManifestDigestV1;
  evaluatorSchemaVersion: 1;
  evidenceManifestVersion: 1;
  rubricVersion: 1;
  promptVersion: 1;
  safetyPolicyVersion: 1;
  qualityGateId: string;
  gateManifestDigest: EvidenceManifestDigestV1;
  gateAttestationDigest: EvidenceManifestDigestV1;
  evaluatorSourceDigest: EvidenceManifestDigestV1;
  gateEvaluatedCommitSha: string;
  executionEnvironment: EvaluatorExecutionEnvironmentV1;
  runtime: Readonly<{
    providerId: string;
    modelId: string;
    reasoningEffort: string | null;
    providerBoundary: EvaluatorProviderBoundaryV1;
  }>;
}>;

export type EvidenceFactContextV1 = Readonly<{
  factKey: string;
  dataDates: readonly NamedDataDateV1[];
}>;
