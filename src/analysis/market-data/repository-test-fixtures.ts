import { z } from 'zod';
import { MarketDataArtifactCodecV1, MarketDataArtifactCommonFieldsV1 } from './artifact-codec.js';
import { digestMarketSourceInputV1, marketDataRolesV1, type SourceInputV1, type MarketDataTargetV1,
  type MarketDataModuleIdV1, type MarketDataCalculationVersionV1 } from './contracts.js';
import { SourceInputIdentityV1Schema } from './contracts.js';
import { CurrentCodeWarningInputV1Schema, MarketDataWarningV1Schema,
  type CurrentCodeWarningInputV1, type MarketDataWarningV1 } from './job-schema.js';

// Synthetic storage codecs only. These are not Technical/Overview production
// output schemas and must never be registered with a Dashboard source adapter.
const result = z.object({ identity: z.literal('synthetic'), value: z.number().finite() }).strict();
const common = { ...MarketDataArtifactCommonFieldsV1, syntheticResult: result,
  warnings: z.array(MarketDataWarningV1Schema) };
export const technicalFixtureSchema = z.object({ ...common,
  schemaVersion: z.literal('technical_chart_dataset_v1'), calculationVersion: z.literal('technical_chart_calculation_v1'),
  ticker: z.literal('7203'), jquantsCode: z.literal('72030'), acceptedAt: z.string(),
}).strict();
export const overviewFixtureSchema = z.object({ ...common,
  schemaVersion: z.literal('market_overview_module_v1'), calculationVersion: z.literal('market_short_ratio_calculation_v1'),
  moduleId: z.literal('market_short_ratio'), sourceId: z.literal('market_short_ratio_v1'),
  syntheticCurrentCodeWarningInput: CurrentCodeWarningInputV1Schema.nullable(),
}).strict();
const overviewCalculationVersions: Record<MarketDataModuleIdV1, MarketDataCalculationVersionV1> = {
  tse_margin_quantities: 'tse_margin_quantities_calculation_v1',
  market_short_ratio: 'market_short_ratio_calculation_v1',
  margin_1570: 'margin_1570_calculation_v1',
  tokyo_nagoya_foreign_flow: 'tokyo_nagoya_foreign_flow_calculation_v1',
  etf_1321_eod: 'etf_1321_eod_calculation_v1',
  etf_1321_2633_relative: 'etf_1321_2633_relative_calculation_v1',
};
export function fixtureOverviewCodec(moduleId: MarketDataModuleIdV1, environment: NodeJS.ProcessEnv = {}) {
  const calculationVersion = overviewCalculationVersions[moduleId];
  return new MarketDataArtifactCodecV1({
    schema: z.object({ ...common, schemaVersion: z.literal('market_overview_module_v1'),
      calculationVersion: z.literal(calculationVersion), moduleId: z.literal(moduleId),
      sourceId: z.literal(`${moduleId}_v1` as const),
      syntheticCurrentCodeWarningInput: CurrentCodeWarningInputV1Schema.nullable() }).strict(),
    target: { kind: 'overview', moduleId, sourceId: `${moduleId}_v1` }, environment,
    validateSourceInputs: inputs => validateSyntheticInputs(inputs),
  });
}
function validateSyntheticInputs(inputs: readonly SourceInputV1[]) {
  for (const input of inputs) {
    if (input.sourceId !== 'synthetic_source_v1' || input.sourceContractVersion !== 'synthetic_contract_v1'
      || input.sourceRevisionIds.length !== 1 || input.sourceRevisionIds[0] !== 'synthetic_revision_v1'
      || input.unitAndCoverageBasis !== 'synthetic_fixture'
      || (input.kind === 'provider' ? input.sourceMappingVersion !== 'synthetic_mapping_v1'
        || input.endpoint !== '/v2/markets/calendar' : input.registryVersion !== 'synthetic_registry_v1')) {
      throw new Error('Invalid synthetic input.');
    }
  }
}
export function fixtureCodec(technical = false, environment: NodeJS.ProcessEnv = {}) {
  const target: MarketDataTargetV1 = technical ? { kind: 'technical', ticker: '7203' }
    : { kind: 'overview', moduleId: 'market_short_ratio', sourceId: 'market_short_ratio_v1' };
  return new MarketDataArtifactCodecV1({
    schema: z.union([technicalFixtureSchema, overviewFixtureSchema]), target, environment,
    validateSourceInputs: inputs => validateSyntheticInputs(inputs),
  });
}
export type FixtureArtifact = ReturnType<ReturnType<typeof fixtureCodec>['build']>;
export function sourceInputIdentity(input: SourceInputV1) {
  const { inputDigest: _digest, asOfCutoff: _cutoff, ...rest } = input;
  if (rest.kind === 'provider') {
    const { fetchedAt: _fetch, entitlementClass: _class, entitlementVerifiedAt: _verified,
      pagination: _pagination, ...identity } = rest;
    return SourceInputIdentityV1Schema.parse(identity);
  }
  return SourceInputIdentityV1Schema.parse(rest);
}
export function fixtureDraft(acceptedAt = '2026-09-03T07:30:00.000Z', value = 0, technical = false,
  warnings: readonly MarketDataWarningV1[] = []) {
  const codec = fixtureCodec(technical);
  const fetchedAt = new Date(Date.parse(acceptedAt) + 1000).toISOString();
  const calculationDate = new Date(Date.parse(acceptedAt) + 9 * 3600000).toISOString().slice(0, 10);
  const sourceInputs = marketDataRolesV1(codec.target).map((role, i): SourceInputV1 => {
    const fields = { role, sourceId: 'synthetic_source_v1', sourceContractVersion: 'synthetic_contract_v1',
      sourceRevisionIds: ['synthetic_revision_v1'], unitAndCoverageBasis: 'synthetic_fixture', asOfCutoff: acceptedAt };
    const input: SourceInputV1 = role.includes('registry') ? {
      ...fields, kind: 'registry', registryVersion: 'synthetic_registry_v1', registryId: 'synthetic_registry',
      effectiveRange: { from: '2026-09-01', through: '2026-09-03' }, inputDigest: `sha256:${'0'.repeat(64)}`,
    } : { ...fields, kind: 'provider', sourceMappingVersion: 'synthetic_mapping_v1',
      endpoint: '/v2/markets/calendar', normalizedQueryIdentity: 'synthetic_query',
      dataDateOrEffectiveRange: '2026-09-03', publishedDate: null, publishedAt: null,
      cadence: 'daily', entitlementClass: 'standard', entitlementVerifiedAt: acceptedAt,
      fetchedAt: new Date(Date.parse(fetchedAt) + i).toISOString(),
      pagination: { complete: true, pageCount: 1, rowCount: 1 }, inputDigest: `sha256:${'0'.repeat(64)}` };
    input.inputDigest = digestMarketSourceInputV1(sourceInputIdentity(input), [{ value }],
      raw => z.array(z.object({ value: z.number().finite() }).strict()).parse(raw), {});
    return input;
  });
  const metadata = { asOfCutoff: acceptedAt, calculationDate, dataDate: '2026-09-03',
    fetchedAt: sourceInputs.filter(i => i.kind === 'provider').map(i => i.fetchedAt).sort().at(-1)!,
    sourceInputs, syntheticResult: { identity: 'synthetic', value }, warnings: [...warnings] };
  return technical ? { ...metadata, schemaVersion: 'technical_chart_dataset_v1',
    calculationVersion: 'technical_chart_calculation_v1', ticker: '7203', jquantsCode: '72030', acceptedAt }
    : { ...metadata, schemaVersion: 'market_overview_module_v1',
      calculationVersion: 'market_short_ratio_calculation_v1', moduleId: 'market_short_ratio',
      sourceId: 'market_short_ratio_v1', syntheticCurrentCodeWarningInput: null };
}
export function fixtureOverviewDraft(moduleId: MarketDataModuleIdV1,
  acceptedAt = '2026-09-03T07:30:00.000Z', value = 0,
  warnings: readonly MarketDataWarningV1[] = [],
  currentCodeWarningInput: CurrentCodeWarningInputV1 | null = null) {
  const codec = fixtureOverviewCodec(moduleId);
  const fetchedAt = new Date(Date.parse(acceptedAt) + 1000).toISOString();
  const calculationDate = new Date(Date.parse(acceptedAt) + 9 * 3600000).toISOString().slice(0, 10);
  const sourceInputs = marketDataRolesV1(codec.target).map((role, i): SourceInputV1 => {
    const fields = { role, sourceId: 'synthetic_source_v1', sourceContractVersion: 'synthetic_contract_v1',
      sourceRevisionIds: ['synthetic_revision_v1'], unitAndCoverageBasis: 'synthetic_fixture', asOfCutoff: acceptedAt };
    const input: SourceInputV1 = role.includes('registry') ? {
      ...fields, kind: 'registry', registryVersion: 'synthetic_registry_v1', registryId: 'synthetic_registry',
      effectiveRange: { from: '2026-09-01', through: '2026-09-03' }, inputDigest: `sha256:${'0'.repeat(64)}`,
    } : { ...fields, kind: 'provider', sourceMappingVersion: 'synthetic_mapping_v1',
      endpoint: '/v2/markets/calendar', normalizedQueryIdentity: 'synthetic_query',
      dataDateOrEffectiveRange: '2026-09-03', publishedDate: null, publishedAt: null,
      cadence: 'daily', entitlementClass: 'standard', entitlementVerifiedAt: acceptedAt,
      fetchedAt: new Date(Date.parse(fetchedAt) + i).toISOString(),
      pagination: { complete: true, pageCount: 1, rowCount: 1 }, inputDigest: `sha256:${'0'.repeat(64)}` };
    input.inputDigest = digestMarketSourceInputV1(sourceInputIdentity(input), [{ value }],
      raw => z.array(z.object({ value: z.number().finite() }).strict()).parse(raw), {});
    return input;
  });
  return { schemaVersion: 'market_overview_module_v1' as const,
    calculationVersion: overviewCalculationVersions[moduleId], moduleId, sourceId: `${moduleId}_v1` as const,
    asOfCutoff: acceptedAt, calculationDate, dataDate: '2026-09-03',
    fetchedAt: sourceInputs.filter(i => i.kind === 'provider').map(i => i.fetchedAt).sort().at(-1)!,
    sourceInputs, syntheticResult: { identity: 'synthetic' as const, value }, warnings: [...warnings],
    syntheticCurrentCodeWarningInput: currentCodeWarningInput };
}
export function fixtureArtifact(acceptedAt?: string, value?: number, technical = false) {
  return fixtureCodec(technical).build(fixtureDraft(acceptedAt, value, technical));
}
export function observationFor(artifact: FixtureArtifact, jobId: string) {
  return { jobId, acceptedAt: artifact.asOfCutoff,
    checkedAt: new Date(Date.parse(artifact.fetchedAt) + 1000).toISOString() };
}
