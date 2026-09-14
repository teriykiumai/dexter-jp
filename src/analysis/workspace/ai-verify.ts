import { AiInputSchema, type AiInput } from './ai-contracts.js';
import { parse, fail, json, objectKey, type ObjectRef } from './contracts.js';
import { resolveReference, type VerifiedObject } from './references.js';
import { workspaceDataCodecs, validateDataObjectLinks } from './data-objects.js';
import { buildAiInput } from './ai-input.js';
import { WorkspaceRepository } from './repository.js';
import type { WorkspaceDatabase } from './database.js';

export function verifyAiInput(db: WorkspaceDatabase, ref: ObjectRef, offlineObjects?: ReadonlyMap<string, VerifiedObject>): AiInput {
  if (ref.codec !== 'workspace_ai_input_v1') fail('reference_conflict');
  const objects = new Map<string, VerifiedObject>();
  // Offline maintenance supplies the already verified closure; online reads retain
  // the normal archive guard. Never bypass that guard on an online DB connection.
  const read = (r: ObjectRef) => offlineObjects ? offlineObjects.get(objectKey(r)) ?? fail('reference_missing') : resolveReference(db, r, workspaceDataCodecs);
  const visit = (r: ObjectRef, depth = 0) => {
    if (depth > 100 || objects.size > 1500) fail('reference_conflict');
    const key = objectKey(r); if (objects.has(key)) return;
    const value = read(r); objects.set(key, value);
    for (const dependency of value.metadata.dependencies) visit(dependency, depth + 1);
  };
  visit(ref); validateDataObjectLinks([...objects.values()]);
  const input = parse(AiInputSchema, JSON.parse(new TextDecoder().decode(objects.get(objectKey(ref))!.bytes)));
  const identity = input.selection.identity;
  const mapping = db.sqlite.query<{ evidence: string }, [string, string, string, number, number]>(`SELECT r.evidence FROM catalog_rows r
    JOIN catalog_generations g USING(generation) WHERE r.instrument_id=? AND r.provider=? AND r.code=? AND r.mapping_revision=? AND r.generation=? AND g.activated=1`)
    .get(identity.instrumentId, identity.provider, identity.code, identity.mappingRevision, identity.catalogGeneration);
  if (!mapping || mapping.evidence !== objectKey(input.selection.master)) fail('reference_conflict');
  // Rebuild from these exact references, even after current catalog/data changes.
  const rebuilt = buildAiInput(new WorkspaceRepository(db), input.selection, input.profile, input.runId, input.createdAt, input.runtime, read);
  if (json(input) !== json(rebuilt)) fail('reference_conflict');
  return input;
}
