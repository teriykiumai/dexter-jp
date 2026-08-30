import { z } from 'zod';
import type { Phase3SnapshotInput, SnapshotDigest } from '../snapshot/canonical-json.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { CanonicalTickerSchema, type AnalysisSnapshot } from '../snapshot/schema.js';

export const COMPARISON_RESULT_VERSION = 1 as const;
export const COMPARISON_REGISTRY_VERSION = 1 as const;

export const COMPARISON_SECTIONS = [
  'valuation',
  'fundamental',
  'technical',
  'advancedTechnical',
  'supplyDemand',
  'marketCorrelation',
  'sectorBenchmark',
  'strategy',
  'advancedDividend',
  'volumeProfile',
] as const;

export type ComparisonSectionV1 = (typeof COMPARISON_SECTIONS)[number];

export const COMPARISON_METRIC_KEYS = [
  'valuation.currentPrice',
  'valuation.per',
  'valuation.pbr',
  'valuation.dividendYieldPercent',
  'valuation.revenueCagrPercent',
  'fundamental.latest.revenue',
  'fundamental.latest.operatingIncome',
  'fundamental.latest.ordinaryIncome',
  'fundamental.latest.netIncome',
  'fundamental.latest.eps',
  'fundamental.latest.roe',
  'fundamental.latest.equityRatio',
  'fundamental.latest.operatingCashFlow',
  'fundamental.latest.freeCashFlow',
  'technical.ma20',
  'technical.atr14',
  'technical.averageVolume20',
  'technical.latestSwingHigh',
  'technical.latestSwingLow',
  'technical.trend',
  'advancedTechnical.rsi14',
  'advancedTechnical.macd.value',
  'advancedTechnical.macd.signal',
  'advancedTechnical.macd.histogram',
  'advancedTechnical.bollinger20.middle',
  'advancedTechnical.bollinger20.upper',
  'advancedTechnical.bollinger20.lower',
  'supplyDemand.buyingBalance',
  'supplyDemand.sellingBalance',
  'supplyDemand.marginRatio',
  'supplyDemand.buyingBalanceWeeklyChange',
  'supplyDemand.sellingBalanceWeeklyChange',
  'supplyDemand.mean4w',
  'supplyDemand.mean13w',
  'supplyDemand.mean52w',
  'supplyDemand.deviation52w',
  'supplyDemand.percentile52w',
  'supplyDemand.averageDailyVolume20',
  'supplyDemand.digestionDays',
  'marketCorrelation.window.observations',
  'marketCorrelation.window.correlation',
  'marketCorrelation.window.beta',
  'marketCorrelation.window.alphaAnnualized',
  'marketCorrelation.window.rSquared',
  'sectorBenchmark.window.observations',
  'sectorBenchmark.window.correlation',
  'sectorBenchmark.window.beta',
  'sectorBenchmark.window.alphaAnnualized',
  'sectorBenchmark.window.rSquared',
  'sectorBenchmark.window.stockVolatilityAnnualized',
  'sectorBenchmark.window.benchmarkVolatilityAnnualized',
  'sectorBenchmark.window.excessReturn',
  'strategy.entry.triggerPrice',
  'strategy.entry.price',
  'strategy.candidate.entry.price',
  'strategy.candidate.stop.price',
  'strategy.candidate.target.price',
  'strategy.candidate.rewardRisk',
  'advancedDividend.fiscal.annualDividendPerShare',
  'advancedDividend.fiscal.payoutRatio',
  'advancedDividend.event.dividendPerShare',
  'advancedDividend.event.ordinaryDividendPerShare',
  'advancedDividend.event.commemorativeDividendPerShare',
  'advancedDividend.event.specialDividendPerShare',
  'volumeProfile.poc.price',
  'volumeProfile.valueArea.val',
  'volumeProfile.valueArea.vah',
] as const;

export type ComparisonMetricKeyV1 = (typeof COMPARISON_METRIC_KEYS)[number];
export type ComparisonSnapshotVersionV1 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type ComparisonIntroductionVersionV1 = 1 | 2 | 3 | 6 | 8 | 9;

export type ComparisonInstanceIdentityV1 = readonly Readonly<{
  name: string;
  value: string | number | boolean | null;
}>[];

export type NamedDataDateV1 = Readonly<{
  role:
    | 'section'
    | 'price'
    | 'financial'
    | 'submit'
    | 'volume'
    | 'window_start'
    | 'window_end'
    | 'analysis_as_of'
    | 'source_eligible'
    | 'disclosed'
    | 'notified'
    | 'record'
    | 'rights_record'
    | 'ex'
    | 'payment';
  value: string | null;
}>;

export type ComparisonProvenanceV1 = Readonly<{
  source: string;
  role: string;
  asOfDate: string | null;
  sourceUrls: readonly string[];
  qualifiers: readonly Readonly<{
    name: 'endpoint' | 'section';
    value: string | null;
  }>[];
}>;

export type ComparisonUnavailableReasonV1 = Readonly<{
  reason: string;
  detail: string | null;
}>;

export type NonEmptyComparisonUnavailableReasonsV1 = readonly [
  ComparisonUnavailableReasonV1,
  ...ComparisonUnavailableReasonV1[],
];

type ComparisonObservationContextV1 = Readonly<{
  dataDates: readonly NamedDataDateV1[];
  provenance: readonly ComparisonProvenanceV1[];
  identity: ComparisonInstanceIdentityV1;
}>;

export type ComparisonObservationV1 =
  | Readonly<ComparisonObservationContextV1 & {
      state: 'available';
      value: number | string;
      actualUnit: string | null;
      unavailableReasons: readonly [];
    }>
  | Readonly<ComparisonObservationContextV1 & {
      state: 'unavailable';
      value: null;
      actualUnit: string | null;
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<ComparisonObservationContextV1 & {
      state: 'not_collected';
      value: null;
      actualUnit: null;
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<{
      state: 'ambiguous';
      value: null;
      actualUnit: null;
      dataDates: readonly [];
      provenance: readonly [];
      identity: ComparisonInstanceIdentityV1;
      unavailableReasons: readonly [Readonly<{
        reason: 'duplicate_instance_identity';
        detail: null;
      }>];
      candidateCount: number;
    }>
  | Readonly<{
      state: 'absent';
      value: null;
      actualUnit: null;
      dataDates: readonly [];
      provenance: readonly [];
      identity: ComparisonInstanceIdentityV1;
      unavailableReasons: readonly [];
    }>;

export type ComparisonValueStateV1 = ComparisonObservationV1['state'];
export type ComparisonDisplaySemanticsV1 =
  | 'native'
  | 'percent_value'
  | 'fraction_as_percent'
  | 'category';

export type ComparisonDispositionV1 =
  | Readonly<{
      state: 'comparable';
      mode: 'absolute_delta';
      delta: number;
      deltaUnit: string;
      changed: boolean;
    }>
  | Readonly<{
      state: 'comparable';
      mode: 'from_to';
      delta: null;
      changed: boolean;
    }>
  | Readonly<{
      state: 'incomparable';
      mode: 'incomparable';
      delta: null;
      reason:
        | 'unit_mismatch'
        | 'period_changed'
        | 'benchmark_changed'
        | 'method_changed'
        | 'window_changed'
        | 'missing_data_date'
        | 'invalid_data_date'
        | 'data_date_regressed'
        | 'identity_changed';
    }>
  | Readonly<{
      state: 'incomparable';
      mode: 'incomparable';
      delta: null;
      reason: 'identity_ambiguous';
      affectedSides: readonly ['base'] | readonly ['target'] | readonly ['base', 'target'];
      candidateCounts: Readonly<{ base: number | null; target: number | null }>;
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason: 'non_available_state';
      sideStates: Readonly<{ base: ComparisonValueStateV1; target: ComparisonValueStateV1 }>;
      affectedSides: readonly ('base' | 'target')[];
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason: 'record_added';
      affectedSides: readonly ['base'];
      presentSide: 'target';
    }>
  | Readonly<{
      state: 'not_applicable';
      mode: 'not_applicable';
      delta: null;
      reason: 'record_removed';
      affectedSides: readonly ['target'];
      presentSide: 'base';
    }>;

export type SnapshotComparisonMetricRowV1 = Readonly<{
  metricKey: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  definitionIntroducedInSnapshotVersion: ComparisonIntroductionVersionV1;
  instanceIntroducedInSnapshotVersion: ComparisonIntroductionVersionV1;
  instanceIdentity: ComparisonInstanceIdentityV1;
  base: ComparisonObservationV1;
  target: ComparisonObservationV1;
  comparison: ComparisonDispositionV1;
}>;

export type ComparisonSnapshotIdentityV1 = Readonly<{
  snapshotId: string;
  schemaVersion: ComparisonSnapshotVersionV1;
  generatedAt: string;
  snapshotDigest: SnapshotDigest;
}>;

export type ComparisonSectionAvailabilityV1 =
  | Readonly<{ state: 'available'; unavailableReasons: readonly [] }>
  | Readonly<{
      state: 'unavailable';
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>
  | Readonly<{
      state: 'not_collected';
      unavailableReasons: NonEmptyComparisonUnavailableReasonsV1;
    }>;

export type ComparisonSectionStateV1 = Readonly<{
  section: ComparisonSectionV1;
  base: ComparisonSectionAvailabilityV1;
  target: ComparisonSectionAvailabilityV1;
}>;

export type ComparisonFailureCodeV1 =
  | 'invalid_ticker'
  | 'invalid_base_snapshot_id'
  | 'invalid_target_snapshot_id'
  | 'same_snapshot_id'
  | 'base_snapshot_not_found'
  | 'target_snapshot_not_found'
  | 'base_ticker_mismatch'
  | 'target_ticker_mismatch'
  | 'invalid_order'
  | 'unsupported_snapshot_version'
  | 'corrupt_snapshot'
  | 'snapshot_filesystem_failure';

export type AnalysisSnapshotComparisonResponseV1 =
  | Readonly<{
      resultVersion: 1;
      registryVersion: 1;
      outcome: 'success';
      ticker: string;
      base: ComparisonSnapshotIdentityV1;
      target: ComparisonSnapshotIdentityV1;
      comparisonAsOf: string;
      sectionStates: readonly ComparisonSectionStateV1[];
      metricRows: readonly SnapshotComparisonMetricRowV1[];
    }>
  | Readonly<{
      resultVersion: 1;
      registryVersion: 1;
      outcome: 'failure';
      request: Readonly<{
        ticker: string;
        baseSnapshotId: string;
        targetSnapshotId: string;
      }>;
      error: Readonly<{
        code: ComparisonFailureCodeV1;
        message: string;
      }>;
    }>;

export type ComparisonInstanceDefinitionV1 = Readonly<{
  identity: ComparisonInstanceIdentityV1;
  introducedInSnapshotVersion: ComparisonIntroductionVersionV1;
}>;

export type ComparisonMetricDefinitionV1 = Readonly<{
  key: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  introducedInSnapshotVersion: ComparisonIntroductionVersionV1;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  comparisonDateRoles: readonly NamedDataDateV1['role'][];
  resolveInstances: (snapshot: AnalysisSnapshot) => readonly ComparisonInstanceDefinitionV1[];
  extractObservation: (
    snapshot: AnalysisSnapshot,
    instance: ComparisonInstanceDefinitionV1,
  ) => ComparisonObservationV1;
  compare: (
    base: ComparisonObservationV1,
    target: ComparisonObservationV1,
  ) => ComparisonDispositionV1;
}>;

export type CompareAnalysisSnapshotsRequestV1 = Readonly<{
  ticker: string;
  base: Phase3SnapshotInput;
  target: Phase3SnapshotInput;
}>;

const identityValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const ComparisonInstanceIdentityV1Schema: z.ZodType<ComparisonInstanceIdentityV1> = z.array(
  z.object({ name: z.string().min(1), value: identityValueSchema }),
);

export const NamedDataDateV1Schema: z.ZodType<NamedDataDateV1> = z.object({
  role: z.enum([
    'section', 'price', 'financial', 'submit', 'volume', 'window_start', 'window_end',
    'analysis_as_of', 'source_eligible', 'disclosed', 'notified', 'record',
    'rights_record', 'ex', 'payment',
  ]),
  value: z.string().nullable(),
});

export const ComparisonProvenanceV1Schema: z.ZodType<ComparisonProvenanceV1> = z.object({
  source: z.string().min(1),
  role: z.string().min(1),
  asOfDate: z.string().nullable(),
  sourceUrls: z.array(z.string()),
  qualifiers: z.array(z.object({
    name: z.enum(['endpoint', 'section']),
    value: z.string().nullable(),
  })),
});

export const ComparisonUnavailableReasonV1Schema: z.ZodType<ComparisonUnavailableReasonV1> = z.object({
  reason: z.string().min(1),
  detail: z.string().nullable(),
});

const nonEmptyUnavailableReasonsSchema: z.ZodType<NonEmptyComparisonUnavailableReasonsV1> = z
  .tuple([ComparisonUnavailableReasonV1Schema])
  .rest(ComparisonUnavailableReasonV1Schema);
const observationContextShape = {
  dataDates: z.array(NamedDataDateV1Schema),
  provenance: z.array(ComparisonProvenanceV1Schema),
  identity: ComparisonInstanceIdentityV1Schema,
} as const;

export const ComparisonObservationV1Schema: z.ZodType<ComparisonObservationV1> = z.discriminatedUnion(
  'state',
  [
    z.object({
      ...observationContextShape,
      state: z.literal('available'),
      value: z.union([z.number().finite(), z.string().min(1)]),
      actualUnit: z.string().nullable(),
      unavailableReasons: z.tuple([]),
    }),
    z.object({
      ...observationContextShape,
      state: z.literal('unavailable'),
      value: z.null(),
      actualUnit: z.string().nullable(),
      unavailableReasons: nonEmptyUnavailableReasonsSchema,
    }),
    z.object({
      ...observationContextShape,
      state: z.literal('not_collected'),
      value: z.null(),
      actualUnit: z.null(),
      unavailableReasons: nonEmptyUnavailableReasonsSchema,
    }),
    z.object({
      state: z.literal('ambiguous'),
      value: z.null(),
      actualUnit: z.null(),
      dataDates: z.tuple([]),
      provenance: z.tuple([]),
      identity: ComparisonInstanceIdentityV1Schema,
      unavailableReasons: z.tuple([z.object({
        reason: z.literal('duplicate_instance_identity'),
        detail: z.null(),
      })]),
      candidateCount: z.number().int().min(2),
    }),
    z.object({
      state: z.literal('absent'),
      value: z.null(),
      actualUnit: z.null(),
      dataDates: z.tuple([]),
      provenance: z.tuple([]),
      identity: ComparisonInstanceIdentityV1Schema,
      unavailableReasons: z.tuple([]),
    }),
  ],
);

const affectedAmbiguousSidesSchema = z.union([
  z.tuple([z.literal('base')]),
  z.tuple([z.literal('target')]),
  z.tuple([z.literal('base'), z.literal('target')]),
]);
const comparisonValueStateSchema = z.enum([
  'available', 'unavailable', 'not_collected', 'ambiguous', 'absent',
]);

export const ComparisonDispositionV1Schema: z.ZodType<ComparisonDispositionV1> = z.union([
  z.object({
    state: z.literal('comparable'),
    mode: z.literal('absolute_delta'),
    delta: z.number().finite(),
    deltaUnit: z.string().min(1),
    changed: z.boolean(),
  }),
  z.object({
    state: z.literal('comparable'),
    mode: z.literal('from_to'),
    delta: z.null(),
    changed: z.boolean(),
  }),
  z.object({
    state: z.literal('incomparable'),
    mode: z.literal('incomparable'),
    delta: z.null(),
    reason: z.enum([
      'unit_mismatch', 'period_changed', 'benchmark_changed', 'method_changed',
      'window_changed', 'missing_data_date', 'invalid_data_date',
      'data_date_regressed', 'identity_changed',
    ]),
  }),
  z.object({
    state: z.literal('incomparable'),
    mode: z.literal('incomparable'),
    delta: z.null(),
    reason: z.literal('identity_ambiguous'),
    affectedSides: affectedAmbiguousSidesSchema,
    candidateCounts: z.object({ base: z.number().int().min(2).nullable(), target: z.number().int().min(2).nullable() }),
  }),
  z.object({
    state: z.literal('not_applicable'),
    mode: z.literal('not_applicable'),
    delta: z.null(),
    reason: z.literal('non_available_state'),
    sideStates: z.object({ base: comparisonValueStateSchema, target: comparisonValueStateSchema }),
    affectedSides: z.array(z.enum(['base', 'target'])).min(1).max(2),
  }),
  z.object({
    state: z.literal('not_applicable'),
    mode: z.literal('not_applicable'),
    delta: z.null(),
    reason: z.literal('record_added'),
    affectedSides: z.tuple([z.literal('base')]),
    presentSide: z.literal('target'),
  }),
  z.object({
    state: z.literal('not_applicable'),
    mode: z.literal('not_applicable'),
    delta: z.null(),
    reason: z.literal('record_removed'),
    affectedSides: z.tuple([z.literal('target')]),
    presentSide: z.literal('base'),
  }),
]);

const sectionAvailabilitySchema: z.ZodType<ComparisonSectionAvailabilityV1> = z.union([
  z.object({ state: z.literal('available'), unavailableReasons: z.tuple([]) }),
  z.object({ state: z.literal('unavailable'), unavailableReasons: nonEmptyUnavailableReasonsSchema }),
  z.object({ state: z.literal('not_collected'), unavailableReasons: nonEmptyUnavailableReasonsSchema }),
]);

export const SnapshotComparisonMetricRowV1Schema: z.ZodType<SnapshotComparisonMetricRowV1> = z.object({
  metricKey: z.enum(COMPARISON_METRIC_KEYS),
  section: z.enum(COMPARISON_SECTIONS),
  valueKind: z.enum(['number', 'category']),
  expectedUnit: z.string().nullable(),
  displaySemantics: z.enum(['native', 'percent_value', 'fraction_as_percent', 'category']),
  definitionIntroducedInSnapshotVersion: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(8), z.literal(9),
  ]),
  instanceIntroducedInSnapshotVersion: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(8), z.literal(9),
  ]),
  instanceIdentity: ComparisonInstanceIdentityV1Schema,
  base: ComparisonObservationV1Schema,
  target: ComparisonObservationV1Schema,
  comparison: ComparisonDispositionV1Schema,
});

const comparisonSnapshotIdentitySchema: z.ZodType<ComparisonSnapshotIdentityV1> = z.object({
  snapshotId: SnapshotIdSchema,
  schemaVersion: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
    z.literal(6), z.literal(7), z.literal(8), z.literal(9),
  ]),
  generatedAt: z.string().datetime({ offset: true }).refine(value => value.endsWith('Z')),
  snapshotDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) as z.ZodType<SnapshotDigest>,
});

export const ComparisonSectionStateV1Schema: z.ZodType<ComparisonSectionStateV1> = z.object({
  section: z.enum(COMPARISON_SECTIONS),
  base: sectionAvailabilitySchema,
  target: sectionAvailabilitySchema,
});

export const AnalysisSnapshotComparisonResponseV1Schema: z.ZodType<AnalysisSnapshotComparisonResponseV1> = z.union([
  z.object({
    resultVersion: z.literal(COMPARISON_RESULT_VERSION),
    registryVersion: z.literal(COMPARISON_REGISTRY_VERSION),
    outcome: z.literal('success'),
    ticker: CanonicalTickerSchema,
    base: comparisonSnapshotIdentitySchema,
    target: comparisonSnapshotIdentitySchema,
    comparisonAsOf: z.string().min(1),
    sectionStates: z.array(ComparisonSectionStateV1Schema),
    metricRows: z.array(SnapshotComparisonMetricRowV1Schema),
  }),
  z.object({
    resultVersion: z.literal(COMPARISON_RESULT_VERSION),
    registryVersion: z.literal(COMPARISON_REGISTRY_VERSION),
    outcome: z.literal('failure'),
    request: z.object({
      ticker: z.string(),
      baseSnapshotId: z.string(),
      targetSnapshotId: z.string(),
    }),
    error: z.object({
      code: z.enum([
        'invalid_ticker', 'invalid_base_snapshot_id', 'invalid_target_snapshot_id',
        'same_snapshot_id', 'base_snapshot_not_found', 'target_snapshot_not_found',
        'base_ticker_mismatch', 'target_ticker_mismatch', 'invalid_order',
        'unsupported_snapshot_version', 'corrupt_snapshot', 'snapshot_filesystem_failure',
      ]),
      message: z.string().min(1),
    }),
  }),
]);
