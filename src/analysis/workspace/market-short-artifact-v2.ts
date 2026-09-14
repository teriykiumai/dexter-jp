import { z } from 'zod';
import { MarketDataArtifactCommonFieldsV1 } from '../market-data/artifact-codec.js';
import type { MarketDataArtifactIdentityV1 } from '../market-data/contracts.js';
import { ObjectRefSchema, digest, json, parse, fail, safe, type ObjectRef } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';
import { MARKET_SHORT_BINDING_POLICY_V2, MarketShortInputSchemaV2, marketShortInputV2,
  marketShortAdmissionV2, calculateMarketShortV2, type MarketShortInputV2 } from './market-short-policy-v2.js';

export const MARKET_SHORT_TARGET_V2 = Object.freeze({ kind: 'workspace' as const, key: 'market_short_tse_regular_market_v2' });
function semantic(input: MarketShortInputV2) {
  const { acceptedAt: _accepted, execution: _execution, source, calendar, ...values } = input;
  const { fetchedAt: _fetched, pageCount: _pages, ...data } = source;
  const { fetchedAt: _calendarFetched, pageCount: _calendarPages, ...evidence } = calendar.evidence;
  return { ...values, source: data, calendar: { ...calendar, evidence } };
}

/** V2 is a new namespace; V1 evidence is never migrated or adopted by this codec. */
export class WorkspaceMarketShortCodecV2 {
  readonly target = MARKET_SHORT_TARGET_V2;
  build(raw: unknown, inputReference: ObjectRef, acceptedAt: string) {
    const input = marketShortInputV2(raw), ref = parse(ObjectRefSchema, inputReference);
    if (ref.codec !== 'workspace_market_short_input_v2' || ref.digest !== digest(json(input))
      || acceptedAt !== input.acceptedAt) fail('reference_conflict');
    const calculated = calculateMarketShortV2(input);
    const payload = { schemaVersion: 'workspace_market_short_artifact_v2' as const,
      calculationVersion: MARKET_SHORT_COVERAGE_V1.calculationVersion,
      asOfCutoff: acceptedAt, calculationDate: marketShortAdmissionV2(input.date, acceptedAt),
      dataDate: input.date, fetchedAt: input.source.fetchedAt,
      sourcePayloadDigest: digest(json({ version: 'workspace_market_short_payload_v2', input: semantic(input) })),
      sourceInputs: [{ kind: 'provider' as const, role: 'workspace_source', sourceId: 'workspace_market_short_v2',
        sourceContractVersion: MARKET_SHORT_COVERAGE_V1.sourceDefinition, sourceRevisionIds: ['official_specs_2026_09_14'],
        unitAndCoverageBasis: 'JPY; percent; TSE regular market, 33 sectors plus 9999; approximate reference; application 17:30 JST cutoff is not provider completion; not point-in-time history',
        sourceMappingVersion: MARKET_SHORT_COVERAGE_V1.version, endpoint: input.source.endpoint,
        normalizedQueryIdentity: json(input.source.query), dataDateOrEffectiveRange: input.date,
        publishedDate: null, publishedAt: null, cadence: 'daily', asOfCutoff: acceptedAt,
        entitlementClass: 'standard' as const, entitlementVerifiedAt: input.source.fetchedAt, fetchedAt: input.source.fetchedAt,
        pagination: { complete: true as const, pageCount: input.source.pageCount, rowCount: input.source.rowCount },
        inputDigest: digest(json(semantic(input))) }], inputReference: ref, input, ...calculated };
    const value = { ...payload, artifactDigest: digest(json(payload)) }; safe(value); return value;
  }
  parse(raw: unknown) {
    const candidate = parse(z.object({ ...MarketDataArtifactCommonFieldsV1,
      schemaVersion: z.literal('workspace_market_short_artifact_v2'), inputReference: ObjectRefSchema,
      input: MarketShortInputSchemaV2, result: z.unknown(), qualification: z.unknown() }).strict(), raw);
    const value = this.build(candidate.input, candidate.inputReference, candidate.asOfCutoff);
    if (json(raw) !== json(value) || value.qualification.policyVersion !== MARKET_SHORT_BINDING_POLICY_V2) fail('reference_conflict');
    return value;
  }
  identity(value: ReturnType<WorkspaceMarketShortCodecV2['build']>): MarketDataArtifactIdentityV1 {
    return { scope: 'workspace', tickerOrSourceId: this.target.key, dataDate: value.dataDate,
      sourcePayloadDigest: value.sourcePayloadDigest, artifactDigest: value.artifactDigest,
      rootRelativeIdentity: `workspace/${this.target.key}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }
  equivalent(a: ReturnType<WorkspaceMarketShortCodecV2['build']>, b: ReturnType<WorkspaceMarketShortCodecV2['build']>) {
    return a.sourcePayloadDigest === b.sourcePayloadDigest && json(semantic(a.input)) === json(semantic(b.input))
      && json(a.result) === json(b.result) && json(a.qualification) === json(b.qualification);
  }
}
