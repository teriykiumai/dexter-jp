import { describe, expect, test } from 'bun:test';
import { parseEvaluatorCliArguments } from './cli.js';

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
});
