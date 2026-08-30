import { createHash } from 'node:crypto';
import {
  COMPARISON_METRIC_REGISTRY_V1,
  comparisonMetricDefinitionV1,
} from '../comparison/index.js';
import type {
  ComparisonInstanceIdentityV1,
  ComparisonMetricKeyV1,
  ComparisonObservationV1,
  NamedDataDateV1,
} from '../comparison/schema.js';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../snapshot/canonical-json.js';
import { EVIDENCE_ENDPOINT_ALLOWLIST_V1 } from '../snapshot/safety.js';
import { AnalysisSnapshotSchema, type AnalysisSnapshot } from '../snapshot/schema.js';
import {
  EVIDENCE_MANIFEST_VERSION,
  EVIDENCE_SCOPE_DOMAIN_V1,
  EVIDENCE_SCOPE_IDS,
  EvidenceManifestV1Schema,
  EvidenceProvenanceV1Schema,
  type EvidenceFactUnavailableReasonV1,
  type EvidenceFactV1,
  type EvidenceItemIdEnvelopeV1,
  type EvidenceItemV1,
  type EvidenceManifestDigestEnvelopeV1,
  type EvidenceManifestDigestV1,
  type EvidenceManifestV1,
  type EvidenceProvenanceV1,
  type EvidenceScopeIdV1,
  type EvidenceScopeV1,
} from './schema.js';

export type EvidenceManifestFailureCodeV1 =
  | 'snapshot_invalid'
  | 'scope_state_invalid'
  | 'collection_limit_exceeded'
  | 'definition_contract_invalid'
  | 'provenance_invalid'
  | 'manifest_limit_exceeded';

export class EvidenceManifestError extends Error {
  readonly code: EvidenceManifestFailureCodeV1;
  readonly causeValue: unknown;

  constructor(code: EvidenceManifestFailureCodeV1, causeValue?: unknown) {
    const messages: Readonly<Record<EvidenceManifestFailureCodeV1, string>> = {
      snapshot_invalid: 'The target Snapshot is invalid.',
      scope_state_invalid: 'The target Snapshot has an inconsistent Evidence scope state.',
      collection_limit_exceeded: 'The target Snapshot exceeds an Evidence collection limit.',
      definition_contract_invalid: 'The Evidence definition contract was violated.',
      provenance_invalid: 'The target Snapshot contains unsupported Evidence provenance.',
      manifest_limit_exceeded: 'The generated Evidence manifest exceeds a V1 limit.',
    };
    super(messages[code]);
    this.name = 'EvidenceManifestError';
    this.code = code;
    this.causeValue = causeValue;
  }
}

export type EvidenceDefinitionV1 = Readonly<{
  definitionKey: string;
  scopeId: EvidenceScopeIdV1;
  factKeys: readonly string[];
}>;

const IDENTITY_FACT_KEYS = [
  'canonicalTicker', 'companyName', 'schemaVersion', 'status', 'generatedAt',
  'dataDate.identity', 'dataDate.fundamental', 'dataDate.valuation.price',
  'dataDate.valuation.financial', 'dataDate.peerComparison', 'dataDate.technical',
  'dataDate.advancedTechnical', 'dataDate.supplyDemand', 'dataDate.marketCorrelation',
  'dataDate.reportedShortPositions', 'dataDate.investorTypeFlows',
  'dataDate.sectorBenchmark', 'dataDate.sectorShortRatio',
  'dataDate.advancedDividend', 'dataDate.volumeProfile', 'dataDate.strategy',
  'dataDate.priceHistory',
] as const;

const FUNDAMENTAL_FACT_KEYS = [
  'revenue', 'operatingIncome', 'ordinaryIncome', 'netIncome', 'eps', 'roe',
  'equityRatio', 'operatingCashFlow', 'freeCashFlow',
] as const;

const PEER_SELECTION_FACT_KEYS = [
  'targetIncludedInStatistics', 'marketCapPriorityApplied',
  'marketCapPriorityUnavailableReason', 'sameSectorCandidateCount',
  'marketCapPrioritizedPeerCount', 'sectorLeaderId', 'sectorLeaderIncluded',
  'tooFewPeers', 'peerCount',
] as const;

const PEER_POSITION_FACT_KEYS = [
  'direction', 'targetValue', 'median', 'rank', 'percentile', 'peerSampleSize', 'cohortSize',
] as const;

const CORRELATION_FACT_KEYS = [
  'observations', 'correlation', 'beta', 'alphaAnnualized', 'rSquared',
  'stockVolatilityAnnualized', 'benchmarkVolatilityAnnualized', 'excessReturn',
] as const;

const REPORTED_SHORT_FACT_KEYS = [
  'shortPositionRatio', 'shortPositionShares', 'previousCalculatedDate',
  'previousReportedRatio', 'ratioDelta',
] as const;

const INVESTOR_GROUPS = [
  'summary.proprietary', 'summary.brokerage', 'summary.total',
  'brokerageBreakdown.individuals', 'brokerageBreakdown.foreignInvestors',
  'brokerageBreakdown.securitiesCompanies', 'brokerageBreakdown.investmentTrusts',
  'brokerageBreakdown.businessCorporations', 'brokerageBreakdown.otherCorporations',
  'brokerageBreakdown.insuranceCompanies', 'brokerageBreakdown.banks',
  'brokerageBreakdown.trustBanks', 'brokerageBreakdown.otherFinancialInstitutions',
] as const;
const INVESTOR_FACT_KEYS = [
  'period',
  ...INVESTOR_GROUPS.flatMap(group => ['sell', 'buy', 'total', 'balance'].map(key => `${group}.${key}`)),
] as const;

const SECTOR_BENCHMARK_IDENTITY_FACT_KEYS = [
  'analysisAsOfDate', 'benchmark.type', 'benchmark.sectorCode', 'benchmark.sectorName',
  'benchmark.indexCode', 'benchmark.classificationDate', 'dataDate', 'alignedPriceCount',
] as const;

const SECTOR_SHORT_IDENTITY_FACT_KEYS = [
  'analysisAsOfDate', 'issuerCode', 'sector.classificationDate', 'sector.sectorCode',
  'sector.sectorName', 'dataDate', 'observationCount',
] as const;

const SECTOR_SHORT_OBSERVATION_FACT_KEYS = [
  'nonShortSellingValue', 'restrictedShortSellingValue', 'unrestrictedShortSellingValue',
  'shortSellingValue', 'totalSellingValue', 'shortSellingRatio',
] as const;

const DIVIDEND_IDENTITY_FACT_KEYS = [
  'analysisAsOfDate', 'collectedAt', 'issuerCode', 'dataDate',
  'fiscalObservationCount', 'eventCollectionAvailable', 'eventCount',
] as const;
const DIVIDEND_FISCAL_FACT_KEYS = [
  'annualDividendPerShare', 'payoutRatio', 'disclosedTime',
] as const;
const DIVIDEND_EVENT_FACT_KEYS = [
  'referenceNumber', 'notifiedTime', 'dividendPerShare', 'ordinaryDividendPerShare',
  'commemorativeDividendPerShare', 'specialDividendPerShare',
] as const;

const VOLUME_PROFILE_FACT_KEYS = [
  'analysisAsOfDate', 'collectedAt', 'issuerCode', 'dataDate', 'windowStartDate',
  'windowEndDate', 'inputBarCount', 'priceBasis', 'volumeBasis', 'allocationMethod',
  'binningMethod.id', 'binningMethod.requestedBinCount', 'binningMethod.effectiveBinCount',
  'binningMethod.minPrice', 'binningMethod.maxPrice', 'poc.binIndex', 'poc.price',
  'poc.allocatedVolume', 'poc.volumeShare', 'valueArea.targetVolumeShare',
  'valueArea.achievedVolumeShare', 'valueArea.val', 'valueArea.vah',
  'valueArea.firstBinIndex', 'valueArea.lastBinIndex', 'methodology.id',
  'methodology.approximation', 'methodology.actualHolderCostBasis',
] as const;

const STRATEGY_ENTRY_FACT_KEYS = [
  'dataDate', 'entry.triggerPrice', 'entry.price', 'entry.reason', 'entry.trigger',
  'entry.tickSizeApplied', 'candidateCount',
] as const;
const STRATEGY_CANDIDATE_FACT_KEYS = [
  'entry.triggerPrice', 'entry.price', 'entry.reason', 'entry.trigger',
  'entry.tickSizeApplied', 'stop.price', 'stop.reason', 'target.price', 'target.reason',
  'risk', 'reward', 'rewardRisk',
] as const;

const FIXED_COMPARISON_KEYS: readonly ComparisonMetricKeyV1[] = [
  ...COMPARISON_METRIC_REGISTRY_V1
    .filter(definition => [
      'valuation', 'technical', 'advancedTechnical', 'supplyDemand',
    ].includes(definition.section))
    .map(definition => definition.key),
];

const comparisonScope = (key: ComparisonMetricKeyV1): EvidenceScopeIdV1 => {
  const section = comparisonMetricDefinitionV1(key).section;
  if (section === 'valuation') return 'valuation';
  if (section === 'technical') return 'technical';
  if (section === 'advancedTechnical') return 'advanced_technical';
  if (section === 'supplyDemand') return 'supply_demand';
  throw new EvidenceManifestError('definition_contract_invalid', key);
};

const fixedDefinitions = (scopeId: EvidenceScopeIdV1): readonly EvidenceDefinitionV1[] => (
  FIXED_COMPARISON_KEYS
    .filter(definitionKey => comparisonScope(definitionKey) === scopeId)
    .map(definitionKey => ({ definitionKey, scopeId, factKeys: ['value'] }))
);

export const EVIDENCE_DEFINITION_REGISTRY_V1: readonly EvidenceDefinitionV1[] = [
  { definitionKey: 'snapshot.identity', scopeId: 'snapshot_identity', factKeys: IDENTITY_FACT_KEYS },
  ...fixedDefinitions('valuation'),
  { definitionKey: 'fundamental.period', scopeId: 'fundamental', factKeys: FUNDAMENTAL_FACT_KEYS },
  { definitionKey: 'peerComparison.selection', scopeId: 'peer_comparison', factKeys: PEER_SELECTION_FACT_KEYS },
  { definitionKey: 'peerComparison.position', scopeId: 'peer_comparison', factKeys: PEER_POSITION_FACT_KEYS },
  ...fixedDefinitions('technical'),
  ...fixedDefinitions('advanced_technical'),
  ...fixedDefinitions('supply_demand'),
  { definitionKey: 'marketCorrelation.window', scopeId: 'market_correlation', factKeys: CORRELATION_FACT_KEYS },
  { definitionKey: 'reportedShortPositions.row', scopeId: 'reported_short_positions', factKeys: REPORTED_SHORT_FACT_KEYS },
  { definitionKey: 'investorTypeFlows.period', scopeId: 'investor_type_flows', factKeys: INVESTOR_FACT_KEYS },
  { definitionKey: 'sectorBenchmark.identity', scopeId: 'sector_benchmark', factKeys: SECTOR_BENCHMARK_IDENTITY_FACT_KEYS },
  { definitionKey: 'sectorBenchmark.window', scopeId: 'sector_benchmark', factKeys: CORRELATION_FACT_KEYS },
  { definitionKey: 'sectorShortRatio.identity', scopeId: 'sector_short_ratio', factKeys: SECTOR_SHORT_IDENTITY_FACT_KEYS },
  { definitionKey: 'sectorShortRatio.observation', scopeId: 'sector_short_ratio', factKeys: SECTOR_SHORT_OBSERVATION_FACT_KEYS },
  { definitionKey: 'advancedDividend.identity', scopeId: 'advanced_dividend', factKeys: DIVIDEND_IDENTITY_FACT_KEYS },
  { definitionKey: 'advancedDividend.fiscal', scopeId: 'advanced_dividend', factKeys: DIVIDEND_FISCAL_FACT_KEYS },
  { definitionKey: 'advancedDividend.event', scopeId: 'advanced_dividend', factKeys: DIVIDEND_EVENT_FACT_KEYS },
  { definitionKey: 'volumeProfile.summary', scopeId: 'volume_profile_summary', factKeys: VOLUME_PROFILE_FACT_KEYS },
  { definitionKey: 'strategy.entry', scopeId: 'strategy', factKeys: STRATEGY_ENTRY_FACT_KEYS },
  { definitionKey: 'strategy.candidate', scopeId: 'strategy', factKeys: STRATEGY_CANDIDATE_FACT_KEYS },
];

const definitionByKey = new Map(
  EVIDENCE_DEFINITION_REGISTRY_V1.map(definition => [definition.definitionKey, definition]),
);
const definitionOrder = new Map(
  EVIDENCE_DEFINITION_REGISTRY_V1.map((definition, index) => [definition.definitionKey, index]),
);

function compareEvidenceItems(left: EvidenceItemV1, right: EvidenceItemV1): number {
  const leftDefinition = definitionOrder.get(left.definitionKey);
  const rightDefinition = definitionOrder.get(right.definitionKey);
  if (leftDefinition === undefined || rightDefinition === undefined) {
    throw new EvidenceManifestError('definition_contract_invalid');
  }
  if (leftDefinition !== rightDefinition) return leftDefinition - rightDefinition;
  const leftIdentity = canonicalJsonV1(left.instanceIdentity as CanonicalJsonValue);
  const rightIdentity = canonicalJsonV1(right.instanceIdentity as CanonicalJsonValue);
  return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
}

function rawSha256Hex(value: CanonicalJsonValue): string {
  return createHash('sha256').update(canonicalJsonV1(value), 'utf8').digest('hex');
}

export function createEvidenceItemIdV1(
  scopeId: EvidenceScopeIdV1,
  definitionKey: string,
  instanceIdentity: ComparisonInstanceIdentityV1,
): string {
  const envelope: EvidenceItemIdEnvelopeV1 = {
    kind: 'dexter_evidence_item_id',
    version: 1,
    manifestVersion: EVIDENCE_MANIFEST_VERSION,
    scopeId,
    definitionKey,
    instanceIdentity,
  };
  return `e_${rawSha256Hex(envelope as CanonicalJsonValue).slice(0, 24)}`;
}

export function digestEvidenceManifestV1(manifest: EvidenceManifestV1): EvidenceManifestDigestV1 {
  const validated = validateEvidenceManifestV1(manifest);
  const envelope: EvidenceManifestDigestEnvelopeV1 = {
    kind: 'dexter_evidence_manifest',
    version: 1,
    manifest: validated,
  };
  return sha256CanonicalJsonV1(envelope as CanonicalJsonValue);
}

const SYNTHETIC_REASON = {
  missing: [{ reason: 'missing_metric_value', detail: null }],
  unavailable: [{ reason: 'snapshot_section_unavailable', detail: null }],
  predatesScope: [{ reason: 'schema_predates_scope', detail: null }],
  predatesInstance: [{ reason: 'schema_predates_instance', detail: null }],
  notCollected: [{ reason: 'stored_not_collected', detail: null }],
} as const;

function reasons(
  values: readonly Readonly<{ reason: string; detail?: string | null }>[] | undefined,
  fallback: readonly EvidenceFactUnavailableReasonV1[] = SYNTHETIC_REASON.missing,
): readonly EvidenceFactUnavailableReasonV1[] {
  if (values === undefined || values.length === 0) return fallback;
  return values.map(value => ({ reason: value.reason, detail: null }));
}

function availableFact(
  factKey: string,
  value: number | string | boolean,
  unit: string | null,
  dataDates: readonly NamedDataDateV1[] = [],
): Extract<EvidenceFactV1, { state: 'available' }> {
  return { factKey, state: 'available', value, unit, dataDates: [...dataDates], unavailableReasons: [] };
}

function unavailableFact(
  factKey: string,
  unit: string | null,
  dataDates: readonly NamedDataDateV1[] = [],
  unavailableReasons: readonly EvidenceFactUnavailableReasonV1[] = SYNTHETIC_REASON.missing,
): Extract<EvidenceFactV1, { state: 'unavailable' }> {
  const normalizedReasons = unavailableReasons.map(value => ({
    reason: value.reason,
    detail: null,
  })).sort((left, right) => {
    const leftKey = `${left.reason}\u0000${left.detail ?? ''}`;
    const rightKey = `${right.reason}\u0000${right.detail ?? ''}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (
    normalizedReasons.length === 0
    || normalizedReasons.some((value, index) => (
      index > 0
      && value.reason === normalizedReasons[index - 1].reason
      && value.detail === normalizedReasons[index - 1].detail
    ))
  ) {
    throw new EvidenceManifestError('definition_contract_invalid', unavailableReasons);
  }
  return {
    factKey,
    state: 'unavailable',
    value: null,
    unit,
    dataDates: [...dataDates],
    unavailableReasons: normalizedReasons,
  };
}

function notCollectedFact(
  factKey: string,
  unavailableReasons: readonly EvidenceFactUnavailableReasonV1[],
): EvidenceFactV1 {
  const fact = unavailableFact(factKey, null, [], unavailableReasons);
  return { ...fact, state: 'not_collected', unit: null };
}

function scalarFact(
  factKey: string,
  value: number | string | boolean | null | undefined,
  unit: string | null,
  dataDates: readonly NamedDataDateV1[] = [],
  unavailableReasons?: readonly EvidenceFactUnavailableReasonV1[],
): EvidenceFactV1 {
  return value === null || value === undefined
    ? unavailableFact(factKey, unit, dataDates, unavailableReasons)
    : availableFact(factKey, value, unit, dataDates);
}

type RawProvenance = Readonly<{
  source: string;
  role: string;
  asOfDate: string | null;
  endpoint?: string | null;
  section?: string | null;
}>;

const ALLOWED_ENDPOINTS: ReadonlySet<string> = new Set<string>([
  ...EVIDENCE_ENDPOINT_ALLOWLIST_V1,
]);
const ALLOWED_PROVENANCE_SOURCES = new Set([
  'edinet_db', 'jquants', 'financial_metrics_engine', 'peer_comparison_engine',
  'technical_engine', 'supply_demand_engine', 'market_correlation_engine',
  'strategy_engine', 'reported_short_position_engine',
  'investor_type_flow_engine', 'sector_short_ratio_engine',
  'advanced_dividend_engine', 'volume_profile_engine',
]);
const ALLOWED_PROVENANCE_ROLES = new Set([
  'identity', 'financial_data', 'price_data', 'margin_data', 'benchmark_data',
  'calculation', 'short_position_data', 'investor_type_flow_data',
  'market_calendar_data', 'sector_classification_data', 'sector_short_ratio_data',
  'dividend_financial_summary_data', 'dividend_event_data',
]);
const ALLOWED_FACT_REASONS = new Set([
  'missing_metric_value', 'snapshot_section_unavailable', 'schema_predates_scope',
  'schema_predates_instance', 'stored_not_collected', 'missing_or_invalid_price',
  'insufficient_financial_history', 'missing_or_invalid_eps', 'non_positive_eps',
  'missing_or_invalid_bps', 'non_positive_bps', 'missing_or_invalid_dividend',
  'missing_or_invalid_revenue', 'non_positive_revenue', 'invalid_fiscal_year_range',
  'engine_reported_unavailable', 'insufficient_history', 'missing_data', 'invalid_data',
  'zero_selling_balance', 'zero_mean_52w', 'zero_average_daily_volume',
  'zero_stock_variance', 'zero_benchmark_variance', 'missing_target_metric',
  'insufficient_peer_data', 'no_public_disclosure_data',
  'no_investor_type_flow_data', 'sector_classification_unavailable',
  'unsupported_sector', 'no_sector_index_data', 'no_sector_short_ratio_data',
  'zero_total_selling_value', 'missing_or_invalid_swing_high',
  'missing_tick_size_for_executable_entry', 'missing_entry',
  'missing_or_invalid_swing_low', 'missing_or_invalid_atr', 'non_positive_stop',
  'stop_not_below_entry', 'zero_risk', 'missing_or_invalid_resistance',
  'target_not_above_entry', 'no_eligible_dividend_disclosure_data',
  'no_eligible_dividend_event_data', 'event_source_plan_unavailable',
  'availability_calendar_unavailable', 'component_breakdown_unavailable',
  'missing_price_data', 'missing_volume_data', 'invalid_price_data',
  'invalid_volume_data', 'invalid_bar_geometry', 'invalid_chronology',
  'zero_total_volume', 'no_price_data', 'corporate_action_basis_unavailable',
  'invalid_input',
]);

function projectProvenance(values: readonly RawProvenance[]): readonly EvidenceProvenanceV1[] {
  return values.map(value => {
    if (
      !ALLOWED_PROVENANCE_SOURCES.has(value.source)
      || !ALLOWED_PROVENANCE_ROLES.has(value.role)
      || (value.endpoint !== undefined && value.endpoint !== null && !ALLOWED_ENDPOINTS.has(value.endpoint))
      || (value.section !== undefined && value.section !== null && value.section !== 'TokyoNagoya')
    ) {
      throw new EvidenceManifestError('provenance_invalid', value.endpoint);
    }
    const candidate = {
      source: value.source,
      role: value.role,
      asOfDate: value.asOfDate,
      qualifiers: [
        ...(value.endpoint !== undefined
          ? [{ name: 'endpoint' as const, value: value.endpoint ?? null }]
          : []),
        ...(value.section !== undefined
          ? [{ name: 'section' as const, value: value.section ?? null }]
          : []),
      ],
    };
    const parsed = EvidenceProvenanceV1Schema.safeParse(candidate);
    if (!parsed.success) throw new EvidenceManifestError('provenance_invalid', parsed.error);
    return parsed.data;
  });
}

type StoredSection =
  | 'fundamental' | 'valuation' | 'peerComparison' | 'technical'
  | 'advancedTechnical' | 'supplyDemand' | 'marketCorrelation'
  | 'reportedShortPositions' | 'investorTypeFlows' | 'sectorBenchmark'
  | 'sectorShortRatio' | 'advancedDividend' | 'volumeProfile' | 'strategy'
  | 'priceHistory';

function sectionProvenance(
  snapshot: AnalysisSnapshot,
  key: StoredSection | 'identity',
): readonly EvidenceProvenanceV1[] {
  const record = snapshot.provenance as unknown as Readonly<Record<string, readonly RawProvenance[]>>;
  return projectProvenance(record[key] ?? []);
}

const SECTION_INTRODUCTION: Readonly<Record<StoredSection, number>> = {
  fundamental: 1,
  valuation: 1,
  peerComparison: 1,
  technical: 1,
  advancedTechnical: 2,
  supplyDemand: 1,
  marketCorrelation: 1,
  reportedShortPositions: 4,
  investorTypeFlows: 5,
  sectorBenchmark: 6,
  sectorShortRatio: 7,
  advancedDividend: 8,
  volumeProfile: 9,
  strategy: 1,
  priceHistory: 1,
};

function sectionObject(snapshot: AnalysisSnapshot, section: StoredSection): unknown | null {
  if (!(section in snapshot)) return null;
  return snapshot[section as keyof AnalysisSnapshot] ?? null;
}

function sectionScope(
  snapshot: AnalysisSnapshot,
  scopeId: EvidenceScopeIdV1,
  section: StoredSection,
): EvidenceScopeV1 {
  if (snapshot.schemaVersion < SECTION_INTRODUCTION[section]) {
    return {
      scopeId,
      claimDomain: EVIDENCE_SCOPE_DOMAIN_V1[scopeId],
      state: 'not_collected',
      coverage: 'partial',
      reason: 'schema_predates_scope',
    };
  }
  const object = sectionObject(snapshot, section);
  const notCollected = snapshot.unavailable.some(
    item => item.section === section && item.metric === undefined && item.reason === 'not_collected',
  );
  if (object !== null && notCollected) {
    throw new EvidenceManifestError('scope_state_invalid', { scopeId, section });
  }
  if (object !== null) {
    return {
      scopeId,
      claimDomain: EVIDENCE_SCOPE_DOMAIN_V1[scopeId],
      state: 'available',
      coverage: 'complete_for_domain',
      reason: null,
    };
  }
  return {
    scopeId,
    claimDomain: EVIDENCE_SCOPE_DOMAIN_V1[scopeId],
    state: notCollected ? 'not_collected' : 'unavailable',
    coverage: 'partial',
    reason: notCollected ? 'stored_not_collected' : 'snapshot_section_unavailable',
  };
}

function scopeFact(
  factKey: string,
  scope: EvidenceScopeV1,
  unit: string | null = null,
): EvidenceFactV1 {
  if (scope.state === 'not_collected') {
    return notCollectedFact(
      factKey,
      scope.reason === 'schema_predates_scope'
        ? SYNTHETIC_REASON.predatesScope
        : SYNTHETIC_REASON.notCollected,
    );
  }
  return unavailableFact(factKey, unit, [], SYNTHETIC_REASON.unavailable);
}

function buildScopes(snapshot: AnalysisSnapshot): readonly EvidenceScopeV1[] {
  const scopes = new Map<EvidenceScopeIdV1, EvidenceScopeV1>();
  scopes.set('snapshot_identity', {
    scopeId: 'snapshot_identity', claimDomain: 'snapshot_identity',
    state: 'available', coverage: 'complete_for_domain', reason: null,
  });
  const sectionMappings: readonly [EvidenceScopeIdV1, StoredSection][] = [
    ['valuation', 'valuation'], ['fundamental', 'fundamental'],
    ['peer_comparison', 'peerComparison'], ['technical', 'technical'],
    ['advanced_technical', 'advancedTechnical'], ['supply_demand', 'supplyDemand'],
    ['market_correlation', 'marketCorrelation'],
    ['reported_short_positions', 'reportedShortPositions'],
    ['investor_type_flows', 'investorTypeFlows'], ['sector_benchmark', 'sectorBenchmark'],
    ['sector_short_ratio', 'sectorShortRatio'], ['advanced_dividend', 'advancedDividend'],
    ['volume_profile_summary', 'volumeProfile'], ['strategy', 'strategy'],
  ];
  for (const [scopeId, section] of sectionMappings) {
    scopes.set(scopeId, sectionScope(snapshot, scopeId, section));
  }

  const price = sectionScope(snapshot, 'price_history_series', 'priceHistory');
  scopes.set('price_history_series', snapshot.priceHistory === null ? price : {
    scopeId: 'price_history_series', claimDomain: 'price_history_series',
    state: 'persisted_but_excluded', coverage: 'excluded_from_manifest',
    reason: 'raw_series_excluded',
  });

  if (snapshot.schemaVersion < 9) {
    scopes.set('volume_profile_bins', {
      scopeId: 'volume_profile_bins', claimDomain: 'volume_profile_bins',
      state: 'not_collected', coverage: 'partial', reason: 'schema_predates_scope',
    });
  } else if ('volumeProfile' in snapshot && snapshot.volumeProfile?.bins != null) {
    scopes.set('volume_profile_bins', {
      scopeId: 'volume_profile_bins', claimDomain: 'volume_profile_bins',
      state: 'persisted_but_excluded', coverage: 'excluded_from_manifest',
      reason: 'volume_profile_bins_excluded',
    });
  } else if ('volumeProfile' in snapshot && snapshot.volumeProfile !== null) {
    scopes.set('volume_profile_bins', {
      scopeId: 'volume_profile_bins', claimDomain: 'volume_profile_bins',
      state: 'unavailable', coverage: 'partial', reason: 'snapshot_section_unavailable',
    });
  } else {
    scopes.set(
      'volume_profile_bins',
      sectionScope(snapshot, 'volume_profile_bins', 'volumeProfile'),
    );
  }

  for (const scopeId of EVIDENCE_SCOPE_IDS.slice(17)) {
    scopes.set(scopeId, {
      scopeId,
      claimDomain: EVIDENCE_SCOPE_DOMAIN_V1[scopeId],
      state: 'outside_snapshot_scope',
      coverage: 'outside_snapshot_scope',
      reason: 'domain_not_persisted',
    });
  }
  return EVIDENCE_SCOPE_IDS.map(scopeId => {
    const scope = scopes.get(scopeId);
    if (scope === undefined) throw new EvidenceManifestError('definition_contract_invalid');
    return scope;
  });
}

function buildItem(
  scopeId: EvidenceScopeIdV1,
  definitionKey: string,
  instanceIdentity: ComparisonInstanceIdentityV1,
  facts: readonly EvidenceFactV1[],
  provenance: readonly EvidenceProvenanceV1[],
  method: string | null = null,
  limitation: string | null = null,
): EvidenceItemV1 {
  const definition = definitionByKey.get(definitionKey);
  if (
    definition === undefined
    || definition.scopeId !== scopeId
    || facts.length === 0
    || facts.length > 64
    || facts.some((fact, index) => definition.factKeys[index] !== fact.factKey)
    || facts.length !== definition.factKeys.length
  ) {
    throw new EvidenceManifestError('definition_contract_invalid', { scopeId, definitionKey });
  }
  return {
    itemId: createEvidenceItemIdV1(scopeId, definitionKey, instanceIdentity),
    scopeId,
    definitionKey,
    instanceIdentity: [...instanceIdentity],
    facts: [...facts],
    provenance: [...provenance],
    method,
    limitation,
  };
}

function unit(snapshot: AnalysisSnapshot, section: StoredSection, key: string): string | null {
  const allUnits = snapshot.units as unknown as Readonly<Record<string, Readonly<Record<string, string>>>>;
  const values = allUnits[section] ?? {};
  return values[key] ?? null;
}

function date(role: NamedDataDateV1['role'], value: string | null | undefined): NamedDataDateV1 {
  return { role, value: value ?? null };
}

function readDataDate(snapshot: AnalysisSnapshot, key: string): string | null {
  const dates = snapshot.dataDates as unknown as Readonly<Record<string, unknown>>;
  const value = dates[key];
  return typeof value === 'string' || value === null ? value : null;
}

function identityItems(snapshot: AnalysisSnapshot): readonly EvidenceItemV1[] {
  const valuationDates = snapshot.dataDates.valuation;
  const dataDateValues: readonly [string, string | null, number][] = [
    ['dataDate.identity', snapshot.dataDates.identity, 1],
    ['dataDate.fundamental', snapshot.dataDates.fundamental, 1],
    ['dataDate.valuation.price', valuationDates.price, 1],
    ['dataDate.valuation.financial', valuationDates.financial, 1],
    ['dataDate.peerComparison', snapshot.dataDates.peerComparison, 1],
    ['dataDate.technical', snapshot.dataDates.technical, 1],
    ['dataDate.advancedTechnical', readDataDate(snapshot, 'advancedTechnical'), 2],
    ['dataDate.supplyDemand', snapshot.dataDates.supplyDemand, 1],
    ['dataDate.marketCorrelation', snapshot.dataDates.marketCorrelation, 1],
    ['dataDate.reportedShortPositions', readDataDate(snapshot, 'reportedShortPositions'), 4],
    ['dataDate.investorTypeFlows', readDataDate(snapshot, 'investorTypeFlows'), 5],
    ['dataDate.sectorBenchmark', readDataDate(snapshot, 'sectorBenchmark'), 6],
    ['dataDate.sectorShortRatio', readDataDate(snapshot, 'sectorShortRatio'), 7],
    ['dataDate.advancedDividend', readDataDate(snapshot, 'advancedDividend'), 8],
    ['dataDate.volumeProfile', readDataDate(snapshot, 'volumeProfile'), 9],
    ['dataDate.strategy', snapshot.dataDates.strategy, 1],
    ['dataDate.priceHistory', snapshot.dataDates.priceHistory, 1],
  ];
  const facts: EvidenceFactV1[] = [
    availableFact('canonicalTicker', snapshot.canonicalTicker, null),
    availableFact('companyName', snapshot.companyName, null),
    availableFact('schemaVersion', snapshot.schemaVersion, null),
    availableFact('status', snapshot.status, null),
    availableFact('generatedAt', snapshot.generatedAt, null),
    ...dataDateValues.map(([factKey, value, introduced]) => (
      snapshot.schemaVersion < introduced
        ? notCollectedFact(factKey, SYNTHETIC_REASON.predatesInstance)
        : scalarFact(factKey, value, null)
    )),
  ];
  return [buildItem(
    'snapshot_identity',
    'snapshot.identity',
    [],
    facts,
    sectionProvenance(snapshot, 'identity'),
  )];
}

function observationFact(
  snapshot: AnalysisSnapshot,
  key: ComparisonMetricKeyV1,
  scope: EvidenceScopeV1,
): EvidenceItemV1 {
  const definition = comparisonMetricDefinitionV1(key);
  const instances = definition.resolveInstances(snapshot);
  if (instances.length !== 1) {
    throw new EvidenceManifestError('definition_contract_invalid', { key, instances: instances.length });
  }
  const observation: ComparisonObservationV1 = definition.extractObservation(snapshot, instances[0]);
  let fact: EvidenceFactV1;
  if (scope.state !== 'available') {
    fact = scopeFact('value', scope, definition.expectedUnit);
  } else if (observation.state === 'available') {
    fact = availableFact(
      'value', observation.value, observation.actualUnit, observation.dataDates,
    );
  } else if (observation.state === 'unavailable') {
    fact = unavailableFact(
      'value', observation.actualUnit, observation.dataDates, observation.unavailableReasons,
    );
  } else if (observation.state === 'not_collected') {
    fact = notCollectedFact('value', observation.unavailableReasons);
  } else {
    throw new EvidenceManifestError('definition_contract_invalid', { key, state: observation.state });
  }
  const provenance = observation.state === 'available' || observation.state === 'unavailable'
    ? projectProvenance(observation.provenance)
    : [];
  return buildItem(
    comparisonScope(key), key, observation.identity, [fact], provenance,
  );
}

function fixedComparisonItems(
  snapshot: AnalysisSnapshot,
  scopes: ReadonlyMap<EvidenceScopeIdV1, EvidenceScopeV1>,
): readonly EvidenceItemV1[] {
  return FIXED_COMPARISON_KEYS.map(key => {
    const scopeId = comparisonScope(key);
    const scope = scopes.get(scopeId);
    if (scope === undefined) throw new EvidenceManifestError('definition_contract_invalid');
    return observationFact(snapshot, key, scope);
  });
}

function fundamentalItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') return [];
  const section = snapshot.fundamental;
  if (section === null) throw new EvidenceManifestError('scope_state_invalid');
  if (section.periods.length > 6) {
    throw new EvidenceManifestError('collection_limit_exceeded', 'fundamental.periods');
  }
  const provenance = sectionProvenance(snapshot, 'fundamental');
  return section.periods.map(period => {
    const dataDates = [date('submit', period.submitDate)];
    const identity: ComparisonInstanceIdentityV1 = [{ name: 'fiscalYear', value: period.fiscalYear }];
    return buildItem(
      'fundamental',
      'fundamental.period',
      identity,
      FUNDAMENTAL_FACT_KEYS.map(factKey => scalarFact(
        factKey,
        period[factKey],
        unit(snapshot, 'fundamental', factKey),
        dataDates,
      )),
      provenance,
    );
  });
}

const PEER_METRICS = [
  'per', 'pbr', 'roe', 'roic', 'operatingMargin', 'revenueGrowth', 'dividendYield',
] as const;

function peerItems(snapshot: AnalysisSnapshot, scope: EvidenceScopeV1): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    const unavailableSelection = PEER_SELECTION_FACT_KEYS.map(key => scopeFact(key, scope));
    const unavailablePositions = PEER_METRICS.map(metric => buildItem(
      'peer_comparison',
      'peerComparison.position',
      [{ name: 'metric', value: metric }],
      PEER_POSITION_FACT_KEYS.map(key => {
        const factUnit = key === 'direction' ? null
          : ['targetValue', 'median'].includes(key) ? unit(snapshot, 'peerComparison', metric)
          : key === 'percentile' ? 'ratio' : 'count';
        return scopeFact(key, scope, factUnit);
      }),
      [],
    ));
    return [
      buildItem('peer_comparison', 'peerComparison.selection', [], unavailableSelection, []),
      ...unavailablePositions,
    ];
  }
  const section = snapshot.peerComparison;
  if (section === null) throw new EvidenceManifestError('scope_state_invalid');
  const result = section.result;
  const dataDates = [date('section', snapshot.dataDates.peerComparison)];
  const provenance = sectionProvenance(snapshot, 'peerComparison');
  const selectionFacts: readonly EvidenceFactV1[] = [
    availableFact('targetIncludedInStatistics', result.targetIncludedInStatistics, null, dataDates),
    availableFact('marketCapPriorityApplied', section.marketCapPriorityApplied, null, dataDates),
    scalarFact('marketCapPriorityUnavailableReason', section.marketCapPriorityUnavailableReason, null, dataDates),
    availableFact('sameSectorCandidateCount', result.selection.sameSectorCandidateCount, 'count', dataDates),
    availableFact('marketCapPrioritizedPeerCount', result.selection.marketCapPrioritizedPeerCount, 'count', dataDates),
    scalarFact('sectorLeaderId', result.selection.sectorLeaderId, null, dataDates),
    availableFact('sectorLeaderIncluded', result.selection.sectorLeaderIncluded, null, dataDates),
    availableFact('tooFewPeers', result.selection.tooFewPeers, null, dataDates),
    availableFact('peerCount', result.selection.peers.length, 'count', dataDates),
  ];
  const items: EvidenceItemV1[] = [
    buildItem('peer_comparison', 'peerComparison.selection', [], selectionFacts, provenance),
  ];
  for (const metric of PEER_METRICS) {
    const position = result.positions[metric];
    if (position.metric !== metric) {
      throw new EvidenceManifestError('definition_contract_invalid', { metric, stored: position.metric });
    }
    const metricReasons = result.unavailable
      .filter(value => value.metric === metric)
      .map(value => ({ reason: value.reason, detail: null }));
    const metricUnit = unit(snapshot, 'peerComparison', metric);
    const facts: readonly EvidenceFactV1[] = [
      availableFact('direction', position.direction, null, dataDates),
      scalarFact('targetValue', position.targetValue, metricUnit, dataDates, reasons(metricReasons)),
      scalarFact('median', position.median, metricUnit, dataDates, reasons(metricReasons)),
      scalarFact('rank', position.rank, unit(snapshot, 'peerComparison', 'rank'), dataDates, reasons(metricReasons)),
      scalarFact('percentile', position.percentile, unit(snapshot, 'peerComparison', 'percentile'), dataDates, reasons(metricReasons)),
      availableFact('peerSampleSize', position.peerSampleSize, 'count', dataDates),
      availableFact('cohortSize', position.cohortSize, 'count', dataDates),
    ];
    items.push(buildItem(
      'peer_comparison', 'peerComparison.position', [{ name: 'metric', value: metric }],
      facts, provenance,
    ));
  }
  return items;
}

const CORRELATION_PERIODS = [20, 60, 250] as const;

function correlationFacts(
  window: Readonly<{
    observations: number;
    correlation: number | null;
    beta: number | null;
    alphaAnnualized: number | null;
    rSquared: number | null;
    stockVolatilityAnnualized: number | null;
    benchmarkVolatilityAnnualized: number | null;
    excessReturn: number | null;
    unavailable: readonly Readonly<{ metric: string; reason: string }>[];
    startDate: string | null;
    endDate: string | null;
  }>,
  units: Readonly<Record<string, string>>,
): readonly EvidenceFactV1[] {
  const dates = [date('window_start', window.startDate), date('window_end', window.endDate)];
  return CORRELATION_FACT_KEYS.map(factKey => {
    const value = window[factKey];
    if (factKey === 'observations') return availableFact(factKey, value as number, units[factKey] ?? 'count', dates);
    const matching = window.unavailable
      .filter(reason => reason.metric === factKey)
      .map(reason => ({ reason: reason.reason, detail: null }));
    return scalarFact(factKey, value as number | null, units[factKey] ?? null, dates, reasons(matching));
  });
}

function marketCorrelationItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  const section = scope.state === 'available' ? snapshot.marketCorrelation : null;
  if (scope.state === 'available' && section === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const provenance = section === null ? [] : sectionProvenance(snapshot, 'marketCorrelation');
  return CORRELATION_PERIODS.map(period => {
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'benchmark', value: 'TOPIX' },
      { name: 'period', value: period },
    ];
    if (scope.state !== 'available') {
      return buildItem(
        'market_correlation', 'marketCorrelation.window', identity,
        CORRELATION_FACT_KEYS.map(key => scopeFact(key, scope)), [], 'market_correlation_engine',
        'Persisted TOPIX window only; no source-totality claim.',
      );
    }
    if (snapshot.schemaVersion < 3 && period === 20) {
      return buildItem(
        'market_correlation', 'marketCorrelation.window', identity,
        CORRELATION_FACT_KEYS.map(key => notCollectedFact(key, SYNTHETIC_REASON.predatesInstance)),
        provenance, 'market_correlation_engine',
        'Persisted TOPIX window only; no source-totality claim.',
      );
    }
    const matches = section?.windows.filter(window => window.period === period) ?? [];
    if (matches.length > 1) throw new EvidenceManifestError('definition_contract_invalid', identity);
    const facts = matches.length === 0
      ? CORRELATION_FACT_KEYS.map(key => unavailableFact(key, unit(snapshot, 'marketCorrelation', key)))
      : correlationFacts(matches[0], snapshot.units.marketCorrelation);
    return buildItem(
      'market_correlation', 'marketCorrelation.window', identity, facts, provenance,
      'market_correlation_engine', 'Persisted TOPIX window only; no source-totality claim.',
    );
  });
}

function reportedShortItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') return [];
  if (!('reportedShortPositions' in snapshot) || snapshot.reportedShortPositions === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const reports = snapshot.reportedShortPositions.reports;
  if (reports.length > 100) {
    throw new EvidenceManifestError('collection_limit_exceeded', 'reportedShortPositions.reports');
  }
  const provenance = sectionProvenance(snapshot, 'reportedShortPositions');
  return reports.map(report => {
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'disclosedDate', value: report.disclosedDate },
      { name: 'calculatedDate', value: report.calculatedDate },
      { name: 'reporterName', value: report.reporterName },
      { name: 'discretionaryManagerName', value: report.discretionaryManagerName },
      { name: 'fundName', value: report.fundName },
    ];
    const dates = [
      date('disclosed', report.disclosedDate),
      date('section', report.calculatedDate),
    ];
    const facts: readonly EvidenceFactV1[] = [
      availableFact('shortPositionRatio', report.shortPositionRatio, unit(snapshot, 'reportedShortPositions', 'shortPositionRatio'), dates),
      availableFact('shortPositionShares', report.shortPositionShares, unit(snapshot, 'reportedShortPositions', 'shortPositionShares'), dates),
      scalarFact('previousCalculatedDate', report.previousCalculatedDate, null, dates),
      scalarFact('previousReportedRatio', report.previousReportedRatio, unit(snapshot, 'reportedShortPositions', 'previousReportedRatio'), dates),
      scalarFact('ratioDelta', report.ratioDelta, unit(snapshot, 'reportedShortPositions', 'ratioDelta'), dates),
    ];
    return buildItem(
      'reported_short_positions', 'reportedShortPositions.row', identity, facts, provenance,
      null, 'Persisted rows only; no completeness claim about public disclosures.',
    );
  });
}

type InvestorValues = Readonly<{ sell: number; buy: number; total: number; balance: number }>;
type InvestorPeriod = NonNullable<NonNullable<
  Extract<AnalysisSnapshot, { schemaVersion: 5 | 6 | 7 | 8 | 9 }>['investorTypeFlows']
>['period']>;

function investorGroup(
  period: InvestorPeriod,
  group: (typeof INVESTOR_GROUPS)[number],
): InvestorValues {
  if (group.startsWith('summary.')) {
    const key = group.slice('summary.'.length) as keyof typeof period.summary;
    return period.summary[key];
  }
  const key = group.slice('brokerageBreakdown.'.length) as keyof typeof period.brokerageBreakdown;
  return period.brokerageBreakdown[key];
}

function investorItems(snapshot: AnalysisSnapshot, scope: EvidenceScopeV1): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') return [];
  if (!('investorTypeFlows' in snapshot) || snapshot.investorTypeFlows === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const section = snapshot.investorTypeFlows;
  const provenance = sectionProvenance(snapshot, 'investorTypeFlows');
  const sectionDates = [date('section', section.dataDate)];
  if (section.period === null) {
    const periodReasons = reasons(section.unavailable);
    return [buildItem(
      'investor_type_flows', 'investorTypeFlows.period', [],
      [
        unavailableFact('period', null, sectionDates, periodReasons),
        ...INVESTOR_FACT_KEYS.slice(1).map(key => unavailableFact(
          key, unit(snapshot, 'investorTypeFlows', key.split('.').at(-1) ?? key),
          sectionDates, periodReasons,
        )),
      ],
      provenance, null, 'Tokyo/Nagoya persisted period only.',
    )];
  }
  const period = section.period;
  const identity: ComparisonInstanceIdentityV1 = [
    { name: 'section', value: period.section },
    { name: 'publishedDate', value: period.publishedDate },
    { name: 'periodStartDate', value: period.periodStartDate },
    { name: 'periodEndDate', value: period.periodEndDate },
  ];
  const dates = [
    date('section', period.publishedDate),
    date('window_start', period.periodStartDate),
    date('window_end', period.periodEndDate),
  ];
  const facts: EvidenceFactV1[] = [availableFact('period', period.section, null, dates)];
  for (const group of INVESTOR_GROUPS) {
    const values = investorGroup(period, group);
    for (const key of ['sell', 'buy', 'total', 'balance'] as const) {
      facts.push(availableFact(
        `${group}.${key}`, values[key], unit(snapshot, 'investorTypeFlows', key), dates,
      ));
    }
  }
  return [buildItem(
    'investor_type_flows', 'investorTypeFlows.period', identity, facts, provenance,
    null, 'Tokyo/Nagoya persisted period only; no other exchange or period coverage.',
  )];
}

function directProvenance(
  values: readonly Readonly<{
    source: string;
    role: string;
    asOfDate: string | null;
    endpoint?: string | null;
  }>[],
): readonly EvidenceProvenanceV1[] {
  return projectProvenance(values);
}

function sectorBenchmarkItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    const identity = buildItem(
      'sector_benchmark', 'sectorBenchmark.identity', [],
      SECTOR_BENCHMARK_IDENTITY_FACT_KEYS.map(key => scopeFact(key, scope)), [],
      'market_correlation_engine', 'Persisted benchmark identity and windows only.',
    );
    const windows = CORRELATION_PERIODS.map(period => buildItem(
      'sector_benchmark', 'sectorBenchmark.window', [
        { name: 'benchmark.type', value: null },
        { name: 'benchmark.sectorCode', value: null },
        { name: 'benchmark.indexCode', value: null },
        { name: 'period', value: period },
      ],
      CORRELATION_FACT_KEYS.map(key => scopeFact(key, scope)), [], 'market_correlation_engine',
      'Persisted sector benchmark window only.',
    ));
    return [identity, ...windows];
  }
  if (!('sectorBenchmark' in snapshot) || snapshot.sectorBenchmark === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const section = snapshot.sectorBenchmark;
  const unavailableReasons = reasons(section.unavailable);
  const dates = [date('analysis_as_of', section.analysisAsOfDate), date('section', section.dataDate)];
  const provenance = directProvenance([
    { source: section.provenance.classification.source, role: 'sector_classification_data', asOfDate: section.benchmark?.classificationDate ?? null, endpoint: section.provenance.classification.endpoint },
    { source: section.provenance.index.source, role: 'benchmark_data', asOfDate: section.dataDate, endpoint: section.provenance.index.endpoint },
    { source: section.provenance.calculation.source, role: 'calculation', asOfDate: section.dataDate },
  ]);
  const benchmark = section.benchmark;
  const identityFacts: readonly EvidenceFactV1[] = [
    availableFact('analysisAsOfDate', section.analysisAsOfDate, null, dates),
    scalarFact('benchmark.type', benchmark?.type, null, dates, unavailableReasons),
    scalarFact('benchmark.sectorCode', benchmark?.sectorCode, null, dates, unavailableReasons),
    scalarFact('benchmark.sectorName', benchmark?.sectorName, null, dates, unavailableReasons),
    scalarFact('benchmark.indexCode', benchmark?.indexCode, null, dates, unavailableReasons),
    scalarFact('benchmark.classificationDate', benchmark?.classificationDate, null, dates, unavailableReasons),
    scalarFact('dataDate', section.dataDate, null, dates, unavailableReasons),
    availableFact('alignedPriceCount', section.alignedPriceCount, 'count', dates),
  ];
  const items: EvidenceItemV1[] = [buildItem(
    'sector_benchmark', 'sectorBenchmark.identity', [], identityFacts, provenance,
    'market_correlation_engine', 'Persisted benchmark identity and windows only.',
  )];
  for (const period of CORRELATION_PERIODS) {
    const matches = section.windows.filter(window => window.period === period);
    if (matches.length > 1) throw new EvidenceManifestError('definition_contract_invalid', period);
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'benchmark.type', value: benchmark?.type ?? null },
      { name: 'benchmark.sectorCode', value: benchmark?.sectorCode ?? null },
      { name: 'benchmark.indexCode', value: benchmark?.indexCode ?? null },
      { name: 'period', value: period },
    ];
    const facts = matches.length === 0
      ? CORRELATION_FACT_KEYS.map(key => unavailableFact(
        key, section.units[key as keyof typeof section.units] ?? null, dates, unavailableReasons,
      ))
      : correlationFacts(matches[0], section.units);
    items.push(buildItem(
      'sector_benchmark', 'sectorBenchmark.window', identity, facts, provenance,
      'market_correlation_engine', 'Persisted sector benchmark window only.',
    ));
  }
  return items;
}

function sectorShortItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    return [buildItem(
      'sector_short_ratio', 'sectorShortRatio.identity', [],
      SECTOR_SHORT_IDENTITY_FACT_KEYS.map(key => scopeFact(key, scope)), [],
      'sector_short_ratio_engine', 'Persisted observations only; no source-totality claim.',
    )];
  }
  if (!('sectorShortRatio' in snapshot) || snapshot.sectorShortRatio === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const section = snapshot.sectorShortRatio;
  if (section.observations.length > 100) {
    throw new EvidenceManifestError('collection_limit_exceeded', 'sectorShortRatio.observations');
  }
  const sectionReasons = reasons(section.unavailable);
  const sectionDates = [date('analysis_as_of', section.analysisAsOfDate), date('section', section.dataDate)];
  const provenance = directProvenance([
    ...(section.provenance.classification === null ? [] : [{
      source: section.provenance.classification.source,
      role: 'sector_classification_data',
      asOfDate: section.sector?.classificationDate ?? null,
      endpoint: section.provenance.classification.endpoint,
    }]),
    ...(section.provenance.flow === null ? [] : [{
      source: section.provenance.flow.source,
      role: 'sector_short_ratio_data',
      asOfDate: section.dataDate,
      endpoint: section.provenance.flow.endpoint,
    }]),
    { source: section.provenance.calculation.source, role: 'calculation', asOfDate: section.dataDate },
  ]);
  const identityFacts: readonly EvidenceFactV1[] = [
    availableFact('analysisAsOfDate', section.analysisAsOfDate, null, sectionDates),
    availableFact('issuerCode', section.issuerCode, null, sectionDates),
    scalarFact('sector.classificationDate', section.sector?.classificationDate, null, sectionDates, sectionReasons),
    scalarFact('sector.sectorCode', section.sector?.sectorCode, null, sectionDates, sectionReasons),
    scalarFact('sector.sectorName', section.sector?.sectorName, null, sectionDates, sectionReasons),
    scalarFact('dataDate', section.dataDate, null, sectionDates, sectionReasons),
    availableFact('observationCount', section.observations.length, 'count', sectionDates),
  ];
  const items: EvidenceItemV1[] = [buildItem(
    'sector_short_ratio', 'sectorShortRatio.identity', [], identityFacts, provenance,
    'sector_short_ratio_engine', 'Persisted observations only; no source-totality claim.',
  )];
  for (const observation of section.observations) {
    const observationReasons = reasons(observation.unavailable);
    const dates = [date('section', observation.date)];
    const facts = SECTOR_SHORT_OBSERVATION_FACT_KEYS.map(factKey => scalarFact(
      factKey,
      observation[factKey],
      section.units[factKey],
      dates,
      observationReasons,
    ));
    items.push(buildItem(
      'sector_short_ratio', 'sectorShortRatio.observation', [{ name: 'date', value: observation.date }],
      facts, provenance, 'sector_short_ratio_engine', 'Persisted sector observation only.',
    ));
  }
  return items;
}

function advancedDividendItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    return [buildItem(
      'advanced_dividend', 'advancedDividend.identity', [],
      DIVIDEND_IDENTITY_FACT_KEYS.map(key => scopeFact(key, scope)), [],
      'advanced_dividend_engine',
    )];
  }
  if (!('advancedDividend' in snapshot) || snapshot.advancedDividend === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const section = snapshot.advancedDividend;
  if (section.observations.length > 20 || (section.events?.length ?? 0) > 50) {
    throw new EvidenceManifestError('collection_limit_exceeded', 'advancedDividend');
  }
  const provenance = directProvenance([
    { source: section.provenance.financialSummary.source, role: 'dividend_financial_summary_data', asOfDate: section.dataDate, endpoint: section.provenance.financialSummary.endpoint },
    ...(section.provenance.dividendEvents === null ? [] : [{
      source: section.provenance.dividendEvents.source,
      role: 'dividend_event_data',
      asOfDate: section.dataDate,
      endpoint: section.provenance.dividendEvents.endpoint,
    }]),
    { source: section.provenance.availabilityCalendar.source, role: 'market_calendar_data', asOfDate: section.analysisAsOfDate, endpoint: section.provenance.availabilityCalendar.endpoint },
    { source: section.provenance.calculation.source, role: 'calculation', asOfDate: section.dataDate },
  ]);
  const dates = [date('analysis_as_of', section.analysisAsOfDate), date('section', section.dataDate)];
  const eventReasons = reasons(section.unavailable.filter(value => value.scope === 'event'));
  const identityFacts: readonly EvidenceFactV1[] = [
    availableFact('analysisAsOfDate', section.analysisAsOfDate, null, dates),
    availableFact('collectedAt', section.collectedAt, null, dates),
    availableFact('issuerCode', section.issuerCode, null, dates),
    scalarFact('dataDate', section.dataDate, null, dates),
    availableFact('fiscalObservationCount', section.observations.length, 'count', dates),
    section.events === null
      ? unavailableFact('eventCollectionAvailable', null, dates, eventReasons)
      : availableFact('eventCollectionAvailable', true, null, dates),
    section.events === null
      ? unavailableFact('eventCount', 'count', dates, eventReasons)
      : availableFact('eventCount', section.events.length, 'count', dates),
  ];
  const items: EvidenceItemV1[] = [buildItem(
    'advanced_dividend', 'advancedDividend.identity', [], identityFacts, provenance,
    'advanced_dividend_engine',
  )];

  const coreReasons = reasons(section.unavailable.filter(value => value.scope === 'core'));
  for (const observation of section.observations) {
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'kind', value: observation.kind },
      { name: 'fiscalYearEndDate', value: observation.fiscalYearEndDate },
      { name: 'disclosureNumber', value: observation.disclosureNumber },
      { name: 'sourceField', value: observation.sourceField },
      { name: 'payoutRatioSourceField', value: observation.payoutRatioSourceField },
    ];
    const itemDates = [
      date('source_eligible', observation.sourceEligibleDate),
      date('disclosed', observation.disclosedDate),
    ];
    const facts: readonly EvidenceFactV1[] = [
      scalarFact('annualDividendPerShare', observation.annualDividendPerShare, section.units.dividendPerShare, itemDates, coreReasons),
      scalarFact('payoutRatio', observation.payoutRatio, section.units.payoutRatio, itemDates, coreReasons),
      scalarFact('disclosedTime', observation.disclosedTime, null, itemDates),
    ];
    items.push(buildItem(
      'advanced_dividend', 'advancedDividend.fiscal', identity, facts, provenance,
      'advanced_dividend_engine',
    ));
  }

  const componentReasons = reasons(section.unavailable.filter(value => value.scope === 'component'));
  for (const event of section.events ?? []) {
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'corporateActionReferenceNumber', value: event.corporateActionReferenceNumber },
      { name: 'kind', value: event.kind },
      { name: 'recordDateYearMonth', value: event.recordDateYearMonth },
      { name: 'decision', value: event.decision },
    ];
    const itemDates = [
      date('source_eligible', event.sourceEligibleDate), date('notified', event.notifiedDate),
      date('record', event.recordDate), date('rights_record', event.rightsRecordDate),
      date('ex', event.exDate), date('payment', event.paymentDate),
    ];
    const facts: readonly EvidenceFactV1[] = [
      availableFact('referenceNumber', event.referenceNumber, null, itemDates),
      scalarFact('notifiedTime', event.notifiedTime, null, itemDates),
      scalarFact('dividendPerShare', event.dividendPerShare, section.units.dividendPerShare, itemDates, eventReasons),
      scalarFact('ordinaryDividendPerShare', event.ordinaryDividendPerShare, section.units.dividendPerShare, itemDates, componentReasons),
      scalarFact('commemorativeDividendPerShare', event.commemorativeDividendPerShare, section.units.dividendPerShare, itemDates, componentReasons),
      scalarFact('specialDividendPerShare', event.specialDividendPerShare, section.units.dividendPerShare, itemDates, componentReasons),
    ];
    items.push(buildItem(
      'advanced_dividend', 'advancedDividend.event', identity, facts, provenance,
      'advanced_dividend_engine',
    ));
  }
  return items;
}

function volumeProfileItems(
  snapshot: AnalysisSnapshot,
  scope: EvidenceScopeV1,
): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    return [buildItem(
      'volume_profile_summary', 'volumeProfile.summary', [],
      VOLUME_PROFILE_FACT_KEYS.map(key => scopeFact(key, scope)), [],
      'daily_ohlcv_volume_profile_proxy_v1', 'Summary only; bins are intentionally excluded.',
    )];
  }
  if (!('volumeProfile' in snapshot) || snapshot.volumeProfile === null) {
    throw new EvidenceManifestError('scope_state_invalid');
  }
  const section = snapshot.volumeProfile;
  const unavailableReasons = reasons(section.unavailable);
  const dates = [
    date('analysis_as_of', section.analysisAsOfDate), date('section', section.dataDate),
    date('window_start', section.windowStartDate), date('window_end', section.windowEndDate),
  ];
  const provenance = directProvenance([
    { source: section.provenance.source, role: 'price_data', asOfDate: section.dataDate, endpoint: section.provenance.endpoint },
    { source: section.provenance.source, role: 'market_calendar_data', asOfDate: section.analysisAsOfDate, endpoint: section.provenance.availabilityCalendarEndpoint },
    { source: section.provenance.calculation, role: 'calculation', asOfDate: section.dataDate },
  ]);
  const profileUnit = section.units.price;
  const allocatedVolumeUnit = section.units.allocatedVolume;
  const ratioUnit = section.units.volumeShare;
  const values: Readonly<Record<(typeof VOLUME_PROFILE_FACT_KEYS)[number], {
    value: number | string | boolean | null;
    unit: string | null;
  }>> = {
    analysisAsOfDate: { value: section.analysisAsOfDate, unit: null },
    collectedAt: { value: section.collectedAt, unit: null },
    issuerCode: { value: section.issuerCode, unit: null },
    dataDate: { value: section.dataDate, unit: null },
    windowStartDate: { value: section.windowStartDate, unit: null },
    windowEndDate: { value: section.windowEndDate, unit: null },
    inputBarCount: { value: section.inputBarCount, unit: 'count' },
    priceBasis: { value: section.priceBasis, unit: null },
    volumeBasis: { value: section.volumeBasis, unit: null },
    allocationMethod: { value: section.allocationMethod, unit: null },
    'binningMethod.id': { value: section.binningMethod.id, unit: null },
    'binningMethod.requestedBinCount': { value: section.binningMethod.requestedBinCount, unit: 'count' },
    'binningMethod.effectiveBinCount': { value: section.binningMethod.effectiveBinCount, unit: 'count' },
    'binningMethod.minPrice': { value: section.binningMethod.minPrice, unit: profileUnit },
    'binningMethod.maxPrice': { value: section.binningMethod.maxPrice, unit: profileUnit },
    'poc.binIndex': { value: section.poc?.binIndex ?? null, unit: 'count' },
    'poc.price': { value: section.poc?.price ?? null, unit: profileUnit },
    'poc.allocatedVolume': { value: section.poc?.allocatedVolume ?? null, unit: allocatedVolumeUnit },
    'poc.volumeShare': { value: section.poc?.volumeShare ?? null, unit: ratioUnit },
    'valueArea.targetVolumeShare': { value: section.valueArea?.targetVolumeShare ?? null, unit: ratioUnit },
    'valueArea.achievedVolumeShare': { value: section.valueArea?.achievedVolumeShare ?? null, unit: ratioUnit },
    'valueArea.val': { value: section.valueArea?.val ?? null, unit: profileUnit },
    'valueArea.vah': { value: section.valueArea?.vah ?? null, unit: profileUnit },
    'valueArea.firstBinIndex': { value: section.valueArea?.firstBinIndex ?? null, unit: 'count' },
    'valueArea.lastBinIndex': { value: section.valueArea?.lastBinIndex ?? null, unit: 'count' },
    'methodology.id': { value: section.methodology.id, unit: null },
    'methodology.approximation': { value: section.methodology.approximation, unit: null },
    'methodology.actualHolderCostBasis': { value: section.methodology.actualHolderCostBasis, unit: null },
  };
  const facts = VOLUME_PROFILE_FACT_KEYS.map(factKey => scalarFact(
    factKey, values[factKey].value, values[factKey].unit, dates, unavailableReasons,
  ));
  return [buildItem(
    'volume_profile_summary', 'volumeProfile.summary', [], facts, provenance,
    section.methodology.id, 'Summary only; bins are intentionally excluded.',
  )];
}

function strategyItems(snapshot: AnalysisSnapshot, scope: EvidenceScopeV1): readonly EvidenceItemV1[] {
  if (scope.state !== 'available') {
    return [buildItem(
      'strategy', 'strategy.entry', [],
      STRATEGY_ENTRY_FACT_KEYS.map(key => scopeFact(key, scope)), [], 'strategy_engine',
    )];
  }
  const section = snapshot.strategy;
  if (section === null) throw new EvidenceManifestError('scope_state_invalid');
  if (section.candidates.length > 16) {
    throw new EvidenceManifestError('collection_limit_exceeded', 'strategy.candidates');
  }
  const provenance = sectionProvenance(snapshot, 'strategy');
  const dates = [date('section', section.dataDate)];
  const entryReasons = reasons(section.unavailable.filter(value => value.candidate === 'entry'));
  const entry = section.entry;
  const entryFacts: readonly EvidenceFactV1[] = [
    scalarFact('dataDate', section.dataDate, null, dates),
    scalarFact('entry.triggerPrice', entry?.triggerPrice, unit(snapshot, 'strategy', 'triggerPrice'), dates, entryReasons),
    scalarFact('entry.price', entry?.price, unit(snapshot, 'strategy', 'price'), dates, entryReasons),
    scalarFact('entry.reason', entry?.reason, null, dates, entryReasons),
    scalarFact('entry.trigger', entry?.trigger, null, dates, entryReasons),
    scalarFact('entry.tickSizeApplied', entry?.tickSizeApplied, unit(snapshot, 'strategy', 'tickSizeApplied'), dates, entryReasons),
    availableFact('candidateCount', section.candidates.length, 'count', dates),
  ];
  const items: EvidenceItemV1[] = [buildItem(
    'strategy', 'strategy.entry', [], entryFacts, provenance, 'strategy_engine',
  )];
  for (const candidate of section.candidates) {
    const identity: ComparisonInstanceIdentityV1 = [
      { name: 'entry.price', value: candidate.entry.price },
      { name: 'stop.price', value: candidate.stop.price },
      { name: 'stop.reason', value: candidate.stop.reason },
      { name: 'target.price', value: candidate.target.price },
      { name: 'target.reason', value: candidate.target.reason },
    ];
    const facts: readonly EvidenceFactV1[] = [
      availableFact('entry.triggerPrice', candidate.entry.triggerPrice, unit(snapshot, 'strategy', 'triggerPrice'), dates),
      availableFact('entry.price', candidate.entry.price, unit(snapshot, 'strategy', 'price'), dates),
      availableFact('entry.reason', candidate.entry.reason, null, dates),
      availableFact('entry.trigger', candidate.entry.trigger, null, dates),
      availableFact('entry.tickSizeApplied', candidate.entry.tickSizeApplied, unit(snapshot, 'strategy', 'tickSizeApplied'), dates),
      availableFact('stop.price', candidate.stop.price, unit(snapshot, 'strategy', 'price'), dates),
      availableFact('stop.reason', candidate.stop.reason, null, dates),
      availableFact('target.price', candidate.target.price, unit(snapshot, 'strategy', 'price'), dates),
      availableFact('target.reason', candidate.target.reason, null, dates),
      availableFact('risk', candidate.risk, unit(snapshot, 'strategy', 'risk'), dates),
      availableFact('reward', candidate.reward, unit(snapshot, 'strategy', 'reward'), dates),
      availableFact('rewardRisk', candidate.rewardRisk, unit(snapshot, 'strategy', 'rewardRisk'), dates),
    ];
    items.push(buildItem(
      'strategy', 'strategy.candidate', identity, facts, provenance, 'strategy_engine',
    ));
  }
  return items;
}

const COMMON_NONAVAILABLE_REASONS = new Set([
  'missing_metric_value', 'snapshot_section_unavailable', 'schema_predates_scope',
  'stored_not_collected',
]);

function allowedReasonsForDefinition(definitionKey: string): ReadonlySet<string> {
  const values = new Set(COMMON_NONAVAILABLE_REASONS);
  const add = (...reasonsToAdd: readonly string[]) => {
    for (const reason of reasonsToAdd) values.add(reason);
  };
  if (definitionKey.startsWith('valuation.')) add(
    'missing_or_invalid_price', 'insufficient_financial_history',
    'missing_or_invalid_eps', 'non_positive_eps', 'missing_or_invalid_bps',
    'non_positive_bps', 'missing_or_invalid_dividend', 'missing_or_invalid_revenue',
    'non_positive_revenue', 'invalid_fiscal_year_range',
  );
  else if (definitionKey === 'snapshot.identity') add('schema_predates_instance');
  else if (definitionKey.startsWith('technical.')) add('engine_reported_unavailable');
  else if (definitionKey.startsWith('advancedTechnical.')) add(
    'insufficient_history', 'missing_data', 'invalid_data',
  );
  else if (definitionKey.startsWith('supplyDemand.')) add(
    'missing_data', 'insufficient_history', 'zero_selling_balance',
    'zero_mean_52w', 'zero_average_daily_volume', 'schema_predates_instance',
  );
  else if (definitionKey === 'peerComparison.position') add(
    'missing_target_metric', 'insufficient_peer_data',
  );
  else if (definitionKey === 'marketCorrelation.window') add(
    'insufficient_history', 'zero_stock_variance', 'zero_benchmark_variance',
    'schema_predates_instance',
  );
  else if (definitionKey === 'investorTypeFlows.period') add(
    'no_investor_type_flow_data', 'invalid_data',
  );
  else if (definitionKey.startsWith('sectorBenchmark.')) add(
    'sector_classification_unavailable', 'unsupported_sector', 'no_sector_index_data',
    'invalid_data', 'insufficient_history', 'zero_stock_variance',
    'zero_benchmark_variance',
  );
  else if (definitionKey === 'sectorShortRatio.identity') add(
    'sector_classification_unavailable', 'unsupported_sector',
    'no_sector_short_ratio_data', 'invalid_data',
  );
  else if (definitionKey === 'sectorShortRatio.observation') add(
    'missing_data', 'invalid_data', 'zero_total_selling_value',
  );
  else if (definitionKey.startsWith('advancedDividend.')) add(
    'no_eligible_dividend_disclosure_data', 'no_eligible_dividend_event_data',
    'event_source_plan_unavailable', 'availability_calendar_unavailable',
    'missing_data', 'invalid_data', 'component_breakdown_unavailable',
  );
  else if (definitionKey === 'volumeProfile.summary') add(
    'insufficient_history', 'missing_price_data', 'missing_volume_data',
    'invalid_price_data', 'invalid_volume_data', 'invalid_bar_geometry',
    'invalid_chronology', 'zero_total_volume', 'no_price_data',
    'corporate_action_basis_unavailable', 'invalid_input',
  );
  else if (definitionKey.startsWith('strategy.')) add(
    'missing_or_invalid_swing_high', 'missing_tick_size_for_executable_entry',
    'missing_entry', 'missing_or_invalid_swing_low', 'missing_or_invalid_atr',
    'non_positive_stop', 'stop_not_below_entry', 'zero_risk',
    'missing_or_invalid_resistance', 'target_not_above_entry',
  );
  return values;
}

function allowedEndpointsForDefinition(definitionKey: string): ReadonlySet<string> {
  if (definitionKey === 'investorTypeFlows.period') {
    return new Set(['/v2/equities/investor-types', '/v2/markets/calendar']);
  }
  if (definitionKey.startsWith('sectorBenchmark.')) {
    return new Set(['/v2/equities/master', '/v2/indices/bars/daily']);
  }
  if (definitionKey.startsWith('sectorShortRatio.')) {
    return new Set(['/v2/equities/master', '/v2/markets/short-ratio']);
  }
  if (definitionKey.startsWith('advancedDividend.')) {
    return new Set(['/v2/fins/summary', '/v2/fins/dividend', '/v2/markets/calendar']);
  }
  if (definitionKey === 'volumeProfile.summary') {
    return new Set(['/v2/equities/bars/daily', '/v2/markets/calendar']);
  }
  return new Set();
}

function allowedProvenancePairsForDefinition(definitionKey: string): ReadonlySet<string> {
  if (definitionKey === 'snapshot.identity') return new Set(['edinet_db/identity']);
  if (definitionKey.startsWith('valuation.')) return new Set([
    'financial_metrics_engine/calculation', 'jquants/price_data', 'edinet_db/financial_data',
  ]);
  if (definitionKey === 'fundamental.period') return new Set(['edinet_db/financial_data']);
  if (definitionKey.startsWith('peerComparison.')) return new Set([
    'peer_comparison_engine/calculation', 'edinet_db/financial_data',
  ]);
  if (definitionKey.startsWith('technical.') || definitionKey.startsWith('advancedTechnical.')) {
    return new Set(['technical_engine/calculation', 'jquants/price_data']);
  }
  if (definitionKey.startsWith('supplyDemand.')) return new Set([
    'supply_demand_engine/calculation', 'jquants/margin_data', 'jquants/price_data',
  ]);
  if (definitionKey === 'marketCorrelation.window') return new Set([
    'market_correlation_engine/calculation', 'jquants/price_data', 'jquants/benchmark_data',
  ]);
  if (definitionKey === 'reportedShortPositions.row') return new Set([
    'reported_short_position_engine/calculation', 'jquants/short_position_data',
  ]);
  if (definitionKey === 'investorTypeFlows.period') return new Set([
    'investor_type_flow_engine/calculation', 'jquants/investor_type_flow_data',
    'jquants/market_calendar_data',
  ]);
  if (definitionKey.startsWith('sectorBenchmark.')) return new Set([
    'jquants/sector_classification_data', 'jquants/benchmark_data',
    'market_correlation_engine/calculation',
  ]);
  if (definitionKey.startsWith('sectorShortRatio.')) return new Set([
    'jquants/sector_classification_data', 'jquants/sector_short_ratio_data',
    'sector_short_ratio_engine/calculation',
  ]);
  if (definitionKey.startsWith('advancedDividend.')) return new Set([
    'jquants/dividend_financial_summary_data', 'jquants/dividend_event_data',
    'jquants/market_calendar_data', 'advanced_dividend_engine/calculation',
  ]);
  if (definitionKey === 'volumeProfile.summary') return new Set([
    'jquants/price_data', 'jquants/market_calendar_data', 'volume_profile_engine/calculation',
  ]);
  if (definitionKey.startsWith('strategy.')) return new Set(['strategy_engine/calculation']);
  return new Set();
}

function identityNames(identity: ComparisonInstanceIdentityV1): readonly string[] {
  return identity.map(value => value.name);
}

function sameIdentityNames(identity: ComparisonInstanceIdentityV1, expected: readonly string[]): boolean {
  const names = identityNames(identity);
  return names.length === expected.length && names.every((name, index) => name === expected[index]);
}

function assertIdentityContract(item: EvidenceItemV1): void {
  const identity = item.instanceIdentity;
  if (new Set(identityNames(identity)).size !== identity.length) {
    throw new EvidenceManifestError('definition_contract_invalid', identity);
  }
  let valid = false;
  switch (item.definitionKey) {
    case 'valuation.per':
    case 'valuation.pbr':
    case 'valuation.dividendYieldPercent':
      valid = identity.length === 0 || sameIdentityNames(identity, ['latestFiscalYear']);
      break;
    case 'valuation.revenueCagrPercent':
      valid = identity.length === 0 || sameIdentityNames(identity, [
        'cagrStartFiscalYear', 'cagrEndFiscalYear', 'cagrPeriods',
      ]);
      break;
    case 'fundamental.period': valid = sameIdentityNames(identity, ['fiscalYear']); break;
    case 'peerComparison.position':
      valid = sameIdentityNames(identity, ['metric'])
        && PEER_METRICS.includes(identity[0]?.value as (typeof PEER_METRICS)[number]);
      break;
    case 'marketCorrelation.window':
      valid = sameIdentityNames(identity, ['benchmark', 'period'])
        && identity[0]?.value === 'TOPIX'
        && CORRELATION_PERIODS.includes(identity[1]?.value as (typeof CORRELATION_PERIODS)[number]);
      break;
    case 'reportedShortPositions.row':
      valid = sameIdentityNames(identity, [
        'disclosedDate', 'calculatedDate', 'reporterName',
        'discretionaryManagerName', 'fundName',
      ]);
      break;
    case 'investorTypeFlows.period':
      valid = identity.length === 0 || sameIdentityNames(identity, [
        'section', 'publishedDate', 'periodStartDate', 'periodEndDate',
      ]);
      break;
    case 'sectorBenchmark.window':
      valid = sameIdentityNames(identity, [
        'benchmark.type', 'benchmark.sectorCode', 'benchmark.indexCode', 'period',
      ]) && CORRELATION_PERIODS.includes(identity[3]?.value as (typeof CORRELATION_PERIODS)[number]);
      break;
    case 'sectorShortRatio.observation': valid = sameIdentityNames(identity, ['date']); break;
    case 'advancedDividend.fiscal':
      valid = sameIdentityNames(identity, [
        'kind', 'fiscalYearEndDate', 'disclosureNumber', 'sourceField',
        'payoutRatioSourceField',
      ]);
      break;
    case 'advancedDividend.event':
      valid = sameIdentityNames(identity, [
        'corporateActionReferenceNumber', 'kind', 'recordDateYearMonth', 'decision',
      ]);
      break;
    case 'strategy.candidate':
      valid = sameIdentityNames(identity, [
        'entry.price', 'stop.price', 'stop.reason', 'target.price', 'target.reason',
      ]);
      break;
    default:
      valid = identity.length === 0;
  }
  if (!valid) throw new EvidenceManifestError('definition_contract_invalid', identity);
}

function expectedItemMetadata(definitionKey: string): Readonly<{
  method: string | null;
  limitation: string | null;
}> {
  if (definitionKey === 'marketCorrelation.window') return {
    method: 'market_correlation_engine',
    limitation: 'Persisted TOPIX window only; no source-totality claim.',
  };
  if (definitionKey === 'reportedShortPositions.row') return {
    method: null,
    limitation: 'Persisted rows only; no completeness claim about public disclosures.',
  };
  if (definitionKey === 'investorTypeFlows.period') return {
    method: null,
    limitation: 'Tokyo/Nagoya persisted period only; no other exchange or period coverage.',
  };
  if (definitionKey === 'sectorBenchmark.identity') return {
    method: 'market_correlation_engine',
    limitation: 'Persisted benchmark identity and windows only.',
  };
  if (definitionKey === 'sectorBenchmark.window') return {
    method: 'market_correlation_engine',
    limitation: 'Persisted sector benchmark window only.',
  };
  if (definitionKey === 'sectorShortRatio.identity') return {
    method: 'sector_short_ratio_engine',
    limitation: 'Persisted observations only; no source-totality claim.',
  };
  if (definitionKey === 'sectorShortRatio.observation') return {
    method: 'sector_short_ratio_engine', limitation: 'Persisted sector observation only.',
  };
  if (definitionKey.startsWith('advancedDividend.')) return {
    method: 'advanced_dividend_engine', limitation: null,
  };
  if (definitionKey === 'volumeProfile.summary') return {
    method: 'daily_ohlcv_volume_profile_proxy_v1',
    limitation: 'Summary only; bins are intentionally excluded.',
  };
  if (definitionKey.startsWith('strategy.')) return {
    method: 'strategy_engine', limitation: null,
  };
  return { method: null, limitation: null };
}

function expectedFactUnit(item: EvidenceItemV1, factKey: string): string | null {
  if (FIXED_COMPARISON_KEYS.includes(item.definitionKey as ComparisonMetricKeyV1)) {
    return comparisonMetricDefinitionV1(item.definitionKey as ComparisonMetricKeyV1).expectedUnit;
  }
  if (item.definitionKey === 'fundamental.period') {
    return ['roe', 'equityRatio'].includes(factKey) ? 'ratio'
      : factKey === 'eps' ? 'JPY' : 'JPY';
  }
  if (item.definitionKey === 'peerComparison.selection') {
    return ['sameSectorCandidateCount', 'marketCapPrioritizedPeerCount', 'peerCount'].includes(factKey)
      ? 'count' : null;
  }
  if (item.definitionKey === 'peerComparison.position') {
    if (['rank', 'peerSampleSize', 'cohortSize'].includes(factKey)) return 'count';
    if (factKey === 'percentile') return 'ratio';
    if (factKey === 'direction') return null;
    const metric = item.instanceIdentity[0]?.value;
    return metric === 'per' || metric === 'pbr' ? 'multiple' : 'percent';
  }
  if (item.definitionKey.endsWith('Correlation.window') || item.definitionKey === 'sectorBenchmark.window') {
    return factKey === 'observations' ? 'count' : 'ratio';
  }
  if (item.definitionKey === 'reportedShortPositions.row') {
    if (factKey === 'shortPositionShares') return 'shares';
    if (factKey === 'previousCalculatedDate') return null;
    return 'ratio';
  }
  if (item.definitionKey === 'investorTypeFlows.period') {
    return factKey === 'period' ? null : 'thousand_JPY';
  }
  if (item.definitionKey === 'sectorBenchmark.identity') {
    return factKey === 'alignedPriceCount' ? 'count' : null;
  }
  if (item.definitionKey === 'sectorShortRatio.identity') {
    return factKey === 'observationCount' ? 'count' : null;
  }
  if (item.definitionKey === 'sectorShortRatio.observation') {
    return factKey === 'shortSellingRatio' ? 'ratio' : 'JPY';
  }
  if (item.definitionKey === 'advancedDividend.identity') {
    return ['fiscalObservationCount', 'eventCount'].includes(factKey) ? 'count' : null;
  }
  if (item.definitionKey === 'advancedDividend.fiscal') {
    if (factKey === 'annualDividendPerShare') return 'JPY_per_share';
    if (factKey === 'payoutRatio') return 'ratio';
    return null;
  }
  if (item.definitionKey === 'advancedDividend.event') {
    return factKey.endsWith('DividendPerShare') || factKey === 'dividendPerShare'
      ? 'JPY_per_share' : null;
  }
  if (item.definitionKey === 'volumeProfile.summary') {
    if (['inputBarCount', 'binningMethod.requestedBinCount', 'binningMethod.effectiveBinCount', 'poc.binIndex', 'valueArea.firstBinIndex', 'valueArea.lastBinIndex'].includes(factKey)) return 'count';
    if (['binningMethod.minPrice', 'binningMethod.maxPrice', 'poc.price', 'valueArea.val', 'valueArea.vah'].includes(factKey)) return 'JPY';
    if (factKey === 'poc.allocatedVolume') return 'adjusted_shares';
    if (['poc.volumeShare', 'valueArea.targetVolumeShare', 'valueArea.achievedVolumeShare'].includes(factKey)) return 'ratio';
    return null;
  }
  if (item.definitionKey === 'strategy.entry') {
    if (factKey === 'candidateCount') return 'count';
    if (['entry.triggerPrice', 'entry.price', 'entry.tickSizeApplied'].includes(factKey)) return 'JPY';
    return null;
  }
  if (item.definitionKey === 'strategy.candidate') {
    if (['entry.triggerPrice', 'entry.price', 'entry.tickSizeApplied', 'stop.price', 'target.price', 'risk', 'reward'].includes(factKey)) return 'JPY';
    if (factKey === 'rewardRisk') return 'ratio';
    return null;
  }
  return null;
}

function expectedFactKind(item: EvidenceItemV1, factKey: string): 'number' | 'string' | 'boolean' {
  if (FIXED_COMPARISON_KEYS.includes(item.definitionKey as ComparisonMetricKeyV1)) {
    return comparisonMetricDefinitionV1(item.definitionKey as ComparisonMetricKeyV1).valueKind === 'category'
      ? 'string' : 'number';
  }
  if (item.definitionKey === 'snapshot.identity') {
    return factKey === 'schemaVersion' ? 'number' : 'string';
  }
  if (item.definitionKey === 'fundamental.period' || item.definitionKey.endsWith('Correlation.window')) return 'number';
  if (item.definitionKey === 'peerComparison.selection') {
    if (['targetIncludedInStatistics', 'marketCapPriorityApplied', 'sectorLeaderIncluded', 'tooFewPeers'].includes(factKey)) return 'boolean';
    if (['sameSectorCandidateCount', 'marketCapPrioritizedPeerCount', 'peerCount'].includes(factKey)) return 'number';
    return 'string';
  }
  if (item.definitionKey === 'peerComparison.position') return factKey === 'direction' ? 'string' : 'number';
  if (item.definitionKey === 'reportedShortPositions.row') return factKey === 'previousCalculatedDate' ? 'string' : 'number';
  if (item.definitionKey === 'investorTypeFlows.period') return factKey === 'period' ? 'string' : 'number';
  if (item.definitionKey === 'sectorBenchmark.identity') return factKey === 'alignedPriceCount' ? 'number' : 'string';
  if (item.definitionKey === 'sectorBenchmark.window' || item.definitionKey === 'sectorShortRatio.observation') return 'number';
  if (item.definitionKey === 'sectorShortRatio.identity') return factKey === 'observationCount' ? 'number' : 'string';
  if (item.definitionKey === 'advancedDividend.identity') {
    if (['fiscalObservationCount', 'eventCount'].includes(factKey)) return 'number';
    return factKey === 'eventCollectionAvailable' ? 'boolean' : 'string';
  }
  if (item.definitionKey === 'advancedDividend.fiscal') return factKey === 'disclosedTime' ? 'string' : 'number';
  if (item.definitionKey === 'advancedDividend.event') return ['referenceNumber', 'notifiedTime'].includes(factKey) ? 'string' : 'number';
  if (item.definitionKey === 'volumeProfile.summary') {
    if (factKey === 'methodology.actualHolderCostBasis') return 'boolean';
    if (expectedFactUnit(item, factKey) !== null) return 'number';
    return 'string';
  }
  if (item.definitionKey.startsWith('strategy.')) {
    return expectedFactUnit(item, factKey) === null && factKey !== 'candidateCount'
      ? 'string' : 'number';
  }
  return 'string';
}

function assertManifestRegistry(manifest: EvidenceManifestV1): void {
  if (manifest.scopes.some((scope, index) => (
    scope.scopeId !== EVIDENCE_SCOPE_IDS[index]
    || scope.claimDomain !== EVIDENCE_SCOPE_DOMAIN_V1[scope.scopeId]
  ))) {
    throw new EvidenceManifestError('definition_contract_invalid', 'scope order');
  }
  const ids = new Set<string>();
  let previous: EvidenceItemV1 | undefined;
  for (const item of manifest.items) {
    const definition = definitionByKey.get(item.definitionKey);
    if (
      definition === undefined
      || definition.scopeId !== item.scopeId
      || definition.factKeys.length !== item.facts.length
      || item.facts.some((fact, index) => fact.factKey !== definition.factKeys[index])
      || item.itemId !== createEvidenceItemIdV1(
        item.scopeId,
        item.definitionKey,
        item.instanceIdentity,
      )
      || ids.has(item.itemId)
    ) {
      throw new EvidenceManifestError('definition_contract_invalid', item.itemId);
    }
    if (previous !== undefined && compareEvidenceItems(previous, item) >= 0) {
      throw new EvidenceManifestError('definition_contract_invalid', 'item order');
    }
    assertIdentityContract(item);
    const metadata = expectedItemMetadata(item.definitionKey);
    if (item.method !== metadata.method || item.limitation !== metadata.limitation) {
      throw new EvidenceManifestError('definition_contract_invalid', item.definitionKey);
    }
    const allowedReasons = allowedReasonsForDefinition(item.definitionKey);
    const allowedEndpoints = allowedEndpointsForDefinition(item.definitionKey);
    const allowedProvenancePairs = allowedProvenancePairsForDefinition(item.definitionKey);
    for (const fact of item.facts) {
      const expectedUnit = expectedFactUnit(item, fact.factKey);
      if (
        (fact.state === 'available' && fact.unit !== expectedUnit)
        || (fact.state === 'unavailable' && fact.unit !== null && fact.unit !== expectedUnit)
        || (fact.state === 'available' && typeof fact.value !== expectedFactKind(item, fact.factKey))
      ) {
        throw new EvidenceManifestError('definition_contract_invalid', fact);
      }
      if (fact.unavailableReasons.some(reason => (
        reason.detail !== null
        || !ALLOWED_FACT_REASONS.has(reason.reason)
        || !allowedReasons.has(reason.reason)
      ))) {
        throw new EvidenceManifestError('definition_contract_invalid', fact.unavailableReasons);
      }
      for (let index = 1; index < fact.unavailableReasons.length; index += 1) {
        const previousReason = fact.unavailableReasons[index - 1];
        const currentReason = fact.unavailableReasons[index];
        const previousKey = `${previousReason.reason}\u0000${previousReason.detail ?? ''}`;
        const currentKey = `${currentReason.reason}\u0000${currentReason.detail ?? ''}`;
        if (currentKey <= previousKey) {
          throw new EvidenceManifestError('definition_contract_invalid', fact.unavailableReasons);
        }
      }
    }
    for (const provenance of item.provenance) {
      if (
        !ALLOWED_PROVENANCE_SOURCES.has(provenance.source)
        || !ALLOWED_PROVENANCE_ROLES.has(provenance.role)
        || !allowedProvenancePairs.has(`${provenance.source}/${provenance.role}`)
        || provenance.qualifiers.some(qualifier => (
          (qualifier.name === 'endpoint' && qualifier.value !== null && !allowedEndpoints.has(qualifier.value))
          || (qualifier.name === 'section' && qualifier.value !== null && qualifier.value !== 'TokyoNagoya')
        ))
      ) {
        throw new EvidenceManifestError('provenance_invalid', provenance);
      }
    }
    ids.add(item.itemId);
    previous = item;
  }
}

export function validateEvidenceManifestV1(rawManifest: unknown): EvidenceManifestV1 {
  const parsed = EvidenceManifestV1Schema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new EvidenceManifestError('definition_contract_invalid', parsed.error);
  }
  const manifest = parsed.data;
  assertManifestRegistry(manifest);
  const manifestCharacters = evidenceManifestLogicalCharactersV1(manifest);
  if (manifestCharacters > 150_000) {
    throw new EvidenceManifestError('manifest_limit_exceeded', manifestCharacters);
  }
  return manifest;
}

export function evidenceManifestLogicalCharactersV1(manifest: EvidenceManifestV1): number {
  let total = 0;
  for (const item of manifest.items) {
    for (const identity of item.instanceIdentity) {
      if (typeof identity.value === 'string') total += identity.value.length;
    }
    for (const fact of item.facts) {
      if (fact.state === 'available' && typeof fact.value === 'string') total += fact.value.length;
      total += fact.dataDates.reduce((sum, value) => sum + (value.value?.length ?? 0), 0);
      total += fact.unavailableReasons.reduce(
        (sum, value) => sum + (value.detail?.length ?? 0),
        0,
      );
    }
    total += item.provenance.reduce(
      (sum, value) => sum + (value.asOfDate?.length ?? 0),
      0,
    );
  }
  return total;
}

export function buildEvidenceManifestV1(rawSnapshot: unknown): EvidenceManifestV1 {
  const parsed = AnalysisSnapshotSchema.safeParse(rawSnapshot);
  if (!parsed.success) throw new EvidenceManifestError('snapshot_invalid', parsed.error);
  const snapshot = parsed.data;
  const scopes = buildScopes(snapshot);
  const scopeById = new Map(scopes.map(scope => [scope.scopeId, scope]));
  const requiredScope = (scopeId: EvidenceScopeIdV1): EvidenceScopeV1 => {
    const scope = scopeById.get(scopeId);
    if (scope === undefined) throw new EvidenceManifestError('definition_contract_invalid');
    return scope;
  };
  const fixedItems = fixedComparisonItems(snapshot, scopeById);
  const fixedFor = (scopeId: EvidenceScopeIdV1): readonly EvidenceItemV1[] => (
    fixedItems.filter(item => item.scopeId === scopeId)
  );
  const items: EvidenceItemV1[] = [
    ...identityItems(snapshot),
    ...fixedFor('valuation'),
    ...fundamentalItems(snapshot, requiredScope('fundamental')),
    ...peerItems(snapshot, requiredScope('peer_comparison')),
    ...fixedFor('technical'),
    ...fixedFor('advanced_technical'),
    ...fixedFor('supply_demand'),
    ...marketCorrelationItems(snapshot, requiredScope('market_correlation')),
    ...reportedShortItems(snapshot, requiredScope('reported_short_positions')),
    ...investorItems(snapshot, requiredScope('investor_type_flows')),
    ...sectorBenchmarkItems(snapshot, requiredScope('sector_benchmark')),
    ...sectorShortItems(snapshot, requiredScope('sector_short_ratio')),
    ...advancedDividendItems(snapshot, requiredScope('advanced_dividend')),
    ...volumeProfileItems(snapshot, requiredScope('volume_profile_summary')),
    ...strategyItems(snapshot, requiredScope('strategy')),
  ].sort(compareEvidenceItems);
  if (items.length > 343) {
    throw new EvidenceManifestError('manifest_limit_exceeded', items.length);
  }
  return validateEvidenceManifestV1({ manifestVersion: 1, scopes, items });
}
