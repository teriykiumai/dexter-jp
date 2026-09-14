import { canonicalJsonV1 } from '../snapshot/canonical-json.js';
import { DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1, resolveJQuantsRequestsPerMinuteV1,
  type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { createMarketDataReaderV1, TechnicalSourceFailureV1,
  type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { inspectMarketShortCoverageV1, compareMarketShortPublicSampleV1, MARKET_SHORT_COVERAGE_V1,
  MARKET_SHORT_PUBLIC_SAMPLE_V1, MarketShortSourceGateError } from './market-short-source-gate.js';

export const MARKET_SHORT_SMOKE_LIMITS = Object.freeze({ logicalQueries: 1, attempts: 5, pages: 5,
  rows: 200, responseBytes: 2 * 1024 * 1024, requestTimeoutMs: 30_000, deadlineMs: 60_000,
  retries: 0, maximumRequestsPerMinute: 5 });
export class MarketShortSmokeError extends Error {
  constructor(readonly code: 'cancelled' | 'invalid_configuration' | 'execution_timeout'
    | 'attempt_limit_exceeded' | 'retry_disabled') { super(code); }
}
const fail = (code: MarketShortSmokeError['code']): never => { throw new MarketShortSmokeError(code); };
type Diagnostic = { attempts: number; pages: number; acceptedRows: number; responseBytes: number };

/** Explicit fixed-day source gate. Not a Dashboard job, artifact writer or market module. */
export async function proveMarketShortSourceCoverageV1(options: {
  confirmed: boolean; environment?: JQuantsExecutionEnvironmentV1; requestsPerMinute?: number;
  observe?: (diagnostic: Diagnostic) => void;
}) {
  if (options.confirmed !== true) return fail('cancelled');
  const env = options.environment ?? DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1;
  const now = env.wallNowMs(), origin = env.monotonicNowMs();
  if (!Number.isFinite(now) || !Number.isFinite(origin)
    || now < Date.parse('2026-09-11T00:00:00Z')) return fail('invalid_configuration');
  const configured = options.requestsPerMinute ?? resolveJQuantsRequestsPerMinuteV1();
  if (!Number.isInteger(configured) || configured < 1 || configured > 500) return fail('invalid_configuration');
  const rpm = Math.min(configured, MARKET_SHORT_SMOKE_LIMITS.maximumRequestsPerMinute);
  let attempts = 0, lastDispatch = -Infinity;
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), MARKET_SHORT_SMOKE_LIMITS.deadlineMs);
  const check = () => {
    if (abort.signal.aborted || !Number.isFinite(env.monotonicNowMs())
      || env.monotonicNowMs() - origin >= MARKET_SHORT_SMOKE_LIMITS.deadlineMs) {
      abort.abort(); return fail('execution_timeout');
    }
  };
  const context: TechnicalCollectionContextV1 = {
    jobId: 'diagnostic-only', acceptedAt: new Date(now).toISOString(), signal: abort.signal,
    shareSource: (_key, load) => load(), recordProgress: () => {},
    waitBeforeRetry: async () => fail('retry_disabled'),
    dispatch: async start => {
      check();
      if (attempts >= MARKET_SHORT_SMOKE_LIMITS.attempts) return fail('attempt_limit_exceeded');
      const wait = lastDispatch + 60_000 / rpm - env.monotonicNowMs();
      if (wait > 0) await env.sleep(wait, abort.signal);
      check();
      attempts++; lastDispatch = env.monotonicNowMs();
      const request = new AbortController(), onAbort = () => request.abort();
      abort.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(onAbort, MARKET_SHORT_SMOKE_LIMITS.requestTimeoutMs);
      let rejectTimeout!: () => void;
      const timeout = new Promise<never>((_resolve, reject) => {
        rejectTimeout = () => reject(new MarketShortSmokeError('execution_timeout'));
        request.signal.addEventListener('abort', rejectTimeout, { once: true });
      });
      try { return await Promise.race([start(request.signal), timeout]); }
      finally {
        clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort);
        request.signal.removeEventListener('abort', rejectTimeout);
      }
    },
  };
  let reader: ReturnType<typeof createMarketDataReaderV1> | undefined;
  try {
    reader = createMarketDataReaderV1(context, env, MARKET_SHORT_SMOKE_LIMITS);
    const rows = await reader.fetchRows('market_short', '/v2/markets/short-ratio',
      { date: MARKET_SHORT_PUBLIC_SAMPLE_V1.date });
    check();
    const result = inspectMarketShortCoverageV1(rows, MARKET_SHORT_PUBLIC_SAMPLE_V1.date,
      new Date(now).toISOString().slice(0, 10));
    const comparison = compareMarketShortPublicSampleV1(result);
    return { schemaVersion: 'workspace_market_short_source_gate_v1',
      state: comparison.state === 'matched' ? 'passed' : 'incomplete',
      acceptedAt: context.acceptedAt, checkedAt: new Date(env.wallNowMs()).toISOString(),
      limits: MARKET_SHORT_SMOKE_LIMITS, requestsPerMinute: rpm, metrics: reader.metrics(),
      registry: MARKET_SHORT_COVERAGE_V1, sourceRevision: 'official_specs_retrieved_2026_09_14',
      sample: MARKET_SHORT_PUBLIC_SAMPLE_V1, result, comparison,
      evidenceScope: 'fixed_sample_coverage_and_public_total_reconciliation',
      historicalCoverage: 'not_verified', longHistoryEntitlement: 'not_tested',
      productionModule: 'not_implemented' };
  } finally {
    clearTimeout(deadline); abort.abort();
    options.observe?.(reader?.metrics() ?? { attempts, pages: 0, acceptedRows: 0, responseBytes: 0 });
  }
}

if (import.meta.main) {
  let diagnostic: Diagnostic | undefined;
  void proveMarketShortSourceCoverageV1({ confirmed: process.argv.slice(2).join('\0') === '--confirm-external-fetch',
    observe: value => { diagnostic = value; } }).then(result => {
    console.log(canonicalJsonV1(result));
    if (result.state !== 'passed') process.exitCode = 1;
  }).catch(error => {
    console.error(JSON.stringify({ state: 'unavailable', code: error instanceof MarketShortSmokeError
      || error instanceof MarketShortSourceGateError || error instanceof TechnicalSourceFailureV1
      ? error.code : 'source_response_invalid', ...(diagnostic ? { diagnostic } : {}) }));
    process.exitCode = 1;
  });
}
