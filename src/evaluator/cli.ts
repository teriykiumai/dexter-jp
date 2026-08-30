import { createInterface } from 'node:readline/promises';
import { DEFAULT_MODEL } from '../model/runtime.js';
import { getSetting } from '../utils/config.js';
import {
  EvaluatorRunError,
  evaluatePersistedSnapshotV1,
  type EvaluatorConfirmationSummaryV1,
} from './runtime.js';

export type EvaluatorCliArguments = Readonly<{
  ticker: string;
  snapshotId: string;
  model: string;
  confirmExternalSend: boolean;
}>;

function usage(): string {
  return 'bun run evaluate:snapshot --ticker <ticker> --snapshot-id <id> [--model <model>] [--confirm-external-send]';
}

export function parseEvaluatorCliArguments(
  args: readonly string[],
  savedModel: string = getSetting('modelId', DEFAULT_MODEL),
): EvaluatorCliArguments {
  const values = new Map<string, string>();
  let confirmExternalSend = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--confirm-external-send') {
      if (confirmExternalSend) throw new Error(usage());
      confirmExternalSend = true;
      continue;
    }
    if (!['--ticker', '--snapshot-id', '--model'].includes(argument)) {
      throw new Error(usage());
    }
    if (values.has(argument)) throw new Error(usage());
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--') || value.length === 0) {
      throw new Error(usage());
    }
    values.set(argument, value);
    index += 1;
  }
  const ticker = values.get('--ticker');
  const snapshotId = values.get('--snapshot-id');
  if (ticker === undefined || snapshotId === undefined) throw new Error(usage());
  return {
    ticker,
    snapshotId,
    model: values.get('--model') ?? savedModel ?? DEFAULT_MODEL,
    confirmExternalSend,
  };
}

export function formatEvaluatorConfirmationSummary(
  summary: EvaluatorConfirmationSummaryV1,
): string {
  return [
    'Evaluator external-send confirmation',
    `ticker: ${summary.ticker}`,
    `snapshotId: ${summary.snapshotId}`,
    `runtime: ${summary.providerId} / ${summary.modelId} / ${summary.reasoningEffort ?? 'none'}`,
    `endpoint: ${summary.baseUrl}`,
    'organization: none',
    'project: none',
    `report: ${summary.reportUtf16Units} UTF-16 units / ${summary.reportUtf8Bytes} UTF-8 bytes`,
    `manifest: ${summary.manifestUtf16Units} UTF-16 units`,
    `logical input: ${summary.totalLogicalInputUtf16Units} UTF-16 units`,
    `HTTP body: ${summary.httpRequestUtf8Bytes} / ${summary.httpRequestMaxUtf8Bytes} UTF-8 bytes`,
    `HTTP request limit: ${summary.httpRequestLimit}`,
    `timeout: ${summary.timeoutMs} ms`,
    'external send: yes',
    'API cost: may be charged',
  ].join('\n');
}

async function confirmExternalSend(
  summary: EvaluatorConfirmationSummaryV1,
  confirmedByFlag: boolean,
): Promise<boolean> {
  process.stdout.write(`${formatEvaluatorConfirmationSummary(summary)}\n`);
  if (confirmedByFlag) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await reader.question('外部送信とAPI費用の可能性を承認しますか？ [y/N] ')).trim();
    return answer === 'y' || answer === 'Y';
  } finally {
    reader.close();
  }
}

export async function runEvaluatorCli(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  let parsed: EvaluatorCliArguments;
  try {
    parsed = parseEvaluatorCliArguments(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : usage()}\n`);
    return 2;
  }
  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  try {
    const result = await evaluatePersistedSnapshotV1({
      ticker: parsed.ticker,
      snapshotId: parsed.snapshotId,
      selectedModel: parsed.model,
      signal: controller.signal,
    }, {
      confirmExternalSend: summary => confirmExternalSend(summary, parsed.confirmExternalSend),
    });
    process.stdout.write(`${JSON.stringify({
      state: result.state,
      ticker: parsed.ticker,
      snapshotId: parsed.snapshotId,
      evaluationId: result.evaluationId,
      resultState: result.resultState,
    })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof EvaluatorRunError) {
      process.stderr.write(`${JSON.stringify({
        state: 'failed',
        ticker: error.selector.ticker,
        snapshotId: error.selector.snapshotId,
        code: error.code,
        message: error.message,
        ...(error.safetyCode === null ? {} : { safetyCode: error.safetyCode }),
        ...(error.costMayHaveOccurred ? { costMayHaveOccurred: true } : {}),
      })}\n`);
      return 1;
    }
    process.stderr.write(`${JSON.stringify({
      state: 'failed',
      ticker: parsed.ticker,
      snapshotId: parsed.snapshotId,
      code: 'snapshot_unavailable',
      message: 'The Evaluator command failed before completion.',
    })}\n`);
    return 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}

if (import.meta.main) {
  process.exitCode = await runEvaluatorCli();
}
