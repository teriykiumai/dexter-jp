import { config } from 'dotenv';
import { createInterface } from 'node:readline/promises';
import { readFile, stat } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { AnalysisSnapshotPersistenceError } from '../snapshot/errors.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { PointInTimeErrorV1 } from './errors.js';
import {
  createCampaignReconstructionPreflightV1,
  createCampaignReconstructionSourceV1,
  executeCampaignReconstructionV1,
  type CampaignReconstructionPreflightV1,
} from './campaign-reconstruction.js';
import {
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  acceptJQuantsExecutionV1,
  requireFeasibleJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
} from './jquants-execution.js';
import {
  STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES,
  StrategyValidationManifestErrorV1,
  parseStrategyValidationCampaignJsonV1,
} from './manifest.js';
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

export type ValidateStrategyCliArgsV1 =
  | Readonly<{
    ticker: string;
    snapshotId: string;
    confirmedExternalFetch: boolean;
  }>
  | Readonly<{
    manifestPath: string;
    confirmedExternalFetch: boolean;
  }>;

function usageError(message: string): never {
  throw new JQuantsValidationErrorV1(
    'invalid_configuration',
    `${message} Usage: (--ticker <ticker> --snapshot-id <snapshotId> | --manifest <campaign.json>) [--confirm-external-fetch]`,
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
    if (arg !== '--ticker' && arg !== '--snapshot-id' && arg !== '--manifest') {
      usageError('Unknown or positional argument.');
    }
    if (values.has(arg)) usageError(`Duplicate ${arg} argument.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) usageError(`${arg} requires a value.`);
    values.set(arg, value);
    index += 1;
  }
  const hasManifest = values.has('--manifest');
  const hasSnapshot = values.has('--ticker') || values.has('--snapshot-id');
  if (hasManifest === hasSnapshot) usageError('Exactly one Snapshot or manifest mode is required.');
  if (hasManifest) {
    if (values.size !== 1) usageError('manifest mode accepts only --manifest.');
    const manifestPath = values.get('--manifest');
    if (manifestPath === undefined || manifestPath.length === 0) {
      usageError('manifest requires a file path.');
    }
    return Object.freeze({ manifestPath, confirmedExternalFetch });
  }
  if (values.size !== 2 || !values.has('--ticker') || !values.has('--snapshot-id')) {
    usageError('ticker and snapshot-id are required together.');
  }
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

async function readCampaignManifest(path: string) {
  let details;
  try {
    details = await stat(path);
  } catch {
    usageError('manifest must name an existing regular file.');
  }
  if (!details.isFile()) usageError('manifest must name an existing regular file.');
  if (details.size > STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES) {
    throw new StrategyValidationManifestErrorV1('input_too_large');
  }
  return parseStrategyValidationCampaignJsonV1(await readFile(path));
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

export function formatCampaignReconstructionWarningV1(
  preflight: CampaignReconstructionPreflightV1,
): string {
  const plan = preflight.executionPlan;
  const tickers = [...new Set(preflight.anchors.map(anchor => anchor.ticker))].sort();
  return [
    'Phase 4 historical Strategy reconstruction',
    `target: ${tickers.length} ticker(s), ${preflight.anchors.length} anchor(s)`,
    `date range: ${preflight.calendarDateFrom} through ${preflight.calendarDateTo}`,
    `minimum attempts: ${plan.estimatedMinimumAttempts}, minimum dispatch duration: ${plan.minimumDispatchDurationMs} ms`,
    `rate: ${plan.requestsPerMinute}/minute, request timeout: ${plan.requestTimeoutMs} ms`,
    `attempt cap: ${plan.hardMaximumAttempts}, execution budget: ${plan.executionBudgetMs} ms`,
    'candidate policy: technical_251_strategy_v1 (not production-pipeline parity)',
    'destination: .dexter/research/strategy-validation/runs/<runId>',
    'This sends ticker/date selectors to the configured J-Quants account and consumes subscription quota.',
    'Pagination, retries, response latency, and dynamically required Master/outcome evidence can still exhaust the limits.',
    'No credential, raw response body, request ID, manifest path, or absolute local path is persisted.',
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
    executionEnvironment?: JQuantsExecutionEnvironmentV1;
  }> = {},
): Promise<
  | Awaited<ReturnType<typeof executeSnapshotAuditV1>>
  | Awaited<ReturnType<typeof executeCampaignReconstructionV1>>
> {
  const parsed = parseValidateStrategyCliArgsV1(args);
  const snapshotRepository = options.snapshotRepository ?? new AnalysisSnapshotRepository();
  const campaignMode = 'manifestPath' in parsed;
  const preflight = campaignMode
    ? await createCampaignReconstructionPreflightV1(
      await readCampaignManifest(parsed.manifestPath),
      {
        snapshotRepository,
        startedAt: options.startedAt,
        requestsPerMinute: options.requestsPerMinute,
      },
    )
    : await createSnapshotAuditPreflightV1(parsed, {
      snapshotRepository,
      startedAt: options.startedAt,
      requestsPerMinute: options.requestsPerMinute,
    });
  requireFeasibleJQuantsExecutionV1(preflight.executionPlan);
  const writeOutput = options.writeOutput ?? (value => stdout.write(value));
  const externalFetchRequired = preflight.executionPlan.estimatedMinimumAttempts > 0;
  if (externalFetchRequired) {
    const warning = preflight.mode === 'campaign'
      ? formatCampaignReconstructionWarningV1(preflight)
      : formatSnapshotAuditWarningV1(preflight);
    const confirmed = parsed.confirmedExternalFetch
      || await (options.confirm ?? interactiveConfirmation)(warning);
    if (!confirmed) {
      throw new JQuantsValidationErrorV1(
        'cancelled',
        'External fetch was not confirmed. Non-interactive use requires --confirm-external-fetch.',
      );
    }
    if (parsed.confirmedExternalFetch) writeOutput(`${warning}\n`);
  }
  const accepted = acceptJQuantsExecutionV1(
    preflight.executionPlan,
    options.executionEnvironment,
  );
  const runtime = new JQuantsExecutionRuntimeV1(accepted, {
    environment: options.executionEnvironment,
    signal: options.signal,
  });
  const runRepository = options.runRepository ?? new StrategyValidationRunRepositoryV1();
  const result = preflight.mode === 'campaign'
    ? await executeCampaignReconstructionV1(preflight, {
      source: createCampaignReconstructionSourceV1(runtime),
      runtime,
      accepted,
      runRepository,
      signal: options.signal,
    })
    : await executeSnapshotAuditV1(preflight, {
      source: createSnapshotAuditSourceV1(runtime),
      runtime,
      accepted,
      runRepository,
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
  if (error instanceof StrategyValidationManifestErrorV1) return error.kind;
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
