import type { WorkspaceRepository } from './repository.js';
import { parse, fail, json, objectKey, scopeKey, type ObjectRef } from './contracts.js';
import { objectRow, rowRef, resolveReference, type VerifiedObject } from './references.js';
import { workspaceDataCodecs, EpisodeObjectSchema } from './data-objects.js';
import { AiInputSchema, AiSelectionSchema, type AiInput, type AiSelection, type AiProfile, type AiRuntime } from './ai-contracts.js';
import { readWorkspaceFinancial } from '../../dashboard/workspace-financial.js';
import { readWorkspaceSupply } from '../../dashboard/workspace-supply.js';

/** A short writer transaction selects exact pointers; slow parsing happens outside it.
 * Admission compares this entire selection again before accepting the durable job. */
export function selectAiInputs(repository: WorkspaceRepository, instrumentId: string, profile: AiProfile): AiSelection {
  const db = repository.db, identity = repository.freezeIdentity(instrumentId);
  if (!db.sqlite.query('SELECT instrument_id FROM workspaces WHERE instrument_id=?').get(instrumentId)) fail('not_found');
  const evidence = db.sqlite.query<{ evidence: string }, [number, string]>(
    'SELECT evidence FROM catalog_rows WHERE generation=? AND instrument_id=?').get(identity.catalogGeneration, instrumentId) ?? fail('identity_review_required');
  const binding = (dataset: string) => {
    const row = db.sqlite.query<{ artifact: string; receipt: string }, [string, string]>(`SELECT b.artifact,b.receipt FROM data_sync_state s
      JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset=? AND s.status='available'`).get(scopeKey({ kind: 'instrument-owned', instrumentId }), dataset);
    return row ? { artifact: rowRef(objectRow(db, row.artifact)), receipt: rowRef(objectRow(db, row.receipt)) } : null;
  };
  const sector = profile === 'supply_demand' ? db.sqlite.query<{ artifact: string; receipt: string; membership: string }, [string]>(`SELECT b.artifact,b.receipt,l.membership
    FROM shared_context_links l JOIN artifact_bindings b USING(binding_id) WHERE l.instrument_id=? AND l.role='sector_short'`).get(instrumentId) : null;
  return parse(AiSelectionSchema, { identity, master: rowRef(objectRow(db, evidence.evidence)),
    financial: profile === 'fundamental' ? binding('financial') : null, technical: profile === 'fundamental' ? binding('technical') : null,
    margin: profile === 'supply_demand' ? binding('margin') : null, issuer_short: profile === 'supply_demand' ? binding('issuer_short') : null,
    sector_short: sector ? { artifact: rowRef(objectRow(db, sector.artifact)), receipt: rowRef(objectRow(db, sector.receipt)), membership: rowRef(objectRow(db, sector.membership)) } : null });
}
export function buildAiInput(repository: WorkspaceRepository, selection: AiSelection, profile: AiProfile, runId: string, createdAt: string, runtime: AiRuntime,
  read = (ref: ObjectRef): VerifiedObject => resolveReference(repository.db, ref, workspaceDataCodecs)): AiInput {
  const get = (ref: ObjectRef) => JSON.parse(new TextDecoder().decode(read(ref).bytes));
  const episode = parse(EpisodeObjectSchema, get(selection.master));
  if (episode.instrumentId !== selection.identity.instrumentId || episode.observation.Code !== selection.identity.code) fail('reference_conflict');
  const data = profile === 'fundamental' ? readWorkspaceFinancial(repository, selection.identity.instrumentId, false, selection, read)
    : readWorkspaceSupply(repository, selection.identity.instrumentId, false, selection, read);
  const input = parse(AiInputSchema, { version: 'workspace_ai_input_v1', runId, createdAt, profile, profileVersion: 'saved_interpretation_v1', selection, runtime, data });
  // No silent truncation of issuer reports or source tables; the user sees why it cannot run.
  if (new TextEncoder().encode(json(input)).byteLength > 96 * 1024) fail('invalid_input');
  return input;
}
export function aiHasInputs(input: AiInput): boolean {
  return input.profile === 'fundamental' ? input.data.state === 'available' : input.data.datasets.some(dataset => dataset.state === 'available');
}
