import type { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { scopeKey, objectKey, parse, fail } from '../analysis/workspace/contracts.js';
import { objectRow, rowRef, resolveReference } from '../analysis/workspace/references.js';
import { workspaceDataCodecs } from '../analysis/workspace/data-objects.js';
import { financialArtifact, FinancialReceiptSchema, validateFinancialLinks } from '../analysis/workspace/financial-objects.js';
import { selectFinancial, type FinancialUnavailable } from '../analysis/workspace/financial-artifact.js';
import { verifiedTechnical } from '../analysis/workspace/verified-technical.js';
import { WorkspaceFinancialSchema, type WorkspaceFinancialView } from './workspace-contracts.js';

const reasons: Record<FinancialUnavailable, string> = { missing_data: '開示値が欠損', historical_identity_unverified: '対象期間の銘柄帰属を未確認',
  no_eligible_disclosure: '利用可能な開示なし', availability_calendar_unavailable: '開示の利用可能日を確認できません',
  price_basis_unverified: '配当と価格の一株基準を未確認', price_unavailable: '最新の利用可能な日足終値なし' };
const number = (value: number) => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 8 }).format(value);
const display = (value: number | null | undefined, reason: FinancialUnavailable | null = null, percent = false) => reason || value == null
  ? `利用不可（${reasons[reason ?? 'missing_data']}）` : percent ? `${number(value * 100)}%` : number(value);

export function readWorkspaceFinancial(repository: WorkspaceRepository, instrumentId: string): WorkspaceFinancialView;
export function readWorkspaceFinancial(repository: WorkspaceRepository, instrumentId: string, uncollectedOnly: true): WorkspaceFinancialView | null;
export function readWorkspaceFinancial(repository: WorkspaceRepository, instrumentId: string, uncollectedOnly = false): WorkspaceFinancialView | null {
  const db = repository.db, scope = scopeKey({ kind: 'instrument-owned', instrumentId });
  const binding = (dataset: string) => db.sqlite.query<{ artifact: string; receipt: string }, [string, string]>(`SELECT b.artifact,b.receipt
    FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset=? AND s.status='available'`).get(scope, dataset);
  const saved = binding('financial');
  const base: WorkspaceFinancialView = { schemaVersion: 'workspace_financial_view_v1', instrumentId, state: 'not_collected',
    through: null, checkedAt: null, artifactDigest: null, rows: [], projection: null,
    note: '取得元: J-Quants（JPX）。通期の会社財務・実績配当性向と会社予想年間配当です。取得時点の訂正を含み、過去時点の情報ではありません。' };
  if (!saved) return base;
  if (uncollectedOnly) return null;
  const read = (key: string) => resolveReference(db, rowRef(objectRow(db, key)), workspaceDataCodecs);
  const decode = (key: string) => JSON.parse(new TextDecoder().decode(read(key).bytes));
  for (const key of [saved.artifact, saved.receipt]) validateFinancialLinks(read(key), ref => decode(objectKey(ref)));
  const artifact = financialArtifact(decode(saved.artifact)), receipt = parse(FinancialReceiptSchema, decode(saved.receipt));
  if (artifact.input.identity.instrumentId !== instrumentId || objectKey(receipt.artifact) !== saved.artifact) fail('reference_conflict');
  let price: NonNullable<WorkspaceFinancialView['projection']>['priceReference'] = null;
  const technical = binding('technical');
  if (technical) {
    const value = verifiedTechnical(db, instrumentId, rowRef(objectRow(db, technical.artifact)), rowRef(objectRow(db, technical.receipt)));
    if (value.input.identity.code !== artifact.input.identity.code) fail('reference_conflict');
    const last = value.input.daily.filter(row => row.Date >= value.input.eligibilityFrom && row.Date <= value.input.queryTo).at(-1);
    if (last) price = { artifact: rowRef(objectRow(db, technical.artifact)), receipt: rowRef(objectRow(db, technical.receipt)), date: last.Date, close: last.C };
  }
  const cutoff = [artifact.input.through, price?.date ?? artifact.input.through].sort().at(-1)!;
  const selected = selectFinancial(artifact.input, cutoff);
  const forecast = selected.forecast, annual = artifact.result.annual, reason = selected.forecastReason
    ?? (!price?.close ? 'price_unavailable' : 'price_basis_unverified');
  base.projection = { policyVersion: 'workspace_dividend_projection_v1', cutoff, state: 'unavailable', reason,
    forecastReference: forecast && forecast.sourceField !== 'DivAnn' ? { artifact: rowRef(objectRow(db, saved.artifact)),
      receipt: rowRef(objectRow(db, saved.receipt)), disclosureNumber: forecast.disclosureNumber, sourceField: forecast.sourceField } : null,
    priceReference: price };
  const annualReason = artifact.result.annualReason, forecastReason = selected.forecastReason;
  base.rows = [['通期対象年度', annual?.CurFYEn ?? display(null, annualReason)], ['通期開示日', annual?.dividend.disclosedDate ?? display(null, annualReason)],
    ['売上高（円）', display(annual?.Sales, annualReason)], ['営業利益（円）', display(annual?.OP, annualReason)],
    ['経常利益（円）', display(annual?.OdP, annualReason)], ['当期純利益（円）', display(annual?.NP, annualReason)],
    ['EPS（開示値・円/株）', display(annual?.EPS, annualReason)], ['BPS（開示値・円/株）', display(annual?.BPS, annualReason)],
    ['総資産（円）', display(annual?.TA, annualReason)], ['純資産（円）', display(annual?.Eq, annualReason)],
    ['自己資本比率', display(annual?.EqAR, annualReason, true)], ['営業CF（円）', display(annual?.CFO, annualReason)],
    ['投資CF（円）', display(annual?.CFI, annualReason)], ['財務CF（円）', display(annual?.CFF, annualReason)],
    [`実績配当性向（${annual?.CurFYEn ?? '対象年度未確認'}）`, display(annual?.dividend.actualPayoutRatio, artifact.result.actualPayoutReason, true)],
    ['会社予想年間配当（円/株）', display(forecast?.annualDividendPerShare, forecastReason)],
    ['予想配当の対象年度', forecast?.fiscalYearEndDate ?? display(null, forecastReason)],
    ['予想配当の開示日', forecast?.disclosedDate ?? display(null, forecastReason)],
    ['利回り計算に用いる日足終値（円）', display(price?.close, price?.close ? null : 'price_unavailable')],
    ['日足終値の基準日', price?.date ?? display(null, 'price_unavailable')],
    ['予想配当利回り', display(null, reason)], ['PER / PBR', display(null, 'price_basis_unverified')]];
  Object.assign(base, { state: annual || forecast && !forecastReason ? 'available' : 'unavailable',
    through: artifact.dataDate, checkedAt: receipt.receipt.checkedAt, artifactDigest: artifact.artifactDigest });
  if (artifact.result.warnings.length) base.note += ' 実績配当性向が通常の範囲外です。元の開示値を表示しています。';
  if (artifact.result.excludedIdentityRows) base.note += ' 銘柄の確認期間より前の開示は表示値に採用していません。';
  return WorkspaceFinancialSchema.parse(base);
}
