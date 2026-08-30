import { describe, expect, test } from 'bun:test';
import {
  formatEvaluatorConfirmationSummary,
  parseEvaluatorCliArguments,
} from './cli.js';

describe('Evaluator CLI arguments', () => {
  test('uses explicit model before saved model', () => {
    expect(parseEvaluatorCliArguments([
      '--ticker', '7203',
      '--snapshot-id', '2026-08-30T01-02-03-000Z',
      '--model', 'gpt-5.6-terra',
      '--confirm-external-send',
    ], 'gpt-5.6-sol')).toEqual({
      ticker: '7203',
      snapshotId: '2026-08-30T01-02-03-000Z',
      model: 'gpt-5.6-terra',
      confirmExternalSend: true,
    });
  });

  test('uses saved model when --model is absent', () => {
    expect(parseEvaluatorCliArguments([
      '--ticker', '7203',
      '--snapshot-id', '2026-08-30T01-02-03-000Z',
    ], 'gpt-5.6-sol').model).toBe('gpt-5.6-sol');
  });

  test('rejects missing, duplicate, and unknown arguments', () => {
    expect(() => parseEvaluatorCliArguments(['--ticker', '7203'], 'gpt-5.6-terra')).toThrow();
    expect(() => parseEvaluatorCliArguments([
      '--ticker', '7203', '--ticker', '6758',
      '--snapshot-id', '2026-08-30T01-02-03-000Z',
    ], 'gpt-5.6-terra')).toThrow();
    expect(() => parseEvaluatorCliArguments([
      '--ticker', '7203',
      '--snapshot-id', '2026-08-30T01-02-03-000Z',
      '--latest',
    ], 'gpt-5.6-terra')).toThrow();
  });

  test('discloses the exact single-request transport limit before confirmation', () => {
    const formatted = formatEvaluatorConfirmationSummary({
      ticker: '7203',
      snapshotId: '2026-08-30T01-02-03-000Z',
      providerId: 'openai',
      modelId: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      baseUrl: 'https://api.openai.com/v1',
      organizationId: null,
      projectId: null,
      reportUtf16Units: 100,
      reportUtf8Bytes: 200,
      manifestUtf16Units: 300,
      totalLogicalInputUtf16Units: 400,
      httpRequestUtf8Bytes: 500,
      httpRequestMaxUtf8Bytes: 1_000_000,
      httpRequestLimit: 1,
      timeoutMs: 180_000,
      externalSend: true,
      apiCostPossible: true,
    });
    expect(formatted).toContain('HTTP request limit: 1');
  });
});
