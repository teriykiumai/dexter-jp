import { test, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { referencePath } from '../analysis/workspace/references.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { WorkspaceResponseSchema, WorkspaceViewSchema, type WorkspaceView, type WorkspaceJobView } from './workspace-contracts.js';

test('Workspace guarded API: explicit catalog/EOD, read-only search/open URL, exact chart and corruption isolation', async () => {
  const f = await workspaceDataFixture(undefined, true), session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin, 'Content-Type': 'application/json',
      'X-Dexter-CSRF': session.csrfToken, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')) as Promise<Response>;
  };
  try {
    expect((await call('search?q=7203')).status).toBe(200); expect(f.calls()).toBe(0);
    for (const [path, method, allow] of [['jobs', 'GET', 'POST'], ['search', 'POST', 'GET'], ['session', 'DELETE', 'GET'],
      ['recents', 'PUT', 'GET'], ['jobs/active', 'POST', 'GET'], ['jobs/bad-id', 'POST', 'GET, DELETE'],
      ['instruments/bad-id', 'POST', 'GET'], ['instruments/bad-id/supply', 'POST', 'GET'], ['instruments/bad-id/open', 'GET', 'POST'], ['instruments/bad-id/favorite', 'DELETE', 'POST']]) {
      const refused = await call(`${path}?invalid=1`, method, undefined, { origin: 'https://evil.test', 'X-Dexter-CSRF': 'bad' });
      expect(refused.status).toBe(405); expect(refused.headers.get('Allow')).toBe(allow!);
      expect((await call(path!, method, undefined, { host: 'evil.test' })).status).toBe(403);
    }
    for (const path of ['search', 'recents', 'jobs/active', 'session'])
      expect(WorkspaceResponseSchema.safeParse(await (await call(path)).json()).success).toBe(true);
    const search = f.repository.search.bind(f.repository);
    f.repository.search = () => [{ instrumentId: 'invalid', code: '72030', label: 'Invalid producer' }];
    expect((await call('search')).status).toBe(500);
    f.repository.search = search;
    const forbidden: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }, { 'X-Dexter-CSRF': 'invalid' }];
    for (const headers of forbidden)
      expect((await call('jobs', 'POST', { kind: 'catalog' }, headers)).status).toBe(403);
    expect((await call('jobs', 'POST', { kind: 'catalog', extra: true })).status).toBe(400);
    expect((await call('search?q=1&q=2')).status).toBe(400); expect(f.calls()).toBe(0);
    const catalog = await (await call('jobs', 'POST', { kind: 'catalog' })).json() as WorkspaceJobView;
    expect((await f.jobs.wait(catalog.id)).state).toBe('published');
    const id = f.repository.search('7203')[0]!.instrumentId;
    const supplyCalls = f.calls();
    expect((await call(`instruments/${id}/supply?latest=1`)).status).toBe(400);
    expect((await call(`instruments/${id}/supply`, 'GET', undefined, { host: 'evil.test' })).status).toBe(403);
    expect(WorkspaceResponseSchema.safeParse(await (await call(`instruments/${id}/supply`)).json()).success).toBe(true);
    for (const kind of ['margin', 'issuer_short', 'sector_short'])
      expect((await call('jobs', 'POST', { kind, instrumentId: id }, { 'X-Dexter-CSRF': 'invalid' })).status).toBe(403);
    expect(f.calls()).toBe(supplyCalls);
    expect((await call(`instruments/${id}`)).status).toBe(200);
    expect(f.db.sqlite.query('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 0 });
    expect((await call(`instruments/${id}/open`, 'POST', {})).status).toBe(200);
    const uncollected = await (await call(`instruments/${id}`)).json() as WorkspaceView; expect(uncollected.chart).toBeNull();
    expect((await call(`instruments/${id}/favorite`, 'POST', { favorite: true, revision: uncollected.item.revision })).status).toBe(200);
    expect((await call(`instruments/${id}/favorite`, 'POST', { favorite: false, revision: uncollected.item.revision })).status).toBe(409);
    f.advance();
    const job = await (await call('jobs', 'POST', { kind: 'technical', instrumentId: id })).json() as WorkspaceJobView;
    expect((await f.jobs.wait(job.id)).state).toBe('published');
    const count = f.calls();
    let reading = true;
    const pendingView = call(`instruments/${id}`).finally(() => { reading = false; });
    const latencies: number[] = [];
    while (reading) {
      const start = performance.now(); await Bun.sleep(5);
      if ((await call('search?q=7203')).status !== 200) throw new Error('Search failed during chart read');
      latencies.push(performance.now() - start);
    }
    expect(latencies.length).toBeGreaterThan(0); expect(Math.max(...latencies)).toBeLessThan(1000);
    latencies.sort((a, b) => a - b);
    console.log('Workspace chart-read responsiveness', JSON.stringify({ platform: process.platform, cpu: cpus()[0]?.model,
      ramGiB: totalmem() / 1024 ** 3, bun: Bun.version, sqlite: f.db.sqliteVersion, inputYears: 10, repetitions: 1,
      samples: latencies.length, eventLoopAndSearchP95Ms: latencies[Math.floor(latencies.length * .95)], eventLoopAndSearchMaxMs: latencies.at(-1) }));
    const view = await (await pendingView).json() as WorkspaceView;
    expect(WorkspaceViewSchema.safeParse(view).success).toBe(true);
    expect(WorkspaceViewSchema.safeParse({ ...view, extra: true }).success).toBe(false);
    expect(WorkspaceViewSchema.safeParse({ ...view, schemaVersion: 'workspace_view_v2' }).success).toBe(false);
    expect(WorkspaceViewSchema.safeParse({ ...view, chart: { ...view.chart, schemaVersion: 'workspace_chart_v2' } }).success).toBe(false);
    expect(WorkspaceViewSchema.safeParse({ ...view, chart: { ...view.chart, extra: true } }).success).toBe(false);
    expect(WorkspaceViewSchema.safeParse({ ...view, chart: { ...view.chart, intervals: { ...view.chart!.intervals, day: [{ ...view.chart!.intervals.day[0], close: '105' }] } } }).success).toBe(false);
    expect((await call(`jobs/${job.id}`, 'DELETE')).status).toBe(409);
    f.db.sqlite.run("UPDATE workspace_data_jobs SET state='publishing' WHERE job_id=?", [job.id]);
    expect((await call(`jobs/${job.id}`, 'DELETE')).status).toBe(409);
    expect(f.jobs.get(job.id).state).toBe('publishing');
    f.db.sqlite.run("UPDATE workspace_data_jobs SET state='published' WHERE job_id=?", [job.id]);
    expect(view.item.instrumentId).toBe(id); expect(view.chart?.intervals.day).toHaveLength(1);
    expect(view.chart?.intervals.week[0]?.completion).toBe('ongoing'); expect(f.calls()).toBe(count);
    expect((await call('instruments/7203')).status).toBe(400);
    expect((await call('instruments/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const ref = f.repository.current({ kind: 'instrument-owned', instrumentId: id }, 'technical')!;
    writeFileSync(referencePath(f.root, ref), 'corrupt');
    expect((await call(`instruments/${id}`)).status).toBe(500); expect(f.calls()).toBe(count);
    expect((await call('search?q=7203')).status).toBe(200);
  } finally { f.dispose(); }
}, 120_000);

test('Workspace DELETE cancels a running source job, enforces mutation guards and never republishes', async () => {
  const f = await workspaceDataFixture(), session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const original = f.environment.fetch;
  const fetch: typeof original = async (...args) => { entered(); await gate; return original(...args); };
  Object.defineProperty(f.environment, 'fetch', { value: fetch });
  let id: string | undefined;
  const cancel = async (body?: string, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/jobs/${id}`);
    return (await api.handle(new Request(url, { method: 'DELETE', body,
      headers: { host: url.host, origin: url.origin, 'X-Dexter-CSRF': session.csrfToken, ...headers } }), url, url.pathname.slice(1).split('/')))!;
  };
  try {
    id = await f.jobs.start('catalog'); await started;
    expect(f.jobs.get(id).state).toBe('running');
    expect((await cancel(undefined, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await cancel(undefined, { 'X-Dexter-CSRF': 'bad' })).status).toBe(403);
    expect((await cancel('{}')).status).toBe(413);
    const result = await cancel(); expect(result.status).toBe(202);
    expect(WorkspaceResponseSchema.safeParse(await result.json()).success).toBe(true);
    release(); expect((await f.jobs.wait(id)).state).toBe('failed');
    expect(f.repository.search('')).toEqual([]); expect(f.calls()).toBe(1);
    expect((await cancel()).status).toBe(409);
    // Cancel after collection, while catalog registration is yielding.
    f.advance();
    let importing!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { importing = resolve; });
    const importingGate = new Promise<void>(resolve => { resume = resolve; });
    const accept = f.repository.acceptCatalog.bind(f.repository);
    f.repository.acceptCatalog = async (...args) => { importing(); await importingGate; return accept(...args); };
    id = await f.jobs.start('catalog');
    try {
      await reached;
      expect((await cancel()).status).toBe(202);
    } finally { resume(); }
    expect((await f.jobs.wait(id)).state).toBe('failed');
    expect(f.repository.search('')).toEqual([]);
  } finally { release(); if (id) await f.jobs.wait(id); f.dispose(); }
}, 30_000);
