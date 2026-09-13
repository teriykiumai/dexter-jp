import { test, expect } from 'playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspaceTechnicalHistory } from '../../analysis/workspace/technical-test-fixtures.js';
import { buildTechnicalFromInputsV1 } from '../../analysis/market-data/technical-source.js';
import { WorkspaceTechnicalCodec } from '../../analysis/workspace/technical-artifact.js';
import { projectWorkspaceChart } from '../workspace-chart.js';

let child: ChildProcessWithoutNullStreams, base: string;
test.use({ hasTouch: true });
test.beforeEach(async () => {
  child = spawn('bun', [fileURLToPath(new URL('../workspace-browser-fixture.ts', import.meta.url))], { stdio: 'pipe' });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 15_000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}`)); });
  });
});
test.afterEach(async () => { child.kill(); await new Promise<void>(resolve => child.once('exit', () => resolve())); });

test('no Snapshot/key: explicit acquisition, chart intervals, favorite, back and reload', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}workspace`);
  await expect(page.getByRole('heading', { name: 'Stock Workspace', exact: true })).toBeVisible();
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  await expect(page.getByText('価格データは未取得です。日足データを明示取得してください。')).toBeVisible();
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('heading', { name: '価格・出来高', exact: true })).toBeVisible({ timeout: 30_000 });
  const calls = await (await page.request.get(`${base}test/counts`)).json();
  await page.getByLabel('表示間隔').selectOption('week');
  await expect(page.getByRole('cell', { name: '未確定（進行中）', exact: true })).toBeVisible();
  await page.getByLabel('表示間隔').selectOption('month');
  await page.goBack(); await expect(page.getByLabel('表示間隔')).toHaveValue('week');
  await page.reload(); await expect(page.getByLabel('表示間隔')).toHaveValue('week');
  await page.getByRole('button', { name: 'お気に入り', exact: true }).click();
  await expect(page.getByRole('button', { name: 'お気に入り', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual(calls);
  await page.screenshot({ path: '.dexter/workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'SMA 20', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'SMA 20', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.dexter/workspace-mobile-chart.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('source-gap indicators and candle-free ongoing shortages render from the deterministic DTO', async ({ page }) => {
  test.setTimeout(60_000);
  page.on('pageerror', error => { throw error; });
  const fixture = workspaceTechnicalHistory(['2025-03-12', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  const legacy = buildTechnicalFromInputsV1(fixture.fetched, {}).artifact;
  const chart = projectWorkspaceChart(new WorkspaceTechnicalCodec('7203').build(legacy, fixture.input));
  const item = { schemaVersion: 'workspace_item_v1', instrumentId: fixture.input.identity.instrumentId,
    code: '72030', label: '欠損fixture', favorite: 0, revision: 1 };
  await page.route(`**/api/workspace/instruments/${item.instrumentId}`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_view_v1', item, chart,
  } }));
  await page.goto(`${base}workspace?instrument=${item.instrumentId}&interval=week`);
  for (const interval of ['week', 'month'] as const) {
    await page.getByLabel('表示間隔').selectOption(interval);
    const gap = chart.intervals[interval].find(row => row.sourceGaps.includes('2025-03-12'))!;
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: gap.displayDate, exact: true }) });
    await expect(row.getByRole('cell', { name: '確定', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'source不足: 2025-03-12', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: '利用不可 (source_gap)', exact: true })).toHaveCount(5);
    const range = interval === 'week' ? '2026-09-07–2026-09-13' : '2026-09-01–2026-09-30';
    await expect(page.getByRole('list', { name: 'source不足の期間' }).getByText(`${range}: source不足（価格利用不可）`, { exact: true })).toBeVisible();
  }
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
});

test('mobile touch/keyboard search, back navigation and invalid URL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}workspace`);
  await page.getByLabel('銘柄名・証券コード').focus(); await page.keyboard.type('7203');
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).tap();
  const candidate = page.getByRole('button', { name: '72030 Synthetic', exact: true }); await candidate.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('価格データは未取得です。日足データを明示取得してください。')).toBeVisible();
  await page.goBack(); await expect(page.getByText('普通株を選択してWorkspaceを開いてください。Snapshot・LLM API keyは不要です。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.dexter/workspace-mobile.png', fullPage: true });
  await page.goto(`${base}workspace?instrument=7203`); await expect(page.getByText('Workspace URLが不正です。')).toBeVisible();
});

test('active job resumes after reload, suspends hidden polling and latches uncertain reads', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  const job = { schemaVersion: 'workspace_job_v1', id, kind: 'catalog', state: 'running', instrumentId: null, error: null };
  let polls = 0, fail = false;
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as Window & { hiddenFixture?: boolean }).hiddenFixture ? 'hidden' : 'visible' });
  });
  await page.route('**/api/workspace/jobs/active', route => route.fulfill({ json: { schemaVersion: 'workspace_active_v1', job, blockingKind: null } }));
  await page.route(`**/api/workspace/jobs/${id}`, route => { polls++; return route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: { code: 'unavailable' } } : job }); });
  await page.goto(`${base}workspace`); await expect.poll(() => polls).toBeGreaterThan(0);
  await page.evaluate(() => { (window as Window & { hiddenFixture?: boolean }).hiddenFixture = true; document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenCount = polls; await page.waitForTimeout(1300); expect(polls).toBe(hiddenCount);
  fail = true;
  await page.evaluate(() => { (window as Window & { hiddenFixture?: boolean }).hiddenFixture = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByText('ジョブ状態の確認を停止しました。再送せずページ全体を再読み込みしてください。')).toBeVisible();
  const failedCount = polls; await page.waitForTimeout(1300); expect(polls).toBe(failedCount);
  fail = false; await page.reload(); await expect.poll(() => polls).toBeGreaterThan(failedCount);
});

test('late instrument response ignoring AbortSignal cannot replace the selected instrument', async ({ page }) => {
  const a = { schemaVersion: 'workspace_item_v1', instrumentId: '00000000-0000-4000-8000-000000000001', code: '72030', label: 'A社', favorite: 0, revision: 1 };
  const b = { ...a, instrumentId: '00000000-0000-4000-8000-000000000002', label: 'B社' };
  await page.route('**/api/workspace/search?*', route => route.fulfill({ json: { schemaVersion: 'workspace_search_v1', items: [a, b].map(({ instrumentId, code, label }) => ({ instrumentId, code, label })) } }));
  await page.route('**/api/workspace/instruments/*/open', route => route.fulfill({ json: route.request().url().includes(a.instrumentId) ? a : b }));
  await page.route(`**/api/workspace/instruments/${b.instrumentId}`, route => route.fulfill({ json: { schemaVersion: 'workspace_view_v1', item: b, chart: null } }));
  await page.goto(`${base}workspace`);
  await page.evaluate(({ item }) => {
    const original = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input) === `/api/workspace/instruments/${item.instrumentId}` ? new Promise<Response>(resolve => {
      (window as Window & { releaseFixture?: () => void }).releaseFixture = () => resolve(Response.json({ schemaVersion: 'workspace_view_v1', item, chart: null }));
    }) : original(input, init)) as typeof window.fetch;
  }, { item: a });
  await page.getByRole('button', { name: '72030 A社' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as Window & { releaseFixture?: () => void }).releaseFixture)).toBe(true);
  await page.getByRole('button', { name: '銘柄検索・最近開いた銘柄' }).click();
  await page.getByRole('button', { name: '72030 B社' }).click();
  await expect(page.getByRole('heading', { name: '72030 B社' })).toBeVisible();
  await page.evaluate(() => (window as Window & { releaseFixture?: () => void }).releaseFixture?.());
  await expect(page.getByRole('heading', { name: '72030 B社' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '72030 A社' })).toHaveCount(0);
});

test('large saved chart keeps exact rows reachable and interval navigation responsive', async ({ page }) => {
  const item = { schemaVersion: 'workspace_item_v1', instrumentId: '00000000-0000-4000-8000-000000000001', code: '72030', label: '長期表示fixture', favorite: 0, revision: 1 };
  const unavailable = { state: 'unavailable', reason: 'warmup' };
  const rows = Array.from({ length: 2600 }, (_, index) => {
    const date = new Date(Date.UTC(2016, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
    return { interval: 'day', identity: date, displayDate: date, periodStart: date, periodEnd: date, firstSessionDate: date, lastSessionDate: date,
      partial: false, completion: 'confirmed', coverage: 'complete', sourceGaps: [], open: 100, high: 110, low: 90, close: 105, volume: 0,
      sma20: unavailable, rsi: unavailable, macd: unavailable, signal: unavailable, histogram: unavailable, cross: unavailable };
  });
  await page.route(`**/api/workspace/instruments/${item.instrumentId}`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_view_v1', item, chart: { schemaVersion: 'workspace_chart_v1', dataDate: rows.at(-1)!.displayDate, eligibilityFrom: rows[0]!.displayDate,
      artifactDigest: `sha256:${'a'.repeat(64)}`, intervals: { day: rows, week: [{ ...rows[0], interval: 'week' }], month: [{ ...rows[0], interval: 'month' }] }, unavailablePeriods: [] },
  } }));
  await page.goto(`${base}workspace?instrument=${item.instrumentId}&interval=day`);
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: '古い100行' }).click();
  await expect(page.getByText('2401–2500 / 2600行', { exact: true })).toBeVisible();
  const latency = await page.getByLabel('表示間隔').evaluate(async element => {
    const started = performance.now(); (element as HTMLSelectElement).value = 'week'; element.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return performance.now() - started;
  });
  expect(latency).toBeLessThan(1000);
  await expect(page.getByLabel('表示間隔')).toHaveValue('week');
  await page.goBack(); await expect(page.locator('.table-scroll tbody tr')).toHaveCount(100);
});

test('definite admission conflict reconciles another tab job and permits manual retry without replay', async ({ page }) => {
  const job = { schemaVersion: 'workspace_job_v1', id: '00000000-0000-4000-8000-000000000001', kind: 'catalog', state: 'running', instrumentId: null, error: null };
  let posts = 0, activeReads = 0, finished = false, deletes = 0;
  await page.route('**/api/workspace/jobs/active', route => { activeReads++; return route.fulfill({ json: {
    schemaVersion: 'workspace_active_v1', job: posts && !finished ? job : null, blockingKind: null,
  } }); });
  await page.route(`**/api/workspace/jobs/${job.id}`, route => {
    if (route.request().method() === 'DELETE') { deletes++; expect(route.request().postData()).toBeNull(); finished = true; }
    return route.fulfill({ json: { ...job, state: finished ? 'failed' : 'running' } });
  });
  await page.route('**/api/workspace/jobs', route => { posts++; return route.fulfill({ status: 409,
    json: { schemaVersion: 'workspace_error_v1', error: { code: 'job_active' } } }); });
  await page.goto(`${base}workspace`);
  const start = page.getByRole('button', { name: '銘柄一覧を取得・更新' });
  await start.click();
  await expect.poll(() => posts).toBe(1);
  await expect.poll(() => activeReads).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('銘柄一覧: running', { exact: true })).toBeVisible();
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: '取得をキャンセル' }).focus(); await page.keyboard.press('Enter');
  await expect(start).toBeEnabled(); expect(deletes).toBe(1);
  await page.waitForTimeout(1200); expect(posts).toBe(1);
  await start.click(); await expect.poll(() => posts).toBe(2); await expect(start).toBeEnabled();
  await expect(page.getByText('ジョブ状態の確認を停止しました。再送せずページ全体を再読み込みしてください。')).toHaveCount(0);
});

test('malformed admission envelope latches without replay and malformed chart stays hidden', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/workspace/jobs', route => { posts++; return route.fulfill({ status: 202, json: {
    schemaVersion: 'workspace_job_v2', id: '00000000-0000-4000-8000-000000000001', kind: 'catalog', state: 'running', instrumentId: null, error: null,
  } }); });
  await page.goto(`${base}workspace`); await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await expect(page.getByText('ジョブ状態の確認を停止しました。再送せずページ全体を再読み込みしてください。')).toBeVisible();
  await page.waitForTimeout(1200); expect(posts).toBe(1);
  const item = { schemaVersion: 'workspace_item_v1', instrumentId: '00000000-0000-4000-8000-000000000001', code: '72030', label: 'Invalid chart', favorite: 0, revision: 1 };
  await page.route(`**/api/workspace/instruments/${item.instrumentId}`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_view_v1', item, chart: { schemaVersion: 'workspace_chart_v1', intervals: {} },
  } }));
  await page.goto(`${base}workspace?instrument=${item.instrumentId}`);
  await expect(page.getByRole('heading', { name: '価格・出来高', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible(); expect(posts).toBe(1);
});
