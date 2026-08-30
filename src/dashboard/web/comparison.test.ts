import { describe, expect, test } from 'bun:test';
import { createSnapshotId, type AnalysisSnapshotHistoryItem } from '../../analysis/snapshot/index.js';
import {
  COMPARISON_PAIR_REQUIREMENT,
  buildComparisonPath,
  buildComparisonResetPath,
  comparisonIdentityKey,
  comparisonMetricLabel,
  comparisonRowMatchesFilter,
  formatComparisonIdentity,
  isValidComparisonPair,
  parseComparisonPageSelection,
  restoreComparisonHistoryState,
  resolveComparisonPair,
} from './comparison.js';

function historyItem(generatedAt: string): AnalysisSnapshotHistoryItem {
  return {
    snapshotId: createSnapshotId(generatedAt),
    canonicalTicker: '7203',
    companyName: 'テスト株式会社',
    generatedAt,
    status: 'complete',
    dataDates: {} as AnalysisSnapshotHistoryItem['dataDates'],
  };
}

describe('comparison Dashboard controller helpers', () => {
  test('parses only an exact, complete, distinct Snapshot pair', () => {
    const base = '2026-08-22T01-02-03-000Z';
    const target = '2026-08-23T01-02-03-000Z';
    expect(parseComparisonPageSelection('')).toEqual({ kind: 'none' });
    expect(parseComparisonPageSelection(`?base=${base}`)).toMatchObject({ kind: 'invalid' });
    expect(parseComparisonPageSelection(`?base=${base}&target=${base}`)).toMatchObject({ kind: 'invalid' });
    expect(parseComparisonPageSelection(`?base=${base}&base=${base}&target=${target}`)).toMatchObject({ kind: 'invalid' });
    expect(parseComparisonPageSelection(`?base=${base}&target=${target}`)).toEqual({
      kind: 'valid',
      pair: { baseSnapshotId: base, targetSnapshotId: target },
    });
  });

  test('uses numeric epoch order to resolve the immediate predecessor', () => {
    const noFraction = historyItem('2026-08-23T01:02:03Z');
    const halfSecond = historyItem('2026-08-23T01:02:03.500Z');
    const later = historyItem('2026-08-24T01:02:03.000Z');
    const history = [later, noFraction, halfSecond];

    expect(resolveComparisonPair(history, halfSecond.snapshotId)).toEqual({
      baseSnapshotId: noFraction.snapshotId,
      targetSnapshotId: halfSecond.snapshotId,
    });
    expect(resolveComparisonPair(history, noFraction.snapshotId)).toBeNull();
    expect(isValidComparisonPair(history, {
      baseSnapshotId: noFraction.snapshotId,
      targetSnapshotId: later.snapshotId,
    })).toBeTrue();
    expect(isValidComparisonPair(history, {
      baseSnapshotId: later.snapshotId,
      targetSnapshotId: halfSecond.snapshotId,
    })).toBeFalse();
    expect(COMPARISON_PAIR_REQUIREMENT).toContain('2件以上');
  });

  test('preserves matching future Evaluation selectors only for the same target', () => {
    const base = '2026-08-22T01-02-03-000Z';
    const target = '2026-08-23T01-02-03-000Z';
    const evaluation = '123e4567-e89b-42d3-a456-426614174000';
    const current = `?ticker=7203&tab=evaluation&evaluationSnapshot=${target}&evaluation=${evaluation}&future=keep`;
    const preserved = new URL(buildComparisonPath(
      '7203',
      { baseSnapshotId: base, targetSnapshotId: target },
      current,
      true,
    ), 'http://localhost');
    expect(preserved.searchParams.get('evaluationSnapshot')).toBe(target);
    expect(preserved.searchParams.get('evaluation')).toBe(evaluation);
    expect(preserved.searchParams.get('future')).toBe('keep');

    const changed = new URL(buildComparisonPath(
      '7203',
      { baseSnapshotId: base, targetSnapshotId: '2026-08-24T01-02-03-000Z' },
      current,
      false,
    ), 'http://localhost');
    expect(changed.searchParams.has('evaluationSnapshot')).toBeFalse();
    expect(changed.searchParams.has('evaluation')).toBeFalse();
  });

  test('reset preserves only an Evaluation tuple matching the former target', () => {
    const target = '2026-08-23T01-02-03-000Z';
    const evaluation = '123e4567-e89b-42d3-a456-426614174000';
    const current = `?ticker=7203&base=2026-08-22T01-02-03-000Z&target=${target}&evaluationSnapshot=${target}&evaluation=${evaluation}`;
    const reset = new URL(buildComparisonResetPath('7203', current, target), 'http://localhost');
    expect(reset.searchParams.has('base')).toBeFalse();
    expect(reset.searchParams.has('target')).toBeFalse();
    expect(reset.searchParams.get('evaluationSnapshot')).toBe(target);
    expect(reset.searchParams.get('evaluation')).toBe(evaluation);
  });

  test('row filters keep changed and issue semantics distinct', () => {
    const changed = { section: 'valuation', comparison: { state: 'comparable', changed: true } };
    const unchanged = { section: 'valuation', comparison: { state: 'comparable', changed: false } };
    const issue = { section: 'valuation', comparison: { state: 'not_applicable' } };
    expect(comparisonRowMatchesFilter(changed as never, 'attention', 'all')).toBeTrue();
    expect(comparisonRowMatchesFilter(issue as never, 'attention', 'all')).toBeTrue();
    expect(comparisonRowMatchesFilter(unchanged as never, 'attention', 'all')).toBeFalse();
    expect(comparisonRowMatchesFilter(issue as never, 'changed', 'all')).toBeFalse();
    expect(comparisonRowMatchesFilter(changed as never, 'issues', 'all')).toBeFalse();
  });

  test('binds long-balance statistics to their stable Supply/Demand keys', () => {
    const expectedLabels = {
      'supplyDemand.mean4w': '信用買残4週平均',
      'supplyDemand.mean13w': '信用買残13週平均',
      'supplyDemand.mean52w': '信用買残52週平均',
      'supplyDemand.deviation52w': '信用買残52週平均乖離率',
      'supplyDemand.percentile52w': '信用買残52週パーセンタイル',
    } as const;

    for (const [metricKey, label] of Object.entries(expectedLabels)) {
      expect(comparisonMetricLabel({ metricKey, instanceIdentity: [] } as never)).toBe(label);
    }
  });

  test('formats exact instance and Observation identity members without dropping nulls', () => {
    expect(formatComparisonIdentity([])).toBe('固定条件なし');
    expect(formatComparisonIdentity([
      { name: 'latestFiscalYear', value: 2026 },
      { name: 'indexCode', value: '0040' },
      { name: 'benchmark', value: null },
    ])).toBe('latestFiscalYear=2026 / indexCode=0040 / benchmark=null');
  });

  test('restores transient UI state only for the exact pair and result versions', () => {
    const response = {
      outcome: 'success',
      resultVersion: 1,
      registryVersion: 1,
      base: { snapshotId: '2026-08-22T01-02-03-000Z' },
      target: { snapshotId: '2026-08-23T01-02-03-000Z' },
    } as never;
    const identityKey = comparisonIdentityKey('7203', response);
    const historyState = {
      comparison: {
        identityKey,
        rowFilter: 'all',
        sectionFilter: 'valuation',
        openDisclosureIds: ['valuation.currentPrice:[]'],
      },
    };
    expect(restoreComparisonHistoryState(historyState, identityKey)).toMatchObject({
      rowFilter: 'all',
      sectionFilter: 'valuation',
    });
    expect(restoreComparisonHistoryState(historyState, identityKey.replace(/:1:1$/, ':2:1'))).toBeNull();
    expect(restoreComparisonHistoryState(historyState, identityKey.replace('2026-08-22', '2026-08-21'))).toBeNull();
  });
});
