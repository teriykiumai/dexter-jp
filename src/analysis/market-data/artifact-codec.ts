import { z } from 'zod';
import { canonicalJsonV1, sha256CanonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { tokyoDateFromUtcInstantV1 } from '../strategy-validation/date.js';
import {
  MARKET_DATA_CALCULATION_VERSIONS_V1, MarketDataDateV1Schema, MarketDataInstantV1Schema,
  MarketDataSourcePayloadEnvelopeV1Schema, MarketDataTargetV1Schema, SourceInputV1Schema,
  assertMarketDataSafeV1, digestMarketDataSourcePayloadV1, failMarketData, marketDataTargetKeyV1,
  type MarketDataArtifactIdentityV1, type MarketDataCalculationVersionV1,
  type MarketDataSourcePayloadEnvelopeV1, type MarketDataTargetV1, type SourceInputV1,
} from './contracts.js';

export const MarketDataArtifactCommonFieldsV1 = {
  calculationVersion: z.enum(MARKET_DATA_CALCULATION_VERSIONS_V1),
  asOfCutoff: MarketDataInstantV1Schema, calculationDate: MarketDataDateV1Schema,
  dataDate: MarketDataDateV1Schema, fetchedAt: MarketDataInstantV1Schema,
  sourceInputs: z.array(SourceInputV1Schema).min(1).max(8),
  sourcePayloadDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
};
const commonSchema = z.object(MarketDataArtifactCommonFieldsV1).strict();
export type MarketDataArtifactFieldsV1 = z.infer<typeof commonSchema>;

export interface MarketDataArtifactCodecOptionsV1<T extends MarketDataArtifactFieldsV1> {
  /** Full, closed module-owned schema, including all output invariants. No codec
   * is installed in production by DR-A1: source gates and module steps own these.
   */
  schema: z.ZodType<T>;
  target: MarketDataTargetV1;
  /** Pins source/role/mapping/revision allowlists and query/basis coverage in code.
   * Read-time checks do NOT pretend to rehash unavailable original source rows.
   */
  validateSourceInputs: (inputs: readonly SourceInputV1[], artifact: T) => void;
  environment?: NodeJS.ProcessEnv;
}

function json(value: unknown): CanonicalJsonValue { return value as CanonicalJsonValue; }
function same(left: unknown, right: unknown): boolean {
  return canonicalJsonV1(json(left)) === canonicalJsonV1(json(right));
}

export class MarketDataArtifactCodecV1<T extends MarketDataArtifactFieldsV1> {
  readonly target: MarketDataTargetV1;
  private readonly options: MarketDataArtifactCodecOptionsV1<T>;
  constructor(options: MarketDataArtifactCodecOptionsV1<T>) {
    const target = MarketDataTargetV1Schema.safeParse(options.target);
    if (!target.success) failMarketData('invalid_artifact');
    this.target = Object.freeze(target.data);
    this.options = { ...options };
  }

  private fields(raw: unknown): T {
    try {
      const value = this.options.schema.parse(raw);
      // Reject stripping, coercion and normalization at the persistence boundary.
      if (!same(raw, value)) return failMarketData('invalid_artifact');
      if (this.options.schema.safeParse({ ...value, __market_data_unknown_field__: null }).success) {
        return failMarketData('invalid_artifact');
      }
      const record = value as unknown as Record<string, unknown>;
      commonSchema.parse(Object.fromEntries(Object.keys(MarketDataArtifactCommonFieldsV1)
        .map(key => [key, record[key]])));
      const technical = this.target.kind === 'technical';
      if (record.schemaVersion !== (technical ? 'technical_chart_dataset_v1' : 'market_overview_module_v1')) {
        return failMarketData('invalid_artifact');
      }
      if (technical ? record.ticker !== marketDataTargetKeyV1(this.target)
        || record.jquantsCode !== `${marketDataTargetKeyV1(this.target)}0`
        || record.acceptedAt !== value.asOfCutoff
        : record.moduleId !== (this.target.kind === 'overview' ? this.target.moduleId : '')
        || record.sourceId !== marketDataTargetKeyV1(this.target)) return failMarketData('invalid_artifact');
      if (tokyoDateFromUtcInstantV1(value.asOfCutoff) !== value.calculationDate) return failMarketData('invalid_artifact');
      const providers = value.sourceInputs.filter(input => input.kind === 'provider');
      if (providers.length === 0 || providers.map(input => input.fetchedAt).sort().at(-1) !== value.fetchedAt) {
        return failMarketData('invalid_artifact');
      }
      for (const input of value.sourceInputs) {
        if (input.asOfCutoff !== value.asOfCutoff) return failMarketData('invalid_artifact');
        if (input.kind === 'provider' && (input.fetchedAt < value.asOfCutoff
          || input.entitlementVerifiedAt > input.fetchedAt
          || (input.publishedAt !== null && input.publishedAt > input.asOfCutoff)
          || (input.publishedDate !== null && input.publishedDate > value.calculationDate))) {
          return failMarketData('invalid_artifact');
        }
      }
      this.envelope(value);
      this.options.validateSourceInputs(value.sourceInputs, value);
      assertMarketDataSafeV1(json(value), this.options.environment ?? process.env);
      return value;
    } catch { return failMarketData('invalid_artifact'); }
  }

  envelope(value: MarketDataArtifactFieldsV1): MarketDataSourcePayloadEnvelopeV1 {
    return MarketDataSourcePayloadEnvelopeV1Schema.parse({
      kind: 'dexter_market_data_source_payload', version: 1,
      target: this.target.kind === 'technical' ? { ...this.target, jquantsCode: `${this.target.ticker}0` } : this.target,
      dataDate: value.dataDate, calculationDate: value.calculationDate,
      calculationVersion: value.calculationVersion as MarketDataCalculationVersionV1,
      sourceInputs: value.sourceInputs.map(input => ({ role: input.role, inputDigest: input.inputDigest })),
    });
  }

  build(rawDraft: unknown): T {
    try {
      if (rawDraft === null || typeof rawDraft !== 'object' || Array.isArray(rawDraft)
        || 'sourcePayloadDigest' in rawDraft || 'artifactDigest' in rawDraft) return failMarketData('invalid_artifact');
      const draft = this.fields({ ...rawDraft, sourcePayloadDigest: `sha256:${'0'.repeat(64)}`,
        artifactDigest: `sha256:${'0'.repeat(64)}` });
      const sourcePayloadDigest = digestMarketDataSourcePayloadV1(this.envelope(draft));
      const { artifactDigest: _placeholder, ...payload } = { ...draft, sourcePayloadDigest };
      return this.parse({ ...payload, artifactDigest: sha256CanonicalJsonV1(json(payload)) });
    } catch { return failMarketData('invalid_artifact'); }
  }

  parse(raw: unknown): T {
    const value = this.fields(raw);
    const { artifactDigest, ...payload } = value;
    if (value.sourcePayloadDigest !== digestMarketDataSourcePayloadV1(this.envelope(value))
      || artifactDigest !== sha256CanonicalJsonV1(json(payload))) return failMarketData('invalid_artifact');
    return value;
  }

  identity(value: T): MarketDataArtifactIdentityV1 {
    const scope = this.target.kind, tickerOrSourceId = marketDataTargetKeyV1(this.target);
    return { scope, tickerOrSourceId, dataDate: value.dataDate, sourcePayloadDigest: value.sourcePayloadDigest,
      artifactDigest: value.artifactDigest,
      rootRelativeIdentity: `${scope}/${tickerOrSourceId}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }

  equivalent(left: T, right: T): boolean {
    function projection(value: T) {
      const { acceptedAt: _accepted, asOfCutoff: _cutoff, fetchedAt: _fetched,
        artifactDigest: _digest, sourceInputs, ...deterministic } = value as T & { acceptedAt?: string };
      return { ...deterministic, sourceInputs: sourceInputs.map(input => ({ role: input.role, inputDigest: input.inputDigest })) };
    }
    return same(projection(left), projection(right));
  }
}
