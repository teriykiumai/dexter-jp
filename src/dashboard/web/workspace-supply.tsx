import { useEffect, useState } from 'react';
import { Button, Card, TableScroll } from './primitives.js';
import { read } from './workspace-http.js';
import { WorkspaceSupplySchema, type WorkspaceSupplyView } from '../workspace-contracts.js';

export type SupplyKind = 'margin' | 'issuer_short' | 'sector_short';
const labels = { margin: '信用取引残高', issuer_short: '公開空売り残高', sector_short: '所属業種の空売り' };
export function WorkspaceSupply({ id, revision, disabled, acquire }: {
  id: string; revision: number; disabled: boolean; acquire: (kind: SupplyKind) => void;
}) {
  const [view, setView] = useState<WorkspaceSupplyView | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void read(`/api/workspace/instruments/${id}/supply`, WorkspaceSupplySchema, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) {
        if (value.instrumentId !== id) throw new Error('identity'); setView(value);
      } }).catch(() => { if (!controller.signal.aborted) { setError(true); setView(null); } });
    return () => controller.abort();
  }, [id, revision]);
  return <section className="design-stack" aria-label="需給データ">
    <h3>需給データ</h3>
    <div className="design-actions">{(Object.keys(labels) as SupplyKind[]).map(kind =>
      <Button key={kind} disabled={disabled || error} onClick={() => acquire(kind)}>{labels[kind]}を取得・更新</Button>)}</div>
    {error ? <p role="alert">保存済み需給データを読み込めません。ページを再読み込みしてください。</p> : null}
    {view?.datasets.map(dataset => <SupplyCard key={`${id}:${dataset.dataset}:${dataset.artifactDigest}`} value={dataset} />)}
    <p>市場全体の空売り売買代金・比率は後続実装です。</p>
  </section>;
}
function SupplyCard({ value }: { value: WorkspaceSupplyView['datasets'][number] }) {
  const [page, setPage] = useState(0), rows = value.rows.slice(page * 50, (page + 1) * 50);
  return <Card title={value.label}><div className="design-stack">
    <p>{value.state === 'not_collected' ? '未取得' : value.state === 'unavailable' ? '利用不可' : '保存済み'}</p>
    <p>{value.note}</p>
    {value.from ? <p>取得対象期間: {value.from}〜{value.through} / 確認日時: {value.checkedAt}</p> : null}
    {value.rows.length > 50 ? <div className="design-actions" aria-label={`${value.label}の表示範囲`}>
      <Button disabled={!page} onClick={() => setPage(page - 1)}>前の50行</Button>
      <span>{page * 50 + 1}〜{Math.min(value.rows.length, (page + 1) * 50)} / {value.rows.length}行</span>
      <Button disabled={(page + 1) * 50 >= value.rows.length} onClick={() => setPage(page + 1)}>次の50行</Button>
    </div> : null}
    {rows.length ? <TableScroll label={`${value.label}の正確な値`}><table>
      <thead><tr>{value.columns.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
    </table></TableScroll> : null}
    {value.artifactDigest ? <details><summary>保存データの識別子</summary><p>{value.artifactDigest}</p></details> : null}
  </div></Card>;
}
