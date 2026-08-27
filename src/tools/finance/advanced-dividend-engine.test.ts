import { describe, expect, test } from 'bun:test';
import {
  analyzeDividendFiscalObservations,
  buildAdvancedDividendResult,
  replayDividendEvents,
  type DividendFiscalObservation,
} from './advanced-dividend-engine.js';
import type {
  DividendAvailabilityCalendarDay,
  DividendSummarySourceRow,
} from './dividend-summary.js';
import type { DividendEventSourceRow } from './dividend-events.js';

function sourceRow(
  overrides: Partial<DividendSummarySourceRow> = {},
): DividendSummarySourceRow {
  return {
    issuerCode: '72030',
    disclosedDate: '2026-05-15',
    disclosedTime: '15:00:00',
    disclosureNumber: '20260515000001',
    currentFiscalYearEndDate: '2027-03-31',
    nextFiscalYearEndDate: '2028-03-31',
    actualAnnualDividendPerShare: 90,
    actualPayoutRatio: 0.321,
    forecastAnnualDividendPerShare: 100,
    forecastPayoutRatio: 0.35,
    nextForecastAnnualDividendPerShare: 110,
    nextForecastPayoutRatio: 0.36,
    ...overrides,
  };
}

const calendar: readonly DividendAvailabilityCalendarDay[] = [
  { date: '2026-05-15', holidayDivision: '1' },
  { date: '2026-05-16', holidayDivision: '0' },
  { date: '2026-05-17', holidayDivision: '0' },
  { date: '2026-05-18', holidayDivision: '1' },
  { date: '2026-05-19', holidayDivision: '2' },
  { date: '2026-05-20', holidayDivision: '1' },
  { date: '2026-05-21', holidayDivision: '1' },
  { date: '2026-05-22', holidayDivision: '1' },
];

function observation(
  observations: readonly DividendFiscalObservation[],
  kind: DividendFiscalObservation['kind'],
  fiscalYearEndDate: string,
): DividendFiscalObservation {
  const selected = observations.find(
    (item) => item.kind === kind && item.fiscalYearEndDate === fiscalYearEndDate,
  );
  if (!selected) throw new Error('Expected dividend observation was not selected.');
  return selected;
}

describe('analyzeDividendFiscalObservations', () => {
  test('maps current and next fiscal years while keeping actual and forecasts separate', () => {
    const result = analyzeDividendFiscalObservations(
      '72030',
      [sourceRow()],
      calendar,
      '2026-05-18',
    );

    expect(result.unavailable).toEqual([]);
    expect(result.observations).toHaveLength(3);
    expect(observation(result.observations, 'actual', '2027-03-31')).toMatchObject({
      sourceField: 'DivAnn',
      payoutRatioSourceField: 'PayoutRatioAnn',
      annualDividendPerShare: 90,
      payoutRatio: 0.321,
    });
    expect(observation(result.observations, 'company_forecast', '2027-03-31'))
      .toMatchObject({
        sourceField: 'FDivAnn',
        payoutRatioSourceField: 'FPayoutRatioAnn',
        annualDividendPerShare: 100,
        payoutRatio: 0.35,
      });
    expect(observation(result.observations, 'company_forecast', '2028-03-31'))
      .toMatchObject({
        sourceField: 'NxFDivAnn',
        payoutRatioSourceField: 'NxFPayoutRatioAnn',
        annualDividendPerShare: 110,
        payoutRatio: 0.36,
      });
  });

  test('preserves publication and source-eligibility dates as distinct facts', () => {
    const onPublicationDate = analyzeDividendFiscalObservations(
      '72030',
      [sourceRow()],
      calendar,
      '2026-05-15',
    );
    const onFollowingBusinessDay = analyzeDividendFiscalObservations(
      '72030',
      [sourceRow()],
      calendar,
      '2026-05-18',
    );

    expect(onPublicationDate).toMatchObject({
      dataDate: null,
      observations: [],
      unavailable: [{ scope: 'core', reason: 'no_eligible_dividend_disclosure_data' }],
    });
    expect(onFollowingBusinessDay.observations[0]).toMatchObject({
      disclosedDate: '2026-05-15',
      sourceEligibleDate: '2026-05-18',
    });
  });

  test('selects the latest eligible same-day disclosure by time then disclosure number', () => {
    const rows = [
      sourceRow({
        disclosedTime: '14:00:00',
        disclosureNumber: '20260515000003',
        forecastAnnualDividendPerShare: 91,
      }),
      sourceRow({
        disclosedTime: '15:00:00',
        disclosureNumber: '20260515000001',
        forecastAnnualDividendPerShare: 92,
      }),
      sourceRow({
        disclosedTime: '15:00:00',
        disclosureNumber: '20260515000002',
        forecastAnnualDividendPerShare: 93,
      }),
    ];

    const result = analyzeDividendFiscalObservations('72030', rows, calendar, '2026-05-18');

    expect(observation(result.observations, 'company_forecast', '2027-03-31'))
      .toMatchObject({
        disclosureNumber: '20260515000002',
        annualDividendPerShare: 93,
      });
  });

  test('selects the latest disclosure independently for each target fiscal year and kind', () => {
    const earlier = sourceRow({
      disclosedDate: '2026-05-14',
      disclosureNumber: '20260514000001',
      currentFiscalYearEndDate: '2026-03-31',
      nextFiscalYearEndDate: '2027-03-31',
      actualAnnualDividendPerShare: 80,
      forecastAnnualDividendPerShare: 82,
      nextForecastAnnualDividendPerShare: 90,
    });
    const later = sourceRow({
      forecastAnnualDividendPerShare: 100,
    });

    const result = analyzeDividendFiscalObservations(
      '72030',
      [later, earlier],
      calendar,
      '2026-05-18',
    );

    expect(observation(result.observations, 'actual', '2026-03-31').annualDividendPerShare)
      .toBe(80);
    expect(observation(result.observations, 'company_forecast', '2027-03-31'))
      .toMatchObject({
        disclosedDate: '2026-05-15',
        sourceField: 'FDivAnn',
        annualDividendPerShare: 100,
      });
    expect(result.observations.map((item) => item.fiscalYearEndDate)).toEqual([
      '2026-03-31',
      '2026-03-31',
      '2027-03-31',
      '2027-03-31',
      '2028-03-31',
    ]);
  });

  test('keeps a blank latest field unavailable instead of forward-filling an older value', () => {
    const earlier = sourceRow({
      disclosedDate: '2026-05-14',
      disclosureNumber: '20260514000001',
      actualAnnualDividendPerShare: 80,
      actualPayoutRatio: 0.3,
    });
    const latestBlank = sourceRow({
      actualAnnualDividendPerShare: null,
      actualPayoutRatio: null,
    });

    const result = analyzeDividendFiscalObservations(
      '72030',
      [earlier, latestBlank],
      calendar,
      '2026-05-18',
    );

    expect(observation(result.observations, 'actual', '2027-03-31')).toMatchObject({
      disclosureNumber: '20260515000001',
      annualDividendPerShare: null,
      payoutRatio: null,
    });
    expect(result.unavailable).toEqual([{ scope: 'core', reason: 'missing_data' }]);
  });

  test('preserves valid zero and finite source payout ratios without recalculation or capping', () => {
    const result = analyzeDividendFiscalObservations('72030', [sourceRow({
      actualAnnualDividendPerShare: 0,
      actualPayoutRatio: 0,
      forecastAnnualDividendPerShare: 0,
      forecastPayoutRatio: -0.25,
      nextForecastAnnualDividendPerShare: 0,
      nextForecastPayoutRatio: 1.5,
    })], calendar, '2026-05-18');

    expect(result.unavailable).toEqual([]);
    expect(result.observations.map((item) => ({
      annualDividendPerShare: item.annualDividendPerShare,
      payoutRatio: item.payoutRatio,
    }))).toEqual([
      { annualDividendPerShare: 0, payoutRatio: 0 },
      { annualDividendPerShare: 0, payoutRatio: -0.25 },
      { annualDividendPerShare: 0, payoutRatio: 1.5 },
    ]);
    expect(result.units).toEqual({
      dividendPerShare: 'JPY_per_share',
      payoutRatio: 'ratio',
    });
  });

  test('returns invalid_data for selected negative or non-finite values', () => {
    const invalidRows: DividendSummarySourceRow[] = [
      sourceRow({ actualAnnualDividendPerShare: -1 }),
      sourceRow({ forecastAnnualDividendPerShare: Number.NaN }),
      sourceRow({ nextForecastPayoutRatio: Number.POSITIVE_INFINITY }),
    ];

    for (const row of invalidRows) {
      expect(analyzeDividendFiscalObservations(
        '72030',
        [row],
        calendar,
        '2026-05-18',
      )).toMatchObject({
        dataDate: '2026-05-15',
        observations: [],
        unavailable: [{ scope: 'core', reason: 'invalid_data' }],
      });
    }
  });

  test('excludes future disclosures before validation and keeps historical results stable', () => {
    const eligible = sourceRow();
    const futureInvalid = sourceRow({
      issuerCode: '67580',
      disclosedDate: '2026-05-21',
      disclosureNumber: '20260521000001',
      actualAnnualDividendPerShare: -1,
    });

    const before = analyzeDividendFiscalObservations(
      '72030',
      [eligible],
      calendar,
      '2026-05-18',
    );
    const after = analyzeDividendFiscalObservations(
      '72030',
      [eligible, futureInvalid],
      calendar,
      '2026-05-18',
    );

    expect(after).toEqual(before);
  });

  test('returns calendar unavailability without weekday inference', () => {
    const insufficientCalendar = [
      { date: '2026-05-15', holidayDivision: '1' },
      { date: '2026-05-16', holidayDivision: '0' },
    ];

    expect(analyzeDividendFiscalObservations(
      '72030',
      [sourceRow()],
      insufficientCalendar,
      '2026-05-18',
    )).toMatchObject({
      dataDate: null,
      observations: [],
      unavailable: [{ scope: 'core', reason: 'availability_calendar_unavailable' }],
    });
  });

  test('keeps empty and fully future input distinct from valid zero', () => {
    const expectedUnavailable = {
      dataDate: null,
      observations: [],
      unavailable: [{ scope: 'core', reason: 'no_eligible_dividend_disclosure_data' }],
    };

    expect(analyzeDividendFiscalObservations('72030', [], calendar, '2026-05-18'))
      .toMatchObject(expectedUnavailable);
    expect(analyzeDividendFiscalObservations(
      '72030',
      [sourceRow({ disclosedDate: '2026-05-21' })],
      calendar,
      '2026-05-18',
    )).toMatchObject(expectedUnavailable);
  });

  test('preserves issuer identity, data-date, and fixed provenance', () => {
    const older = sourceRow({
      disclosedDate: '2026-05-14',
      disclosureNumber: '20260514000001',
      currentFiscalYearEndDate: '2026-03-31',
      nextFiscalYearEndDate: null,
    });
    const result = analyzeDividendFiscalObservations(
      '72030',
      [sourceRow(), older],
      calendar,
      '2026-05-18',
    );

    expect(result).toMatchObject({
      analysisAsOfDate: '2026-05-18',
      issuerCode: '72030',
      dataDate: '2026-05-15',
      provenance: {
        financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
        availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
        calculation: { source: 'advanced_dividend_engine' },
      },
    });
  });

  test('accepts a normalized alphanumeric J-Quants issuer code', () => {
    const result = analyzeDividendFiscalObservations(
      '130A0',
      [sourceRow({ issuerCode: '130A0' })],
      calendar,
      '2026-05-18',
    );

    expect(result).toMatchObject({
      issuerCode: '130A0',
      dataDate: '2026-05-15',
      unavailable: [],
    });
    expect(result.observations).toHaveLength(3);
  });

  test('returns invalid_data for an eligible issuer mismatch or duplicate disclosure identity', () => {
    const mismatched = sourceRow({ issuerCode: '67580' });
    const duplicate = sourceRow();

    expect(analyzeDividendFiscalObservations(
      '72030',
      [mismatched],
      calendar,
      '2026-05-18',
    ).unavailable).toEqual([{ scope: 'core', reason: 'invalid_data' }]);
    expect(analyzeDividendFiscalObservations(
      '72030',
      [duplicate, structuredClone(duplicate)],
      calendar,
      '2026-05-18',
    ).unavailable).toEqual([{ scope: 'core', reason: 'invalid_data' }]);
  });

  test('does not mutate source rows or official calendar rows', () => {
    const rows = [sourceRow()];
    const mutableCalendar = [...calendar];
    const rowsBefore = structuredClone(rows);
    const calendarBefore = structuredClone(mutableCalendar);

    analyzeDividendFiscalObservations('72030', rows, mutableCalendar, '2026-05-18');

    expect(rows).toEqual(rowsBefore);
    expect(mutableCalendar).toEqual(calendarBefore);
  });

  test('rejects invalid boundary identity inputs', () => {
    expect(() => analyzeDividendFiscalObservations(
      '7203', [], calendar, '2026-05-18',
    )).toThrow(RangeError);
    expect(() => analyzeDividendFiscalObservations(
      '130A', [], calendar, '2026-05-18',
    )).toThrow(RangeError);
    expect(() => analyzeDividendFiscalObservations(
      '72030', [], calendar, '2026-02-30',
    )).toThrow(RangeError);
  });
});

function eventRow(
  overrides: Partial<DividendEventSourceRow> = {},
): DividendEventSourceRow {
  return {
    notifiedDate: '2026-05-15',
    notifiedTime: '15:30',
    issuerCode: '72030',
    referenceNumber: 'event-1',
    statusCode: '1',
    kindCode: '1',
    decisionCode: '2',
    recordDateYearMonth: '2026-09',
    dividendPerShare: 50,
    recordDate: '2026-09-30',
    exDate: '2026-09-29',
    rightsRecordDate: '2026-09-30',
    paymentDate: '2026-12-01',
    corporateActionReferenceNumber: 'event-1',
    componentCode: '0',
    commemorativeDividendPerShare: null,
    specialDividendPerShare: null,
    ...overrides,
  };
}

describe('replayDividendEvents', () => {
  test('derives ordinary components only for complete source component codes', () => {
    const rows = [
      eventRow({ referenceNumber: 'ordinary', corporateActionReferenceNumber: 'ordinary' }),
      eventRow({
        referenceNumber: 'commemorative',
        corporateActionReferenceNumber: 'commemorative',
        componentCode: '1',
        commemorativeDividendPerShare: 5,
      }),
      eventRow({
        referenceNumber: 'special',
        corporateActionReferenceNumber: 'special',
        componentCode: '2',
        specialDividendPerShare: 10,
      }),
      eventRow({
        referenceNumber: 'both',
        corporateActionReferenceNumber: 'both',
        componentCode: '3',
        commemorativeDividendPerShare: 5,
        specialDividendPerShare: 10,
      }),
    ];

    const result = replayDividendEvents('72030', rows, calendar, '2026-05-18');

    expect(result.unavailable).toEqual([]);
    expect(result.events?.map((event) => ({
      referenceNumber: event.referenceNumber,
      ordinaryDividendPerShare: event.ordinaryDividendPerShare,
    }))).toEqual([
      { referenceNumber: 'both', ordinaryDividendPerShare: 35 },
      { referenceNumber: 'commemorative', ordinaryDividendPerShare: 45 },
      { referenceNumber: 'ordinary', ordinaryDividendPerShare: 50 },
      { referenceNumber: 'special', ordinaryDividendPerShare: 40 },
    ]);
    expect(result.units).toEqual({ dividendPerShare: 'JPY_per_share' });
  });

  test('replays a correction through CARefNo instead of keeping both notifications', () => {
    const original = eventRow({
      notifiedDate: '2026-05-14',
      notifiedTime: '10:00',
      referenceNumber: 'original',
      corporateActionReferenceNumber: 'original',
      dividendPerShare: 40,
    });
    const correction = eventRow({
      notifiedDate: '2026-05-18',
      notifiedTime: '09:00',
      referenceNumber: 'correction',
      corporateActionReferenceNumber: 'original',
      statusCode: '2',
      dividendPerShare: 45,
    });

    const result = replayDividendEvents(
      '72030',
      [correction, original],
      calendar,
      '2026-05-19',
    );

    expect(result.dataDate).toBe('2026-05-18');
    expect(result.events).toEqual([expect.objectContaining({
      referenceNumber: 'correction',
      corporateActionReferenceNumber: 'original',
      dividendPerShare: 45,
      ordinaryDividendPerShare: 45,
    })]);
  });

  test('does not apply a future correction to an earlier as-of result', () => {
    const original = eventRow({
      notifiedDate: '2026-05-14',
      referenceNumber: 'original',
      corporateActionReferenceNumber: 'original',
      dividendPerShare: 40,
    });
    const futureCorrection = eventRow({
      notifiedDate: '2026-05-20',
      referenceNumber: 'future-correction',
      corporateActionReferenceNumber: 'original',
      statusCode: '2',
      dividendPerShare: -1,
    });

    const baseline = replayDividendEvents('72030', [original], calendar, '2026-05-20');
    const withFuture = replayDividendEvents(
      '72030',
      [original, futureCorrection],
      calendar,
      '2026-05-20',
    );

    expect(withFuture).toEqual(baseline);
    expect(withFuture.events?.[0].dividendPerShare).toBe(40);
  });

  test('applies an eligible deletion and retains its notification as dataDate', () => {
    const original = eventRow({
      notifiedDate: '2026-05-14',
      referenceNumber: 'original',
      corporateActionReferenceNumber: 'original',
    });
    const deletion = eventRow({
      notifiedDate: '2026-05-20',
      referenceNumber: 'deletion',
      corporateActionReferenceNumber: 'original',
      statusCode: '3',
      dividendPerShare: null,
      recordDate: null,
      exDate: null,
      rightsRecordDate: null,
      paymentDate: null,
    });

    const beforeDeletion = replayDividendEvents(
      '72030', [original, deletion], calendar, '2026-05-20',
    );
    const afterDeletion = replayDividendEvents(
      '72030', [deletion, original], calendar, '2026-05-21',
    );

    expect(beforeDeletion.events).toHaveLength(1);
    expect(afterDeletion).toMatchObject({
      dataDate: '2026-05-20',
      events: [],
      unavailable: [],
    });
  });

  test('keeps an event ineligible on notification date and eligible on the next business day', () => {
    const onNotificationDate = replayDividendEvents(
      '72030', [eventRow()], calendar, '2026-05-15',
    );
    const onFollowingBusinessDay = replayDividendEvents(
      '72030', [eventRow()], calendar, '2026-05-18',
    );

    expect(onNotificationDate).toMatchObject({
      dataDate: null,
      events: null,
      unavailable: [{ scope: 'event', reason: 'no_eligible_dividend_event_data' }],
    });
    expect(onFollowingBusinessDay.events?.[0]).toMatchObject({
      notifiedDate: '2026-05-15',
      sourceEligibleDate: '2026-05-18',
    });
  });

  test('returns typed calendar unavailability instead of using weekday arithmetic', () => {
    expect(replayDividendEvents('72030', [eventRow()], [
      { date: '2026-05-15', holidayDivision: '1' },
      { date: '2026-05-16', holidayDivision: '0' },
    ], '2026-05-18')).toMatchObject({
      dataDate: null,
      events: null,
      unavailable: [{ scope: 'event', reason: 'availability_calendar_unavailable' }],
    });
  });

  test('keeps missing pre-2022 component detail unavailable rather than zero', () => {
    const pre2022 = eventRow({
      notifiedDate: '2021-06-04',
      referenceNumber: 'pre-2022',
      corporateActionReferenceNumber: 'pre-2022',
      componentCode: '1',
      commemorativeDividendPerShare: null,
    });
    const pre2022Calendar = [
      { date: '2021-06-04', holidayDivision: '1' },
      { date: '2021-06-05', holidayDivision: '0' },
      { date: '2021-06-06', holidayDivision: '0' },
      { date: '2021-06-07', holidayDivision: '1' },
    ];

    const result = replayDividendEvents(
      '72030', [pre2022], pre2022Calendar, '2021-06-07',
    );

    expect(result.events?.[0]).toMatchObject({
      dividendPerShare: 50,
      ordinaryDividendPerShare: null,
      commemorativeDividendPerShare: null,
    });
    expect(result.unavailable).toEqual([{
      scope: 'component',
      reason: 'component_breakdown_unavailable',
    }]);
  });

  test('distinguishes an empty result, missing amount, and valid zero', () => {
    const empty = replayDividendEvents('72030', [], calendar, '2026-05-18');
    const missing = replayDividendEvents('72030', [eventRow({
      dividendPerShare: null,
    })], calendar, '2026-05-18');
    const zero = replayDividendEvents('72030', [eventRow({
      dividendPerShare: 0,
    })], calendar, '2026-05-18');

    expect(empty).toMatchObject({
      events: null,
      unavailable: [{ scope: 'event', reason: 'no_eligible_dividend_event_data' }],
    });
    expect(missing.events?.[0]).toMatchObject({
      dividendPerShare: null,
      ordinaryDividendPerShare: null,
    });
    expect(missing.unavailable).toContainEqual({ scope: 'event', reason: 'missing_data' });
    expect(zero.events?.[0]).toMatchObject({
      dividendPerShare: 0,
      ordinaryDividendPerShare: 0,
    });
    expect(zero.unavailable).toEqual([]);
  });

  test('keeps interim and year-end events separate without annual aggregation', () => {
    const interim = eventRow({
      referenceNumber: 'interim',
      corporateActionReferenceNumber: 'interim',
      kindCode: '1',
      decisionCode: '1',
      dividendPerShare: 20,
    });
    const yearEnd = eventRow({
      referenceNumber: 'year-end',
      corporateActionReferenceNumber: 'year-end',
      kindCode: '2',
      decisionCode: '2',
      dividendPerShare: 30,
    });

    const result = replayDividendEvents(
      '72030', [yearEnd, interim], calendar, '2026-05-18',
    );

    expect(result.events).toEqual([
      expect.objectContaining({ referenceNumber: 'interim', kind: 'interim', decision: 'decided', dividendPerShare: 20 }),
      expect.objectContaining({ referenceNumber: 'year-end', kind: 'fiscal_year_end', decision: 'forecast', dividendPerShare: 30 }),
    ]);
    expect(result.events).toHaveLength(2);
  });

  test('preserves distinct IFTerm, RecDate, and ActRecDate meanings', () => {
    const result = replayDividendEvents('72030', [eventRow({
      recordDateYearMonth: '2026-09',
      recordDate: '2026-09-28',
      rightsRecordDate: '2026-09-30',
      exDate: '2026-09-29',
      paymentDate: '2026-12-01',
    })], calendar, '2026-05-18');

    expect(result.events?.[0]).toMatchObject({
      recordDateYearMonth: '2026-09',
      recordDate: '2026-09-28',
      rightsRecordDate: '2026-09-30',
      exDate: '2026-09-29',
      paymentDate: '2026-12-01',
    });
  });

  test('rejects invalid values, negative ordinary amounts, and broken replay identity', () => {
    const invalidInputs: DividendEventSourceRow[][] = [
      [eventRow({ dividendPerShare: -1 })],
      [eventRow({ dividendPerShare: Number.NaN })],
      [eventRow({
        componentCode: '1',
        dividendPerShare: 5,
        commemorativeDividendPerShare: 10,
      })],
      [eventRow({
        referenceNumber: 'orphan-correction',
        corporateActionReferenceNumber: 'missing',
        statusCode: '2',
      })],
      [eventRow(), structuredClone(eventRow())],
      [eventRow({ issuerCode: '67580' })],
    ];

    for (const rows of invalidInputs) {
      expect(replayDividendEvents('72030', rows, calendar, '2026-05-18'))
        .toMatchObject({
          events: null,
          unavailable: [{ scope: 'event', reason: 'invalid_data' }],
        });
    }
  });

  test('supports normalized alphanumeric issuer identity', () => {
    const result = replayDividendEvents('130A0', [eventRow({
      issuerCode: '130A0',
    })], calendar, '2026-05-18');

    expect(result).toMatchObject({ issuerCode: '130A0', unavailable: [] });
    expect(result.events).toHaveLength(1);
  });

  test('does not mutate event rows or official calendar rows', () => {
    const rows = [eventRow()];
    const mutableCalendar = [...calendar];
    const rowsBefore = structuredClone(rows);
    const calendarBefore = structuredClone(mutableCalendar);

    replayDividendEvents('72030', rows, mutableCalendar, '2026-05-18');

    expect(rows).toEqual(rowsBefore);
    expect(mutableCalendar).toEqual(calendarBefore);
  });

  test('rejects non-normalized issuer and invalid as-of boundary inputs', () => {
    expect(() => replayDividendEvents(
      '7203', [], calendar, '2026-05-18',
    )).toThrow(RangeError);
    expect(() => replayDividendEvents(
      '72030', [], calendar, '2026-02-30',
    )).toThrow(RangeError);
  });
});

describe('buildAdvancedDividendResult', () => {
  test('combines fiscal and event results without aggregating their values', () => {
    const rows = [sourceRow()];
    const eventRows = [eventRow({ notifiedDate: '2026-05-19' })];
    const fiscal = analyzeDividendFiscalObservations('72030', rows, calendar, '2026-05-20');
    const event = replayDividendEvents('72030', eventRows, calendar, '2026-05-20');
    const result = buildAdvancedDividendResult(
      fiscal,
      event,
      '2026-05-20T03:00:00.000Z',
    );

    expect(result).toMatchObject({
      analysisAsOfDate: '2026-05-20',
      collectedAt: '2026-05-20T03:00:00.000Z',
      issuerCode: '72030',
      dataDate: '2026-05-19',
      observations: fiscal.observations,
      events: event.events,
      unavailable: [],
      provenance: {
        financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
        dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
        availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
        calculation: { source: 'advanced_dividend_engine' },
      },
      units: { dividendPerShare: 'JPY_per_share', payoutRatio: 'ratio' },
    });
  });

  test('preserves an optional event plan restriction without erasing core data', () => {
    const fiscal = analyzeDividendFiscalObservations(
      '72030', [sourceRow()], calendar, '2026-05-18',
    );
    const result = buildAdvancedDividendResult(
      fiscal,
      { reason: 'event_source_plan_unavailable' },
      '2026-05-18T09:00:00.000Z',
    );

    expect(result.observations).toHaveLength(3);
    expect(result.events).toBeNull();
    expect(result.provenance.dividendEvents).toBeNull();
    expect(result.unavailable).toContainEqual({
      scope: 'event',
      reason: 'event_source_plan_unavailable',
    });
  });

  test('rejects mismatched result identity and invalid collection timestamps', () => {
    const fiscal = analyzeDividendFiscalObservations(
      '72030', [sourceRow()], calendar, '2026-05-18',
    );
    const mismatchedEvent = replayDividendEvents(
      '130A0', [eventRow({ issuerCode: '130A0' })], calendar, '2026-05-18',
    );

    expect(() => buildAdvancedDividendResult(
      fiscal, mismatchedEvent, '2026-05-18T09:00:00.000Z',
    )).toThrow(RangeError);
    expect(() => buildAdvancedDividendResult(
      fiscal, { reason: 'event_source_plan_unavailable' }, '2026-05-18T09:00:00+09:00',
    )).toThrow(RangeError);
  });

  test('does not mutate either deterministic input result', () => {
    const fiscal = analyzeDividendFiscalObservations(
      '72030', [sourceRow()], calendar, '2026-05-18',
    );
    const event = replayDividendEvents('72030', [eventRow()], calendar, '2026-05-18');
    const beforeFiscal = structuredClone(fiscal);
    const beforeEvent = structuredClone(event);

    buildAdvancedDividendResult(fiscal, event, '2026-05-18T09:00:00.000Z');

    expect(fiscal).toEqual(beforeFiscal);
    expect(event).toEqual(beforeEvent);
  });
});
