import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { parseStrictJsonBytesV1 } from '../strategy-validation/strict-json.js';
import { parseRetryAfterMs, type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { digestMarketSourceInputV1, type SourceInputV1 } from './contracts.js';
import { currentCodeWarningsV1, marketDataJobFailureV1, type MarketDataJobFailureCodeV1 } from './job-schema.js';
import { createTechnicalArtifactCodecV1, technicalSourceIdentityV1 } from './technical-artifact.js';
import { calculateTechnicalSeriesV1, TECHNICAL_INDICATOR_METHODS_V1, TechnicalSeriesErrorV1 } from './technical-series.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, mapTechnicalDailyBarsV1,
  resolveTechnicalEligibleThroughV1, validateCurrentTechnicalMasterV1, TechnicalSourceGateErrorV1,
  TECHNICAL_SOURCE_ENDPOINTS_V1 } from './technical-source-gate.js';
import { classifyPlanRestrictionResponse } from './technical-source-smoke.js';
import type { OverviewCollectionContextV1 } from './overview-registry.js';

export const TECHNICAL_JOB_LIMITS_V1 = Object.freeze({ estimatedMinimumAttempts: 3,
  maximumAttempts: 20, maximumPages: 20, maximumRows: 8000,
  maximumResponseBytes: 32 * 1024 * 1024, executionBudgetMs: 600_000 });
const bounds = { pages: TECHNICAL_JOB_LIMITS_V1.maximumPages, rows: TECHNICAL_JOB_LIMITS_V1.maximumRows,
  responseBytes: TECHNICAL_JOB_LIMITS_V1.maximumResponseBytes };
export type TechnicalCollectionContextV1 = OverviewCollectionContextV1 & Readonly<{
  waitBeforeRetry(delayMs: number): Promise<void>;
}>;
class RetryableTechnicalFailure extends Error {
  constructor(readonly code: 'source_rate_limited' | 'source_invalid_response', readonly delayMs: number | null) {
    super(code);
  }
}
export class TechnicalSourceFailureV1 extends Error {
  constructor(readonly code: Exclude<MarketDataJobFailureCodeV1, 'all_modules_failed'>) {
    super(marketDataJobFailureV1(code).message);
  }
}
const fail = (code: TechnicalSourceFailureV1['code']): never => { throw new TechnicalSourceFailureV1(code); };

/** Shared bounded transport; callers own mapping and source identity. */
export function createMarketDataReaderV1(context: TechnicalCollectionContextV1,
  environment: JQuantsExecutionEnvironmentV1, bounds: { pages: number; rows: number; responseBytes: number }) {
  const key = environment.apiKey();
  if (!key || /[\r\n]/.test(key)) return fail('source_unauthorized');
  let pages = 0, rowCount = 0, bytes = 0, attempts = 0;
  const fetched = new Map<string, { rows: readonly unknown[]; fetchedAt: string; pageCount: number }>();
  async function dispatchWithRetry<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
      try { return await context.dispatch(start); }
      catch (error) {
        if (context.signal.aborted) return fail('source_timeout');
        if (!(error instanceof RetryableTechnicalFailure)) throw error;
        if (retry === 2) return fail(error.code);
        await context.waitBeforeRetry(error.delayMs ?? (retry + 1) * 1000);
      }
    }
  }
  async function fetchRows(role: string, endpoint: string, query: Record<string, string>) {
    const rows: unknown[] = [], cursors = new Set<string>();
    let cursor: string | undefined, sourcePages = 0;
    do {
      if (pages >= bounds.pages) fail('source_pagination_incomplete');
      const url = new URL(`https://api.jquants.com${endpoint}`);
      Object.entries(query).forEach(([name, value]) => url.searchParams.set(name, value));
      if (cursor !== undefined) url.searchParams.set('pagination_key', cursor);
      const payload = await dispatchWithRetry(async signal => {
        attempts++;
        let response: Response;
        try { response = await environment.fetch(url, { method: 'GET', redirect: 'error',
          headers: { 'x-api-key': key! }, signal }); }
        catch {
          if (signal.aborted) return fail('source_timeout');
          throw new RetryableTechnicalFailure('source_invalid_response', null);
        }
        if (response.status === 429 || response.status >= 500 && response.status <= 599) {
          const delay = parseRetryAfterMs(response.headers.get('retry-after'), environment.wallNowMs());
          await response.body?.cancel();
          throw new RetryableTechnicalFailure(response.status === 429 ? 'source_rate_limited' : 'source_invalid_response', delay);
        }
        if (!response.ok && response.status !== 400) {
          await response.body?.cancel();
          return fail(response.status === 401 ? 'source_unauthorized' : response.status === 403
            ? 'source_entitlement_required' : response.status === 429 ? 'source_rate_limited' : 'source_invalid_response');
        }
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > bounds.responseBytes - bytes)) {
          await response.body?.cancel(); return fail('source_response_too_large');
        }
        if (!response.body) return fail('source_invalid_response');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > bounds.responseBytes - bytes) { await reader.cancel(); return fail('source_response_too_large'); }
            chunks.push(chunk.value);
          }
        } catch (error) {
          if (error instanceof TechnicalSourceFailureV1) throw error;
          return fail(signal.aborted ? 'source_timeout' : 'source_invalid_response');
        } finally { reader.releaseLock(); }
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        bytes += size;
        if (!response.ok) return fail(classifyPlanRestrictionResponse(response.status, data, query) !== null
          ? 'source_entitlement_required' : 'source_invalid_response');
        return { data, size };
      });
      let raw: unknown;
      try { raw = parseStrictJsonBytesV1(payload.data, bounds.responseBytes); }
      catch { return fail('source_invalid_response'); }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('source_invalid_response');
      const obj = raw as Record<string, unknown>;
      if (Object.keys(obj).some(key => key !== 'data' && key !== 'pagination_key') || !Array.isArray(obj.data)) return fail('source_invalid_response');
      rowCount += obj.data.length; pages++; sourcePages++;
      context.recordProgress({ pages: 1, acceptedRows: obj.data.length, responseBytes: payload.size });
      if (rowCount > bounds.rows) return fail('source_response_too_large');
      rows.push(...obj.data);
      if (obj.pagination_key !== undefined && (typeof obj.pagination_key !== 'string'
        || !obj.pagination_key.length || obj.pagination_key.length > 2048
        || /[\u0000-\u001f\u007f-\u009f]/.test(obj.pagination_key) || cursors.has(obj.pagination_key))) return fail('source_pagination_incomplete');
      cursor = obj.pagination_key as string | undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor !== undefined);
    fetched.set(role, { rows, fetchedAt: new Date(environment.wallNowMs()).toISOString(), pageCount: sourcePages });
    return rows;
  }
  return { fetchRows, fetched, metrics: () => ({ attempts, pages, acceptedRows: rowCount, responseBytes: bytes }) };
}

/** All network dispatches go through the admitted Dashboard lease, not the CLI limiter. */
export async function collectTechnicalV1(ticker: string, context: TechnicalCollectionContextV1,
  environment: JQuantsExecutionEnvironmentV1, secrets: NodeJS.ProcessEnv = process.env) {
  CanonicalTickerSchema.parse(ticker);
  const window = createTechnicalSourceRequestWindowV1(context.acceptedAt);
  const reader = createMarketDataReaderV1(context, environment, bounds);
  const { fetchRows, fetched } = reader;
  try {
    const calendarRows = await fetchRows('trading_calendar', TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
      { from: window.calendarCoverageFrom, to: window.calendarCoverageTo });
    const calendar = mapTechnicalCalendarV1(calendarRows, window.calendarCoverageFrom, window.calendarCoverageTo);
    const eligibleThrough = resolveTechnicalEligibleThroughV1(window, calendar.calendar);
    const code = `${ticker}0`;
    const masterRows = await fetchRows('security_master', TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster, { code, date: eligibleThrough });
    const master = validateCurrentTechnicalMasterV1(masterRows, { ticker, eligibleThrough, environment: secrets });
    if (master.state !== 'accepted') return fail('instrument_identity_unverified');
    const barRows = await fetchRows('daily_bars', TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars,
      { code, from: window.queryFrom, to: eligibleThrough });
    const mapped = mapTechnicalDailyBarsV1(barRows, { ticker, queryFrom: window.queryFrom, eligibleThrough, calendar: calendar.calendar });
    const result = calculateTechnicalSeriesV1({ observations: mapped.observations, calendar: calendar.calendar,
      window: { queryFrom: window.queryFrom, eligibleThrough, calculationDate: window.calculationDate, historyBoundary: mapped.historyBoundary } });
    const normalized = { daily_bars: mapped.rows, security_master: [master.observation], trading_calendar: calendar.rows };
    const sourceInputs: SourceInputV1[] = (['daily_bars', 'security_master', 'trading_calendar'] as const).map(role => {
      const source = fetched.get(role)!;
      const identity = technicalSourceIdentityV1(role, { jquantsCode: code, queryFrom: window.queryFrom,
        queryTo: eligibleThrough, acceptedAt: context.acceptedAt });
      const inputDigest = digestMarketSourceInputV1(identity, normalized[role],
        rows => rows as CanonicalJsonValue, secrets);
      return { ...identity, inputDigest, asOfCutoff: context.acceptedAt, fetchedAt: source.fetchedAt,
        // Minimum verified entitlement class: successful exact ten-year query proves Standard capability.
        entitlementClass: 'standard', entitlementVerifiedAt: source.fetchedAt,
        pagination: { complete: true, pageCount: source.pageCount, rowCount: source.rows.length } };
    });
    const artifact = createTechnicalArtifactCodecV1(ticker, secrets).build({
      schemaVersion: 'technical_chart_dataset_v1', calculationVersion: 'technical_chart_calculation_v2',
      ticker, jquantsCode: code, instrumentName: master.observation.CoName, priceUnit: 'JPY', volumeUnit: 'shares',
      acceptedAt: context.acceptedAt, asOfCutoff: context.acceptedAt, calculationDate: window.calculationDate,
      queryFrom: window.queryFrom, queryTo: eligibleThrough, calculationFrom: result.calculationFrom,
      calculationTo: result.calculationTo, eligibleThrough, historyBoundary: mapped.historyBoundary,
      dataDate: result.dataDate, fetchedAt: sourceInputs.map(input => input.kind === 'provider' ? input.fetchedAt : '').sort().at(-1),
      adjustmentBasis: 'jquants_adjusted_ohlcv_not_total_return', sourceInputs, indicatorMethods: TECHNICAL_INDICATOR_METHODS_V1,
      dailyObservations: result.dailyObservations, series: result.intervals, unavailablePeriods: result.unavailablePeriods,
      warnings: currentCodeWarningsV1({ kind: 'technical', boundary: { state: 'available',
        sourceCoverageFrom: result.calculationFrom, historyCoverageClipped: result.historyCoverageClipped } }),
    });
    return { artifact, ...reader.metrics() };
  } catch (error) {
    if (error instanceof TechnicalSourceGateErrorV1 || error instanceof TechnicalSeriesErrorV1) {
      return fail(error.code === 'source_no_observation' ? 'source_no_observation'
        : error.code === 'source_not_yet_updated' ? 'source_not_yet_updated' : 'source_invalid_response');
    }
    throw error;
  }
}
