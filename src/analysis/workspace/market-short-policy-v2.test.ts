import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { digest, json } from './contracts.js';
import { MARKET_SHORT_BINDING_POLICY_V2, marketShortInputV2, calculateMarketShortV2, type MarketShortInputV2 } from './market-short-policy-v2.js';
import { MARKET_SHORT_PUBLIC_SAMPLE_V1 } from './market-short-source-gate.js';
import { WorkspaceMarketShortCodecV2 } from './market-short-artifact-v2.js';
import { bindingQualificationV1 } from './market-short-qualification.js';
import { marketShortCodecsV2 } from './market-short-objects-v2.js';
import { marketShortFixtureV2 } from './market-short-v2-test-fixtures.js';

const codec = new WorkspaceMarketShortCodecV2();
const ref = (input: MarketShortInputV2) => ({ path: `${randomUUID()}.json`, codec: input.version, digest: digest(json(input)) });
const build = (input = marketShortFixtureV2()) => codec.build(input, ref(input), input.acceptedAt);

test('complete JPY aggregate is eligible and approximate, without a published reference', () => {
  const input = marketShortFixtureV2(); input.rows.at(-1)!.ShrtNoResVa = 905;
  const artifact = build(input), q = artifact.qualification;
  expect(q).toMatchObject({ policyVersion: MARKET_SHORT_BINDING_POLICY_V2, state: 'eligible_reference', providerCompletion: 'not_guaranteed',
    correctionVintage: 'current_at_fetch_not_point_in_time', reconciliation: { state: 'approximate',
      reasons: ['published_rounding_method_unverified', 'published_reference_unavailable'], differences: null } });
  expect(artifact.result.totals).toMatchObject({ totalSellingValue: 4300, shortSellingValue: 1240, shortSellingRatioPercent: 100 * (1240 / 4300) });
  expect(codec.parse(artifact)).toEqual(artifact);
  const metadata = marketShortCodecsV2.get(artifact.schemaVersion)!(artifact);
  // V1 itself is still closed even for a V2 object; only the new policy admits it.
  expect(bindingQualificationV1(input.scope, 'market_short', [{ codec: artifact.schemaVersion, metadata }]).state).toBe('unqualified');
});
test.each([0, 999_999, 1_000_000, 1_770_757, 3_000_000, 100_000_000, -100_000_000])('difference %s never acts as a production threshold', difference => {
  const input = marketShortFixtureV2('2026-09-10'); input.rows.forEach(row => { row.SellExShortVa = row.ShrtWithResVa = row.ShrtNoResVa = 0; });
  const publicTotals = MARKET_SHORT_PUBLIC_SAMPLE_V1.totals;
  Object.assign(input.rows[0]!, { SellExShortVa: publicTotals.nonShortSellingValue * 1e6 + difference,
    ShrtWithResVa: publicTotals.restrictedShortSellingValue * 1e6, ShrtNoResVa: publicTotals.unrestrictedShortSellingValue * 1e6 });
  const { qualification: q } = build(input);
  expect(q.state).toBe('eligible_reference'); expect(q.reconciliation.state).toBe('approximate');
  const total = q.reconciliation.differences![0]!.cells.find(cell => cell.component === 'totalSellingValue')!;
  expect(total).toEqual({ component: 'totalSellingValue', aggregateJPY: publicTotals.totalSellingValue * 1e6 + difference,
    publishedMillionJPY: publicTotals.totalSellingValue, differenceJPY: difference });
  if (difference) expect(q.reconciliation.reasons).toContain('published_total_difference_present');
  expect(json(q)).not.toContain('tolerance');
});
test('the observed public discrepancy remains explicit evidence, not reconciled or unavailable', () => {
  const input = marketShortFixtureV2('2026-09-10'); input.rows.forEach(row => { row.SellExShortVa = row.ShrtWithResVa = row.ShrtNoResVa = 0; });
  Object.assign(input.rows[0]!, { SellExShortVa: 5_245_919_759_105, ShrtWithResVa: 2_948_443_262_888, ShrtNoResVa: 908_768_748_764 });
  const q = build(input).qualification;
  expect(q.reconciliation.differences![0]!.cells.map(cell => cell.differenceJPY)).toEqual([759105, 262888, 748764, 1770757]);
  expect(q.reconciliation.reasons).toContain('published_total_difference_present');
  expect(q).toMatchObject({ state: 'eligible_reference', reconciliation: { state: 'approximate' } });
});
test('valid zero turnover is eligible but cannot fabricate a ratio', () => {
  const input = marketShortFixtureV2(); input.rows.forEach(row => { row.SellExShortVa = row.ShrtWithResVa = row.ShrtNoResVa = 0; });
  expect(build(input).result.totals).toMatchObject({ totalSellingValue: 0, shortSellingValue: 0,
    shortSellingRatioPercent: null, ratioUnavailableReason: 'zero_total_selling_value' });
});
test.each(['2026-09-14T08:29:59.999Z', '2026-09-13T15:00:00.000Z'])('same-day admission %s fails before the application cutoff', time => {
  expect(() => build(marketShortFixtureV2('2026-09-14', time))).toThrow();
});
test.each(['2026-09-14T08:30:00.000Z', '2026-09-14T08:30:00.001Z', '2026-09-14T15:00:00.000Z'])('admission %s retains completion and vintage warnings', time => {
  const q = build(marketShortFixtureV2('2026-09-14', time)).qualification;
  expect(q.warnings).toEqual(['provider_completion_not_guaranteed', 'not_point_in_time_history']);
  expect(q.completionPolicy).toBe('dexter_market_short_1730_jst_v2');
});
test.each(['0', '3'] as const)('official holiday division %s is not a TSE session, even on a weekday', HolDiv => {
  const input = marketShortFixtureV2('2026-09-14', '2026-09-14T08:30:00.000Z'); input.calendar.rows[0]!.HolDiv = HolDiv;
  expect(() => build(input)).toThrow();
});
test('official half-day and irregular weekend sessions use the calendar, not weekend arithmetic', () => {
  const half = marketShortFixtureV2(); half.calendar.rows[0]!.HolDiv = '2'; expect(() => build(half)).not.toThrow();
  expect(() => build(marketShortFixtureV2('2026-09-13'))).not.toThrow(); // Synthetic irregular session.
});
const changes: [string, (v: MarketShortInputV2) => unknown][] = [
  ['missing category', v => ({ ...v, rows: v.rows.slice(1), source: { ...v.source, rowCount: 33 },
    execution: { ...v.execution, acceptedRows: 34 } })],
  ['duplicate category', v => ({ ...v, rows: [v.rows[0], ...v.rows.slice(0, -1)] })],
  ['null amount', v => ({ ...v, rows: [{ ...v.rows[0], ShrtWithResVa: null }, ...v.rows.slice(1)] })],
  ['unknown category', v => ({ ...v, rows: [{ ...v.rows[0], S33: '0000' }, ...v.rows.slice(1)] })],
  ['unknown field', v => ({ ...v, rows: [{ ...v.rows[0], Extra: 0 }, ...v.rows.slice(1)] })],
  ...[-1, NaN, Infinity, Number.MAX_VALUE, '5'].map(amount => [String(amount), (v: MarketShortInputV2) =>
    ({ ...v, rows: [{ ...v.rows[0], ShrtWithResVa: amount }, ...v.rows.slice(1)] })] as [string, (v: MarketShortInputV2) => unknown]),
  ['unsafe sum', v => ({ ...v, rows: v.rows.map(row => ({ ...row, SellExShortVa: Number.MAX_SAFE_INTEGER })) })],
  ['wrong date', v => ({ ...v, rows: v.rows.map(row => ({ ...row, Date: '2026-09-10' })) })],
  ['source query date', v => ({ ...v, source: { ...v.source, query: { date: '2026-09-10' } } })],
  ['source subset query', v => ({ ...v, source: { ...v.source, query: { date: v.date, s33: '0050' } } })],
  ['source pages incomplete', v => ({ ...v, source: { ...v.source, complete: false } })],
  ['calendar pages incomplete', v => ({ ...v, calendar: { ...v.calendar, evidence: { ...v.calendar.evidence, complete: false } } })],
  ['calendar missing', v => ({ ...v, calendar: { ...v.calendar, rows: [] } })],
  ['calendar duplicate', v => ({ ...v, calendar: { ...v.calendar, rows: [...v.calendar.rows, ...v.calendar.rows] } })],
  ['calendar date mismatch', v => ({ ...v, calendar: { ...v.calendar, rows: [{ Date: '2026-09-10', HolDiv: '1' }] } })],
  ['calendar unknown field', v => ({ ...v, calendar: { ...v.calendar, rows: [{ ...v.calendar.rows[0], Extra: 0 }] } })],
  ['calendar query mismatch', v => ({ ...v, calendar: { ...v.calendar, query: { from: v.date, to: '2026-09-14' } } })],
  ['calendar unknown division', v => ({ ...v, calendar: { ...v.calendar, rows: [{ Date: v.date, HolDiv: '4' }] } })],
  ['scope', v => ({ ...v, scope: { ...v.scope, universe: 'all_japan' } })],
  ['registry', v => ({ ...v, registry: { codes: ['0050'] } })],
  ['old version', v => ({ ...v, version: 'workspace_market_short_input_v1' })],
  ['old policy', v => ({ ...v, policyVersion: 'workspace_market_short_binding_qualification_v1' })],
  ['trusted flag', v => ({ ...v, verified: true })],
  ['impossible dispatch spacing', v => ({ ...v, execution: { ...v.execution, elapsedMs: 11999 } })],
  ['lower configured rate', v => ({ ...v, execution: { ...v.execution, requestsPerMinute: 1 } })],
  ['vintage', v => ({ ...v, correctionVintage: 'point_in_time' })],
  ['forged public reference', v => ({ ...v, publishedReference: MARKET_SHORT_PUBLIC_SAMPLE_V1 })],
  ['future', _v => marketShortFixtureV2('2026-09-15')],
  ['pre-floor', _v => marketShortFixtureV2('2026-09-09')],
  ['fetch before admission', v => ({ ...v, calendar: { ...v.calendar, evidence: { ...v.calendar.evidence, fetchedAt: '2026-09-13T00:00:00.000Z' } } })],
  ['fetch over deadline', v => ({ ...v, source: { ...v.source, fetchedAt: '2026-09-14T00:01:00.000Z' } })],
  ...Object.entries({ attempts: 6, pages: 6, acceptedRows: 201, responseBytes: 2 * 1024 * 1024 + 1, elapsedMs: 60_000, requestsPerMinute: 6, retries: 1 })
    .map(([key, value]) => [`execution ${key}`, (v: MarketShortInputV2) => ({ ...v, execution: { ...v.execution, [key]: value } })] as [string, (v: MarketShortInputV2) => unknown]),
];
test.each(changes)('hard gate rejects %s despite approximate policy', (_name, change) => {
  expect(() => marketShortInputV2(change(marketShortFixtureV2()))).toThrow();
  expect(() => calculateMarketShortV2(change(marketShortFixtureV2()))).toThrow();
});
test('a calendar-confirmed weekend is unavailable and a known public reference cannot be omitted', () => {
  const weekend = marketShortFixtureV2('2026-09-13'); weekend.calendar.rows[0]!.HolDiv = '0';
  expect(() => marketShortInputV2(weekend)).toThrow();
  expect(() => marketShortInputV2({ ...marketShortFixtureV2('2026-09-10'), publishedReference: null })).toThrow();
});
test('rehashing qualified flags, a result or warning removal cannot bypass deterministic replay', () => {
  const artifact = build();
  for (const change of [
    { qualification: { ...artifact.qualification, reconciliation: { ...artifact.qualification.reconciliation, state: 'verified' } } },
    { qualification: { ...artifact.qualification, warnings: [] } },
    { result: { ...artifact.result, totals: { ...artifact.result.totals, shortSellingRatioPercent: 99 } } },
  ]) {
    const { artifactDigest: _digest, ...payload } = { ...artifact, ...change };
    expect(() => codec.parse({ ...payload, artifactDigest: digest(json(payload)) })).toThrow();
  }
});
