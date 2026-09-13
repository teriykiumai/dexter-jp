import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { verifiedTechnical } from '../analysis/workspace/verified-technical.js';
import type { ObjectRef } from '../analysis/workspace/contracts.js';
import type { WorkspaceChart } from './workspace-contracts.js';
import { projectWorkspaceChart } from './workspace-chart.js';

self.onmessage = (event: MessageEvent<{ root: string; artifact: ObjectRef; receipt: ObjectRef; instrumentId: string }>) => {
  let db: WorkspaceDatabase | undefined;
  let result: { ok: true; chart: WorkspaceChart } | { ok: false };
  try {
    const request = event.data;
    db = new WorkspaceDatabase(request.root, { readonly: true });
    const chart = projectWorkspaceChart(verifiedTechnical(db, request.instrumentId, request.artifact, request.receipt));
    result = { ok: true, chart };
  } catch { result = { ok: false }; }
  finally { db?.close(); }
  // Completion must follow connection release; callers may immediately stop/backup.
  self.postMessage(result);
};
