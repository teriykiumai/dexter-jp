import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { DashboardRouteError, MarketOverviewPlaceholder, Watchlist } from './watchlist.js';
import type { WatchlistItemView } from './presentation.js';

const available = (text: string) => ({ text, available: true });
const item: WatchlistItemView = {
  ticker: '7203', companyName: '日本語 <script>株式会社', status: 'partial',
  price: available('0'), per: { text: '利用不可', available: false }, pbr: available('0.00'),
  roe: available('0%'), trend: available('range_or_transition'), marginPercentile: available('0%'),
  beta250: { text: '未収集', available: false }, latestDataDate: available('2026-08-21'),
  latestDataDateRaw: '2026-08-21', generatedAt: available('2026-08-23 10:02 JST'),
  generatedAtRaw: '2026-08-23T01:02:03.000Z', stale: true,
};
const navigation = { currentSearch: '?future=keep', onShowWatchlist: () => {}, onShowMarketOverview: () => {} };
function renderWatchlist(overrides: Partial<ComponentProps<typeof Watchlist>> = {}) {
  return parseHTML(renderToStaticMarkup(createElement(Watchlist, {
    ...navigation, items: [item], sortKey: 'latestDataDate', onSort: () => {}, onSelect: () => {},
    loading: false, error: null, onRetry: () => {}, ...overrides,
  }))).document;
}

describe('complete Watchlist light surface', () => {
  test('preserves every stored column, exact zero, missing states, roles, and immutable input', () => {
    const before = structuredClone(item);
    const document = renderWatchlist();
    expect([...document.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual([
      '銘柄', '株価', 'PER', 'PBR', 'ROE', 'トレンド', '信用倍率Percentile', 'Beta 250',
      '最新基準日', '生成日時', '状態', '詳細への移動',
    ]);
    const values = [...document.querySelectorAll('tbody .design-value')];
    expect(values.map(value => value.textContent)).toEqual([
      '0', '利用不可', '0.00', '0%', 'range_or_transition', '0%', '未収集', '2026-08-21', '2026-08-23 10:02 JST',
    ]);
    expect(values.map(value => value.getAttribute('data-kind')))
      .toEqual(['data', 'text', 'data', 'data', 'text', 'data', 'text', 'data', 'data']);
    expect(document.querySelectorAll('thead .numeric-cell').length).toBe(6);
    expect(document.querySelectorAll('tbody .numeric-cell').length).toBe(6);
    expect(document.querySelector('tbody th')?.getAttribute('scope')).toBe('row');
    expect(document.querySelector('.analysis-company')?.textContent).toContain(item.companyName);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('.analysis-date-note')?.textContent).toBe('7日超');
    expect(document.querySelector('.table-scroll')?.getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('.table-scroll')?.getAttribute('aria-label')).toBe('保存済み分析一覧を横スクロール');
    expect(item).toEqual(before);
  });

  test('sort state is explicit, remains stable, and never changes the passed collection', () => {
    const newer = { ...item, ticker: '6758', generatedAtRaw: '2026-08-24T01:02:03.000Z', latestDataDateRaw: '2026-08-20' };
    const items = [item, newer];
    const before = structuredClone(items);
    for (const [sortKey, order] of [
      ['latestDataDate', ['7203', '6758']], ['generatedAt', ['6758', '7203']],
    ] as const) {
      const document = renderWatchlist({ items, sortKey });
      expect([...document.querySelectorAll('tbody tr')].map(row => row.getAttribute('data-ticker'))).toEqual([...order]);
      expect(document.querySelectorAll('button[aria-pressed="true"]').length).toBe(1);
    }
    expect(items).toEqual(before);
  });

  test('loading and initial failure never masquerade as zero saved items or empty data', () => {
    for (const error of [null, '読み込み失敗']) {
      const document = renderWatchlist({ items: null, loading: error === null, error });
      expect(document.querySelector('h1')?.textContent).toBe('保存済み分析');
      expect(document.querySelector('.watchlist-summary')).toBeNull();
      expect(document.querySelector('table')).toBeNull();
      expect(document.querySelectorAll('nav a').length).toBe(2);
      expect(document.querySelector(error ? '[role="alert"]' : '[role="status"]')).not.toBeNull();
      expect(document.querySelector('h2')?.textContent).not.toBe('保存済み分析はありません');
    }
    const empty = renderWatchlist({ items: [] });
    expect(empty.querySelector('h2')?.textContent).toBe('保存済み分析はありません');
    expect(empty.querySelector('.watchlist-summary dd')?.textContent).toBe('0');
  });

  test('refresh failure retains the last valid list with an explicit warning and correct headings', () => {
    const document = renderWatchlist({ error: '読み込み失敗' });
    expect(document.querySelector('tbody tr')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('前回の保存済み一覧');
    expect([...document.querySelectorAll('h1, h2, h3')].map(heading => heading.tagName)).toEqual(['H1', 'H2', 'H3']);
  });

  test('global placeholder and scoped errors expose no data or execution controls', () => {
    const global = parseHTML(renderToStaticMarkup(createElement(MarketOverviewPlaceholder, navigation))).document;
    expect(global.querySelector('h1')?.textContent).toBe('市場概況');
    expect(global.querySelector('.design-badge')?.textContent).toBe('全市場共通');
    expect(global.querySelector('a[aria-current="page"]')?.getAttribute('href')).toContain('view=market-overview');
    expect(global.querySelectorAll('table, button, [role="tab"]').length).toBe(0);
    const invalid = parseHTML(renderToStaticMarkup(createElement(DashboardRouteError, {
      ...navigation, reason: 'conflicting_owner',
    }))).document;
    expect(invalid.querySelector('[role="alert"]')?.textContent).toContain('読み込みは行っていません');
    expect(invalid.querySelectorAll('a[aria-current]').length).toBe(0);
  });

  test('surface styling uses declared tokens with no external assets or independent palette', () => {
    const css = readFileSync(new URL('./watchlist.css', import.meta.url), 'utf8');
    const tokens = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');
    const names = new Set([...tokens.matchAll(/(--[\w-]+):/g)].map(([, name]) => name));
    for (const [, reference] of css.matchAll(/var\((--[\w-]+)\)/g)) expect(names.has(reference)).toBe(true);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|gradient\(|backdrop-filter|@import|@font-face|url\(/i);
  });
});
