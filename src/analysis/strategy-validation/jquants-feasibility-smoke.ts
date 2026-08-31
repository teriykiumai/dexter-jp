import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import {
  parseSourceDate,
  parseTseSessionDate,
  tokyoDateFromUtcInstantV1,
  type AsOfCutoff,
  type TseSessionDate,
} from './date.js';
import { PointInTimeErrorV1 } from './errors.js';
import {
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  acceptJQuantsExecutionV1,
  planJQuantsExecutionV1,
  resolveJQuantsRequestsPerMinuteV1,
} from './jquants-execution.js';
import { JQuantsValidationAdapterV1 } from './jquants-validation-adapter.js';
import { requireDailyBarsForSessionsV1 } from './daily-bar.js';

export const JQUANTS_FEASIBILITY_SMOKE_ATTEMPT_LIMIT_V1 = 10 as const;
export const JQUANTS_FEASIBILITY_SMOKE_MINIMUM_ATTEMPTS_V1 = 3 as const;
export const JQUANTS_FEASIBILITY_WORST_CASE_SESSION_V1 = 79 as const;

export type JQuantsFeasibilitySmokeArgsV1 = Readonly<{
  ticker: string;
  anchor: string;
  outcomeTo: string;
  confirmedExternalFetch: boolean;
}>;

export type JQuantsFeasibilityEvidenceV1 = Readonly<{
  ticker: string;
  anchor: TseSessionDate;
  maturityThrough: TseSessionDate;
  marketCode: string;
  scaleCategory: string | null;
  attempts: number;
  calendarDigest: string;
  masterDigest: string;
  dailyBarsDigest: string;
}>;

function usageError(message: string): never {
  throw new JQuantsValidationErrorV1(
    'invalid_configuration',
    `${message} Usage: --ticker <ticker> --anchor <YYYY-MM-DD> --outcome-to <YYYY-MM-DD> [--confirm-external-fetch]`,
  );
}

export function parseJQuantsFeasibilitySmokeArgsV1(args: readonly string[]): JQuantsFeasibilitySmokeArgsV1 {
  const values = new Map<string, string>();
  let confirmedExternalFetch = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-external-fetch') {
      if (confirmedExternalFetch) usageError('Duplicate --confirm-external-fetch flag.');
      confirmedExternalFetch = true;
      continue;
    }
    if (arg !== '--ticker' && arg !== '--anchor' && arg !== '--outcome-to') {
      usageError('Unknown or positional argument.');
    }
    if (values.has(arg)) usageError(`Duplicate ${arg} argument.`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) usageError(`${arg} requires a value.`);
    values.set(arg, value);
    index += 1;
  }
  if (values.size !== 3) usageError('ticker, anchor, and outcome-to are required.');
  const tickerResult = CanonicalTickerSchema.safeParse(values.get('--ticker'));
  if (!tickerResult.success) usageError('ticker must be a canonical four-character JPX code.');
  const anchor = parseSourceDate(values.get('--anchor'));
  const outcomeTo = parseSourceDate(values.get('--outcome-to'));
  if (anchor >= outcomeTo) usageError('outcome-to must be later than the anchor.');
  return Object.freeze({ ticker: tickerResult.data, anchor, outcomeTo, confirmedExternalFetch });
}

function unavailable(reason: 'source_plan_unavailable' | 'source_history_unavailable'): never {
  throw new JQuantsValidationErrorV1(reason, 'The configured J-Quants source cannot prove the Phase 4 feasibility gate.');
}

export async function proveJQuantsMaturedAnchorV1(
  adapter: JQuantsValidationAdapterV1,
  runtime: JQuantsExecutionRuntimeV1,
  input: Readonly<{
    ticker: string;
    anchor: string;
    outcomeTo: string;
    startedAt: AsOfCutoff;
    signal?: AbortSignal;
  }>,
): Promise<JQuantsFeasibilityEvidenceV1> {
  const anchor = parseTseSessionDate(parseSourceDate(input.anchor));
  const outcomeTo = parseSourceDate(input.outcomeTo);
  if (outcomeTo >= tokyoDateFromUtcInstantV1(input.startedAt)) {
    throw new PointInTimeErrorV1(
      'source_response_invalid',
      'The feasibility outcome boundary must be strictly before the startedAt Tokyo date.',
    );
  }
  const calendarResult = await adapter.fetchCalendar({
    dateFrom: anchor,
    dateTo: outcomeTo,
    asOfCutoff: input.startedAt,
    signal: input.signal,
  });
  if (calendarResult.state === 'unavailable') unavailable(calendarResult.reason);
  if (!calendarResult.calendar.isSession(anchor)) {
    throw new PointInTimeErrorV1('calendar_incomplete', 'The feasibility anchor is not a TSE session.');
  }
  const maturityThrough = calendarResult.calendar.shiftSession(
    anchor,
    JQUANTS_FEASIBILITY_WORST_CASE_SESSION_V1,
  );
  const masterResult = await adapter.fetchMaster({
    ticker: input.ticker,
    date: anchor,
    asOfCutoff: input.startedAt,
    signal: input.signal,
  });
  if (masterResult.state === 'unavailable') unavailable(masterResult.reason);
  const dailyResult = await adapter.fetchDailyBars({
    ticker: input.ticker,
    dateFrom: anchor,
    dateTo: maturityThrough,
    asOfCutoff: input.startedAt,
    signal: input.signal,
  });
  if (dailyResult.state === 'unavailable') unavailable(dailyResult.reason);
  const anchorIndex = calendarResult.calendar.sessions.indexOf(anchor);
  const requiredSessions = calendarResult.calendar.sessions.slice(
    anchorIndex,
    anchorIndex + JQUANTS_FEASIBILITY_WORST_CASE_SESSION_V1 + 1,
  );
  const requiredBars = requireDailyBarsForSessionsV1(dailyResult.bars, requiredSessions);
  if (requiredBars[0]?.open === null) {
    throw new PointInTimeErrorV1(
      'price_history_incomplete',
      'The feasibility anchor has no traded raw OHLC row.',
    );
  }
  runtime.assertCanContinue(input.signal);
  return Object.freeze({
    ticker: input.ticker,
    anchor,
    maturityThrough,
    marketCode: masterResult.observation.marketCode,
    scaleCategory: masterResult.observation.scaleCategory,
    attempts: runtime.attempts.length,
    calendarDigest: calendarResult.envelope.digest,
    masterDigest: masterResult.envelope.digest,
    dailyBarsDigest: dailyResult.envelope.digest,
  });
}

async function interactiveConfirmation(warning: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${warning}\nContinue? [y/N] `);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const args = parseJQuantsFeasibilitySmokeArgsV1(process.argv.slice(2));
  const requestsPerMinute = resolveJQuantsRequestsPerMinuteV1();
  const plan = planJQuantsExecutionV1(
    JQUANTS_FEASIBILITY_SMOKE_MINIMUM_ATTEMPTS_V1,
    requestsPerMinute,
  );
  const startedAt = new Date().toISOString() as AsOfCutoff;
  const warning = [
    'Phase 4 J-Quants feasibility smoke (no artifact output)',
    `target: ${args.ticker}, anchor: ${args.anchor}, outcome through: ${args.outcomeTo}`,
    `minimum attempts: ${plan.estimatedMinimumAttempts}, minimum dispatch duration: ${plan.minimumDispatchDurationMs} ms`,
    `rate: ${plan.requestsPerMinute}/minute, attempt cap: ${JQUANTS_FEASIBILITY_SMOKE_ATTEMPT_LIMIT_V1}`,
    `request timeout: ${plan.requestTimeoutMs} ms, execution budget: ${plan.executionBudgetMs} ms`,
    'This sends ticker/date selectors to the configured J-Quants account and consumes subscription quota.',
    'Pagination/retries/latency can still exhaust the limits. No response body or credential is printed.',
  ].join('\n');
  const confirmed = args.confirmedExternalFetch || await interactiveConfirmation(warning);
  if (!confirmed) {
    throw new JQuantsValidationErrorV1(
      'cancelled',
      'External fetch was not confirmed. Non-interactive use requires --confirm-external-fetch.',
    );
  }
  if (args.confirmedExternalFetch) stdout.write(`${warning}\n`);
  const accepted = acceptJQuantsExecutionV1(plan);
  const runtime = new JQuantsExecutionRuntimeV1(accepted, {
    actualAttemptLimit: JQUANTS_FEASIBILITY_SMOKE_ATTEMPT_LIMIT_V1,
  });
  const evidence = await proveJQuantsMaturedAnchorV1(
    new JQuantsValidationAdapterV1(runtime),
    runtime,
    { ...args, startedAt },
  );
  stdout.write(`${JSON.stringify({ state: 'available', ...evidence })}\n`);
}

if (import.meta.main) {
  main().catch(error => {
    const code = error instanceof JQuantsValidationErrorV1
      ? error.code
      : error instanceof PointInTimeErrorV1
        ? error.code
        : 'internal_error';
    process.stderr.write(`${JSON.stringify({ state: 'unavailable', code })}\n`);
    process.exitCode = 1;
  });
}
