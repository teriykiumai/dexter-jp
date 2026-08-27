import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import {
  JQuantsApiError,
  jquantsGetAll,
  resolveJQuantsCode,
} from './jquants-client.js';

const ENDPOINT = '/fins/dividend';
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type DividendEventStatusCode = '1' | '2' | '3';
export type DividendEventKindCode = '1' | '2';
export type DividendEventDecisionCode = '1' | '2';
export type DividendComponentCode = '0' | '1' | '2' | '3';

export interface DividendEventSourceRow {
  notifiedDate: string;
  notifiedTime: string | null;
  issuerCode: string;
  referenceNumber: string;
  statusCode: DividendEventStatusCode;
  kindCode: DividendEventKindCode;
  decisionCode: DividendEventDecisionCode;
  recordDateYearMonth: string;
  dividendPerShare: number | null;
  recordDate: string | null;
  exDate: string | null;
  rightsRecordDate: string | null;
  paymentDate: string | null;
  corporateActionReferenceNumber: string;
  componentCode: DividendComponentCode;
  commemorativeDividendPerShare: number | null;
  specialDividendPerShare: number | null;
}

export const DIVIDEND_EVENTS_DESCRIPTION = `
Fetches report-level dividend notifications from the Premium-only J-Quants dividend endpoint for TSE-listed issues.

The source preserves notification and corporate-action reference identity, new/correction/deletion status, interim/fiscal-year-end and decided/forecast codes, source JPY-per-share amounts, record dates, and explicit commemorative/special components. Component amounts are available only from 2022-06-06. The tool does not replay updates, calculate ordinary dividends, aggregate annual amounts, split-adjust values, or calculate yield or growth. Blank fields and an empty response are unavailable, not zero.
`.trim();

const DividendEventsInputSchema = z.object({
  ticker: z.string().describe('Japanese securities code, company name, or EDINET code.'),
});

function invalidResponse(detail: string): never {
  throw new JQuantsApiError(
    `J-Quants endpoint ${ENDPOINT} returned invalid dividend-event data: ${detail}`,
    'invalid_response',
  );
}

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCanonicalYearMonth(value: string): boolean {
  if (!YEAR_MONTH_PATTERN.test(value)) return false;
  return isCanonicalDate(`${value}-01`);
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
    return invalidResponse(`${field} must be a valid HH:MM time or blank.`);
  }
  return value;
}

function sourceYearMonth(row: Record<string, unknown>, field: string): string {
  const value = sourceString(row, field);
  if (!isCanonicalYearMonth(value)) {
    return invalidResponse(`${field} must be a valid YYYY-MM value.`);
  }
  return value;
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

function sourceCode<const T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = sourceString(row, field);
  if (!allowed.includes(value as T)) {
    return invalidResponse(`${field} contains an unsupported code.`);
  }
  return value as T;
}

function mapDividendEventRow(
  value: unknown,
  requestedIssuerCode: string,
): DividendEventSourceRow {
  const row = sourceRecord(value);
  const issuerCode = sourceString(row, 'Code');
  if (issuerCode !== requestedIssuerCode) {
    return invalidResponse('Code does not match the requested issuer.');
  }

  return {
    notifiedDate: sourceDate(row, 'PubDate'),
    notifiedTime: nullableSourceTime(row, 'PubTime'),
    issuerCode,
    referenceNumber: sourceString(row, 'RefNo'),
    statusCode: sourceCode(row, 'StatCode', ['1', '2', '3']),
    kindCode: sourceCode(row, 'IFCode', ['1', '2']),
    decisionCode: sourceCode(row, 'FRCode', ['1', '2']),
    recordDateYearMonth: sourceYearMonth(row, 'IFTerm'),
    dividendPerShare: nullableSourceNumber(row, 'DivRate'),
    recordDate: nullableSourceDate(row, 'RecDate'),
    exDate: nullableSourceDate(row, 'ExDate'),
    rightsRecordDate: nullableSourceDate(row, 'ActRecDate'),
    paymentDate: nullableSourceDate(row, 'PayDate'),
    corporateActionReferenceNumber: sourceString(row, 'CARefNo'),
    componentCode: sourceCode(row, 'CommSpecCode', ['0', '1', '2', '3']),
    commemorativeDividendPerShare: nullableSourceNumber(row, 'CommDivRate'),
    specialDividendPerShare: nullableSourceNumber(row, 'SpecDivRate'),
  };
}

export const getDividendEvents = new DynamicStructuredTool({
  name: 'get_dividend_events',
  description: DIVIDEND_EVENTS_DESCRIPTION,
  schema: DividendEventsInputSchema,
  func: async ({ ticker }) => {
    const issuerCode = await resolveJQuantsCode(ticker);
    const rows = await jquantsGetAll<Record<string, unknown>>(ENDPOINT, {
      code: issuerCode,
    });

    if (rows.length === 0) {
      return formatToolResult({
        error: `No eligible dividend-event data returned for ${ticker}`,
        reason: 'no_eligible_dividend_event_data',
      }, []);
    }

    return formatToolResult(
      rows.map((row) => mapDividendEventRow(row, issuerCode)),
      [],
    );
  },
});
