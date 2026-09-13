import { digest, json, objectKey, scopeKey, parse, fail, WorkspaceError, type ObjectRef } from './contracts.js';
import { resolveReference, objectRow, rowRef, retainVerifiedObject } from './references.js';
import { workspaceDataCodecs } from './data-objects.js';
import { FinancialReceiptSchema } from './financial-objects.js';
import { WorkspaceFinancialCodec, financialTarget } from './financial-artifact.js';
import { runFinancialWorker } from './financial-worker-client.js';
import type { WorkspaceRepository } from './repository.js';
import type { WorkspaceDataJob } from './data-jobs.js';

async function prepared(repository: WorkspaceRepository, job: WorkspaceDataJob) {
  if (job.kind !== 'financial' || !job.input_object) fail('reference_conflict');
  const p = await runFinancialWorker({ operation: 'prepared', root: repository.db.root,
    reference: rowRef(objectRow(repository.db, job.input_object)) });
  if (json(p.identity) !== job.identity || objectKey(p.master) !== job.master_object || p.artifact.asOfCutoff !== job.accepted_at) fail('reference_conflict');
  return p;
}
export async function publishWorkspaceFinancial(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob, checkedAt: string) {
  const p = await prepared(repository, job);
  await runFinancialWorker({ operation: 'publish', root: repository.db.root, artifactRoot, artifact: p.artifact,
    jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt });
}
async function retain(repository: WorkspaceRepository, codec: string, value: unknown): Promise<ObjectRef> {
  const bytes = json(value), contentDigest = digest(bytes), ref = { path: `${contentDigest.slice(7)}.json`, codec, digest: contentDigest };
  const metadata = await runFinancialWorker({ operation: 'validate', root: repository.db.root, codec, bytes });
  retainVerifiedObject(repository.db, { ref, metadata, bytes: new TextEncoder().encode(bytes) }); return ref;
}
export async function finalizeWorkspaceFinancial(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob,
  checkpoint?: () => Promise<void> | undefined) {
  const p = await prepared(repository, job);
  const observed = await runFinancialWorker({ operation: 'recover', root: repository.db.root, artifactRoot, artifact: p.artifact,
    jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt: job.accepted_at });
  if (!observed) {
    repository.db.transaction(() => repository.db.sqlite.run("UPDATE workspace_data_jobs SET state='interrupted' WHERE job_id=?", [job.job_id])); return;
  }
  if (!new WorkspaceFinancialCodec(financialTarget(p.artifact.input)).equivalent(observed.artifact, p.artifact)) fail('reference_conflict');
  const artifact = await retain(repository, 'workspace_financial_artifact_v1', observed.artifact);
  const receipt = await retain(repository, 'workspace_financial_receipt_v1', { version: 'workspace_financial_receipt_v1', artifact, receipt: observed.receipt });
  await checkpoint?.();
  repository.db.transaction(() => {
    let state = 'published', error: string | null = null;
    try {
      if (!repository.identityMatches(p.identity) || repository.db.sqlite.query<{ evidence: string }, [number, string]>(
        'SELECT evidence FROM catalog_rows WHERE generation=? AND instrument_id=?').get(
        p.identity.catalogGeneration, p.identity.instrumentId)?.evidence !== job.master_object) fail('identity_review_required');
      const scope = scopeKey({ kind: 'instrument-owned', instrumentId: p.identity.instrumentId });
      const previous = repository.db.sqlite.query<{ binding_id: string; receipt: string }, [string]>(`SELECT b.binding_id,b.receipt
        FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset='financial'`).get(scope);
      const prior = previous ? parse(FinancialReceiptSchema, JSON.parse(new TextDecoder().decode(resolveReference(repository.db,
        rowRef(objectRow(repository.db, previous.receipt)), workspaceDataCodecs).bytes))).receipt : null;
      if (prior && prior.acceptedAt === observed.receipt.acceptedAt && prior.artifactIdentity.artifactDigest !== observed.receipt.artifactIdentity.artifactDigest) fail('reference_conflict');
      const keep = prior && (prior.acceptedAt > observed.receipt.acceptedAt || prior.acceptedAt === observed.receipt.acceptedAt && prior.jobId < observed.receipt.jobId);
      repository.bind(p.identity, artifact, receipt, 'financial');
      if (keep) repository.db.sqlite.run("UPDATE data_sync_state SET binding_id=? WHERE scope=? AND dataset='financial'", [previous!.binding_id, scope]);
    } catch (caught) {
      if (!(caught instanceof WorkspaceError) || caught.code !== 'identity_review_required') throw caught;
      state = 'identity_review_required'; error = caught.code;
    }
    repository.db.sqlite.run('UPDATE workspace_data_jobs SET state=?,result_object=?,error=? WHERE job_id=?', [state, objectKey(receipt), error, job.job_id]);
  });
}
