import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readStep2aTechnicalFixture } from './technical-test-fixtures.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { retainWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { registerReferences, resolveReference } from './references.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { writeExclusive } from './files.js';
import { json } from './contracts.js';
import { projectWorkspaceChart } from '../../dashboard/workspace-chart.js';

test('frozen Step 2A V2 bytes survive exact read, re-observation and backup/restore', async () => {
  const fixture = readStep2aTechnicalFixture(), raw = fixture.artifact, codec = new WorkspaceTechnicalCodec('7203');
  expect(fixture.sourceCommit).toBe('9066a2bef1c041b25494c2614b68387b36350d3f');
  const savedBytes = json(raw);
  expect(json(codec.parse(raw))).toBe(savedBytes);
  expect(raw.sourcePayloadDigest).toBe('sha256:83b1ef5fdfd351f235df6ae03f4c2de30c3f07bf84eccbb196b9e95c3a875ce8');
  expect(raw.artifactDigest).toBe('sha256:81bfc081d6445e2844ba715333a36550d582945a03fde9c187f72955fdbab383');
  for (const interval of ['week', 'month'] as const) {
    const complete = raw.result.intervals[interval].filter(row => !row.partial);
    const index = complete.findIndex(row => row.sourceGaps.includes('2025-03-12'));
    expect(index).toBeGreaterThan(34);
    for (const field of ['sma20', 'rsi', 'macd', 'signal', 'histogram', 'cross'] as const)
      expect(complete[index]![field].state).toBe('available');
  }
  const directory = mkdtempSync(resolve(tmpdir(), 'dexter-workspace-v2-compat-'));
  let db: WorkspaceDatabase | undefined;
  try {
    const root = resolve(directory, 'workspace'), sourceRoot = resolve(directory, 'inputs'), marketRoot = resolve(directory, 'market');
    const path = resolve(marketRoot, codec.identity(raw).rootRelativeIdentity);
    writeExclusive(path, savedBytes);
    const candidate = codec.build(raw.source, raw.input);
    expect(json(candidate)).toBe(savedBytes);
    const observed = await new MarketDataRepositoryV1(codec, marketRoot).publish(candidate, {
      jobId: '00000000-0000-4000-8000-000000000002', acceptedAt: raw.asOfCutoff, checkedAt: raw.fetchedAt,
    });
    expect(observed.state).toBe('idempotent_reuse');
    expect(readFileSync(path, 'utf8')).toBe(savedBytes);
    db = new WorkspaceDatabase(root, { create: true });
    for (const object of fixture.objects) writeExclusive(resolve(sourceRoot, object.ref.path), json(object.value));
    await registerReferences(db, sourceRoot, fixture.objects.map(object => object.ref), workspaceDataCodecs);
    const repository = new WorkspaceRepository(db), identity = raw.input.identity;
    const scope = { kind: 'instrument-owned' as const, instrumentId: identity.instrumentId };
    const catalog = fixture.objects.find(object => object.ref.path === 'catalog-2026-09-11.json')!.ref;
    await repository.acceptCatalog(repository.requestCatalog(raw.input.queryTo), [{ instrumentId: identity.instrumentId,
      assetType: 'stock', provider: identity.provider, code: identity.code, label: raw.input.master.CoName,
      mappingRevision: identity.mappingRevision, episodeFrom: raw.input.eligibilityFrom, episodeThrough: null, evidence: raw.input.masterEvidence }], catalog);
    const artifactRef = await retainWorkspaceObject(db, 'workspace_technical_v2', raw);
    const receiptRef = await retainWorkspaceObject(db, 'workspace_receipt_v1', { version: 'workspace_receipt_v1',
      identity, artifact: artifactRef, receipt: observed.receipt });
    repository.bind(identity, artifactRef, receiptRef, 'technical');
    repository.openWorkspace(identity.instrumentId);
    db.close(); db = undefined;
    const backup = resolve(directory, 'backup'), restored = resolve(directory, 'restored');
    backupWorkspace(root, backup, workspaceDataCodecs);
    restoreWorkspace(backup, restored, workspaceDataCodecs);
    db = new WorkspaceDatabase(restored);
    expect(new WorkspaceRepository(db).current(scope, 'technical')).toEqual(artifactRef);
    const restoredBytes = new TextDecoder().decode(resolveReference(db, artifactRef, workspaceDataCodecs).bytes);
    expect(restoredBytes).toBe(savedBytes);
    const chart = projectWorkspaceChart(codec.parse(JSON.parse(restoredBytes)));
    for (const interval of ['week', 'month'] as const) {
      const gap = chart.intervals[interval].find(row => row.sourceGaps.includes('2025-03-12'))!;
      expect(gap.rsi).toEqual({ state: 'unavailable', reason: 'source_gap' });
      expect(raw.result.intervals[interval].find(row => row.identity === gap.identity)!.rsi.state).toBe('available');
    }
    expect(json(raw)).toBe(savedBytes);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
}, 120_000);
