import { expect, test } from 'bun:test';
import { financialSourceFixture } from './financial-test-fixtures.js';
import { mapWorkspaceFinancialSummaries } from './financial-input.js';
import { selectFinancial, WorkspaceFinancialCodec, financialTarget, type FinancialInput } from './financial-artifact.js';

function input(rows: Record<string, unknown>[] = [financialSourceFixture()]): FinancialInput {
  const calendar: FinancialInput['calendar'] = [];
  for (let time = Date.parse('2026-05-01'); time <= Date.parse('2026-09-15'); time += 86_400_000) {
    const day = new Date(time); calendar.push({ Date: day.toISOString().slice(0, 10), HolDiv: [0, 6].includes(day.getUTCDay()) ? '0' : '1' });
  }
  const fetchedAt = '2026-09-11T08:01:00.000Z';
  return { version: 'workspace_financial_input_v1', identity: { instrumentId: '00000000-0000-4000-8000-000000000001',
    provider: 'jquants', code: '72030', mappingRevision: 1, catalogGeneration: 1 },
    masterEvidence: { codec: 'workspace_episode_v1', path: 'episode.json', digest: `sha256:${'a'.repeat(64)}` },
    episodeFrom: '2022-01-03', through: '2026-09-11', calendarFrom: '2026-05-01', calendarThrough: '2026-09-15', calendar,
    rows: mapWorkspaceFinancialSummaries(rows, '72030'), correctionVintage: 'current_at_fetch_not_point_in_time', forecastPriceShareBasis: 'not_verified',
    sources: { master: { fetchedAt, pageCount: 1, rowCount: 1 }, summary: { fetchedAt, pageCount: 1, rowCount: rows.length },
      calendar: { fetchedAt, pageCount: 1, rowCount: calendar.length } } };
}

test('latest FY source null replaces older payout; quarter and revision payout never substitute', () => {
  const base = financialSourceFixture(), correction = financialSourceFixture({ DiscDate: '2026-05-11', DiscNo: '20260511000001', PayoutRatioAnn: '' });
  const quarter = financialSourceFixture({ DiscDate: '2026-08-01', DiscNo: '20260801000001', DocType: '1QFinancialStatements_Consolidated_IFRS',
    CurPerType: '1Q', CurFYSt: '2026-04-01', CurFYEn: '2027-03-31', CurPerSt: '2026-04-01', CurPerEn: '2026-06-30',
    NxtFYEn: '', NxFDivAnn: '', NxFPayoutRatioAnn: '', FDivAnn: '5', PayoutRatioAnn: '.99' });
  const revision = { ...quarter, DocType: 'DividendForecastRevision', DiscDate: '2026-08-03', DiscNo: '20260803000001', FDivAnn: '' };
  const result = selectFinancial(input([base, correction, quarter, revision]));
  expect(result.annual?.dividend.disclosureNumber).toBe('20260511000001');
  expect(result.actualPayoutReason).toBe('missing_data'); expect(result.annual?.dividend.actualPayoutRatio).toBeNull();
  expect(result.forecastReason).toBe('missing_data'); expect(result.forecast?.annualDividendPerShare).toBeNull();
  expect(result.forecast?.disclosureNumber).toBe('20260803000001');
});

test('next official session excludes same-day updates and uses holidays without weekday assumptions', () => {
  const older = financialSourceFixture(), latest = financialSourceFixture({ DiscDate: '2026-09-09', DiscNo: '20260909000001', NxFDivAnn: '7' });
  const value = input([older, latest]); value.calendar.find(day => day.Date === '2026-09-10')!.HolDiv = '0';
  expect(selectFinancial({ ...value, through: '2026-09-10' }).forecast?.annualDividendPerShare).toBe(4);
  expect(selectFinancial(value).forecast?.annualDividendPerShare).toBe(7);
  expect(selectFinancial({ ...value, through: '2026-09-09' }).forecast?.annualDividendPerShare).toBe(4);
});

test('a later missing next-fiscal-year identity never revives an older forecast', () => {
  const result = selectFinancial(input([financialSourceFixture(), financialSourceFixture({ DiscDate: '2026-05-11',
    DiscNo: '20260511000001', NxtFYEn: '', NxFDivAnn: '', NxFPayoutRatioAnn: '' })]));
  expect(result.forecast).toBeNull(); expect(result.forecastReason).toBe('missing_data');
});

test('fiscal period ownership cannot be inferred from a later disclosure date or matching code', () => {
  const value = input(); value.episodeFrom = '2026-04-01';
  expect(selectFinancial(value)).toMatchObject({ annual: null, forecast: null, annualReason: 'historical_identity_unverified',
    forecastReason: 'historical_identity_unverified', actualPayoutReason: 'historical_identity_unverified' });
});

test('expired forecast, absent rows and missing calendar have distinct unavailable states', () => {
  expect(selectFinancial(input([])).annualReason).toBe('no_eligible_disclosure');
  expect(selectFinancial(input([financialSourceFixture({ DiscDate: '2026-04-30' })])).annualReason).toBe('availability_calendar_unavailable');
  const value = input(); value.rows[0]!.dividend.nextFiscalYearEndDate = '2026-08-31';
  expect(selectFinancial(value).forecast).toBeNull();
});

test('immutable codec reproduces input and selection, rejects altered amounts, ownership and invented basis', () => {
  const value = input(), codec = new WorkspaceFinancialCodec(financialTarget(value)), time = '2026-09-11T08:00:00.000Z';
  const artifact = codec.build(value, time);
  expect(codec.parse(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
  expect(artifact).not.toHaveProperty('yield');
  expect(() => codec.parse({ ...artifact, result: { ...artifact.result, actualPayoutReason: 'missing_data' } })).toThrow('reference_conflict');
  expect(() => codec.build({ ...value, forecastPriceShareBasis: 'verified' }, time)).toThrow('invalid_input');
  expect(() => codec.build({ ...value, identity: { ...value.identity, instrumentId: '00000000-0000-4000-8000-000000000002' } }, time)).toThrow('reference_conflict');
  const copy = structuredClone(value); copy.rows[0]!.dividend.nextForecastAnnualDividendPerShare = 0;
  expect(codec.build(copy, time).sourcePayloadDigest).not.toBe(artifact.sourcePayloadDigest);
  expect(codec.build(copy, time).result.forecast?.annualDividendPerShare).toBe(0);
});
