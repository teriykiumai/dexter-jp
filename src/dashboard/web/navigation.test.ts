import { describe, expect, test } from 'bun:test';
import {
  DASHBOARD_TABS,
  buildDashboardTabPath,
  buildDetailPath,
  buildMarketOverviewPath,
  buildWatchlistPath,
  parseDashboardPageRoute,
  parseDetailTab,
} from './presentation.js';
import { buildComparisonPath, buildComparisonResetPath } from './comparison.js';
import { buildStrategyValidationSelectionPath } from './strategy-validation.js';

const detailKeys = ['ticker', 'tab', 'base', 'target', 'validationRun', 'validationCase', 'chartSource', 'interval'];
const unknown = 'future=keep&future=again&note=%E6%97%A5%E6%9C%AC%E8%AA%9E';

describe('Dashboard Refresh page ownership', () => {
  test('recognizes defaults, global scope, and the inherited ticker/tab parser', () => {
    for (const search of ['', `?${unknown}`, '?ticker=../7203', '?ticker=72030']) {
      expect(parseDashboardPageRoute(search)).toEqual({ kind: 'watchlist' });
    }
    for (const suffix of ['', '&marketRange=1y', `&${unknown}`]) {
      expect(parseDashboardPageRoute(`?view=market-overview${suffix}`)).toEqual({ kind: 'market-overview' });
    }
    for (const ticker of ['7203', '130A']) {
      for (const tab of ['', '&tab=unknown', '&tab=market-overview', '&tab=report']) {
        const search = `?ticker=${ticker}${tab}`;
        expect(parseDashboardPageRoute(search)).toEqual({ kind: 'detail', ticker });
        expect(parseDetailTab(search)).toBe('report');
      }
    }
    expect(parseDashboardPageRoute('?ticker=7203&ticker=6758'))
      .toEqual({ kind: 'detail', ticker: '7203' });
  });

  test('rejects every raw detail key with the global owner, even empty values', () => {
    for (const key of detailKeys) {
      const value = key === 'chartSource' ? 'auto' : key === 'interval' ? 'day' : '7203';
      expect(parseDashboardPageRoute(`?view=market-overview&${key}=${value}`))
        .toEqual({ kind: 'invalid', reason: 'conflicting_owner' });
      expect(parseDashboardPageRoute(`?view=market-overview&${key}=`).kind).toBe('invalid');
    }
  });

  test('rejects orphan owned state instead of silently treating it as Watchlist', () => {
    for (const entry of [
      'tab=', 'tab=report', 'base=old', 'target=new', 'validationRun=run',
      'validationCase=case', 'chartSource=auto', 'interval=week', 'marketRange=1y',
    ]) {
      for (const owner of ['', 'ticker=bad&']) {
        expect(parseDashboardPageRoute(`?${owner}${entry}&${unknown}`))
          .toEqual({ kind: 'invalid', reason: 'missing_owner' });
      }
    }
  });

  test('validates all closed enums and duplicate occurrences, even while dormant', () => {
    const cases = {
      view: ['market-overview'], chartSource: ['auto', 'snapshot', 'latest'],
      interval: ['day', 'week', 'month'], marketRange: ['3m', '6m', '1y', '3y', 'max'],
    };
    for (const [key, values] of Object.entries(cases)) {
      const prefix = key === 'view' ? '?' : '?ticker=7203&tab=report&';
      for (const value of values) {
        expect(parseDashboardPageRoute(`${prefix}${key}=${value}`).kind)
          .toBe(key === 'view' ? 'market-overview' : 'detail');
        expect(parseDashboardPageRoute(`${prefix}${key}=${value}&${key}=${value}`))
          .toEqual({ kind: 'invalid', reason: 'invalid_parameter' });
      }
      for (const value of ['', 'invalid', values[0]!.toUpperCase(), `${values[0]}%20`]) {
        expect(parseDashboardPageRoute(`${prefix}${key}=${value}`))
          .toEqual({ kind: 'invalid', reason: 'invalid_parameter' });
      }
    }
    for (const tab of DASHBOARD_TABS) {
      expect(parseDashboardPageRoute(`?ticker=7203&tab=${tab.id}&chartSource=latest&interval=month&marketRange=max`))
        .toEqual({ kind: 'detail', ticker: '7203' });
    }
  });
});

describe('Dashboard Refresh URL transitions', () => {
  const detail = `?ticker=7203&tab=technical&base=old&target=new&validationRun=run&validationCase=case&chartSource=latest&interval=month&marketRange=3y&${unknown}`;

  test('global entry clears every detail key, preserves valid range and unknown duplicates', () => {
    const global = new URL(buildMarketOverviewPath(detail), 'http://localhost');
    expect([...global.searchParams]).toEqual([
      ['marketRange', '3y'], ['future', 'keep'], ['future', 'again'], ['note', '日本語'],
      ['view', 'market-overview'],
    ]);
    expect(parseDashboardPageRoute(global.search).kind).toBe('market-overview');
    expect(buildMarketOverviewPath()).toBe('/?view=market-overview');
    for (const invalid of ['marketRange=bad', 'marketRange=max&marketRange=max']) {
      expect(buildMarketOverviewPath(`?view=bad&${invalid}&${unknown}`))
        .toBe(`/?view=market-overview&${unknown}`);
    }
  });

  test('return to list clears recognized state only, including duplicate/invalid keys', () => {
    expect(buildWatchlistPath(`${detail}&view=market-overview&interval=day`)).toBe(`/?${unknown}`);
    expect(buildWatchlistPath('?view=market-overview&marketRange=max')).toBe('/');
  });

  test('ticker change resets selection/source/range but preserves interval and unknowns', () => {
    const next = new URL(buildDetailPath('6758', 'report', `${detail}&view=market-overview`), 'http://localhost');
    expect([...next.searchParams]).toEqual([
      ['ticker', '6758'], ['tab', 'report'], ['interval', 'month'],
      ['future', 'keep'], ['future', 'again'], ['note', '日本語'],
    ]);
  });

  test('tab changes and Comparison preserve dormant new keys and inherited selection ownership', () => {
    for (const tab of DASHBOARD_TABS) {
      const next = new URL(buildDashboardTabPath('7203', tab.id, detail), 'http://localhost');
      const expected = new URLSearchParams(detail);
      expected.set('tab', tab.id);
      expect([...next.searchParams]).toEqual([...expected]);
    }
    const pair = { baseSnapshotId: '20260821T010203000Z', targetSnapshotId: '20260823T010203000Z' };
    for (const path of [
      buildComparisonPath('7203', pair, detail), buildComparisonResetPath('7203', detail),
      buildStrategyValidationSelectionPath('7203', { kind: 'valid', runId: 'run', caseId: 'case' }, detail),
    ]) {
      const parameters = new URL(path, 'http://localhost').searchParams;
      expect(parameters.get('chartSource')).toBe('latest');
      expect(parameters.get('interval')).toBe('month');
      expect(parameters.get('marketRange')).toBe('3y');
      expect(parameters.get('validationRun')).toBe('run');
      expect(parameters.getAll('future')).toEqual(['keep', 'again']);
    }
  });
});
