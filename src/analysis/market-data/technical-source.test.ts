import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DashboardJobCoordinatorV1 } from '../dashboard-jobs/coordinator.js';
import { MarketDataJobRepositoryV1 } from './job-repository.js';
import { MarketDataJobServiceV1 } from './job-service.js';
import { TechnicalAdapterV1 } from './technical-adapter.js';
import { MarketDataDashboardApiV1 } from '../../dashboard/market-data-api.js';
import { DashboardSessionV1 } from '../../dashboard/session.js';
import type { MarketDataJobViewV1 } from './job-schema.js';
import type { JobWriteOutcomeV1 } from '../dashboard-jobs/coordinator.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { collectTechnicalV1 } from './technical-source.js';
import { createTechnicalArtifactCodecV1 } from './technical-artifact.js';
import type { OverviewCollectionContextV1 } from './overview-registry.js';

export function technicalFixtureV1(options: { allGap?: boolean; missing?: boolean; master?: Record<string, unknown>;
  status?: number; partialGap?: boolean; close?: number; acceptedAt?: string } = {}) {
  let calls = 0;
  const acceptedAt = options.acceptedAt ?? '2026-09-09T08:00:00.000Z';
  const env: JQuantsExecutionEnvironmentV1 = { apiKey: () => 'synthetic-test-key',
    wallNowMs: () => Date.parse(acceptedAt) + 1000, monotonicNowMs: () => 0, sleep: async () => {},
    fetch: async input => {
      calls++;
      const url = new URL(String(input));
      if (options.status) return new Response('private provider detail', { status: options.status });
      if (url.pathname.endsWith('/master')) return Response.json({ data: [{ Date: url.searchParams.get('date'), Code: '72030',
        CoName: '合成テスト銘柄', ProdCat: '011', Mkt: '0111', ...options.master }] });
      const calendar = url.pathname.endsWith('/calendar');
      const from = calendar ? url.searchParams.get('from')! : '2026-07-01';
      const to = url.searchParams.get('to')!;
      const rows = [];
      for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 86400000) {
        const day = new Date(ms), DateValue = day.toISOString().slice(0, 10);
        const session = ![0, 6].includes(day.getUTCDay());
        if (calendar) rows.push({ Date: DateValue, HolDiv: session ? '1' : '0' });
        else if (session && !(options.missing && DateValue === '2026-07-10')) {
          const gap = options.allGap || (options.partialGap && DateValue.startsWith('2026-09'));
          rows.push({ Date: DateValue, Code: '72030', AdjO: gap ? null : 100, AdjH: gap ? null : 110,
            AdjL: gap ? null : 90, AdjC: gap ? null : options.close ?? 105, AdjVo: gap ? null : 0, AdjFactor: 1, ExRT: null });
        }
      }
      return Response.json({ data: rows });
    } };
  const counts = { attempts: 0, pages: 0, acceptedRows: 0, responseBytes: 0 };
  const context: OverviewCollectionContextV1 = { jobId: '11111111-1111-4111-8111-111111111111',
    acceptedAt, signal: new AbortController().signal, shareSource: async (_key, load) => load(),
    dispatch: async start => { counts.attempts++; return start(new AbortController().signal); },
    recordProgress: p => { counts.pages += p.pages; counts.acceptedRows += p.acceptedRows; counts.responseBytes += p.responseBytes; } };
  return { env, context, counts, calls: () => calls };
}

describe('DR-T2 Technical production artifact/source', () => {
  test('freezes admission-date range and excludes the admission session before 16:30 JST', async () => {
    const h = technicalFixtureV1({ acceptedAt: '2026-09-09T07:29:59.999Z' });
    const { artifact } = await collectTechnicalV1('7203', h.context, h.env, {});
    expect(artifact.queryFrom).toBe('2016-09-09');
    expect(artifact.queryTo).toBe('2026-09-08');
    expect(artifact.dataDate).toBe('2026-09-08');
    expect(artifact.acceptedAt).toBe(h.context.acceptedAt);
    expect(artifact.historyBoundary.currentMasterDate).toBe('2026-09-08');
  });

  test('production transport rejects unbounded, malformed and unfinished inputs without publication', async () => {
    for (const [response, code] of [
      [() => Response.json({ data: [], extra: true }), 'source_invalid_response'],
      [() => Response.json({ data: [], pagination_key: 'repeat' }), 'source_pagination_incomplete'],
      [() => new Response('{}', { headers: { 'content-length': String(33554433) } }), 'source_response_too_large'],
      [() => Response.json({ message: 'Your subscription covers the following dates: 2021-09-09 ~ 2026-09-09' }, { status: 400 }), 'source_entitlement_required'],
    ] as const) {
      const h = technicalFixtureV1();
      await expect(collectTechnicalV1('7203', h.context, { ...h.env, fetch: async () => response() }, {}))
        .rejects.toMatchObject({ code });
      expect(h.counts.attempts).toBeLessThanOrEqual(2);
    }
  });

  test('builds three-input digest-bound artifacts using the official-calendar mapper and no raw fields', async () => {
    const h = technicalFixtureV1();
    const result = await collectTechnicalV1('7203', h.context, h.env, {});
    expect(h.calls()).toBe(3);
    expect(result).toMatchObject(h.counts);
    const artifact = result.artifact;
    expect(artifact.queryFrom).toBe('2016-09-09');
    expect(artifact.calculationFrom).toBe('2026-07-01');
    expect(artifact.dataDate).toBe('2026-09-09');
    expect(artifact.warnings.map(w => w.code)).toEqual(['history_coverage_clipped', 'historical_identity_unverified']);
    expect(artifact.sourceInputs.map(i => i.role)).toEqual(['daily_bars', 'security_master', 'trading_calendar']);
    expect(JSON.stringify(artifact)).not.toContain('synthetic-test-key');
    const codec = createTechnicalArtifactCodecV1('7203', {});
    expect(codec.parse(artifact)).toEqual(artifact);
    expect(h.calls()).toBe(3);
    const { sourcePayloadDigest: _s, artifactDigest: _a, ...draft } = artifact;
    expect(() => codec.build({ ...draft, extra: true })).toThrow();
    expect(() => codec.build({ ...draft, warnings: [] })).toThrow();
    expect(() => codec.build({ ...draft, series: { ...draft.series, day: [] } })).toThrow();
    expect(() => codec.build({ ...draft, series: { ...draft.series, day: draft.series.day.map((row, i) =>
      i === 20 ? { ...row, rsi: { state: 'available', value: 12 } } : row) } })).toThrow();
    expect(() => codec.build({ ...draft, dailyObservations: [...draft.dailyObservations, draft.dailyObservations[0]] })).toThrow();
    expect(() => codec.parse({ ...artifact, artifactDigest: `sha256:${'0'.repeat(64)}` })).toThrow();
    expect(() => createTechnicalArtifactCodecV1('6758', {}).parse(artifact)).toThrow();
  });

  test('retains exact partial-period gap reasons and does not convert all-gap input into an artifact', async () => {
    const h = technicalFixtureV1({ partialGap: true });
    const { artifact } = await collectTechnicalV1('7203', h.context, h.env, {});
    expect(artifact.dataDate).toBe('2026-08-31');
    expect(artifact.unavailablePeriods).toContainEqual({ interval: 'month', identity: '2026-09',
      periodStart: '2026-09-01', periodEnd: '2026-09-30', reason: 'partial_period' });
    const { sourcePayloadDigest: _s, artifactDigest: _a, ...draft } = artifact;
    expect(() => createTechnicalArtifactCodecV1('7203', {}).build({ ...draft,
      unavailablePeriods: draft.unavailablePeriods.map(row => row.interval === 'month' ? { ...row, reason: 'source_gap' } : row) })).toThrow();
    const gap = technicalFixtureV1({ allGap: true });
    await expect(collectTechnicalV1('7203', gap.context, gap.env, {})).rejects.toMatchObject({ code: 'source_no_observation' });
  });

  test('fails closed on identity/missing-session/provider failures without retries', async () => {
    for (const [options, code, attempts] of [
      [{ missing: true }, 'source_invalid_response', 3],
      [{ master: { Mkt: '0109' } }, 'instrument_identity_unverified', 2],
      [{ status: 403 }, 'source_entitlement_required', 1],
      [{ status: 401 }, 'source_unauthorized', 1],
      [{ status: 429 }, 'source_rate_limited', 1],
    ] as const) {
      const h = technicalFixtureV1(options);
      await expect(collectTechnicalV1('7203', h.context, h.env, {})).rejects.toMatchObject({ code });
      expect(h.calls()).toBe(attempts);
    }
  });
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function harness(options: Parameters<typeof technicalFixtureV1>[0] = {}, fault: 'terminal' | 'create' | null = null) {
  const fixture = technicalFixtureV1(options);
  const root = await mkdtemp(join(tmpdir(), 'dexter-technical-')); roots.push(root);
  let now = Date.parse(fixture.context.acceptedAt);
  const env = { ...fixture.env, wallNowMs: () => now, monotonicNowMs: () => now - Date.parse(fixture.context.acceptedAt) };
  const coordinator = new DashboardJobCoordinatorV1(env, 500);
  coordinator.register({ domain: 'strategy_validation', inventory: async () => [], cleanup: async () => {},
    isAbsent: async () => true, reconcile: async () => {} });
  const adapter = new TechnicalAdapterV1(env, root, {});
  let queued: (() => void) | undefined;
  class FaultRepository extends MarketDataJobRepositoryV1 {
    override async create(job: MarketDataJobViewV1): Promise<JobWriteOutcomeV1<MarketDataJobViewV1>> {
      if (fault === 'create') return { state: 'ambiguous' };
      return super.create(job);
    }
    override async replace(job: MarketDataJobViewV1): Promise<JobWriteOutcomeV1<MarketDataJobViewV1>> {
      if (fault === 'terminal' && job.status === 'completed') return { state: 'ambiguous' };
      return super.replace(job);
    }
  }
  const service = new MarketDataJobServiceV1({ coordinator, technicalSource: adapter,
    jobRepository: new FaultRepository(root), enqueue: work => { queued = work; } });
  await service.initialize();
  return { ...fixture, root, env, adapter, service, coordinator,
    start: () => queued?.(), advance: () => { now += 60001; } };
}
async function terminal(service: MarketDataJobServiceV1, id: string) {
  for (let i = 0; i < 300; i++) {
    const job = await service.getJob(id);
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Technical test did not terminate.');
}

describe('DR-T2 shared service and GET/POST boundary', () => {
  test('a corrupt latest revision falls back explicitly to the prior valid receipt', async () => {
    const options = { close: 105 };
    const h = await harness(options);
    const first = await h.service.acceptTechnical('7203'); h.start(); await terminal(h.service, first.jobId);
    const before = await h.service.readTechnical('7203');
    options.close = 106; h.advance();
    const next = await h.service.acceptTechnical('7203'); h.start(); await terminal(h.service, next.jobId);
    const latest = await h.service.readTechnical('7203');
    expect(latest.artifact.artifactDigest).not.toBe(before.artifact.artifactDigest);
    await writeFile(join(h.root, h.adapter.repository('7203').codec.identity(latest.artifact).rootRelativeIdentity), '{broken');
    const fallback = await h.service.readTechnical('7203');
    expect(fallback.state).toBe('fallback');
    expect(fallback.observationReceiptIdentity).toEqual(before.observationReceiptIdentity);
    expect(fallback.warnings.map(w => w.code)).toContain('artifact_corrupt_fallback');
    expect(h.calls()).toBe(6);
  });

  test('in-flight cancellation and elapsed execution budget prevent publication', async () => {
    const h = await harness();
    let dispatchStarted!: () => void;
    const started = new Promise<void>(resolve => { dispatchStarted = resolve; });
    h.env.fetch = async () => { dispatchStarted(); return new Promise<Response>(() => {}); };
    const accepted = await h.service.acceptTechnical('7203'); h.start(); await started;
    await h.service.cancelJob(accepted.jobId);
    expect((await terminal(h.service, accepted.jobId)).status).toBe('cancelled');
    await expect(h.service.readTechnical('7203')).rejects.toMatchObject({ code: 'artifact_not_found' });
    const timeout = await harness();
    const original = timeout.env.fetch;
    timeout.env.fetch = async (url, init) => { timeout.advance(); timeout.advance(); timeout.advance(); return original(url, init); };
    const job = await timeout.service.acceptTechnical('7203'); timeout.start();
    expect((await terminal(timeout.service, job.jobId)).failure?.code).toBe('source_timeout');
    expect(timeout.calls()).toBe(1);
  });

  test('retains prior observation after all-gap failure and detects corrupt latest without fetching', async () => {
    const options = { allGap: false };
    const h = await harness(options);
    const first = await h.service.acceptTechnical('7203'); h.start(); await terminal(h.service, first.jobId);
    const before = await h.service.readTechnical('7203');
    options.allGap = true; h.advance();
    const next = await h.service.acceptTechnical('7203'); h.start();
    expect((await terminal(h.service, next.jobId)).failure?.code).toBe('source_no_observation');
    expect((await h.service.readTechnical('7203')).observationReceiptIdentity).toEqual(before.observationReceiptIdentity);
    expect(h.calls()).toBe(6);
    const identity = h.adapter.repository('7203').codec.identity(before.artifact);
    await writeFile(join(h.root, identity.rootRelativeIdentity), '{broken');
    await expect(h.service.readTechnical('7203')).rejects.toMatchObject({ code: 'artifact_corrupt' });
    expect(h.calls()).toBe(6);
  });

  test('post-receipt terminal write failure keeps a memory result and restart interrupts only the job', async () => {
    const h = await harness({}, 'terminal');
    const accepted = await h.service.acceptTechnical('7203'); h.start();
    const done = await terminal(h.service, accepted.jobId);
    expect(done.status).toBe('completed');
    expect(done.result?.kind === 'technical' && done.result.warningCodes).toContain('job_record_write_failed');
    expect((await h.service.readTechnical('7203')).artifact.dataDate).toBe('2026-09-09');
    await expect(h.service.acceptTechnical('7203')).rejects.toBeDefined();
    const coordinator = new DashboardJobCoordinatorV1(h.env, 500);
    coordinator.register({ domain: 'strategy_validation', inventory: async () => [], cleanup: async () => {},
      isAbsent: async () => true, reconcile: async () => {} });
    const recovered = new MarketDataJobServiceV1({ coordinator, technicalSource: h.adapter,
      jobRepository: new MarketDataJobRepositoryV1(h.root) });
    await recovered.initialize();
    expect((await recovered.getJob(accepted.jobId)).status).toBe('interrupted');
    expect((await recovered.readTechnical('7203')).observationReceiptIdentity.jobId).toBe(accepted.jobId);
  });

  test('ambiguous admission cannot dispatch, and an external strategy lease blocks Technical admission', async () => {
    const broken = await harness({}, 'create');
    await expect(broken.service.acceptTechnical('7203')).rejects.toBeDefined();
    expect(broken.calls()).toBe(0);
    const h = await harness();
    const jobId = '22222222-2222-4222-8222-222222222222';
    await h.coordinator.admit({ kind: 'strategy_validation', jobId, revalidate: () => {},
      create: async () => ({ state: 'published', record: { domain: 'strategy_validation', kind: 'strategy_validation', jobId, terminal: false } }),
      adopt: () => {} });
    await expect(h.service.acceptTechnical('7203')).rejects.toBeDefined();
    expect(h.calls()).toBe(0);
  });

  test('publishes, reads without fetch, and reuses content with a new receipt', async () => {
    const h = await harness();
    await expect(h.service.readTechnical('7203')).rejects.toMatchObject({ code: 'artifact_not_found' });
    expect(h.calls()).toBe(0);
    const accepted = await h.service.acceptTechnical('7203'); h.start();
    const done = await terminal(h.service, accepted.jobId);
    expect(done.status).toBe('completed');
    expect(done.result).toMatchObject({ kind: 'technical', state: 'published' });
    const latest = await h.service.readTechnical('7203');
    expect(latest.artifact.dataDate).toBe('2026-09-09'); expect(h.calls()).toBe(3);
    h.advance();
    const next = await h.service.acceptTechnical('7203'); h.start();
    const reused = await terminal(h.service, next.jobId);
    expect(reused.result).toMatchObject({ state: 'idempotent_reuse' });
    const reread = await h.service.readTechnical('7203');
    expect(reread.artifact.artifactDigest).toBe(latest.artifact.artifactDigest);
    expect(reread.observationReceiptIdentity.jobId).toBe(next.jobId);
    expect(reread.checkedAt).not.toBe(latest.checkedAt);
  });

  test('all-gap failure leaves initial GET missing and cancellation uses the common job owner', async () => {
    const h = await harness({ allGap: true });
    const accepted = await h.service.acceptTechnical('7203'); h.start();
    expect(await terminal(h.service, accepted.jobId)).toMatchObject({ status: 'failed', failure: { code: 'source_no_observation' }, result: null });
    await expect(h.service.readTechnical('7203')).rejects.toMatchObject({ code: 'artifact_not_found' });
    h.advance();
    const next = await h.service.acceptTechnical('7203');
    await expect(h.service.acceptTechnical('7203')).rejects.toBeDefined();
    const cancelled = await h.service.cancelJob(next.jobId); expect(cancelled.status).toBe(202);
    h.start(); expect((await terminal(h.service, next.jobId)).status).toBe('cancelled');
    expect(h.calls()).toBe(3);
  });

  test('strict API validates method/query/CSRF/body and GET performs no network request', async () => {
    const h = await harness();
    const session = new DashboardSessionV1('a'.repeat(43));
    const api = new MarketDataDashboardApiV1(h.service, session);
    const invoke = async (path: string, method = 'GET', body?: string, secure = false) => {
      const url = new URL(`http://127.0.0.1${path}`);
      const response = await api.handle(new Request(url, { method, body,
        headers: { host: '127.0.0.1', 'content-type': 'application/json',
          ...(secure ? { origin: 'http://127.0.0.1', 'x-dexter-csrf': session.csrfToken } : {}) } }), url, url.pathname.split('/').filter(Boolean));
      return response!;
    };
    expect((await invoke('/api/market-data/technical/7203/latest')).status).toBe(404);
    expect((await invoke('/api/market-data/technical/7203/latest?x=1')).status).toBe(400);
    expect((await invoke('/api/market-data/technical/7203/latest', 'POST', '{}')).status).toBe(405);
    expect((await invoke('/api/market-data/technical/jobs', 'POST', '{"ticker":"7203"}')).status).toBe(403);
    expect((await invoke('/api/market-data/technical/jobs', 'POST', '{"ticker":"7203","extra":true}', true)).status).toBe(400);
    expect((await invoke('/api/market-data/technical/jobs', 'POST', '{"ticker":"7203"}', true)).status).toBe(202);
    expect(h.calls()).toBe(0);
    const active = await h.service.activeJob();
    await h.service.cancelJob(active.marketJob!.jobId); h.start();
    await terminal(h.service, active.marketJob!.jobId);
  });
});
