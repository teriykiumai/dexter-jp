import { expect, test } from 'bun:test';
import { FinancialSummaryRowSchema, isFullYearFinancialStatement, mapWorkspaceFinancialSummaries } from './financial-input.js';

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { Code: '72030', DiscDate: '2026-05-08', DiscTime: '15:00', DiscNo: '20260508000001',
    DocType: 'FYFinancialStatements_Consolidated_IFRS', CurPerType: 'FY', CurPerSt: '2025-04-01', CurPerEn: '2026-03-31',
    CurFYSt: '2025-04-01', CurFYEn: '2026-03-31', NxtFYEn: '2027-03-31',
    Sales: '1000', OP: '100', OdP: '', NP: '50', EPS: '10', BPS: '100', TA: '2000', Eq: '800', EqAR: '0.4',
    CFO: '100', CFI: '-50', CFF: '-20', ShOutFY: '100', TrShFY: '10',
    DivAnn: '3', PayoutRatioAnn: '0.3', FDivAnn: '', FPayoutRatioAnn: '', NxFDivAnn: '4', NxFPayoutRatioAnn: '0.4', ...overrides };
}
const map = (row: Record<string, unknown>) => mapWorkspaceFinancialSummaries([row], '72030')[0]!;

test('normalized financial input retains only source fields, source ratios and signed financial values', () => {
  const row = map(source({ NP: '-50', EPS: '-10', Eq: '-800', PayoutRatioAnn: '-0.2', FDivAnn: '0',
    secretProviderField: 'not retained', instrumentId: 'not evidence', priceBasisVerified: true }));
  expect(row).toMatchObject({ OdP: null, CFI: -50, CFF: -20, NP: -50, EPS: -10, Eq: -800,
    dividend: { disclosedTime: '15:00:00', actualPayoutRatio: -.2, forecastAnnualDividendPerShare: 0 } });
  expect(row).not.toHaveProperty('secretProviderField'); expect(row).not.toHaveProperty('instrumentId');
  expect(row).not.toHaveProperty('priceBasisVerified');
  expect(FinancialSummaryRowSchema.parse(row)).toEqual(row);
  expect(isFullYearFinancialStatement(row)).toBe(true);
});

test.each([null, '', '-', '  ', ' - '])('blank financial values stay null (%s)', blank => {
  const row = map(source({ PayoutRatioAnn: blank, EPS: blank, CFO: blank, NxFDivAnn: blank }));
  expect(row.EPS).toBeNull(); expect(row.CFO).toBeNull();
  expect(row.dividend.actualPayoutRatio).toBeNull(); expect(row.dividend.nextForecastAnnualDividendPerShare).toBeNull();
});

test.each([-0.2, 0, 1.4])('source payout %s is preserved without calculation or clamping', value => {
  expect(map(source({ PayoutRatioAnn: value })).dividend.actualPayoutRatio).toBe(value);
});

test.each([
  { DocType: '1QFinancialStatements_Consolidated_IFRS', CurPerType: '1Q', CurPerEn: '2025-06-30' },
  { DocType: 'OtherPeriodFinancialStatements_NonConsolidated_JP', CurPerType: '5Q' },
  { DocType: 'DividendForecastRevision', CurPerType: '', CurPerSt: '', CurPerEn: '' },
  { DocType: 'EarnForecastRevision', CurPerType: 'FY' },
])('only FY statements can supply full-year actuals ($DocType)', metadata => {
  expect(isFullYearFinancialStatement(map(source(metadata)))).toBe(false);
});

test.each([
  { DocType: 'UnknownDocument' },
  { DocType: 'FYFinancialStatements_Consolidated_IFRS', CurPerType: '1Q' },
  { DocType: '1QFinancialStatements_Consolidated_IFRS', CurPerType: 'FY' },
  { CurPerSt: '' }, { CurPerSt: '', CurPerEn: '' },
  { CurFYSt: '2026-04-01' }, { CurPerSt: '2025-03-31' }, { CurPerEn: '2026-04-01' },
  { CurPerEn: '2025-12-31' }, { CurPerSt: '2025-07-01' }, { DiscDate: '2026-03-30' },
  { CurPerEn: '2026-02-30' }, { NxtFYEn: '2026-03-31' },
  { NxtFYEn: null }, { DivAnn: -1 }, { NxFDivAnn: -1 }, { ShOutFY: -1 }, { TrShFY: 101 },
  { DiscNo: '' }, { DiscTime: '24:00' }, { Code: '67580' },
])('inconsistent financial metadata fails closed: %j', changes => {
  expect(() => map(source(changes))).toThrow('invalid_input');
});

test.each([Infinity, -Infinity, NaN, 'Infinity', 'not-a-number', false, undefined])('invalid numbers are not unavailable source blanks (%s)', invalid => {
  expect(() => map(source({ Sales: invalid }))).toThrow('invalid_input');
  expect(() => map(source({ PayoutRatioAnn: invalid }))).toThrow('invalid_input');
});

test('revision rows allow paired missing period dates but never fabricate a next fiscal year', () => {
  const row = map(source({ DocType: 'DividendForecastRevision', CurPerType: '', CurPerSt: null, CurPerEn: '-',
    NxtFYEn: '', NxFDivAnn: '', NxFPayoutRatioAnn: '' }));
  expect(row.CurPerSt).toBeNull(); expect(row.CurPerEn).toBeNull(); expect(row.dividend.nextFiscalYearEndDate).toBeNull();
  expect(() => map(source({ DocType: 'DividendForecastRevision', CurPerSt: null }))).toThrow('invalid_input');
});

test('deterministic disclosure ordering retains latest blanks and does not mutate the provider rows', () => {
  const old = source(), later = source({ DiscNo: '20260508000002', DiscTime: '15:01', NxFDivAnn: '' });
  const rows = [later, old], before = structuredClone(rows);
  const mapped = mapWorkspaceFinancialSummaries(rows, '72030');
  expect(rows).toEqual(before);
  expect(mapped.map(row => row.dividend.disclosureNumber)).toEqual(['20260508000001', '20260508000002']);
  expect(mapped.at(-1)!.dividend.nextForecastAnnualDividendPerShare).toBeNull();
  expect(mapWorkspaceFinancialSummaries([...rows].reverse(), '72030')).toEqual(mapped);
  expect(() => mapWorkspaceFinancialSummaries([old, { ...later, DiscNo: old.DiscNo }], '72030')).toThrow('invalid_input');
});

test('malformed rows and issuer selectors do not expose source text in errors', () => {
  for (const row of [null, [], source({ Code: 'source-secret' }), source({ Sales: 'source-secret' })]) {
    try { mapWorkspaceFinancialSummaries([row], '72030'); throw new Error('missing rejection'); }
    catch (error) { expect(String(error)).toContain('invalid_input'); expect(String(error)).not.toContain('source-secret'); }
  }
  expect(() => mapWorkspaceFinancialSummaries([], '7203')).toThrow('invalid_input');
  expect(() => mapWorkspaceFinancialSummaries([], '72031')).toThrow('invalid_input');
  expect(mapWorkspaceFinancialSummaries([], '72030')).toEqual([]);
});

test('persisted observations require normalized values and reject injected eligibility flags', () => {
  const row = map(source());
  expect(FinancialSummaryRowSchema.safeParse({ ...row, Sales: '1000' }).success).toBe(false);
  expect(FinancialSummaryRowSchema.safeParse({ ...row, identityVerified: true }).success).toBe(false);
  expect(FinancialSummaryRowSchema.safeParse({ ...row, dividend: { ...row.dividend, priceBasisVerified: true } }).success).toBe(false);
  expect(FinancialSummaryRowSchema.safeParse({ ...row, CurFYEn: '2027-03-31' }).success).toBe(false);
});
