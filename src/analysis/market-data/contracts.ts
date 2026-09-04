import { z } from 'zod';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { canonicalJsonV1, sha256CanonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { assertEvaluatorInputSafe } from '../snapshot/safety.js';
import { isStrictGregorianDate, parseAsOfCutoff } from '../strategy-validation/date.js';
import { StrategyValidationDigestSchema, StrategyValidationUuidV4Schema } from '../strategy-validation/artifacts.js';

export type MarketDataRepositoryErrorCodeV1 =
  | 'invalid_artifact' | 'artifact_not_found' | 'artifact_corrupt' | 'artifact_collision'
  | 'artifact_write_failed' | 'create_only_publish_unsupported' | 'repository_unsafe'
  | 'repository_unavailable' | 'latest_resolution_failed' | 'artifact_recovery_bound_exceeded';

export class MarketDataRepositoryErrorV1 extends Error {
  constructor(readonly code: MarketDataRepositoryErrorCodeV1) {
    // No provider value, filesystem path or underlying exception is exposed.
    super(`Market data repository failure: ${code}.`);
    this.name = 'MarketDataRepositoryErrorV1';
  }
}

export type MarketDataReceiptPublicationProofV1 =
  | Readonly<{ receiptState: 'definitely_absent' }>
  | Readonly<{ receiptState: 'ambiguous';
    contentPublicationState: 'published' | 'idempotent_reuse' }>;

/** Proof carried across the repository/service boundary after publication fails.
 * A filesystem error code alone never proves whether the receipt commit point
 * was reached.
 */
export class MarketDataReceiptPublicationErrorV1 extends MarketDataRepositoryErrorV1 {
  constructor(code: 'artifact_write_failed' | 'create_only_publish_unsupported',
    readonly proof: MarketDataReceiptPublicationProofV1) {
    super(code);
    this.name = 'MarketDataReceiptPublicationErrorV1';
  }
}
export function failMarketData(code: MarketDataRepositoryErrorCodeV1): never {
  throw new MarketDataRepositoryErrorV1(code);
}

export const MarketDataDateV1Schema = z.string().refine(isStrictGregorianDate);
export const MarketDataInstantV1Schema = z.string().refine(value => {
  try { return parseAsOfCutoff(value) === value && Date.parse(value) >= 0; }
  catch { return false; }
});
const token = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
const safeText = z.string().min(1).max(2048);
const dateRange = z.object({ from: MarketDataDateV1Schema, through: MarketDataDateV1Schema })
  .strict().refine(value => value.from <= value.through);
const revisions = z.array(token).min(1).max(32).refine(values =>
  values.every((value, i) => i === 0 || values[i - 1]! < value));
const identityFields = {
  role: token, sourceId: token, sourceContractVersion: token, sourceRevisionIds: revisions,
  unitAndCoverageBasis: safeText,
};
const providerFields = {
  kind: z.literal('provider'), ...identityFields,
  sourceMappingVersion: token, endpoint: z.string().regex(/^\/v2\/[a-z0-9/-]+$/).max(160),
  normalizedQueryIdentity: safeText,
  dataDateOrEffectiveRange: z.union([MarketDataDateV1Schema, dateRange]),
  publishedDate: MarketDataDateV1Schema.nullable(), publishedAt: MarketDataInstantV1Schema.nullable(),
  cadence: token,
};
const registryFields = {
  kind: z.literal('registry'), ...identityFields, registryVersion: token,
  registryId: token, effectiveRange: dateRange,
};
export const SourceInputIdentityV1Schema = z.discriminatedUnion('kind', [
  z.object(providerFields).strict(), z.object(registryFields).strict(),
]);
export const SourceInputV1Schema = z.discriminatedUnion('kind', [
  z.object({ ...providerFields, asOfCutoff: MarketDataInstantV1Schema,
    entitlementClass: z.enum(['standard', 'premium']), entitlementVerifiedAt: MarketDataInstantV1Schema,
    fetchedAt: MarketDataInstantV1Schema,
    pagination: z.object({ complete: z.literal(true), pageCount: z.number().int().positive().safe(),
      rowCount: z.number().int().nonnegative().safe() }).strict(),
    inputDigest: StrategyValidationDigestSchema,
  }).strict(),
  z.object({ ...registryFields, asOfCutoff: MarketDataInstantV1Schema,
    inputDigest: StrategyValidationDigestSchema }).strict(),
]);
export type SourceInputV1 = z.infer<typeof SourceInputV1Schema>;
export type SourceInputIdentityV1 = z.infer<typeof SourceInputIdentityV1Schema>;

export const MARKET_DATA_MODULE_IDS_V1 = [
  'tse_margin_quantities', 'market_short_ratio', 'margin_1570',
  'tokyo_nagoya_foreign_flow', 'etf_1321_eod', 'etf_1321_2633_relative',
] as const;
export const MARKET_DATA_CALCULATION_VERSIONS_V1 = [
  'technical_chart_calculation_v1', 'tse_margin_quantities_calculation_v1',
  'market_short_ratio_calculation_v1', 'margin_1570_calculation_v1',
  'tokyo_nagoya_foreign_flow_calculation_v1', 'etf_1321_eod_calculation_v1',
  'etf_1321_2633_relative_calculation_v1',
] as const;
export type MarketDataModuleIdV1 = typeof MARKET_DATA_MODULE_IDS_V1[number];
export type MarketDataCalculationVersionV1 = typeof MARKET_DATA_CALCULATION_VERSIONS_V1[number];
const overviewTargetFields = { kind: z.literal('overview'), moduleId: z.enum(MARKET_DATA_MODULE_IDS_V1),
  sourceId: z.enum(MARKET_DATA_MODULE_IDS_V1.map(id => `${id}_v1` as const)) };
export const MarketDataTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('technical'), ticker: CanonicalTickerSchema }).strict(),
  z.object(overviewTargetFields).strict(),
]).refine(target => target.kind === 'technical' || target.sourceId === `${target.moduleId}_v1`);
export type MarketDataTargetV1 = z.infer<typeof MarketDataTargetV1Schema>;
const envelopeTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('technical'), ticker: CanonicalTickerSchema,
    jquantsCode: z.string() }).strict(),
  z.object(overviewTargetFields).strict(),
]);
const etfHistoryRoles = (ticker: string) => ['security_master', 'daily_bars',
  'corporate_action_registry'].map(role => `${role}_${ticker}`);
const roleSets: Readonly<Record<'technical' | MarketDataModuleIdV1, readonly string[]>> = {
  technical: ['security_master', 'trading_calendar', 'daily_bars'],
  tse_margin_quantities: ['security_master_population', 'trading_calendar', 'margin_cadence_registry', 'margin_rows'],
  market_short_ratio: ['trading_calendar', 'short_ratio_schedule_registry', 'sector_coverage_registry', 'short_ratio_rows'],
  margin_1570: ['security_master_1570', 'trading_calendar', 'margin_cadence_registry', 'margin_rows', 'corporate_action_registry_1570'],
  tokyo_nagoya_foreign_flow: ['trading_calendar', 'investor_type_schedule_registry', 'investor_type_rows'],
  etf_1321_eod: [...etfHistoryRoles('1321'), 'trading_calendar'],
  etf_1321_2633_relative: [...etfHistoryRoles('1321'), ...etfHistoryRoles('2633'), 'trading_calendar'],
};
export function marketDataRolesV1(target: MarketDataTargetV1): readonly string[] {
  return [...roleSets[target.kind === 'technical' ? 'technical' : target.moduleId]].sort();
}
export const MarketDataSourcePayloadEnvelopeV1Schema = z.object({
  kind: z.literal('dexter_market_data_source_payload'), version: z.literal(1),
  target: envelopeTarget, dataDate: MarketDataDateV1Schema, calculationDate: MarketDataDateV1Schema,
  calculationVersion: z.enum(MARKET_DATA_CALCULATION_VERSIONS_V1),
  sourceInputs: z.array(z.object({ role: token, inputDigest: StrategyValidationDigestSchema }).strict()).min(1).max(8),
}).strict().refine(value => {
  const target = value.target;
  if (target.kind === 'technical' ? target.jquantsCode !== `${target.ticker}0`
    : target.sourceId !== `${target.moduleId}_v1`) return false;
  const calculation = target.kind === 'technical' ? 'technical_chart_calculation_v1'
    : `${target.moduleId}_calculation_v1`;
  return value.calculationVersion === calculation && value.dataDate <= value.calculationDate
    && canonicalJsonV1(value.sourceInputs.map(input => input.role)) === canonicalJsonV1(marketDataRolesV1(target));
});
export type MarketDataSourcePayloadEnvelopeV1 = z.infer<typeof MarketDataSourcePayloadEnvelopeV1Schema>;
export function digestMarketDataSourcePayloadV1(raw: unknown): string {
  const value = MarketDataSourcePayloadEnvelopeV1Schema.safeParse(raw);
  if (!value.success) return failMarketData('invalid_artifact');
  return sha256CanonicalJsonV1(value.data);
}

/** The caller is the reviewed source mapper: its closed row schema and canonical
 * order check must reject raw provider fields. No default/open mapper is installed.
 */
export function digestMarketSourceInputV1<T extends CanonicalJsonValue>(raw: unknown,
  observations: unknown, validateOrderedRows: (raw: unknown) => T,
  environment: NodeJS.ProcessEnv = process.env): string {
  const identity = SourceInputIdentityV1Schema.safeParse(raw);
  if (!identity.success) return failMarketData('invalid_artifact');
  try {
    const rows = validateOrderedRows(observations);
    if (canonicalJsonV1(rows) !== canonicalJsonV1(observations as CanonicalJsonValue)) {
      return failMarketData('invalid_artifact');
    }
    const payload = { kind: 'dexter_market_source_input', version: 1, identity: identity.data, observations: rows };
    assertMarketDataSafeV1(payload, environment);
    return sha256CanonicalJsonV1(payload);
  } catch { return failMarketData('invalid_artifact'); }
}

export function assertMarketDataSafeV1(value: CanonicalJsonValue, environment: NodeJS.ProcessEnv): void {
  // Reuse the existing configured-secret, marker, control-character and path grammar.
  // Walk individual strings so the Evaluator logical-input cap is not an artifact cap.
  function visit(item: CanonicalJsonValue): void {
    if (typeof item === 'string') {
      assertEvaluatorInputSafe({ reportMarkdown: '', logicalInput: item, evidenceManifest: item }, environment);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item !== null && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) { visit(key); visit(child); }
    }
  }
  try { visit(value); } catch { failMarketData('invalid_artifact'); }
}

const identityFieldsV1 = { scope: z.enum(['technical', 'overview']), tickerOrSourceId: z.string(),
  rootRelativeIdentity: z.string() };
function validScope(scope: string, key: string): boolean {
  return scope === 'technical' ? CanonicalTickerSchema.safeParse(key).success
    : MARKET_DATA_MODULE_IDS_V1.some(id => key === `${id}_v1`);
}
export const MarketDataArtifactIdentityV1Schema = z.object({ ...identityFieldsV1,
  dataDate: MarketDataDateV1Schema, sourcePayloadDigest: StrategyValidationDigestSchema,
  artifactDigest: StrategyValidationDigestSchema,
}).strict().refine(v => validScope(v.scope, v.tickerOrSourceId)
  && v.rootRelativeIdentity === `${v.scope}/${v.tickerOrSourceId}/${v.dataDate}/${v.sourcePayloadDigest.slice(7)}.json`);
export type MarketDataArtifactIdentityV1 = z.infer<typeof MarketDataArtifactIdentityV1Schema>;
export const MarketDataObservationReceiptIdentityV1Schema = z.object({ ...identityFieldsV1,
  acceptedAtEpochMs: z.number().int().nonnegative().safe(), jobId: StrategyValidationUuidV4Schema,
  receiptDigest: StrategyValidationDigestSchema,
}).strict().refine(v => validScope(v.scope, v.tickerOrSourceId)
  && v.rootRelativeIdentity === `observations/${v.scope}/${v.tickerOrSourceId}/${v.acceptedAtEpochMs}_${v.jobId}.json`);
export type MarketDataObservationReceiptIdentityV1 = z.infer<typeof MarketDataObservationReceiptIdentityV1Schema>;
export const MarketDataObservationReceiptV1Schema = z.object({
  schemaVersion: z.literal('market_data_observation_receipt_v1'), jobId: StrategyValidationUuidV4Schema,
  target: MarketDataTargetV1Schema, acceptedAt: MarketDataInstantV1Schema, checkedAt: MarketDataInstantV1Schema,
  artifactIdentity: MarketDataArtifactIdentityV1Schema, receiptDigest: StrategyValidationDigestSchema,
}).strict().refine(v => v.checkedAt >= v.acceptedAt && v.artifactIdentity.scope === v.target.kind
  && v.artifactIdentity.tickerOrSourceId === marketDataTargetKeyV1(v.target));
export type MarketDataObservationReceiptV1 = z.infer<typeof MarketDataObservationReceiptV1Schema>;
export function marketDataTargetKeyV1(target: MarketDataTargetV1): string {
  return target.kind === 'technical' ? target.ticker : target.sourceId;
}
export function receiptIdentityV1(receipt: MarketDataObservationReceiptV1): MarketDataObservationReceiptIdentityV1 {
  const acceptedAtEpochMs = Date.parse(receipt.acceptedAt);
  const scope = receipt.target.kind, tickerOrSourceId = marketDataTargetKeyV1(receipt.target);
  return MarketDataObservationReceiptIdentityV1Schema.parse({ scope, tickerOrSourceId,
    acceptedAtEpochMs, jobId: receipt.jobId, receiptDigest: receipt.receiptDigest,
    rootRelativeIdentity: `observations/${scope}/${tickerOrSourceId}/${acceptedAtEpochMs}_${receipt.jobId}.json` });
}
export function validateReceiptV1(raw: unknown): MarketDataObservationReceiptV1 {
  const result = MarketDataObservationReceiptV1Schema.safeParse(raw);
  if (!result.success) return failMarketData('artifact_corrupt');
  const { receiptDigest, ...preimage } = result.data;
  if (sha256CanonicalJsonV1(preimage) !== receiptDigest) return failMarketData('artifact_corrupt');
  return result.data;
}
