import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { canonicalJsonV1, sha256CanonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { MarketDataArtifactCodecV1 } from './artifact-codec.js';
import { digestMarketDataSourcePayloadV1, digestMarketSourceInputV1, marketDataRolesV1,
  MARKET_DATA_MODULE_IDS_V1, MarketDataSourcePayloadEnvelopeV1Schema, SourceInputV1Schema } from './contracts.js';
import { fixtureArtifact, fixtureCodec, fixtureDraft, sourceInputIdentity, overviewFixtureSchema } from './repository-test-fixtures.js';

describe('Market Data source identity and strict codec', () => {
  test('literal root envelope golden bytes and digest; no cyclic artifact/path preimage', () => {
    const envelope = { kind: 'dexter_market_data_source_payload', version: 1,
      target: { kind: 'technical', ticker: '7203', jquantsCode: '72030' },
      dataDate: '2026-09-03', calculationDate: '2026-09-03', calculationVersion: 'technical_chart_calculation_v1',
      sourceInputs: ['daily_bars', 'security_master', 'trading_calendar']
        .map(role => ({ role, inputDigest: `sha256:${'a'.repeat(64)}` })) };
    const golden = '{"calculationDate":"2026-09-03","calculationVersion":"technical_chart_calculation_v1","dataDate":"2026-09-03","kind":"dexter_market_data_source_payload","sourceInputs":[{"inputDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"daily_bars"},{"inputDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"security_master"},{"inputDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"trading_calendar"}],"target":{"jquantsCode":"72030","kind":"technical","ticker":"7203"},"version":1}';
    expect(canonicalJsonV1(envelope)).toBe(golden);
    expect(digestMarketDataSourcePayloadV1(envelope)).toBe('sha256:80e5713de4d2a5a36010b86c33568c1304cf932a1b0efc5bd8fc8bac1236d035');
    for (const key of ['sourcePayloadDigest', 'artifactDigest', 'acceptedAt', 'checkedAt', 'fetchedAt',
      'entitlementVerifiedAt', 'rootRelativeIdentity', 'raw', 'derivedValue']) {
      expect(() => digestMarketDataSourcePayloadV1({ ...envelope, [key]: 'unexpected' })).toThrow();
    }
  });
  test('literal input golden digest and closed sanitized rows; publication is never guessed as midnight', () => {
    const input = fixtureDraft().sourceInputs.find(i => i.kind === 'provider')!;
    const identity = sourceInputIdentity(input);
    const rows = [{ value: 0 }];
    const parse = (raw: unknown) => z.array(z.object({ value: z.number().finite() }).strict()).parse(raw);
    const golden = '{"identity":{"cadence":"daily","dataDateOrEffectiveRange":"2026-09-03","endpoint":"/v2/markets/calendar","kind":"provider","normalizedQueryIdentity":"synthetic_query","publishedAt":null,"publishedDate":null,"role":"short_ratio_rows","sourceContractVersion":"synthetic_contract_v1","sourceId":"synthetic_source_v1","sourceMappingVersion":"synthetic_mapping_v1","sourceRevisionIds":["synthetic_revision_v1"],"unitAndCoverageBasis":"synthetic_fixture"},"kind":"dexter_market_source_input","observations":[{"value":0}],"version":1}';
    expect(canonicalJsonV1({ kind: 'dexter_market_source_input', version: 1, identity, observations: rows })).toBe(golden);
    expect(digestMarketSourceInputV1(identity, rows, parse, {})).toBe('sha256:482fb24d17aa1bf8329e32a1e483a01806db11487185bfcfdd21a233080613f4');
    expect(identity.kind === 'provider' && identity.publishedAt).toBeNull();
    expect(() => digestMarketSourceInputV1({ ...identity, fetchedAt: input.asOfCutoff }, rows, parse, {})).toThrow();
    expect(() => digestMarketSourceInputV1(identity, [{ value: 0, rawHeader: 'x' }], parse, {})).toThrow();
    expect(() => digestMarketSourceInputV1(identity, [{ value: 0, dropped: true }], raw =>
      z.array(z.object({ value: z.number() })).parse(raw), {})).toThrow();
  });
  test('closed target/calculation/roles for all seven families', () => {
    const technicalTarget = { kind: 'technical' as const, ticker: '7203' };
    expect(marketDataRolesV1(technicalTarget)).toEqual([
      'daily_bars', 'security_master', 'trading_calendar',
    ]);
    expect(marketDataRolesV1({ kind: 'overview', moduleId: 'etf_1321_eod',
      sourceId: 'etf_1321_eod_v1' })).toEqual([
      'corporate_action_registry_1321', 'daily_bars_1321', 'security_master_1321', 'trading_calendar',
    ]);
    expect(marketDataRolesV1({ kind: 'overview', moduleId: 'etf_1321_2633_relative',
      sourceId: 'etf_1321_2633_relative_v1' })).toEqual([
      'corporate_action_registry_1321', 'corporate_action_registry_2633',
      'daily_bars_1321', 'daily_bars_2633', 'security_master_1321',
      'security_master_2633', 'trading_calendar',
    ]);
    const technical = { kind: 'dexter_market_data_source_payload', version: 1,
      target: { ...technicalTarget, jquantsCode: '72030' }, dataDate: '2026-09-03',
      calculationDate: '2026-09-03', calculationVersion: 'technical_chart_calculation_v1',
      sourceInputs: marketDataRolesV1(technicalTarget)
        .map(role => ({ role, inputDigest: `sha256:${'a'.repeat(64)}` })) };
    expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse(technical).success).toBe(true);
    expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse({ ...technical,
      sourceInputs: [...technical.sourceInputs, {
        role: 'instrument_lifetime', inputDigest: `sha256:${'a'.repeat(64)}`,
      }].sort((a, b) => a.role.localeCompare(b.role)) }).success).toBe(false);
    const legacyTechnicalDraft = fixtureDraft(undefined, 0, true);
    legacyTechnicalDraft.sourceInputs = [...legacyTechnicalDraft.sourceInputs, {
      ...legacyTechnicalDraft.sourceInputs[0]!, role: 'instrument_lifetime',
    }].sort((a, b) => a.role.localeCompare(b.role));
    expect(() => fixtureCodec(true).build(legacyTechnicalDraft)).toThrow();
    for (const moduleId of MARKET_DATA_MODULE_IDS_V1) {
      const target = { kind: 'overview' as const, moduleId, sourceId: `${moduleId}_v1` as const };
      const value = { kind: 'dexter_market_data_source_payload', version: 1, target,
        dataDate: '2026-09-03', calculationDate: '2026-09-03', calculationVersion: `${moduleId}_calculation_v1`,
        sourceInputs: marketDataRolesV1(target).map(role => ({ role, inputDigest: `sha256:${'a'.repeat(64)}` })) };
      expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse(value).success).toBe(true);
      expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse({ ...value, calculationVersion: 'technical_chart_calculation_v1' }).success).toBe(false);
      expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse({ ...value, target: { ...target, sourceId: 'margin_1570_v1' === target.sourceId ? 'market_short_ratio_v1' : 'margin_1570_v1' } }).success).toBe(false);
      for (const roles of [value.sourceInputs.slice(1), [...value.sourceInputs].reverse(),
        [...value.sourceInputs, value.sourceInputs[0]], value.sourceInputs.map(i => ({ ...i, role: 'unknown' }))]) {
        expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse({ ...value, sourceInputs: roles }).success).toBe(false);
      }
      if (moduleId === 'etf_1321_eod' || moduleId === 'etf_1321_2633_relative') {
        const legacy = [...value.sourceInputs, {
          role: 'instrument_lifetime_1321', inputDigest: `sha256:${'a'.repeat(64)}`,
        }].sort((a, b) => a.role.localeCompare(b.role));
        expect(MarketDataSourcePayloadEnvelopeV1Schema.safeParse({ ...value, sourceInputs: legacy }).success).toBe(false);
      }
    }
  });
  test('exact source digest -> path -> full artifact digest and max provider fetchedAt', () => {
    const codec = fixtureCodec(), artifact = fixtureArtifact();
    const { artifactDigest, ...payload } = artifact;
    expect(artifact.sourcePayloadDigest).toBe(digestMarketDataSourcePayloadV1(codec.envelope(artifact)));
    expect(codec.identity(artifact).rootRelativeIdentity).toBe(`overview/market_short_ratio_v1/2026-09-03/${artifact.sourcePayloadDigest.slice(7)}.json`);
    expect(artifactDigest).toBe(sha256CanonicalJsonV1(payload));
    expect(artifact.fetchedAt).toBe('2026-09-03T07:30:01.003Z');
    expect(artifact.syntheticResult.value).toBe(0);
    const raw = fixtureDraft(); raw.fetchedAt = '2026-09-03T07:30:01.000Z';
    expect(() => codec.build(raw)).toThrow();
  });
  test('same calculation context excludes volatile metadata; date rollover changes revision', () => {
    const codec = fixtureCodec(true);
    const a = fixtureArtifact(undefined, 0, true);
    const draft = fixtureDraft('2026-09-03T07:31:00.000Z', 0, true);
    for (const input of draft.sourceInputs) if (input.kind === 'provider') {
      input.pagination.pageCount = 2; input.entitlementClass = 'premium';
    }
    const b = codec.build(draft), nextDate = fixtureArtifact('2026-09-04T07:30:00.000Z', 0, true);
    expect(a.sourcePayloadDigest).toBe(b.sourcePayloadDigest);
    expect(a.artifactDigest).not.toBe(b.artifactDigest);
    expect(codec.equivalent(a, b)).toBe(true);
    expect(a.sourcePayloadDigest).not.toBe(nextDate.sourcePayloadDigest);
  });
  test('strict dates, target, manifest policy, unknown output, digest and unsafe value rejection', () => {
    const codec = fixtureCodec();
    const cases: ((value: ReturnType<typeof fixtureDraft>) => void)[] = [
      v => { v.calculationDate = '2026-02-30'; }, v => { v.calculationDate = '2026-09-02'; },
      v => { v.sourceInputs[0]!.sourceRevisionIds = ['unknown']; },
      v => { v.sourceInputs[0]!.sourceRevisionIds = ['z', 'a']; },
      v => { v.sourceInputs[0]!.asOfCutoff = '2026-09-01T00:00:00.000Z'; },
      v => { v.syntheticResult.value = Infinity; },
      v => { v.sourceInputs[0]!.unitAndCoverageBasis = 'C:\\private\\credentials'; },
    ];
    for (const change of cases) { const value = fixtureDraft(); change(value); expect(() => codec.build(value)).toThrow(); }
    expect(() => codec.build({ ...fixtureDraft(), unknown: true })).toThrow();
    expect(() => codec.parse({ ...fixtureArtifact(), artifactDigest: `sha256:${'0'.repeat(64)}` })).toThrow();
    const input = fixtureDraft().sourceInputs.find(i => i.kind === 'provider')!;
    expect(SourceInputV1Schema.safeParse({ ...input, pagination: { complete: false, pageCount: 1, rowCount: 1 } }).success).toBe(false);
    const secretCodec = fixtureCodec(false, { JQUANTS_API_KEY: 'synthetic_query' });
    expect(() => secretCodec.build(fixtureDraft())).toThrow();
    const stripCodec = new MarketDataArtifactCodecV1({ schema: overviewFixtureSchema.strip(), target: codec.target, validateSourceInputs: () => {} });
    expect(() => stripCodec.build({ ...fixtureDraft(), secret: 'discarded' })).toThrow();
    const openCodec = new MarketDataArtifactCodecV1({ schema: overviewFixtureSchema.passthrough(), target: codec.target, validateSourceInputs: () => {} });
    expect(() => openCodec.build(fixtureDraft())).toThrow();
  });
  test('input and output are not mutated', () => {
    const raw = fixtureDraft(); const before = structuredClone(raw);
    fixtureCodec().build(raw);
    expect(raw).toEqual(before);
    expect(canonicalJsonV1(raw as CanonicalJsonValue)).toBe(canonicalJsonV1(before as CanonicalJsonValue));
  });
});
