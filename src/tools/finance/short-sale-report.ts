import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { jquantsGetAll, resolveJQuantsCode } from './jquants-client.js';

interface JQuantsShortSaleReportRow extends Record<string, unknown> {
  DiscDate: string;
  CalcDate: string;
  Code: string;
  SSName: string | null;
  DICName: string | null;
  FundName: string | null;
  ShrtPosToSO: number | null;
  ShrtPosShares: number | null;
  PrevRptDate: string | null;
  PrevRptRatio: number | null;
}

export interface ShortSaleReportSourceRow {
  disclosedDate: string;
  calculatedDate: string;
  code: string;
  reporterName: string | null;
  discretionaryManagerName: string | null;
  fundName: string | null;
  shortPositionRatio: number | null;
  shortPositionShares: number | null;
  previousCalculatedDate: string | null;
  previousReportedRatio: number | null;
}

export const SHORT_SALE_REPORT_DESCRIPTION = `
Fetches source-level public short-position reports for a Japanese equity from J-Quants.

**Requires:** JQUANTS_API_KEY and a J-Quants plan that includes the short-sale-report endpoint (Standard plan or higher).

The source publishes reports for short-position ratios of 0.5% or more. An empty result does not mean that the short position is zero, that no short seller exists, or that no position below 0.5% exists. This is distinct from weekly margin-trading outstanding balances returned by get_margin_data.
`.trim();

const ShortSaleReportInputSchema = z.object({
  ticker: z
    .string()
    .describe("Securities code (e.g. '7203'), company name, or EDINET code."),
  disclosedDate: z
    .string()
    .optional()
    .describe('Exact disclosure date (YYYY-MM-DD or YYYYMMDD).'),
  disclosedFrom: z
    .string()
    .optional()
    .describe('Disclosure-date range start (YYYY-MM-DD or YYYYMMDD).'),
  disclosedTo: z
    .string()
    .optional()
    .describe('Disclosure-date range end (YYYY-MM-DD or YYYYMMDD).'),
  calculatedDate: z
    .string()
    .optional()
    .describe('Exact position calculation date (YYYY-MM-DD or YYYYMMDD).'),
});

function nullableSourceString(value: string | null): string | null {
  return value === '' ? null : value;
}

export const getShortSaleReports = new DynamicStructuredTool({
  name: 'get_short_sale_reports',
  description: SHORT_SALE_REPORT_DESCRIPTION,
  schema: ShortSaleReportInputSchema,
  func: async (input) => {
    const code = await resolveJQuantsCode(input.ticker);
    const rows = await jquantsGetAll<JQuantsShortSaleReportRow>('/markets/short-sale-report', {
      code,
      disc_date: input.disclosedDate,
      disc_date_from: input.disclosedFrom,
      disc_date_to: input.disclosedTo,
      calc_date: input.calculatedDate,
    });

    if (rows.length === 0) {
      return formatToolResult({
        error: `No public short-position disclosure data at or above the 0.5% reporting threshold found for ${input.ticker}`,
        reason: 'no_public_disclosure_data',
      }, []);
    }

    const reports: ShortSaleReportSourceRow[] = rows.map((row) => ({
      disclosedDate: row.DiscDate,
      calculatedDate: row.CalcDate,
      code: row.Code,
      reporterName: nullableSourceString(row.SSName),
      discretionaryManagerName: nullableSourceString(row.DICName),
      fundName: nullableSourceString(row.FundName),
      shortPositionRatio: row.ShrtPosToSO,
      shortPositionShares: row.ShrtPosShares,
      previousCalculatedDate: nullableSourceString(row.PrevRptDate),
      previousReportedRatio: row.PrevRptRatio,
    }));

    return formatToolResult(reports, []);
  },
});
