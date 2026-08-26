import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { JQuantsApiError, jquantsGetAll } from './jquants-client.js';
import {
  SECTOR_INDEX_CODE_BY_S33,
  normalizeSectorSourceDate,
  resolveSectorClassification,
  type Sector33Code,
  type SectorClassificationUnavailableReason,
} from './sector-index.js';

export type SectorShortRatioSourceUnavailableReason =
  | SectorClassificationUnavailableReason
  | 'no_sector_short_ratio_data';

export interface SectorShortRatioClassification {
  classificationDate: string;
  sectorCode: Sector33Code;
  sectorName: string;
}

export interface SectorShortRatioSourceRow {
  date: string;
  sectorCode: Sector33Code;
  nonShortSellingValue: number | null;
  restrictedShortSellingValue: number | null;
  unrestrictedShortSellingValue: number | null;
}

export interface SectorShortRatioSourceResult {
  analysisAsOfDate: string;
  classification: SectorShortRatioClassification;
  rows: SectorShortRatioSourceRow[];
  provenance: {
    classification: {
      source: 'jquants';
      endpoint: '/v2/equities/master';
    };
    flow: {
      source: 'jquants';
      endpoint: '/v2/markets/short-ratio';
    };
  };
}

export interface UnavailableSectorShortRatioSource {
  analysisAsOfDate: string;
  classification: SectorShortRatioClassification | null;
  reason: SectorShortRatioSourceUnavailableReason;
  error: string;
  provenance: {
    classification: {
      source: 'jquants';
      endpoint: '/v2/equities/master';
    } | null;
    flow: {
      source: 'jquants';
      endpoint: '/v2/markets/short-ratio';
    } | null;
  };
}

export type SectorShortRatioSource =
  | SectorShortRatioSourceResult
  | UnavailableSectorShortRatioSource;

export interface FetchSectorShortRatioInput {
  ticker?: string;
  analysisAsOfDate: string;
  from: string;
  classification?: SectorShortRatioClassification;
}

export const SECTOR_SHORT_RATIO_DESCRIPTION = `
Fetches daily TSE 33-sector selling-turnover components from J-Quants for one authoritative as-of sector classification.

**Requires:** JQUANTS_API_KEY and a J-Quants Standard plan or higher.

This is sector-wide trading-flow data, not an issuer short position or outstanding balance. Source JPY values remain separate and are not combined with public short-position reports or margin balances. Empty/non-trading responses are unavailable, not zero. No ratio, threshold, squeeze label, score, or signal is calculated by this source tool.
`.trim();

const sectorCodes = new Set<string>(Object.keys(SECTOR_INDEX_CODE_BY_S33));
const sector33CodeSchema = z.custom<Sector33Code>((value) => (
  typeof value === 'string' && sectorCodes.has(value)
));
const sectorClassificationSchema = z.object({
  classificationDate: z.string(),
  sectorCode: sector33CodeSchema,
  sectorName: z.string(),
});

const SectorShortRatioInputSchema = z.object({
  ticker: z.string().optional().describe(
    'Ticker used to resolve the as-of S33 classification when classification is omitted.',
  ),
  analysisAsOfDate: z.string().describe(
    'Inclusive date-only end-of-day eligibility boundary (YYYY-MM-DD or YYYYMMDD).',
  ),
  from: z.string().describe('History start date (YYYY-MM-DD or YYYYMMDD).'),
  classification: sectorClassificationSchema.optional().describe(
    'Optional authoritative classification already resolved by get_sector_index.',
  ),
});

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalidResponse(detail: string): never {
  throw new JQuantsApiError(
    `J-Quants endpoint /markets/short-ratio returned invalid source data: ${detail}`,
    'invalid_response',
  );
}

function sourceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResponse('expected an object row.');
  }
  return value as Record<string, unknown>;
}

function sourceDate(row: Record<string, unknown>): string {
  const value = row.Date;
  if (typeof value !== 'string' || !CANONICAL_DATE_PATTERN.test(value)) {
    return invalidResponse('Date must be YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalidResponse('Date must be a valid date.');
  }
  return value;
}

function sourceAmount(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (value !== null && typeof value !== 'number') {
    return invalidResponse(`${field} must be a number or null.`);
  }
  return value;
}

function mapRows(
  values: readonly unknown[],
  sectorCode: Sector33Code,
  from: string,
  analysisAsOfDate: string,
): SectorShortRatioSourceRow[] {
  const rows: SectorShortRatioSourceRow[] = [];
  for (const value of values) {
    const row = sourceRecord(value);
    const date = sourceDate(row);
    if (date < from || date > analysisAsOfDate) continue;
    if (row.S33 !== sectorCode) {
      return invalidResponse('S33 does not match the resolved sector.');
    }
    rows.push({
      date,
      sectorCode,
      nonShortSellingValue: sourceAmount(row, 'SellExShortVa'),
      restrictedShortSellingValue: sourceAmount(row, 'ShrtWithResVa'),
      unrestrictedShortSellingValue: sourceAmount(row, 'ShrtNoResVa'),
    });
  }
  rows.sort((left, right) => left.date.localeCompare(right.date));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].date === rows[index - 1].date) {
      return invalidResponse('duplicate Date rows are not allowed for one S33.');
    }
  }
  return rows;
}

function validateClassification(
  classification: SectorShortRatioClassification,
  analysisAsOfDate: string,
): SectorShortRatioClassification {
  const classificationDate = normalizeSectorSourceDate(
    classification.classificationDate,
    'classification.classificationDate',
  );
  if (classificationDate > analysisAsOfDate) {
    throw new Error('classificationDate must be on or before analysisAsOfDate.');
  }
  if (!sectorCodes.has(classification.sectorCode) || classification.sectorName.length === 0) {
    throw new Error('classification must contain an official supported S33 identity.');
  }
  return { ...classification, classificationDate };
}

/** Fetch source rows while allowing a previously resolved S33 identity to be reused. */
export async function fetchSectorShortRatioSource(
  input: FetchSectorShortRatioInput,
): Promise<SectorShortRatioSource> {
  const analysisAsOfDate = normalizeSectorSourceDate(
    input.analysisAsOfDate,
    'analysisAsOfDate',
  );
  const from = normalizeSectorSourceDate(input.from, 'from');
  if (from > analysisAsOfDate) throw new Error('from must be on or before analysisAsOfDate.');

  let classification: SectorShortRatioClassification;
  if (input.classification) {
    classification = validateClassification(input.classification, analysisAsOfDate);
  } else {
    if (!input.ticker) {
      throw new Error('get_sector_short_ratio requires ticker or classification.');
    }
    const resolution = await resolveSectorClassification(input.ticker, analysisAsOfDate);
    if ('reason' in resolution) {
      return {
        analysisAsOfDate,
        classification: null,
        reason: resolution.reason,
        error: resolution.error,
        provenance: { classification: null, flow: null },
      };
    }
    classification = {
      classificationDate: resolution.classification.classificationDate,
      sectorCode: resolution.classification.sectorCode,
      sectorName: resolution.classification.sectorName,
    };
  }

  const sourceRows = await jquantsGetAll<Record<string, unknown>>(
    '/markets/short-ratio',
    { s33: classification.sectorCode, from, to: analysisAsOfDate },
  );
  const rows = mapRows(sourceRows, classification.sectorCode, from, analysisAsOfDate);
  const provenance = {
    classification: { source: 'jquants', endpoint: '/v2/equities/master' },
    flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
  } as const;
  if (rows.length === 0) {
    return {
      analysisAsOfDate,
      classification,
      reason: 'no_sector_short_ratio_data',
      error: 'No sector short-ratio source rows were returned for the requested boundary.',
      provenance,
    };
  }
  return { analysisAsOfDate, classification, rows, provenance };
}

export const getSectorShortRatio = new DynamicStructuredTool({
  name: 'get_sector_short_ratio',
  description: SECTOR_SHORT_RATIO_DESCRIPTION,
  schema: SectorShortRatioInputSchema,
  func: async (input) => formatToolResult(
    await fetchSectorShortRatioSource(input),
    [],
  ),
});
