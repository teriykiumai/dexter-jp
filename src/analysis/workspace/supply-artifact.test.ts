import { expect, test } from 'bun:test';
import { calculateSupply, supplyPriceEvidence, supplyTarget, WorkspaceSupplyCodec, type SupplyInput } from './supply-artifact.js';
import { readStep2aTechnicalFixture } from './technical-test-fixtures.js';
import { assertMarketDataSafeV1 } from '../market-data/contracts.js';
import { supplyCodecs, validateSupplyLinks } from './supply-objects.js';
import { digest, json } from './contracts.js';

function margin(): SupplyInput {
  const fixture = readStep2aTechnicalFixture().artifact.input;
  return { version: 'workspace_supply_input_v1', dataset: 'margin', identity: fixture.identity,
    scope: { kind: 'instrument-owned', instrumentId: fixture.identity.instrumentId }, masterEvidence: fixture.masterEvidence,
    episodeFrom: fixture.eligibilityFrom, from: '2026-08-01', through: '2026-09-11', source: { endpoint: '/v2/markets/margin-interest',
      query: { code: fixture.identity.code, from: '2026-08-01', to: '2026-09-11' }, fetchedAt: '2026-09-11T09:00:00.000Z', pageCount: 1 },
    margin: [{ Date: '2026-09-04', Code: fixture.identity.code, LongVol: 1000, ShrtVol: 100 },
      { Date: '2026-09-11', Code: fixture.identity.code, LongVol: 1100, ShrtVol: 0 }], reports: [], sector: [],
    volume: [], volumeEvidence: null, basisComparable: false };
}
function issuer(): SupplyInput {
  const input = margin();
  return { ...input, dataset: 'issuer_short', episodeFrom: '2024-01-01', from: '2025-09-11', margin: [],
    source: { ...input.source, endpoint: '/v2/markets/short-sale-report',
      query: { code: input.identity!.code, disc_date_from: '2025-09-11', disc_date_to: input.through } },
    reports: [{ DiscDate: '2025-09-11', CalcDate: '2025-09-10', Code: input.identity!.code,
      SSName: 'Synthetic Reporter', DICName: null, FundName: null, ShrtPosToSO: .006, ShrtPosShares: 100,
      PrevRptDate: '2025-09-09', PrevRptRatio: .005 }] };
}

test('issuer ownership and previous context use the episode floor, not the disclosure horizon', () => {
  const input = issuer(), codec = new WorkspaceSupplyCodec(supplyTarget(input));
  const artifact = codec.parse(codec.build(input, input.source.fetchedAt));
  expect(artifact.result).toMatchObject({ reports: [{ calculatedDate: '2025-09-10',
    previousCalculatedDate: '2025-09-09', previousReportedRatio: .005, ratioDelta: .001 }] });
  input.reports[0]!.CalcDate = input.episodeFrom!;
  input.reports[0]!.PrevRptDate = input.episodeFrom!;
  expect(calculateSupply(input).result).toMatchObject({ reports: [{ previousCalculatedDate: '2024-01-01', previousReportedRatio: .005 }] });
  input.reports[0]!.PrevRptDate = '2023-12-31';
  expect(calculateSupply(input).result).toMatchObject({ reports: [{ previousCalculatedDate: null, previousReportedRatio: null, ratioDelta: null }] });
  input.reports[0]!.CalcDate = '2023-12-31';
  expect(() => calculateSupply(input)).toThrow('reference_conflict');
  input.episodeFrom = null;
  expect(() => calculateSupply(input)).toThrow('reference_conflict');
});

test.each(['workspace_supply_artifact_v1', 'workspace_supply_prepared_v1'])('%s re-proves the frozen episode floor from its exact dependency', codecName => {
  const fixture = readStep2aTechnicalFixture(), input = margin();
  const verify = () => {
    const artifact = new WorkspaceSupplyCodec(supplyTarget(input)).build(input, input.source.fetchedAt);
    const value = codecName === 'workspace_supply_artifact_v1' ? artifact : {
      version: codecName, identity: input.identity, master: input.masterEvidence,
      observation: { ...fixture.artifact.input.master, S33: '3700', S33Nm: '輸送用機器' }, artifact };
    const bytes = new TextEncoder().encode(json(value));
    validateSupplyLinks({ ref: { codec: codecName, path: 'supply.json', digest: digest(bytes) },
      metadata: supplyCodecs.get(codecName)!(value), bytes }, ref => {
      const object = fixture.objects.find(object => json(object.ref) === json(ref));
      expect(object).toBeDefined(); return object!.value;
    });
  };
  expect(verify).not.toThrow();
  for (const floor of ['2020-01-01', '2025-01-01']) {
    input.episodeFrom = floor;
    expect(verify).toThrow('reference_conflict');
  }
});
test('margin zero, missing history and unverified basis remain distinct', () => {
  const result = calculateSupply(margin()).result;
  expect(result).toMatchObject({ buyingBalance: 1100, sellingBalance: 0, marginRatio: null,
    buyingBalanceWeeklyChange: null, digestionDays: null, comparisonState: 'price_basis_unverified' });
  expect(result.unavailable).toContainEqual({ metric: 'marginRatio', reason: 'zero_selling_balance' });
});
test.each([-1, NaN, Infinity])('invalid credit amount %s fails before publication', value => {
  const input = margin(); input.margin[0]!.LongVol = value;
  expect(() => calculateSupply(input)).toThrow();
});
test('weekly gaps cannot be relabelled as consecutive weeks even with comparable price basis', () => {
  const input = margin(); input.volumeEvidence = input.masterEvidence; input.basisComparable = true;
  input.margin[0]!.Date = '2026-08-28';
  expect(calculateSupply(input).result).toMatchObject({ buyingBalanceWeeklyChange: null, comparisonState: 'weekly_source_gap' });
});

test('eligible consecutive weekly balances use exact saved volumes and never future volume', () => {
  const input = margin(); input.volumeEvidence = input.masterEvidence; input.basisComparable = true;
  input.volume = Array.from({ length: 25 }, (_, index) => ({
    date: new Date(Date.parse('2026-08-18') + index * 86_400_000).toISOString().slice(0, 10), volume: 100 }));
  expect(calculateSupply(input).result).toMatchObject({ buyingBalanceWeeklyChange: 100,
    comparisonState: 'eligible', digestionDays: 11 });
  input.volume.push({ date: '2026-09-12', volume: 999999 });
  expect(() => calculateSupply(input)).toThrow();
});
test('supply codec rejects computed-value tampering and pre-publication current-day dates', () => {
  const input = margin(), codec = new WorkspaceSupplyCodec(supplyTarget(input));
  const artifact = codec.build(input, '2026-09-11T09:00:00.000Z');
  expect(codec.parse(artifact)).toEqual(artifact);
  expect(() => codec.parse({ ...artifact, result: { ...artifact.result, marginRatio: 99 } })).toThrow();
  expect(() => codec.build(input, '2026-09-11T08:00:00.000Z')).toThrow();
});
test('price evidence processing measures a frozen multi-year input and rejects foreign owners', () => {
  const input = margin(), artifact = readStep2aTechnicalFixture().artifact;
  const start = performance.now();
  const evidence = supplyPriceEvidence(input, artifact);
  console.info(JSON.stringify({ supplyPriceEvidenceMs: performance.now() - start }));
  expect(evidence.volume.every(row => row.date <= '2026-09-11')).toBe(true);
  input.from = '2026-09-11'; input.margin = input.margin.slice(-1);
  expect(supplyPriceEvidence(input, artifact)).toEqual({ basisComparable: true,
    volume: [{ date: '2026-09-11', volume: artifact.input.daily.at(-1)!.Vo }] });
  input.identity!.instrumentId = '00000000-0000-4000-8000-000000000002';
  expect(() => supplyPriceEvidence(input, artifact)).toThrow('reference_conflict');
});
test('new exact source endpoints do not admit arbitrary absolute paths', () => {
  for (const endpoint of ['/v2/markets/margin-interest', '/v2/markets/short-sale-report'])
    expect(() => assertMarketDataSafeV1({ endpoint }, {})).not.toThrow();
  for (const endpoint of ['/v2/markets/margin-interest/private', '/etc/passwd', 'C:\\private\\key'])
    expect(() => assertMarketDataSafeV1({ endpoint }, {})).toThrow();
});

test('prepared job cannot hide an exact master reference outside its declared backup closure', () => {
  const input = margin(), fixture = readStep2aTechnicalFixture().artifact.input;
  const artifact = new WorkspaceSupplyCodec(supplyTarget(input)).build(input, '2026-09-11T09:00:00.000Z');
  const prepared = { version: 'workspace_supply_prepared_v1', identity: input.identity, master: input.masterEvidence,
    observation: { ...fixture.master, S33: '3700', S33Nm: '輸送用機器' }, artifact };
  const metadata = supplyCodecs.get('workspace_supply_prepared_v1')!;
  expect(metadata(prepared).dependencies).toEqual([input.masterEvidence!]);
  expect(() => metadata({ ...prepared, master: { ...input.masterEvidence, path: 'another-master.json' } })).toThrow('reference_conflict');
});
