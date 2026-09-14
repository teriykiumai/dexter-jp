import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { MARKET_SHORT_SCOPE_V1, WorkspaceMarketShortCodec } from './market-short-artifact.js';
import { WorkspaceMarketShortCodecV2 } from './market-short-artifact-v2.js';
import { marketShortFixtureV2 } from './market-short-v2-test-fixtures.js';
import { digest, json, objectKey } from './contracts.js';
import { retainWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { registerReferences, resolveReference, validateReferences, referencePath } from './references.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { backupWorkspace, restoreWorkspace, validateWorkspaceBackup } from './backup.js';
import { fixtureCodecs, fixtureObject, fixtureWorkspace } from './test-fixtures.js';

const codec = new WorkspaceMarketShortCodecV2(), codecs = new Map([...fixtureCodecs, ...workspaceDataCodecs]);
const fixtures: Awaited<ReturnType<typeof fixtureWorkspace>>[] = [], opened: WorkspaceDatabase[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); fixtures.splice(0).forEach(f => f.dispose()); });
async function fixture() { const f = await fixtureWorkspace(); fixtures.push(f); return f; }
async function publish(f: Awaited<ReturnType<typeof fixture>>, input = marketShortFixtureV2()) {
  const inputRef = await retainWorkspaceObject(f.db, input.version, input);
  const repository = new MarketDataRepositoryV1(codec, resolve(f.directory, 'market-data'));
  const observed = await repository.publish(codec.build(input, inputRef, input.acceptedAt),
    { jobId: randomUUID(), acceptedAt: input.acceptedAt, checkedAt: input.source.fetchedAt });
  const artifact = await retainWorkspaceObject(f.db, observed.artifact.schemaVersion, observed.artifact);
  const value = { version: 'workspace_market_short_receipt_v2', artifact, observationInput: inputRef, receipt: observed.receipt };
  const receipt = await retainWorkspaceObject(f.db, value.version, value);
  return { inputRef, artifact, receipt, observed, repository, value };
}
test('qualified V2 content binds and recovers the exact result without rewinding to an old observation', async () => {
  const f = await fixture(), first = await publish(f);
  const id = f.repository.bindContext(MARKET_SHORT_SCOPE_V1, first.artifact, first.receipt, 'market_short');
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(first.artifact);
  const next = marketShortFixtureV2('2026-09-11', '2026-09-14T00:02:00.000Z'); next.rows[0]!.SellExShortVa!++;
  const corrected = await publish(f, next);
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, corrected.artifact, corrected.receipt, 'market_short');
  expect(f.repository.bindContext(MARKET_SHORT_SCOPE_V1, first.artifact, first.receipt, 'market_short')).toBe(id);
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(corrected.artifact);
  expect(resolveReference(f.db, first.artifact, codecs).ref).toEqual(first.artifact);
  expect(() => validateReferences(f.db, codecs)).not.toThrow();
});
test('same content reuses its artifact while each receipt retains its exact new qualified input', async () => {
  const f = await fixture(), first = await publish(f);
  const second = await publish(f, marketShortFixtureV2('2026-09-11', '2026-09-14T00:02:00.000Z'));
  expect(second.observed.state).toBe('idempotent_reuse');
  expect(second.observed.artifact.inputReference).toEqual(first.inputRef);
  expect(second.inputRef).not.toEqual(first.inputRef);
  expect(resolveReference(f.db, second.receipt, codecs).metadata.dependencies).toEqual([second.artifact, second.inputRef]);
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, second.artifact, second.receipt, 'market_short')).not.toThrow();
});
test('a delayed new binding cannot rewind current; equal-time conflicting content is rejected', async () => {
  const f = await fixture(), older = await publish(f);
  const input = marketShortFixtureV2('2026-09-11', '2026-09-14T00:02:00.000Z'); input.rows[0]!.SellExShortVa!++;
  const newer = await publish(f, input);
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, newer.artifact, newer.receipt, 'market_short');
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, older.artifact, older.receipt, 'market_short');
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(newer.artifact);
  input.rows[0]!.SellExShortVa!++; const conflict = await publish(f, input);
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, conflict.artifact, conflict.receipt, 'market_short')).toThrow('reference_conflict');
  expect(f.db.sqlite.query('SELECT * FROM artifact_bindings WHERE artifact=?').all(objectKey(conflict.artifact))).toHaveLength(0);
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(newer.artifact);
});
test('market binding is shareable by two Workspaces while their owned prices remain separate', async () => {
  const f = await fixture(), secondId = randomUUID(), secondScope = { kind: 'instrument-owned' as const, instrumentId: secondId };
  const secondEvidence = fixtureObject(f.objectRoot, secondScope, [f.master]);
  await registerReferences(f.db, f.objectRoot, [secondEvidence], codecs);
  await f.repository.acceptCatalog(f.repository.requestCatalog('2026-09-11'), [f.row,
    { ...f.row, instrumentId: secondId, code: '67580', evidence: secondEvidence }], f.master);
  const saved = await publish(f), id = f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short');
  for (const scope of [f.scope, secondScope]) {
    f.repository.openWorkspace(scope.instrumentId);
    const membership = fixtureObject(f.objectRoot, scope, [saved.artifact]);
    await registerReferences(f.db, f.objectRoot, [membership], codecs);
    f.repository.linkContext(scope.instrumentId, 'market_short', id, membership);
  }
  expect(f.db.sqlite.query<{ binding_id: string }, []>('SELECT binding_id FROM shared_context_links').all()).toEqual([{ binding_id: id }, { binding_id: id }]);
  expect(() => f.repository.bind(f.repository.freezeIdentity(secondId), f.artifact, f.receipt, 'technical')).toThrow();
  expect(f.repository.current(secondScope, 'technical')).toBeNull();
  expect(f.repository.current(f.scope, 'technical')).toEqual(f.artifact);
  expect(() => validateReferences(f.db, codecs)).not.toThrow();
});
test('aliases, sector scope, instrument scope and mixed receipt versions cannot qualify', async () => {
  const f = await fixture(), saved = await publish(f);
  for (const dataset of ['alias', 'market_short_ratio', 'technical'])
    expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, dataset)).toThrow('reference_conflict');
  expect(() => f.repository.bind(f.identity, saved.artifact, saved.receipt, 'market_short')).toThrow();
  expect(() => f.repository.bindContext({ kind: 'sector-scoped', provider: 'jquants', scheme: 's33', sectorCode: '0050', definitionVersion: 'v1' },
    saved.artifact, saved.receipt, 'market_short')).toThrow();
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, f.receipt, 'market_short')).toThrow();
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
});
test('V1 archive stays unverified and ineligible after V2 activation, with distinct content namespace', async () => {
  const f = await fixture(), source = marketShortFixtureV2();
  const old = { version: 'workspace_market_short_input_v1', scope: source.scope, registry: source.registry, registryDigest: source.registryDigest,
    date: source.date, sourceQualification: 'unverified', correctionVintage: source.correctionVintage, source: source.source, rows: source.rows };
  const oldInput = await retainWorkspaceObject(f.db, old.version, old), oldCodec = new WorkspaceMarketShortCodec();
  const oldArtifact = oldCodec.build(old, oldInput, source.acceptedAt);
  expect(() => workspaceDataCodecs.get('workspace_market_short_artifact_v2')!(oldArtifact)).toThrow();
  expect(() => workspaceDataCodecs.get('workspace_market_short_input_v2')!(old)).toThrow();
  const oldObserved = await new MarketDataRepositoryV1(oldCodec, resolve(f.directory, 'market-data')).publish(oldArtifact,
    { jobId: randomUUID(), acceptedAt: source.acceptedAt, checkedAt: source.source.fetchedAt });
  const artifact = await retainWorkspaceObject(f.db, oldArtifact.schemaVersion, oldArtifact);
  const receipt = await retainWorkspaceObject(f.db, 'workspace_market_short_receipt_v1', { version: 'workspace_market_short_receipt_v1', artifact, receipt: oldObserved.receipt });
  const saved = await publish(f); f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short');
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, artifact, receipt, 'market_short')).toThrow('reference_conflict');
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, artifact, saved.receipt, 'market_short')).toThrow('reference_conflict');
  expect(codec.identity(saved.observed.artifact).rootRelativeIdentity).not.toBe(oldCodec.identity(oldArtifact).rootRelativeIdentity);
  expect(new TextDecoder().decode(resolveReference(f.db, oldInput, codecs).bytes)).toBe(json(old));
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(saved.artifact);
});
test.each(['issuer_short', 'financial', 'technical', 'sector_short', 'catalog'])('market eligibility does not reject existing %s binding/read/recovery', async dataset => {
  const f = await fixture();
  const scope = dataset === 'sector_short' ? { kind: 'sector-scoped' as const, provider: 'jquants', scheme: 's33', sectorCode: '0050', definitionVersion: 'v1' }
    : dataset === 'catalog' ? { kind: 'market-scoped' as const, universe: 'master', definitionVersion: 'v1' } : f.scope;
  const artifact = fixtureObject(f.objectRoot, scope), receipt = fixtureObject(f.objectRoot, scope, [artifact]);
  await registerReferences(f.db, f.objectRoot, [receipt], codecs);
  const bind = (repository: WorkspaceRepository) => scope.kind === 'instrument-owned'
    ? repository.bind(f.identity, artifact, receipt, dataset) : repository.bindContext(scope, artifact, receipt, dataset);
  const id = bind(f.repository); expect(f.repository.current(scope, dataset)).toEqual(artifact);
  f.db.close(); const db = new WorkspaceDatabase(f.root); opened.push(db); const repository = new WorkspaceRepository(db);
  expect(bind(repository)).toBe(id); expect(repository.current(scope, dataset)).toEqual(artifact);
  expect(() => validateReferences(db, codecs)).not.toThrow();
});
test('input/receipt substitution cannot acquire qualification even with a valid outer receipt digest', async () => {
  const f = await fixture(), first = await publish(f);
  const source = marketShortFixtureV2('2026-09-11', '2026-09-14T00:02:00.000Z'), second = await publish(f, source);
  await expect(retainWorkspaceObject(f.db, second.value.version, { ...second.value, observationInput: first.inputRef })).rejects.toThrow();
  const { receiptDigest: _digest, ...preimage } = first.value.receipt;
  const changed = { ...preimage, acceptedAt: '2026-09-11T08:29:59.999Z' };
  await expect(retainWorkspaceObject(f.db, first.value.version, { ...first.value, receipt: { ...changed, receiptDigest: digest(json(changed)) } })).rejects.toThrow();
});
test('missing or changed input is rechecked at insert, recovery and current read, without repairing old references', async () => {
  const f = await fixture(), saved = await publish(f), path = referencePath(f.root, saved.inputRef);
  const bytes = readFileSync(path); unlinkSync(path);
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short')).toThrow('reference_missing');
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
  writeFileSync(path, bytes);
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short');
  writeFileSync(path, '{}');
  expect(() => f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short')).toThrow('reference_conflict');
  expect(() => f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toThrow('reference_conflict');
  expect(f.db.sqlite.query('SELECT * FROM artifact_bindings WHERE artifact=?').all(objectKey(saved.artifact))).toHaveLength(1);
});
test('no Drawing/AI backup restores market binding, current warnings and complete original/observed/corrected inputs offline', async () => {
  const f = await fixture(), first = await publish(f);
  const next = marketShortFixtureV2('2026-09-11', '2026-09-14T00:02:00.000Z'), second = await publish(f, next);
  next.rows[0]!.SellExShortVa!++; const corrected = await publish(f, next);
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, first.artifact, first.receipt, 'market_short');
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, corrected.artifact, corrected.receipt, 'market_short');
  const packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
  f.db.close(); backupWorkspace(f.root, packageRoot, codecs); restoreWorkspace(packageRoot, restored, codecs);
  const db = new WorkspaceDatabase(restored); opened.push(db); const repository = new WorkspaceRepository(db);
  expect(repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(corrected.artifact);
  expect(repository.current(f.scope, 'technical')).toEqual(f.artifact); expect(repository.freezeIdentity(f.instrumentId)).toEqual(f.identity);
  for (const saved of [first, second, corrected]) {
    unlinkSync(referencePath(f.root, saved.inputRef));
    const artifact = codec.parse(JSON.parse(new TextDecoder().decode(resolveReference(db, saved.artifact, codecs).bytes)));
    expect(artifact.qualification).toEqual(saved.observed.artifact.qualification);
    expect(resolveReference(db, saved.inputRef, codecs).ref).toEqual(saved.inputRef);
  }
  expect(db.sqlite.query('SELECT * FROM drawings').all()).toHaveLength(0);
  expect(db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(0);
});
test('restore with missing calendar/input closure preserves existing Drawings and exact current data', async () => {
  const f = await fixture(), saved = await publish(f);
  f.repository.openWorkspace(f.instrumentId); f.repository.saveDrawing(f.drawing, 0);
  f.repository.bindContext(MARKET_SHORT_SCOPE_V1, saved.artifact, saved.receipt, 'market_short');
  const packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
  f.db.close(); backupWorkspace(f.root, packageRoot, codecs); validateWorkspaceBackup(packageRoot, codecs);
  restoreWorkspace(packageRoot, restored, codecs); unlinkSync(referencePath(packageRoot, saved.inputRef));
  expect(() => restoreWorkspace(packageRoot, restored, codecs)).toThrow('reference_missing');
  const db = new WorkspaceDatabase(restored); opened.push(db); const repository = new WorkspaceRepository(db);
  expect(repository.drawings(f.instrumentId)).toEqual([f.drawing]);
  expect(repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(saved.artifact);
});
