import { z } from 'zod';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { TechnicalSourceSmokeClientV1, TechnicalSourceSmokeErrorV1, TECHNICAL_SOURCE_SMOKE_LIMITS_V1 } from '../market-data/technical-source-smoke.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, mapTechnicalDailyBarsV1,
  resolveTechnicalEligibleThroughV1, validateCurrentTechnicalMasterV1, digestTechnicalSourceRowsV1,
  TECHNICAL_SOURCE_ENDPOINTS_V1 } from '../market-data/technical-source-gate.js';
import { normalizeTechnicalDailyObservationV1 } from '../market-data/technical-series.js';

const fail = (): never => { throw new TechnicalSourceSmokeErrorV1('source_response_invalid'); };
const code = z.string().regex(/^[0-9A-Z]{5}$/);
const masterFields = z.object({ Date: z.string(), Code: code, Mkt: z.string().regex(/^\d{4}$/),
  ProdCat: z.string().regex(/^\d{3}$/) });

/** Diagnostic only. Current code observations are not historical identity proof. */
export async function proveWorkspaceSourceFields(client: TechnicalSourceSmokeClientV1) {
  if (client.metrics.length) throw new TechnicalSourceSmokeErrorV1('invalid_configuration');
  const inherited = createTechnicalSourceRequestWindowV1(client.acceptedAt);
  const start = new Date(`${inherited.calculationDate.slice(0, 7)}-01T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const from = start.toISOString().slice(0, 10);
  const window = { ...inherited, queryFrom: from, calendarCoverageFrom: from };
  const calendarFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
    { from, to: window.calendarCoverageTo });
  const calendar = mapTechnicalCalendarV1(calendarFetch.rows, from, window.calendarCoverageTo);
  const through = resolveTechnicalEligibleThroughV1(window, calendar.calendar);
  const catalogFetch = await client.getCatalog(through);
  const seen = new Set<string>();
  const ordinary = [];
  for (const raw of catalogFetch.rows) {
    const result = masterFields.safeParse(raw);
    if (!result.success || result.data.Date !== through || seen.has(result.data.Code)) return fail();
    const row = result.data; seen.add(row.Code);
    if (row.ProdCat !== '011' || !['0105', '0111', '0112', '0113'].includes(row.Mkt)) continue;
    if (!row.Code.endsWith('0') || !CanonicalTickerSchema.safeParse(row.Code.slice(0, 4)).success) continue;
    const checked = validateCurrentTechnicalMasterV1([raw], { ticker: row.Code.slice(0, 4), eligibleThrough: through,
      environment: client.processEnvironment });
    if (checked.state !== 'accepted') return fail();
    ordinary.push(checked.observation);
  }
  ordinary.sort((a, b) => a.Code.localeCompare(b.Code));
  if (!ordinary.some(row => row.Code === '72030')) return fail();
  const fetched = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars, { code: '72030', from, to: through });
  const adjusted = mapTechnicalDailyBarsV1(fetched.rows, { ticker: '7203', queryFrom: from,
    eligibleThrough: through, calendar: calendar.calendar });
  const rawByDate = new Map<string, Record<string, unknown>>();
  for (const raw of fetched.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    const row = raw as Record<string, unknown>;
    rawByDate.set(String(row.Date), row);
  }
  const normalized = adjusted.rows.map(row => {
    const raw = rawByDate.get(row.Date)!;
    const numeric = (key: string) => {
      const value = raw[key];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return fail();
      return value as number | null;
    };
    const observation = normalizeTechnicalDailyObservationV1({ date: row.Date, open: numeric('O'),
      high: numeric('H'), low: numeric('L'), close: numeric('C'), volume: numeric('Vo') });
    if ((observation.kind === 'bar') !== (row.AdjC !== null)) return fail();
    return { ...row, O: numeric('O'), H: numeric('H'), L: numeric('L'), C: numeric('C'), Vo: numeric('Vo') };
  });
  const result = { schemaVersion: 'workspace_source_field_gate_v1', state: 'passed',
    acceptedAt: client.acceptedAt, checkedAt: client.now(), from, through,
    limits: TECHNICAL_SOURCE_SMOKE_LIMITS_V1,
    totals: { attempts: client.attempts, pages: client.pages, rows: client.rows, responseBytes: client.responseBytes },
    ordinaryStockCount: ordinary.length, dailyRowCount: normalized.length,
    catalogDigest: digestTechnicalSourceRowsV1(ordinary, client.processEnvironment),
    dailyDigest: digestTechnicalSourceRowsV1(normalized, client.processEnvironment),
    calendarDigest: digestTechnicalSourceRowsV1(calendar.rows, client.processEnvironment),
    nonUnitFactorDates: normalized.filter(row => row.AdjFactor !== 1).map(row => row.Date),
    historicalIdentity: 'not_verified', adjustmentVintageComparison: 'not_verified',
    maximumTenYearEntitlement: 'not_tested', sourceRevision: 'official_specs_retrieved_2026_09_12' };
  digestTechnicalSourceRowsV1(result as CanonicalJsonValue, client.processEnvironment);
  return result;
}

if (import.meta.main) {
  void (async () => {
    if (process.argv.slice(2).join('\0') !== '--confirm-external-fetch') throw new TechnicalSourceSmokeErrorV1('cancelled');
    console.log(canonicalJsonV1(await proveWorkspaceSourceFields(new TechnicalSourceSmokeClientV1()) as CanonicalJsonValue));
  })().catch(error => {
    console.error(JSON.stringify({ state: 'unavailable', code: error instanceof TechnicalSourceSmokeErrorV1
      ? error.code : 'source_response_invalid' }));
    process.exitCode = 1;
  });
}
