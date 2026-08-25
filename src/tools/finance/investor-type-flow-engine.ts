import type {
  InvestorTypeFlowSourceRow,
  InvestorTypeTradingValue,
} from './investor-type-flows.js';

export const INVESTOR_TYPE_FLOW_SECTION = 'TokyoNagoya' as const;
export const CORRECTION_AVAILABILITY_START_DATE = '2023-04-03' as const;

export interface InvestorTypeCalendarDay {
  date: string;
  holidayDivision: string;
}

export type InvestorTypeFlowPeriod = InvestorTypeFlowSourceRow;

export type InvestorTypeFlowUnavailableReason =
  | 'no_investor_type_flow_data'
  | 'invalid_data';

export interface UnavailableInvestorTypeFlow {
  reason: InvestorTypeFlowUnavailableReason;
}

export interface InvestorTypeFlowResult {
  dataDate: string | null;
  section: typeof INVESTOR_TYPE_FLOW_SECTION;
  period: InvestorTypeFlowPeriod | null;
  unavailable: readonly UnavailableInvestorTypeFlow[];
}

const TRADING_VALUE_FIELDS = ['sell', 'buy', 'total', 'balance'] as const;

function unavailableResult(
  reason: InvestorTypeFlowUnavailableReason,
  dataDate: string | null = null,
): InvestorTypeFlowResult {
  return {
    dataDate,
    section: INVESTOR_TYPE_FLOW_SECTION,
    period: null,
    unavailable: [{ reason }],
  };
}

function periodKey(period: InvestorTypeFlowSourceRow): string {
  return `${period.section}\u0000${period.periodStartDate}\u0000${period.periodEndDate}`;
}

function isOfficialBusinessDay(day: InvestorTypeCalendarDay): boolean {
  return day.holidayDivision === '1' || day.holidayDivision === '2';
}

function nextOfficialBusinessDay(
  publishedDate: string,
  calendar: readonly InvestorTypeCalendarDay[],
): string | null {
  return calendar.reduce<string | null>((next, day) => {
    if (day.date <= publishedDate || !isOfficialBusinessDay(day)) return next;
    return next === null || day.date < next ? day.date : next;
  }, null);
}

function isFiniteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTradingValue(value: InvestorTypeTradingValue): boolean {
  return isFiniteNumber(value.sell)
    && value.sell >= 0
    && isFiniteNumber(value.buy)
    && value.buy >= 0
    && isFiniteNumber(value.total)
    && value.total >= 0
    && isFiniteNumber(value.balance)
    && value.total === value.sell + value.buy
    && value.balance === value.buy - value.sell;
}

function componentSum(
  values: readonly InvestorTypeTradingValue[],
  field: typeof TRADING_VALUE_FIELDS[number],
): number {
  return values.reduce((sum, value) => sum + value[field], 0);
}

function isValidPeriod(period: InvestorTypeFlowSourceRow): boolean {
  const summaryValues = [
    period.summary.proprietary,
    period.summary.brokerage,
    period.summary.total,
  ];
  const brokerageValues = [
    period.brokerageBreakdown.individuals,
    period.brokerageBreakdown.foreignInvestors,
    period.brokerageBreakdown.securitiesCompanies,
    period.brokerageBreakdown.investmentTrusts,
    period.brokerageBreakdown.businessCorporations,
    period.brokerageBreakdown.otherCorporations,
    period.brokerageBreakdown.insuranceCompanies,
    period.brokerageBreakdown.banks,
    period.brokerageBreakdown.trustBanks,
    period.brokerageBreakdown.otherFinancialInstitutions,
  ];

  if (![...summaryValues, ...brokerageValues].every(isValidTradingValue)) {
    return false;
  }

  return TRADING_VALUE_FIELDS.every((field) => (
    period.summary.total[field]
      === period.summary.proprietary[field] + period.summary.brokerage[field]
    && period.summary.brokerage[field] === componentSum(brokerageValues, field)
  ));
}

interface PublicationGroup {
  publishedDate: string;
  rows: InvestorTypeFlowSourceRow[];
}

function publicationGroups(
  periods: readonly InvestorTypeFlowSourceRow[],
): PublicationGroup[] {
  const rowsByPublication = new Map<string, InvestorTypeFlowSourceRow[]>();
  for (const period of periods) {
    const rows = rowsByPublication.get(period.publishedDate) ?? [];
    rows.push(period);
    rowsByPublication.set(period.publishedDate, rows);
  }

  return [...rowsByPublication.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([publishedDate, rows]) => ({ publishedDate, rows }));
}

interface ResolvedPublication {
  group: PublicationGroup | null;
  calendarComplete: boolean;
}

function resolveLatestPublication(
  periods: readonly InvestorTypeFlowSourceRow[],
  calendar: readonly InvestorTypeCalendarDay[],
  analysisAsOfDate: string,
): ResolvedPublication {
  const groups = publicationGroups(periods);
  let latestEligible: PublicationGroup | null = null;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group.publishedDate > analysisAsOfDate) continue;

    // Later publications for the same section and trading period are corrections.
    const isCorrection = index > 0
      && group.publishedDate >= CORRECTION_AVAILABILITY_START_DATE;
    if (!isCorrection) {
      latestEligible = group;
      continue;
    }

    // A correction is never eligible on its publication date.
    if (group.publishedDate === analysisAsOfDate) continue;

    const eligibleDate = nextOfficialBusinessDay(group.publishedDate, calendar);
    if (eligibleDate === null) {
      return { group: latestEligible, calendarComplete: false };
    }
    if (eligibleDate <= analysisAsOfDate) latestEligible = group;
  }

  return { group: latestEligible, calendarComplete: true };
}

/**
 * Select and validate the latest correction-resolved Tokyo/Nagoya investor-type row
 * available at the supplied date-only boundary.
 */
export function analyzeInvestorTypeFlows(
  sourcePeriods: readonly InvestorTypeFlowSourceRow[],
  officialCalendar: readonly InvestorTypeCalendarDay[],
  analysisAsOfDate: string,
): InvestorTypeFlowResult {
  const periodsByKey = new Map<string, InvestorTypeFlowSourceRow[]>();
  for (const period of sourcePeriods) {
    if (period.section !== INVESTOR_TYPE_FLOW_SECTION) continue;
    const key = periodKey(period);
    const periods = periodsByKey.get(key) ?? [];
    periods.push(period);
    periodsByKey.set(key, periods);
  }

  const eligiblePeriodGroups = [...periodsByKey.values()]
    .filter((periods) => publicationGroups(periods)[0]?.publishedDate <= analysisAsOfDate)
    .sort((left, right) => (
      right[0].periodEndDate.localeCompare(left[0].periodEndDate)
    ));

  if (eligiblePeriodGroups.length === 0) {
    return unavailableResult('no_investor_type_flow_data');
  }

  const latestPeriodEndDate = eligiblePeriodGroups[0][0].periodEndDate;
  const latestPeriodGroups = eligiblePeriodGroups.filter(
    (periods) => periods[0].periodEndDate === latestPeriodEndDate,
  );
  if (latestPeriodGroups.length !== 1) {
    return unavailableResult('invalid_data');
  }

  const resolved = resolveLatestPublication(
    latestPeriodGroups[0],
    officialCalendar,
    analysisAsOfDate,
  );
  if (!resolved.calendarComplete) {
    return unavailableResult('invalid_data');
  }
  if (resolved.group === null) {
    return unavailableResult('no_investor_type_flow_data');
  }
  if (resolved.group.rows.length !== 1) {
    return unavailableResult('invalid_data', resolved.group.publishedDate);
  }

  const selectedPeriod = resolved.group.rows[0];
  if (!isValidPeriod(selectedPeriod)) {
    return unavailableResult('invalid_data', selectedPeriod.publishedDate);
  }

  return {
    dataDate: selectedPeriod.publishedDate,
    section: INVESTOR_TYPE_FLOW_SECTION,
    period: selectedPeriod,
    unavailable: [],
  };
}
