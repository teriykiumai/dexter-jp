import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { resolveReference, type VerifiedObject } from '../analysis/workspace/references.js';
import { workspaceDataCodecs, validateDataObjectLinks } from '../analysis/workspace/data-objects.js';
import { objectKey, fail, type ObjectRef } from '../analysis/workspace/contracts.js';
import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { WorkspaceChart } from './workspace-contracts.js';
import { projectWorkspaceChart } from './workspace-chart.js';

self.onmessage = (event: MessageEvent<{ root: string; artifact: ObjectRef; receipt: ObjectRef; instrumentId: string }>) => {
  let db: WorkspaceDatabase | undefined;
  let result: { ok: true; chart: WorkspaceChart } | { ok: false };
  try {
    const request = event.data;
    db = new WorkspaceDatabase(request.root, { readonly: true });
    const objects = new Map<string, VerifiedObject>();
    const visit = (ref: ObjectRef, depth = 0) => {
      if (depth > 100 || objects.size > 1000) fail('reference_conflict');
      if (objects.has(objectKey(ref))) return;
      const object = resolveReference(db!, ref, workspaceDataCodecs);
      objects.set(objectKey(ref), object);
      for (const child of object.metadata.dependencies) visit(child, depth + 1);
    };
    visit(request.receipt); visit(request.artifact);
    validateDataObjectLinks([...objects.values()]);
    const object = objects.get(objectKey(request.artifact))!;
    const receipt = objects.get(objectKey(request.receipt))!;
    if (request.artifact.codec !== 'workspace_technical_v2' || request.receipt.codec !== 'workspace_receipt_v1'
      || object.metadata.scope.kind !== 'instrument-owned' || object.metadata.scope.instrumentId !== request.instrumentId
      || !receipt.metadata.dependencies.some(ref => objectKey(ref) === objectKey(request.artifact))) fail('reference_conflict');
    const artifact = JSON.parse(new TextDecoder().decode(object.bytes)) as TechnicalArtifactV2;
    const chart = projectWorkspaceChart(artifact);
    result = { ok: true, chart };
  } catch { result = { ok: false }; }
  finally { db?.close(); }
  // Completion must follow connection release; callers may immediately stop/backup.
  self.postMessage(result);
};
