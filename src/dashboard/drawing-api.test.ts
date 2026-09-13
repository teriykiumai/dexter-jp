import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, DrawingHistoryResultSchema } from './drawing-contracts.js';
import { WorkspaceViewSchema } from './workspace-contracts.js';
import { backupWorkspace, restoreWorkspace } from '../analysis/workspace/backup.js';
import { workspaceDataCodecs } from '../analysis/workspace/data-objects.js';
import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { drawingWork } from './drawing-worker.js';
import { referencePath } from '../analysis/workspace/references.js';

test('Horizontal guarded CRUD retains exact basis, rejects stale writes and restores real-file state', async () => {
  const f = await workspaceDataFixture(), session = new DashboardSessionV1();
  let api = new WorkspaceDashboardApi(f.jobs, session);
  const call = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return (await api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin,
      'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')))!;
  };
  try {
    await f.jobs.wait(await f.jobs.start('catalog'));
    const instrumentId = f.repository.search('7203')[0]!.instrumentId;
    f.repository.openWorkspace(instrumentId); f.advance();
    await f.jobs.wait(await f.jobs.start('technical', instrumentId));
    const base = `instruments/${instrumentId}`, drawings = `${base}/drawings`;
    const chart = WorkspaceViewSchema.parse(await (await call(base)).json()).chart!;
    const write = { id: randomUUID(), revision: 0, chartDigest: chart.artifactDigest, price: 101.25, time: chart.dataDate };
    expect((await call(drawings)).status).toBe(200); // Warm the verified calculation proof.
    expect((await call(drawings, 'PATCH', write)).status).toBe(405);
    const forbidden: Record<string, string>[] = [{ host: 'evil.test' }, { origin: 'https://evil.test' }, { 'X-Dexter-CSRF': 'invalid' }];
    for (const headers of forbidden)
      expect((await call(drawings, 'POST', write, headers)).status).toBe(403);
    for (const body of [{ ...write, price: 0 }, { ...write, time: '2026-02-30' }, { ...write, basisObject: {} }, { ...write, revision: 1 }])
      expect((await call(drawings, 'POST', body)).status).toBe(400);
    expect((await call(`${drawings}?after=x`)).status).toBe(400);
    expect((await call(drawings, 'POST', { ...write, time: '2026-09-10' })).status).toBe(400);
    const saved = DrawingSavedSchema.parse(await (await call(drawings, 'POST', write)).json());
    expect(saved.revision).toBe(1);
    expect((await call(drawings, 'POST', write)).status).toBe(409);
    const original = f.repository.drawing(instrumentId, write.id)!;
    const concurrent = await Promise.all([call(`${drawings}/${write.id}`, 'PUT', { ...write, revision: 1, price: 102 }),
      call(`${drawings}/${write.id}`, 'PUT', { ...write, revision: 1, price: 103 })]);
    expect(concurrent.map(r => r.status).sort()).toEqual([200, 409]);
    expect(f.repository.drawing(instrumentId, write.id)!.basisObject).toEqual(original.basisObject);
    expect((await call(`instruments/${randomUUID()}/drawings/${write.id}`, 'DELETE', { revision: 2 })).status).toBe(409);
    const page = DrawingPageSchema.parse(await (await call(drawings)).json());
    expect(page.items[0]).toMatchObject({ state: 'compatible', revision: 2, instrumentId });
    expect(DrawingPageSchema.safeParse({ ...page, extra: true }).success).toBe(false);
    const file = referencePath(f.root, original.basisObject), bytes = readFileSync(file);
    writeFileSync(file, 'corrupt');
    expect((await call(`${drawings}/${write.id}`, 'PUT', { ...write, revision: 2, price: 999 })).status).toBe(500);
    writeFileSync(file, bytes);
    expect(f.repository.drawing(instrumentId, write.id)!.price).toBe(page.items[0]!.price);
    const catalog = f.db.sqlite.query<{ object_key: string; metadata: string }, []>(
      "SELECT object_key,metadata FROM immutable_objects WHERE codec='workspace_catalog_v1' LIMIT 1").get()!;
    expect(() => f.db.sqlite.run('UPDATE immutable_objects SET metadata=? WHERE object_key=?', ['{}', catalog.object_key])).toThrow('immutable');
    const calls = f.calls();
    const restarted = await f.restart(); api = new WorkspaceDashboardApi(restarted.jobs, session);
    expect(DrawingPageSchema.parse(await (await call(drawings)).json())).toEqual(page);
    expect(f.calls()).toBe(calls);
    restarted.db.close();
    const backup = `${f.directory}/backup`, restored = `${f.directory}/restored`;
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored);
    expect(new WorkspaceRepository(db).drawing(instrumentId, write.id)).toEqual({ ...original, price: page.items[0]!.price, revision: 2 });
    db.close();
    const projected = drawingWork({ root: restored, instrumentId });
    expect('page' in projected && projected.page).toEqual(page);
  } finally { f.dispose(); }
}, 120_000);

test('warm guarded Horizontal saves stay responsive during a ten-year EOD job', async () => {
  let pause = false, release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { reached = resolve; });
  const f = await workspaceDataFixture(async phase => { if (pause && phase === 'before_publish') { reached(); await gate; } }, true);
  const session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  const call = async (path: string, body?: unknown) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return (await api.handle(new Request(url, { method: body ? 'POST' : 'GET', headers: { host: url.host, origin: url.origin,
      'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken }, body: body ? JSON.stringify(body) : undefined }), url, url.pathname.slice(1).split('/')))!;
  };
  let job: string | undefined;
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const id = f.repository.search('7203')[0]!.instrumentId;
    f.advance(); await f.jobs.wait(await f.jobs.start('technical', id));
    const chart = WorkspaceViewSchema.parse(await (await call(`instruments/${id}`)).json()).chart!;
    expect((await call(`instruments/${id}/drawings`)).status).toBe(200);
    pause = true; f.advance(); job = await f.jobs.start('technical', id); await ready;
    const latencies: number[] = [], search: number[] = [];
    for (let index = 0; index < 20; index++) {
      const start = performance.now();
      const pending = call(`instruments/${id}/drawings`, { id: randomUUID(), revision: 0, price: 100 + index,
        time: chart.dataDate, chartDigest: chart.artifactDigest });
      const searchStart = performance.now(); await Bun.sleep(1);
      expect((await call('search?q=7203')).status).toBe(200); search.push(performance.now() - searchStart);
      expect((await pending).status).toBe(200); latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b); search.sort((a, b) => a - b);
    expect(latencies[18]!).toBeLessThan(250); expect(Math.max(...latencies)).toBeLessThan(1000);
    expect(search[18]!).toBeLessThan(250); expect(Math.max(...search)).toBeLessThan(1000);
    console.log('Horizontal API responsiveness', JSON.stringify({ platform: process.platform, cpu: cpus()[0]?.model,
      ramGiB: totalmem() / 1024 ** 3, bun: Bun.version, sqlite: f.db.sqliteVersion, sourceYears: 10, samples: latencies.length,
      saveP95: latencies[18], saveMax: latencies.at(-1), searchP95: search[18], searchMax: search.at(-1) }));
    release(); expect((await f.jobs.wait(job)).state).toBe('published');
  } finally { release(); if (job) await f.jobs.wait(job); f.dispose(); }
}, 180_000);

test('Horizontal refresh and worker-to-commit races fail closed without deleting user work', async () => {
  const f = await workspaceDataFixture(), session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return (await api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin,
      'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')))!;
  };
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const instrumentId = f.repository.search('7203')[0]!.instrumentId;
    f.advance(); await f.jobs.wait(await f.jobs.start('technical', instrumentId));
    const base = `instruments/${instrumentId}`, path = `${base}/drawings`;
    const initial = WorkspaceViewSchema.parse(await (await call(base)).json()).chart!;
    const write = { id: randomUUID(), revision: 0, chartDigest: initial.artifactDigest, price: 101, time: initial.dataDate };
    expect((await call(path, 'POST', write)).status).toBe(200);
    const drawing = f.repository.drawing(instrumentId, write.id)!;
    // Volume-only correction changes artifact identity but preserves price basis.
    f.setTransform((endpoint, rows) => { if (endpoint.endsWith('/daily')) for (const row of rows) { row.Vo = 2000; row.AdjVo = 2000; } });
    f.advance(); await f.jobs.wait(await f.jobs.start('technical', instrumentId));
    const volume = WorkspaceViewSchema.parse(await (await call(base)).json()).chart!;
    expect(volume.artifactDigest).not.toBe(initial.artifactDigest);
    expect(DrawingPageSchema.parse(await (await call(path)).json()).items[0]!.state).toBe('compatible');
    expect((await call(`${path}/${write.id}`, 'PUT', { ...write, revision: 1 })).status).toBe(409);
    // Remove current binding after worker validation, inside the commit transaction.
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = operation => transaction(() => { f.db.sqlite.run("DELETE FROM data_sync_state WHERE dataset='technical'"); return operation(); });
    expect((await call(`${path}/${write.id}`, 'PUT', { ...write, revision: 1, chartDigest: volume.artifactDigest })).status).toBe(409);
    f.db.transaction = transaction;
    expect(f.repository.drawing(instrumentId, write.id)).toEqual(drawing);
    const secondWrite = { ...write, id: randomUUID(), chartDigest: volume.artifactDigest };
    expect((await call(path, 'POST', secondWrite)).status).toBe(200);
    const secondDrawing = f.repository.drawing(instrumentId, secondWrite.id)!;
    const earlyDelete = DrawingDeletedSchema.parse(await (await call(path + '/' + secondWrite.id, 'DELETE', { revision: 1 })).json());
    // The failed transaction also rolls the competing pointer change back.
    f.setTransform((endpoint, rows) => { if (endpoint.endsWith('/daily')) for (const row of rows) row.AdjC = 106; });
    f.advance(); await f.jobs.wait(await f.jobs.start('technical', instrumentId));
    const correction = WorkspaceViewSchema.parse(await (await call(base)).json()).chart!;
    expect(DrawingPageSchema.parse(await (await call(path)).json()).items[0]!.state).toBe('basis_review_required');
    expect((await call(`${path}/${write.id}`, 'PUT', { ...write, revision: 1, chartDigest: correction.artifactDigest })).status).toBe(409);
    expect(f.repository.drawing(instrumentId, write.id)).toEqual(drawing);
    expect((await call(`${path}/${write.id}`, 'DELETE', { revision: 99 })).status).toBe(409);
    const removed = DrawingDeletedSchema.parse(await (await call(path + '/' + write.id, 'DELETE', { revision: 1 })).json());
    expect(f.repository.drawing(instrumentId, write.id)).toBeNull();
    // A valid current artifact must not mask corruption in the distinct historical basis.
    const historicalFile = referencePath(f.root, drawing.basisObject), historicalBytes = readFileSync(historicalFile);
    writeFileSync(historicalFile, 'corrupt');
    expect((await call(path + '/' + drawing.id, 'POST', { token: removed.historyToken, direction: 'undo',
      revision: 0, state: removed.historyState, chartDigest: correction.artifactDigest })).status).toBe(500);
    expect(f.repository.drawing(instrumentId, drawing.id)).toBeNull();
    writeFileSync(historicalFile, historicalBytes);
    for (const [record, command] of [[drawing, removed], [secondDrawing, earlyDelete]] as const) {
      const response = await call(path + '/' + record.id, 'POST', { token: command.historyToken, direction: 'undo',
        revision: 0, state: command.historyState, chartDigest: correction.artifactDigest });
      expect(response.status).toBe(200);
      const restored = DrawingHistoryResultSchema.parse(await response.json());
      expect(f.repository.drawing(instrumentId, record.id)).toEqual({ ...record, revision: restored.revision });
      expect(restored.revision).toBe(2);
    }
    expect(DrawingPageSchema.parse(await (await call(path)).json()).items.map(item => item.state))
      .toEqual(['basis_review_required', 'basis_review_required']);
  } finally { f.dispose(); }
}, 120_000);
