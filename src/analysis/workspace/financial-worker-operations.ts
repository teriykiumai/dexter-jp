import { resolve } from 'node:path';
import { WorkspaceRepository } from './repository.js';
import type { WorkspaceDatabase } from './database.js';
import { workspaceDataCodecs } from './data-objects.js';
import { resolveReference } from './references.js';
import { financialCodecs, validateFinancialLinks, FinancialPreparedSchema, financialArtifact } from './financial-objects.js';
import { WorkspaceFinancialCodec, financialTarget } from './financial-artifact.js';
import { digest, fail, parse } from './contracts.js';
import { safeDirectory } from './files.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { readWorkspaceFinancial } from '../../dashboard/workspace-financial.js';
import type { FinancialWorkerRequest } from './financial-worker-client.js';

export async function financialWorkerOperation(db: WorkspaceDatabase, r: FinancialWorkerRequest) {
  const get = (ref: Parameters<typeof resolveReference>[1]) => JSON.parse(new TextDecoder().decode(resolveReference(db, ref, workspaceDataCodecs).bytes));
  if (r.operation === 'build') {
    const codec = new WorkspaceFinancialCodec(financialTarget(r.input)); return codec.parse(codec.build(r.input, r.acceptedAt));
  }
  if (r.operation === 'validate') {
    const contentDigest = digest(r.bytes), validator = financialCodecs.get(r.codec) ?? fail('schema_unsupported');
    const object = { ref: { path: `${contentDigest.slice(7)}.json`, codec: r.codec, digest: contentDigest },
      metadata: validator(JSON.parse(r.bytes)), bytes: new TextEncoder().encode(r.bytes) };
    validateFinancialLinks(object, get); return object.metadata;
  }
  if (r.operation === 'prepared') {
    const object = resolveReference(db, r.reference, workspaceDataCodecs);
    const prepared = parse(FinancialPreparedSchema, JSON.parse(new TextDecoder().decode(object.bytes)));
    validateFinancialLinks(object, get); return { ...prepared, artifact: financialArtifact(prepared.artifact) };
  }
  if (r.operation === 'read') return readWorkspaceFinancial(new WorkspaceRepository(db), r.instrumentId);
  const codec = new WorkspaceFinancialCodec(financialTarget(r.artifact.input)); safeDirectory(r.artifactRoot, true);
  const repository = new MarketDataRepositoryV1(codec, resolve(r.artifactRoot, 'workspace-financial-v1'));
  const observed = r.operation === 'publish' ? await repository.publish(r.artifact,
    { jobId: r.jobId, acceptedAt: r.acceptedAt, checkedAt: r.checkedAt }) : await repository.findObservation(r.jobId, r.acceptedAt);
  return observed ? { artifact: observed.artifact, receipt: observed.receipt } : null;
}
