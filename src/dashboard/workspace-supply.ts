import type { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { scopeKey, parse, fail, objectKey } from '../analysis/workspace/contracts.js';
import { objectRow, rowRef, resolveReference } from '../analysis/workspace/references.js';
import { workspaceDataCodecs } from '../analysis/workspace/data-objects.js';
import { SupplyReceiptSchema, SupplyMembershipSchema, supplyArtifact, validateSupplyLinks } from '../analysis/workspace/supply-objects.js';
import { WorkspaceSupplySchema, type WorkspaceSupplyView } from './workspace-contracts.js';
import type { SupplyDemandMetric } from '../tools/finance/supply-demand-engine.js';

const labels = { margin: '信用取引残高', issuer_short: '個別銘柄の公開空売り残高・機関別報告', sector_short: '所属業種の空売り売買代金・比率' } as const;
const number = (value: number | null) => value === null ? '利用不可' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 8 }).format(value);
const ratio = (value: number | null) => value === null ? '利用不可' : `${number(value * 100)}%`;
export function readWorkspaceSupply(repository: WorkspaceRepository, instrumentId: string): WorkspaceSupplyView;
export function readWorkspaceSupply(repository: WorkspaceRepository, instrumentId: string, uncollectedOnly: true): WorkspaceSupplyView | null;
export function readWorkspaceSupply(repository: WorkspaceRepository, instrumentId: string, uncollectedOnly = false): WorkspaceSupplyView | null {
  const read = (key: string) => resolveReference(repository.db, rowRef(objectRow(repository.db, key)), workspaceDataCodecs);
  const decode = (key: string) => JSON.parse(new TextDecoder().decode(read(key).bytes));
  const datasets = (Object.keys(labels) as (keyof typeof labels)[]).map(dataset => {
    const binding = dataset === 'sector_short'
      ? repository.db.sqlite.query<{ artifact: string; receipt: string; membership?: string }, [string]>(`SELECT b.artifact,b.receipt,l.membership FROM shared_context_links l
        JOIN artifact_bindings b USING(binding_id) WHERE l.instrument_id=? AND l.role='sector_short'`).get(instrumentId)
      : repository.db.sqlite.query<{ artifact: string; receipt: string; membership?: string }, [string, string]>(`SELECT b.artifact,b.receipt FROM data_sync_state s
        JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset=?`).get(scopeKey({ kind: 'instrument-owned', instrumentId }), dataset);
    const base: WorkspaceSupplyView['datasets'][number] = { dataset, label: labels[dataset], state: 'not_collected',
      artifactDigest: null, from: null, through: null, checkedAt: null,
      note: dataset === 'margin' ? '週次・未調整株数。信用倍率は買残÷売残。'
        : dataset === 'issuer_short' ? '日次公表の残高報告です。公表基準は残高割合0.5%以上。報告なしは空売りゼロを意味しません。'
          : '日次の業種別売買代金です。個別銘柄の空売り残高・市場全体の比率とは異なります。', columns: ['項目', '値'], rows: [] };
    base.note = `取得元: J-Quants（JPX）。${base.note}`;
    if (!binding) return base;
    if (uncollectedOnly) return null;
    for (const key of [binding.artifact, binding.receipt, ...(binding.membership ? [binding.membership] : [])])
      validateSupplyLinks(read(key), ref => decode(objectKey(ref)));
    const receipt = parse(SupplyReceiptSchema, decode(binding.receipt)), artifact = supplyArtifact(decode(binding.artifact));
    if (objectKey(receipt.artifact) !== binding.artifact || artifact.input.dataset !== dataset) fail('reference_conflict');
    if (dataset === 'sector_short') {
      const member = parse(SupplyMembershipSchema, decode(binding.membership ?? fail('reference_missing')));
      if (member.identity.instrumentId !== instrumentId || objectKey(member.artifact) !== binding.artifact) fail('reference_conflict');
      base.note += ` 業種: ${member.observation.S33Nm}（${member.observation.S33}）、所属確認日: ${member.date}。`;
    } else if (artifact.input.identity?.instrumentId !== instrumentId) fail('reference_conflict');
    Object.assign(base, { state: 'available', artifactDigest: artifact.artifactDigest, from: artifact.input.from,
      through: artifact.input.through, checkedAt: receipt.receipt.checkedAt });
    const result = artifact.result;
    if ('buyingBalance' in result) {
      const reasons = { missing_data: '必要なデータが欠損', insufficient_history: '履歴不足', zero_selling_balance: '売残がゼロ',
        zero_mean_52w: '52週平均がゼロ', zero_average_daily_volume: '平均出来高がゼロ' };
      const value = (metric: SupplyDemandMetric, amount: number | null, percent = false) => amount !== null
        ? percent ? ratio(amount) : number(amount)
        : `利用不可（${reasons[result.unavailable.find(item => item.metric === metric)?.reason ?? 'missing_data']}）`;
      base.rows = [['残高基準日', result.dataDate ?? '利用不可'], ['信用買残（株）', value('buyingBalance', result.buyingBalance)],
        ['信用売残（株）', value('sellingBalance', result.sellingBalance)], ['信用倍率（倍）', value('marginRatio', result.marginRatio)],
        ['買残前週差（株）', value('buyingBalanceWeeklyChange', result.buyingBalanceWeeklyChange)], ['売残前週差（株）', value('sellingBalanceWeeklyChange', result.sellingBalanceWeeklyChange)],
        ['買残4週平均（株）', value('mean4w', result.mean4w)], ['買残13週平均（株）', value('mean13w', result.mean13w)], ['買残52週平均（株）', value('mean52w', result.mean52w)],
        ['買残52週乖離率', value('deviation52w', result.deviation52w, true)], ['買残52週Percentile', value('percentile52w', result.percentile52w, true)],
        ['信用消化日数（日）', value('digestionDays', result.digestionDays)]];
      if (!result.dataDate) base.state = 'unavailable';
      if (result.comparisonState !== 'eligible') base.note += result.comparisonState === 'price_basis_unverified'
        ? ' 価格基準を検証できないため、履歴比較は利用できません。' : ' 連続した週次データが不足しているため、履歴比較は利用できません。';
    } else if ('reports' in result) {
      base.columns = ['公表日', '計算日', '報告者', '委託者', 'ファンド', '残高割合', '残高（株）', '前回計算日'];
      base.rows = result.reports.map(row => [row.disclosedDate, row.calculatedDate, row.reporterName ?? '未公表',
        row.discretionaryManagerName ?? '未公表', row.fundName ?? '未公表', ratio(row.shortPositionRatio), number(row.shortPositionShares), row.previousCalculatedDate ?? '利用不可']);
      if (!result.reports.length) { base.state = 'unavailable'; base.note += ' 取得範囲に利用可能な公開報告はありません。'; }
    } else {
      base.columns = ['対象日', '空売り売買代金（円）', '売買代金合計（円）', '空売り比率'];
      base.rows = result.observations.map(row => [row.date, number(row.shortSellingValue), number(row.totalSellingValue), ratio(row.shortSellingRatio)]);
      if (!result.observations.length) { base.state = 'unavailable'; base.note += ' 取得範囲に利用可能な業種データはありません。'; }
      if (result.observations.some(row => row.unavailable.length)) base.note += ' 比率等の欠損または分母ゼロは利用不可と表示します。';
    }
    return base;
  });
  if (datasets.some(dataset => dataset === null)) return null;
  return WorkspaceSupplySchema.parse({ schemaVersion: 'workspace_supply_view_v1', instrumentId, datasets });
}
