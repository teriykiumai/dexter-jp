import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import {
  createTseSessionCalendarV1,
  type TseSessionCalendarV1,
} from './calendar.js';
import {
  compareStrictDatesV1,
  parseAsOfCutoff,
  parseSourceDate,
  parseTseSessionDate,
  selectRowsAtOrBeforeV1,
  type AsOfCutoff,
  type SourceDate,
  type TseSessionDate,
} from './date.js';
import {
  parseEligibleDailyBarsV1,
  type DailyBarInputV1,
  type TseDailyBarV1,
} from './daily-bar.js';
import { PointInTimeErrorV1 } from './errors.js';
import {
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  type JQuantsQueryV1,
} from './jquants-execution.js';
import {
  createPointInTimeSourceEnvelopeV1,
  type PointInTimeSourceEndpointV1,
  type PointInTimeSourceEnvelopeV1,
  type PointInTimeSourceUnavailableReasonV1,
} from './source-envelope.js';
import {
  jQuantsScaleCategoryToTseTickCategoryV1,
  type TseTickCategoryV1,
} from './tick.js';

export const JQUANTS_CALENDAR_SOURCE_MAPPING_VERSION_V1 = 'jquants_calendar_v1' as const;
export const JQUANTS_MASTER_SOURCE_MAPPING_VERSION_V1 = 'jquants_master_v1' as const;
export const JQUANTS_DAILY_BAR_SOURCE_MAPPING_VERSION_V1 = 'jquants_daily_bar_v1' as const;

const CALENDAR_ENDPOINT = '/v2/markets/calendar' as const;
const MASTER_ENDPOINT = '/v2/equities/master' as const;
const DAILY_BAR_ENDPOINT = '/v2/equities/bars/daily' as const;

type AdapterUnavailableV1 = Readonly<{
  state: 'unavailable';
  reason: 'source_plan_unavailable' | 'source_history_unavailable';
  envelope: PointInTimeSourceEnvelopeV1;
}>;

export type JQuantsCalendarResultV1 = Readonly<{
  state: 'available';
  calendar: TseSessionCalendarV1;
  envelope: PointInTimeSourceEnvelopeV1;
}> | AdapterUnavailableV1;

export type JQuantsMasterObservationV1 = Readonly<{
  date: TseSessionDate;
  code: string;
  ticker: string;
  scaleCategory: string | null;
  tickCategory: TseTickCategoryV1 | null;
  marketCode: string;
  productCategory: '011';
}>;

export type JQuantsMasterResultV1 = Readonly<{
  state: 'available';
  observation: JQuantsMasterObservationV1;
  envelope: PointInTimeSourceEnvelopeV1;
}> | AdapterUnavailableV1;

export type JQuantsDailyBarsResultV1 = Readonly<{
  state: 'available';
  bars: readonly TseDailyBarV1[];
  envelope: PointInTimeSourceEnvelopeV1;
}> | AdapterUnavailableV1;

type SourceRequestV1 = Readonly<{
  ticker: string | null;
  dateFrom: SourceDate;
  dateTo: SourceDate;
  asOfCutoff: AsOfCutoff;
}>;

function sourceInvalid(message: string): never {
  throw new PointInTimeErrorV1('source_response_invalid', message);
}

function record(value: unknown, kind: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return sourceInvalid(`J-Quants ${kind} rows must be objects.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalTicker(value: unknown): string {
  const parsed = CanonicalTickerSchema.safeParse(value);
  if (!parsed.success) {
    throw new PointInTimeErrorV1('source_response_invalid', 'The requested canonical ticker is invalid.');
  }
  return parsed.data;
}

function queryForEnvelope(query: JQuantsQueryV1): readonly Readonly<{ name: string; value: string }>[] {
  return Object.entries(query)
    .map(([name, value]) => Object.freeze({ name, value }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function availableEnvelope(
  endpoint: PointInTimeSourceEndpointV1,
  sourceMappingVersion: string,
  query: JQuantsQueryV1,
  request: SourceRequestV1,
  fetchedAt: AsOfCutoff,
  rows: readonly Readonly<Record<string, string | number | null>>[],
): PointInTimeSourceEnvelopeV1 {
  return createPointInTimeSourceEnvelopeV1({
    endpoint,
    sourceMappingVersion,
    query: queryForEnvelope(query),
    request,
    fetchedAt,
    result: { state: 'available', rows },
  });
}

function unavailableEnvelope(
  endpoint: PointInTimeSourceEndpointV1,
  sourceMappingVersion: string,
  query: JQuantsQueryV1,
  request: SourceRequestV1,
  fetchedAt: AsOfCutoff,
  reason: PointInTimeSourceUnavailableReasonV1,
): PointInTimeSourceEnvelopeV1 {
  return createPointInTimeSourceEnvelopeV1({
    endpoint,
    sourceMappingVersion,
    query: queryForEnvelope(query),
    request,
    fetchedAt,
    result: { state: 'unavailable', reason, rows: [] },
  });
}

function unavailable(
  endpoint: PointInTimeSourceEndpointV1,
  sourceMappingVersion: string,
  query: JQuantsQueryV1,
  request: SourceRequestV1,
  fetchedAt: AsOfCutoff,
  reason: 'source_plan_unavailable' | 'source_history_unavailable',
): AdapterUnavailableV1 {
  return Object.freeze({
    state: 'unavailable',
    reason,
    envelope: unavailableEnvelope(endpoint, sourceMappingVersion, query, request, fetchedAt, reason),
  });
}

function equalDateDuplicate<T>(rows: readonly T[], dateOf: (row: T) => unknown, label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const date = parseTseSessionDate(dateOf(row));
    if (seen.has(date)) return sourceInvalid(`J-Quants ${label} rows contain a duplicate date.`);
    seen.add(date);
  }
}

export class JQuantsValidationAdapterV1 {
  constructor(private readonly runtime: JQuantsExecutionRuntimeV1) {}

  async fetchCalendar(input: Readonly<{
    dateFrom: unknown;
    dateTo: unknown;
    asOfCutoff: unknown;
    signal?: AbortSignal;
  }>): Promise<JQuantsCalendarResultV1> {
    const dateFrom = parseSourceDate(input.dateFrom);
    const dateTo = parseSourceDate(input.dateTo);
    const asOfCutoff = parseAsOfCutoff(input.asOfCutoff);
    if (dateFrom > dateTo) sourceInvalid('The calendar request date envelope is reversed.');
    const query = Object.freeze({ from: dateFrom, to: dateTo });
    const request = Object.freeze({ ticker: null, dateFrom, dateTo, asOfCutoff });
    let rows: readonly unknown[];
    let fetchedAt: AsOfCutoff;
    try {
      const fetched = await this.runtime.getAll(CALENDAR_ENDPOINT, query, input.signal);
      rows = fetched.rows;
      fetchedAt = fetched.fetchedAt;
    } catch (error) {
      if (error instanceof JQuantsValidationErrorV1 && error.code === 'source_plan_unavailable') {
        return unavailable(
          CALENDAR_ENDPOINT,
          JQUANTS_CALENDAR_SOURCE_MAPPING_VERSION_V1,
          query,
          request,
          this.runtime.nowUtc(),
          'source_plan_unavailable',
        );
      }
      throw error;
    }
    this.runtime.assertCanContinue(input.signal);
    if (rows.length === 0) {
      return unavailable(
        CALENDAR_ENDPOINT,
        JQUANTS_CALENDAR_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        'source_history_unavailable',
      );
    }
    const used = rows.map(value => {
      const row = record(value, 'calendar');
      return Object.freeze({ Date: row.Date, HolDiv: row.HolDiv });
    });
    const selected = selectRowsAtOrBeforeV1(used, dateTo, row => row.Date);
    equalDateDuplicate(selected, row => row.Date, 'calendar');
    const calendar = createTseSessionCalendarV1(selected, dateFrom, dateTo);
    this.runtime.assertCanContinue(input.signal);
    return Object.freeze({
      state: 'available',
      calendar,
      envelope: availableEnvelope(
        CALENDAR_ENDPOINT,
        JQUANTS_CALENDAR_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        selected as readonly Readonly<Record<string, string | number | null>>[],
      ),
    });
  }

  async fetchMaster(input: Readonly<{
    ticker: unknown;
    date: unknown;
    asOfCutoff: unknown;
    signal?: AbortSignal;
  }>): Promise<JQuantsMasterResultV1> {
    const ticker = canonicalTicker(input.ticker);
    const date = parseSourceDate(input.date);
    const asOfCutoff = parseAsOfCutoff(input.asOfCutoff);
    const code = toJQuantsSecuritiesCode(ticker);
    const query = Object.freeze({ code, date });
    const request = Object.freeze({ ticker, dateFrom: date, dateTo: date, asOfCutoff });
    let rows: readonly unknown[];
    let fetchedAt: AsOfCutoff;
    try {
      const fetched = await this.runtime.getAll(MASTER_ENDPOINT, query, input.signal);
      rows = fetched.rows;
      fetchedAt = fetched.fetchedAt;
    } catch (error) {
      if (error instanceof JQuantsValidationErrorV1 && error.code === 'source_plan_unavailable') {
        return unavailable(
          MASTER_ENDPOINT,
          JQUANTS_MASTER_SOURCE_MAPPING_VERSION_V1,
          query,
          request,
          this.runtime.nowUtc(),
          'source_plan_unavailable',
        );
      }
      throw error;
    }
    this.runtime.assertCanContinue(input.signal);
    const used = rows.map(value => {
      const row = record(value, 'master');
      return Object.freeze({
        Date: row.Date,
        Code: row.Code,
        ScaleCat: row.ScaleCat,
        Mkt: row.Mkt,
        ProdCat: row.ProdCat,
      });
    });
    const selected = selectRowsAtOrBeforeV1(used, date, row => row.Date);
    if (selected.length === 0) {
      return unavailable(
        MASTER_ENDPOINT,
        JQUANTS_MASTER_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        'source_history_unavailable',
      );
    }
    if (selected.length !== 1) sourceInvalid('J-Quants master rows contain a duplicate effective identity.');
    const row = selected[0]!;
    const returnedDate = parseTseSessionDate(row.Date);
    if (compareStrictDatesV1(returnedDate, date) !== 0 || row.Code !== code) {
      sourceInvalid('The J-Quants master row does not match the requested date and ticker.');
    }
    if (row.ProdCat !== '011') {
      return unavailable(
        MASTER_ENDPOINT,
        JQUANTS_MASTER_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        'source_history_unavailable',
      );
    }
    if (typeof row.Mkt !== 'string' || row.Mkt.length === 0) {
      sourceInvalid('The J-Quants master row has no non-empty market code.');
    }
    if (row.ScaleCat !== null && typeof row.ScaleCat !== 'string') {
      sourceInvalid('The J-Quants master ScaleCat is invalid.');
    }
    const normalized = Object.freeze({
      date: returnedDate,
      code,
      ticker,
      scaleCategory: row.ScaleCat,
      tickCategory: jQuantsScaleCategoryToTseTickCategoryV1(row.ScaleCat),
      marketCode: row.Mkt,
      productCategory: '011' as const,
    });
    this.runtime.assertCanContinue(input.signal);
    return Object.freeze({
      state: 'available',
      observation: normalized,
      envelope: availableEnvelope(
        MASTER_ENDPOINT,
        JQUANTS_MASTER_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        [row] as readonly Readonly<Record<string, string | number | null>>[],
      ),
    });
  }

  async fetchDailyBars(input: Readonly<{
    ticker: unknown;
    dateFrom: unknown;
    dateTo: unknown;
    asOfCutoff: unknown;
    signal?: AbortSignal;
  }>): Promise<JQuantsDailyBarsResultV1> {
    const ticker = canonicalTicker(input.ticker);
    const dateFrom = parseSourceDate(input.dateFrom);
    const dateTo = parseSourceDate(input.dateTo);
    const asOfCutoff = parseAsOfCutoff(input.asOfCutoff);
    if (dateFrom > dateTo) sourceInvalid('The daily-bar request date envelope is reversed.');
    const code = toJQuantsSecuritiesCode(ticker);
    const query = Object.freeze({ code, from: dateFrom, to: dateTo });
    const request = Object.freeze({ ticker, dateFrom, dateTo, asOfCutoff });
    let rows: readonly unknown[];
    let fetchedAt: AsOfCutoff;
    try {
      const fetched = await this.runtime.getAll(DAILY_BAR_ENDPOINT, query, input.signal);
      rows = fetched.rows;
      fetchedAt = fetched.fetchedAt;
    } catch (error) {
      if (error instanceof JQuantsValidationErrorV1 && error.code === 'source_plan_unavailable') {
        return unavailable(
          DAILY_BAR_ENDPOINT,
          JQUANTS_DAILY_BAR_SOURCE_MAPPING_VERSION_V1,
          query,
          request,
          this.runtime.nowUtc(),
          'source_plan_unavailable',
        );
      }
      throw error;
    }
    this.runtime.assertCanContinue(input.signal);
    if (rows.length === 0) {
      return unavailable(
        DAILY_BAR_ENDPOINT,
        JQUANTS_DAILY_BAR_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        'source_history_unavailable',
      );
    }
    const used = rows.map(value => {
      const row = record(value, 'daily-bar');
      return Object.freeze({
        Date: row.Date,
        Code: row.Code,
        O: row.O,
        H: row.H,
        L: row.L,
        C: row.C,
        UL: row.UL,
        LL: row.LL,
        AdjFactor: row.AdjFactor,
        ExRT: row.ExRT,
      });
    });
    const selected = selectRowsAtOrBeforeV1(used, dateTo, row => row.Date);
    const normalizedInput: DailyBarInputV1[] = selected.map(row => {
      const date = parseTseSessionDate(row.Date);
      if (compareStrictDatesV1(date, dateFrom) < 0) {
        sourceInvalid('A J-Quants daily-bar row is outside the requested date envelope.');
      }
      if (row.Code !== code) sourceInvalid('A J-Quants daily-bar row does not match the requested ticker.');
      return Object.freeze({
        date,
        open: row.O,
        high: row.H,
        low: row.L,
        close: row.C,
        upperLimitFlag: row.UL,
        lowerLimitFlag: row.LL,
        adjustmentFactor: row.AdjFactor,
        exRightsType: row.ExRT,
      });
    });
    const bars = parseEligibleDailyBarsV1(normalizedInput, dateTo);
    if (bars.length === 0) {
      return unavailable(
        DAILY_BAR_ENDPOINT,
        JQUANTS_DAILY_BAR_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        'source_history_unavailable',
      );
    }
    this.runtime.assertCanContinue(input.signal);
    return Object.freeze({
      state: 'available',
      bars,
      envelope: availableEnvelope(
        DAILY_BAR_ENDPOINT,
        JQUANTS_DAILY_BAR_SOURCE_MAPPING_VERSION_V1,
        query,
        request,
        fetchedAt,
        selected as readonly Readonly<Record<string, string | number | null>>[],
      ),
    });
  }
}
