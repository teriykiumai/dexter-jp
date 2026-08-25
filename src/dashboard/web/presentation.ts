import type {
  AnalysisSnapshot,
  AnalysisSnapshotLatestItem,
  MetricUnit,
  SnapshotUnavailable,
} from '../../analysis/snapshot/index.js';

export const UNAVAILABLE_TEXT = '利用不可' as const;

export interface DisplayValue {
  text: string;
  available: boolean;
}

export interface DashboardMetric {
  label: string;
  value: DisplayValue;
  note?: string;
}

export interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface ChartPriceLine {
  label: string;
  price: number;
  color: string;
}

export interface PeerMetricRow {
  label: string;
  target: DisplayValue;
  median: DisplayValue;
  rank: DisplayValue;
  percentile: DisplayValue;
}

export interface CorrelationWindowView {
  period: number;
  observations: DisplayValue;
  correlation: DisplayValue;
  beta: DisplayValue;
  alpha: DisplayValue;
  rSquared: DisplayValue;
  unavailableReasons: string[];
}

export interface StrategyCandidateView {
  entry: DisplayValue;
  stop: DisplayValue;
  target: DisplayValue;
  rewardRisk: DisplayValue;
}

export interface DashboardViewModel {
  header: {
    ticker: string;
    companyName: string;
    generatedAt: string;
    status: 'complete' | 'partial';
  };
  kpis: DashboardMetric[];
  chart: {
    bars: ChartBar[];
    priceLines: ChartPriceLine[];
  };
  peer: {
    rows: PeerMetricRow[];
    marketCapPriority: DisplayValue;
    marketCapPriorityReason: string | null;
  } | null;
  supplyDemand: DashboardMetric[] | null;
  correlations: CorrelationWindowView[] | null;
  strategy: {
    trigger: DisplayValue;
    exactEntry: DisplayValue;
    candidates: StrategyCandidateView[];
    unavailableReasons: string[];
  } | null;
  advancedTechnical: {
    metrics: DashboardMetric[];
    unavailableReasons: string[];
  } | null;
  dataDates: DashboardMetric[];
  scenarios: AnalysisSnapshot['scenarios'];
  risks: AnalysisSnapshot['risks'];
  unavailable: SnapshotUnavailable[];
  finalReportMarkdown: string;
}

export const WATCHLIST_STALE_AFTER_DAYS = 7;

export interface WatchlistItemView {
  ticker: string;
  companyName: string;
  status: AnalysisSnapshot['status'];
  price: DisplayValue;
  per: DisplayValue;
  pbr: DisplayValue;
  roe: DisplayValue;
  trend: DisplayValue;
  marginPercentile: DisplayValue;
  beta250: DisplayValue;
  latestDataDate: DisplayValue;
  latestDataDateRaw: string | null;
  generatedAt: DisplayValue;
  generatedAtRaw: string;
  stale: boolean;
}

export type WatchlistSortKey = 'latestDataDate' | 'generatedAt';

interface FormatOptions {
  ratioAsPercent?: boolean;
  maximumFractionDigits?: number;
}

const numberFormatter = (maximumFractionDigits: number) => new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits,
  minimumFractionDigits: 0,
});

export function formatMetric(
  value: number | null | undefined,
  unit: MetricUnit | 'index' | null | undefined,
  options: FormatOptions = {},
): DisplayValue {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { text: UNAVAILABLE_TEXT, available: false };
  }

  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  if (unit === 'ratio' && options.ratioAsPercent) {
    return {
      text: `${numberFormatter(maximumFractionDigits).format(value * 100)}%`,
      available: true,
    };
  }

  const formatted = numberFormatter(
    unit === 'shares' ? 0 : maximumFractionDigits,
  ).format(value);
  const text = (() => {
    switch (unit) {
      case 'JPY': return `¥${formatted}`;
      case 'shares': return `${formatted} 株`;
      case 'percent': return `${formatted}%`;
      case 'multiple': return `${formatted}x`;
      case 'days': return `${formatted} 日`;
      case 'count':
      case 'ratio':
      default: return formatted;
    }
  })();

  return { text, available: true };
}

export function displayText(value: string | null | undefined): DisplayValue {
  return value
    ? { text: value, available: true }
    : { text: UNAVAILABLE_TEXT, available: false };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

function rankValue(rank: number | null, cohortSize: number): DisplayValue {
  if (rank === null) return { text: UNAVAILABLE_TEXT, available: false };
  return {
    text: `${numberFormatter(2).format(rank)} / ${numberFormatter(0).format(cohortSize)}`,
    available: true,
  };
}

const peerLabels = {
  per: 'PER',
  pbr: 'PBR',
  roe: 'ROE',
  roic: 'ROIC',
  operatingMargin: '営業利益率',
  revenueGrowth: '売上成長率',
  dividendYield: '配当利回り',
} as const;

const dataDateLabels = {
  identity: '企業情報',
  fundamental: '財務情報',
  valuationPrice: '株価',
  valuationFinancial: 'バリュエーション財務',
  peerComparison: 'Peer比較',
  technical: 'テクニカル',
  advancedTechnical: 'Advanced Technical',
  supplyDemand: '需給',
  marketCorrelation: '市場相関',
  strategy: 'Strategy',
  priceHistory: '価格履歴',
} as const;

function reasonText(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function isStaleDataDate(
  dataDate: string | null,
  referenceDate: Date,
  staleAfterDays = WATCHLIST_STALE_AFTER_DAYS,
): boolean {
  if (dataDate === null) return false;
  const dataTime = Date.parse(`${dataDate}T00:00:00.000Z`);
  if (Number.isNaN(dataTime)) return false;
  const referenceDay = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  return referenceDay - dataTime > staleAfterDays * 24 * 60 * 60 * 1000;
}

export function mapLatestAnalysisToWatchlistItem(
  item: AnalysisSnapshotLatestItem,
  referenceDate = new Date(),
): WatchlistItemView {
  return {
    ticker: item.canonicalTicker,
    companyName: item.companyName,
    status: item.status,
    price: formatMetric(item.metrics.latestPrice, item.units.latestPrice),
    per: formatMetric(item.metrics.per, item.units.per),
    pbr: formatMetric(item.metrics.pbr, item.units.pbr),
    roe: formatMetric(item.metrics.roe, item.units.roe, {
      ratioAsPercent: true,
    }),
    trend: displayText(item.metrics.trend === 'unavailable'
      ? null
      : item.metrics.trend),
    marginPercentile: formatMetric(
      item.metrics.marginPercentile,
      item.units.marginPercentile,
      { ratioAsPercent: true },
    ),
    beta250: formatMetric(item.metrics.beta250, item.units.beta250, {
      maximumFractionDigits: 3,
    }),
    latestDataDate: displayText(item.latestSourceDataDate),
    latestDataDateRaw: item.latestSourceDataDate,
    generatedAt: displayText(formatDateTime(item.generatedAt)),
    generatedAtRaw: item.generatedAt,
    stale: isStaleDataDate(item.latestSourceDataDate, referenceDate),
  };
}

export function sortWatchlistItems(
  items: WatchlistItemView[],
  sortKey: WatchlistSortKey,
): WatchlistItemView[] {
  return [...items].sort((left, right) => {
    const leftValue = sortKey === 'generatedAt'
      ? left.generatedAtRaw
      : left.latestDataDateRaw;
    const rightValue = sortKey === 'generatedAt'
      ? right.generatedAtRaw
      : right.latestDataDateRaw;
    if (leftValue === null && rightValue !== null) return 1;
    if (rightValue === null && leftValue !== null) return -1;
    const byDate = (rightValue ?? '').localeCompare(leftValue ?? '');
    return byDate !== 0 ? byDate : left.ticker.localeCompare(right.ticker);
  });
}

export function buildDetailPath(ticker: string): string {
  return `/?ticker=${encodeURIComponent(ticker)}`;
}

export function parseDetailTicker(search: string): string | null {
  const ticker = new URLSearchParams(search).get('ticker');
  return ticker && /^(?:\d{4}|\d{3}[A-Z])$/.test(ticker) ? ticker : null;
}

export function mapSnapshotToDashboard(snapshot: AnalysisSnapshot): DashboardViewModel {
  const latestFundamental = snapshot.fundamental?.periods.at(-1);
  const valuationUnits = snapshot.units.valuation;
  const technicalUnits = snapshot.units.technical;
  const peerUnits = snapshot.units.peerComparison;
  const supplyUnits = snapshot.units.supplyDemand;
  const correlationUnits = snapshot.units.marketCorrelation;
  const strategyUnits = snapshot.units.strategy;
  const advancedTechnical = snapshot.schemaVersion !== 1
    ? snapshot.advancedTechnical
    : null;
  const advancedUnits = snapshot.schemaVersion !== 1
    ? snapshot.units.advancedTechnical
    : null;

  const bars = (snapshot.priceHistory ?? []).flatMap(bar => (
    bar.open === null || bar.high === null || bar.low === null || bar.close === null
      ? []
      : [{
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? null,
      }]
  ));

  const priceLines: ChartPriceLine[] = [];
  if (snapshot.technical?.ma20 !== null && snapshot.technical?.ma20 !== undefined) {
    priceLines.push({ label: 'SMA 20', price: snapshot.technical.ma20, color: '#5aa9ff' });
  }
  if (
    snapshot.technical?.latestSwingHigh !== null
    && snapshot.technical?.latestSwingHigh !== undefined
  ) {
    priceLines.push({
      label: 'Swing High',
      price: snapshot.technical.latestSwingHigh,
      color: '#f0b35a',
    });
  }
  if (
    snapshot.technical?.latestSwingLow !== null
    && snapshot.technical?.latestSwingLow !== undefined
  ) {
    priceLines.push({
      label: 'Swing Low',
      price: snapshot.technical.latestSwingLow,
      color: '#b478ff',
    });
  }

  const peer = snapshot.peerComparison;
  const peerView = peer ? {
    rows: Object.entries(peer.result.positions).map(([key, position]) => {
      const metric = key as keyof typeof peerLabels;
      return {
        label: peerLabels[metric],
        target: formatMetric(position.targetValue, peerUnits[metric]),
        median: formatMetric(position.median, peerUnits[metric]),
        rank: rankValue(position.rank, position.cohortSize),
        percentile: formatMetric(position.percentile, 'ratio', { ratioAsPercent: true }),
      };
    }),
    marketCapPriority: peer.marketCapPriorityApplied
      ? { text: '適用済み', available: true }
      : { text: '未適用', available: false },
    marketCapPriorityReason: peer.marketCapPriorityUnavailableReason
      ? reasonText(peer.marketCapPriorityUnavailableReason)
      : null,
  } : null;

  const supply = snapshot.supplyDemand;
  const supplyDemand = supply ? [
    { label: '買残', value: formatMetric(supply.buyingBalance, supplyUnits.buyingBalance) },
    ...('mean4w' in supply ? [{
      label: '買残4週平均',
      value: formatMetric(supply.mean4w, supplyUnits.mean4w),
    }] : []),
    { label: '売残', value: formatMetric(supply.sellingBalance, supplyUnits.sellingBalance) },
    { label: '信用倍率', value: formatMetric(supply.marginRatio, supplyUnits.marginRatio) },
    {
      label: '52週Percentile',
      value: formatMetric(supply.percentile52w, supplyUnits.percentile52w, {
        ratioAsPercent: true,
      }),
    },
    {
      label: '消化日数',
      value: formatMetric(supply.digestionDays, supplyUnits.digestionDays),
    },
  ] : null;

  const correlations = snapshot.marketCorrelation?.windows.map(window => ({
    period: window.period,
    observations: formatMetric(window.observations, correlationUnits.observations),
    correlation: formatMetric(window.correlation, correlationUnits.correlation, {
      maximumFractionDigits: 3,
    }),
    beta: formatMetric(window.beta, correlationUnits.beta, { maximumFractionDigits: 3 }),
    alpha: formatMetric(window.alphaAnnualized, correlationUnits.alphaAnnualized, {
      ratioAsPercent: true,
    }),
    rSquared: formatMetric(window.rSquared, correlationUnits.rSquared, {
      maximumFractionDigits: 3,
    }),
    unavailableReasons: window.unavailable.map(item => (
      `${item.metric}: ${reasonText(item.reason)}`
    )),
  })) ?? null;

  const strategy = snapshot.strategy;
  const strategyView = strategy ? {
    trigger: strategy.entry
      ? {
        text: `> ${formatMetric(strategy.entry.triggerPrice, strategyUnits.triggerPrice).text}`,
        available: true,
      }
      : { text: UNAVAILABLE_TEXT, available: false },
    exactEntry: strategy.entry?.price === null || strategy.entry?.price === undefined
      ? { text: UNAVAILABLE_TEXT, available: false }
      : formatMetric(strategy.entry.price, strategyUnits.price),
    candidates: strategy.candidates.map(candidate => ({
      entry: formatMetric(candidate.entry.price, strategyUnits.price),
      stop: formatMetric(candidate.stop.price, strategyUnits.price),
      target: formatMetric(candidate.target.price, strategyUnits.price),
      rewardRisk: formatMetric(candidate.rewardRisk, strategyUnits.rewardRisk),
    })),
    unavailableReasons: strategy.unavailable.map(item => (
      `${item.candidate}: ${reasonText(item.reason)}`
    )),
  } : null;

  const advancedTechnicalView = advancedTechnical && advancedUnits ? {
    metrics: [
      { label: 'RSI 14', value: formatMetric(advancedTechnical.rsi14, advancedUnits.rsi14) },
      {
        label: 'MACD',
        value: formatMetric(advancedTechnical.macd?.value, advancedUnits['macd.value']),
      },
      {
        label: 'MACD Signal',
        value: formatMetric(advancedTechnical.macd?.signal, advancedUnits['macd.signal']),
      },
      {
        label: 'MACD Histogram',
        value: formatMetric(
          advancedTechnical.macd?.histogram,
          advancedUnits['macd.histogram'],
        ),
      },
      {
        label: 'Bollinger Middle',
        value: formatMetric(
          advancedTechnical.bollinger20?.middle,
          advancedUnits['bollinger20.middle'],
        ),
      },
      {
        label: 'Bollinger Upper',
        value: formatMetric(
          advancedTechnical.bollinger20?.upper,
          advancedUnits['bollinger20.upper'],
        ),
      },
      {
        label: 'Bollinger Lower',
        value: formatMetric(
          advancedTechnical.bollinger20?.lower,
          advancedUnits['bollinger20.lower'],
        ),
      },
    ],
    unavailableReasons: advancedTechnical.unavailable.map(item => (
      `${item.metric}: ${reasonText(item.reason)}`
    )),
  } : null;

  const dates = snapshot.dataDates;
  const dateEntries: Array<[keyof typeof dataDateLabels, string | null]> = [
    ['identity', dates.identity],
    ['fundamental', dates.fundamental],
    ['valuationPrice', dates.valuation.price],
    ['valuationFinancial', dates.valuation.financial],
    ['peerComparison', dates.peerComparison],
    ['technical', dates.technical],
    ['supplyDemand', dates.supplyDemand],
    ['marketCorrelation', dates.marketCorrelation],
    ['strategy', dates.strategy],
    ['priceHistory', dates.priceHistory],
  ];
  if (snapshot.schemaVersion !== 1) {
    dateEntries.push(['advancedTechnical', snapshot.dataDates.advancedTechnical]);
  }

  return {
    header: {
      ticker: snapshot.canonicalTicker,
      companyName: snapshot.companyName,
      generatedAt: formatDateTime(snapshot.generatedAt),
      status: snapshot.status,
    },
    kpis: [
      {
        label: 'Price',
        value: formatMetric(snapshot.valuation?.currentPrice, valuationUnits.currentPrice),
      },
      { label: 'PER', value: formatMetric(snapshot.valuation?.per, valuationUnits.per) },
      { label: 'PBR', value: formatMetric(snapshot.valuation?.pbr, valuationUnits.pbr) },
      {
        label: 'ROE',
        value: formatMetric(latestFundamental?.roe, snapshot.units.fundamental.roe, {
          ratioAsPercent: true,
        }),
      },
      {
        label: 'Trend',
        value: displayText(snapshot.technical?.trend === 'unavailable'
          ? null
          : snapshot.technical?.trend),
      },
    ],
    chart: { bars, priceLines },
    peer: peerView,
    supplyDemand,
    correlations,
    strategy: strategyView,
    advancedTechnical: advancedTechnicalView,
    dataDates: dateEntries.map(([key, value]) => ({
      label: dataDateLabels[key],
      value: displayText(value),
    })),
    scenarios: snapshot.scenarios,
    risks: snapshot.risks,
    unavailable: snapshot.unavailable,
    finalReportMarkdown: snapshot.finalReportMarkdown,
  };
}
