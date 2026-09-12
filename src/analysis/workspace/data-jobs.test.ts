import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { workspaceDataCodecs } from './data-objects.js';
import { resolveReference, validateReferences, rowRef, objectRow } from './references.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';

test('ordinary catalog -> frozen EOD -> exact binding -> backup/restore without Drawing or AI', async () => {
  const f = await workspaceDataFixture();
  try {
    expect((await f.jobs.wait(await f.jobs.start('catalog'))).state).toBe('published');
    const catalogKey = f.db.sqlite.query<{ evidence: string }, []>('SELECT evidence FROM catalog_generations WHERE state=\'active\'').get()!.evidence;
    const catalog = JSON.parse(new TextDecoder().decode(resolveReference(f.db, rowRef(objectRow(f.db, catalogKey)), workspaceDataCodecs).bytes));
    const corruptCalendar = structuredClone(catalog); corruptCalendar.calendar.pop();
    expect(() => workspaceDataCodecs.get('workspace_catalog_v1')!(corruptCalendar)).toThrow();
    const corruptDate = structuredClone(catalog); corruptDate.date = '2026-09-10';
    expect(() => workspaceDataCodecs.get('workspace_catalog_v1')!(corruptDate)).toThrow();
    const item = f.repository.search('7203')[0]!; expect(item).toBeDefined();
    f.repository.openWorkspace(item.instrumentId); f.advance();
    const job = await f.jobs.wait(await f.jobs.start('technical', item.instrumentId));
    expect(job.state).toBe('published'); expect(f.calls()).toBe(5);
    const scope = { kind: 'instrument-owned' as const, instrumentId: item.instrumentId };
    const ref = f.repository.current(scope, 'technical')!;
    const bytes = resolveReference(f.db, ref, workspaceDataCodecs).bytes;
    const artifact = JSON.parse(new TextDecoder().decode(bytes));
    expect(artifact.schemaVersion).toBe('technical_chart_dataset_v2');
    expect(artifact.result.dailyObservations).toHaveLength(1);
    expect(artifact.result.intervals.week[0].completion).toBe('ongoing');
    expect(artifact.result.intervals.week[0].rsi).toEqual({ state: 'unavailable', reason: 'partial_period' });
    const changed = structuredClone(artifact); changed.result.intervals.day[0].close = 999;
    expect(() => new WorkspaceTechnicalCodec('7203').parse(changed)).toThrow();
    validateReferences(f.db, workspaceDataCodecs); f.db.close();
    const backup = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored);
    try { expect(new WorkspaceRepository(db).current(scope, 'technical')).toEqual(ref);
      expect(resolveReference(db, ref, workspaceDataCodecs).bytes).toEqual(bytes); } finally { db.close(); }
  } finally { f.dispose(); }
}, 30_000);

test('mapping revision changed after publication cannot bind and recovery never fetches', async () => {
  let change = false;
  const f = await workspaceDataFixture(async phase => {
    if (phase === 'before_binding' && !change) {
      change = true; f.db.sqlite.run('UPDATE catalog_rows SET mapping_revision=mapping_revision+1');
    }
  });
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const item = f.repository.search('7203')[0]!; f.advance();
    const job = await f.jobs.wait(await f.jobs.start('technical', item.instrumentId));
    expect(job.state).toBe('identity_review_required'); expect(f.repository.current({ kind: 'instrument-owned', instrumentId: item.instrumentId }, 'technical')).toBeNull();
    const calls = f.calls(); await f.jobs.recover(job.job_id); expect(f.calls()).toBe(calls);
  } finally { f.dispose(); }
}, 30_000);

test('interruption after exact receipt publication finalizes on restart without another source request', async () => {
  let interrupted = false;
  const f = await workspaceDataFixture(async phase => { if (phase === 'after_publish' && !interrupted) { interrupted = true; throw new Error('crash checkpoint'); } });
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const item = f.repository.search('7203')[0]!; f.advance();
    const job = await f.jobs.wait(await f.jobs.start('technical', item.instrumentId)); expect(job.state).toBe('publishing');
    expect(() => validateReferences(f.db, workspaceDataCodecs)).toThrow();
    const calls = f.calls(), restarted = await f.restart();
    expect(restarted.jobs.get(job.job_id).state).toBe('published'); expect(f.calls()).toBe(calls);
    validateReferences(restarted.db, workspaceDataCodecs);
  } finally { f.dispose(); }
}, 30_000);

test('failed catalog and unproved dated continuity preserve accepted identities', async () => {
  const f = await workspaceDataFixture();
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const before = f.repository.search('7203');
    f.advance(3 * 86_400_000);
    const job = await f.jobs.wait(await f.jobs.start('catalog'));
    expect(job.state).toBe('identity_review_required'); expect(f.repository.search('7203')).toEqual(before);
    f.advance();
    const eod = await f.jobs.wait(await f.jobs.start('technical', before[0]!.instrumentId));
    expect(eod.state).toBe('identity_review_required');
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: before[0]!.instrumentId }, 'technical')).toBeNull();
  } finally { f.dispose(); }
});

test('shared coordinator rejects competing jobs; legacy status does not latch recovery; cancellation cannot publish', async () => {
  let ready!: () => void, resume!: () => void;
  const reached = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  const f = await workspaceDataFixture(async phase => { if (phase === 'before_publish') { ready(); await gate; } });
  try {
    await f.jobs.wait(await f.jobs.start('catalog')); const item = f.repository.search('7203')[0]!; f.advance();
    const id = await f.jobs.start('technical', item.instrumentId); await reached;
    let error: unknown; try { await f.market.activeJob(); } catch (e) { error = e; }
    expect(error).toMatchObject({ reason: 'active_job_conflict', activeKind: 'workspace_technical' });
    expect(() => f.coordinator.assertHealthy()).not.toThrow();
    error = undefined; try { await f.jobs.start('catalog'); } catch (e) { error = e; }
    expect(error).toMatchObject({ reason: 'active_job_conflict' });
    f.jobs.cancel(id); resume(); expect((await f.jobs.wait(id)).state).toBe('failed');
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: item.instrumentId }, 'technical')).toBeNull();
  } finally { resume(); for (const job of f.jobs.inventory()) await f.jobs.wait(job.job_id); f.dispose(); }
}, 30_000);

test.each([false, true])('writer contention: background=%s preserves the foreground wait bound', async backgroundWriter => {
  const f = await workspaceDataFixture();
  const program = `const { WorkspaceDatabase } = await import(${JSON.stringify(new URL('./database.ts', import.meta.url).href)});
    const db = new WorkspaceDatabase(${JSON.stringify(f.root)}, { backgroundWriter: ${backgroundWriter} });
    process.stdout.write('ready');
    try { db.transaction(() => db.sqlite.run("INSERT INTO workspace_meta VALUES ('contention_probe','committed')")); }
    catch (error) { process.stderr.write(String(error.code)); process.exitCode = 1; }
    finally { db.close(); }`;
  f.db.sqlite.exec('BEGIN IMMEDIATE');
  const child = Bun.spawn([process.execPath, '-e', program], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  try {
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('ready'); reader.releaseLock();
    await Bun.sleep(350);
    expect(f.db.sqlite.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 100 });
    f.db.sqlite.exec('COMMIT');
    expect(await child.exited).toBe(backgroundWriter ? 0 : 1);
    expect(await new Response(child.stderr).text()).toBe(backgroundWriter ? '' : 'SQLITE_BUSY');
    expect(f.db.sqlite.query("SELECT value FROM workspace_meta WHERE key='contention_probe'").get()).toEqual(backgroundWriter ? { value: 'committed' } : null);
  } finally {
    if (f.db.sqlite.inTransaction) f.db.sqlite.exec('ROLLBACK');
    child.kill(); await child.exited; f.dispose();
  }
}, 10_000);
