import { z } from 'zod';
import { calculateSma } from '../../tools/finance/technical-engine.js';
import { calculateMacdSeries, calculateRsiSeries } from '../../tools/finance/advanced-technical-engine.js';
import { DateValue, FrozenIdentitySchema, ObjectRefSchema, parse, fail, json, digest } from './contracts.js';
import { normalizeTechnicalDailyObservationV1, calculateTechnicalSeriesV1 } from '../market-data/technical-series.js';
import { mapTechnicalCalendarV1, mapTechnicalDailyBarsV1, validateCurrentTechnicalMasterV1 } from '../market-data/technical-source-gate.js';

const price = z.number().positive().finite().nullable(), volume = z.number().nonnegative().finite().nullable();
export const WorkspaceDailyRowSchema = z.object({ Date: DateValue, Code: z.string(),
  O: price, H: price, L: price, C: price, Vo: volume,
  AdjO: price, AdjH: price, AdjL: price, AdjC: price, AdjVo: volume,
  AdjFactor: z.number().positive().finite(), ExRT: z.enum(['1', '2', '3']).nullable() }).strict();
export const WorkspaceMasterSchema = z.object({ Date: DateValue, Code: z.string(), CoName: z.string().min(1).max(160),
  Mkt: z.string(), ProdCat: z.literal('011') }).strict();
export const TechnicalInputSchema = z.object({ version: z.literal('workspace_technical_input_v1'),
  identity: FrozenIdentitySchema, masterEvidence: ObjectRefSchema, eligibilityFrom: DateValue,
  master: WorkspaceMasterSchema, queryFrom: DateValue, queryTo: DateValue, calculationDate: DateValue,
  calendarFrom: DateValue, calendarThrough: DateValue,
  calendar: z.array(z.object({ Date: DateValue, HolDiv: z.string() }).strict()).min(1).max(8000),
  daily: z.array(WorkspaceDailyRowSchema).min(1).max(8000),
  adjustmentMethod: z.literal('jquants_adjusted_ohlcv_not_total_return'),
  factorSemantics: z.literal('provider_daily_event_factor_not_cumulative'),
  historicalIdentity: z.literal('not_verified') }).strict();
export type TechnicalInput = z.infer<typeof TechnicalInputSchema>;

/** Closed projection: raw provider keys never enter immutable Workspace inputs. */
export function mapWorkspaceDailyRows(raw: readonly unknown[]) {
  return raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_input');
    const source = value as Record<string, unknown>;
    const row = parse(WorkspaceDailyRowSchema, Object.fromEntries(Object.keys(WorkspaceDailyRowSchema.shape).map(key => [key, source[key]])));
    const unadjusted = normalizeTechnicalDailyObservationV1({ date: row.Date, open: row.O, high: row.H, low: row.L, close: row.C, volume: row.Vo });
    const adjusted = normalizeTechnicalDailyObservationV1({ date: row.Date, open: row.AdjO, high: row.AdjH, low: row.AdjL, close: row.AdjC, volume: row.AdjVo });
    if (unadjusted.kind !== adjusted.kind) fail('invalid_input');
    return row;
  }).sort((a, b) => a.Date.localeCompare(b.Date));
}

export function calculateWorkspaceTechnical(raw: unknown) {
  const input = parse(TechnicalInputSchema, raw), ticker = input.identity.code.slice(0, 4);
  if (input.identity.provider !== 'jquants' || input.identity.code !== `${ticker}0`
    || input.master.Code !== input.identity.code || input.master.Date !== input.queryTo
    || input.eligibilityFrom > input.queryTo || input.queryFrom > input.queryTo || input.queryTo > input.calculationDate) fail('identity_review_required');
  if (validateCurrentTechnicalMasterV1([input.master], { ticker, eligibleThrough: input.queryTo }).state !== 'accepted') fail('identity_review_required');
  if (json(mapWorkspaceDailyRows(input.daily)) !== json(input.daily)) fail('invalid_input');
  const calendar = mapTechnicalCalendarV1(input.calendar, input.calendarFrom, input.calendarThrough);
  const mapped = mapTechnicalDailyBarsV1(input.daily, { ticker, queryFrom: input.queryFrom, eligibleThrough: input.queryTo, calendar: calendar.calendar });
  const from = input.eligibilityFrom > input.queryFrom ? input.eligibilityFrom : input.queryFrom;
  const eligible = mapped.observations.filter(row => row.date >= from);
  if (!eligible.length) fail('identity_review_required');
  const eligibleCalendar = mapTechnicalCalendarV1(input.calendar.filter(row => row.Date >= from), from, input.calendarThrough);
  const result = calculateTechnicalSeriesV1({ observations: eligible, calendar: eligibleCalendar.calendar,
    window: { queryFrom: from, eligibleThrough: input.queryTo, calculationDate: input.calculationDate,
      historyBoundary: { ...mapped.historyBoundary, sourceCoverageFrom: eligible[0]!.date } } });
  const decorate = (interval: 'day' | 'week' | 'month') => {
    const rows = result.intervals[interval].map(row => ({ ...row,
      sourceGaps: eligible.filter(observation => observation.kind === 'gap' && observation.date >= row.periodStart
        && observation.date <= row.periodEnd).map(observation => observation.date),
    }));
    // Workspace owns this sequence. Legacy V1 includes all non-partial candles
    // and must retain its original calculation version and immutable bytes.
    const closes = rows.filter(row => !row.partial && row.sourceGaps.length === 0).map(row => row.close);
    const rsi = calculateRsiSeries(closes), macd = calculateMacdSeries(closes);
    let completedIndex = -1;
    return rows.map(row => {
      const unavailable = { state: 'unavailable' as const,
        reason: row.sourceGaps.length ? 'source_gap' as const : row.partial ? 'partial_period' as const : 'warmup' as const };
      const complete = !row.partial && row.sourceGaps.length === 0;
      if (complete) completedIndex++;
      const numeric = (value: number | null | undefined) => {
        if (value == null) return unavailable;
        if (!Number.isFinite(value)) fail('invalid_input');
        return { state: 'available' as const, value };
      };
      const current = complete ? macd[completedIndex] : null, previous = complete ? macd[completedIndex - 1] : null;
      return { ...row,
        rsi: numeric(complete ? rsi[completedIndex] : null), macd: numeric(current?.value),
        signal: numeric(current?.signal), histogram: numeric(current?.histogram),
        cross: current && previous ? { state: 'available' as const, value: previous.value <= previous.signal
          && current.value > current.signal ? 'golden_cross' as const : 'none' as const } : unavailable,
        sma20: numeric(complete ? calculateSma(closes.slice(Math.max(0, completedIndex - 19), completedIndex + 1), 20) : null),
        completion: interval !== 'day' && row.periodEnd >= input.calculationDate ? 'ongoing' as const : 'confirmed' as const,
        coverage: row.periodStart < from || eligibleCalendar.calendar.sessions.some(date => date >= row.periodStart && date < result.calculationFrom)
          ? 'history_coverage_clipped' as const : 'complete' as const,
      };
    });
  };
  const series = { day: decorate('day'), week: decorate('week'), month: decorate('month') };
  return { input, result: { ...result, intervals: series },
    basis: input.daily.filter(row => row.Date >= from).map(row => ({ date: row.Date,
      priceDigest: digest(json({ O: row.O, H: row.H, L: row.L, C: row.C, AdjO: row.AdjO, AdjH: row.AdjH, AdjL: row.AdjL, AdjC: row.AdjC })),
      adjustmentDigest: digest(json({ AdjFactor: row.AdjFactor, ExRT: row.ExRT })) })) };
}

/** Whole-artifact changes are not price-basis changes. No automatic conversion. */
export function compareDrawingBasis(before: TechnicalInput, after: TechnicalInput, from: string, through: string): 'compatible' | 'basis_review_required' {
  parse(DateValue, from); parse(DateValue, through);
  if (from > through) fail('invalid_input');
  const a = calculateWorkspaceTechnical(before), b = calculateWorkspaceTechnical(after);
  if (a.input.identity.instrumentId !== b.input.identity.instrumentId || a.input.identity.code !== b.input.identity.code
    || before.adjustmentMethod !== after.adjustmentMethod || from < before.eligibilityFrom || from < after.eligibilityFrom) return 'basis_review_required';
  // A new corporate-action event can change the coordinate basis even when the
  // provider has not yet restated overlapping prices. Do not infer compatibility.
  if (after.daily.some(row => row.Date > before.queryTo && (row.AdjFactor !== 1 || row.ExRT !== null))) return 'basis_review_required';
  const oldRows = a.basis.filter(row => row.date >= from && row.date <= through);
  const newRows = b.basis.filter(row => row.date >= from && row.date <= through);
  if (!oldRows.length || oldRows[0]!.date !== from || oldRows.at(-1)!.date !== through
    || json(oldRows) !== json(newRows)) return 'basis_review_required';
  return 'compatible';
}
