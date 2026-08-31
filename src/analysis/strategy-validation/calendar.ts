import {
  nextGregorianDateV1,
  parseAsOfCutoff,
  parseTseSessionDate,
  selectRowsAtOrBeforeV1,
  tokyoDateFromUtcInstantV1,
  type OutcomeAsOfSession,
  type TseSessionDate,
} from './date.js';
import { PointInTimeErrorV1 } from './errors.js';

export type TseHolidayDivisionV1 = '0' | '1' | '2' | '3';

export type TseCalendarSourceRowV1 = Readonly<{
  Date: unknown;
  HolDiv: unknown;
}>;

export type TseCalendarRowV1 = Readonly<{
  date: TseSessionDate;
  holidayDivision: TseHolidayDivisionV1;
  isSession: boolean;
}>;

const HOLIDAY_DIVISIONS = new Set<unknown>(['0', '1', '2', '3']);
const CALENDAR_CONSTRUCTOR_TOKEN: unique symbol = Symbol('TseSessionCalendarV1');

export class TseSessionCalendarV1 {
  readonly rows: readonly TseCalendarRowV1[];
  readonly sessions: readonly TseSessionDate[];
  readonly requiredFrom: TseSessionDate;
  readonly requiredTo: TseSessionDate;
  readonly #sessionIndex: ReadonlyMap<string, number>;
  readonly #dates: ReadonlySet<string>;

  constructor(
    rows: readonly TseCalendarRowV1[],
    requiredFrom: TseSessionDate,
    requiredTo: TseSessionDate,
    token: typeof CALENDAR_CONSTRUCTOR_TOKEN,
  ) {
    if (token !== CALENDAR_CONSTRUCTOR_TOKEN) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'Use createTseSessionCalendarV1 to build a validated calendar.');
    }
    this.rows = rows.map(row => Object.freeze({ ...row }));
    this.sessions = Object.freeze(this.rows.filter(row => row.isSession).map(row => row.date));
    this.requiredFrom = requiredFrom;
    this.requiredTo = requiredTo;
    this.#sessionIndex = new Map(this.sessions.map((date, index) => [date, index]));
    this.#dates = new Set(this.rows.map(row => row.date));
  }

  hasCalendarDate(value: unknown): boolean {
    const date = parseTseSessionDate(value);
    return this.#dates.has(date);
  }

  isSession(value: unknown): boolean {
    const date = parseTseSessionDate(value);
    return this.#sessionIndex.has(date);
  }

  previousSessionBefore(value: unknown): TseSessionDate {
    const date = parseTseSessionDate(value);
    if (!this.#dates.has(date)) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'The calendar does not cover the requested date.', date);
    }
    for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
      const session = this.sessions[index];
      if (session !== undefined && session < date) return session;
    }
    throw new PointInTimeErrorV1('calendar_incomplete', 'No preceding TSE session is available.', date);
  }

  nextSessionAfter(value: unknown): TseSessionDate {
    const date = parseTseSessionDate(value);
    if (!this.#dates.has(date)) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'The calendar does not cover the requested date.', date);
    }
    const session = this.sessions.find(candidate => candidate > date);
    if (session === undefined) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'No following TSE session is available.', date);
    }
    return session;
  }

  shiftSession(value: unknown, offset: number): TseSessionDate {
    const date = parseTseSessionDate(value);
    if (!Number.isSafeInteger(offset)) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Session offset must be a safe integer.', offset);
    }
    const start = this.#sessionIndex.get(date);
    if (start === undefined) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'The requested date is not a TSE session.', date);
    }
    const result = this.sessions[start + offset];
    if (result === undefined) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'The requested session offset is outside calendar coverage.', { date, offset });
    }
    return result;
  }
}

function sourceRow(value: unknown): TseCalendarSourceRowV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PointInTimeErrorV1('source_response_invalid', 'Calendar rows must be objects.', value);
  }
  const row = value as Record<string, unknown>;
  return { Date: row.Date, HolDiv: row.HolDiv };
}

export function createTseSessionCalendarV1(
  inputRows: readonly unknown[],
  requiredFromValue: unknown,
  requiredToValue: unknown,
): TseSessionCalendarV1 {
  const requiredFrom = parseTseSessionDate(requiredFromValue);
  const requiredTo = parseTseSessionDate(requiredToValue);
  if (requiredFrom > requiredTo) {
    throw new PointInTimeErrorV1('calendar_incomplete', 'Calendar window boundaries are reversed.');
  }

  const decoded = inputRows.map(sourceRow);
  const eligible = selectRowsAtOrBeforeV1(decoded, requiredTo, row => row.Date);
  const rows: TseCalendarRowV1[] = [];
  for (const row of eligible) {
    const date = parseTseSessionDate(row.Date);
    if (date < requiredFrom) {
      throw new PointInTimeErrorV1('source_response_invalid', 'A calendar row is outside the requested date envelope.', date);
    }
    if (!HOLIDAY_DIVISIONS.has(row.HolDiv)) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Calendar HolDiv is unsupported.', row.HolDiv);
    }
    const holidayDivision = row.HolDiv as TseHolidayDivisionV1;
    const normalized = Object.freeze({
      date,
      holidayDivision,
      isSession: holidayDivision === '1' || holidayDivision === '2',
    });
    const previous = rows.at(-1);
    if (previous?.date === date) {
      if (previous.holidayDivision !== holidayDivision) {
        throw new PointInTimeErrorV1('source_response_invalid', 'A calendar date has conflicting HolDiv values.', date);
      }
      continue;
    }
    if (previous !== undefined && previous.date > date) {
      throw new PointInTimeErrorV1('source_response_invalid', 'Calendar rows are not monotonic.', date);
    }
    rows.push(normalized);
  }

  let expected: string = requiredFrom;
  for (const row of rows) {
    if (row.date !== expected) {
      throw new PointInTimeErrorV1('calendar_incomplete', 'A calendar date is missing inside the required window.', expected);
    }
    if (expected !== requiredTo) expected = nextGregorianDateV1(expected);
  }
  if (rows.length === 0 || rows.at(-1)?.date !== requiredTo) {
    throw new PointInTimeErrorV1('calendar_incomplete', 'The calendar does not cover the required window.', requiredTo);
  }

  return new TseSessionCalendarV1(rows, requiredFrom, requiredTo, CALENDAR_CONSTRUCTOR_TOKEN);
}

export function deriveOutcomeAsOfSessionV1(
  calendar: TseSessionCalendarV1,
  startedAtValue: unknown,
): OutcomeAsOfSession {
  const startedAt = parseAsOfCutoff(startedAtValue);
  const tokyoDate = tokyoDateFromUtcInstantV1(startedAt);
  return calendar.previousSessionBefore(tokyoDate) as OutcomeAsOfSession;
}
