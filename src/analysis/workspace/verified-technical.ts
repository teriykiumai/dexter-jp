import { resolveReference, type VerifiedObject } from './references.js';
import { workspaceDataCodecs, validateDataObjectLinks } from './data-objects.js';
import { objectKey, fail, type ObjectRef } from './contracts.js';
import type { WorkspaceDatabase } from './database.js';
import type { TechnicalArtifactV2 } from './technical-artifact.js';

/** Exact receipt and dependency verification shared by chart and Drawing workers. */
export function verifiedTechnical(db: WorkspaceDatabase, instrumentId: string, artifact: ObjectRef, receipt: ObjectRef,
  objects = new Map<string, VerifiedObject>()): TechnicalArtifactV2 {
  const visit = (ref: ObjectRef, depth = 0) => {
    if (depth > 100 || objects.size > 1000) fail('reference_conflict');
    if (objects.has(objectKey(ref))) return;
    const object = resolveReference(db, ref, workspaceDataCodecs);
    objects.set(objectKey(ref), object);
    for (const child of object.metadata.dependencies) visit(child, depth + 1);
  };
  visit(receipt); visit(artifact);
  validateDataObjectLinks([...objects.values()]);
  const object = objects.get(objectKey(artifact))!, observation = objects.get(objectKey(receipt))!;
  if (artifact.codec !== 'workspace_technical_v2' || receipt.codec !== 'workspace_receipt_v1'
    || object.metadata.scope.kind !== 'instrument-owned' || object.metadata.scope.instrumentId !== instrumentId
    || !observation.metadata.dependencies.some(ref => objectKey(ref) === objectKey(artifact))) fail('reference_conflict');
  return JSON.parse(new TextDecoder().decode(object.bytes)) as TechnicalArtifactV2;
}
