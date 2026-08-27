import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import {
  resolveDividendSourceEligibleDate,
  type DividendAvailabilityCalendarDay,
  type DividendSummarySourceRow,
} from './dividend-summary.js';

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

export type AdvancedDividendCoreUnavailableReason =
  | 'no_eligible_dividend_disclosure_data'
  | 'availability_calendar_unavailable'
  | 'missing_data'
  | 'invalid_data';

export interface UnavailableAdvancedDividendCore {
  scope: 'core';
  reason: AdvancedDividendCoreUnavailableReason;
}

export interface DividendFiscalObservation {
  kind: 'actual' | 'company_forecast';
  fiscalYearEndDate: string;
  disclosedDate: string;
  disclosedTime: string | null;
  sourceEligibleDate: string;
  disclosureNumber: string;
  sourceField: 'DivAnn' | 'FDivAnn' | 'NxFDivAnn';
  payoutRatioSourceField:
    | 'PayoutRatioAnn'
    | 'FPayoutRatioAnn'
    | 'NxFPayoutRatioAnn';
  annualDividendPerShare: number | null;
  payoutRatio: number | null;
}

export interface DividendFiscalResult {
  analysisAsOfDate: string;
  issuerCode: string;
  dataDate: string | null;
  observations: readonly DividendFiscalObservation[];
  unavailable: readonly UnavailableAdvancedDividendCore[];
  provenance: {
    financialSummary: { source: 'jquants'; endpoint: '/v2/fins/summary' };
    availabilityCalendar: { source: 'jquants'; endpoint: '/v2/markets/calendar' };
    calculation: { source: 'advanced_dividend_engine' };
  };
  units: {
    dividendPerShare: 'JPY_per_share';
    payoutRatio: 'ratio';
  };
}

interface EligibleRow {
  row: DividendSummarySourceRow;
  sourceEligibleDate: string;
}

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isNormalizedJQuantsIssuerCode(value: string): boolean {
  try {
    return toJQuantsSecuritiesCode(value) === value;
  } catch {
    return false;
  }
}

function result(
  analysisAsOfDate: string,
  issuerCode: string,
  dataDate: string | null,
  observations: readonly DividendFiscalObservation[],
  unavailable: readonly UnavailableAdvancedDividendCore[],
): DividendFiscalResult {
  return {
    analysisAsOfDate,
    issuerCode,
    dataDate,
    observations,
    unavailable,
    provenance: {
      financialSummary: { source: 'jquants', endpoint: '/v2/fins/summary' },
      availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
      calculation: { source: 'advanced_dividend_engine' },
    },
    units: {
      dividendPerShare: 'JPY_per_share',
      payoutRatio: 'ratio',
    },
  };
}

function disclosureOrder(
  left: Pick<DividendFiscalObservation, 'disclosedDate' | 'disclosedTime' | 'disclosureNumber'>,
  right: Pick<DividendFiscalObservation, 'disclosedDate' | 'disclosedTime' | 'disclosureNumber'>,
): number {
  return left.disclosedDate.localeCompare(right.disclosedDate)
    || (left.disclosedTime ?? '').localeCompare(right.disclosedTime ?? '')
    || left.disclosureNumber.localeCompare(right.disclosureNumber);
}

function observationCandidates(eligible: EligibleRow): DividendFiscalObservation[] {
  const common = {
    disclosedDate: eligible.row.disclosedDate,
    disclosedTime: eligible.row.disclosedTime,
    sourceEligibleDate: eligible.sourceEligibleDate,
    disclosureNumber: eligible.row.disclosureNumber,
  };
  const observations: DividendFiscalObservation[] = [
    {
      ...common,
      kind: 'actual',
      fiscalYearEndDate: eligible.row.currentFiscalYearEndDate,
      sourceField: 'DivAnn',
      payoutRatioSourceField: 'PayoutRatioAnn',
      annualDividendPerShare: eligible.row.actualAnnualDividendPerShare,
      payoutRatio: eligible.row.actualPayoutRatio,
    },
    {
      ...common,
      kind: 'company_forecast',
      fiscalYearEndDate: eligible.row.currentFiscalYearEndDate,
      sourceField: 'FDivAnn',
      payoutRatioSourceField: 'FPayoutRatioAnn',
      annualDividendPerShare: eligible.row.forecastAnnualDividendPerShare,
      payoutRatio: eligible.row.forecastPayoutRatio,
    },
  ];

  if (eligible.row.nextFiscalYearEndDate !== null) {
    observations.push({
      ...common,
      kind: 'company_forecast',
      fiscalYearEndDate: eligible.row.nextFiscalYearEndDate,
      sourceField: 'NxFDivAnn',
      payoutRatioSourceField: 'NxFPayoutRatioAnn',
      annualDividendPerShare: eligible.row.nextForecastAnnualDividendPerShare,
      payoutRatio: eligible.row.nextForecastPayoutRatio,
    });
  }

  return observations;
}

function hasValidIdentityAndDates(row: DividendSummarySourceRow, issuerCode: string): boolean {
  return row.issuerCode === issuerCode
    && isCanonicalDate(row.disclosedDate)
    && (row.disclosedTime === null || TIME_PATTERN.test(row.disclosedTime))
    && row.disclosureNumber.length > 0
    && isCanonicalDate(row.currentFiscalYearEndDate)
    && (row.nextFiscalYearEndDate === null || isCanonicalDate(row.nextFiscalYearEndDate));
}

function isValidObservation(observation: DividendFiscalObservation): boolean {
  const amount = observation.annualDividendPerShare;
  const payoutRatio = observation.payoutRatio;
  return (amount === null || (Number.isFinite(amount) && amount >= 0))
    && (payoutRatio === null || Number.isFinite(payoutRatio));
}

function latestByFiscalKind(
  eligibleRows: readonly EligibleRow[],
): DividendFiscalObservation[] | null {
  const selected = new Map<string, DividendFiscalObservation>();
  for (const eligible of eligibleRows) {
    for (const candidate of observationCandidates(eligible)) {
      const key = `${candidate.fiscalYearEndDate}\u0000${candidate.kind}`;
      const current = selected.get(key);
      if (current === undefined || disclosureOrder(current, candidate) < 0) {
        selected.set(key, candidate);
      } else if (disclosureOrder(current, candidate) === 0) {
        return null;
      }
    }
  }

  return [...selected.values()].sort((left, right) => (
    left.fiscalYearEndDate.localeCompare(right.fiscalYearEndDate)
      || disclosureOrder(left, right)
      || left.kind.localeCompare(right.kind)
  ));
}

/** Select the latest as-of-safe actual and company-forecast fiscal observations. */
export function analyzeDividendFiscalObservations(
  issuerCode: string,
  sourceRows: readonly DividendSummarySourceRow[],
  officialCalendar: readonly DividendAvailabilityCalendarDay[],
  analysisAsOfDate: string,
): DividendFiscalResult {
  if (!isNormalizedJQuantsIssuerCode(issuerCode)) {
    throw new RangeError('Dividend issuerCode must be a normalized five-digit JPX code.');
  }
  if (!isCanonicalDate(analysisAsOfDate)) {
    throw new RangeError('Dividend analysisAsOfDate must be a valid YYYY-MM-DD date.');
  }

  const eligibleRows: EligibleRow[] = [];
  for (const row of sourceRows) {
    // A publication cannot be eligible on its source date, so future/same-day rows
    // are excluded before validating their values or resolving calendar availability.
    if (row.disclosedDate >= analysisAsOfDate) continue;

    const sourceEligibleDate = resolveDividendSourceEligibleDate(
      row.disclosedDate,
      officialCalendar,
    );
    if (sourceEligibleDate === null) {
      return result(
        analysisAsOfDate,
        issuerCode,
        null,
        [],
        [{ scope: 'core', reason: 'availability_calendar_unavailable' }],
      );
    }
    if (sourceEligibleDate <= analysisAsOfDate) {
      eligibleRows.push({ row, sourceEligibleDate });
    }
  }

  if (eligibleRows.length === 0) {
    return result(
      analysisAsOfDate,
      issuerCode,
      null,
      [],
      [{ scope: 'core', reason: 'no_eligible_dividend_disclosure_data' }],
    );
  }

  if (!eligibleRows.every(({ row }) => hasValidIdentityAndDates(row, issuerCode))) {
    return result(
      analysisAsOfDate,
      issuerCode,
      null,
      [],
      [{ scope: 'core', reason: 'invalid_data' }],
    );
  }

  const observations = latestByFiscalKind(eligibleRows);
  const dataDate = observations?.reduce<string | null>((latest, observation) => (
    latest === null || observation.disclosedDate > latest
      ? observation.disclosedDate
      : latest
  ), null) ?? null;

  if (observations === null || !observations.every(isValidObservation)) {
    return result(
      analysisAsOfDate,
      issuerCode,
      dataDate,
      [],
      [{ scope: 'core', reason: 'invalid_data' }],
    );
  }

  const unavailable: UnavailableAdvancedDividendCore[] = observations.some(
    (observation) => observation.annualDividendPerShare === null
      && observation.payoutRatio === null,
  )
    ? [{ scope: 'core', reason: 'missing_data' }]
    : [];

  return result(
    analysisAsOfDate,
    issuerCode,
    dataDate,
    observations,
    unavailable,
  );
}
