import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { analyzeFinancialMetrics } from './financial-metrics-engine.js';
import { analyzeMarketCorrelation } from './market-correlation-engine.js';
import { analyzePeerComparison } from './peer-comparison-engine.js';
import { analyzeStrategy } from './strategy-engine.js';
import { analyzeSupplyDemand } from './supply-demand-engine.js';
import { analyzeTechnical } from './technical-engine.js';
import { getMarginData } from './margin-data.js';
import { getStockPrice } from './stock-price.js';
import { getTopix } from './topix.js';

const nullableNumber = z.number().nullable();

const technicalBarSchema = z.object({
  date: z.string(),
  open: nullableNumber.optional(),
  high: nullableNumber,
  low: nullableNumber,
  close: nullableNumber,
  volume: nullableNumber,
});

const marginHistoryPointSchema = z.object({
  date: z.string(),
  longBalance: nullableNumber,
  shortBalance: nullableNumber,
});

const volumeHistoryPointSchema = z.object({
  date: z.string(),
  volume: nullableNumber,
});

const peerMetricsSchema = z.object({
  per: nullableNumber.optional(),
  pbr: nullableNumber.optional(),
  roe: nullableNumber.optional(),
  roic: nullableNumber.optional(),
  operatingMargin: nullableNumber.optional(),
  revenueGrowth: nullableNumber.optional(),
  dividendYield: nullableNumber.optional(),
});

const peerCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  sector: z.string(),
  marketCap: nullableNumber.optional(),
  dataDate: z.string().nullable().optional(),
  metrics: peerMetricsSchema,
});

const marketPricePointSchema = z.object({
  date: z.string(),
  close: nullableNumber,
});

const strategyTechnicalInputSchema = z.object({
  dataDate: z.string().nullable(),
  latestSwingHigh: nullableNumber,
  latestSwingLow: nullableNumber,
  atr14: nullableNumber,
});

const financialMetricPointSchema = z.object({
  fiscalYear: z.number(),
  submitDate: z.string().nullable(),
  revenue: nullableNumber,
  eps: nullableNumber,
  bps: nullableNumber,
  dividendPerShare: nullableNumber,
});

const tickerSourceFields = {
  ticker: z.string().optional().describe(
    'Ticker to fetch directly instead of re-serializing a retrieved history.',
  ),
  from: z.string().optional().describe('History start date for direct ticker mode.'),
  to: z.string().optional().describe('History end date for direct ticker mode.'),
};

function parseToolArray<T>(result: unknown, toolName: string): T[] {
  const parsed = JSON.parse(
    typeof result === 'string' ? result : JSON.stringify(result),
  ) as { data?: unknown };
  if (!Array.isArray(parsed.data)) {
    const error = parsed.data && typeof parsed.data === 'object'
      ? (parsed.data as { error?: unknown }).error
      : undefined;
    throw new Error(
      typeof error === 'string' ? error : `${toolName} did not return a history array.`,
    );
  }
  return parsed.data as T[];
}

function requireTickerRange(
  ticker: string | undefined,
  from: string | undefined,
  to: string | undefined,
  toolName: string,
): { ticker: string; from: string; to: string | undefined } {
  if (!ticker || !from) {
    throw new Error(`${toolName} requires its history arrays or both ticker and from.`);
  }
  return { ticker, from, to };
}

async function fetchStockHistory(
  ticker: string,
  from: string,
  to: string | undefined,
) {
  return parseToolArray<z.infer<typeof technicalBarSchema>>(
    await getStockPrice.invoke({ ticker, from, to }),
    'get_stock_price',
  );
}

async function fetchMarginHistory(
  ticker: string,
  from: string,
  to: string | undefined,
) {
  return parseToolArray<z.infer<typeof marginHistoryPointSchema>>(
    await getMarginData.invoke({ ticker, from, to }),
    'get_margin_data',
  );
}

async function fetchTopixHistory(from: string, to: string | undefined) {
  return parseToolArray<z.infer<typeof marketPricePointSchema>>(
    await getTopix.invoke({ from, to }),
    'get_topix',
  );
}

export const ANALYZE_TECHNICAL_DESCRIPTION = `
Calculate the fixed MVP technical snapshot from chronological OHLCV bars. Returns SMA20, ATR14, average volume, Swing High/Low, trend, data date, and explicit unavailable metrics. All calculations are deterministic; do not calculate these values in the model.
`.trim();

export const analyzeTechnicalTool = new DynamicStructuredTool({
  name: 'analyze_technical',
  description: ANALYZE_TECHNICAL_DESCRIPTION,
  schema: z.object({
    bars: z.array(technicalBarSchema).optional().describe(
      'Chronological adjusted OHLCV bars from get_stock_price. Preserve null values and dates.',
    ),
    ...tickerSourceFields,
  }),
  func: async ({ bars, ticker, from, to }) => {
    if (!bars) {
      const source = requireTickerRange(ticker, from, to, 'analyze_technical');
      bars = await fetchStockHistory(source.ticker, source.from, source.to);
    }
    return formatToolResult(analyzeTechnical(bars), []);
  },
});

export const ANALYZE_SUPPLY_DEMAND_DESCRIPTION = `
Calculate deterministic Japanese margin supply-demand statistics from chronological weekly margin balances and daily volume. Returns margin ratio, weekly changes, 13/52-week statistics, percentile, digestion days, data dates, and explicit unavailable metrics.
`.trim();

export const analyzeSupplyDemandTool = new DynamicStructuredTool({
  name: 'analyze_supply_demand',
  description: ANALYZE_SUPPLY_DEMAND_DESCRIPTION,
  schema: z.object({
    marginHistory: z.array(marginHistoryPointSchema).optional().describe(
      'Chronological rows from get_margin_data, mapped to date, longBalance, and shortBalance.',
    ),
    volumeHistory: z.array(volumeHistoryPointSchema).optional().describe(
      'Chronological rows from get_stock_price, mapped to date and volume.',
    ),
    ...tickerSourceFields,
  }),
  func: async ({ marginHistory, volumeHistory, ticker, from, to }) => {
    if (!marginHistory || !volumeHistory) {
      const source = requireTickerRange(ticker, from, to, 'analyze_supply_demand');
      if (!marginHistory && !volumeHistory) {
        const [fetchedMargin, fetchedStock] = await Promise.all([
          fetchMarginHistory(source.ticker, source.from, source.to),
          fetchStockHistory(source.ticker, source.from, source.to),
        ]);
        marginHistory = fetchedMargin;
        volumeHistory = fetchedStock.map(({ date, volume }) => ({ date, volume }));
      } else if (!marginHistory) {
        marginHistory = await fetchMarginHistory(source.ticker, source.from, source.to);
      } else if (!volumeHistory) {
        const fetchedStock = await fetchStockHistory(source.ticker, source.from, source.to);
        volumeHistory = fetchedStock.map(({ date, volume }) => ({ date, volume }));
      }
    }
    if (!marginHistory || !volumeHistory) {
      throw new Error('analyze_supply_demand could not resolve complete histories.');
    }
    return formatToolResult(analyzeSupplyDemand(marginHistory, volumeHistory), []);
  },
});

export const ANALYZE_PEER_COMPARISON_DESCRIPTION = `
Select same-sector peers and calculate deterministic median, rank, and directional percentile for available valuation, profitability, growth, and dividend metrics. The target and candidates must contain sourced values; preserve missing values instead of estimating them.
`.trim();

export const analyzePeerComparisonTool = new DynamicStructuredTool({
  name: 'analyze_peer_comparison',
  description: ANALYZE_PEER_COMPARISON_DESCRIPTION,
  schema: z.object({
    target: peerCompanySchema.describe('Target company with sourced sector, market cap, metrics, and data date.'),
    candidates: z.array(peerCompanySchema).describe(
      'Candidate companies obtained from financial or screener tools. The engine filters and ranks them.',
    ),
  }),
  func: async ({ target, candidates }) => formatToolResult(
    analyzePeerComparison(target, candidates),
    [],
  ),
});

export const ANALYZE_MARKET_CORRELATION_DESCRIPTION = `
Calculate deterministic 60-day and 250-day stock-versus-TOPIX return statistics. Dates are inner-joined, missing dates are never forward-filled, and insufficient history or zero variance is reported explicitly.
`.trim();

export const analyzeMarketCorrelationTool = new DynamicStructuredTool({
  name: 'analyze_market_correlation',
  description: ANALYZE_MARKET_CORRELATION_DESCRIPTION,
  schema: z.object({
    stockPrices: z.array(marketPricePointSchema).optional().describe(
      'Chronological adjusted stock closes from get_stock_price.',
    ),
    topixPrices: z.array(marketPricePointSchema).optional().describe(
      'Chronological TOPIX closes from get_topix.',
    ),
    ...tickerSourceFields,
  }),
  func: async ({ stockPrices, topixPrices, ticker, from, to }) => {
    if (!stockPrices || !topixPrices) {
      const source = requireTickerRange(ticker, from, to, 'analyze_market_correlation');
      if (!stockPrices && !topixPrices) {
        const [fetchedStock, fetchedTopix] = await Promise.all([
          fetchStockHistory(source.ticker, source.from, source.to),
          fetchTopixHistory(source.from, source.to),
        ]);
        stockPrices = fetchedStock.map(({ date, close }) => ({ date, close }));
        topixPrices = fetchedTopix;
      } else if (!stockPrices) {
        const fetchedStock = await fetchStockHistory(source.ticker, source.from, source.to);
        stockPrices = fetchedStock.map(({ date, close }) => ({ date, close }));
      } else if (!topixPrices) {
        topixPrices = await fetchTopixHistory(source.from, source.to);
      }
    }
    if (!stockPrices || !topixPrices) {
      throw new Error('analyze_market_correlation could not resolve complete histories.');
    }
    return formatToolResult(analyzeMarketCorrelation(stockPrices, topixPrices), []);
  },
});

export const ANALYZE_STRATEGY_DESCRIPTION = `
Generate deterministic long Entry, Stop, Target, risk, reward, and reward/risk candidates from analyze_technical output. Tick size and resistance levels are optional sourced inputs only; never infer them when unavailable. Without a sourced tick size, return only the strictly-above trigger and do not claim an exact entry or 2R target.
`.trim();

export const analyzeStrategyTool = new DynamicStructuredTool({
  name: 'analyze_strategy',
  description: ANALYZE_STRATEGY_DESCRIPTION,
  schema: z.object({
    ticker: z.string().optional().describe(
      'Verified target securities code. Used only to attribute this deterministic result to the active analysis run.',
    ),
    technical: strategyTechnicalInputSchema.describe(
      'The dataDate, latestSwingHigh, latestSwingLow, and atr14 fields returned by analyze_technical.',
    ),
    tickSize: nullableNumber.optional().describe(
      'A sourced tick size. Omit or pass null when the applicable tick size is unknown.',
    ),
    resistanceLevels: z.array(nullableNumber).optional().describe(
      'Optional sourced resistance prices. Do not create or infer resistance levels.',
    ),
  }),
  func: async ({ technical, tickSize, resistanceLevels }) => formatToolResult(
    analyzeStrategy(technical, { tickSize, resistanceLevels }),
    [],
  ),
});

export const ANALYZE_FINANCIAL_METRICS_DESCRIPTION = `
Calculate current PER, PBR, dividend yield, and revenue CAGR deterministically from a sourced current price and chronological financial history. Pass adjusted EPS/BPS/dividend values when the source provides them. Never calculate these metrics in the model.
`.trim();

export const analyzeFinancialMetricsTool = new DynamicStructuredTool({
  name: 'analyze_financial_metrics',
  description: ANALYZE_FINANCIAL_METRICS_DESCRIPTION,
  schema: z.object({
    ticker: z.string().optional().describe(
      'Verified target securities code. Used only to attribute this deterministic result to the active analysis run.',
    ),
    currentPrice: nullableNumber.describe('Latest sourced adjusted closing price.'),
    priceDataDate: z.string().nullable().describe('Data date of currentPrice.'),
    financials: z.array(financialMetricPointSchema).describe(
      'Strictly chronological financial rows. Preserve missing values; use adjusted per-share values when sourced.',
    ),
  }),
  func: async ({ currentPrice, priceDataDate, financials }) => formatToolResult(
    analyzeFinancialMetrics(currentPrice, priceDataDate, financials),
    [],
  ),
});

export const deterministicAnalysisTools = [
  analyzeFinancialMetricsTool,
  analyzeTechnicalTool,
  analyzeSupplyDemandTool,
  analyzePeerComparisonTool,
  analyzeMarketCorrelationTool,
  analyzeStrategyTool,
] as const;
