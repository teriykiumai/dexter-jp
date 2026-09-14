import { useEffect, useRef, useState } from 'react';
import { Button, Card, TableScroll } from './primitives.js';
import { read, mutate, WorkspaceHttpError } from './workspace-http.js';
import { AiHistorySchema, AiJobViewSchema, AiDetailSchema, aiTerminal, type AiHistory, type AiJobView, type AiDetail, type AiProfile } from '../../analysis/workspace/ai-contracts.js';

const profiles = { fundamental: '財務分析', supply_demand: '需給分析' } as const;
const sources = { financial: '財務・配当', margin: '信用取引残高', issuer_short: '個別銘柄の公開空売り', sector_short: '所属業種の空売り' } as const;
const states = { prepared: '入力を保存済み', running: 'AI分析中', publishing: '結果保存を確認中', published: '保存済み',
  interrupted: '中断（再実行なし）', failed: '失敗（再実行なし）', cancelled: 'キャンセル済み', insufficient_inputs: '入力不足（AI未実行）' } as const;
let aiReadFailed = false;
export function WorkspaceAi({ id }: { id: string }) {
  const [history, setHistory] = useState<AiHistory | null>(null), [job, setJob] = useState<AiJobView | null>(null);
  const [detail, setDetail] = useState<AiDetail | null>(null), [profile, setProfile] = useState<AiProfile>('fundamental');
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(aiReadFailed), [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true), selection = useRef(0), base = `/api/workspace/instruments/${id}/ai`;
  const block = () => { aiReadFailed = true; if (mounted.current) setBlocked(true); };
  useEffect(() => {
    if (aiReadFailed) return;
    mounted.current = true; const controller = new AbortController();
    void read(base, AiHistorySchema, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.instrumentId !== id) throw new Error('identity'); setHistory(value); setJob(value.active);
    }).catch(() => { if (!controller.signal.aborted) block(); });
    return () => { mounted.current = false; controller.abort(); selection.current++; };
  }, [id, base]);
  async function loadHistory(before?: string) {
    const value = await read(before ? `${base}?before=${before}` : base, AiHistorySchema);
    if (value.instrumentId !== id) throw new Error('identity');
    if (mounted.current) { setHistory(value); setJob(value.active); }
  }
  useEffect(() => {
    if (!job || aiTerminal(job.state) || blocked) return;
    let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const schedule = () => {
      clearTimeout(timer); controller?.abort();
      if (document.visibilityState !== 'visible') return;
      timer = setTimeout(() => {
        const current = new AbortController(); controller = current;
        void read(`${base}/jobs/${job.id}`, AiJobViewSchema, { signal: current.signal }).then(async value => {
          if (current.signal.aborted) return;
          if (value.id !== job.id || value.instrumentId !== id || value.profile !== job.profile) throw new Error('identity');
          setJob(value); if (aiTerminal(value.state)) await loadHistory();
        }).catch(() => { if (!current.signal.aborted && mounted.current) block(); });
      }, 1000);
    };
    document.addEventListener('visibilitychange', schedule); schedule();
    return () => { clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', schedule); };
  }, [job, blocked, base, id]);
  async function start() {
    if (busy || blocked || aiReadFailed || !history?.configured || history.busy || job && !aiTerminal(job.state)) return;
    setBusy(true); setMessage(null);
    try {
      const value = await mutate(`${base}/jobs`, { profile }, AiJobViewSchema);
      if (value.instrumentId !== id || value.profile !== profile) throw new Error('identity');
      if (!mounted.current) return; setJob(value); await loadHistory();
      if (value.state === 'insufficient_inputs') setMessage('分析に使える保存済みデータが不足しています。必要なデータを明示取得してください。');
    } catch (error) {
      if (!mounted.current) { if (!(error instanceof WorkspaceHttpError && error.status < 500)) aiReadFailed = true; return; }
      if (error instanceof WorkspaceHttpError && error.status >= 400 && error.status < 500) {
        setMessage('AI分析を受け付けられませんでした。入力・モデル設定・実行状況を確認してください。');
        try { await loadHistory(); } catch { block(); }
      } else block();
    } finally { if (mounted.current) setBusy(false); }
  }
  async function open(runId: string) {
    const token = ++selection.current; setDetail(null);
    try {
      const value = await read(`${base}/runs/${runId}`, AiDetailSchema);
      if (value.job.instrumentId !== id || value.job.id !== runId) throw new Error('identity');
      if (mounted.current && token === selection.current) setDetail(value);
    } catch { if (mounted.current && token === selection.current) { setDetail(null); block(); } }
  }
  async function cancel() {
    if (!job || busy || blocked || aiReadFailed) return; setBusy(true);
    try {
      const value = await mutate(`${base}/jobs/${job.id}`, undefined, AiJobViewSchema, 'DELETE');
      if (value.id !== job.id || value.instrumentId !== id || value.profile !== job.profile) throw new Error('identity');
      if (mounted.current) { setJob(value); await loadHistory(); }
    } catch { block(); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="design-stack" aria-label="AI分析・履歴"><h3>AI分析・履歴</h3>
    <p>保存済みデータをAIへ送信して解釈します。追加の市場データ取得は行いません。数値と基準日は固定入力の表で確認できます。</p>
    {history?.runtime ? <p>モデル: {history.runtime.model} / {history.runtime.providerId}</p> : null}
    {history && !history.configured ? <p>AIモデルまたはキーの設定を確認してください。価格・Drawingは引き続き利用できます。</p> : null}
    <div className="design-actions"><label className="design-field">分析の種類<select value={profile} onChange={event => setProfile(event.target.value as AiProfile)}>
      {Object.entries(profiles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <Button disabled={busy || blocked || !history?.configured || history.busy || !!job && !aiTerminal(job.state)} onClick={() => void start()}>保存済み入力でAI分析を実行</Button>
      {job && ['prepared', 'running'].includes(job.state) ? <Button disabled={busy || blocked} onClick={() => void cancel()}>AI分析をキャンセル</Button> : null}</div>
    {job ? <p role="status">{profiles[job.profile]}: {states[job.state]}</p> : history?.busy ? <p role="status">別のAI処理または保存確認が進行中です。完了後に履歴を読み直してください。</p> : null}
    {message ? <p role="alert">{message}</p> : null}
    {blocked ? <p role="alert">AI状態を確認できません。再送せずページ全体を再読み込みしてください。</p> : null}
    <Card title="保存したAI履歴"><div className="design-stack">
      <Button disabled={busy || blocked} onClick={() => { void loadHistory().catch(block); }}>AI履歴を読み直す</Button>
      {!history?.items.length ? <p>AI履歴はありません。</p> : <ul>{history.items.map(item => <li key={item.id}>
        <p>{item.createdAt} / {states[item.state]}</p>
        <Button onClick={() => void open(item.id)}>{profiles[item.profile]}の固定入力と結果を開く</Button></li>)}</ul>}
      {history?.next ? <Button disabled={blocked} onClick={() => { void loadHistory(history.next!).catch(block); }}>以前のAI履歴</Button> : null}
    </div></Card>
    {detail ? <Card title="固定入力とAI解釈"><div className="design-stack">
      <p>実行日時: {detail.input.createdAt} / {profiles[detail.input.profile]} / {states[detail.job.state]}</p>
      {detail.result ? <><h4>AIの解釈</h4><ul>{detail.result.interpretation.observations.map((item, i) => <li key={i}>{item.text}（参照: {item.sources.map(source => sources[source]).join('、')}）</li>)}</ul>
        <h4>制約・不足</h4><ul>{detail.result.interpretation.limitations.map((item, i) => <li key={i}>{item.text}（参照: {item.sources.map(source => sources[source]).join('、')}）</li>)}</ul></> : <p>保存が確認できたAI結果はありません。自動再実行はしません。</p>}
      {(detail.input.profile === 'fundamental' ? [{ ...detail.input.data, label: 'financial' as const, columns: ['項目', '値'] }]
        : detail.input.data.datasets.map(dataset => ({ ...dataset, label: dataset.dataset }))).map(dataset =>
        <details className="stored-disclosure" key={`${detail.job.id}-${dataset.label}`}><summary>固定入力: {sources[dataset.label]}</summary><div className="stored-disclosure-content design-stack"><p>{dataset.note}</p>
          <p>状態: {{ not_collected: '未取得', unavailable: '利用不可', available: '保存済み' }[dataset.state]} / 基準日: {dataset.through ?? 'なし'} / 確認日時: {dataset.checkedAt ?? 'なし'}</p>
          <AiInputTable dataset={dataset} /></div>
        </details>)}
      <details><summary>入力・結果の識別子</summary><p>入力: {detail.job.input.digest}</p><p>結果: {detail.job.result?.digest ?? '未保存'}</p></details>
    </div></Card> : null}
  </section>;
}

function AiInputTable({ dataset }: { dataset: { label: string; columns: string[]; rows: string[][] } }) {
  const [page, setPage] = useState(0), rows = dataset.rows.slice(page * 50, (page + 1) * 50);
  return <><div className="design-actions">
    {dataset.rows.length > 50 ? <><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>固定入力の前の50行</Button>
      <Button disabled={(page + 1) * 50 >= dataset.rows.length} onClick={() => setPage(value => value + 1)}>固定入力の次の50行</Button></> : null}
  </div><TableScroll label={`AI固定入力 ${dataset.label}`}><table>
    <thead><tr>{dataset.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
  </table></TableScroll></>;
}
