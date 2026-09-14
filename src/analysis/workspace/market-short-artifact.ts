import { z } from 'zod';
import { MarketDataArtifactCommonFieldsV1 } from '../market-data/artifact-codec.js';
import { MarketDataInstantV1Schema, type MarketDataArtifactIdentityV1 } from '../market-data/contracts.js';
import { DateValue, ObjectRefSchema, digest, json, parse, fail, safe, type ObjectRef } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1, MARKET_SHORT_COVERAGE_DIGEST_V1, MarketShortRowSchemaV1,
  inspectMarketShortCoverageV1 } from './market-short-source-gate.js';

export const MARKET_SHORT_SCOPE_V1 = Object.freeze({ kind: 'market-scoped' as const,
  universe: MARKET_SHORT_COVERAGE_V1.scopeId, definitionVersion: MARKET_SHORT_COVERAGE_V1.version });
export const MARKET_SHORT_TARGET_V1 = Object.freeze({ kind: 'workspace' as const, key: 'market_short_tse_regular_market_v1' });
export const MarketShortInputSchema = z.object({ version: z.literal('workspace_market_short_input_v1'),
  scope: z.object({ kind: z.literal(MARKET_SHORT_SCOPE_V1.kind), universe: z.literal(MARKET_SHORT_SCOPE_V1.universe),
    definitionVersion: z.literal(MARKET_SHORT_SCOPE_V1.definitionVersion) }).strict(),
  registry: z.unknown(), registryDigest: z.literal(MARKET_SHORT_COVERAGE_DIGEST_V1), date: DateValue,
  sourceQualification: z.literal('unverified'), correctionVintage: z.literal('current_at_fetch_not_point_in_time'),
  source: z.object({ endpoint: z.literal('/v2/markets/short-ratio'), query: z.object({ date: DateValue }).strict(),
    fetchedAt: MarketDataInstantV1Schema, pageCount: z.number().int().min(1).max(5),
    rowCount: z.number().int().min(0).max(200), complete: z.literal(true) }).strict(),
  rows: z.array(MarketShortRowSchemaV1).max(200),
}).strict();
export type MarketShortInput = z.infer<typeof MarketShortInputSchema>;

/** Immutable, bounded diagnostic inputs. Coverage success is not source qualification. */
export function marketShortInput(raw: unknown): MarketShortInput {
  const input = parse(MarketShortInputSchema, raw);
  if (json(input.registry) !== json(MARKET_SHORT_COVERAGE_V1) || input.source.query.date !== input.date
    || input.source.rowCount !== input.rows.length
    || input.rows.some((row, i) => i > 0 && input.rows[i - 1]!.S33 > row.S33)) fail('reference_conflict');
  inspectMarketShortCoverageV1(input.rows, input.date, tokyoDate(input.source.fetchedAt));
  safe(input);
  // z.unknown() does not clone; use the fully frozen, byte-equal registry after validation.
  return { ...input, registry: MARKET_SHORT_COVERAGE_V1 };
}
function tokyoDate(instant: string): string {
  return new Date(Date.parse(instant) + 9 * 3600_000).toISOString().slice(0, 10);
}
export function marketShortCalculationDate(date: string, acceptedAt: string): string {
  parse(MarketDataInstantV1Schema, acceptedAt);
  const calculationDate = tokyoDate(acceptedAt);
  // A conservative storage boundary, not proof of provider completion or an eligible session.
  if (date > calculationDate || date === calculationDate && acceptedAt < `${calculationDate}T08:30:00.000Z`)
    fail('reference_conflict');
  return calculationDate;
}
function semantic(input: MarketShortInput) {
  const { fetchedAt: _fetched, pageCount: _pages, ...source } = input.source;
  return { ...input, source };
}

/** SW-M1 storage foundation only; no production collector or market module installs this codec. */
export class WorkspaceMarketShortCodec {
  readonly target = MARKET_SHORT_TARGET_V1;
  build(raw: unknown, inputReference: ObjectRef, acceptedAt: string) {
    const input = marketShortInput(raw), ref = parse(ObjectRefSchema, inputReference);
    const calculationDate = marketShortCalculationDate(input.date, acceptedAt);
    if (ref.codec !== 'workspace_market_short_input_v1' || ref.digest !== digest(json(input))
      || input.source.fetchedAt < acceptedAt) fail('reference_conflict');
    const result = inspectMarketShortCoverageV1(input.rows, input.date, calculationDate);
    const payload = { schemaVersion: 'workspace_market_short_artifact_v1' as const,
      calculationVersion: MARKET_SHORT_COVERAGE_V1.calculationVersion,
      asOfCutoff: acceptedAt, calculationDate, dataDate: input.date, fetchedAt: input.source.fetchedAt,
      sourcePayloadDigest: digest(json({ version: 'workspace_market_short_payload_v1', input: semantic(input) })),
      sourceInputs: [{ kind: 'provider' as const, role: 'workspace_source', sourceId: 'workspace_market_short_v1',
        sourceContractVersion: MARKET_SHORT_COVERAGE_V1.sourceDefinition, sourceRevisionIds: ['official_specs_2026_09_14'],
        unitAndCoverageBasis: 'JPY; percent; TSE regular market, 33 sectors plus 9999; source qualification unverified; current fetch is not point-in-time history',
        sourceMappingVersion: MARKET_SHORT_COVERAGE_V1.version, endpoint: input.source.endpoint,
        normalizedQueryIdentity: json(input.source.query), dataDateOrEffectiveRange: input.date,
        publishedDate: null, publishedAt: null, cadence: 'daily', asOfCutoff: acceptedAt,
        entitlementClass: 'standard' as const, entitlementVerifiedAt: input.source.fetchedAt, fetchedAt: input.source.fetchedAt,
        pagination: { complete: true as const, pageCount: input.source.pageCount, rowCount: input.source.rowCount },
        inputDigest: digest(json(semantic(input))) }], inputReference: ref, input, result };
    const value = { ...payload, artifactDigest: digest(json(payload)) }; safe(value); return value;
  }
  parse(raw: unknown) {
    const candidate = parse(z.object({ ...MarketDataArtifactCommonFieldsV1,
      schemaVersion: z.literal('workspace_market_short_artifact_v1'), inputReference: ObjectRefSchema,
      input: MarketShortInputSchema, result: z.unknown() }).strict(), raw);
    const value = this.build(candidate.input, candidate.inputReference, candidate.asOfCutoff);
    if (json(raw) !== json(value)) fail('reference_conflict'); return value;
  }
  identity(value: ReturnType<WorkspaceMarketShortCodec['build']>): MarketDataArtifactIdentityV1 {
    return { scope: 'workspace', tickerOrSourceId: this.target.key, dataDate: value.dataDate,
      sourcePayloadDigest: value.sourcePayloadDigest, artifactDigest: value.artifactDigest,
      rootRelativeIdentity: `workspace/${this.target.key}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }
  equivalent(a: ReturnType<WorkspaceMarketShortCodec['build']>, b: ReturnType<WorkspaceMarketShortCodec['build']>) {
    return a.sourcePayloadDigest === b.sourcePayloadDigest && json(semantic(a.input)) === json(semantic(b.input))
      && json(a.result) === json(b.result);
  }
}
