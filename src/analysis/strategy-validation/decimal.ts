import { PointInTimeErrorV1 } from './errors.js';

export type DecimalRationalV1 = Readonly<{
  numerator: bigint;
  denominator: bigint;
}>;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function normalize(numerator: bigint, denominator: bigint): DecimalRationalV1 {
  if (denominator === 0n) {
    throw new PointInTimeErrorV1('source_response_invalid', 'A decimal denominator cannot be zero.');
  }
  const sign = denominator < 0n ? -1n : 1n;
  const common = gcd(numerator, denominator);
  return Object.freeze({
    numerator: sign * numerator / common,
    denominator: sign * denominator / common,
  });
}

export function decimalRationalV1(value: number): DecimalRationalV1 {
  if (!Number.isFinite(value)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Expected a finite decimal number.', value);
  }
  const text = value.toString().toLowerCase();
  const [coefficient, exponentText] = text.split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const negative = coefficient?.startsWith('-') ?? false;
  const unsigned = negative ? coefficient?.slice(1) : coefficient;
  const [integerPart = '', fractionalPart = ''] = unsigned?.split('.') ?? [];
  const digits = `${integerPart}${fractionalPart}`;
  if (!/^\d+$/.test(digits) || !Number.isInteger(exponent)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Expected a finite decimal number.', value);
  }
  const signedDigits = (negative ? -1n : 1n) * BigInt(digits);
  const scale = fractionalPart.length - exponent;
  return scale >= 0
    ? normalize(signedDigits, 10n ** BigInt(scale))
    : normalize(signedDigits * 10n ** BigInt(-scale), 1n);
}

export function multiplyDecimalRationalV1(
  left: DecimalRationalV1,
  right: DecimalRationalV1,
): DecimalRationalV1 {
  return normalize(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

export function compareDecimalRationalV1(
  left: DecimalRationalV1,
  right: DecimalRationalV1,
): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function isIntegerMultipleV1(value: number, step: number): boolean {
  if (!(value > 0) || !(step > 0)) return false;
  const left = decimalRationalV1(value);
  const right = decimalRationalV1(step);
  return (left.numerator * right.denominator) % (left.denominator * right.numerator) === 0n;
}

export function floorRationalQuotientV1(
  value: DecimalRationalV1,
  step: DecimalRationalV1,
): bigint {
  if (value.numerator < 0n || step.numerator <= 0n) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Positive decimal values are required.');
  }
  return (value.numerator * step.denominator) / (value.denominator * step.numerator);
}

export function multiplyRationalByIntegerV1(
  value: DecimalRationalV1,
  multiplier: bigint,
): DecimalRationalV1 {
  return normalize(value.numerator * multiplier, value.denominator);
}

export function decimalRationalToNumberV1(value: DecimalRationalV1): number {
  const result = Number(value.numerator) / Number(value.denominator);
  if (!Number.isFinite(result)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'A decimal result is outside the finite number range.');
  }
  return result;
}

export function roundProductToOneDecimalV1(
  value: number,
  factor: DecimalRationalV1,
): number {
  if (!(value > 0) || factor.numerator <= 0n) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Positive price and adjustment values are required.');
  }
  const product = multiplyDecimalRationalV1(decimalRationalV1(value), factor);
  const scaledNumerator = product.numerator * 10n;
  let rounded = scaledNumerator / product.denominator;
  const remainder = scaledNumerator % product.denominator;
  if (remainder * 2n >= product.denominator) rounded += 1n;
  const result = Number(rounded) / 10;
  if (!Number.isFinite(result) || !(result > 0)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'An adjusted price is outside the finite positive range.');
  }
  return result;
}
