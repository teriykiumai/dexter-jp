import { z } from 'zod';
import { mapDividendSummaryRow } from '../../tools/finance/dividend-summary.js';
import { DateValue, parse, fail } from './contracts.js';

const number = z.number().finite().nullable();
const amount = z.number().finite().nonnegative().nullable();
const sourceNumber = z.preprocess(value => {
  if (value === null || typeof value === 'string' && ['', '-'].includes(value.trim())) return null;
  return typeof value === 'string' ? Number(value) : value;
}, number);
const sourceDate = z.preprocess(value => value === '' || value === '-' ? null : value, DateValue.nullable());
const fields = z.object({ DocType: z.string().min(1).max(128), CurPerType: z.enum(['1Q', '2Q', '3Q', '4Q', '5Q', 'FY', '']),
  CurPerSt: sourceDate, CurPerEn: sourceDate, CurFYSt: DateValue, CurFYEn: DateValue,
  Sales: sourceNumber, OP: sourceNumber, OdP: sourceNumber, NP: sourceNumber, EPS: sourceNumber, BPS: sourceNumber,
  TA: sourceNumber, Eq: sourceNumber, EqAR: sourceNumber, CFO: sourceNumber, CFI: sourceNumber, CFF: sourceNumber,
  ShOutFY: sourceNumber, TrShFY: sourceNumber });
const dividend = z.object({ issuerCode: z.string().regex(/^[0-9A-Z]{4}0$/), disclosedDate: DateValue,
  disclosedTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).nullable(),
  disclosureNumber: z.string().regex(/^\d{1,80}$/), currentFiscalYearEndDate: DateValue, nextFiscalYearEndDate: DateValue.nullable(),
  actualAnnualDividendPerShare: amount, actualPayoutRatio: number, forecastAnnualDividendPerShare: amount,
  forecastPayoutRatio: number, nextForecastAnnualDividendPerShare: amount, nextForecastPayoutRatio: number }).strict();
const statement = /^(FY|[123]Q|OtherPeriod)FinancialStatements_(Consolidated|NonConsolidated)_(JP|US|IFRS|JMIS)$/;
const revisions = new Set(['EarnForecastRevision', 'DividendForecastRevision']);

/** Normalized provider observations only. This schema grants neither instrument ownership nor price-basis eligibility. */
export const FinancialSummaryRowSchema = z.object({
  DocType: fields.shape.DocType, CurPerType: fields.shape.CurPerType,
  CurPerSt: DateValue.nullable(), CurPerEn: DateValue.nullable(), CurFYSt: DateValue, CurFYEn: DateValue,
  Sales: number, OP: number, OdP: number, NP: number, EPS: number, BPS: number, TA: number, Eq: number, EqAR: number,
  CFO: number, CFI: number, CFF: number, ShOutFY: amount, TrShFY: amount, dividend,
}).strict().superRefine((row, context) => {
  const doc = statement.exec(row.DocType), d = row.dividend;
  const invalid = () => context.addIssue({ code: 'custom', message: 'invalid financial source observation' });
  if (!doc && !revisions.has(row.DocType)) invalid();
  if (row.CurFYSt > row.CurFYEn || row.CurFYEn !== d.currentFiscalYearEndDate
    || (row.CurPerSt === null) !== (row.CurPerEn === null)) invalid();
  if (row.CurPerSt !== null && row.CurPerEn !== null && (row.CurPerSt > row.CurPerEn
    || row.CurPerSt < row.CurFYSt || row.CurPerEn > row.CurFYEn || row.CurPerEn > d.disclosedDate)) invalid();
  if (doc) {
    if (row.CurPerSt === null || row.CurPerEn === null || row.CurPerType === '') invalid();
    if (doc[1] !== 'OtherPeriod' && doc[1] !== row.CurPerType) invalid();
    if (doc[1] === 'FY' && (row.CurPerSt !== row.CurFYSt || row.CurPerEn !== row.CurFYEn)) invalid();
  }
  if (d.nextFiscalYearEndDate !== null && d.nextFiscalYearEndDate <= row.CurFYEn
    || d.nextFiscalYearEndDate === null && (d.nextForecastAnnualDividendPerShare !== null || d.nextForecastPayoutRatio !== null)) invalid();
  if (row.ShOutFY !== null && row.TrShFY !== null && row.TrShFY > row.ShOutFY) invalid();
});
export type FinancialSummaryRow = z.infer<typeof FinancialSummaryRowSchema>;

/** Explicitly project source fields; unknown provider keys are never retained or included in errors. */
export function mapWorkspaceFinancialSummaries(raw: readonly unknown[], code: string): FinancialSummaryRow[] {
  if (!/^[0-9A-Z]{4}0$/.test(code) || raw.length > 8000) fail('invalid_input');
  const seen = new Set<string>();
  return raw.map(value => {
    let mapped;
    try { mapped = mapDividendSummaryRow(value, code); }
    catch { return fail('invalid_input'); }
    const row = parse(FinancialSummaryRowSchema, { ...parse(fields, value), dividend: mapped });
    if (seen.has(row.dividend.disclosureNumber)) fail('invalid_input');
    seen.add(row.dividend.disclosureNumber);
    return row;
  }).sort((a, b) => compareFinancialDisclosures(a, b));
}

export function compareFinancialDisclosures(a: FinancialSummaryRow, b: FinancialSummaryRow): number {
  return a.dividend.disclosedDate.localeCompare(b.dividend.disclosedDate)
    || (a.dividend.disclosedTime ?? '').localeCompare(b.dividend.disclosedTime ?? '')
    || a.dividend.disclosureNumber.localeCompare(b.dividend.disclosureNumber);
}

export function isFullYearFinancialStatement(row: FinancialSummaryRow): boolean {
  return row.CurPerType === 'FY' && row.DocType.startsWith('FYFinancialStatements_');
}
