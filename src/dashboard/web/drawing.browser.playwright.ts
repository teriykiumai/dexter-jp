import { test, expect, type Page } from 'playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let child: ChildProcessWithoutNullStreams, base: string, directory: string;
async function start() {
  child = spawn('bun', [fileURLToPath(new URL('../workspace-browser-fixture.ts', import.meta.url))], { stdio: 'pipe',
    env: { ...process.env, WORKSPACE_BROWSER_ROOT: directory, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 15_000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}`)); });
  });
}
async function stop() {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited;
}
test.use({ hasTouch: true });
test.beforeEach(async () => { directory = mkdtempSync(resolve(tmpdir(), 'dexter-horizontal-browser-')); await start(); });
test.afterEach(async () => { await stop(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
async function acquire(page: Page) {
  await page.goto(`${base}workspace`);
  await page.getByRole('button', { name: '銘柄一覧を取得・更新' }).click();
  await page.getByRole('button', { name: '72030 Synthetic', exact: true }).click();
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('button', { name: 'Horizontal lineを作成' })).toBeEnabled({ timeout: 30_000 });
}
async function create(page: Page, price = '102.25') {
  await page.getByRole('button', { name: 'Horizontal lineを作成' }).tap();
  await expect(page.getByLabel('Horizontal価格（円・調整後）')).toBeFocused();
  await page.getByLabel('Horizontal価格（円・調整後）').fill(price);
  await page.getByRole('button', { name: 'Horizontalを保存', exact: true }).click();
  await expect(page.getByRole('list', { name: '保存済みDrawing' }).getByText(`${price} 円`, { exact: false })).toBeVisible();
}

test('M1: no Snapshot/LLM, explicit EOD, day/week/month, touch create, real process restart restores Horizontal', async ({ page }) => {
  test.setTimeout(90_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await acquire(page);
  for (const interval of ['week', 'month', 'day']) await page.getByLabel('表示間隔').selectOption(interval);
  await create(page);
  const route = new URL(page.url()).pathname + new URL(page.url()).search;
  const old = await page.request.get(`${base}api/workspace/instruments/${new URL(page.url()).searchParams.get('instrument')}/drawings`).then(r => r.json());
  await page.goto('about:blank'); await stop(); await start(); await page.goto(`${base.slice(0, -1)}${route}`);
  await expect(page.getByRole('list', { name: '保存済みDrawing' }).getByText('102.25 円', { exact: false })).toBeVisible();
  const restored = await page.request.get(`${base}api/workspace/instruments/${old.instrumentId}/drawings`).then(r => r.json());
  expect(restored).toEqual(old); expect(await page.request.get(`${base}test/counts`).then(r => r.json())).toEqual({ calls: 0 });
  for (const width of [320, 390, 680, 768, 980, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const interval of ['week', 'month', 'day']) {
    await page.getByLabel('表示間隔').selectOption(interval);
    await expect(page.getByRole('list', { name: '保存済みDrawing' }).getByText('102.25 円', { exact: false })).toBeVisible();
  }
  await page.locator('.price-chart').screenshot({ path: '.dexter/horizontal-chart-restored.png' });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('heading', { name: 'Drawing', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.dexter/horizontal-mobile.png' });
  await page.getByRole('button', { name: /を選択・編集/ }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Horizontal価格（円・調整後）').fill('104');
  await page.getByRole('button', { name: 'Horizontalを保存', exact: true }).click();
  await expect(page.getByRole('list', { name: '保存済みDrawing' }).getByText('104 円', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /を削除/ }).tap();
  await expect(page.getByText('保存済みDrawingはありません。')).toBeVisible();
  expect(errors).toEqual([]);
});

test('save conflict and ambiguous publication preserve draft, never auto-retry, and reconcile manually', async ({ page }) => {
  test.setTimeout(90_000); await acquire(page); await create(page);
  await page.getByRole('button', { name: /を選択・編集/ }).click();
  await page.getByLabel('Horizontal価格（円・調整後）').fill('109');
  let writes = 0;
  await page.route('**/api/workspace/instruments/*/drawings/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++; await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 'workspace_error_v1', error: { code: 'revision_conflict' } }) });
  });
  await page.getByRole('button', { name: 'Horizontalを保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '保存競合' })).toBeVisible();
  await expect(page.getByLabel('Horizontal価格（円・調整後）')).toHaveValue('109');
  await expect(page.getByRole('button', { name: 'Horizontalを保存', exact: true })).toBeDisabled();
  await page.getByLabel('表示間隔').selectOption('month'); expect(writes).toBe(1);
  await page.unroute('**/api/workspace/instruments/*/drawings/*');
  await page.getByRole('button', { name: '保存状態を再読込' }).click();
  await expect(page.getByText('保存済みDrawingを読み込みました。')).toBeVisible();
  await page.getByRole('button', { name: '編集をキャンセル' }).click();
  await page.getByRole('button', { name: /を選択・編集/ }).click();
  await page.getByLabel('Horizontal価格（円・調整後）').fill('107');
  await page.route('**/api/workspace/instruments/*/drawings/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++; await route.fetch(); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Horizontalを保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '保存結果を確認できません' })).toBeVisible();
  await expect(page.getByLabel('Horizontal価格（円・調整後）')).toHaveValue('107'); expect(writes).toBe(2);
  await page.getByRole('button', { name: '保存状態を再読込' }).click();
  await expect(page.getByRole('list', { name: '保存済みDrawing' }).getByText('107 円', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Horizontal価格（円・調整後）')).toHaveValue('107'); expect(writes).toBe(2);
  await page.getByRole('button', { name: '編集をキャンセル' }).click();
});

test('basis review retains the saved record while disabling compatible editing', async ({ page }) => {
  test.setTimeout(60_000); await acquire(page); await create(page);
  await page.route('**/api/workspace/instruments/*/drawings', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(), value = await response.json();
    value.items[0].state = 'basis_review_required';
    await route.fulfill({ response, json: value });
  });
  await page.getByRole('button', { name: '保存状態を再読込' }).click();
  await expect(page.getByText('basis_review_required（保持・非表示）', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /を選択・編集/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /を削除/ })).toBeEnabled();
  await page.locator('.price-chart').screenshot({ path: '.dexter/horizontal-basis-review.png' });
});

test('undo restores a price-corrected Drawing as retained, hidden and non-editable', async ({ page }) => {
  test.setTimeout(90_000); await acquire(page); await create(page);
  const path = base + 'api/workspace/instruments/' + new URL(page.url()).searchParams.get('instrument') + '/drawings';
  const original = (await (await page.request.get(path)).json()).items[0];
  await page.request.post(base + 'test/price-correction');
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByText('basis_review_required（保持・非表示）', { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /を削除/ }).click();
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
  await expect.poll(async () => (await (await page.request.get(path)).json()).items.length).toBe(0);
  // Same chart pixels before and after restoration prove the retained line adds no overlay.
  const chart = page.locator('.price-chart');
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  const hidden = await chart.screenshot();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByText('basis_review_required（保持・非表示）', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /を選択・編集/ })).toBeDisabled();
  const restored = (await (await page.request.get(path)).json()).items[0];
  expect(restored).toEqual({ ...original, revision: 2, state: 'basis_review_required',
    projections: Object.fromEntries(['day', 'week', 'month'].map(key => [key, { state: 'unavailable', reason: 'basis_review_required' }])) });
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  expect(await chart.screenshot()).toEqual(hidden);
});


test('basis review requires explicit confirmation, preserves anchors, supports undo and survives restart', async ({ page }) => {
  test.setTimeout(120_000); await acquire(page); await create(page);
  const path = base + 'api/workspace/instruments/' + new URL(page.url()).searchParams.get('instrument') + '/drawings';
  const original = (await (await page.request.get(path)).json()).items[0];
  await page.request.post(base + 'test/price-correction');
  await page.getByRole('button', { name: '日足データを取得・更新' }).click();
  await expect(page.getByRole('button', { name: /basisを確認/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: /basisを確認/ }).click();
  await expect(page.getByRole('button', { name: 'このbasisを承認' })).toBeDisabled();
  for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole('button', { name: 'basis確認をキャンセル' }).click();
  expect((await (await page.request.get(path)).json()).items[0].revision).toBe(1);
  await page.getByRole('button', { name: /basisを確認/ }).click();
  await page.getByRole('checkbox', { name: '価格を自動換算せず現在のbasisとして扱うことを確認しました' }).check();
  await page.getByRole('button', { name: 'このbasisを承認' }).click();
  await expect(page.getByRole('button', { name: /を選択・編集/ })).toBeEnabled();
  const accepted = (await (await page.request.get(path)).json()).items[0];
  expect(accepted).toMatchObject({ id: original.id, price: original.price, time: original.time, basisDigest: original.basisDigest, revision: 2, state: 'compatible' });
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('button', { name: /basisを確認/ })).toBeEnabled();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.getByRole('button', { name: /を選択・編集/ })).toBeEnabled();
  const before = (await (await page.request.get(path)).json()).items[0], route = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.goto('about:blank'); await stop(); await start(); await page.goto(base.slice(0, -1) + route);
  await expect(page.getByRole('button', { name: /を選択・編集/ })).toBeEnabled({ timeout: 30_000 });
  expect((await (await page.request.get(base + new URL(path).pathname.slice(1))).json()).items[0]).toEqual(before);
});
