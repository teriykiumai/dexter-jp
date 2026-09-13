import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, DrawingHistoryResultSchema } from './drawing-contracts.js';
import { referencePath, referenceRoots } from '../analysis/workspace/references.js';
import { backupWorkspace, restoreWorkspace } from '../analysis/workspace/backup.js';
import { workspaceDataCodecs } from '../analysis/workspace/data-objects.js';
import { drawingWork } from './drawing-worker.js';

test('explicit basis acceptance preserves original evidence, rejects corruption/races and survives undo, restart and backup', async () => {
  const f = await workspaceDataFixture(), session = new DashboardSessionV1();
  const api = new WorkspaceDashboardApi(f.jobs, session);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const url = new URL('http://127.0.0.1:3000/api/workspace/instruments/' + path);
    return (await api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin,
      'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')))!;
  };
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const owner = f.repository.search('7203')[0]!.instrumentId;
    f.advance(); await f.jobs.wait(await f.jobs.start('technical', owner));
    const path = owner + '/drawings', id = crypto.randomUUID(), endpoint = path + '/' + id;
    const initial = DrawingPageSchema.parse(await (await call(path)).json());
    expect((await call(path, 'POST', { id, revision: 0, chartDigest: initial.chartDigest, time: '2026-09-11', price: 100 })).status).toBe(200);
    const original = f.repository.drawing(owner, id)!;
    f.setTransform((endpoint, rows) => { if (endpoint.endsWith('/daily')) for (const row of rows) { row.AdjC = 106; row.AdjFactor = 0.5; } });
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('technical', owner))).state).toBe('published');
    const corrected = DrawingPageSchema.parse(await (await call(path)).json());
    expect(corrected.items[0]!.state).toBe('basis_review_required');
    const accept = { action: 'accept_basis', revision: 1, chartDigest: corrected.chartDigest, confirm: true };
    expect((await call(endpoint, 'POST', { ...accept, confirm: false })).status).toBe(400);
    expect((await call(endpoint, 'POST', { ...accept, chartDigest: initial.chartDigest })).status).toBe(409);
    expect((await call(crypto.randomUUID() + '/drawings/' + id, 'POST', accept)).status).toBe(409);
    const file = referencePath(f.root, original.basisObject), bytes = readFileSync(file);
    writeFileSync(file, 'corrupt');
    expect((await call(endpoint, 'POST', accept)).status).toBe(500);
    writeFileSync(file, bytes);
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = operation => transaction(() => { f.db.sqlite.run("DELETE FROM data_sync_state WHERE dataset='technical'"); return operation(); });
    expect((await call(endpoint, 'POST', accept)).status).toBe(409);
    f.db.transaction = transaction;
    const responses = await Promise.all([call(endpoint, 'POST', accept), call(endpoint, 'POST', accept)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const saved = DrawingSavedSchema.parse(await responses.find(response => response.ok)!.json());
    const accepted = f.repository.drawing(owner, id)!;
    expect(accepted).toEqual({ ...original, revision: 2, acceptedBasis: { object: accepted.acceptedBasis!.object, revision: 2 } });
    expect(accepted.acceptedBasis!.object.digest).not.toBe(original.basisObject.digest);
    expect(DrawingPageSchema.parse(await (await call(path)).json()).items[0]!.state).toBe('compatible');
    const undone = DrawingHistoryResultSchema.parse(await (await call(endpoint, 'POST', { token: saved.historyToken,
      direction: 'undo', revision: 2, state: saved.historyState, chartDigest: corrected.chartDigest })).json());
    expect(f.repository.drawing(owner, id)).toEqual({ ...original, revision: 3 });
    expect(DrawingPageSchema.parse(await (await call(path)).json()).items[0]!.state).toBe('basis_review_required');
    await call(endpoint, 'POST', { token: saved.historyToken, direction: 'redo', revision: 3, state: undone.state, chartDigest: corrected.chartDigest });
    const removed = DrawingDeletedSchema.parse(await (await call(endpoint, 'DELETE', { revision: 4 })).json());
    expect((await call(endpoint, 'POST', { token: removed.historyToken, direction: 'undo', revision: 0,
      state: removed.historyState, chartDigest: corrected.chartDigest })).status).toBe(200);
    expect(f.repository.drawing(owner, id)).toEqual({ ...accepted, revision: 5 });
    expect(referenceRoots(f.db).filter(root => root.table === 'drawings').map(root => root.field).sort()).toEqual(['acceptedBasis', 'basis_object']);
    f.setTransform((endpoint, rows) => { if (endpoint.endsWith('/daily')) for (const row of rows) { row.AdjC = 107; row.AdjFactor = 0.5; } });
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('technical', owner))).state).toBe('published');
    const final = DrawingPageSchema.parse(await (await call(path)).json()), calls = f.calls();
    expect(final.items[0]!.state).toBe('basis_review_required');
    const acceptedFile = referencePath(f.root, accepted.acceptedBasis!.object), acceptedBytes = readFileSync(acceptedFile);
    writeFileSync(acceptedFile, 'corrupt');
    expect((await call(endpoint, 'POST', { ...accept, revision: 5, chartDigest: final.chartDigest })).status).toBe(500);
    writeFileSync(acceptedFile, acceptedBytes);
    f.db.close();
    backupWorkspace(f.root, f.directory + '/backup', workspaceDataCodecs);
    restoreWorkspace(f.directory + '/backup', f.directory + '/restored', workspaceDataCodecs);
    const result = drawingWork({ root: f.directory + '/restored', instrumentId: owner });
    expect('page' in result && result.page).toEqual(final); expect(f.calls()).toBe(calls);
  } finally { f.dispose(); }
}, 180_000);
