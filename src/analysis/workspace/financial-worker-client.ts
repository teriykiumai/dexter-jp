import { fileURLToPath } from 'node:url';
import { WorkspaceError, json, type WorkspaceErrorCode } from './contracts.js';
import type { FinancialInput, WorkspaceFinancialCodec } from './financial-artifact.js';
import type { ObjectRef, ObjectMetadata } from './contracts.js';
import type { FinancialPrepared } from './financial-objects.js';
import type { MarketDataObservationReceiptV1 } from '../market-data/contracts.js';
import type { WorkspaceFinancialView } from '../../dashboard/workspace-contracts.js';
type Artifact = ReturnType<WorkspaceFinancialCodec['build']>;
export type FinancialWorkerRequest = { operation: 'build'; root: string; input: FinancialInput; acceptedAt: string }
  | { operation: 'validate'; root: string; codec: string; bytes: string }
  | { operation: 'prepared'; root: string; reference: ObjectRef }
  | { operation: 'publish' | 'recover'; root: string; artifactRoot: string; artifact: Artifact; jobId: string; acceptedAt: string; checkedAt: string }
  | { operation: 'read'; root: string; instrumentId: string };
type Publication = { artifact: Artifact; receipt: MarketDataObservationReceiptV1 } | null;
export function runFinancialWorker(request: Extract<FinancialWorkerRequest, { operation: 'build' }>, signal?: AbortSignal): Promise<Artifact>;
export function runFinancialWorker(request: Extract<FinancialWorkerRequest, { operation: 'validate' }>, signal?: AbortSignal): Promise<ObjectMetadata>;
export function runFinancialWorker(request: Extract<FinancialWorkerRequest, { operation: 'prepared' }>, signal?: AbortSignal): Promise<FinancialPrepared>;
export function runFinancialWorker(request: Extract<FinancialWorkerRequest, { operation: 'publish' | 'recover' }>, signal?: AbortSignal): Promise<Publication>;
export function runFinancialWorker(request: Extract<FinancialWorkerRequest, { operation: 'read' }>, signal?: AbortSignal): Promise<WorkspaceFinancialView>;
export async function runFinancialWorker(request: FinancialWorkerRequest, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new WorkspaceError('invalid_input');
  // Large financial graphs triggered repeated Bun/Windows worker teardown crashes.
  // Keep the same runtime and read-only DB boundary in an isolated process.
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./financial-worker-process.ts', import.meta.url))],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const abort = () => child.kill();
  const timer = setTimeout(abort, 60_000); signal?.addEventListener('abort', abort, { once: true });
  const bounded = async (stream: ReadableStream<Uint8Array>, maximum: number) => {
    const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > maximum) { abort(); throw new WorkspaceError('reference_conflict'); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  };
  try {
    const output = Promise.all([bounded(child.stdout, 64 * 1024 * 1024), bounded(child.stderr, 4096), child.exited]);
    // Attach handlers before stdin can fail if the child exits during startup.
    void output.catch(() => {});
    child.stdin.write(json(request)); await child.stdin.end();
    const [bytes, _stderr, exit] = await output;
    if (signal?.aborted) throw new WorkspaceError('invalid_input');
    if (exit !== 0) throw new WorkspaceError('reference_conflict');
    const envelope = JSON.parse(bytes) as { ok: boolean; result: unknown; code?: WorkspaceErrorCode };
    if (!envelope.ok) throw new WorkspaceError(envelope.code ?? 'reference_conflict'); return envelope.result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (child.exitCode === null) child.kill(); }
}
