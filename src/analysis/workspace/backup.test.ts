import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { backupWorkspace, recoverWorkspaceMaintenance, restoreWorkspace, validateWorkspaceBackup } from './backup.js';
import { fixtureCodecs, fixtureObject, fixtureWorkspace } from './test-fixtures.js';
import { registerReferences } from './references.js';
import { digest, json, objectKey, type ObjectRef } from './contracts.js';
import { readJson } from './files.js';

type Fixture = Awaited<ReturnType<typeof fixtureWorkspace>>;
const fixtures: Fixture[] = [], connections: WorkspaceDatabase[] = [];
async function setup(): Promise<Fixture> { const f = await fixtureWorkspace(); fixtures.push(f); return f; }
afterEach(() => { connections.splice(0).forEach(db => db.close()); fixtures.splice(0).forEach(f => f.dispose()); });
function reopen(root: string): WorkspaceRepository {
  const db = new WorkspaceDatabase(root); connections.push(db); return new WorkspaceRepository(db);
}
async function crash(f: Fixture, phase: 'before' | 'after'): Promise<void> {
  f.db.close();
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./crash-worker.ts', import.meta.url)), f.root, f.instrumentId, phase],
    { stdout: 'pipe', stderr: 'pipe' });
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Crash worker timed out')), 10_000);
    })]);
    if (new TextDecoder().decode(ready.value) !== 'ready') throw new Error(await new Response(child.stderr).text());
  } finally {
    clearTimeout(timer); child.kill('SIGKILL'); await child.exited; reader.releaseLock();
  }
}

describe('Workspace backup reference closure and crash recovery', () => {
  test('EOD-only Workspace without Drawings or AI restores binding/current data/instrument', async () => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    f.db.close(); backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    const manifest = validateWorkspaceBackup(packageRoot, fixtureCodecs);
    expect(manifest.roots.some(root => root.table === 'data_sync_state')).toBe(true);
    expect(manifest.roots.some(root => root.table === 'catalog_rows')).toBe(true);
    expect(manifest.objects).toHaveLength(4);
    restoreWorkspace(packageRoot, restored, fixtureCodecs);
    const repo = reopen(restored);
    expect(repo.current(f.scope, 'technical')).toEqual(f.artifact);
    expect(repo.freezeIdentity(f.instrumentId)).toEqual(f.identity);
    expect(repo.db.sqlite.query('SELECT * FROM drawings').all()).toHaveLength(0);
    expect(repo.db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(0);
  });
  test('includes prepared jobs, saved analysis and exact input dependencies without executing any job', async () => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    const input = fixtureObject(f.objectRoot, f.scope, [f.artifact]); registerReferences(f.db, f.objectRoot, [input], fixtureCodecs);
    f.db.sqlite.run("INSERT INTO analysis_jobs VALUES (?,?,?, ?,NULL,'prepared')", [randomUUID(), f.instrumentId, 'fundamental', objectKey(input)]);
    const result = fixtureObject(f.objectRoot, f.scope, [input]); registerReferences(f.db, f.objectRoot, [result], fixtureCodecs);
    f.db.sqlite.run("INSERT INTO analysis_jobs VALUES (?,?,?,?,?,'published')", [randomUUID(), f.instrumentId, 'supply_demand', objectKey(input), objectKey(result)]);
    const packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    f.db.close(); backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    const manifest = validateWorkspaceBackup(packageRoot, fixtureCodecs);
    expect(manifest.roots.some(root => root.table === 'analysis_jobs' && root.object === objectKey(input))).toBe(true);
    expect(manifest.roots.some(root => root.table === 'analysis_jobs' && root.object === objectKey(result))).toBe(true);
    restoreWorkspace(packageRoot, restored, fixtureCodecs);
    const repo = reopen(restored);
    expect(repo.drawings(f.instrumentId)).toEqual([f.drawing]);
    expect(repo.db.sqlite.query('SELECT state FROM analysis_jobs ORDER BY state').all()).toEqual([{ state: 'prepared' }, { state: 'published' }]);
  });
  test.each(['before', 'after'] as const)('process kill %s commit has atomic Drawing/preference recovery', async phase => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    await crash(f, phase);
    expect(existsSync(`${f.db.path}-wal`)).toBe(true);
    const repo = reopen(f.root);
    expect(repo.drawings(f.instrumentId)[0]?.price).toBe(phase === 'after' ? 321 : 100);
    expect(repo.preferences(f.instrumentId).value.volume).toBe(phase !== 'after');
  });
  test('backs up a committed write still in WAL after a killed process', async () => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    await crash(f, 'after');
    expect(readFileSync(`${f.db.path}-wal`).length).toBeGreaterThan(0);
    const packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    restoreWorkspace(packageRoot, restored, fixtureCodecs);
    expect(reopen(restored).drawings(f.instrumentId)[0]?.price).toBe(321);
  });
  test('refuses live managed connections and leaves source intact on missing dependency', async () => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup');
    expect(() => backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs)).toThrow('maintenance_required');
    f.db.close(); unlinkSync(resolve(f.objectRoot, f.artifact.path));
    expect(() => backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs)).toThrow('reference_missing');
    expect(existsSync(resolve(packageRoot, 'manifest.json'))).toBe(false);
    expect(reopen(f.root).current(f.scope, 'technical')).toEqual(f.artifact);
  });
  test.each(['missing', 'corrupt', 'manifest', 'codec', 'wal'] as const)('rejects %s package before modifying destination', async mode => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup'); f.db.close();
    backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    const previousBytes = readFileSync(f.db.path), object = resolve(packageRoot, 'objects', f.artifact.path);
    if (mode === 'missing') unlinkSync(object);
    if (mode === 'corrupt') writeFileSync(object, '{}');
    if (mode === 'wal') writeFileSync(resolve(packageRoot, 'workspace.sqlite-wal'), 'unexpected sidecar');
    if (mode === 'manifest') {
      const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'manifest.json'), 'utf8'));
      manifest.roots = []; writeFileSync(resolve(packageRoot, 'manifest.json'), json(manifest));
    }
    expect(() => restoreWorkspace(packageRoot, f.root, mode === 'codec' ? new Map() : fixtureCodecs)).toThrow();
    expect(readFileSync(f.db.path)).toEqual(previousBytes);
    expect(existsSync(`${f.root}.maintenance.json`)).toBe(false);
  });
  test.each(['owner', 'hidden_reference', 'schema'] as const)('refuses backup with %s corruption without modifying source', async mode => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    if (mode === 'owner') f.db.sqlite.run("UPDATE drawings SET anchors=json_set(anchors,'$.instrumentId',?)", [randomUUID()]);
    if (mode === 'hidden_reference') f.db.sqlite.run("UPDATE drawings SET anchors=json_set(anchors,'$.basisObject',json(?))", [json(f.receipt)]);
    if (mode === 'schema') f.db.sqlite.exec('ALTER TABLE workspaces ADD COLUMN hidden_reference TEXT');
    f.db.close(); const original = readFileSync(f.db.path), packageRoot = resolve(f.directory, 'backup');
    expect(() => backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs)).toThrow();
    expect(readFileSync(f.db.path)).toEqual(original);
    expect(existsSync(resolve(packageRoot, 'manifest.json'))).toBe(false);
  });
  test('rejects overlapping installation/package paths', async () => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup'); f.db.close();
    expect(() => backupWorkspace(f.root, f.objectRoot, resolve(f.root, 'nested'), fixtureCodecs)).toThrow('storage_unsafe');
    backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    expect(() => restoreWorkspace(packageRoot, packageRoot, fixtureCodecs)).toThrow('storage_unsafe');
    expect(() => restoreWorkspace(packageRoot, f.directory, fixtureCodecs)).toThrow('storage_unsafe');
  });
  test.each(['started', 'staged', 'previous_preserved', 'installed'] as const)('recovers interrupted restore at %s without mixing installations', async phase => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup');
    f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0); f.db.close();
    backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    expect(() => restoreWorkspace(packageRoot, f.root, fixtureCodecs, point => {
      if (point === phase) throw new Error('simulated interruption');
    })).toThrow('simulated interruption');
    expect(() => new WorkspaceDatabase(f.root, { create: true })).toThrow('maintenance_required');
    recoverWorkspaceMaintenance(f.root, fixtureCodecs);
    expect(reopen(f.root).drawings(f.instrumentId)).toEqual([f.drawing]);
  });
  test('incomplete first restore permits an explicit retry and never activates partial staging', async () => {
    const f = await setup(), packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'new-installation');
    f.db.close(); backupWorkspace(f.root, f.objectRoot, packageRoot, fixtureCodecs);
    expect(() => restoreWorkspace(packageRoot, restored, fixtureCodecs, phase => {
      if (phase !== 'staged') return;
      const marker = readJson(`${restored}.maintenance.json`) as { stage: string };
      unlinkSync(resolve(f.directory, marker.stage, 'manifest.json'));
      throw new Error('interrupted before complete staging');
    })).toThrow('interrupted before complete staging');
    expect(recoverWorkspaceMaintenance(restored, fixtureCodecs)).toBe('retry_restore');
    expect(existsSync(restored)).toBe(false);
    restoreWorkspace(packageRoot, restored, fixtureCodecs);
    expect(reopen(restored).current(f.scope, 'technical')).toEqual(f.artifact);
  });
  test('rejects cross-owner dependency, traversal, unknown fields and symlink storage', async () => {
    const f = await setup();
    const other = fixtureObject(f.objectRoot, { kind: 'instrument-owned', instrumentId: randomUUID() }, [f.artifact]);
    expect(() => registerReferences(f.db, f.objectRoot, [other], fixtureCodecs)).toThrow('reference_conflict');
    expect(() => registerReferences(f.db, f.objectRoot, [{ ...f.artifact, path: '../escape.json' }], fixtureCodecs)).toThrow('invalid_input');
    const bad = { ...readJson(resolve(f.objectRoot, f.artifact.path)) as object, unknown: 'field' };
    const body = json(bad), ref: ObjectRef = { ...f.artifact, path: `${randomUUID()}.json`, digest: digest(body) };
    writeFileSync(resolve(f.objectRoot, ref.path), body);
    expect(() => registerReferences(f.db, f.objectRoot, [ref], fixtureCodecs)).toThrow();
    const link = resolve(f.directory, 'link'); symlinkSync(f.root, link, 'junction');
    expect(() => new WorkspaceDatabase(link)).toThrow('storage_unsafe');
    unlinkSync(link);
  });
});
