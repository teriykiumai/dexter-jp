import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { jquantsGetAll } from './jquants-client.js';

interface JQuantsTopixBar extends Record<string, unknown> {
  Date: string;
  O: number | null;
  H: number | null;
  L: number | null;
  C: number | null;
}

export const TOPIX_DESCRIPTION = `
Fetches historical daily TOPIX OHLC data from J-Quants.

**Requires:** JQUANTS_API_KEY and a J-Quants plan that includes TOPIX data (Light plan or higher).

Use this for Japanese equity-market benchmark history. It does not return constituent stocks or other indices.
`.trim();

const TopixInputSchema = z.object({
  from: z.string().optional().describe('Start date (YYYY-MM-DD or YYYYMMDD).'),
  to: z.string().optional().describe('End date (YYYY-MM-DD or YYYYMMDD).'),
});

export const getTopix = new DynamicStructuredTool({
  name: 'get_topix',
  description: 'Fetch daily TOPIX OHLC benchmark data from J-Quants.',
  schema: TopixInputSchema,
  func: async (input) => {
    const bars = await jquantsGetAll<JQuantsTopixBar>('/indices/bars/daily/topix', {
      from: input.from,
      to: input.to,
    });

    if (bars.length === 0) {
      return formatToolResult({ error: 'No TOPIX data found for the requested period' }, []);
    }

    return formatToolResult(bars.map((bar) => ({
      date: bar.Date,
      open: bar.O,
      high: bar.H,
      low: bar.L,
      close: bar.C,
    })), []);
  },
});
