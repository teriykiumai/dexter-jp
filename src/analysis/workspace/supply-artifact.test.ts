import { expect, test } from 'bun:test';
import { calculateSupply, supplyPriceEvidence, supplyTarget, WorkspaceSupplyCodec, type SupplyInput } from './supply-artifact.js';
import { readStep2aTechnicalFixture } from './technical-test-fixtures.js';
import { assertMarketDataSafeV1 } from '../market-data/contracts.js';
import { supplyCodecs } from './supply-objects.js';

function margin(): SupplyInput {
  const fixture = readStep2aTechnicalFixture().artifact.input;
  return { version: 'workspace_supply_input_v1', dataset: 'margin', identity: fixture.identity,
    scope: { kind: 'instrument-owned', instrumentId: fixture.identity.instrumentId }, masterEvidence: fixture.masterEvidence,
    from: '2026-08-01', through: '2026-09-11', source: { endpoint: '/v2/markets/margin-interest',
      query: { code: fixture.identity.code, from: '2026-08-01', to: '2026-09-11' }, fetchedAt: '2026-09-11T09:00:00.000Z', pageCount: 1 },
    margin: [{ Date: '2026-09-04', Code: fixture.identity.code, LongVol: 1000, ShrtVol: 100 },
      { Date: '2026-09-11', Code: fixture.identity.code, LongVol: 1100, ShrtVol: 0 }], reports: [], sector: [],
    volume: [], volumeEvidence: null, basisComparable: false };
}
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
