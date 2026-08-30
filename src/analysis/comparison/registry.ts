import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import type { AnalysisSnapshot } from '../snapshot/schema.js';
import {
  COMPARISON_METRIC_KEYS,
  COMPARISON_SECTIONS,
  ComparisonObservationV1Schema,
  type ComparisonDispositionV1,
  type ComparisonDisplaySemanticsV1,
  type ComparisonInstanceDefinitionV1,
  type ComparisonInstanceIdentityV1,
  type ComparisonIntroductionVersionV1,
  type ComparisonMetricDefinitionV1,
  type ComparisonMetricKeyV1,
  type ComparisonObservationV1,
  type ComparisonProvenanceV1,
  type ComparisonSectionAvailabilityV1,
  type ComparisonSectionV1,
  type ComparisonUnavailableReasonV1,
  type NamedDataDateV1,
  type NonEmptyComparisonUnavailableReasonsV1,
} from './schema.js';

type IdentityMismatchReason = Extract<
  ComparisonDispositionV1,
  { state: 'incomparable' }
>['reason'];

type IdentityRule = Readonly<{
  name: string;
  reason: Exclude<IdentityMismatchReason, 'identity_ambiguous'>;
}>;

type ValueResolution =
  | Readonly<{
      kind: 'found';
      value: number | string | null;
      actualUnit: string | null;
      dataDates: readonly NamedDataDateV1[];
      provenance: readonly ComparisonProvenanceV1[];
      identity: ComparisonInstanceIdentityV1;
      reasonMetrics: readonly string[];
      directReasons?: readonly ComparisonUnavailableReasonV1[];
    }>
  | Readonly<{
      kind: 'absent';
      identity: ComparisonInstanceIdentityV1;
      missingAsUnavailable?: boolean;
      actualUnit?: string | null;
      dataDates?: readonly NamedDataDateV1[];
      provenance?: readonly ComparisonProvenanceV1[];
      directReasons?: readonly ComparisonUnavailableReasonV1[];
      reasonMetrics?: readonly string[];
    }>
  | Readonly<{
      kind: 'ambiguous';
      identity: ComparisonInstanceIdentityV1;
      candidateCount: number;
    }>;

type InternalDefinitionV1 = ComparisonMetricDefinitionV1 & Readonly<{
  sectionIntroducedInSnapshotVersion: ComparisonIntroductionVersionV1;
  identityRules: readonly IdentityRule[];
  allowedUnavailableReasons: ReadonlySet<string> | null;
  readActualUnit: (snapshot: AnalysisSnapshot) => string | null;
  compareInstances: (
    left: ComparisonInstanceDefinitionV1,
    right: ComparisonInstanceDefinitionV1,
  ) => number;
}>;

type DefinitionConfig = Readonly<{
  key: ComparisonMetricKeyV1;
  section: ComparisonSectionV1;
  introducedInSnapshotVersion: ComparisonIntroductionVersionV1;
  sectionIntroducedInSnapshotVersion?: ComparisonIntroductionVersionV1;
  valueKind: 'number' | 'category';
  expectedUnit: string | null;
  displaySemantics: ComparisonDisplaySemanticsV1;
  comparisonDateRoles: readonly NamedDataDateV1['role'][];
  identityRules?: readonly IdentityRule[];
  allowedUnavailableReasons?: readonly string[];
  readActualUnit: (snapshot: AnalysisSnapshot) => string | null;
  resolveInstances?: (snapshot: AnalysisSnapshot) => readonly ComparisonInstanceDefinitionV1[];
  compareInstances?: (
    left: ComparisonInstanceDefinitionV1,
    right: ComparisonInstanceDefinitionV1,
  ) => number;
  resolveValue: (
    snapshot: AnalysisSnapshot,
    instance: ComparisonInstanceDefinitionV1,
  ) => ValueResolution;
}>;

export class ComparisonCorruptSnapshotError extends Error {
  constructor() {
    super('The saved Snapshot is inconsistent with Comparison registry V1.');
    this.name = 'ComparisonCorruptSnapshotError';
  }
}

const SINGLETON_INSTANCE: ComparisonInstanceDefinitionV1 = {
  identity: [],
  introducedInSnapshotVersion: 1,
};

const SECTION_INTRODUCTION: Readonly<Record<ComparisonSectionV1, ComparisonIntroductionVersionV1>> = {
  valuation: 1,
  fundamental: 1,
  technical: 1,
  advancedTechnical: 2,
  supplyDemand: 1,
  marketCorrelation: 1,
  sectorBenchmark: 6,
  strategy: 1,
  advancedDividend: 8,
  volumeProfile: 9,
};

const MISSING_METRIC_VALUE: NonEmptyComparisonUnavailableReasonsV1 = [{
  reason: 'missing_metric_value',
  detail: null,
}];

function reasonTuple(
  reasons: readonly ComparisonUnavailableReasonV1[],
): NonEmptyComparisonUnavailableReasonsV1 {
  if (reasons.length === 0) throw new ComparisonCorruptSnapshotError();
  return reasons as NonEmptyComparisonUnavailableReasonsV1;
}

function schemaPredatesSection(): NonEmptyComparisonUnavailableReasonsV1 {
  return [{ reason: 'schema_predates_section', detail: null }];
}

function schemaPredatesInstance(): NonEmptyComparisonUnavailableReasonsV1 {
  return [{ reason: 'schema_predates_instance', detail: null }];
}

function sectionObject(snapshot: AnalysisSnapshot, section: ComparisonSectionV1): unknown | null {
  switch (section) {
    case 'valuation': return snapshot.valuation;
    case 'fundamental': return snapshot.fundamental;
    case 'technical': return snapshot.technical;
    case 'advancedTechnical': return 'advancedTechnical' in snapshot ? snapshot.advancedTechnical : null;
    case 'supplyDemand': return snapshot.supplyDemand;
    case 'marketCorrelation': return snapshot.marketCorrelation;
    case 'sectorBenchmark': return 'sectorBenchmark' in snapshot ? snapshot.sectorBenchmark : null;
    case 'strategy': return snapshot.strategy;
    case 'advancedDividend': return 'advancedDividend' in snapshot ? snapshot.advancedDividend : null;
    case 'volumeProfile': return 'volumeProfile' in snapshot ? snapshot.volumeProfile : null;
  }
}

function storedSectionReasons(
  snapshot: AnalysisSnapshot,
  section: ComparisonSectionV1,
): readonly ComparisonUnavailableReasonV1[] {
  return snapshot.unavailable
    .filter(item => item.section === section && item.metric === undefined)
    .map(item => ({ reason: item.reason, detail: item.detail ?? null }));
}

function storedMetricReasons(
  snapshot: AnalysisSnapshot,
  section: ComparisonSectionV1,
  metrics: readonly string[],
  allowedReasons: ReadonlySet<string> | null,
): readonly ComparisonUnavailableReasonV1[] {
  const reasons: ComparisonUnavailableReasonV1[] = [];
  for (const metric of metrics) {
    for (const item of snapshot.unavailable) {
      if (item.section !== section || item.metric !== metric) continue;
      if (allowedReasons === null || allowedReasons.has(item.reason)) {
        reasons.push({ reason: item.reason, detail: item.detail ?? null });
      }
    }
  }
  return reasons;
}

export function classifyComparisonSectionV1(
  snapshot: AnalysisSnapshot,
  section: ComparisonSectionV1,
): ComparisonSectionAvailabilityV1 {
  if (snapshot.schemaVersion < SECTION_INTRODUCTION[section]) {
    return { state: 'not_collected', unavailableReasons: schemaPredatesSection() };
  }

  const object = sectionObject(snapshot, section);
  const storedReasons = storedSectionReasons(snapshot, section);
  const notCollected = storedReasons.filter(reason => reason.reason === 'not_collected');
  if (object !== null) {
    if (notCollected.length > 0) throw new ComparisonCorruptSnapshotError();
    return { state: 'available', unavailableReasons: [] };
  }
  if (notCollected.length > 0) {
    return { state: 'not_collected', unavailableReasons: reasonTuple(notCollected) };
  }
  return {
    state: 'unavailable',
    unavailableReasons: storedReasons.length > 0
      ? reasonTuple(storedReasons)
      : [{ reason: 'missing_section_value', detail: null }],
  };
}

function sectionProvenance(
  snapshot: AnalysisSnapshot,
  section: ComparisonSectionV1,
): readonly ComparisonProvenanceV1[] {
  let values: readonly {
    source: string;
    role: string;
    asOfDate: string | null;
    sourceUrls: readonly string[];
    endpoint?: string | null;
    section?: string | null;
  }[];
  switch (section) {
    case 'valuation': values = snapshot.provenance.valuation; break;
    case 'fundamental': values = snapshot.provenance.fundamental; break;
    case 'technical': values = snapshot.provenance.technical; break;
    case 'advancedTechnical': values = 'advancedTechnical' in snapshot.provenance
      ? snapshot.provenance.advancedTechnical
      : []; break;
    case 'supplyDemand': values = snapshot.provenance.supplyDemand; break;
    case 'marketCorrelation': values = snapshot.provenance.marketCorrelation; break;
    case 'sectorBenchmark': values = 'sectorBenchmark' in snapshot.provenance
      ? snapshot.provenance.sectorBenchmark
      : []; break;
    case 'strategy': values = snapshot.provenance.strategy; break;
    case 'advancedDividend': values = 'advancedDividend' in snapshot.provenance
      ? snapshot.provenance.advancedDividend
      : []; break;
    case 'volumeProfile': values = 'volumeProfile' in snapshot.provenance
      ? snapshot.provenance.volumeProfile
      : []; break;
  }
  return values.map(value => ({
    source: value.source,
    role: value.role,
    asOfDate: value.asOfDate,
    sourceUrls: value.sourceUrls,
    qualifiers: [
      ...('endpoint' in value ? [{ name: 'endpoint' as const, value: value.endpoint ?? null }] : []),
      ...('section' in value ? [{ name: 'section' as const, value: value.section ?? null }] : []),
    ],
  }));
}

function observationIdentityValue(
  observation: Extract<ComparisonObservationV1, { state: 'available' }>,
  name: string,
): string | number | boolean | null | undefined {
  const matches = observation.identity.filter(item => item.name === name);
  if (matches.length > 1) throw new ComparisonCorruptSnapshotError();
  return matches[0]?.value;
}

function canonicalDateTuple(value: string): readonly [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return null;
  return [year, month, day];
}

export function isCanonicalCalendarDateV1(value: string): boolean {
  return canonicalDateTuple(value) !== null;
}

function compareDateTuple(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function checkedDate(
  observation: Extract<ComparisonObservationV1, { state: 'available' }>,
  role: NamedDataDateV1['role'],
): { state: 'missing' } | { state: 'invalid' } | { state: 'valid'; tuple: readonly [number, number, number] } {
  const matches = observation.dataDates.filter(item => item.role === role);
  if (matches.length > 1) return { state: 'invalid' };
  if (matches.length === 0 || matches[0].value === null) return { state: 'missing' };
  const tuple = canonicalDateTuple(matches[0].value);
  return tuple === null ? { state: 'invalid' } : { state: 'valid', tuple };
}

function compareAvailable(
  definition: InternalDefinitionV1,
  base: Extract<ComparisonObservationV1, { state: 'available' }>,
  target: Extract<ComparisonObservationV1, { state: 'available' }>,
): ComparisonDispositionV1 {
  if (definition.valueKind === 'number') {
    if (typeof base.value !== 'number' || typeof target.value !== 'number') {
      throw new ComparisonCorruptSnapshotError();
    }
    if (
      base.actualUnit === null
      || target.actualUnit === null
      || base.actualUnit !== definition.expectedUnit
      || target.actualUnit !== definition.expectedUnit
    ) {
      return { state: 'incomparable', mode: 'incomparable', delta: null, reason: 'unit_mismatch' };
    }
  } else if (
    typeof base.value !== 'string'
    || typeof target.value !== 'string'
    || base.actualUnit !== null
    || target.actualUnit !== null
  ) {
    throw new ComparisonCorruptSnapshotError();
  }

  for (const rule of definition.identityRules) {
    const baseIdentity = observationIdentityValue(base, rule.name);
    const targetIdentity = observationIdentityValue(target, rule.name);
    if (
      baseIdentity === undefined
      || targetIdentity === undefined
      || baseIdentity === null
      || targetIdentity === null
      || baseIdentity !== targetIdentity
    ) {
      return { state: 'incomparable', mode: 'incomparable', delta: null, reason: rule.reason };
    }
  }

  for (const role of definition.comparisonDateRoles) {
    const baseDate = checkedDate(base, role);
    const targetDate = checkedDate(target, role);
    if (baseDate.state === 'missing' || targetDate.state === 'missing') {
      return { state: 'incomparable', mode: 'incomparable', delta: null, reason: 'missing_data_date' };
    }
    if (baseDate.state === 'invalid' || targetDate.state === 'invalid') {
      return { state: 'incomparable', mode: 'incomparable', delta: null, reason: 'invalid_data_date' };
    }
    if (compareDateTuple(targetDate.tuple, baseDate.tuple) < 0) {
      return { state: 'incomparable', mode: 'incomparable', delta: null, reason: 'data_date_regressed' };
    }
  }

  if (definition.valueKind === 'category') {
    return {
      state: 'comparable',
      mode: 'from_to',
      delta: null,
      changed: base.value !== target.value,
    };
  }
  const rawDelta = (target.value as number) - (base.value as number);
  const delta = Object.is(rawDelta, -0) ? 0 : rawDelta;
  return {
    state: 'comparable',
    mode: 'absolute_delta',
    delta,
    deltaUnit: definition.expectedUnit as string,
    changed: delta !== 0,
  };
}

function compareObservationPair(
  definition: InternalDefinitionV1,
  base: ComparisonObservationV1,
  target: ComparisonObservationV1,
): ComparisonDispositionV1 {
  if (base.state === 'ambiguous' || target.state === 'ambiguous') {
    const affectedSides: readonly ['base'] | readonly ['target'] | readonly ['base', 'target'] =
      base.state === 'ambiguous' && target.state === 'ambiguous'
        ? ['base', 'target']
        : base.state === 'ambiguous' ? ['base'] : ['target'];
    return {
      state: 'incomparable',
      mode: 'incomparable',
      delta: null,
      reason: 'identity_ambiguous',
      affectedSides,
      candidateCounts: {
        base: base.state === 'ambiguous' ? base.candidateCount : null,
        target: target.state === 'ambiguous' ? target.candidateCount : null,
      },
    };
  }
  if (base.state === 'absent' && target.state === 'available') {
    return {
      state: 'not_applicable', mode: 'not_applicable', delta: null,
      reason: 'record_added', affectedSides: ['base'], presentSide: 'target',
    };
  }
  if (base.state === 'available' && target.state === 'absent') {
    return {
      state: 'not_applicable', mode: 'not_applicable', delta: null,
      reason: 'record_removed', affectedSides: ['target'], presentSide: 'base',
    };
  }
  if (
    base.state === 'unavailable'
    || base.state === 'not_collected'
    || target.state === 'unavailable'
    || target.state === 'not_collected'
  ) {
    return {
      state: 'not_applicable',
      mode: 'not_applicable',
      delta: null,
      reason: 'non_available_state',
      sideStates: { base: base.state, target: target.state },
      affectedSides: [
        ...(base.state !== 'available' ? ['base' as const] : []),
        ...(target.state !== 'available' ? ['target' as const] : []),
      ],
    };
  }
  if (base.state === 'absent' || target.state === 'absent') {
    throw new ComparisonCorruptSnapshotError();
  }
  return compareAvailable(definition, base, target);
}

function identityKey(identity: ComparisonInstanceIdentityV1): string {
  return canonicalJsonV1(identity as CanonicalJsonValue);
}

function defaultInstanceCompare(
  left: ComparisonInstanceDefinitionV1,
  right: ComparisonInstanceDefinitionV1,
): number {
  const leftKey = identityKey(left.identity);
  const rightKey = identityKey(right.identity);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function extractObservation(
  definition: InternalDefinitionV1,
  resolveValue: DefinitionConfig['resolveValue'],
  snapshot: AnalysisSnapshot,
  instance: ComparisonInstanceDefinitionV1,
): ComparisonObservationV1 {
  if (snapshot.schemaVersion < definition.sectionIntroducedInSnapshotVersion) {
    return ComparisonObservationV1Schema.parse({
      state: 'not_collected', value: null, actualUnit: null, dataDates: [], provenance: [],
      identity: instance.identity, unavailableReasons: schemaPredatesSection(),
    });
  }
  if (snapshot.schemaVersion < instance.introducedInSnapshotVersion) {
    return ComparisonObservationV1Schema.parse({
      state: 'not_collected', value: null, actualUnit: null, dataDates: [], provenance: [],
      identity: instance.identity, unavailableReasons: schemaPredatesInstance(),
    });
  }
  const sectionState = classifyComparisonSectionV1(snapshot, definition.section);
  if (sectionState.state !== 'available') {
    return ComparisonObservationV1Schema.parse({
      state: sectionState.state,
      value: null,
      actualUnit: sectionState.state === 'not_collected' ? null : definition.readActualUnit(snapshot),
      dataDates: [],
      provenance: [],
      identity: instance.identity,
      unavailableReasons: sectionState.unavailableReasons,
    });
  }

  const resolution = resolveValue(snapshot, instance);
  if (resolution.kind === 'ambiguous') {
    return ComparisonObservationV1Schema.parse({
      state: 'ambiguous', value: null, actualUnit: null, dataDates: [], provenance: [],
      identity: resolution.identity,
      unavailableReasons: [{ reason: 'duplicate_instance_identity', detail: null }],
      candidateCount: resolution.candidateCount,
    });
  }
  if (resolution.kind === 'absent' && !resolution.missingAsUnavailable) {
    return ComparisonObservationV1Schema.parse({
      state: 'absent', value: null, actualUnit: null, dataDates: [], provenance: [],
      identity: resolution.identity, unavailableReasons: [],
    });
  }

  const context = resolution.kind === 'found' ? resolution : {
    value: null,
    actualUnit: resolution.actualUnit ?? definition.expectedUnit,
    dataDates: resolution.dataDates ?? [],
    provenance: resolution.provenance ?? [],
    identity: resolution.identity,
    reasonMetrics: resolution.reasonMetrics ?? [],
    directReasons: resolution.directReasons,
  };
  const reasons = context.directReasons ?? storedMetricReasons(
    snapshot, definition.section, context.reasonMetrics, definition.allowedUnavailableReasons,
  );
  if (context.value !== null && reasons.length > 0) throw new ComparisonCorruptSnapshotError();
  if (context.value === null) {
    return ComparisonObservationV1Schema.parse({
      state: 'unavailable',
      value: null,
      actualUnit: context.actualUnit,
      dataDates: context.dataDates,
      provenance: context.provenance,
      identity: context.identity,
      unavailableReasons: reasons.length > 0 ? reasonTuple(reasons) : MISSING_METRIC_VALUE,
    });
  }
  return ComparisonObservationV1Schema.parse({
    state: 'available',
    value: context.value,
    actualUnit: context.actualUnit,
    dataDates: context.dataDates,
    provenance: context.provenance,
    identity: context.identity,
    unavailableReasons: [],
  });
}

function createDefinition(config: DefinitionConfig): InternalDefinitionV1 {
  let definition: InternalDefinitionV1;
  definition = {
    key: config.key,
    section: config.section,
    introducedInSnapshotVersion: config.introducedInSnapshotVersion,
    sectionIntroducedInSnapshotVersion:
      config.sectionIntroducedInSnapshotVersion ?? SECTION_INTRODUCTION[config.section],
    valueKind: config.valueKind,
    expectedUnit: config.expectedUnit,
    displaySemantics: config.displaySemantics,
    comparisonDateRoles: config.comparisonDateRoles,
    identityRules: config.identityRules ?? [],
    allowedUnavailableReasons: config.allowedUnavailableReasons === undefined
      ? null
      : new Set(config.allowedUnavailableReasons),
    readActualUnit: config.readActualUnit,
    resolveInstances: config.resolveInstances ?? (() => [{
      ...SINGLETON_INSTANCE,
      introducedInSnapshotVersion: config.introducedInSnapshotVersion,
    }]),
    compareInstances: config.compareInstances ?? defaultInstanceCompare,
    extractObservation: (snapshot, instance) => extractObservation(
      definition,
      config.resolveValue,
      snapshot,
      instance,
    ),
    compare: (base, target) => compareObservationPair(definition, base, target),
  };
  return definition;
}

function identity(...items: readonly [string, string | number | boolean | null][]): ComparisonInstanceIdentityV1 {
  return items.map(([name, value]) => ({ name, value }));
}

function scalarFound(
  snapshot: AnalysisSnapshot,
  section: ComparisonSectionV1,
  value: number | string | null,
  actualUnit: string | null,
  dataDates: readonly NamedDataDateV1[],
  observationIdentity: ComparisonInstanceIdentityV1,
  reasonMetrics: readonly string[],
): ValueResolution {
  return {
    kind: 'found',
    value,
    actualUnit,
    dataDates,
    provenance: sectionProvenance(snapshot, section),
    identity: observationIdentity,
    reasonMetrics,
  };
}

type ValuationField =
  | 'currentPrice'
  | 'per'
  | 'pbr'
  | 'dividendYieldPercent'
  | 'revenueCagrPercent';

function valuationDefinition(
  key: Extract<ComparisonMetricKeyV1, `valuation.${string}`>,
  field: ValuationField,
  expectedUnit: string,
  displaySemantics: ComparisonDisplaySemanticsV1,
  dateRoles: readonly NamedDataDateV1['role'][],
  identityRules: readonly IdentityRule[],
  observationIdentity: (snapshot: AnalysisSnapshot) => ComparisonInstanceIdentityV1,
): InternalDefinitionV1 {
  return createDefinition({
    key,
    section: 'valuation',
    introducedInSnapshotVersion: 1,
    valueKind: 'number',
    expectedUnit,
    readActualUnit: snapshot => snapshot.units.valuation[field] ?? null,
    displaySemantics,
    comparisonDateRoles: dateRoles,
    identityRules,
    allowedUnavailableReasons: field === 'currentPrice' ? undefined : [
      'missing_or_invalid_price', 'insufficient_financial_history',
      'missing_or_invalid_eps', 'non_positive_eps', 'missing_or_invalid_bps',
      'non_positive_bps', 'missing_or_invalid_dividend', 'missing_or_invalid_revenue',
      'non_positive_revenue', 'invalid_fiscal_year_range',
    ],
    resolveValue: (snapshot) => {
      const value = snapshot.valuation;
      if (value === null) throw new ComparisonCorruptSnapshotError();
      const dates: NamedDataDateV1[] = [];
      if (dateRoles.includes('price')) dates.push({ role: 'price', value: value.priceDataDate });
      if (dateRoles.includes('financial')) dates.push({ role: 'financial', value: value.financialDataDate });
      return scalarFound(
        snapshot,
        'valuation',
        value[field],
        snapshot.units.valuation[field] ?? null,
        dates,
        observationIdentity(snapshot),
        [field],
      );
    },
  });
}

const valuationDefinitions: readonly InternalDefinitionV1[] = [
  valuationDefinition(
    'valuation.currentPrice', 'currentPrice', 'JPY', 'native', ['price'], [], () => [],
  ),
  valuationDefinition(
    'valuation.per', 'per', 'multiple', 'native', ['price', 'financial'],
    [{ name: 'latestFiscalYear', reason: 'period_changed' }],
    snapshot => identity(['latestFiscalYear', snapshot.valuation?.latestFiscalYear ?? null]),
  ),
  valuationDefinition(
    'valuation.pbr', 'pbr', 'multiple', 'native', ['price', 'financial'],
    [{ name: 'latestFiscalYear', reason: 'period_changed' }],
    snapshot => identity(['latestFiscalYear', snapshot.valuation?.latestFiscalYear ?? null]),
  ),
  valuationDefinition(
    'valuation.dividendYieldPercent', 'dividendYieldPercent', 'percent', 'percent_value',
    ['price', 'financial'], [{ name: 'latestFiscalYear', reason: 'period_changed' }],
    snapshot => identity(['latestFiscalYear', snapshot.valuation?.latestFiscalYear ?? null]),
  ),
  valuationDefinition(
    'valuation.revenueCagrPercent', 'revenueCagrPercent', 'percent', 'percent_value',
    ['financial'], [
      { name: 'cagrStartFiscalYear', reason: 'period_changed' },
      { name: 'cagrEndFiscalYear', reason: 'period_changed' },
      { name: 'cagrPeriods', reason: 'period_changed' },
    ],
    snapshot => identity(
      ['cagrStartFiscalYear', snapshot.valuation?.cagrStartFiscalYear ?? null],
      ['cagrEndFiscalYear', snapshot.valuation?.cagrEndFiscalYear ?? null],
      ['cagrPeriods', snapshot.valuation?.cagrPeriods ?? null],
    ),
  ),
];

type FundamentalField =
  | 'revenue'
  | 'operatingIncome'
  | 'ordinaryIncome'
  | 'netIncome'
  | 'eps'
  | 'roe'
  | 'equityRatio'
  | 'operatingCashFlow'
  | 'freeCashFlow';

function fundamentalDefinition(
  field: FundamentalField,
  displaySemantics: ComparisonDisplaySemanticsV1 = 'native',
): InternalDefinitionV1 {
  return createDefinition({
    key: `fundamental.latest.${field}` as ComparisonMetricKeyV1,
    section: 'fundamental',
    introducedInSnapshotVersion: 1,
    valueKind: 'number',
    expectedUnit: field === 'roe' || field === 'equityRatio' ? 'ratio' : 'JPY',
    readActualUnit: snapshot => snapshot.units.fundamental[field] ?? null,
    displaySemantics,
    comparisonDateRoles: ['submit'],
    identityRules: [{ name: 'fiscalYear', reason: 'period_changed' }],
    resolveValue: (snapshot) => {
      const period = snapshot.fundamental?.periods.at(-1);
      if (period === undefined) throw new ComparisonCorruptSnapshotError();
      return scalarFound(
        snapshot,
        'fundamental',
        period[field],
        snapshot.units.fundamental[field] ?? null,
        [{ role: 'submit', value: period.submitDate }],
        identity(['fiscalYear', period.fiscalYear]),
        [field],
      );
    },
  });
}

const fundamentalDefinitions: readonly InternalDefinitionV1[] = [
  fundamentalDefinition('revenue'),
  fundamentalDefinition('operatingIncome'),
  fundamentalDefinition('ordinaryIncome'),
  fundamentalDefinition('netIncome'),
  fundamentalDefinition('eps'),
  fundamentalDefinition('roe', 'fraction_as_percent'),
  fundamentalDefinition('equityRatio', 'fraction_as_percent'),
  fundamentalDefinition('operatingCashFlow'),
  fundamentalDefinition('freeCashFlow'),
];

type TechnicalField =
  | 'ma20'
  | 'atr14'
  | 'averageVolume20'
  | 'latestSwingHigh'
  | 'latestSwingLow'
  | 'trend';

function technicalDefinition(
  field: TechnicalField,
  expectedUnit: string | null,
): InternalDefinitionV1 {
  const category = field === 'trend';
  return createDefinition({
    key: `technical.${field}` as ComparisonMetricKeyV1,
    section: 'technical',
    introducedInSnapshotVersion: 1,
    valueKind: category ? 'category' : 'number',
    expectedUnit,
    readActualUnit: snapshot => category ? null : snapshot.units.technical[field] ?? null,
    displaySemantics: category ? 'category' : 'native',
    comparisonDateRoles: ['section'],
    allowedUnavailableReasons: ['engine_reported_unavailable'],
    resolveValue: (snapshot) => {
      const result = snapshot.technical;
      if (result === null) throw new ComparisonCorruptSnapshotError();
      const rawValue = result[field];
      const value = field === 'trend' && rawValue === 'unavailable' ? null : rawValue;
      return scalarFound(
        snapshot,
        'technical',
        value,
        category ? null : snapshot.units.technical[field] ?? null,
        [{ role: 'section', value: result.dataDate }],
        [],
        [field],
      );
    },
  });
}

const technicalDefinitions: readonly InternalDefinitionV1[] = [
  technicalDefinition('ma20', 'JPY'),
  technicalDefinition('atr14', 'JPY'),
  technicalDefinition('averageVolume20', 'shares'),
  technicalDefinition('latestSwingHigh', 'JPY'),
  technicalDefinition('latestSwingLow', 'JPY'),
  technicalDefinition('trend', null),
];

type AdvancedTechnicalField =
  | 'rsi14'
  | 'macd.value'
  | 'macd.signal'
  | 'macd.histogram'
  | 'bollinger20.middle'
  | 'bollinger20.upper'
  | 'bollinger20.lower';

function advancedTechnicalDefinition(
  field: AdvancedTechnicalField,
  expectedUnit: string,
): InternalDefinitionV1 {
  const [group, child] = field.split('.') as [string, string | undefined];
  return createDefinition({
    key: `advancedTechnical.${field}` as ComparisonMetricKeyV1,
    section: 'advancedTechnical',
    introducedInSnapshotVersion: 2,
    valueKind: 'number',
    expectedUnit,
    readActualUnit: snapshot => 'advancedTechnical' in snapshot.units
      ? snapshot.units.advancedTechnical[field] ?? null
      : null,
    displaySemantics: 'native',
    comparisonDateRoles: ['section'],
    allowedUnavailableReasons: ['insufficient_history', 'missing_data', 'invalid_data'],
    resolveValue: (snapshot) => {
      if (!('advancedTechnical' in snapshot) || snapshot.advancedTechnical === null) {
        throw new ComparisonCorruptSnapshotError();
      }
      const result = snapshot.advancedTechnical;
      let value: number | null;
      let reasonMetric: string;
      if (group === 'rsi14') {
        value = result.rsi14;
        reasonMetric = 'rsi14';
      } else if (group === 'macd') {
        value = result.macd === null ? null : result.macd[child as 'value' | 'signal' | 'histogram'];
        reasonMetric = 'macd';
      } else {
        value = result.bollinger20 === null
          ? null
          : result.bollinger20[child as 'middle' | 'upper' | 'lower'];
        reasonMetric = 'bollinger20';
      }
      return scalarFound(
        snapshot,
        'advancedTechnical',
        value,
        snapshot.units.advancedTechnical[field] ?? null,
        [{ role: 'section', value: result.dataDate }],
        [],
        [reasonMetric],
      );
    },
  });
}

const advancedTechnicalDefinitions: readonly InternalDefinitionV1[] = [
  advancedTechnicalDefinition('rsi14', 'index'),
  advancedTechnicalDefinition('macd.value', 'JPY'),
  advancedTechnicalDefinition('macd.signal', 'JPY'),
  advancedTechnicalDefinition('macd.histogram', 'JPY'),
  advancedTechnicalDefinition('bollinger20.middle', 'JPY'),
  advancedTechnicalDefinition('bollinger20.upper', 'JPY'),
  advancedTechnicalDefinition('bollinger20.lower', 'JPY'),
];

type SupplyDemandField =
  | 'buyingBalance'
  | 'sellingBalance'
  | 'marginRatio'
  | 'buyingBalanceWeeklyChange'
  | 'sellingBalanceWeeklyChange'
  | 'mean4w'
  | 'mean13w'
  | 'mean52w'
  | 'deviation52w'
  | 'percentile52w'
  | 'averageDailyVolume20'
  | 'digestionDays';

const supplyDemandUnits: Readonly<Record<SupplyDemandField, string>> = {
  buyingBalance: 'shares',
  sellingBalance: 'shares',
  marginRatio: 'ratio',
  buyingBalanceWeeklyChange: 'shares',
  sellingBalanceWeeklyChange: 'shares',
  mean4w: 'shares',
  mean13w: 'shares',
  mean52w: 'shares',
  deviation52w: 'ratio',
  percentile52w: 'ratio',
  averageDailyVolume20: 'shares',
  digestionDays: 'days',
};

function supplyDemandDefinition(field: SupplyDemandField): InternalDefinitionV1 {
  const introduced = field === 'mean4w' ? 3 : 1;
  const displaySemantics = field === 'deviation52w' || field === 'percentile52w'
    ? 'fraction_as_percent'
    : 'native';
  const comparisonDateRoles: readonly NamedDataDateV1['role'][] = field === 'averageDailyVolume20'
    ? ['volume']
    : field === 'digestionDays'
      ? ['section', 'volume']
      : ['section'];
  return createDefinition({
    key: `supplyDemand.${field}` as ComparisonMetricKeyV1,
    section: 'supplyDemand',
    introducedInSnapshotVersion: introduced,
    valueKind: 'number',
    expectedUnit: supplyDemandUnits[field],
    readActualUnit: snapshot => snapshot.units.supplyDemand[field] ?? null,
    displaySemantics,
    comparisonDateRoles,
    allowedUnavailableReasons: [
      'missing_data', 'insufficient_history', 'zero_selling_balance',
      'zero_mean_52w', 'zero_average_daily_volume',
    ],
    resolveValue: (snapshot) => {
      const result = snapshot.supplyDemand;
      if (result === null) throw new ComparisonCorruptSnapshotError();
      const value = field === 'mean4w'
        ? ('mean4w' in result ? result.mean4w : null)
        : result[field];
      const dates: NamedDataDateV1[] = [];
      if (comparisonDateRoles.includes('section')) dates.push({ role: 'section', value: result.dataDate });
      if (comparisonDateRoles.includes('volume')) dates.push({ role: 'volume', value: result.volumeDataDate });
      return scalarFound(
        snapshot,
        'supplyDemand',
        value,
        snapshot.units.supplyDemand[field] ?? null,
        dates,
        [],
        [field],
      );
    },
  });
}

const supplyDemandDefinitions: readonly InternalDefinitionV1[] = [
  supplyDemandDefinition('buyingBalance'),
  supplyDemandDefinition('sellingBalance'),
  supplyDemandDefinition('marginRatio'),
  supplyDemandDefinition('buyingBalanceWeeklyChange'),
  supplyDemandDefinition('sellingBalanceWeeklyChange'),
  supplyDemandDefinition('mean4w'),
  supplyDemandDefinition('mean13w'),
  supplyDemandDefinition('mean52w'),
  supplyDemandDefinition('deviation52w'),
  supplyDemandDefinition('percentile52w'),
  supplyDemandDefinition('averageDailyVolume20'),
  supplyDemandDefinition('digestionDays'),
];

const WINDOW_PERIODS = [20, 60, 250] as const;
type WindowPeriod = (typeof WINDOW_PERIODS)[number];
type WindowMetric =
  | 'observations'
  | 'correlation'
  | 'beta'
  | 'alphaAnnualized'
  | 'rSquared'
  | 'stockVolatilityAnnualized'
  | 'benchmarkVolatilityAnnualized'
  | 'excessReturn';

function windowInstances(
  introducedInSnapshotVersion: (period: WindowPeriod) => ComparisonIntroductionVersionV1,
): readonly ComparisonInstanceDefinitionV1[] {
  return WINDOW_PERIODS.map(period => ({
    identity: identity(['period', period]),
    introducedInSnapshotVersion: introducedInSnapshotVersion(period),
  }));
}

function marketCorrelationWindowInstances(): readonly ComparisonInstanceDefinitionV1[] {
  return windowInstances(period => period === 20 ? 3 : 1);
}

function sectorBenchmarkWindowInstances(): readonly ComparisonInstanceDefinitionV1[] {
  return windowInstances(() => 6);
}

function instancePeriod(instance: ComparisonInstanceDefinitionV1): WindowPeriod {
  const value = instance.identity.find(item => item.name === 'period')?.value;
  if (value !== 20 && value !== 60 && value !== 250) throw new ComparisonCorruptSnapshotError();
  return value;
}

function windowInstanceCompare(
  left: ComparisonInstanceDefinitionV1,
  right: ComparisonInstanceDefinitionV1,
): number {
  return WINDOW_PERIODS.indexOf(instancePeriod(left)) - WINDOW_PERIODS.indexOf(instancePeriod(right));
}

function marketCorrelationDefinition(metric: Exclude<WindowMetric,
  'stockVolatilityAnnualized' | 'benchmarkVolatilityAnnualized' | 'excessReturn'>): InternalDefinitionV1 {
  return createDefinition({
    key: `marketCorrelation.window.${metric}` as ComparisonMetricKeyV1,
    section: 'marketCorrelation',
    introducedInSnapshotVersion: 1,
    valueKind: 'number',
    expectedUnit: metric === 'observations' ? 'count' : 'ratio',
    readActualUnit: snapshot => snapshot.units.marketCorrelation[metric] ?? null,
    displaySemantics: metric === 'alphaAnnualized' ? 'fraction_as_percent' : 'native',
    comparisonDateRoles: ['section', 'window_start', 'window_end'],
    identityRules: [
      { name: 'period', reason: 'window_changed' },
      { name: 'benchmark', reason: 'benchmark_changed' },
    ],
    allowedUnavailableReasons: [
      'insufficient_history', 'zero_stock_variance', 'zero_benchmark_variance',
    ],
    resolveInstances: marketCorrelationWindowInstances,
    compareInstances: windowInstanceCompare,
    resolveValue: (snapshot, instance) => {
      const result = snapshot.marketCorrelation;
      if (result === null) throw new ComparisonCorruptSnapshotError();
      const period = instancePeriod(instance);
      const matches = result.windows.filter(window => window.period === period);
      const observationIdentity = identity(['benchmark', result.benchmark], ['period', period]);
      if (matches.length > 1) {
        return { kind: 'ambiguous', identity: instance.identity, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        return {
          kind: 'absent',
          identity: observationIdentity,
          missingAsUnavailable: true,
          actualUnit: snapshot.units.marketCorrelation[metric] ?? null,
          dataDates: [
            { role: 'section', value: result.dataDate },
            { role: 'window_start', value: null },
            { role: 'window_end', value: null },
          ],
          provenance: sectionProvenance(snapshot, 'marketCorrelation'),
        };
      }
      const window = matches[0];
      return scalarFound(
        snapshot,
        'marketCorrelation',
        window[metric],
        snapshot.units.marketCorrelation[metric] ?? null,
        [
          { role: 'section', value: result.dataDate },
          { role: 'window_start', value: window.startDate },
          { role: 'window_end', value: window.endDate },
        ],
        observationIdentity,
        [`${period}.${metric}`],
      );
    },
  });
}

const marketCorrelationDefinitions: readonly InternalDefinitionV1[] = [
  marketCorrelationDefinition('observations'),
  marketCorrelationDefinition('correlation'),
  marketCorrelationDefinition('beta'),
  marketCorrelationDefinition('alphaAnnualized'),
  marketCorrelationDefinition('rSquared'),
];

function sectorBenchmarkDefinition(metric: WindowMetric): InternalDefinitionV1 {
  return createDefinition({
    key: `sectorBenchmark.window.${metric}` as ComparisonMetricKeyV1,
    section: 'sectorBenchmark',
    introducedInSnapshotVersion: 6,
    valueKind: 'number',
    expectedUnit: metric === 'observations' ? 'count' : 'ratio',
    readActualUnit: snapshot => 'sectorBenchmark' in snapshot.units
      ? snapshot.units.sectorBenchmark[metric] ?? null
      : null,
    displaySemantics: [
      'alphaAnnualized', 'stockVolatilityAnnualized',
      'benchmarkVolatilityAnnualized', 'excessReturn',
    ].includes(metric) ? 'fraction_as_percent' : 'native',
    comparisonDateRoles: ['analysis_as_of', 'section', 'window_start', 'window_end'],
    identityRules: [
      { name: 'period', reason: 'window_changed' },
      { name: 'benchmarkType', reason: 'benchmark_changed' },
      { name: 'sectorCode', reason: 'benchmark_changed' },
      { name: 'indexCode', reason: 'benchmark_changed' },
      { name: 'calculationSource', reason: 'method_changed' },
    ],
    allowedUnavailableReasons: [
      'insufficient_history', 'zero_stock_variance', 'zero_benchmark_variance',
    ],
    resolveInstances: sectorBenchmarkWindowInstances,
    compareInstances: windowInstanceCompare,
    resolveValue: (snapshot, instance) => {
      if (!('sectorBenchmark' in snapshot) || snapshot.sectorBenchmark === null) {
        throw new ComparisonCorruptSnapshotError();
      }
      const result = snapshot.sectorBenchmark;
      const period = instancePeriod(instance);
      const matches = result.windows.filter(window => window.period === period);
      const observationIdentity = identity(
        ['period', period],
        ['benchmarkType', result.benchmark?.type ?? null],
        ['sectorCode', result.benchmark?.sectorCode ?? null],
        ['indexCode', result.benchmark?.indexCode ?? null],
        ['calculationSource', result.provenance.calculation.source],
      );
      if (matches.length > 1) {
        return { kind: 'ambiguous', identity: instance.identity, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        const sectionReasons = storedSectionReasons(snapshot, 'sectorBenchmark')
          .filter(reason => reason.reason !== 'not_collected');
        return {
          kind: 'absent',
          identity: observationIdentity,
          missingAsUnavailable: true,
          actualUnit: snapshot.units.sectorBenchmark[metric] ?? null,
          dataDates: [
            { role: 'analysis_as_of', value: result.analysisAsOfDate },
            { role: 'section', value: result.dataDate },
            { role: 'window_start', value: null },
            { role: 'window_end', value: null },
          ],
          provenance: sectionProvenance(snapshot, 'sectorBenchmark'),
          directReasons: sectionReasons.length > 0 ? sectionReasons : undefined,
        };
      }
      if (result.benchmark === null) throw new ComparisonCorruptSnapshotError();
      const window = matches[0];
      return scalarFound(
        snapshot,
        'sectorBenchmark',
        window[metric],
        snapshot.units.sectorBenchmark[metric] ?? null,
        [
          { role: 'analysis_as_of', value: result.analysisAsOfDate },
          { role: 'section', value: result.dataDate },
          { role: 'window_start', value: window.startDate },
          { role: 'window_end', value: window.endDate },
        ],
        observationIdentity,
        [`${period}.${metric}`],
      );
    },
  });
}

const sectorBenchmarkDefinitions: readonly InternalDefinitionV1[] = [
  sectorBenchmarkDefinition('observations'),
  sectorBenchmarkDefinition('correlation'),
  sectorBenchmarkDefinition('beta'),
  sectorBenchmarkDefinition('alphaAnnualized'),
  sectorBenchmarkDefinition('rSquared'),
  sectorBenchmarkDefinition('stockVolatilityAnnualized'),
  sectorBenchmarkDefinition('benchmarkVolatilityAnnualized'),
  sectorBenchmarkDefinition('excessReturn'),
];

const STRATEGY_UNAVAILABLE_REASONS = [
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
] as const;

function strategyEntryDefinition(
  field: 'triggerPrice' | 'price',
): InternalDefinitionV1 {
  const allowedReasons = field === 'triggerPrice'
    ? ['missing_or_invalid_swing_high']
    : ['missing_tick_size_for_executable_entry', 'missing_entry'];
  return createDefinition({
    key: `strategy.entry.${field}` as ComparisonMetricKeyV1,
    section: 'strategy',
    introducedInSnapshotVersion: 1,
    valueKind: 'number',
    expectedUnit: 'JPY',
    readActualUnit: snapshot => snapshot.units.strategy[field] ?? null,
    displaySemantics: 'native',
    comparisonDateRoles: ['section'],
    identityRules: [
      { name: 'entry.reason', reason: 'identity_changed' },
      { name: 'entry.trigger', reason: 'identity_changed' },
    ],
    allowedUnavailableReasons: allowedReasons,
    resolveValue: (snapshot) => {
      const result = snapshot.strategy;
      if (result === null) throw new ComparisonCorruptSnapshotError();
      const entryIdentity = identity(
        ['entry.reason', result.entry?.reason ?? 'breakout_above_swing_high'],
        ['entry.trigger', result.entry?.trigger ?? 'strictly_above'],
      );
      return scalarFound(
        snapshot,
        'strategy',
        result.entry?.[field] ?? null,
        snapshot.units.strategy[field] ?? null,
        [{ role: 'section', value: result.dataDate }],
        entryIdentity,
        ['entry'],
      );
    },
  });
}

function strategyCandidateIdentity(candidate: NonNullable<AnalysisSnapshot['strategy']>['candidates'][number]): ComparisonInstanceIdentityV1 {
  return identity(
    ['entry.reason', candidate.entry.reason],
    ['stop.reason', candidate.stop.reason],
    ['target.reason', candidate.target.reason],
  );
}

function strategyCandidateInstances(snapshot: AnalysisSnapshot): readonly ComparisonInstanceDefinitionV1[] {
  const candidates = snapshot.strategy?.candidates
    .filter(candidate => candidate.target.reason === 'risk_reward_2R') ?? [];
  const byIdentity = new Map<string, ComparisonInstanceDefinitionV1>();
  for (const candidate of candidates) {
    const candidateIdentity = strategyCandidateIdentity(candidate);
    byIdentity.set(identityKey(candidateIdentity), {
      identity: candidateIdentity,
      introducedInSnapshotVersion: 1,
    });
  }
  return [...byIdentity.values()].sort(defaultInstanceCompare);
}

type StrategyCandidateField = 'entry.price' | 'stop.price' | 'target.price' | 'rewardRisk';

function strategyCandidateDefinition(field: StrategyCandidateField): InternalDefinitionV1 {
  const expectedUnit = field === 'rewardRisk' ? 'ratio' : 'JPY';
  return createDefinition({
    key: `strategy.candidate.${field}` as ComparisonMetricKeyV1,
    section: 'strategy',
    introducedInSnapshotVersion: 1,
    valueKind: 'number',
    expectedUnit,
    readActualUnit: snapshot => snapshot.units.strategy[field === 'rewardRisk' ? 'rewardRisk' : 'price'] ?? null,
    displaySemantics: 'native',
    comparisonDateRoles: ['section'],
    identityRules: [
      { name: 'entry.reason', reason: 'identity_changed' },
      { name: 'stop.reason', reason: 'identity_changed' },
      { name: 'target.reason', reason: 'identity_changed' },
    ],
    allowedUnavailableReasons: STRATEGY_UNAVAILABLE_REASONS,
    resolveInstances: strategyCandidateInstances,
    resolveValue: (snapshot, instance) => {
      const result = snapshot.strategy;
      if (result === null) throw new ComparisonCorruptSnapshotError();
      const requestedKey = identityKey(instance.identity);
      const matches = result.candidates.filter(candidate => (
        candidate.target.reason === 'risk_reward_2R'
        && identityKey(strategyCandidateIdentity(candidate)) === requestedKey
      ));
      if (matches.length > 1) {
        return { kind: 'ambiguous', identity: instance.identity, candidateCount: matches.length };
      }
      if (matches.length === 0) return { kind: 'absent', identity: instance.identity };
      const candidate = matches[0];
      let value: number;
      let unitKey: string;
      if (field === 'entry.price') {
        value = candidate.entry.price;
        unitKey = 'price';
      } else if (field === 'stop.price') {
        value = candidate.stop.price;
        unitKey = 'price';
      } else if (field === 'target.price') {
        value = candidate.target.price;
        unitKey = 'price';
      } else {
        value = candidate.rewardRisk;
        unitKey = 'rewardRisk';
      }
      return scalarFound(
        snapshot,
        'strategy',
        value,
        snapshot.units.strategy[unitKey] ?? null,
        [{ role: 'section', value: result.dataDate }],
        instance.identity,
        [],
      );
    },
  });
}

const strategyDefinitions: readonly InternalDefinitionV1[] = [
  strategyEntryDefinition('triggerPrice'),
  strategyEntryDefinition('price'),
  strategyCandidateDefinition('entry.price'),
  strategyCandidateDefinition('stop.price'),
  strategyCandidateDefinition('target.price'),
  strategyCandidateDefinition('rewardRisk'),
];

function identityMember(
  instance: ComparisonInstanceDefinitionV1,
  name: string,
): string | number | boolean | null {
  const matches = instance.identity.filter(item => item.name === name);
  if (matches.length !== 1) throw new ComparisonCorruptSnapshotError();
  return matches[0].value;
}

type AdvancedDividendResult = NonNullable<
  Extract<AnalysisSnapshot, { schemaVersion: 8 | 9 }>['advancedDividend']
>;
type DividendFiscal = AdvancedDividendResult['observations'][number];
type DividendEvent = NonNullable<AdvancedDividendResult['events']>[number];

function dividendFiscalIdentity(observation: DividendFiscal): ComparisonInstanceIdentityV1 {
  return identity(
    ['kind', observation.kind],
    ['fiscalYearEndDate', observation.fiscalYearEndDate],
  );
}

function fiscalInstanceCompare(
  left: ComparisonInstanceDefinitionV1,
  right: ComparisonInstanceDefinitionV1,
): number {
  const leftDate = identityMember(left, 'fiscalYearEndDate');
  const rightDate = identityMember(right, 'fiscalYearEndDate');
  if (typeof leftDate !== 'string' || typeof rightDate !== 'string') {
    throw new ComparisonCorruptSnapshotError();
  }
  if (leftDate !== rightDate) return leftDate > rightDate ? -1 : 1;
  const leftKind = identityMember(left, 'kind');
  const rightKind = identityMember(right, 'kind');
  const order = (value: string | number | boolean | null) => value === 'actual' ? 0 : 1;
  return order(leftKind) - order(rightKind);
}

function dividendFiscalInstances(snapshot: AnalysisSnapshot): readonly ComparisonInstanceDefinitionV1[] {
  if (!('advancedDividend' in snapshot) || snapshot.advancedDividend === null) return [];
  const byIdentity = new Map<string, ComparisonInstanceDefinitionV1>();
  for (const observation of snapshot.advancedDividend.observations) {
    const observationIdentity = dividendFiscalIdentity(observation);
    byIdentity.set(identityKey(observationIdentity), {
      identity: observationIdentity,
      introducedInSnapshotVersion: 8,
    });
  }
  return [...byIdentity.values()].sort(fiscalInstanceCompare);
}

function dividendFiscalDefinition(
  field: 'annualDividendPerShare' | 'payoutRatio',
): InternalDefinitionV1 {
  const isPayout = field === 'payoutRatio';
  const sourceFieldName = isPayout ? 'payoutRatioSourceField' : 'sourceField';
  return createDefinition({
    key: `advancedDividend.fiscal.${field}` as ComparisonMetricKeyV1,
    section: 'advancedDividend',
    introducedInSnapshotVersion: 8,
    valueKind: 'number',
    expectedUnit: isPayout ? 'ratio' : 'JPY_per_share',
    readActualUnit: snapshot => 'advancedDividend' in snapshot.units
      ? snapshot.units.advancedDividend[isPayout ? 'payoutRatio' : 'dividendPerShare'] ?? null
      : null,
    displaySemantics: isPayout ? 'fraction_as_percent' : 'native',
    comparisonDateRoles: ['source_eligible', 'disclosed'],
    identityRules: [
      { name: 'kind', reason: 'period_changed' },
      { name: 'fiscalYearEndDate', reason: 'period_changed' },
      { name: sourceFieldName, reason: 'method_changed' },
    ],
    allowedUnavailableReasons: [
      'no_eligible_dividend_disclosure_data', 'availability_calendar_unavailable',
      'missing_data', 'invalid_data',
    ],
    resolveInstances: dividendFiscalInstances,
    compareInstances: fiscalInstanceCompare,
    resolveValue: (snapshot, instance) => {
      if (!('advancedDividend' in snapshot) || snapshot.advancedDividend === null) {
        throw new ComparisonCorruptSnapshotError();
      }
      const result = snapshot.advancedDividend;
      const requestedKey = identityKey(instance.identity);
      const matches = result.observations.filter(observation => (
        identityKey(dividendFiscalIdentity(observation)) === requestedKey
      ));
      if (matches.length > 1) {
        return { kind: 'ambiguous', identity: instance.identity, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        const hasCoreReason = result.unavailable.some(item => item.scope === 'core');
        return result.observations.length === 0 && hasCoreReason
          ? {
              kind: 'absent', identity: instance.identity, missingAsUnavailable: true,
              actualUnit: snapshot.units.advancedDividend[isPayout ? 'payoutRatio' : 'dividendPerShare'] ?? null,
              dataDates: [
                { role: 'source_eligible', value: null },
                { role: 'disclosed', value: null },
              ],
              provenance: sectionProvenance(snapshot, 'advancedDividend'),
              reasonMetrics: ['core'],
            }
          : { kind: 'absent', identity: instance.identity };
      }
      const observation = matches[0];
      return scalarFound(
        snapshot,
        'advancedDividend',
        observation[field],
        snapshot.units.advancedDividend[isPayout ? 'payoutRatio' : 'dividendPerShare'] ?? null,
        [
          { role: 'source_eligible', value: observation.sourceEligibleDate },
          { role: 'disclosed', value: observation.disclosedDate },
        ],
        identity(
          ...instance.identity.map(item => [item.name, item.value] as [string, typeof item.value]),
          [sourceFieldName, observation[sourceFieldName]],
        ),
        observation[field] === null ? ['core'] : [],
      );
    },
  });
}

function dividendEventIdentity(event: DividendEvent): ComparisonInstanceIdentityV1 {
  return identity(
    ['corporateActionReferenceNumber', event.corporateActionReferenceNumber],
    ['kind', event.kind],
    ['recordDateYearMonth', event.recordDateYearMonth],
  );
}

function dividendEventInstanceCompare(
  left: ComparisonInstanceDefinitionV1,
  right: ComparisonInstanceDefinitionV1,
): number {
  const leftPeriod = identityMember(left, 'recordDateYearMonth');
  const rightPeriod = identityMember(right, 'recordDateYearMonth');
  if (typeof leftPeriod !== 'string' || typeof rightPeriod !== 'string') {
    throw new ComparisonCorruptSnapshotError();
  }
  if (leftPeriod !== rightPeriod) return leftPeriod > rightPeriod ? -1 : 1;
  const kindOrder = (value: string | number | boolean | null) => value === 'interim' ? 0 : 1;
  const kindDifference = kindOrder(identityMember(left, 'kind')) - kindOrder(identityMember(right, 'kind'));
  if (kindDifference !== 0) return kindDifference;
  const leftReference = identityMember(left, 'corporateActionReferenceNumber');
  const rightReference = identityMember(right, 'corporateActionReferenceNumber');
  if (typeof leftReference !== 'string' || typeof rightReference !== 'string') {
    throw new ComparisonCorruptSnapshotError();
  }
  return leftReference < rightReference ? -1 : leftReference > rightReference ? 1 : 0;
}

function dividendEventInstances(snapshot: AnalysisSnapshot): readonly ComparisonInstanceDefinitionV1[] {
  if (!('advancedDividend' in snapshot) || snapshot.advancedDividend?.events == null) return [];
  const byIdentity = new Map<string, ComparisonInstanceDefinitionV1>();
  for (const event of snapshot.advancedDividend.events) {
    const eventIdentity = dividendEventIdentity(event);
    byIdentity.set(identityKey(eventIdentity), {
      identity: eventIdentity,
      introducedInSnapshotVersion: 8,
    });
  }
  return [...byIdentity.values()].sort(dividendEventInstanceCompare);
}

type DividendEventField =
  | 'dividendPerShare'
  | 'ordinaryDividendPerShare'
  | 'commemorativeDividendPerShare'
  | 'specialDividendPerShare';

function dividendEventDefinition(field: DividendEventField): InternalDefinitionV1 {
  const scope = field === 'dividendPerShare' ? 'event' : 'component';
  const eventCollectionReasons = [
    'no_eligible_dividend_event_data', 'event_source_plan_unavailable',
    'availability_calendar_unavailable', 'missing_data', 'invalid_data',
  ];
  const allowedReasons = scope === 'event'
    ? eventCollectionReasons
    : [...eventCollectionReasons, 'component_breakdown_unavailable'];
  return createDefinition({
    key: `advancedDividend.event.${field}` as ComparisonMetricKeyV1,
    section: 'advancedDividend',
    introducedInSnapshotVersion: 8,
    valueKind: 'number',
    expectedUnit: 'JPY_per_share',
    readActualUnit: snapshot => 'advancedDividend' in snapshot.units
      ? snapshot.units.advancedDividend.dividendPerShare ?? null
      : null,
    displaySemantics: 'native',
    comparisonDateRoles: ['source_eligible', 'notified'],
    identityRules: [
      { name: 'corporateActionReferenceNumber', reason: 'identity_changed' },
      { name: 'kind', reason: 'period_changed' },
      { name: 'recordDateYearMonth', reason: 'period_changed' },
      { name: 'decision', reason: 'method_changed' },
    ],
    allowedUnavailableReasons: allowedReasons,
    resolveInstances: dividendEventInstances,
    compareInstances: dividendEventInstanceCompare,
    resolveValue: (snapshot, instance) => {
      if (!('advancedDividend' in snapshot) || snapshot.advancedDividend === null) {
        throw new ComparisonCorruptSnapshotError();
      }
      const result = snapshot.advancedDividend;
      const events = result.events;
      const requestedKey = identityKey(instance.identity);
      const matches = events?.filter(event => identityKey(dividendEventIdentity(event)) === requestedKey) ?? [];
      if (matches.length > 1) {
        return { kind: 'ambiguous', identity: instance.identity, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        return events === null
          ? {
              kind: 'absent', identity: instance.identity, missingAsUnavailable: true,
              actualUnit: snapshot.units.advancedDividend.dividendPerShare ?? null,
              dataDates: [
                { role: 'source_eligible', value: null },
                { role: 'notified', value: null },
              ],
              provenance: sectionProvenance(snapshot, 'advancedDividend'),
              reasonMetrics: ['event'],
            }
          : { kind: 'absent', identity: instance.identity };
      }
      const event = matches[0];
      return scalarFound(
        snapshot,
        'advancedDividend',
        event[field],
        snapshot.units.advancedDividend.dividendPerShare ?? null,
        [
          { role: 'source_eligible', value: event.sourceEligibleDate },
          { role: 'notified', value: event.notifiedDate },
          { role: 'record', value: event.recordDate },
          { role: 'rights_record', value: event.rightsRecordDate },
          { role: 'ex', value: event.exDate },
          { role: 'payment', value: event.paymentDate },
        ],
        identity(
          ...instance.identity.map(item => [item.name, item.value] as [string, typeof item.value]),
          ['decision', event.decision],
        ),
        event[field] === null ? [scope] : [],
      );
    },
  });
}

const advancedDividendDefinitions: readonly InternalDefinitionV1[] = [
  dividendFiscalDefinition('annualDividendPerShare'),
  dividendFiscalDefinition('payoutRatio'),
  dividendEventDefinition('dividendPerShare'),
  dividendEventDefinition('ordinaryDividendPerShare'),
  dividendEventDefinition('commemorativeDividendPerShare'),
  dividendEventDefinition('specialDividendPerShare'),
];

type VolumeProfileField = 'poc.price' | 'valueArea.val' | 'valueArea.vah';

function volumeProfileDefinition(field: VolumeProfileField): InternalDefinitionV1 {
  return createDefinition({
    key: `volumeProfile.${field}` as ComparisonMetricKeyV1,
    section: 'volumeProfile',
    introducedInSnapshotVersion: 9,
    valueKind: 'number',
    expectedUnit: 'JPY',
    readActualUnit: snapshot => 'volumeProfile' in snapshot.units
      ? snapshot.units.volumeProfile.price ?? null
      : null,
    displaySemantics: 'native',
    comparisonDateRoles: ['section', 'window_start', 'window_end'],
    identityRules: [
      { name: 'methodology.id', reason: 'method_changed' },
      { name: 'allocationMethod', reason: 'method_changed' },
      { name: 'binningMethod.id', reason: 'method_changed' },
      { name: 'binningMethod.requestedBinCount', reason: 'method_changed' },
      { name: 'priceBasis', reason: 'method_changed' },
      { name: 'volumeBasis', reason: 'method_changed' },
      { name: 'targetVolumeShare', reason: 'method_changed' },
      { name: 'inputBarCount', reason: 'window_changed' },
    ],
    allowedUnavailableReasons: [
      'insufficient_history', 'missing_price_data', 'missing_volume_data',
      'invalid_price_data', 'invalid_volume_data', 'invalid_bar_geometry',
      'invalid_chronology', 'zero_total_volume', 'no_price_data',
      'corporate_action_basis_unavailable', 'invalid_input',
    ],
    resolveValue: (snapshot) => {
      if (!('volumeProfile' in snapshot) || snapshot.volumeProfile === null) {
        throw new ComparisonCorruptSnapshotError();
      }
      const result = snapshot.volumeProfile;
      let value: number | null;
      if (field === 'poc.price') value = result.poc?.price ?? null;
      else if (field === 'valueArea.val') value = result.valueArea?.val ?? null;
      else value = result.valueArea?.vah ?? null;
      return scalarFound(
        snapshot,
        'volumeProfile',
        value,
        result.units.price,
        [
          { role: 'section', value: result.dataDate },
          { role: 'window_start', value: result.windowStartDate },
          { role: 'window_end', value: result.windowEndDate },
        ],
        identity(
          ['methodology.id', result.methodology.id],
          ['allocationMethod', result.allocationMethod],
          ['binningMethod.id', result.binningMethod.id],
          ['binningMethod.requestedBinCount', result.binningMethod.requestedBinCount],
          ['priceBasis', result.priceBasis],
          ['volumeBasis', result.volumeBasis],
          ['targetVolumeShare', result.valueArea?.targetVolumeShare ?? null],
          ['inputBarCount', result.inputBarCount],
        ),
        ['profile'],
      );
    },
  });
}

const volumeProfileDefinitions: readonly InternalDefinitionV1[] = [
  volumeProfileDefinition('poc.price'),
  volumeProfileDefinition('valueArea.val'),
  volumeProfileDefinition('valueArea.vah'),
];

const internalRegistry: readonly InternalDefinitionV1[] = [
  ...valuationDefinitions,
  ...fundamentalDefinitions,
  ...technicalDefinitions,
  ...advancedTechnicalDefinitions,
  ...supplyDemandDefinitions,
  ...marketCorrelationDefinitions,
  ...sectorBenchmarkDefinitions,
  ...strategyDefinitions,
  ...advancedDividendDefinitions,
  ...volumeProfileDefinitions,
];

function assertRegistryContract(): void {
  if (internalRegistry.length !== COMPARISON_METRIC_KEYS.length || internalRegistry.length !== 67) {
    throw new Error('Comparison registry V1 must contain exactly 67 definitions.');
  }
  const keys = internalRegistry.map(definition => definition.key);
  if (new Set(keys).size !== keys.length) throw new Error('Comparison registry V1 keys must be unique.');
  for (let index = 0; index < COMPARISON_METRIC_KEYS.length; index += 1) {
    if (keys[index] !== COMPARISON_METRIC_KEYS[index]) {
      throw new Error('Comparison registry V1 definition order does not match its public key contract.');
    }
  }
  const sections = new Set(COMPARISON_SECTIONS);
  if (internalRegistry.some(definition => !sections.has(definition.section))) {
    throw new Error('Comparison registry V1 contains an unsupported section.');
  }
}

assertRegistryContract();

export const COMPARISON_METRIC_REGISTRY_V1: readonly ComparisonMetricDefinitionV1[] = internalRegistry;

const definitionByKey = new Map(internalRegistry.map(definition => [definition.key, definition]));

export function comparisonMetricDefinitionV1(key: ComparisonMetricKeyV1): ComparisonMetricDefinitionV1 {
  const definition = definitionByKey.get(key);
  if (definition === undefined) throw new RangeError(`Unknown Comparison registry V1 key: ${key}`);
  return definition;
}

export function resolveComparisonInstancesV1(
  key: ComparisonMetricKeyV1,
  base: AnalysisSnapshot,
  target: AnalysisSnapshot,
): readonly ComparisonInstanceDefinitionV1[] {
  const definition = definitionByKey.get(key);
  if (definition === undefined) throw new ComparisonCorruptSnapshotError();
  const instances = new Map<string, ComparisonInstanceDefinitionV1>();
  for (const snapshot of [base, target]) {
    for (const instance of definition.resolveInstances(snapshot)) {
      const keyValue = identityKey(instance.identity);
      const existing = instances.get(keyValue);
      if (
        existing !== undefined
        && existing.introducedInSnapshotVersion !== instance.introducedInSnapshotVersion
      ) {
        throw new ComparisonCorruptSnapshotError();
      }
      instances.set(keyValue, instance);
    }
  }
  return [...instances.values()].sort(definition.compareInstances);
}
