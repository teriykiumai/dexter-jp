import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { financialFixture, financialSourceFixture } from './financial-test-fixtures.js';
import { readWorkspaceFinancial } from '../../dashboard/workspace-financial.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { workspaceDataCodecs } from './data-objects.js';
import { validateReferences, rowRef, objectRow } from './references.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { finalizeWorkspaceFinancial } from './financial-jobs.js';
import { runFinancialWorker } from './financial-worker-client.js';
import type { StoredDrawing } from './contracts.js';

test('new catalog never adopts older financial history and restores the complete persistent reference closure', async () => {
  const f = await financialFixture();
  try {
    expect(readWorkspaceFinancial(f.repository, f.id).state).toBe('not_collected');
    const job = await f.jobs.wait(await f.jobs.start('financial', f.id)); expect(job.state).toBe('published');
    const view = readWorkspaceFinancial(f.repository, f.id), calls = f.calls();
    expect(view.state).toBe('unavailable'); expect(view.rows.find(row => row[0] === '売上高（円）')![1]).toContain('銘柄帰属を未確認');
    expect(view.projection?.forecastReference).toBeNull(); expect(f.calls()).toBe(calls);
    validateReferences(f.db, workspaceDataCodecs); f.db.close();
    const backup = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored);
    try { expect(readWorkspaceFinancial(new WorkspaceRepository(db), f.id)).toEqual(view); }
    finally { db.close(); }
  } finally { f.dispose(); }
}, 60_000);

test('eligible source financials keep payout, null and zero while daily-only correction changes the exact projection input', async () => {
  const f = await financialFixture(true);
  try {
    expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('published');
    const financial = f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'financial')!;
    f.advance();
    expect((await f.jobs.wait(await f.jobs.start('technical', f.id))).state).toBe('published');
    const before = readWorkspaceFinancial(f.repository, f.id), calls = f.calls();
    expect(before.rows).toContainEqual(['実績配当性向（2026-03-31）', '30%']);
    expect(before.rows).toContainEqual(['投資CF（円）', '-50']); expect(before.rows).toContainEqual(['会社予想年間配当（円/株）', '4']);
    expect(before.projection).toMatchObject({ state: 'unavailable', reason: 'price_basis_unverified', priceReference: { close: 105, date: '2026-09-11' } });
    expect(readWorkspaceFinancial(f.repository, f.id)).toEqual(before); expect(f.calls()).toBe(calls);
    f.advance(); let summaries = 0;
    f.setTransform((path, rows) => { if (path.endsWith('/summary')) summaries++;
      if (path.endsWith('/daily')) { const row = rows.at(-1)!; row.C = 106; row.AdjC = 106; } });
    expect((await f.jobs.wait(await f.jobs.start('technical', f.id))).state).toBe('published');
    const after = readWorkspaceFinancial(f.repository, f.id);
    expect(summaries).toBe(0); expect(after.projection?.forecastReference).toEqual(before.projection?.forecastReference);
    expect(after.projection?.priceReference?.artifact.digest).not.toBe(before.projection?.priceReference?.artifact.digest);
    expect(after.projection?.priceReference?.close).toBe(106); expect(after.projection?.reason).toBe('price_basis_unverified');
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'financial')).toEqual(financial);
    const restarted = await f.restart(); expect(readWorkspaceFinancial(restarted.repository, f.id)).toEqual(after);
  } finally { f.dispose(); }
}, 90_000);

test('binding and recovery use the frozen transaction predicate', async () => {
  let changed = false;
  const f = await financialFixture(false, async phase => { if (phase === 'before_binding' && !changed) {
    changed = true; f.db.sqlite.run('UPDATE catalog_rows SET mapping_revision=mapping_revision+1');
  } });
  try {
    const job = await f.jobs.wait(await f.jobs.start('financial', f.id)); expect(job.state).toBe('identity_review_required');
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'financial')).toBeNull();
    expect(job.result_object).not.toBeNull();
  } finally { f.dispose(); }
}, 60_000);

test.each([false, true])('ambiguous publication recovers without fetch; changed mapping=%s', async changed => {
  let crashed = false;
  const f = await financialFixture(false, async phase => { if (phase === 'after_publish' && !crashed) { crashed = true; throw new Error('crash'); } });
  try {
    const job = await f.jobs.wait(await f.jobs.start('financial', f.id)); expect(job.state).toBe('publishing');
    if (changed) f.db.sqlite.run('UPDATE catalog_rows SET mapping_revision=mapping_revision+1');
    const calls = f.calls(), restarted = await f.restart();
    expect(restarted.jobs.get(job.job_id).state).toBe(changed ? 'identity_review_required' : 'published'); expect(f.calls()).toBe(calls);
  } finally { f.dispose(); }
}, 60_000);

test('foreign rows and a later dated master cannot replace saved data; late completion cannot roll back a correction', async () => {
  const f = await financialFixture(true);
  try {
    const first = await f.jobs.wait(await f.jobs.start('financial', f.id)); expect(first.state).toBe('published');
    f.advance(); f.setTransform((path, rows) => { if (path.endsWith('/summary')) rows.push(financialSourceFixture({ PayoutRatioAnn: '-0.2', NxFDivAnn: '0' })); });
    expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('published');
    const corrected = readWorkspaceFinancial(f.repository, f.id);
    expect(corrected.rows).toContainEqual(['実績配当性向（2026-03-31）', '-20%']); expect(corrected.note).toContain('通常の範囲外');
    expect(corrected.rows).toContainEqual(['会社予想年間配当（円/株）', '0']);
    await finalizeWorkspaceFinancial(f.repository, f.artifacts, first); expect(readWorkspaceFinancial(f.repository, f.id)).toEqual(corrected);
    f.advance(); f.setTransform((path, rows) => { if (path.endsWith('/summary')) rows.push(financialSourceFixture({ Code: '67580' })); });
    expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('failed');
    expect(readWorkspaceFinancial(f.repository, f.id)).toEqual(corrected);
    f.advance(4 * 86_400_000);
    expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('identity_review_required');
    expect(readWorkspaceFinancial(f.repository, f.id)).toEqual(corrected);
  } finally { f.dispose(); }
}, 90_000);

test('financial acquisition and saved reads leave foreground Drawing saves and search responsive', async () => {
  const f = await financialFixture();
  try {
    f.setTransform((path, rows) => { if (path.endsWith('/summary')) rows.push(...Array.from({ length: 3000 }, (_, i) =>
      financialSourceFixture({ DiscNo: String(20260508000001 + i) }))); });
    const key = f.db.sqlite.query<{ evidence: string }, []>('SELECT evidence FROM catalog_rows').get()!.evidence;
    let drawing: StoredDrawing = { id: randomUUID(), instrumentId: f.id, kind: 'horizontal', price: 100,
      time: '2026-09-11', evidenceFrom: '2026-09-11', evidenceThrough: '2026-09-11', basisObject: rowRef(objectRow(f.db, key)), revision: 1 };
    f.repository.saveDrawing(drawing, 0);
    const loop: number[] = [], saves: number[] = [];
    async function foreground<T>(operation: Promise<T>) {
      let done = false; void operation.finally(() => { done = true; }).catch(() => {});
      while (!done) {
        let start = performance.now(); await Bun.sleep(10); loop.push(performance.now() - start);
        start = performance.now(); f.repository.search('7203'); f.repository.saveDrawing({ ...drawing, revision: drawing.revision + 1 }, drawing.revision);
        drawing = { ...drawing, revision: drawing.revision + 1 }; saves.push(performance.now() - start);
      }
      return operation;
    }
    expect((await foreground((async () => f.jobs.wait(await f.jobs.start('financial', f.id)))())).state).toBe('published');
    expect((await foreground(runFinancialWorker({ operation: 'read', root: f.root, instrumentId: f.id }))).state).toBe('unavailable');
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]!;
    console.info('Workspace financial responsiveness', JSON.stringify({ rows: 3000, samples: loop.length, eventLoopMax: Math.max(...loop), saveP95: p95(saves), saveMax: Math.max(...saves) }));
    expect(Math.max(...loop)).toBeLessThan(1000); expect(p95(saves)).toBeLessThan(250); expect(Math.max(...saves)).toBeLessThan(1000);
  } finally { f.dispose(); }
}, 120_000);
