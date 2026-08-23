export interface FinancialMetricPoint {
  fiscalYear: number;
  submitDate: string | null;
  revenue: number | null;
  eps: number | null;
  bps: number | null;
  dividendPerShare: number | null;
}

export type FinancialMetric = 'per' | 'pbr' | 'dividendYieldPercent' | 'revenueCagrPercent';

export type FinancialMetricUnavailableReason =
  | 'missing_or_invalid_price'
  | 'insufficient_financial_history'
  | 'missing_or_invalid_eps'
  | 'non_positive_eps'
  | 'missing_or_invalid_bps'
  | 'non_positive_bps'
  | 'missing_or_invalid_dividend'
  | 'missing_or_invalid_revenue'
  | 'non_positive_revenue'
  | 'invalid_fiscal_year_range';

export interface UnavailableFinancialMetric {
  metric: FinancialMetric;
  reason: FinancialMetricUnavailableReason;
}

export interface FinancialMetricsResult {
  priceDataDate: string | null;
  financialDataDate: string | null;
  latestFiscalYear: number | null;
  currentPrice: number | null;
  per: number | null;
  pbr: number | null;
  dividendYieldPercent: number | null;
  revenueCagrPercent: number | null;
  cagrStartFiscalYear: number | null;
  cagrEndFiscalYear: number | null;
  cagrPeriods: number | null;
  unavailable: UnavailableFinancialMetric[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertChronological(financials: readonly FinancialMetricPoint[]): void {
  for (let index = 1; index < financials.length; index += 1) {
    if (financials[index - 1].fiscalYear >= financials[index].fiscalYear) {
      throw new RangeError('Financial history must be strictly chronological by fiscalYear.');
    }
  }
}

/** Calculate current valuation ratios and revenue CAGR without using an LLM. */
export function analyzeFinancialMetrics(
  currentPrice: number | null,
  priceDataDate: string | null,
  financials: readonly FinancialMetricPoint[],
): FinancialMetricsResult {
  assertChronological(financials);

  const unavailable: UnavailableFinancialMetric[] = [];
  const latest = financials.at(-1) ?? null;
  const first = financials[0] ?? null;
  const validPrice = isFiniteNumber(currentPrice) && currentPrice > 0
    ? currentPrice
    : null;

  let per: number | null = null;
  let pbr: number | null = null;
  let dividendYieldPercent: number | null = null;

  if (validPrice === null) {
    for (const metric of ['per', 'pbr', 'dividendYieldPercent'] as const) {
      unavailable.push({ metric, reason: 'missing_or_invalid_price' });
    }
  } else if (latest === null) {
    unavailable.push({ metric: 'per', reason: 'insufficient_financial_history' });
    unavailable.push({ metric: 'pbr', reason: 'insufficient_financial_history' });
    unavailable.push({ metric: 'dividendYieldPercent', reason: 'insufficient_financial_history' });
  } else {
    if (!isFiniteNumber(latest.eps)) {
      unavailable.push({ metric: 'per', reason: 'missing_or_invalid_eps' });
    } else if (latest.eps <= 0) {
      unavailable.push({ metric: 'per', reason: 'non_positive_eps' });
    } else {
      per = validPrice / latest.eps;
    }

    if (!isFiniteNumber(latest.bps)) {
      unavailable.push({ metric: 'pbr', reason: 'missing_or_invalid_bps' });
    } else if (latest.bps <= 0) {
      unavailable.push({ metric: 'pbr', reason: 'non_positive_bps' });
    } else {
      pbr = validPrice / latest.bps;
    }

    if (!isFiniteNumber(latest.dividendPerShare) || latest.dividendPerShare < 0) {
      unavailable.push({
        metric: 'dividendYieldPercent',
        reason: 'missing_or_invalid_dividend',
      });
    } else {
      dividendYieldPercent = latest.dividendPerShare / validPrice * 100;
    }
  }

  let revenueCagrPercent: number | null = null;
  let cagrStartFiscalYear: number | null = null;
  let cagrEndFiscalYear: number | null = null;
  let cagrPeriods: number | null = null;

  if (first === null || latest === null || first === latest) {
    unavailable.push({
      metric: 'revenueCagrPercent',
      reason: 'insufficient_financial_history',
    });
  } else if (!isFiniteNumber(first.revenue) || !isFiniteNumber(latest.revenue)) {
    unavailable.push({ metric: 'revenueCagrPercent', reason: 'missing_or_invalid_revenue' });
  } else if (first.revenue <= 0 || latest.revenue <= 0) {
    unavailable.push({ metric: 'revenueCagrPercent', reason: 'non_positive_revenue' });
  } else {
    const periods = latest.fiscalYear - first.fiscalYear;
    if (!Number.isInteger(periods) || periods <= 0) {
      unavailable.push({ metric: 'revenueCagrPercent', reason: 'invalid_fiscal_year_range' });
    } else {
      revenueCagrPercent = (Math.pow(latest.revenue / first.revenue, 1 / periods) - 1) * 100;
      cagrStartFiscalYear = first.fiscalYear;
      cagrEndFiscalYear = latest.fiscalYear;
      cagrPeriods = periods;
    }
  }

  return {
    priceDataDate,
    financialDataDate: latest?.submitDate ?? null,
    latestFiscalYear: latest?.fiscalYear ?? null,
    currentPrice: validPrice,
    per,
    pbr,
    dividendYieldPercent,
    revenueCagrPercent,
    cagrStartFiscalYear,
    cagrEndFiscalYear,
    cagrPeriods,
    unavailable,
  };
}
