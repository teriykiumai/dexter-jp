import { describe, expect, test } from 'bun:test';
import type {
  InvestorTypeFlowSourceRow,
  InvestorTypeTradingValue,
} from './investor-type-flows.js';
import {
  analyzeInvestorTypeFlows,
  type InvestorTypeCalendarDay,
} from './investor-type-flow-engine.js';

function tradingValue(sell: number, buy: number): InvestorTypeTradingValue {
  return {
    sell,
    buy,
    total: sell + buy,
    balance: buy - sell,
  };
}

function sourcePeriod(
  overrides: Partial<InvestorTypeFlowSourceRow> = {},
): InvestorTypeFlowSourceRow {
  const brokerageBreakdown = {
    individuals: tradingValue(10, 15),
    foreignInvestors: tradingValue(20, 10),
    securitiesCompanies: tradingValue(3, 3),
    investmentTrusts: tradingValue(4, 6),
    businessCorporations: tradingValue(8, 7),
    otherCorporations: tradingValue(2, 3),
    insuranceCompanies: tradingValue(5, 4),
    banks: tradingValue(6, 8),
    trustBanks: tradingValue(7, 7),
    otherFinancialInstitutions: tradingValue(5, 2),
  };
  const brokerage = tradingValue(70, 65);
  const proprietary = tradingValue(30, 40);

  return {
    publishedDate: '2026-05-14',
    periodStartDate: '2026-05-04',
    periodEndDate: '2026-05-08',
    section: 'TokyoNagoya',
    summary: {
      proprietary,
      brokerage,
      total: tradingValue(100, 105),
    },
    brokerageBreakdown,
    ...overrides,
  };
}

const correctionCalendar: readonly InvestorTypeCalendarDay[] = [
  { date: '2026-05-18', holidayDivision: '1' },
  { date: '2026-05-19', holidayDivision: '0' },
  { date: '2026-05-20', holidayDivision: '2' },
  { date: '2026-05-21', holidayDivision: '1' },
  { date: '2026-05-22', holidayDivision: '1' },
];

describe('analyzeInvestorTypeFlows', () => {
  test('returns the latest complete Tokyo/Nagoya source period without recalculation', () => {
    const earlier = sourcePeriod({
      publishedDate: '2026-05-07',
      periodStartDate: '2026-04-27',
      periodEndDate: '2026-05-01',
    });
    const latest = sourcePeriod();

    const result = analyzeInvestorTypeFlows(
      [earlier, latest],
      correctionCalendar,
      '2026-05-14',
    );

    expect(result).toEqual({
      dataDate: '2026-05-14',
      section: 'TokyoNagoya',
      period: latest,
      unavailable: [],
    });
    expect(result.period?.brokerageBreakdown).toEqual(latest.brokerageBreakdown);
    expect(result.period?.brokerageBreakdown.foreignInvestors.balance).toBe(-10);
    expect(result.period?.brokerageBreakdown.securitiesCompanies.balance).toBe(0);
    expect(result.period?.brokerageBreakdown.individuals.balance).toBe(5);
  });

  test('excludes a future publication before validating it', () => {
    const eligible = sourcePeriod();
    const futureInvalid = sourcePeriod({
      publishedDate: '2026-05-21',
      periodStartDate: '2026-05-11',
      periodEndDate: '2026-05-15',
      summary: {
        ...sourcePeriod().summary,
        total: { sell: Number.NaN, buy: 0, total: 0, balance: 0 },
      },
    });

    expect(analyzeInvestorTypeFlows(
      [eligible, futureInvalid],
      correctionCalendar,
      '2026-05-20',
    ).period).toBe(eligible);
  });

  test('does not use trading-period dates to bypass a future publication date', () => {
    const result = analyzeInvestorTypeFlows([
      sourcePeriod({ publishedDate: '2026-05-21' }),
    ], correctionCalendar, '2026-05-20');

    expect(result).toEqual({
      dataDate: null,
      section: 'TokyoNagoya',
      period: null,
      unavailable: [{ reason: 'no_investor_type_flow_data' }],
    });
  });

  test('keeps the old vintage on a correction publication date', () => {
    const original = sourcePeriod();
    const correction = sourcePeriod({ publishedDate: '2026-05-18' });

    const result = analyzeInvestorTypeFlows(
      [original, correction],
      correctionCalendar,
      '2026-05-18',
    );

    expect(result.dataDate).toBe(original.publishedDate);
    expect(result.period).toBe(original);
  });

  test('uses a corrected vintage from the following official business day', () => {
    const original = sourcePeriod();
    const correction = sourcePeriod({ publishedDate: '2026-05-18' });

    expect(analyzeInvestorTypeFlows(
      [original, correction],
      correctionCalendar,
      '2026-05-19',
    ).period).toBe(original);
    expect(analyzeInvestorTypeFlows(
      [original, correction],
      correctionCalendar,
      '2026-05-20',
    ).period).toBe(correction);
  });

  test('uses only the supplied official calendar instead of weekday arithmetic', () => {
    const original = sourcePeriod();
    const correction = sourcePeriod({ publishedDate: '2026-05-18' });
    const calendar = [
      { date: '2026-05-19', holidayDivision: '0' },
      { date: '2026-05-20', holidayDivision: '0' },
      { date: '2026-05-21', holidayDivision: '1' },
    ];

    expect(analyzeInvestorTypeFlows(
      [original, correction],
      calendar,
      '2026-05-20',
    ).period).toBe(original);
    expect(analyzeInvestorTypeFlows(
      [original, correction],
      calendar,
      '2026-05-21',
    ).period).toBe(correction);
  });

  test('selects the latest eligible correction without rewriting a historical result', () => {
    const original = sourcePeriod();
    const firstCorrection = sourcePeriod({ publishedDate: '2026-05-18' });
    const futureCorrection = sourcePeriod({ publishedDate: '2026-05-21' });

    expect(analyzeInvestorTypeFlows(
      [original, firstCorrection, futureCorrection],
      correctionCalendar,
      '2026-05-20',
    )).toMatchObject({
      dataDate: '2026-05-18',
      period: firstCorrection,
    });
    expect(analyzeInvestorTypeFlows(
      [original, firstCorrection, futureCorrection],
      correctionCalendar,
      '2026-05-22',
    )).toMatchObject({
      dataDate: '2026-05-21',
      period: futureCorrection,
    });
  });

  test('selects by latest period end after resolving corrections', () => {
    const olderCorrection = sourcePeriod({ publishedDate: '2026-05-21' });
    const newerPeriod = sourcePeriod({
      publishedDate: '2026-05-14',
      periodStartDate: '2026-05-11',
      periodEndDate: '2026-05-15',
    });

    const result = analyzeInvestorTypeFlows(
      [sourcePeriod(), olderCorrection, newerPeriod],
      correctionCalendar,
      '2026-05-22',
    );

    expect(result.period).toBe(newerPeriod);
  });

  test('validates every category and both source hierarchy invariants', () => {
    const invalidRows: InvestorTypeFlowSourceRow[] = [];

    const invalidCategoryTotal = structuredClone(sourcePeriod());
    invalidCategoryTotal.brokerageBreakdown.individuals.total += 1;
    invalidRows.push(invalidCategoryTotal);

    const invalidCategoryBalance = structuredClone(sourcePeriod());
    invalidCategoryBalance.brokerageBreakdown.foreignInvestors.balance = 0;
    invalidRows.push(invalidCategoryBalance);

    const invalidSummary = structuredClone(sourcePeriod());
    invalidSummary.summary.total.buy += 1;
    invalidSummary.summary.total.total += 1;
    invalidSummary.summary.total.balance += 1;
    invalidRows.push(invalidSummary);

    const invalidBreakdown = structuredClone(sourcePeriod());
    invalidBreakdown.summary.brokerage = tradingValue(71, 65);
    invalidBreakdown.summary.total = tradingValue(101, 105);
    invalidRows.push(invalidBreakdown);

    for (const invalid of invalidRows) {
      expect(analyzeInvestorTypeFlows(
        [invalid],
        correctionCalendar,
        '2026-05-14',
      )).toEqual({
        dataDate: '2026-05-14',
        section: 'TokyoNagoya',
        period: null,
        unavailable: [{ reason: 'invalid_data' }],
      });
    }
  });

  test('rejects invalid numeric values and never falls back to an older valid period', () => {
    const invalidMutations: Array<(period: InvestorTypeFlowSourceRow) => void> = [
      (period) => { period.brokerageBreakdown.banks.sell = Number.NaN; },
      (period) => { period.brokerageBreakdown.banks.buy = Number.POSITIVE_INFINITY; },
      (period) => { period.brokerageBreakdown.banks.total = -1; },
      (period) => { period.brokerageBreakdown.banks.balance = Number.NEGATIVE_INFINITY; },
    ];
    for (const mutate of invalidMutations) {
      const invalidLatest = structuredClone(sourcePeriod({
        publishedDate: '2026-05-21',
        periodStartDate: '2026-05-11',
        periodEndDate: '2026-05-15',
      }));
      mutate(invalidLatest);

      const result = analyzeInvestorTypeFlows(
        [sourcePeriod(), invalidLatest],
        correctionCalendar,
        '2026-05-21',
      );

      expect(result.dataDate).toBe('2026-05-21');
      expect(result.period).toBeNull();
      expect(result.unavailable).toEqual([{ reason: 'invalid_data' }]);
    }
  });

  test('does not fall back to the original when the eligible correction is invalid', () => {
    const original = sourcePeriod();
    const invalidCorrection = structuredClone(sourcePeriod({
      publishedDate: '2026-05-18',
    }));
    invalidCorrection.summary.proprietary.total += 1;

    expect(analyzeInvestorTypeFlows(
      [original, invalidCorrection],
      correctionCalendar,
      '2026-05-20',
    )).toEqual({
      dataDate: '2026-05-18',
      section: 'TokyoNagoya',
      period: null,
      unavailable: [{ reason: 'invalid_data' }],
    });
  });

  test('treats equal-key/equal-publication duplicates as invalid', () => {
    const period = sourcePeriod();

    expect(analyzeInvestorTypeFlows(
      [period, structuredClone(period)],
      correctionCalendar,
      '2026-05-14',
    )).toEqual({
      dataDate: '2026-05-14',
      section: 'TokyoNagoya',
      period: null,
      unavailable: [{ reason: 'invalid_data' }],
    });
  });

  test('keeps unavailable distinct from a valid all-zero source row', () => {
    const zero = tradingValue(0, 0);
    const zeroPeriod = sourcePeriod({
      summary: { proprietary: zero, brokerage: zero, total: zero },
      brokerageBreakdown: {
        individuals: zero,
        foreignInvestors: zero,
        securitiesCompanies: zero,
        investmentTrusts: zero,
        businessCorporations: zero,
        otherCorporations: zero,
        insuranceCompanies: zero,
        banks: zero,
        trustBanks: zero,
        otherFinancialInstitutions: zero,
      },
    });

    expect(analyzeInvestorTypeFlows([], correctionCalendar, '2026-05-14').unavailable)
      .toEqual([{ reason: 'no_investor_type_flow_data' }]);
    expect(analyzeInvestorTypeFlows(
      [zeroPeriod],
      correctionCalendar,
      '2026-05-14',
    )).toMatchObject({ period: zeroPeriod, unavailable: [] });
  });

  test('preserves the exact Tokyo/Nagoya categories and ignores other sections', () => {
    const target = sourcePeriod();
    const otherSection = sourcePeriod({
      publishedDate: '2026-05-21',
      periodStartDate: '2026-05-11',
      periodEndDate: '2026-05-15',
      section: 'TSEPrime',
    });

    const result = analyzeInvestorTypeFlows(
      [target, otherSection],
      correctionCalendar,
      '2026-05-21',
    );

    expect(result.section).toBe('TokyoNagoya');
    expect(result.period).toBe(target);
    expect(result.period?.brokerageBreakdown).toEqual(target.brokerageBreakdown);
  });

  test('requires calendar coverage for a potentially eligible correction', () => {
    const original = sourcePeriod();
    const correction = sourcePeriod({ publishedDate: '2026-05-18' });

    expect(analyzeInvestorTypeFlows(
      [original, correction],
      [],
      '2026-05-20',
    ).unavailable).toEqual([{ reason: 'invalid_data' }]);
  });

  test('does not mutate source rows or calendar rows and does not forward-fill weeks', () => {
    const rows = [
      sourcePeriod({
        publishedDate: '2026-05-07',
        periodStartDate: '2026-04-27',
        periodEndDate: '2026-05-01',
      }),
      sourcePeriod({
        publishedDate: '2026-05-21',
        periodStartDate: '2026-05-11',
        periodEndDate: '2026-05-15',
      }),
    ];
    const calendar = [...correctionCalendar];
    const rowsBefore = structuredClone(rows);
    const calendarBefore = structuredClone(calendar);

    const result = analyzeInvestorTypeFlows(rows, calendar, '2026-05-21');

    expect(result.period).toBe(rows[1]);
    expect(result.period?.periodStartDate).toBe('2026-05-11');
    expect(rows).toEqual(rowsBefore);
    expect(calendar).toEqual(calendarBefore);
  });
});
