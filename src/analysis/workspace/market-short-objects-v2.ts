import { z } from 'zod';
import { MarketDataObservationReceiptV1Schema, validateReceiptV1 } from '../market-data/contracts.js';
import { ObjectRefSchema, json, parse, fail, type ObjectMetadata, type ReferenceCodecs, type ObjectRef, type WorkspaceScope } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';
import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { WorkspaceMarketShortCodecV2, MARKET_SHORT_TARGET_V2 } from './market-short-artifact-v2.js';
import { marketShortInputV2 } from './market-short-policy-v2.js';
import type { VerifiedObject } from './references.js';

export const MarketShortReceiptSchemaV2 = z.object({ version: z.literal('workspace_market_short_receipt_v2'),
  artifact: ObjectRefSchema, observationInput: ObjectRefSchema, receipt: MarketDataObservationReceiptV1Schema }).strict();
const codec = new WorkspaceMarketShortCodecV2();
function metadata(date: string, dependencies: ObjectRef[]): ObjectMetadata {
  return { scope: MARKET_SHORT_SCOPE_V1, effectiveDate: date, dependencies,
    sourceDefinition: MARKET_SHORT_COVERAGE_V1.sourceDefinition, calculationVersion: MARKET_SHORT_COVERAGE_V1.calculationVersion };
}
function envelope(raw: unknown) {
  const value = parse(MarketShortReceiptSchemaV2, raw), receipt = validateReceiptV1(value.receipt);
  if (value.artifact.codec !== 'workspace_market_short_artifact_v2' || value.observationInput.codec !== 'workspace_market_short_input_v2'
    || json(receipt.target) !== json(MARKET_SHORT_TARGET_V2)) fail('reference_conflict');
  return value;
}
export const marketShortCodecsV2: ReferenceCodecs = new Map([
  ['workspace_market_short_input_v2', raw => metadata(marketShortInputV2(raw).date, [])],
  ['workspace_market_short_artifact_v2', raw => {
    const artifact = codec.parse(raw); return metadata(artifact.dataDate, [artifact.inputReference]);
  }],
  ['workspace_market_short_receipt_v2', raw => {
    const value = envelope(raw); return metadata(value.receipt.artifactIdentity.dataDate, [value.artifact, value.observationInput]);
  }],
]);
function exactArtifact(ref: ObjectRef, get: (ref: ObjectRef) => unknown) {
  if (ref.codec !== 'workspace_market_short_artifact_v2') fail('reference_conflict');
  const artifact = codec.parse(get(ref)), input = marketShortInputV2(get(artifact.inputReference));
  if (json(artifact.input) !== json(input)) fail('reference_conflict');
  return artifact;
}
function exactReceipt(raw: unknown, get: (ref: ObjectRef) => unknown) {
  const value = envelope(raw), artifact = exactArtifact(value.artifact, get);
  const observation = codec.build(get(value.observationInput), value.observationInput, value.receipt.acceptedAt);
  if (json(codec.identity(artifact)) !== json(value.receipt.artifactIdentity)
    || value.receipt.checkedAt < artifact.fetchedAt || value.receipt.checkedAt < observation.fetchedAt
    || !codec.equivalent(artifact, observation)) fail('reference_conflict');
  return { value, artifact };
}
export function validateMarketShortLinksV2(object: VerifiedObject, get: (ref: ObjectRef) => unknown): void {
  if (object.ref.codec === 'workspace_market_short_artifact_v2') exactArtifact(object.ref, get);
  if (object.ref.codec === 'workspace_market_short_receipt_v2') exactReceipt(get(object.ref), get);
}
/** Invoked inside the binding transaction, and by current/link/backup validation.
 * Replays exact bytes and their closure, not a trusted boolean in SQLite metadata.
 */
export function requireMarketShortBindingV2(scope: WorkspaceScope, dataset: string, artifact: ObjectRef, receipt: ObjectRef,
  get: (ref: ObjectRef) => unknown) {
  if (dataset !== 'market_short' || json(scope) !== json(MARKET_SHORT_SCOPE_V1)
    || artifact.codec !== 'workspace_market_short_artifact_v2' || receipt.codec !== 'workspace_market_short_receipt_v2') fail('reference_conflict');
  const checked = exactReceipt(get(receipt), get);
  if (json(checked.value.artifact) !== json(artifact)) fail('reference_conflict');
  return checked.value;
}
