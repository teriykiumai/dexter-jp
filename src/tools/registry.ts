import { StructuredToolInterface } from '@langchain/core/tools';
import {
  ANALYZE_FINANCIAL_METRICS_DESCRIPTION,
  ANALYZE_MARKET_CORRELATION_DESCRIPTION,
  ANALYZE_PEER_COMPARISON_DESCRIPTION,
  ANALYZE_REPORTED_SHORT_POSITIONS_DESCRIPTION,
  ANALYZE_STRATEGY_DESCRIPTION,
  ANALYZE_SUPPLY_DEMAND_DESCRIPTION,
  ANALYZE_TECHNICAL_DESCRIPTION,
  analyzeFinancialMetricsTool,
  analyzeMarketCorrelationTool,
  analyzePeerComparisonTool,
  analyzeReportedShortPositionsTool,
  analyzeStrategyTool,
  analyzeSupplyDemandTool,
  analyzeTechnicalTool,
  createGetFinancials,
  createReadFilings,
  createScreenCompanies,
  getMarginData,
  getShortSaleReports,
  getStockPrice,
  getTopix,
  isJQuantsAvailable,
  MARGIN_DATA_DESCRIPTION,
  SHORT_SALE_REPORT_DESCRIPTION,
  STOCK_PRICE_DESCRIPTION,
  TOPIX_DESCRIPTION,
} from './finance/index.js';
import { exaSearch, perplexitySearch, tavilySearch, langSearch, WEB_SEARCH_DESCRIPTION, xSearchTool, X_SEARCH_DESCRIPTION } from './search/index.js';
import { createWebSearchTool, type WebSearchProvider } from './search/web-search.js';
import { getSetting } from '../utils/config.js';
import type { SearchProviderId } from '../utils/env.js';
import { skillTool, SKILL_TOOL_DESCRIPTION } from './skill.js';
import { createWebFetch, WEB_FETCH_DESCRIPTION } from './fetch/web-fetch.js';
import { browserTool, BROWSER_DESCRIPTION } from './browser/browser.js';
import { readFileTool, READ_FILE_DESCRIPTION } from './filesystem/read-file.js';
import { writeFileTool, WRITE_FILE_DESCRIPTION } from './filesystem/write-file.js';
import { editFileTool, EDIT_FILE_DESCRIPTION } from './filesystem/edit-file.js';
import { GET_FINANCIALS_DESCRIPTION } from './finance/get-financials.js';
import { READ_FILINGS_DESCRIPTION } from './finance/read-filings.js';
import { SCREEN_COMPANIES_DESCRIPTION } from './finance/screen-companies.js';
import { heartbeatTool, HEARTBEAT_TOOL_DESCRIPTION } from './heartbeat/heartbeat-tool.js';
import { cronTool, CRON_TOOL_DESCRIPTION } from './cron/cron-tool.js';
import { memoryGetTool, MEMORY_GET_DESCRIPTION, memorySearchTool, MEMORY_SEARCH_DESCRIPTION, memoryUpdateTool, MEMORY_UPDATE_DESCRIPTION } from './memory/index.js';
import { discoverSkills } from '../skills/index.js';
import { createSpawnSubagent, SPAWN_SUBAGENT_DESCRIPTION } from './subagent/spawn-subagent.js';
import { createAskUserQuestion, ASK_USER_QUESTION_DESCRIPTION } from './ask-user-question/ask-user-question.js';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
  /** 1-2 sentence description for token-optimized system prompts. */
  compactDescription: string;
  /** Whether this tool can safely execute concurrently with other concurrent-safe tools. */
  concurrencySafe: boolean;
}

/**
 * Get all registered tools with their descriptions.
 * Conditionally includes tools based on environment configuration.
 *
 * @param model - The model name (needed for tools that require model-specific configuration)
 * @returns Array of registered tools
 */
export function getToolRegistry(model: string): RegisteredTool[] {
  const isPublicGateway = process.env.DEXTER_PUBLIC_GATEWAY === '1';

  const tools: RegisteredTool[] = [
    {
      name: 'get_financials',
      tool: createGetFinancials(model),
      description: GET_FINANCIALS_DESCRIPTION,
      compactDescription: 'Japanese company financials, metrics, earnings, and AI analysis. Handles multi-company/multi-metric queries in one call.',
      concurrencySafe: true,
    },
    {
      name: 'read_filings',
      tool: createReadFilings(model),
      description: READ_FILINGS_DESCRIPTION,
      compactDescription: 'Japanese securities report text (事業の状況, リスク, MD&A) and shareholder data (大量保有報告書).',
      concurrencySafe: true,
    },
    {
      name: 'company_screener',
      tool: createScreenCompanies(model),
      description: SCREEN_COMPANIES_DESCRIPTION,
      compactDescription: 'Screen Japanese listed companies by financial criteria (PER, ROE, growth, margins, etc.).',
      concurrencySafe: true,
    },
    {
      name: 'ask_user_question',
      tool: createAskUserQuestion(),
      description: ASK_USER_QUESTION_DESCRIPTION,
      compactDescription: 'Ask the user 1-4 multiple-choice questions mid-turn and wait for their answers. CLI only.',
      concurrencySafe: false,
    },
    {
      name: 'web_fetch',
      tool: createWebFetch(model),
      description: WEB_FETCH_DESCRIPTION,
      compactDescription: 'Fetch and extract content from a URL as markdown. Use when you need full article text beyond headlines.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_financial_metrics',
      tool: analyzeFinancialMetricsTool,
      description: ANALYZE_FINANCIAL_METRICS_DESCRIPTION,
      compactDescription: 'Deterministic current PER, PBR, dividend yield, and revenue CAGR from sourced price and financial history.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_technical',
      tool: analyzeTechnicalTool,
      description: ANALYZE_TECHNICAL_DESCRIPTION,
      compactDescription: 'Deterministic SMA20, ATR14, Swing High/Low, trend, and average-volume calculations from chronological OHLCV.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_supply_demand',
      tool: analyzeSupplyDemandTool,
      description: ANALYZE_SUPPLY_DEMAND_DESCRIPTION,
      compactDescription: 'Deterministic Japanese margin-balance statistics and digestion days from margin and volume histories.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_reported_short_positions',
      tool: analyzeReportedShortPositionsTool,
      description: ANALYZE_REPORTED_SHORT_POSITIONS_DESCRIPTION,
      compactDescription: 'Deterministic disclosure-date filtering and source-provided ratio deltas for public short-position reports.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_peer_comparison',
      tool: analyzePeerComparisonTool,
      description: ANALYZE_PEER_COMPARISON_DESCRIPTION,
      compactDescription: 'Deterministic same-sector peer selection, median, rank, and directional percentile from sourced company metrics.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_market_correlation',
      tool: analyzeMarketCorrelationTool,
      description: ANALYZE_MARKET_CORRELATION_DESCRIPTION,
      compactDescription: 'Deterministic 60/250-day stock-versus-TOPIX correlation, beta, alpha, R², volatility, and excess return.',
      concurrencySafe: true,
    },
    {
      name: 'analyze_strategy',
      tool: analyzeStrategyTool,
      description: ANALYZE_STRATEGY_DESCRIPTION,
      compactDescription: 'Deterministic Swing breakout Entry, Swing/ATR Stops, 2R Targets, and reward/risk from technical results.',
      concurrencySafe: true,
    },
  ];

  // Tools excluded in public gateway mode (security + Gemini z.literal() incompatibility)
  if (!isPublicGateway) {
    tools.push(
      {
        name: 'spawn_subagent',
        tool: createSpawnSubagent(model),
        description: SPAWN_SUBAGENT_DESCRIPTION,
        compactDescription: 'Delegate a focused sub-task to an isolated subagent. Emit multiple calls in one turn to run independent sub-tasks in parallel.',
        concurrencySafe: true,
      },
      {
        name: 'browser',
        tool: browserTool,
        description: BROWSER_DESCRIPTION,
        compactDescription: 'JavaScript-rendered pages and interactive navigation. Actions: navigate, snapshot, act, read, close.',
        concurrencySafe: true,
      },
      {
        name: 'read_file',
        tool: readFileTool,
        description: READ_FILE_DESCRIPTION,
        compactDescription: 'Read a local file by path. Returns file content as text.',
        concurrencySafe: true,
      },
      {
        name: 'write_file',
        tool: writeFileTool,
        description: WRITE_FILE_DESCRIPTION,
        compactDescription: 'Create or overwrite a file. Requires user approval.',
        concurrencySafe: false,
      },
      {
        name: 'edit_file',
        tool: editFileTool,
        description: EDIT_FILE_DESCRIPTION,
        compactDescription: 'Edit a file by replacing text. Requires user approval.',
        concurrencySafe: false,
      },
      {
        name: 'heartbeat',
        tool: heartbeatTool,
        description: HEARTBEAT_TOOL_DESCRIPTION,
        compactDescription: 'View or update the periodic heartbeat checklist (.dexter/HEARTBEAT.md).',
        concurrencySafe: true,
      },
      {
        name: 'cron',
        tool: cronTool,
        description: CRON_TOOL_DESCRIPTION,
        compactDescription: 'Manage scheduled cron jobs (create, list, update, delete).',
        concurrencySafe: true,
      },
      {
        name: 'memory_search',
        tool: memorySearchTool,
        description: MEMORY_SEARCH_DESCRIPTION,
        compactDescription: 'Search persistent memory and past conversations for stored facts and preferences.',
        concurrencySafe: true,
      },
      {
        name: 'memory_get',
        tool: memoryGetTool,
        description: MEMORY_GET_DESCRIPTION,
        compactDescription: 'Read specific memory file sections by line range.',
        concurrencySafe: true,
      },
      {
        name: 'memory_update',
        tool: memoryUpdateTool,
        description: MEMORY_UPDATE_DESCRIPTION,
        compactDescription: 'Add, edit, or delete persistent memory entries.',
        concurrencySafe: false,
      },
    );
  }

  // Include J-Quants market data tools when an API key is configured.
  if (isJQuantsAvailable()) {
    tools.push(
      {
        name: 'get_stock_price',
        tool: getStockPrice,
        description: STOCK_PRICE_DESCRIPTION,
        compactDescription: 'Japanese stock price OHLC and volume from J-Quants (TSE official data).',
        concurrencySafe: true,
      },
      {
        name: 'get_margin_data',
        tool: getMarginData,
        description: MARGIN_DATA_DESCRIPTION,
        compactDescription: 'Weekly Japanese stock margin trading balances from J-Quants (Standard plan or higher).',
        concurrencySafe: true,
      },
      {
        name: 'get_short_sale_reports',
        tool: getShortSaleReports,
        description: SHORT_SALE_REPORT_DESCRIPTION,
        compactDescription: 'Public Japanese stock short-position reports from J-Quants (Standard plan or higher).',
        concurrencySafe: true,
      },
      {
        name: 'get_topix',
        tool: getTopix,
        description: TOPIX_DESCRIPTION,
        compactDescription: 'Daily TOPIX benchmark OHLC from J-Quants (Light plan or higher).',
        concurrencySafe: true,
      },
    );
  }

  // Build web_search as a fallback chain over whichever providers have keys configured.
  // The user's preferred provider (set via /search) is tried first; the others act as fallbacks.
  const allWebSearchProviders: WebSearchProvider[] = [];
  if (process.env.EXASEARCH_API_KEY) {
    allWebSearchProviders.push({ id: 'exa', name: 'Exa', tool: exaSearch });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    allWebSearchProviders.push({ id: 'perplexity', name: 'Perplexity', tool: perplexitySearch });
  }
  if (process.env.TAVILY_API_KEY) {
    allWebSearchProviders.push({ id: 'tavily', name: 'Tavily', tool: tavilySearch });
  }
  if (process.env.LANGSEARCH_API_KEY) {
    allWebSearchProviders.push({ id: 'langsearch', name: 'LangSearch', tool: langSearch });
  }

  if (allWebSearchProviders.length > 0) {
    const preferred = getSetting<SearchProviderId | undefined>('webSearchPreferredProvider', undefined);
    const orderedProviders = preferred
      ? [
          ...allWebSearchProviders.filter((p) => p.id === preferred),
          ...allWebSearchProviders.filter((p) => p.id !== preferred),
        ]
      : allWebSearchProviders;

    tools.push({
      name: 'web_search',
      tool: createWebSearchTool(orderedProviders),
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns titles, URLs, and snippets.',
      concurrencySafe: true,
    });
  }

  // Include x_search if X Bearer Token is configured
  if (process.env.X_BEARER_TOKEN) {
    tools.push({
      name: 'x_search',
      tool: xSearchTool,
      description: X_SEARCH_DESCRIPTION,
      compactDescription: 'Search X/Twitter for tweets, profiles, and threads.',
      concurrencySafe: true,
    });
  }

  const availableSkills = discoverSkills();
  if (availableSkills.length > 0) {
    tools.push({
      name: 'skill',
      tool: skillTool,
      description: SKILL_TOOL_DESCRIPTION,
      compactDescription: 'Invoke a specialized skill workflow (e.g., DCF valuation).',
      concurrencySafe: false,
    });
  }

  return tools;
}

/**
 * Build a name → concurrencySafe map for the tool executor.
 */
export function getToolConcurrencyMap(model: string): Map<string, boolean> {
  return new Map(getToolRegistry(model).map(t => [t.name, t.concurrencySafe]));
}

/**
 * Get just the tool instances for binding to the LLM.
 */
export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((t) => t.tool);
}

/**
 * Build compact tool descriptions for token-optimized system prompts.
 * Uses 1-2 sentence descriptions instead of full multi-paragraph ones.
 * The LLM already has full tool schemas via bindTools().
 */
export function buildCompactToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((t) => `- **${t.name}**: ${t.compactDescription}`)
    .join('\n');
}
