import { z } from 'zod';
import { MarketDataObservationReceiptV1Schema, validateReceiptV1 } from '../market-data/contracts.js';
import { ObjectRefSchema, json, parse, fail, type ObjectMetadata, type ReferenceCodecs, type ObjectRef } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';
import { MARKET_SHORT_SCOPE_V1, MARKET_SHORT_TARGET_V1, WorkspaceMarketShortCodec, marketShortInput,
  marketShortCalculationDate } from './market-short-artifact.js';
import type { VerifiedObject } from './references.js';

export const MarketShortReceiptSchema = z.object({ version: z.literal('workspace_market_short_receipt_v1'),
  artifact: ObjectRefSchema, receipt: MarketDataObservationReceiptV1Schema }).strict();
const codec = new WorkspaceMarketShortCodec();
function metadata(date: string, dependencies: ObjectRef[]): ObjectMetadata {
  return { scope: MARKET_SHORT_SCOPE_V1, effectiveDate: date, dependencies,
    sourceDefinition: MARKET_SHORT_COVERAGE_V1.sourceDefinition, calculationVersion: MARKET_SHORT_COVERAGE_V1.calculationVersion };
}
export const marketShortCodecs: ReferenceCodecs = new Map([
  ['workspace_market_short_input_v1', raw => metadata(marketShortInput(raw).date, [])],
  ['workspace_market_short_artifact_v1', raw => {
    const artifact = codec.parse(raw); return metadata(artifact.dataDate, [artifact.inputReference]);
  }],
  ['workspace_market_short_receipt_v1', raw => {
    const envelope = parse(MarketShortReceiptSchema, raw), receipt = validateReceiptV1(envelope.receipt);
    if (envelope.artifact.codec !== 'workspace_market_short_artifact_v1'
      || json(receipt.target) !== json(MARKET_SHORT_TARGET_V1)) fail('reference_conflict');
    marketShortCalculationDate(receipt.artifactIdentity.dataDate, receipt.acceptedAt);
    return metadata(receipt.artifactIdentity.dataDate, [envelope.artifact]);
  }],
]);

export function validateMarketShortLinks(object: VerifiedObject, get: (ref: ObjectRef) => unknown): void {
  const value: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
  if (object.ref.codec === 'workspace_market_short_artifact_v1') {
    const artifact = codec.parse(value), input = marketShortInput(get(artifact.inputReference));
    if (json(input) !== json(artifact.input)) fail('reference_conflict');
  } else if (object.ref.codec === 'workspace_market_short_receipt_v1') {
    const envelope = parse(MarketShortReceiptSchema, value), receipt = validateReceiptV1(envelope.receipt);
    const artifact = codec.parse(get(envelope.artifact));
    if (json(codec.identity(artifact)) !== json(receipt.artifactIdentity)
      || receipt.checkedAt < artifact.fetchedAt) fail('reference_conflict');
  }
}
