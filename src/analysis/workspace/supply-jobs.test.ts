import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { workspaceDataCodecs } from './data-objects.js';
import { validateReferences } from './references.js';
import { readWorkspaceSupply } from '../../dashboard/workspace-supply.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import type { SupplyDataset } from './supply-artifact.js';
import { collectWorkspaceSupply } from './supply-source.js';
import { rowRef, objectRow } from './references.js';
import { WorkspaceSupplyCodec, supplyTarget } from './supply-artifact.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { randomUUID } from 'node:crypto';
import { safeDirectory } from './files.js';
import { finalizeWorkspaceSupply } from './supply-jobs.js';
import { type StoredDrawing } from './contracts.js';
import { runSupplyWorker } from './supply-worker-client.js';

test('large saved issuer input keeps Drawing saves and search responsive during acquisition and read', async () => {
  const f = await fixture();
  try {
    f.setTransform((path, data) => {
      rows(path, data);
      if (path.endsWith('/short-sale-report')) {
        const row = data[0]!;
        data.splice(0, data.length, ...Array.from({ length: 7000 }, (_, i) => ({ ...row, SSName: `Synthetic ${i}` })));
      }
    });
    const evidence = f.db.sqlite.query<{ evidence: string }, []>('SELECT evidence FROM catalog_rows').get()!.evidence;
    const drawing: StoredDrawing = { id: randomUUID(), instrumentId: f.id, kind: 'horizontal', price: 100,
      time: '2026-09-11', evidenceFrom: '2026-09-11', evidenceThrough: '2026-09-11',
      basisObject: rowRef(objectRow(f.db, evidence)), revision: 1 };
    f.repository.saveDrawing(drawing, 0);
    const loop: number[] = [], saves: number[] = [], searches: number[] = [];
    async function foreground<T>(operation: Promise<T>): Promise<T> {
      let done = false; void operation.then(() => { done = true; }, () => { done = true; });
      while (!done) {
        let start = performance.now(); await Bun.sleep(10); loop.push(performance.now() - start);
        start = performance.now(); f.repository.search('7203'); searches.push(performance.now() - start);
        start = performance.now(); f.repository.saveDrawing({ ...drawing, revision: drawing.revision + 1 }, drawing.revision);
        drawing.revision++; saves.push(performance.now() - start);
      }
      return operation;
    }
    expect((await foreground((async () => f.jobs.wait(await f.jobs.start('issuer_short', f.id)))())).state).toBe('published');
    const calls = f.calls();
    expect((await foreground(runSupplyWorker({ operation: 'read', root: f.root, instrumentId: f.id }))).datasets[1]!.rows).toHaveLength(7000);
    expect(f.calls()).toBe(calls);
    const stats = (values: number[]) => { values.sort((a, b) => a - b); return { samples: values.length,
      p95: values[Math.ceil(values.length * .95) - 1]!, max: values.at(-1)! }; };
    const report = { rows: 7000, eventLoop: stats(loop), saves: stats(saves), searches: stats(searches) };
    console.info('Workspace supply responsiveness', JSON.stringify(report));
    expect(report.eventLoop.max).toBeLessThan(1000);
    for (const value of [report.saves, report.searches]) { expect(value.p95).toBeLessThan(250); expect(value.max).toBeLessThan(1000); }
  } finally { f.dispose(); }
}, 120_000);

function rows(path: string, data: Record<string, unknown>[]) {
  if (path.endsWith('/master')) { data[0]!.S33 = '3700'; data[0]!.S33Nm = '輸送用機器'; }
  if (path.endsWith('/margin-interest')) data.splice(0, data.length, { Date: '2026-09-11', Code: '72030', LongVol: 1000, ShrtVol: 0 });
  if (path.endsWith('/short-sale-report')) data.splice(0, data.length, { DiscDate: '2026-09-11', CalcDate: '2026-09-11', Code: '72030',
    SSName: 'Synthetic Reporter', DICName: '', FundName: '', ShrtPosToSO: 0.0051, ShrtPosShares: 100,
    PrevRptDate: '-', PrevRptRatio: null });
  if (path.endsWith('/short-ratio')) data.splice(0, data.length, { Date: '2026-09-11', S33: '3700', SellExShortVa: 60, ShrtWithResVa: 30, ShrtNoResVa: 10 });
}
async function fixture(hook?: Parameters<typeof workspaceDataFixture>[0]) {
  const f = await workspaceDataFixture(hook); f.setTransform(rows);
  await f.jobs.wait(await f.jobs.start('catalog'));
  const id = f.repository.search('7203')[0]!.instrumentId;
  f.repository.openWorkspace(id); f.advance(3600_000);
  return { ...f, id };
}

test.each(['margin', 'issuer_short', 'sector_short'] as const)('%s collector and receipt codec integrate', async kind => {
  const f = await fixture();
  try {
    const identity = f.repository.freezeIdentity(f.id);
    const key = f.db.sqlite.query<{ evidence: string }, []>('SELECT evidence FROM catalog_rows').get()!.evidence;
    const acceptedAt = new Date(f.environment.wallNowMs()).toISOString();
    const prepared = await collectWorkspaceSupply(kind, identity, rowRef(objectRow(f.db, key)), f.repository, {
      jobId: randomUUID(), acceptedAt, signal: new AbortController().signal,
      dispatch: start => start(new AbortController().signal), shareSource: (_key, load) => load(),
      recordProgress: () => {}, waitBeforeRetry: async () => { throw new Error('no retries'); },
    }, f.environment);
    const codec = new WorkspaceSupplyCodec(supplyTarget(prepared.artifact.input));
    safeDirectory(f.artifacts, true);
    const observed = await new MarketDataRepositoryV1(codec, resolve(f.artifacts, 'workspace-supply-v1')).publish(prepared.artifact,
      { jobId: randomUUID(), acceptedAt, checkedAt: new Date(f.environment.wallNowMs()).toISOString() });
    expect(observed.receipt.artifactIdentity.scope).toBe('workspace');
  } finally { f.dispose(); }
}, 30_000);

test('three explicit datasets publish exact receipts and survive backup/restore without Drawing or AI', async () => {
  const f = await fixture();
  try {
    expect(readWorkspaceSupply(f.repository, f.id, true)?.datasets.every(value => value.state === 'not_collected')).toBe(true);
    for (const kind of ['margin', 'issuer_short', 'sector_short'] as SupplyDataset[]) {
      f.advance(); const job = await f.jobs.wait(await f.jobs.start(kind, f.id));
      expect(job.state).toBe('published');
    }
    const calls = f.calls(), view = readWorkspaceSupply(f.repository, f.id);
    expect(readWorkspaceSupply(f.repository, f.id, true)).toBeNull();
    expect(f.calls()).toBe(calls);
    expect(view.datasets.map(item => item.state)).toEqual(['available', 'available', 'available']);
    expect(view.datasets[0]!.rows).toContainEqual(['信用売残（株）', '0']);
    expect(view.datasets[0]!.rows).toContainEqual(['信用倍率（倍）', '利用不可（売残がゼロ）']);
    expect(view.datasets[1]!.rows[0]![5]).toBe('0.51%');
    expect(view.datasets[2]!.rows[0]).toEqual(['2026-09-11', '40', '100', '40%']);
    validateReferences(f.db, workspaceDataCodecs); f.db.close();
    const backup = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored);
    try { expect(readWorkspaceSupply(new WorkspaceRepository(db), f.id)).toEqual(view); }
    finally { db.close(); }
  } finally { f.dispose(); }
}, 30_000);

test.each(['margin', 'issuer_short', 'sector_short'] as const)('%s binding rechecks identity in its transaction', async kind => {
  const f = await fixture(async phase => { if (phase === 'before_binding') f.db.sqlite.run('UPDATE catalog_rows SET mapping_revision=mapping_revision+1'); });
  try {
    const job = await f.jobs.wait(await f.jobs.start(kind, f.id));
    expect(job.state).toBe('identity_review_required');
    expect(readWorkspaceSupply(f.repository, f.id).datasets.every(value => value.state === 'not_collected')).toBe(true);
  } finally { f.dispose(); }
}, 30_000);

test.each(['margin', 'issuer_short', 'sector_short'] as const)('%s ambiguous publication recovers without external replay', async kind => {
  let crashed = false;
  const f = await fixture(async phase => { if (phase === 'after_publish' && !crashed) { crashed = true; throw new Error('crash'); } });
  try {
    const job = await f.jobs.wait(await f.jobs.start(kind, f.id)); expect(job.state).toBe('publishing');
    const calls = f.calls(), restarted = await f.restart();
    expect(restarted.jobs.get(job.job_id).state).toBe('published'); expect(f.calls()).toBe(calls);
    validateReferences(restarted.db, workspaceDataCodecs);
  } finally { f.dispose(); }
}, 30_000);

test('foreign issuer rows fail without replacing a saved binding', async () => {
  const f = await fixture();
  try {
    expect((await f.jobs.wait(await f.jobs.start('issuer_short', f.id))).state).toBe('published');
    const before = readWorkspaceSupply(f.repository, f.id);
    f.setTransform((path, data) => { rows(path, data); if (path.endsWith('/short-sale-report')) data[0]!.Code = '67580'; });
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('issuer_short', f.id))).state).toBe('failed');
    expect(readWorkspaceSupply(f.repository, f.id)).toEqual(before);
  } finally { f.dispose(); }
}, 30_000);

test.each(['margin', 'sector_short'] as const)('%s delayed finalization cannot roll back current data', async kind => {
  const f = await fixture();
  try {
    const first = await f.jobs.wait(await f.jobs.start(kind, f.id));
    expect(first.state).toBe('published');
    f.advance(); f.setTransform((path, data) => {
      rows(path, data);
      if (path.endsWith('/margin-interest')) data[0]!.LongVol = 2000;
      if (path.endsWith('/short-ratio')) data[0]!.ShrtNoResVa = 20;
    });
    expect((await f.jobs.wait(await f.jobs.start(kind, f.id))).state).toBe('published');
    const current = readWorkspaceSupply(f.repository, f.id);
    await finalizeWorkspaceSupply(f.repository, f.artifacts, first);
    expect(readWorkspaceSupply(f.repository, f.id)).toEqual(current);
    validateReferences(f.db, workspaceDataCodecs);
  } finally { f.dispose(); }
}, 30_000);

test('weekly source expiry stops margin before dispatch while issuer and sector retain independent gates', async () => {
  const f = await fixture();
  try {
    f.advance(Date.parse('2026-09-28T00:00:00.000Z') - f.environment.wallNowMs());
    const before = f.calls();
    expect((await f.jobs.wait(await f.jobs.start('margin', f.id))).state).toBe('failed');
    expect(f.calls()).toBe(before);
    // Old catalog evidence must still prevent binding after the date advances.
    for (const kind of ['issuer_short', 'sector_short'] as const) {
      f.advance(); const calls = f.calls();
      expect((await f.jobs.wait(await f.jobs.start(kind, f.id))).state).toBe('identity_review_required');
      expect(f.calls()).toBeGreaterThan(calls);
    }
  } finally { f.dispose(); }
}, 30_000);

test('two dated members reuse one sector artifact while an issuer artifact stays with its owner', async () => {
  const f = await workspaceDataFixture();
  f.setTransform((path, data, url) => {
    rows(path, data);
    if (path.endsWith('/master')) {
      const other = { ...data[0], Code: '67580', CoName: 'Synthetic B' };
      if (url.searchParams.get('code') === '67580') data.splice(0, data.length, other);
      else if (!url.searchParams.has('code')) data.push(other);
    }
  });
  try {
    await f.jobs.wait(await f.jobs.start('catalog'));
    const a = f.repository.search('7203')[0]!.instrumentId, b = f.repository.search('6758')[0]!.instrumentId;
    f.advance(3600_000);
    for (const id of [a, b]) {
      f.advance(); expect((await f.jobs.wait(await f.jobs.start('sector_short', id))).state).toBe('published');
    }
    const av = readWorkspaceSupply(f.repository, a), bv = readWorkspaceSupply(f.repository, b);
    expect(av.datasets[2]!.artifactDigest).toBe(bv.datasets[2]!.artifactDigest);
    expect(f.db.sqlite.query("SELECT COUNT(DISTINCT artifact) AS n FROM artifact_bindings WHERE dataset='sector_short'").get()).toEqual({ n: 1 });
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('issuer_short', a))).state).toBe('published');
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('issuer_short', b))).state).toBe('failed');
    expect(readWorkspaceSupply(f.repository, b).datasets[1]!.state).toBe('not_collected');
    validateReferences(f.db, workspaceDataCodecs);
  } finally { f.dispose(); }
}, 30_000);
