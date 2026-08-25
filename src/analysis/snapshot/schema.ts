import { z } from 'zod';
import {
  JAPANESE_SECURITIES_CODE_PATTERN,
  normalizeJapaneseSecuritiesCode,
} from '../../utils/japanese-securities-code.js';

const finiteNumber = z.number().finite();
const nullableFiniteNumber = finiteNumber.nullable();
const nullableDate = z.string().min(1).nullable();
const utcIsoDateTime = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'), {
  message: 'generatedAt must be a UTC ISO 8601 timestamp.',
});

export const ANALYSIS_SNAPSHOT_V1_SCHEMA_VERSION = 1 as const;
export const ANALYSIS_SNAPSHOT_V2_SCHEMA_VERSION = 2 as const;
export const ANALYSIS_SNAPSHOT_V3_SCHEMA_VERSION = 3 as const;
export const ANALYSIS_SNAPSHOT_SCHEMA_VERSION = 4 as const;

export const CanonicalTickerSchema = z.string().regex(JAPANESE_SECURITIES_CODE_PATTERN, {
  message: 'canonicalTicker must be a valid four-character Japanese securities code.',
});

export function normalizeCanonicalTicker(value: string): string {
  return normalizeJapaneseSecuritiesCode(value);
}

export const MetricUnitSchema = z.enum([
  'JPY',
  'shares',
  'percent',
  'ratio',
  'multiple',
  'days',
  'count',
]);

export type MetricUnit = z.infer<typeof MetricUnitSchema>;

export const MetricUnitV2Schema = z.union([
  MetricUnitSchema,
  z.literal('index'),
]);

export const SnapshotSectionSchema = z.enum([
  'identity',
  'fundamental',
  'valuation',
  'peerComparison',
  'technical',
  'supplyDemand',
  'marketCorrelation',
  'strategy',
  'priceHistory',
  'scenarios',
  'risks',
]);

export type SnapshotSection = z.infer<typeof SnapshotSectionSchema>;

export const SnapshotSectionV2Schema = z.union([
  SnapshotSectionSchema,
  z.literal('advancedTechnical'),
]);

export const SnapshotSectionV4Schema = z.union([
  SnapshotSectionV2Schema,
  z.literal('reportedShortPositions'),
]);

export const SnapshotProvenanceSchema = z.object({
  source: z.enum([
    'edinet_db',
    'jquants',
    'financial_metrics_engine',
    'peer_comparison_engine',
    'technical_engine',
    'supply_demand_engine',
    'market_correlation_engine',
    'strategy_engine',
    'llm',
  ]),
  role: z.enum([
    'identity',
    'financial_data',
    'price_data',
    'margin_data',
    'benchmark_data',
    'calculation',
    'narrative',
  ]),
  asOfDate: nullableDate,
  sourceUrls: z.array(z.string().min(1)),
});

export type SnapshotProvenance = z.infer<typeof SnapshotProvenanceSchema>;

const provenanceRecordShape = {
  identity: z.array(SnapshotProvenanceSchema),
  fundamental: z.array(SnapshotProvenanceSchema),
  valuation: z.array(SnapshotProvenanceSchema),
  peerComparison: z.array(SnapshotProvenanceSchema),
  technical: z.array(SnapshotProvenanceSchema),
  supplyDemand: z.array(SnapshotProvenanceSchema),
  marketCorrelation: z.array(SnapshotProvenanceSchema),
  strategy: z.array(SnapshotProvenanceSchema),
  priceHistory: z.array(SnapshotProvenanceSchema),
  scenarios: z.array(SnapshotProvenanceSchema),
  risks: z.array(SnapshotProvenanceSchema),
} as const;

export const SnapshotProvenanceRecordSchema = z.object(provenanceRecordShape);

export const SnapshotProvenanceRecordV2Schema = z.object({
  ...provenanceRecordShape,
  advancedTechnical: z.array(SnapshotProvenanceSchema),
});

export const ReportedShortPositionProvenanceSchema = SnapshotProvenanceSchema.extend({
  source: z.enum(['jquants', 'reported_short_position_engine']),
  role: z.enum(['short_position_data', 'calculation']),
});

export type ReportedShortPositionProvenance = z.infer<
  typeof ReportedShortPositionProvenanceSchema
>;

export const SnapshotProvenanceRecordV4Schema = SnapshotProvenanceRecordV2Schema.extend({
  reportedShortPositions: z.array(ReportedShortPositionProvenanceSchema),
});

const unitMap = z.record(z.string().min(1), MetricUnitSchema);

export const SnapshotUnitsSchema = z.object({
  fundamental: unitMap,
  valuation: unitMap,
  peerComparison: unitMap,
  technical: unitMap,
  supplyDemand: unitMap,
  marketCorrelation: unitMap,
  strategy: unitMap,
  priceHistory: unitMap,
});

const unitMapV2 = z.record(z.string().min(1), MetricUnitV2Schema);

export const SnapshotUnitsV2Schema = z.object({
  fundamental: unitMap,
  valuation: unitMap,
  peerComparison: unitMap,
  technical: unitMap,
  advancedTechnical: unitMapV2,
  supplyDemand: unitMap,
  marketCorrelation: unitMap,
  strategy: unitMap,
  priceHistory: unitMap,
});

export const SnapshotUnitsV4Schema = SnapshotUnitsV2Schema.extend({
  reportedShortPositions: unitMap,
});

export const SnapshotUnavailableSchema = z.object({
  section: SnapshotSectionSchema,
  metric: z.string().min(1).optional(),
  reason: z.string().min(1),
  detail: z.string().min(1).optional(),
});

export type SnapshotUnavailableV1 = z.infer<typeof SnapshotUnavailableSchema>;

export const SnapshotUnavailableV2Schema = z.object({
  section: SnapshotSectionV2Schema,
  metric: z.string().min(1).optional(),
  reason: z.string().min(1),
  detail: z.string().min(1).optional(),
});

export type SnapshotUnavailableV2 = z.infer<typeof SnapshotUnavailableV2Schema>;

export const SnapshotUnavailableV4Schema = z.object({
  section: SnapshotSectionV4Schema,
  metric: z.string().min(1).optional(),
  reason: z.string().min(1),
  detail: z.string().min(1).optional(),
});

export type SnapshotUnavailableV4 = z.infer<typeof SnapshotUnavailableV4Schema>;
export type SnapshotUnavailable = SnapshotUnavailableV4;

export const CompanyIdentitySchema = z.object({
  canonicalTicker: CanonicalTickerSchema,
  companyName: z.string().min(1),
  industry: z.string().min(1).nullable(),
  listingStatus: z.string().min(1).nullable(),
  isDelisted: z.boolean().nullable(),
  dataDate: nullableDate,
  sourceUrls: z.array(z.string().min(1)),
});

export type CompanyIdentity = z.infer<typeof CompanyIdentitySchema>;

export const FundamentalPeriodSchema = z.object({
  fiscalYear: z.number().int(),
  submitDate: nullableDate,
  revenue: nullableFiniteNumber,
  operatingIncome: nullableFiniteNumber,
  ordinaryIncome: nullableFiniteNumber,
  netIncome: nullableFiniteNumber,
  eps: nullableFiniteNumber,
  roe: nullableFiniteNumber,
  equityRatio: nullableFiniteNumber,
  operatingCashFlow: nullableFiniteNumber,
  freeCashFlow: nullableFiniteNumber,
});

export const FundamentalSnapshotSchema = z.object({
  periods: z.array(FundamentalPeriodSchema).min(1),
  sourceUrls: z.array(z.string().min(1)),
}).superRefine(({ periods }, ctx) => {
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index - 1].fiscalYear >= periods[index].fiscalYear) {
      ctx.addIssue({
        code: 'custom',
        message: 'Fundamental periods must be strictly chronological.',
        path: ['periods', index, 'fiscalYear'],
      });
    }
  }
});

export type FundamentalSnapshot = z.infer<typeof FundamentalSnapshotSchema>;

const financialMetricUnavailableReason = z.enum([
  'missing_or_invalid_price',
  'insufficient_financial_history',
  'missing_or_invalid_eps',
  'non_positive_eps',
  'missing_or_invalid_bps',
  'non_positive_bps',
  'missing_or_invalid_dividend',
  'missing_or_invalid_revenue',
  'non_positive_revenue',
  'invalid_fiscal_year_range',
]);

export const FinancialMetricsResultSchema = z.object({
  priceDataDate: nullableDate,
  financialDataDate: nullableDate,
  latestFiscalYear: z.number().int().nullable(),
  currentPrice: nullableFiniteNumber,
  per: nullableFiniteNumber,
  pbr: nullableFiniteNumber,
  dividendYieldPercent: nullableFiniteNumber,
  revenueCagrPercent: nullableFiniteNumber,
  cagrStartFiscalYear: z.number().int().nullable(),
  cagrEndFiscalYear: z.number().int().nullable(),
  cagrPeriods: z.number().int().nullable(),
  unavailable: z.array(z.object({
    metric: z.enum(['per', 'pbr', 'dividendYieldPercent', 'revenueCagrPercent']),
    reason: financialMetricUnavailableReason,
  })),
});

export type SnapshotFinancialMetricsResult = z.infer<typeof FinancialMetricsResultSchema>;

export const TechnicalResultSchema = z.object({
  dataDate: nullableDate,
  ma20: nullableFiniteNumber,
  atr14: nullableFiniteNumber,
  averageVolume20: nullableFiniteNumber,
  trend: z.enum(['uptrend', 'downtrend', 'range_or_transition', 'unavailable']),
  latestSwingHigh: nullableFiniteNumber,
  latestSwingLow: nullableFiniteNumber,
  unavailable: z.array(z.enum([
    'ma20',
    'atr14',
    'averageVolume20',
    'latestSwingHigh',
    'latestSwingLow',
    'trend',
  ])),
});

export type SnapshotTechnicalResult = z.infer<typeof TechnicalResultSchema>;

const advancedTechnicalUnavailableReason = z.enum([
  'insufficient_history',
  'missing_data',
  'invalid_data',
]);

export const AdvancedTechnicalResultSchema = z.object({
  dataDate: nullableDate,
  rsi14: nullableFiniteNumber,
  macd: z.object({
    value: finiteNumber,
    signal: finiteNumber,
    histogram: finiteNumber,
  }).nullable(),
  bollinger20: z.object({
    middle: finiteNumber,
    upper: finiteNumber,
    lower: finiteNumber,
  }).nullable(),
  unavailable: z.array(z.object({
    metric: z.enum(['rsi14', 'macd', 'bollinger20']),
    reason: advancedTechnicalUnavailableReason,
  })),
});

export type SnapshotAdvancedTechnicalResult = z.infer<
  typeof AdvancedTechnicalResultSchema
>;

const supplyDemandMetric = z.enum([
  'buyingBalance',
  'sellingBalance',
  'marginRatio',
  'buyingBalanceWeeklyChange',
  'sellingBalanceWeeklyChange',
  'mean13w',
  'mean52w',
  'deviation52w',
  'percentile52w',
  'averageDailyVolume20',
  'digestionDays',
]);

export const SupplyDemandResultSchema = z.object({
  dataDate: nullableDate,
  volumeDataDate: nullableDate,
  buyingBalance: nullableFiniteNumber,
  sellingBalance: nullableFiniteNumber,
  marginRatio: nullableFiniteNumber,
  buyingBalanceWeeklyChange: nullableFiniteNumber,
  sellingBalanceWeeklyChange: nullableFiniteNumber,
  mean13w: nullableFiniteNumber,
  mean52w: nullableFiniteNumber,
  deviation52w: nullableFiniteNumber,
  percentile52w: nullableFiniteNumber,
  averageDailyVolume20: nullableFiniteNumber,
  digestionDays: nullableFiniteNumber,
  unavailable: z.array(z.object({
    metric: supplyDemandMetric,
    reason: z.enum([
      'missing_data',
      'insufficient_history',
      'zero_selling_balance',
      'zero_mean_52w',
      'zero_average_daily_volume',
    ]),
  })),
});

export type SnapshotSupplyDemandResult = z.infer<typeof SupplyDemandResultSchema>;

const supplyDemandMetricV3 = z.union([
  supplyDemandMetric,
  z.literal('mean4w'),
]);

export const SupplyDemandResultV3Schema = SupplyDemandResultSchema.extend({
  mean4w: nullableFiniteNumber,
  unavailable: z.array(z.object({
    metric: supplyDemandMetricV3,
    reason: z.enum([
      'missing_data',
      'insufficient_history',
      'zero_selling_balance',
      'zero_mean_52w',
      'zero_average_daily_volume',
    ]),
  })),
});

export type SnapshotSupplyDemandResultV3 = z.infer<typeof SupplyDemandResultV3Schema>;

const reportedShortPositionUnavailableReason = z.enum([
  'no_public_disclosure_data',
  'invalid_data',
]);

export const ReportedShortPositionResultSchema = z.object({
  dataDate: nullableDate,
  reports: z.array(z.object({
    disclosedDate: z.string().min(1),
    calculatedDate: z.string().min(1),
    reporterName: z.string().nullable(),
    discretionaryManagerName: z.string().nullable(),
    fundName: z.string().nullable(),
    shortPositionRatio: finiteNumber.nonnegative(),
    shortPositionShares: finiteNumber.nonnegative(),
    previousCalculatedDate: nullableDate,
    previousReportedRatio: finiteNumber.nonnegative().nullable(),
    ratioDelta: nullableFiniteNumber,
  })),
  unavailable: z.array(z.object({
    reason: reportedShortPositionUnavailableReason,
  })),
});

export type SnapshotReportedShortPositionResult = z.infer<
  typeof ReportedShortPositionResultSchema
>;

const peerMetric = z.enum([
  'per',
  'pbr',
  'roe',
  'roic',
  'operatingMargin',
  'revenueGrowth',
  'dividendYield',
]);

const peerMetricsSchema = z.object({
  per: nullableFiniteNumber.optional(),
  pbr: nullableFiniteNumber.optional(),
  roe: nullableFiniteNumber.optional(),
  roic: nullableFiniteNumber.optional(),
  operatingMargin: nullableFiniteNumber.optional(),
  revenueGrowth: nullableFiniteNumber.optional(),
  dividendYield: nullableFiniteNumber.optional(),
});

export const PeerCompanySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sector: z.string().min(1),
  marketCap: nullableFiniteNumber.optional(),
  dataDate: nullableDate.optional(),
  metrics: peerMetricsSchema,
});

const peerPositionSchema = z.object({
  metric: peerMetric,
  direction: z.enum(['higher_is_better', 'lower_is_better']),
  targetValue: nullableFiniteNumber,
  median: nullableFiniteNumber,
  rank: nullableFiniteNumber,
  percentile: nullableFiniteNumber,
  peerSampleSize: z.number().int().nonnegative(),
  cohortSize: z.number().int().nonnegative(),
});

export const PeerComparisonResultSchema = z.object({
  target: PeerCompanySchema,
  selection: z.object({
    peers: z.array(PeerCompanySchema),
    sameSectorCandidateCount: z.number().int().nonnegative(),
    marketCapPrioritizedPeerCount: z.number().int().nonnegative(),
    sectorLeaderId: z.string().min(1).nullable(),
    sectorLeaderIncluded: z.boolean(),
    tooFewPeers: z.boolean(),
  }),
  targetIncludedInStatistics: z.literal(true),
  positions: z.object({
    per: peerPositionSchema,
    pbr: peerPositionSchema,
    roe: peerPositionSchema,
    roic: peerPositionSchema,
    operatingMargin: peerPositionSchema,
    revenueGrowth: peerPositionSchema,
    dividendYield: peerPositionSchema,
  }),
  unavailable: z.array(z.object({
    metric: peerMetric,
    reason: z.enum(['missing_target_metric', 'insufficient_peer_data']),
  })),
});

export const SnapshotPeerComparisonSchema = z.object({
  result: PeerComparisonResultSchema,
  marketCapPriorityApplied: z.boolean(),
  marketCapPriorityUnavailableReason: z.enum([
    'missing_target_market_cap',
    'incomplete_peer_market_cap',
  ]).nullable(),
});

export type SnapshotPeerComparison = z.infer<typeof SnapshotPeerComparisonSchema>;

const marketCorrelationMetric = z.enum([
  'correlation',
  'beta',
  'alphaAnnualized',
  'rSquared',
  'stockVolatilityAnnualized',
  'benchmarkVolatilityAnnualized',
  'excessReturn',
]);

export const MarketCorrelationResultSchema = z.object({
  benchmark: z.literal('TOPIX'),
  dataDate: nullableDate,
  alignedPriceCount: z.number().int().nonnegative(),
  windows: z.array(z.object({
    period: z.number().int().positive(),
    startDate: nullableDate,
    endDate: nullableDate,
    observations: z.number().int().nonnegative(),
    correlation: nullableFiniteNumber,
    beta: nullableFiniteNumber,
    alphaAnnualized: nullableFiniteNumber,
    rSquared: nullableFiniteNumber,
    stockVolatilityAnnualized: nullableFiniteNumber,
    benchmarkVolatilityAnnualized: nullableFiniteNumber,
    excessReturn: nullableFiniteNumber,
    unavailable: z.array(z.object({
      metric: marketCorrelationMetric,
      reason: z.enum([
        'insufficient_history',
        'zero_stock_variance',
        'zero_benchmark_variance',
      ]),
    })),
  })),
});

export type SnapshotMarketCorrelationResult = z.infer<typeof MarketCorrelationResultSchema>;

const strategyEntrySchema = z.object({
  triggerPrice: finiteNumber,
  price: nullableFiniteNumber,
  reason: z.literal('breakout_above_swing_high'),
  trigger: z.literal('strictly_above'),
  tickSizeApplied: nullableFiniteNumber,
});

export const StrategyResultSchema = z.object({
  dataDate: nullableDate,
  entry: strategyEntrySchema.nullable(),
  candidates: z.array(z.object({
    entry: strategyEntrySchema.extend({
      price: finiteNumber,
      tickSizeApplied: finiteNumber,
    }),
    stop: z.object({
      price: finiteNumber,
      reason: z.enum(['latest_swing_low', 'entry_minus_1_5_atr']),
    }),
    target: z.object({
      price: finiteNumber,
      reason: z.enum(['risk_reward_2R', 'resistance_level']),
    }),
    risk: finiteNumber,
    reward: finiteNumber,
    rewardRisk: finiteNumber,
  })),
  unavailable: z.array(z.object({
    candidate: z.enum(['entry', 'swing_stop', 'atr_stop', 'resistance_target']),
    reason: z.enum([
      'missing_or_invalid_swing_high',
      'missing_tick_size_for_executable_entry',
      'missing_entry',
      'missing_or_invalid_swing_low',
      'missing_or_invalid_atr',
      'non_positive_stop',
      'stop_not_below_entry',
      'zero_risk',
      'missing_or_invalid_resistance',
      'target_not_above_entry',
    ]),
    price: finiteNumber.optional(),
  })),
});

export type SnapshotStrategyResult = z.infer<typeof StrategyResultSchema>;

export const PriceBarSchema = z.object({
  date: z.string().min(1),
  open: nullableFiniteNumber,
  high: nullableFiniteNumber,
  low: nullableFiniteNumber,
  close: nullableFiniteNumber,
  volume: nullableFiniteNumber,
});

export const PriceHistorySchema = z.array(PriceBarSchema).min(1).superRefine((bars, ctx) => {
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].date <= bars[index - 1].date) {
      ctx.addIssue({
        code: 'custom',
        message: 'Price history must be strictly chronological.',
        path: [index, 'date'],
      });
    }
  }
});

export type SnapshotPriceBar = z.infer<typeof PriceBarSchema>;

export const ScenarioResultSchema = z.object({
  condition: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  invalidation: z.string().min(1),
});

export const ScenariosSchema = z.object({
  bull: ScenarioResultSchema,
  base: ScenarioResultSchema,
  bear: ScenarioResultSchema,
});

export const RiskItemSchema = z.object({
  category: z.string().min(1).nullable(),
  description: z.string().min(1),
  relatedSection: SnapshotSectionSchema.nullable(),
});

export const SnapshotDataDatesSchema = z.object({
  identity: nullableDate,
  fundamental: nullableDate,
  valuation: z.object({
    price: nullableDate,
    financial: nullableDate,
  }),
  peerComparison: nullableDate,
  technical: nullableDate,
  supplyDemand: nullableDate,
  marketCorrelation: nullableDate,
  strategy: nullableDate,
  priceHistory: nullableDate,
});

export const SnapshotDataDatesV2Schema = SnapshotDataDatesSchema.extend({
  advancedTechnical: nullableDate,
});

export const SnapshotDataDatesV4Schema = SnapshotDataDatesV2Schema.extend({
  reportedShortPositions: nullableDate,
});

export const AnalysisSnapshotV1Schema = z.object({
  schemaVersion: z.literal(ANALYSIS_SNAPSHOT_V1_SCHEMA_VERSION),
  status: z.enum(['complete', 'partial']),
  canonicalTicker: CanonicalTickerSchema,
  companyName: z.string().min(1),
  generatedAt: utcIsoDateTime,
  dataDates: SnapshotDataDatesSchema,
  provenance: SnapshotProvenanceRecordSchema,
  units: SnapshotUnitsSchema,
  fundamental: FundamentalSnapshotSchema.nullable(),
  valuation: FinancialMetricsResultSchema.nullable(),
  peerComparison: SnapshotPeerComparisonSchema.nullable(),
  technical: TechnicalResultSchema.nullable(),
  supplyDemand: SupplyDemandResultSchema.nullable(),
  marketCorrelation: MarketCorrelationResultSchema.nullable(),
  strategy: StrategyResultSchema.nullable(),
  priceHistory: PriceHistorySchema.nullable(),
  scenarios: ScenariosSchema.nullable(),
  risks: z.array(RiskItemSchema).nullable(),
  unavailable: z.array(SnapshotUnavailableSchema),
  finalReportMarkdown: z.string().min(1),
});

export const AnalysisSnapshotV2Schema = AnalysisSnapshotV1Schema.extend({
  schemaVersion: z.literal(ANALYSIS_SNAPSHOT_V2_SCHEMA_VERSION),
  dataDates: SnapshotDataDatesV2Schema,
  provenance: SnapshotProvenanceRecordV2Schema,
  units: SnapshotUnitsV2Schema,
  advancedTechnical: AdvancedTechnicalResultSchema.nullable(),
  unavailable: z.array(SnapshotUnavailableV2Schema),
});

export const AnalysisSnapshotV3Schema = AnalysisSnapshotV2Schema.extend({
  schemaVersion: z.literal(ANALYSIS_SNAPSHOT_V3_SCHEMA_VERSION),
  supplyDemand: SupplyDemandResultV3Schema.nullable(),
});

export const AnalysisSnapshotV4Schema = AnalysisSnapshotV3Schema.extend({
  schemaVersion: z.literal(ANALYSIS_SNAPSHOT_SCHEMA_VERSION),
  dataDates: SnapshotDataDatesV4Schema,
  provenance: SnapshotProvenanceRecordV4Schema,
  units: SnapshotUnitsV4Schema,
  reportedShortPositions: ReportedShortPositionResultSchema.nullable(),
  unavailable: z.array(SnapshotUnavailableV4Schema),
});

export const AnalysisSnapshotSchema = z.discriminatedUnion('schemaVersion', [
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  AnalysisSnapshotV4Schema,
]);

export type AnalysisSnapshotV1 = z.infer<typeof AnalysisSnapshotV1Schema>;
export type AnalysisSnapshotV2 = z.infer<typeof AnalysisSnapshotV2Schema>;
export type AnalysisSnapshotV3 = z.infer<typeof AnalysisSnapshotV3Schema>;
export type AnalysisSnapshotV4 = z.infer<typeof AnalysisSnapshotV4Schema>;
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;

export const AnalysisSnapshotInputSchema = z.object({
  identity: CompanyIdentitySchema,
  generatedAt: utcIsoDateTime,
  fundamental: FundamentalSnapshotSchema.nullable(),
  valuation: FinancialMetricsResultSchema.nullable(),
  peerComparison: PeerComparisonResultSchema.nullable(),
  peerCandidateMarketCapsComplete: z.boolean().nullable(),
  technical: TechnicalResultSchema.nullable(),
  advancedTechnical: AdvancedTechnicalResultSchema.nullable(),
  supplyDemand: SupplyDemandResultV3Schema.nullable(),
  reportedShortPositions: ReportedShortPositionResultSchema.nullable(),
  marketCorrelation: MarketCorrelationResultSchema.nullable(),
  strategy: StrategyResultSchema.nullable(),
  priceHistory: PriceHistorySchema.nullable(),
  scenarios: ScenariosSchema.nullable(),
  risks: z.array(RiskItemSchema).nullable(),
  finalReportMarkdown: z.string().min(1),
  priceSourceUrls: z.array(z.string().min(1)),
  peerSourceUrls: z.array(z.string().min(1)),
  reportedShortPositionSourceUrls: z.array(z.string().min(1)),
  sourceUsage: z.object({
    valuation: z.object({
      priceFromJQuants: z.boolean(),
      financialsFromEdinetDb: z.boolean(),
    }),
    technical: z.object({
      priceFromJQuants: z.boolean(),
    }),
    supplyDemand: z.object({
      marginFromJQuants: z.boolean(),
      volumeFromJQuants: z.boolean(),
    }),
    marketCorrelation: z.object({
      stockFromJQuants: z.boolean(),
      benchmarkFromJQuants: z.boolean(),
    }),
    reportedShortPositions: z.object({
      sourceFromJQuants: z.boolean(),
    }),
  }),
  additionalUnavailable: z.array(SnapshotUnavailableV4Schema),
});

export type AnalysisSnapshotInput = z.infer<typeof AnalysisSnapshotInputSchema>;
