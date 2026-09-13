import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { resolveReference } from './references.js';
import { workspaceDataCodecs } from './data-objects.js';
import { supplyPriceEvidence, WorkspaceSupplyCodec, supplyTarget } from './supply-artifact.js';
import { WorkspaceError, digest, fail, parse } from './contracts.js';
import { supplyCodecs, validateSupplyLinks, SupplyPreparedSchema, supplyArtifact } from './supply-objects.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { safeDirectory } from './files.js';
import { resolve } from 'node:path';
import { readWorkspaceSupply } from '../../dashboard/workspace-supply.js';
import type { SupplyWorkerRequest } from './supply-worker-client.js';

self.onmessage = async (event: MessageEvent<SupplyWorkerRequest>) => {
  let db: WorkspaceDatabase | undefined;
  try {
    const r = event.data; db = new WorkspaceDatabase(r.root, { readonly: true });
    let result: unknown = null;
    if (r.operation === 'validate') {
      const contentDigest = digest(r.bytes), validator = supplyCodecs.get(r.codec) ?? fail('schema_unsupported');
      const object = { ref: { path: `${contentDigest.slice(7)}.json`, codec: r.codec, digest: contentDigest },
        metadata: validator(JSON.parse(r.bytes)), bytes: new TextEncoder().encode(r.bytes) };
      validateSupplyLinks(object, ref => JSON.parse(new TextDecoder().decode(resolveReference(db!, ref, workspaceDataCodecs).bytes)));
      result = object.metadata;
    } else if (r.operation === 'build') {
      const codec = new WorkspaceSupplyCodec(supplyTarget(r.input));
      result = codec.parse(codec.build(r.input, r.acceptedAt));
    } else if (r.operation === 'prepared') {
      const object = resolveReference(db, r.reference, workspaceDataCodecs);
      const prepared = parse(SupplyPreparedSchema, JSON.parse(new TextDecoder().decode(object.bytes)));
      validateSupplyLinks(object, ref => JSON.parse(new TextDecoder().decode(resolveReference(db!, ref, workspaceDataCodecs).bytes)));
      result = { ...prepared, artifact: supplyArtifact(prepared.artifact) };
    } else if (r.operation === 'publish' || r.operation === 'recover') {
      const codec = new WorkspaceSupplyCodec(supplyTarget(r.artifact.input));
      safeDirectory(r.artifactRoot, true);
      const repository = new MarketDataRepositoryV1(codec, resolve(r.artifactRoot, 'workspace-supply-v1'));
      const observed = r.operation === 'publish' ? await repository.publish(r.artifact,
        { jobId: r.jobId, acceptedAt: r.acceptedAt, checkedAt: r.checkedAt }) : await repository.findObservation(r.jobId, r.acceptedAt);
      result = observed ? { artifact: observed.artifact, receipt: observed.receipt } : null;
    } else if (r.operation === 'read') result = readWorkspaceSupply(new WorkspaceRepository(db), r.instrumentId);
    else if (r.operation === 'price') result = supplyPriceEvidence(r.input,
      JSON.parse(new TextDecoder().decode(resolveReference(db, r.reference, workspaceDataCodecs).bytes)));
    db.close(); db = undefined; self.postMessage({ ok: true, result });
  } catch (error) {
    try { db?.close(); } finally { self.postMessage({ ok: false, result: null,
      code: error instanceof WorkspaceError ? error.code : 'reference_conflict' }); }
  }
};
