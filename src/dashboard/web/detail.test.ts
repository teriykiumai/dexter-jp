import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DASHBOARD_TABS, DASHBOARD_SECTION_DESTINATIONS } from './presentation.js';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

test('Step 8 keeps four history tabs and preserves raw Snapshot ownership', () => {
  expect(DASHBOARD_TABS).toEqual([
    { id: 'report', label: '概要・レポート' },
    { id: 'technical', label: '株価・テクニカル' },
    { id: 'fundamentals', label: '保存済み配当' },
    { id: 'supply-demand', label: '需給・空売り' },
  ]);
  expect(Object.values(DASHBOARD_SECTION_DESTINATIONS)).not.toContain('market-overview');
});

test('production root is Light and cannot load the legacy palette', () => {
  const html = read('./index.html');
  expect(html).toContain('name="color-scheme" content="light"');
  expect(html).toContain('href="./detail.css"');
  expect(html).not.toContain('href="./styles.css"');
  expect(read('./detail.css')).toContain(':root { color-scheme: light;');
});

test('complex surfaces and canvas consume declared tokens without a private palette or assets', () => {
  const css = read('./detail.css');
  const tokens = new Set([...read('./design-tokens.css').matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  for (const match of css.matchAll(/var\((--[\w-]+)/g)) expect(tokens.has(match[1])).toBeTrue();
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|https?:|url\(|gradient\(|backdrop-filter/iu);
  expect(read('./chart.tsx')).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  expect(read('./chart.tsx')).toContain("color('--color-chart-volume')");
});
