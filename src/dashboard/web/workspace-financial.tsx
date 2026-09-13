import { useEffect, useState } from 'react';
import { Button, Card, TableScroll } from './primitives.js';
import { read } from './workspace-http.js';
import { WorkspaceFinancialSchema, type WorkspaceFinancialView } from '../workspace-contracts.js';

export function WorkspaceFinancial({ id, revision, disabled, acquire }: {
  id: string; revision: number; disabled: boolean; acquire: () => void;
}) {
  const [view, setView] = useState<WorkspaceFinancialView | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError(false); setView(null);
    void read(`/api/workspace/instruments/${id}/financial`, WorkspaceFinancialSchema, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) {
        if (value.instrumentId !== id) throw new Error('identity'); setView(value);
      } }).catch(() => { if (!controller.signal.aborted) { setError(true); setView(null); } });
    return () => controller.abort();
  }, [id, revision]);
  return <section className="design-stack" aria-label="財務・配当">
    <h3>財務・配当</h3>
    <div className="design-actions"><Button disabled={disabled || error} onClick={acquire}>財務・配当を取得・更新</Button></div>
    {error ? <p role="alert">保存済み財務データを読み込めません。ページを再読み込みしてください。</p> : null}
    {view ? <Card title="会社財務と配当"><div className="design-stack">
      <p>{view.state === 'not_collected' ? '未取得' : view.state === 'unavailable' ? '利用不可' : '保存済み'}</p>
      <p>{view.note}</p>
      {view.through ? <p>情報基準日: {view.through} / 確認日時: {view.checkedAt}</p> : null}
      {view.rows.length ? <TableScroll label="財務・配当の正確な値"><table>
        <thead><tr><th scope="col">項目</th><th scope="col">値</th></tr></thead>
        <tbody>{view.rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
      </table></TableScroll> : null}
      {view.artifactDigest ? <details><summary>保存データの識別子</summary><p>{view.artifactDigest}</p>
        <p>価格: {view.projection?.priceReference?.artifact.digest ?? '未取得'}</p></details> : null}
    </div></Card> : !error ? <p role="status">保存済み財務データを読込中</p> : null}
  </section>;
}
