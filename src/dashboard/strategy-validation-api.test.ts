import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comparisonSnapshot } from '../analysis/comparison/test-fixtures.js';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/index.js';
import {
  StrategyValidationJobRepositoryV1,
  StrategyValidationJobServiceV1,
  StrategyValidationRunRepositoryV1,
  type JQuantsExecutionEnvironmentV1,
  type PromoteStrategyValidationRunDirectoryV1,
  type StrategyValidationRunPublicationV1,
  type StrategyValidationRunPublishOptionsV1,
} from '../analysis/strategy-validation/index.js';
import { handleDashboardRequest } from './api.js';
import { StrategyValidationDashboardApiV1 } from './strategy-validation-api.js';

const roots: string[] = [];
const CSRF_TOKEN = Buffer.alloc(32, 7).toString('base64url');

function dates(from: string, to: string): string[] {
  const result: string[] = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function sourceResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function executionEnvironment(): JQuantsExecutionEnvironmentV1 {
  let wall = Date.parse('2026-12-01T00:00:00.000Z');
  let monotonic = 0;
  return Object.freeze({
    fetch: async input => {
      const url = new URL(String(input));
      if (url.pathname === '/v2/markets/calendar') {
        return sourceResponse({
          data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!).map(Date => ({
            Date,
            HolDiv: isWeekday(Date) ? '1' : '0',
          })),
        });
      }
      if (url.pathname === '/v2/equities/master') {
        return sourceResponse({ data: [{
          Date: url.searchParams.get('date'),
          Code: url.searchParams.get('code'),
          ScaleCat: 'TOPIX Large70',
          Mkt: '0111',
          ProdCat: '011',
        }] });
      }
      return sourceResponse({
        data: dates(url.searchParams.get('from')!, url.searchParams.get('to')!)
          .filter(isWeekday)
          .map(Date => ({
            Date,
            Code: url.searchParams.get('code'),
            O: 3_051,
            H: 4_000,
            L: 3_000,
            C: 3_500,
            UL: '0',
            LL: '0',
            AdjFactor: 1,
            ExRT: null,
          })),
      });
    },
    wallNowMs: () => wall++,
    monotonicNowMs: () => monotonic++,
    sleep: (durationMs, signal) => {
      if (durationMs === 30_000 && signal !== undefined) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      wall += durationMs;
      monotonic += durationMs;
      return Promise.resolve();
    },
    apiKey: () => 'test-key',
  });
}

async function context(options: Readonly<{
  environment?: JQuantsExecutionEnvironmentV1;
  promoteDirectory?: PromoteStrategyValidationRunDirectoryV1;
  beforePublish?: () => Promise<void>;
  requestsPerMinute?: number;
}> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-strategy-api-'));
  roots.push(root);
  const snapshots = new AnalysisSnapshotRepository(join(root, 'analysis'));
  const RunRepository = options.beforePublish === undefined
    ? StrategyValidationRunRepositoryV1
    : class extends StrategyValidationRunRepositoryV1 {
      override async publish(
        publication: StrategyValidationRunPublicationV1,
        publishOptions: StrategyValidationRunPublishOptionsV1 = {},
      ) {
        await options.beforePublish!();
        return super.publish(publication, publishOptions);
      }
    };
  const runs = new RunRepository(join(root, 'research'), {
    promoteDirectory: options.promoteDirectory ?? rename,
  });
  const jobs = new StrategyValidationJobRepositoryV1(join(root, 'research'));
  const service = new StrategyValidationJobServiceV1({
    snapshotRepository: snapshots,
    runRepository: runs,
    jobRepository: jobs,
    executionEnvironment: options.environment ?? executionEnvironment(),
    requestsPerMinute: options.requestsPerMinute ?? 500,
  });
  const api = new StrategyValidationDashboardApiV1(service, CSRF_TOKEN);
  return { root, snapshots, runs, jobs, service, api };
}

function request(
  path: string,
  options: Readonly<{
    method?: string;
    body?: string;
    host?: string;
    origin?: string | null;
    csrf?: string | null;
    contentType?: string | null;
  }> = {},
): Request {
  const host = options.host ?? '127.0.0.1:3000';
  const headers = new Headers({ Host: host });
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'http://127.0.0.1:3000');
  if (options.csrf !== null) headers.set('X-Dexter-CSRF', options.csrf ?? CSRF_TOKEN);
  if (options.contentType !== null && options.body !== undefined) {
    headers.set('Content-Type', options.contentType ?? 'application/json; charset=utf-8');
  }
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });
}

async function call(
  value: Awaited<ReturnType<typeof context>>,
  requestValue: Request,
): Promise<Response> {
  return handleDashboardRequest(requestValue, value.snapshots, value.api);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function waitForCompleted(
  value: Awaited<ReturnType<typeof context>>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await call(value, request(`/api/strategy-validation/jobs/${jobId}`, {
      origin: null, csrf: null,
    }));
    const body = await json(response);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(String(body.status))) {
      return { response, body };
    }
    await Bun.sleep(5);
  }
  throw new Error('job did not become terminal');
}

async function waitForStatus(
  value: Awaited<ReturnType<typeof context>>,
  jobId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = await value.service.getJob(jobId);
    if (job.status === status) return job;
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) {
      throw new Error(`job became ${job.status} before ${status}`);
    }
    await Bun.sleep(5);
  }
  throw new Error(`job did not reach ${status}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Phase 4 Strategy-validation local API', () => {
  test('rotates a 32-byte process CSRF token and returns no capability or path detail', async () => {
    const first = await context();
    const response = await call(first, request('/api/session', { origin: null, csrf: null }));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toEqual({
      schemaVersion: 'dashboard_session_v1',
      csrfHeader: 'X-Dexter-CSRF',
      csrfToken: CSRF_TOKEN,
    });
    const second = new StrategyValidationDashboardApiV1(first.service);
    expect(second.csrfToken).not.toBe(first.api.csrfToken);
    expect(Buffer.from(second.csrfToken, 'base64url')).toHaveLength(32);
    expect(JSON.stringify(body)).not.toContain(first.root);
    expect(JSON.stringify(body)).not.toContain('JQUANTS_API_KEY');
  });

  test('executes preflight and job, then serves exact run/case pagination without latest fallback', async () => {
    const value = await context();
    const saved = await value.snapshots.save(comparisonSnapshot());
    const preflightResponse = await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId }),
    }));
    const preflight = await json(preflightResponse);
    expect(preflightResponse.status).toBe(200);
    expect(preflight).toMatchObject({
      schemaVersion: 'strategy_validation_preflight_v1',
      mode: 'snapshot',
      tickerCount: 1,
      anchorCount: 1,
      requestsPerMinute: 500,
      hardMaximumAttempts: 250,
    });

    const acceptedResponse = await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({
        preflightId: preflight.preflightId,
        confirmExternalFetch: true,
      }),
    }));
    const accepted = await json(acceptedResponse);
    expect(acceptedResponse.status).toBe(202);
    const consumedResponse = await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({
        preflightId: preflight.preflightId,
        confirmExternalFetch: true,
      }),
    }));
    expect(consumedResponse.status).toBe(409);
    expect(await json(consumedResponse)).toMatchObject({
      error: { code: 'preflight_consumed' },
    });
    const acceptedJob = accepted.job as Record<string, unknown>;
    expect(acceptedJob).toMatchObject({
      startedAt: preflight.startedAt,
      executionControls: {
        requestsPerMinute: preflight.requestsPerMinute,
        hardMaximumAttempts: preflight.hardMaximumAttempts,
        requestTimeoutMs: preflight.requestTimeoutMs,
        executionBudgetMs: preflight.executionBudgetMs,
      },
    });
    const jobId = String(acceptedJob.jobId);
    const runId = String(acceptedJob.runId);
    const completed = await waitForCompleted(value, jobId);
    expect(completed.response.status).toBe(200);
    expect(completed.body.status).toBe('completed');

    const active = await call(value, request('/api/strategy-validation/jobs/active', {
      origin: null, csrf: null,
    }));
    expect(await json(active)).toEqual({
      schemaVersion: 'strategy_validation_active_job_v1', job: null,
    });

    const runs = await call(value, request('/api/strategy-validation/runs?ticker=7203&limit=1', {
      origin: null, csrf: null,
    }));
    const runList = await json(runs);
    expect(runs.status).toBe(200);
    expect(runList).toMatchObject({
      schemaVersion: 'strategy_validation_list_v1',
      items: [{ runId }],
      nextCursor: null,
    });
    const run = await call(value, request(`/api/strategy-validation/runs/${runId}`, {
      origin: null, csrf: null,
    }));
    expect(await json(run)).toMatchObject({ runId, aggregationScope: { tickers: ['7203'] } });

    const firstCases = await call(value, request(
      `/api/strategy-validation/runs/${runId}/cases?ticker=7203&limit=1`,
      { origin: null, csrf: null },
    ));
    const firstPage = await json(firstCases);
    expect((firstPage.items as unknown[])).toHaveLength(1);
    expect(typeof firstPage.nextCursor).toBe('string');
    const secondCases = await call(value, request(
      `/api/strategy-validation/runs/${runId}/cases?ticker=7203&limit=1&cursor=${firstPage.nextCursor}`,
      { origin: null, csrf: null },
    ));
    const secondPage = await json(secondCases);
    expect((secondPage.items as unknown[])).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    const caseIds = [...firstPage.items as Array<Record<string, unknown>>,
      ...secondPage.items as Array<Record<string, unknown>>].map(item => item.caseId);
    expect(new Set(caseIds).size).toBe(2);

    const crossQueryCursor = await call(value, request(
      `/api/strategy-validation/runs/${runId}/cases?limit=1&cursor=${firstPage.nextCursor}`,
      { origin: null, csrf: null },
    ));
    expect(crossQueryCursor.status).toBe(400);
    expect(await json(crossQueryCursor)).toMatchObject({ error: { code: 'invalid_cursor' } });

    const caseDetail = await call(value, request(
      `/api/strategy-validation/runs/${runId}/cases/${caseIds[0]}`,
      { origin: null, csrf: null },
    ));
    expect(await json(caseDetail)).toMatchObject({ caseId: caseIds[0], runId, ticker: '7203' });
  });

  test('keeps campaign-global aggregation unchanged when the case list is ticker-filtered', async () => {
    const value = await context();
    const preflight = await json(await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'campaign',
        manifest: {
          schemaVersion: 'strategy_validation_campaign_v1',
          name: 'API campaign',
          anchors: [
            { ticker: '7203', anchorDate: '2025-03-31', resistanceEvidence: [] },
            { ticker: '6758', anchorDate: '2025-03-31', resistanceEvidence: [] },
          ],
        },
      }),
    })));
    const accepted = await json(await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ preflightId: preflight.preflightId, confirmExternalFetch: true }),
    })));
    const job = accepted.job as Record<string, unknown>;
    const completed = await waitForCompleted(value, String(job.jobId));
    expect(completed.body.status).toBe('completed');

    const runResponse = await call(value, request(
      `/api/strategy-validation/runs/${job.runId}`,
      { origin: null, csrf: null },
    ));
    const run = await json(runResponse);
    expect(run).toMatchObject({
      aggregationScope: {
        kind: 'campaign_global',
        tickers: ['6758', '7203'],
        requestedAnchorCount: 2,
      },
      aggregation: { track: { requestedAnchorCount: 2 } },
    });
    const casesResponse = await call(value, request(
      `/api/strategy-validation/runs/${job.runId}/cases?ticker=7203`,
      { origin: null, csrf: null },
    ));
    const cases = await json(casesResponse);
    expect((cases.items as Array<Record<string, unknown>>)).toHaveLength(1);
    expect((cases.items as Array<Record<string, unknown>>)[0]).toMatchObject({ ticker: '7203' });
    expect(cases).not.toHaveProperty('aggregation');
  });

  test('cancels a live fetch without publishing and rejects cancellation once publishing begins', async () => {
    let wall = Date.parse('2026-12-01T00:00:00.000Z');
    let monotonic = 0;
    const hangingEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
      wallNowMs: () => wall++,
      monotonicNowMs: () => monotonic++,
      sleep: (_durationMs, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      apiKey: () => 'test-key',
    });
    const live = await context({ environment: hangingEnvironment });
    const saved = await live.snapshots.save(comparisonSnapshot());
    const preflight = await json(await call(live, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId }),
    })));
    const accepted = await json(await call(live, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ preflightId: preflight.preflightId, confirmExternalFetch: true }),
    })));
    const job = accepted.job as Record<string, unknown>;
    await waitForStatus(live, String(job.jobId), 'collecting');
    const cancel = await call(live, request(`/api/strategy-validation/jobs/${job.jobId}`, {
      method: 'DELETE',
    }));
    expect(cancel.status).toBe(202);
    const cancelled = await waitForCompleted(live, String(job.jobId));
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      progress: { attemptCount: 1, caseCount: 0 },
    });
    expect(await live.runs.hasRun(String(job.runId))).toBeFalse();
    const repeated = await call(live, request(`/api/strategy-validation/jobs/${job.jobId}`, {
      method: 'DELETE',
    }));
    expect(repeated.status).toBe(200);

    let releasePromotion!: () => void;
    let promotionStarted!: () => void;
    const promotionSignal = new Promise<void>(resolve => { promotionStarted = resolve; });
    const promotionGate = new Promise<void>(resolve => { releasePromotion = resolve; });
    const publishing = await context({
      promoteDirectory: async (temporaryDirectory, finalDirectory) => {
        promotionStarted();
        await promotionGate;
        await rename(temporaryDirectory, finalDirectory);
      },
    });
    const localSaved = await publishing.snapshots.save({ ...comparisonSnapshot(), strategy: null });
    const localPreflight = await json(await call(
      publishing,
      request('/api/strategy-validation/preflights', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'snapshot', ticker: '7203', snapshotId: localSaved.snapshotId,
        }),
      }),
    ));
    const localAccepted = await json(await call(publishing, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({
        preflightId: localPreflight.preflightId, confirmExternalFetch: true,
      }),
    })));
    const publishingJob = localAccepted.job as Record<string, unknown>;
    await promotionSignal;
    await waitForStatus(publishing, String(publishingJob.jobId), 'publishing');
    const lateCancel = await call(
      publishing,
      request(`/api/strategy-validation/jobs/${publishingJob.jobId}`, { method: 'DELETE' }),
    );
    expect(lateCancel.status).toBe(409);
    expect(await json(lateCancel)).toMatchObject({ error: { code: 'invalid_job_transition' } });
    releasePromotion();
    expect((await waitForCompleted(publishing, String(publishingJob.jobId))).body.status)
      .toBe('completed');
  });

  test('cancels during a bounded rate wait and during validation without publishing', async () => {
    let waitStarted!: () => void;
    const rateWait = new Promise<void>(resolve => { waitStarted = resolve; });
    const successfulFetch = executionEnvironment().fetch;
    const waitingEnvironment: JQuantsExecutionEnvironmentV1 = Object.freeze({
      fetch: successfulFetch,
      wallNowMs: () => Date.parse('2026-12-01T00:00:00.000Z'),
      monotonicNowMs: () => 0,
      sleep: (durationMs, signal) => new Promise((_resolve, reject) => {
        if (durationMs !== 30_000) waitStarted();
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      apiKey: () => 'test-key',
    });
    const waiting = await context({
      environment: waitingEnvironment,
      requestsPerMinute: 1,
    });
    const saved = await waiting.snapshots.save(comparisonSnapshot());
    const preflight = await json(await call(waiting, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId }),
    })));
    const accepted = await json(await call(waiting, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ preflightId: preflight.preflightId, confirmExternalFetch: true }),
    })));
    const waitingJob = accepted.job as Record<string, unknown>;
    await rateWait;
    expect((await call(waiting, request(
      `/api/strategy-validation/jobs/${waitingJob.jobId}`,
      { method: 'DELETE' },
    ))).status).toBe(202);
    expect((await waitForCompleted(waiting, String(waitingJob.jobId))).body.status)
      .toBe('cancelled');
    expect(await waiting.runs.hasRun(String(waitingJob.runId))).toBeFalse();

    let validationStarted!: () => void;
    let releaseValidation!: () => void;
    const validationSignal = new Promise<void>(resolve => { validationStarted = resolve; });
    const validationGate = new Promise<void>(resolve => { releaseValidation = resolve; });
    const validating = await context({
      beforePublish: async () => {
        validationStarted();
        await validationGate;
      },
    });
    const localSaved = await validating.snapshots.save({ ...comparisonSnapshot(), strategy: null });
    const localPreflight = await json(await call(
      validating,
      request('/api/strategy-validation/preflights', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'snapshot', ticker: '7203', snapshotId: localSaved.snapshotId,
        }),
      }),
    ));
    const localAccepted = await json(await call(
      validating,
      request('/api/strategy-validation/jobs', {
        method: 'POST',
        body: JSON.stringify({
          preflightId: localPreflight.preflightId, confirmExternalFetch: true,
        }),
      }),
    ));
    const validatingJob = localAccepted.job as Record<string, unknown>;
    await validationSignal;
    await waitForStatus(validating, String(validatingJob.jobId), 'validating');
    expect((await call(validating, request(
      `/api/strategy-validation/jobs/${validatingJob.jobId}`,
      { method: 'DELETE' },
    ))).status).toBe(202);
    releaseValidation();
    expect((await waitForCompleted(validating, String(validatingJob.jobId))).body.status)
      .toBe('cancelled');
    expect(await validating.runs.hasRun(String(validatingJob.runId))).toBeFalse();
  });

  test('persists the derived outcome boundary through a later failure and cancellation', async () => {
    const failedBase = executionEnvironment();
    let failedFetchCount = 0;
    const failing = await context({
      environment: Object.freeze({
        ...failedBase,
        fetch: async (input: string | URL, init?: RequestInit) => {
          failedFetchCount += 1;
          if (failedFetchCount === 1) return failedBase.fetch(input, init);
          return new Response('{"message":"rejected"}', {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
    });
    const failedSaved = await failing.snapshots.save(comparisonSnapshot());
    const failedPreflight = await json(await call(
      failing,
      request('/api/strategy-validation/preflights', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'snapshot', ticker: '7203', snapshotId: failedSaved.snapshotId,
        }),
      }),
    ));
    const failedAccepted = await json(await call(failing, request(
      '/api/strategy-validation/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          preflightId: failedPreflight.preflightId, confirmExternalFetch: true,
        }),
      },
    )));
    const failedJob = failedAccepted.job as Record<string, unknown>;
    const failedTerminal = await waitForCompleted(failing, String(failedJob.jobId));
    expect(failedTerminal.body).toMatchObject({
      status: 'failed',
      outcomeAsOfSession: '2026-11-30',
    });
    expect(await failing.runs.hasRun(String(failedJob.runId))).toBeFalse();

    let laterFetchStarted!: () => void;
    const laterFetchSignal = new Promise<void>(resolve => { laterFetchStarted = resolve; });
    const cancelledBase = executionEnvironment();
    let cancelledFetchCount = 0;
    const cancelled = await context({
      environment: Object.freeze({
        ...cancelledBase,
        fetch: async (input: string | URL, init?: RequestInit) => {
          cancelledFetchCount += 1;
          if (cancelledFetchCount === 1) return cancelledBase.fetch(input, init);
          laterFetchStarted();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          });
        },
      }),
    });
    const cancelledSaved = await cancelled.snapshots.save(comparisonSnapshot());
    const cancelledPreflight = await json(await call(
      cancelled,
      request('/api/strategy-validation/preflights', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'snapshot', ticker: '7203', snapshotId: cancelledSaved.snapshotId,
        }),
      }),
    ));
    const cancelledAccepted = await json(await call(cancelled, request(
      '/api/strategy-validation/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          preflightId: cancelledPreflight.preflightId, confirmExternalFetch: true,
        }),
      },
    )));
    const cancelledJob = cancelledAccepted.job as Record<string, unknown>;
    await laterFetchSignal;
    expect((await call(cancelled, request(
      `/api/strategy-validation/jobs/${cancelledJob.jobId}`,
      { method: 'DELETE' },
    ))).status).toBe(202);
    const cancelledTerminal = await waitForCompleted(cancelled, String(cancelledJob.jobId));
    expect(cancelledTerminal.body).toMatchObject({
      status: 'cancelled',
      outcomeAsOfSession: '2026-11-30',
    });
    expect(await cancelled.runs.hasRun(String(cancelledJob.runId))).toBeFalse();
  });

  test('rejects a provably infeasible campaign before creating a preflight identity', async () => {
    const value = await context();
    const anchors = Array.from({ length: 250 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
      return { ticker: '7203', anchorDate: date, resistanceEvidence: [] };
    });
    const response = await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'campaign',
        manifest: {
          schemaVersion: 'strategy_validation_campaign_v1',
          name: 'infeasible',
          anchors,
        },
      }),
    }));
    const body = await json(response);
    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'external_schedule_infeasible',
        message: 'The minimum external-request schedule cannot finish within the fixed limits.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('preflightId');
  });

  test('rejects preflight capacity exhaustion without invalidating returned identities', async () => {
    const value = await context();
    const saved = await value.snapshots.save({ ...comparisonSnapshot(), strategy: null });
    const preflights: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 64; index += 1) {
      const response = await call(value, request('/api/strategy-validation/preflights', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId,
        }),
      }));
      expect(response.status).toBe(200);
      preflights.push(await json(response));
    }
    const overflow = await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId }),
    }));
    const overflowBody = await json(overflow);
    expect(overflow.status).toBe(500);
    expect(overflowBody).toEqual({
      error: {
        code: 'internal_failure',
        message: 'The request could not be completed.',
      },
    });
    expect(JSON.stringify(overflowBody)).not.toContain('preflightId');

    const oldest = preflights[0]!;
    const accepted = await json(await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ preflightId: oldest.preflightId, confirmExternalFetch: true }),
    })));
    const job = accepted.job as Record<string, unknown>;
    expect((await waitForCompleted(value, String(job.jobId))).body.status).toBe('completed');
  });

  test('fails closed on Host, Origin, CSRF, media type, strict JSON, body caps, and methods', async () => {
    const value = await context();
    const path = '/api/strategy-validation/preflights';
    const validBody = JSON.stringify({
      mode: 'snapshot', ticker: '7203', snapshotId: '2026-08-22T01-00-00-000Z',
    });
    const vectors = [
      [request(path, { method: 'POST', body: validBody, host: 'example.com' }), 403, 'forbidden_host'],
      [request(path, { method: 'POST', body: validBody, origin: 'http://localhost:3000' }), 403, 'forbidden_origin'],
      [request(path, { method: 'POST', body: validBody, csrf: 'wrong' }), 403, 'csrf_failed'],
      [request(path, { method: 'POST', body: validBody, contentType: 'text/plain' }), 415, 'unsupported_media_type'],
      [request(path, { method: 'POST', body: '{"mode":"snapshot","mode":"campaign"}' }), 400, 'invalid_json'],
      [request(path, { method: 'POST', body: '{"unknown":true}' }), 400, 'invalid_request'],
    ] as const;
    for (const [input, status, code] of vectors) {
      const response = await call(value, input);
      expect(response.status).toBe(status);
      expect(await json(response)).toMatchObject({ error: { code } });
      expect(response.headers.has('access-control-allow-origin')).toBeFalse();
    }
    const oversized = await call(value, request(path, {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(1_100_000) }),
    }));
    expect(oversized.status).toBe(413);
    expect(await json(oversized)).toMatchObject({ error: { code: 'payload_too_large' } });
    const oversizedJob = await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(4_096) }),
    }));
    expect(oversizedJob.status).toBe(413);
    const deleteWithBody = await call(value, request(
      '/api/strategy-validation/jobs/33333333-3333-4333-8333-333333333333',
      { method: 'DELETE', body: '{}' },
    ));
    expect(deleteWithBody.status).toBe(400);
    expect(await json(deleteWithBody)).toMatchObject({ error: { code: 'invalid_request' } });

    const unsupported = await call(value, request('/api/strategy-validation/runs', {
      method: 'POST', body: '{}',
    }));
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get('allow')).toBe('GET');
    expect(unsupported.headers.has('access-control-allow-origin')).toBeFalse();
  });

  test('maps not-found, lifecycle conflict, malformed query, and artifact corruption exactly', async () => {
    const value = await context();
    const missingSnapshot = await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'snapshot', ticker: '7203', snapshotId: '2026-08-22T01-00-00-000Z',
      }),
    }));
    expect(missingSnapshot.status).toBe(404);
    expect(await json(missingSnapshot)).toMatchObject({ error: { code: 'snapshot_not_found' } });
    const unknownRoute = await call(value, request('/api/strategy-validation/unknown', {
      origin: null, csrf: null,
    }));
    expect(unknownRoute.status).toBe(400);
    expect(await json(unknownRoute)).toMatchObject({
      error: { code: 'invalid_route_parameter' },
    });
    for (const [path, code] of [
      ['/api/strategy-validation/runs/11111111-1111-4111-8111-111111111111', 'run_not_found'],
      ['/api/strategy-validation/jobs/33333333-3333-4333-8333-333333333333', 'job_not_found'],
    ]) {
      const response = await call(value, request(path, { origin: null, csrf: null }));
      expect(response.status).toBe(404);
      expect(await json(response)).toMatchObject({ error: { code } });
    }
    for (const query of ['limit=01', 'limit=101', 'unknown=1', 'ticker=7203&ticker=6758']) {
      const response = await call(value, request(`/api/strategy-validation/runs?${query}`, {
        origin: null, csrf: null,
      }));
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: { code: 'invalid_query' } });
    }

    const saved = await value.snapshots.save({ ...comparisonSnapshot(), strategy: null });
    const preflight = await json(await call(value, request('/api/strategy-validation/preflights', {
      method: 'POST',
      body: JSON.stringify({ mode: 'snapshot', ticker: '7203', snapshotId: saved.snapshotId }),
    })));
    const accepted = await json(await call(value, request('/api/strategy-validation/jobs', {
      method: 'POST',
      body: JSON.stringify({ preflightId: preflight.preflightId, confirmExternalFetch: true }),
    })));
    const job = accepted.job as Record<string, unknown>;
    const completed = await waitForCompleted(value, String(job.jobId));
    expect(completed.body.status).toBe('completed');
    const missingCase = await call(value, request(
      `/api/strategy-validation/runs/${job.runId}/cases/77777777-7777-4777-8777-777777777777`,
      { origin: null, csrf: null },
    ));
    expect(missingCase.status).toBe(404);
    expect(await json(missingCase)).toMatchObject({ error: { code: 'case_not_found' } });
    const invalidRoute = await call(value, request('/api/strategy-validation/runs/not-a-uuid', {
      origin: null, csrf: null,
    }));
    expect(invalidRoute.status).toBe(400);
    expect(await json(invalidRoute)).toMatchObject({
      error: { code: 'invalid_route_parameter' },
    });
    const cancel = await call(value, request(
      `/api/strategy-validation/jobs/${job.jobId}`,
      { method: 'DELETE' },
    ));
    expect(cancel.status).toBe(409);
    expect(await json(cancel)).toMatchObject({ error: { code: 'invalid_job_transition' } });

    const storedJob = await value.jobs.load(String(job.jobId));
    await value.jobs.replace({
      ...storedJob,
      progress: { ...storedJob.progress, caseCount: storedJob.progress.caseCount + 1 },
    });
    const corruptJob = await call(value, request(
      `/api/strategy-validation/jobs/${job.jobId}`,
      { origin: null, csrf: null },
    ));
    expect(corruptJob.status).toBe(500);
    expect(await json(corruptJob)).toMatchObject({ error: { code: 'artifact_unavailable' } });
    await value.jobs.replace(storedJob);

    await writeFile(
      join(value.runs.runsDirectory, String(job.runId), 'run.json'),
      '{invalid',
      'utf8',
    );
    const corrupt = await call(value, request('/api/strategy-validation/runs', {
      origin: null, csrf: null,
    }));
    const corruptText = await corrupt.text();
    expect(corrupt.status).toBe(500);
    expect(corruptText).toContain('artifact_unavailable');
    expect(corruptText).not.toContain(value.root);
    expect(corruptText).not.toContain('SyntaxError');
  });
});
