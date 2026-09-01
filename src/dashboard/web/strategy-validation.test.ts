import { describe, expect, test } from 'bun:test';
import {
  buildStrategyValidationSelectionPath,
  clearStrategyValidationQuery,
  parseStrategyValidationCampaignBytes,
  parseStrategyValidationPageSelection,
  strategyValidationSelectionKey,
  strategyValidationRunLabel,
} from './strategy-validation.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '22222222-2222-4222-8222-222222222222';

describe('Strategy-validation Dashboard URL state', () => {
  test('parses none, run, and hierarchical case selections exactly', () => {
    expect(parseStrategyValidationPageSelection('?ticker=7203&tab=validation')).toEqual({
      kind: 'none',
    });
    expect(parseStrategyValidationPageSelection(
      `?ticker=7203&tab=validation&validationRun=${RUN_ID}`,
    )).toEqual({ kind: 'valid', runId: RUN_ID, caseId: null });
    const selected = parseStrategyValidationPageSelection(
      `?ticker=7203&tab=validation&validationRun=${RUN_ID}&validationCase=${CASE_ID}`,
    );
    expect(selected).toEqual({ kind: 'valid', runId: RUN_ID, caseId: CASE_ID });
    expect(strategyValidationSelectionKey(selected)).toBe(`valid:${RUN_ID}:${CASE_ID}`);
  });

  test('rejects malformed, duplicate, and orphaned selectors without repairing them', () => {
    for (const search of [
      `?validationRun=${RUN_ID}&validationRun=${RUN_ID}`,
      `?validationRun=${RUN_ID}&validationCase=${CASE_ID}&validationCase=${CASE_ID}`,
      `?validationCase=${CASE_ID}`,
      '?validationRun=latest',
      `?validationRun=${RUN_ID}&validationCase=latest`,
    ]) {
      expect(parseStrategyValidationPageSelection(search).kind).toBe('invalid');
    }
  });

  test('pushes explicit selection while preserving unrelated query state', () => {
    expect(buildStrategyValidationSelectionPath(
      '7203',
      { kind: 'valid', runId: RUN_ID, caseId: CASE_ID },
      '?ticker=6758&tab=report&base=old&target=new&future=keep',
    )).toBe(
      `/?ticker=7203&tab=validation&base=old&target=new&future=keep&validationRun=${RUN_ID}&validationCase=${CASE_ID}`,
    );
    expect(buildStrategyValidationSelectionPath(
      '7203',
      { kind: 'none' },
      `?ticker=7203&tab=validation&validationRun=${RUN_ID}&validationCase=${CASE_ID}`,
    )).toBe('/?ticker=7203&tab=validation');
  });

  test('removes only Phase 4 run and case selectors', () => {
    const parameters = new URLSearchParams(
      `ticker=7203&tab=validation&validationRun=${RUN_ID}&validationCase=${CASE_ID}&future=keep`,
    );
    clearStrategyValidationQuery(parameters);
    expect(parameters.toString()).toBe('ticker=7203&tab=validation&future=keep');
  });

  test('keeps the immutable run identity visible in explicit-selection labels', () => {
    expect(strategyValidationRunLabel({
      schemaVersion: 'strategy_validation_run_summary_v1',
      runId: RUN_ID,
      mode: 'campaign',
      confidence: 'reconstructed_251_as_of',
      campaignName: '日本株検証',
      completedAt: '2026-09-01T00:00:00.000Z',
      outcomeAsOfSession: '2026-08-31',
      aggregationScope: {
        scopeVersion: 'strategy_validation_aggregation_scope_v1',
        kind: 'campaign_global',
        tickers: ['7203'],
        tickerCount: 1,
        requestedAnchorCount: 1,
      },
      caseCount: 1,
      warnings: [],
    })).toBe(
      `2026-09-01T00:00:00.000Z / 日本株検証 / reconstructed_251_as_of / 1ケース / ${RUN_ID}`,
    );
  });
});

describe('Strategy-validation Dashboard campaign file parser', () => {
  test('uses the shared strict parser before ordinary object serialization', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 'strategy_validation_campaign_v1',
      name: '日本株検証',
      anchors: [{ ticker: '7203', anchorDate: '2025-01-06', resistanceEvidence: [] }],
    }));
    expect(parseStrategyValidationCampaignBytes(bytes)).toMatchObject({
      name: '日本株検証',
      anchors: [{ ticker: '7203', anchorDate: '2025-01-06' }],
    });
  });

  test('rejects duplicate JSON keys and strict-schema extras', () => {
    const duplicate = new TextEncoder().encode(
      '{"schemaVersion":"strategy_validation_campaign_v1","name":"a","name":"b","anchors":[]}',
    );
    expect(() => parseStrategyValidationCampaignBytes(duplicate)).toThrow();
    const extra = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 'strategy_validation_campaign_v1',
      name: 'a',
      anchors: [{ ticker: '7203', anchorDate: '2025-01-06', resistanceEvidence: [] }],
      extra: true,
    }));
    expect(() => parseStrategyValidationCampaignBytes(extra)).toThrow();
  });
});
