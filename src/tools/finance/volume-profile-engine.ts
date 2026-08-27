import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';

export const VOLUME_PROFILE_BIN_COUNT = 50 as const;

export const VOLUME_PROFILE_ALLOCATION_METHOD = 'uniform_range_overlap_v1' as const;
export const VOLUME_PROFILE_BINNING_METHOD = 'fixed_count_linear_v1' as const;

export interface VolumeProfileAllocationBar {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface VolumeProfileAllocationBin {
  index: number;
  lowerPrice: number;
  upperPrice: number;
  representativePrice: number;
  allocatedVolume: number;
}

export interface VolumeProfileAllocation {
  minPrice: number;
  maxPrice: number;
  binWidth: number;
  requestedBinCount: typeof VOLUME_PROFILE_BIN_COUNT;
  effectiveBinCount: number;
  totalInputVolume: number;
  bins: VolumeProfileAllocationBin[];
}

export type VolumeProfileAllocationInputIssue =
  | 'invalid_input'
  | 'missing_price_data'
  | 'missing_volume_data'
  | 'invalid_price_data'
  | 'invalid_volume_data'
  | 'invalid_bar_geometry';

export class VolumeProfileAllocationInputError extends RangeError {
  constructor(
    public readonly issue: VolumeProfileAllocationInputIssue,
    public readonly barIndex: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'VolumeProfileAllocationInputError';
  }
}

interface ValidatedVolumeProfileAllocationBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function normalizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateBar(
  bar: VolumeProfileAllocationBar,
  barIndex: number,
): ValidatedVolumeProfileAllocationBar {
  if (bar.open === null || bar.high === null || bar.low === null || bar.close === null) {
    throw new VolumeProfileAllocationInputError(
      'missing_price_data',
      barIndex,
      `Bar ${barIndex} has missing adjusted price data.`,
    );
  }
  const prices = [bar.open, bar.high, bar.low, bar.close];
  if (!prices.every((price) => Number.isFinite(price) && price > 0)) {
    throw new VolumeProfileAllocationInputError(
      'invalid_price_data',
      barIndex,
      `Bar ${barIndex} has invalid adjusted price data.`,
    );
  }
  if (bar.volume === null) {
    throw new VolumeProfileAllocationInputError(
      'missing_volume_data',
      barIndex,
      `Bar ${barIndex} has missing adjusted volume data.`,
    );
  }
  if (!Number.isFinite(bar.volume) || bar.volume < 0) {
    throw new VolumeProfileAllocationInputError(
      'invalid_volume_data',
      barIndex,
      `Bar ${barIndex} has invalid adjusted volume data.`,
    );
  }
  if (
    bar.high < bar.low
    || bar.open < bar.low
    || bar.open > bar.high
    || bar.close < bar.low
    || bar.close > bar.high
  ) {
    throw new VolumeProfileAllocationInputError(
      'invalid_bar_geometry',
      barIndex,
      `Bar ${barIndex} has invalid adjusted OHLC geometry.`,
    );
  }

  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

export function volumeProfileConservationTolerance(totalVolume: number): number {
  return Math.max(1e-8, totalVolume * 1e-12);
}

function createBins(minPrice: number, maxPrice: number): VolumeProfileAllocationBin[] {
  if (minPrice === maxPrice) {
    return [{
      index: 0,
      lowerPrice: normalizeNegativeZero(minPrice),
      upperPrice: normalizeNegativeZero(maxPrice),
      representativePrice: normalizeNegativeZero(minPrice),
      allocatedVolume: 0,
    }];
  }

  const binWidth = (maxPrice - minPrice) / VOLUME_PROFILE_BIN_COUNT;
  return Array.from({ length: VOLUME_PROFILE_BIN_COUNT }, (_, index) => {
    const lowerPrice = minPrice + index * binWidth;
    const upperPrice = index === VOLUME_PROFILE_BIN_COUNT - 1
      ? maxPrice
      : minPrice + (index + 1) * binWidth;
    return {
      index,
      lowerPrice: normalizeNegativeZero(lowerPrice),
      upperPrice: normalizeNegativeZero(upperPrice),
      representativePrice: normalizeNegativeZero((lowerPrice + upperPrice) / 2),
      allocatedVolume: 0,
    };
  });
}

function findContainingBinIndex(
  price: number,
  bins: readonly VolumeProfileAllocationBin[],
): number {
  const binIndex = bins.findIndex((bin, index) => (
    price >= bin.lowerPrice
    && (index === bins.length - 1 ? price <= bin.upperPrice : price < bin.upperPrice)
  ));
  if (binIndex === -1) {
    throw new Error('Flat-bar price is outside the constructed volume-profile bins.');
  }
  return binIndex;
}

function addAllocation(bin: VolumeProfileAllocationBin, volume: number): void {
  bin.allocatedVolume = normalizeNegativeZero(bin.allocatedVolume + volume);
}

function allocateBar(
  bar: Readonly<ValidatedVolumeProfileAllocationBar>,
  bins: VolumeProfileAllocationBin[],
): void {
  if (bar.volume === 0) return;

  if (bar.high === bar.low) {
    const binIndex = bins.length === 1
      ? 0
      : findContainingBinIndex(bar.low, bins);
    addAllocation(bins[binIndex], bar.volume);
    return;
  }

  const intersectedBins = bins.filter((bin) => (
    Math.min(bar.high, bin.upperPrice) - Math.max(bar.low, bin.lowerPrice) > 0
  ));
  let alreadyAllocated = 0;

  for (let index = 0; index < intersectedBins.length; index += 1) {
    const bin = intersectedBins[index];
    const isFinalBin = index === intersectedBins.length - 1;
    const overlap = Math.max(
      0,
      Math.min(bar.high, bin.upperPrice) - Math.max(bar.low, bin.lowerPrice),
    );
    const allocatedVolume = isFinalBin
      ? bar.volume - alreadyAllocated
      : bar.volume * overlap / (bar.high - bar.low);
    addAllocation(bin, allocatedVolume);
    alreadyAllocated += allocatedVolume;
  }
}

/**
 * Build fixed linear bins and allocate adjusted daily volume uniformly over each
 * supplied adjusted low-high range. Window selection and profile metrics belong to
 * the aggregate engine, not this helper.
 */
export function allocateVolumeProfile(
  bars: readonly VolumeProfileAllocationBar[],
): VolumeProfileAllocation {
  if (bars.length === 0) {
    throw new VolumeProfileAllocationInputError(
      'invalid_input',
      null,
      'At least one adjusted OHLCV bar is required.',
    );
  }

  const validBars = bars.map(validateBar);
  const minPrice = Math.min(...validBars.map((bar) => bar.low));
  const maxPrice = Math.max(...validBars.map((bar) => bar.high));
  const binWidth = (maxPrice - minPrice) / VOLUME_PROFILE_BIN_COUNT;
  const bins = createBins(minPrice, maxPrice);
  const totalInputVolume = validBars.reduce((sum, bar) => sum + bar.volume, 0);

  for (const bar of validBars) {
    allocateBar(bar, bins);
  }

  const totalAllocatedVolume = bins.reduce((sum, bin) => sum + bin.allocatedVolume, 0);
  const tolerance = volumeProfileConservationTolerance(totalInputVolume);
  if (Math.abs(totalAllocatedVolume - totalInputVolume) > tolerance) {
    throw new Error('Volume-profile allocation failed to conserve adjusted volume.');
  }

  return {
    minPrice: normalizeNegativeZero(minPrice),
    maxPrice: normalizeNegativeZero(maxPrice),
    binWidth: normalizeNegativeZero(binWidth),
    requestedBinCount: VOLUME_PROFILE_BIN_COUNT,
    effectiveBinCount: bins.length,
    totalInputVolume: normalizeNegativeZero(totalInputVolume),
    bins,
  };
}

export const VOLUME_PROFILE_MINIMUM_BAR_COUNT = 60 as const;
export const VOLUME_PROFILE_MAXIMUM_BAR_COUNT = 120 as const;
export const VOLUME_PROFILE_VALUE_AREA_TARGET = 0.7 as const;

const verifiedVolumeProfileSource = Symbol('verifiedVolumeProfileSource');
const volumeProfileSourceAudit = Symbol('volumeProfileSourceAudit');
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TRADING_HOLIDAY_DIVISIONS = new Set(['1', '2']);
const OFFICIAL_HOLIDAY_DIVISIONS = new Set(['0', '1', '2', '3']);

export interface VolumeProfileSourceRow {
  Date: string;
  Code: string;
  AdjO: number | null;
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null;
  AdjVo: number | null;
  AdjFactor: number | null;
  ExRT: '1' | '2' | '3' | null;
}

export interface VolumeProfileSourceInputRow extends Omit<
  VolumeProfileSourceRow,
  'AdjFactor' | 'ExRT'
> {
  AdjFactor?: unknown;
  ExRT?: unknown;
}

export interface VolumeProfileAvailabilityCalendarDay {
  date: string;
  holidayDivision: string;
}

export interface VolumeProfileSourceInput {
  issuerCode: string;
  collectedAt: string;
  rows: readonly VolumeProfileSourceInputRow[];
  calendar: readonly VolumeProfileAvailabilityCalendarDay[];
  provenance: {
    source: 'jquants';
    endpoint: '/v2/equities/bars/daily';
    availabilityCalendarEndpoint: '/v2/markets/calendar';
    mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1';
    basisAudit: 'collection_horizon_rights_audit_v1';
  };
}

interface VolumeProfileSourceAuditState {
  collectionDate: string;
  calendarCoversCollectionDate: boolean;
  calendarSequenceComplete: boolean;
  calendarStartDate: string | null;
  tradingDates: readonly string[];
  unknownMetadataDates: readonly string[];
}

export type VolumeProfileSource = Readonly<{
  readonly [verifiedVolumeProfileSource]: true;
  readonly [volumeProfileSourceAudit]: VolumeProfileSourceAuditState;
  issuerCode: string;
  collectedAt: string;
  basisAuditRequiredThroughDate: string | null;
  basisAuditThroughDate: string | null;
  rows: readonly Readonly<VolumeProfileSourceRow>[];
  provenance: Readonly<{
    source: 'jquants';
    endpoint: '/v2/equities/bars/daily';
    availabilityCalendarEndpoint: '/v2/markets/calendar';
    mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1';
    basisAudit: 'collection_horizon_rights_audit_v1';
  }>;
}>;

export type VolumeProfileUnavailableReason =
  | 'insufficient_history'
  | 'missing_price_data'
  | 'missing_volume_data'
  | 'invalid_price_data'
  | 'invalid_volume_data'
  | 'invalid_bar_geometry'
  | 'invalid_chronology'
  | 'zero_total_volume'
  | 'no_price_data'
  | 'corporate_action_basis_unavailable'
  | 'invalid_input';

export interface VolumeProfileBin extends VolumeProfileAllocationBin {
  volumeShare: number;
}

export interface VolumeProfileResult {
  analysisAsOfDate: string;
  collectedAt: string;
  issuerCode: string;
  dataDate: string | null;
  windowStartDate: string | null;
  windowEndDate: string | null;
  inputBarCount: number;
  priceBasis: 'jquants_corporate_action_adjusted' | null;
  volumeBasis: 'jquants_corporate_action_adjusted' | null;
  allocationMethod: typeof VOLUME_PROFILE_ALLOCATION_METHOD;
  binningMethod: {
    id: typeof VOLUME_PROFILE_BINNING_METHOD;
    requestedBinCount: typeof VOLUME_PROFILE_BIN_COUNT;
    effectiveBinCount: number;
    minPrice: number | null;
    maxPrice: number | null;
  };
  bins: readonly VolumeProfileBin[] | null;
  poc: {
    binIndex: number;
    price: number;
    allocatedVolume: number;
    volumeShare: number;
  } | null;
  valueArea: {
    targetVolumeShare: typeof VOLUME_PROFILE_VALUE_AREA_TARGET;
    achievedVolumeShare: number;
    val: number;
    vah: number;
    firstBinIndex: number;
    lastBinIndex: number;
  } | null;
  unavailable: readonly {
    scope: 'profile';
    reason: VolumeProfileUnavailableReason;
  }[];
  methodology: {
    id: 'daily_ohlcv_volume_profile_proxy_v1';
    approximation: 'uniform_daily_range';
    actualHolderCostBasis: false;
  };
  provenance: {
    source: 'jquants';
    endpoint: '/v2/equities/bars/daily';
    availabilityCalendarEndpoint: '/v2/markets/calendar';
    sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1';
    adjustmentFactorField: 'AdjFactor';
    exRightsField: 'ExRT';
    basisAudit: 'collection_horizon_rights_audit_v1';
    basisAuditRequiredThroughDate: string | null;
    basisAuditThroughDate: string | null;
    corporateActionBasisStatus:
      | 'not_evaluated'
      | 'supported_common_basis_established'
      | 'rights_issue_unavailable'
      | 'unknown_basis_unavailable';
    calculation: 'volume_profile_engine';
  };
  units: {
    price: 'JPY';
    allocatedVolume: 'adjusted_shares';
    volumeShare: 'ratio';
  };
}

type CorporateActionBasisStatus = VolumeProfileResult['provenance']['corporateActionBasisStatus'];

export class VolumeProfileSourceValidationError extends Error {
  constructor(
    public readonly reason: 'invalid_input' | 'invalid_chronology',
    message: string,
  ) {
    super(message);
    this.name = 'VolumeProfileSourceValidationError';
  }
}

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function collectionDateInJapan(collectedAt: string): string | null {
  if (!UTC_TIMESTAMP_PATTERN.test(collectedAt)) return null;
  const parsed = new Date(collectedAt);
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp)) return null;
  const canonicalInput = collectedAt.includes('.')
    ? collectedAt
    : collectedAt.replace('Z', '.000Z');
  if (parsed.toISOString() !== canonicalInput) return null;
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isNextCalendarDate(previous: string, current: string): boolean {
  return Date.parse(`${current}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)
    === 24 * 60 * 60 * 1000;
}

function isNormalizedJQuantsCode(value: string): boolean {
  try {
    return toJQuantsSecuritiesCode(value) === value;
  } catch {
    return false;
  }
}

function invalidSource(
  reason: 'invalid_input' | 'invalid_chronology',
  message: string,
): never {
  throw new VolumeProfileSourceValidationError(reason, message);
}

function validateStrictChronology(
  dates: readonly unknown[],
  sourceName: string,
): void {
  let previousDate: string | null = null;
  for (const date of dates) {
    if (typeof date !== 'string') {
      invalidSource('invalid_input', `${sourceName} must retain its date field.`);
    }
    if (!isCanonicalDate(date)) {
      invalidSource('invalid_chronology', `${sourceName} contains an invalid date.`);
    }
    if (previousDate !== null && date <= previousDate) {
      invalidSource('invalid_chronology', `${sourceName} dates must be unique and chronological.`);
    }
    previousDate = date;
  }
}

function sourceNumberOrNull(value: unknown, fieldName: string): number | null {
  if (value === null || typeof value === 'number') return value;
  return invalidSource('invalid_input', `${fieldName} must be a number or null.`);
}

function copySourceRow(
  input: VolumeProfileSourceInputRow,
  issuerCode: string,
  collectionDate: string,
  unknownMetadataDates: string[],
): Readonly<VolumeProfileSourceRow> {
  const row = input as unknown as Record<string, unknown>;
  if (typeof row.Date !== 'string' || typeof row.Code !== 'string') {
    return invalidSource('invalid_input', 'Volume-profile rows must retain Date and Code.');
  }
  if (row.Code !== issuerCode || row.Date > collectionDate) {
    return invalidSource('invalid_input', 'Volume-profile row identity or collection boundary is invalid.');
  }

  const hasAdjustmentFactor = Object.hasOwn(row, 'AdjFactor');
  const hasExRightsType = Object.hasOwn(row, 'ExRT');
  const isReturnedNoSaleRow = [row.AdjO, row.AdjH, row.AdjL, row.AdjC, row.AdjVo]
    .every((value) => value === null);
  const adjustmentFactorKnown = hasAdjustmentFactor && (
    (typeof row.AdjFactor === 'number'
      && Number.isFinite(row.AdjFactor)
      && row.AdjFactor > 0)
    || (row.AdjFactor === null && isReturnedNoSaleRow)
  );
  const exRightsTypeKnown = hasExRightsType && (
    row.ExRT === null
    || row.ExRT === '1'
    || row.ExRT === '2'
    || row.ExRT === '3'
  );
  if (!adjustmentFactorKnown || !exRightsTypeKnown) {
    unknownMetadataDates.push(row.Date);
  }
  const adjustmentFactor = typeof row.AdjFactor === 'number' ? row.AdjFactor : null;
  const exRightsType = exRightsTypeKnown
    ? row.ExRT as VolumeProfileSourceRow['ExRT']
    : null;

  return Object.freeze({
    Date: row.Date,
    Code: row.Code,
    AdjO: sourceNumberOrNull(row.AdjO, 'AdjO'),
    AdjH: sourceNumberOrNull(row.AdjH, 'AdjH'),
    AdjL: sourceNumberOrNull(row.AdjL, 'AdjL'),
    AdjC: sourceNumberOrNull(row.AdjC, 'AdjC'),
    AdjVo: sourceNumberOrNull(row.AdjVo, 'AdjVo'),
    AdjFactor: adjustmentFactor,
    ExRT: exRightsType,
  });
}

/** Validate source identity and completeness evidence before adding the private brand. */
export function validateVolumeProfileSource(
  input: VolumeProfileSourceInput,
): VolumeProfileSource {
  const record = input as unknown as Record<string, unknown>;
  for (const assertedField of [
    'basisAuditComplete',
    'basisAuditRequiredThroughDate',
    'basisAuditThroughDate',
    'verified',
  ]) {
    if (Object.hasOwn(record, assertedField)) {
      return invalidSource('invalid_input', 'Caller-asserted source completeness is not accepted.');
    }
  }
  if (!isNormalizedJQuantsCode(input.issuerCode)) {
    return invalidSource('invalid_input', 'issuerCode must be a normalized J-Quants code.');
  }
  const collectionDate = collectionDateInJapan(input.collectedAt);
  if (collectionDate === null) {
    return invalidSource('invalid_input', 'collectedAt must be a valid UTC timestamp.');
  }
  if (
    input.provenance.source !== 'jquants'
    || input.provenance.endpoint !== '/v2/equities/bars/daily'
    || input.provenance.availabilityCalendarEndpoint !== '/v2/markets/calendar'
    || input.provenance.mapping !== 'jquants_adjusted_ohlcv_with_corporate_actions_v1'
    || input.provenance.basisAudit !== 'collection_horizon_rights_audit_v1'
  ) {
    return invalidSource('invalid_input', 'Volume-profile source provenance is invalid.');
  }

  validateStrictChronology(input.calendar.map((day) => day.date), 'Availability calendar');
  const calendar = input.calendar.map((day) => {
    if (!OFFICIAL_HOLIDAY_DIVISIONS.has(day.holidayDivision)) {
      return invalidSource('invalid_input', 'Availability calendar contains an invalid HolDiv.');
    }
    return Object.freeze({ ...day });
  });
  validateStrictChronology(input.rows.map((row) => row.Date), 'Volume-profile source');

  const unknownMetadataDates: string[] = [];
  const rows = input.rows.map((row) => copySourceRow(
    row,
    input.issuerCode,
    collectionDate,
    unknownMetadataDates,
  ));
  const calendarCoversCollectionDate = calendar.some((day) => day.date === collectionDate);
  const calendarThroughCollection = calendar.filter((day) => day.date <= collectionDate);
  const calendarSequenceComplete = calendarThroughCollection.every((day, index) => (
    index === 0 || isNextCalendarDate(calendarThroughCollection[index - 1].date, day.date)
  ));
  const sameDateRowReturned = rows.some((row) => row.Date === collectionDate);
  const latestPriorTradingDate = calendar.reduce<string | null>((latest, day) => (
    day.date < collectionDate
    && TRADING_HOLIDAY_DIVISIONS.has(day.holidayDivision)
    && (latest === null || day.date > latest)
      ? day.date
      : latest
  ), null);
  const basisAuditRequiredThroughDate = sameDateRowReturned
    ? collectionDate
    : calendarCoversCollectionDate
      ? latestPriorTradingDate
      : null;
  const basisAuditThroughDate = rows.length === 0 ? null : rows[rows.length - 1].Date;
  const provenance = Object.freeze({ ...input.provenance });
  const auditState: VolumeProfileSourceAuditState = Object.freeze({
    collectionDate,
    calendarCoversCollectionDate,
    calendarSequenceComplete,
    calendarStartDate: calendarThroughCollection[0]?.date ?? null,
    tradingDates: Object.freeze(calendar
      .filter((day) => TRADING_HOLIDAY_DIVISIONS.has(day.holidayDivision))
      .map((day) => day.date)),
    unknownMetadataDates: Object.freeze([...unknownMetadataDates]),
  });
  const source = {
    issuerCode: input.issuerCode,
    collectedAt: input.collectedAt,
    basisAuditRequiredThroughDate,
    basisAuditThroughDate,
    rows: Object.freeze(rows),
    provenance,
  } as Omit<VolumeProfileSource, typeof verifiedVolumeProfileSource | typeof volumeProfileSourceAudit>;
  Object.defineProperties(source, {
    [verifiedVolumeProfileSource]: { value: true, enumerable: false },
    [volumeProfileSourceAudit]: { value: auditState, enumerable: false },
  });
  return Object.freeze(source) as VolumeProfileSource;
}

export function isVerifiedVolumeProfileSource(value: unknown): value is VolumeProfileSource {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Partial<VolumeProfileSource>)[verifiedVolumeProfileSource] === true,
  );
}

interface CanonicalWindowMetadata {
  dataDate: string | null;
  windowStartDate: string | null;
  windowEndDate: string | null;
  inputBarCount: number;
}

const EMPTY_WINDOW: CanonicalWindowMetadata = {
  dataDate: null,
  windowStartDate: null,
  windowEndDate: null,
  inputBarCount: 0,
};

function resultProvenance(
  basisAuditRequiredThroughDate: string | null,
  basisAuditThroughDate: string | null,
  corporateActionBasisStatus: CorporateActionBasisStatus,
): VolumeProfileResult['provenance'] {
  return {
    source: 'jquants',
    endpoint: '/v2/equities/bars/daily',
    availabilityCalendarEndpoint: '/v2/markets/calendar',
    sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
    adjustmentFactorField: 'AdjFactor',
    exRightsField: 'ExRT',
    basisAudit: 'collection_horizon_rights_audit_v1',
    basisAuditRequiredThroughDate,
    basisAuditThroughDate,
    corporateActionBasisStatus,
    calculation: 'volume_profile_engine',
  };
}

function unavailableVolumeProfile(
  analysisAsOfDate: string,
  issuerCode: string,
  collectedAt: string,
  auditDates: {
    required: string | null;
    through: string | null;
  },
  reasons: readonly VolumeProfileUnavailableReason[],
  basisStatus: CorporateActionBasisStatus,
  window: CanonicalWindowMetadata = EMPTY_WINDOW,
): VolumeProfileResult {
  const basisEstablished = basisStatus === 'supported_common_basis_established';
  return {
    analysisAsOfDate,
    collectedAt,
    issuerCode,
    ...window,
    priceBasis: basisEstablished ? 'jquants_corporate_action_adjusted' : null,
    volumeBasis: basisEstablished ? 'jquants_corporate_action_adjusted' : null,
    allocationMethod: VOLUME_PROFILE_ALLOCATION_METHOD,
    binningMethod: {
      id: VOLUME_PROFILE_BINNING_METHOD,
      requestedBinCount: VOLUME_PROFILE_BIN_COUNT,
      effectiveBinCount: 0,
      minPrice: null,
      maxPrice: null,
    },
    bins: null,
    poc: null,
    valueArea: null,
    unavailable: reasons.map((reason) => ({ scope: 'profile', reason })),
    methodology: {
      id: 'daily_ohlcv_volume_profile_proxy_v1',
      approximation: 'uniform_daily_range',
      actualHolderCostBasis: false,
    },
    provenance: resultProvenance(auditDates.required, auditDates.through, basisStatus),
    units: {
      price: 'JPY',
      allocatedVolume: 'adjusted_shares',
      volumeShare: 'ratio',
    },
  };
}

function canonicalWindow(rows: readonly Readonly<VolumeProfileSourceRow>[]): CanonicalWindowMetadata {
  if (rows.length === 0) return EMPTY_WINDOW;
  return {
    dataDate: rows[rows.length - 1].Date,
    windowStartDate: rows[0].Date,
    windowEndDate: rows[rows.length - 1].Date,
    inputBarCount: rows.length,
  };
}

function auditCorporateActionBasis(
  source: VolumeProfileSource,
  windowStartDate: string,
): 'supported' | 'rights_issue' | 'unknown' {
  const audit = source[volumeProfileSourceAudit];
  const required = source.basisAuditRequiredThroughDate;
  const through = source.basisAuditThroughDate;
  const auditedRows = through === null
    ? []
    : source.rows.filter((row) => row.Date >= windowStartDate && row.Date <= through);

  if (auditedRows.some((row) => row.ExRT === '3')) return 'rights_issue';
  if (
    !audit.calendarCoversCollectionDate
    || !audit.calendarSequenceComplete
    || audit.calendarStartDate === null
    || audit.calendarStartDate > windowStartDate
    || required === null
    || through === null
    || through < required
  ) {
    return 'unknown';
  }

  const rowDates = new Set(auditedRows.map((row) => row.Date));
  const requiredTradingDates = audit.tradingDates.filter(
    (date) => date >= windowStartDate && date <= through,
  );
  if (
    requiredTradingDates.some((date) => !rowDates.has(date))
    || auditedRows.some((row) => !audit.tradingDates.includes(row.Date))
    || audit.unknownMetadataDates.some((date) => date >= windowStartDate && date <= through)
  ) {
    return 'unknown';
  }
  return 'supported';
}

const CANONICAL_ISSUE_ORDER = [
  'missing_price_data',
  'missing_volume_data',
  'invalid_price_data',
  'invalid_volume_data',
  'invalid_bar_geometry',
] as const satisfies readonly VolumeProfileUnavailableReason[];

function canonicalDataIssues(
  rows: readonly Readonly<VolumeProfileSourceRow>[],
): VolumeProfileUnavailableReason[] {
  const issues = new Set<VolumeProfileUnavailableReason>();
  for (const row of rows) {
    const prices = [row.AdjO, row.AdjH, row.AdjL, row.AdjC];
    if (prices.some((price) => price === null)) issues.add('missing_price_data');
    if (row.AdjVo === null) issues.add('missing_volume_data');

    const validPrices = prices.every(
      (price) => typeof price === 'number' && Number.isFinite(price) && price > 0,
    );
    if (!prices.every((price) => price === null || (Number.isFinite(price) && price > 0))) {
      issues.add('invalid_price_data');
    }
    if (row.AdjVo !== null && (!Number.isFinite(row.AdjVo) || row.AdjVo < 0)) {
      issues.add('invalid_volume_data');
    }
    if (
      validPrices
      && (row.AdjH! < row.AdjL!
        || row.AdjO! < row.AdjL!
        || row.AdjO! > row.AdjH!
        || row.AdjC! < row.AdjL!
        || row.AdjC! > row.AdjH!)
    ) {
      issues.add('invalid_bar_geometry');
    }
  }
  return CANONICAL_ISSUE_ORDER.filter((issue) => issues.has(issue));
}

function selectPoc(
  bins: readonly VolumeProfileBin[],
  totalVolume: number,
): NonNullable<VolumeProfileResult['poc']> {
  const tolerance = volumeProfileConservationTolerance(totalVolume);
  let maxAllocatedVolume = bins[0].allocatedVolume;
  for (const bin of bins.slice(1)) {
    maxAllocatedVolume = Math.max(maxAllocatedVolume, bin.allocatedVolume);
  }
  const selected = bins.find(
    (bin) => maxAllocatedVolume - bin.allocatedVolume <= tolerance,
  ) ?? bins[0];
  return {
    binIndex: selected.index,
    price: selected.representativePrice,
    allocatedVolume: selected.allocatedVolume,
    volumeShare: selected.volumeShare,
  };
}

function calculateValueArea(
  bins: readonly VolumeProfileBin[],
  poc: NonNullable<VolumeProfileResult['poc']>,
  totalVolume: number,
): NonNullable<VolumeProfileResult['valueArea']> {
  const tolerance = volumeProfileConservationTolerance(totalVolume);
  let firstBinIndex = poc.binIndex;
  let lastBinIndex = poc.binIndex;
  let includedVolume = poc.allocatedVolume;

  while (includedVolume / totalVolume < VOLUME_PROFILE_VALUE_AREA_TARGET) {
    const lower = firstBinIndex > 0 ? bins[firstBinIndex - 1] : null;
    const upper = lastBinIndex < bins.length - 1 ? bins[lastBinIndex + 1] : null;
    if (lower === null && upper === null) {
      throw new Error('Value Area could not reach its target with a valid positive profile.');
    }
    const chooseLower = lower !== null && (
      upper === null
      || lower.allocatedVolume > upper.allocatedVolume + tolerance
      || Math.abs(lower.allocatedVolume - upper.allocatedVolume) <= tolerance
    );
    if (chooseLower) {
      firstBinIndex -= 1;
      includedVolume += lower!.allocatedVolume;
    } else {
      lastBinIndex += 1;
      includedVolume += upper!.allocatedVolume;
    }
  }

  return {
    targetVolumeShare: VOLUME_PROFILE_VALUE_AREA_TARGET,
    achievedVolumeShare: includedVolume / totalVolume,
    val: bins[firstBinIndex].lowerPrice,
    vah: bins[lastBinIndex].upperPrice,
    firstBinIndex,
    lastBinIndex,
  };
}

/** Calculate the canonical daily-OHLCV volume-profile proxy from a complete source envelope. */
export function analyzeVolumeProfile(
  analysisAsOfDate: string,
  input: VolumeProfileSourceInput | VolumeProfileSource,
): VolumeProfileResult {
  const identity = {
    issuerCode: input.issuerCode,
    collectedAt: input.collectedAt,
  };
  if (!isCanonicalDate(analysisAsOfDate)) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      identity.issuerCode,
      identity.collectedAt,
      { required: null, through: null },
      ['invalid_input'],
      'not_evaluated',
    );
  }

  let source: VolumeProfileSource;
  try {
    source = isVerifiedVolumeProfileSource(input)
      ? input
      : validateVolumeProfileSource(input);
  } catch (error) {
    if (!(error instanceof VolumeProfileSourceValidationError)) throw error;
    return unavailableVolumeProfile(
      analysisAsOfDate,
      identity.issuerCode,
      identity.collectedAt,
      { required: null, through: null },
      [error.reason],
      'not_evaluated',
    );
  }

  const auditDates = {
    required: source.basisAuditRequiredThroughDate,
    through: source.basisAuditThroughDate,
  };
  const eligibleRows = source.rows.filter((row) => row.Date <= analysisAsOfDate);
  if (eligibleRows.length === 0) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      ['no_price_data'],
      'not_evaluated',
    );
  }

  const canonical = eligibleRows.slice(-VOLUME_PROFILE_MAXIMUM_BAR_COUNT);
  const window = canonicalWindow(canonical);
  if (canonical.length < VOLUME_PROFILE_MINIMUM_BAR_COUNT) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      ['insufficient_history'],
      'not_evaluated',
      window,
    );
  }

  const basisAudit = auditCorporateActionBasis(source, canonical[0].Date);
  if (basisAudit !== 'supported') {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      ['corporate_action_basis_unavailable'],
      basisAudit === 'rights_issue' ? 'rights_issue_unavailable' : 'unknown_basis_unavailable',
      window,
    );
  }

  const issues = canonicalDataIssues(canonical);
  if (issues.length > 0) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      issues,
      'supported_common_basis_established',
      window,
    );
  }

  const totalVolume = canonical.reduce((sum, row) => sum + row.AdjVo!, 0);
  if (!Number.isFinite(totalVolume)) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      ['invalid_volume_data'],
      'supported_common_basis_established',
      window,
    );
  }
  if (totalVolume === 0) {
    return unavailableVolumeProfile(
      analysisAsOfDate,
      source.issuerCode,
      source.collectedAt,
      auditDates,
      ['zero_total_volume'],
      'supported_common_basis_established',
      window,
    );
  }

  const allocation = allocateVolumeProfile(canonical.map((row) => ({
    open: row.AdjO,
    high: row.AdjH,
    low: row.AdjL,
    close: row.AdjC,
    volume: row.AdjVo,
  })));
  const bins: VolumeProfileBin[] = allocation.bins.map((bin) => ({
    ...bin,
    volumeShare: bin.allocatedVolume / totalVolume,
  }));
  if (bins.length === 0) {
    throw new Error('A valid positive volume profile must contain bins.');
  }
  const poc = selectPoc(bins, totalVolume);
  const valueArea = calculateValueArea(bins, poc, totalVolume);

  return {
    analysisAsOfDate,
    collectedAt: source.collectedAt,
    issuerCode: source.issuerCode,
    ...window,
    priceBasis: 'jquants_corporate_action_adjusted',
    volumeBasis: 'jquants_corporate_action_adjusted',
    allocationMethod: VOLUME_PROFILE_ALLOCATION_METHOD,
    binningMethod: {
      id: VOLUME_PROFILE_BINNING_METHOD,
      requestedBinCount: VOLUME_PROFILE_BIN_COUNT,
      effectiveBinCount: bins.length,
      minPrice: allocation.minPrice,
      maxPrice: allocation.maxPrice,
    },
    bins,
    poc,
    valueArea,
    unavailable: [],
    methodology: {
      id: 'daily_ohlcv_volume_profile_proxy_v1',
      approximation: 'uniform_daily_range',
      actualHolderCostBasis: false,
    },
    provenance: resultProvenance(
      source.basisAuditRequiredThroughDate,
      source.basisAuditThroughDate,
      'supported_common_basis_established',
    ),
    units: {
      price: 'JPY',
      allocatedVolume: 'adjusted_shares',
      volumeShare: 'ratio',
    },
  };
}
