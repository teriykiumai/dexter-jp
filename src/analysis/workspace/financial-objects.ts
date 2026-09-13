import { z } from 'zod';
import { MarketDataObservationReceiptV1Schema, validateReceiptV1 } from '../market-data/contracts.js';
import { EpisodeObjectSchema, WorkspaceMasterSchema } from './technical-input.js';
import { FinancialInputSchema, WorkspaceFinancialCodec, financialTarget } from './financial-artifact.js';
import { FrozenIdentitySchema, ObjectRefSchema, parse, fail, json, type ObjectMetadata, type ReferenceCodecs, type ObjectRef } from './contracts.js';
import type { VerifiedObject } from './references.js';

export const FinancialPreparedSchema = z.object({ version: z.literal('workspace_financial_prepared_v1'),
  identity: FrozenIdentitySchema, master: ObjectRefSchema, observation: WorkspaceMasterSchema, artifact: z.unknown() }).strict();
export const FinancialReceiptSchema = z.object({ version: z.literal('workspace_financial_receipt_v1'),
  artifact: ObjectRefSchema, receipt: MarketDataObservationReceiptV1Schema }).strict();
export function financialArtifact(raw: unknown) {
  const input = parse(FinancialInputSchema, (raw as { input?: unknown })?.input);
  return new WorkspaceFinancialCodec(financialTarget(input)).parse(raw);
}
export type FinancialPrepared = Omit<z.infer<typeof FinancialPreparedSchema>, 'artifact'> & { artifact: ReturnType<typeof financialArtifact> };
function metadata(instrumentId: string, effectiveDate: string, dependencies: ObjectRef[]): ObjectMetadata {
  return { scope: { kind: 'instrument-owned', instrumentId }, effectiveDate, dependencies,
    sourceDefinition: 'workspace_financial_source_v1', calculationVersion: 'workspace_financial_selection_v1' };
}
export const financialCodecs: ReferenceCodecs = new Map([
  ['workspace_financial_artifact_v1', raw => {
    const artifact = financialArtifact(raw);
    return metadata(artifact.input.identity.instrumentId, artifact.dataDate, [artifact.input.masterEvidence]);
  }],
  ['workspace_financial_prepared_v1', raw => {
    const p = parse(FinancialPreparedSchema, raw), artifact = financialArtifact(p.artifact);
    if (json(p.identity) !== json(artifact.input.identity) || json(p.master) !== json(artifact.input.masterEvidence)
      || p.observation.Code !== p.identity.code || p.observation.Date !== artifact.dataDate) fail('reference_conflict');
    return metadata(p.identity.instrumentId, artifact.dataDate, [p.master]);
  }],
  ['workspace_financial_receipt_v1', raw => {
    const p = parse(FinancialReceiptSchema, raw), receipt = validateReceiptV1(p.receipt);
    if (receipt.target.kind !== 'workspace' || !receipt.target.key.startsWith('financial_')) fail('reference_conflict');
    return metadata(receipt.target.key.slice('financial_'.length), receipt.artifactIdentity.dataDate, [p.artifact]);
  }],
]);
export function validateFinancialLinks(object: VerifiedObject, get: (ref: ObjectRef) => unknown) {
  if (!financialCodecs.has(object.ref.codec)) return;
  const raw: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
  if (object.ref.codec === 'workspace_financial_receipt_v1') {
    const receipt = parse(FinancialReceiptSchema, raw), artifact = financialArtifact(get(receipt.artifact));
    if (json(receipt.receipt.artifactIdentity) !== json(new WorkspaceFinancialCodec(financialTarget(artifact.input)).identity(artifact))) fail('reference_conflict');
    return;
  }
  const prepared = object.ref.codec === 'workspace_financial_prepared_v1' ? parse(FinancialPreparedSchema, raw) : null;
  const artifact = financialArtifact(prepared ? prepared.artifact : raw), input = artifact.input;
  const episode = parse(EpisodeObjectSchema, get(input.masterEvidence));
  if (episode.instrumentId !== input.identity.instrumentId || episode.observation.Code !== input.identity.code
    || episode.from !== input.episodeFrom || episode.observation.Date !== input.through
    || prepared && json(prepared.observation) !== json(episode.observation)) fail('reference_conflict');
}
