import { describe, expect, test } from 'bun:test';
import {
  buildAnalysisSnapshot,
  type AnalysisSnapshotInput,
} from '../../analysis/snapshot/index.js';
import { mapSnapshotToDashboard } from './presentation.js';

function snapshotInput(
  advancedDividend: AnalysisSnapshotInput['advancedDividend'],
): AnalysisSnapshotInput {
  return {
    identity: {
      canonicalTicker: '7203',
      companyName: 'トヨタ自動車株式会社',
      industry: '輸送用機器',
      listingStatus: 'listed',
      isDelisted: false,
      dataDate: '2026-08-21',
      sourceUrls: ['https://example.test/company'],
    },
    generatedAt: '2026-08-23T01:02:03.000Z',
    fundamental: null,
    valuation: {
      priceDataDate: '2026-08-21',
      financialDataDate: '2026-06-10',
      latestFiscalYear: 2026,
      currentPrice: 3_000,
      per: 15,
      pbr: 1.2,
      dividendYieldPercent: 2.5,
      revenueCagrPercent: null,
      cagrStartFiscalYear: null,
      cagrEndFiscalYear: null,
      cagrPeriods: null,
      unavailable: [{ metric: 'revenueCagrPercent', reason: 'insufficient_financial_history' }],
    },
    peerComparison: null,
    peerCandidateMarketCapsComplete: null,
    technical: null,
    advancedTechnical: null,
    supplyDemand: null,
    reportedShortPositions: null,
    investorTypeFlows: null,
    marketCorrelation: null,
    sectorBenchmark: null,
    sectorShortRatio: null,
    advancedDividend,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: [],
    investorTypeFlowSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
      reportedShortPositions: { sourceFromJQuants: false },
      investorTypeFlows: { sourceFromJQuants: false, calendarFromJQuants: false },
      sectorBenchmark: { stockFromJQuants: false },
    },
    additionalUnavailable: [],
  };
}

function advancedDividend(
  overrides: Partial<NonNullable<AnalysisSnapshotInput['advancedDividend']>> = {},
): NonNullable<AnalysisSnapshotInput['advancedDividend']> {
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-21T10:00:00.000Z',
    issuerCode: '72030',
    dataDate: '2026-08-20',
    observations: [
      {
        kind: 'actual',
        fiscalYearEndDate: '2027-03-31',
        disclosedDate: '2026-08-20',
        disclosedTime: '15:00:00',
        sourceEligibleDate: '2026-08-21',
        disclosureNumber: '20260820000001',
        sourceField: 'DivAnn',
        payoutRatioSourceField: 'PayoutRatioAnn',
        annualDividendPerShare: 90,
        payoutRatio: 0.32,
      },
      {
        kind: 'company_forecast',
        fiscalYearEndDate: '2027-03-31',
        disclosedDate: '2026-08-20',
        disclosedTime: '15:00:00',
        sourceEligibleDate: '2026-08-21',
        disclosureNumber: '20260820000001',
        sourceField: 'FDivAnn',
        payoutRatioSourceField: 'FPayoutRatioAnn',
        annualDividendPerShare: 100,
        payoutRatio: 0.35,
      },
    ],
    events: [{
      notifiedDate: '2026-08-20',
      notifiedTime: '15:00',
      sourceEligibleDate: '2026-08-21',
      referenceNumber: 'event-1',
      corporateActionReferenceNumber: 'event-1',
      kind: 'fiscal_year_end',
      decision: 'forecast',
      recordDateYearMonth: '2027-03',
      dividendPerShare: 50,
      ordinaryDividendPerShare: 35,
      commemorativeDividendPerShare: 5,
      specialDividendPerShare: 10,
      recordDate: '2027-03-31',
      rightsRecordDate: '2027-03-31',
      exDate: '2027-03-30',
      paymentDate: null,
    }],
    unavailable: [],
    provenance: {
      financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
      dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
      availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
      calculation: { source: 'advanced_dividend_engine' },
    },
    units: { dividendPerShare: 'JPY_per_share', payoutRatio: 'ratio' },
    ...overrides,
  };
}

describe('Advanced Dividend dashboard presentation', () => {
  test('keeps existing yield, actual/forecast amounts, payout ratios, and event components distinct', () => {
    const snapshot = buildAnalysisSnapshot(snapshotInput(advancedDividend()));
    const view = mapSnapshotToDashboard(snapshot).advancedDividend;

    expect(view.state).toBe('available');
    expect(view.eventState).toBe('available');
    expect(view.existingDividendYield.text).toBe('2.5%');
    expect(view.observations.map(item => ({
      kind: item.kind,
      sourceField: item.sourceField,
      amount: item.annualDividendPerShare.text,
      payoutRatio: item.payoutRatio.text,
    }))).toEqual([
      { kind: 'actual', sourceField: 'DivAnn', amount: '¥90 / 株', payoutRatio: '32%' },
      {
        kind: 'company_forecast',
        sourceField: 'FDivAnn',
        amount: '¥100 / 株',
        payoutRatio: '35%',
      },
    ]);
    expect(view.events[0]).toMatchObject({
      referenceNumber: 'event-1',
      dividendPerShare: { text: '¥50 / 株', available: true },
      ordinaryDividendPerShare: { text: '¥35 / 株', available: true },
      commemorativeDividendPerShare: { text: '¥5 / 株', available: true },
      specialDividendPerShare: { text: '¥10 / 株', available: true },
    });
    expect(mapSnapshotToDashboard(snapshot).dataDates).toContainEqual({
      label: 'Advanced Dividend',
      value: { text: '2026-08-20', available: true },
    });
  });

  test('does not turn optional Premium unavailability into zero or ordinary-only detail', () => {
    const result = advancedDividend({
      events: null,
      unavailable: [{ scope: 'event', reason: 'event_source_plan_unavailable' }],
      provenance: {
        financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
        dividendEvents: null,
        availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
        calculation: { source: 'advanced_dividend_engine' },
      },
    });
    const view = mapSnapshotToDashboard(buildAnalysisSnapshot(snapshotInput(result)))
      .advancedDividend;

    expect(view.state).toBe('available');
    expect(view.eventState).toBe('unavailable');
    expect(view.events).toEqual([]);
    expect(view.observations).toHaveLength(2);
    expect(view.unavailableReasons).toContain('event: event source plan unavailable');
  });

  test('distinguishes a known empty replay from unavailable and uncollected event detail', () => {
    const knownEmpty = mapSnapshotToDashboard(buildAnalysisSnapshot(snapshotInput(
      advancedDividend({ events: [] }),
    ))).advancedDividend;
    const uncollected = mapSnapshotToDashboard(buildAnalysisSnapshot(snapshotInput(null)))
      .advancedDividend;

    expect(knownEmpty.eventState).toBe('known_empty');
    expect(knownEmpty.events).toEqual([]);
    expect(uncollected.state).toBe('not_collected');
    expect(uncollected.eventState).toBe('not_collected');
    expect(uncollected.existingDividendYield.text).toBe('2.5%');
    expect(uncollected.observations).toEqual([]);
  });
});
