import { z } from 'zod';
import { analyzeSupplyDemand } from '../../tools/finance/supply-demand-engine.js';
import { analyzeReportedShortPositions } from '../../tools/finance/reported-short-position-engine.js';
import { calculateSectorShortObservation } from '../../tools/finance/sector-short-ratio-engine.js';
import { sector33CodeSchema } from '../../tools/finance/sector-index.js';
import { MarketDataArtifactCommonFieldsV1 } from '../market-data/artifact-codec.js';
import { marketDataTargetKeyV1, type MarketDataArtifactIdentityV1, type MarketDataTargetV1 } from '../market-data/contracts.js';
import { DateValue, FrozenIdentitySchema, ObjectRefSchema, ScopeSchema, digest, json, parse, fail, safe } from './contracts.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { mapTechnicalCalendarV1 } from '../market-data/technical-source-gate.js';

export const SupplyDatasetSchema = z.enum(['margin', 'issuer_short', 'sector_short']);
export type SupplyDataset = z.infer<typeof SupplyDatasetSchema>;
const amount = z.number().finite().nonnegative().nullable();
export const MarginRowSchema = z.object({ Date: DateValue, Code: z.string().regex(/^[0-9A-Z]{5}$/),
  LongVol: amount, ShrtVol: amount }).strict();
export const ReportRowSchema = z.object({ DiscDate: DateValue, CalcDate: DateValue,
  Code: z.string().regex(/^[0-9A-Z]{5}$/), SSName: z.string().max(4096).nullable(),
  DICName: z.string().max(4096).nullable(), FundName: z.string().max(4096).nullable(),
  ShrtPosToSO: amount, ShrtPosShares: amount,
  PrevRptDate: z.union([DateValue, z.literal(''), z.literal('-'), z.null()]), PrevRptRatio: amount }).strict();
export const SectorRowSchema = z.object({ Date: DateValue, S33: sector33CodeSchema,
  SellExShortVa: amount, ShrtWithResVa: amount, ShrtNoResVa: amount }).strict();
export const SupplyInputSchema = z.object({ version: z.literal('workspace_supply_input_v1'),
  dataset: SupplyDatasetSchema, scope: ScopeSchema, identity: FrozenIdentitySchema.nullable(),
  masterEvidence: ObjectRefSchema.nullable(), from: DateValue, through: DateValue,
  source: z.object({ endpoint: z.string(), query: z.record(z.string(), z.string()), fetchedAt: z.iso.datetime(),
    pageCount: z.number().int().positive().max(20) }).strict(),
  margin: z.array(MarginRowSchema).max(8000), reports: z.array(ReportRowSchema).max(8000),
  sector: z.array(SectorRowSchema).max(8000),
  volume: z.array(z.object({ date: DateValue, volume: amount }).strict()).max(8000),
  volumeEvidence: ObjectRefSchema.nullable(),
  basisComparable: z.boolean(),
}).strict();
export type SupplyInput = z.infer<typeof SupplyInputSchema>;
function semanticInput(input: SupplyInput) {
  const { fetchedAt: _fetchedAt, pageCount: _pages, ...source } = input.source;
  return { ...input, source };
}

export function supplyPriceEvidence(input: SupplyInput, raw: unknown): Pick<SupplyInput, 'volume' | 'basisComparable'> {
  if (input.dataset !== 'margin' || !input.identity) fail('reference_conflict');
  const technical = new WorkspaceTechnicalCodec(input.identity.code.slice(0, 4)).parse(raw).input;
  if (technical.identity.instrumentId !== input.identity.instrumentId || technical.identity.code !== input.identity.code) fail('reference_conflict');
  const through = input.margin.at(-1)?.Date;
  if (!through || technical.eligibilityFrom > input.from || technical.queryFrom > input.from || technical.queryTo < through)
    return { volume: [], basisComparable: false };
  const daily = technical.daily.filter(row => row.Date >= input.from && row.Date <= through);
  const calendar = mapTechnicalCalendarV1(technical.calendar, technical.calendarFrom, technical.calendarThrough).calendar;
  const observed = new Set(daily.map(row => row.Date));
  if (!daily.length || daily[0]!.Date > input.margin[0]!.Date || daily.at(-1)!.Date !== through
    || calendar.sessions.some(date => date >= input.from && date <= through && !observed.has(date))
    || daily.some(row => row.AdjFactor !== 1 || row.ExRT !== null || row.C === null)) return { volume: [], basisComparable: false };
  return { volume: daily.map(row => ({ date: row.Date, volume: row.Vo })), basisComparable: true };
}

export function supplyTarget(input: SupplyInput): MarketDataTargetV1 {
  return { kind: 'workspace', key: input.scope.kind === 'instrument-owned'
    ? `${input.dataset}_${input.scope.instrumentId}` : input.scope.kind === 'sector-scoped'
      ? `sector_short_${input.scope.sectorCode}` : fail('reference_conflict') };
}
export function calculateSupply(raw: unknown) {
  const input = parse(SupplyInputSchema, raw);
  if (input.from > input.through || input.scope.kind === 'market-scoped') fail('invalid_input');
  if (input.dataset === 'sector_short') {
    if (input.scope.kind !== 'sector-scoped' || input.identity || input.masterEvidence || input.volumeEvidence
      || input.margin.length || input.reports.length || input.volume.length || input.basisComparable
      || input.scope.provider !== 'jquants' || input.scope.scheme !== 's33' || input.scope.definitionVersion !== 'v1'
      || input.source.endpoint !== '/v2/markets/short-ratio'
      || json(input.source.query) !== json({ s33: input.scope.sectorCode, date: input.through })
      || input.from !== input.through || input.sector.length > 1
      || input.sector.some(row => row.S33 !== (input.scope.kind === 'sector-scoped' ? input.scope.sectorCode : '') || row.Date !== input.through)) fail('reference_conflict');
    const observations = input.sector.map(row => calculateSectorShortObservation({ date: row.Date, sectorCode: row.S33,
      nonShortSellingValue: row.SellExShortVa, restrictedShortSellingValue: row.ShrtWithResVa, unrestrictedShortSellingValue: row.ShrtNoResVa }));
    return { input, result: { dataset: input.dataset, observations,
      unavailable: observations.length ? [] : [{ reason: 'no_sector_short_ratio_data' }],
      turnoverUnit: 'JPY', ratioUnit: 'fraction' } };
  }
  if (input.scope.kind !== 'instrument-owned' || !input.identity || !input.masterEvidence
    || input.identity.instrumentId !== input.scope.instrumentId || input.identity.provider !== 'jquants'
    || input.sector.length) fail('reference_conflict');
  if (input.dataset === 'margin') {
    if (input.reports.length || input.source.endpoint !== '/v2/markets/margin-interest'
      || json(input.source.query) !== json({ code: input.identity.code, from: input.from, to: input.through })
      || input.margin.some(row => row.Code !== input.identity!.code || row.Date < input.from || row.Date > input.through)
      || input.volume.some(row => row.date < input.from || row.date > input.through)
      || (input.volume.length > 0 || input.basisComparable) && !input.volumeEvidence
      || !input.basisComparable && input.volume.length > 0) fail('reference_conflict');
    const result = analyzeSupplyDemand(input.margin.map(row => ({ date: row.Date, longBalance: row.LongVol, shortBalance: row.ShrtVol })), input.volume);
    const weekStart = (date: string) => {
      const time = new Date(`${date}T00:00:00Z`);
      time.setUTCDate(time.getUTCDate() - (time.getUTCDay() + 6) % 7); return time.getTime();
    };
    const consecutive = input.margin.every((row, index) => index === 0
      || weekStart(row.Date) - weekStart(input.margin[index - 1]!.Date) === 7 * 86_400_000);
    const comparable = input.basisComparable && consecutive;
    if (!comparable) {
      for (const metric of ['buyingBalanceWeeklyChange', 'sellingBalanceWeeklyChange', 'mean4w', 'mean13w', 'mean52w',
        'deviation52w', 'percentile52w'] as const) {
        result[metric] = null;
        result.unavailable = result.unavailable.filter(item => item.metric !== metric);
        result.unavailable.push({ metric, reason: 'missing_data' });
      }
    }
    return { input, result: { dataset: input.dataset, ...result,
      comparisonState: comparable ? 'eligible' : !input.basisComparable ? 'price_basis_unverified' : 'weekly_source_gap' } };
  }
  if (input.margin.length || input.volume.length || input.volumeEvidence || input.basisComparable
    || input.source.endpoint !== '/v2/markets/short-sale-report'
    || json(input.source.query) !== json({ code: input.identity.code, disc_date_from: input.from, disc_date_to: input.through })
    || input.reports.some(row => row.Code !== input.identity!.code || row.DiscDate < input.from || row.DiscDate > input.through
      || row.CalcDate < input.from || row.CalcDate > row.DiscDate
      || row.PrevRptDate && row.PrevRptDate !== '-' && row.PrevRptDate > row.CalcDate)) fail('reference_conflict');
  const result = analyzeReportedShortPositions(input.reports.map(row => ({ code: row.Code, disclosedDate: row.DiscDate,
    calculatedDate: row.CalcDate, reporterName: row.SSName, discretionaryManagerName: row.DICName, fundName: row.FundName,
    shortPositionRatio: row.ShrtPosToSO, shortPositionShares: row.ShrtPosShares,
    previousCalculatedDate: row.PrevRptDate && row.PrevRptDate !== '-' && row.PrevRptDate >= input.from ? row.PrevRptDate : null,
    previousReportedRatio: row.PrevRptDate && row.PrevRptDate !== '-' && row.PrevRptDate >= input.from ? row.PrevRptRatio : null })), input.through);
  return { input, result: { dataset: input.dataset, ...result } };
}

export class WorkspaceSupplyCodec {
  constructor(readonly target: MarketDataTargetV1) {
    if (target.kind !== 'workspace') fail('invalid_input');
  }
  build(raw: unknown, acceptedAt: string) {
    const { input, result } = calculateSupply(raw);
    if (json(supplyTarget(input)) !== json(this.target) || input.source.fetchedAt < acceptedAt) fail('reference_conflict');
    const sourcePayloadDigest = digest(json({ version: 'workspace_supply_payload_v1', input: semanticInput(input) }));
    const payload = { schemaVersion: 'workspace_supply_artifact_v1' as const, calculationVersion: 'workspace_supply_calculation_v1' as const,
      asOfCutoff: acceptedAt, calculationDate: new Date(Date.parse(acceptedAt) + 9 * 3600_000).toISOString().slice(0, 10),
      dataDate: input.through, fetchedAt: input.source.fetchedAt, sourcePayloadDigest,
      sourceInputs: [{ kind: 'provider' as const, role: 'workspace_source', sourceId: 'workspace_supply_v1',
        sourceContractVersion: 'workspace_supply_source_v1', sourceRevisionIds: ['official_specs_2026_09_13'],
        unitAndCoverageBasis: input.dataset === 'sector_short' ? 'JPY daily sector turnover; ratio is a fraction'
          : input.dataset === 'margin' ? 'unadjusted shares; weekly observations' : 'public reported shares; ratio is a fraction; disclosure threshold 0.005',
        sourceMappingVersion: 'workspace_supply_mapping_v1', endpoint: input.source.endpoint,
        normalizedQueryIdentity: json(input.source.query), dataDateOrEffectiveRange: { from: input.from, through: input.through },
        publishedDate: null, publishedAt: null, cadence: input.dataset === 'margin' ? 'weekly' : 'daily',
        asOfCutoff: acceptedAt, entitlementClass: 'standard' as const, entitlementVerifiedAt: input.source.fetchedAt,
        fetchedAt: input.source.fetchedAt, pagination: { complete: true as const, pageCount: input.source.pageCount,
          rowCount: input.margin.length + input.reports.length + input.sector.length }, inputDigest: digest(json(semanticInput(input))) }], input, result };
    const tokyo = new Date(Date.parse(acceptedAt) + 9 * 3600_000);
    if (payload.dataDate > payload.calculationDate || payload.dataDate === payload.calculationDate
      && tokyo.getUTCHours() * 60 + tokyo.getUTCMinutes() < 17 * 60 + 30) fail('reference_conflict');
    const value = { ...payload, artifactDigest: digest(json(payload)) }; safe(value); return value;
  }
  parse(raw: unknown) {
    const candidate = z.object({ ...MarketDataArtifactCommonFieldsV1, schemaVersion: z.literal('workspace_supply_artifact_v1'),
      input: SupplyInputSchema, result: z.unknown() }).strict().parse(raw);
    const value = this.build(candidate.input, candidate.asOfCutoff);
    if (json(raw) !== json(value)) fail('reference_conflict');
    return value;
  }
  identity(value: ReturnType<WorkspaceSupplyCodec['build']>): MarketDataArtifactIdentityV1 {
    const key = marketDataTargetKeyV1(this.target);
    return { scope: 'workspace', tickerOrSourceId: key, dataDate: value.dataDate,
      sourcePayloadDigest: value.sourcePayloadDigest, artifactDigest: value.artifactDigest,
      rootRelativeIdentity: `workspace/${key}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }
  equivalent(a: ReturnType<WorkspaceSupplyCodec['build']>, b: ReturnType<WorkspaceSupplyCodec['build']>) {
    return a.sourcePayloadDigest === b.sourcePayloadDigest && json(semanticInput(a.input)) === json(semanticInput(b.input))
      && json(a.result) === json(b.result);
  }
}
