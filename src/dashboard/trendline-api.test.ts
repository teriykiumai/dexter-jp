import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, DrawingHistoryResultSchema } from './drawing-contracts.js';
import { seedTrendlineFixture } from './drawing-test-fixtures.js';
import { drawingWork } from './drawing-worker.js';
import { backupWorkspace, restoreWorkspace } from '../analysis/workspace/backup.js';
import { workspaceDataCodecs } from '../analysis/workspace/data-objects.js';
import { referencePath } from '../analysis/workspace/references.js';
import { DrawingHistory } from './drawing-history.js';

test('Trendline CRUD and session undo/redo preserve exact basis and reject revision, identity and replay races', async () => {
  const f = await workspaceDataFixture(), session = new DashboardSessionV1();
  let historyState = '';
  let api = new WorkspaceDashboardApi(f.jobs, session);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/instruments/${path}`);
    const response = (await api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin,
      'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')))!;
    if (response.ok && method !== 'GET') { const body = await response.clone().json() as { historyState?: string; state?: string }; historyState = body.historyState ?? body.state ?? historyState; }
    return response;
  };
  try {
    const instrumentId = await seedTrendlineFixture(f.db), path = `${instrumentId}/drawings`;
    const page = DrawingPageSchema.parse(await (await call(path)).json()), id = randomUUID();
    const write = { id, revision: 0, chartDigest: page.chartDigest!, kind: 'trendline', price: 100, time: '2026-09-10', endTime: '2026-09-11', endPrice: 108 };
    for (const invalid of [{ ...write, endTime: write.time }, { ...write, endTime: '2026-09-06' }, { ...write, endPrice: 0 },
      { ...write, endTime: '2026-09-12' }, { ...write, basisObject: {} }]) expect((await call(path, 'POST', invalid)).status).toBe(400);
    const saved = DrawingSavedSchema.parse(await (await call(path, 'POST', write)).json());
    const original = f.repository.drawing(instrumentId, id)!;
    expect(original).toMatchObject({ kind: 'trendline', time: write.time, endTime: write.endTime });
    const endpoint = `${path}/${id}`;
    const history = (token: string, direction: 'undo' | 'redo', revision: number) => call(endpoint, 'POST', { token, direction, revision, state: historyState, chartDigest: write.chartDigest });
    const undoneCreate = DrawingHistoryResultSchema.parse(await (await history(saved.historyToken, 'undo', 1)).json());
    expect(undoneCreate.revision).toBe(0); expect(f.repository.drawing(instrumentId, id)).toBeNull();
    expect((await history(saved.historyToken, 'undo', 0)).status).toBe(409);
    const recreated = DrawingHistoryResultSchema.parse(await (await history(saved.historyToken, 'redo', 0)).json());
    expect(recreated.revision).toBe(2);
    expect(f.repository.drawing(instrumentId, id)).toEqual({ ...original, revision: 2 });
    const edit = DrawingSavedSchema.parse(await (await call(endpoint, 'PUT', { ...write, revision: 2, endPrice: 109 })).json());
    const competing = await Promise.all([history(edit.historyToken, 'undo', 3), history(edit.historyToken, 'undo', 3)]);
    expect(competing.map(r => r.status).sort()).toEqual([200, 409]);
    expect(f.repository.drawing(instrumentId, id)).toEqual({ ...original, revision: 4 });
    // A different tab's update is not overwritten by the old confirmed revision.
    expect((await call(endpoint, 'PUT', { ...write, revision: 4, price: 101 })).status).toBe(200);
    expect((await history(edit.historyToken, 'redo', 4)).status).toBe(409);
    expect(f.repository.drawing(instrumentId, id)!.price).toBe(101);
    expect((await call(`${randomUUID()}/drawings/${id}`, 'POST', { token: edit.historyToken, direction: 'redo', revision: 5, state: historyState, chartDigest: write.chartDigest })).status).toBe(409);
    const abaId = randomUUID(), aba = { ...write, id: abaId };
    const first = DrawingSavedSchema.parse(await (await call(path, 'POST', aba)).json());
    await call(path + '/' + abaId, 'DELETE', { revision: 1 });
    await call(path, 'POST', aba);
    expect((await call(path + '/' + abaId, 'POST', { token: first.historyToken, direction: 'undo',
      revision: 1, state: first.historyState, chartDigest: write.chartDigest })).status).toBe(409);
    expect(f.repository.drawing(instrumentId, abaId)!.revision).toBe(1);
    await call(path + '/' + abaId, 'DELETE', { revision: 1 });
    const removed = DrawingDeletedSchema.parse(await (await call(endpoint, 'DELETE', { revision: 5 })).json());
    const file = referencePath(f.root, original.basisObject), bytes = readFileSync(file);
    writeFileSync(file, 'corrupt');
    expect((await history(removed.historyToken, 'undo', 0)).status).toBe(500);
    expect(f.repository.drawing(instrumentId, id)).toBeNull(); writeFileSync(file, bytes);
    expect(DrawingHistoryResultSchema.parse(await (await history(removed.historyToken, 'undo', 0)).json()).revision).toBe(6);
    const restored = f.repository.drawing(instrumentId, id)!;
    expect(restored.basisObject).toEqual(original.basisObject);
    const finalPage = DrawingPageSchema.parse(await (await call(path)).json());
    expect(finalPage.items[0]).toMatchObject({ kind: 'trendline', state: 'compatible', endPrice: 108 });
    const calls = f.calls(), restarted = await f.restart(); api = new WorkspaceDashboardApi(restarted.jobs, session);
    expect((await history(removed.historyToken, 'redo', 6)).status).toBe(409);
    expect(DrawingPageSchema.parse(await (await call(path)).json())).toEqual(finalPage);
    restarted.db.close();
    backupWorkspace(f.root, `${f.directory}/backup`, workspaceDataCodecs);
    restoreWorkspace(`${f.directory}/backup`, `${f.directory}/restored`, workspaceDataCodecs);
    const result = drawingWork({ root: `${f.directory}/restored`, instrumentId });
    expect('page' in result && result.page).toEqual(finalPage); expect(f.calls()).toBe(calls);
  } finally { f.dispose(); }
}, 180_000);

test('session command inventory is bounded and owner scoped', () => {
  const history = new DrawingHistory(), owner = randomUUID(), id = randomUUID();
  const first = history.record(owner, id, null, null);
  for (let i = 0; i < 100; i++) history.record(owner, id, null, null);
  expect(() => history.get(first.historyToken, owner, id, 'undo')).toThrow('revision_conflict');
});
