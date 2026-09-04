import { z } from 'zod';
import { calculateMacdSeries, calculateRsiSeries } from '../../tools/finance/advanced-technical-engine.js';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import { TseSessionCalendarV1 } from '../strategy-validation/calendar.js';
import { isStrictGregorianDate } from '../strategy-validation/date.js';

export type TechnicalSeriesErrorCodeV1 =
  | 'source_invalid_response' | 'source_no_observation'
  | 'calendar_incomplete' | 'instrument_identity_unverified';

export class TechnicalSeriesErrorV1 extends Error {
  constructor(readonly code: TechnicalSeriesErrorCodeV1) {
    // Never attach source payloads, paths, or credentials to a public failure.
    super(`Technical series calculation failed: ${code}.`);
    this.name = 'TechnicalSeriesErrorV1';
  }
}

const dateSchema = z.string().refine(isStrictGregorianDate);
const priceSchema = z.number().finite().positive();
const volumeSchema = z.number().finite().nonnegative();
const barFields = {
  date: dateSchema, open: priceSchema, high: priceSchema,
  low: priceSchema, close: priceSchema, volume: volumeSchema,
};
const observationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bar'), ...barFields }).strict(),
  z.object({
    kind: z.literal('gap'), date: dateSchema,
    reason: z.literal('source_all_null'),
  }).strict(),
]);

export type TechnicalDailyObservationV1 = z.infer<typeof observationSchema>;
type Bar = Extract<TechnicalDailyObservationV1, { kind: 'bar' }>;
export type TechnicalIntervalV1 = 'day' | 'week' | 'month';
export const TECHNICAL_INTERVALS_V1 = ['day', 'week', 'month'] as const;
export const TECHNICAL_INDICATOR_METHODS_V1 = {
  rsi: 'rsi_wilder_14_v1', macd: 'macd_ema_12_26_9_v1',
} as const;

export type IndicatorValueV1 =
  | { state: 'available'; value: number }
  | { state: 'unavailable'; reason: 'warmup' | 'partial_period' };
export type TechnicalCrossStateV1 =
  | { state: 'available'; value: 'golden_cross' | 'none' }
  | { state: 'unavailable'; reason: 'warmup' | 'partial_period' };
type Period = { interval: TechnicalIntervalV1; identity: string; periodStart: string; periodEnd: string };
export type TechnicalCandleV1 = Period & {
  displayDate: string; firstSessionDate: string; lastSessionDate: string; partial: boolean;
  open: number; high: number; low: number; close: number; volume: number;
  rsi: IndicatorValueV1; macd: IndicatorValueV1; signal: IndicatorValueV1;
  histogram: IndicatorValueV1; cross: TechnicalCrossStateV1;
};
export type TechnicalUnavailablePeriodV1 = Period & { reason: 'source_gap' };

const jquantsCodeSchema = z.string().refine((value) => {
  try {
    return value.length === 5 && toJQuantsSecuritiesCode(value) === value;
  } catch {
    return false;
  }
});

const historyBoundarySchema = z.object({
  state: z.literal('available'),
  contractVersion: z.literal('current_code_history_v1'),
  mode: z.literal('current_code_only'),
  jquantsCode: jquantsCodeSchema,
  currentMasterDate: dateSchema,
  sourceCoverageFrom: dateSchema,
  sourceCoverageThrough: dateSchema,
  historicalIdentity: z.literal('not_verified'),
}).strict();

export type CurrentCodeHistoryBoundaryAvailableV1 = z.infer<typeof historyBoundarySchema>;

const windowSchema = z.object({
  queryFrom: dateSchema, eligibleThrough: dateSchema, calculationDate: dateSchema,
  historyBoundary: historyBoundarySchema,
}).strict();

/** Structural input only, NOT source/identity proof. DR-T0/DR-T2 must verify provenance.
 * The caller selects the window (production: exact ten years; parity tests: exact suffix).
 * Eligibility, pagination and adjustment-basis validation belong to the source adapter.
 */
export type TechnicalCalculationWindowV1 = z.infer<typeof windowSchema>;
export type TechnicalSeriesResultV1 = {
  calculationFrom: string; calculationTo: string; dataDate: string;
  calendarCoverageFrom: string; calendarCoverageTo: string;
  historyCoverageClipped: boolean;
  dailyObservations: TechnicalDailyObservationV1[];
  intervals: Record<TechnicalIntervalV1, TechnicalCandleV1[]>;
  unavailablePeriods: TechnicalUnavailablePeriodV1[];
};

function fail(code: TechnicalSeriesErrorCodeV1): never {
  throw new TechnicalSeriesErrorV1(code);
}

export function parseTechnicalDailyObservationV1(value: unknown): TechnicalDailyObservationV1 {
  const result = observationSchema.safeParse(value);
  if (!result.success) return fail('source_invalid_response');
  const row = result.data;
  if (row.kind === 'bar' && (row.low > Math.min(row.open, row.close)
    || Math.max(row.open, row.close) > row.high)) return fail('source_invalid_response');
  return row;
}

const nullableRowSchema = z.object({
  date: dateSchema, open: priceSchema.nullable(), high: priceSchema.nullable(),
  low: priceSchema.nullable(), close: priceSchema.nullable(), volume: volumeSchema.nullable(),
}).strict();

/** Normalize already selected adjusted fields, not raw provider field names.
 * An absent row has no gap representation and fails after source coverage begins.
 */
export function normalizeTechnicalDailyObservationV1(value: unknown): TechnicalDailyObservationV1 {
  const result = nullableRowSchema.safeParse(value);
  if (!result.success) return fail('source_invalid_response');
  const row = result.data;
  const fields = [row.open, row.high, row.low, row.close, row.volume];
  if (fields.every(field => field === null)) {
    return { kind: 'gap', date: row.date, reason: 'source_all_null' };
  }
  return parseTechnicalDailyObservationV1({ kind: 'bar', ...row });
}

function isoDate(date: Date): string {
  const value = date.toISOString().slice(0, 10);
  if (!isStrictGregorianDate(value)) return fail('source_invalid_response');
  return value;
}

function periodFor(date: string, interval: TechnicalIntervalV1): Period {
  if (interval === 'day') return { interval, identity: date, periodStart: date, periodEnd: date };
  const start = new Date(`${date}T00:00:00.000Z`);
  if (interval === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    const periodStart = isoDate(start);
    start.setUTCDate(start.getUTCDate() + 6);
    return { interval, identity: periodStart, periodStart, periodEnd: isoDate(start) };
  }
  start.setUTCDate(1);
  const periodStart = isoDate(start);
  start.setUTCMonth(start.getUTCMonth() + 1, 0);
  return { interval, identity: date.slice(0, 7), periodStart, periodEnd: isoDate(start) };
}

function resolveWindow(value: unknown) {
  const result = windowSchema.safeParse(value);
  if (!result.success) return fail('source_invalid_response');
  const window = result.data;
  const { queryFrom, eligibleThrough, calculationDate, historyBoundary } = window;
  if (queryFrom > eligibleThrough || eligibleThrough > calculationDate) return fail('source_invalid_response');
  if (historyBoundary.currentMasterDate !== eligibleThrough
    || historyBoundary.sourceCoverageThrough !== eligibleThrough
    || historyBoundary.sourceCoverageFrom < queryFrom
    || historyBoundary.sourceCoverageFrom > eligibleThrough) {
    return fail('instrument_identity_unverified');
  }
  const calculationFrom = historyBoundary.sourceCoverageFrom;
  const fromWeek = periodFor(queryFrom, 'week').periodStart;
  const fromMonth = periodFor(queryFrom, 'month').periodStart;
  const toWeek = periodFor(eligibleThrough, 'week').periodEnd;
  const toMonth = periodFor(eligibleThrough, 'month').periodEnd;
  return {
    window, calculationFrom, calculationTo: eligibleThrough,
    calendarCoverageFrom: fromWeek < fromMonth ? fromWeek : fromMonth,
    calendarCoverageTo: toWeek > toMonth ? toWeek : toMonth,
  };
}

export function getTechnicalCalendarCoverageV1(window: TechnicalCalculationWindowV1) {
  const { calendarCoverageFrom, calendarCoverageTo } = resolveWindow(window);
  return { calendarCoverageFrom, calendarCoverageTo };
}

function indicator(value: number | null): IndicatorValueV1 {
  if (value === null) return { state: 'unavailable', reason: 'warmup' };
  if (!Number.isFinite(value)) return fail('source_invalid_response');
  return { state: 'available', value };
}

function attachIndicators(candles: TechnicalCandleV1[]): void {
  const completed = candles.filter(candle => !candle.partial);
  const closes = completed.map(candle => candle.close);
  try {
    const rsi = calculateRsiSeries(closes);
    const macd = calculateMacdSeries(closes);
    completed.forEach((candle, index) => {
      const current = macd[index];
      const previous = macd[index - 1];
      candle.rsi = indicator(rsi[index]);
      candle.macd = indicator(current?.value ?? null);
      candle.signal = indicator(current?.signal ?? null);
      candle.histogram = indicator(current?.histogram ?? null);
      if (current && previous) {
        candle.cross = { state: 'available', value: previous.value <= previous.signal
          && current.value > current.signal ? 'golden_cross' : 'none' };
      }
    });
  } catch (error) {
    if (error instanceof RangeError) return fail('source_invalid_response');
    throw error;
  }
}

/** Pure calculation; no source calls, Snapshot changes, artifact writes or source admission. */
export function calculateTechnicalSeriesV1(input: {
  window: TechnicalCalculationWindowV1;
  calendar: TseSessionCalendarV1;
  observations: readonly unknown[];
}): TechnicalSeriesResultV1 {
  const { window, ...range } = resolveWindow(input.window);
  const { calendar } = input;
  if (!(calendar instanceof TseSessionCalendarV1)
    || calendar.requiredFrom !== range.calendarCoverageFrom
    || calendar.requiredTo !== range.calendarCoverageTo
    || !calendar.isSession(window.eligibleThrough)) return fail('calendar_incomplete');

  if (!Array.isArray(input.observations)) return fail('source_invalid_response');
  const seen = new Set<string>();
  const dailyObservations = Array.from(input.observations, parseTechnicalDailyObservationV1)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const row of dailyObservations) {
    if (seen.has(row.date) || row.date < range.calculationFrom || row.date > window.eligibleThrough
      || !calendar.isSession(row.date)) {
      return fail('source_invalid_response');
    }
    seen.add(row.date);
  }
  if (dailyObservations[0]?.date !== range.calculationFrom) return fail('source_invalid_response');
  const sessions = calendar.sessions.filter(date => date >= range.calculationFrom && date <= range.calculationTo);
  if (sessions.some(date => !seen.has(date))) return fail('source_invalid_response');
  const lastBar = dailyObservations.findLast((row): row is Bar => row.kind === 'bar');
  if (!lastBar) return fail('source_no_observation');
  const historyCoverageClipped = calendar.sessions
    .some(date => date >= window.queryFrom && date < range.calculationFrom);

  const intervals: TechnicalSeriesResultV1['intervals'] = { day: [], week: [], month: [] };
  const unavailablePeriods: TechnicalUnavailablePeriodV1[] = [];
  for (const interval of TECHNICAL_INTERVALS_V1) {
    const groups = new Map<string, { period: Period; bars: Bar[] }>();
    for (const row of dailyObservations) {
      const period = periodFor(row.date, interval);
      const group = groups.get(period.identity) ?? { period, bars: [] };
      if (row.kind === 'bar') group.bars.push(row);
      groups.set(period.identity, group);
    }
    for (const { period, bars } of groups.values()) {
      if (bars.length === 0) {
        unavailablePeriods.push({ ...period, reason: 'source_gap' });
        continue;
      }
      const periodSessions = interval === 'day' ? [] : calendar.sessions
        .filter(date => date >= period.periodStart && date <= period.periodEnd);
      const leadingPartial = periodSessions.some(date => date < range.calculationFrom);
      const partial = interval !== 'day' && (leadingPartial || period.periodEnd >= window.calculationDate
        || periodSessions.some(date => date > window.eligibleThrough));
      const first = bars[0];
      const last = bars[bars.length - 1];
      const volume = bars.reduce((sum, bar) => sum + bar.volume, 0);
      if (!Number.isFinite(volume)) return fail('source_invalid_response');
      const unavailable = { state: 'unavailable', reason: partial ? 'partial_period' : 'warmup' } as const;
      intervals[interval].push({
        ...period, displayDate: last.date, firstSessionDate: first.date, lastSessionDate: last.date, partial,
        open: first.open, high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)),
        close: last.close, volume,
        rsi: { ...unavailable }, macd: { ...unavailable }, signal: { ...unavailable },
        histogram: { ...unavailable }, cross: { ...unavailable },
      });
    }
    attachIndicators(intervals[interval]);
  }
  return { ...range, dataDate: lastBar.date, historyCoverageClipped, dailyObservations, intervals, unavailablePeriods };
}
