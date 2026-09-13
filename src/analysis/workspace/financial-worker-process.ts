import { WorkspaceDatabase } from './database.js';
import { WorkspaceError, json } from './contracts.js';
import { financialWorkerOperation } from './financial-worker-operations.js';
import type { FinancialWorkerRequest } from './financial-worker-client.js';

// Private child protocol; no source-fetch function or SQLite writer is dispatched.
if (import.meta.main) {
  let db: WorkspaceDatabase | undefined;
  let response: unknown;
  try {
    const request = JSON.parse(await Bun.stdin.text()) as FinancialWorkerRequest;
    db = new WorkspaceDatabase(request.root, { readonly: true });
    const result = await financialWorkerOperation(db, request);
    response = { ok: true, result };
  } catch (error) { response = { ok: false, result: null, code: error instanceof WorkspaceError ? error.code : 'reference_conflict' }; }
  finally { db?.close(); }
  await Bun.write(Bun.stdout, json(response));
}
