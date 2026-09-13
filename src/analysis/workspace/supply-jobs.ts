import { workspaceDataCodecs } from './data-objects.js';
import { SupplyReceiptSchema } from './supply-objects.js';
import { WorkspaceSupplyCodec, supplyTarget } from './supply-artifact.js';
import { digest, json, objectKey, scopeKey, parse, fail, WorkspaceError, type ObjectRef } from './contracts.js';
import { resolveReference, objectRow, rowRef, retainVerifiedObject } from './references.js';
import type { WorkspaceRepository } from './repository.js';
import type { WorkspaceDataJob } from './data-jobs.js';
import { runSupplyWorker } from './supply-worker-client.js';

function read(repository: WorkspaceRepository, ref: ObjectRef): unknown {
  return JSON.parse(new TextDecoder().decode(resolveReference(repository.db, ref, workspaceDataCodecs).bytes));
}
export async function retainSupply(repository: WorkspaceRepository, codec: string, value: unknown): Promise<ObjectRef> {
  const bytes = json(value), contentDigest = digest(bytes);
  const ref = { path: `${contentDigest.slice(7)}.json`, codec, digest: contentDigest };
  const metadata = await runSupplyWorker({ operation: 'validate', root: repository.db.root, codec, bytes });
  const object = { ref, metadata, bytes: new TextEncoder().encode(bytes) };
  retainVerifiedObject(repository.db, object); return ref;
}
async function prepared(repository: WorkspaceRepository, job: WorkspaceDataJob) {
  if (!job.input_object) fail('reference_missing');
  const value = await runSupplyWorker({ operation: 'prepared', root: repository.db.root,
    reference: rowRef(objectRow(repository.db, job.input_object)) });
  if (json(value.identity) !== job.identity || objectKey(value.master) !== job.master_object) fail('reference_conflict');
  const artifact = value.artifact;
  if (artifact.input.dataset !== job.kind || artifact.asOfCutoff !== job.accepted_at) fail('reference_conflict');
  return { value, artifact, codec: new WorkspaceSupplyCodec(supplyTarget(artifact.input)) };
}
export async function publishWorkspaceSupply(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob, checkedAt: string) {
  const p = await prepared(repository, job);
  await runSupplyWorker({ operation: 'publish', root: repository.db.root, artifactRoot, artifact: p.artifact,
    jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt });
}
export async function finalizeWorkspaceSupply(repository: WorkspaceRepository, artifactRoot: string, job: WorkspaceDataJob,
  checkpoint?: () => Promise<void> | undefined) {
  const p = await prepared(repository, job);
  const observed = await runSupplyWorker({ operation: 'recover', root: repository.db.root, artifactRoot, artifact: p.artifact,
    jobId: job.job_id, acceptedAt: job.accepted_at, checkedAt: job.accepted_at });
  if (!observed) {
    repository.db.transaction(() => repository.db.sqlite.run("UPDATE workspace_data_jobs SET state='interrupted' WHERE job_id=?", [job.job_id])); return;
  }
  if (!p.codec.equivalent(observed.artifact, p.artifact)) fail('reference_conflict');
  const artifact = await retainSupply(repository, 'workspace_supply_artifact_v1', observed.artifact);
  const receipt = await retainSupply(repository, 'workspace_supply_receipt_v1', {
    version: 'workspace_supply_receipt_v1', artifact, receipt: observed.receipt });
  const membership = p.artifact.input.dataset === 'sector_short' ? await retainSupply(repository, 'workspace_supply_membership_v1',
    { version: 'workspace_supply_membership_v1', identity: p.value.identity, master: p.value.master,
      observation: p.value.observation, artifact, date: p.artifact.dataDate }) : null;
  await checkpoint?.();
  repository.db.transaction(() => {
    let state = 'published', error: string | null = null;
    try {
      if (!repository.identityMatches(p.value.identity) || repository.db.sqlite.query<{ evidence: string }, [number, string]>(
        'SELECT evidence FROM catalog_rows WHERE generation=? AND instrument_id=?').get(
        p.value.identity.catalogGeneration, p.value.identity.instrumentId)?.evidence !== job.master_object) fail('identity_review_required');
      const scope = scopeKey(p.artifact.input.scope);
      const old = repository.db.sqlite.query<{ binding_id: string; receipt: string }, [string, string]>(`SELECT b.binding_id,b.receipt
        FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset=?`).get(scope, job.kind);
      const oldLink = membership ? repository.db.sqlite.query<{ binding_id: string; receipt: string; membership: string }, [string, string]>(`SELECT b.binding_id,b.receipt,l.membership
        FROM shared_context_links l JOIN artifact_bindings b USING(binding_id) WHERE l.instrument_id=? AND l.role=?`).get(p.value.identity.instrumentId, job.kind) : null;
      const later = (previous: { receipt: string } | null) => {
        if (!previous) return false;
        const prior = parse(SupplyReceiptSchema, read(repository, rowRef(objectRow(repository.db, previous.receipt)))).receipt;
        if (prior.acceptedAt === observed.receipt.acceptedAt && prior.artifactIdentity.artifactDigest !== observed.receipt.artifactIdentity.artifactDigest) fail('reference_conflict');
        return prior.acceptedAt > observed.receipt.acceptedAt || prior.acceptedAt === observed.receipt.acceptedAt && prior.jobId < observed.receipt.jobId;
      };
      const keepCurrent = later(old), keepLink = later(oldLink);
      if (membership) {
        const binding = repository.bindContext(p.artifact.input.scope, artifact, receipt, job.kind);
        if (!keepLink) repository.linkContext(p.value.identity.instrumentId, job.kind, binding, membership);
      } else repository.bind(p.value.identity, artifact, receipt, job.kind);
      if (keepCurrent) repository.db.sqlite.run('UPDATE data_sync_state SET binding_id=? WHERE scope=? AND dataset=?', [old!.binding_id, scope, job.kind]);
    } catch (caught) {
      if (!(caught instanceof WorkspaceError) || caught.code !== 'identity_review_required') throw caught;
      state = 'identity_review_required'; error = caught.code;
    }
    repository.db.sqlite.run('UPDATE workspace_data_jobs SET state=?,result_object=?,error=? WHERE job_id=?',
      [state, objectKey(receipt), error, job.job_id]);
  });
}
