import { describe, expect, test } from 'bun:test';
import { calculateTechnicalSeriesV1, getTechnicalCalendarCoverageV1 } from './technical-series.js';
import {
  CURRENT_TECHNICAL_MASTER_EXPECTATION_V1,
  TECHNICAL_SOURCE_ENDPOINTS_V1,
  TECHNICAL_SOURCE_REGISTRY_V1,
  TECHNICAL_SOURCE_REVISIONS_V1,
  createTechnicalSourceRequestWindowV1,
  digestTechnicalSourceRowsV1,
  mapTechnicalCalendarV1,
  mapTechnicalDailyBarsV1,
  resolveTechnicalEligibleThroughV1,
  technicalQueryFromV1,
  validateCurrentTechnicalMasterV1,
} from './technical-source-gate.js';

function dates(from: string, to: string): string[] {
  const output: string[] = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000) output.push(new Date(cursor).toISOString().slice(0, 10));
  return output;
}

function calendarRows(from: string, to: string, holidays: readonly string[] = []) {
  const closed = new Set(holidays);
  return dates(from, to).map(date => {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return { Date: date, HolDiv: closed.has(date) || day === 0 || day === 6 ? '0' : '1', ignored: 'not-normalized' };
  });
}

function smallCalendar(holidays: readonly string[] = []) {
  return mapTechnicalCalendarV1(
    calendarRows('2026-08-31', '2026-09-13', holidays),
    '2026-08-31',
    '2026-09-13',
  ).calendar;
}

function master(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    Date: '2026-09-04',
    Code: '72030',
    CoName: 'トヨタ自動車',
    Mkt: '0111',
    ProdCat: '011',
    CoNameEn: 'ignored',
    ...overrides,
  };
}

function bar(Date: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    Date,
    Code: '72030',
    AdjO: 100,
    AdjH: 110,
    AdjL: 90,
    AdjC: 105,
    AdjVo: 1000,
    AdjFactor: 1,
    ExRT: null,
    O: 999,
    ...overrides,
  };
}

describe('DR-T0 Technical source registry and request window', () => {
  test.each([false, true])('feeds the Standard boundary into the merged series engine (leading gap: %s)', leadingGap => {
    const request = createTechnicalSourceRequestWindowV1('2026-09-09T08:00:00.000Z');
    const { calendar } = mapTechnicalCalendarV1(
      calendarRows(request.calendarCoverageFrom, request.calendarCoverageTo),
      request.calendarCoverageFrom, request.calendarCoverageTo,
    );
    const eligibleThrough = resolveTechnicalEligibleThroughV1(request, calendar);
    const rows = calendar.sessions.filter(date => date <= eligibleThrough).map(date => bar(date,
      leadingGap && date === request.queryFrom
        ? { AdjO: null, AdjH: null, AdjL: null, AdjC: null, AdjVo: null } : {}));
    const mapped = mapTechnicalDailyBarsV1(rows, {
      ticker: '7203', queryFrom: request.queryFrom, eligibleThrough, calendar,
    });
    const window = { queryFrom: request.queryFrom, eligibleThrough,
      calculationDate: request.calculationDate, historyBoundary: mapped.historyBoundary };
    expect(getTechnicalCalendarCoverageV1(window)).toEqual({
      calendarCoverageFrom: request.queryFrom, calendarCoverageTo: request.calendarCoverageTo,
    });
    const result = calculateTechnicalSeriesV1({ window, calendar, observations: mapped.observations });
    expect(mapped.historyBoundary.sourceCoverageFrom).toBe(request.queryFrom);
    expect(mapped.historyBoundary.historicalIdentity).toBe('not_verified');
    expect(mapped.historyCoverageClipped).toBe(false);
    expect(result.dailyObservations).toHaveLength(rows.length);
    expect(result.intervals.day).toHaveLength(rows.length - Number(leadingGap));
    for (const interval of ['week', 'month'] as const) {
      if (leadingGap && interval === 'week') {
        expect(result.unavailablePeriods).toContainEqual({ interval: 'week', identity: '2016-09-05',
          periodStart: '2016-09-05', periodEnd: '2016-09-11', reason: 'partial_period' });
        expect(result.intervals.week[0].partial).toBe(false);
        continue;
      }
      expect(result.intervals[interval][0].partial).toBe(true);
      expect(result.intervals[interval][0].macd).toEqual({ state: 'unavailable', reason: 'partial_period' });
      expect(result.intervals[interval][1].partial).toBe(false);
    }
    expect(() => mapTechnicalDailyBarsV1(rows.filter((_, index) => index !== 5), {
      ticker: '7203', queryFrom: request.queryFrom, eligibleThrough, calendar,
    })).toThrow(expect.objectContaining({ code: 'source_response_invalid' }));
  });

  test('pins exact endpoints and lexically ordered official source revision IDs', () => {
    expect(TECHNICAL_SOURCE_REGISTRY_V1.find(source => source.role === 'trading_calendar')).toMatchObject({
      boundaryPolicy: 'standard_calendar_boundary_v2',
      calendarCoverageFrom: 'queryFrom',
      calendarCoverageTo: 'max(containingSunday(calculationDate),lastDayOfMonth(calculationDate))',
    });
    expect(TECHNICAL_SOURCE_ENDPOINTS_V1).toEqual({
      tradingCalendar: '/v2/markets/calendar',
      securityMaster: '/v2/equities/master',
      dailyBars: '/v2/equities/bars/daily',
    });
    for (const revisions of Object.values(TECHNICAL_SOURCE_REVISIONS_V1)) {
      const ids = revisions.map(item => item.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      expect(revisions.every(item => item.url.startsWith('https://jpx-jquants.com/ja/spec/'))).toBe(true);
      expect(revisions.every(item => item.retrievedAt === '2026-09-04')).toBe(true);
    }
    expect(CURRENT_TECHNICAL_MASTER_EXPECTATION_V1).toEqual({
      family: 'technical_domestic_equity',
      productCategories: ['011'],
      marketCodes: ['0105', '0111', '0112', '0113'],
      namePolicy: 'validated_source_label_only',
    });
    expect(TECHNICAL_SOURCE_REGISTRY_V1.map(source => ({
      role: source.role,
      endpoint: source.endpoint,
      queryFields: source.queryFields,
      normalizedFields: source.normalizedFields,
      entitlementClass: source.entitlementClass,
    }))).toEqual([
      { role: 'daily_bars', endpoint: '/v2/equities/bars/daily',
        queryFields: ['code', 'from', 'to'],
        normalizedFields: ['Date', 'Code', 'AdjO', 'AdjH', 'AdjL', 'AdjC', 'AdjVo', 'AdjFactor', 'ExRT'],
        entitlementClass: 'configured_standard_or_higher' },
      { role: 'security_master', endpoint: '/v2/equities/master',
        queryFields: ['code', 'date'], normalizedFields: ['Date', 'Code', 'CoName', 'Mkt', 'ProdCat'],
        entitlementClass: 'configured_standard_or_higher' },
      { role: 'trading_calendar', endpoint: '/v2/markets/calendar',
        queryFields: ['from', 'to'], normalizedFields: ['Date', 'HolDiv'],
        entitlementClass: 'configured_standard_or_higher' },
    ]);
  });

  test('uses ten Gregorian years and maps a non-leap target February 29 to March 1', () => {
    expect(technicalQueryFromV1('2026-09-04')).toBe('2016-09-04');
    expect(technicalQueryFromV1('2028-02-29')).toBe('2018-03-01');
    expect(technicalQueryFromV1('2024-02-29')).toBe('2014-03-01');
    expect(technicalQueryFromV1('2020-02-29')).toBe('2010-03-01');
    expect(() => technicalQueryFromV1('2026-02-30')).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
  });

  test('freezes the Tokyo date with Standard calendar starting exactly at queryFrom', () => {
    expect(createTechnicalSourceRequestWindowV1('2026-09-04T06:00:00.000Z')).toMatchObject({
      acceptedAt: '2026-09-04T06:00:00.000Z',
      calculationDate: '2026-09-04',
      queryFrom: '2016-09-04',
      calendarCoverageFrom: '2016-09-04',
      calendarCoverageTo: '2026-09-30',
    });
    expect(createTechnicalSourceRequestWindowV1('2026-09-03T16:00:00.000Z').calculationDate).toBe('2026-09-04');
  });

  test('selects the same session only at or after 16:30 JST and otherwise the prior session', () => {
    const calendar = smallCalendar();
    const before = createTechnicalSourceRequestWindowV1('2026-09-04T07:29:59.999Z');
    const at = createTechnicalSourceRequestWindowV1('2026-09-04T07:30:00.000Z');
    expect(resolveTechnicalEligibleThroughV1({ ...before,
      calendarCoverageFrom: calendar.requiredFrom, calendarCoverageTo: calendar.requiredTo }, calendar)).toBe('2026-09-03');
    expect(resolveTechnicalEligibleThroughV1({ ...at,
      calendarCoverageFrom: calendar.requiredFrom, calendarCoverageTo: calendar.requiredTo }, calendar)).toBe('2026-09-04');
    const weekend = createTechnicalSourceRequestWindowV1('2026-09-06T12:00:00.000Z');
    expect(resolveTechnicalEligibleThroughV1({ ...weekend,
      calendarCoverageFrom: calendar.requiredFrom, calendarCoverageTo: calendar.requiredTo }, calendar)).toBe('2026-09-04');
  });
});

describe('DR-T0 strict calendar and current master', () => {
  test('normalizes only Date/HolDiv and proves every requested calendar date', () => {
    const result = mapTechnicalCalendarV1(calendarRows('2026-09-01', '2026-09-07'), '2026-09-01', '2026-09-07');
    expect(Object.keys(result.rows[0]!)).toEqual(['Date', 'HolDiv']);
    expect(result.calendar.sessions.map(String)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07']);
    for (const invalid of [
      calendarRows('2026-09-01', '2026-09-07').filter(row => row.Date !== '2026-09-03'),
      [...calendarRows('2026-09-01', '2026-09-07'), { Date: '2026-09-03', HolDiv: '1' }],
      calendarRows('2026-09-01', '2026-09-07').map(row => row.Date === '2026-09-03' ? { ...row, HolDiv: 1 } : row),
    ]) expect(() => mapTechnicalCalendarV1(invalid, '2026-09-01', '2026-09-07')).toThrow();
  });

  test('applies the exact master rejection precedence', () => {
    const input = { ticker: '7203', eligibleThrough: '2026-09-04', environment: {} };
    const cases = [
      [[], 'missing_row'],
      [[master({ Date: 'bad' }), master()], 'duplicate_row'],
      [[master({ Date: '2026-09-03', Code: '67580' })], 'effective_date_mismatch'],
      [[master({ Code: '67580', ProdCat: '999' })], 'code_mismatch'],
      [[master({ ProdCat: '014', Mkt: '9999' })], 'product_category_mismatch'],
      [[master({ Mkt: '0109', CoName: '' })], 'market_code_mismatch'],
      [[master({ CoName: '   ' })], 'blank_name'],
      [[master({ CoName: 'bad\u0000name' })], 'invalid_name'],
    ] as const;
    for (const [rows, reason] of cases) {
      expect(validateCurrentTechnicalMasterV1(rows, input)).toEqual({ state: 'rejected', reason });
    }
  });

  test('accepts a current source-label change and transfer inside the closed market allowlist', () => {
    for (const Mkt of ['0105', '0111', '0112', '0113']) {
      const result = validateCurrentTechnicalMasterV1([master({ CoName: '変更後の会社名', Mkt })], {
        ticker: '7203', eligibleThrough: '2026-09-04', environment: {},
      });
      expect(result).toEqual({ state: 'accepted', observation: {
        Date: '2026-09-04', Code: '72030', CoName: '変更後の会社名', Mkt, ProdCat: '011',
      } });
      if (result.state === 'accepted') expect(Object.keys(result.observation)).toEqual(['Date', 'Code', 'CoName', 'Mkt', 'ProdCat']);
    }
  });

  test('rejects configured credentials, marker-shaped names, surrounding whitespace, and invalid lengths', () => {
    const input = { ticker: '7203', eligibleThrough: '2026-09-04', environment: { JQUANTS_API_KEY: 'configured-secret' } };
    for (const CoName of ['configured-secret', 'sk-proj-abcdefghijklmnop', ' name', 'x'.repeat(161), 42]) {
      expect(validateCurrentTechnicalMasterV1([master({ CoName })], input)).toEqual({ state: 'rejected', reason: 'invalid_name' });
    }
  });
});

describe('DR-T0 adjusted daily bars and current-code boundary', () => {
  test('maps adjusted OHLCV, retains valid zero volume and explicit all-null gaps', () => {
    const calendar = smallCalendar(['2026-09-02']);
    const result = mapTechnicalDailyBarsV1([
      bar('2026-09-01', { AdjVo: 0 }),
      bar('2026-09-03', { AdjO: null, AdjH: null, AdjL: null, AdjC: null, AdjVo: null }),
      bar('2026-09-04'),
    ], { ticker: '7203', queryFrom: '2026-09-01', eligibleThrough: '2026-09-04', calendar });
    expect(result.observations).toEqual([
      { kind: 'bar', date: '2026-09-01', open: 100, high: 110, low: 90, close: 105, volume: 0 },
      { kind: 'gap', date: '2026-09-03', reason: 'source_all_null' },
      { kind: 'bar', date: '2026-09-04', open: 100, high: 110, low: 90, close: 105, volume: 1000 },
    ]);
    expect(Object.keys(result.rows[0]!)).toEqual(['Date', 'Code', 'AdjO', 'AdjH', 'AdjL', 'AdjC', 'AdjVo', 'AdjFactor', 'ExRT']);
    expect(result.historyBoundary).toEqual({
      state: 'available', contractVersion: 'current_code_history_v1', mode: 'current_code_only',
      jquantsCode: '72030', currentMasterDate: '2026-09-04', sourceCoverageFrom: '2026-09-01',
      sourceCoverageThrough: '2026-09-04', historicalIdentity: 'not_verified',
    });
  });

  test('distinguishes official-session clipping from a weekend or holiday query start', () => {
    const calendar = smallCalendar(['2026-09-01']);
    const clipped = mapTechnicalDailyBarsV1([
      bar('2026-09-03'), bar('2026-09-04'),
    ], { ticker: '7203', queryFrom: '2026-08-31', eligibleThrough: '2026-09-04', calendar });
    expect(clipped.historyCoverageClipped).toBe(true);
    const nonSessionStart = mapTechnicalDailyBarsV1([
      bar('2026-09-02'), bar('2026-09-03'), bar('2026-09-04'),
    ], { ticker: '7203', queryFrom: '2026-09-01', eligibleThrough: '2026-09-04', calendar });
    expect(nonSessionStart.historyCoverageClipped).toBe(false);
    const weekend = mapTechnicalDailyBarsV1([
      bar('2026-09-07'), bar('2026-09-08'),
    ], { ticker: '7203', queryFrom: '2026-09-06', eligibleThrough: '2026-09-08', calendar });
    expect(weekend.historyCoverageClipped).toBe(false);
  });

  test('fails missing post-start sessions, missing eligible row, duplicates and invalid adjusted values', () => {
    const calendar = smallCalendar();
    const input = { ticker: '7203', queryFrom: '2026-09-01', eligibleThrough: '2026-09-04', calendar };
    const cases: readonly [readonly unknown[], string][] = [
      [[bar('2026-09-01'), bar('2026-09-03'), bar('2026-09-04')], 'source_response_invalid'],
      [[bar('2026-09-01'), bar('2026-09-02'), bar('2026-09-03')], 'source_not_yet_updated'],
      [[bar('2026-09-01'), bar('2026-09-01'), bar('2026-09-02'), bar('2026-09-03'), bar('2026-09-04')], 'source_response_invalid'],
      [[bar('2026-09-01', { Code: '67580' })], 'source_response_invalid'],
      [[bar('2026-09-01', { AdjO: null })], 'source_response_invalid'],
      [[bar('2026-09-01', { AdjL: 120 })], 'source_response_invalid'],
      [[bar('2026-09-01', { AdjVo: -1 })], 'source_response_invalid'],
      [[bar('2026-09-01', { AdjFactor: 0 })], 'source_response_invalid'],
      [[bar('2026-09-01', { ExRT: '9' })], 'source_response_invalid'],
    ];
    for (const [rows, code] of cases) {
      expect(() => mapTechnicalDailyBarsV1(rows, input)).toThrow(expect.objectContaining({ code }));
    }
  });

  test('does not claim that a gapless reused code was detected', () => {
    const calendar = smallCalendar();
    const result = mapTechnicalDailyBarsV1([
      bar('2026-09-01'), bar('2026-09-02'), bar('2026-09-03'), bar('2026-09-04'),
    ], { ticker: '7203', queryFrom: '2026-09-01', eligibleThrough: '2026-09-04', calendar });
    expect(result.historyBoundary.historicalIdentity).toBe('not_verified');
    expect(result).not.toHaveProperty('listingDate');
  });

  test('fails closed when the calendar cannot prove the leading coverage interval', () => {
    const calendar = mapTechnicalCalendarV1(
      calendarRows('2026-09-02', '2026-09-13'), '2026-09-02', '2026-09-13',
    ).calendar;
    expect(() => mapTechnicalDailyBarsV1([
      bar('2026-09-02'), bar('2026-09-03'), bar('2026-09-04'),
    ], { ticker: '7203', queryFrom: '2026-09-01', eligibleThrough: '2026-09-04', calendar }))
      .toThrow(expect.objectContaining({ code: 'calendar_incomplete' }));
  });

  test('hashes only canonical normalized rows and rejects configured secrets', () => {
    const rows = [{ Date: '2026-09-04', Code: '72030' }] as const;
    expect(digestTechnicalSourceRowsV1(rows, {})).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestTechnicalSourceRowsV1(rows, {})).toBe(digestTechnicalSourceRowsV1([{ Code: '72030', Date: '2026-09-04' }], {}));
    expect(() => digestTechnicalSourceRowsV1(['configured-secret'], { JQUANTS_API_KEY: 'configured-secret' })).toThrow();
  });
});
