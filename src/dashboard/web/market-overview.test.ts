import { expect, test } from 'bun:test';
import { MARKET_RANGES, elapsedCalendarDays, etfDirection, etfNumber, marketRange, marketRangePath } from './market-overview.js';
import { parseDashboardPageRoute, buildWatchlistPath, buildDetailPath, buildDashboardTabPath } from './presentation.js';

test('ETF range updates only its owned query, retains unknown duplicates and restores all five ranges', () => {
  expect(marketRange('?view=market-overview')).toBe('1y');
  for (const range of MARKET_RANGES) {
    const path = marketRangePath('?ticker=1321&tab=market-overview&future=a&future=b', range);
    expect(marketRange(path.slice(1))).toBe(range);
    const query = new URL(path, 'http://localhost').searchParams;
    expect(query.getAll('future')).toEqual(['a', 'b']);
    expect(query.get('ticker')).toBe('1321');
    expect(new URL(buildDashboardTabPath('1321', 'technical', query.toString()), 'http://localhost').searchParams.get('marketRange')).toBe(range);
    expect(new URL(buildWatchlistPath(query.toString()), 'http://localhost').searchParams.has('marketRange')).toBe(false);
    expect(new URL(buildDetailPath('2633', 'report', query.toString()), 'http://localhost').searchParams.has('marketRange')).toBe(false);
  }
  for (const search of ['?view=market-overview&marketRange=bad', '?view=market-overview&marketRange=1y&marketRange=3m']) expect(parseDashboardPageRoute(search).kind).toBe('invalid');
});
test('elapsed dates use local calendar days, not hours or a freshness classification', () => {
  expect(elapsedCalendarDays('2026-09-09', new Date(2026, 8, 10, 0, 1))).toBe(1);
  expect(elapsedCalendarDays('2026-09-10', new Date(2026, 8, 10, 23, 59))).toBe(0);
});
test('presentation never infers direction from rounded differences and preserves exact zero', () => {
  const base = { range: '1y' as const, state: 'available' as const, rangeStart: '2025-09-10', rangeEnd: '2026-09-10', commonDates: [], normalized1321: [], normalized2633: [], return1321Percent: 0, return2633Percent: 0, differencePercentagePoints: 0.0000001 };
  expect(etfNumber(base.differencePercentagePoints)).toBe('0');
  expect(etfDirection({ ...base, direction: '1321_leads' })).toBe('JPY建てETF市場価格・選択期間: 1321優勢');
  expect(etfDirection({ ...base, direction: '2633_leads' })).toContain('2633優勢');
  expect(etfDirection({ ...base, direction: 'same' })).toContain('同水準');
  expect(etfNumber(0)).toBe('0');
});
