import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository, type CatalogRow } from './repository.js';
import { ObjectMetadataSchema, digest, json, type ObjectRef, type WorkspaceScope,
  type ReferenceCodecs, type StoredDrawing } from './contracts.js';
import { registerReferences } from './references.js';
import { writeExclusive } from './files.js';

const TestInputSchema = z.object({ schemaVersion: z.literal('workspace_test_input_v1'),
  value: z.number(), metadata: ObjectMetadataSchema }).strict();
export const fixtureCodecs: ReferenceCodecs = new Map([['workspace_test_input_v1', value => TestInputSchema.parse(value).metadata]]);
export function fixtureObject(root: string, scope: WorkspaceScope, dependencies: ObjectRef[] = [],
  effectiveDate = '2026-09-11'): ObjectRef {
  const body = json({ schemaVersion: 'workspace_test_input_v1', value: 100,
    metadata: { scope, effectiveDate, sourceDefinition: 'fixture_v1', calculationVersion: 'fixture_v1', dependencies } });
  const ref = { path: `${randomUUID()}.json`, codec: 'workspace_test_input_v1', digest: digest(body) };
  writeExclusive(resolve(root, ref.path), body); return ref;
}
export async function fixtureWorkspace() {
  const directory = mkdtempSync(resolve(tmpdir(), 'dexter-workspace-test-'));
  const root = resolve(directory, 'active'), objectRoot = resolve(directory, 'source');
  const db = new WorkspaceDatabase(root, { create: true }), repository = new WorkspaceRepository(db);
  const instrumentId = randomUUID(), scope: WorkspaceScope = { kind: 'instrument-owned', instrumentId };
  const master = fixtureObject(objectRoot, { kind: 'market-scoped', universe: 'master', definitionVersion: 'v1' });
  const evidence = fixtureObject(objectRoot, scope, [master]);
  const artifact = fixtureObject(objectRoot, scope), receipt = fixtureObject(objectRoot, scope, [artifact]);
  await registerReferences(db, objectRoot, [evidence, receipt], fixtureCodecs);
  const row: CatalogRow = { instrumentId, assetType: 'stock', provider: 'jquants', code: '72030', label: 'トヨタ',
    mappingRevision: 1, episodeFrom: '2026-01-01', episodeThrough: null, evidence };
  await repository.acceptCatalog(repository.requestCatalog('2026-09-11'), [row], master);
  const identity = repository.freezeIdentity(instrumentId);
  repository.bind(identity, artifact, receipt, 'technical');
  const drawing: StoredDrawing = { id: randomUUID(), instrumentId, kind: 'horizontal', price: 100, time: '2026-09-11',
    evidenceFrom: '2026-01-01', evidenceThrough: '2026-09-11', basisObject: artifact, revision: 1 };
  return { directory, root, objectRoot, db, repository, instrumentId, scope, master, evidence, artifact, receipt, row, identity, drawing,
    dispose() { db.close(); if (directory.startsWith(resolve(tmpdir(), 'dexter-workspace-test-'))) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } };
}
