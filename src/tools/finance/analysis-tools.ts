import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import { formatToolResult } from '../types.js';
import { analyzeAdvancedTechnical } from './advanced-technical-engine.js';
import { analyzeFinancialMetrics } from './financial-metrics-engine.js';
import { analyzeInvestorTypeFlows } from './investor-type-flow-engine.js';
import { analyzeMarketCorrelation } from './market-correlation-engine.js';
import { analyzePeerComparison } from './peer-comparison-engine.js';
import { analyzeReportedShortPositions } from './reported-short-position-engine.js';
import {
  analyzeSectorBenchmark,
  type SectorBenchmarkInput,
} from './sector-benchmark-engine.js';
import { analyzeSectorShortRatio } from './sector-short-ratio-engine.js';
import { analyzeStrategy } from './strategy-engine.js';
import { analyzeSupplyDemand } from './supply-demand-engine.js';
import { analyzeTechnical } from './technical-engine.js';
import { getMarginData } from './margin-data.js';
import { getInvestorTypeFlows } from './investor-type-flows.js';
import { jquantsGetAll } from './jquants-client.js';
import { getShortSaleReports } from './short-sale-report.js';
import {
  getSectorIndex,
  SECTOR_INDEX_CODE_BY_S33,
  type Sector33Code,
  type SectorIndexCode,
} from './sector-index.js';
import {
  fetchSectorShortRatioSource,
  type SectorShortRatioSource,
} from './sector-short-ratio.js';
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

const shortSaleReportSourceRowSchema = z.object({
  disclosedDate: z.string(),
  calculatedDate: z.string(),
  code: z.string(),
  reporterName: z.string().nullable(),
  discretionaryManagerName: z.string().nullable(),
  fundName: z.string().nullable(),
  shortPositionRatio: nullableNumber,
  shortPositionShares: nullableNumber,
  previousCalculatedDate: z.string().nullable(),
  previousReportedRatio: nullableNumber,
});

const investorTypeTradingValueSchema = z.object({
  sell: z.number(),
  buy: z.number(),
  total: z.number(),
  balance: z.number(),
});

const investorTypeFlowSourceRowSchema = z.object({
  publishedDate: z.string(),
  periodStartDate: z.string(),
  periodEndDate: z.string(),
  section: z.enum([
    'TSE1st',
    'TSE2nd',
    'TSEMothers',
    'TSEJASDAQ',
    'TSEPrime',
    'TSEStandard',
    'TSEGrowth',
    'TokyoNagoya',
  ]),
  summary: z.object({
    proprietary: investorTypeTradingValueSchema,
    brokerage: investorTypeTradingValueSchema,
    total: investorTypeTradingValueSchema,
  }),
  brokerageBreakdown: z.object({
    individuals: investorTypeTradingValueSchema,
    foreignInvestors: investorTypeTradingValueSchema,
    securitiesCompanies: investorTypeTradingValueSchema,
    investmentTrusts: investorTypeTradingValueSchema,
    businessCorporations: investorTypeTradingValueSchema,
    otherCorporations: investorTypeTradingValueSchema,
    insuranceCompanies: investorTypeTradingValueSchema,
    banks: investorTypeTradingValueSchema,
    trustBanks: investorTypeTradingValueSchema,
    otherFinancialInstitutions: investorTypeTradingValueSchema,
  }),
});

const investorTypeCalendarDaySchema = z.object({
  date: z.string(),
  holidayDivision: z.string(),
});

interface JQuantsCalendarRow extends Record<string, unknown> {
  Date: string;
  HolDiv: string;
}

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

const sectorIndexCodes = new Set<string>(Object.values(SECTOR_INDEX_CODE_BY_S33));
const sector33CodeSchema = z.custom<Sector33Code>((value) => (
  typeof value === 'string' && Object.hasOwn(SECTOR_INDEX_CODE_BY_S33, value)
));
const sectorIndexCodeSchema = z.custom<SectorIndexCode>((value) => (
  typeof value === 'string' && sectorIndexCodes.has(value)
));
const sectorIndexUnavailableReasonSchema = z.enum([
  'sector_classification_unavailable',
  'unsupported_sector',
  'no_sector_index_data',
]);
const sectorIndexPriceSourceRowSchema = z.object({
  date: z.string(),
  indexCode: sectorIndexCodeSchema,
  open: nullableNumber,
  high: nullableNumber,
  low: nullableNumber,
  close: nullableNumber,
});
const sectorIndexSourceResultSchema = z.object({
  analysisAsOfDate: z.string(),
  classification: z.object({
    issuerCode: z.string(),
    classificationDate: z.string(),
    sectorCode: sector33CodeSchema,
    sectorName: z.string(),
    indexCode: sectorIndexCodeSchema,
  }),
  prices: z.array(sectorIndexPriceSourceRowSchema),
});
const unavailableSectorBenchmarkInputSchema = z.object({
  analysisAsOfDate: z.string(),
  reason: sectorIndexUnavailableReasonSchema,
});
const sectorBenchmarkInputSchema = z.union([
  sectorIndexSourceResultSchema,
  unavailableSectorBenchmarkInputSchema,
]);

const sectorShortRatioClassificationSchema = z.object({
  classificationDate: z.string(),
  sectorCode: sector33CodeSchema,
  sectorName: z.string(),
});
const sectorShortRatioSourceRowSchema = z.object({
  date: z.string(),
  sectorCode: sector33CodeSchema,
  nonShortSellingValue: nullableNumber,
  restrictedShortSellingValue: nullableNumber,
  unrestrictedShortSellingValue: nullableNumber,
});
const sectorShortRatioProvenanceSchema = z.object({
  classification: z.object({
    source: z.literal('jquants'),
    endpoint: z.literal('/v2/equities/master'),
  }).nullable(),
  flow: z.object({
    source: z.literal('jquants'),
    endpoint: z.literal('/v2/markets/short-ratio'),
  }).nullable(),
});
const sectorShortRatioSourceSchema = z.union([
  z.object({
    analysisAsOfDate: z.string(),
    classification: sectorShortRatioClassificationSchema,
    rows: z.array(sectorShortRatioSourceRowSchema),
    provenance: sectorShortRatioProvenanceSchema.extend({
      classification: sectorShortRatioProvenanceSchema.shape.classification.unwrap(),
      flow: sectorShortRatioProvenanceSchema.shape.flow.unwrap(),
    }),
  }),
  z.object({
    analysisAsOfDate: z.string(),
    classification: sectorShortRatioClassificationSchema.nullable(),
    reason: z.enum([
      'sector_classification_unavailable',
      'unsupported_sector',
      'no_sector_short_ratio_data',
    ]),
    error: z.string(),
    provenance: sectorShortRatioProvenanceSchema,
  }),
]);

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

function parseShortSaleReports(result: unknown): z.infer<
  typeof shortSaleReportSourceRowSchema
>[] {
  const parsed = JSON.parse(
    typeof result === 'string' ? result : JSON.stringify(result),
  ) as { data?: unknown };
  if (Array.isArray(parsed.data)) {
    return z.array(shortSaleReportSourceRowSchema).parse(parsed.data);
  }
  if (
    parsed.data
    && typeof parsed.data === 'object'
    && (parsed.data as { reason?: unknown }).reason === 'no_public_disclosure_data'
  ) {
    return [];
  }
  const error = parsed.data && typeof parsed.data === 'object'
    ? (parsed.data as { error?: unknown }).error
    : undefined;
  throw new Error(
    typeof error === 'string'
      ? error
      : 'get_short_sale_reports did not return source reports.',
  );
}

function parseInvestorTypeFlows(result: unknown): z.infer<
  typeof investorTypeFlowSourceRowSchema
>[] {
  const parsed = JSON.parse(
    typeof result === 'string' ? result : JSON.stringify(result),
  ) as { data?: unknown };
  if (Array.isArray(parsed.data)) {
    return z.array(investorTypeFlowSourceRowSchema).parse(parsed.data);
  }
  if (
    parsed.data
    && typeof parsed.data === 'object'
    && (parsed.data as { reason?: unknown }).reason === 'no_investor_type_flow_data'
  ) {
    return [];
  }
  const error = parsed.data && typeof parsed.data === 'object'
    ? (parsed.data as { error?: unknown }).error
    : undefined;
  throw new Error(
    typeof error === 'string'
      ? error
      : 'get_investor_type_flows did not return source periods.',
  );
}

function parseSectorIndexSource(
  result: unknown,
  analysisAsOfDate: string,
): SectorBenchmarkInput {
  const parsed = JSON.parse(
    typeof result === 'string' ? result : JSON.stringify(result),
  ) as { data?: unknown };
  const available = sectorIndexSourceResultSchema.safeParse(parsed.data);
  if (available.success) return available.data;

  const unavailableReason = sectorIndexUnavailableReasonSchema.safeParse(
    parsed.data && typeof parsed.data === 'object'
      ? (parsed.data as { reason?: unknown }).reason
      : undefined,
  );
  if (unavailableReason.success) {
    return { analysisAsOfDate, reason: unavailableReason.data };
  }

  const error = parsed.data && typeof parsed.data === 'object'
    ? (parsed.data as { error?: unknown }).error
    : undefined;
  throw new Error(
    typeof error === 'string'
      ? error
      : 'get_sector_index did not return a sector-index source result.',
  );
}

async function fetchInvestorTypeCalendar(from: string | undefined) {
  if (!from) return [];
  const rows = await jquantsGetAll<JQuantsCalendarRow>('/markets/calendar', { from });
  return rows.map((row) => ({
    date: row.Date,
    holidayDivision: row.HolDiv,
  }));
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
Calculate technical results from chronological adjusted OHLCV bars. Returns the fixed MVP SMA20, ATR14, average volume, Swing High/Low, trend, data date, and unavailable metrics, plus an advancedTechnical companion with RSI14, MACD 12/26/9, and Bollinger Bands 20/2σ. All calculations are deterministic; do not calculate these values in the model.
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
    return formatToolResult({
      ...analyzeTechnical(bars),
      advancedTechnical: analyzeAdvancedTechnical(bars),
    }, []);
  },
});

export const ANALYZE_SUPPLY_DEMAND_DESCRIPTION = `
Calculate deterministic Japanese margin supply-demand statistics from chronological weekly margin balances and daily volume. Returns margin ratio, weekly changes, 4/13/52-week statistics, percentile, digestion days, data dates, and explicit unavailable metrics.
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

export const ANALYZE_REPORTED_SHORT_POSITIONS_DESCRIPTION = `
Apply the disclosure-date as-of boundary and calculate source-provided previous-ratio deltas for public short-position reports. Reports remain separate by reporter and fund; no issue-level total, identity matching, forward fill, or signal is inferred. J-Quants publishes these reports at the 0.5% threshold, and no_public_disclosure_data does not mean a zero short position.
`.trim();

export const analyzeReportedShortPositionsTool = new DynamicStructuredTool({
  name: 'analyze_reported_short_positions',
  description: ANALYZE_REPORTED_SHORT_POSITIONS_DESCRIPTION,
  schema: z.object({
    ticker: z.string().optional().describe(
      'Ticker to fetch directly, or to attribute supplied source reports to the active analysis.',
    ),
    analysisAsOfDate: z.string().describe(
      'Analysis availability boundary. Only reports disclosed on or before this date are used.',
    ),
    sourceReports: z.array(shortSaleReportSourceRowSchema).optional().describe(
      'Source-level rows from get_short_sale_reports. Preserve report identity strings and nulls.',
    ),
  }),
  func: async ({ ticker, analysisAsOfDate, sourceReports }) => {
    if (!sourceReports) {
      if (!ticker) {
        throw new Error(
          'analyze_reported_short_positions requires sourceReports or ticker.',
        );
      }
      sourceReports = parseShortSaleReports(await getShortSaleReports.invoke({
        ticker,
        disclosedTo: analysisAsOfDate,
      }));
    }
    return formatToolResult(
      analyzeReportedShortPositions(sourceReports, analysisAsOfDate),
      [],
    );
  },
});

export const ANALYZE_INVESTOR_TYPE_FLOWS_DESCRIPTION = `
Select and validate the latest correction-resolved Tokyo/Nagoya weekly investor-type trading-value period at an explicit as-of date. Uses official J-Quants calendar rows for correction availability. Values remain source-provided in thousand JPY; no category aggregation, ratio, rank, threshold, issuer attribution, forward fill, or signal is added.
`.trim();

export const analyzeInvestorTypeFlowsTool = new DynamicStructuredTool({
  name: 'analyze_investor_type_flows',
  description: ANALYZE_INVESTOR_TYPE_FLOWS_DESCRIPTION,
  schema: z.object({
    ticker: z.string().optional().describe(
      'Verified target ticker used only to attribute this market-context result to the active analysis.',
    ),
    analysisAsOfDate: z.string().describe(
      'Date-only availability boundary for publication and correction-vintage selection.',
    ),
    sourcePeriods: z.array(investorTypeFlowSourceRowSchema).optional().describe(
      'Optional source rows from get_investor_type_flows. Preserve every category and source value.',
    ),
    officialCalendar: z.array(investorTypeCalendarDaySchema).optional().describe(
      'Optional official J-Quants calendar rows mapped to date and holidayDivision.',
    ),
  }),
  func: async ({ analysisAsOfDate, sourcePeriods, officialCalendar }) => {
    if (!sourcePeriods) {
      sourcePeriods = parseInvestorTypeFlows(await getInvestorTypeFlows.invoke({
        section: 'TokyoNagoya',
        to: analysisAsOfDate,
      }));
    }
    if (!officialCalendar) {
      const earliestPublication = sourcePeriods
        .map((period) => period.publishedDate)
        .sort()
        .at(0);
      officialCalendar = await fetchInvestorTypeCalendar(earliestPublication);
    }
    return formatToolResult(
      analyzeInvestorTypeFlows(sourcePeriods, officialCalendar, analysisAsOfDate),
      [],
    );
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
Calculate deterministic 20-day, 60-day, and 250-day stock-versus-TOPIX return statistics. Dates are inner-joined, missing dates are never forward-filled, and insufficient history or zero variance is reported explicitly.
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

export const ANALYZE_SECTOR_BENCHMARK_DESCRIPTION = `
Calculate deterministic 20-day, 60-day, and 250-day stock-versus-TSE-33-sector return statistics. The benchmark is the single official sector resolved at analysisAsOfDate; dates are inner-joined without forward fill and sector indices are never stitched across a classification change.
`.trim();

export const analyzeSectorBenchmarkTool = new DynamicStructuredTool({
  name: 'analyze_sector_benchmark',
  description: ANALYZE_SECTOR_BENCHMARK_DESCRIPTION,
  schema: z.object({
    ticker: z.string().describe(
      'Verified target ticker used to resolve or attribute the as-of sector benchmark.',
    ),
    analysisAsOfDate: z.string().describe(
      'Inclusive date-only boundary for classification and price observations.',
    ),
    from: z.string().optional().describe(
      'History start date required when adjusted stock closes must be fetched directly.',
    ),
    stockPrices: z.array(marketPricePointSchema).optional().describe(
      'Optional chronological adjusted stock closes from get_stock_price.',
    ),
    sectorSource: sectorBenchmarkInputSchema.optional().describe(
      'Optional structured output from get_sector_index, including a typed unavailable state.',
    ),
  }),
  func: async ({ ticker, analysisAsOfDate, from, stockPrices, sectorSource }) => {
    if (sectorSource && sectorSource.analysisAsOfDate !== analysisAsOfDate) {
      throw new Error('sectorSource analysisAsOfDate must match analysisAsOfDate.');
    }

    if (sectorSource && 'reason' in sectorSource) {
      return formatToolResult(
        analyzeSectorBenchmark(stockPrices ?? [], sectorSource),
        [],
      );
    }

    if (sectorSource && 'classification' in sectorSource) {
      const issuerCode = toJQuantsSecuritiesCode(ticker);
      if (sectorSource.classification.issuerCode !== issuerCode) {
        throw new Error('sectorSource issuerCode must match ticker.');
      }
    }

    const stockFrom = from;
    const fetchMissingStockHistory = () => {
      if (!stockFrom) {
        throw new Error(
          'analyze_sector_benchmark requires stockPrices or ticker history from.',
        );
      }
      return fetchStockHistory(ticker, stockFrom, analysisAsOfDate);
    };

    const sectorFrom = from ?? stockPrices?.at(0)?.date;
    if (!stockPrices && !sectorSource) {
      const [fetchedStock, fetchedSector] = await Promise.all([
        fetchMissingStockHistory(),
        getSectorIndex.invoke({ ticker, analysisAsOfDate, from: sectorFrom }),
      ]);
      stockPrices = fetchedStock.map(({ date, close }) => ({ date, close }));
      sectorSource = parseSectorIndexSource(fetchedSector, analysisAsOfDate);
    } else if (!stockPrices) {
      const fetchedStock = await fetchMissingStockHistory();
      stockPrices = fetchedStock.map(({ date, close }) => ({ date, close }));
    } else if (!sectorSource) {
      sectorSource = parseSectorIndexSource(
        await getSectorIndex.invoke({ ticker, analysisAsOfDate, from: sectorFrom }),
        analysisAsOfDate,
      );
    }

    if (!stockPrices || !sectorSource) {
      throw new Error('analyze_sector_benchmark could not resolve complete inputs.');
    }
    return formatToolResult(analyzeSectorBenchmark(stockPrices, sectorSource), []);
  },
});

export const ANALYZE_SECTOR_SHORT_RATIO_DESCRIPTION = `
Calculate the daily TSE 33-sector short-selling turnover total and ratio from the three official J-Quants JPY source values. This is sector-wide flow context, not an issuer position. Source observations remain separate with no forward fill, aggregation across sectors, baseline statistic, threshold, squeeze label, score, or signal.
`.trim();

export const analyzeSectorShortRatioTool = new DynamicStructuredTool({
  name: 'analyze_sector_short_ratio',
  description: ANALYZE_SECTOR_SHORT_RATIO_DESCRIPTION,
  schema: z.object({
    ticker: z.string().describe(
      'Verified target ticker used only to resolve or attribute the as-of sector context.',
    ),
    analysisAsOfDate: z.string().describe(
      'Inclusive date-only end-of-day eligibility boundary.',
    ),
    from: z.string().optional().describe(
      'History start date required when source rows must be fetched directly.',
    ),
    classification: sectorShortRatioClassificationSchema.optional().describe(
      'Optional authoritative identity from get_sector_index or analyze_sector_benchmark.',
    ),
    sectorSource: sectorShortRatioSourceSchema.optional().describe(
      'Optional structured output from get_sector_short_ratio, including typed unavailable state.',
    ),
  }),
  func: async ({ ticker, analysisAsOfDate, from, classification, sectorSource }) => {
    if (sectorSource && sectorSource.analysisAsOfDate !== analysisAsOfDate) {
      throw new Error('sectorSource analysisAsOfDate must match analysisAsOfDate.');
    }
    if (!sectorSource) {
      if (!from) {
        throw new Error('analyze_sector_short_ratio requires sectorSource or history from.');
      }
      sectorSource = await fetchSectorShortRatioSource({
        ticker,
        analysisAsOfDate,
        from,
        classification,
      });
    }
    return formatToolResult(
      analyzeSectorShortRatio(sectorSource as SectorShortRatioSource),
      [],
    );
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
  analyzeReportedShortPositionsTool,
  analyzeInvestorTypeFlowsTool,
  analyzePeerComparisonTool,
  analyzeMarketCorrelationTool,
  analyzeSectorBenchmarkTool,
  analyzeSectorShortRatioTool,
  analyzeStrategyTool,
] as const;
