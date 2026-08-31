import { posix, win32 } from 'node:path';
import { z } from 'zod';
import {
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import { SnapshotIdSchema } from '../snapshot/id.js';
import { assertStoredReportSafe } from '../snapshot/safety.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { isStrictGregorianDate } from './date.js';
import { parseStrictJsonBytesV1, StrictJsonErrorV1 } from './strict-json.js';

export const STRATEGY_VALIDATION_CAMPAIGN_SCHEMA_VERSION =
  'strategy_validation_campaign_v1' as const;
export const STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES = 1_048_576 as const;
export const STRATEGY_VALIDATION_CAMPAIGN_MAX_ANCHORS = 500 as const;
export const STRATEGY_VALIDATION_CAMPAIGN_MAX_SNAPSHOT_REFS = 8 as const;
export const STRATEGY_VALIDATION_MAX_RESISTANCE_LEVELS = 16 as const;

export type StrategyValidationManifestErrorKindV1 =
  | 'input_too_large'
  | 'invalid_utf8'
  | 'bom_not_allowed'
  | 'malformed_json'
  | 'duplicate_object_key'
  | 'schema_validation_failed'
  | 'unsafe_name'
  | 'duplicate_anchor';

export class StrategyValidationManifestErrorV1 extends Error {
  constructor(public readonly kind: StrategyValidationManifestErrorKindV1) {
    const messages: Readonly<Record<StrategyValidationManifestErrorKindV1, string>> = {
      input_too_large: 'The campaign manifest exceeds 1 MiB.',
      invalid_utf8: 'The campaign manifest is not valid UTF-8.',
      bom_not_allowed: 'The campaign manifest must not contain a UTF-8 BOM.',
      malformed_json: 'The campaign manifest contains malformed JSON.',
      duplicate_object_key: 'The campaign manifest contains a duplicate object key.',
      schema_validation_failed: 'The campaign manifest does not match its strict schema.',
      unsafe_name: 'The campaign name is unsafe or invalid.',
      duplicate_anchor: 'The campaign manifest contains a duplicate ticker and anchor date.',
    };
    super(messages[kind]);
    this.name = 'StrategyValidationManifestErrorV1';
  }
}

const strictDateSchema = z.string().refine(isStrictGregorianDate);

export const StrategyValidationSnapshotReferenceV1Schema = z.object({
  kind: z.literal('analysis_snapshot'),
  snapshotId: SnapshotIdSchema,
}).strict();

export const StrategyValidationCampaignAnchorV1Schema = z.object({
  ticker: CanonicalTickerSchema,
  anchorDate: strictDateSchema,
  resistanceEvidence: z.array(StrategyValidationSnapshotReferenceV1Schema)
    .max(STRATEGY_VALIDATION_CAMPAIGN_MAX_SNAPSHOT_REFS),
}).strict();

const CampaignManifestWireV1Schema = z.object({
  schemaVersion: z.literal(STRATEGY_VALIDATION_CAMPAIGN_SCHEMA_VERSION),
  name: z.string(),
  anchors: z.array(StrategyValidationCampaignAnchorV1Schema)
    .min(1)
    .max(STRATEGY_VALIDATION_CAMPAIGN_MAX_ANCHORS),
}).strict();

export type StrategyValidationSnapshotReferenceV1 = Readonly<z.infer<
  typeof StrategyValidationSnapshotReferenceV1Schema
>>;
export type StrategyValidationCampaignAnchorV1 = Readonly<{
  ticker: string;
  anchorDate: string;
  resistanceEvidence: readonly StrategyValidationSnapshotReferenceV1[];
}>;
export type StrategyValidationCampaignManifestV1 = Readonly<{
  schemaVersion: typeof STRATEGY_VALIDATION_CAMPAIGN_SCHEMA_VERSION;
  name: string;
  anchors: readonly StrategyValidationCampaignAnchorV1[];
}>;

export function normalizeStrategyValidationCampaignNameV1(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalized = value.normalize('NFC');
  if (Array.from(normalized).length < 1
    || Array.from(normalized).length > 64
    || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized === '.'
    || normalized === '..'
    || /^[A-Za-z]:/.test(normalized)
    || win32.isAbsolute(normalized)
    || posix.isAbsolute(normalized)) {
    throw new StrategyValidationManifestErrorV1('unsafe_name');
  }
  try {
    assertStoredReportSafe(normalized, env);
  } catch {
    throw new StrategyValidationManifestErrorV1('unsafe_name');
  }
  return normalized;
}

function freezeManifest(
  parsed: z.infer<typeof CampaignManifestWireV1Schema>,
  env: NodeJS.ProcessEnv,
): StrategyValidationCampaignManifestV1 {
  const seen = new Set<string>();
  const anchors = parsed.anchors.map(anchor => {
    const identity = `${anchor.ticker}\u0000${anchor.anchorDate}`;
    if (seen.has(identity)) throw new StrategyValidationManifestErrorV1('duplicate_anchor');
    seen.add(identity);
    return Object.freeze({
      ticker: anchor.ticker,
      anchorDate: anchor.anchorDate,
      resistanceEvidence: Object.freeze(anchor.resistanceEvidence.map(reference => (
        Object.freeze({ ...reference })
      ))),
    });
  });
  return Object.freeze({
    schemaVersion: STRATEGY_VALIDATION_CAMPAIGN_SCHEMA_VERSION,
    name: normalizeStrategyValidationCampaignNameV1(parsed.name, env),
    anchors: Object.freeze(anchors),
  });
}

export function validateStrategyValidationCampaignManifestV1(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): StrategyValidationCampaignManifestV1 {
  const parsed = CampaignManifestWireV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new StrategyValidationManifestErrorV1('schema_validation_failed');
  }
  return freezeManifest(parsed.data, env);
}

export function parseStrategyValidationCampaignJsonV1(
  bytes: Uint8Array,
  env: NodeJS.ProcessEnv = process.env,
): StrategyValidationCampaignManifestV1 {
  let raw: unknown;
  try {
    raw = parseStrictJsonBytesV1(bytes, STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES);
  } catch (error) {
    if (error instanceof StrictJsonErrorV1) {
      throw new StrategyValidationManifestErrorV1(error.kind);
    }
    throw error;
  }
  return validateStrategyValidationCampaignManifestV1(raw, env);
}

export function digestStrategyValidationCampaignManifestV1(
  manifest: StrategyValidationCampaignManifestV1,
): SnapshotDigest {
  const validated = validateStrategyValidationCampaignManifestV1(manifest, {});
  return sha256CanonicalJsonV1(validated as CanonicalJsonValue);
}

export type StrategyValidationInputV1 =
  | Readonly<{
    mode: 'snapshot';
    ticker: string;
    snapshotId: string;
  }>
  | Readonly<{
    mode: 'campaign';
    manifest: StrategyValidationCampaignManifestV1;
  }>;

const SnapshotInputV1Schema = z.object({
  mode: z.literal('snapshot'),
  ticker: CanonicalTickerSchema,
  snapshotId: SnapshotIdSchema,
}).strict();
const CampaignInputV1Schema = z.object({
  mode: z.literal('campaign'),
  manifest: CampaignManifestWireV1Schema,
}).strict();

export function validateStrategyValidationInputV1(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): StrategyValidationInputV1 {
  const snapshot = SnapshotInputV1Schema.safeParse(value);
  if (snapshot.success) return Object.freeze(snapshot.data);
  const campaign = CampaignInputV1Schema.safeParse(value);
  if (!campaign.success) {
    throw new StrategyValidationManifestErrorV1('schema_validation_failed');
  }
  return Object.freeze({
    mode: 'campaign',
    manifest: freezeManifest(campaign.data.manifest, env),
  });
}

export function digestStrategyValidationInputV1(input: StrategyValidationInputV1): SnapshotDigest {
  const validated = validateStrategyValidationInputV1(input, {});
  return sha256CanonicalJsonV1({
    kind: 'strategy_validation_input',
    version: 1,
    input: validated,
  } as CanonicalJsonValue);
}

export function normalizeStrategyValidationResistanceLevelsV1(
  values: readonly unknown[],
): readonly number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
      throw new StrategyValidationManifestErrorV1('schema_validation_failed');
    }
    unique.add(Object.is(value, -0) ? 0 : value);
  }
  if (unique.size > STRATEGY_VALIDATION_MAX_RESISTANCE_LEVELS) {
    throw new StrategyValidationManifestErrorV1('schema_validation_failed');
  }
  return Object.freeze([...unique].sort((left, right) => left - right));
}
