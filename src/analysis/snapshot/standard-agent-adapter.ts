import { z } from 'zod';
import type {
  ToolDeniedEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ToolStartEvent,
} from '../../agent/types.js';
import { buildAnalysisSnapshot } from './builder.js';
import {
  AdvancedTechnicalResultSchema,
  CompanyIdentitySchema,
  FinancialMetricsResultSchema,
  FundamentalSnapshotSchema,
  MarketCorrelationResultSchema,
  PeerComparisonResultSchema,
  PriceHistorySchema,
  ReportedShortPositionResultSchema,
  StrategyResultSchema,
  SupplyDemandResultV3Schema,
  TechnicalResultSchema,
  normalizeCanonicalTicker,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotInput,
  type CompanyIdentity,
  type FundamentalSnapshot,
  type SnapshotUnavailableV4,
} from './schema.js';

const trackedToolNames = [
  'skill',
  'get_financials',
  'company_screener',
  'get_stock_price',
  'analyze_financial_metrics',
  'analyze_technical',
  'analyze_supply_demand',
  'analyze_reported_short_positions',
  'analyze_peer_comparison',
  'analyze_market_correlation',
  'analyze_strategy',
] as const;

type TrackedToolName = (typeof trackedToolNames)[number];

const trackedToolNameSet = new Set<string>(trackedToolNames);
const tickerArgsSchema = z.object({ ticker: z.string().min(1) }).passthrough();
const peerCompanyMarketCapArgsSchema = z.object({
  id: z.string().min(1),
  marketCap: z.number().finite().nullable().optional(),
}).passthrough();
const startArgsSchemas: Record<TrackedToolName, z.ZodType<Record<string, unknown>>> = {
  skill: z.object({ skill: z.string().min(1), args: z.string().optional() }).passthrough(),
  get_financials: z.object({ query: z.string().min(1) }).passthrough(),
  company_screener: z.object({ query: z.string().min(1) }).passthrough(),
  get_stock_price: tickerArgsSchema,
  analyze_financial_metrics: tickerArgsSchema,
  analyze_technical: tickerArgsSchema,
  analyze_supply_demand: tickerArgsSchema,
  analyze_reported_short_positions: z.object({
    ticker: z.string().min(1),
    analysisAsOfDate: z.string().min(1),
  }).passthrough(),
  analyze_peer_comparison: z.object({
    target: peerCompanyMarketCapArgsSchema,
    candidates: z.array(peerCompanyMarketCapArgsSchema),
  }).passthrough(),
  analyze_market_correlation: tickerArgsSchema,
  analyze_strategy: tickerArgsSchema,
};

const toolEnvelopeSchema = z.object({
  data: z.unknown(),
  sourceUrls: z.array(z.string().min(1)).optional(),
});

const analyzeTechnicalResultSchema = TechnicalResultSchema.extend({
  advancedTechnical: AdvancedTechnicalResultSchema.optional(),
});

const companyScreenerResultSchema = z.object({
  companies: z.array(z.record(z.string(), z.unknown())).optional(),
  data: z.object({
    companies: z.array(z.record(z.string(), z.unknown())),
  }).passthrough().optional(),
}).passthrough().refine(value => Boolean(value.companies ?? value.data?.companies), {
  message: 'company_screener result requires a companies array.',
});

const companyInfoSourceSchema = z.object({
  sec_code: z.string().min(1),
  name_ja: z.string().min(1).nullable().optional(),
  name: z.string().min(1).nullable().optional(),
  industry: z.string().min(1).nullable().optional(),
  listing_status: z.string().min(1).nullable().optional(),
  is_delisted: z.boolean().nullable().optional(),
  listing_status_as_of: z.string().min(1).nullable().optional(),
}).passthrough().refine(value => Boolean(value.name_ja ?? value.name), {
  message: 'Company identity requires name_ja or name.',
});

const financialRowSourceSchema = z.object({
  fiscal_year: z.number().int(),
  submit_date: z.string().min(1).nullable().optional(),
  revenue: z.number().finite().nullable().optional(),
  operating_income: z.number().finite().nullable().optional(),
  ordinary_income: z.number().finite().nullable().optional(),
  net_income: z.number().finite().nullable().optional(),
  adjusted_eps: z.number().finite().nullable().optional(),
  eps: z.number().finite().nullable().optional(),
  roe_official: z.number().finite().nullable().optional(),
  roe: z.number().finite().nullable().optional(),
  equity_ratio_official: z.number().finite().nullable().optional(),
  equity_ratio: z.number().finite().nullable().optional(),
  cf_operating: z.number().finite().nullable().optional(),
  operating_cash_flow: z.number().finite().nullable().optional(),
  free_cash_flow: z.number().finite().nullable().optional(),
}).passthrough();

interface PendingToolCall {
  tool: TrackedToolName;
  validatedArgs: Record<string, unknown>;
}

interface ValidatedToolCall extends PendingToolCall {
  validatedResult: unknown;
  sourceUrls: string[];
}

export interface SnapshotCollectorRejection {
  toolCallId: string | null;
  tool: string;
  reason: string;
}

function parseToolResult(result: string): { data: unknown; sourceUrls: string[] } {
  const parsed = toolEnvelopeSchema.parse(JSON.parse(result));
  return { data: parsed.data, sourceUrls: parsed.sourceUrls ?? [] };
}

function candidateFinancialRows(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['financials', 'data', 'results']) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return null;
}

function mapFundamental(rows: unknown[], sourceUrls: string[]): FundamentalSnapshot {
  const periods = rows.map(row => {
    const parsed = financialRowSourceSchema.parse(row);
    return {
      fiscalYear: parsed.fiscal_year,
      submitDate: parsed.submit_date ?? null,
      revenue: parsed.revenue ?? null,
      operatingIncome: parsed.operating_income ?? null,
      ordinaryIncome: parsed.ordinary_income ?? null,
      netIncome: parsed.net_income ?? null,
      eps: parsed.adjusted_eps ?? parsed.eps ?? null,
      roe: parsed.roe_official ?? parsed.roe ?? null,
      equityRatio: parsed.equity_ratio_official ?? parsed.equity_ratio ?? null,
      operatingCashFlow: parsed.cf_operating ?? parsed.operating_cash_flow ?? null,
      freeCashFlow: parsed.free_cash_flow ?? null,
    };
  }).sort((left, right) => left.fiscalYear - right.fiscalYear);

  return FundamentalSnapshotSchema.parse({ periods, sourceUrls });
}

export class StandardAgentSnapshotCollector {
  private readonly pendingCalls = new Map<string, PendingToolCall>();
  private readonly deferredTargetCalls: ValidatedToolCall[] = [];
  private readonly rejectionValues: SnapshotCollectorRejection[] = [];
  private comprehensiveAnalysisObserved = false;
  private identity: CompanyIdentity | null = null;
  private fundamental: FundamentalSnapshot | null = null;
  private valuation: AnalysisSnapshotInput['valuation'] = null;
  private peerComparison: AnalysisSnapshotInput['peerComparison'] = null;
  private peerCandidateMarketCapsComplete: boolean | null = null;
  private technical: AnalysisSnapshotInput['technical'] = null;
  private advancedTechnical: AnalysisSnapshotInput['advancedTechnical'] = null;
  private supplyDemand: AnalysisSnapshotInput['supplyDemand'] = null;
  private reportedShortPositions: AnalysisSnapshotInput['reportedShortPositions'] = null;
  private marketCorrelation: AnalysisSnapshotInput['marketCorrelation'] = null;
  private strategy: AnalysisSnapshotInput['strategy'] = null;
  private priceHistory: AnalysisSnapshotInput['priceHistory'] = null;
  private priceSourceUrls: string[] = [];
  private peerSourceUrls: string[] = [];
  private reportedShortPositionSourceUrls: string[] = [];
  private technicalUsesDirectJQuants = false;
  private supplyDemandMarginUsesDirectJQuants = false;
  private supplyDemandVolumeUsesDirectJQuants = false;
  private reportedShortPositionsUseDirectJQuants = false;
  private correlationStockUsesDirectJQuants = false;
  private correlationBenchmarkUsesDirectJQuants = false;
  private readonly additionalUnavailable: SnapshotUnavailableV4[] = [];

  get canonicalTicker(): string | null {
    return this.identity?.canonicalTicker ?? null;
  }

  get rejections(): readonly SnapshotCollectorRejection[] {
    return this.rejectionValues;
  }

  recordToolStart(event: ToolStartEvent): void {
    if (!trackedToolNameSet.has(event.tool)) return;
    if (!event.toolCallId) {
      this.reject(null, event.tool, 'missing_tool_call_id');
      return;
    }

    const tool = event.tool as TrackedToolName;
    const parsed = startArgsSchemas[tool].safeParse(event.args);
    if (!parsed.success) {
      this.reject(event.toolCallId, tool, 'invalid_tool_args');
      return;
    }
    if (this.pendingCalls.has(event.toolCallId)) {
      this.reject(event.toolCallId, tool, 'duplicate_tool_call_id');
      return;
    }
    this.pendingCalls.set(event.toolCallId, { tool, validatedArgs: parsed.data });
  }

  recordToolEnd(event: ToolEndEvent): void {
    if (!trackedToolNameSet.has(event.tool)) return;
    if (!event.toolCallId) {
      this.reject(null, event.tool, 'missing_tool_call_id');
      return;
    }

    const started = this.pendingCalls.get(event.toolCallId);
    this.pendingCalls.delete(event.toolCallId);
    if (!started) {
      this.reject(event.toolCallId, event.tool, 'unpaired_tool_end');
      return;
    }
    if (started.tool !== event.tool) {
      this.reject(event.toolCallId, event.tool, 'tool_name_mismatch');
      return;
    }

    try {
      if (started.tool === 'skill') {
        if (event.result.startsWith('Error:')) throw new Error('Skill invocation failed.');
        this.accept({ ...started, validatedResult: event.result, sourceUrls: [] });
        return;
      }
      const { data, sourceUrls } = parseToolResult(event.result);
      this.accept({ ...started, validatedResult: data, sourceUrls });
    } catch {
      this.reject(event.toolCallId, event.tool, 'invalid_tool_result');
    }
  }

  recordToolFailure(event: ToolErrorEvent | ToolDeniedEvent): void {
    if (!trackedToolNameSet.has(event.tool)) return;
    if (event.toolCallId) this.pendingCalls.delete(event.toolCallId);
  }

  finalize(finalReportMarkdown: string, generatedAt = new Date().toISOString()): AnalysisSnapshotV4 | null {
    if (!this.comprehensiveAnalysisObserved || !this.identity || finalReportMarkdown.length === 0) {
      return null;
    }

    return buildAnalysisSnapshot({
      identity: this.identity,
      generatedAt,
      fundamental: this.fundamental,
      valuation: this.valuation,
      peerComparison: this.peerComparison,
      peerCandidateMarketCapsComplete: this.peerCandidateMarketCapsComplete,
      technical: this.technical,
      advancedTechnical: this.advancedTechnical,
      supplyDemand: this.supplyDemand,
      reportedShortPositions: this.reportedShortPositions,
      marketCorrelation: this.marketCorrelation,
      strategy: this.strategy,
      priceHistory: this.priceHistory,
      scenarios: null,
      risks: null,
      finalReportMarkdown,
      priceSourceUrls: this.priceSourceUrls,
      peerSourceUrls: this.peerSourceUrls,
      reportedShortPositionSourceUrls: this.reportedShortPositionSourceUrls,
      sourceUsage: {
        valuation: {
          priceFromJQuants: this.priceHistory !== null,
          financialsFromEdinetDb: this.fundamental !== null,
        },
        technical: {
          priceFromJQuants: this.technicalUsesDirectJQuants || this.priceHistory !== null,
        },
        supplyDemand: {
          marginFromJQuants: this.supplyDemandMarginUsesDirectJQuants,
          volumeFromJQuants: this.supplyDemandVolumeUsesDirectJQuants || this.priceHistory !== null,
        },
        marketCorrelation: {
          stockFromJQuants: this.correlationStockUsesDirectJQuants || this.priceHistory !== null,
          benchmarkFromJQuants: this.correlationBenchmarkUsesDirectJQuants,
        },
        reportedShortPositions: {
          sourceFromJQuants: this.reportedShortPositionsUseDirectJQuants,
        },
      },
      additionalUnavailable: this.additionalUnavailable,
    });
  }

  private accept(call: ValidatedToolCall): void {
    if (call.tool === 'skill') {
      const skill = call.validatedArgs.skill;
      if (skill === 'comprehensive-analysis') this.comprehensiveAnalysisObserved = true;
      return;
    }

    if (call.tool === 'get_financials') {
      this.acceptFinancials(call);
      return;
    }

    if (call.tool === 'company_screener') {
      companyScreenerResultSchema.parse(call.validatedResult);
      this.peerSourceUrls = [...new Set([...this.peerSourceUrls, ...call.sourceUrls])];
      return;
    }

    if (!this.identity) {
      this.deferredTargetCalls.push(call);
      return;
    }
    this.acceptTargetCall(call);
  }

  private acceptFinancials(call: ValidatedToolCall): void {
    if (!call.validatedResult || typeof call.validatedResult !== 'object') {
      throw new Error('Invalid get_financials result.');
    }

    const result = call.validatedResult as Record<string, unknown>;
    const companyEntries = Object.entries(result).filter(([key]) => key.startsWith('get_company_info'));
    if (companyEntries.length !== 1) {
      throw new Error('Expected exactly one verified company identity.');
    }

    const [, rawCompany] = companyEntries[0];
    const company = companyInfoSourceSchema.parse(rawCompany);
    const canonicalTicker = normalizeCanonicalTicker(company.sec_code);
    if (this.identity && this.identity.canonicalTicker !== canonicalTicker) {
      this.reject(null, call.tool, 'locked_ticker_mismatch');
      return;
    }

    const identity = CompanyIdentitySchema.parse({
      canonicalTicker,
      companyName: company.name_ja ?? company.name,
      industry: company.industry ?? null,
      listingStatus: company.listing_status ?? null,
      isDelisted: company.is_delisted ?? null,
      dataDate: company.listing_status_as_of ?? null,
      sourceUrls: call.sourceUrls,
    });

    const financialEntries = Object.entries(result).filter(([key]) => (
      key.startsWith('get_financial_statements')
    ));
    const financialEntry = financialEntries.find(([key]) => {
      if (!key.startsWith('get_financial_statements')) return false;
      const suffix = key.slice('get_financial_statements_'.length);
      try {
        return suffix.length === 0 || normalizeCanonicalTicker(suffix) === canonicalTicker;
      } catch {
        return false;
      }
    }) ?? (financialEntries.length === 1 ? financialEntries[0] : undefined);
    const rows = financialEntry ? candidateFinancialRows(financialEntry[1]) : null;
    const fundamental = rows && rows.length > 0
      ? mapFundamental(rows, call.sourceUrls)
      : null;

    if (!this.identity) this.identity = identity;
    if (!this.fundamental && fundamental) this.fundamental = fundamental;

    if (this.deferredTargetCalls.length > 0) {
      const deferred = this.deferredTargetCalls.splice(0);
      for (const deferredCall of deferred) this.acceptTargetCall(deferredCall);
    }
  }

  private acceptTargetCall(call: ValidatedToolCall): void {
    if (!this.identity) return;

    let rawTicker: unknown;
    if (call.tool === 'analyze_peer_comparison') {
      const target = call.validatedArgs.target as { id: string };
      rawTicker = target.id;
    } else {
      rawTicker = call.validatedArgs.ticker;
    }

    let toolTicker: string;
    try {
      toolTicker = normalizeCanonicalTicker(String(rawTicker));
    } catch {
      this.reject(null, call.tool, 'invalid_target_ticker');
      return;
    }
    if (toolTicker !== this.identity.canonicalTicker) {
      this.reject(null, call.tool, 'locked_ticker_mismatch');
      this.additionalUnavailable.push({
        section: this.sectionForTool(call.tool),
        reason: 'locked_ticker_mismatch',
      });
      return;
    }

    switch (call.tool) {
      case 'get_stock_price':
        if (!this.priceHistory) {
          this.priceHistory = PriceHistorySchema.parse(call.validatedResult);
          this.priceSourceUrls = call.sourceUrls;
        }
        break;
      case 'analyze_financial_metrics':
        this.valuation ??= FinancialMetricsResultSchema.parse(call.validatedResult);
        break;
      case 'analyze_technical':
        if (!this.technical) {
          const result = analyzeTechnicalResultSchema.parse(call.validatedResult);
          this.technical = TechnicalResultSchema.parse(result);
          this.advancedTechnical = result.advancedTechnical ?? null;
          this.technicalUsesDirectJQuants = !Array.isArray(call.validatedArgs.bars);
        }
        break;
      case 'analyze_supply_demand':
        if (!this.supplyDemand) {
          this.supplyDemand = SupplyDemandResultV3Schema.parse(call.validatedResult);
          this.supplyDemandMarginUsesDirectJQuants = !Array.isArray(call.validatedArgs.marginHistory);
          this.supplyDemandVolumeUsesDirectJQuants = !Array.isArray(call.validatedArgs.volumeHistory);
        }
        break;
      case 'analyze_reported_short_positions':
        if (!this.reportedShortPositions) {
          this.reportedShortPositions = ReportedShortPositionResultSchema.parse(
            call.validatedResult,
          );
          this.reportedShortPositionsUseDirectJQuants = !Array.isArray(
            call.validatedArgs.sourceReports,
          );
          this.reportedShortPositionSourceUrls = call.sourceUrls;
        }
        break;
      case 'analyze_peer_comparison': {
        const peerComparison = PeerComparisonResultSchema.parse(call.validatedResult);
        let resultTargetTicker: string;
        try {
          resultTargetTicker = normalizeCanonicalTicker(peerComparison.target.id);
        } catch {
          this.reject(null, call.tool, 'invalid_result_target_ticker');
          return;
        }
        if (resultTargetTicker !== this.identity.canonicalTicker) {
          this.reject(null, call.tool, 'locked_ticker_mismatch');
          this.additionalUnavailable.push({
            section: 'peerComparison',
            reason: 'locked_ticker_mismatch',
          });
          return;
        }
        if (!this.peerComparison) {
          const candidates = call.validatedArgs.candidates as Array<{
            marketCap?: number | null;
          }>;
          this.peerComparison = peerComparison;
          this.peerCandidateMarketCapsComplete = candidates.length > 0 && candidates.every(
            candidate => candidate.marketCap !== undefined
              && candidate.marketCap !== null
              && candidate.marketCap > 0,
          );
        }
        break;
      }
      case 'analyze_market_correlation':
        if (!this.marketCorrelation) {
          this.marketCorrelation = MarketCorrelationResultSchema.parse(call.validatedResult);
          this.correlationStockUsesDirectJQuants = !Array.isArray(call.validatedArgs.stockPrices);
          this.correlationBenchmarkUsesDirectJQuants = !Array.isArray(call.validatedArgs.topixPrices);
        }
        break;
      case 'analyze_strategy':
        this.strategy ??= StrategyResultSchema.parse(call.validatedResult);
        break;
      case 'skill':
      case 'get_financials':
      case 'company_screener':
        break;
    }
  }

  private sectionForTool(tool: TrackedToolName): SnapshotUnavailableV4['section'] {
    switch (tool) {
      case 'get_financials': return 'identity';
      case 'company_screener': return 'peerComparison';
      case 'get_stock_price': return 'priceHistory';
      case 'analyze_financial_metrics': return 'valuation';
      case 'analyze_peer_comparison': return 'peerComparison';
      case 'analyze_technical': return 'technical';
      case 'analyze_supply_demand': return 'supplyDemand';
      case 'analyze_reported_short_positions': return 'reportedShortPositions';
      case 'analyze_market_correlation': return 'marketCorrelation';
      case 'analyze_strategy': return 'strategy';
      case 'skill': return 'scenarios';
    }
  }

  private reject(toolCallId: string | null, tool: string, reason: string): void {
    this.rejectionValues.push({ toolCallId, tool, reason });
  }
}
