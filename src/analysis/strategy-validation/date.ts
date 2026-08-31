import { PointInTimeErrorV1 } from './errors.js';

declare const tseSessionDateBrand: unique symbol;
declare const outcomeAsOfSessionBrand: unique symbol;
declare const asOfCutoffBrand: unique symbol;
declare const sourceDateBrand: unique symbol;
declare const sourceEffectiveDateBrand: unique symbol;
declare const sourceEligibleDateBrand: unique symbol;

export type TseSessionDate = string & { readonly [tseSessionDateBrand]: true };
export type OutcomeAsOfSession = TseSessionDate & {
  readonly [outcomeAsOfSessionBrand]: true;
};
export type AsOfCutoff = string & { readonly [asOfCutoffBrand]: true };
export type SourceDate = string & { readonly [sourceDateBrand]: true };
export type SourceEffectiveDate = string & { readonly [sourceEffectiveDateBrand]: true };
export type SourceEligibleDate = string & { readonly [sourceEligibleDateBrand]: true };

export type PointInTimeConfidence = 'precommitted' | 'reconstructed_251_as_of';

export type PointInTimeObservationV1<T> = Readonly<{
  value: T;
  sourceDate: SourceDate;
  sourceEffectiveDate: SourceEffectiveDate;
  sourceEligibleDate: SourceEligibleDate;
  asOfCutoff: AsOfCutoff;
}>;

const STRICT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STRICT_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

export function isStrictGregorianDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = STRICT_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function parseDate(value: unknown): string {
  if (!isStrictGregorianDate(value)) {
    throw new PointInTimeErrorV1('invalid_date', 'Expected a strict Gregorian YYYY-MM-DD date.', value);
  }
  return value;
}

export const parseTseSessionDate = (value: unknown): TseSessionDate =>
  parseDate(value) as TseSessionDate;
export const parseSourceDate = (value: unknown): SourceDate => parseDate(value) as SourceDate;
export const parseSourceEffectiveDate = (value: unknown): SourceEffectiveDate =>
  parseDate(value) as SourceEffectiveDate;
export const parseSourceEligibleDate = (value: unknown): SourceEligibleDate =>
  parseDate(value) as SourceEligibleDate;

export function parseAsOfCutoff(value: unknown): AsOfCutoff {
  if (typeof value !== 'string') {
    throw new PointInTimeErrorV1('invalid_cutoff', 'Expected a UTC ISO-8601 instant ending in Z.', value);
  }
  const match = STRICT_UTC_PATTERN.exec(value);
  if (!match || !isStrictGregorianDate(`${match[1]}-${match[2]}-${match[3]}`)) {
    throw new PointInTimeErrorV1('invalid_cutoff', 'Expected a UTC ISO-8601 instant ending in Z.', value);
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59 || !Number.isFinite(Date.parse(value))) {
    throw new PointInTimeErrorV1('invalid_cutoff', 'Expected a valid UTC ISO-8601 instant.', value);
  }
  return new Date(Date.parse(value)).toISOString() as AsOfCutoff;
}

export function tokyoEndOfDayV1(value: unknown): AsOfCutoff {
  const date = parseDate(value);
  return `${date}T14:59:59.999Z` as AsOfCutoff;
}

export function tokyoDateFromUtcInstantV1(value: unknown): SourceDate {
  const cutoff = parseAsOfCutoff(value);
  const instant = Date.parse(cutoff) + 9 * 60 * 60 * 1_000;
  const date = new Date(instant).toISOString().slice(0, 10);
  return parseSourceDate(date);
}

export function compareStrictDatesV1(left: string, right: string): number {
  parseDate(left);
  parseDate(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function nextGregorianDateV1(value: unknown): SourceDate {
  const date = parseDate(value);
  const [yearText, monthText, dayText] = date.split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  let day = Number(dayText) + 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  if (year > 9_999) {
    throw new PointInTimeErrorV1('invalid_date', 'Date arithmetic exceeded the supported Gregorian range.', value);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as SourceDate;
}

export function previousGregorianDateV1(value: unknown): SourceDate {
  const date = parseDate(value);
  const [yearText, monthText, dayText] = date.split('-');
  let year = Number(yearText);
  let month = Number(monthText);
  let day = Number(dayText) - 1;
  if (day === 0) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    if (year < 1) {
      throw new PointInTimeErrorV1('invalid_date', 'Date arithmetic exceeded the supported Gregorian range.', value);
    }
    day = daysInMonth(year, month);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as SourceDate;
}

export function selectRowsAtOrBeforeV1<T>(
  rows: readonly T[],
  cutoff: unknown,
  eligibleDate: (row: T) => unknown,
): readonly T[] {
  const parsedCutoff = parseDate(cutoff);
  const selected: T[] = [];
  for (const row of rows) {
    const candidate = eligibleDate(row);
    if (typeof candidate !== 'string' || !STRICT_DATE_PATTERN.test(candidate)) {
      throw new PointInTimeErrorV1(
        'source_response_invalid',
        'A source row has no syntactically valid eligible date.',
        candidate,
      );
    }
    if (candidate <= parsedCutoff) {
      parseDate(candidate);
      selected.push(row);
    }
  }
  return selected;
}
