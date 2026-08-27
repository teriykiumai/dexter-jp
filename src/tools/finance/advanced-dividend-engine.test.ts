import { describe, expect, test } from 'bun:test';
import {
  analyzeDividendFiscalObservations,
  type DividendFiscalObservation,
} from './advanced-dividend-engine.js';
import type {
  DividendAvailabilityCalendarDay,
  DividendSummarySourceRow,
} from './dividend-summary.js';

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
      '72030', [], calendar, '2026-02-30',
    )).toThrow(RangeError);
  });
});
