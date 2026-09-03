import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from 'playwright/test';
import { contrastRatio } from './primitives.test-fixtures.js';

const legacyCss = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const tokenCss = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');
const primitiveCss = readFileSync(new URL('./primitives.css', import.meta.url), 'utf8');
let markup: string;

async function openPrimitives(page: Page): Promise<void> {
  const requests: string[] = [];
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.setContent(`<!doctype html><html lang="ja"><head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${legacyCss}\n${tokenCss}\n${primitiveCss}</style>
    </head><body>${markup}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  expect(requests).toEqual([]);
}

test.describe('DR-V1 shared visual primitives', () => {
  test.beforeAll(() => {
    // Render real React JSX with Bun, not Playwright's component-test JSX transform.
    markup = execFileSync('bun', ['-e', [
      "import { createElement } from 'react';",
      "import { renderToStaticMarkup } from 'react-dom/server';",
      "import { PrimitivesFixture } from './src/dashboard/web/primitives.test-fixtures.tsx';",
      'process.stdout.write(renderToStaticMarkup(createElement(PrimitivesFixture)));',
    ].join('\n')], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
  });

  test('light tokens do not leak into an untouched legacy surface', async ({ page }) => {
    await page.setContent(`<style>${legacyCss}</style><section class="panel">
      <h2>未移行のカード</h2><span class="unavailable">利用不可</span>
      <button class="guidance-button">?</button></section>`);
    const appearance = () => page.locator('.panel, .panel h2, .unavailable, .guidance-button').evaluateAll(elements => (
      elements.map(element => {
        const style = getComputedStyle(element);
        return [style.color, style.background, style.font, style.padding, style.border, style.borderRadius, style.boxShadow];
      })
    ));
    const before = await appearance();
    await page.addStyleTag({ content: `${tokenCss}\n${primitiveCss}` });
    expect(await appearance()).toEqual(before);
  });

  test('computed typography, flat surfaces, semantic text, and contrast match DESIGN.md', async ({ page }) => {
    await openPrimitives(page);
    await expect(page.locator('.dashboard-design')).toHaveCSS('color-scheme', 'light');
    await expect(page.locator('.dashboard-design')).toHaveCSS('background-color', 'rgb(244, 248, 251)');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('line-height', '32px');
    await expect(page.locator('.panel').first()).toHaveCSS('border-radius', '12px');
    await expect(page.locator('.panel').first()).toHaveCSS('background-image', 'none');
    await expect(page.locator('.panel').first()).toHaveCSS('box-shadow', 'none');
    await expect(page.locator('.eyebrow').first()).toHaveCSS('text-transform', 'none');
    await expect(page.locator('.metric-row dd').first()).toHaveText('0');
    await expect(page.locator('.metric-row dd').first()).toHaveCSS('font-variant-numeric', 'tabular-nums');
    await expect(page.locator('.metric-row dd').first()).toHaveCSS('color', 'rgb(15, 23, 42)');
    await expect(page.locator('.metric-row dd .unavailable').first()).toHaveCSS('color', 'rgb(71, 85, 105)');
    await expect(page.locator('.availability-badges.compact .availability-badge').first()).toHaveCSS('font-size', '11px');
    await expect(page.getByRole('status')).toContainText('再読込に失敗しました');
    await expect(page.getByRole('status')).toContainText('前回の保存値を表示しています');

    const pairs = await page.locator('h1, h2, h3, p, dt, dd, small, .eyebrow, .availability-badge, .design-badge, button, input, select, th, td, a')
      .evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element);
        let parent: Element | null = element;
        let background = '';
        while (parent) {
          background = getComputedStyle(parent).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)') break;
          parent = parent.parentElement;
        }
        return { color: style.color, background, label: element.textContent?.slice(0, 60) };
      }));
    for (const pair of pairs) {
      expect(contrastRatio(pair.color, pair.background), pair.label).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('native keyboard targets, disabled actions, associated help/errors, and exact table remain usable', async ({ page }) => {
    await openPrimitives(page);
    await page.keyboard.press('Tab');
    const guidance = page.getByRole('button', { name: 'RSIの説明を開く' });
    await expect(guidance).toBeFocused();
    await expect(guidance).toHaveCSS('outline-width', '2px');
    await expect(guidance).toHaveCSS('outline-offset', '2px');
    await expect(guidance).toHaveCSS('outline-color', 'rgb(3, 105, 161)');
    const primary = page.getByRole('button', { name: '保存済みデータを読む' });
    await page.keyboard.press('Tab');
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS('outline-style', 'solid');
    const disabled = page.getByRole('button', { name: '実行できません' });
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveCSS('opacity', '1');
    await expect(disabled).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await page.getByRole('button', { name: '実行を中止' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'コンパクト' })).toBeFocused();

    await page.locator('form').evaluate(form => form.addEventListener('submit', event => {
      event.preventDefault();
      form.setAttribute('data-submitted', 'true');
    }));
    await primary.click();
    await expect(page.locator('form')).not.toHaveAttribute('data-submitted');
    await expect(page.getByLabel('識別子', { exact: true })).toHaveAccessibleDescription('これは入力表示の確認用です。');
    await expect(page.getByLabel('選択対象', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('選択対象', { exact: true })).toHaveAccessibleDescription('入力エラー: 対象が指定されていません。');
    await expect(page.getByLabel('選択対象', { exact: true })).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
    const table = page.getByRole('region', { name: '保存値の表を横スクロール' });
    await page.getByLabel('表示対象', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(table).toBeFocused();
    await expect(table).toHaveCSS('outline-width', '2px');
    await expect(table.getByRole('table')).toHaveAccessibleName('合成データ / 2026-08-21 / 数値・利用不可・未収集を区別');
    await expect(page.getByRole('link', { name: '正確な保存値へ' })).toHaveCSS('text-decoration-line', 'underline');
  });

  for (const width of [320, 390, 680, 768, 980, 1024, 1280]) {
    test(`fits ${width}px without document overflow and keeps data locally scrollable`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await openPrimitives(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator('.panel').first()).toHaveCSS('padding', width < 680 ? '16px' : '24px');
      const targets = await page.locator('button, input, select, a').evaluateAll(elements => (
        elements.map(element => ({
          tag: element.tagName,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          compact: element.getAttribute('data-compact') === 'true',
        }))
      ));
      for (const target of targets) {
        if (width < 680) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        } else if (target.tag !== 'A') {
          expect(target.height).toBeGreaterThanOrEqual(target.compact ? 32 : 40);
        }
      }
      if (width < 680) {
        const table = page.getByRole('region', { name: '保存値の表を横スクロール' });
        expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await table.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        await table.evaluate(element => { element.scrollLeft = 0; });
      }
      await page.screenshot({ path: testInfo.outputPath(`primitives-${width}.png`), fullPage: true });
    });
  }

  test('coarse pointer keeps wide-screen compact controls touch-safe', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    try {
      const page = await context.newPage();
      await openPrimitives(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      for (const box of await page.locator('button, input, select, a').evaluateAll(elements => (
        elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
      ))) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  });

  test('hover does not move controls and reduced motion disables feedback transitions', async ({ page }) => {
    await openPrimitives(page);
    const primary = page.getByRole('button', { name: '保存済みデータを読む' });
    await primary.scrollIntoViewIfNeeded();
    const before = await primary.boundingBox();
    await primary.hover();
    await expect(primary).toHaveCSS('background-color', 'rgb(7, 89, 133)');
    expect(await primary.boundingBox()).toEqual(before);
    await expect(primary).toHaveCSS('transform', 'none');
    await expect(primary).toHaveCSS('transition-duration', '0.12s, 0.12s, 0.12s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(primary).toHaveCSS('transition-duration', '0s');
    await expect(primary).toHaveCSS('animation-name', 'none');
  });
});
