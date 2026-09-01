import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { parseAsOfCutoff, type AsOfCutoff } from './date.js';

export const JQUANTS_VALIDATION_BASE_URL = 'https://api.jquants.com' as const;
export const JQUANTS_RATE_LIMIT_VERSION_V1 = 'rolling_attempt_log_v1' as const;
export const JQUANTS_DEFAULT_REQUESTS_PER_MINUTE_V1 = 5 as const;
export const JQUANTS_REQUEST_TIMEOUT_MS_V1 = 30_000 as const;
export const JQUANTS_EXECUTION_BUDGET_MS_V1 = 5_400_000 as const;
export const JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1 = 250 as const;
export const JQUANTS_MAX_ATTEMPTS_PER_REQUEST_V1 = 3 as const;
export const JQUANTS_VALIDATION_ENDPOINTS_V1 = Object.freeze([
  '/v2/markets/calendar',
  '/v2/equities/master',
  '/v2/equities/bars/daily',
] as const);
export type JQuantsValidationEndpointV1 = (typeof JQUANTS_VALIDATION_ENDPOINTS_V1)[number];

export type JQuantsValidationErrorCodeV1 =
  | 'invalid_configuration'
  | 'external_schedule_infeasible'
  | 'execution_timeout'
  | 'attempt_limit_exceeded'
  | 'cancelled'
  | 'missing_api_key'
  | 'network_error'
  | 'http_error'
  | 'source_plan_unavailable'
  | 'source_history_unavailable'
  | 'source_response_invalid';

export class JQuantsValidationErrorV1 extends Error {
  constructor(
    public readonly code: JQuantsValidationErrorCodeV1,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'JQuantsValidationErrorV1';
  }
}

export type JQuantsExecutionPlanV1 = Readonly<{
  rateLimitVersion: typeof JQUANTS_RATE_LIMIT_VERSION_V1;
  requestsPerMinute: number;
  estimatedMinimumAttempts: number;
  minimumDispatchDurationMs: number;
  minimumScheduleFeasible: boolean;
  requestTimeoutMs: typeof JQUANTS_REQUEST_TIMEOUT_MS_V1;
  executionBudgetMs: typeof JQUANTS_EXECUTION_BUDGET_MS_V1;
  hardMaximumAttempts: typeof JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1;
}>;

export type AcceptedJQuantsExecutionV1 = Readonly<{
  controls: JQuantsExecutionPlanV1 & Readonly<{ minimumScheduleFeasible: true }>;
  acceptedAt: AsOfCutoff;
  executionDeadline: AsOfCutoff;
  monotonicOriginMs: number;
}>;

export type JQuantsAttemptAuditV1 = Readonly<{
  attempt: number;
  dispatchedAt: AsOfCutoff;
}>;

export type JQuantsExecutionEnvironmentV1 = Readonly<{
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  wallNowMs: () => number;
  monotonicNowMs: () => number;
  sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  apiKey: () => string | undefined;
}>;

export type JQuantsQueryV1 = Readonly<Record<string, string>>;

export type JQuantsFetchedRowsV1 = Readonly<{
  rows: readonly unknown[];
  fetchedAt: AsOfCutoff;
}>;

const defaultSleep = (durationMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1: JQuantsExecutionEnvironmentV1 =
  Object.freeze({
    fetch: (input, init) => fetch(input, init),
    wallNowMs: () => Date.now(),
    monotonicNowMs: () => performance.now(),
    sleep: defaultSleep,
    apiKey: () => process.env.JQUANTS_API_KEY,
  });

function invalidConfiguration(message: string): never {
  throw new JQuantsValidationErrorV1('invalid_configuration', message);
}

export function resolveJQuantsRequestsPerMinuteV1(value = process.env.JQUANTS_REQUESTS_PER_MINUTE): number {
  if (value === undefined) return JQUANTS_DEFAULT_REQUESTS_PER_MINUTE_V1;
  if (!/^[1-9]\d*$/.test(value)) {
    return invalidConfiguration('JQUANTS_REQUESTS_PER_MINUTE must be an integer from 1 through 500.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
    return invalidConfiguration('JQUANTS_REQUESTS_PER_MINUTE must be an integer from 1 through 500.');
  }
  return parsed;
}

export function planJQuantsExecutionV1(
  estimatedMinimumAttempts: number,
  requestsPerMinute: number,
): JQuantsExecutionPlanV1 {
  if (!Number.isSafeInteger(estimatedMinimumAttempts) || estimatedMinimumAttempts < 0) {
    return invalidConfiguration('estimatedMinimumAttempts must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(requestsPerMinute)
    || requestsPerMinute < 1 || requestsPerMinute > 500) {
    return invalidConfiguration('requestsPerMinute must be an integer from 1 through 500.');
  }
  const minimumDispatchDurationMs = estimatedMinimumAttempts === 0
    ? 0
    : Math.floor((estimatedMinimumAttempts - 1) / requestsPerMinute) * 60_000;
  return Object.freeze({
    rateLimitVersion: JQUANTS_RATE_LIMIT_VERSION_V1,
    requestsPerMinute,
    estimatedMinimumAttempts,
    minimumDispatchDurationMs,
    minimumScheduleFeasible: estimatedMinimumAttempts <= JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1
      && minimumDispatchDurationMs < JQUANTS_EXECUTION_BUDGET_MS_V1,
    requestTimeoutMs: JQUANTS_REQUEST_TIMEOUT_MS_V1,
    executionBudgetMs: JQUANTS_EXECUTION_BUDGET_MS_V1,
    hardMaximumAttempts: JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1,
  });
}

export function requireFeasibleJQuantsExecutionV1(
  plan: JQuantsExecutionPlanV1,
): JQuantsExecutionPlanV1 & Readonly<{ minimumScheduleFeasible: true }> {
  if (typeof plan !== 'object' || plan === null) {
    return invalidConfiguration('The J-Quants execution controls are invalid.');
  }
  const expected = planJQuantsExecutionV1(
    plan.estimatedMinimumAttempts,
    plan.requestsPerMinute,
  );
  if (plan.rateLimitVersion !== expected.rateLimitVersion
    || plan.minimumDispatchDurationMs !== expected.minimumDispatchDurationMs
    || plan.minimumScheduleFeasible !== expected.minimumScheduleFeasible
    || plan.requestTimeoutMs !== expected.requestTimeoutMs
    || plan.executionBudgetMs !== expected.executionBudgetMs
    || plan.hardMaximumAttempts !== expected.hardMaximumAttempts) {
    return invalidConfiguration('The J-Quants execution controls do not match the versioned runtime contract.');
  }
  if (!expected.minimumScheduleFeasible) {
    throw new JQuantsValidationErrorV1(
      'external_schedule_infeasible',
      'The minimum J-Quants request schedule cannot dispatch within the fixed execution limits.',
    );
  }
  return expected as JQuantsExecutionPlanV1 & Readonly<{ minimumScheduleFeasible: true }>;
}

function utcInstantFromMs(value: number): AsOfCutoff {
  if (!Number.isFinite(value)) {
    return invalidConfiguration('The execution clock returned a non-finite wall time.');
  }
  return parseAsOfCutoff(new Date(value).toISOString());
}

export function acceptJQuantsExecutionV1(
  controls: JQuantsExecutionPlanV1,
  environment: JQuantsExecutionEnvironmentV1 = DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1,
): AcceptedJQuantsExecutionV1 {
  const feasible = requireFeasibleJQuantsExecutionV1(controls);
  const monotonicOriginMs = environment.monotonicNowMs();
  if (!Number.isFinite(monotonicOriginMs)) {
    return invalidConfiguration('The execution clock returned a non-finite monotonic time.');
  }
  const acceptedAtMs = environment.wallNowMs();
  return Object.freeze({
    controls: feasible,
    acceptedAt: utcInstantFromMs(acceptedAtMs),
    executionDeadline: utcInstantFromMs(acceptedAtMs + feasible.executionBudgetMs),
    monotonicOriginMs,
  });
}

function cancelled(): JQuantsValidationErrorV1 {
  return new JQuantsValidationErrorV1('cancelled', 'The J-Quants validation request was cancelled.');
}

function timeout(): JQuantsValidationErrorV1 {
  return new JQuantsValidationErrorV1('execution_timeout', 'The J-Quants validation execution deadline was reached.');
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function canonicalQuery(query: JQuantsQueryV1): readonly Readonly<{ name: string; value: string }>[] {
  const entries = Object.entries(query).map(([name, value]) => {
    if (!/^[a-z][a-z_]*$/.test(name) || typeof value !== 'string' || value.length === 0) {
      return invalidConfiguration('A J-Quants query parameter is invalid.');
    }
    return Object.freeze({ name, value });
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return Object.freeze(entries);
}

function initialQuery(
  endpoint: JQuantsValidationEndpointV1,
  query: JQuantsQueryV1,
): JQuantsQueryV1 {
  const expectedNames = endpoint === '/v2/markets/calendar'
    ? ['from', 'to']
    : endpoint === '/v2/equities/master'
      ? ['code', 'date']
      : ['code', 'from', 'to'];
  const entries = canonicalQuery(query);
  if (entries.map(entry => entry.name).join('\0') !== [...expectedNames].sort().join('\0')) {
    return invalidConfiguration('The J-Quants endpoint query does not match its exact Phase 4 shape.');
  }
  return Object.freeze(Object.fromEntries(entries.map(entry => [entry.name, entry.value])));
}

function cacheKey(endpoint: string, query: JQuantsQueryV1): string {
  return canonicalJsonV1({ endpoint, query: canonicalQuery(query) } as CanonicalJsonValue);
}

function validationEndpoint(value: string): JQuantsValidationEndpointV1 {
  if (!JQUANTS_VALIDATION_ENDPOINTS_V1.includes(value as JQuantsValidationEndpointV1)) {
    return invalidConfiguration('The J-Quants endpoint is not allowlisted for Phase 4 validation.');
  }
  return value as JQuantsValidationEndpointV1;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(deepFreezeJson);
    return Object.freeze(value);
  }
  if (isJsonObject(value)) {
    Object.values(value).forEach(deepFreezeJson);
    return Object.freeze(value);
  }
  return value;
}

function planRestriction(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 403) return false;
  if (!isJsonObject(body)) return false;
  const detail = body.message ?? body.error;
  return typeof detail === 'string'
    && /not available on your subscription|subscription covers the following dates/i.test(detail);
}

function parseRetryAfterMs(value: string | null, wallNowMs: number): number | null {
  if (value === null) return null;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
      ? seconds * 1_000
      : null;
  }
  const httpDatePattern = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!httpDatePattern.test(value)) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  return Math.max(0, instant - wallNowMs);
}

function responseBody(response: Response): Promise<unknown> {
  return response.text().then(text => {
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) return null;
      throw new JQuantsValidationErrorV1(
        'source_response_invalid',
        'J-Quants returned invalid JSON for a successful request.',
        response.status,
      );
    }
  });
}

type RetryableHttpFailure = Readonly<{
  status: number;
  retryAfterMs: number | null;
}>;

type CompletedHttpAttempt = Readonly<{
  response: Response;
  body: unknown;
}>;

function isRetryableHttpFailure(value: unknown): value is RetryableHttpFailure {
  return isJsonObject(value)
    && typeof value.status === 'number'
    && (value.retryAfterMs === null || typeof value.retryAfterMs === 'number');
}

async function waitForPromiseOrAbort(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  abortIfNeeded(signal);
  if (signal === undefined) return promise;
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class JQuantsExecutionRuntimeV1 {
  readonly #accepted!: AcceptedJQuantsExecutionV1;
  readonly #environment!: JQuantsExecutionEnvironmentV1;
  readonly #actualAttemptLimit!: number;
  readonly #apiKey!: string;
  readonly #attempts: JQuantsAttemptAuditV1[] = [];
  readonly #attemptTimes: number[] = [];
  readonly #cache = new Map<string, Promise<JQuantsFetchedRowsV1>>();
  readonly #operationController = new AbortController();
  #limiterTail: Promise<void> = Promise.resolve();
  #cacheHitCount = 0;

  constructor(
    accepted: AcceptedJQuantsExecutionV1,
    options: Readonly<{
      environment?: JQuantsExecutionEnvironmentV1;
      actualAttemptLimit?: number;
      signal?: AbortSignal;
    }> = {},
  ) {
    if (typeof accepted !== 'object' || accepted === null
      || typeof accepted.controls !== 'object' || accepted.controls === null
      || typeof accepted.acceptedAt !== 'string'
      || typeof accepted.executionDeadline !== 'string'
      || !Number.isFinite(accepted.monotonicOriginMs)) {
      invalidConfiguration('A valid acceptedAt and monotonic execution origin are required.');
    }
    let acceptedAt: AsOfCutoff;
    let deadline: AsOfCutoff;
    try {
      acceptedAt = parseAsOfCutoff(accepted.acceptedAt);
      deadline = parseAsOfCutoff(accepted.executionDeadline);
    } catch {
      return invalidConfiguration('The accepted execution timestamps are invalid.');
    }
    const controls = requireFeasibleJQuantsExecutionV1(accepted.controls);
    if (Date.parse(deadline) - Date.parse(acceptedAt) !== JQUANTS_EXECUTION_BUDGET_MS_V1) {
      invalidConfiguration('The accepted execution deadline does not match the fixed budget.');
    }
    this.#accepted = Object.freeze({
      controls,
      acceptedAt,
      executionDeadline: deadline,
      monotonicOriginMs: accepted.monotonicOriginMs,
    });
    this.#environment = options.environment ?? DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1;
    const apiKey = this.#environment.apiKey();
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new JQuantsValidationErrorV1(
        'missing_api_key',
        'JQUANTS_API_KEY is not set for the J-Quants validation adapter.',
      );
    }
    this.#apiKey = apiKey;
    const actualAttemptLimit = options.actualAttemptLimit ?? accepted.controls.hardMaximumAttempts;
    if (!Number.isSafeInteger(actualAttemptLimit)
      || actualAttemptLimit < 1
      || actualAttemptLimit > accepted.controls.hardMaximumAttempts) {
      invalidConfiguration('actualAttemptLimit must be within the frozen hard attempt cap.');
    }
    this.#actualAttemptLimit = actualAttemptLimit;
    this.#bindCancellation(options.signal);
  }

  get accepted(): AcceptedJQuantsExecutionV1 {
    return this.#accepted;
  }

  get attempts(): readonly JQuantsAttemptAuditV1[] {
    return Object.freeze(this.#attempts.map(attempt => Object.freeze({ ...attempt })));
  }

  get cacheHitCount(): number {
    return this.#cacheHitCount;
  }

  nowUtc(): AsOfCutoff {
    return utcInstantFromMs(this.#environment.wallNowMs());
  }

  cancel(): void {
    this.#operationController.abort();
  }

  assertCanContinue(signal?: AbortSignal): void {
    abortIfNeeded(signal);
    const elapsed = this.#environment.monotonicNowMs() - this.#accepted.monotonicOriginMs;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new JQuantsValidationErrorV1(
        'invalid_configuration',
        'The monotonic execution clock moved backwards or became invalid.',
      );
    }
    if (elapsed >= this.#accepted.controls.executionBudgetMs) throw timeout();
  }

  async getAll(
    endpoint: string,
    query: JQuantsQueryV1,
    signal?: AbortSignal,
  ): Promise<JQuantsFetchedRowsV1> {
    this.#bindCancellation(signal);
    const operationSignal = this.#operationController.signal;
    this.assertCanContinue(operationSignal);
    const allowedEndpoint = validationEndpoint(endpoint);
    const normalizedQuery = initialQuery(allowedEndpoint, query);
    const key = cacheKey(allowedEndpoint, normalizedQuery);
    const existing = this.#cache.get(key);
    if (existing !== undefined) {
      this.#cacheHitCount += 1;
      return existing;
    }
    const request = this.#getAllUncached(allowedEndpoint, normalizedQuery, operationSignal).catch(error => {
      if (this.#cache.get(key) === request) this.#cache.delete(key);
      throw error;
    });
    this.#cache.set(key, request);
    return request;
  }

  async #getAllUncached(
    endpoint: string,
    query: JQuantsQueryV1,
    signal?: AbortSignal,
  ): Promise<JQuantsFetchedRowsV1> {
    const rows: unknown[] = [];
    const seenPaginationKeys = new Set<string>();
    let paginationKey: string | undefined;
    do {
      const page = await this.#requestPage(endpoint, paginationKey === undefined
        ? query
        : { ...query, pagination_key: paginationKey }, signal);
      rows.push(...page.data);
      paginationKey = page.paginationKey;
      if (paginationKey !== undefined) {
        if (seenPaginationKeys.has(paginationKey)) {
          throw new JQuantsValidationErrorV1(
            'source_response_invalid',
            'J-Quants returned a repeated pagination key.',
          );
        }
        seenPaginationKeys.add(paginationKey);
      }
    } while (paginationKey !== undefined);
    this.assertCanContinue(signal);
    return Object.freeze({
      rows: deepFreezeJson(rows) as readonly unknown[],
      fetchedAt: this.nowUtc(),
    });
  }

  async #requestPage(
    endpoint: string,
    query: JQuantsQueryV1,
    signal?: AbortSignal,
  ): Promise<Readonly<{ data: readonly unknown[]; paginationKey?: string }>> {
    for (let attempt = 0; attempt < JQUANTS_MAX_ATTEMPTS_PER_REQUEST_V1; attempt += 1) {
      this.assertCanContinue(signal);
      try {
        const { response, body } = await this.#attempt(endpoint, query, signal);
        if (!response.ok) {
          if (planRestriction(response.status, body)) {
            throw new JQuantsValidationErrorV1(
              'source_plan_unavailable',
              'The J-Quants endpoint or requested history is unavailable for the configured plan.',
              response.status,
            );
          }
          if (response.status === 429 || response.status >= 500) {
            throw Object.freeze({
              status: response.status,
              retryAfterMs: parseRetryAfterMs(
                response.headers.get('retry-after'),
                this.#environment.wallNowMs(),
              ),
            });
          }
          throw new JQuantsValidationErrorV1(
            'http_error',
            `The J-Quants request failed with HTTP ${response.status}.`,
            response.status,
          );
        }
        if (!isJsonObject(body) || !Array.isArray(body.data)) {
          throw new JQuantsValidationErrorV1(
            'source_response_invalid',
            'J-Quants returned an unexpected response shape.',
            response.status,
          );
        }
        const pagination = body.pagination_key;
        if (pagination !== undefined && (typeof pagination !== 'string' || pagination.length === 0)) {
          throw new JQuantsValidationErrorV1(
            'source_response_invalid',
            'J-Quants returned an invalid pagination key.',
            response.status,
          );
        }
        return Object.freeze({ data: body.data, paginationKey: pagination as string | undefined });
      } catch (error) {
        if (error instanceof JQuantsValidationErrorV1
          && error.code !== 'network_error') throw error;
        const retryable = error instanceof JQuantsValidationErrorV1
          ? error.code === 'network_error'
          : isRetryableHttpFailure(error);
        if (!retryable || attempt === JQUANTS_MAX_ATTEMPTS_PER_REQUEST_V1 - 1) {
          if (isRetryableHttpFailure(error)) {
            throw new JQuantsValidationErrorV1(
              'http_error',
              `The J-Quants request failed after bounded retries with HTTP ${error.status}.`,
              error.status,
            );
          }
          throw error;
        }
        const retryAfterMs = isRetryableHttpFailure(error) ? error.retryAfterMs : null;
        const delayMs = retryAfterMs ?? (attempt + 1) * 1_000;
        await this.#waitBeforeRetry(delayMs, signal);
      }
    }
    throw new JQuantsValidationErrorV1('network_error', 'The bounded J-Quants request failed.');
  }

  async #attempt(
    endpoint: string,
    query: JQuantsQueryV1,
    signal?: AbortSignal,
  ): Promise<CompletedHttpAttempt> {
    await this.#reserveAttempt(signal);
    this.assertCanContinue(signal);
    const remainingMs = this.#remainingMs();
    const requestTimeoutMs = Math.min(this.#accepted.controls.requestTimeoutMs, remainingMs);
    if (!(requestTimeoutMs > 0)) throw timeout();

    const url = new URL(`${JQUANTS_VALIDATION_BASE_URL}${endpoint}`);
    for (const { name, value } of canonicalQuery(query)) url.searchParams.set(name, value);

    const controller = new AbortController();
    const timeoutController = new AbortController();
    let timedOut = false;
    const onCancel = (): void => controller.abort();
    signal?.addEventListener('abort', onCancel, { once: true });
    const timeoutPromise = this.#environment.sleep(requestTimeoutMs, timeoutController.signal)
      .then(() => {
        timedOut = true;
        controller.abort();
        throw timeout();
      });
    try {
      const fetchPromise = this.#environment.fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.#apiKey },
        signal: controller.signal,
      }).then(async response => Object.freeze({
        response,
        body: await responseBody(response),
      })).catch(error => {
        if (signal?.aborted) throw cancelled();
        if (timedOut) throw timeout();
        if (error instanceof JQuantsValidationErrorV1) throw error;
        throw new JQuantsValidationErrorV1(
          'network_error',
          'Could not complete the allowlisted J-Quants request.',
        );
      });
      const completed = await Promise.race([fetchPromise, timeoutPromise]);
      this.assertCanContinue(signal);
      return completed;
    } finally {
      timeoutController.abort();
      signal?.removeEventListener('abort', onCancel);
    }
  }

  async #reserveAttempt(signal?: AbortSignal): Promise<void> {
    const previous = this.#limiterTail;
    let release = (): void => {};
    this.#limiterTail = new Promise<void>(resolve => { release = resolve; });
    try {
      await waitForPromiseOrAbort(previous, signal);
      while (true) {
        this.assertCanContinue(signal);
        if (this.#attempts.length >= this.#actualAttemptLimit) {
          throw new JQuantsValidationErrorV1(
            'attempt_limit_exceeded',
            'The J-Quants validation attempt cap was reached.',
          );
        }
        const now = this.#environment.monotonicNowMs();
        const firstRetained = this.#attemptTimes.findIndex(timestamp => now - timestamp < 60_000);
        if (firstRetained === -1) this.#attemptTimes.length = 0;
        else if (firstRetained > 0) this.#attemptTimes.splice(0, firstRetained);
        if (this.#attemptTimes.some(timestamp => timestamp > now)) {
          throw new JQuantsValidationErrorV1(
            'invalid_configuration',
            'The monotonic execution clock moved backwards.',
          );
        }
        if (this.#attemptTimes.length < this.#accepted.controls.requestsPerMinute) {
          this.assertCanContinue(signal);
          const dispatchTime = this.#environment.monotonicNowMs();
          const dispatchElapsed = dispatchTime - this.#accepted.monotonicOriginMs;
          if (!Number.isFinite(dispatchElapsed) || dispatchElapsed < 0) {
            throw new JQuantsValidationErrorV1(
              'invalid_configuration',
              'The monotonic execution clock moved backwards or became invalid.',
            );
          }
          if (dispatchElapsed >= this.#accepted.controls.executionBudgetMs) throw timeout();
          this.#attemptTimes.push(dispatchTime);
          this.#attempts.push(Object.freeze({
            attempt: this.#attempts.length + 1,
            dispatchedAt: utcInstantFromMs(this.#environment.wallNowMs()),
          }));
          return;
        }
        const waitMs = 60_000 - (now - this.#attemptTimes[0]!);
        if (waitMs >= this.#remainingMs()) throw timeout();
        try {
          await this.#environment.sleep(waitMs, signal);
        } catch {
          abortIfNeeded(signal);
          throw new JQuantsValidationErrorV1(
            'invalid_configuration',
            'The rate-limiter wait failed.',
          );
        }
      }
    } finally {
      release();
    }
  }

  async #waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
    this.assertCanContinue(signal);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs >= this.#remainingMs()) throw timeout();
    try {
      await this.#environment.sleep(delayMs, signal);
    } catch {
      abortIfNeeded(signal);
      throw new JQuantsValidationErrorV1(
        'invalid_configuration',
        'The retry wait failed.',
      );
    }
    this.assertCanContinue(signal);
  }

  #remainingMs(): number {
    const elapsed = this.#environment.monotonicNowMs() - this.#accepted.monotonicOriginMs;
    return this.#accepted.controls.executionBudgetMs - elapsed;
  }

  #bindCancellation(signal?: AbortSignal): void {
    if (signal === undefined) return;
    if (signal.aborted) {
      this.cancel();
      return;
    }
    signal.addEventListener('abort', () => this.cancel(), { once: true });
  }
}
