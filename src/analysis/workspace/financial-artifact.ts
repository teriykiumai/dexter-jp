import { z } from 'zod';
import { analyzeDividendFiscalObservations } from '../../tools/finance/advanced-dividend-engine.js';
import { resolveDividendSourceEligibleDate } from '../../tools/finance/dividend-summary.js';
import { mapTechnicalCalendarV1 } from '../market-data/technical-source-gate.js';
import { MarketDataArtifactCommonFieldsV1 } from '../market-data/artifact-codec.js';
import { marketDataTargetKeyV1, type MarketDataArtifactIdentityV1, type MarketDataTargetV1 } from '../market-data/contracts.js';
import { FinancialSummaryRowSchema, compareFinancialDisclosures, isFullYearFinancialStatement } from './financial-input.js';
import { DateValue, FrozenIdentitySchema, ObjectRefSchema, digest, json, parse, fail, safe } from './contracts.js';

const fetch = z.object({ fetchedAt: z.iso.datetime(), pageCount: z.number().int().positive().max(20),
  rowCount: z.number().int().nonnegative().max(8000) }).strict();
export const FinancialInputSchema = z.object({ version: z.literal('workspace_financial_input_v1'),
  identity: FrozenIdentitySchema, masterEvidence: ObjectRefSchema, episodeFrom: DateValue, through: DateValue,
  calendarFrom: DateValue, calendarThrough: DateValue,
  calendar: z.array(z.object({ Date: DateValue, HolDiv: z.string() }).strict()).min(1).max(8000),
  rows: z.array(FinancialSummaryRowSchema).max(8000),
  sources: z.object({ summary: fetch, calendar: fetch, master: fetch }).strict(),
  correctionVintage: z.literal('current_at_fetch_not_point_in_time'),
  forecastPriceShareBasis: z.literal('not_verified'),
}).strict();
export type FinancialInput = z.infer<typeof FinancialInputSchema>;
export type FinancialUnavailable = 'missing_data' | 'historical_identity_unverified' | 'no_eligible_disclosure'
  | 'availability_calendar_unavailable' | 'price_basis_unverified' | 'price_unavailable';

export function selectFinancial(input: FinancialInput) {
  const calendar = mapTechnicalCalendarV1(input.calendar, input.calendarFrom, input.calendarThrough);
  const days = calendar.rows.map(row => ({ date: row.Date, holidayDivision: row.HolDiv }));
  const owned = (row: FinancialInput['rows'][number]) => row.CurFYSt >= input.episodeFrom
    && row.dividend.disclosedDate >= input.episodeFrom;
  const availability = new Map<string, string | null>();
  const eligible = input.rows.filter(row => {
    const date = row.dividend.disclosedDate;
    if (date < input.calendarFrom || date >= input.through) return false;
    if (!availability.has(date)) availability.set(date, resolveDividendSourceEligibleDate(date, days));
    return (availability.get(date) ?? '9999-12-31') <= input.through;
  });
  const emptyReason: FinancialUnavailable = input.rows.some(row => row.dividend.disclosedDate < input.calendarFrom)
    ? 'availability_calendar_unavailable' : 'no_eligible_disclosure';
  const annual = eligible.filter(row => isFullYearFinancialStatement(row) && row.CurFYEn <= input.through)
    .sort((a, b) => a.CurFYEn.localeCompare(b.CurFYEn) || compareFinancialDisclosures(a, b)).at(-1) ?? null;
  const annualReason: FinancialUnavailable | null = !annual ? emptyReason : !owned(annual) ? 'historical_identity_unverified' : null;
  // Each date below is the exact next session resolved from the validated complete
  // calendar. Repeated corrections need not revalidate ten years for every row.
  const nextSessions = new Set(availability.values());
  const fiscal = analyzeDividendFiscalObservations(input.identity.code, eligible.map(row => row.dividend),
    days.filter(day => nextSessions.has(day.date)), input.through);
  if (fiscal.unavailable.some(item => item.reason === 'invalid_data')) fail('invalid_input');
  const lastDisclosure = eligible.at(-1);
  const unidentifiedNextYear = lastDisclosure && lastDisclosure.CurFYEn < input.through && lastDisclosure.dividend.nextFiscalYearEndDate === null;
  const forecast = unidentifiedNextYear ? null : fiscal.observations.filter(row => row.kind === 'company_forecast' && row.fiscalYearEndDate >= input.through)
    .sort((a, b) => a.fiscalYearEndDate.localeCompare(b.fiscalYearEndDate))[0] ?? null;
  const forecastRow = forecast ? eligible.find(row => row.dividend.disclosureNumber === forecast.disclosureNumber)! : null;
  const forecastReason: FinancialUnavailable | null = unidentifiedNextYear ? owned(lastDisclosure) ? 'missing_data' : 'historical_identity_unverified'
    : !forecast ? emptyReason : !forecastRow || !owned(forecastRow)
    ? 'historical_identity_unverified' : forecast.annualDividendPerShare === null ? 'missing_data' : null;
  return { annual: annualReason ? null : annual, annualReason,
    forecast: forecastReason === 'historical_identity_unverified' ? null : forecast, forecastReason,
    actualPayoutReason: annualReason ?? (annual?.dividend.actualPayoutRatio === null ? 'missing_data' as const : null),
    warnings: !annualReason && annual?.dividend.actualPayoutRatio !== null && annual?.dividend.actualPayoutRatio !== undefined
      && (annual.dividend.actualPayoutRatio < 0 || annual.dividend.actualPayoutRatio > 1) ? ['unusual_source_payout_ratio'] : [],
    excludedIdentityRows: eligible.filter(row => !owned(row)).length };
}

export const financialTarget = (input: FinancialInput): MarketDataTargetV1 => ({ kind: 'workspace', key: `financial_${input.identity.instrumentId}` });
function semantic(input: FinancialInput) {
  const { sources: _sources, ...value } = input; return value;
}
export class WorkspaceFinancialCodec {
  constructor(readonly target: MarketDataTargetV1) { if (target.kind !== 'workspace') fail('invalid_input'); }
  build(raw: unknown, acceptedAt: string) {
    const input = parse(FinancialInputSchema, raw), date = new Date(Date.parse(acceptedAt) + 9 * 3600_000).toISOString().slice(0, 10);
    if (json(this.target) !== json(financialTarget(input)) || input.identity.provider !== 'jquants'
      || input.episodeFrom > input.through || input.through > date || input.calendarFrom > input.through
      || input.calendarThrough < input.through || input.sources.summary.rowCount !== input.rows.length
      || input.sources.calendar.rowCount !== input.calendar.length || input.sources.master.rowCount !== 1
      || Object.values(input.sources).some(source => source.fetchedAt < acceptedAt)
      || new Set(input.rows.map(row => row.dividend.disclosureNumber)).size !== input.rows.length
      || input.rows.some((row, index) => row.dividend.issuerCode !== input.identity.code
        || row.dividend.disclosedDate > new Date(Date.parse(input.sources.summary.fetchedAt) + 9 * 3600_000).toISOString().slice(0, 10)
        || index > 0 && compareFinancialDisclosures(input.rows[index - 1]!, row) >= 0)) fail('reference_conflict');
    const result = selectFinancial(input), sourcePayloadDigest = digest(json(semantic(input)));
    const payload = { schemaVersion: 'workspace_financial_artifact_v1' as const, calculationVersion: 'workspace_financial_selection_v1' as const,
      asOfCutoff: acceptedAt, calculationDate: date, dataDate: input.through,
      fetchedAt: Object.values(input.sources).map(source => source.fetchedAt).sort().at(-1)!, sourcePayloadDigest,
      sourceInputs: (['summary', 'calendar', 'master'] as const).map(role => ({ kind: 'provider' as const, role,
        sourceId: 'workspace_financial_v1', sourceContractVersion: 'workspace_financial_source_v1',
        sourceRevisionIds: ['official_specs_2026_09_13'], unitAndCoverageBasis: 'source JPY, JPY per share, fractions; current fetch is not point-in-time history',
        sourceMappingVersion: 'workspace_financial_mapping_v1', endpoint: role === 'summary' ? '/v2/fins/summary'
          : role === 'calendar' ? '/v2/markets/calendar' : '/v2/equities/master',
        normalizedQueryIdentity: json(role === 'summary' ? { code: input.identity.code } : role === 'master'
          ? { code: input.identity.code, date: input.through } : { from: input.calendarFrom, to: input.calendarThrough }),
        dataDateOrEffectiveRange: role === 'calendar' ? { from: input.calendarFrom, through: input.calendarThrough } : input.through,
        publishedDate: null, publishedAt: null, cadence: 'daily', asOfCutoff: acceptedAt, entitlementClass: 'standard' as const,
        entitlementVerifiedAt: input.sources[role].fetchedAt, fetchedAt: input.sources[role].fetchedAt,
        pagination: { complete: true as const, pageCount: input.sources[role].pageCount, rowCount: input.sources[role].rowCount },
        inputDigest: digest(json(role === 'summary' ? input.rows : role === 'calendar' ? input.calendar : input.masterEvidence)) })), input, result };
    const value = { ...payload, artifactDigest: digest(json(payload)) }; safe(value); return value;
  }
  parse(raw: unknown) {
    const candidate = parse(z.object({ ...MarketDataArtifactCommonFieldsV1,
      schemaVersion: z.literal('workspace_financial_artifact_v1'), input: FinancialInputSchema, result: z.unknown() }).strict(), raw);
    const value = this.build(candidate.input, candidate.asOfCutoff);
    if (json(value) !== json(raw)) fail('reference_conflict'); return value;
  }
  identity(value: ReturnType<WorkspaceFinancialCodec['build']>): MarketDataArtifactIdentityV1 {
    const key = marketDataTargetKeyV1(this.target);
    return { scope: 'workspace', tickerOrSourceId: key, dataDate: value.dataDate, sourcePayloadDigest: value.sourcePayloadDigest,
      artifactDigest: value.artifactDigest, rootRelativeIdentity: `workspace/${key}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }
  equivalent(a: ReturnType<WorkspaceFinancialCodec['build']>, b: ReturnType<WorkspaceFinancialCodec['build']>) {
    return a.sourcePayloadDigest === b.sourcePayloadDigest && json(semantic(a.input)) === json(semantic(b.input)) && json(a.result) === json(b.result);
  }
}
