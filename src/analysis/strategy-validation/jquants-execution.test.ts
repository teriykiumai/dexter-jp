import { describe, expect, test } from 'bun:test';
import {
  JQUANTS_EXECUTION_BUDGET_MS_V1,
  JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1,
  JQUANTS_RATE_LIMIT_VERSION_V1,
  JQUANTS_REQUEST_TIMEOUT_MS_V1,
  JQuantsExecutionRuntimeV1,
  JQuantsValidationErrorV1,
  acceptJQuantsExecutionV1,
  planJQuantsExecutionV1,
  requireFeasibleJQuantsExecutionV1,
  resolveJQuantsRequestsPerMinuteV1,
  type JQuantsExecutionEnvironmentV1,
  type JQuantsQueryV1,
} from './jquants-execution.js';

const WALL_START = Date.parse('2026-08-31T00:00:00.000Z');

class FakeClock {
  wallMs = WALL_START;
  monotonicMs = 10_000;
  readonly delays: number[] = [];

  advance(durationMs: number): void {
    this.delays.push(durationMs);
    this.wallMs += durationMs;
    this.monotonicMs += durationMs;
  }

  sleep = (durationMs: number, signal?: AbortSignal): Promise<void> => {
    if (signal !== undefined && durationMs === JQUANTS_REQUEST_TIMEOUT_MS_V1) {
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    this.advance(durationMs);
    return Promise.resolve();
  };
}

type Fetcher = JQuantsExecutionEnvironmentV1['fetch'];

function environment(
  fetcher: Fetcher,
  clock = new FakeClock(),
  apiKey = 'test-jquants-key',
): JQuantsExecutionEnvironmentV1 {
  return Object.freeze({
    fetch: fetcher,
    wallNowMs: () => clock.wallMs,
    monotonicNowMs: () => clock.monotonicMs,
    sleep: clock.sleep,
    apiKey: () => apiKey,
  });
}

function runtime(
  fetcher: Fetcher,
  options: Readonly<{
    rate?: number;
    estimated?: number;
    clock?: FakeClock;
    attemptLimit?: number;
    apiKey?: string;
    environmentOverride?: JQuantsExecutionEnvironmentV1;
  }> = {},
): Readonly<{ runtime: JQuantsExecutionRuntimeV1; clock: FakeClock; environment: JQuantsExecutionEnvironmentV1 }> {
  const clock = options.clock ?? new FakeClock();
  const executionEnvironment = options.environmentOverride
    ?? environment(fetcher, clock, options.apiKey ?? 'test-jquants-key');
  const accepted = acceptJQuantsExecutionV1(
    planJQuantsExecutionV1(options.estimated ?? 1, options.rate ?? 5),
    executionEnvironment,
  );
  return Object.freeze({
    runtime: new JQuantsExecutionRuntimeV1(accepted, {
      environment: executionEnvironment,
      actualAttemptLimit: options.attemptLimit,
    }),
    clock,
    environment: executionEnvironment,
  });
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function deferredBodyHarness(elapsedBeforeRequestMs = 0): Readonly<{
  runtime: JQuantsExecutionRuntimeV1;
  bodyStarted: Promise<void>;
  timeoutScheduled: Promise<void>;
  timeoutDurationMs: () => number | null;
  completeBody: () => void;
  fireTimeout: () => void;
  advance: (durationMs: number) => void;
  bodyWasAborted: () => boolean;
}> {
  let wallMs = WALL_START;
  let monotonicMs = 10_000;
  let timeoutDurationMs: number | null = null;
  let completeBody = (): void => {};
  let fireTimeout = (): void => {};
  let bodyWasAborted = false;
  let markBodyStarted = (): void => {};
  let markTimeoutScheduled = (): void => {};
  const bodyStarted = new Promise<void>(resolve => { markBodyStarted = resolve; });
  const timeoutScheduled = new Promise<void>(resolve => { markTimeoutScheduled = resolve; });
  const executionEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
    fetch: async (_input, init) => {
      const requestSignal = init?.signal;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => new Promise<string>((resolve, reject) => {
          let settled = false;
          const onAbort = (): void => {
            if (settled) return;
            settled = true;
            bodyWasAborted = true;
            reject(new Error('body aborted'));
          };
          requestSignal?.addEventListener('abort', onAbort, { once: true });
          completeBody = (): void => {
            if (settled) return;
            settled = true;
            requestSignal?.removeEventListener('abort', onAbort);
            resolve(JSON.stringify({ data: [] }));
          };
          markBodyStarted();
        }),
      } as unknown as Response;
    },
    wallNowMs: () => wallMs,
    monotonicNowMs: () => monotonicMs,
    sleep: (durationMs, signal) => new Promise<void>((resolve, reject) => {
      let settled = false;
      timeoutDurationMs = durationMs;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      fireTimeout = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        wallMs += durationMs;
        monotonicMs += durationMs;
        resolve();
      };
      markTimeoutScheduled();
    }),
    apiKey: () => 'test-key',
  });
  const accepted = acceptJQuantsExecutionV1(
    planJQuantsExecutionV1(1, 5),
    executionEnvironment,
  );
  wallMs += elapsedBeforeRequestMs;
  monotonicMs += elapsedBeforeRequestMs;
  return Object.freeze({
    runtime: new JQuantsExecutionRuntimeV1(accepted, { environment: executionEnvironment }),
    bodyStarted,
    timeoutScheduled,
    timeoutDurationMs: () => timeoutDurationMs,
    completeBody: () => completeBody(),
    fireTimeout: () => fireTimeout(),
    advance: durationMs => {
      wallMs += durationMs;
      monotonicMs += durationMs;
    },
    bodyWasAborted: () => bodyWasAborted,
  });
}

describe('J-Quants execution planning', () => {
  test('resolves the configured rate strictly and defaults to five', () => {
    expect(resolveJQuantsRequestsPerMinuteV1(undefined)).toBe(5);
    expect(resolveJQuantsRequestsPerMinuteV1('1')).toBe(1);
    expect(resolveJQuantsRequestsPerMinuteV1('500')).toBe(500);
    for (const invalid of ['', '0', '01', '1.5', ' 5', '501', '-1']) {
      expect(() => resolveJQuantsRequestsPerMinuteV1(invalid)).toThrow(
        expect.objectContaining({ code: 'invalid_configuration' }),
      );
    }
  });

  test('uses the exact rolling-window lower-bound formula and hard cap', () => {
    expect(planJQuantsExecutionV1(0, 1)).toMatchObject({
      rateLimitVersion: JQUANTS_RATE_LIMIT_VERSION_V1,
      minimumDispatchDurationMs: 0,
      minimumScheduleFeasible: true,
      requestTimeoutMs: JQUANTS_REQUEST_TIMEOUT_MS_V1,
      executionBudgetMs: JQUANTS_EXECUTION_BUDGET_MS_V1,
      hardMaximumAttempts: JQUANTS_HARD_MAXIMUM_ATTEMPTS_V1,
    });
    expect(planJQuantsExecutionV1(90, 1)).toMatchObject({
      minimumDispatchDurationMs: 5_340_000,
      minimumScheduleFeasible: true,
    });
    expect(planJQuantsExecutionV1(91, 1)).toMatchObject({
      minimumDispatchDurationMs: 5_400_000,
      minimumScheduleFeasible: false,
    });
    expect(planJQuantsExecutionV1(180, 2).minimumScheduleFeasible).toBe(true);
    expect(planJQuantsExecutionV1(181, 2).minimumScheduleFeasible).toBe(false);
    expect(planJQuantsExecutionV1(250, 5).minimumScheduleFeasible).toBe(true);
    expect(planJQuantsExecutionV1(251, 5).minimumScheduleFeasible).toBe(false);
    expect(() => requireFeasibleJQuantsExecutionV1(planJQuantsExecutionV1(91, 1)))
      .toThrow(expect.objectContaining({ code: 'external_schedule_infeasible' }));
    expect(() => requireFeasibleJQuantsExecutionV1({
      ...planJQuantsExecutionV1(3, 5),
      requestTimeoutMs: 1 as never,
    })).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
  });

  test('freezes acceptedAt, the monotonic origin, controls, and the exact deadline', () => {
    const clock = new FakeClock();
    const executionEnvironment = environment(async () => jsonResponse({ data: [] }), clock);
    const controls = planJQuantsExecutionV1(3, 2);
    const accepted = acceptJQuantsExecutionV1(controls, executionEnvironment);

    expect(String(accepted.acceptedAt)).toBe('2026-08-31T00:00:00.000Z');
    expect(String(accepted.executionDeadline)).toBe('2026-08-31T01:30:00.000Z');
    expect(accepted.monotonicOriginMs).toBe(10_000);
    expect(JSON.stringify(accepted.controls)).toBe(JSON.stringify(controls));
    expect(Object.isFrozen(accepted)).toBe(true);
  });

  test('requires an acceptedAt-bearing execution before runtime construction', () => {
    const executionEnvironment = environment(async () => jsonResponse({ data: [] }));
    expect(() => new JQuantsExecutionRuntimeV1({
      controls: requireFeasibleJQuantsExecutionV1(planJQuantsExecutionV1(1, 5)),
      executionDeadline: '2026-08-31T01:30:00.000Z',
      monotonicOriginMs: 0,
    } as never, { environment: executionEnvironment })).toThrow(
      expect.objectContaining({ code: 'invalid_configuration' }),
    );
  });
});

describe('J-Quants request runtime', () => {
  test('uses exact GET query parameters, follows pages, and shares a same-job cache', async () => {
    const requests: Readonly<{ url: URL; apiKey: string | null }>[] = [];
    const fetcher: Fetcher = async (input, init) => {
      const request = Object.freeze({
        url: new URL(String(input)),
        apiKey: new Headers(init?.headers).get('x-api-key'),
      });
      (requests as { url: URL; apiKey: string | null }[]).push(request);
      return requests.length === 1
        ? jsonResponse({ data: [{ Date: '2026-08-28' }], pagination_key: 'page-2' })
        : jsonResponse({ data: [{ Date: '2026-08-29' }] });
    };
    const actual = runtime(fetcher, { rate: 5 }).runtime;
    const query = { code: '72030', from: '2026-08-28', to: '2026-08-29' };
    const first = await actual.getAll('/v2/equities/bars/daily', query);
    const second = await actual.getAll('/v2/equities/bars/daily', {
      to: '2026-08-29', code: '72030', from: '2026-08-28',
    });

    expect(first).toBe(second);
    expect(first.rows).toEqual([{ Date: '2026-08-28' }, { Date: '2026-08-29' }]);
    expect(String(first.fetchedAt)).toBe('2026-08-31T00:00:00.000Z');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url.origin).toBe('https://api.jquants.com');
    expect(requests[0]?.url.pathname).toBe('/v2/equities/bars/daily');
    expect([...requests[0]!.url.searchParams]).toEqual([
      ['code', '72030'], ['from', '2026-08-28'], ['to', '2026-08-29'],
    ]);
    expect(requests[1]?.url.searchParams.get('pagination_key')).toBe('page-2');
    expect(requests.every(request => request.apiKey === 'test-jquants-key')).toBe(true);
    expect(actual.attempts).toHaveLength(2);
  });

  test('rejects non-allowlisted endpoints before dispatch', async () => {
    const actual = runtime(async () => jsonResponse({ data: [] })).runtime;
    await expect(actual.getAll('/v2/fins/summary', { code: '72030' })).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
    expect(actual.attempts).toHaveLength(0);
  });

  test('rejects non-exact or secret-bearing initial queries before dispatch', async () => {
    const actual = runtime(async () => jsonResponse({ data: [] })).runtime;
    const invalidQueries: JQuantsQueryV1[] = [
      { code: '72030' },
      { code: '72030', date: '2026-08-28', token: 'secret' },
      { code: '72030', date: '2026-08-28', pagination_key: 'caller-owned' },
    ];
    for (const query of invalidQueries) {
      await expect(actual.getAll('/v2/equities/master', query)).rejects.toMatchObject({
        code: 'invalid_configuration',
      });
    }
    expect(actual.attempts).toHaveLength(0);
  });

  test('does not retain failures in the same-job cache', async () => {
    let calls = 0;
    const actual = runtime(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ message: 'bad request' }, 400) : jsonResponse({ data: [] });
    }).runtime;
    const query = { code: '72030', date: '2026-08-28' };
    await expect(actual.getAll('/v2/equities/master', query)).rejects.toMatchObject({
      code: 'http_error', status: 400,
    });
    await expect(actual.getAll('/v2/equities/master', query)).resolves.toMatchObject({ rows: [] });
    expect(calls).toBe(2);
  });

  test('rejects repeated pagination keys and malformed page shapes without retry', async () => {
    let calls = 0;
    const repeated = runtime(async () => {
      calls += 1;
      return jsonResponse({ data: [], pagination_key: 'same' });
    }).runtime;
    await expect(repeated.getAll('/v2/markets/calendar', {
      from: '2026-08-01', to: '2026-08-31',
    })).rejects.toMatchObject({ code: 'source_response_invalid' });
    expect(calls).toBe(2);

    calls = 0;
    const malformed = runtime(async () => {
      calls += 1;
      return jsonResponse({ rows: [] });
    }).runtime;
    await expect(malformed.getAll('/v2/markets/calendar', {
      from: '2026-08-01', to: '2026-08-31',
    })).rejects.toMatchObject({ code: 'source_response_invalid' });
    expect(calls).toBe(1);
  });

  test('retries only network, 429, and 5xx failures with deterministic fallback delays', async () => {
    const cases = [
      {
        name: 'network',
        responses: [new Error('secret body'), jsonResponse({ data: [] })],
        expectedDelays: [1_000],
      },
      {
        name: '429',
        responses: [jsonResponse({ message: 'quota' }, 429), jsonResponse({ data: [] })],
        expectedDelays: [1_000],
      },
      {
        name: '5xx twice',
        responses: [
          jsonResponse({ message: 'one' }, 500),
          jsonResponse({ message: 'two' }, 503),
          jsonResponse({ data: [] }),
        ],
        expectedDelays: [1_000, 2_000],
      },
    ] as const;

    for (const retryCase of cases) {
      const clock = new FakeClock();
      let index = 0;
      const actual = runtime(async () => {
        const next: Response | Error | undefined = retryCase.responses[index];
        index += 1;
        if (next instanceof Error) throw next;
        return next!;
      }, { clock }).runtime;
      await expect(actual.getAll('/v2/equities/master', {
        code: '72030', date: '2026-08-28',
      })).resolves.toMatchObject({ rows: [] });
      expect(actual.attempts).toHaveLength(retryCase.responses.length);
      expect(clock.delays).toEqual([...retryCase.expectedDelays]);
    }

    let fourHundredCalls = 0;
    const noRetry = runtime(async () => {
      fourHundredCalls += 1;
      return jsonResponse({ message: 'invalid' }, 422);
    }).runtime;
    await expect(noRetry.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    })).rejects.toMatchObject({ code: 'http_error', status: 422 });
    expect(fourHundredCalls).toBe(1);
  });

  test('honors valid Retry-After and fails when the delay reaches the deadline', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const actual = runtime(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, 429, { 'retry-after': '3' })
        : jsonResponse({ data: [] });
    }, { clock }).runtime;
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
    expect(clock.delays).toEqual([3_000]);

    const dateClock = new FakeClock();
    let dateCalls = 0;
    const dateRetry = runtime(async () => {
      dateCalls += 1;
      return dateCalls === 1
        ? jsonResponse({}, 503, {
          'retry-after': new Date(dateClock.wallMs + 5_000).toUTCString(),
        })
        : jsonResponse({ data: [] });
    }, { clock: dateClock }).runtime;
    await dateRetry.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
    expect(dateClock.delays).toEqual([5_000]);

    const malformedClock = new FakeClock();
    let malformedCalls = 0;
    const malformedRetryAfter = runtime(async () => {
      malformedCalls += 1;
      return malformedCalls === 1
        ? jsonResponse({}, 429, { 'retry-after': '2026-08-31T00:00:05.000Z' })
        : jsonResponse({ data: [] });
    }, { clock: malformedClock }).runtime;
    await malformedRetryAfter.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    });
    expect(malformedClock.delays).toEqual([1_000]);

    const deadlineClock = new FakeClock();
    const beyond = runtime(
      async () => jsonResponse({}, 429, { 'retry-after': '5400' }),
      { clock: deadlineClock },
    ).runtime;
    await expect(beyond.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    })).rejects.toMatchObject({ code: 'execution_timeout' });
    expect(beyond.attempts).toHaveLength(1);
  });

  test('uses monotonic rolling-attempt scheduling and expires timestamps at exactly 60 seconds', async () => {
    const clock = new FakeClock();
    const actual = runtime(async () => jsonResponse({ data: [] }), { rate: 2, clock }).runtime;
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-27' });
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-29' });

    expect(actual.attempts.map(attempt => String(attempt.dispatchedAt))).toEqual([
      '2026-08-31T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z',
      '2026-08-31T00:01:00.000Z',
    ]);
    expect(clock.delays).toEqual([60_000]);
  });

  test('enforces a narrower manual-smoke cap without changing frozen hard controls', async () => {
    const actual = runtime(async () => jsonResponse({ data: [] }), { rate: 500, attemptLimit: 2 }).runtime;
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-27' });
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
    await expect(actual.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-29',
    })).rejects.toMatchObject({ code: 'attempt_limit_exceeded' });
    expect(actual.accepted.controls.hardMaximumAttempts).toBe(250);
    expect(actual.attempts).toHaveLength(2);
  });

  test('never dispatches a 251st actual attempt', async () => {
    const actual = runtime(async () => jsonResponse({ data: [] }), {
      rate: 500,
      estimated: 250,
    }).runtime;
    for (let index = 0; index < 250; index += 1) {
      await actual.getAll('/v2/equities/master', {
        code: '72030', date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
      });
    }
    await expect(actual.getAll('/v2/equities/master', {
      code: '67580', date: '2026-08-28',
    })).rejects.toMatchObject({ code: 'attempt_limit_exceeded' });
    expect(actual.attempts).toHaveLength(250);
  });

  test('keeps the per-attempt timeout active while the response body is pending', async () => {
    const harness = deferredBodyHarness();
    const outcome = harness.runtime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    }).catch(error => error as unknown);
    await Promise.all([harness.bodyStarted, harness.timeoutScheduled]);
    expect(harness.timeoutDurationMs()).toBe(JQUANTS_REQUEST_TIMEOUT_MS_V1);
    harness.fireTimeout();

    await expect(outcome).resolves.toMatchObject({ code: 'execution_timeout' });
    expect(harness.bodyWasAborted()).toBe(true);
    expect(harness.runtime.attempts).toHaveLength(1);
  });

  test('cancels a request after headers while its response body is pending', async () => {
    const harness = deferredBodyHarness();
    const controller = new AbortController();
    const outcome = harness.runtime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    }, controller.signal).catch(error => error as unknown);
    await Promise.all([harness.bodyStarted, harness.timeoutScheduled]);
    controller.abort();

    await expect(outcome).resolves.toMatchObject({ code: 'cancelled' });
    expect(harness.bodyWasAborted()).toBe(true);
    expect(harness.runtime.attempts).toHaveLength(1);
  });

  test('accepts a complete response body just inside the per-attempt timeout', async () => {
    const harness = deferredBodyHarness();
    const request = harness.runtime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    });
    await Promise.all([harness.bodyStarted, harness.timeoutScheduled]);
    harness.advance(JQUANTS_REQUEST_TIMEOUT_MS_V1 - 1);
    harness.completeBody();

    await expect(request).resolves.toMatchObject({ rows: [] });
    expect(harness.bodyWasAborted()).toBe(false);
    expect(harness.runtime.attempts).toHaveLength(1);
  });

  test('clamps the body timeout to the remaining execution budget', async () => {
    const remainingMs = 250;
    const justInside = deferredBodyHarness(JQUANTS_EXECUTION_BUDGET_MS_V1 - remainingMs);
    const completed = justInside.runtime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    });
    await Promise.all([justInside.bodyStarted, justInside.timeoutScheduled]);
    expect(justInside.timeoutDurationMs()).toBe(remainingMs);
    justInside.advance(remainingMs - 1);
    justInside.completeBody();
    await expect(completed).resolves.toMatchObject({ rows: [] });

    const harness = deferredBodyHarness(JQUANTS_EXECUTION_BUDGET_MS_V1 - remainingMs);
    const outcome = harness.runtime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    }).catch(error => error as unknown);
    await Promise.all([harness.bodyStarted, harness.timeoutScheduled]);
    expect(harness.timeoutDurationMs()).toBe(remainingMs);
    harness.fireTimeout();

    await expect(outcome).resolves.toMatchObject({ code: 'execution_timeout' });
    expect(harness.bodyWasAborted()).toBe(true);
    expect(harness.runtime.attempts).toHaveLength(1);
  });

  test('gives cancellation and timeout precedence and prevents retry', async () => {
    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelledRuntime = runtime(async () => jsonResponse({ data: [] })).runtime;
    await expect(cancelledRuntime.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    }, cancelledController.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancelledRuntime.attempts).toHaveLength(0);

    const clock = new FakeClock();
    let aborted = false;
    const timeoutEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('transport aborted'));
        }, { once: true });
      }),
      wallNowMs: () => clock.wallMs,
      monotonicNowMs: () => clock.monotonicMs,
      sleep: async durationMs => { clock.advance(durationMs); },
      apiKey: () => 'test-key',
    });
    const timed = runtime(async () => jsonResponse({ data: [] }), {
      clock,
      environmentOverride: timeoutEnvironment,
    }).runtime;
    await expect(timed.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    })).rejects.toMatchObject({ code: 'execution_timeout' });
    expect(aborted).toBe(true);
    expect(timed.attempts).toHaveLength(1);
  });

  test('propagates an in-flight cancellation to the whole same-job runtime', async () => {
    const controller = new AbortController();
    let markStarted = (): void => {};
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const actual = runtime((_input, init) => new Promise((_resolve, reject) => {
      markStarted();
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })).runtime;
    const first = actual.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-28',
    }, controller.signal);
    await started;
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(actual.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-29',
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(actual.attempts).toHaveLength(1);
  });

  test('cancellation interrupts a rolling-window wait before another dispatch', async () => {
    let monotonicMs = 0;
    let wallMs = WALL_START;
    let markWaiting = (): void => {};
    const waiting = new Promise<void>(resolve => { markWaiting = resolve; });
    const executionEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: async () => jsonResponse({ data: [] }),
      wallNowMs: () => wallMs,
      monotonicNowMs: () => monotonicMs,
      sleep: (durationMs, signal) => {
        if (durationMs === 60_000) {
          markWaiting();
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        if (signal !== undefined) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        monotonicMs += durationMs;
        wallMs += durationMs;
        return Promise.resolve();
      },
      apiKey: () => 'test-key',
    });
    const accepted = acceptJQuantsExecutionV1(
      planJQuantsExecutionV1(2, 1),
      executionEnvironment,
    );
    const actual = new JQuantsExecutionRuntimeV1(accepted, { environment: executionEnvironment });
    await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
    const controller = new AbortController();
    const second = actual.getAll('/v2/equities/master', {
      code: '72030', date: '2026-08-29',
    }, controller.signal);
    await waiting;
    controller.abort();
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    expect(actual.attempts).toHaveLength(1);
  });

  test('keeps credentials and response bodies out of errors', async () => {
    const secret = 'secret-api-key-value';
    const actual = runtime(async () => jsonResponse({
      message: `failure ${secret} C:\\private\\report.json`,
    }, 400), { apiKey: secret }).runtime;
    try {
      await actual.getAll('/v2/equities/master', { code: '72030', date: '2026-08-28' });
      throw new Error('Expected the request to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(JQuantsValidationErrorV1);
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain('private');
      expect(message).not.toContain('report.json');
    }
  });
});
