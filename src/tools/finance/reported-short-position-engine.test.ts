import { describe, expect, test } from 'bun:test';
import type { ShortSaleReportSourceRow } from './short-sale-report.js';
import { analyzeReportedShortPositions } from './reported-short-position-engine.js';

function sourceReport(
  overrides: Partial<ShortSaleReportSourceRow> = {},
): ShortSaleReportSourceRow {
  return {
    disclosedDate: '2026-05-20',
    calculatedDate: '2026-05-19',
    code: '72030',
    reporterName: 'Reporter A',
    discretionaryManagerName: null,
    fundName: 'Fund A',
    shortPositionRatio: 0.0061,
    shortPositionShares: 123_400,
    previousCalculatedDate: '2026-05-12',
    previousReportedRatio: 0.0058,
    ...overrides,
  };
}

describe('analyzeReportedShortPositions', () => {
  test('calculates a hand-verifiable source-provided ratio delta without percent conversion', () => {
    const result = analyzeReportedShortPositions([sourceReport()], '2026-05-20');

    expect(result.dataDate).toBe('2026-05-20');
    expect(result.unavailable).toEqual([]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      shortPositionRatio: 0.0061,
      previousReportedRatio: 0.0058,
    });
    expect(result.reports[0].ratioDelta).toBeCloseTo(0.0003, 12);
  });

  test('returns a null delta when the source does not provide a previous ratio', () => {
    const report = sourceReport({
      previousCalculatedDate: null,
      previousReportedRatio: null,
    });

    expect(analyzeReportedShortPositions([report], '2026-05-20').reports[0]).toMatchObject({
      previousCalculatedDate: null,
      previousReportedRatio: null,
      ratioDelta: null,
    });
  });

  test('excludes future disclosures before validating or calculating them', () => {
    const available = sourceReport();
    const futureInvalid = sourceReport({
      disclosedDate: '2026-05-21',
      calculatedDate: '2026-05-01',
      shortPositionRatio: Number.NaN,
    });

    const result = analyzeReportedShortPositions(
      [available, futureInvalid],
      '2026-05-20',
    );

    expect(result.unavailable).toEqual([]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].disclosedDate).toBe('2026-05-20');
  });

  test('does not use an earlier calculation date to bypass a future disclosure date', () => {
    const result = analyzeReportedShortPositions([
      sourceReport({
        disclosedDate: '2026-05-21',
        calculatedDate: '2026-04-30',
      }),
    ], '2026-05-20');

    expect(result).toEqual({
      dataDate: null,
      reports: [],
      unavailable: [{ reason: 'no_public_disclosure_data' }],
    });
  });

  test('keeps multiple reporters and calculation dates as separate source reports', () => {
    const reports = [
      sourceReport({ reporterName: 'Reporter A', calculatedDate: '2026-05-18' }),
      sourceReport({
        reporterName: 'Reporter B',
        fundName: 'Fund B',
        calculatedDate: '2026-05-19',
        shortPositionRatio: 0.007,
        shortPositionShares: 140_000,
      }),
    ];

    const result = analyzeReportedShortPositions(reports, '2026-05-20');

    expect(result.reports).toHaveLength(2);
    expect(result.reports.map((report) => ({
      reporterName: report.reporterName,
      calculatedDate: report.calculatedDate,
      shortPositionRatio: report.shortPositionRatio,
      shortPositionShares: report.shortPositionShares,
    }))).toEqual([
      {
        reporterName: 'Reporter A',
        calculatedDate: '2026-05-18',
        shortPositionRatio: 0.0061,
        shortPositionShares: 123_400,
      },
      {
        reporterName: 'Reporter B',
        calculatedDate: '2026-05-19',
        shortPositionRatio: 0.007,
        shortPositionShares: 140_000,
      },
    ]);
  });

  test('preserves exact source identity strings without normalization', () => {
    const report = sourceReport({
      reporterName: ' Reporter Ａ ',
      discretionaryManagerName: '運用者　甲',
      fundName: 'Fund Name  ',
    });

    expect(analyzeReportedShortPositions([report], '2026-05-20').reports[0]).toMatchObject({
      reporterName: ' Reporter Ａ ',
      discretionaryManagerName: '運用者　甲',
      fundName: 'Fund Name  ',
    });
  });

  test('uses the latest included disclosure date rather than a calculation date', () => {
    const result = analyzeReportedShortPositions([
      sourceReport({ disclosedDate: '2026-05-18', calculatedDate: '2026-05-25' }),
      sourceReport({ disclosedDate: '2026-05-20', calculatedDate: '2026-05-01' }),
    ], '2026-05-20');

    expect(result.dataDate).toBe('2026-05-20');
  });

  test('returns typed source absence for an empty or fully future input', () => {
    const expected = {
      dataDate: null,
      reports: [],
      unavailable: [{ reason: 'no_public_disclosure_data' as const }],
    };

    expect(analyzeReportedShortPositions([], '2026-05-20')).toEqual(expected);
    expect(analyzeReportedShortPositions([
      sourceReport({ disclosedDate: '2026-05-21' }),
    ], '2026-05-20')).toEqual(expected);
  });

  test('makes selected invalid numeric data unavailable instead of skipping or zeroing it', () => {
    const invalidValues: Array<Partial<ShortSaleReportSourceRow>> = [
      { shortPositionRatio: null },
      { shortPositionRatio: Number.NaN },
      { shortPositionRatio: Number.POSITIVE_INFINITY },
      { shortPositionRatio: -0.001 },
      { shortPositionShares: null },
      { shortPositionShares: Number.NaN },
      { shortPositionShares: Number.POSITIVE_INFINITY },
      { shortPositionShares: -1 },
      { previousReportedRatio: Number.NEGATIVE_INFINITY },
      { previousReportedRatio: -0.001 },
    ];

    for (const invalid of invalidValues) {
      const result = analyzeReportedShortPositions([
        sourceReport(),
        sourceReport({ reporterName: 'Invalid Reporter', ...invalid }),
      ], '2026-05-20');

      expect(result).toEqual({
        dataDate: '2026-05-20',
        reports: [],
        unavailable: [{ reason: 'invalid_data' }],
      });
    }
  });

  test('does not mutate the input array or source reports', () => {
    const reports = [
      sourceReport(),
      sourceReport({
        disclosedDate: '2026-05-21',
        reporterName: 'Future Reporter',
      }),
    ];
    const before = structuredClone(reports);

    analyzeReportedShortPositions(reports, '2026-05-20');

    expect(reports).toEqual(before);
  });
});
