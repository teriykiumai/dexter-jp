import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkspaceDatabase, supportedSqlite } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { fixtureCodecs, fixtureObject, fixtureWorkspace } from './test-fixtures.js';
import { migrateWorkspace } from './schema.js';
import { registerReferences } from './references.js';
import { objectKey, type WorkspaceScope } from './contracts.js';

type Fixture = Awaited<ReturnType<typeof fixtureWorkspace>>;
const fixtures: Fixture[] = [];
const connections: WorkspaceDatabase[] = [];
async function setup(): Promise<Fixture> { const f = await fixtureWorkspace(); fixtures.push(f); return f; }
afterEach(() => { connections.splice(0).forEach(db => db.close()); fixtures.splice(0).forEach(f => f.dispose()); });

describe('Workspace SQLite foundation', () => {
  test('creates a real WAL/FULL/FK database and restores committed Drawing/preferences on reopen', async () => {
    const f = await setup();
    expect(existsSync(resolve(f.root, 'workspace.sqlite'))).toBe(true);
    expect(supportedSqlite(f.db.sqliteVersion)).toBe(true);
    expect(f.db.sqlite.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(f.db.sqlite.query('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    expect(f.db.sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    const settings = { ...f.repository.preferences(f.instrumentId).value, volume: false };
    f.repository.savePreferences(f.instrumentId, settings, 1); f.db.close();
    const reopened = new WorkspaceDatabase(f.root); connections.push(reopened);
    const repo = new WorkspaceRepository(reopened);
    expect(repo.drawings(f.instrumentId)).toEqual([f.drawing]);
    expect(repo.preferences(f.instrumentId)).toEqual({ value: settings, revision: 2 });
    expect(repo.current(f.scope, 'technical')).toEqual(f.artifact);
  });
  test('keeps zero-query search read-only and isolates reused codes and revisions', async () => {
    const f = await setup(); expect(f.repository.search('トヨ')).toHaveLength(1);
    expect(f.db.sqlite.query('SELECT * FROM workspaces').all()).toHaveLength(0);
    expect(f.repository.search('%')).toHaveLength(0);
    f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    expect(() => f.repository.saveDrawing(f.drawing, 0)).toThrow('revision_conflict');
    f.repository.savePreferences(f.instrumentId, f.repository.preferences(f.instrumentId).value, 1);
    expect(() => f.repository.savePreferences(f.instrumentId, f.repository.preferences(f.instrumentId).value, 1)).toThrow('revision_conflict');
    const otherId = randomUUID(), evidence = fixtureObject(f.objectRoot, { kind: 'instrument-owned', instrumentId: otherId }, [f.master]);
    await registerReferences(f.db, f.objectRoot, [evidence], fixtureCodecs);
    await f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-11'), [{ ...f.row, instrumentId: otherId, label: '別銘柄', evidence }], f.master);
    expect(f.repository.search('7203')[0]?.instrumentId).toBe(otherId);
    expect(f.repository.drawings(otherId)).toEqual([]);
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: otherId }, 'technical')).toBeNull();
    expect(() => f.repository.bind(f.repository.freezeIdentity(otherId), f.artifact, f.receipt, 'technical')).toThrow('reference_conflict');
    expect(f.repository.drawings(f.instrumentId)).toEqual([f.drawing]);
  });
  test('rejects a mapping change between validation and binding; serializes a concurrent writer', async () => {
    const f = await setup(), frozen = f.repository.freezeIdentity(f.instrumentId);
    const nextArtifact = fixtureObject(f.objectRoot, f.scope), nextReceipt = fixtureObject(f.objectRoot, f.scope, [nextArtifact]);
    await registerReferences(f.db, f.objectRoot, [nextReceipt], fixtureCodecs);
    f.db.transaction(() => {
      expect(f.repository.identityMatches(frozen)).toBe(true);
      // Opening a second independent SQLite connection cannot write through our check/commit boundary.
      const second = new Database(f.db.path); second.exec('PRAGMA busy_timeout=0');
      try { expect(() => second.run("UPDATE catalog_rows SET label='late' WHERE instrument_id=?", [f.instrumentId])).toThrow(); }
      finally { second.close(); }
      f.repository.bind(frozen, f.artifact, f.receipt, 'technical');
    });
    await f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-11'), [{ ...f.row, code: '72031', mappingRevision: 2 }], f.master);
    expect(() => f.repository.bind(frozen, nextArtifact, nextReceipt, 'technical')).toThrow('identity_review_required');
    expect(f.db.sqlite.query('SELECT * FROM artifact_bindings').all()).toHaveLength(1);
    const committed = f.repository.bind(frozen, f.artifact, f.receipt, 'technical');
    f.repository.bind(f.repository.freezeIdentity(f.instrumentId), nextArtifact, nextReceipt, 'technical');
    expect(f.repository.bind(frozen, f.artifact, f.receipt, 'technical')).toBe(committed);
    expect(f.repository.current(f.scope, 'technical')).toEqual(nextArtifact);
  });
  test('late catalog completion and an older effective date cannot roll back current labels', async () => {
    const f = await setup();
    const older = f.repository.requestCatalog('2026-09-11'), newer = f.repository.requestCatalog('2026-09-11');
    expect(await f.repository.acceptCatalog(newer, [{ ...f.row, label: '最新' }], f.master)).toBe('active');
    expect(await f.repository.acceptCatalog(older, [{ ...f.row, label: '古い' }], f.master)).toBe('superseded');
    f.repository.failCatalog(f.repository.requestCatalog('2026-09-12'));
    const oldMaster = fixtureObject(f.objectRoot, { kind: 'market-scoped', universe: 'master', definitionVersion: 'v1' }, [], '2026-09-10');
    const oldEvidence = fixtureObject(f.objectRoot, f.scope, [oldMaster], '2026-09-10');
    await registerReferences(f.db, f.objectRoot, [oldEvidence], fixtureCodecs);
    expect(await f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-10'), [{ ...f.row, evidence: oldEvidence }], oldMaster)).toBe('superseded');
    expect(f.repository.search('7203')[0]?.label).toBe('最新');
  });
  test('recovery proves the original dataset and never associates an exact receipt with another dataset', async () => {
    const f = await setup();
    const original = f.repository.bind(f.identity, f.artifact, f.receipt, 'technical');
    expect(() => f.repository.bind(f.identity, f.artifact, f.receipt, 'fundamental')).toThrow('reference_conflict');
    expect(f.repository.current(f.scope, 'fundamental')).toBeNull();
    const artifact = fixtureObject(f.objectRoot, f.scope), receipt = fixtureObject(f.objectRoot, f.scope, [artifact]);
    await registerReferences(f.db, f.objectRoot, [receipt], fixtureCodecs);
    f.repository.bind(f.identity, artifact, receipt, 'technical');
    f.db.close();
    const db = new WorkspaceDatabase(f.root); connections.push(db); const repo = new WorkspaceRepository(db);
    expect(repo.bind(f.identity, f.artifact, f.receipt, 'technical')).toBe(original);
    expect(repo.current(f.scope, 'technical')).toEqual(artifact);
    expect(() => repo.bind(f.identity, f.artifact, f.receipt, 'fundamental')).toThrow('reference_conflict');
    expect(db.sqlite.query('SELECT dataset FROM artifact_bindings WHERE binding_id=?').get(original)).toEqual({ dataset: 'technical' });
  });
  test('failed migration and transaction preserve existing records and schema version', async () => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
    expect(() => migrateWorkspace(f.db.sqlite, [{ version: 1, sql: '' }, { version: 2,
      sql: 'CREATE TABLE should_rollback(x); DELETE FROM drawings; THIS IS INVALID SQL;' }])).toThrow();
    expect(f.db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(f.db.sqlite.query("SELECT name FROM sqlite_schema WHERE name='should_rollback'").all()).toEqual([]);
    expect(f.repository.drawings(f.instrumentId)).toEqual([f.drawing]);
    expect(() => f.db.transaction(() => { f.db.sqlite.run('DELETE FROM drawings'); throw new Error('abort'); })).toThrow('abort');
    expect(f.repository.drawings(f.instrumentId)).toEqual([f.drawing]);
    expect(() => f.db.sqlite.run('DELETE FROM instruments WHERE instrument_id=?', [f.instrumentId])).toThrow();
    expect(() => f.db.transaction(async () => 1)).toThrow('invalid_input');
  });
  test('rejects unknown schema and vulnerable SQLite versions', async () => {
    expect(supportedSqlite('3.51.2')).toBe(false); expect(supportedSqlite('3.51.3')).toBe(true);
    expect(supportedSqlite('3.50.7')).toBe(true); expect(supportedSqlite('unknown')).toBe(false);
    const f = await setup(); f.db.sqlite.exec('ALTER TABLE workspaces ADD COLUMN hidden_reference TEXT;'); f.db.close();
    expect(() => new WorkspaceDatabase(f.root)).toThrow('schema_unsupported');
  });
  test('shares sector context while preventing issuer-owned contamination', async () => {
    const f = await setup(); f.repository.openWorkspace(f.instrumentId);
    const b = randomUUID(); f.db.sqlite.run("INSERT INTO instruments VALUES (?,'stock')", [b]); f.repository.openWorkspace(b);
    const scope: WorkspaceScope = { kind: 'sector-scoped', provider: 'jquants', scheme: 'tse33', sectorCode: '3700', definitionVersion: 'v1' };
    const artifact = fixtureObject(f.objectRoot, scope), receipt = fixtureObject(f.objectRoot, scope, [artifact]);
    const am = fixtureObject(f.objectRoot, f.scope, [artifact]), bm = fixtureObject(f.objectRoot, { kind: 'instrument-owned', instrumentId: b }, [artifact]);
    await registerReferences(f.db, f.objectRoot, [receipt, am, bm], fixtureCodecs);
    const binding = f.repository.bindContext(scope, artifact, receipt, 'sector_short');
    expect(f.repository.bindContext(scope, artifact, receipt, 'sector_short')).toBe(binding);
    expect(() => f.repository.bindContext(scope, artifact, receipt, 'market_short')).toThrow('reference_conflict');
    expect(f.repository.current(scope, 'market_short')).toBeNull();
    const nextArtifact = fixtureObject(f.objectRoot, scope), nextReceipt = fixtureObject(f.objectRoot, scope, [nextArtifact]);
    await registerReferences(f.db, f.objectRoot, [nextReceipt], fixtureCodecs);
    f.repository.bindContext(scope, nextArtifact, nextReceipt, 'sector_short');
    expect(f.repository.bindContext(scope, artifact, receipt, 'sector_short')).toBe(binding);
    expect(f.repository.current(scope, 'sector_short')).toEqual(nextArtifact);
    f.repository.linkContext(f.instrumentId, 'sector_short', binding, am); f.repository.linkContext(b, 'sector_short', binding, bm);
    expect(f.db.sqlite.query('SELECT DISTINCT binding_id FROM shared_context_links').all()).toHaveLength(1);
    expect(() => f.repository.linkContext(b, 'sector_short', binding, am)).toThrow('reference_conflict');
    expect(() => f.repository.linkContext(f.instrumentId, 'market_short', binding, am)).toThrow('reference_conflict');
    expect(() => f.repository.saveDrawing({ ...f.drawing, id: randomUUID(), instrumentId: b }, 0)).toThrow('reference_conflict');
    expect(() => f.db.sqlite.run('UPDATE immutable_objects SET codec=? WHERE object_key=?', ['other', objectKey(artifact)])).toThrow();
  });
});
