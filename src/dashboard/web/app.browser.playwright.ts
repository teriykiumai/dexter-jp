import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { expect, test, type Page } from 'playwright/test';
import {
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV4Schema,
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotV9,
} from '../../analysis/snapshot/index.js';
import { DASHBOARD_TABS, type DashboardTabId } from './presentation.js';

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

const snapshots = new Map<string, AnalysisSnapshot>([
  ['1001', v1Snapshot()],
  ['1004', v4Snapshot()],
  ['1009', v9Snapshot()],
]);

function snapshotFor(ticker: string): AnalysisSnapshot {
  const snapshot = snapshots.get(ticker);
  if (!snapshot) throw new Error(`No browser fixture exists for ${ticker}.`);
  return snapshot;
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

async function mockSnapshotApi(page: Page): Promise<void> {
  await page.route('**/api/analyses/*', async route => {
    const ticker = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
    await route.fulfill({
      body: JSON.stringify(snapshotFor(ticker)),
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

  test('keeps the approved section headings reachable in V1, V4, and V9', async ({ browser }) => {
    const page = await browser.newPage();
    const headingsByTab = {
      report: ['総合レポート'],
      technical: ['株価チャート', 'テクニカル指標', '出来高価格分布（Volume Profile）', '戦略水準'],
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
