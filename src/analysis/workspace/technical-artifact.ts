import { z } from 'zod';
import { createTechnicalArtifactCodecV1, technicalSourceIdentityV1, type TechnicalChartDatasetV1 } from '../market-data/technical-artifact.js';
import { digestMarketSourceInputV1, type MarketDataArtifactIdentityV1 } from '../market-data/contracts.js';
import { MarketDataArtifactCommonFieldsV1 } from '../market-data/artifact-codec.js';
import { type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { TechnicalInputSchema, calculateWorkspaceTechnical, type TechnicalInput } from './technical-input.js';
import { digest, json, fail, safe } from './contracts.js';

export type TechnicalArtifactV2 = ReturnType<WorkspaceTechnicalCodec['build']>;
export class WorkspaceTechnicalCodec {
  readonly target;
  constructor(ticker: string) { this.target = createTechnicalArtifactCodecV1(ticker).target; }
  build(source: TechnicalChartDatasetV1, input: TechnicalInput) {
    const legacy = createTechnicalArtifactCodecV1(source.ticker).parse(source);
    const calculated = calculateWorkspaceTechnical(input);
    const sourcePayloadDigest = digest(json({ version: 'workspace_technical_source_v2',
      source: legacy.sourcePayloadDigest, input: calculated.input }));
    const payload = { schemaVersion: 'technical_chart_dataset_v2' as const,
      calculationVersion: legacy.calculationVersion, asOfCutoff: legacy.asOfCutoff,
      calculationDate: legacy.calculationDate, dataDate: calculated.result.dataDate,
      fetchedAt: legacy.fetchedAt, sourceInputs: legacy.sourceInputs, sourcePayloadDigest,
      source: legacy, ...calculated };
    return { ...payload, artifactDigest: digest(json(payload)) };
  }
  parse(raw: unknown) {
    const schema = z.object({ ...MarketDataArtifactCommonFieldsV1, schemaVersion: z.literal('technical_chart_dataset_v2'),
      source: z.unknown(), input: TechnicalInputSchema, result: z.unknown(), basis: z.unknown() }).strict();
    const candidate = schema.parse(raw), source = createTechnicalArtifactCodecV1(this.target.kind === 'technical' ? this.target.ticker : '').parse(candidate.source);
    const input = candidate.input;
    if (input.identity.code !== source.jquantsCode || input.queryFrom !== source.queryFrom || input.queryTo !== source.queryTo
      || input.calculationDate !== source.calculationDate || input.master.CoName !== source.instrumentName) fail('reference_conflict');
    for (const role of ['daily_bars', 'security_master', 'trading_calendar'] as const) {
      const rows = role === 'daily_bars' ? input.daily.map(({ O, H, L, C, Vo, ...row }) => row)
        : role === 'security_master' ? [input.master] : input.calendar;
      const expected = digestMarketSourceInputV1(technicalSourceIdentityV1(role, source), rows, value => value as CanonicalJsonValue);
      if (source.sourceInputs.find(item => item.role === role)?.inputDigest !== expected) fail('reference_conflict');
    }
    const value = this.build(source, input);
    if (json(raw) !== json(value)) fail('reference_conflict');
    safe(value); return value;
  }
  identity(value: TechnicalArtifactV2): MarketDataArtifactIdentityV1 {
    const ticker = value.source.ticker;
    return { scope: 'technical', tickerOrSourceId: ticker, dataDate: value.dataDate,
      sourcePayloadDigest: value.sourcePayloadDigest, artifactDigest: value.artifactDigest,
      rootRelativeIdentity: `technical/${ticker}/${value.dataDate}/${value.sourcePayloadDigest.slice(7)}.json` };
  }
  equivalent(a: TechnicalArtifactV2, b: TechnicalArtifactV2) {
    return a.sourcePayloadDigest === b.sourcePayloadDigest && json(a.input) === json(b.input)
      && json(a.result) === json(b.result) && json(a.basis) === json(b.basis)
      && createTechnicalArtifactCodecV1(a.source.ticker).equivalent(a.source, b.source);
  }
}
