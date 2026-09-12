import { resolve } from 'node:path';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { buildWorkspaceTechnical } from './data-source.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { safeDirectory } from './files.js';
import { json, fail, WorkspaceError } from './contracts.js';
import type { EodWorkerRequest } from './eod-worker-client.js';

self.onmessage = async (event: MessageEvent<EodWorkerRequest>) => {
  let db: WorkspaceDatabase | undefined;
  try {
    const r = event.data;
    let result: unknown = null;
    if (r.operation === 'prepare') {
      db = new WorkspaceDatabase(r.root, { readonly: true });
      const artifact = buildWorkspaceTechnical(r.identity, r.master, new WorkspaceRepository(db), r.fetched);
      result = { artifactBytes: json(artifact), dataDate: artifact.dataDate, receipt: null };
    } else {
      const codec = new WorkspaceTechnicalCodec(r.identity.code.slice(0, 4));
      const candidate = codec.parse(JSON.parse(r.preparedBytes));
      if (json(candidate.input.identity) !== json(r.identity)) fail('reference_conflict');
      safeDirectory(r.artifactRoot, true);
      const repository = new MarketDataRepositoryV1(codec, resolve(r.artifactRoot, 'workspace-v2'));
      const observed = r.operation === 'publish'
        ? await repository.publish(candidate, { jobId: r.jobId, acceptedAt: r.acceptedAt, checkedAt: r.checkedAt })
        : await repository.findObservation(r.jobId, r.acceptedAt);
      if (observed) {
        if (json(observed.artifact.input) !== json(candidate.input)) fail('reference_conflict');
        result = { artifactBytes: json(observed.artifact), dataDate: observed.artifact.dataDate, receipt: observed.receipt };
      }
    }
    db?.close(); db = undefined;
    self.postMessage({ ok: true, result });
  } catch (error) {
    try { db?.close(); } finally { self.postMessage({ ok: false, result: null,
      code: error instanceof WorkspaceError ? error.code
        : error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY' ? 'database_busy' : 'reference_conflict' }); }
  }
};
