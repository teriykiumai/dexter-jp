import type { CanonicalJsonValue } from '../snapshot/canonical-json.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { digestMarketSourceInputV1, type SourceInputV1 } from './contracts.js';
import { createEtfArtifactCodecV1, etfInputIdentityV1, etfRegistryRowsV1, type EtfModuleIdV1 } from './etf-artifact.js';
import { calculateEtf1321EodV1, calculateEtfRelativeV1 } from './etf-series.js';
import { createMarketDataReaderV1, TechnicalSourceFailureV1 } from './technical-source.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, mapEtfDailyBarsV1,
  resolveTechnicalEligibleThroughV1, validateCurrentEtfMasterV1, TECHNICAL_SOURCE_ENDPOINTS_V1,
  TechnicalSourceGateErrorV1 } from './technical-source-gate.js';
import { currentCodeWarningsV1, MarketDataSourceFailureV1, type MarketDataWarningV1 } from './job-schema.js';
import type { OverviewCollectionContextV1 } from './overview-registry.js';

export const ETF_JOB_LIMITS_V1 = Object.freeze({ estimatedMinimumAttempts: 5, maximumAttempts: 40,
  maximumPages: 40, maximumRows: 16000, maximumResponseBytes: 64 * 1024 * 1024, executionBudgetMs: 600000 });

export async function collectEtfModuleV1(moduleId: EtfModuleIdV1, context: OverviewCollectionContextV1,
  environment: JQuantsExecutionEnvironmentV1, secrets: NodeJS.ProcessEnv = process.env) {
  const window = createTechnicalSourceRequestWindowV1(context.acceptedAt);
  const started = environment.monotonicNowMs();
  const reader = createMarketDataReaderV1({ ...context, waitBeforeRetry: async delay => {
    if (environment.monotonicNowMs() - started + delay >= ETF_JOB_LIMITS_V1.executionBudgetMs) {
      throw new MarketDataSourceFailureV1('source_timeout');
    }
    await environment.sleep(delay, context.signal);
  } }, environment, { pages: 40, rows: 16000, responseBytes: 64 * 1024 * 1024 });
  async function fetchShared(role: string, endpoint: string, query: Record<string, string>) {
    return context.shareSource(`etf_v1:${role}`, async () => {
      await reader.fetchRows(role, endpoint, query);
      return reader.fetched.get(role)!;
    });
  }
  const sourceInputs: SourceInputV1[] = [];
  try {
    const calendarSource = await fetchShared('trading_calendar', TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
      { from: window.calendarCoverageFrom, to: window.calendarCoverageTo });
    const calendar = mapTechnicalCalendarV1(calendarSource.rows, window.calendarCoverageFrom, window.calendarCoverageTo);
    const eligibleThrough = resolveTechnicalEligibleThroughV1(window, calendar.calendar);
    const providerInput = (role: string, source: typeof calendarSource, rows: CanonicalJsonValue) => {
      const identity = etfInputIdentityV1(role, context.acceptedAt, eligibleThrough);
      if (identity.kind !== 'provider') throw new MarketDataSourceFailureV1('source_invalid_response');
      sourceInputs.push({ ...identity, asOfCutoff: context.acceptedAt, fetchedAt: source.fetchedAt,
        entitlementClass: 'standard', entitlementVerifiedAt: source.fetchedAt,
        pagination: { complete: true, pageCount: source.pageCount, rowCount: source.rows.length },
        inputDigest: digestMarketSourceInputV1(identity, rows, value => value as CanonicalJsonValue, secrets) });
    };
    providerInput('trading_calendar', calendarSource, calendar.rows);
    const mapped: ReturnType<typeof mapEtfDailyBarsV1>[] = [];
    for (const ticker of (moduleId === 'etf_1321_eod' ? ['1321'] : ['1321', '2633']) as ('1321' | '2633')[]) {
      const masterSource = await fetchShared(`security_master_${ticker}`, TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster,
        { code: `${ticker}0`, date: eligibleThrough });
      const master = validateCurrentEtfMasterV1(masterSource.rows, { ticker, eligibleThrough, environment: secrets });
      if (master.state !== 'accepted') throw new MarketDataSourceFailureV1('instrument_identity_unverified');
      providerInput(`security_master_${ticker}`, masterSource, [master.observation]);
      const identity = etfInputIdentityV1(`corporate_action_registry_${ticker}`, context.acceptedAt, eligibleThrough);
      const events = etfRegistryRowsV1(ticker, context.acceptedAt, eligibleThrough);
      sourceInputs.push({ ...identity, asOfCutoff: context.acceptedAt,
        inputDigest: digestMarketSourceInputV1(identity, events, value => value as CanonicalJsonValue, secrets) } as SourceInputV1);
      const barsSource = await fetchShared(`daily_bars_${ticker}`, TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars,
        { code: `${ticker}0`, from: window.queryFrom, to: eligibleThrough });
      const bars = mapEtfDailyBarsV1(barsSource.rows, { ticker, queryFrom: window.queryFrom, eligibleThrough, calendar: calendar.calendar });
      providerInput(`daily_bars_${ticker}`, barsSource, bars.rows as CanonicalJsonValue);
      mapped.push(bars);
    }
    sourceInputs.sort((a, b) => a.role.localeCompare(b.role));
    const boundaryWarning = (data: typeof mapped[number]) => data.historyBoundary.state === 'available'
      ? { state: 'available' as const, sourceCoverageFrom: data.historyBoundary.sourceCoverageFrom, historyCoverageClipped: data.historyCoverageClipped }
      : { state: 'unavailable' as const, historyCoverageClipped: false as const };
    const warnings: MarketDataWarningV1[] = mapped.some(data => data.observations.some(row => row.kind === 'gap'))
      ? [{ code: 'source_gap', message: '取得済み価格に明示的な欠損があります。', moduleId, artifactIdentity: null }] : [];
    warnings.push(...currentCodeWarningsV1(moduleId === 'etf_1321_eod'
      ? { kind: moduleId, boundary: boundaryWarning(mapped[0]!) }
      : { kind: moduleId, boundary1321: boundaryWarning(mapped[0]!), boundary2633: boundaryWarning(mapped[1]!) }));
    const eod = calculateEtf1321EodV1(mapped[0]!.observations, eligibleThrough);
    const ranges = moduleId === 'etf_1321_2633_relative' ? calculateEtfRelativeV1(mapped[0]!.observations, mapped[1]!.observations) : [];
    const availableRanges = ranges.filter(range => range.state === 'available');
    const state = moduleId === 'etf_1321_eod' ? eod.observationState.state : availableRanges.length ? 'available' : 'unavailable';
    const reason = state === 'available' ? null : moduleId === 'etf_1321_eod' ? 'source_no_observation'
      : ranges.some(r => r.state === 'unavailable' && r.reason === 'source_no_observation') ? 'source_no_observation'
        : ranges.some(r => r.state === 'unavailable' && r.reason === 'invalid_base') ? 'invalid_base' : 'insufficient_common_dates';
    const artifact = createEtfArtifactCodecV1(moduleId, secrets).build({
      schemaVersion: 'market_overview_module_v1', calculationVersion: `${moduleId}_calculation_v1`, moduleId,
      sourceId: `${moduleId}_v1`, state, reason, asOfCutoff: context.acceptedAt, calculationDate: window.calculationDate,
      dataDate: state === 'unavailable' ? eligibleThrough : moduleId === 'etf_1321_eod' ? eod.dataDate : availableRanges[0]!.rangeEnd,
      fetchedAt: sourceInputs.filter(i => i.kind === 'provider').map(i => i.fetchedAt).sort().at(-1),
      cadence: 'daily', displayUnit: moduleId === 'etf_1321_eod' ? 'JPY' : 'base_100',
      historyBoundaries: mapped.map(data => data.historyBoundary), sourceInputs,
      observations: moduleId === 'etf_1321_eod' ? [eod] : ranges, warnings,
    });
    return { artifact, ...reader.metrics() };
  } catch (error) {
    if (error instanceof TechnicalSourceFailureV1) throw new MarketDataSourceFailureV1(error.code === 'source_no_observation'
      ? 'source_invalid_response' : error.code);
    if (error instanceof TechnicalSourceGateErrorV1) throw new MarketDataSourceFailureV1(
      error.code === 'source_not_yet_updated' ? error.code : 'source_invalid_response');
    throw error;
  }
}
