import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DashboardJobCoordinatorV1 } from '../analysis/dashboard-jobs/coordinator.js';
import type { JQuantsExecutionEnvironmentV1 } from '../analysis/strategy-validation/jquants-execution.js';
import { MarketDataJobRepositoryV1 } from '../analysis/market-data/job-repository.js';
import { MarketDataJobServiceV1, type MarketDataJobLimitsV1 } from '../analysis/market-data/job-service.js';
import { MarketDataRepositoryV1 } from '../analysis/market-data/repository.js';
import { fixtureCodec, fixtureDraft, type FixtureArtifact } from '../analysis/market-data/repository-test-fixtures.js';
import { OverviewModuleRegistryV1, createOverviewModuleAdapterV1 } from '../analysis/market-data/overview-registry.js';
import type { AnalysisSnapshotReader } from './api.js';
import { handleDashboardRequest } from './api.js';
import { MarketDataDashboardApiV1 } from './market-data-api.js';
import { DashboardSessionV1 } from './session.js';
import { createDefaultDashboardApisV1 } from './server.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const snapshots: AnalysisSnapshotReader = { listLatest: async () => [], listHistory: async () => [],
  loadLatest: async () => { throw new Error('missing'); }, loadHistory: async () => { throw new Error('missing'); } };

async function api(configured = false, limitOverride?: MarketDataJobLimitsV1) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-market-api-')); roots.push(root);
  const environment: JQuantsExecutionEnvironmentV1 = { monotonicNowMs: () => 0,
    wallNowMs: () => Date.parse('2026-09-04T00:00:00.000Z'), apiKey: () => 'synthetic',
    fetch: async () => { throw new Error('external I/O forbidden'); }, sleep: async () => {} };
  const coordinator = new DashboardJobCoordinatorV1(environment, 5);
  coordinator.register({ domain: 'strategy_validation', inventory: async () => [], isAbsent: async () => true,
    cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected'); } });
  let queued: (() => void) | undefined;
  const repository = new MarketDataRepositoryV1(fixtureCodec(false, {}), root);
  const module = createOverviewModuleAdapterV1<FixtureArtifact>({ repository,
    collect: async context => {
      await context.dispatch(async () => null);
      context.recordProgress({ pages: 1, acceptedRows: 1, responseBytes: 8 });
      return { artifact: fixtureCodec(false, {}).build(fixtureDraft(context.acceptedAt)),
        attempts: 1, pages: 1, acceptedRows: 1, responseBytes: 8 };
    }, project: artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }), environment: {} });
  const service = new MarketDataJobServiceV1({ coordinator, jobRepository: new MarketDataJobRepositoryV1(root),
    overviewRegistry: new OverviewModuleRegistryV1(configured ? [module] : []),
    limits: configured ? limitOverride ?? { estimatedMinimumAttempts: 1, maximumAttempts: 2, maximumPages: 2,
      maximumRows: 2, maximumResponseBytes: 128, executionBudgetMs: 120_000 } : undefined,
    enqueue: work => { queued = work; } });
  const session = new DashboardSessionV1('a'.repeat(43));
  const value = new MarketDataDashboardApiV1(service, session);
  await service.initialize();
  return { value, session, queued: () => queued?.() };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://127.0.0.1${path}`, { ...init,
    headers: { host: '127.0.0.1', ...(init.headers ?? {}) } });
}
async function body(response: Response) { return await response.json() as { error?: { code: string } }; }

describe('Market Data Dashboard API', () => {
  test('uses the closed empty-registry GET/POST behavior and query code', async () => {
    const h = await api();
    const get = await handleDashboardRequest(request('/api/market-data/overview'), snapshots, undefined, h.value);
    expect(get.status).toBe(404); expect((await body(get)).error?.code).toBe('artifact_not_found');

    const post = await handleDashboardRequest(request('/api/market-data/overview/jobs', { method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1',
        'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' }, body: '{}' }), snapshots, undefined, h.value);
    expect(post.status).toBe(400); expect((await body(post)).error?.code).toBe('source_configuration_missing');

    const query = await handleDashboardRequest(request('/api/market-data/overview?extra=1'), snapshots, undefined, h.value);
    expect(query.status).toBe(400); expect((await body(query)).error?.code).toBe('invalid_query');
  });

  test('accepts configured but infeasible limits and records the typed terminal result', async () => {
    const h = await api(true, { estimatedMinimumAttempts: 11, maximumAttempts: 11,
      maximumPages: 2, maximumRows: 2, maximumResponseBytes: 128, executionBudgetMs: 120_000 });
    const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1',
      'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' };
    const response = await handleDashboardRequest(request('/api/market-data/overview/jobs',
      { method: 'POST', headers, body: '{}' }), snapshots, undefined, h.value);
    expect(response.status).toBe(202);
    const accepted = await response.json() as { jobId: string };
    h.queued();
    for (let i = 0; i < 50; i++) {
      const job = await h.value.service.getJob(accepted.jobId);
      if (job.status === 'failed') {
        if (job.result?.kind !== 'overview') throw new Error('Expected Overview result.');
        expect(job.result.moduleResults[0]).toMatchObject({ failureCode: 'external_schedule_infeasible' });
        expect(job.progress.attempts).toBe(0);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error('Infeasible job did not finish.');
  });

  test('preserves method, security, strict JSON, and streaming body precedence', async () => {
    const h = await api();
    const method = await handleDashboardRequest(request('/api/market-data/overview', { method: 'POST' }), snapshots, undefined, h.value);
    expect(method.status).toBe(405); expect(method.headers.get('allow')).toBe('GET');

    const forbidden = await handleDashboardRequest(request('/api/market-data/overview/jobs', { method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://localhost',
        'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' }, body: '{}' }), snapshots, undefined, h.value);
    expect(forbidden.status).toBe(403); expect((await body(forbidden)).error?.code).toBe('request_forbidden');

    const duplicate = await handleDashboardRequest(request('/api/market-data/overview/jobs', { method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1',
        'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' }, body: '{"x":1,"x":2}' }), snapshots, undefined, h.value);
    expect(duplicate.status).toBe(400); expect((await body(duplicate)).error?.code).toBe('invalid_request');

    const oversized = await handleDashboardRequest(request('/api/market-data/overview/jobs', { method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1',
        'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' }, body: `{"x":"${'a'.repeat(4096)}"}` }), snapshots, undefined, h.value);
    expect(oversized.status).toBe(413); expect((await body(oversized)).error?.code).toBe('request_body_too_large');
  });

  test('maps Market Data Host failures and exact missing jobs without changing Analysis codes', async () => {
    const h = await api();
    const forbidden = await handleDashboardRequest(new Request('http://evil.example/api/market-data/overview',
      { headers: { host: 'evil.example' } }), snapshots, undefined, h.value);
    expect(forbidden.status).toBe(403); expect((await body(forbidden)).error?.code).toBe('request_forbidden');
    const missing = await handleDashboardRequest(request(`/api/market-data/jobs/${randomUUID()}`), snapshots, undefined, h.value);
    expect(missing.status).toBe(404); expect((await body(missing)).error?.code).toBe('job_not_found');
    const analyses = await handleDashboardRequest(new Request('http://evil.example/api/analyses',
      { headers: { host: 'evil.example' } }), snapshots, undefined, h.value);
    expect((await body(analyses)).error?.code).toBe('forbidden_host');
  });

  test('serves accepted/active/exact/cancel lifecycle routes without a second confirmation field', async () => {
    const h = await api(true);
    const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1',
      'x-dexter-csrf': h.session.csrfToken, 'content-type': 'application/json' };
    const acceptedResponse = await handleDashboardRequest(request('/api/market-data/overview/jobs',
      { method: 'POST', headers, body: '{}' }), snapshots, undefined, h.value);
    expect(acceptedResponse.status).toBe(202);
    const accepted = await acceptedResponse.json() as { jobId: string };
    const active = await handleDashboardRequest(request('/api/market-data/jobs/active'), snapshots, undefined, h.value);
    expect(await active.json()).toMatchObject({ marketJob: { jobId: accepted.jobId, status: 'accepted' }, blockingKind: null });
    const exact = await handleDashboardRequest(request(`/api/market-data/jobs/${accepted.jobId}`), snapshots, undefined, h.value);
    expect(exact.status).toBe(200);
    const cancellation = await handleDashboardRequest(request(`/api/market-data/jobs/${accepted.jobId}`,
      { method: 'DELETE', headers }), snapshots, undefined, h.value);
    expect(cancellation.status).toBe(202);
    h.queued();
    for (let i = 0; i < 50; i++) {
      const job = await h.value.service.getJob(accepted.jobId);
      if (job.status === 'cancelled') break;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    const again = await handleDashboardRequest(request(`/api/market-data/jobs/${accepted.jobId}`,
      { method: 'DELETE', headers }), snapshots, undefined, h.value);
    expect(again.status).toBe(200);
  });

  test('default composition gives both domains one session owner', () => {
    const defaults = createDefaultDashboardApisV1();
    expect(defaults.strategyValidationApi.session).toBe(defaults.marketDataApi.session);
    expect(defaults.strategyValidationApi.csrfToken).toBe(defaults.marketDataApi.session.csrfToken);
  });
});
