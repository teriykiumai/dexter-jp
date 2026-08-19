import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { jquantsGetAll, resolveJQuantsCode } from './jquants-client.js';

interface JQuantsMarginRow extends Record<string, unknown> {
  Date: string;
  Code: string;
  ShrtVol: number | null;
  LongVol: number | null;
  ShrtNegVol: number | null;
  LongNegVol: number | null;
  ShrtStdVol: number | null;
  LongStdVol: number | null;
  IssType: string;
}

export const MARGIN_DATA_DESCRIPTION = `
Fetches weekly margin trading outstanding balances for a Japanese equity from J-Quants.

**Requires:** JQUANTS_API_KEY and a J-Quants plan that includes the margin-interest endpoint (Standard plan or higher).

Use this for historical long/short margin balances. Do not use it for exchange daily margin statistics, short-selling reports, or investor-type trading data.
`.trim();

const MarginDataInputSchema = z.object({
  ticker: z
    .string()
    .describe("Securities code (e.g. '7203'), company name, or EDINET code."),
  from: z.string().optional().describe('Start date (YYYY-MM-DD or YYYYMMDD).'),
  to: z.string().optional().describe('End date (YYYY-MM-DD or YYYYMMDD).'),
});

export const getMarginData = new DynamicStructuredTool({
  name: 'get_margin_data',
  description: 'Fetch weekly long and short margin trading outstanding balances for a Japanese equity from J-Quants.',
  schema: MarginDataInputSchema,
  func: async (input) => {
    const code = await resolveJQuantsCode(input.ticker);
    const rows = await jquantsGetAll<JQuantsMarginRow>('/markets/margin-interest', {
      code,
      from: input.from,
      to: input.to,
    });

    if (rows.length === 0) {
      return formatToolResult({ error: `No margin data found for ${input.ticker}` }, []);
    }

    return formatToolResult(rows.map((row) => ({
      date: row.Date,
      code: row.Code,
      shortBalance: row.ShrtVol,
      longBalance: row.LongVol,
      negotiableShortBalance: row.ShrtNegVol,
      negotiableLongBalance: row.LongNegVol,
      standardizedShortBalance: row.ShrtStdVol,
      standardizedLongBalance: row.LongStdVol,
      issueType: row.IssType,
    })), []);
  },
});
