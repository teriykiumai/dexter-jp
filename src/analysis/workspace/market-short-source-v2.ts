import { createMarketDataReaderV1, TechnicalSourceFailureV1, type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { parse, fail } from './contracts.js';
import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { MARKET_SHORT_COVERAGE_V1, MARKET_SHORT_COVERAGE_DIGEST_V1, MARKET_SHORT_PUBLIC_SAMPLE_V1,
  MarketShortRowSchemaV1 } from './market-short-source-gate.js';
import { MARKET_SHORT_BINDING_POLICY_V2, MARKET_SHORT_LIMITS_V2,
  marketShortAdmissionV2, marketShortCalendarV2, marketShortInputV2 } from './market-short-policy-v2.js';

/** Frozen controls from the admitted owner; this collector never acquires a lease. */
export type MarketShortCollectionContextV2 = TechnicalCollectionContextV1 & Readonly<{
  monotonicOriginMs: number; requestsPerMinute: number;
}>;
const timeout = (): never => { throw new TechnicalSourceFailureV1('source_timeout'); };

async function untilAborted<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  if (signal.aborted) return timeout();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new TechnicalSourceFailureV1('source_timeout'));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { return await Promise.race([start(), aborted]); }
  finally { signal.removeEventListener('abort', rejectAbort); }
}

/** Explicit single-day collection only. No persistence, latest fallback or source cache. */
export async function collectWorkspaceMarketShortV2(date: string, context: MarketShortCollectionContextV2,
  environment: JQuantsExecutionEnvironmentV1) {
  const { acceptedAt, monotonicOriginMs, requestsPerMinute } = context;
  marketShortAdmissionV2(date, acceptedAt);
  const limits = MARKET_SHORT_LIMITS_V2, acceptedMs = Date.parse(acceptedAt);
  if (!Number.isFinite(monotonicOriginMs) || !Number.isInteger(requestsPerMinute)
    || requestsPerMinute < 1 || requestsPerMinute > 500) fail('invalid_input');
  const rpm = Math.min(requestsPerMinute, limits.maximumRequestsPerMinute);
  const controller = new AbortController(), signal = AbortSignal.any([context.signal, controller.signal]);
  let clock = monotonicOriginMs, wall = acceptedMs, attempts = 0, lastDispatch = -Infinity;
  const check = (wait = 0) => {
    const now = environment.monotonicNowMs(), observed = environment.wallNowMs();
    if (!Number.isFinite(now) || now < clock || !Number.isFinite(observed) || observed < wall) fail('invalid_input');
    clock = now; wall = observed;
    if (signal.aborted || now - monotonicOriginMs + wait >= limits.deadlineMs
      || observed - acceptedMs + wait >= limits.deadlineMs) return timeout();
    return now - monotonicOriginMs;
  };
  // Reject an infeasible two-query schedule before reading credentials or dispatching.
  check(60_000 / rpm);
  const deadline = setTimeout(() => controller.abort(), Math.min(limits.deadlineMs - check(), limits.deadlineMs - (wall - acceptedMs)));
  const bounded: TechnicalCollectionContextV1 = {
    ...context, signal, shareSource: (_key, load) => load(),
    waitBeforeRetry: async () => { throw new TechnicalSourceFailureV1('source_invalid_response'); },
    recordProgress: progress => { check(); context.recordProgress(progress); },
    dispatch: async start => {
      check();
      if (attempts >= limits.attempts) throw new TechnicalSourceFailureV1('source_pagination_incomplete');
      while (clock < lastDispatch + 60_000 / rpm) {
        const wait = lastDispatch + 60_000 / rpm - clock;
        check(wait);
        await untilAborted(signal, () => environment.sleep(wait, signal));
        check();
      }
      // Ownership/rate logging stays with the caller's shared dispatcher. Recheck
      // inside its callback so a queued callback cannot start after our deadline.
      return untilAborted(signal, () => context.dispatch(async ownerSignal => {
        check();
        if (attempts >= limits.attempts || clock < lastDispatch + 60_000 / rpm) fail('invalid_input');
        attempts++; lastDispatch = clock;
        const request = new AbortController(), requestSignal = AbortSignal.any([signal, ownerSignal, request.signal]);
        const started = clock, timer = setTimeout(() => request.abort(), limits.requestTimeoutMs);
        try {
          const result = await untilAborted(requestSignal, () => start(requestSignal));
          check();
          if (clock - started >= limits.requestTimeoutMs) return timeout();
          return result;
        } finally { clearTimeout(timer); request.abort(); }
      }, signal));
    },
  };
  try {
    const reader = createMarketDataReaderV1(bounded, environment, limits);
    const calendar = marketShortCalendarV2(await reader.fetchRows('calendar', '/v2/markets/calendar', { from: date, to: date }), date);
    check();
    const rows = (await reader.fetchRows('market_short', '/v2/markets/short-ratio', { date }))
      .map(row => parse(MarketShortRowSchemaV1, row)).sort((a, b) => a.S33.localeCompare(b.S33));
    const elapsedMs = check(), metrics = reader.metrics();
    if (metrics.attempts !== attempts) fail('invalid_input');
    const evidence = (role: string) => {
      const fetched = reader.fetched.get(role)!;
      return { fetchedAt: fetched.fetchedAt, pageCount: fetched.pageCount, rowCount: fetched.rows.length, complete: true as const };
    };
    const input = marketShortInputV2({ version: 'workspace_market_short_input_v2', policyVersion: MARKET_SHORT_BINDING_POLICY_V2,
      scope: MARKET_SHORT_SCOPE_V1, registry: MARKET_SHORT_COVERAGE_V1, registryDigest: MARKET_SHORT_COVERAGE_DIGEST_V1,
      date, acceptedAt, correctionVintage: 'current_at_fetch_not_point_in_time',
      source: { endpoint: '/v2/markets/short-ratio', query: { date }, ...evidence('market_short') },
      calendar: { endpoint: '/v2/markets/calendar', query: { from: date, to: date }, evidence: evidence('calendar'), rows: calendar },
      execution: { ...metrics, elapsedMs, requestsPerMinute: rpm, retries: 0 }, rows,
      publishedReference: date === MARKET_SHORT_PUBLIC_SAMPLE_V1.date ? MARKET_SHORT_PUBLIC_SAMPLE_V1 : null });
    check();
    return input;
  } finally { clearTimeout(deadline); controller.abort(); }
}
