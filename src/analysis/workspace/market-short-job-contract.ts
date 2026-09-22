import { fail, json, objectKey, parse, scopeKey, type ObjectRef } from './contracts.js';
import type { WorkspaceDatabase } from './database.js';
import type { WorkspaceDataJob } from './data-jobs.js';
import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { marketShortAdmissionV2, marketShortInputV2 } from './market-short-policy-v2.js';
import { MarketShortReceiptSchemaV2, requireMarketShortBindingV2 } from './market-short-objects-v2.js';

type Job = Pick<WorkspaceDataJob, 'job_id' | 'kind' | 'state' | 'accepted_at' | 'identity' | 'master_object' | 'generation' | 'input_object' | 'result_object'>;

/** Schema 6 freezes the date separately so legacy job rows retain their shape. */
export function marketShortJobDate(db: WorkspaceDatabase, job: Job): string {
  if (job.kind !== 'market_short' || job.identity !== null || job.master_object !== null || job.generation !== null) fail('reference_conflict');
  const request = db.sqlite.query<{ requested_date: string }, [string]>(
    'SELECT requested_date FROM workspace_market_short_requests WHERE job_id=?').get(job.job_id) ?? fail('reference_missing');
  marketShortAdmissionV2(request.requested_date, job.accepted_at);
  return request.requested_date;
}

/** Same exact admission/input/receipt predicate for live jobs and offline backup. */
export function validateMarketShortJob(db: WorkspaceDatabase, job: Job,
  get: (key: string) => { ref: ObjectRef; value: unknown }): void {
  const date = marketShortJobDate(db, job);
  if (job.state === 'identity_review_required') fail('reference_conflict');
  if (job.input_object) {
    const stored = get(job.input_object), input = marketShortInputV2(stored.value);
    if (objectKey(stored.ref) !== job.input_object || stored.ref.codec !== 'workspace_market_short_input_v2'
      || input.date !== date || input.acceptedAt !== job.accepted_at) fail('reference_conflict');
  }
  if (job.result_object) {
    if (!job.input_object || job.state !== 'published') fail('reference_conflict');
    const stored = get(job.result_object), receipt = parse(MarketShortReceiptSchemaV2, stored.value);
    if (objectKey(stored.ref) !== job.result_object || receipt.receipt.jobId !== job.job_id || receipt.receipt.acceptedAt !== job.accepted_at
      || objectKey(receipt.observationInput) !== job.input_object) fail('reference_conflict');
    requireMarketShortBindingV2(MARKET_SHORT_SCOPE_V1, 'market_short', receipt.artifact, stored.ref, ref => {
      const object = get(objectKey(ref));
      if (json(object.ref) !== json(ref)) fail('reference_conflict');
      return object.value;
    });
    if (!db.sqlite.query(`SELECT binding_id FROM artifact_bindings WHERE artifact=? AND receipt=?
      AND dataset='market_short' AND scope=? AND frozen_identity IS NULL`)
      .get(objectKey(receipt.artifact), job.result_object, scopeKey(MARKET_SHORT_SCOPE_V1))) fail('reference_conflict');
  } else if (job.state === 'published' || job.state === 'publishing' && !job.input_object) fail('reference_conflict');
}
