import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { analyzeMarketCorrelation } from './market-correlation-engine.js';
import { analyzePeerComparison } from './peer-comparison-engine.js';
import { analyzeStrategy } from './strategy-engine.js';
import { analyzeSupplyDemand } from './supply-demand-engine.js';
import { analyzeTechnical } from './technical-engine.js';

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

export const ANALYZE_TECHNICAL_DESCRIPTION = `
Calculate the fixed MVP technical snapshot from chronological OHLCV bars. Returns SMA20, ATR14, average volume, Swing High/Low, trend, data date, and explicit unavailable metrics. All calculations are deterministic; do not calculate these values in the model.
`.trim();

export const analyzeTechnicalTool = new DynamicStructuredTool({
  name: 'analyze_technical',
  description: ANALYZE_TECHNICAL_DESCRIPTION,
  schema: z.object({
    bars: z.array(technicalBarSchema).describe(
      'Chronological adjusted OHLCV bars from get_stock_price. Preserve null values and dates.',
    ),
  }),
  func: async ({ bars }) => formatToolResult(analyzeTechnical(bars), []),
});

export const ANALYZE_SUPPLY_DEMAND_DESCRIPTION = `
Calculate deterministic Japanese margin supply-demand statistics from chronological weekly margin balances and daily volume. Returns margin ratio, weekly changes, 13/52-week statistics, percentile, digestion days, data dates, and explicit unavailable metrics.
`.trim();

export const analyzeSupplyDemandTool = new DynamicStructuredTool({
  name: 'analyze_supply_demand',
  description: ANALYZE_SUPPLY_DEMAND_DESCRIPTION,
  schema: z.object({
    marginHistory: z.array(marginHistoryPointSchema).describe(
      'Chronological rows from get_margin_data, mapped to date, longBalance, and shortBalance.',
    ),
    volumeHistory: z.array(volumeHistoryPointSchema).describe(
      'Chronological rows from get_stock_price, mapped to date and volume.',
    ),
  }),
  func: async ({ marginHistory, volumeHistory }) => formatToolResult(
    analyzeSupplyDemand(marginHistory, volumeHistory),
    [],
  ),
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
    stockPrices: z.array(marketPricePointSchema).describe(
      'Chronological adjusted stock closes from get_stock_price.',
    ),
    topixPrices: z.array(marketPricePointSchema).describe(
      'Chronological TOPIX closes from get_topix.',
    ),
  }),
  func: async ({ stockPrices, topixPrices }) => formatToolResult(
    analyzeMarketCorrelation(stockPrices, topixPrices),
    [],
  ),
});

export const ANALYZE_STRATEGY_DESCRIPTION = `
Generate deterministic long Entry, Stop, Target, risk, reward, and reward/risk candidates from analyze_technical output. Tick size and resistance levels are optional sourced inputs only; never infer them when unavailable.
`.trim();

export const analyzeStrategyTool = new DynamicStructuredTool({
  name: 'analyze_strategy',
  description: ANALYZE_STRATEGY_DESCRIPTION,
  schema: z.object({
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

export const deterministicAnalysisTools = [
  analyzeTechnicalTool,
  analyzeSupplyDemandTool,
  analyzePeerComparisonTool,
  analyzeMarketCorrelationTool,
  analyzeStrategyTool,
] as const;
