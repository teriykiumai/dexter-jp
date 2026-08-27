import {
  ANALYSIS_SNAPSHOT_SCHEMA_VERSION,
  type AdvancedDividendProvenance,
  AnalysisSnapshotInputSchema,
  AnalysisSnapshotV8Schema,
  type AnalysisSnapshotV8,
  type AnalysisSnapshotInput,
  type InvestorTypeFlowProvenance,
  type ReportedShortPositionProvenance,
  type SectorShortRatioProvenance,
  type SnapshotProvenance,
  type SnapshotSection,
  type SnapshotUnavailableV8,
} from './schema.js';

export const REQUIRED_ANALYSIS_SNAPSHOT_SECTIONS = [
  'identity',
  'fundamental',
  'valuation',
  'peerComparison',
  'technical',
  'supplyDemand',
  'marketCorrelation',
  'strategy',
  'priceHistory',
] as const satisfies readonly SnapshotSection[];

type RequiredSnapshotSection = (typeof REQUIRED_ANALYSIS_SNAPSHOT_SECTIONS)[number];

const UNITS = {
  fundamental: {
    revenue: 'JPY',
    operatingIncome: 'JPY',
    ordinaryIncome: 'JPY',
    netIncome: 'JPY',
    eps: 'JPY',
    roe: 'ratio',
    equityRatio: 'ratio',
    operatingCashFlow: 'JPY',
    freeCashFlow: 'JPY',
  },
  valuation: {
    currentPrice: 'JPY',
    per: 'multiple',
    pbr: 'multiple',
    dividendYieldPercent: 'percent',
    revenueCagrPercent: 'percent',
    cagrPeriods: 'count',
  },
  peerComparison: {
    per: 'multiple',
    pbr: 'multiple',
    roe: 'percent',
    roic: 'percent',
    operatingMargin: 'percent',
    revenueGrowth: 'percent',
    dividendYield: 'percent',
    rank: 'count',
    percentile: 'ratio',
  },
  technical: {
    ma20: 'JPY',
    atr14: 'JPY',
    averageVolume20: 'shares',
    latestSwingHigh: 'JPY',
    latestSwingLow: 'JPY',
  },
  advancedTechnical: {
    rsi14: 'index',
    'macd.value': 'JPY',
    'macd.signal': 'JPY',
    'macd.histogram': 'JPY',
    'bollinger20.middle': 'JPY',
    'bollinger20.upper': 'JPY',
    'bollinger20.lower': 'JPY',
  },
  supplyDemand: {
    buyingBalance: 'shares',
    sellingBalance: 'shares',
    marginRatio: 'ratio',
    buyingBalanceWeeklyChange: 'shares',
    sellingBalanceWeeklyChange: 'shares',
    mean4w: 'shares',
    mean13w: 'shares',
    mean52w: 'shares',
    deviation52w: 'ratio',
    percentile52w: 'ratio',
    averageDailyVolume20: 'shares',
    digestionDays: 'days',
  },
  reportedShortPositions: {
    shortPositionRatio: 'ratio',
    shortPositionShares: 'shares',
    previousReportedRatio: 'ratio',
    ratioDelta: 'ratio',
  },
  investorTypeFlows: {
    sell: 'thousand_JPY',
    buy: 'thousand_JPY',
    total: 'thousand_JPY',
    balance: 'thousand_JPY',
  },
  marketCorrelation: {
    alignedPriceCount: 'count',
    observations: 'count',
    correlation: 'ratio',
    beta: 'ratio',
    alphaAnnualized: 'ratio',
    rSquared: 'ratio',
    stockVolatilityAnnualized: 'ratio',
    benchmarkVolatilityAnnualized: 'ratio',
    excessReturn: 'ratio',
  },
  sectorBenchmark: {
    indexLevel: 'index_points',
    alignedPriceCount: 'count',
    observations: 'count',
    correlation: 'ratio',
    beta: 'ratio',
    alphaAnnualized: 'ratio',
    rSquared: 'ratio',
    stockVolatilityAnnualized: 'ratio',
    benchmarkVolatilityAnnualized: 'ratio',
    excessReturn: 'ratio',
  },
  sectorShortRatio: {
    nonShortSellingValue: 'JPY',
    restrictedShortSellingValue: 'JPY',
    unrestrictedShortSellingValue: 'JPY',
    shortSellingValue: 'JPY',
    totalSellingValue: 'JPY',
    shortSellingRatio: 'ratio',
  },
  advancedDividend: {
    dividendPerShare: 'JPY_per_share',
    payoutRatio: 'ratio',
  },
  strategy: {
    triggerPrice: 'JPY',
    price: 'JPY',
    tickSizeApplied: 'JPY',
    risk: 'JPY',
    reward: 'JPY',
    rewardRisk: 'ratio',
  },
  priceHistory: {
    open: 'JPY',
    high: 'JPY',
    low: 'JPY',
    close: 'JPY',
    volume: 'shares',
  },
} as const;

function provenance(
  source: SnapshotProvenance['source'],
  role: SnapshotProvenance['role'],
  asOfDate: string | null,
  sourceUrls: string[] = [],
): SnapshotProvenance[] {
  return [{ source, role, asOfDate, sourceUrls }];
}

function reportedShortPositionProvenance(
  source: ReportedShortPositionProvenance['source'],
  role: ReportedShortPositionProvenance['role'],
  asOfDate: string | null,
  sourceUrls: string[] = [],
): ReportedShortPositionProvenance[] {
  return [{ source, role, asOfDate, sourceUrls }];
}

function investorTypeFlowProvenance(
  source: InvestorTypeFlowProvenance['source'],
  role: InvestorTypeFlowProvenance['role'],
  asOfDate: string | null,
  section: InvestorTypeFlowProvenance['section'],
  endpoint: InvestorTypeFlowProvenance['endpoint'],
  sourceUrls: string[] = [],
): InvestorTypeFlowProvenance[] {
  return [{ source, role, asOfDate, section, endpoint, sourceUrls }];
}

function sectorShortRatioProvenance(
  source: SectorShortRatioProvenance['source'],
  role: SectorShortRatioProvenance['role'],
  asOfDate: string | null,
  endpoint: SectorShortRatioProvenance['endpoint'],
): SectorShortRatioProvenance[] {
  return [{ source, role, asOfDate, endpoint, sourceUrls: [] }];
}

function advancedDividendProvenance(
  source: AdvancedDividendProvenance['source'],
  role: AdvancedDividendProvenance['role'],
  asOfDate: string | null,
  endpoint: AdvancedDividendProvenance['endpoint'],
): AdvancedDividendProvenance[] {
  return [{ source, role, asOfDate, endpoint, sourceUrls: [] }];
}

function latestFundamentalDate(input: AnalysisSnapshotInput): string | null {
  const periods = input.fundamental?.periods ?? [];
  return periods.reduce<string | null>((latest, period) => {
    if (!period.submitDate) return latest;
    return latest === null || period.submitDate > latest ? period.submitDate : latest;
  }, null);
}

function latestPeerDate(input: AnalysisSnapshotInput): string | null {
  if (!input.peerComparison) return null;
  return [input.peerComparison.target, ...input.peerComparison.selection.peers]
    .map(company => company.dataDate ?? null)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1) ?? null;
}

function latestPriceDate(input: AnalysisSnapshotInput): string | null {
  return input.priceHistory?.at(-1)?.date ?? null;
}

function missingSections(input: AnalysisSnapshotInput): RequiredSnapshotSection[] {
  return REQUIRED_ANALYSIS_SNAPSHOT_SECTIONS.filter(section => {
    if (section === 'identity') return false;
    return input[section] === null;
  });
}

function peerComparisonState(input: AnalysisSnapshotInput) {
  if (!input.peerComparison) return null;

  const targetMarketCap = input.peerComparison.target.marketCap;
  if (targetMarketCap === undefined || targetMarketCap === null || targetMarketCap <= 0) {
    return {
      result: input.peerComparison,
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'missing_target_market_cap' as const,
    };
  }

  if (input.peerCandidateMarketCapsComplete !== true) {
    return {
      result: input.peerComparison,
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap' as const,
    };
  }

  const peers = input.peerComparison.selection.peers;
  const hasIncompletePeerMarketCap = peers.length === 0 || peers.some(peer => {
    const marketCap = peer.marketCap;
    return marketCap === undefined || marketCap === null || marketCap <= 0;
  });

  if (hasIncompletePeerMarketCap) {
    return {
      result: input.peerComparison,
      marketCapPriorityApplied: false,
      marketCapPriorityUnavailableReason: 'incomplete_peer_market_cap' as const,
    };
  }

  return {
    result: input.peerComparison,
    marketCapPriorityApplied: true,
    marketCapPriorityUnavailableReason: null,
  };
}

function aggregateUnavailable(input: AnalysisSnapshotInput): SnapshotUnavailableV8[] {
  const unavailable: SnapshotUnavailableV8[] = missingSections(input).map(section => ({
    section,
    reason: 'missing_required_section',
  }));

  for (const item of input.valuation?.unavailable ?? []) {
    unavailable.push({ section: 'valuation', metric: item.metric, reason: item.reason });
  }
  for (const metric of input.technical?.unavailable ?? []) {
    unavailable.push({ section: 'technical', metric, reason: 'engine_reported_unavailable' });
  }
  if (input.advancedTechnical === null) {
    unavailable.push({ section: 'advancedTechnical', reason: 'not_collected' });
  } else {
    for (const item of input.advancedTechnical.unavailable) {
      unavailable.push({
        section: 'advancedTechnical',
        metric: item.metric,
        reason: item.reason,
      });
    }
  }
  for (const item of input.supplyDemand?.unavailable ?? []) {
    unavailable.push({ section: 'supplyDemand', metric: item.metric, reason: item.reason });
  }
  if (input.reportedShortPositions === null) {
    unavailable.push({ section: 'reportedShortPositions', reason: 'not_collected' });
  } else {
    for (const item of input.reportedShortPositions.unavailable) {
      unavailable.push({ section: 'reportedShortPositions', reason: item.reason });
    }
  }
  if (input.investorTypeFlows === null) {
    unavailable.push({ section: 'investorTypeFlows', reason: 'not_collected' });
  } else {
    for (const item of input.investorTypeFlows.unavailable) {
      unavailable.push({ section: 'investorTypeFlows', reason: item.reason });
    }
  }
  for (const item of input.peerComparison?.unavailable ?? []) {
    unavailable.push({ section: 'peerComparison', metric: item.metric, reason: item.reason });
  }
  for (const window of input.marketCorrelation?.windows ?? []) {
    for (const item of window.unavailable) {
      unavailable.push({
        section: 'marketCorrelation',
        metric: `${window.period}.${item.metric}`,
        reason: item.reason,
      });
    }
  }
  if (input.sectorBenchmark === null) {
    unavailable.push({ section: 'sectorBenchmark', reason: 'not_collected' });
  } else {
    for (const item of input.sectorBenchmark.unavailable) {
      unavailable.push({ section: 'sectorBenchmark', reason: item.reason });
    }
    for (const window of input.sectorBenchmark.windows) {
      for (const item of window.unavailable) {
        unavailable.push({
          section: 'sectorBenchmark',
          metric: `${window.period}.${item.metric}`,
          reason: item.reason,
        });
      }
    }
  }
  if (input.sectorShortRatio === null) {
    unavailable.push({ section: 'sectorShortRatio', reason: 'not_collected' });
  } else {
    for (const item of input.sectorShortRatio.unavailable) {
      unavailable.push({ section: 'sectorShortRatio', reason: item.reason });
    }
    for (const observation of input.sectorShortRatio.observations) {
      for (const item of observation.unavailable) {
        unavailable.push({
          section: 'sectorShortRatio',
          metric: observation.date,
          reason: item.reason,
        });
      }
    }
  }
  if (input.advancedDividend === null) {
    unavailable.push({ section: 'advancedDividend', reason: 'not_collected' });
  } else {
    for (const item of input.advancedDividend.unavailable) {
      unavailable.push({
        section: 'advancedDividend',
        metric: item.scope,
        reason: item.reason,
      });
    }
  }
  for (const item of input.strategy?.unavailable ?? []) {
    unavailable.push({ section: 'strategy', metric: item.candidate, reason: item.reason });
  }

  if (input.scenarios === null) {
    unavailable.push({ section: 'scenarios', reason: 'structured_narrative_not_captured_v1' });
  }
  if (input.risks === null) {
    unavailable.push({ section: 'risks', reason: 'structured_narrative_not_captured_v1' });
  }

  return [...unavailable, ...input.additionalUnavailable];
}

export function buildAnalysisSnapshot(rawInput: AnalysisSnapshotInput): AnalysisSnapshotV8 {
  const input = AnalysisSnapshotInputSchema.parse(rawInput);
  const fundamentalDate = latestFundamentalDate(input);
  const peerDate = latestPeerDate(input);
  const priceDate = latestPriceDate(input);
  const missing = missingSections(input);

  return AnalysisSnapshotV8Schema.parse({
    schemaVersion: ANALYSIS_SNAPSHOT_SCHEMA_VERSION,
    status: missing.length === 0 ? 'complete' : 'partial',
    canonicalTicker: input.identity.canonicalTicker,
    companyName: input.identity.companyName,
    generatedAt: input.generatedAt,
    dataDates: {
      identity: input.identity.dataDate,
      fundamental: fundamentalDate,
      valuation: {
        price: input.valuation?.priceDataDate ?? null,
        financial: input.valuation?.financialDataDate ?? null,
      },
      peerComparison: peerDate,
      technical: input.technical?.dataDate ?? null,
      advancedTechnical: input.advancedTechnical?.dataDate ?? null,
      reportedShortPositions: input.reportedShortPositions?.dataDate ?? null,
      investorTypeFlows: input.investorTypeFlows?.dataDate ?? null,
      supplyDemand: input.supplyDemand?.dataDate ?? null,
      marketCorrelation: input.marketCorrelation?.dataDate ?? null,
      sectorBenchmark: input.sectorBenchmark?.dataDate ?? null,
      sectorShortRatio: input.sectorShortRatio?.dataDate ?? null,
      advancedDividend: input.advancedDividend?.dataDate ?? null,
      strategy: input.strategy?.dataDate ?? null,
      priceHistory: priceDate,
    },
    provenance: {
      identity: provenance(
        'edinet_db',
        'identity',
        input.identity.dataDate,
        input.identity.sourceUrls,
      ),
      fundamental: input.fundamental
        ? provenance('edinet_db', 'financial_data', fundamentalDate, input.fundamental.sourceUrls)
        : [],
      valuation: input.valuation
        ? [
            ...provenance('financial_metrics_engine', 'calculation', input.valuation.priceDataDate),
            ...(input.sourceUsage.valuation.priceFromJQuants
              ? provenance('jquants', 'price_data', input.valuation.priceDataDate, input.priceSourceUrls)
              : []),
            ...(input.sourceUsage.valuation.financialsFromEdinetDb
              ? provenance(
                  'edinet_db',
                  'financial_data',
                  input.valuation.financialDataDate,
                  input.fundamental?.sourceUrls ?? [],
                )
              : []),
          ]
        : [],
      peerComparison: input.peerComparison
        ? [
            ...provenance('peer_comparison_engine', 'calculation', peerDate),
            ...(input.peerSourceUrls.length > 0
              ? provenance('edinet_db', 'financial_data', peerDate, input.peerSourceUrls)
              : []),
          ]
        : [],
      technical: input.technical
        ? [
            ...provenance('technical_engine', 'calculation', input.technical.dataDate),
            ...(input.sourceUsage.technical.priceFromJQuants
              ? provenance('jquants', 'price_data', input.technical.dataDate, input.priceSourceUrls)
              : []),
          ]
        : [],
      advancedTechnical: input.advancedTechnical
        ? [
            ...provenance(
              'technical_engine',
              'calculation',
              input.advancedTechnical.dataDate,
            ),
            ...(input.sourceUsage.technical.priceFromJQuants
              ? provenance(
                  'jquants',
                  'price_data',
                  input.advancedTechnical.dataDate,
                  input.priceSourceUrls,
                )
              : []),
          ]
        : [],
      supplyDemand: input.supplyDemand
        ? [
            ...provenance('supply_demand_engine', 'calculation', input.supplyDemand.dataDate),
            ...(input.sourceUsage.supplyDemand.marginFromJQuants
              ? provenance('jquants', 'margin_data', input.supplyDemand.dataDate)
              : []),
            ...(input.sourceUsage.supplyDemand.volumeFromJQuants
              ? provenance('jquants', 'price_data', input.supplyDemand.volumeDataDate, input.priceSourceUrls)
              : []),
          ]
        : [],
      reportedShortPositions: input.reportedShortPositions
        ? [
            ...reportedShortPositionProvenance(
              'reported_short_position_engine',
              'calculation',
              input.reportedShortPositions.dataDate,
            ),
            ...(input.sourceUsage.reportedShortPositions.sourceFromJQuants
              ? reportedShortPositionProvenance(
                  'jquants',
                  'short_position_data',
                  input.reportedShortPositions.dataDate,
                  input.reportedShortPositionSourceUrls,
                )
              : []),
          ]
        : [],
      investorTypeFlows: input.investorTypeFlows
        ? [
            ...investorTypeFlowProvenance(
              'investor_type_flow_engine',
              'calculation',
              input.investorTypeFlows.dataDate,
              'TokyoNagoya',
              null,
            ),
            ...(input.sourceUsage.investorTypeFlows.sourceFromJQuants
              ? investorTypeFlowProvenance(
                  'jquants',
                  'investor_type_flow_data',
                  input.investorTypeFlows.dataDate,
                  'TokyoNagoya',
                  '/v2/equities/investor-types',
                  input.investorTypeFlowSourceUrls,
                )
              : []),
            ...(input.sourceUsage.investorTypeFlows.calendarFromJQuants
              ? investorTypeFlowProvenance(
                  'jquants',
                  'market_calendar_data',
                  null,
                  null,
                  '/v2/markets/calendar',
                )
              : []),
          ]
        : [],
      marketCorrelation: input.marketCorrelation
        ? [
            ...provenance('market_correlation_engine', 'calculation', input.marketCorrelation.dataDate),
            ...(input.sourceUsage.marketCorrelation.stockFromJQuants
              ? provenance('jquants', 'price_data', input.marketCorrelation.dataDate, input.priceSourceUrls)
              : []),
            ...(input.sourceUsage.marketCorrelation.benchmarkFromJQuants
              ? provenance('jquants', 'benchmark_data', input.marketCorrelation.dataDate)
              : []),
          ]
        : [],
      sectorBenchmark: input.sectorBenchmark
        ? [
            ...provenance(
              'market_correlation_engine',
              'calculation',
              input.sectorBenchmark.dataDate,
            ),
            ...provenance(
              'jquants',
              'benchmark_data',
              input.sectorBenchmark.benchmark?.classificationDate
                ?? input.sectorBenchmark.dataDate,
            ),
            ...(input.sourceUsage.sectorBenchmark.stockFromJQuants
              ? provenance(
                  'jquants',
                  'price_data',
                  input.sectorBenchmark.dataDate,
                  input.priceSourceUrls,
                )
              : []),
          ]
        : [],
      sectorShortRatio: input.sectorShortRatio
        ? [
            ...sectorShortRatioProvenance(
              'sector_short_ratio_engine',
              'calculation',
              input.sectorShortRatio.dataDate,
              null,
            ),
            ...(input.sectorShortRatio.provenance.classification
              ? sectorShortRatioProvenance(
                  'jquants',
                  'sector_classification_data',
                  input.sectorShortRatio.sector?.classificationDate ?? null,
                  '/v2/equities/master',
                )
              : []),
            ...(input.sectorShortRatio.provenance.flow
              ? sectorShortRatioProvenance(
                  'jquants',
                  'sector_short_ratio_data',
                  input.sectorShortRatio.dataDate,
                  '/v2/markets/short-ratio',
                )
              : []),
          ]
        : [],
      advancedDividend: input.advancedDividend
        ? [
            ...advancedDividendProvenance(
              'advanced_dividend_engine',
              'calculation',
              input.advancedDividend.dataDate,
              null,
            ),
            ...advancedDividendProvenance(
              'jquants',
              'dividend_financial_summary_data',
              input.advancedDividend.dataDate,
              '/v2/fins/summary',
            ),
            ...(input.advancedDividend.provenance.dividendEvents
              ? advancedDividendProvenance(
                  'jquants',
                  'dividend_event_data',
                  input.advancedDividend.dataDate,
                  '/v2/fins/dividend',
                )
              : []),
            ...advancedDividendProvenance(
              'jquants',
              'market_calendar_data',
              null,
              '/v2/markets/calendar',
            ),
          ]
        : [],
      strategy: input.strategy
        ? provenance('strategy_engine', 'calculation', input.strategy.dataDate)
        : [],
      priceHistory: input.priceHistory
        ? provenance('jquants', 'price_data', priceDate, input.priceSourceUrls)
        : [],
      scenarios: input.scenarios ? provenance('llm', 'narrative', input.generatedAt) : [],
      risks: input.risks ? provenance('llm', 'narrative', input.generatedAt) : [],
    },
    units: UNITS,
    fundamental: input.fundamental,
    valuation: input.valuation,
    peerComparison: peerComparisonState(input),
    technical: input.technical,
    advancedTechnical: input.advancedTechnical,
    supplyDemand: input.supplyDemand,
    reportedShortPositions: input.reportedShortPositions,
    investorTypeFlows: input.investorTypeFlows,
    marketCorrelation: input.marketCorrelation,
    sectorBenchmark: input.sectorBenchmark,
    sectorShortRatio: input.sectorShortRatio,
    advancedDividend: input.advancedDividend,
    strategy: input.strategy,
    priceHistory: input.priceHistory,
    scenarios: input.scenarios,
    risks: input.risks,
    unavailable: aggregateUnavailable(input),
    finalReportMarkdown: input.finalReportMarkdown,
  });
}
