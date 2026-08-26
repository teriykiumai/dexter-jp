import {
  calculateMarketCorrelation,
  type MarketCorrelationWindowResult,
  type MarketPricePoint,
} from './market-correlation-engine.js';
import {
  SECTOR_INDEX_CODE_BY_S33,
  type SectorIndexSourceResult,
  type SectorIndexSourceUnavailableReason,
} from './sector-index.js';

export type SectorBenchmarkUnavailableReason =
  | SectorIndexSourceUnavailableReason
  | 'invalid_data';

export interface SectorBenchmarkIdentity {
  readonly type: 'TSE33_SECTOR_PRICE_INDEX';
  readonly sectorCode: string;
  readonly sectorName: string;
  readonly indexCode: string;
  readonly classificationDate: string;
}

export interface UnavailableSectorBenchmark {
  readonly reason: SectorBenchmarkUnavailableReason;
}

export interface SectorBenchmarkResult {
  readonly analysisAsOfDate: string;
  readonly benchmark: SectorBenchmarkIdentity | null;
  readonly dataDate: string | null;
  readonly alignedPriceCount: number;
  readonly windows: readonly MarketCorrelationWindowResult[];
  readonly unavailable: readonly UnavailableSectorBenchmark[];
  readonly provenance: {
    readonly classification: {
      readonly source: 'jquants';
      readonly endpoint: '/v2/equities/master';
    };
    readonly index: {
      readonly source: 'jquants';
      readonly endpoint: '/v2/indices/bars/daily';
    };
    readonly calculation: {
      readonly source: 'market_correlation_engine';
    };
  };
  readonly units: {
    readonly indexLevel: 'index_points';
    readonly observations: 'count';
    readonly correlation: 'ratio';
    readonly beta: 'ratio';
    readonly alphaAnnualized: 'ratio';
    readonly rSquared: 'ratio';
    readonly stockVolatilityAnnualized: 'ratio';
    readonly benchmarkVolatilityAnnualized: 'ratio';
    readonly excessReturn: 'ratio';
  };
}

export interface UnavailableSectorBenchmarkInput {
  readonly analysisAsOfDate: string;
  readonly reason: SectorIndexSourceUnavailableReason;
}

export type SectorBenchmarkInput =
  | SectorIndexSourceResult
  | UnavailableSectorBenchmarkInput;

const PROVENANCE: SectorBenchmarkResult['provenance'] = {
  classification: {
    source: 'jquants',
    endpoint: '/v2/equities/master',
  },
  index: {
    source: 'jquants',
    endpoint: '/v2/indices/bars/daily',
  },
  calculation: { source: 'market_correlation_engine' },
};

const UNITS: SectorBenchmarkResult['units'] = {
  indexLevel: 'index_points',
  observations: 'count',
  correlation: 'ratio',
  beta: 'ratio',
  alphaAnnualized: 'ratio',
  rSquared: 'ratio',
  stockVolatilityAnnualized: 'ratio',
  benchmarkVolatilityAnnualized: 'ratio',
  excessReturn: 'ratio',
};

const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalDate(value: string): boolean {
  if (!CANONICAL_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isStrictlyChronological(points: readonly { date: string }[]): boolean {
  return points.every((point, index) => (
    isCanonicalDate(point.date)
    && (index === 0 || point.date > points[index - 1].date)
  ));
}

function unavailableResult(
  analysisAsOfDate: string,
  reason: SectorBenchmarkUnavailableReason,
  benchmark: SectorBenchmarkIdentity | null = null,
): SectorBenchmarkResult {
  return {
    analysisAsOfDate,
    benchmark,
    dataDate: null,
    alignedPriceCount: 0,
    windows: [],
    unavailable: [{ reason }],
    provenance: PROVENANCE,
    units: UNITS,
  };
}

function isUnavailableInput(
  input: SectorBenchmarkInput,
): input is UnavailableSectorBenchmarkInput {
  return 'reason' in input;
}

function benchmarkIdentity(
  source: SectorIndexSourceResult,
): SectorBenchmarkIdentity | null {
  const { classification } = source;
  const expectedIndexCode = (
    SECTOR_INDEX_CODE_BY_S33 as Readonly<Record<string, string>>
  )[classification.sectorCode];
  if (
    !isCanonicalDate(source.analysisAsOfDate)
    || !isCanonicalDate(classification.classificationDate)
    || classification.classificationDate > source.analysisAsOfDate
    || classification.sectorName.length === 0
    || expectedIndexCode === undefined
    || classification.indexCode !== expectedIndexCode
  ) {
    return null;
  }

  return {
    type: 'TSE33_SECTOR_PRICE_INDEX',
    sectorCode: classification.sectorCode,
    sectorName: classification.sectorName,
    indexCode: classification.indexCode,
    classificationDate: classification.classificationDate,
  };
}

/** Compare adjusted stock closes with the single sector index resolved at the as-of date. */
export function analyzeSectorBenchmark(
  stockPrices: readonly MarketPricePoint[],
  input: SectorBenchmarkInput,
): SectorBenchmarkResult {
  if (isUnavailableInput(input)) {
    return unavailableResult(input.analysisAsOfDate, input.reason);
  }

  const benchmark = benchmarkIdentity(input);
  if (benchmark === null) {
    return unavailableResult(input.analysisAsOfDate, 'invalid_data');
  }

  // Exclude future observations before validating identity and chronological order.
  const eligibleStockPrices = stockPrices.filter(
    (point) => point.date <= input.analysisAsOfDate,
  );
  const eligibleSectorPrices = input.prices.filter(
    (point) => point.date <= input.analysisAsOfDate,
  );
  if (eligibleSectorPrices.length === 0) {
    return unavailableResult(
      input.analysisAsOfDate,
      'no_sector_index_data',
      benchmark,
    );
  }
  if (eligibleSectorPrices.some((point) => point.indexCode !== benchmark.indexCode)) {
    return unavailableResult(input.analysisAsOfDate, 'invalid_data', benchmark);
  }
  if (
    !isStrictlyChronological(eligibleStockPrices)
    || !isStrictlyChronological(eligibleSectorPrices)
  ) {
    return unavailableResult(input.analysisAsOfDate, 'invalid_data', benchmark);
  }

  const calculation = calculateMarketCorrelation(
    eligibleStockPrices,
    eligibleSectorPrices.map((point) => ({
      date: point.date,
      close: point.close,
    })),
  );
  return {
    analysisAsOfDate: input.analysisAsOfDate,
    benchmark,
    ...calculation,
    unavailable: [],
    provenance: PROVENANCE,
    units: UNITS,
  };
}
