import type { TechnicalFetchedInputsV1 } from '../market-data/technical-source.js';
import { ObjectRefSchema, parse, WorkspaceError, type FrozenIdentity, type ObjectRef } from './contracts.js';

export type EodWorkerRequest = { root: string; artifactRoot: string; identity: FrozenIdentity } & (
  { operation: 'prepare'; master: ObjectRef; fetched: TechnicalFetchedInputsV1 }
  | { operation: 'publish' | 'recover'; prepared: ObjectRef; jobId: string; acceptedAt: string; checkedAt: string });
/** Only CPU/immutable I/O crosses this boundary. No worker market-data fetch. */
export function runEodWorker(request: EodWorkerRequest, signal?: AbortSignal): Promise<ObjectRef | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./eod-worker.ts', import.meta.url).href);
    let done = false;
    const finish = (value: ObjectRef | null, failed = false, code: 'identity_review_required' | 'database_busy' | 'reference_conflict' = 'reference_conflict') => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
      if (failed) reject(new WorkspaceError(code)); else resolve(value);
    };
    const abort = () => finish(null, true), timer = setTimeout(abort, 600_000);
    worker.onerror = event => { event.preventDefault(); finish(null, true); };
    worker.onmessage = event => {
      try { const data = event.data as { ok: boolean; ref: unknown; code?: string };
        finish(data.ok && data.ref !== null ? parse(ObjectRefSchema, data.ref) : null, !data.ok,
          data.code === 'identity_review_required' || data.code === 'database_busy' ? data.code : 'reference_conflict');
      } catch { finish(null, true); }
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true }); worker.postMessage(request);
  });
}
