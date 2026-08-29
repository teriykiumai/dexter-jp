import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { expect, test, type Page } from 'playwright/test';
import {
  AnalysisSnapshotSchema,
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV4Schema,
  AnalysisSnapshotV8Schema,
  AnalysisSnapshotV9Schema,
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotV9,
} from '../../analysis/snapshot/index.js';
import {
  DASHBOARD_TABS,
  buildDashboardAvailabilityNavigation,
  type DashboardTabId,
} from './presentation.js';

function snapshotInput(ticker: string): AnalysisSnapshotInput {
  return {
    identity: {
      canonicalTicker: ticker,
      companyName: `${ticker} テスト株式会社`,
      industry: 'テスト業種',
      listingStatus: 'listed',
      isDelisted: false,
      dataDate: '2026-08-21',
      sourceUrls: ['https://example.test/company'],
    },
    generatedAt: '2026-08-23T01:02:03.000Z',
    fundamental: null,
    valuation: null,
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
    advancedDividend: null,
    volumeProfile: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis\n\nBrowser fixture.',
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

function v9Snapshot(ticker = '1009'): AnalysisSnapshotV9 {
  return buildAnalysisSnapshot(snapshotInput(ticker));
}

const V4_LATER_SECTIONS = [
  'investorTypeFlows',
  'sectorBenchmark',
  'sectorShortRatio',
  'advancedDividend',
  'volumeProfile',
] as const;

const V1_LATER_SECTIONS = [
  'advancedTechnical',
  'reportedShortPositions',
  ...V4_LATER_SECTIONS,
] as const;

function omitProperties(value: object, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function legacySnapshotPayload(
  ticker: string,
  schemaVersion: 1 | 4,
): Record<string, unknown> {
  const v9 = v9Snapshot(ticker);
  const laterSections = schemaVersion === 1 ? V1_LATER_SECTIONS : V4_LATER_SECTIONS;
  const excludedSections = new Set<string>(laterSections);
  const units = omitProperties(v9.units, laterSections);
  if (schemaVersion === 1) {
    units.supplyDemand = omitProperties(v9.units.supplyDemand, ['mean4w']);
  }
  return {
    ...omitProperties(v9, [
      'schemaVersion',
      'dataDates',
      'provenance',
      'units',
      'unavailable',
      ...laterSections,
    ]),
    schemaVersion,
    dataDates: omitProperties(v9.dataDates, laterSections),
    provenance: omitProperties(v9.provenance, laterSections),
    units,
    unavailable: v9.unavailable.filter(item => !excludedSections.has(item.section)),
  };
}

function v4Snapshot(ticker = '1004'): AnalysisSnapshotV4 {
  return AnalysisSnapshotV4Schema.parse(legacySnapshotPayload(ticker, 4));
}

function v1Snapshot(ticker = '1001'): AnalysisSnapshot {
  return AnalysisSnapshotV1Schema.parse(legacySnapshotPayload(ticker, 1));
}

function v8Snapshot(ticker = '1008'): AnalysisSnapshot {
  const v9 = v9Snapshot(ticker);
  return AnalysisSnapshotV8Schema.parse({
    ...omitProperties(v9, [
      'schemaVersion',
      'dataDates',
      'provenance',
      'units',
      'unavailable',
      'volumeProfile',
    ]),
    schemaVersion: 8,
    dataDates: omitProperties(v9.dataDates, ['volumeProfile']),
    provenance: omitProperties(v9.provenance, ['volumeProfile']),
    units: omitProperties(v9.units, ['volumeProfile']),
    unavailable: v9.unavailable.filter(item => item.section !== 'volumeProfile'),
  });
}

function duplicateStateSnapshot(ticker = '1011'): AnalysisSnapshotV9 {
  const snapshot = v9Snapshot(ticker);
  return AnalysisSnapshotV9Schema.parse({
    ...snapshot,
    unavailable: [
      {
        section: 'technical',
        metric: 'rsi14',
        reason: 'missing_data',
        detail: 'same stored detail',
      },
      {
        section: 'technical',
        metric: 'rsi14',
        reason: 'missing_data',
        detail: 'same stored detail',
      },
      { section: 'volumeProfile', reason: 'not_collected' },
    ],
  });
}

function richV9Snapshot(ticker = '1010'): AnalysisSnapshotV9 {
  const snapshot = v9Snapshot(ticker);
  const investorValues = { sell: 10, buy: 20, total: 777, balance: -333 };
  const investorBreakdown = {
    individuals: investorValues,
    foreignInvestors: investorValues,
    securitiesCompanies: investorValues,
    investmentTrusts: investorValues,
    businessCorporations: investorValues,
    otherCorporations: investorValues,
    insuranceCompanies: investorValues,
    banks: investorValues,
    trustBanks: investorValues,
    otherFinancialInstitutions: investorValues,
  };

  return AnalysisSnapshotV9Schema.parse({
    ...snapshot,
    technical: {
      dataDate: '2026-08-21',
      ma20: 2_950,
      atr14: 75,
      averageVolume20: 12_000,
      trend: 'uptrend',
      latestSwingHigh: 3_100,
      latestSwingLow: 2_800,
      unavailable: [],
    },
    advancedTechnical: {
      dataDate: '2026-08-21',
      rsi14: 62.35,
      macd: { value: 42.5, signal: 40.25, histogram: 2.25 },
      bollinger20: { middle: 2_950, upper: 3_100, lower: 2_800 },
      unavailable: [],
    },
    priceHistory: [
      {
        date: '2026-08-19',
        open: 2_900,
        high: 2_980,
        low: 2_880,
        close: 2_960,
        volume: 10_000,
      },
      {
        date: '2026-08-20',
        open: 2_960,
        high: 3_040,
        low: 2_930,
        close: 3_010,
        volume: 0,
      },
      {
        date: '2026-08-21',
        open: 3_010,
        high: 3_080,
        low: 2_990,
        close: 3_050,
        volume: 14_000,
      },
    ],
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
      buyingBalance: 10_000,
      sellingBalance: 5_000,
      marginRatio: 2,
      buyingBalanceWeeklyChange: 100,
      sellingBalanceWeeklyChange: -100,
      mean4w: 9_500,
      mean13w: 9_000,
      mean52w: 8_000,
      deviation52w: 0.25,
      percentile52w: 0.8,
      averageDailyVolume20: 2_000,
      digestionDays: 5,
      unavailable: [],
    },
    marketCorrelation: {
      benchmark: 'TOPIX',
      dataDate: '2026-08-21',
      alignedPriceCount: 21,
      windows: [{
        period: 20,
        startDate: '2026-07-24',
        endDate: '2026-08-21',
        observations: 20,
        correlation: 0.625,
        beta: 1.1,
        alphaAnnualized: 0.02,
        rSquared: 0.390625,
        stockVolatilityAnnualized: 0.25,
        benchmarkVolatilityAnnualized: 0.18,
        excessReturn: 0.03,
        unavailable: [],
      }],
    },
    reportedShortPositions: {
      dataDate: '2026-08-20',
      reports: [
        {
          disclosedDate: '2026-08-20',
          calculatedDate: '2026-08-18',
          reporterName: 'Reporter A',
          discretionaryManagerName: 'Manager A',
          fundName: 'Fund A',
          shortPositionRatio: 0.006,
          shortPositionShares: 120_000,
          previousCalculatedDate: '2026-08-11',
          previousReportedRatio: 0.0054,
          ratioDelta: 0.0005,
        },
        {
          disclosedDate: '2026-08-21',
          calculatedDate: '2026-08-19',
          reporterName: 'Reporter B',
          discretionaryManagerName: null,
          fundName: null,
          shortPositionRatio: 0,
          shortPositionShares: 0,
          previousCalculatedDate: null,
          previousReportedRatio: null,
          ratioDelta: null,
        },
      ],
      unavailable: [],
    },
    investorTypeFlows: {
      dataDate: '2026-08-20',
      section: 'TokyoNagoya',
      period: {
        publishedDate: '2026-08-20',
        periodStartDate: '2026-08-10',
        periodEndDate: '2026-08-14',
        section: 'TokyoNagoya',
        summary: {
          proprietary: investorValues,
          brokerage: investorValues,
          total: investorValues,
        },
        brokerageBreakdown: investorBreakdown,
      },
      unavailable: [],
    },
    advancedDividend: {
      analysisAsOfDate: '2026-08-24',
      collectedAt: '2026-08-24T03:04:05.000Z',
      issuerCode: `${ticker}0`,
      dataDate: '2026-08-21',
      observations: [{
        kind: 'actual',
        fiscalYearEndDate: '2026-03-31',
        disclosedDate: '2026-05-08',
        disclosedTime: '15:00:00',
        sourceEligibleDate: '2026-05-11',
        disclosureNumber: 'summary-actual',
        sourceField: 'DivAnn',
        payoutRatioSourceField: 'PayoutRatioAnn',
        annualDividendPerShare: 120,
        payoutRatio: 0.321,
      }],
      events: [{
        notifiedDate: '2026-08-21',
        notifiedTime: null,
        sourceEligibleDate: '2026-08-24',
        referenceNumber: 'event-one',
        corporateActionReferenceNumber: 'ca-one',
        kind: 'fiscal_year_end',
        decision: 'decided',
        recordDateYearMonth: '2027-03',
        dividendPerShare: 60,
        ordinaryDividendPerShare: 40,
        commemorativeDividendPerShare: 5,
        specialDividendPerShare: 15,
        recordDate: null,
        rightsRecordDate: null,
        exDate: null,
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
    },
    volumeProfile: {
      analysisAsOfDate: '2026-08-21',
      collectedAt: '2026-08-28T03:04:05.000Z',
      issuerCode: `${ticker}0`,
      dataDate: '2026-08-21',
      windowStartDate: '2026-03-03',
      windowEndDate: '2026-08-21',
      inputBarCount: 120,
      priceBasis: 'jquants_corporate_action_adjusted',
      volumeBasis: 'jquants_corporate_action_adjusted',
      allocationMethod: 'uniform_range_overlap_v1',
      binningMethod: {
        id: 'fixed_count_linear_v1',
        requestedBinCount: 50,
        effectiveBinCount: 2,
        minPrice: 1_000,
        maxPrice: 1_020,
      },
      bins: [
        {
          index: 0,
          lowerPrice: 1_000,
          upperPrice: 1_010,
          representativePrice: 1_005,
          allocatedVolume: 510,
          volumeShare: 0.51,
        },
        {
          index: 1,
          lowerPrice: 1_010,
          upperPrice: 1_020,
          representativePrice: 1_015,
          allocatedVolume: 490,
          volumeShare: 0.49,
        },
      ],
      // Presentation sentinel: the stored POC is deliberately not the largest stored bin.
      poc: { binIndex: 1, price: 1_015, allocatedVolume: 490, volumeShare: 0.49 },
      valueArea: {
        targetVolumeShare: 0.7,
        achievedVolumeShare: 1,
        val: 1_000,
        vah: 1_020,
        firstBinIndex: 0,
        lastBinIndex: 1,
      },
      unavailable: [],
      methodology: {
        id: 'daily_ohlcv_volume_profile_proxy_v1',
        approximation: 'uniform_daily_range',
        actualHolderCostBasis: false,
      },
      provenance: {
        source: 'jquants',
        endpoint: '/v2/equities/bars/daily',
        availabilityCalendarEndpoint: '/v2/markets/calendar',
        sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
        adjustmentFactorField: 'AdjFactor',
        exRightsField: 'ExRT',
        basisAudit: 'collection_horizon_rights_audit_v1',
        basisAuditRequiredThroughDate: '2026-08-26',
        basisAuditThroughDate: '2026-08-27',
        corporateActionBasisStatus: 'supported_common_basis_established',
        calculation: 'volume_profile_engine',
      },
      units: {
        price: 'JPY',
        allocatedVolume: 'adjusted_shares',
        volumeShare: 'ratio',
      },
    },
    dataDates: {
      ...snapshot.dataDates,
      technical: '2026-08-21',
      advancedTechnical: '2026-08-21',
      supplyDemand: '2026-08-19',
      marketCorrelation: '2026-08-21',
      reportedShortPositions: '2026-08-20',
      investorTypeFlows: '2026-08-20',
      advancedDividend: '2026-08-21',
      volumeProfile: '2026-08-21',
      priceHistory: '2026-08-21',
    },
    unavailable: snapshot.unavailable.filter(item => ![
      'technical',
      'priceHistory',
      'reportedShortPositions',
      'investorTypeFlows',
      'advancedDividend',
      'volumeProfile',
      'advancedTechnical',
      'supplyDemand',
      'marketCorrelation',
    ].includes(item.section)),
  });
}

const snapshots = new Map<string, AnalysisSnapshot>([
  ['1001', v1Snapshot()],
  ['1004', v4Snapshot()],
  ['1008', v8Snapshot()],
  ['1009', v9Snapshot()],
  ['1010', richV9Snapshot()],
  ['1011', duplicateStateSnapshot()],
]);

const EXPECTED_UNCOLLECTED_SECTIONS = [
  'advancedTechnical',
  'volumeProfile',
  'advancedDividend',
  'reportedShortPositions',
  'investorTypeFlows',
  'sectorBenchmark',
  'sectorShortRatio',
] as const;

function snapshotFor(ticker: string): AnalysisSnapshot {
  const snapshot = snapshots.get(ticker);
  if (!snapshot) throw new Error(`No browser fixture exists for ${ticker}.`);
  return snapshot;
}

function snapshotWithIdentity(
  ticker: string,
  generatedAt: string,
  companyName = `${ticker} テスト株式会社`,
): AnalysisSnapshot {
  return AnalysisSnapshotSchema.parse({
    ...snapshotFor(ticker),
    companyName,
    generatedAt,
  });
}

let dashboardProcess: ChildProcessWithoutNullStreams;
let baseUrl: string;

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port.');
  await new Promise<void>((resolve, reject) => server.close(error => (
    error ? reject(error) : resolve()
  )));
  return address.port;
}

async function waitForServer(process: ChildProcessWithoutNullStreams): Promise<void> {
  let stderr = '';
  process.stderr.on('data', chunk => {
    stderr += String(chunk);
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Dashboard fixture server exited early: ${stderr.trim()}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling the Dashboard bundle.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Dashboard fixture server did not become ready.');
}

async function mockSnapshotApi(
  page: Page,
  responseDelayMs: Readonly<Record<string, number>> = {},
): Promise<void> {
  await page.route('**/api/analyses/*', async route => {
    const ticker = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
    const delay = responseDelayMs[ticker] ?? 0;
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill({
      body: JSON.stringify(snapshotFor(ticker)),
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });
}

interface MockReloadResponse {
  body: unknown;
  delayMs?: number;
  status?: number;
}

async function mockReloadResponses(
  page: Page,
  responses: readonly MockReloadResponse[],
): Promise<void> {
  let responseIndex = 0;
  await page.unroute('**/api/analyses/*');
  await page.route('**/api/analyses/*', async route => {
    const response = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex += 1;
    if (!response) throw new Error('No reload fixture response was configured.');
    if (response.delayMs) {
      await new Promise(resolve => setTimeout(resolve, response.delayMs));
    }
    await route.fulfill({
      body: typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body),
      contentType: 'application/json; charset=utf-8',
      status: response.status ?? 200,
    });
  });
}

async function installAbortIgnoringReloadFetch(
  page: Page,
  ticker: string,
  responses: readonly Required<Pick<MockReloadResponse, 'body' | 'delayMs'>>[],
): Promise<void> {
  await page.evaluate(({ requestedTicker, queuedResponses }) => {
    const originalFetch = window.fetch.bind(window);
    let responseIndex = 0;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string') {
        const requestUrl = new URL(input, window.location.href);
        const response = queuedResponses[responseIndex];
        if (
          requestUrl.pathname === `/api/analyses/${requestedTicker}`
          && response
        ) {
          responseIndex += 1;
          return new Promise<Response>(resolve => {
            window.setTimeout(() => resolve(new Response(JSON.stringify(response.body), {
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
              status: 200,
            })), response.delayMs);
          });
        }
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { requestedTicker: ticker, queuedResponses: responses });
}

async function mockWatchlistApi(page: Page): Promise<void> {
  await page.route('**/api/analyses', async route => {
    await route.fulfill({
      body: '[]',
      contentType: 'application/json; charset=utf-8',
      status: 200,
    });
  });
}

test.beforeAll(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dashboardProcess = spawn(
    'bun',
    [
      '-e',
      `import { startDashboardServer } from './src/dashboard/server.ts'; startDashboardServer(undefined, ${port});`,
    ],
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  await waitForServer(dashboardProcess);
});

test.afterAll(() => {
  dashboardProcess.kill();
});

async function openDetail(
  page: Page,
  ticker = '1009',
  tab: DashboardTabId = 'report',
  query = '',
): Promise<void> {
  await page.goto(`${baseUrl}/?ticker=${ticker}&tab=${tab}${query}`);
  await waitForSelectedTab(page, tab);
}

async function waitForSelectedTab(page: Page, tab: DashboardTabId): Promise<void> {
  await page.waitForFunction(selectedTab => (
    document.getElementById(`dashboard-tab-${selectedTab}`)?.getAttribute('aria-selected') === 'true'
    && document.querySelector(`#dashboard-panel-${selectedTab}:not([hidden])`) !== null
  ), tab);
}

async function expectSelectedTab(page: Page, tab: DashboardTabId): Promise<void> {
  await waitForSelectedTab(page, tab);
  const state = await page.evaluate(selectedTab => ({
    activeElement: document.activeElement instanceof HTMLElement
      ? document.activeElement.id
      : null,
    selected: document.getElementById(`dashboard-tab-${selectedTab}`)?.getAttribute('aria-selected'),
    visiblePanels: document.querySelectorAll('[role="tabpanel"]:not([hidden])').length,
    visiblePanel: document.querySelector('[role="tabpanel"]:not([hidden])')?.id,
  }), tab);
  expect(state.selected).toBe('true');
  expect(state.visiblePanels).toBe(1);
  expect(state.visiblePanel).toBe(`dashboard-panel-${tab}`);
  expect(new URL(page.url()).searchParams.get('tab')).toBe(tab);
}

test.describe('Dashboard detail tab browser interaction', () => {
  test('canonicalizes tab URLs and preserves non-tab query parameters', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await page.goto(`${baseUrl}/?ticker=1009&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'report');
      let url = new URL(page.url());
      expect(url.searchParams.get('tab')).toBe('report');
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');

      await page.goto(`${baseUrl}/?ticker=1009&tab=unknown&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'report');
      url = new URL(page.url());
      expect(url.searchParams.get('tab')).toBe('report');
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');

      await page.goto(`${baseUrl}/?ticker=1009&tab=technical&snapshot=v9&future=keep`);
      await waitForSelectedTab(page, 'technical');
      await page.locator('#dashboard-tab-market').click();
      await expectSelectedTab(page, 'market');
      url = new URL(page.url());
      expect(url.searchParams.get('snapshot')).toBe('v9');
      expect(url.searchParams.get('future')).toBe('keep');
    } finally {
      await page.close();
    }
  });

  test('keeps click, keyboard focus, URL, ARIA, panel, and history synchronized', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page);
      await page.locator('#dashboard-tab-report').focus();
      await page.keyboard.press('ArrowLeft');
      await expectSelectedTab(page, 'market');
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id))
        .toBe('dashboard-tab-market');

      await page.keyboard.press('ArrowRight');
      await expectSelectedTab(page, 'report');
      await page.keyboard.press('End');
      await expectSelectedTab(page, 'market');
      await page.keyboard.press('Home');
      await expectSelectedTab(page, 'report');

      await page.locator('#dashboard-tab-fundamentals').click();
      await expectSelectedTab(page, 'fundamentals');

      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical&future=keep');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expectSelectedTab(page, 'technical');
      await page.getByRole('button', { name: '← Analysis Portfolio' }).focus();
      await page.goBack();
      await expectSelectedTab(page, 'fundamentals');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim()))
        .toBe('← Analysis Portfolio');
      await page.goForward();
      await expectSelectedTab(page, 'technical');
      expect(await page.evaluate(() => document.activeElement?.textContent?.trim()))
        .toBe('← Analysis Portfolio');
    } finally {
      await page.close();
    }
  });

  test('opens metric guidance accessibly and closes it across context changes', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page, { '1009': 2_500 });
      await mockWatchlistApi(page);
      await openDetail(page, '1010', 'technical');

      const rsiInvoker = page.getByRole('button', { name: 'RSIの説明を開く' });
      await rsiInvoker.click();
      const dialog = page.getByRole('dialog', { name: '用語集 / RSI' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('何を測るか', { exact: true })).toBeVisible();
      await expect(dialog.getByText('単位と読み方', { exact: true })).toBeVisible();
      await expect(dialog.getByText('主な制約', { exact: true })).toBeVisible();
      await expect(dialog.getByText('判断上の注意', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '用語集を閉じる' })).toBeFocused();
      await page.locator('#dashboard-tab-report').focus();
      expect(await page.evaluate(() => (
        document.querySelector('dialog')?.contains(document.activeElement) ?? false
      ))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(rsiInvoker).toBeFocused();

      await rsiInvoker.click();
      await page.evaluate(() => {
        window.history.replaceState({}, '', '/?ticker=1010&tab=technical&future=changed');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(dialog).toBeHidden();
      await expect(rsiInvoker).toBeFocused();

      const glossaryInvoker = page.getByRole('button', { name: '用語集', exact: true });
      await glossaryInvoker.click();
      const glossary = page.getByRole('dialog', { name: '用語集', exact: true });
      await expect(glossary).toBeVisible();
      await page.setViewportSize({ width: 320, height: 568 });
      const glossaryLayout = await glossary.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          left: rect.left,
          right: rect.right,
        };
      });
      expect(glossaryLayout.documentOverflow).toBeLessThanOrEqual(0);
      expect(glossaryLayout.left).toBeGreaterThanOrEqual(0);
      expect(glossaryLayout.right).toBeLessThanOrEqual(320);
      await glossary.getByRole('button', { name: /ATR/ }).click();
      await expect(page.getByRole('dialog', { name: '用語集 / ATR' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(glossaryInvoker).toBeFocused();

      await rsiInvoker.click();
      await page.evaluate(() => {
        window.history.replaceState({}, '', '/?ticker=1010&tab=market');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expectSelectedTab(page, 'market');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.locator('#dashboard-tab-market')).toBeFocused();

      await page.getByRole('button', { name: '投資部門別売買の説明を開く' }).click();
      await expect(page.getByRole('dialog', { name: '用語集 / 投資部門別売買' }))
        .toBeVisible();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByText('1009 Snapshotを読み込み中…')).toBeVisible();
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#dashboard-tab-technical')).toBeFocused();

      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      const watchlistHeading = page.getByRole('heading', { name: 'Saved Analysis' });
      await expect(watchlistHeading).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(watchlistHeading).toBeFocused();
    } finally {
      await page.close();
    }
  });

  test('presents Snapshot-only price and volume panes with persistent line toggles', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');

      const chart = page.getByRole('img', {
        name: '調整後日足ローソク足と日次出来高の同期チャート',
      });
      await expect(chart).toBeVisible();
      const descriptionId = await chart.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      const description = page.locator(`#${descriptionId}`);
      await expect(description).toContainText('2026-08-19から2026-08-21');
      await expect(description).toContainText('保存済み最新行の終値 ¥3,050');
      await expect(description).toContainText('SMA 20 ¥2,950');
      await expect(description).toContainText('Swing High ¥3,100');
      await expect(description).toContainText('Swing Low ¥2,800');

      const paneHeights = await chart.evaluate(element => {
        const table = element.querySelector('table');
        return table
          ? [...table.rows]
              .map(row => row.getBoundingClientRect().height)
              .filter(height => height > 50)
          : [];
      });
      expect(paneHeights.length).toBeGreaterThanOrEqual(2);
      const pricePaneShare = paneHeights[0]! / (paneHeights[0]! + paneHeights[1]!);
      expect(pricePaneShare).toBeGreaterThan(0.64);
      expect(pricePaneShare).toBeLessThan(0.76);

      await chart.scrollIntoViewIfNeeded();
      const chartBox = await chart.boundingBox();
      expect(chartBox).not.toBeNull();
      const timeAxisClip = {
        x: chartBox!.x + 30,
        y: chartBox!.y + chartBox!.height - 28,
        width: chartBox!.width - 90,
        height: 24,
      };
      await page.mouse.move(1, 1);
      const fitContentAxis = await page.screenshot({ clip: timeAxisClip });
      await page.mouse.move(
        chartBox!.x + chartBox!.width / 2,
        chartBox!.y + chartBox!.height / 2,
      );
      await page.mouse.wheel(0, -800);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      const zoomedAxis = await page.screenshot({ clip: timeAxisClip });
      expect(zoomedAxis.equals(fitContentAxis)).toBe(false);

      const latest = page.getByRole('region', { name: '最新値' });
      await expect(latest).toContainText('データ基準日 2026-08-21');
      await expect(latest).toContainText('crosshair日付とは連動しません');
      await expect(latest.getByText('RSI 14', { exact: true })).toBeVisible();
      await expect(latest.getByText('MACD', { exact: true })).toBeVisible();
      await expect(latest.getByText('ボリンジャー中心線', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'テクニカル指標', exact: true }))
        .toHaveCount(0);

      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'true');
      await smaToggle.click();
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
      await expect(description).not.toContainText('SMA 20');
      await expect(description).toContainText('Swing High ¥3,100');
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      const toggledAxis = await page.screenshot({ clip: timeAxisClip });
      expect(toggledAxis.equals(zoomedAxis)).toBe(true);

      await page.locator('#dashboard-tab-report').click();
      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'false');

      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1010&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1010 テスト株式会社' }).waitFor();
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'true');

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileLayout = await page.evaluate(() => {
        const chartBox = document.querySelector('.price-chart')!.getBoundingClientRect();
        const legendBox = document.querySelector('.chart-legend')!.getBoundingClientRect();
        const latestBox = document.querySelector('.chart-latest-values')!.getBoundingClientRect();
        return {
          chartBottom: chartBox.bottom,
          chartHeight: chartBox.height,
          legendTop: legendBox.top,
          legendBottom: legendBox.bottom,
          latestTop: latestBox.top,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(mobileLayout.chartHeight).toBeGreaterThanOrEqual(390);
      expect(mobileLayout.legendTop).toBeGreaterThanOrEqual(mobileLayout.chartBottom);
      expect(mobileLayout.latestTop).toBeGreaterThanOrEqual(mobileLayout.legendBottom);
      expect(mobileLayout.overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.close();
    }
  });

  test('reloads with GET only and preserves every local state for an unchanged identity', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      const requests: Array<{ method: string; pathname: string }> = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
          requests.push({ method: request.method(), pathname: url.pathname });
        }
      });
      await mockReloadResponses(page, [{ body: snapshotFor('1010'), delayMs: 500 }]);

      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      const displayedGeneratedAt = (await page.locator('.generated-at').textContent())
        ?.replace(/^生成日時\s*/, '') ?? '';

      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      await reload.click();
      const feedback = page.locator('.snapshot-reload-feedback');
      await expect(feedback).toHaveText('保存済みSnapshotを再読み込み中…');
      await expect(reload).toHaveAttribute('aria-busy', 'true');
      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();

      await expect(feedback).toContainText('変更なし。');
      await expect(feedback).toContainText(`表示中の生成日時 ${displayedGeneratedAt}`);
      await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
      await expect(feedback).toHaveAttribute('aria-live', 'polite');
      await expect(reload).toHaveAttribute('aria-busy', 'false');
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');
      await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
      expect(requests).toEqual([{ method: 'GET', pathname: '/api/analyses/1010' }]);
    } finally {
      await page.close();
    }
  });

  test('replaces a newer identity while preserving only the selected tab', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      const updated = snapshotWithIdentity('1010', '2026-08-24T02:03:04.000Z');
      await mockReloadResponses(page, [{ body: updated, delayMs: 500 }]);

      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      await page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      }).click();
      await page.getByRole('button', { name: '用語集', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();

      const feedback = page.locator('.snapshot-reload-feedback');
      await expect(feedback).toContainText('更新。');
      await expectSelectedTab(page, 'technical');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(bins).not.toHaveAttribute('open', '');
      await expect(page.getByRole('button', { name: /SMA 20/ }))
        .toHaveAttribute('aria-pressed', 'true');
      const displayedGeneratedAt = (await page.locator('.generated-at').textContent())
        ?.replace(/^生成日時\s*/, '') ?? '';
      await expect(feedback).toContainText(`表示中の生成日時 ${displayedGeneratedAt}`);
      await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
    } finally {
      await page.close();
    }
  });

  test('keeps the current Snapshot and UI state for every reload validation failure', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      await mockReloadResponses(page, [
        { body: '{', delayMs: 300 },
        { body: {} },
        { body: snapshotFor('1009') },
        { body: {}, status: 404 },
        { body: {}, status: 500 },
      ]);
      const bins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await bins.locator('summary').click();
      const smaToggle = page.getByRole('button', { name: /SMA 20/ });
      await smaToggle.click();
      const generatedAt = await page.locator('.generated-at').textContent();
      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      const feedback = page.locator('.snapshot-reload-feedback');
      const expectedErrors = [
        'Snapshot JSONを読み込めませんでした。',
        'Snapshotの形式を検証できませんでした。',
        'Snapshotの銘柄が表示中の銘柄と一致しません。',
        '1010 の保存済みSnapshotがありません。',
        'Snapshotを読み込めませんでした。',
      ];

      for (const [index, expectedError] of expectedErrors.entries()) {
        await reload.click();
        if (index === 0) {
          await page.getByRole('button', { name: '用語集', exact: true }).click();
        }
        await expect(feedback).toContainText(`エラー: ${expectedError}`);
        await expect(feedback).toContainText('外部ソースからの最新データ取得・再分析は実行していません');
        await expect(page.locator('.generated-at')).toHaveText(generatedAt ?? '');
        await expectSelectedTab(page, 'technical');
        await expect(bins).toHaveAttribute('open', '');
        await expect(smaToggle).toHaveAttribute('aria-pressed', 'false');
        if (index === 0) {
          await expect(page.getByRole('dialog', { name: '用語集', exact: true })).toBeVisible();
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await page.close();
    }
  });

  test('ignores stale reloads after a newer request, ticker change, or list navigation', async ({ browser }) => {
    const page = await browser.newPage();
    const listPage = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');
      await installAbortIgnoringReloadFetch(page, '1010', [
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T01:00:00.000Z',
            '1010 stale first request',
          ),
          delayMs: 500,
        },
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T02:00:00.000Z',
            '1010 latest request',
          ),
          delayMs: 50,
        },
        {
          body: snapshotWithIdentity(
            '1010',
            '2026-08-24T03:00:00.000Z',
            '1010 stale after ticker change',
          ),
          delayMs: 500,
        },
      ]);
      const reload = page.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      });
      await reload.click();
      await reload.click();
      await page.getByRole('heading', { name: '1010 latest request' }).waitFor();
      await page.waitForTimeout(600);
      await expect(page.getByRole('heading', { name: '1010 latest request' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '1010 stale first request' })).toHaveCount(0);

      await reload.click();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.waitForTimeout(600);
      await expect(page.getByRole('heading', { name: '1009 テスト株式会社' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '1010 stale after ticker change' }))
        .toHaveCount(0);

      await mockSnapshotApi(listPage);
      await mockWatchlistApi(listPage);
      await openDetail(listPage, '1010', 'technical');
      await installAbortIgnoringReloadFetch(listPage, '1010', [{
        body: snapshotWithIdentity(
          '1010',
          '2026-08-24T04:00:00.000Z',
          '1010 stale after list navigation',
        ),
        delayMs: 500,
      }]);
      await listPage.getByRole('button', {
        name: '保存済みSnapshotを再読み込み',
        exact: true,
      }).click();
      await listPage.getByRole('button', { name: '← Analysis Portfolio' }).click();
      await expect(listPage.getByRole('heading', { name: 'Saved Analysis' })).toBeVisible();
      await listPage.waitForTimeout(600);
      await expect(listPage.getByRole('heading', { name: 'Saved Analysis' })).toBeVisible();
      await expect(listPage.getByRole('heading', { name: '1010 stale after list navigation' }))
        .toHaveCount(0);
    } finally {
      await page.close();
      await listPage.close();
    }
  });

  test('keeps initial vertical position and every tab reachable on narrow screens', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    try {
      await mockSnapshotApi(page);
      await openDetail(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await openDetail(page, '1009', 'market');
      const directLinkLayout = await page.evaluate(() => {
        const selected = document.getElementById('dashboard-tab-market')!.getBoundingClientRect();
        const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!;
        const listRect = tablist.getBoundingClientRect();
        const cueStyle = getComputedStyle(tablist.parentElement!, '::after');
        const cueWidth = cueStyle.display === 'none' ? 0 : Number.parseFloat(cueStyle.width);
        return {
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          scrollLeft: tablist.scrollLeft,
          selectedLeft: selected.left,
          selectedRight: selected.right,
          listLeft: listRect.left,
          listVisibleRight: listRect.right - cueWidth,
        };
      });
      expect(directLinkLayout.scrollLeft).toBeGreaterThan(0);
      expect(directLinkLayout.selectedLeft).toBeGreaterThanOrEqual(directLinkLayout.listLeft);
      expect(directLinkLayout.selectedRight).toBeLessThanOrEqual(
        directLinkLayout.listVisibleRight,
      );
      expect(directLinkLayout.documentOverflow).toBeLessThanOrEqual(0);

      await page.evaluate(() => window.scrollTo(0, 400));
      const stickyScrollY = await page.evaluate(() => window.scrollY);
      await page.locator('#dashboard-tab-market').focus();
      for (const key of ['Home', 'End', 'ArrowLeft'] as const) {
        await page.keyboard.press(key);
        const selectedTab = key === 'Home' ? 'report' : key === 'End' ? 'market' : 'supply-demand';
        await expectSelectedTab(page, selectedTab);
        const stickyState = await page.evaluate(() => {
          const rect = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
          return { bottom: rect.bottom, scrollY: window.scrollY, top: rect.top };
        });
        expect(stickyState.top).toBeGreaterThanOrEqual(0);
        expect(stickyState.bottom).toBeLessThanOrEqual(568);
        expect(stickyState.scrollY).toBe(stickyScrollY);
      }

      const viewports = [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 680, height: 960 },
        { width: 768, height: 1_024 },
        { width: 980, height: 720 },
        { width: 1_024, height: 768 },
        { width: 1_280, height: 800 },
      ];
      for (const viewport of viewports) {
        const { width, height } = viewport;
        await page.setViewportSize(viewport);
        await openDetail(page);
        await page.locator('#dashboard-tab-report').focus();
        for (const tab of DASHBOARD_TABS) {
          await expectSelectedTab(page, tab.id);
          const layout = await page.evaluate(selectedTab => {
            const selected = document.getElementById(`dashboard-tab-${selectedTab}`)!
              .getBoundingClientRect();
            const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!;
            const listRect = tablist.getBoundingClientRect();
            const cueStyle = getComputedStyle(tablist.parentElement!, '::after');
            const cueWidth = cueStyle.display === 'none' ? 0 : Number.parseFloat(cueStyle.width);
            const overflowingElements = [...document.querySelectorAll<HTMLElement>('body *')]
              .filter(element => element.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 10)
              .map(element => {
                const rect = element.getBoundingClientRect();
                return [
                  `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
                  `left=${rect.left.toFixed(1)}`,
                  `right=${rect.right.toFixed(1)}`,
                  `width=${rect.width.toFixed(1)}`,
                  `text=${element.textContent?.trim().slice(0, 30) ?? ''}`,
                ].join(' ');
              });
            return {
              documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
              overflowingElements,
              selectedLeft: selected.left,
              selectedRight: selected.right,
              listLeft: listRect.left,
              listVisibleRight: listRect.right - cueWidth,
              tablistTop: listRect.top,
              tablistBottom: listRect.bottom,
            };
          }, tab.id);
          expect(
            layout.documentOverflow,
            `${width}px ${tab.id}: ${layout.overflowingElements.join(', ')}`,
          ).toBeLessThanOrEqual(0);
          expect(layout.selectedLeft).toBeGreaterThanOrEqual(layout.listLeft);
          expect(layout.selectedRight).toBeLessThanOrEqual(layout.listVisibleRight);
          expect(layout.tablistTop).toBeGreaterThanOrEqual(0);
          expect(layout.tablistBottom).toBeLessThanOrEqual(height);
          if (tab.id !== DASHBOARD_TABS.at(-1)!.id) await page.keyboard.press('ArrowRight');
        }
      }
    } finally {
      await page.close();
    }
  });

  test('shows separate unavailable and uncollected navigation states for V1, V4, V8, and V9', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      for (const ticker of ['1001', '1004', '1008', '1009']) {
        const availability = buildDashboardAvailabilityNavigation(snapshotFor(ticker));
        await openDetail(page, ticker);

        const overview = page.getByLabel('Snapshotのデータ利用状況');
        await expect(overview).toContainText(`利用不可 ${availability.global.unavailable}`);
        await expect(overview).toContainText(`未収集 ${availability.global.uncollected}`);
        await expect(overview).toContainText('このSnapshotでは未収集の項目です');

        for (const tab of DASHBOARD_TABS) {
          const button = page.locator(`#dashboard-tab-${tab.id}`);
          const counts = availability.tabs[tab.id];
          if (counts.unavailable > 0) {
            await expect(button).toContainText(`利用不可 ${counts.unavailable}`);
          }
          if (counts.uncollected > 0) {
            await expect(button).toContainText(`未収集 ${counts.uncollected}`);
          }
        }

        const uncollected = page.getByRole('region', { name: '未収集セクション' });
        const storedRecords = page.getByRole('region', {
          name: '保存済みデータ状態レコード',
        });
        await expect(uncollected).toBeVisible();
        const uncollectedSections = await uncollected.locator('li strong').allTextContents();
        expect(uncollectedSections).toEqual([...EXPECTED_UNCOLLECTED_SECTIONS]);
        expect(new Set(uncollectedSections).size).toBe(7);
        expect(await uncollected.getByText('fundamental', { exact: true }).count()).toBe(0);
        await expect(storedRecords.locator('li').filter({ hasText: 'fundamental' }))
          .toContainText('missing_required_section');
        expect(await page.getByRole('heading', { name: '利用不可データ', exact: true }).count())
          .toBe(0);
      }
    } finally {
      await page.close();
    }
  });

  test('keeps exact duplicate and not-collected raw records reachable under a neutral heading', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1011');

      const uncollected = page.getByRole('region', { name: '未収集セクション' });
      const storedRecords = page.getByRole('region', {
        name: '保存済みデータ状態レコード',
      });
      expect(await uncollected.locator('li strong').allTextContents()).toEqual(['volumeProfile']);
      expect(await storedRecords.locator('li strong').allTextContents()).toEqual([
        'technical / rsi14',
        'technical / rsi14',
        'volumeProfile',
      ]);
      expect(await storedRecords.locator('li span').allTextContents()).toEqual([
        'missing_data',
        'missing_data',
        'not_collected',
      ]);
      expect(await storedRecords.locator('li small').allTextContents()).toEqual([
        'same stored detail',
        'same stored detail',
      ]);
    } finally {
      await page.close();
    }
  });

  test('keeps summaries visible and preserves or resets native disclosures by Snapshot identity', async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await mockSnapshotApi(page);
      await openDetail(page, '1010', 'technical');

      const technicalPanel = page.locator('#dashboard-panel-technical');
      const methodology = technicalPanel.locator('details').filter({
        hasText: '算出方法・データ基準',
      });
      const bins = technicalPanel.locator('details').filter({
        hasText: '価格帯別分布 2件',
      });
      await expect(technicalPanel.getByRole('heading', {
        name: 'POC（最大出来高価格帯）',
        exact: true,
      }))
        .toBeVisible();
      await expect(technicalPanel.getByText('¥1,015', { exact: true }).first()).toBeVisible();
      await expect(technicalPanel.getByText('490 調整後株', { exact: true }).first())
        .toBeVisible();
      await expect(technicalPanel.getByText('目標出来高比率', { exact: true }))
        .toBeVisible();
      await expect(methodology).not.toHaveAttribute('open', '');
      await expect(bins).not.toHaveAttribute('open', '');
      await expect(page.getByRole('region', { name: '出来高価格分布の価格帯別データ' }))
        .toBeHidden();

      const profileChart = page.getByRole('region', {
        name: '保存済み出来高価格分布チャート',
      });
      await expect(profileChart).toBeVisible();
      const profileBins = profileChart.locator('[data-volume-profile-bin]');
      await expect(profileBins).toHaveCount(2);
      await expect(profileBins.nth(0)).toHaveAttribute('data-poc', 'false');
      await expect(profileBins.nth(0)).toHaveAttribute('data-value-area', 'true');
      await expect(profileBins.nth(0).locator('meter')).toHaveAttribute('value', '0.51');
      await expect(profileBins.nth(0).locator('meter')).toHaveAttribute('max', '1');
      await expect(profileBins.nth(1)).toHaveAttribute('data-poc', 'true');
      await expect(profileBins.nth(1)).toHaveAttribute('data-value-area', 'true');
      await expect(profileBins.nth(1).locator('meter')).toHaveAttribute('value', '0.49');
      await expect(profileBins.nth(1).locator('meter')).toHaveAttribute('max', '1');
      await expect(technicalPanel.getByText(
        'POC・VAL・VAHは支持線・抵抗線や売買シグナルを意味しません。正確な保存値は下の全件表で確認できます。',
        { exact: true },
      )).toBeVisible();

      await bins.locator('summary').click();
      const binsTable = page.getByRole('region', { name: '出来高価格分布の価格帯別データ' });
      await expect(binsTable).toBeVisible();
      expect(await binsTable.locator('tbody tr th').allTextContents()).toEqual(['0', '1']);
      await expect(binsTable.getByText('510 調整後株', { exact: true })).toBeVisible();

      await page.locator('#dashboard-tab-market').click();
      await expectSelectedTab(page, 'market');
      const marketPanel = page.locator('#dashboard-panel-market');
      const brokerage = marketPanel.locator('details').filter({
        hasText: '委託内訳 10区分',
      });
      await expect(page.getByRole('region', { name: '投資部門別売買の集計' })).toBeVisible();
      await expect(marketPanel.getByText('777 千円', { exact: true }).first()).toBeVisible();
      await expect(brokerage).not.toHaveAttribute('open', '');
      await brokerage.locator('summary').click();
      const brokerageTable = page.getByRole('region', { name: '投資部門別売買の委託内訳' });
      await expect(brokerageTable).toBeVisible();
      expect(await brokerageTable.locator('tbody tr').count()).toBe(10);
      await expect(brokerageTable.getByText('777 千円', { exact: true }).first()).toBeVisible();

      await page.locator('#dashboard-tab-supply-demand').click();
      await expectSelectedTab(page, 'supply-demand');
      const shortReports = page.locator('#dashboard-panel-supply-demand details').filter({
        hasText: '公開報告 2件',
      });
      await expect(shortReports).toHaveAttribute('open', '');
      await expect(shortReports).toContainText('データ基準日 2026-08-20');
      const reportsTable = page.getByRole('region', { name: '公開空売り残高報告の全報告' });
      expect(await reportsTable.locator('tbody tr td:nth-child(3)').allTextContents())
        .toEqual(['Reporter A', 'Reporter B']);
      await expect(reportsTable.getByText('0%', { exact: true })).toBeVisible();
      await expect(reportsTable.getByText('0 株', { exact: true })).toBeVisible();

      await page.locator('#dashboard-tab-fundamentals').click();
      await expectSelectedTab(page, 'fundamentals');
      const advancedDividend = page.locator('#dashboard-panel-fundamentals details').filter({
        hasText: '年間観測 1件',
      });
      await expect(advancedDividend).toHaveAttribute('open', '');
      await expect(advancedDividend).toContainText('配当イベント 1件');
      await expect(advancedDividend).toContainText('データ基準日 2026-08-21');
      await expect(advancedDividend.getByText('¥120 / 株', { exact: true })).toBeVisible();
      await expect(advancedDividend.getByText('¥60 / 株', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: '配当分析の年間観測' })).toBeVisible();
      await expect(page.getByRole('region', { name: '配当分析の配当イベント' })).toBeVisible();

      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');
      await page.locator('#dashboard-tab-report').click();
      await page.locator('#dashboard-tab-technical').click();
      await expectSelectedTab(page, 'technical');
      await expect(bins).toHaveAttribute('open', '');

      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        for (const tab of ['technical', 'fundamentals', 'supply-demand', 'market'] as const) {
          await page.locator(`#dashboard-tab-${tab}`).click();
          await expectSelectedTab(page, tab);
          expect(await page.evaluate(() => (
            document.documentElement.scrollWidth - window.innerWidth
          ))).toBeLessThanOrEqual(0);
        }
      }
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1009&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1009 テスト株式会社' }).waitFor();
      await page.evaluate(() => {
        window.history.pushState({}, '', '/?ticker=1010&tab=technical');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByRole('heading', { name: '1010 テスト株式会社' }).waitFor();
      const resetBins = page.locator('#dashboard-panel-technical details').filter({
        hasText: '価格帯別分布 2件',
      });
      await expect(resetBins).not.toHaveAttribute('open', '');
    } finally {
      await page.close();
    }
  });

  test('keeps the approved section headings reachable in V1, V4, and V9', async ({ browser }) => {
    const page = await browser.newPage();
    const headingsByTab = {
      report: ['総合レポート'],
      technical: [
        '株価チャート',
        '価格線',
        '最新値',
        '出来高価格分布（Volume Profile）',
        '戦略水準',
      ],
      fundamentals: ['同業比較', '配当分析'],
      'supply-demand': ['信用需給', '公開空売り残高報告'],
      market: ['投資部門別売買', '市場相関', '業種指数比較', '業種別空売り売買代金'],
    } as const satisfies Record<DashboardTabId, readonly string[]>;
    try {
      await mockSnapshotApi(page);
      for (const ticker of ['1001', '1004', '1009']) {
        await openDetail(page, ticker);
        expect(await page.locator('[role="tab"]').count()).toBe(DASHBOARD_TABS.length);
        for (const tab of DASHBOARD_TABS) {
          await page.locator(`#dashboard-tab-${tab.id}`).click();
          await expectSelectedTab(page, tab.id);
          const panel = page.locator(`#dashboard-panel-${tab.id}`);
          for (const heading of headingsByTab[tab.id]) {
            expect(await panel.getByRole('heading', { name: heading, exact: true }).count()).toBe(1);
          }
        }
      }
    } finally {
      await page.close();
    }
  });
});
