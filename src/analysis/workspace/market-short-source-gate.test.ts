import { expect, test } from 'bun:test';
import { inspectMarketShortCoverageV1, compareMarketShortPublicSampleV1,
  MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';

const date = '2026-09-10';
function rows() {
  return MARKET_SHORT_COVERAGE_V1.codes.map(S33 => ({ Date: date, S33,
    SellExShortVa: 0, ShrtWithResVa: 0, ShrtNoResVa: 0 }));
}
const inspect = (input: readonly unknown[]) => inspectMarketShortCoverageV1(input, date, '2026-09-14');

test('complete partition sums turnover including Other, not the arithmetic mean of sector ratios', () => {
  const input = rows();
  Object.assign(input[0]!, { SellExShortVa: 90, ShrtWithResVa: 10 });
  Object.assign(input.at(-1)!, { SellExShortVa: 90, ShrtNoResVa: 810 });
  const result = inspect(input);
  expect(result.state).toBe('available');
  expect(result.coverage).toEqual({ expected: 34, observed: 34, missing: [], duplicates: [] });
  expect(result.totals).toEqual({ nonShortSellingValue: 180, restrictedShortSellingValue: 10,
    unrestrictedShortSellingValue: 810, shortSellingValue: 820, totalSellingValue: 1000,
    shortSellingRatioPercent: 82, ratioUnavailableReason: null });
  expect(result.other?.totalSellingValue).toBe(900);
  expect(inspect([...input].reverse())).toEqual(result);
});

test('observed zero retains turnover with unavailable ratio; it cannot prove a nonempty public sample', () => {
  const result = inspect(rows());
  expect(result.state).toBe('available');
  expect(result.totals).toMatchObject({ shortSellingValue: 0, totalSellingValue: 0,
    shortSellingRatioPercent: null, ratioUnavailableReason: 'zero_total_selling_value' });
  expect(compareMarketShortPublicSampleV1(result).state).toBe('mismatch');
});

test.each(['empty', 'other_missing', 'sector_missing', 'duplicate', 'null'])('%s never produces subset market totals', kind => {
  const input: Record<string, unknown>[] = rows();
  if (kind === 'empty') input.length = 0;
  if (kind === 'other_missing') input.pop();
  if (kind === 'sector_missing') input.shift();
  if (kind === 'duplicate') input.push({ ...input[0]! });
  if (kind === 'null') input[0]!.SellExShortVa = null;
  const result = inspect(input);
  expect(result.state).toBe('unavailable'); expect(result.totals).toBeNull(); expect(result.other).toBeNull();
  expect(result).toMatchObject({ reason: kind === 'duplicate' ? 'duplicate_constituent'
    : kind === 'null' ? 'missing_amount' : 'incomplete_coverage' });
  expect(compareMarketShortPublicSampleV1(result).state).toBe('unavailable');
});

test.each(['negative', 'nan', 'infinity', 'unsafe_amount', 'unknown_category', 'total_row', 'unknown_field',
  'missing_field', 'string_amount', 'wrong_date', 'invalid_date', 'rows_limit'])('%s fails collection with safe diagnostics', kind => {
  const input: Record<string, unknown>[] = rows();
  const first = input[0]!;
  if (kind === 'negative') first.ShrtNoResVa = -1;
  if (kind === 'nan') first.ShrtNoResVa = NaN;
  if (kind === 'infinity') first.ShrtNoResVa = Infinity;
  if (kind === 'unsafe_amount') first.ShrtNoResVa = Number.MAX_VALUE;
  if (kind === 'unknown_category') first.S33 = 'private-unknown-category';
  if (kind === 'total_row') input.push({ ...first, S33: '0000' });
  if (kind === 'unknown_field') first.secret = 'private-provider-value';
  if (kind === 'missing_field') delete first.SellExShortVa;
  if (kind === 'string_amount') first.SellExShortVa = 'private-provider-value';
  if (kind === 'wrong_date') first.Date = '2026-09-11';
  if (kind === 'invalid_date') first.Date = '2026-09-31';
  if (kind === 'rows_limit') while (input.length <= 200) input.push({ ...first });
  expect(() => inspect(input)).toThrow('source_response_invalid');
});

test('safe component amounts cannot overflow the aggregate numeric boundary', () => {
  const input = rows();
  input[0]!.SellExShortVa = Number.MAX_SAFE_INTEGER;
  input[1]!.SellExShortVa = 1;
  expect(() => inspect(input)).toThrow('unsafe_total');
  input[1]!.SellExShortVa = 0;
  input[0]!.ShrtNoResVa = 1;
  expect(() => inspect(input)).toThrow('unsafe_total');
});

test('source decimals are preserved and input digest changes with corrected amounts', () => {
  const input = rows();
  input[0]!.SellExShortVa = 0.25; input[0]!.ShrtNoResVa = 0.75;
  const result = inspect(input);
  expect(result.totals?.shortSellingRatioPercent).toBe(75);
  input[0]!.SellExShortVa = 0.5;
  expect(inspect(input).inputDigest).not.toBe(result.inputDigest);
});

test.each([['2026-09-09', '2026-09-14'], ['2026-09-15', '2026-09-14'], ['2026-09-31', '2026-10-01'],
  [date, 'invalid']])('rejects unverified period or future observation %s / %s', (sample, asOf) => {
  expect(() => inspectMarketShortCoverageV1(rows(), sample, asOf)).toThrow('invalid_configuration');
});

test('rounded public comparisons reject a full million discrepancy and wrong sample date', () => {
  const input = rows();
  Object.assign(input.at(-1)!, { SellExShortVa: 181_612.6e6, ShrtWithResVa: 104_849.6e6, ShrtNoResVa: 36_738.6e6 });
  Object.assign(input[0]!, { SellExShortVa: (5_245_919 - 181_612.6) * 1e6,
    ShrtWithResVa: (2_948_443 - 104_849.6) * 1e6, ShrtNoResVa: (908_768 - 36_738.6) * 1e6 });
  expect(compareMarketShortPublicSampleV1(inspect(input)).state).toBe('matched');
  input[0]!.SellExShortVa += 1e6;
  expect(compareMarketShortPublicSampleV1(inspect(input)).state).toBe('mismatch');
  expect(compareMarketShortPublicSampleV1(inspectMarketShortCoverageV1(
    input.map(row => ({ ...row, Date: '2026-09-11' })), '2026-09-11', '2026-09-14')).state).toBe('unavailable');
});

test('the observed public-total discrepancy cannot be hidden by matching each component separately', () => {
  const input = rows();
  // Synthetic distribution of the live aggregate observations, not original source rows.
  Object.assign(input.at(-1)!, { SellExShortVa: 181_612_569_816,
    ShrtWithResVa: 104_850_009_978, ShrtNoResVa: 36_738_813_014 });
  Object.assign(input[0]!, { SellExShortVa: 5_245_919_759_105 - 181_612_569_816,
    ShrtWithResVa: 2_948_443_262_888 - 104_850_009_978,
    ShrtNoResVa: 908_768_748_764 - 36_738_813_014 });
  expect(compareMarketShortPublicSampleV1(inspect(input))).toMatchObject({ state: 'mismatch',
    totalsDeltaJPY: { nonShortSellingValue: 759_105, restrictedShortSellingValue: 262_888,
      unrestrictedShortSellingValue: 748_764, totalSellingValue: 1_770_757 } });
});
