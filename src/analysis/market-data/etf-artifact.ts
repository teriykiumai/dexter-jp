import { z } from 'zod';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { MarketDataArtifactCodecV1, MarketDataArtifactCommonFieldsV1 } from './artifact-codec.js';
import { MarketDataDateV1Schema as date, failMarketData, marketDataRolesV1, type SourceInputV1,
  type SourceInputIdentityV1, digestMarketSourceInputV1 } from './contracts.js';
import { MarketDataWarningV1Schema, assertCurrentCodeWarningsV1, type CurrentCodeWarningInputV1 } from './job-schema.js';
import { technicalSourceIdentityV1 } from './technical-artifact.js';
import { createTechnicalSourceRequestWindowV1 } from './technical-source-gate.js';
import { ETF_RANGES_V1, etfRangeStartV1 } from './etf-series.js';

export type EtfModuleIdV1 = 'etf_1321_eod' | 'etf_1321_2633_relative';
const numeric = z.number().finite();
const value = z.union([z.object({ state: z.literal('available'), value: numeric }).strict(),
  z.object({ state: z.literal('unavailable'), reason: z.enum(['source_no_observation', 'insufficient_history', 'zero_denominator']) }).strict()]);
const observationState = z.union([z.object({ state: z.literal('available'), reason: z.null() }).strict(),
  z.object({ state: z.literal('unavailable'), reason: z.literal('source_no_observation') }).strict()]);
const eod = z.object({ identity: date, dataDate: date, observationState, adjustedCloseYen: value,
  previousCommonDate: date.nullable(), previousAdjustedCloseYen: value, changeYen: value, changeRatePercent: value }).strict();
const range = z.discriminatedUnion('state', [
  z.object({ range: z.enum(ETF_RANGES_V1), state: z.literal('available'), rangeStart: date, rangeEnd: date,
    commonDates: z.array(date).min(2).max(8000), normalized1321: z.array(numeric.nonnegative()).min(2).max(8000),
    normalized2633: z.array(numeric.nonnegative()).min(2).max(8000), return1321Percent: numeric, return2633Percent: numeric,
    differencePercentagePoints: numeric, direction: z.enum(['1321_leads', '2633_leads', 'same']) }).strict(),
  z.object({ range: z.enum(ETF_RANGES_V1), state: z.literal('unavailable'),
    reason: z.enum(['source_no_observation', 'insufficient_common_dates', 'invalid_base']),
    rangeStart: date.nullable(), rangeEnd: date.nullable(), commonDateCount: z.number().int().nonnegative().max(8000) }).strict(),
]);
const boundaryCommon = { contractVersion: z.literal('current_code_history_v1'), mode: z.literal('current_code_only'),
  jquantsCode: z.enum(['13210', '26330']), currentMasterDate: date, historicalIdentity: z.literal('not_verified') };
const boundary = z.discriminatedUnion('state', [
  z.object({ ...boundaryCommon, state: z.literal('available'), sourceCoverageFrom: date, sourceCoverageThrough: date }).strict(),
  z.object({ ...boundaryCommon, state: z.literal('unavailable'), reason: z.literal('source_no_observation') }).strict(),
]);
const moduleSchema = z.object({ ...MarketDataArtifactCommonFieldsV1,
  schemaVersion: z.literal('market_overview_module_v1'),
  calculationVersion: z.enum(['etf_1321_eod_calculation_v1', 'etf_1321_2633_relative_calculation_v1']),
  moduleId: z.enum(['etf_1321_eod', 'etf_1321_2633_relative']), sourceId: z.enum(['etf_1321_eod_v1', 'etf_1321_2633_relative_v1']),
  state: z.enum(['available', 'unavailable']), reason: z.enum(['source_no_observation', 'insufficient_common_dates', 'invalid_base']).nullable(),
  cadence: z.literal('daily'), displayUnit: z.enum(['JPY', 'base_100']), historyBoundaries: z.array(boundary).min(1).max(2),
  observations: z.union([z.array(eod).length(1), z.array(range).length(5)]), warnings: z.array(MarketDataWarningV1Schema).min(1).max(3),
}).strict();
export type EtfModuleArtifactV1 = z.infer<typeof moduleSchema>;
const same = (a: unknown, b: unknown) => canonicalJsonV1(a as CanonicalJsonValue) === canonicalJsonV1(b as CanonicalJsonValue);

export const ETF_CORPORATE_ACTION_REGISTRY_V1 = Object.freeze({
  '1321': [{ eventId: 'nextfunds_1321_split_2026_10_07', announcedDate: '2026-08-25',
    effectiveDate: '2026-10-07', ratioFrom: 1, ratioTo: 100 }],
  '2633': [{ eventId: 'nextfunds_2633_split_2023_12_08', announcedDate: '2023-10-31',
    effectiveDate: '2023-12-08', ratioFrom: 1, ratioTo: 10 }],
} as const);
export const ETF_ISSUER_REVISIONS_V1 = {
  nextfunds_1321_split_2026_08_25: { url: 'https://nextfunds.jp/data/2026/td_260825a.pdf',
    title: '上場投資信託（ETF）の受益権分割および売買単位変更に関するお知らせ', publishedRevision: '2026-08-25', retrievedAt: '2026-09-10' },
  nextfunds_2633_split_2023_10_31: { url: 'https://nextfunds.jp/en/data/2023/td_en_231031a.pdf',
    title: 'Notice Regarding Split of Beneficial Interests', publishedRevision: '2023-10-31', retrievedAt: '2026-09-10' },
} as const;

export function etfInputIdentityV1(role: string, acceptedAt: string, eligibleThrough: string): SourceInputIdentityV1 {
  const window = createTechnicalSourceRequestWindowV1(acceptedAt);
  const ticker = role.endsWith('_2633') ? '2633' : '1321';
  if (role.startsWith('corporate_action_registry_')) return { kind: 'registry', role,
    sourceId: `nextfunds_corporate_actions_${ticker}`, sourceContractVersion: 'etf_corporate_actions_v1',
    registryVersion: 'etf_corporate_actions_v1', registryId: `nextfunds_${ticker}_v1`,
    sourceRevisionIds: [ticker === '1321' ? 'nextfunds_1321_split_2026_08_25' : 'nextfunds_2633_split_2023_10_31'],
    effectiveRange: { from: window.queryFrom, through: eligibleThrough }, unitAndCoverageBasis: 'announced_beneficial_interest_split:not_total_return' };
  const originalRole = role.replace(/_(1321|2633)$/, '');
  const identity = technicalSourceIdentityV1(originalRole,
    { jquantsCode: `${ticker}0`, queryFrom: window.queryFrom, queryTo: eligibleThrough, acceptedAt });
  return { ...identity, role, unitAndCoverageBasis: originalRole === 'daily_bars'
    ? 'jquants_adjusted_ohlcv_not_total_return:JPY:units' : identity.unitAndCoverageBasis };
}

export function etfRegistryRowsV1(ticker: '1321' | '2633', acceptedAt: string, eligibleThrough: string) {
  const window = createTechnicalSourceRequestWindowV1(acceptedAt);
  return ETF_CORPORATE_ACTION_REGISTRY_V1[ticker].filter(event => event.announcedDate <= window.calculationDate
    && event.effectiveDate >= window.queryFrom && event.effectiveDate <= eligibleThrough);
}

export function etfWarningInputV1(artifact: EtfModuleArtifactV1): CurrentCodeWarningInputV1 {
  const clipped = artifact.warnings.find(w => w.code === 'history_coverage_clipped');
  const convert = (b: EtfModuleArtifactV1['historyBoundaries'][number]) => b.state === 'available'
    ? { state: 'available' as const, sourceCoverageFrom: b.sourceCoverageFrom,
      historyCoverageClipped: !!clipped && b.sourceCoverageFrom > createTechnicalSourceRequestWindowV1(artifact.asOfCutoff).queryFrom }
    : { state: 'unavailable' as const, historyCoverageClipped: false as const };
  return artifact.moduleId === 'etf_1321_eod' ? { kind: artifact.moduleId, boundary: convert(artifact.historyBoundaries[0]!) }
    : { kind: artifact.moduleId, boundary1321: convert(artifact.historyBoundaries[0]!), boundary2633: convert(artifact.historyBoundaries[1]!) };
}

function validateStored(a: EtfModuleArtifactV1): boolean {
  const single = a.moduleId === 'etf_1321_eod', expectedCodes = single ? ['13210'] : ['13210', '26330'];
  if (a.calculationVersion !== `${a.moduleId}_calculation_v1` || a.sourceId !== `${a.moduleId}_v1`
    || a.displayUnit !== (single ? 'JPY' : 'base_100') || (a.state === 'available') !== (a.reason === null)
    || !same(a.historyBoundaries.map(b => b.jquantsCode), expectedCodes)) return false;
  const end = a.historyBoundaries[0]!.currentMasterDate, window = createTechnicalSourceRequestWindowV1(a.asOfCutoff);
  if (end > window.calculationDate || end < window.queryFrom || a.dataDate > end
    || a.historyBoundaries.some(b => b.currentMasterDate !== end || b.state === 'available'
      && (b.sourceCoverageFrom < window.queryFrom || b.sourceCoverageFrom > end || b.sourceCoverageThrough !== end))) return false;
  if (a.state === 'unavailable' && a.dataDate !== end) return false;
  assertCurrentCodeWarningsV1(a.warnings.filter(w => w.code !== 'source_gap'), etfWarningInputV1(a));
  if (a.warnings.some((w, i) => w.moduleId !== a.moduleId || w.artifactIdentity !== null
    || w.code === 'source_gap' && (i !== 0 || w.message !== '取得済み価格に明示的な欠損があります。'))) return false;
  if (single) {
    if (a.observations.length !== 1 || !('identity' in a.observations[0]!)) return false;
    const o = a.observations[0];
    if (o.identity !== a.dataDate || o.dataDate !== a.dataDate || o.observationState.state !== a.state
      || o.observationState.reason !== a.reason) return false;
    const values = [o.adjustedCloseYen, o.previousAdjustedCloseYen, o.changeYen, o.changeRatePercent];
    if (a.state === 'unavailable') return o.previousCommonDate === null
      && values.every(v => same(v, { state: 'unavailable', reason: 'source_no_observation' }));
    if (o.adjustedCloseYen.state !== 'available' || o.adjustedCloseYen.value <= 0) return false;
    if (o.previousCommonDate === null) return values.slice(1).every(v => same(v, { state: 'unavailable', reason: 'insufficient_history' }));
    if (o.previousCommonDate >= o.dataDate || o.previousAdjustedCloseYen.state !== 'available' || o.previousAdjustedCloseYen.value < 0) return false;
    if (o.previousAdjustedCloseYen.value === 0) return [o.changeYen, o.changeRatePercent]
      .every(v => same(v, { state: 'unavailable', reason: 'zero_denominator' }));
    const change = o.adjustedCloseYen.value - o.previousAdjustedCloseYen.value;
    return same(o.changeYen, { state: 'available', value: change })
      && same(o.changeRatePercent, { state: 'available', value: change / o.previousAdjustedCloseYen.value * 100 });
  }
  if (!a.observations.every(o => 'range' in o) || !same(a.observations.map(o => o.range), ETF_RANGES_V1)) return false;
  const ranges = a.observations;
  const valid = ranges.filter(r => r.state === 'available');
  const reason = valid.length ? null : ranges.some(r => r.state === 'unavailable' && r.reason === 'source_no_observation')
    ? 'source_no_observation' : ranges.some(r => r.state === 'unavailable' && r.reason === 'invalid_base') ? 'invalid_base' : 'insufficient_common_dates';
  if (a.reason !== reason || valid.some(r => r.rangeEnd !== a.dataDate)) return false;
  return ranges.every(r => {
    if (r.state === 'unavailable') return r.reason === 'source_no_observation'
      ? r.commonDateCount === 0 && r.rangeStart === null && r.rangeEnd === null
      : r.commonDateCount === 0 ? r.rangeStart === null && r.rangeEnd === null
        : r.rangeStart !== null && r.rangeEnd !== null && r.rangeStart <= r.rangeEnd
          && (r.reason === 'invalid_base' ? r.commonDateCount >= 2 : r.commonDateCount === 1 && r.rangeStart === r.rangeEnd);
    if (r.commonDates.length !== r.normalized1321.length || r.commonDates.length !== r.normalized2633.length
      || r.commonDates[0] !== r.rangeStart || r.commonDates.at(-1) !== r.rangeEnd
      || r.normalized1321[0] !== 100 || r.normalized2633[0] !== 100
      || r.commonDates.some((d, i) => i > 0 && r.commonDates[i - 1]! >= d)
      || r.rangeStart < (etfRangeStartV1(r.rangeEnd, r.range) ?? window.queryFrom)) return false;
    const left = (r.normalized1321.at(-1)! / 100 - 1) * 100, right = (r.normalized2633.at(-1)! / 100 - 1) * 100;
    const difference = left - right;
    return r.return1321Percent === left && r.return2633Percent === right && r.differencePercentagePoints === difference
      && r.direction === (difference > 0 ? '1321_leads' : difference < 0 ? '2633_leads' : 'same');
  });
}

export function createEtfArtifactCodecV1(moduleId: EtfModuleIdV1, environment: NodeJS.ProcessEnv = process.env) {
  const target = { kind: 'overview' as const, moduleId, sourceId: `${moduleId}_v1` as const };
  return new MarketDataArtifactCodecV1({ target, environment, schema: moduleSchema.refine(validateStored),
    validateSourceInputs: (inputs: readonly SourceInputV1[], a) => {
      if (!same(inputs.map(i => i.role), marketDataRolesV1(target))) failMarketData('invalid_artifact');
      for (const input of inputs) {
        const expected = etfInputIdentityV1(input.role, a.asOfCutoff, a.historyBoundaries[0]!.currentMasterDate);
        const { inputDigest, asOfCutoff: _cutoff, ...rest } = input;
        if (rest.kind === 'provider') {
          const { fetchedAt: _f, entitlementClass: _e, entitlementVerifiedAt: _v, pagination, ...identity } = rest;
          if (!same(identity, expected) || pagination.pageCount > 40 || pagination.rowCount > 16000
            || input.role.startsWith('security_master') && pagination.rowCount !== 1) failMarketData('invalid_artifact');
          if (input.role.startsWith('daily_bars_')) {
            const b = a.historyBoundaries.find(b => b.jquantsCode === `${input.role.slice(-4)}0`);
            if (!b || (b.state === 'unavailable') !== (pagination.rowCount === 0)) failMarketData('invalid_artifact');
          }
        } else {
          const ticker = input.role.endsWith('2633') ? '2633' : '1321';
          if (!same(rest, expected) || inputDigest !== digestMarketSourceInputV1(expected,
            etfRegistryRowsV1(ticker, a.asOfCutoff, a.historyBoundaries[0]!.currentMasterDate), rows => rows as CanonicalJsonValue, environment)) failMarketData('invalid_artifact');
        }
      }
    } });
}
