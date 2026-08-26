import { describe, expect, test } from 'bun:test';
import {
  analyzeFinancialMetrics,
  analyzeInvestorTypeFlows,
  analyzeMarketCorrelation,
  analyzePeerComparison,
  analyzeReportedShortPositions,
  analyzeSectorBenchmark,
  analyzeSectorShortRatio,
  analyzeStrategy,
  analyzeSupplyDemand,
  analyzeTechnical,
  type PeerCompany,
} from './index.js';
import { analyzeAdvancedTechnical } from './advanced-technical-engine.js';
import {
  analyzeFinancialMetricsTool,
  analyzeInvestorTypeFlowsTool,
  analyzeMarketCorrelationTool,
  analyzePeerComparisonTool,
  analyzeReportedShortPositionsTool,
  analyzeSectorBenchmarkTool,
  analyzeSectorShortRatioTool,
  analyzeStrategyTool,
  analyzeSupplyDemandTool,
  analyzeTechnicalTool,
  deterministicAnalysisTools,
} from './analysis-tools.js';

function toolData(value: unknown): unknown {
  expect(typeof value).toBe('string');
  return JSON.parse(value as string).data;
}

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });
}

function investorTypeSourcePeriod() {
  const zero = { sell: 0, buy: 0, total: 0, balance: 0 };
  return {
    publishedDate: '2026-08-20',
    periodStartDate: '2026-08-10',
    periodEndDate: '2026-08-14',
    section: 'TokyoNagoya' as const,
    summary: { proprietary: zero, brokerage: zero, total: zero },
    brokerageBreakdown: {
      individuals: zero,
      foreignInvestors: zero,
      securitiesCompanies: zero,
      investmentTrusts: zero,
      businessCorporations: zero,
      otherCorporations: zero,
      insuranceCompanies: zero,
      banks: zero,
      trustBanks: zero,
      otherFinancialInstitutions: zero,
    },
  };
}

function rawInvestorTypeRow() {
  return {
    PubDate: '2026-08-20', StDate: '2026-08-10', EnDate: '2026-08-14',
    Section: 'TokyoNagoya',
    PropSell: 0, PropBuy: 0, PropTot: 0, PropBal: 0,
    BrkSell: 0, BrkBuy: 0, BrkTot: 0, BrkBal: 0,
    TotSell: 0, TotBuy: 0, TotTot: 0, TotBal: 0,
    IndSell: 0, IndBuy: 0, IndTot: 0, IndBal: 0,
    FrgnSell: 0, FrgnBuy: 0, FrgnTot: 0, FrgnBal: 0,
    SecCoSell: 0, SecCoBuy: 0, SecCoTot: 0, SecCoBal: 0,
    InvTrSell: 0, InvTrBuy: 0, InvTrTot: 0, InvTrBal: 0,
    BusCoSell: 0, BusCoBuy: 0, BusCoTot: 0, BusCoBal: 0,
    OthCoSell: 0, OthCoBuy: 0, OthCoTot: 0, OthCoBal: 0,
    InsCoSell: 0, InsCoBuy: 0, InsCoTot: 0, InsCoBal: 0,
    BankSell: 0, BankBuy: 0, BankTot: 0, BankBal: 0,
    TrstBnkSell: 0, TrstBnkBuy: 0, TrstBnkTot: 0, TrstBnkBal: 0,
    OthFinSell: 0, OthFinBuy: 0, OthFinTot: 0, OthFinBal: 0,
  };
}

describe('deterministic analysis tools', () => {
  test('have stable unique names', () => {
    const names = deterministicAnalysisTools.map((tool) => tool.name);
    expect(names).toEqual([
      'analyze_financial_metrics',
      'analyze_technical',
      'analyze_supply_demand',
      'analyze_reported_short_positions',
      'analyze_investor_type_flows',
      'analyze_peer_comparison',
      'analyze_market_correlation',
      'analyze_sector_benchmark',
      'analyze_sector_short_ratio',
      'analyze_strategy',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test('delegates valuation and CAGR calculations to the Financial Metrics Engine', async () => {
    const financials = [
      {
        fiscalYear: 2021,
        submitDate: '2021-06-24',
        revenue: 100,
        eps: 10,
        bps: 50,
        dividendPerShare: 2,
      },
      {
        fiscalYear: 2026,
        submitDate: '2026-06-10',
        revenue: 200,
        eps: 20,
        bps: 80,
        dividendPerShare: 4,
      },
    ];
    const actual = toolData(await analyzeFinancialMetricsTool.invoke({
      currentPrice: 100,
      priceDataDate: '2026-08-21',
      financials,
    }));

    expect(actual).toEqual(analyzeFinancialMetrics(100, '2026-08-21', financials));
  });

  test('delegates OHLCV calculations to the Technical Engine', async () => {
    const bars = dates(20).map((date, index) => ({
      date,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1_000 + index,
    }));

    const actual = toolData(await analyzeTechnicalTool.invoke({ bars })) as ReturnType<
      typeof analyzeTechnical
    > & { advancedTechnical: ReturnType<typeof analyzeAdvancedTechnical> };
    const { advancedTechnical, ...technical } = actual;

    expect(technical).toEqual(analyzeTechnical(bars));
    expect(advancedTechnical).toEqual(analyzeAdvancedTechnical(bars));
  });

  test('delegates margin and volume calculations to the Supply-Demand Engine', async () => {
    const marginHistory = dates(2).map((date, index) => ({
      date,
      longBalance: 100 + index * 20,
      shortBalance: 50 + index * 10,
    }));
    const volumeHistory = dates(20).map((date) => ({ date, volume: 10 }));

    const actual = toolData(await analyzeSupplyDemandTool.invoke({
      marginHistory,
      volumeHistory,
    }));
    expect(actual).toEqual(analyzeSupplyDemand(marginHistory, volumeHistory));
  });

  test('delegates supplied report rows without fetching and preserves report-level results', async () => {
    const sourceReports = [{
      disclosedDate: '2026-08-20',
      calculatedDate: '2026-08-18',
      code: '72030',
      reporterName: 'Reporter Exact',
      discretionaryManagerName: null,
      fundName: 'Fund Exact',
      shortPositionRatio: 0.006,
      shortPositionShares: 120_000,
      previousCalculatedDate: '2026-08-11',
      previousReportedRatio: 0.0055,
    }];
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error('Unexpected fetch');
    }) as unknown as typeof fetch;

    try {
      const actual = toolData(await analyzeReportedShortPositionsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        sourceReports,
      }));

      expect(actual).toEqual(analyzeReportedShortPositions(sourceReports, '2026-08-20'));
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetches short-sale reports once in direct ticker mode', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    let fetches = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetches += 1;
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      expect(url.pathname).toEndWith('/markets/short-sale-report');
      expect(url.searchParams.get('disc_date_to')).toBe('2026-08-20');
      return new Response(JSON.stringify({ data: [{
        DiscDate: '2026-08-20',
        CalcDate: '2026-08-18',
        Code: '72030',
        SSName: 'Reporter Exact',
        DICName: null,
        FundName: null,
        ShrtPosToSO: 0.006,
        ShrtPosShares: 120_000,
        PrevRptDate: '2026-08-11',
        PrevRptRatio: 0.005,
      }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const actual = toolData(await analyzeReportedShortPositionsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
      })) as { reports: unknown[]; unavailable: unknown[] };
      expect(actual.reports).toHaveLength(1);
      expect(actual.unavailable).toEqual([]);
      expect(fetches).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('maps an empty direct response to typed unavailable data, not zero', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const actual = toolData(await analyzeReportedShortPositionsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
      }));
      expect(actual).toEqual({
        dataDate: null,
        reports: [],
        unavailable: [{ reason: 'no_public_disclosure_data' }],
      });
      expect(fetches).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('delegates supplied investor-type rows and calendar without fetching', async () => {
    const sourcePeriods = [investorTypeSourcePeriod()];
    const officialCalendar = [{ date: '2026-08-21', holidayDivision: '1' }];
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error('Unexpected fetch');
    }) as unknown as typeof fetch;

    try {
      const actual = toolData(await analyzeInvestorTypeFlowsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        sourcePeriods,
        officialCalendar,
      }));

      expect(actual).toEqual(analyzeInvestorTypeFlows(
        sourcePeriods,
        officialCalendar,
        '2026-08-20',
      ));
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetches investor-type rows and official calendar once each in direct mode', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const requestedUrls: URL[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      requestedUrls.push(url);
      if (url.pathname.endsWith('/equities/investor-types')) {
        return new Response(JSON.stringify({ data: [rawInvestorTypeRow()] }));
      }
      if (url.pathname.endsWith('/markets/calendar')) {
        return new Response(JSON.stringify({
          data: [{ Date: '2026-08-21', HolDiv: '1' }],
        }));
      }
      throw new Error(`Unexpected test URL: ${url.pathname}`);
    }) as typeof fetch;

    try {
      const actual = toolData(await analyzeInvestorTypeFlowsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
      })) as { dataDate: string | null; period: unknown; unavailable: unknown[] };

      expect(actual).toMatchObject({
        dataDate: '2026-08-20',
        section: 'TokyoNagoya',
        period: investorTypeSourcePeriod(),
        unavailable: [],
      });
      expect(requestedUrls).toHaveLength(2);
      expect(requestedUrls[0].pathname).toEndWith('/equities/investor-types');
      expect(requestedUrls[0].searchParams.get('section')).toBe('TokyoNagoya');
      expect(requestedUrls[0].searchParams.get('to')).toBe('2026-08-20');
      expect(requestedUrls[1].pathname).toEndWith('/markets/calendar');
      expect(requestedUrls[1].searchParams.get('from')).toBe('2026-08-20');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('does not fetch a calendar after an empty direct investor-type response', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const requestedUrls: URL[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      requestedUrls.push(url);
      if (url.pathname.endsWith('/equities/investor-types')) {
        return new Response(JSON.stringify({ data: [] }));
      }
      throw new Error(`Unexpected test URL: ${url.pathname}`);
    }) as typeof fetch;

    try {
      const actual = toolData(await analyzeInvestorTypeFlowsTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
      }));

      expect(actual).toEqual({
        dataDate: null,
        section: 'TokyoNagoya',
        period: null,
        unavailable: [{ reason: 'no_investor_type_flow_data' }],
      });
      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0].pathname).toEndWith('/equities/investor-types');
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('delegates sourced company cohorts to the Peer Comparison Engine', async () => {
    const target: PeerCompany = {
      id: 'target',
      name: 'Target',
      sector: '輸送用機器',
      marketCap: 1_000,
      metrics: { per: 10, roe: 12 },
    };
    const candidates: PeerCompany[] = [{
      id: 'peer',
      name: 'Peer',
      sector: '輸送用機器',
      marketCap: 900,
      metrics: { per: 12, roe: 10 },
    }];

    const actual = toolData(await analyzePeerComparisonTool.invoke({ target, candidates }));
    expect(actual).toEqual(analyzePeerComparison(target, candidates));
  });

  test('delegates aligned closes to the Market Correlation Engine', async () => {
    const stockPrices = dates(61).map((date, index) => ({ date, close: 100 + index }));
    const topixPrices = dates(61).map((date, index) => ({ date, close: 200 + index * 2 }));

    const actual = toolData(await analyzeMarketCorrelationTool.invoke({
      stockPrices,
      topixPrices,
    }));
    expect(actual).toEqual(analyzeMarketCorrelation(stockPrices, topixPrices));
  });

  test('delegates one supplied as-of sector source without fetching or stitching', async () => {
    const stockPrices = dates(61).map((date, index) => ({ date, close: 100 + index }));
    const sectorSource = {
      analysisAsOfDate: dates(61).at(-1)!,
      classification: {
        issuerCode: '72030',
        classificationDate: dates(61).at(-1)!,
        sectorCode: '3700' as const,
        sectorName: '輸送用機器',
        indexCode: '0050' as const,
      },
      prices: dates(61).map((date, index) => ({
        date,
        indexCode: '0050' as const,
        open: null,
        high: null,
        low: null,
        close: 2_000 + index * 2,
      })),
    };

    const actual = toolData(await analyzeSectorBenchmarkTool.invoke({
      ticker: '7203',
      analysisAsOfDate: sectorSource.analysisAsOfDate,
      stockPrices,
      sectorSource,
    }));

    expect(actual).toEqual(analyzeSectorBenchmark(stockPrices, sectorSource));
  });

  test('short-circuits supplied sector source unavailability without fetching stock', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error('Unexpected fetch');
    }) as unknown as typeof fetch;

    try {
      for (const reason of [
        'sector_classification_unavailable',
        'unsupported_sector',
        'no_sector_index_data',
      ] as const) {
        const sectorSource = {
          analysisAsOfDate: '2026-08-20',
          reason,
        };
        const actual = toolData(await analyzeSectorBenchmarkTool.invoke({
          ticker: '7203',
          analysisAsOfDate: sectorSource.analysisAsOfDate,
          sectorSource,
        }));

        expect(actual).toEqual(analyzeSectorBenchmark([], sectorSource));
      }
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects supplied sector source data for a different issuer', async () => {
    const stockPrices = dates(21).map((date, index) => ({ date, close: 100 + index }));
    const analysisAsOfDate = dates(21).at(-1)!;

    await expect(analyzeSectorBenchmarkTool.invoke({
      ticker: '7203',
      analysisAsOfDate,
      stockPrices,
      sectorSource: {
        analysisAsOfDate,
        classification: {
          issuerCode: '67580',
          classificationDate: analysisAsOfDate,
          sectorCode: '3650',
          sectorName: '電気機器',
          indexCode: '004F',
        },
        prices: [],
      },
    })).rejects.toThrow('sectorSource issuerCode must match ticker.');
  });

  test('fetches stock, calendar, master, and one sector index exactly once in direct mode', async () => {
    const priceDates = dates(251);
    const analysisAsOfDate = priceDates.at(-1)!;
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const fetchCounts = {
      stock: 0,
      calendar: 0,
      master: 0,
      sectorIndex: 0,
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      let data: Record<string, unknown>[];

      if (url.pathname.endsWith('/equities/bars/daily')) {
        fetchCounts.stock += 1;
        data = priceDates.map((date, index) => ({
          Date: date,
          Code: '72030',
          AdjO: 100 + index,
          AdjH: 102 + index,
          AdjL: 99 + index,
          AdjC: 101 + index,
          AdjVo: 1_000 + index,
          Va: null,
        }));
      } else if (url.pathname.endsWith('/markets/calendar')) {
        fetchCounts.calendar += 1;
        data = [{ Date: analysisAsOfDate, HolDiv: '1' }];
      } else if (url.pathname.endsWith('/equities/master')) {
        fetchCounts.master += 1;
        data = [{
          Date: analysisAsOfDate,
          Code: '72030',
          S33: '3700',
          S33Nm: '輸送用機器',
        }];
      } else if (url.pathname.endsWith('/indices/bars/daily')) {
        fetchCounts.sectorIndex += 1;
        data = priceDates.map((date, index) => ({
          Date: date,
          Code: '0050',
          O: 2_000 + index,
          H: 2_002 + index,
          L: 1_999 + index,
          C: 2_001 + index * 1.01,
        }));
      } else {
        throw new Error(`Unexpected test URL: ${url.pathname}`);
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const actual = toolData(await analyzeSectorBenchmarkTool.invoke({
        ticker: '7203',
        analysisAsOfDate,
        from: priceDates[0],
      })) as {
        benchmark: { sectorCode: string; indexCode: string } | null;
        alignedPriceCount: number;
        windows: Array<{ period: number; observations: number }>;
      };

      expect(actual.benchmark).toMatchObject({ sectorCode: '3700', indexCode: '0050' });
      expect(actual.alignedPriceCount).toBe(251);
      expect(actual.windows.map((window) => window.period)).toEqual([20, 60, 250]);
      expect(actual.windows.find((window) => window.period === 250)?.observations).toBe(250);
      expect(fetchCounts).toEqual({
        stock: 1,
        calendar: 1,
        master: 1,
        sectorIndex: 1,
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('reverifies supplied sector short-ratio rows before deterministic analysis', async () => {
    const sectorSource = {
      analysisAsOfDate: '2026-08-20',
      issuerCode: '72030',
      classification: {
        classificationDate: '2026-08-20',
        sectorCode: '3700' as const,
        sectorName: '輸送用機器',
      },
      rows: [{
        date: '2026-08-20',
        sectorCode: '3700' as const,
        nonShortSellingValue: 100,
        restrictedShortSellingValue: 20,
        unrestrictedShortSellingValue: 30,
      }],
      provenance: {
        classification: {
          source: 'jquants' as const,
          endpoint: '/v2/equities/master' as const,
        },
        flow: {
          source: 'jquants' as const,
          endpoint: '/v2/markets/short-ratio' as const,
        },
      },
    };
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      paths.push(url.pathname);
      if (url.pathname.endsWith('/markets/calendar')) {
        return new Response(JSON.stringify({
          data: [{ Date: '2026-08-20', HolDiv: '1' }],
        }));
      }
      if (url.pathname.endsWith('/equities/master')) {
        return new Response(JSON.stringify({ data: [{
          Date: '2026-08-20', Code: '72030', S33: '3700', S33Nm: '輸送用機器',
        }] }));
      }
      throw new Error('Supplied flow rows must not be fetched again.');
    }) as typeof fetch;
    try {
      const actual = toolData(await analyzeSectorShortRatioTool.invoke({
        ticker: '7203',
        analysisAsOfDate: sectorSource.analysisAsOfDate,
        sectorSource,
      }));

      expect(actual).toEqual(analyzeSectorShortRatio(sectorSource));
      expect(paths).toEqual(['/v2/markets/calendar', '/v2/equities/master']);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('reverifies supplied sector identity before fetching short-ratio history', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      paths.push(url.pathname);
      if (url.pathname.endsWith('/markets/calendar')) {
        return new Response(JSON.stringify({
          data: [{ Date: '2026-08-20', HolDiv: '1' }],
        }));
      }
      if (url.pathname.endsWith('/equities/master')) {
        return new Response(JSON.stringify({ data: [{
          Date: '2026-08-20', Code: '72030', S33: '3700', S33Nm: '輸送用機器',
        }] }));
      }
      return new Response(JSON.stringify({ data: [{
        Date: '2026-08-20', S33: '3700', SellExShortVa: 100,
        ShrtWithResVa: 20, ShrtNoResVa: 30,
      }] }));
    }) as typeof fetch;

    try {
      const actual = toolData(await analyzeSectorShortRatioTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        from: '2026-01-01',
        sectorIdentity: {
          analysisAsOfDate: '2026-08-20',
          issuerCode: '72030',
          classificationDate: '2026-08-20',
          sectorCode: '3700',
          sectorName: '輸送用機器',
          indexCode: '0050',
          provenance: { source: 'jquants', endpoint: '/v2/equities/master' },
        },
      })) as { observations: Array<{ shortSellingRatio: number }> };

      expect(paths).toEqual([
        '/v2/markets/calendar',
        '/v2/equities/master',
        '/v2/markets/short-ratio',
      ]);
      expect(actual.observations[0]?.shortSellingRatio).toBe(1 / 3);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('rejects unbound sector identities and sources before fetching short-ratio data', async () => {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error('Unexpected fetch');
    }) as unknown as typeof fetch;
    const sectorIdentity = {
      analysisAsOfDate: '2026-08-20',
      issuerCode: '72030',
      classificationDate: '2026-08-20',
      sectorCode: '3700' as const,
      sectorName: '輸送用機器',
      indexCode: '0050' as const,
      provenance: {
        source: 'jquants' as const,
        endpoint: '/v2/equities/master' as const,
      },
    };
    const sectorSource = {
      analysisAsOfDate: '2026-08-20',
      issuerCode: '72030',
      classification: {
        classificationDate: '2026-08-20',
        sectorCode: '3700' as const,
        sectorName: '輸送用機器',
      },
      rows: [],
      reason: 'no_sector_short_ratio_data' as const,
      error: 'No source rows.',
      provenance: {
        classification: {
          source: 'jquants' as const,
          endpoint: '/v2/equities/master' as const,
        },
        flow: {
          source: 'jquants' as const,
          endpoint: '/v2/markets/short-ratio' as const,
        },
      },
    };

    try {
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203', analysisAsOfDate: '2026-08-20', from: '2026-01-01',
        sectorIdentity: { ...sectorIdentity, issuerCode: '67580' },
      })).rejects.toThrow('sectorIdentity issuerCode must match ticker.');
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203', analysisAsOfDate: '2026-08-20', from: '2026-01-01',
        sectorIdentity: { ...sectorIdentity, analysisAsOfDate: '2026-08-19' },
      })).rejects.toThrow('sectorIdentity analysisAsOfDate must match analysisAsOfDate.');
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203', analysisAsOfDate: '2026-08-20',
        sectorSource: { ...sectorSource, issuerCode: '67580' },
      })).rejects.toThrow('sectorSource issuerCode must match ticker.');
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203', analysisAsOfDate: '2026-08-20',
        sectorSource: { ...sectorSource, analysisAsOfDate: '2026-08-19' },
      })).rejects.toThrow('sectorSource analysisAsOfDate must match analysisAsOfDate.');
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects a fabricated same-issuer sector identity before short-ratio fetch', async () => {
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      paths.push(url.pathname);
      if (url.pathname.endsWith('/markets/calendar')) {
        return new Response(JSON.stringify({
          data: [{ Date: '2026-08-20', HolDiv: '1' }],
        }));
      }
      if (url.pathname.endsWith('/equities/master')) {
        return new Response(JSON.stringify({ data: [{
          Date: '2026-08-20', Code: '72030', S33: '3700', S33Nm: '輸送用機器',
        }] }));
      }
      throw new Error('Short-ratio data must not be fetched for a mismatched identity.');
    }) as typeof fetch;

    try {
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        from: '2026-01-01',
        sectorIdentity: {
          analysisAsOfDate: '2026-08-20',
          issuerCode: '72030',
          classificationDate: '2026-08-20',
          sectorCode: '3650',
          sectorName: '電気機器',
          indexCode: '004F',
          provenance: { source: 'jquants', endpoint: '/v2/equities/master' },
        },
      })).rejects.toThrow(
        'sectorIdentity must match the authoritative issuer sector classification.',
      );
      expect(paths).toEqual(['/v2/markets/calendar', '/v2/equities/master']);

      paths.length = 0;
      await expect(analyzeSectorShortRatioTool.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-08-20',
        sectorSource: {
          analysisAsOfDate: '2026-08-20',
          issuerCode: '72030',
          classification: {
            classificationDate: '2026-08-20',
            sectorCode: '3650',
            sectorName: '電気機器',
          },
          rows: [],
          reason: 'no_sector_short_ratio_data',
          error: 'No source rows.',
          provenance: {
            classification: {
              source: 'jquants', endpoint: '/v2/equities/master',
            },
            flow: {
              source: 'jquants', endpoint: '/v2/markets/short-ratio',
            },
          },
        },
      })).rejects.toThrow(
        'sectorSource must match the authoritative issuer sector classification.',
      );
      expect(paths).toEqual(['/v2/markets/calendar', '/v2/equities/master']);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });

  test('delegates technical levels and sourced options to the Strategy Engine', async () => {
    const technical = {
      dataDate: '2026-08-20',
      latestSwingHigh: 4_200,
      latestSwingLow: 4_050,
      atr14: 100,
    };
    const options = { tickSize: 5, resistanceLevels: [4_600] };

    const actual = toolData(await analyzeStrategyTool.invoke({
      technical,
      ...options,
    }));
    expect(actual).toEqual(analyzeStrategy(technical, options));
  });

  test('fetches complete J-Quants histories in direct ticker mode', async () => {
    const priceDates = dates(251);
    const marginDates = Array.from({ length: 52 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 2 + index * 7));
      return date.toISOString().slice(0, 10);
    });
    const originalFetch = globalThis.fetch;
    const previousApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-jquants-key';
    let stockHistoryFetches = 0;
    let topixHistoryFetches = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const href = input instanceof URL
        ? input.href
        : typeof input === 'string'
          ? input
          : input.url;
      const url = new URL(href);
      let data: Record<string, unknown>[];

      if (url.pathname.endsWith('/equities/bars/daily')) {
        stockHistoryFetches += 1;
        data = priceDates.map((date, index) => ({
          Date: date,
          Code: '72030',
          AdjO: 100 + index,
          AdjH: 102 + index,
          AdjL: 99 + index,
          AdjC: 101 + index,
          AdjVo: 1_000 + index,
          Va: null,
        }));
      } else if (url.pathname.endsWith('/markets/margin-interest')) {
        data = marginDates.map((date, index) => ({
          Date: date,
          Code: '72030',
          ShrtVol: 100 + index,
          LongVol: 1_000 + index,
          ShrtNegVol: null,
          LongNegVol: null,
          ShrtStdVol: null,
          LongStdVol: null,
          IssType: '2',
        }));
      } else if (url.pathname.endsWith('/indices/bars/daily/topix')) {
        topixHistoryFetches += 1;
        data = priceDates.map((date, index) => ({
          Date: date,
          O: 200 + index,
          H: 202 + index,
          L: 199 + index,
          C: 201 + index * 1.01,
        }));
      } else {
        throw new Error(`Unexpected test URL: ${url.pathname}`);
      }

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const source = { ticker: '7203', from: '2025-01-01', to: '2026-12-31' };
      const technical = toolData(await analyzeTechnicalTool.invoke(source)) as {
        dataDate: string | null;
        advancedTechnical: { rsi14: number | null; dataDate: string | null };
      };
      expect(stockHistoryFetches).toBe(1);
      const supplyDemand = toolData(await analyzeSupplyDemandTool.invoke(source)) as {
        mean4w: number | null;
        mean52w: number | null;
        unavailable: unknown[];
      };
      const correlation = toolData(await analyzeMarketCorrelationTool.invoke(source)) as {
        alignedPriceCount: number;
        windows: Array<{ period: number; observations: number; unavailable: unknown[] }>;
      };

      expect(technical.dataDate).toBe(priceDates[priceDates.length - 1]);
      expect(technical.advancedTechnical).toMatchObject({
        dataDate: priceDates[priceDates.length - 1],
        rsi14: 100,
      });
      expect(supplyDemand.mean4w).not.toBeNull();
      expect(supplyDemand.mean52w).not.toBeNull();
      expect(supplyDemand.unavailable).toEqual([]);
      expect(correlation.alignedPriceCount).toBe(251);
      expect(correlation.windows.map(window => window.period)).toEqual([20, 60, 250]);
      expect(correlation.windows.find((window) => window.period === 20)).toMatchObject({
        observations: 20,
        unavailable: [],
      });
      expect(correlation.windows.find((window) => window.period === 250)).toMatchObject({
        observations: 250,
        unavailable: [],
      });
      expect(stockHistoryFetches).toBe(3);
      expect(topixHistoryFetches).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApiKey === undefined) delete process.env.JQUANTS_API_KEY;
      else process.env.JQUANTS_API_KEY = previousApiKey;
    }
  });
});
