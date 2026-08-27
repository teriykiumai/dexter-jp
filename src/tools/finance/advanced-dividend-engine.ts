import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import {
  resolveDividendSourceEligibleDate,
  type DividendAvailabilityCalendarDay,
  type DividendSummarySourceRow,
} from './dividend-summary.js';
import type { DividendEventSourceRow } from './dividend-events.js';

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const EVENT_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

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

export type DividendEventUnavailableReason =
  | 'no_eligible_dividend_event_data'
  | 'availability_calendar_unavailable'
  | 'component_breakdown_unavailable'
  | 'missing_data'
  | 'invalid_data';

export interface UnavailableDividendEvent {
  scope: 'event' | 'component';
  reason: DividendEventUnavailableReason;
}

export interface DividendEvent {
  notifiedDate: string;
  notifiedTime: string | null;
  sourceEligibleDate: string;
  referenceNumber: string;
  corporateActionReferenceNumber: string;
  kind: 'interim' | 'fiscal_year_end';
  decision: 'decided' | 'forecast';
  recordDateYearMonth: string;
  dividendPerShare: number | null;
  ordinaryDividendPerShare: number | null;
  commemorativeDividendPerShare: number | null;
  specialDividendPerShare: number | null;
  recordDate: string | null;
  rightsRecordDate: string | null;
  exDate: string | null;
  paymentDate: string | null;
}

export interface DividendEventReplayResult {
  analysisAsOfDate: string;
  issuerCode: string;
  dataDate: string | null;
  events: readonly DividendEvent[] | null;
  unavailable: readonly UnavailableDividendEvent[];
  provenance: {
    dividendEvents: { source: 'jquants'; endpoint: '/v2/fins/dividend' };
    availabilityCalendar: { source: 'jquants'; endpoint: '/v2/markets/calendar' };
    calculation: { source: 'advanced_dividend_engine' };
  };
  units: {
    dividendPerShare: 'JPY_per_share';
  };
}

export type AdvancedDividendUnavailableReason =
  | AdvancedDividendCoreUnavailableReason
  | DividendEventUnavailableReason
  | 'event_source_plan_unavailable';

export interface UnavailableAdvancedDividend {
  scope: 'core' | 'event' | 'component';
  reason: AdvancedDividendUnavailableReason;
}

export interface AdvancedDividendResult {
  analysisAsOfDate: string;
  collectedAt: string;
  issuerCode: string;
  dataDate: string | null;
  observations: readonly DividendFiscalObservation[];
  events: readonly DividendEvent[] | null;
  unavailable: readonly UnavailableAdvancedDividend[];
  provenance: {
    financialSummary: { source: 'jquants'; endpoint: '/v2/fins/summary' };
    dividendEvents: { source: 'jquants'; endpoint: '/v2/fins/dividend' } | null;
    availabilityCalendar: { source: 'jquants'; endpoint: '/v2/markets/calendar' };
    calculation: { source: 'advanced_dividend_engine' };
  };
  units: {
    dividendPerShare: 'JPY_per_share';
    payoutRatio: 'ratio';
  };
}

export interface DividendEventSourcePlanUnavailable {
  reason: 'event_source_plan_unavailable';
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

function isCanonicalYearMonth(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value) && isCanonicalDate(`${value}-01`);
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

interface EligibleEventNotification {
  row: DividendEventSourceRow;
  sourceEligibleDate: string;
}

function eventResult(
  analysisAsOfDate: string,
  issuerCode: string,
  dataDate: string | null,
  events: readonly DividendEvent[] | null,
  unavailable: readonly UnavailableDividendEvent[],
): DividendEventReplayResult {
  return {
    analysisAsOfDate,
    issuerCode,
    dataDate,
    events,
    unavailable,
    provenance: {
      dividendEvents: { source: 'jquants', endpoint: '/v2/fins/dividend' },
      availabilityCalendar: { source: 'jquants', endpoint: '/v2/markets/calendar' },
      calculation: { source: 'advanced_dividend_engine' },
    },
    units: { dividendPerShare: 'JPY_per_share' },
  };
}

function eventNotificationOrder(
  left: Pick<DividendEventSourceRow, 'notifiedDate' | 'notifiedTime' | 'referenceNumber'>,
  right: Pick<DividendEventSourceRow, 'notifiedDate' | 'notifiedTime' | 'referenceNumber'>,
): number {
  return left.notifiedDate.localeCompare(right.notifiedDate)
    || (left.notifiedTime ?? '').localeCompare(right.notifiedTime ?? '')
    || left.referenceNumber.localeCompare(right.referenceNumber);
}

function isNullableCanonicalDate(value: string | null): boolean {
  return value === null || isCanonicalDate(value);
}

function hasValidEventMetadata(row: DividendEventSourceRow, issuerCode: string): boolean {
  return row.issuerCode === issuerCode
    && isCanonicalDate(row.notifiedDate)
    && (row.notifiedTime === null || EVENT_TIME_PATTERN.test(row.notifiedTime))
    && row.referenceNumber.length > 0
    && row.corporateActionReferenceNumber.length > 0
    && (row.statusCode === '1' || row.statusCode === '2' || row.statusCode === '3')
    && (row.statusCode !== '1'
      || row.corporateActionReferenceNumber === row.referenceNumber)
    && (row.kindCode === '1' || row.kindCode === '2')
    && (row.decisionCode === '1' || row.decisionCode === '2')
    && isCanonicalYearMonth(row.recordDateYearMonth)
    && isNullableCanonicalDate(row.recordDate)
    && isNullableCanonicalDate(row.rightsRecordDate)
    && isNullableCanonicalDate(row.exDate)
    && isNullableCanonicalDate(row.paymentDate)
    && (
      row.componentCode === '0'
      || row.componentCode === '1'
      || row.componentCode === '2'
      || row.componentCode === '3'
    );
}

function areValidEventAmounts(row: DividendEventSourceRow): boolean {
  return [
    row.dividendPerShare,
    row.commemorativeDividendPerShare,
    row.specialDividendPerShare,
  ].every((value) => value === null || (Number.isFinite(value) && value >= 0));
}

interface MappedDividendEvent {
  event: DividendEvent;
  missingDividend: boolean;
  componentUnavailable: boolean;
  invalid: boolean;
}

function mapDividendEvent(
  notification: EligibleEventNotification,
): MappedDividendEvent {
  const { row } = notification;
  const dividend = row.dividendPerShare;
  const needsCommemorativeComponent = row.componentCode === '1' || row.componentCode === '3';
  const needsSpecialComponent = row.componentCode === '2' || row.componentCode === '3';
  let ordinaryDividendPerShare: number | null = null;
  let componentUnavailable = false;

  if (dividend !== null) {
    if (row.componentCode === '0') {
      ordinaryDividendPerShare = dividend;
    } else if (row.componentCode === '1') {
      if (row.commemorativeDividendPerShare === null) {
        componentUnavailable = true;
      } else {
        ordinaryDividendPerShare = dividend - row.commemorativeDividendPerShare;
      }
    } else if (row.componentCode === '2') {
      if (row.specialDividendPerShare === null) {
        componentUnavailable = true;
      } else {
        ordinaryDividendPerShare = dividend - row.specialDividendPerShare;
      }
    } else if (
      row.commemorativeDividendPerShare === null
      || row.specialDividendPerShare === null
    ) {
      componentUnavailable = true;
    } else {
      ordinaryDividendPerShare = dividend
        - row.commemorativeDividendPerShare
        - row.specialDividendPerShare;
    }
  } else if (
    (needsCommemorativeComponent && row.commemorativeDividendPerShare === null)
    || (needsSpecialComponent && row.specialDividendPerShare === null)
  ) {
    componentUnavailable = true;
  }

  return {
    event: {
      notifiedDate: row.notifiedDate,
      notifiedTime: row.notifiedTime,
      sourceEligibleDate: notification.sourceEligibleDate,
      referenceNumber: row.referenceNumber,
      corporateActionReferenceNumber: row.corporateActionReferenceNumber,
      kind: row.kindCode === '1' ? 'interim' : 'fiscal_year_end',
      decision: row.decisionCode === '1' ? 'decided' : 'forecast',
      recordDateYearMonth: row.recordDateYearMonth,
      dividendPerShare: dividend,
      ordinaryDividendPerShare,
      commemorativeDividendPerShare: row.commemorativeDividendPerShare,
      specialDividendPerShare: row.specialDividendPerShare,
      recordDate: row.recordDate,
      rightsRecordDate: row.rightsRecordDate,
      exDate: row.exDate,
      paymentDate: row.paymentDate,
    },
    missingDividend: dividend === null,
    componentUnavailable,
    invalid: ordinaryDividendPerShare !== null && ordinaryDividendPerShare < 0,
  };
}

/** Replay eligible J-Quants dividend notifications through their CA reference identity. */
export function replayDividendEvents(
  issuerCode: string,
  sourceRows: readonly DividendEventSourceRow[],
  officialCalendar: readonly DividendAvailabilityCalendarDay[],
  analysisAsOfDate: string,
): DividendEventReplayResult {
  if (!isNormalizedJQuantsIssuerCode(issuerCode)) {
    throw new RangeError('Dividend issuerCode must be a normalized five-digit JPX code.');
  }
  if (!isCanonicalDate(analysisAsOfDate)) {
    throw new RangeError('Dividend analysisAsOfDate must be a valid YYYY-MM-DD date.');
  }

  const eligibleNotifications: EligibleEventNotification[] = [];
  for (const row of sourceRows) {
    if (row.notifiedDate >= analysisAsOfDate) continue;
    const sourceEligibleDate = resolveDividendSourceEligibleDate(
      row.notifiedDate,
      officialCalendar,
    );
    if (sourceEligibleDate === null) {
      return eventResult(
        analysisAsOfDate,
        issuerCode,
        null,
        null,
        [{ scope: 'event', reason: 'availability_calendar_unavailable' }],
      );
    }
    if (sourceEligibleDate <= analysisAsOfDate) {
      eligibleNotifications.push({ row, sourceEligibleDate });
    }
  }

  if (eligibleNotifications.length === 0) {
    return eventResult(
      analysisAsOfDate,
      issuerCode,
      null,
      null,
      [{ scope: 'event', reason: 'no_eligible_dividend_event_data' }],
    );
  }

  const ordered = [...eligibleNotifications].sort(
    (left, right) => eventNotificationOrder(left.row, right.row),
  );
  const dataDate = ordered.at(-1)?.row.notifiedDate ?? null;
  if (!ordered.every(({ row }) => hasValidEventMetadata(row, issuerCode))) {
    return eventResult(
      analysisAsOfDate,
      issuerCode,
      dataDate,
      null,
      [{ scope: 'event', reason: 'invalid_data' }],
    );
  }

  const states = new Map<string, EligibleEventNotification>();
  const seenReferences = new Set<string>();
  for (const notification of ordered) {
    const { row } = notification;
    if (seenReferences.has(row.referenceNumber)) {
      return eventResult(
        analysisAsOfDate,
        issuerCode,
        dataDate,
        null,
        [{ scope: 'event', reason: 'invalid_data' }],
      );
    }
    seenReferences.add(row.referenceNumber);

    const target = row.corporateActionReferenceNumber;
    if (row.statusCode === '1') {
      if (states.has(target)) {
        return eventResult(
          analysisAsOfDate,
          issuerCode,
          dataDate,
          null,
          [{ scope: 'event', reason: 'invalid_data' }],
        );
      }
      states.set(target, notification);
    } else if (!states.has(target)) {
      return eventResult(
        analysisAsOfDate,
        issuerCode,
        dataDate,
        null,
        [{ scope: 'event', reason: 'invalid_data' }],
      );
    } else if (row.statusCode === '2') {
      states.set(target, notification);
    } else {
      states.delete(target);
    }
  }

  const finalNotifications = [...states.values()].sort(
    (left, right) => eventNotificationOrder(left.row, right.row),
  );
  if (!finalNotifications.every(({ row }) => areValidEventAmounts(row))) {
    return eventResult(
      analysisAsOfDate,
      issuerCode,
      dataDate,
      null,
      [{ scope: 'event', reason: 'invalid_data' }],
    );
  }

  const mapped = finalNotifications.map(mapDividendEvent);
  if (mapped.some((item) => item.invalid)) {
    return eventResult(
      analysisAsOfDate,
      issuerCode,
      dataDate,
      null,
      [{ scope: 'event', reason: 'invalid_data' }],
    );
  }

  const unavailable: UnavailableDividendEvent[] = [];
  if (mapped.some((item) => item.missingDividend)) {
    unavailable.push({ scope: 'event', reason: 'missing_data' });
  }
  if (mapped.some((item) => item.componentUnavailable)) {
    unavailable.push({ scope: 'component', reason: 'component_breakdown_unavailable' });
  }

  return eventResult(
    analysisAsOfDate,
    issuerCode,
    dataDate,
    mapped.map((item) => item.event),
    unavailable,
  );
}

/** Combine the independently calculated fiscal and optional event results. */
export function buildAdvancedDividendResult(
  fiscal: DividendFiscalResult,
  event: DividendEventReplayResult | DividendEventSourcePlanUnavailable,
  collectedAt: string,
): AdvancedDividendResult {
  const collectedDate = new Date(collectedAt);
  if (!collectedAt.endsWith('Z') || Number.isNaN(collectedDate.getTime())) {
    throw new RangeError('Advanced dividend collectedAt must be a UTC ISO 8601 timestamp.');
  }
  if ('analysisAsOfDate' in event && (
    event.analysisAsOfDate !== fiscal.analysisAsOfDate
    || event.issuerCode !== fiscal.issuerCode
  )) {
    throw new RangeError('Dividend fiscal and event results must share one analysis identity.');
  }

  const eventDataDate = 'dataDate' in event ? event.dataDate : null;
  const dataDate = [fiscal.dataDate, eventDataDate]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const eventUnavailable: readonly UnavailableAdvancedDividend[] = 'analysisAsOfDate' in event
    ? event.unavailable
    : [{ scope: 'event', reason: event.reason }];

  return {
    analysisAsOfDate: fiscal.analysisAsOfDate,
    collectedAt,
    issuerCode: fiscal.issuerCode,
    dataDate,
    observations: [...fiscal.observations],
    events: 'analysisAsOfDate' in event
      ? event.events === null ? null : [...event.events]
      : null,
    unavailable: [...fiscal.unavailable, ...eventUnavailable],
    provenance: {
      financialSummary: fiscal.provenance.financialSummary,
      dividendEvents: 'analysisAsOfDate' in event
        ? event.provenance.dividendEvents
        : null,
      availabilityCalendar: fiscal.provenance.availabilityCalendar,
      calculation: fiscal.provenance.calculation,
    },
    units: {
      dividendPerShare: 'JPY_per_share',
      payoutRatio: 'ratio',
    },
  };
}
