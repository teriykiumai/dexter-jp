import { test, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { referencePath } from '../analysis/workspace/references.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import type { WorkspaceView, WorkspaceJobView } from './workspace-contracts.js';

test('Workspace guarded API: explicit catalog/EOD, read-only search/open URL, exact chart and corruption isolation', async () => {
  const f = await workspaceDataFixture(undefined, true), session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin, 'Content-Type': 'application/json',
      'X-Dexter-CSRF': session.csrfToken, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')) as Promise<Response>;
  };
  try {
    expect((await call('search?q=7203')).status).toBe(200); expect(f.calls()).toBe(0);
    const forbidden: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }, { 'X-Dexter-CSRF': 'invalid' }];
    for (const headers of forbidden)
      expect((await call('jobs', 'POST', { kind: 'catalog' }, headers)).status).toBe(403);
    expect((await call('jobs', 'POST', { kind: 'catalog', extra: true })).status).toBe(400);
    expect((await call('search?q=1&q=2')).status).toBe(400); expect(f.calls()).toBe(0);
    const catalog = await (await call('jobs', 'POST', { kind: 'catalog' })).json() as WorkspaceJobView;
    expect((await f.jobs.wait(catalog.id)).state).toBe('published');
    const id = f.repository.search('7203')[0]!.instrumentId;
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
