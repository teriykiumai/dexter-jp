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

export interface ReportedShortPositionReportView {
  disclosedDate: DisplayValue;
  calculatedDate: DisplayValue;
  reporterName: DisplayValue;
  discretionaryManagerName: DisplayValue;
  fundName: DisplayValue;
  shortPositionRatio: DisplayValue;
  shortPositionShares: DisplayValue;
  previousCalculatedDate: DisplayValue;
  previousReportedRatio: DisplayValue;
  ratioDelta: DisplayValue;
}

export interface ReportedShortPositionsView {
  state: 'available' | 'unavailable' | 'not_collected';
  reports: ReportedShortPositionReportView[];
  unavailableReasons: string[];
}

export interface InvestorTypeCategoryView {
  category: string;
  sell: DisplayValue;
  buy: DisplayValue;
  total: DisplayValue;
  balance: DisplayValue;
}

export interface InvestorTypeFlowsView {
  state: 'available' | 'unavailable' | 'not_collected';
  section: DisplayValue;
  publishedDate: DisplayValue;
  periodStartDate: DisplayValue;
  periodEndDate: DisplayValue;
  summary: InvestorTypeCategoryView[];
  brokerageBreakdown: InvestorTypeCategoryView[];
  unavailableReasons: string[];
}

export interface SectorBenchmarkWindowView extends CorrelationWindowView {
  stockVolatility: DisplayValue;
  benchmarkVolatility: DisplayValue;
  excessReturn: DisplayValue;
}

export interface SectorBenchmarkView {
  state: 'available' | 'unavailable' | 'not_collected';
  analysisAsOfDate: DisplayValue;
  benchmarkType: DisplayValue;
  sectorCode: DisplayValue;
  sectorName: DisplayValue;
  indexCode: DisplayValue;
  classificationDate: DisplayValue;
  dataDate: DisplayValue;
  alignedPriceCount: DisplayValue;
  windows: SectorBenchmarkWindowView[];
  unavailableReasons: string[];
}

export interface SectorShortRatioObservationView {
  date: DisplayValue;
  nonShortSellingValue: DisplayValue;
  restrictedShortSellingValue: DisplayValue;
  unrestrictedShortSellingValue: DisplayValue;
  shortSellingValue: DisplayValue;
  totalSellingValue: DisplayValue;
  shortSellingRatio: DisplayValue;
  unavailableReasons: string[];
}

export interface SectorShortRatioView {
  state: 'available' | 'unavailable' | 'not_collected';
  analysisAsOfDate: DisplayValue;
  classificationDate: DisplayValue;
  sectorCode: DisplayValue;
  sectorName: DisplayValue;
  dataDate: DisplayValue;
  observations: SectorShortRatioObservationView[];
  unavailableReasons: string[];
}

export interface AdvancedDividendFiscalObservationView {
  kind: string;
  fiscalYearEndDate: DisplayValue;
  disclosedDate: DisplayValue;
  disclosedTime: DisplayValue;
  sourceEligibleDate: DisplayValue;
  disclosureNumber: DisplayValue;
  sourceField: DisplayValue;
  payoutRatioSourceField: DisplayValue;
  annualDividendPerShare: DisplayValue;
  payoutRatio: DisplayValue;
}

export interface AdvancedDividendEventView {
  notifiedDate: DisplayValue;
  notifiedTime: DisplayValue;
  sourceEligibleDate: DisplayValue;
  referenceNumber: DisplayValue;
  corporateActionReferenceNumber: DisplayValue;
  kind: DisplayValue;
  decision: DisplayValue;
  recordDateYearMonth: DisplayValue;
  dividendPerShare: DisplayValue;
  ordinaryDividendPerShare: DisplayValue;
  commemorativeDividendPerShare: DisplayValue;
  specialDividendPerShare: DisplayValue;
  recordDate: DisplayValue;
  rightsRecordDate: DisplayValue;
  exDate: DisplayValue;
  paymentDate: DisplayValue;
}

export interface AdvancedDividendView {
  state: 'available' | 'unavailable' | 'not_collected';
  analysisAsOfDate: DisplayValue;
  dataDate: DisplayValue;
  collectedAt: DisplayValue;
  existingDividendYield: DisplayValue;
  observations: AdvancedDividendFiscalObservationView[];
  events: AdvancedDividendEventView[] | null;
  unavailableReasons: string[];
}

export interface VolumeProfileBinView {
  index: number;
  lowerPrice: DisplayValue;
  upperPrice: DisplayValue;
  representativePrice: DisplayValue;
  allocatedVolume: DisplayValue;
  volumeShare: DisplayValue;
}

export interface VolumeProfileView {
  state: 'available' | 'unavailable' | 'not_collected';
  analysisAsOfDate: DisplayValue;
  collectedAt: DisplayValue;
  dataDate: DisplayValue;
  windowStartDate: DisplayValue;
  windowEndDate: DisplayValue;
  inputBarCount: DisplayValue;
  priceBasis: DisplayValue;
  volumeBasis: DisplayValue;
  allocationMethod: DisplayValue;
  binningMethod: DisplayValue;
  requestedBinCount: DisplayValue;
  effectiveBinCount: DisplayValue;
  minPrice: DisplayValue;
  maxPrice: DisplayValue;
  poc: {
    binIndex: number;
    price: DisplayValue;
    allocatedVolume: DisplayValue;
    volumeShare: DisplayValue;
  } | null;
  valueArea: {
    targetVolumeShare: DisplayValue;
    achievedVolumeShare: DisplayValue;
    val: DisplayValue;
    vah: DisplayValue;
    firstBinIndex: number;
    lastBinIndex: number;
  } | null;
  bins: VolumeProfileBinView[];
  methodology: DisplayValue;
  approximation: DisplayValue;
  corporateActionBasisStatus: DisplayValue;
  unavailableReasons: string[];
}

export const REPORTED_SHORT_POSITION_DISCLOSURE_NOTE =
  'J-Quantsの0.5%以上の公開報告です。未収集・利用不可は、空売り残高0、空売り主体なし、0.5%未満のpositionなし、または買い戻し完了を意味しません。信用売残や市場全体のshort interestとは別データです。';

export const INVESTOR_TYPE_FLOW_CONTEXT_NOTE =
  'Tokyo/Nagoya市場全体の週次market contextです。個別銘柄の売買フローではありません。公表日と売買期間を区別し、Snapshotに保存されたsource categoryと値をそのまま表示します。';

export const SECTOR_BENCHMARK_CONTEXT_NOTE =
  'analysisAsOfDate時点で解決した単一の東証33業種指数を各window全体に使用したhistorical comparisonです。銘柄がlookback期間全体で同じsectorに所属していたことを意味せず、current classificationの過去適用、複数sector indexのstitch、銘柄への業種指数値の帰属、rank・score・signalは行いません。';

export const SECTOR_SHORT_RATIO_CONTEXT_NOTE =
  '東証33業種単位の日次売買代金flowです。個別銘柄のshort position、残高、信用売残ではありません。Snapshotのsource値とdeterministic ratioだけを表示し、業種指数・公開空売り残高報告・信用残との合算、forward fill、threshold・squeeze・Buy/Sell signalは行いません。';

export const ADVANCED_DIVIDEND_CONTEXT_NOTE =
  'Snapshotに保存された年間1株配当、source-provided配当性向、event-level配当内訳をそのまま表示します。金額（JPY/株）、配当性向、既存のdeterministic配当利回りは別指標です。actualとcompany forecast、ordinary・special・commemorativeを区別し、Browserで再計算・年次集計・成長率推定を行いません。';

export const VOLUME_PROFILE_CONTEXT_NOTE =
  '日足の調整後OHLCVを一様レンジ配分した推定出来高価格分布proxyです。実際の価格別約定出来高、現在の保有株数、投資家の取得単価、真のしこり玉やoverhead supplyではありません。Snapshotのbin・POC・Value Areaをそのまま表示し、Browserで再計算せず、support/resistance、Entry/Stop/Target、score、threshold、Buy/Sell signalへ変換しません。';

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
  reportedShortPositions: ReportedShortPositionsView;
  investorTypeFlows: InvestorTypeFlowsView;
  sectorBenchmark: SectorBenchmarkView;
  sectorShortRatio: SectorShortRatioView;
  advancedDividend: AdvancedDividendView;
  volumeProfile: VolumeProfileView;
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
  unit: MetricUnit | 'index' | 'thousand_JPY' | 'index_points' | 'JPY_per_share'
    | 'adjusted_shares' | null | undefined,
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
      case 'JPY_per_share': return `¥${formatted} / 株`;
      case 'thousand_JPY': return `${formatted} 千円`;
      case 'index_points': return `${formatted} points`;
      case 'shares': return `${formatted} 株`;
      case 'adjusted_shares': return `${formatted} 調整後株`;
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

function formatRatioDeltaAsPoints(value: number | null): DisplayValue {
  if (value === null || !Number.isFinite(value)) {
    return { text: UNAVAILABLE_TEXT, available: false };
  }

  const formatted = new Intl.NumberFormat('ja-JP', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(value * 100);
  return { text: `${formatted} pt`, available: true };
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
  reportedShortPositions: '公開空売り残高報告',
  investorTypeFlows: '投資部門別 公表日',
  supplyDemand: '需給',
  marketCorrelation: '市場相関',
  sectorBenchmark: '業種指数比較',
  sectorShortRatio: '業種別空売り比率',
  advancedDividend: 'Advanced Dividend',
  volumeProfile: 'Volume Profile',
  strategy: 'Strategy',
  priceHistory: '価格履歴',
} as const;

function reasonText(reason: string): string {
  return reason.replaceAll('_', ' ');
}

function investorTypeCategoryView(
  category: string,
  value: { sell: number; buy: number; total: number; balance: number },
  units: Record<string, MetricUnit | 'index' | 'thousand_JPY'>,
): InvestorTypeCategoryView {
  return {
    category,
    sell: formatMetric(value.sell, units.sell),
    buy: formatMetric(value.buy, units.buy),
    total: formatMetric(value.total, units.total),
    balance: formatMetric(value.balance, units.balance),
  };
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
  const reportedShortPositions = 'reportedShortPositions' in snapshot
    ? snapshot.reportedShortPositions
    : null;
  const reportedShortPositionUnits = 'reportedShortPositions' in snapshot.units
    ? snapshot.units.reportedShortPositions
    : null;
  const investorTypeFlows = 'investorTypeFlows' in snapshot
    ? snapshot.investorTypeFlows
    : null;
  const investorTypeFlowUnits = 'investorTypeFlows' in snapshot.units
    ? snapshot.units.investorTypeFlows
    : null;
  const sectorBenchmark = 'sectorBenchmark' in snapshot
    ? snapshot.sectorBenchmark
    : null;
  const sectorBenchmarkUnits = 'sectorBenchmark' in snapshot.units
    ? snapshot.units.sectorBenchmark
    : null;
  const sectorShortRatio = 'sectorShortRatio' in snapshot
    ? snapshot.sectorShortRatio
    : null;
  const sectorShortRatioUnits = 'sectorShortRatio' in snapshot.units
    ? snapshot.units.sectorShortRatio
    : null;
  const advancedDividend = 'advancedDividend' in snapshot
    ? snapshot.advancedDividend
    : null;
  const advancedDividendUnits = 'advancedDividend' in snapshot.units
    ? snapshot.units.advancedDividend
    : null;
  const volumeProfile = 'volumeProfile' in snapshot
    ? snapshot.volumeProfile
    : null;
  const volumeProfileUnits = 'volumeProfile' in snapshot.units
    ? snapshot.units.volumeProfile
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

  const reportedShortPositionsView: ReportedShortPositionsView = {
    state: !('reportedShortPositions' in snapshot) || reportedShortPositions === null
      ? 'not_collected'
      : reportedShortPositions.reports.length > 0
        ? 'available'
        : 'unavailable',
    reports: reportedShortPositions && reportedShortPositionUnits
      ? reportedShortPositions.reports.map(report => ({
          disclosedDate: displayText(report.disclosedDate),
          calculatedDate: displayText(report.calculatedDate),
          reporterName: displayText(report.reporterName),
          discretionaryManagerName: displayText(report.discretionaryManagerName),
          fundName: displayText(report.fundName),
          shortPositionRatio: formatMetric(
            report.shortPositionRatio,
            reportedShortPositionUnits.shortPositionRatio,
            { ratioAsPercent: true },
          ),
          shortPositionShares: formatMetric(
            report.shortPositionShares,
            reportedShortPositionUnits.shortPositionShares,
          ),
          previousCalculatedDate: displayText(report.previousCalculatedDate),
          previousReportedRatio: formatMetric(
            report.previousReportedRatio,
            reportedShortPositionUnits.previousReportedRatio,
            { ratioAsPercent: true },
          ),
          ratioDelta: formatRatioDeltaAsPoints(report.ratioDelta),
        }))
      : [],
    unavailableReasons: reportedShortPositions?.unavailable.map(item => (
      reasonText(item.reason)
    )) ?? [],
  };

  const investorPeriod = investorTypeFlows?.period ?? null;
  const investorTypeFlowsView: InvestorTypeFlowsView = {
    state: !('investorTypeFlows' in snapshot) || investorTypeFlows === null
      ? 'not_collected'
      : investorPeriod === null
        ? 'unavailable'
        : 'available',
    section: displayText(investorTypeFlows?.section),
    publishedDate: displayText(investorPeriod?.publishedDate),
    periodStartDate: displayText(investorPeriod?.periodStartDate),
    periodEndDate: displayText(investorPeriod?.periodEndDate),
    summary: investorPeriod && investorTypeFlowUnits
      ? [
          investorTypeCategoryView(
            'proprietary',
            investorPeriod.summary.proprietary,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'brokerage',
            investorPeriod.summary.brokerage,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'total',
            investorPeriod.summary.total,
            investorTypeFlowUnits,
          ),
        ]
      : [],
    brokerageBreakdown: investorPeriod && investorTypeFlowUnits
      ? [
          investorTypeCategoryView(
            'individuals',
            investorPeriod.brokerageBreakdown.individuals,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'foreignInvestors',
            investorPeriod.brokerageBreakdown.foreignInvestors,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'securitiesCompanies',
            investorPeriod.brokerageBreakdown.securitiesCompanies,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'investmentTrusts',
            investorPeriod.brokerageBreakdown.investmentTrusts,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'businessCorporations',
            investorPeriod.brokerageBreakdown.businessCorporations,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'otherCorporations',
            investorPeriod.brokerageBreakdown.otherCorporations,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'insuranceCompanies',
            investorPeriod.brokerageBreakdown.insuranceCompanies,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'banks',
            investorPeriod.brokerageBreakdown.banks,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'trustBanks',
            investorPeriod.brokerageBreakdown.trustBanks,
            investorTypeFlowUnits,
          ),
          investorTypeCategoryView(
            'otherFinancialInstitutions',
            investorPeriod.brokerageBreakdown.otherFinancialInstitutions,
            investorTypeFlowUnits,
          ),
        ]
      : [],
    unavailableReasons: investorTypeFlows?.unavailable.map(item => (
      reasonText(item.reason)
    )) ?? [],
  };

  const sectorBenchmarkView: SectorBenchmarkView = {
    state: !('sectorBenchmark' in snapshot) || sectorBenchmark === null
      ? 'not_collected'
      : sectorBenchmark.benchmark === null || sectorBenchmark.unavailable.length > 0
        ? 'unavailable'
        : 'available',
    analysisAsOfDate: displayText(sectorBenchmark?.analysisAsOfDate),
    benchmarkType: displayText(sectorBenchmark?.benchmark?.type),
    sectorCode: displayText(sectorBenchmark?.benchmark?.sectorCode),
    sectorName: displayText(sectorBenchmark?.benchmark?.sectorName),
    indexCode: displayText(sectorBenchmark?.benchmark?.indexCode),
    classificationDate: displayText(sectorBenchmark?.benchmark?.classificationDate),
    dataDate: displayText(sectorBenchmark?.dataDate),
    alignedPriceCount: formatMetric(
      sectorBenchmark?.alignedPriceCount,
      sectorBenchmarkUnits?.alignedPriceCount,
    ),
    windows: sectorBenchmark && sectorBenchmarkUnits
      ? sectorBenchmark.windows.map(window => ({
          period: window.period,
          observations: formatMetric(
            window.observations,
            sectorBenchmarkUnits.observations,
          ),
          correlation: formatMetric(
            window.correlation,
            sectorBenchmarkUnits.correlation,
            { maximumFractionDigits: 3 },
          ),
          beta: formatMetric(window.beta, sectorBenchmarkUnits.beta, {
            maximumFractionDigits: 3,
          }),
          alpha: formatMetric(
            window.alphaAnnualized,
            sectorBenchmarkUnits.alphaAnnualized,
            { ratioAsPercent: true },
          ),
          rSquared: formatMetric(window.rSquared, sectorBenchmarkUnits.rSquared, {
            maximumFractionDigits: 3,
          }),
          stockVolatility: formatMetric(
            window.stockVolatilityAnnualized,
            sectorBenchmarkUnits.stockVolatilityAnnualized,
            { ratioAsPercent: true },
          ),
          benchmarkVolatility: formatMetric(
            window.benchmarkVolatilityAnnualized,
            sectorBenchmarkUnits.benchmarkVolatilityAnnualized,
            { ratioAsPercent: true },
          ),
          excessReturn: formatMetric(
            window.excessReturn,
            sectorBenchmarkUnits.excessReturn,
            { ratioAsPercent: true },
          ),
          unavailableReasons: window.unavailable.map(item => (
            `${item.metric}: ${reasonText(item.reason)}`
          )),
        }))
      : [],
    unavailableReasons: sectorBenchmark?.unavailable.map(item => (
      reasonText(item.reason)
    )) ?? [],
  };

  const sectorShortRatioView: SectorShortRatioView = {
    state: !('sectorShortRatio' in snapshot) || sectorShortRatio === null
      ? 'not_collected'
      : sectorShortRatio.observations.length > 0
        ? 'available'
        : 'unavailable',
    analysisAsOfDate: displayText(sectorShortRatio?.analysisAsOfDate),
    classificationDate: displayText(sectorShortRatio?.sector?.classificationDate),
    sectorCode: displayText(sectorShortRatio?.sector?.sectorCode),
    sectorName: displayText(sectorShortRatio?.sector?.sectorName),
    dataDate: displayText(sectorShortRatio?.dataDate),
    observations: sectorShortRatio && sectorShortRatioUnits
      ? sectorShortRatio.observations.slice(-20).reverse().map(observation => ({
          date: displayText(observation.date),
          nonShortSellingValue: formatMetric(
            observation.nonShortSellingValue,
            sectorShortRatioUnits.nonShortSellingValue,
          ),
          restrictedShortSellingValue: formatMetric(
            observation.restrictedShortSellingValue,
            sectorShortRatioUnits.restrictedShortSellingValue,
          ),
          unrestrictedShortSellingValue: formatMetric(
            observation.unrestrictedShortSellingValue,
            sectorShortRatioUnits.unrestrictedShortSellingValue,
          ),
          shortSellingValue: formatMetric(
            observation.shortSellingValue,
            sectorShortRatioUnits.shortSellingValue,
          ),
          totalSellingValue: formatMetric(
            observation.totalSellingValue,
            sectorShortRatioUnits.totalSellingValue,
          ),
          shortSellingRatio: formatMetric(
            observation.shortSellingRatio,
            sectorShortRatioUnits.shortSellingRatio,
            { ratioAsPercent: true },
          ),
          unavailableReasons: observation.unavailable.map(item => reasonText(item.reason)),
        }))
      : [],
    unavailableReasons: sectorShortRatio?.unavailable.map(item => reasonText(item.reason)) ?? [],
  };

  const advancedDividendView: AdvancedDividendView = {
    state: !('advancedDividend' in snapshot) || advancedDividend === null
      ? 'not_collected'
      : advancedDividend.observations.length > 0 || (advancedDividend.events?.length ?? 0) > 0
        ? 'available'
        : 'unavailable',
    analysisAsOfDate: displayText(advancedDividend?.analysisAsOfDate),
    dataDate: displayText(advancedDividend?.dataDate),
    collectedAt: advancedDividend
      ? displayText(formatDateTime(advancedDividend.collectedAt))
      : displayText(null),
    existingDividendYield: formatMetric(
      snapshot.valuation?.dividendYieldPercent,
      valuationUnits.dividendYieldPercent,
    ),
    observations: advancedDividend && advancedDividendUnits
      ? advancedDividend.observations.map(observation => ({
          kind: observation.kind,
          fiscalYearEndDate: displayText(observation.fiscalYearEndDate),
          disclosedDate: displayText(observation.disclosedDate),
          disclosedTime: displayText(observation.disclosedTime),
          sourceEligibleDate: displayText(observation.sourceEligibleDate),
          disclosureNumber: displayText(observation.disclosureNumber),
          sourceField: displayText(observation.sourceField),
          payoutRatioSourceField: displayText(observation.payoutRatioSourceField),
          annualDividendPerShare: formatMetric(
            observation.annualDividendPerShare,
            advancedDividendUnits.dividendPerShare,
          ),
          payoutRatio: formatMetric(
            observation.payoutRatio,
            advancedDividendUnits.payoutRatio,
            { ratioAsPercent: true },
          ),
        }))
      : [],
    events: advancedDividend?.events === null || advancedDividend === null
      ? null
      : advancedDividendUnits
        ? advancedDividend.events.map(event => ({
            notifiedDate: displayText(event.notifiedDate),
            notifiedTime: displayText(event.notifiedTime),
            sourceEligibleDate: displayText(event.sourceEligibleDate),
            referenceNumber: displayText(event.referenceNumber),
            corporateActionReferenceNumber: displayText(
              event.corporateActionReferenceNumber,
            ),
            kind: displayText(event.kind),
            decision: displayText(event.decision),
            recordDateYearMonth: displayText(event.recordDateYearMonth),
            dividendPerShare: formatMetric(
              event.dividendPerShare,
              advancedDividendUnits.dividendPerShare,
            ),
            ordinaryDividendPerShare: formatMetric(
              event.ordinaryDividendPerShare,
              advancedDividendUnits.dividendPerShare,
            ),
            commemorativeDividendPerShare: formatMetric(
              event.commemorativeDividendPerShare,
              advancedDividendUnits.dividendPerShare,
            ),
            specialDividendPerShare: formatMetric(
              event.specialDividendPerShare,
              advancedDividendUnits.dividendPerShare,
            ),
            recordDate: displayText(event.recordDate),
            rightsRecordDate: displayText(event.rightsRecordDate),
            exDate: displayText(event.exDate),
            paymentDate: displayText(event.paymentDate),
          }))
        : null,
    unavailableReasons: advancedDividend?.unavailable.map(item => (
      `${item.scope}: ${reasonText(item.reason)}`
    )) ?? [],
  };

  const volumeProfileView: VolumeProfileView = {
    state: !('volumeProfile' in snapshot) || volumeProfile === null
      ? 'not_collected'
      : volumeProfile.bins !== null
          && volumeProfile.poc !== null
          && volumeProfile.valueArea !== null
        ? 'available'
        : 'unavailable',
    analysisAsOfDate: displayText(volumeProfile?.analysisAsOfDate),
    collectedAt: volumeProfile
      ? displayText(formatDateTime(volumeProfile.collectedAt))
      : displayText(null),
    dataDate: displayText(volumeProfile?.dataDate),
    windowStartDate: displayText(volumeProfile?.windowStartDate),
    windowEndDate: displayText(volumeProfile?.windowEndDate),
    inputBarCount: formatMetric(volumeProfile?.inputBarCount, 'count'),
    priceBasis: displayText(volumeProfile?.priceBasis),
    volumeBasis: displayText(volumeProfile?.volumeBasis),
    allocationMethod: displayText(volumeProfile?.allocationMethod),
    binningMethod: displayText(volumeProfile?.binningMethod.id),
    requestedBinCount: formatMetric(volumeProfile?.binningMethod.requestedBinCount, 'count'),
    effectiveBinCount: formatMetric(volumeProfile?.binningMethod.effectiveBinCount, 'count'),
    minPrice: formatMetric(
      volumeProfile?.binningMethod.minPrice,
      volumeProfileUnits?.price,
    ),
    maxPrice: formatMetric(
      volumeProfile?.binningMethod.maxPrice,
      volumeProfileUnits?.price,
    ),
    poc: volumeProfile?.poc && volumeProfileUnits
      ? {
          binIndex: volumeProfile.poc.binIndex,
          price: formatMetric(volumeProfile.poc.price, volumeProfileUnits.price),
          allocatedVolume: formatMetric(
            volumeProfile.poc.allocatedVolume,
            volumeProfileUnits.allocatedVolume,
          ),
          volumeShare: formatMetric(
            volumeProfile.poc.volumeShare,
            volumeProfileUnits.volumeShare,
            { ratioAsPercent: true },
          ),
        }
      : null,
    valueArea: volumeProfile?.valueArea && volumeProfileUnits
      ? {
          targetVolumeShare: formatMetric(
            volumeProfile.valueArea.targetVolumeShare,
            volumeProfileUnits.volumeShare,
            { ratioAsPercent: true },
          ),
          achievedVolumeShare: formatMetric(
            volumeProfile.valueArea.achievedVolumeShare,
            volumeProfileUnits.volumeShare,
            { ratioAsPercent: true },
          ),
          val: formatMetric(volumeProfile.valueArea.val, volumeProfileUnits.price),
          vah: formatMetric(volumeProfile.valueArea.vah, volumeProfileUnits.price),
          firstBinIndex: volumeProfile.valueArea.firstBinIndex,
          lastBinIndex: volumeProfile.valueArea.lastBinIndex,
        }
      : null,
    bins: volumeProfile?.bins && volumeProfileUnits
      ? volumeProfile.bins.map(bin => ({
          index: bin.index,
          lowerPrice: formatMetric(bin.lowerPrice, volumeProfileUnits.price),
          upperPrice: formatMetric(bin.upperPrice, volumeProfileUnits.price),
          representativePrice: formatMetric(
            bin.representativePrice,
            volumeProfileUnits.price,
          ),
          allocatedVolume: formatMetric(
            bin.allocatedVolume,
            volumeProfileUnits.allocatedVolume,
          ),
          volumeShare: formatMetric(
            bin.volumeShare,
            volumeProfileUnits.volumeShare,
            { ratioAsPercent: true },
          ),
        }))
      : [],
    methodology: displayText(volumeProfile?.methodology.id),
    approximation: displayText(volumeProfile?.methodology.approximation),
    corporateActionBasisStatus: displayText(
      volumeProfile?.provenance.corporateActionBasisStatus,
    ),
    unavailableReasons: volumeProfile?.unavailable.map(item => (
      `${item.scope}: ${reasonText(item.reason)}`
    )) ?? [],
  };

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
  if ('reportedShortPositions' in snapshot.dataDates) {
    dateEntries.push([
      'reportedShortPositions',
      snapshot.dataDates.reportedShortPositions,
    ]);
  }
  if ('investorTypeFlows' in snapshot.dataDates) {
    dateEntries.push(['investorTypeFlows', snapshot.dataDates.investorTypeFlows]);
  }
  if ('sectorBenchmark' in snapshot.dataDates) {
    dateEntries.push(['sectorBenchmark', snapshot.dataDates.sectorBenchmark]);
  }
  if ('sectorShortRatio' in snapshot.dataDates) {
    dateEntries.push(['sectorShortRatio', snapshot.dataDates.sectorShortRatio]);
  }
  if ('advancedDividend' in snapshot.dataDates) {
    dateEntries.push(['advancedDividend', snapshot.dataDates.advancedDividend]);
  }
  if ('volumeProfile' in snapshot.dataDates) {
    dateEntries.push(['volumeProfile', snapshot.dataDates.volumeProfile]);
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
    reportedShortPositions: reportedShortPositionsView,
    investorTypeFlows: investorTypeFlowsView,
    sectorBenchmark: sectorBenchmarkView,
    sectorShortRatio: sectorShortRatioView,
    advancedDividend: advancedDividendView,
    volumeProfile: volumeProfileView,
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
