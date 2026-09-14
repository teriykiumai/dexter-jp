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

test('Step 8 landing, history and cross-shell Back/Forward do not collect data or start AI', async ({ page }) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(`${request.method()} ${url.pathname}`); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Stock Workspace', exact: true })).toBeVisible();
  await expect(page.getByLabel('銘柄名・証券コード')).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.startsWith('GET /api/workspace/'))).toBe(true);
  await expect(page.getByRole('link', { name: '市場概況', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '保存済み分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存済み分析はありません', exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe('?view=history');
  await page.reload();
  await expect(page.getByRole('heading', { name: '保存済み分析はありません', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Stock Workspace', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '保存済み分析はありません', exact: true })).toBeVisible();
  await page.evaluate(() => { history.pushState({}, '', '/workspace'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('heading', { name: 'Stock Workspace', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '保存済み分析はありません', exact: true })).toBeVisible();
  expect(requests.every(request => request.startsWith('GET '))).toBe(true);
  expect(requests.some(request => /market-data|strategy-validation/.test(request))).toBe(false);
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 0 });
  expect(errors).toEqual([]);
});

test('Step 8 Workspace landing uses DESIGN at every required width', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  for (const width of [320, 390, 680, 768, 980, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Stock Workspace', exact: true })).toHaveCSS('font-size', '24px');
    await expect(page.locator('.dashboard-design')).toHaveCSS('color-scheme', 'light');
    await page.getByLabel('銘柄名・証券コード').focus();
    await expect(page.getByLabel('銘柄名・証券コード')).toHaveCSS('outline-width', '2px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const targets = await page.locator('button:visible, nav a, input:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(targets.every(height => height >= 44)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-landing-${width}.png`), fullPage: true });
  }
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
});

test('AI explicit supply interpretation survives reload and keeps chart navigation independent', async ({ page }) => {
  test.setTimeout(100_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('heading', { name: '価格・出来高', exact: true })).toBeVisible({ timeout: 30_000 });
  const region = page.getByRole('region', { name: 'AI分析・履歴', exact: true });
  await expect(region.getByText('AI履歴はありません。')).toBeVisible();
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 0 });
  await region.getByRole('button', { name: '保存済み入力でAI分析を実行', exact: true }).click();
  await expect(region.getByText(/分析に使える保存済みデータが不足/)).toBeVisible();
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 0 });
  await page.request.post(`${base}test/supply`);
  await page.getByRole('button', { name: '所属業種の空売りを取得・更新', exact: true }).click();
  await expect(page.getByRole('cell', { name: '40%', exact: true })).toBeVisible({ timeout: 30_000 });
  const before = await (await page.request.get(`${base}test/counts`)).json();
  await page.request.post(`${base}test/ai-delay`);
  await region.getByLabel('分析の種類').selectOption('supply_demand');
  await region.getByRole('button', { name: '保存済み入力でAI分析を実行', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(region.getByRole('status')).toContainText(/入力を保存済み|AI分析中/, { timeout: 15_000 });
  await page.getByLabel('表示間隔').selectOption('week'); await page.getByLabel('表示間隔').selectOption('month');
  await page.reload();
  const saved = region.getByRole('listitem').filter({ has: page.getByRole('button', { name: '需給分析の固定入力と結果を開く', exact: true }) });
  await expect(saved.locator('p')).toContainText(/\/ 保存済み$/, { timeout: 30_000 }); await saved.getByRole('button').click();
  await expect(region.getByText('AIの解釈', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(region.getByText(/保存された開示データを確認できます/)).toBeVisible();
  await region.getByText('固定入力: 所属業種の空売り', { exact: true }).click();
  await expect(region.getByRole('cell', { name: '40%', exact: true })).toBeVisible();
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual(before);
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await region.screenshot({ path: '.dexter/workspace-ai-mobile.png' });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { timeout: 1000 }).toBe(true); expect(errors).toEqual([]);
});

test('AI history rejects foreign identity and never starts a model on navigation or failed read', async ({ page }) => {
  await page.goto(`${base}workspace`);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  const region = page.getByRole('region', { name: 'AI分析・履歴', exact: true });
  await expect(region.getByText('AI履歴はありません。')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('instrument')!;
  await page.route(`**/instruments/${id}/ai`, async route => {
    const response = await route.fetch(), value = await response.json();
    await route.fulfill({ json: { ...value, instrumentId: '00000000-0000-4000-8000-000000000099' } });
  });
  await page.reload();
  await expect(region.getByRole('alert')).toContainText('AI状態を確認できません');
  await expect(region.getByRole('button', { name: '保存済み入力でAI分析を実行', exact: true })).toBeDisabled();
  await page.unroute(`**/instruments/${id}/ai`);
  await page.goBack();
  await expect(region).toHaveCount(0);
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  await expect(region.getByRole('alert')).toContainText('AI状態を確認できません');
  await page.reload();
  await expect(region.getByRole('button', { name: '保存済み入力でAI分析を実行', exact: true })).toBeEnabled();
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 0 });
});

test('AI slot conflict adopts the existing run, suspends hidden polling and still latches a foreign response', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as Window & { hiddenFixture?: boolean }).hiddenFixture ? 'hidden' : 'visible' });
  });
  await page.goto(`${base}workspace`);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  const region = page.getByRole('region', { name: 'AI分析・履歴', exact: true });
  await expect(region.getByText('AI履歴はありません。')).toBeVisible();
  const id = new URL(page.url()).searchParams.get('instrument')!;
  const job = { schemaVersion: 'workspace_ai_job_v1', id: '00000000-0000-4000-8000-000000000001', instrumentId: id,
    profile: 'supply_demand', createdAt: '2026-09-11T09:00:00.000Z', state: 'running', error: null, result: null,
    input: { path: 'poll-fixture.json', codec: 'workspace_ai_input_v1', digest: `sha256:${'a'.repeat(64)}` } };
  let polls = 0, foreign = false;
  await page.route(`**/instruments/${id}/ai`, async route => {
    const response = await route.fetch(), value = await response.json();
    await route.fulfill({ json: { ...value, active: job, busy: true } });
  });
  await page.route(`**/instruments/${id}/ai/jobs/${job.id}`, route => {
    polls++; return route.fulfill({ json: foreign ? { ...job, instrumentId: '00000000-0000-4000-8000-000000000099' } : job });
  });
  let posts = 0;
  await page.route(`**/instruments/${id}/ai/jobs`, route => { posts++; return route.fulfill({ status: 409,
    json: { schemaVersion: 'workspace_error_v1', error: { code: 'revision_conflict' } } }); });
  await region.getByRole('button', { name: '保存済み入力でAI分析を実行', exact: true }).click();
  await expect(region.getByRole('status')).toHaveText('需給分析: AI分析中');
  await expect(region.getByRole('button', { name: 'AI履歴を読み直す', exact: true })).toBeEnabled();
  await expect(region.getByText(/AI状態を確認できません/)).toHaveCount(0);
  expect(posts).toBe(1); await expect.poll(() => polls).toBeGreaterThan(0);
  await page.evaluate(() => { (window as Window & { hiddenFixture?: boolean }).hiddenFixture = true; document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = polls; await page.waitForTimeout(1300); expect(polls).toBe(hidden);
  foreign = true;
  await page.evaluate(() => { (window as Window & { hiddenFixture?: boolean }).hiddenFixture = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(region.getByRole('alert').filter({ hasText: 'AI状態を確認できません' })).toBeVisible();
  const failed = polls; await page.waitForTimeout(1300); expect(polls).toBe(failed);
  foreign = false; await page.reload(); await expect.poll(() => polls).toBeGreaterThan(failed);
  expect(await (await page.request.get(`${base}test/ai-counts`)).json()).toEqual({ calls: 0 });
});

test('financial explicit acquisition retains unavailable identity, daily denominator and saved state on reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}workspace`);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  const section = page.getByRole('region', { name: '財務・配当', exact: true });
  await expect(section.getByText('未取得', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('heading', { name: '価格・出来高', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.request.post(`${base}test/financial`);
  await section.getByRole('button', { name: '財務・配当を取得・更新' }).focus(); await page.keyboard.press('Enter');
  await expect(section.getByRole('row', { name: /売上高.*銘柄帰属を未確認/ })).toBeVisible({ timeout: 30_000 });
  await expect(section.getByRole('row', { name: /利回り計算に用いる日足終値.*105/ })).toBeVisible();
  const count = await (await page.request.get(`${base}test/counts`)).json();
  await page.getByLabel('表示間隔').selectOption('week'); await page.getByLabel('表示間隔').selectOption('month');
  await expect(section.getByRole('row', { name: /日足終値の基準日.*2026-09-11/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  await expect(section.getByRole('row', { name: /予想配当利回り.*利用不可/ })).toBeVisible({ timeout: 30_000 });
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual(count);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.dexter/workspace-financial-mobile.png', fullPage: true });
});

test('financial foreign or failed saved response hides values without external replay', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  await page.route(`**/api/workspace/instruments/${id}`, route => route.fulfill({ json: { schemaVersion: 'workspace_view_v1',
    item: { schemaVersion: 'workspace_item_v1', instrumentId: id, code: '72030', label: 'Synthetic', favorite: 0, revision: 1 }, chart: null } }));
  await page.route(`**/api/workspace/instruments/${id}/financial`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_financial_view_v1', instrumentId: '00000000-0000-4000-8000-000000000002', state: 'not_collected',
    artifactDigest: null, through: null, checkedAt: null, note: 'foreign', rows: [], projection: null } }));
  await page.goto(`${base}workspace?instrument=${id}`);
  const section = page.getByRole('region', { name: '財務・配当', exact: true });
  await expect(section.getByRole('alert')).toContainText('保存済み財務データを読み込めません');
  await expect(section.getByRole('button')).toBeDisabled(); await expect(section.getByText('foreign')).toHaveCount(0);
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
  await page.unroute(`**/api/workspace/instruments/${id}/financial`);
  await page.route(`**/api/workspace/instruments/${id}/financial`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_financial_view_v1', instrumentId: id, state: 'unavailable',
    artifactDigest: `sha256:${'a'.repeat(64)}`, through: '2026-09-11', checkedAt: '2026-09-11T08:00:00.000Z',
    note: 'undeclared reason', rows: [['Invalid forecast', '999']], projection: {
      policyVersion: 'workspace_dividend_projection_v1', cutoff: '2026-10-01', state: 'unavailable', reason: 'future_reason',
      forecastReference: null, priceReference: null } } }));
  await page.reload();
  await expect(section.getByRole('alert')).toContainText('保存済み財務データを読み込めません');
  await expect(section.getByRole('button')).toBeDisabled();
  await expect(section.getByText('999')).toHaveCount(0);
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
});

test('saved supply pagination works by keyboard and touch; foreign owner response hides data without fetching', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  const datasets = (['margin', 'issuer_short', 'sector_short'] as const).map(dataset => ({ dataset, label: dataset,
    state: 'available', artifactDigest: `sha256:${'a'.repeat(64)}`, from: '2026-09-11', through: '2026-09-11',
    checkedAt: '2026-09-11T09:00:00.000Z', note: 'Synthetic saved data', columns: ['項目', '値'],
    rows: dataset === 'issuer_short' ? Array.from({ length: 51 }, (_, index) => [`Report ${index + 1}`, '0.51%']) : [] }));
  await page.route(`**/api/workspace/instruments/${id}`, route => route.fulfill({ json: { schemaVersion: 'workspace_view_v1',
    item: { schemaVersion: 'workspace_item_v1', instrumentId: id, code: '72030', label: 'Synthetic', favorite: 0, revision: 1 }, chart: null } }));
  let foreign = false;
  await page.route(`**/api/workspace/instruments/${id}/supply`, route => route.fulfill({ json: {
    schemaVersion: 'workspace_supply_view_v1', instrumentId: foreign ? '00000000-0000-4000-8000-000000000002' : id, datasets } }));
  await page.goto(`${base}workspace?instrument=${id}`);
  await expect(page.getByRole('cell', { name: 'Report 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '次の50行' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('cell', { name: 'Report 51', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Report 1', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '前の50行' }).tap();
  await expect(page.getByRole('cell', { name: 'Report 1', exact: true })).toBeVisible();
  foreign = true; await page.reload();
  await expect(page.getByText('保存済み需給データを読み込めません。ページを再読み込みしてください。')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Report 1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '公開空売り残高を取得・更新' })).toBeDisabled();
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual({ calls: 0 });
});

test('explicit supply datasets restore on reload, preserve zero and remain responsive to chart navigation', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}workspace`);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('heading', { name: '価格・出来高', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.request.post(`${base}test/supply`);
  const credit = page.getByRole('button', { name: '信用取引残高を取得・更新', exact: true });
  await credit.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('cell', { name: '信用売残（株）', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: '信用売残（株）', exact: true }) })).toContainText('0');
  await page.getByRole('button', { name: '公開空売り残高を取得・更新', exact: true }).click();
  await expect(page.getByRole('cell', { name: '0.51%', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Synthetic Reporter', exact: true }) })
    .getByRole('cell', { name: '未公表', exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '所属業種の空売りを取得・更新', exact: true }).tap();
  await expect(page.getByRole('cell', { name: '40%', exact: true })).toBeVisible({ timeout: 30_000 });
  const calls = await (await page.request.get(`${base}test/counts`)).json();
  await page.getByLabel('表示間隔').selectOption('week');
  await page.getByLabel('表示間隔').selectOption('month');
  await page.reload();
  await expect(page.getByRole('cell', { name: '40%', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('cell', { name: '0.51%', exact: true })).toBeVisible();
  expect(await (await page.request.get(`${base}test/counts`)).json()).toEqual(calls);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.dexter/workspace-supply-mobile.png', fullPage: true });
});

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
  const fixture = workspaceTechnicalHistory(['2025-03-12', '2026-08-12', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
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
    // Latest confirmed week/month contains gaps; its date is not an indicator date.
    const indicatorDate = interval === 'week' ? '2026-08-28' : '2026-07-31';
    await expect(page.getByText(`確定indicator対象日: ${indicatorDate}`, { exact: true })).toBeVisible();
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
