import { WorkspaceError, type ObjectRef, type ObjectMetadata, type WorkspaceErrorCode } from './contracts.js';
import type { SupplyInput, WorkspaceSupplyCodec } from './supply-artifact.js';
import type { WorkspaceSupplyView } from '../../dashboard/workspace-contracts.js';
import type { SupplyPrepared } from './supply-objects.js';
import type { MarketDataObservationReceiptV1 } from '../market-data/contracts.js';
type SupplyArtifact = ReturnType<WorkspaceSupplyCodec['build']>;
type Publication = { artifact: SupplyArtifact; receipt: MarketDataObservationReceiptV1 } | null;

export type SupplyWorkerRequest = { operation: 'price'; root: string; input: SupplyInput; reference: ObjectRef }
  | { operation: 'read'; root: string; instrumentId: string }
  | { operation: 'validate'; root: string; codec: string; bytes: string }
  | { operation: 'build'; root: string; input: SupplyInput; acceptedAt: string }
  | { operation: 'prepared'; root: string; reference: ObjectRef }
  | { operation: 'publish' | 'recover'; root: string; artifactRoot: string; artifact: SupplyArtifact;
    jobId: string; acceptedAt: string; checkedAt: string };
type PriceEvidence = Pick<SupplyInput, 'volume' | 'basisComparable'>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'price' }>, signal?: AbortSignal): Promise<PriceEvidence>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'read' }>, signal?: AbortSignal): Promise<WorkspaceSupplyView>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'validate' }>, signal?: AbortSignal): Promise<ObjectMetadata>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'build' }>, signal?: AbortSignal): Promise<SupplyArtifact>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'prepared' }>, signal?: AbortSignal): Promise<SupplyPrepared>;
export function runSupplyWorker(request: Extract<SupplyWorkerRequest, { operation: 'publish' | 'recover' }>, signal?: AbortSignal): Promise<Publication>;
export function runSupplyWorker(request: SupplyWorkerRequest, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new WorkspaceError('invalid_input')); return; }
    const worker = new Worker(new URL('./supply-worker.ts', import.meta.url).href);
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new WorkspaceError('invalid_input')); };
    const timer = setTimeout(() => { finish(); reject(new WorkspaceError('reference_conflict')); }, 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new WorkspaceError('reference_conflict')); };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result: unknown; code?: WorkspaceErrorCode }>) => {
      finish(); if (event.data.ok) resolve(event.data.result); else reject(new WorkspaceError(event.data.code ?? 'reference_conflict'));
    };
    worker.postMessage(request);
  });
}
