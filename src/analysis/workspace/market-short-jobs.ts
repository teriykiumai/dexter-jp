import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { digest, fail, json, objectKey } from './contracts.js';
import { workspaceDataCodecs } from './data-objects.js';
import { objectRow, rowRef, resolveReference, retainVerifiedObject } from './references.js';
import type { WorkspaceRepository } from './repository.js';
import type { WorkspaceDataJob } from './data-jobs.js';
import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { WorkspaceMarketShortCodecV2 } from './market-short-artifact-v2.js';
import { marketShortJobDate, validateMarketShortJob } from './market-short-job-contract.js';
import { marketShortCodecsV2 } from './market-short-objects-v2.js';

const codec = new WorkspaceMarketShortCodecV2();
function retain(repository: WorkspaceRepository, name: string, value: unknown) {
  const bytes = json(value), contentDigest = digest(bytes);
  const metadata = (marketShortCodecsV2.get(name) ?? fail('schema_unsupported'))(value);
  const ref = { path: `${contentDigest.slice(7)}.json`, codec: name, digest: contentDigest };
  retainVerifiedObject(repository.db, { ref, metadata, bytes: new TextEncoder().encode(bytes) });
  return ref;
}
function stored(repository: WorkspaceRepository, key: string) {
  const ref = rowRef(objectRow(repository.db, key));
  return { ref, value: JSON.parse(new TextDecoder().decode(resolveReference(repository.db, ref, workspaceDataCodecs).bytes)) as unknown };
}
function prepared(repository: WorkspaceRepository, job: WorkspaceDataJob) {
  if (job.state !== 'publishing') fail('reference_conflict');
  validateMarketShortJob(repository.db, job, key => stored(repository, key));
  const input = stored(repository, job.input_object ?? fail('reference_missing'));
  return { input: input.ref, artifact: codec.build(input.value, input.ref, job.accepted_at) };
}
export async function publishWorkspaceMarketShort(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob, checkedAt: string) {
  const p = prepared(repository, job);
  await new MarketDataRepositoryV1(codec, artifactRoot).publish(p.artifact,
    { jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt });
}
export async function finalizeWorkspaceMarketShort(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob,
  checkpoint?: () => Promise<void> | undefined) {
  const p = prepared(repository, job);
  const observed = await new MarketDataRepositoryV1(codec, artifactRoot).findObservation(job.job_id, job.accepted_at);
  if (!observed) {
    repository.db.transaction(() => repository.db.sqlite.run("UPDATE workspace_data_jobs SET state='interrupted' WHERE job_id=?", [job.job_id]));
    return;
  }
  if (!codec.equivalent(p.artifact, observed.artifact)) fail('reference_conflict');
  // A reused artifact retains its original input; this receipt additionally owns
  // the new job's exact observation input. Never replace either with latest.
  const artifact = retain(repository, observed.artifact.schemaVersion, observed.artifact);
  const receipt = retain(repository, 'workspace_market_short_receipt_v2',
    { version: 'workspace_market_short_receipt_v2', artifact, observationInput: p.input, receipt: observed.receipt });
  await checkpoint?.();
  repository.db.transaction(() => {
    const current = repository.db.sqlite.query<WorkspaceDataJob, [string]>('SELECT * FROM workspace_data_jobs WHERE job_id=?').get(job.job_id);
    if (!current || json(current) !== json(job) || current.state !== 'publishing') fail('reference_conflict');
    marketShortJobDate(repository.db, job);
    repository.bindContext(MARKET_SHORT_SCOPE_V1, artifact, receipt, 'market_short');
    repository.db.sqlite.run("UPDATE workspace_data_jobs SET state='published',result_object=?,error=NULL WHERE job_id=?", [objectKey(receipt), job.job_id]);
    validateMarketShortJob(repository.db, { ...job, state: 'published', result_object: objectKey(receipt) }, key => stored(repository, key));
  });
}

export function validateStoredMarketShortJob(repository: WorkspaceRepository, job: WorkspaceDataJob) {
  validateMarketShortJob(repository.db, job, key => stored(repository, key));
}
