import { z } from 'zod';
import { mapDividendSummaryRow } from '../../tools/finance/dividend-summary.js';
import { analyzeDividendFiscalObservations } from '../../tools/finance/advanced-dividend-engine.js';
import { mapWorkspaceFinancialSummaries } from './financial-input.js';
import { DateValue, digest, json } from './contracts.js';
import { createMarketDataReaderV1, TechnicalSourceFailureV1, type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, mapTechnicalDailyBarsV1, validateCurrentTechnicalMasterV1 } from '../market-data/technical-source-gate.js';
import { DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1, resolveJQuantsRequestsPerMinuteV1,
  type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

export const FINANCIAL_SMOKE_SAMPLE = Object.freeze({ code: '72030', through: '2026-09-11',
  priceFrom: '2026-08-01' });
export const FINANCIAL_SMOKE_LIMITS = Object.freeze({ logicalQueries: 4, attempts: 20, pages: 20, rows: 8000,
  responseBytes: 32 * 1024 * 1024, deadlineMs: 180_000, requestTimeoutMs: 30_000, retries: 0, maximumRequestsPerMinute: 5 });
export class FinancialSmokeError extends Error {
  constructor(readonly code: 'cancelled' | 'invalid_configuration' | 'execution_timeout' | 'attempt_limit_exceeded'
    | 'retry_disabled' | 'source_response_invalid', readonly fields: string[] = []) { super(code); }
}
const fail = (code: FinancialSmokeError['code']): never => { throw new FinancialSmokeError(code); };
const numeric = z.preprocess(value => {
  if (value === null || typeof value === 'string' && ['', '-'].includes(value.trim())) return null;
  return typeof value === 'string' ? Number(value) : value;
}, z.number().finite().nullable());
const optionalDate = z.union([DateValue, z.literal(''), z.literal('-'), z.null()]);
const financialFields = z.object({ DocType: z.string().min(1).max(128), CurPerType: z.enum(['1Q', '2Q', '3Q', '4Q', '5Q', 'FY', '']),
  CurPerSt: optionalDate, CurPerEn: optionalDate, CurFYSt: DateValue, CurFYEn: DateValue,
  Sales: numeric, OP: numeric, OdP: numeric, NP: numeric, EPS: numeric, BPS: numeric, TA: numeric,
  Eq: numeric, EqAR: numeric, CFO: numeric, CFI: numeric, CFF: numeric, ShOutFY: numeric, TrShFY: numeric });
const statementDocument = /^(?:FY|[123]Q|OtherPeriod)FinancialStatements_(?:Consolidated|NonConsolidated)_(?:JP|US|IFRS|JMIS)$/;
const revisions = new Set(['EarnForecastRevision', 'DividendForecastRevision']);

/** Field diagnostic only: a current ticker and source dates never establish historical ownership or share basis. */
export function inspectFinancialSourceRows(rows: readonly unknown[]) {
  const seen = new Set<string>();
  return rows.map(raw => {
    const parsed = financialFields.safeParse(raw);
    if (!parsed.success) throw new FinancialSmokeError('source_response_invalid',
      [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? '')).filter(key => Object.hasOwn(financialFields.shape, key)))].sort());
    let dividend;
    try { dividend = mapDividendSummaryRow(raw, FINANCIAL_SMOKE_SAMPLE.code); }
    catch { return fail('source_response_invalid'); }
    if (seen.has(dividend.disclosureNumber) || dividend.disclosedDate > FINANCIAL_SMOKE_SAMPLE.through
      || parsed.data.CurFYSt > parsed.data.CurFYEn) return fail('source_response_invalid');
    seen.add(dividend.disclosureNumber);
    const knownDocument = statementDocument.test(parsed.data.DocType) || revisions.has(parsed.data.DocType);
    if (statementDocument.test(parsed.data.DocType) && (!DateValue.safeParse(parsed.data.CurPerSt).success
      || !DateValue.safeParse(parsed.data.CurPerEn).success
      || parsed.data.CurPerSt! > parsed.data.CurPerEn!
      || parsed.data.CurPerEn! > dividend.disclosedDate)) return fail('source_response_invalid');
    return { ...parsed.data, dividend, knownDocument };
  });
}

type Diagnostic = { stage: 'configuration' | 'master' | 'summary' | 'calendar' | 'prices';
  attempts: number; pages: number; acceptedRows: number; responseBytes: number };
export async function proveFinancialSourceFields(options: { confirmed: boolean; environment?: JQuantsExecutionEnvironmentV1;
  requestsPerMinute?: number; observe?: (diagnostic: Diagnostic) => void }) {
  if (!options.confirmed) return fail('cancelled');
  const env = options.environment ?? DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1;
  const now = env.wallNowMs(), origin = env.monotonicNowMs();
  const configured = options.requestsPerMinute ?? resolveJQuantsRequestsPerMinuteV1();
  if (!Number.isFinite(now) || now < Date.parse('2026-09-11T15:00:00Z') || !Number.isFinite(origin)
    || !Number.isInteger(configured) || configured < 1 || configured > 500) return fail('invalid_configuration');
  const rpm = Math.min(configured, FINANCIAL_SMOKE_LIMITS.maximumRequestsPerMinute);
  const abort = new AbortController(), deadline = setTimeout(() => abort.abort(), FINANCIAL_SMOKE_LIMITS.deadlineMs);
  let attempts = 0, lastDispatch = -Infinity;
  const check = () => { if (abort.signal.aborted || env.monotonicNowMs() - origin >= FINANCIAL_SMOKE_LIMITS.deadlineMs)
    { abort.abort(); return fail('execution_timeout'); } };
  const context: TechnicalCollectionContextV1 = { jobId: 'diagnostic-only', acceptedAt: new Date(now).toISOString(),
    signal: abort.signal, shareSource: (_key, load) => load(), recordProgress: () => {},
    waitBeforeRetry: async () => fail('retry_disabled'), dispatch: async start => {
      check(); if (attempts >= FINANCIAL_SMOKE_LIMITS.attempts) return fail('attempt_limit_exceeded');
      const delay = lastDispatch + 60_000 / rpm - env.monotonicNowMs();
      if (delay > 0) await env.sleep(delay, abort.signal);
      check(); attempts++; lastDispatch = env.monotonicNowMs();
      const request = new AbortController(), onAbort = () => request.abort();
      abort.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(onAbort, FINANCIAL_SMOKE_LIMITS.requestTimeoutMs);
      let rejectTimeout!: () => void;
      const timeout = new Promise<never>((_resolve, reject) => {
        rejectTimeout = () => reject(new FinancialSmokeError('execution_timeout'));
        request.signal.addEventListener('abort', rejectTimeout, { once: true });
      });
      try { return await Promise.race([start(request.signal), timeout]); }
      finally { clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort);
        request.signal.removeEventListener('abort', rejectTimeout); }
    } };
  const reader = createMarketDataReaderV1(context, env, FINANCIAL_SMOKE_LIMITS);
  let stage: Diagnostic['stage'] = 'configuration';
  try {
    const { code, through, priceFrom } = FINANCIAL_SMOKE_SAMPLE;
    const calendarFrom = createTechnicalSourceRequestWindowV1(context.acceptedAt).queryFrom;
    if (calendarFrom > priceFrom) return fail('invalid_configuration');
    stage = 'master';
    const master = validateCurrentTechnicalMasterV1(await reader.fetchRows(stage, '/v2/equities/master', { code, date: through }),
      { ticker: code.slice(0, 4), eligibleThrough: through });
    if (master.state !== 'accepted') return fail('source_response_invalid');
    stage = 'summary';
    const rawSummary = await reader.fetchRows(stage, '/v2/fins/summary', { code });
    const summary = inspectFinancialSourceRows(rawSummary);
    if (summary.every(row => row.knownDocument)) {
      try { mapWorkspaceFinancialSummaries(rawSummary, code); }
      catch { return fail('source_response_invalid'); }
    }
    stage = 'calendar';
    const calendar = mapTechnicalCalendarV1(await reader.fetchRows(stage, '/v2/markets/calendar', { from: calendarFrom, to: through }), calendarFrom, through);
    // The inherited availability model is next official business day, not claimed receipt of a provider vintage.
    const selection = analyzeDividendFiscalObservations(code,
      summary.filter(row => row.dividend.disclosedDate >= calendarFrom).map(row => row.dividend),
      calendar.rows.map(row => ({ date: row.Date, holidayDivision: row.HolDiv })), through);
    stage = 'prices';
    const rawPrices = await reader.fetchRows(stage, '/v2/equities/bars/daily', { code, from: priceFrom, to: through });
    const prices = mapTechnicalDailyBarsV1(rawPrices, { ticker: code.slice(0, 4), queryFrom: priceFrom, eligibleThrough: through, calendar: calendar.calendar });
    const priceSchema = z.object({ Date: DateValue, C: z.number().finite().nonnegative().nullable() });
    const closes = rawPrices.map(row => { const checked = priceSchema.safeParse(row); return checked.success ? checked.data : fail('source_response_invalid'); });
    const annual = summary.filter(row => row.CurPerType === 'FY' && row.DocType.startsWith('FYFinancialStatements_')
      && row.dividend.currentFiscalYearEndDate <= through);
    const coverage = { financials: annual.some(row => row.Sales !== null && row.EPS !== null && row.BPS !== null),
      actualPayout: annual.some(row => row.dividend.actualPayoutRatio !== null),
      annualForecast: selection.observations.some(row => row.kind === 'company_forecast' && row.fiscalYearEndDate > through && row.annualDividendPerShare !== null),
      dailyClose: closes.some(row => row.Date === through && row.C !== null && row.C > 0),
      knownDocuments: summary.length > 0 && summary.every(row => row.knownDocument) };
    check();
    const evidence = (value: unknown) => ({ digest: digest(json(value)) });
    return { schemaVersion: 'workspace_financial_source_field_gate_v1',
      state: Object.values(coverage).every(Boolean) ? 'passed' : 'incomplete', scope: 'field_shape_only',
      sample: { ...FINANCIAL_SMOKE_SAMPLE, calendarFrom }, limits: FINANCIAL_SMOKE_LIMITS, requestsPerMinute: rpm,
      acceptedAt: context.acceptedAt, checkedAt: new Date(env.wallNowMs()).toISOString(), metrics: reader.metrics(), coverage,
      master: evidence(master.observation), summary: { ...evidence(summary), rowCount: summary.length, annualRowCount: annual.length,
        outsideAvailabilityCalendarCount: summary.filter(row => row.dividend.disclosedDate < calendarFrom).length,
        unknownDocumentCount: summary.filter(row => !row.knownDocument).length,
        blankForecastCount: summary.filter(row => row.dividend.forecastAnnualDividendPerShare === null).length,
        zeroForecastCount: summary.filter(row => row.dividend.forecastAnnualDividendPerShare === 0).length,
        unusualActualPayoutCount: annual.filter(row => row.dividend.actualPayoutRatio !== null
          && (row.dividend.actualPayoutRatio < 0 || row.dividend.actualPayoutRatio > 1)).length },
      calendar: { ...evidence(calendar.rows), rowCount: calendar.rows.length },
      prices: { ...evidence({ adjusted: prices.rows, closes }), rowCount: prices.rows.length,
        nonUnitFactorCount: prices.rows.filter(row => row.AdjFactor !== 1).length },
      sourceRevision: 'official_specs_retrieved_2026_09_13', availabilityPolicy: 'next_official_business_day',
      historicalIdentity: 'not_verified', forecastPriceShareBasis: 'not_verified',
      correctionVintage: 'current_at_fetch_not_point_in_time', productionProjectionGate: 'not_passed' };
  } finally { clearTimeout(deadline); abort.abort(); options.observe?.({ stage, ...reader.metrics() }); }
}

if (import.meta.main) {
  let diagnostic: Diagnostic | undefined;
  void proveFinancialSourceFields({ confirmed: process.argv.slice(2).join('\0') === '--confirm-external-fetch',
    observe: value => { diagnostic = value; } }).then(result => {
    console.log(json(result)); if (result.state !== 'passed') process.exitCode = 1;
  }).catch(error => {
    console.error(JSON.stringify({ state: 'unavailable', code: error instanceof FinancialSmokeError
      || error instanceof TechnicalSourceFailureV1 ? error.code : 'source_response_invalid',
      ...(diagnostic ? { diagnostic } : {}), ...(error instanceof FinancialSmokeError && error.fields.length ? { fields: error.fields } : {}) }));
    process.exitCode = 1;
  });
}
