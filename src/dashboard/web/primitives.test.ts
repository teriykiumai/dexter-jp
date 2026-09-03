import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import {
  AvailabilityBadges,
  Button,
  Card,
  MetricGrid,
  StatusNotice,
  TableScroll,
} from './primitives.js';
import { contrastRatio, PRIMITIVE_METRICS } from './primitives.test-fixtures.js';

const tokenCss = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');
const primitiveCss = readFileSync(new URL('./primitives.css', import.meta.url), 'utf8');
const design = readFileSync(new URL('../../../DESIGN.md', import.meta.url), 'utf8');
const tokens = new Map([...tokenCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
  .map(([, name, value]) => [name!, value!.trim()]));

function token(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing token ${name}.`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? token(alias[1]!) : value;
}

describe('dexter_design_v1 tokens', () => {
  test('all named DESIGN.md table tokens match exactly, with no extra base colors', () => {
    const rows = [...design.matchAll(/^\| `(--[\w-]+)` \|.*?`([^`]+)` \|$/gm)];
    expect(rows.length).toBe(32);
    for (const [, name, value] of rows) expect(tokens.get(name!)).toBe(value);
    const documentedColors = rows.filter(([, , value]) => value!.startsWith('#')).map(([, name]) => name);
    expect([...tokens].filter(([, value]) => value.startsWith('#')).map(([name]) => name)).toEqual(documentedColors);
    expect(new Set(tokens.keys()).size).toBe([...tokenCss.matchAll(/--[\w-]+:/g)].length);
  });

  test('typography and geometry use the exact roles, not a second scale', () => {
    expect(tokens.get('--type-body')).toBe('400 14px/22px var(--font-ui)');
    expect(tokens.get('--type-page-heading')).toBe('700 24px/32px var(--font-ui)');
    expect(tokens.get('--type-section-heading')).toBe('700 18px/24px var(--font-ui)');
    expect(tokens.get('--type-subsection-heading')).toBe('600 16px/24px var(--font-ui)');
    expect(tokens.get('--type-display')).toBe('700 32px/40px var(--font-ui)');
    expect(tokens.get('--type-display-mobile')).toBe('700 28px/36px var(--font-ui)');
    expect(tokens.get('--type-small')).toBe('400 12px/18px var(--font-ui)');
    expect(tokens.get('--type-label')).toBe('600 11px/16px var(--font-ui)');
    expect(tokens.get('--type-metadata')).toBe('600 11px/16px var(--font-data)');
    expect(tokens.get('--type-data')).toBe('500 12px/18px var(--font-data)');
    expect(tokens.get('--type-kpi')).toBe('600 24px/32px var(--font-data)');
    expect(token('--control-height')).toBe('40px');
    expect(token('--control-compact-height')).toBe('32px');
    expect(token('--touch-target-size')).toBe('44px');
    expect(token('--tab-height')).toBe('48px');
    expect(token('--focus-width')).toBe('2px');
    expect(token('--focus-offset')).toBe('2px');
  });

  test('text, action labels, borders, focus, and chart tokens meet their contrast gates', () => {
    const surfaces = ['--color-canvas', '--color-surface', '--color-surface-muted'];
    const textColors = [
      '--color-text-strong', '--color-text', '--color-text-muted', '--color-accent',
      '--color-accent-active', '--color-positive', '--color-warning', '--color-danger',
      '--color-unavailable',
    ];
    const nonTextColors = [
      '--color-focus', '--color-border-control', '--color-chart-price', '--color-chart-up',
      '--color-chart-down', '--color-chart-volume', '--color-chart-rsi', '--color-chart-macd',
      '--color-chart-signal',
    ];
    for (const surface of surfaces) {
      for (const foreground of textColors) {
        expect(contrastRatio(token(foreground), token(surface))).toBeGreaterThanOrEqual(4.5);
      }
      for (const foreground of nonTextColors) {
        expect(contrastRatio(token(foreground), token(surface))).toBeGreaterThanOrEqual(3);
      }
    }
    for (const background of ['--color-accent', '--color-accent-active', '--color-danger']) {
      expect(contrastRatio(token('--color-surface'), token(background))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('primitive styles reference declared tokens and never fetch assets or add a palette', () => {
    const declared = new Set([
      ...tokens.keys(),
      ...[...primitiveCss.matchAll(/(--[\w-]+):/g)].map(([, name]) => name!),
    ]);
    for (const [, reference] of primitiveCss.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(declared.has(reference!)).toBe(true);
    }
    expect(primitiveCss).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(|gradient\(|backdrop-filter/i);
    expect(`${tokenCss}\n${primitiveCss}`).not.toMatch(/@import|@font-face|url\(/i);
  });
});

describe('shared Dashboard primitives', () => {
  test('Card retains its heading, glossary accessible name, and escaped content', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      title: 'RSI <script>', eyebrow: 'Snapshot', guidanceTerm: 'rsi',
      onOpenGuidance: () => {}, children: '保存済み',
    }));
    const { document } = parseHTML(html);
    expect(document.querySelector('h2')?.textContent).toBe('RSI <script>');
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('RSIの説明を開く');
  });

  test('MetricGrid preserves zero, unavailable, uncollected, order, note, and input', () => {
    const before = structuredClone(PRIMITIVE_METRICS);
    const { document } = parseHTML(renderToStaticMarkup(createElement(MetricGrid, { metrics: PRIMITIVE_METRICS })));
    expect([...document.querySelectorAll('dt')].map(item => item.textContent)).toEqual(before.map(item => item.label));
    expect([...document.querySelectorAll('dd')].map(item => item.textContent)).toEqual(before.map(item => item.value.text));
    expect(document.querySelector('dd')?.querySelector('.unavailable')).toBeNull();
    expect(document.querySelectorAll('dd .unavailable').length).toBe(2);
    expect(document.querySelector('small')?.textContent).toBe(before[0]!.note!);
    expect(PRIMITIVE_METRICS).toEqual(before);
  });

  test('availability stays two explicit counts and does not invent a zero-count warning', () => {
    expect(renderToStaticMarkup(createElement(AvailabilityBadges, { counts: { unavailable: 0, uncollected: 0 } }))).toBe('');
    const { document } = parseHTML(renderToStaticMarkup(createElement(AvailabilityBadges, {
      counts: { unavailable: 1, uncollected: 2 }, compact: true,
    })));
    expect([...document.querySelectorAll('.availability-badge')].map(item => item.textContent)).toEqual(['利用不可 1', '未収集 2']);
  });

  test('buttons keep native disabled semantics and default to non-submitting actions', () => {
    const { document } = parseHTML(renderToStaticMarkup(createElement(Button, {
      disabled: true, variant: 'primary', children: '実行できません', 'aria-busy': true,
    })));
    const button = document.querySelector('button')!;
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('実行できません');
  });

  test('notices require explanatory content and exact tables have a named keyboard region', () => {
    const { document } = parseHTML(renderToStaticMarkup(createElement(StatusNotice, {
      title: '保存値を保持', tone: 'warning', role: 'status', children: '更新に失敗しました。',
    })));
    expect(document.querySelector('[role="status"] h3')?.textContent).toBe('保存値を保持');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('更新に失敗しました。');
    const table = parseHTML(renderToStaticMarkup(createElement(TableScroll, {
      label: '保存値の表', children: createElement('table'),
    }))).document;
    expect(table.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('保存値の表');
    expect(table.querySelector('[role="region"]')?.getAttribute('tabindex')).toBe('0');
  });
});
