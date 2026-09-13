import { resolve } from 'node:path';
import { writeExclusive } from '../analysis/workspace/files.js';
import { json } from '../analysis/workspace/contracts.js';
import { registerReferences } from '../analysis/workspace/references.js';
import { workspaceDataCodecs, retainWorkspaceObject } from '../analysis/workspace/data-objects.js';
import { readStep2aTechnicalFixture } from '../analysis/workspace/technical-test-fixtures.js';
import { WorkspaceTechnicalCodec } from '../analysis/workspace/technical-artifact.js';
import { MarketDataRepositoryV1 } from '../analysis/market-data/repository.js';
import { WorkspaceRepository } from '../analysis/workspace/repository.js';
import type { WorkspaceDatabase } from '../analysis/workspace/database.js';

// Frozen synthetic Step 2A evidence exercises multiple daily anchors. This does
// not relax the production dated-identity gate or claim live source continuity.
export async function seedTrendlineFixture(db: WorkspaceDatabase) {
  const fixture = readStep2aTechnicalFixture(), raw = fixture.artifact, identity = raw.input.identity;
  const repository = new WorkspaceRepository(db);
  if (repository.search('7203').length) return identity.instrumentId;
  const sourceRoot = resolve(db.root, 'imports');
  for (const object of fixture.objects) writeExclusive(resolve(sourceRoot, object.ref.path), json(object.value));
  await registerReferences(db, sourceRoot, fixture.objects.map(object => object.ref), workspaceDataCodecs);
  await repository.acceptCatalog(repository.requestCatalog(raw.input.queryTo), [{ instrumentId: identity.instrumentId,
    assetType: 'stock', provider: identity.provider, code: identity.code, label: raw.input.master.CoName,
    mappingRevision: identity.mappingRevision, episodeFrom: raw.input.eligibilityFrom, episodeThrough: null,
    evidence: raw.input.masterEvidence }], fixture.objects.find(object => object.ref.path === 'catalog-2026-09-11.json')!.ref);
  const published = await new MarketDataRepositoryV1(new WorkspaceTechnicalCodec('7203'), resolve(db.root, 'fixture-market')).publish(raw,
    { jobId: '00000000-0000-4000-8000-000000000002', acceptedAt: raw.asOfCutoff, checkedAt: raw.fetchedAt });
  const artifact = await retainWorkspaceObject(db, 'workspace_technical_v2', raw);
  const receipt = await retainWorkspaceObject(db, 'workspace_receipt_v1', { version: 'workspace_receipt_v1', identity,
    artifact, receipt: published.receipt });
  repository.bind(identity, artifact, receipt, 'technical'); repository.openWorkspace(identity.instrumentId);
  return identity.instrumentId;
}
