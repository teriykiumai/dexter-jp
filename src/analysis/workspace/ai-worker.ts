import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { json, WorkspaceError, type ObjectRef } from './contracts.js';
import { type AiInput, type AiSelection, type AiProfile, type AiRuntime } from './ai-contracts.js';
import { buildAiInput } from './ai-input.js';
import { verifyAiInput } from './ai-verify.js';
import { runWorkspaceProcess } from './financial-worker-client.js';

type Request = { operation: 'build'; root: string; selection: AiSelection; profile: AiProfile; runId: string; createdAt: string; runtime: AiRuntime }
  | { operation: 'verify'; root: string; input: ObjectRef };
export async function runAiRead(request: Request, signal?: AbortSignal): Promise<AiInput> {
  return await runWorkspaceProcess(new URL('./ai-worker.ts', import.meta.url), request, signal) as AiInput;
}
if (import.meta.main) {
  let db: WorkspaceDatabase | undefined, response: unknown;
  try {
    const r = JSON.parse(await Bun.stdin.text()) as Request;
    db = new WorkspaceDatabase(r.root, { readonly: true });
    const result = r.operation === 'build' ? buildAiInput(new WorkspaceRepository(db), r.selection, r.profile, r.runId, r.createdAt, r.runtime)
      : verifyAiInput(db, r.input);
    response = { ok: true, result };
  } catch (error) { response = { ok: false, result: null, code: error instanceof WorkspaceError ? error.code : 'reference_conflict' }; }
  finally { db?.close(); }
  await Bun.write(Bun.stdout, json(response));
}
