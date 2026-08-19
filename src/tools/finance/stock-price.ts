import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { isJQuantsAvailable, jquantsGetAll, resolveJQuantsCode } from './jquants-client.js';

/**
 * J-Quants V2 tool for stock price data.
 * Optional — only works when JQUANTS_API_KEY is set.
 *
 * V2 auth: API key via x-api-key header (no token refresh needed, no expiry).
 * Free plan: daily OHLC for all TSE-listed stocks (data may have a delay).
 */

interface JQuantsStockBar extends Record<string, unknown> {
  Date: string;
  Code: string;
  AdjO: number | null;
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null;
  AdjVo: number | null;
  Va: number | null;
}

// ============================================================================
// Tools
// ============================================================================

export const STOCK_PRICE_DESCRIPTION = `
Fetches current and historical stock prices for Japanese equities from J-Quants (Tokyo Stock Exchange official data). Includes OHLC, volume, and split-adjusted prices.

**Requires:** JQUANTS_API_KEY environment variable.

## When to Use

- Current stock price (latest close, volume)
- Historical OHLC price data over a date range
- Price trend analysis and charting data

## When NOT to Use

- Company financials or ratios (use get_financials)
- Securities report content (use read_filings)
- Company screening (use company_screener)

## Notes

- Free plan data may have a delay (not real-time)
- V2 API: response fields are abbreviated (O=Open, H=High, L=Low, C=Close, Vo=Volume)
- Adjusted prices (AdjO/AdjH/AdjL/AdjC) account for stock splits
`.trim();

const StockPriceInputSchema = z.object({
  ticker: z
    .string()
    .describe(
      "Securities code (e.g. '7203' for Toyota), company name (e.g. 'トヨタ'), or EDINET code."
    ),
  from: z
    .string()
    .optional()
    .describe('Start date (YYYY-MM-DD or YYYYMMDD). If omitted, returns latest available data.'),
  to: z
    .string()
    .optional()
    .describe('End date (YYYY-MM-DD or YYYYMMDD). If omitted, defaults to latest available.'),
});

export const getStockPrice = new DynamicStructuredTool({
  name: 'get_stock_price',
  description: `Fetches stock price data for a Japanese equity from J-Quants (TSE official data). Returns OHLC, volume, and split-adjusted prices. Specify date range for historical data, or omit for the latest available price.`,
  schema: StockPriceInputSchema,
  func: async (input) => {
    const code = await resolveJQuantsCode(input.ticker);

    const params: Record<string, string | undefined> = {
      code,
      from: input.from,
      to: input.to,
    };

    const bars = await jquantsGetAll<JQuantsStockBar>('/equities/bars/daily', params);

    if (bars.length === 0) {
      return formatToolResult({ error: `No price data found for ${input.ticker}` }, []);
    }

    // For single-day / latest queries, return just the most recent
    if (!input.from && !input.to) {
      const latest = bars[bars.length - 1];
      return formatToolResult({
        code: latest.Code,
        date: latest.Date,
        open: latest.AdjO,
        high: latest.AdjH,
        low: latest.AdjL,
        close: latest.AdjC,
        volume: latest.AdjVo,
        turnover: latest.Va,
      }, []);
    }

    // For date ranges, return compact array with adjusted prices
    const compact = bars.map((q) => ({
      date: q.Date,
      open: q.AdjO,
      high: q.AdjH,
      low: q.AdjL,
      close: q.AdjC,
      volume: q.AdjVo,
    }));

    return formatToolResult(compact, []);
  },
});

/**
 * Check if J-Quants is available (JQUANTS_API_KEY is set).
 */
export { isJQuantsAvailable };
