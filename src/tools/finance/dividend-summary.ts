import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import {
  JQuantsApiError,
  jquantsGetAll,
  resolveJQuantsCode,
} from './jquants-client.js';

const ENDPOINT = '/fins/summary';
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const OFFICIAL_HOLIDAY_DIVISIONS = new Set(['0', '1', '2', '3']);
const BUSINESS_HOLIDAY_DIVISIONS = new Set(['1', '2']);

export interface DividendAvailabilityCalendarDay {
  date: string;
  holidayDivision: string;
}

export interface DividendSummarySourceRow {
  issuerCode: string;
  disclosedDate: string;
  disclosedTime: string | null;
  disclosureNumber: string;
  currentFiscalYearEndDate: string;
  nextFiscalYearEndDate: string | null;
  actualAnnualDividendPerShare: number | null;
  actualPayoutRatio: number | null;
  forecastAnnualDividendPerShare: number | null;
  forecastPayoutRatio: number | null;
  nextForecastAnnualDividendPerShare: number | null;
  nextForecastPayoutRatio: number | null;
}

export const DIVIDEND_SUMMARY_DESCRIPTION = `
Fetches actual and company-forecast annual dividend-per-share values and source-provided payout ratios from J-Quants financial summaries.

**Requires:** JQUANTS_API_KEY. Free-plan history excludes the latest twelve weeks; paid-plan history follows the configured subscription range.

Dividend amounts remain source-provided JPY per share and payout ratios remain ratios (for example, 0.321 means 32.1%). The tool does not calculate dividend yield, payout ratio, growth, or as-of eligibility. Blank source values and an empty response are unavailable, not zero.
`.trim();

const DividendSummaryInputSchema = z.object({
  ticker: z.string().describe('Japanese securities code, company name, or EDINET code.'),
});

function invalidResponse(detail: string): never {
  throw new JQuantsApiError(
    `J-Quants endpoint ${ENDPOINT} returned invalid dividend-summary data: ${detail}`,
    'invalid_response',
  );
}

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function sourceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResponse('expected each row to be an object.');
  }
  return value as Record<string, unknown>;
}

function sourceString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    return invalidResponse(`${field} must be a non-empty string.`);
  }
  return value;
}

function sourceDate(row: Record<string, unknown>, field: string): string {
  const value = sourceString(row, field);
  if (!isCanonicalDate(value)) {
    return invalidResponse(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function nullableSourceDate(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === '' || value === '-') return null;
  if (typeof value !== 'string' || !isCanonicalDate(value)) {
    return invalidResponse(`${field} must be a valid YYYY-MM-DD date or blank.`);
  }
  return value;
}

function nullableSourceTime(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === '' || value === '-') return null;
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    return invalidResponse(`${field} must be a valid HH:MM or HH:MM:SS time or blank.`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

function nullableSourceNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (value === null || value === '' || value === '-') return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return invalidResponse(`${field} must be finite or blank.`);
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === '' || normalized === '-') return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return invalidResponse(`${field} must be numeric or blank.`);
}

function mapDividendSummaryRow(
  value: unknown,
  requestedIssuerCode: string,
): DividendSummarySourceRow {
  const row = sourceRecord(value);
  const issuerCode = sourceString(row, 'Code');
  if (issuerCode !== requestedIssuerCode) {
    return invalidResponse('Code does not match the requested issuer.');
  }

  return {
    issuerCode,
    disclosedDate: sourceDate(row, 'DiscDate'),
    disclosedTime: nullableSourceTime(row, 'DiscTime'),
    disclosureNumber: sourceString(row, 'DiscNo'),
    currentFiscalYearEndDate: sourceDate(row, 'CurFYEn'),
    nextFiscalYearEndDate: nullableSourceDate(row, 'NxtFYEn'),
    actualAnnualDividendPerShare: nullableSourceNumber(row, 'DivAnn'),
    actualPayoutRatio: nullableSourceNumber(row, 'PayoutRatioAnn'),
    forecastAnnualDividendPerShare: nullableSourceNumber(row, 'FDivAnn'),
    forecastPayoutRatio: nullableSourceNumber(row, 'FPayoutRatioAnn'),
    nextForecastAnnualDividendPerShare: nullableSourceNumber(row, 'NxFDivAnn'),
    nextForecastPayoutRatio: nullableSourceNumber(row, 'NxFPayoutRatioAnn'),
  };
}

/** Resolve the plan-independent modelled availability date from official calendar rows. */
export function resolveDividendSourceEligibleDate(
  sourceDate: string,
  officialCalendar: readonly DividendAvailabilityCalendarDay[],
): string | null {
  if (!isCanonicalDate(sourceDate)) {
    throw new RangeError('Dividend source date must be a valid YYYY-MM-DD date.');
  }

  let selected: string | null = null;
  for (const day of officialCalendar) {
    if (!isCanonicalDate(day.date)) {
      throw new RangeError('Dividend availability calendar dates must be valid YYYY-MM-DD dates.');
    }
    if (!OFFICIAL_HOLIDAY_DIVISIONS.has(day.holidayDivision)) {
      throw new RangeError('Dividend availability calendar contains an invalid holiday division.');
    }
    if (
      day.date > sourceDate
      && BUSINESS_HOLIDAY_DIVISIONS.has(day.holidayDivision)
      && (selected === null || day.date < selected)
    ) {
      selected = day.date;
    }
  }
  return selected;
}

export const getDividendSummary = new DynamicStructuredTool({
  name: 'get_dividend_summary',
  description: DIVIDEND_SUMMARY_DESCRIPTION,
  schema: DividendSummaryInputSchema,
  func: async ({ ticker }) => {
    const issuerCode = await resolveJQuantsCode(ticker);
    const rows = await jquantsGetAll<Record<string, unknown>>(ENDPOINT, {
      code: issuerCode,
    });

    if (rows.length === 0) {
      return formatToolResult({
        error: `No eligible dividend financial-summary data returned for ${ticker}`,
        reason: 'no_eligible_dividend_disclosure_data',
      }, []);
    }

    return formatToolResult(
      rows.map((row) => mapDividendSummaryRow(row, issuerCode)),
      [],
    );
  },
});
