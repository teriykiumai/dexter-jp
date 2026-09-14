import { z } from 'zod';
import { sha256CanonicalJsonV1 } from '../snapshot/canonical-json.js';
import { isStrictGregorianDate } from '../strategy-validation/date.js';

/** A versioned partition, independent of a Workspace's current sector membership. */
export const MARKET_SHORT_COVERAGE_V1 = Object.freeze({
  version: 'tse_short_turnover_34_categories_v1',
  scope: 'market-scoped', scopeId: 'tse_regular_market_short_selling',
  sourceDefinition: 'jpx_short_selling_daily_including_foreign_securities_v1',
  calculationVersion: 'market_short_turnover_weighted_v1',
  effectiveFrom: '2026-09-10', effectiveThrough: null,
  // Policy floor, not the provider's historical availability or a listing date.
  reviewedOn: '2026-09-14',
  codes: Object.freeze(['0050', '1050', '2050', '3050', '3100', '3150', '3200', '3250',
    '3300', '3350', '3400', '3450', '3500', '3550', '3600', '3650', '3700', '3750',
    '3800', '4050', '5050', '5100', '5150', '5200', '5250', '6050', '6100', '7050',
    '7100', '7150', '7200', '8050', '9050', '9999'] as const),
  otherCategory: '9999_etf_reit_preferred_equity_contribution_securities',
  amountUnit: 'JPY', ratioUnit: 'percent',
} as const);
export const MARKET_SHORT_COVERAGE_DIGEST_V1 = sha256CanonicalJsonV1(MARKET_SHORT_COVERAGE_V1);

export class MarketShortSourceGateError extends Error {
  constructor(readonly code: 'invalid_configuration' | 'source_response_invalid' | 'unsafe_total') { super(code); }
}
const fail = (code: MarketShortSourceGateError['code']): never => { throw new MarketShortSourceGateError(code); };
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const MarketShortRowSchemaV1 = z.object({
  Date: z.string().refine(isStrictGregorianDate), S33: z.enum(MARKET_SHORT_COVERAGE_V1.codes),
  SellExShortVa: amount, ShrtWithResVa: amount, ShrtNoResVa: amount,
}).strict();

/** Diagnostic seam only. No source access, publication, instrument binding or latest fallback. */
export function inspectMarketShortCoverageV1(raw: readonly unknown[], date: string, asOfDate: string) {
  if (!isStrictGregorianDate(date) || !isStrictGregorianDate(asOfDate)
    || date < MARKET_SHORT_COVERAGE_V1.effectiveFrom || date > asOfDate) return fail('invalid_configuration');
  const parsed = z.array(MarketShortRowSchemaV1).max(200).safeParse(raw);
  if (!parsed.success || parsed.data.some(row => row.Date !== date)) return fail('source_response_invalid');
  const rows = parsed.data.sort((a, b) => a.S33.localeCompare(b.S33));
  const codes = new Set(rows.map(row => row.S33));
  const coverage = { expected: MARKET_SHORT_COVERAGE_V1.codes.length, observed: codes.size,
    missing: MARKET_SHORT_COVERAGE_V1.codes.filter(code => !codes.has(code)),
    duplicates: [...new Set(rows.filter((row, i) => i > 0 && row.S33 === rows[i - 1]!.S33).map(row => row.S33))] };
  const common = { date, coverage, registryDigest: MARKET_SHORT_COVERAGE_DIGEST_V1,
    inputDigest: sha256CanonicalJsonV1(rows), rowCount: rows.length };
  const unavailable = (reason: 'incomplete_coverage' | 'duplicate_constituent' | 'missing_amount') =>
    ({ ...common, state: 'unavailable' as const, reason, totals: null, other: null });
  if (coverage.duplicates.length) return unavailable('duplicate_constituent');
  if (coverage.missing.length) return unavailable('incomplete_coverage');
  if (rows.some(row => [row.SellExShortVa, row.ShrtWithResVa, row.ShrtNoResVa].includes(null))) {
    return unavailable('missing_amount');
  }
  const sum = (values: readonly number[]) => {
    const result = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER) return fail('unsafe_total');
    return result;
  };
  const nonShortSellingValue = sum(rows.map(row => row.SellExShortVa!));
  const restrictedShortSellingValue = sum(rows.map(row => row.ShrtWithResVa!));
  const unrestrictedShortSellingValue = sum(rows.map(row => row.ShrtNoResVa!));
  const shortSellingValue = sum([restrictedShortSellingValue, unrestrictedShortSellingValue]);
  const totalSellingValue = sum([nonShortSellingValue, shortSellingValue]);
  const other = rows.find(row => row.S33 === '9999')!;
  return { ...common, state: 'available' as const, reason: null, totals: { nonShortSellingValue,
    restrictedShortSellingValue, unrestrictedShortSellingValue, shortSellingValue, totalSellingValue,
    shortSellingRatioPercent: totalSellingValue === 0 ? null : 100 * (shortSellingValue / totalSellingValue),
    ratioUnavailableReason: totalSellingValue === 0 ? 'zero_total_selling_value' as const : null },
    other: { nonShortSellingValue: other.SellExShortVa!, restrictedShortSellingValue: other.ShrtWithResVa!,
      unrestrictedShortSellingValue: other.ShrtNoResVa!,
      totalSellingValue: sum([other.SellExShortVa!, other.ShrtWithResVa!, other.ShrtNoResVa!]) } };
}

/** JPX 2026-09-10 -m / -g tables, million JPY. Not synthetic API input. */
export const MARKET_SHORT_PUBLIC_SAMPLE_V1 = Object.freeze({
  date: '2026-09-10',
  totalUrl: 'https://www.jpx.co.jp/markets/statistics-equities/short-selling/t13vrt000001y46z-att/260910-m.pdf',
  sectorUrl: 'https://www.jpx.co.jp/markets/statistics-equities/short-selling/t13vrt000001y46z-att/260910-g.pdf',
  totals: Object.freeze({ nonShortSellingValue: 5_245_919, restrictedShortSellingValue: 2_948_443,
    unrestrictedShortSellingValue: 908_768, totalSellingValue: 9_103_130 }),
  other: Object.freeze({ nonShortSellingValue: 181_613, restrictedShortSellingValue: 104_850,
    unrestrictedShortSellingValue: 36_739, totalSellingValue: 323_201 }),
});

export function compareMarketShortPublicSampleV1(result: ReturnType<typeof inspectMarketShortCoverageV1>) {
  if (result.date !== MARKET_SHORT_PUBLIC_SAMPLE_V1.date || result.state !== 'available') {
    return { state: 'unavailable' as const, toleranceJPYExclusive: 1_000_000, totalsDeltaJPY: null, otherDeltaJPY: null };
  }
  // Public values are rounded to millions; the specification does not promise a
  // rounding mode. Require less than one printed unit per component and total.
  const delta = (actual: Record<keyof typeof MARKET_SHORT_PUBLIC_SAMPLE_V1.totals, number>,
    published: Record<keyof typeof MARKET_SHORT_PUBLIC_SAMPLE_V1.totals, number>) =>
    Object.fromEntries((Object.keys(published) as (keyof typeof published)[])
      .map(key => [key, actual[key] - published[key] * 1_000_000]));
  const totalsDeltaJPY = delta(result.totals, MARKET_SHORT_PUBLIC_SAMPLE_V1.totals);
  const otherDeltaJPY = delta(result.other, MARKET_SHORT_PUBLIC_SAMPLE_V1.other);
  return { state: [...Object.values(totalsDeltaJPY), ...Object.values(otherDeltaJPY)]
    .every(value => Math.abs(value) < 1_000_000) ? 'matched' as const : 'mismatch' as const,
    toleranceJPYExclusive: 1_000_000, totalsDeltaJPY, otherDeltaJPY };
}
