import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { sha256CanonicalJsonV1, type CanonicalJsonValue, type SnapshotDigest } from '../snapshot/canonical-json.js';
import { assertMarketDataSafeV1 } from './contracts.js';
import { normalizeTechnicalDailyObservationV1, type CurrentCodeHistoryBoundaryAvailableV1,
  type TechnicalDailyObservationV1 } from './technical-series.js';
import { TseSessionCalendarV1, createTseSessionCalendarV1 } from '../strategy-validation/calendar.js';
import { isStrictGregorianDate, parseAsOfCutoff, tokyoDateFromUtcInstantV1,
  type AsOfCutoff } from '../strategy-validation/date.js';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';

export const TECHNICAL_SOURCE_CONTRACT_VERSION_V1 = 'jquants_technical_source_contract_v1' as const;
export const TECHNICAL_CALENDAR_BOUNDARY_POLICY_V2 = 'standard_calendar_boundary_v2' as const;
export const JQUANTS_CURRENT_MASTER_MAPPING_VERSION_V1 = 'jquants_current_master_mapping_v1' as const;
export const JQUANTS_TECHNICAL_CALENDAR_MAPPING_VERSION_V1 = 'jquants_technical_calendar_mapping_v1' as const;
export const JQUANTS_TECHNICAL_DAILY_BARS_MAPPING_VERSION_V1 = 'jquants_technical_daily_bars_mapping_v1' as const;
export const JQUANTS_DAILY_BARS_ELIGIBILITY_VERSION_V1 = 'jquants_daily_bars_eligibility_v1' as const;

export const TECHNICAL_SOURCE_ENDPOINTS_V1 = Object.freeze({
  tradingCalendar: '/v2/markets/calendar',
  securityMaster: '/v2/equities/master',
  dailyBars: '/v2/equities/bars/daily',
} as const);

export type TechnicalSourceRevisionV1 = Readonly<{
  id: string;
  title: string;
  url: string;
  publishedRevision: 'unversioned-live-document';
  retrievedAt: '2026-09-04';
}>;

function revision(id: string, title: string, url: string): TechnicalSourceRevisionV1 {
  return Object.freeze({ id, title, url, publishedRevision: 'unversioned-live-document', retrievedAt: '2026-09-04' });
}

/** Closed code registry. A source-contract update requires a reviewed new revision ID. */
export const TECHNICAL_SOURCE_REVISIONS_V1 = Object.freeze({
  bars: Object.freeze([
    revision('jquants_data_spec_retrieved_2026_09_04', '契約ごとに利用可能なAPIとデータ格納期間', 'https://jpx-jquants.com/ja/spec/data-spec'),
    revision('jquants_data_update_retrieved_2026_09_04', '提供データの更新タイミング', 'https://jpx-jquants.com/ja/spec/data-update'),
    revision('jquants_eq_bars_daily_retrieved_2026_09_04', '株価四本値(/equities/bars/daily)', 'https://jpx-jquants.com/ja/spec/eq-bars-daily'),
    revision('jquants_pagination_retrieved_2026_09_04', 'レスポンスのページングについて', 'https://jpx-jquants.com/ja/spec/pagination'),
  ]),
  calendar: Object.freeze([
    revision('jquants_data_spec_retrieved_2026_09_04', '契約ごとに利用可能なAPIとデータ格納期間', 'https://jpx-jquants.com/ja/spec/data-spec'),
    revision('jquants_holiday_division_retrieved_2026_09_04', '休日区分', 'https://jpx-jquants.com/ja/spec/mkt-cal/holiday-division'),
    revision('jquants_market_calendar_retrieved_2026_09_04', '取引カレンダー(/markets/calendar)', 'https://jpx-jquants.com/ja/spec/mkt-cal'),
    revision('jquants_pagination_retrieved_2026_09_04', 'レスポンスのページングについて', 'https://jpx-jquants.com/ja/spec/pagination'),
  ]),
  master: Object.freeze([
    revision('jquants_data_spec_retrieved_2026_09_04', '契約ごとに利用可能なAPIとデータ格納期間', 'https://jpx-jquants.com/ja/spec/data-spec'),
    revision('jquants_eq_master_retrieved_2026_09_04', '上場銘柄一覧(/equities/master)', 'https://jpx-jquants.com/ja/spec/eq-master'),
    revision('jquants_marketcode_retrieved_2026_09_04', '市場区分コード及び市場区分名', 'https://jpx-jquants.com/ja/spec/eq-master/marketcode'),
    revision('jquants_pagination_retrieved_2026_09_04', 'レスポンスのページングについて', 'https://jpx-jquants.com/ja/spec/pagination'),
    revision('jquants_product_category_retrieved_2026_09_04', '商品区分コード及び商品区分名', 'https://jpx-jquants.com/ja/spec/eq-master/product-category'),
  ]),
} as const);

export const TECHNICAL_SOURCE_REGISTRY_V1 = Object.freeze([
  Object.freeze({
    role: 'daily_bars',
    sourceId: 'jquants_v2_equities_bars_daily',
    endpoint: TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars,
    queryFields: Object.freeze(['code', 'from', 'to'] as const),
    normalizedFields: Object.freeze(['Date', 'Code', 'AdjO', 'AdjH', 'AdjL', 'AdjC', 'AdjVo', 'AdjFactor', 'ExRT'] as const),
    sourceContractVersion: TECHNICAL_SOURCE_CONTRACT_VERSION_V1,
    sourceMappingVersion: JQUANTS_TECHNICAL_DAILY_BARS_MAPPING_VERSION_V1,
    sourceRevisionIds: Object.freeze(TECHNICAL_SOURCE_REVISIONS_V1.bars.map(item => item.id)),
    entitlementClass: 'configured_standard_or_higher',
    coverage: 'maximum_ten_gregorian_years_from_calculation_date',
    eligibility: JQUANTS_DAILY_BARS_ELIGIBILITY_VERSION_V1,
    adjustmentBasis: 'jquants_adjusted_ohlcv_not_total_return',
  }),
  Object.freeze({
    role: 'security_master',
    sourceId: 'jquants_v2_equities_master',
    endpoint: TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster,
    queryFields: Object.freeze(['code', 'date'] as const),
    normalizedFields: Object.freeze(['Date', 'Code', 'CoName', 'Mkt', 'ProdCat'] as const),
    sourceContractVersion: TECHNICAL_SOURCE_CONTRACT_VERSION_V1,
    sourceMappingVersion: JQUANTS_CURRENT_MASTER_MAPPING_VERSION_V1,
    sourceRevisionIds: Object.freeze(TECHNICAL_SOURCE_REVISIONS_V1.master.map(item => item.id)),
    entitlementClass: 'configured_standard_or_higher',
    coverage: 'eligible_end_date_current_identity_only',
  }),
  Object.freeze({
    role: 'trading_calendar',
    sourceId: 'jquants_v2_markets_calendar',
    endpoint: TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
    queryFields: Object.freeze(['from', 'to'] as const),
    normalizedFields: Object.freeze(['Date', 'HolDiv'] as const),
    sourceContractVersion: TECHNICAL_SOURCE_CONTRACT_VERSION_V1,
    sourceMappingVersion: JQUANTS_TECHNICAL_CALENDAR_MAPPING_VERSION_V1,
    sourceRevisionIds: Object.freeze(TECHNICAL_SOURCE_REVISIONS_V1.calendar.map(item => item.id)),
    entitlementClass: 'configured_standard_or_higher',
    coverage: 'complete_calendar_date_envelope',
    boundaryPolicy: TECHNICAL_CALENDAR_BOUNDARY_POLICY_V2,
    calendarCoverageFrom: 'queryFrom',
    calendarCoverageTo: 'max(containingSunday(calculationDate),lastDayOfMonth(calculationDate))',
  }),
] as const);

export type TechnicalSourceGateErrorCodeV1 =
  | 'invalid_configuration'
  | 'calendar_incomplete'
  | 'source_response_invalid'
  | 'source_not_yet_updated'
  | 'source_no_observation';

export class TechnicalSourceGateErrorV1 extends Error {
  constructor(readonly code: TechnicalSourceGateErrorCodeV1) {
    super(`Technical source gate failed: ${code}.`);
    this.name = 'TechnicalSourceGateErrorV1';
  }
}

function fail(code: TechnicalSourceGateErrorCodeV1): never {
  throw new TechnicalSourceGateErrorV1(code);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('source_response_invalid');
  return value as Readonly<Record<string, unknown>>;
}

function isoDate(date: Date): string {
  const value = date.toISOString().slice(0, 10);
  if (!isStrictGregorianDate(value)) return fail('invalid_configuration');
  return value;
}

function startOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return isoDate(value);
}

function endOfWeek(date: string): string {
  const value = new Date(`${startOfWeek(date)}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 6);
  return isoDate(value);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date: string): string {
  const value = new Date(`${startOfMonth(date)}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1, 0);
  return isoDate(value);
}

export function technicalQueryFromV1(calculationDateValue: unknown): string {
  if (!isStrictGregorianDate(calculationDateValue)) return fail('invalid_configuration');
  const [year, month, day] = calculationDateValue.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || year <= 10) {
    return fail('invalid_configuration');
  }
  const targetYear = String(year - 10).padStart(4, '0');
  const candidate = `${targetYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (isStrictGregorianDate(candidate)) return candidate;
  if (month === 2 && day === 29) return `${targetYear}-03-01`;
  return fail('invalid_configuration');
}

export type TechnicalSourceRequestWindowV1 = Readonly<{
  acceptedAt: AsOfCutoff;
  calculationDate: string;
  queryFrom: string;
  calendarCoverageFrom: string;
  calendarCoverageTo: string;
}>;

export function createTechnicalSourceRequestWindowV1(acceptedAtValue: unknown): TechnicalSourceRequestWindowV1 {
  let acceptedAt: AsOfCutoff;
  try {
    acceptedAt = parseAsOfCutoff(acceptedAtValue);
  } catch {
    return fail('invalid_configuration');
  }
  const calculationDate = String(tokyoDateFromUtcInstantV1(acceptedAt));
  const queryFrom = technicalQueryFromV1(calculationDate);
  const weekTo = endOfWeek(calculationDate);
  const monthTo = endOfMonth(calculationDate);
  return Object.freeze({
    acceptedAt,
    calculationDate,
    queryFrom,
    calendarCoverageFrom: queryFrom,
    calendarCoverageTo: weekTo > monthTo ? weekTo : monthTo,
  });
}

export type NormalizedTechnicalCalendarRowV1 = Readonly<{ Date: string; HolDiv: '0' | '1' | '2' | '3' }>;

export function mapTechnicalCalendarV1(
  inputRows: unknown,
  requiredFrom: string,
  requiredTo: string,
): Readonly<{ rows: readonly NormalizedTechnicalCalendarRowV1[]; calendar: TseSessionCalendarV1 }> {
  if (!Array.isArray(inputRows)) return fail('source_response_invalid');
  if (!isStrictGregorianDate(requiredFrom) || !isStrictGregorianDate(requiredTo)
    || requiredFrom > requiredTo) return fail('invalid_configuration');
  const rows = inputRows.map(value => {
    const source = record(value);
    if (!isStrictGregorianDate(source.Date) || typeof source.HolDiv !== 'string'
      || !['0', '1', '2', '3'].includes(source.HolDiv)) {
      return fail('source_response_invalid');
    }
    if (source.Date < requiredFrom || source.Date > requiredTo) {
      return fail('source_response_invalid');
    }
    return Object.freeze({ Date: source.Date, HolDiv: source.HolDiv as '0' | '1' | '2' | '3' });
  }).sort((left, right) => left.Date.localeCompare(right.Date));
  if (rows.some((row, index) => index > 0 && rows[index - 1]?.Date === row.Date)) {
    return fail('source_response_invalid');
  }
  try {
    return Object.freeze({ rows: Object.freeze(rows), calendar: createTseSessionCalendarV1(rows, requiredFrom, requiredTo) });
  } catch {
    return fail('calendar_incomplete');
  }
}

function tokyoClock(acceptedAt: AsOfCutoff): string {
  return new Date(Date.parse(acceptedAt) + 9 * 60 * 60 * 1_000).toISOString().slice(11, 19);
}

export function resolveTechnicalEligibleThroughV1(
  window: TechnicalSourceRequestWindowV1,
  calendar: TseSessionCalendarV1,
): string {
  if (!(calendar instanceof TseSessionCalendarV1)
    || calendar.requiredFrom !== window.calendarCoverageFrom
    || calendar.requiredTo !== window.calendarCoverageTo) return fail('calendar_incomplete');
  if (calendar.isSession(window.calculationDate) && tokyoClock(window.acceptedAt) >= '16:30:00') {
    return window.calculationDate;
  }
  try {
    return calendar.previousSessionBefore(window.calculationDate);
  } catch {
    return fail('calendar_incomplete');
  }
}

export const CURRENT_TECHNICAL_MASTER_EXPECTATION_V1 = Object.freeze({
  family: 'technical_domestic_equity',
  productCategories: Object.freeze(['011'] as const),
  marketCodes: Object.freeze(['0105', '0111', '0112', '0113'] as const),
  namePolicy: 'validated_source_label_only',
} as const);

export type CurrentMasterRejectionReasonV1 =
  | 'missing_row'
  | 'duplicate_row'
  | 'effective_date_mismatch'
  | 'code_mismatch'
  | 'product_category_mismatch'
  | 'market_code_mismatch'
  | 'blank_name'
  | 'invalid_name';

export type NormalizedCurrentMasterObservationV1 = Readonly<{
  Date: string;
  Code: string;
  CoName: string;
  Mkt: string;
  ProdCat: string;
}>;

export type CurrentMasterValidationResultV1 =
  | Readonly<{ state: 'accepted'; observation: NormalizedCurrentMasterObservationV1 }>
  | Readonly<{ state: 'rejected'; reason: CurrentMasterRejectionReasonV1 }>;

function rejected(reason: CurrentMasterRejectionReasonV1): CurrentMasterValidationResultV1 {
  return Object.freeze({ state: 'rejected', reason });
}

function validSourceName(value: string, environment: NodeJS.ProcessEnv): boolean {
  if (value.length > 160 || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
  try {
    assertMarketDataSafeV1(value, environment);
    return true;
  } catch {
    return false;
  }
}

export function validateCurrentTechnicalMasterV1(
  inputRows: unknown,
  input: Readonly<{ ticker: string; eligibleThrough: string; environment?: NodeJS.ProcessEnv }>,
): CurrentMasterValidationResultV1 {
  if (!Array.isArray(inputRows)) return fail('source_response_invalid');
  const tickerResult = CanonicalTickerSchema.safeParse(input.ticker);
  if (!tickerResult.success || !isStrictGregorianDate(input.eligibleThrough)) return fail('invalid_configuration');
  if (inputRows.length === 0) return rejected('missing_row');
  if (inputRows.length > 1) return rejected('duplicate_row');
  const source = record(inputRows[0]);
  const jquantsCode = toJQuantsSecuritiesCode(tickerResult.data);
  if (source.Date !== input.eligibleThrough) return rejected('effective_date_mismatch');
  if (source.Code !== jquantsCode) return rejected('code_mismatch');
  if (!CURRENT_TECHNICAL_MASTER_EXPECTATION_V1.productCategories.includes(source.ProdCat as '011')) {
    return rejected('product_category_mismatch');
  }
  if (!CURRENT_TECHNICAL_MASTER_EXPECTATION_V1.marketCodes.includes(source.Mkt as '0105' | '0111' | '0112' | '0113')) {
    return rejected('market_code_mismatch');
  }
  if (typeof source.CoName === 'string' && source.CoName.trim().length === 0) return rejected('blank_name');
  if (typeof source.CoName !== 'string' || !validSourceName(source.CoName, input.environment ?? process.env)) {
    return rejected('invalid_name');
  }
  return Object.freeze({ state: 'accepted', observation: Object.freeze({
    Date: source.Date,
    Code: source.Code,
    CoName: source.CoName,
    Mkt: source.Mkt as string,
    ProdCat: source.ProdCat as string,
  }) });
}

export type NormalizedTechnicalDailyBarV1 = Readonly<{
  Date: string;
  Code: string;
  AdjO: number | null;
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null;
  AdjVo: number | null;
  AdjFactor: number;
  ExRT: '1' | '2' | '3' | null;
}>;

function adjustedNumber(value: unknown, allowZero: boolean): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    return fail('source_response_invalid');
  }
  return value;
}

function mapTechnicalDailyBarRow(value: unknown, jquantsCode: string,
  queryFrom: string, eligibleThrough: string): NormalizedTechnicalDailyBarV1 {
  const source = record(value);
  if (!isStrictGregorianDate(source.Date) || source.Date < queryFrom || source.Date > eligibleThrough
    || source.Code !== jquantsCode) return fail('source_response_invalid');
  const AdjO = adjustedNumber(source.AdjO, false);
  const AdjH = adjustedNumber(source.AdjH, false);
  const AdjL = adjustedNumber(source.AdjL, false);
  const AdjC = adjustedNumber(source.AdjC, false);
  const AdjVo = adjustedNumber(source.AdjVo, true);
  const fields = [AdjO, AdjH, AdjL, AdjC, AdjVo];
  if (!fields.every(field => field === null) && fields.some(field => field === null)) {
    return fail('source_response_invalid');
  }
  if (typeof source.AdjFactor !== 'number' || !Number.isFinite(source.AdjFactor) || source.AdjFactor <= 0
    || ![null, '1', '2', '3'].includes(source.ExRT as null | string)) {
    return fail('source_response_invalid');
  }
  return Object.freeze({
    Date: source.Date,
    Code: source.Code,
    AdjO, AdjH, AdjL, AdjC, AdjVo,
    AdjFactor: source.AdjFactor,
    ExRT: source.ExRT as '1' | '2' | '3' | null,
  });
}

export type TechnicalDailyBarsGateResultV1 = Readonly<{
  rows: readonly NormalizedTechnicalDailyBarV1[];
  observations: readonly TechnicalDailyObservationV1[];
  historyBoundary: CurrentCodeHistoryBoundaryAvailableV1;
  historyCoverageClipped: boolean;
}>;

export function mapTechnicalDailyBarsV1(
  inputRows: unknown,
  input: Readonly<{
    ticker: string;
    queryFrom: string;
    eligibleThrough: string;
    calendar: TseSessionCalendarV1;
  }>,
): TechnicalDailyBarsGateResultV1 {
  if (!Array.isArray(inputRows)) return fail('source_response_invalid');
  const tickerResult = CanonicalTickerSchema.safeParse(input.ticker);
  if (!tickerResult.success || !isStrictGregorianDate(input.queryFrom)
    || !isStrictGregorianDate(input.eligibleThrough) || input.queryFrom > input.eligibleThrough
    || !(input.calendar instanceof TseSessionCalendarV1)) return fail('invalid_configuration');
  if (input.calendar.requiredFrom > input.queryFrom
    || input.calendar.requiredTo < input.eligibleThrough) return fail('calendar_incomplete');
  const jquantsCode = toJQuantsSecuritiesCode(tickerResult.data);
  const rows = inputRows.map(row => mapTechnicalDailyBarRow(
    row, jquantsCode, input.queryFrom, input.eligibleThrough,
  )).sort((left, right) => left.Date.localeCompare(right.Date));
  if (rows.length === 0) return fail('source_no_observation');
  if (rows.some((row, index) => index > 0 && rows[index - 1]?.Date === row.Date)) {
    return fail('source_response_invalid');
  }
  let observations: TechnicalDailyObservationV1[];
  try {
    observations = rows.map(row => normalizeTechnicalDailyObservationV1({
      date: row.Date,
      open: row.AdjO,
      high: row.AdjH,
      low: row.AdjL,
      close: row.AdjC,
      volume: row.AdjVo,
    }));
  } catch {
    return fail('source_response_invalid');
  }
  if (!rows.some(row => row.Date === input.eligibleThrough)) return fail('source_not_yet_updated');
  const sourceCoverageFrom = rows[0]!.Date;
  const rowDates = new Set(rows.map(row => row.Date));
  for (const row of rows) if (!input.calendar.isSession(row.Date)) return fail('source_response_invalid');
  const postStartSessions = input.calendar.sessions.filter(date => date >= sourceCoverageFrom && date <= input.eligibleThrough);
  if (postStartSessions.some(date => !rowDates.has(date))) return fail('source_response_invalid');
  if (!observations.some(row => row.kind === 'bar')) return fail('source_no_observation');
  const historyBoundary: CurrentCodeHistoryBoundaryAvailableV1 = Object.freeze({
    state: 'available',
    contractVersion: 'current_code_history_v1',
    mode: 'current_code_only',
    jquantsCode,
    currentMasterDate: input.eligibleThrough,
    sourceCoverageFrom,
    sourceCoverageThrough: input.eligibleThrough,
    historicalIdentity: 'not_verified',
  });
  const historyCoverageClipped = input.calendar.sessions
    .some(date => date >= input.queryFrom && date < sourceCoverageFrom);
  return Object.freeze({ rows: Object.freeze(rows), observations: Object.freeze(observations),
    historyBoundary, historyCoverageClipped });
}

export function digestTechnicalSourceRowsV1(
  rows: CanonicalJsonValue,
  environment: NodeJS.ProcessEnv = process.env,
): SnapshotDigest {
  assertMarketDataSafeV1(rows, environment);
  return sha256CanonicalJsonV1(rows);
}
