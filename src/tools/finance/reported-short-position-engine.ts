import type { ShortSaleReportSourceRow } from './short-sale-report.js';

export interface ReportedShortPosition {
  disclosedDate: string;
  calculatedDate: string;
  reporterName: string | null;
  discretionaryManagerName: string | null;
  fundName: string | null;
  shortPositionRatio: number;
  shortPositionShares: number;
  previousCalculatedDate: string | null;
  previousReportedRatio: number | null;
  ratioDelta: number | null;
}

export type ReportedShortPositionUnavailableReason =
  | 'no_public_disclosure_data'
  | 'invalid_data';

export interface UnavailableReportedShortPosition {
  reason: ReportedShortPositionUnavailableReason;
}

export interface ReportedShortPositionResult {
  dataDate: string | null;
  reports: readonly ReportedShortPosition[];
  unavailable: readonly UnavailableReportedShortPosition[];
}

type ValidShortSaleReportSourceRow = ShortSaleReportSourceRow & {
  shortPositionRatio: number;
  shortPositionShares: number;
};

function isNonNegativeFinite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidSourceReport(
  report: ShortSaleReportSourceRow,
): report is ValidShortSaleReportSourceRow {
  return isNonNegativeFinite(report.shortPositionRatio)
    && isNonNegativeFinite(report.shortPositionShares)
    && (report.previousReportedRatio === null
      || isNonNegativeFinite(report.previousReportedRatio));
}

function latestDisclosedDate(reports: readonly ShortSaleReportSourceRow[]): string | null {
  return reports.reduce<string | null>((latest, report) => (
    latest === null || report.disclosedDate > latest ? report.disclosedDate : latest
  ), null);
}

/** Apply the disclosure-date as-of boundary and calculate source-provided ratio deltas. */
export function analyzeReportedShortPositions(
  sourceReports: readonly ShortSaleReportSourceRow[],
  analysisAsOfDate: string,
): ReportedShortPositionResult {
  // Availability is determined by disclosure date before validating selected reports.
  const selectedReports = sourceReports.filter(
    (report) => report.disclosedDate <= analysisAsOfDate,
  );

  if (selectedReports.length === 0) {
    return {
      dataDate: null,
      reports: [],
      unavailable: [{ reason: 'no_public_disclosure_data' }],
    };
  }

  const dataDate = latestDisclosedDate(selectedReports);
  const validReports = selectedReports.filter(isValidSourceReport);
  if (validReports.length !== selectedReports.length) {
    return {
      dataDate,
      reports: [],
      unavailable: [{ reason: 'invalid_data' }],
    };
  }

  return {
    dataDate,
    reports: validReports.map((report) => ({
      disclosedDate: report.disclosedDate,
      calculatedDate: report.calculatedDate,
      reporterName: report.reporterName,
      discretionaryManagerName: report.discretionaryManagerName,
      fundName: report.fundName,
      shortPositionRatio: report.shortPositionRatio,
      shortPositionShares: report.shortPositionShares,
      previousCalculatedDate: report.previousCalculatedDate,
      previousReportedRatio: report.previousReportedRatio,
      ratioDelta: report.previousReportedRatio === null
        ? null
        : report.shortPositionRatio - report.previousReportedRatio,
    })),
    unavailable: [],
  };
}
