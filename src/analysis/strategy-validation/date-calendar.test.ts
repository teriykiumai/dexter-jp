import { describe, expect, test } from 'bun:test';
import {
  createTseSessionCalendarV1,
  deriveOutcomeAsOfSessionV1,
  parseAsOfCutoff,
  parseTseSessionDate,
  selectRowsAtOrBeforeV1,
  tokyoDateFromUtcInstantV1,
  tokyoEndOfDayV1,
} from './index.js';

describe('strict point-in-time dates', () => {
  test('accepts real Gregorian dates and UTC Z instants without coercion', () => {
    expect(String(parseTseSessionDate('2024-02-29'))).toBe('2024-02-29');
    expect(() => parseTseSessionDate('2025-02-29')).toThrow('strict Gregorian');
    expect(() => parseTseSessionDate('2025-2-03')).toThrow('strict Gregorian');
    expect(String(parseAsOfCutoff('2025-01-02T03:04:05.006Z'))).toBe('2025-01-02T03:04:05.006Z');
    expect(String(parseAsOfCutoff('2025-01-02T03:04:05.1Z'))).toBe('2025-01-02T03:04:05.100Z');
    expect(() => parseAsOfCutoff('2025-01-02T03:04:05+09:00')).toThrow('ending in Z');
    expect(() => parseAsOfCutoff('2025-01-02T24:00:00Z')).toThrow('valid UTC');
  });

  test('implements tokyo_end_of_day_v1 and Tokyo date boundaries exactly', () => {
    expect(String(tokyoEndOfDayV1('2025-03-31'))).toBe('2025-03-31T14:59:59.999Z');
    expect(String(tokyoDateFromUtcInstantV1('2025-03-31T14:59:59.999Z'))).toBe('2025-03-31');
    expect(String(tokyoDateFromUtcInstantV1('2025-03-31T15:00:00.000Z'))).toBe('2025-04-01');
  });

  test('filters future rows before impossible-date and domain validation', () => {
    const rows = [
      { eligibleDate: '2025-01-02', value: 'eligible' },
      { eligibleDate: '9999-99-99', value: 'malformed-future' },
    ] as const;
    expect(selectRowsAtOrBeforeV1(rows, '2025-01-02', row => row.eligibleDate)).toEqual([
      rows[0],
    ]);
    expect(() => selectRowsAtOrBeforeV1(
      [{ eligibleDate: '2025-02-30' }],
      '2025-03-01',
      row => row.eligibleDate,
    )).toThrow('strict Gregorian');
  });
});

describe('TseSessionCalendarV1', () => {
  const rows = [
    { Date: '2025-01-01', HolDiv: '0' },
    { Date: '2025-01-02', HolDiv: '1' },
    { Date: '2025-01-03', HolDiv: '2' },
    { Date: '2025-01-04', HolDiv: '0' },
    { Date: '2025-01-05', HolDiv: '3' },
    { Date: '2025-01-06', HolDiv: '1' },
  ] as const;

  test('owns official-session predecessor, successor, and ordinal arithmetic', () => {
    const calendar = createTseSessionCalendarV1(rows, '2025-01-01', '2025-01-06');
    expect(calendar.sessions.map(String)).toEqual(['2025-01-02', '2025-01-03', '2025-01-06']);
    expect(calendar.isSession('2025-01-03')).toBe(true);
    expect(calendar.isSession('2025-01-04')).toBe(false);
    expect(String(calendar.previousSessionBefore('2025-01-06'))).toBe('2025-01-03');
    expect(String(calendar.nextSessionAfter('2025-01-03'))).toBe('2025-01-06');
    expect(String(calendar.shiftSession('2025-01-02', 2))).toBe('2025-01-06');
  });

  test('derives outcomeAsOfSession strictly before the frozen Tokyo date', () => {
    const calendar = createTseSessionCalendarV1(rows, '2025-01-01', '2025-01-06');
    expect(String(deriveOutcomeAsOfSessionV1(calendar, '2025-01-03T14:59:59.999Z'))).toBe('2025-01-02');
    expect(String(deriveOutcomeAsOfSessionV1(calendar, '2025-01-03T15:00:00.000Z'))).toBe('2025-01-03');
  });

  test('fails closed for gaps, conflicts, unknown HolDiv, and non-monotonic rows', () => {
    expect(() => createTseSessionCalendarV1(
      [rows[0], rows[2]], '2025-01-01', '2025-01-03',
    )).toThrow('missing inside');
    expect(() => createTseSessionCalendarV1(
      [rows[0], { Date: '2025-01-01', HolDiv: '1' }], '2025-01-01', '2025-01-01',
    )).toThrow('conflicting');
    expect(() => createTseSessionCalendarV1(
      [{ Date: '2025-01-01', HolDiv: '9' }], '2025-01-01', '2025-01-01',
    )).toThrow('unsupported');
    expect(() => createTseSessionCalendarV1(
      [rows[1], rows[0]], '2025-01-01', '2025-01-02',
    )).toThrow('not monotonic');
  });

  test('ignores future domain errors before validation and leaves input unchanged', () => {
    const input = [
      ...rows.slice(0, 2).map(row => ({ ...row })),
      { Date: '2025-01-03', HolDiv: 'unknown' },
    ];
    const before = structuredClone(input);
    const calendar = createTseSessionCalendarV1(input, '2025-01-01', '2025-01-02');
    expect(calendar.sessions.map(String)).toEqual(['2025-01-02']);
    expect(input).toEqual(before);
  });
});
