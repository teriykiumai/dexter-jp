import { z } from 'zod';
import { calculateMacdSeries, calculateRsiSeries } from '../../tools/finance/advanced-technical-engine.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { MarketDataArtifactCodecV1, MarketDataArtifactCommonFieldsV1 } from './artifact-codec.js';
import { MarketDataDateV1Schema as date, MarketDataInstantV1Schema,
  failMarketData, type SourceInputV1 } from './contracts.js';
import { MarketDataWarningV1Schema, assertCurrentCodeWarningsV1 } from './job-schema.js';
import { parseTechnicalDailyObservationV1 } from './technical-series.js';
import { createTechnicalSourceRequestWindowV1, TECHNICAL_SOURCE_REGISTRY_V1 } from './technical-source-gate.js';

const finite = z.number().finite();
const prices = { open: finite.positive(), high: finite.positive(), low: finite.positive(),
  close: finite.positive(), volume: finite.nonnegative() };
const unavailable = z.object({ state: z.literal('unavailable'), reason: z.enum(['warmup', 'partial_period']) }).strict();
const indicator = z.union([z.object({ state: z.literal('available'), value: finite }).strict(), unavailable]);
const period = { interval: z.enum(['day', 'week', 'month']), identity: z.string().min(7).max(10),
  periodStart: date, periodEnd: date };
const candle = z.object({ ...period, ...prices, displayDate: date, firstSessionDate: date,
  lastSessionDate: date, partial: z.boolean(), rsi: indicator, macd: indicator,
  signal: indicator, histogram: indicator,
  cross: z.union([z.object({ state: z.literal('available'), value: z.enum(['golden_cross', 'none']) }).strict(), unavailable]),
}).strict();
const observation = z.union([
  z.object({ kind: z.literal('bar'), date, ...prices }).strict(),
  z.object({ kind: z.literal('gap'), date, reason: z.literal('source_all_null') }).strict(),
]);
const boundary = z.object({ state: z.literal('available'), contractVersion: z.literal('current_code_history_v1'),
  mode: z.literal('current_code_only'), jquantsCode: z.string(), currentMasterDate: date,
  sourceCoverageFrom: date, sourceCoverageThrough: date, historicalIdentity: z.literal('not_verified') }).strict();
const dataset = z.object({ ...MarketDataArtifactCommonFieldsV1,
  schemaVersion: z.literal('technical_chart_dataset_v1'), calculationVersion: z.literal('technical_chart_calculation_v2'),
  ticker: CanonicalTickerSchema, jquantsCode: z.string(), instrumentName: z.string().min(1).max(160),
  priceUnit: z.literal('JPY'), volumeUnit: z.literal('shares'), acceptedAt: MarketDataInstantV1Schema,
  queryFrom: date, queryTo: date, calculationFrom: date, calculationTo: date, eligibleThrough: date,
  historyBoundary: boundary, adjustmentBasis: z.literal('jquants_adjusted_ohlcv_not_total_return'),
  indicatorMethods: z.object({ rsi: z.literal('rsi_wilder_14_v1'), macd: z.literal('macd_ema_12_26_9_v1') }).strict(),
  dailyObservations: z.array(observation).min(1).max(8000),
  series: z.object({ day: z.array(candle).max(8000), week: z.array(candle).max(8000), month: z.array(candle).max(8000) }).strict(),
  unavailablePeriods: z.array(z.object({ ...period, reason: z.enum(['source_gap', 'partial_period']) }).strict()).max(24000),
  warnings: z.array(MarketDataWarningV1Schema).max(2),
}).strict();
export type TechnicalChartDatasetV1 = z.infer<typeof dataset>;
const same = (a: unknown, b: unknown) => canonicalJsonV1(a as CanonicalJsonValue) === canonicalJsonV1(b as CanonicalJsonValue);
const invalid = () => failMarketData('invalid_artifact');

export function technicalSourceIdentityV1(role: string, artifact: Pick<TechnicalChartDatasetV1,
  'jquantsCode' | 'queryFrom' | 'queryTo' | 'acceptedAt'>) {
  const source = TECHNICAL_SOURCE_REGISTRY_V1.find(item => item.role === role);
  if (!source) return invalid();
  const window = createTechnicalSourceRequestWindowV1(artifact.acceptedAt);
  const query: Record<string, string> = role === 'daily_bars' ? { code: artifact.jquantsCode, from: artifact.queryFrom, to: artifact.queryTo }
    : role === 'security_master' ? { code: artifact.jquantsCode, date: artifact.queryTo }
      : { from: window.calendarCoverageFrom, to: window.calendarCoverageTo };
  return { kind: 'provider' as const, role, sourceId: source.sourceId,
    sourceContractVersion: source.sourceContractVersion, sourceMappingVersion: source.sourceMappingVersion,
    sourceRevisionIds: [...source.sourceRevisionIds], endpoint: source.endpoint,
    normalizedQueryIdentity: canonicalJsonV1(query as CanonicalJsonValue),
    dataDateOrEffectiveRange: role === 'security_master' ? artifact.queryTo
      : { from: role === 'daily_bars' ? artifact.queryFrom : window.calendarCoverageFrom,
        through: role === 'daily_bars' ? artifact.queryTo : window.calendarCoverageTo },
    publishedDate: null, publishedAt: null, cadence: 'daily',
    unitAndCoverageBasis: role === 'daily_bars' ? 'jquants_adjusted_ohlcv_not_total_return:JPY:shares'
      : role === 'security_master' ? 'current_master_expectation_v1'
        : 'standard_calendar_boundary_v2:Date:HolDiv',
  };
}

function validateInputs(inputs: readonly SourceInputV1[], artifact: TechnicalChartDatasetV1) {
  if (!same(inputs.map(input => input.role), ['daily_bars', 'security_master', 'trading_calendar'])) invalid();
  for (const input of inputs) {
    if (input.kind !== 'provider') return invalid();
    const { fetchedAt: _f, entitlementClass: _e, entitlementVerifiedAt: _v, pagination: _p,
      asOfCutoff: _a, inputDigest: _d, ...identity } = input;
    if (!same(identity, technicalSourceIdentityV1(input.role, artifact)) || input.pagination.pageCount > 20
      || input.pagination.rowCount > 8000) invalid();
    if (input.role === 'security_master' && input.pagination.rowCount !== 1) invalid();
    if (input.role === 'daily_bars' && input.pagination.rowCount !== artifact.dailyObservations.length) invalid();
  }
}

function validateStored(value: TechnicalChartDatasetV1): boolean {
  try {
    const w = createTechnicalSourceRequestWindowV1(value.acceptedAt);
    if (value.queryFrom !== w.queryFrom || value.queryTo !== value.eligibleThrough
      || value.calculationTo !== value.queryTo || value.queryTo > w.calculationDate
      || value.calculationFrom !== value.historyBoundary.sourceCoverageFrom
      || value.historyBoundary.sourceCoverageThrough !== value.queryTo
      || value.historyBoundary.currentMasterDate !== value.queryTo
      || value.historyBoundary.jquantsCode !== value.jquantsCode
      || value.instrumentName !== value.instrumentName.trim()) return false;
    const observations = value.dailyObservations.map(parseTechnicalDailyObservationV1);
    if (observations[0]!.date !== value.calculationFrom || observations.at(-1)!.date !== value.queryTo
      || observations.some((row, i) => row.date < value.queryFrom || row.date > value.queryTo
        || (i > 0 && observations[i - 1]!.date >= row.date))) return false;
    const bars = observations.filter(row => row.kind === 'bar');
    if (!bars.length || bars.at(-1)!.date !== value.dataDate) return false;
    const clipped = value.warnings.some(warning => warning.code === 'history_coverage_clipped');
    assertCurrentCodeWarningsV1(value.warnings, { kind: 'technical', boundary: {
      state: 'available', sourceCoverageFrom: value.calculationFrom, historyCoverageClipped: clipped } });
    for (const interval of ['day', 'week', 'month'] as const) {
      const rows = value.series[interval];
      const groups = new Map<string, { start: string; end: string }>();
      for (const observation of observations) {
        const date = new Date(`${observation.date}T00:00:00Z`);
        if (interval === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        if (interval === 'month') date.setUTCDate(1);
        const start = date.toISOString().slice(0, 10);
        if (interval === 'week') date.setUTCDate(date.getUTCDate() + 6);
        if (interval === 'month') date.setUTCMonth(date.getUTCMonth() + 1, 0);
        const end = date.toISOString().slice(0, 10), identity = interval === 'month' ? start.slice(0, 7) : start;
        groups.set(identity, { start, end });
      }
      const output = [...rows, ...value.unavailablePeriods.filter(row => row.interval === interval)];
      if (output.length !== groups.size || new Set(output.map(row => row.identity)).size !== groups.size
        || output.some(row => groups.get(row.identity)?.start !== row.periodStart || groups.get(row.identity)?.end !== row.periodEnd)) return false;
      if (rows.some((row, i) => row.interval !== interval || (i > 0 && rows[i - 1]!.identity >= row.identity))) return false;
      for (const row of rows) {
        const included = bars.filter(bar => row.periodStart <= bar.date && bar.date <= row.periodEnd);
        if (!included.length || row.periodStart > row.firstSessionDate || row.lastSessionDate > row.periodEnd
          || row.firstSessionDate !== included[0]!.date || row.lastSessionDate !== included.at(-1)!.date
          || row.displayDate !== row.lastSessionDate || row.open !== included[0]!.open
          || row.close !== included.at(-1)!.close || row.high !== Math.max(...included.map(bar => bar.high))
          || row.low !== Math.min(...included.map(bar => bar.low))
          || row.volume !== included.reduce((sum, bar) => sum + bar.volume, 0)) return false;
        if (interval === 'day' && (row.partial || row.identity !== row.displayDate
          || row.periodStart !== row.displayDate || row.periodEnd !== row.displayDate)) return false;
        if (interval !== 'day' && (row.periodStart < value.queryFrom || row.periodEnd >= value.calculationDate) && !row.partial) return false;
        for (const field of ['rsi', 'macd', 'signal', 'histogram', 'cross'] as const) {
          const indicator = row[field];
          if (row.partial ? indicator.state !== 'unavailable' || indicator.reason !== 'partial_period'
            : indicator.state === 'unavailable' && indicator.reason === 'partial_period') return false;
        }
        if (row.rsi.state === 'available' && (row.rsi.value < 0 || row.rsi.value > 100)) return false;
      }
      if (interval === 'day' && rows.length !== bars.length) return false;
      // Validate deterministic indicators from stored completed candles, without
      // claiming to re-prove their calendar-dependent completeness flags.
      const complete = rows.filter(row => !row.partial);
      const closes = complete.map(row => row.close);
      const rsi = calculateRsiSeries(closes), macd = calculateMacdSeries(closes);
      const numeric = (value: number | null) => value === null
        ? { state: 'unavailable', reason: 'warmup' } : { state: 'available', value };
      for (let i = 0; i < complete.length; i++) {
        const row = complete[i]!, current = macd[i], previous = macd[i - 1];
        if (!same(row.rsi, numeric(rsi[i] ?? null)) || !same(row.macd, numeric(current?.value ?? null))
          || !same(row.signal, numeric(current?.signal ?? null)) || !same(row.histogram, numeric(current?.histogram ?? null))
          || !same(row.cross, current && previous ? { state: 'available', value:
            previous.value <= previous.signal && current.value > current.signal ? 'golden_cross' : 'none' }
            : { state: 'unavailable', reason: 'warmup' })) return false;
      }
    }
    const identities = new Set<string>();
    const keys = value.unavailablePeriods.map(row => `${['day', 'week', 'month'].indexOf(row.interval)}:${row.identity}`);
    if (!same(keys, [...keys].sort())) return false;
    for (const row of value.unavailablePeriods) {
      const key = `${row.interval}:${row.identity}`;
      if (identities.has(key) || row.periodStart > row.periodEnd
        || value.series[row.interval].some(candle => candle.identity === row.identity)) return false;
      identities.add(key);
      const included = observations.filter(obs => row.periodStart <= obs.date && obs.date <= row.periodEnd);
      if (!included.length || included.some(obs => obs.kind === 'bar')) return false;
      if (row.interval === 'day' && (row.reason !== 'source_gap' || row.identity !== row.periodStart || row.periodStart !== row.periodEnd)) return false;
      if (row.interval !== 'day' && (row.periodStart < value.queryFrom || row.periodEnd >= value.calculationDate)
        && row.reason !== 'partial_period') return false;
    }
    return true;
  } catch { return false; }
}

export function createTechnicalArtifactCodecV1(ticker: string, environment: NodeJS.ProcessEnv = process.env) {
  return new MarketDataArtifactCodecV1({ schema: dataset.refine(validateStored), target: { kind: 'technical', ticker },
    validateSourceInputs: validateInputs, environment });
}
