import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './primitives.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, DrawingHistoryResultSchema, type DrawingPage, type DrawingView } from '../drawing-contracts.js';
import { read, mutate, WorkspaceHttpError } from './workspace-http.js';
import type { WorkspaceChart } from '../workspace-contracts.js';
import type { ChartOverlay, TrendOverlay, TrendEditor } from './chart.js';

type Draft = { id: string; revision: number; chartDigest: string; kind: 'horizontal' | 'trendline'; price: string; time: string; endPrice: string; endTime: string };
type Command = { id: string; token: string };
export function HorizontalDrawings({ id, chart, interval, children }: { id: string; chart: WorkspaceChart; interval: 'day' | 'week' | 'month'; children: (lines: ChartOverlay[], trends: TrendOverlay[], editor?: TrendEditor) => ReactNode }) {
  const [page, setPage] = useState<DrawingPage | null>(null), [after, setAfter] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  const [message, setMessage] = useState('Drawingを読み込み中です。');
  const priceInput = useRef<HTMLInputElement>(null), newButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true), inFlight = useRef(false);
  const [undo, setUndo] = useState<Command[]>([]), [redo, setRedo] = useState<Command[]>([]);
  const revisions = useRef(new Map<string, { revision: number; state: string }>());
  const url = `/api/workspace/instruments/${id}/drawings`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setFailed(false); setPage(null);
    void read(`${url}${after ? `?after=${after}` : ''}`, DrawingPageSchema, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.instrumentId !== id || value.items.some(item => item.instrumentId !== id)) throw new Error('Drawing identity mismatch');
      setPage(value); setMessage('保存済みDrawingを読み込みました。');
    }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setMessage('Drawingを読み込めません。保存状態を再読込してください。'); } });
    return () => controller.abort();
  }, [id, url, chart.artifactDigest, after, reload]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn);
  }, [draft]);
  const matching = !!page && page.chartDigest === chart.artifactDigest && !failed;
  const staleDraft = !!draft && draft.chartDigest !== chart.artifactDigest;
  const lines = useMemo<ChartOverlay[]>(() => matching ? page!.items.filter(item => item.state === 'compatible' && item.kind === 'horizontal').map(item => ({
    price: item.price, label: `Horizontal ${item.id.slice(0, 8)}${selected === item.id ? ' 選択中' : ''}`,
    colorToken: '--color-chart-price',
  })) : [], [page, matching, selected]);
  const choose = (item?: DrawingView, kind: Draft['kind'] = 'horizontal') => {
    const last = chart.intervals.day.at(-1);
    if (!last) return;
    setSelected(item?.id ?? null);
    setDraft({ id: item?.id ?? crypto.randomUUID(), revision: item?.revision ?? 0, chartDigest: chart.artifactDigest,
      kind: item?.kind ?? kind, price: String(item?.price ?? last.close),
      time: item?.time ?? (kind === 'trendline' ? chart.intervals.day.at(-2)!.displayDate : last.displayDate),
      endTime: item?.kind === 'trendline' ? item.endTime : last.displayDate,
      endPrice: String(item?.kind === 'trendline' ? item.endPrice : last.close) });
    setMessage('未保存。数値を確認して保存してください。');
    queueMicrotask(() => priceInput.current?.focus());
  };
  async function save() {
    if (!draft || inFlight.current || !matching || staleDraft) return;
    inFlight.current = true; setBusy(true);
    const submitted = draft;
    try {
      const saved = await mutate(submitted.revision ? `${url}/${submitted.id}` : url,
        writeDraft(submitted), DrawingSavedSchema, submitted.revision ? 'PUT' : 'POST');
      if (saved.instrumentId !== id || saved.id !== submitted.id || saved.revision !== submitted.revision + 1) throw new Error('Drawing response mismatch');
      if (alive.current) { record(saved.id, saved.historyToken, saved.revision, saved.historyState); setDraft(null); setSelected(saved.id); setAfter(undefined); setReload(value => value + 1); setMessage('保存しました。'); newButton.current?.focus(); }
    } catch (error) {
      if (alive.current) { setFailed(true); setMessage(error instanceof WorkspaceHttpError && error.status === 409
        ? '保存競合またはbasis確認が必要です。入力は未保存のまま保持しています。保存状態を再読込し、キャンセル後に選び直してください。'
        : '保存結果を確認できません。入力を保持しています。自動再送せず、保存状態を再読込してください。'); }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function remove(item: DrawingView) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const deleted = await mutate(`${url}/${item.id}`, { revision: item.revision }, DrawingDeletedSchema, 'DELETE');
      if (deleted.instrumentId !== id || deleted.id !== item.id) throw new Error('Drawing response mismatch');
      if (alive.current) { record(item.id, deleted.historyToken, 0, deleted.historyState); setSelected(null); setReload(value => value + 1); setMessage('削除しました。'); newButton.current?.focus(); }
    } catch { if (alive.current) { setFailed(true); setMessage('削除結果を確認できません。保存状態を再読込してください。'); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  function record(drawingId: string, token: string | undefined, revision: number, state: string) {
    revisions.current.set(drawingId, { revision, state }); setRedo([]);
    if (token) setUndo(items => [...items, { id: drawingId, token }].slice(-100));
    else setUndo([]);
  }
  async function replay(direction: 'undo' | 'redo') {
    const command = (direction === 'undo' ? undo : redo).at(-1);
    if (!command || inFlight.current || !matching || draft) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await mutate(url + '/' + command.id, { token: command.token, direction,
        ...revisions.current.get(command.id), chartDigest: chart.artifactDigest }, DrawingHistoryResultSchema);
      if (result.instrumentId !== id || result.id !== command.id || result.token !== command.token || result.direction !== direction) throw new Error('Drawing response mismatch');
      if (alive.current) {
        revisions.current.set(command.id, { revision: result.revision, state: result.state });
        if (direction === 'undo') { setUndo(items => items.slice(0, -1)); setRedo(items => [...items, command]); }
        else { setRedo(items => items.slice(0, -1)); setUndo(items => [...items, command]); }
        setReload(value => value + 1); setMessage(direction === 'undo' ? '元に戻しました。' : 'やり直しました。');
      }
    } catch { if (alive.current) { setFailed(true); setMessage('undo/redoの結果を確認できません。自動再送せず保存状態を再読込してください。'); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const trends: TrendOverlay[] = matching && interval === 'day' ? page!.items.flatMap(item => item.kind === 'trendline' && item.state === 'compatible'
    ? [{ id: item.id, time: item.time, price: item.price, endTime: item.endTime, endPrice: item.endPrice }] : []) : [];
  const editor: TrendEditor | undefined = draft?.kind === 'trendline' && interval === 'day' && matching && !staleDraft && !busy ? {
    time: draft.time, price: Number(draft.price), endTime: draft.endTime, endPrice: Number(draft.endPrice),
    dates: chart.intervals.day.map(row => row.displayDate).filter(date => {
      const original = page?.items.find(item => item.id === draft.id);
      return !original || (date >= original.evidenceFrom && date <= original.evidenceThrough);
    }),
    onChange: (point, time, price) => setDraft(current => current ? { ...current,
      ...(point === 'start' ? { time, price: String(price) } : { endTime: time, endPrice: String(price) }) } : null),
  } : undefined;
  return <>
    <section className="design-stack" aria-label="Drawing">
      <h3>Drawing</h3>
      <p>手動の価格メモです。売買推奨ではありません。日足の基準日・調整後価格を保存します。Horizontalは日・週・月で同じ価格を表示します。</p>
      <p>一覧は最大100件です。表示中の一覧でbasis互換を確認できた線だけをチャートに表示します。</p>
      <div className="design-actions">
        <Button ref={newButton} disabled={busy || !!draft || !matching || !chart.intervals.day.length} onClick={() => choose()}>Horizontal lineを作成</Button>
        <Button disabled={busy} onClick={() => { setUndo([]); setRedo([]); setReload(value => value + 1); }}>保存状態を再読込</Button>
      </div>
      <div className="design-actions">
        <Button disabled={busy || !!draft || !matching || chart.intervals.day.length < 2} onClick={() => choose(undefined, 'trendline')}>Trendlineを作成</Button>
        <Button disabled={busy || !!draft || !matching || !undo.length} onClick={() => void replay('undo')}>元に戻す</Button>
        <Button disabled={busy || !!draft || !matching || !redo.length} onClick={() => void replay('redo')}>やり直す</Button>
      </div>
      <p>undo/redoはこの画面の確定操作を最大100件保持します。再読込・画面移動・server restartで操作履歴は終了します。保存済みDrawingは残ります。</p>
      {interval !== 'day' ? <p>Trendlineの表示とドラッグは日足で利用できます。週・月への投影は後続Stepで追加します。</p> : null}
      <p role={failed ? 'alert' : 'status'}>{message}</p>
      {!matching && page ? <p role="alert">表示価格とDrawingの確認対象が異なります。価格と保存状態を再読込してください。線は表示していません。</p> : null}
      {staleDraft ? <p role="alert">編集中に価格が更新されました。入力を保持しています。キャンセル後に選び直してください。</p> : null}
      {draft ? <form className="design-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p>未保存 {draft.revision ? '編集' : '新規'} / revision {draft.revision}</p>
        <label className="design-field">{draft.kind === 'horizontal' ? 'Horizontal価格（円・調整後）' : 'Trendline始点価格（円・調整後）'}<input ref={priceInput} type="number" min="0.00000001" step="any" required value={draft.price} disabled={busy}
          onChange={event => setDraft({ ...draft, price: event.target.value })} /></label>
        <label className="design-field">{draft.kind === 'horizontal' ? 'Horizontal基準日（日足）' : 'Trendline始点日（日足）'}<input type="date" required value={draft.time} disabled={busy}
          onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
        {draft.kind === 'trendline' ? <>
          <label className="design-field">Trendline終点価格（円・調整後）<input type="number" min="0.00000001" step="any" required value={draft.endPrice} disabled={busy} onChange={event => setDraft({ ...draft, endPrice: event.target.value })} /></label>
          <label className="design-field">Trendline終点日（日足）<input type="date" required value={draft.endTime} disabled={busy} onChange={event => setDraft({ ...draft, endTime: event.target.value })} /></label>
          <p>日足チャートの端点をドラッグして編集できます。Escapeでドラッグを取り消します。日付・価格欄でも同じ端点を編集できます。</p>
        </> : null}
        <p>作成時の根拠期間を保持します。編集の基準日はその期間内の日足を指定してください。</p>
        <div className="design-actions"><Button type="submit" disabled={busy || !matching || staleDraft}>{draft.kind === 'horizontal' ? 'Horizontalを保存' : 'Trendlineを保存'}</Button>
          <Button disabled={busy} onClick={() => { setDraft(null); setMessage('編集をキャンセルしました。'); newButton.current?.focus(); }}>編集をキャンセル</Button></div>
      </form> : null}
      <ul aria-label="保存済みDrawing">{page?.items.map(item => <li key={item.id}>
        <p>{item.price} 円 / 基準日 {item.time} / revision {item.revision} / {item.state === 'compatible' ? 'basis互換' : 'basis_review_required（保持・非表示）'}</p>
        {item.kind === 'trendline' ? <p>終点 {item.endPrice} 円 / {item.endTime}</p> : null}
        <p>根拠期間 {item.evidenceFrom}–{item.evidenceThrough}</p>
        <div className="design-actions"><Button aria-pressed={selected === item.id} disabled={busy || !!draft || !matching || item.state !== 'compatible'} onClick={() => choose(item)}>{item.kind === 'horizontal' ? 'Horizontal' : 'Trendline'} {item.id.slice(0, 8)} を選択・編集</Button>
          <Button variant="destructive" disabled={busy || !!draft || failed} onClick={() => void remove(item)}>{item.kind === 'horizontal' ? 'Horizontal' : 'Trendline'} {item.id.slice(0, 8)} を削除</Button></div>
      </li>)}</ul>
      {page && !page.items.length ? <p>保存済みDrawingはありません。</p> : null}
      {after || page?.next ? <div className="design-actions"><Button disabled={busy || !!draft || !after} onClick={() => setAfter(undefined)}>最初の100件</Button>
        <Button disabled={busy || !!draft || !page?.next} onClick={() => setAfter(page!.next!)}>次の100件</Button></div> : null}
    </section>
    {children(lines, trends, editor)}
  </>;
}

function writeDraft(draft: Draft) {
  const common = { id: draft.id, revision: draft.revision, chartDigest: draft.chartDigest, price: Number(draft.price), time: draft.time };
  return draft.kind === 'trendline' ? { ...common, kind: draft.kind, endTime: draft.endTime, endPrice: Number(draft.endPrice) } : common;
}
