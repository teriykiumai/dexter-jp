import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { referencePath } from '../analysis/workspace/references.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { WorkspaceViewSchema } from './workspace-contracts.js';
import { DrawingPageSchema, DrawingSavedSchema } from './drawing-contracts.js';
import { DashboardSessionV1 } from './session.js';
import { startDashboardServer } from './server.js';

test('ten-year Workspace and Drawing reads survive real HTTP reload/restart without relaxing verification', async () => {
  const f = await workspaceDataFixture(undefined, true), session = new DashboardSessionV1();
  const snapshots = { listLatest: async () => [], loadLatest: async () => { throw new Error('not found'); },
    listHistory: async () => [], loadHistory: async () => { throw new Error('not found'); } };
  let server: ReturnType<typeof startDashboardServer> | undefined;
  const open = (jobs: typeof f.jobs) => startDashboardServer(snapshots, 0, undefined, undefined, new WorkspaceDashboardApi(jobs, session));
  const call = async (path: string, body?: unknown) => {
    const url = new URL(`/api/workspace/${path}`, server!.url);
    return fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10_000),
      headers: { origin: url.origin, 'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken },
      body: body ? JSON.stringify(body) : undefined });
  };
  try {
    expect((await f.jobs.wait(await f.jobs.start('catalog'))).state).toBe('published');
    const id = f.repository.search('7203')[0]!.instrumentId; f.advance();
    expect((await f.jobs.wait(await f.jobs.start('technical', id))).state).toBe('published');
    const calls = f.calls(), ref = f.repository.current({ kind: 'instrument-owned', instrumentId: id }, 'technical')!;
    const path = referencePath(f.root, ref), bytes = readFileSync(path);
    expect(JSON.parse(bytes.toString()).source.dailyObservations.length).toBeGreaterThan(2400);
    server = open(f.jobs);
    const base = `instruments/${id}`, drawingPath = `${base}/drawings`;
    const read = async () => {
      const [viewResponse, pageResponse] = await Promise.all([call(base), call(drawingPath)]);
      expect(viewResponse.status).toBe(200); expect(pageResponse.status).toBe(200);
      return { view: WorkspaceViewSchema.parse(await viewResponse.json()), page: DrawingPageSchema.parse(await pageResponse.json()) };
    };
    const initial = await read();
    expect(initial.view.chart!.intervals.day).toHaveLength(1);
    expect(initial.page.items).toEqual([]);
    const drawingId = randomUUID();
    const saved = await call(drawingPath, { id: drawingId, revision: 0, price: 101.25,
      time: initial.view.chart!.dataDate, chartDigest: initial.view.chart!.artifactDigest });
    expect(saved.status).toBe(200);
    expect(DrawingSavedSchema.parse(await saved.json()).revision).toBe(1);
    expect((await read()).page.items).toMatchObject([{ id: drawingId, price: 101.25, state: 'compatible', revision: 1 }]);
    await server.stop(true); server = undefined;
    const restarted = await f.restart(); server = open(restarted.jobs);
    const restored = await read();
    expect(restored.view).toMatchObject({ item: { instrumentId: id }, chart: initial.view.chart });
    expect(restored.page.items).toMatchObject([{ id: drawingId, price: 101.25, state: 'compatible', revision: 1 }]);
    // A prior successful read must not hide changed archive bytes or switch to latest.
    writeFileSync(path, 'corrupt');
    for (const route of [base, drawingPath]) expect((await call(route)).status).toBe(500);
    writeFileSync(path, bytes);
    expect((await read()).page.items).toEqual(restored.page.items);
    expect(f.calls()).toBe(calls);
    restarted.db.close();
  } finally { await server?.stop(true); f.dispose(); }
}, 120_000);
