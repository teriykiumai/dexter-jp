import {
  compareDecimalRationalV1,
  decimalRationalToNumberV1,
  decimalRationalV1,
  floorRationalQuotientV1,
  isIntegerMultipleV1,
  multiplyRationalByIntegerV1,
  type DecimalRationalV1,
} from './decimal.js';
import { parseTseSessionDate, type TseSessionDate } from './date.js';
import { PointInTimeErrorV1 } from './errors.js';

export const TSE_TICK_RULE_VERSION = 'tse_tick_rule_v1' as const;
export const TSE_TICK_RULE_START = '2015-09-24' as const;
export const TSE_TICK_RULE_END = '2027-02-28' as const;
const MID400_FINE_START = '2023-06-05' as const;

export const TSE_TICK_CATEGORIES_V1 = Object.freeze([
  'topix_core30',
  'topix_large70',
  'topix_mid400',
  'other',
] as const);
export type TseTickCategoryV1 = (typeof TSE_TICK_CATEGORIES_V1)[number];

export function jQuantsScaleCategoryToTseTickCategoryV1(
  scaleCategory: string | null,
): TseTickCategoryV1 | null {
  if (scaleCategory === null || scaleCategory.length === 0) return null;
  if (scaleCategory === 'TOPIX Core30') return 'topix_core30';
  if (scaleCategory === 'TOPIX Large70') return 'topix_large70';
  if (scaleCategory === 'TOPIX Mid400') return 'topix_mid400';
  return 'other';
}

export type TseTickUnavailableReasonV1 =
  | 'tick_rule_period_unsupported'
  | 'tick_category_unavailable';

export type TseTickUnavailableV1 = Readonly<{
  state: 'unavailable';
  reason: TseTickUnavailableReasonV1;
}>;

export type TseTickResolutionV1 = Readonly<{
  state: 'available';
  date: TseSessionDate;
  category: TseTickCategoryV1;
  table: 'fine' | 'ordinary';
  tick: number;
}> | TseTickUnavailableV1;

export type TseExecutablePriceResultV1 = Readonly<{
  state: 'available';
  date: TseSessionDate;
  category: TseTickCategoryV1;
  table: 'fine' | 'ordinary';
  tick: number;
  executable: boolean;
}> | TseTickUnavailableV1;

export type TseNextQuoteResultV1 = Readonly<{
  state: 'available';
  date: TseSessionDate;
  category: TseTickCategoryV1;
  table: 'fine' | 'ordinary';
  price: number;
  tick: number;
}> | TseTickUnavailableV1;

type TickBandV1 = Readonly<{
  upper: number | null;
  fine: number;
  ordinary: number;
}>;

export const TSE_TICK_BANDS_V1: readonly TickBandV1[] = Object.freeze([
  { upper: 1_000, fine: 0.1, ordinary: 1 },
  { upper: 3_000, fine: 0.5, ordinary: 1 },
  { upper: 5_000, fine: 1, ordinary: 5 },
  { upper: 10_000, fine: 1, ordinary: 10 },
  { upper: 30_000, fine: 5, ordinary: 10 },
  { upper: 50_000, fine: 10, ordinary: 50 },
  { upper: 100_000, fine: 10, ordinary: 100 },
  { upper: 300_000, fine: 50, ordinary: 100 },
  { upper: 500_000, fine: 100, ordinary: 500 },
  { upper: 1_000_000, fine: 100, ordinary: 1_000 },
  { upper: 3_000_000, fine: 500, ordinary: 1_000 },
  { upper: 5_000_000, fine: 1_000, ordinary: 5_000 },
  { upper: 10_000_000, fine: 1_000, ordinary: 10_000 },
  { upper: 30_000_000, fine: 5_000, ordinary: 10_000 },
  { upper: 50_000_000, fine: 10_000, ordinary: 50_000 },
  { upper: null, fine: 10_000, ordinary: 100_000 },
].map(band => Object.freeze(band)));

function categoryFromEvidence(evidence: readonly unknown[]): TseTickCategoryV1 | null {
  if (evidence.length === 0) return null;
  const unique = new Set<TseTickCategoryV1>();
  for (const value of evidence) {
    if (typeof value !== 'string' || !TSE_TICK_CATEGORIES_V1.includes(value as TseTickCategoryV1)) {
      return null;
    }
    unique.add(value as TseTickCategoryV1);
  }
  return unique.size === 1 ? [...unique][0] ?? null : null;
}

function tableFor(date: TseSessionDate, category: TseTickCategoryV1): 'fine' | 'ordinary' {
  if (category === 'topix_core30' || category === 'topix_large70') return 'fine';
  if (category === 'topix_mid400' && date >= MID400_FINE_START) return 'fine';
  return 'ordinary';
}

function basis(
  dateValue: unknown,
  categoryEvidence: readonly unknown[],
): Readonly<{ date: TseSessionDate; category: TseTickCategoryV1; table: 'fine' | 'ordinary' }>
  | TseTickUnavailableV1 {
  const date = parseTseSessionDate(dateValue);
  if (date < TSE_TICK_RULE_START || date > TSE_TICK_RULE_END) {
    return Object.freeze({ state: 'unavailable', reason: 'tick_rule_period_unsupported' });
  }
  const category = categoryFromEvidence(categoryEvidence);
  if (category === null) {
    return Object.freeze({ state: 'unavailable', reason: 'tick_category_unavailable' });
  }
  return Object.freeze({ date, category, table: tableFor(date, category) });
}

function positivePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'A price must be finite and positive.', value);
  }
  return value;
}

function bandFor(price: number): TickBandV1 {
  return TSE_TICK_BANDS_V1.find(band => band.upper === null || price <= band.upper)
    ?? TSE_TICK_BANDS_V1[TSE_TICK_BANDS_V1.length - 1]!;
}

export function resolveTseTickV1(
  dateValue: unknown,
  categoryEvidence: readonly unknown[],
  priceValue: unknown,
): TseTickResolutionV1 {
  const resolvedBasis = basis(dateValue, categoryEvidence);
  if ('state' in resolvedBasis) return resolvedBasis;
  const price = positivePrice(priceValue);
  const band = bandFor(price);
  return Object.freeze({
    state: 'available',
    ...resolvedBasis,
    tick: band[resolvedBasis.table],
  });
}

export function isExecutableTsePriceV1(
  dateValue: unknown,
  categoryEvidence: readonly unknown[],
  priceValue: unknown,
): TseExecutablePriceResultV1 {
  const resolution = resolveTseTickV1(dateValue, categoryEvidence, priceValue);
  if (resolution.state === 'unavailable') return resolution;
  const price = positivePrice(priceValue);
  return Object.freeze({ ...resolution, executable: isIntegerMultipleV1(price, resolution.tick) });
}

function greater(left: DecimalRationalV1, right: DecimalRationalV1): DecimalRationalV1 {
  return compareDecimalRationalV1(left, right) >= 0 ? left : right;
}

export function nextTseQuoteAboveV1(
  dateValue: unknown,
  categoryEvidence: readonly unknown[],
  referencePriceValue: unknown,
): TseNextQuoteResultV1 {
  const resolvedBasis = basis(dateValue, categoryEvidence);
  if ('state' in resolvedBasis) return resolvedBasis;
  const referencePrice = positivePrice(referencePriceValue);

  const reference = decimalRationalV1(referencePrice);
  let lower = decimalRationalV1(0);
  for (const band of TSE_TICK_BANDS_V1) {
    const stepValue = band[resolvedBasis.table];
    const step = decimalRationalV1(stepValue);
    const minimum = greater(reference, lower);
    const multiplier = floorRationalQuotientV1(minimum, step) + 1n;
    const candidate = multiplyRationalByIntegerV1(step, multiplier);
    if (band.upper === null
      || compareDecimalRationalV1(candidate, decimalRationalV1(band.upper)) <= 0) {
      return Object.freeze({
        state: 'available',
        ...resolvedBasis,
        price: decimalRationalToNumberV1(candidate),
        tick: stepValue,
      });
    }
    lower = decimalRationalV1(band.upper);
  }
  throw new PointInTimeErrorV1('source_response_invalid', 'No executable quote could be resolved.');
}
