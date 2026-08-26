import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import type {
  SectorShortRatioClassification,
  SectorShortRatioSource,
  SectorShortRatioSourceUnavailableReason,
  SectorShortRatioSourceRow,
} from './sector-short-ratio.js';

export type SectorShortRatioUnavailableReason =
  | SectorShortRatioSourceUnavailableReason
  | 'invalid_data';

export type SectorShortRatioObservationUnavailableReason =
  | 'missing_data'
  | 'invalid_data'
  | 'zero_total_selling_value';

export interface SectorShortRatioObservation {
  readonly date: string;
  readonly nonShortSellingValue: number | null;
  readonly restrictedShortSellingValue: number | null;
  readonly unrestrictedShortSellingValue: number | null;
  readonly shortSellingValue: number | null;
  readonly totalSellingValue: number | null;
  readonly shortSellingRatio: number | null;
  readonly unavailable: readonly {
    reason: SectorShortRatioObservationUnavailableReason;
  }[];
}

export interface SectorShortRatioResult {
  readonly analysisAsOfDate: string;
  readonly issuerCode: string;
  readonly sector: SectorShortRatioClassification | null;
  readonly dataDate: string | null;
  readonly observations: readonly SectorShortRatioObservation[];
  readonly unavailable: readonly { reason: SectorShortRatioUnavailableReason }[];
  readonly provenance: {
    readonly classification: {
      readonly source: 'jquants';
      readonly endpoint: '/v2/equities/master';
    } | null;
    readonly flow: {
      readonly source: 'jquants';
      readonly endpoint: '/v2/markets/short-ratio';
    } | null;
    readonly calculation: { readonly source: 'sector_short_ratio_engine' };
  };
  readonly units: {
    readonly nonShortSellingValue: 'JPY';
    readonly restrictedShortSellingValue: 'JPY';
    readonly unrestrictedShortSellingValue: 'JPY';
    readonly shortSellingValue: 'JPY';
    readonly totalSellingValue: 'JPY';
    readonly shortSellingRatio: 'ratio';
  };
}

const UNITS = {
  nonShortSellingValue: 'JPY',
  restrictedShortSellingValue: 'JPY',
  unrestrictedShortSellingValue: 'JPY',
  shortSellingValue: 'JPY',
  totalSellingValue: 'JPY',
  shortSellingRatio: 'ratio',
} as const;

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function unavailableResult(
  source: SectorShortRatioSource,
  reason: SectorShortRatioUnavailableReason,
): SectorShortRatioResult {
  return {
    analysisAsOfDate: source.analysisAsOfDate,
    issuerCode: source.issuerCode,
    sector: source.classification,
    dataDate: null,
    observations: [],
    unavailable: [{ reason }],
    provenance: {
      classification: source.provenance.classification,
      flow: source.provenance.flow,
      calculation: { source: 'sector_short_ratio_engine' },
    },
    units: UNITS,
  };
}

function calculateObservation(row: SectorShortRatioSourceRow): SectorShortRatioObservation {
  const observation = {
    date: row.date,
    nonShortSellingValue: row.nonShortSellingValue,
    restrictedShortSellingValue: row.restrictedShortSellingValue,
    unrestrictedShortSellingValue: row.unrestrictedShortSellingValue,
  };
  const values = [
    row.nonShortSellingValue,
    row.restrictedShortSellingValue,
    row.unrestrictedShortSellingValue,
  ];
  if (values.some(value => value === null)) {
    return {
      ...observation,
      shortSellingValue: null,
      totalSellingValue: null,
      shortSellingRatio: null,
      unavailable: [{ reason: 'missing_data' }],
    };
  }
  if (values.some(value => !Number.isFinite(value) || (value as number) < 0)) {
    return {
      ...observation,
      shortSellingValue: null,
      totalSellingValue: null,
      shortSellingRatio: null,
      unavailable: [{ reason: 'invalid_data' }],
    };
  }

  const [nonShortSellingValue, restrictedShortSellingValue, unrestrictedShortSellingValue] = (
    values as [number, number, number]
  );
  const shortSellingValue = restrictedShortSellingValue + unrestrictedShortSellingValue;
  const totalSellingValue = nonShortSellingValue + shortSellingValue;
  if (totalSellingValue === 0) {
    return {
      ...observation,
      shortSellingValue,
      totalSellingValue,
      shortSellingRatio: null,
      unavailable: [{ reason: 'zero_total_selling_value' }],
    };
  }
  return {
    ...observation,
    shortSellingValue,
    totalSellingValue,
    shortSellingRatio: shortSellingValue / totalSellingValue,
    unavailable: [],
  };
}

/** Calculate only source-defined daily sector short-selling totals and ratios. */
export function analyzeSectorShortRatio(source: SectorShortRatioSource): SectorShortRatioResult {
  if ('reason' in source) return unavailableResult(source, source.reason);
  let normalizedIssuerCode: string;
  try {
    normalizedIssuerCode = toJQuantsSecuritiesCode(source.issuerCode);
  } catch {
    return unavailableResult(source, 'invalid_data');
  }
  if (
    normalizedIssuerCode !== source.issuerCode
    || !isCanonicalDate(source.analysisAsOfDate)
    || !isCanonicalDate(source.classification.classificationDate)
    || source.classification.classificationDate > source.analysisAsOfDate
  ) {
    return unavailableResult(source, 'invalid_data');
  }

  const rows = source.rows
    .filter(row => row.date <= source.analysisAsOfDate)
    .map(row => ({ ...row }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length === 0) return unavailableResult(source, 'no_sector_short_ratio_data');

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      !isCanonicalDate(row.date)
      || row.sectorCode !== source.classification.sectorCode
      || (index > 0 && row.date === rows[index - 1].date)
    ) {
      return unavailableResult(source, 'invalid_data');
    }
  }

  const observations = rows.map(calculateObservation);
  return {
    analysisAsOfDate: source.analysisAsOfDate,
    issuerCode: source.issuerCode,
    sector: source.classification,
    dataDate: observations.at(-1)?.date ?? null,
    observations,
    unavailable: [],
    provenance: {
      classification: source.provenance.classification,
      flow: source.provenance.flow,
      calculation: { source: 'sector_short_ratio_engine' },
    },
    units: UNITS,
  };
}
