import { resolve } from 'node:path';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { buildWorkspaceTechnical } from './data-source.js';
import { retainWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { resolveReference } from './references.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { safeDirectory } from './files.js';
import { json, fail, WorkspaceError } from './contracts.js';
import type { EodWorkerRequest } from './eod-worker-client.js';

self.onmessage = async (event: MessageEvent<EodWorkerRequest>) => {
  let db: WorkspaceDatabase | undefined;
  try {
    const r = event.data; db = new WorkspaceDatabase(r.root);
    let ref = null;
    if (r.operation === 'prepare') {
      const artifact = buildWorkspaceTechnical(r.identity, r.master, new WorkspaceRepository(db), r.fetched);
      ref = await retainWorkspaceObject(db, 'workspace_technical_v2', artifact);
    } else {
      const codec = new WorkspaceTechnicalCodec(r.identity.code.slice(0, 4));
      const candidate = codec.parse(JSON.parse(new TextDecoder().decode(resolveReference(db, r.prepared, workspaceDataCodecs).bytes)));
      if (json(candidate.input.identity) !== json(r.identity)) fail('reference_conflict');
      safeDirectory(r.artifactRoot, true);
      const repository = new MarketDataRepositoryV1(codec, resolve(r.artifactRoot, 'workspace-v2'));
      const observed = r.operation === 'publish'
        ? await repository.publish(candidate, { jobId: r.jobId, acceptedAt: r.acceptedAt, checkedAt: r.checkedAt })
        : await repository.findObservation(r.jobId, r.acceptedAt);
      if (observed) {
        if (json(observed.artifact.input) !== json(candidate.input)) fail('reference_conflict');
        const artifact = await retainWorkspaceObject(db, 'workspace_technical_v2', observed.artifact);
        ref = await retainWorkspaceObject(db, 'workspace_receipt_v1', { version: 'workspace_receipt_v1', identity: r.identity, artifact, receipt: observed.receipt });
      }
    }
    db.close(); db = undefined;
    self.postMessage({ ok: true, ref });
  } catch (error) {
    try { db?.close(); } finally { self.postMessage({ ok: false, ref: null,
      code: error instanceof WorkspaceError && error.code === 'identity_review_required' ? error.code : 'reference_conflict' }); }
  }
};
