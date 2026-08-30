import {
  COMPARISON_SECTIONS,
  type AnalysisSnapshotComparisonResponseV1,
  type ComparisonInstanceIdentityV1,
  type ComparisonMetricKeyV1,
  type ComparisonObservationV1,
  type ComparisonSectionV1,
  type SnapshotComparisonMetricRowV1,
} from '../../analysis/comparison/schema.js';
import { comparisonPresentationNumberV1 } from '../../analysis/comparison/presentation.js';
import { generatedAtEpochMs } from '../../analysis/snapshot/latest-order.js';
import { createSnapshotId, SnapshotIdSchema } from '../../analysis/snapshot/id.js';
import type { AnalysisSnapshotHistoryItem } from '../../analysis/snapshot/repository.js';

export const COMPARISON_PAIR_REQUIREMENT =
  '比較には生成時刻の異なる保存済み分析が2件以上必要です' as const;

export function isSnapshotId(value: unknown): value is string {
  return SnapshotIdSchema.safeParse(value).success;
}

export function snapshotIdFromGeneratedAt(generatedAt: string): string | null {
  try {
    return createSnapshotId(generatedAt);
  } catch {
    return null;
  }
}

export type ComparisonPair = Readonly<{
  baseSnapshotId: string;
  targetSnapshotId: string;
}>;

export type ComparisonPageSelection =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'valid'; pair: ComparisonPair }>
  | Readonly<{ kind: 'invalid'; baseSnapshotId: string | null; targetSnapshotId: string | null }>;

export function parseComparisonPageSelection(search: string): ComparisonPageSelection {
  const parameters = new URLSearchParams(search);
  const baseValues = parameters.getAll('base');
  const targetValues = parameters.getAll('target');
  if (baseValues.length === 0 && targetValues.length === 0) return { kind: 'none' };
  const baseSnapshotId = baseValues.length === 1 ? baseValues[0]! : null;
  const targetSnapshotId = targetValues.length === 1 ? targetValues[0]! : null;
  if (
    baseSnapshotId === null
    || targetSnapshotId === null
    || !isSnapshotId(baseSnapshotId)
    || !isSnapshotId(targetSnapshotId)
    || baseSnapshotId === targetSnapshotId
  ) {
    return { kind: 'invalid', baseSnapshotId, targetSnapshotId };
  }
  return { kind: 'valid', pair: { baseSnapshotId, targetSnapshotId } };
}

export function comparisonSelectionKey(selection: ComparisonPageSelection): string {
  if (selection.kind === 'none') return 'none';
  if (selection.kind === 'invalid') {
    return `invalid:${selection.baseSnapshotId ?? ''}:${selection.targetSnapshotId ?? ''}`;
  }
  return `valid:${selection.pair.baseSnapshotId}:${selection.pair.targetSnapshotId}`;
}

export function orderedHistory(
  history: readonly AnalysisSnapshotHistoryItem[],
): AnalysisSnapshotHistoryItem[] {
  return [...history].sort((left, right) => (
    generatedAtEpochMs(left) - generatedAtEpochMs(right)
  ));
}

export function resolveComparisonPair(
  history: readonly AnalysisSnapshotHistoryItem[],
  targetSnapshotId: string,
): ComparisonPair | null {
  const ordered = orderedHistory(history);
  const targetIndex = ordered.findIndex(item => item.snapshotId === targetSnapshotId);
  if (targetIndex <= 0) return null;
  return {
    baseSnapshotId: ordered[targetIndex - 1]!.snapshotId,
    targetSnapshotId,
  };
}

export function isValidComparisonPair(
  history: readonly AnalysisSnapshotHistoryItem[],
  pair: ComparisonPair,
): boolean {
  const ordered = orderedHistory(history);
  const baseIndex = ordered.findIndex(item => item.snapshotId === pair.baseSnapshotId);
  const targetIndex = ordered.findIndex(item => item.snapshotId === pair.targetSnapshotId);
  return baseIndex >= 0 && targetIndex >= 0 && baseIndex < targetIndex;
}

const EVALUATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasMatchingEvaluationSelectors(parameters: URLSearchParams, targetSnapshotId: string): boolean {
  const snapshot = parameters.get('evaluationSnapshot');
  const evaluation = parameters.get('evaluation');
  return snapshot === targetSnapshotId
    && isSnapshotId(snapshot)
    && (evaluation === null || EVALUATION_ID_PATTERN.test(evaluation));
}

function clearEvaluationSelectors(parameters: URLSearchParams): void {
  parameters.delete('evaluationSnapshot');
  parameters.delete('evaluation');
}

export function buildComparisonPath(
  ticker: string,
  pair: ComparisonPair,
  currentSearch: string,
  preserveEvaluationForTarget = false,
): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set('ticker', ticker);
  parameters.set('tab', 'report');
  parameters.set('base', pair.baseSnapshotId);
  parameters.set('target', pair.targetSnapshotId);
  if (!preserveEvaluationForTarget || !hasMatchingEvaluationSelectors(parameters, pair.targetSnapshotId)) {
    clearEvaluationSelectors(parameters);
  }
  return `/?${parameters.toString()}`;
}

export function buildComparisonResetPath(
  ticker: string,
  currentSearch: string,
  targetSnapshotId: string | null,
): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set('ticker', ticker);
  parameters.set('tab', 'report');
  parameters.delete('base');
  parameters.delete('target');
  if (targetSnapshotId === null || !hasMatchingEvaluationSelectors(parameters, targetSnapshotId)) {
    clearEvaluationSelectors(parameters);
  }
  return `/?${parameters.toString()}`;
}

export type ComparisonRowFilter = 'attention' | 'all' | 'changed' | 'issues';

export type ComparisonHistoryStateV1 = Readonly<{
  identityKey: string;
  rowFilter: ComparisonRowFilter;
  sectionFilter: ComparisonSectionV1 | 'all';
  openDisclosureIds: readonly string[];
}>;

export function comparisonIdentityKey(
  ticker: string,
  response: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }>,
): string {
  return [
    ticker,
    response.base.snapshotId,
    response.target.snapshotId,
    response.resultVersion,
    response.registryVersion,
  ].join(':');
}

export function restoreComparisonHistoryState(
  value: unknown,
  identityKey: string,
): ComparisonHistoryStateV1 | null {
  if (typeof value !== 'object' || value === null || !('comparison' in value)) return null;
  const comparison = (value as { comparison?: unknown }).comparison;
  if (typeof comparison !== 'object' || comparison === null) return null;
  const state = comparison as Partial<ComparisonHistoryStateV1>;
  if (state.identityKey !== identityKey) return null;
  if (!['attention', 'all', 'changed', 'issues'].includes(state.rowFilter ?? '')) return null;
  if (state.sectionFilter !== 'all' && !COMPARISON_SECTIONS.includes(state.sectionFilter as ComparisonSectionV1)) {
    return null;
  }
  if (!Array.isArray(state.openDisclosureIds) || !state.openDisclosureIds.every(id => typeof id === 'string')) {
    return null;
  }
  return {
    identityKey,
    rowFilter: state.rowFilter as ComparisonRowFilter,
    sectionFilter: state.sectionFilter as ComparisonSectionV1 | 'all',
    openDisclosureIds: [...state.openDisclosureIds],
  };
}

export function comparisonRowId(row: SnapshotComparisonMetricRowV1): string {
  return `${row.metricKey}:${JSON.stringify(row.instanceIdentity)}`;
}

export function comparisonRowMatchesFilter(
  row: SnapshotComparisonMetricRowV1,
  rowFilter: ComparisonRowFilter,
  sectionFilter: ComparisonSectionV1 | 'all',
): boolean {
  if (sectionFilter !== 'all' && row.section !== sectionFilter) return false;
  const changed = row.comparison.state === 'comparable' && row.comparison.changed;
  const issue = row.comparison.state !== 'comparable';
  if (rowFilter === 'all') return true;
  if (rowFilter === 'changed') return changed;
  if (rowFilter === 'issues') return issue;
  return changed || issue;
}

export const COMPARISON_SECTION_LABELS = {
  valuation: 'バリュエーション',
  fundamental: '財務',
  technical: 'テクニカル',
  advancedTechnical: '高度テクニカル',
  supplyDemand: '需給',
  marketCorrelation: '市場相関',
  sectorBenchmark: '業種指数比較',
  strategy: '戦略水準',
  advancedDividend: '配当分析',
  volumeProfile: '出来高価格分布',
} as const satisfies Readonly<Record<ComparisonSectionV1, string>>;

export const COMPARISON_METRIC_LABELS = {
  'valuation.currentPrice': '現在株価',
  'valuation.per': 'PER',
  'valuation.pbr': 'PBR',
  'valuation.dividendYieldPercent': '配当利回り',
  'valuation.revenueCagrPercent': '売上高CAGR',
  'fundamental.latest.revenue': '売上高',
  'fundamental.latest.operatingIncome': '営業利益',
  'fundamental.latest.ordinaryIncome': '経常利益',
  'fundamental.latest.netIncome': '純利益',
  'fundamental.latest.eps': 'EPS',
  'fundamental.latest.roe': 'ROE',
  'fundamental.latest.equityRatio': '自己資本比率',
  'fundamental.latest.operatingCashFlow': '営業キャッシュフロー',
  'fundamental.latest.freeCashFlow': 'フリーキャッシュフロー',
  'technical.ma20': '20日移動平均',
  'technical.atr14': 'ATR 14',
  'technical.averageVolume20': '20日平均出来高',
  'technical.latestSwingHigh': '直近スイング高値',
  'technical.latestSwingLow': '直近スイング安値',
  'technical.trend': 'トレンド',
  'advancedTechnical.rsi14': 'RSI 14',
  'advancedTechnical.macd.value': 'MACD',
  'advancedTechnical.macd.signal': 'MACDシグナル',
  'advancedTechnical.macd.histogram': 'MACDヒストグラム',
  'advancedTechnical.bollinger20.middle': 'ボリンジャー中心線',
  'advancedTechnical.bollinger20.upper': 'ボリンジャー上限',
  'advancedTechnical.bollinger20.lower': 'ボリンジャー下限',
  'supplyDemand.buyingBalance': '信用買残',
  'supplyDemand.sellingBalance': '信用売残',
  'supplyDemand.marginRatio': '信用倍率',
  'supplyDemand.buyingBalanceWeeklyChange': '信用買残の週次変化',
  'supplyDemand.sellingBalanceWeeklyChange': '信用売残の週次変化',
  'supplyDemand.mean4w': '信用買残4週平均',
  'supplyDemand.mean13w': '信用買残13週平均',
  'supplyDemand.mean52w': '信用買残52週平均',
  'supplyDemand.deviation52w': '信用買残52週平均乖離率',
  'supplyDemand.percentile52w': '信用買残52週パーセンタイル',
  'supplyDemand.averageDailyVolume20': '20日平均出来高',
  'supplyDemand.digestionDays': '買残消化日数',
  'marketCorrelation.window.observations': '観測数',
  'marketCorrelation.window.correlation': '相関係数',
  'marketCorrelation.window.beta': 'ベータ',
  'marketCorrelation.window.alphaAnnualized': '年率アルファ',
  'marketCorrelation.window.rSquared': '決定係数',
  'sectorBenchmark.window.observations': '観測数',
  'sectorBenchmark.window.correlation': '相関係数',
  'sectorBenchmark.window.beta': 'ベータ',
  'sectorBenchmark.window.alphaAnnualized': '年率アルファ',
  'sectorBenchmark.window.rSquared': '決定係数',
  'sectorBenchmark.window.stockVolatilityAnnualized': '銘柄年率ボラティリティ',
  'sectorBenchmark.window.benchmarkVolatilityAnnualized': '業種指数年率ボラティリティ',
  'sectorBenchmark.window.excessReturn': '超過リターン',
  'strategy.entry.triggerPrice': '発動条件価格',
  'strategy.entry.price': '確定Entry価格',
  'strategy.candidate.entry.price': '候補Entry価格',
  'strategy.candidate.stop.price': '候補Stop価格',
  'strategy.candidate.target.price': '候補Target価格',
  'strategy.candidate.rewardRisk': '候補Reward / Risk',
  'advancedDividend.fiscal.annualDividendPerShare': '年間1株配当',
  'advancedDividend.fiscal.payoutRatio': '配当性向',
  'advancedDividend.event.dividendPerShare': '1株配当',
  'advancedDividend.event.ordinaryDividendPerShare': '普通配当',
  'advancedDividend.event.commemorativeDividendPerShare': '記念配当',
  'advancedDividend.event.specialDividendPerShare': '特別配当',
  'volumeProfile.poc.price': 'POC価格',
  'volumeProfile.valueArea.val': 'Value Area下限',
  'volumeProfile.valueArea.vah': 'Value Area上限',
} as const satisfies Readonly<Record<ComparisonMetricKeyV1, string>>;

const OBSERVATION_STATE_LABELS = {
  available: '利用可能',
  unavailable: '利用不可',
  not_collected: '未収集',
  ambiguous: '同一性が曖昧',
  absent: '記録なし',
} as const;

const DISPOSITION_REASON_LABELS: Readonly<Record<string, string>> = {
  unit_mismatch: '単位不一致',
  period_changed: '期間不一致',
  benchmark_changed: 'ベンチマーク不一致',
  method_changed: '計算方法不一致',
  window_changed: '窓不一致',
  missing_data_date: '基準日不足',
  invalid_data_date: '基準日不正',
  data_date_regressed: '基準日逆行',
  identity_changed: '同一性不一致',
  identity_ambiguous: '同一性が曖昧',
  non_available_state: '利用状態により比較対象外',
  record_added: '対象側で記録追加',
  record_removed: '対象側で記録消失',
};

function unitSuffix(unit: string | null): string {
  switch (unit) {
    case 'JPY': return ' 円';
    case 'JPY_per_share': return ' 円/株';
    case 'thousand_JPY': return ' 千円';
    case 'shares': return ' 株';
    case 'adjusted_shares': return ' 調整後株';
    case 'percent': return '%';
    case 'multiple': return 'x';
    case 'days': return ' 日';
    case 'count': return ' 件';
    case 'index_points': return ' points';
    default: return '';
  }
}

function formattedNumber(value: number, signDisplay: 'auto' | 'exceptZero' = 'auto'): string {
  return new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 4,
    signDisplay,
  }).format(value);
}

export function formatComparisonObservation(
  observation: ComparisonObservationV1,
  row: SnapshotComparisonMetricRowV1,
): string {
  if (observation.state !== 'available') return OBSERVATION_STATE_LABELS[observation.state];
  if (typeof observation.value === 'string') return observation.value;
  const value = comparisonPresentationNumberV1(observation.value, row.displaySemantics === 'category'
    ? 'native'
    : row.displaySemantics);
  const unit = row.displaySemantics === 'fraction_as_percent'
    || row.displaySemantics === 'percent_value'
    ? 'percent'
    : observation.actualUnit;
  return `${formattedNumber(value)}${unitSuffix(unit)}`;
}

export function formatComparisonDelta(row: SnapshotComparisonMetricRowV1): string {
  if (row.comparison.mode === 'absolute_delta') {
    const delta = comparisonPresentationNumberV1(
      row.comparison.delta,
      row.displaySemantics === 'category' ? 'native' : row.displaySemantics,
    );
    if (row.displaySemantics === 'fraction_as_percent'
      || row.displaySemantics === 'percent_value') {
      return `${formattedNumber(delta, 'exceptZero')} pt`;
    }
    const unit = row.comparison.deltaUnit;
    return `${formattedNumber(delta, 'exceptZero')}${unitSuffix(unit)}`;
  }
  if (row.comparison.mode === 'from_to') {
    return row.comparison.changed ? '変更あり' : '変更なし';
  }
  return '—';
}

export function comparisonStatusLabel(row: SnapshotComparisonMetricRowV1): string {
  if (row.comparison.state === 'comparable') {
    return row.comparison.changed ? '値の変化' : '変更なし';
  }
  return `${row.comparison.state === 'incomparable' ? '比較不可' : '対象外'}: ${
    DISPOSITION_REASON_LABELS[row.comparison.reason] ?? row.comparison.reason
  }`;
}

export function comparisonMetricLabel(row: SnapshotComparisonMetricRowV1): string {
  const identity = row.instanceIdentity
    .map(item => `${item.name}=${item.value === null ? 'null' : String(item.value)}`)
    .join(' / ');
  return identity ? `${COMPARISON_METRIC_LABELS[row.metricKey]}（${identity}）` : COMPARISON_METRIC_LABELS[row.metricKey];
}

export function formatComparisonIdentity(identity: ComparisonInstanceIdentityV1): string {
  if (identity.length === 0) return '固定条件なし';
  return identity
    .map(item => `${item.name}=${item.value === null ? 'null' : String(item.value)}`)
    .join(' / ');
}
