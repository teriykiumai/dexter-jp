import { describe, expect, test } from 'bun:test';
import { analyzeAdvancedTechnical, calculateMacd, calculateRsi } from '../../tools/finance/advanced-technical-engine.js';
import { createTseSessionCalendarV1 } from '../strategy-validation/calendar.js';
import {
  calculateTechnicalSeriesV1, getTechnicalCalendarCoverageV1, normalizeTechnicalDailyObservationV1,
  parseTechnicalDailyObservationV1, TechnicalSeriesErrorV1, TECHNICAL_INDICATOR_METHODS_V1,
  type CurrentCodeHistoryBoundaryAvailableV1, type TechnicalCalculationWindowV1,
  type TechnicalDailyObservationV1,
} from './technical-series.js';

// Synthetic weekday calendar only: this is not an official source or identity fixture.
function dates(from: string, through: string): string[] {
  const result: string[] = [];
  const date = new Date(`${from}T00:00:00Z`);
  while (date.toISOString().slice(0, 10) <= through) {
    result.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

function bar(date: string, close = 100, volume = 10): TechnicalDailyObservationV1 {
  return { kind: 'bar', date, open: close, high: close + 2, low: close - 2, close, volume };
}

type FixtureWindowOptions = Partial<Omit<TechnicalCalculationWindowV1, 'historyBoundary'>> & {
  historyBoundary?: Partial<CurrentCodeHistoryBoundaryAvailableV1>;
};

function fixture(
  options: FixtureWindowOptions = {},
  holidays: string[] = [],
  close: (index: number) => number = index => 100 + index / 10 + Math.sin(index) * 3,
) {
  const queryFrom = options.queryFrom ?? '2024-01-01';
  const eligibleThrough = options.eligibleThrough ?? '2024-03-29';
  const window: TechnicalCalculationWindowV1 = {
    queryFrom, eligibleThrough,
    calculationDate: options.calculationDate ?? '2024-04-01',
    historyBoundary: {
      state: 'available', contractVersion: 'current_code_history_v1',
      mode: 'current_code_only', jquantsCode: '72030',
      currentMasterDate: eligibleThrough, sourceCoverageFrom: queryFrom,
      sourceCoverageThrough: eligibleThrough, historicalIdentity: 'not_verified',
      ...options.historyBoundary,
    },
  };
  const coverage = getTechnicalCalendarCoverageV1(window);
  const sourceRows = dates(coverage.calendarCoverageFrom, coverage.calendarCoverageTo).map(Date => ({
    Date, HolDiv: holidays.includes(Date) || [0, 6].includes(new globalThis.Date(`${Date}T00:00:00Z`).getUTCDay()) ? '0' : '1',
  }));
  const calendar = createTseSessionCalendarV1(sourceRows, coverage.calendarCoverageFrom, coverage.calendarCoverageTo);
  if (options.historyBoundary?.sourceCoverageFrom === undefined) {
    const firstSession = calendar.sessions.find(date => date >= queryFrom && date <= eligibleThrough);
    if (firstSession === undefined) throw new Error('Synthetic fixture requires an eligible official session.');
    window.historyBoundary.sourceCoverageFrom = firstSession;
  }
  const observations = calendar.sessions.filter(date => date >= window.historyBoundary.sourceCoverageFrom
    && date <= window.eligibleThrough)
    .map((date, index) => bar(date, close(index)));
  return { window, calendar, observations };
}

function expectCode(action: () => unknown, code: TechnicalSeriesErrorV1['code']) {
  expect(action).toThrow(TechnicalSeriesErrorV1);
  try { action(); } catch (error) {
    expect((error as TechnicalSeriesErrorV1).code).toBe(code);
    expect((error as Error).message).toBe(`Technical series calculation failed: ${code}.`);
  }
}

describe('strict Technical daily input', () => {
  test('normalizes all-null adjusted OHLCV to a proved gap; volume zero remains a bar', () => {
    expect(normalizeTechnicalDailyObservationV1({ date: '2024-01-02', open: null, high: null, low: null, close: null, volume: null }))
      .toEqual({ kind: 'gap', date: '2024-01-02', reason: 'source_all_null' });
    const { kind, ...row } = bar('2024-01-02', 100, 0) as Extract<TechnicalDailyObservationV1, { kind: 'bar' }>;
    expect(normalizeTechnicalDailyObservationV1(row)).toEqual({ kind, ...row });
  });

  test.each(['open', 'high', 'low', 'close', 'volume'])('rejects partially null %s', field => {
    const row = { date: '2024-01-02', open: 100, high: 110, low: 90, close: 100, volume: 10, [field]: null };
    expectCode(() => normalizeTechnicalDailyObservationV1(row), 'source_invalid_response');
  });

  test.each([
    { open: 0 }, { close: -1 }, { high: NaN }, { low: Infinity }, { volume: -1 }, { volume: Infinity },
    { open: 103 }, { close: 97 }, { low: 103, high: 102 }, { volume: '10' },
    { date: '2023-02-29' }, { date: '2024-2-01' }, { date: '2024-01-01T00:00:00Z' },
    { requestHeader: 'must not survive strict parsing' },
  ])('rejects invalid observation %j', patch => {
    expectCode(() => parseTechnicalDailyObservationV1({ ...bar('2024-01-02'), ...patch }), 'source_invalid_response');
  });

  test('gap union is closed and cannot carry values or unknown reasons', () => {
    for (const patch of [{ reason: 'unknown' }, { reason: 'missing_in_complete_envelope' }, { close: 0 }, { date: 'bad' }]) {
      expectCode(() => parseTechnicalDailyObservationV1({ kind: 'gap', date: '2024-01-02', reason: 'source_all_null', ...patch }), 'source_invalid_response');
    }
  });

  test('rejects duplicate bar/bar and bar/gap dates instead of deduplicating', () => {
    const input = fixture();
    const first = input.observations[0];
    for (const duplicate of [first, { kind: 'gap', date: first.date, reason: 'source_all_null' }]) {
      expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: [...input.observations, duplicate] }), 'source_invalid_response');
    }
  });

  test('rejects sparse arrays instead of skipping unknown observations', () => {
    const input = fixture();
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: Array(2) }), 'source_invalid_response');
  });

  test('rejects future, pre-query, non-session rows and unproved missing sessions', () => {
    const input = fixture();
    for (const date of ['2024-04-01', '2023-12-29', '2024-01-06']) {
      expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: [...input.observations, bar(date)] }), 'source_invalid_response');
    }
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: input.observations.slice(1) }), 'source_invalid_response');
    expectCode(() => calculateTechnicalSeriesV1({
      ...input, observations: input.observations.filter((_, index) => index !== 10),
    }), 'source_invalid_response');
  });

  test('requires the declared first source row and never synthesizes or admits pre-coverage rows', () => {
    const input = fixture({ historyBoundary: { sourceCoverageFrom: '2024-01-03' } });
    const result = calculateTechnicalSeriesV1(input);
    expect(result.calculationFrom).toBe('2024-01-03');
    expect(result.dailyObservations[0]?.date).toBe('2024-01-03');
    expectCode(() => calculateTechnicalSeriesV1({
      ...input, observations: [bar('2024-01-02'), ...input.observations],
    }), 'source_invalid_response');
    expectCode(() => calculateTechnicalSeriesV1({
      ...input, observations: input.observations.slice(1),
    }), 'source_invalid_response');

    const explicitGap = [{ kind: 'gap', date: '2024-01-03', reason: 'source_all_null' } as const,
      ...input.observations.slice(1)];
    expect(calculateTechnicalSeriesV1({ ...input, observations: explicitGap }).dailyObservations[0])
      .toEqual(explicitGap[0]);
  });

  test('requires exact calendar coverage and an eligible official session', () => {
    const input = fixture();
    const wrong = fixture({ queryFrom: '2024-02-01' }).calendar;
    expectCode(() => calculateTechnicalSeriesV1({ ...input, calendar: wrong }), 'calendar_incomplete');
    const closedEnd = fixture({ eligibleThrough: '2024-03-31' });
    expectCode(() => calculateTechnicalSeriesV1(closedEnd), 'calendar_incomplete');
    const rows = input.calendar.rows.filter(row => row.date !== '2024-01-02')
      .map(row => ({ Date: row.date, HolDiv: row.holidayDivision }));
    expect(() => createTseSessionCalendarV1(rows, input.calendar.requiredFrom, input.calendar.requiredTo)).toThrow();
  });

  test('rejects invalid windows and inconsistent current-code history boundaries', () => {
    const input = fixture();
    for (const patch of [{ queryFrom: '2024-04-01' }, { calculationDate: '2024-03-28' }, { queryFrom: '2024-02-30' }, { extra: true }]) {
      expectCode(() => calculateTechnicalSeriesV1({ ...input, window: { ...input.window, ...patch } }), 'source_invalid_response');
    }
    for (const patch of [
      { currentMasterDate: '2024-03-28' }, { sourceCoverageThrough: '2024-03-28' },
      { sourceCoverageFrom: '2023-12-29' }, { sourceCoverageFrom: '2024-04-01' },
    ]) {
      expectCode(() => calculateTechnicalSeriesV1({ ...input, window: {
        ...input.window, historyBoundary: { ...input.window.historyBoundary, ...patch },
      } }), 'instrument_identity_unverified');
    }
    for (const patch of [
      { state: 'unavailable' }, { contractVersion: 'other' }, { mode: 'other' },
      { jquantsCode: '7203' }, { jquantsCode: '72030 ' }, { jquantsCode: '130a0' },
      { historicalIdentity: 'verified' }, { extra: true },
    ]) {
      const window = {
        ...input.window, historyBoundary: { ...input.window.historyBoundary, ...patch },
      } as unknown as TechnicalCalculationWindowV1;
      expectCode(() => calculateTechnicalSeriesV1({ ...input, window }), 'source_invalid_response');
    }
    const legacyWindow = {
      ...input.window,
      listingWindow: { segmentStart: '2000-01-01', segmentEnd: null, proofFrom: '2000-01-01', proofThrough: '2025-12-31' },
    } as unknown as TechnicalCalculationWindowV1;
    expectCode(() => calculateTechnicalSeriesV1({ ...input, window: legacyWindow }), 'source_invalid_response');

    const alphanumeric = fixture({ historyBoundary: { jquantsCode: '130A0' } });
    expect(calculateTechnicalSeriesV1(alphanumeric).calculationFrom)
      .toBe(alphanumeric.window.historyBoundary.sourceCoverageFrom);
  });

  test('gap-only input fails; gaps after the final bar do not change dataDate', () => {
    const input = fixture();
    const gaps = input.observations.map(row => ({ kind: 'gap', date: row.date, reason: 'source_all_null' }));
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: gaps }), 'source_no_observation');
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: [] }), 'source_invalid_response');
    const result = calculateTechnicalSeriesV1({ ...input, observations: [input.observations[0], ...gaps.slice(1)] });
    expect(result.dataDate).toBe(input.observations[0].date);
    expect(result.intervals.day).toHaveLength(1);
    expect(result.unavailablePeriods.find(row => row.interval === 'month' && row.identity === '2024-02'))
      .toEqual({ interval: 'month', identity: '2024-02', periodStart: '2024-02-01', periodEnd: '2024-02-29', reason: 'source_gap' });
  });
});

describe('interval aggregation and completeness', () => {
  test('aggregates exact OHLCV, excluding holidays and proved gaps, with fixed interval order', () => {
    const input = fixture({ queryFrom: '2024-01-01', eligibleThrough: '2024-01-05', calculationDate: '2024-02-01' }, ['2024-01-01']);
    input.observations = [
      { kind: 'bar', date: '2024-01-02', open: 100, high: 115, low: 95, close: 110, volume: 10 },
      { kind: 'gap', date: '2024-01-03', reason: 'source_all_null' },
      { kind: 'bar', date: '2024-01-04', open: 105, high: 110, low: 90, close: 95, volume: 0 },
      { kind: 'bar', date: '2024-01-05', open: 95, high: 120, low: 92, close: 118, volume: 30 },
    ];
    const result = calculateTechnicalSeriesV1(input);
    expect(Object.keys(result.intervals)).toEqual(['day', 'week', 'month']);
    expect(result.intervals.week[0]).toMatchObject({
      interval: 'week', identity: '2024-01-01', periodStart: '2024-01-01', periodEnd: '2024-01-07',
      displayDate: '2024-01-05', firstSessionDate: '2024-01-02', lastSessionDate: '2024-01-05', partial: false,
      open: 100, high: 120, low: 90, close: 118, volume: 40,
    });
    expect(result.intervals.month[0].partial).toBe(true); // calendar has later January sessions, beyond eligibleThrough
    expect(result.intervals.day[0]).toMatchObject({
      identity: '2024-01-02', periodStart: '2024-01-02', periodEnd: '2024-01-02',
      displayDate: '2024-01-02', firstSessionDate: '2024-01-02', lastSessionDate: '2024-01-02', partial: false,
    });
    expect(result.unavailablePeriods).toEqual([
      { interval: 'day', identity: '2024-01-03', periodStart: '2024-01-03', periodEnd: '2024-01-03', reason: 'source_gap' },
    ]);
  });

  test('gap-only weeks have one unavailable row, no fake candle or indicator reset', () => {
    const input = fixture();
    input.observations = input.observations.map(row => row.date >= '2024-02-05' && row.date <= '2024-02-09'
      ? { kind: 'gap', date: row.date, reason: 'source_all_null' } : row);
    const result = calculateTechnicalSeriesV1(input);
    expect(result.intervals.week.some(row => row.identity === '2024-02-05')).toBe(false);
    expect(result.unavailablePeriods.filter(row => row.interval === 'week')).toEqual([
      { interval: 'week', identity: '2024-02-05', periodStart: '2024-02-05', periodEnd: '2024-02-11', reason: 'source_gap' },
    ]);
    const closes = result.intervals.day.map(row => row.close);
    expect(result.intervals.day.at(-1)!.rsi).toEqual({ state: 'available', value: calculateRsi(closes).rsi14! });
    expect(result.intervals.day.at(-1)!.macd).toEqual({ state: 'available', value: calculateMacd(closes).macd!.value });
  });

  test('a calendar week with no official sessions is not a gap period', () => {
    const input = fixture({}, dates('2024-02-05', '2024-02-09'));
    const result = calculateTechnicalSeriesV1(input);
    expect(result.intervals.week.some(row => row.identity === '2024-02-05')).toBe(false);
    expect(result.unavailablePeriods).toEqual([]);
  });

  test('Gregorian identities cross years, and leap months retain their actual last session', () => {
    const result = calculateTechnicalSeriesV1(fixture({ queryFrom: '2020-12-28', eligibleThrough: '2021-01-08', calculationDate: '2021-02-01' }));
    expect(result.intervals.week[0]).toMatchObject({ identity: '2020-12-28', periodEnd: '2021-01-03' });
    expect(result.intervals.month.map(row => row.identity)).toEqual(['2020-12', '2021-01']);
    const leap = calculateTechnicalSeriesV1(fixture());
    expect(leap.intervals.month[1]).toMatchObject({ identity: '2024-02', periodEnd: '2024-02-29', displayDate: '2024-02-29', partial: false });
  });

  test('a leading query truncation excludes the first weekly/monthly candle from all indicators', () => {
    const result = calculateTechnicalSeriesV1(fixture({ queryFrom: '2024-01-03' }));
    for (const interval of ['week', 'month'] as const) {
      const first = result.intervals[interval][0];
      expect(first.partial).toBe(true);
      for (const field of ['rsi', 'macd', 'signal', 'histogram', 'cross'] as const) {
        expect(first[field]).toEqual({ state: 'unavailable', reason: 'partial_period' });
      }
    }
    expect(result.intervals.day[0].partial).toBe(false);
  });

  test('no earlier official session means no leading partial, even if query starts midweek', () => {
    const result = calculateTechnicalSeriesV1(fixture({ queryFrom: '2024-01-03' }, ['2024-01-01', '2024-01-02']));
    expect(result.intervals.week[0].partial).toBe(false);
    expect(result.intervals.month[0].partial).toBe(false);
    expect(result.historyCoverageClipped).toBe(false);
  });

  test('derives the coverage-warning input from official sessions rather than calendar-day distance', () => {
    const clipped = calculateTechnicalSeriesV1(fixture({
      queryFrom: '2024-01-01', historyBoundary: { sourceCoverageFrom: '2024-01-03' },
    }));
    expect(clipped.historyCoverageClipped).toBe(true);

    const holidayStart = calculateTechnicalSeriesV1(fixture({
      queryFrom: '2024-01-01', historyBoundary: { sourceCoverageFrom: '2024-01-03' },
    }, ['2024-01-01', '2024-01-02']));
    expect(holidayStart.historyCoverageClipped).toBe(false);

    const weekendStart = calculateTechnicalSeriesV1(fixture({
      queryFrom: '2024-01-06', historyBoundary: { sourceCoverageFrom: '2024-01-08' },
    }));
    expect(weekendStart.historyCoverageClipped).toBe(false);
  });

  test('pre-coverage omission is not a gap, remains leading-partial, and permits fewer than 251 bars', () => {
    const input = fixture({ historyBoundary: { sourceCoverageFrom: '2024-01-03' } });
    const result = calculateTechnicalSeriesV1(input);
    expect(result.calculationFrom).toBe('2024-01-03');
    expect(result.dailyObservations[0].date).toBe('2024-01-03');
    expect(result.unavailablePeriods).toEqual([]);
    expect(result.intervals.day.length).toBeLessThan(251);
    expect(result.intervals.week[0].partial).toBe(true);
    expect(result.intervals.month[0].partial).toBe(true);
    expect(result.historyCoverageClipped).toBe(true);
  });

  test('calendar coverage stays anchored to queryFrom after source coverage begins later', () => {
    const input = fixture({ queryFrom: '2024-01-01', historyBoundary: { sourceCoverageFrom: '2024-03-01' } });
    const result = calculateTechnicalSeriesV1(input);
    expect(result.calendarCoverageFrom).toBe('2024-01-01');
    expect(result.calendarCoverageTo).toBe('2024-03-31');
    expect(result.calculationTo).toBe('2024-03-29');
    expect(result.historyCoverageClipped).toBe(true);
  });

  test('current week/month remain partial even after their final trading session', () => {
    for (const calculationDate of ['2024-03-29', '2024-03-31', '2024-04-01']) {
      const result = calculateTechnicalSeriesV1(fixture({ calculationDate }));
      for (const interval of ['week', 'month'] as const) {
        expect(result.intervals[interval].at(-1)!.partial).toBe(calculationDate !== '2024-04-01');
      }
      expect(result.intervals.day.every(row => !row.partial)).toBe(true);
    }
  });

  test('overflow in volume or indicator arithmetic fails closed', () => {
    const input = fixture();
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: input.observations.map(row => ({ ...row, volume: Number.MAX_VALUE })) }), 'source_invalid_response');
    expectCode(() => calculateTechnicalSeriesV1({ ...input, observations: input.observations.map(row => ({
      kind: 'bar', date: row.date, open: 1e308, high: 1e308, low: 1e308, close: 1e308, volume: 0,
    })) }), 'source_invalid_response');
  });
});

describe('dated RSI/MACD and cross', () => {
  test.each([{ delta: 1, rsi: 100 }, { delta: -1, rsi: 0 }, { delta: 0, rsi: 50 }])('RSI 14 seed and zero edges: %j', ({ delta, rsi }) => {
    const result = calculateTechnicalSeriesV1(fixture({}, [], index => 200 + index * delta));
    expect(result.intervals.day.slice(0, 14).every(row => row.rsi.state === 'unavailable' && row.rsi.reason === 'warmup')).toBe(true);
    expect(result.intervals.day[14].rsi).toEqual({ state: 'available', value: rsi });
    expect(result.intervals.day.at(-1)!.rsi).toEqual({ state: 'available', value: rsi });
  });

  test('RSI uses the hand-calculated Wilder seed and first recurrence', () => {
    const closes = [100, 102, 101, 104, 103, 105, 106, 104, 107, 109, 108, 110, 111, 109, 112, 113];
    const result = calculateTechnicalSeriesV1(fixture({ eligibleThrough: '2024-01-22' }, [], index => closes[index]));
    expect(result.intervals.day[14].rsi).toEqual({ state: 'available', value: calculateRsi(closes.slice(0, 15)).rsi14! });
    const last = result.intervals.day[15].rsi;
    expect(last.state).toBe('available');
    if (last.state === 'available') expect(last.value).toBeCloseTo(6525 / 88, 10);
  });

  test('MACD bundle starts at 34 closes, cross at 35; equality is none, not a cross', () => {
    const result = calculateTechnicalSeriesV1(fixture({}, [], () => 100));
    for (const field of ['macd', 'signal', 'histogram'] as const) {
      expect(result.intervals.day[32][field]).toEqual({ state: 'unavailable', reason: 'warmup' });
      expect(result.intervals.day[33][field]).toEqual({ state: 'available', value: 0 });
    }
    expect(result.intervals.day[33].cross).toEqual({ state: 'unavailable', reason: 'warmup' });
    expect(result.intervals.day[34].cross).toEqual({ state: 'available', value: 'none' });
  });

  test('records only observed golden crosses; equality/decreases never become death-cross labels', () => {
    const rising = calculateTechnicalSeriesV1(fixture({}, [], index => index < 34 ? 100 : 101));
    expect(rising.intervals.day[34].cross).toEqual({ state: 'available', value: 'golden_cross' });
    expect(rising.intervals.day[35].cross).toEqual({ state: 'available', value: 'none' });
    const falling = calculateTechnicalSeriesV1(fixture({}, [], index => index < 34 ? 100 : 99));
    expect(falling.intervals.day[34].cross).toEqual({ state: 'available', value: 'none' });
  });

  test('34-month boundary excludes the current partial month from the MACD seed', () => {
    const input = fixture({ queryFrom: '2021-01-01', eligibleThrough: '2023-10-31', calculationDate: '2023-10-31' });
    const partial = calculateTechnicalSeriesV1(input).intervals.month;
    expect(partial).toHaveLength(34);
    expect(partial[32].macd).toEqual({ state: 'unavailable', reason: 'warmup' });
    for (const field of ['rsi', 'macd', 'signal', 'histogram', 'cross'] as const) {
      expect(partial[33][field]).toEqual({ state: 'unavailable', reason: 'partial_period' });
    }
    const completed = calculateTechnicalSeriesV1({ ...input, window: { ...input.window, calculationDate: '2023-11-01' } }).intervals.month;
    const expected = calculateMacd(completed.map(row => row.close)).macd!;
    expect(completed[33].macd).toEqual({ state: 'available', value: expected.value });
    expect(completed[33].signal).toEqual({ state: 'available', value: expected.signal });
    expect(completed[33].cross).toEqual({ state: 'unavailable', reason: 'warmup' });
  });

  test('weekly/monthly indicators are independently recomputed from completed closes, not resampled', () => {
    const result = calculateTechnicalSeriesV1(fixture({ queryFrom: '2020-01-08', eligibleThrough: '2024-03-29', calculationDate: '2024-03-29' }));
    for (const interval of ['week', 'month'] as const) {
      const completed = result.intervals[interval].filter(row => !row.partial);
      const closes = completed.map(row => row.close);
      const last = completed.at(-1)!;
      expect(last.rsi).toEqual({ state: 'available', value: calculateRsi(closes).rsi14! });
      expect(last.macd).toEqual({ state: 'available', value: calculateMacd(closes).macd!.value });
      expect(result.intervals[interval][0].partial).toBe(true);
      expect(result.intervals[interval].at(-1)!.partial).toBe(true);
    }
  });

  test('same explicit 251-row suffix gives exact legacy Engine parity; earlier candles cannot look ahead', () => {
    const input = fixture({ queryFrom: '2022-01-01' });
    const full = calculateTechnicalSeriesV1(input);
    const suffix = input.observations.slice(-251);
    const suffixInput = fixture({ queryFrom: suffix[0].date });
    const suffixResult = calculateTechnicalSeriesV1({ ...suffixInput, observations: suffix });
    const legacyBars = suffix.map(row => {
      if (row.kind !== 'bar') throw new Error('Unexpected fixture gap');
      return { ...row };
    });
    const legacy = analyzeAdvancedTechnical(legacyBars);
    const last = suffixResult.intervals.day.at(-1)!;
    expect(last.rsi).toEqual({ state: 'available', value: legacy.rsi14! });
    expect(last.macd).toEqual({ state: 'available', value: legacy.macd!.value });
    expect(last.signal).toEqual({ state: 'available', value: legacy.macd!.signal });
    expect(last.histogram).toEqual({ state: 'available', value: legacy.macd!.histogram });
    const prefixInput = fixture({ queryFrom: input.window.queryFrom, eligibleThrough: '2023-12-29', calculationDate: '2024-01-01' });
    const prefix = calculateTechnicalSeriesV1(prefixInput);
    expect(full.intervals.day.slice(0, prefix.intervals.day.length)).toEqual(prefix.intervals.day);
    expect(TECHNICAL_INDICATOR_METHODS_V1).toEqual({ rsi: 'rsi_wilder_14_v1', macd: 'macd_ema_12_26_9_v1' });
  });

  test('sorting is deterministic and does not mutate caller arrays, rows, window or calendar', () => {
    const input = fixture();
    const expected = calculateTechnicalSeriesV1(input);
    input.observations.reverse();
    const before = JSON.stringify(input);
    input.observations.forEach(Object.freeze);
    Object.freeze(input.observations);
    Object.freeze(input.window.historyBoundary);
    Object.freeze(input.window);
    expect(calculateTechnicalSeriesV1(input)).toEqual(expected);
    expect(JSON.stringify(input)).toBe(before);
  });
});
