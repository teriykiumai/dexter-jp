import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { TechnicalSourceSmokeClientV1, TechnicalSourceSmokeErrorV1,
  TECHNICAL_SOURCE_SMOKE_LIMITS_V1 } from './technical-source-smoke.js';
import { createTechnicalSourceRequestWindowV1, digestTechnicalSourceRowsV1,
  mapTechnicalCalendarV1, mapTechnicalDailyBarsV1, resolveTechnicalEligibleThroughV1,
  validateCurrentEtfMasterV1, TECHNICAL_SOURCE_ENDPOINTS_V1, TechnicalSourceGateErrorV1 } from './technical-source-gate.js';

/** Diagnostic gate only: no artifact, receipt, job, or production registration. */
export async function proveEtfSourceGateV1(client: TechnicalSourceSmokeClientV1) {
  if (client.metrics.length) throw new TechnicalSourceSmokeErrorV1('invalid_configuration');
  const window = createTechnicalSourceRequestWindowV1(client.acceptedAt);
  const calendarFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
    { from: window.calendarCoverageFrom, to: window.calendarCoverageTo });
  const mappedCalendar = mapTechnicalCalendarV1(calendarFetch.rows, window.calendarCoverageFrom, window.calendarCoverageTo);
  const eligibleThrough = resolveTechnicalEligibleThroughV1(window, mappedCalendar.calendar);
  const evidence = [];
  for (const ticker of ['1321', '2633'] as const) {
    const masterFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster,
      { code: `${ticker}0`, date: eligibleThrough });
    const master = validateCurrentEtfMasterV1(masterFetch.rows,
      { ticker, eligibleThrough, environment: client.processEnvironment });
    if (master.state !== 'accepted') throw new TechnicalSourceSmokeErrorV1('instrument_identity_unverified');
    const barsFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars,
      { code: `${ticker}0`, from: window.queryFrom, to: eligibleThrough });
    const bars = mapTechnicalDailyBarsV1(barsFetch.rows,
      { ticker, queryFrom: window.queryFrom, eligibleThrough, calendar: mappedCalendar.calendar });
    evidence.push({ ticker, currentMaster: master.observation, historyBoundary: bars.historyBoundary,
      historyCoverageClipped: bars.historyCoverageClipped,
      masterDigest: digestTechnicalSourceRowsV1([master.observation], client.processEnvironment),
      barsDigest: digestTechnicalSourceRowsV1(bars.rows as CanonicalJsonValue, client.processEnvironment),
      barCount: bars.rows.length });
  }
  const result = { schemaVersion: 'etf_source_gate_evidence_v1', state: 'passed',
    acceptedAt: client.acceptedAt, checkedAt: client.now(), window, eligibleThrough,
    // This diagnostic deliberately uses the narrower existing Technical client caps.
    limits: { ...TECHNICAL_SOURCE_SMOKE_LIMITS_V1, logicalQueries: 5 },
    totals: { attempts: client.attempts, pages: client.pages, rows: client.rows, responseBytes: client.responseBytes },
    calendarDigest: digestTechnicalSourceRowsV1(mappedCalendar.rows, client.processEnvironment), evidence };
  digestTechnicalSourceRowsV1(result as CanonicalJsonValue, client.processEnvironment);
  return result;
}

if (import.meta.main) {
  void (async () => {
    if (process.argv.slice(2).join('\0') !== '--confirm-external-fetch') {
      throw new TechnicalSourceSmokeErrorV1('cancelled');
    }
    const result = await proveEtfSourceGateV1(new TechnicalSourceSmokeClientV1());
    console.log(canonicalJsonV1(result as CanonicalJsonValue));
  })().catch(error => {
    console.error(JSON.stringify({ state: 'unavailable', code:
      error instanceof TechnicalSourceSmokeErrorV1 || error instanceof TechnicalSourceGateErrorV1
        ? error.code : 'source_response_invalid' }));
    process.exitCode = 1;
  });
}
