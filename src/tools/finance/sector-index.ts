import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import {
  JQuantsApiError,
  jquantsGetAll,
  resolveJQuantsCode,
} from './jquants-client.js';

export const SECTOR_INDEX_SOURCE_START_DATE = '2008-05-07';

export const SECTOR_INDEX_CODE_BY_S33 = {
  '0050': '0040',
  '1050': '0041',
  '2050': '0042',
  '3050': '0043',
  '3100': '0044',
  '3150': '0045',
  '3200': '0046',
  '3250': '0047',
  '3300': '0048',
  '3350': '0049',
  '3400': '004A',
  '3450': '004B',
  '3500': '004C',
  '3550': '004D',
  '3600': '004E',
  '3650': '004F',
  '3700': '0050',
  '3750': '0051',
  '3800': '0052',
  '4050': '0053',
  '5050': '0054',
  '5100': '0055',
  '5150': '0056',
  '5200': '0057',
  '5250': '0058',
  '6050': '0059',
  '6100': '005A',
  '7050': '005B',
  '7100': '005C',
  '7150': '005D',
  '7200': '005E',
  '8050': '005F',
  '9050': '0060',
} as const;

export type Sector33Code = keyof typeof SECTOR_INDEX_CODE_BY_S33;
export type SectorIndexCode = typeof SECTOR_INDEX_CODE_BY_S33[Sector33Code];

export type SectorIndexSourceUnavailableReason =
  | 'sector_classification_unavailable'
  | 'unsupported_sector'
  | 'no_sector_index_data';

export interface SectorCalendarDay {
  date: string;
  holidayDivision: string;
}

export interface SectorClassificationSource {
  issuerCode: string;
  classificationDate: string;
  sectorCode: Sector33Code;
  sectorName: string;
  indexCode: SectorIndexCode;
}

export interface SectorIndexPriceSourceRow {
  date: string;
  indexCode: SectorIndexCode;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface SectorIndexSourceResult {
  analysisAsOfDate: string;
  classification: SectorClassificationSource;
  prices: SectorIndexPriceSourceRow[];
}

export const SECTOR_INDEX_DESCRIPTION = `
Fetches an issuer's as-of TSE 33-sector classification and the corresponding daily price-index history from J-Quants.

**Requires:** JQUANTS_API_KEY and a J-Quants Standard plan or higher for general index data.

The classification is resolved from the official trading calendar and equity master at analysisAsOfDate. The returned history uses that one as-of sector index only; it does not claim that the issuer belonged to the sector throughout the history and does not stitch indices after sector changes. Values are source-provided index points and no correlation or other financial metric is calculated. Empty data is unavailable, not zero.
`.trim();

const SectorIndexInputSchema = z.object({
  ticker: z
    .string()
    .describe("Securities code (e.g. '7203'), company name, or EDINET code."),
  analysisAsOfDate: z
    .string()
    .describe('Inclusive as-of date (YYYY-MM-DD or YYYYMMDD).'),
  from: z
    .string()
    .optional()
    .describe('Optional sector-index history start date (YYYY-MM-DD or YYYYMMDD).'),
});

const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INPUT_DATE_PATTERN = /^(?:\d{8}|\d{4}-\d{2}-\d{2})$/;
const BUSINESS_HOLIDAY_DIVISIONS = new Set(['1', '2']);
const HOLIDAY_DIVISIONS = new Set(['0', '1', '2', '3']);

function normalizeInputDate(value: string, fieldName: string): string {
  if (!INPUT_DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD or YYYYMMDD date.`);
  }
  const compact = value.replaceAll('-', '');
  const normalized = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD or YYYYMMDD date.`);
  }
  return normalized;
}

function invalidResponse(endpoint: string, detail: string): never {
  throw new JQuantsApiError(
    `J-Quants endpoint ${endpoint} returned invalid sector-index source data: ${detail}`,
    'invalid_response',
  );
}

function sourceRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResponse(endpoint, 'expected an object row.');
  }
  return value as Record<string, unknown>;
}

function sourceString(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    return invalidResponse(endpoint, `${field} must be a non-empty string.`);
  }
  return value;
}

function sourceDate(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): string {
  const value = sourceString(row, field, endpoint);
  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) return invalidResponse(endpoint, `${field} must be YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalidResponse(endpoint, `${field} must be a valid date.`);
  }
  return value;
}

function nullableSourceNumber(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): number | null {
  const value = row[field];
  if (value !== null && typeof value !== 'number') {
    return invalidResponse(endpoint, `${field} must be a number or null.`);
  }
  return value;
}

export function selectSectorClassificationDate(
  calendar: readonly SectorCalendarDay[],
  analysisAsOfDate: string,
): string | null {
  let selected: string | null = null;
  for (const day of calendar) {
    if (
      day.date <= analysisAsOfDate
      && BUSINESS_HOLIDAY_DIVISIONS.has(day.holidayDivision)
      && (selected === null || day.date > selected)
    ) {
      selected = day.date;
    }
  }
  return selected;
}

function mapCalendarRows(
  rows: readonly unknown[],
  analysisAsOfDate: string,
): SectorCalendarDay[] {
  const endpoint = '/markets/calendar';
  const days: SectorCalendarDay[] = [];
  for (const value of rows) {
    const row = sourceRecord(value, endpoint);
    const date = sourceDate(row, 'Date', endpoint);
    if (date > analysisAsOfDate) continue;
    const holidayDivision = sourceString(row, 'HolDiv', endpoint);
    if (!HOLIDAY_DIVISIONS.has(holidayDivision)) {
      return invalidResponse(endpoint, 'HolDiv is not an official holiday division.');
    }
    days.push({ date, holidayDivision });
  }
  return days;
}

async function fetchClassificationDate(analysisAsOfDate: string): Promise<string | null> {
  const rows = await jquantsGetAll<Record<string, unknown>>('/markets/calendar', {
    from: SECTOR_INDEX_SOURCE_START_DATE,
    to: analysisAsOfDate,
  });
  return selectSectorClassificationDate(
    mapCalendarRows(rows, analysisAsOfDate),
    analysisAsOfDate,
  );
}

function isSector33Code(value: string): value is Sector33Code {
  return Object.hasOwn(SECTOR_INDEX_CODE_BY_S33, value);
}

function mapClassification(
  rows: readonly unknown[],
  issuerCode: string,
  classificationDate: string,
): SectorClassificationSource | 'unsupported' | null {
  const endpoint = '/equities/master';
  const eligibleRows: Record<string, unknown>[] = [];
  for (const value of rows) {
    const row = sourceRecord(value, endpoint);
    const date = sourceDate(row, 'Date', endpoint);
    if (date > classificationDate) continue;
    if (date !== classificationDate) return null;
    eligibleRows.push(row);
  }
  if (eligibleRows.length === 0) return null;
  if (eligibleRows.length !== 1) {
    return invalidResponse(endpoint, 'expected one exact code/date row.');
  }

  const row = eligibleRows[0];
  if (sourceString(row, 'Code', endpoint) !== issuerCode) {
    return invalidResponse(endpoint, 'Code does not match the requested issuer.');
  }
  const sectorCode = sourceString(row, 'S33', endpoint);
  const sectorName = sourceString(row, 'S33Nm', endpoint);
  if (sectorCode === '9999') return 'unsupported';
  if (!isSector33Code(sectorCode)) {
    return invalidResponse(endpoint, `S33 ${sectorCode} has no fixed index mapping.`);
  }

  return {
    issuerCode,
    classificationDate,
    sectorCode,
    sectorName,
    indexCode: SECTOR_INDEX_CODE_BY_S33[sectorCode],
  };
}

function mapIndexRows(
  rows: readonly unknown[],
  indexCode: SectorIndexCode,
  from: string | undefined,
  analysisAsOfDate: string,
): SectorIndexPriceSourceRow[] {
  const endpoint = '/indices/bars/daily';
  const prices: SectorIndexPriceSourceRow[] = [];
  for (const value of rows) {
    const row = sourceRecord(value, endpoint);
    const date = sourceDate(row, 'Date', endpoint);
    if (date > analysisAsOfDate || (from !== undefined && date < from)) continue;
    if (sourceString(row, 'Code', endpoint) !== indexCode) {
      return invalidResponse(endpoint, 'Code does not match the resolved sector index.');
    }
    prices.push({
      date,
      indexCode,
      open: nullableSourceNumber(row, 'O', endpoint),
      high: nullableSourceNumber(row, 'H', endpoint),
      low: nullableSourceNumber(row, 'L', endpoint),
      close: nullableSourceNumber(row, 'C', endpoint),
    });
  }
  return prices;
}

function unavailable(reason: SectorIndexSourceUnavailableReason, error: string): string {
  return formatToolResult({ error, reason }, []);
}

export const getSectorIndex = new DynamicStructuredTool({
  name: 'get_sector_index',
  description: SECTOR_INDEX_DESCRIPTION,
  schema: SectorIndexInputSchema,
  func: async (input) => {
    const analysisAsOfDate = normalizeInputDate(
      input.analysisAsOfDate,
      'analysisAsOfDate',
    );
    const from = input.from === undefined
      ? undefined
      : normalizeInputDate(input.from, 'from');
    if (analysisAsOfDate < SECTOR_INDEX_SOURCE_START_DATE) {
      return unavailable(
        'sector_classification_unavailable',
        `Sector classification is unavailable before ${SECTOR_INDEX_SOURCE_START_DATE}.`,
      );
    }
    if (from !== undefined && from > analysisAsOfDate) {
      throw new Error('from must be on or before analysisAsOfDate.');
    }

    const issuerCode = await resolveJQuantsCode(input.ticker);
    const classificationDate = await fetchClassificationDate(analysisAsOfDate);
    if (!classificationDate) {
      return unavailable(
        'sector_classification_unavailable',
        `No official classification business date found on or before ${analysisAsOfDate}.`,
      );
    }

    const masterRows = await jquantsGetAll<Record<string, unknown>>('/equities/master', {
      code: issuerCode,
      date: classificationDate,
    });
    const classification = mapClassification(
      masterRows,
      issuerCode,
      classificationDate,
    );
    if (classification === null) {
      return unavailable(
        'sector_classification_unavailable',
        `No exact as-of sector classification found for ${input.ticker}.`,
      );
    }
    if (classification === 'unsupported') {
      return unavailable(
        'unsupported_sector',
        `The as-of S33 classification for ${input.ticker} has no TSE 33-sector index.`,
      );
    }

    const indexRows = await jquantsGetAll<Record<string, unknown>>('/indices/bars/daily', {
      code: classification.indexCode,
      from,
      to: analysisAsOfDate,
    });
    const prices = mapIndexRows(
      indexRows,
      classification.indexCode,
      from,
      analysisAsOfDate,
    );
    if (prices.length === 0) {
      return unavailable(
        'no_sector_index_data',
        `No sector-index data found for ${classification.indexCode} at the requested source boundary.`,
      );
    }

    const result: SectorIndexSourceResult = {
      analysisAsOfDate,
      classification,
      prices,
    };
    return formatToolResult(result, []);
  },
});
