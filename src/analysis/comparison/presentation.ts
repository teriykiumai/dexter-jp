import type { ComparisonDisplaySemanticsV1 } from './schema.js';

export function comparisonPresentationNumberV1(
  value: number,
  semantics: Exclude<ComparisonDisplaySemanticsV1, 'category'>,
): number {
  if (!Number.isFinite(value)) throw new TypeError('Comparison display values must be finite.');
  const converted = semantics === 'fraction_as_percent' ? value * 100 : value;
  return Object.is(converted, -0) ? 0 : converted;
}
