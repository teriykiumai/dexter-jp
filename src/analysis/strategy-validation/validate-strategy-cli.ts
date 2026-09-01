import { config } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { AnalysisSnapshotPersistenceError } from '../snapshot/errors.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { PointInTimeErrorV1 } from './errors.js';
import {
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  acceptJQuantsExecutionV1,
  requireFeasibleJQuantsExecutionV1,
} from './jquants-execution.js';
import {
  StrategyValidationRunRepositoryErrorV1,
  StrategyValidationRunRepositoryV1,
} from './run-repository.js';
import {
  createSnapshotAuditPreflightV1,
  createSnapshotAuditSourceV1,
  executeSnapshotAuditV1,
  type SnapshotAuditPreflightV1,
} from './snapshot-audit.js';

export type ValidateStrategyCliArgsV1 = Readonly<{
  ticker: string;
  snapshotId: string;
  confirmedExternalFetch: boolean;
}>;

function usageError(message: string): never {
  throw new JQuantsValidationErrorV1(
    'invalid_configuration',
    `${message} Usage: --ticker <ticker> --snapshot-id <snapshotId> [--confirm-external-fetch]`,
  );
}

export function parseValidateStrategyCliArgsV1(
  args: readonly string[],
): ValidateStrategyCliArgsV1 {
  const values = new Map<string, string>();
  let confirmedExternalFetch = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-external-fetch') {
      if (confirmedExternalFetch) usageError('Duplicate --confirm-external-fetch flag.');
      confirmedExternalFetch = true;
      continue;
    }
    if (arg !== '--ticker' && arg !== '--snapshot-id') {
      usageError('Unknown or positional argument.');
    }
    if (values.has(arg)) usageError(`Duplicate ${arg} argument.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) usageError(`${arg} requires a value.`);
    values.set(arg, value);
    index += 1;
  }
  if (values.size !== 2) usageError('ticker and snapshot-id are required.');
  const ticker = CanonicalTickerSchema.safeParse(values.get('--ticker'));
  if (!ticker.success) usageError('ticker must be a canonical four-character JPX code.');
  const snapshotId = SnapshotIdSchema.safeParse(values.get('--snapshot-id'));
  if (!snapshotId.success) usageError('snapshot-id is unsafe or malformed.');
  return Object.freeze({
    ticker: ticker.data,
    snapshotId: snapshotId.data,
    confirmedExternalFetch,
  });
}

export function formatSnapshotAuditWarningV1(preflight: SnapshotAuditPreflightV1): string {
  const plan = preflight.executionPlan;
  return [
    'Phase 4 saved-Snapshot Strategy audit',
    `target: ${preflight.ticker}, snapshot: ${preflight.snapshotId}`,
    `date range: ${preflight.calendarDateFrom} through ${preflight.calendarDateTo}`,
    `minimum attempts: ${plan.estimatedMinimumAttempts}, minimum dispatch duration: ${plan.minimumDispatchDurationMs} ms`,
    `rate: ${plan.requestsPerMinute}/minute, request timeout: ${plan.requestTimeoutMs} ms`,
    `attempt cap: ${plan.hardMaximumAttempts}, execution budget: ${plan.executionBudgetMs} ms`,
    'destination: .dexter/research/strategy-validation/runs/<runId>',
    'This sends ticker/date selectors to the configured J-Quants account and consumes subscription quota.',
    'Pagination, retries, response latency, and dynamically required dated master evidence can still exhaust the limits.',
    'No credential, raw response body, request ID, or absolute local path is persisted.',
  ].join('\n');
}

async function interactiveConfirmation(warning: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${warning}\nContinue? [y/N] `);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    prompt.close();
  }
}

export async function runValidateStrategyCliV1(
  args: readonly string[],
  options: Readonly<{
    snapshotRepository?: AnalysisSnapshotRepository;
    runRepository?: StrategyValidationRunRepositoryV1;
    confirm?: (warning: string) => Promise<boolean>;
    writeOutput?: (value: string) => void;
    signal?: AbortSignal;
    startedAt?: string;
    requestsPerMinute?: number;
  }> = {},
): Promise<Awaited<ReturnType<typeof executeSnapshotAuditV1>>> {
  const parsed = parseValidateStrategyCliArgsV1(args);
  const preflight = await createSnapshotAuditPreflightV1(parsed, {
    snapshotRepository: options.snapshotRepository ?? new AnalysisSnapshotRepository(),
    startedAt: options.startedAt,
    requestsPerMinute: options.requestsPerMinute,
  });
  requireFeasibleJQuantsExecutionV1(preflight.executionPlan);
  const warning = formatSnapshotAuditWarningV1(preflight);
  const confirmed = parsed.confirmedExternalFetch
    || await (options.confirm ?? interactiveConfirmation)(warning);
  if (!confirmed) {
    throw new JQuantsValidationErrorV1(
      'cancelled',
      'External fetch was not confirmed. Non-interactive use requires --confirm-external-fetch.',
    );
  }
  const writeOutput = options.writeOutput ?? (value => stdout.write(value));
  if (parsed.confirmedExternalFetch) writeOutput(`${warning}\n`);
  const accepted = acceptJQuantsExecutionV1(preflight.executionPlan);
  const runtime = new JQuantsExecutionRuntimeV1(accepted, { signal: options.signal });
  const result = await executeSnapshotAuditV1(preflight, {
    source: createSnapshotAuditSourceV1(runtime),
    runtime,
    accepted,
    runRepository: options.runRepository ?? new StrategyValidationRunRepositoryV1(),
    signal: options.signal,
  });
  writeOutput(`${JSON.stringify(result)}\n`);
  return result;
}

function errorCode(error: unknown): string {
  if (error instanceof JQuantsValidationErrorV1 || error instanceof PointInTimeErrorV1) {
    return error.code;
  }
  if (error instanceof AnalysisSnapshotPersistenceError) return error.kind;
  if (error instanceof StrategyValidationRunRepositoryErrorV1) return error.kind;
  return 'internal_error';
}

async function main(): Promise<void> {
  config({ quiet: true });
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await runValidateStrategyCliV1(process.argv.slice(2), { signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ state: 'unavailable', code: errorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
