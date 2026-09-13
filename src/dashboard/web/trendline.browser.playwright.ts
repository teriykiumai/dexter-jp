import { test, expect, type Page } from 'playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let child: ChildProcessWithoutNullStreams, base: string, directory: string;
const instrument = '00000000-0000-4000-8000-000000000001';
const route = `workspace?instrument=${instrument}&interval=day`;
async function start() {
  child = spawn('bun', [fileURLToPath(new URL('../workspace-browser-fixture.ts', import.meta.url))], { stdio: 'pipe',
    env: { ...process.env, WORKSPACE_BROWSER_ROOT: directory, WORKSPACE_BROWSER_TRENDLINES: '1', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timeout')), 30_000);
    child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}`)); });
  });
}
async function stop() {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited;
}
test.use({ hasTouch: true });
test.beforeEach(async () => { directory = mkdtempSync(resolve(tmpdir(), 'dexter-trend-browser-')); await start(); });
test.afterEach(async () => { await stop(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
async function open(page: Page) {
  await page.goto(base + route);
  await expect(page.getByRole('button', { name: 'Trendlineを作成', exact: true })).toBeEnabled({ timeout: 30_000 });
}
async function draft(page: Page) {
  await page.getByRole('button', { name: 'Trendlineを作成', exact: true }).tap();
  await page.getByLabel('Trendline始点日（日足）').fill('2026-09-03');
  await page.getByLabel('Trendline始点価格（円・調整後）').fill('132');
  await page.getByLabel('Trendline終点価格（円・調整後）').fill('140');
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Trendlineを保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /Trendline .* を選択・編集/ })).toBeEnabled({ timeout: 30_000 });
}
async function stored(page: Page) { return (await (await page.request.get(`${base}api/workspace/instruments/${instrument}/drawings`)).json()).items; }

test('Trendline endpoint mouse/keyboard edits, cancel, full command undo/redo and process restart', async ({ page }) => {
  test.setTimeout(180_000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await draft(page);
  const end = page.getByRole('button', { name: 'Trendline終点を移動', exact: true });
  await expect(end).toBeVisible(); await end.scrollIntoViewIfNeeded(); await end.focus(); await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('Trendline終点価格（円・調整後）')).toHaveValue('141');
  await page.keyboard.press('ArrowLeft'); await expect(page.getByLabel('Trendline終点日（日足）')).toHaveValue('2026-09-10');
  await page.keyboard.press('ArrowRight'); await expect(page.getByLabel('Trendline終点日（日足）')).toHaveValue('2026-09-11');
  expect(await end.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute('class'); })).toBe('drawing-handle');
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByLabel('Trendline終点価格（円・調整後）')).toHaveValue('141');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 8, { steps: 3 }); await page.mouse.up();
  expect(Number(await page.getByLabel('Trendline終点価格（円・調整後）').inputValue())).toBeGreaterThan(141);
  expect(await stored(page)).toHaveLength(0); // Drag releases a draft, not a write.
  await save(page); const created = (await stored(page))[0];
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(await stored(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.getByRole('button', { name: /Trendline .* を選択・編集/ })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: /Trendline .* を選択・編集/ }).click();
  await page.getByLabel('Trendline始点価格（円・調整後）').fill('133'); await save(page);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect((await stored(page))[0].price).toBe(132);
  await page.getByRole('button', { name: /Trendline .* を削除/ }).tap();
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('button', { name: /Trendline .* を選択・編集/ })).toBeEnabled({ timeout: 30_000 });
  const final = (await stored(page))[0]; expect(final.id).toBe(created.id); expect(final.basisDigest).toBe(created.basisDigest);
  for (const interval of ['week', 'month', 'day']) await page.getByLabel('表示間隔').selectOption(interval);
  await page.locator('.drawing-chart-frame').screenshot({ path: '.dexter/trendline-chart.png' });
  await page.goto('about:blank'); await stop(); await start(); await open(page);
  expect((await stored(page))[0]).toEqual(final);
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  expect(await page.request.get(base + 'test/counts').then(r => r.json())).toEqual({ calls: 0 }); expect(errors).toEqual([]);
});

test('Trendline touch targets, interval draft preservation and ambiguous history publication latch', async ({ page, context }) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 390, height: 900 }); await open(page); await draft(page);
  const end = page.getByRole('button', { name: 'Trendline終点を移動', exact: true }); await end.scrollIntoViewIfNeeded();
  expect(await end.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.getAttribute('class'); })).toBe('drawing-handle');
  const box = (await end.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Number(await page.getByLabel('Trendline終点価格（円・調整後）').inputValue())).toBeGreaterThan(140);
  const value = await page.getByLabel('Trendline終点価格（円・調整後）').inputValue();
  const moved = (await end.boundingBox())!, tx = moved.x + moved.width / 2, ty = moved.y + moved.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx, y: ty - 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.getByLabel('Trendline終点価格（円・調整後）')).toHaveValue(value);
  await page.locator('.drawing-chart-frame').screenshot({ path: '.dexter/trendline-mobile-draft.png' });
  await page.getByLabel('表示間隔').selectOption('week'); await expect(end).toHaveCount(0);
  await expect(page.getByLabel('Trendline終点価格（円・調整後）')).toHaveValue(value);
  await page.getByLabel('表示間隔').selectOption('day'); await save(page);
  for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); const layout = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth, width: innerWidth,
    overflow: [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth && !e.closest('.table-scroll, .price-chart')).slice(0, 8).map(e => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right })) })); expect(layout.fits, JSON.stringify(layout)).toBe(true); }
  let writes = 0;
  await page.route('**/drawings/*', async route => { if (route.request().method() !== 'POST') return route.continue(); writes++; await route.fetch(); await route.abort(); });
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'undo/redo' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  expect(await stored(page)).toHaveLength(0); expect(writes).toBe(1);
  await page.getByRole('button', { name: '保存状態を再読込' }).click();
  await expect(page.getByRole('button', { name: 'Trendlineを作成', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeDisabled(); expect(writes).toBe(1);
});

test('Trendline undo cannot overwrite an edit confirmed in another tab', async ({ page, context }) => {
  test.setTimeout(120_000); await open(page); await draft(page); await save(page);
  await page.getByRole('button', { name: /Trendline .* を選択・編集/ }).click();
  await page.getByLabel('Trendline始点価格（円・調整後）').fill('133'); await save(page);
  const other = await context.newPage(); await open(other);
  await other.getByRole('button', { name: /Trendline .* を選択・編集/ }).click();
  await other.getByLabel('Trendline始点価格（円・調整後）').fill('134'); await save(other);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'undo/redo' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  expect((await stored(page))[0].price).toBe(134);
  await other.close();
});

test('rejected Trendline date order keeps an editable draft without reconciliation', async ({ page }) => {
  await open(page); await draft(page);
  await page.getByLabel('Trendline始点日（日足）').fill('2026-09-11');
  await page.getByRole('button', { name: 'Trendlineを保存', exact: true }).click();
  await expect(page.getByText('入力が受け付けられませんでした。', { exact: false })).toBeVisible();
  expect(await stored(page)).toHaveLength(0);
  await expect(page.getByLabel('Trendline始点日（日足）')).toBeEnabled();
  await expect(page.getByLabel('Trendline終点価格（円・調整後）')).toHaveValue('140');
  await page.getByLabel('Trendline始点日（日足）').fill('2026-09-06');
  const rejection = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/drawings'));
  await page.getByRole('button', { name: 'Trendlineを保存', exact: true }).click();
  expect((await rejection).status()).toBe(400);
  await expect(page.getByRole('button', { name: 'Trendlineを保存', exact: true })).toBeEnabled();
  await page.getByLabel('Trendline始点日（日足）').fill('2026-09-03');
  await save(page);
  expect(await stored(page)).toHaveLength(1);
});
