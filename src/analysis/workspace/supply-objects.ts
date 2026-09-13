import { z } from 'zod';
import { MarketDataObservationReceiptV1Schema, validateReceiptV1 } from '../market-data/contracts.js';
import { WorkspaceSupplyCodec, SupplyInputSchema, supplyTarget, supplyPriceEvidence } from './supply-artifact.js';
import { FrozenIdentitySchema, ObjectRefSchema, DateValue, json, parse, fail,
  type ObjectMetadata, type ReferenceCodecs, type ObjectRef } from './contracts.js';
import { EpisodeObjectSchema, WorkspaceMasterSchema } from './technical-input.js';
import { sector33CodeSchema } from '../../tools/finance/sector-index.js';
import type { VerifiedObject } from './references.js';

export const SupplyMasterSchema = WorkspaceMasterSchema.extend({ S33: sector33CodeSchema, S33Nm: z.string().min(1).max(256) }).strict();
export const SupplyPreparedSchema = z.object({ version: z.literal('workspace_supply_prepared_v1'), identity: FrozenIdentitySchema,
  master: ObjectRefSchema, observation: SupplyMasterSchema, artifact: z.unknown() }).strict();
export type SupplyPrepared = Omit<z.infer<typeof SupplyPreparedSchema>, 'artifact'> & { artifact: ReturnType<WorkspaceSupplyCodec['build']> };
export const SupplyReceiptSchema = z.object({ version: z.literal('workspace_supply_receipt_v1'),
  artifact: ObjectRefSchema, receipt: MarketDataObservationReceiptV1Schema }).strict();
export const SupplyMembershipSchema = z.object({ version: z.literal('workspace_supply_membership_v1'),
  identity: FrozenIdentitySchema, master: ObjectRefSchema, observation: SupplyMasterSchema,
  artifact: ObjectRefSchema, date: DateValue }).strict();
export function supplyArtifact(raw: unknown) {
  const input = parse(SupplyInputSchema, (raw as { input?: unknown })?.input);
  return new WorkspaceSupplyCodec(supplyTarget(input)).parse(raw);
}
function metadata(scope: ObjectMetadata['scope'], effectiveDate: string, dependencies: ObjectRef[]): ObjectMetadata {
  return { scope, effectiveDate, dependencies, sourceDefinition: 'workspace_supply_source_v1', calculationVersion: 'workspace_supply_calculation_v1' };
}
export const supplyCodecs: ReferenceCodecs = new Map([
  ['workspace_supply_artifact_v1', raw => {
    const artifact = supplyArtifact(raw), input = artifact.input;
    return metadata(input.scope, input.through, [input.masterEvidence, input.volumeEvidence].filter((ref): ref is ObjectRef => ref !== null));
  }],
  ['workspace_supply_prepared_v1', raw => {
    const prepared = parse(SupplyPreparedSchema, raw), artifact = supplyArtifact(prepared.artifact);
    if (artifact.input.identity && json(artifact.input.identity) !== json(prepared.identity)
      || artifact.input.masterEvidence && json(artifact.input.masterEvidence) !== json(prepared.master)
      || prepared.observation.Code !== prepared.identity.code || prepared.observation.Date !== artifact.dataDate) fail('reference_conflict');
    return metadata({ kind: 'instrument-owned', instrumentId: prepared.identity.instrumentId }, artifact.dataDate,
      [prepared.master, ...(artifact.input.volumeEvidence ? [artifact.input.volumeEvidence] : [])]);
  }],
  ['workspace_supply_receipt_v1', raw => {
    const receipt = parse(SupplyReceiptSchema, raw), observed = validateReceiptV1(receipt.receipt);
    if (observed.target.kind !== 'workspace') fail('reference_conflict');
    const key = observed.target.key;
    const scope: ObjectMetadata['scope'] = key.startsWith('sector_short_') ? { kind: 'sector-scoped',
      provider: 'jquants', scheme: 's33', definitionVersion: 'v1', sectorCode: key.slice('sector_short_'.length) }
      : { kind: 'instrument-owned', instrumentId: key.replace(/^(margin|issuer_short)_/, '') };
    return metadata(scope, observed.artifactIdentity.dataDate, [receipt.artifact]);
  }],
  ['workspace_supply_membership_v1', raw => {
    const member = parse(SupplyMembershipSchema, raw);
    if (member.observation.Code !== member.identity.code || member.observation.Date !== member.date) fail('reference_conflict');
    return metadata({ kind: 'instrument-owned', instrumentId: member.identity.instrumentId }, member.date, [member.master, member.artifact]);
  }],
]);

export function validateSupplyLinks(object: VerifiedObject, get: (ref: ObjectRef) => unknown): void {
  const value: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
  if (object.ref.codec === 'workspace_supply_receipt_v1') {
    const receipt = parse(SupplyReceiptSchema, value), artifact = supplyArtifact(get(receipt.artifact));
    if (json(new WorkspaceSupplyCodec(supplyTarget(artifact.input)).identity(artifact)) !== json(receipt.receipt.artifactIdentity)) fail('reference_conflict');
    return;
  }
  if (object.ref.codec === 'workspace_supply_artifact_v1') {
    const artifact = supplyArtifact(value), input = artifact.input;
    if (!input.masterEvidence) return;
    const episode = parse(EpisodeObjectSchema, get(input.masterEvidence));
    if (episode.instrumentId !== input.identity?.instrumentId || episode.observation.Code !== input.identity.code
      || input.from < episode.from || input.through !== episode.observation.Date) fail('reference_conflict');
    if (input.volumeEvidence && json(supplyPriceEvidence(input, get(input.volumeEvidence)))
      !== json({ volume: input.volume, basisComparable: input.basisComparable })) fail('reference_conflict');
    return;
  }
  if (object.ref.codec === 'workspace_supply_prepared_v1' || object.ref.codec === 'workspace_supply_membership_v1') {
    const prepared = object.ref.codec === 'workspace_supply_prepared_v1' ? parse(SupplyPreparedSchema, value) : parse(SupplyMembershipSchema, value);
    const episode = parse(EpisodeObjectSchema, get(prepared.master));
    const { S33: _code, S33Nm: _name, ...observation } = prepared.observation;
    if (episode.instrumentId !== prepared.identity.instrumentId || json(observation) !== json(episode.observation)) fail('reference_conflict');
    const artifact = supplyArtifact(object.ref.codec === 'workspace_supply_prepared_v1' ? prepared.artifact : get((prepared as z.infer<typeof SupplyMembershipSchema>).artifact));
    if (artifact.input.identity) {
      if (json(artifact.input.identity) !== json(prepared.identity) || json(artifact.input.masterEvidence) !== json(prepared.master)
        || artifact.input.from < episode.from || artifact.input.through !== episode.observation.Date) fail('reference_conflict');
      if (artifact.input.volumeEvidence && json(supplyPriceEvidence(artifact.input, get(artifact.input.volumeEvidence)))
        !== json({ volume: artifact.input.volume, basisComparable: artifact.input.basisComparable })) fail('reference_conflict');
    }
    if (artifact.input.dataset === 'sector_short' && (artifact.input.scope.kind !== 'sector-scoped'
      || artifact.input.scope.sectorCode !== prepared.observation.S33 || artifact.dataDate !== prepared.observation.Date)) fail('reference_conflict');
  }
}
