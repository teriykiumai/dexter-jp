import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './primitives.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, DrawingHistoryResultSchema, type DrawingPage, type DrawingView } from '../drawing-contracts.js';
import { read, mutate, WorkspaceHttpError } from './workspace-http.js';
import type { WorkspaceChart } from '../workspace-contracts.js';
import type { ChartOverlay, TrendOverlay, TrendEditor } from './chart.js';

type Draft = { id: string; revision: number; chartDigest: string; kind: 'horizontal' | 'trendline' | 'fibonacci'; price: string; time: string; endPrice: string; endTime: string };
type Command = { id: string; token: string };
export function HorizontalDrawings({ id, chart, interval, children }: { id: string; chart: WorkspaceChart; interval: 'day' | 'week' | 'month'; children: (lines: ChartOverlay[], trends: TrendOverlay[], editor?: TrendEditor) => ReactNode }) {
  const [page, setPage] = useState<DrawingPage | null>(null), [after, setAfter] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<{ item: DrawingView; chartDigest: string } | null>(null), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  const [message, setMessage] = useState('Drawingを読み込み中です。');
  const confirmationInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (review) confirmationInput.current?.focus(); }, [review]);
  const priceInput = useRef<HTMLInputElement>(null), newButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true), inFlight = useRef(false);
  const [undo, setUndo] = useState<Command[]>([]), [redo, setRedo] = useState<Command[]>([]);
  const revisions = useRef(new Map<string, { revision: number; state: string }>());
  const url = `/api/workspace/instruments/${id}/drawings`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setFailed(false); setPage(null); setReview(null); setConfirmed(false);
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
      time: item?.time ?? (kind !== 'horizontal' ? chart.intervals.day.at(-2)!.displayDate : last.displayDate),
      endTime: item && item.kind !== 'horizontal' ? item.endTime : last.displayDate,
      endPrice: String(item && item.kind !== 'horizontal' ? item.endPrice : last.close) });
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
      if (alive.current && error instanceof WorkspaceHttpError && error.status === 400) {
        setMessage('入力が受け付けられませんでした。日付の順序・営業日・価格を確認して修正してください。下書きは保持しています。');
      } else if (alive.current) { setFailed(true); setMessage(error instanceof WorkspaceHttpError && error.status === 409
        ? '保存競合またはbasis確認が必要です。入力は未保存のまま保持しています。保存状態を再読込し、キャンセル後に選び直してください。'
        : '保存結果を確認できません。入力を保持しています。自動再送せず、保存状態を再読込してください。'); }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function acceptBasis() {
    if (!review || !confirmed || !matching || inFlight.current || review.chartDigest !== chart.artifactDigest) return;
    inFlight.current = true; setBusy(true);
    const item = review.item;
    try {
      const saved = await mutate(url + '/' + item.id, { action: 'accept_basis', revision: item.revision,
        chartDigest: review.chartDigest, confirm: true }, DrawingSavedSchema);
      if (saved.id !== item.id || saved.instrumentId !== id || saved.revision !== item.revision + 1) throw new Error('Drawing response mismatch');
      if (alive.current) { record(saved.id, saved.historyToken, saved.revision, saved.historyState);
        setReview(null); setConfirmed(false); setReload(value => value + 1); newButton.current?.focus(); }
    } catch { if (alive.current) { setFailed(true); setMessage('basis承認の結果を確認できません。自動再送せず保存状態を再読込してください。'); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
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
  const trends: TrendOverlay[] = matching ? page!.items.flatMap(item => {
    const projection = item.projections[interval];
    if (item.kind === 'horizontal' || item.state !== 'compatible' || projection.state !== 'available') return [];
    const common = { id: item.id, time: projection.time, endTime: projection.endTime };
    return item.kind === 'trendline' ? [{ ...common, price: item.price, endPrice: item.endPrice }]
      : item.levels.map(level => ({ ...common, id: item.id + ':' + level.ratio, price: level.price, endPrice: level.price }));
  }) : [];
  const editor: TrendEditor | undefined = draft && draft.kind !== 'horizontal' && interval === 'day' && matching && !staleDraft && !busy ? {
    label: draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline', time: draft.time, price: Number(draft.price), endTime: draft.endTime, endPrice: Number(draft.endPrice),
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
        <Button ref={newButton} disabled={busy || !!draft || !!review || !matching || !chart.intervals.day.length} onClick={() => choose()}>Horizontal lineを作成</Button>
        <Button disabled={busy} onClick={() => { setUndo([]); setRedo([]); setReload(value => value + 1); }}>保存状態を再読込</Button>
      </div>
      <div className="design-actions">
        <Button disabled={busy || !!draft || !!review || !matching || chart.intervals.day.length < 2} onClick={() => choose(undefined, 'trendline')}>Trendlineを作成</Button>
        <Button disabled={busy || !!draft || !!review || !matching || chart.intervals.day.length < 2} onClick={() => choose(undefined, 'fibonacci')}>Fibonacciを作成</Button>
        <Button disabled={busy || !!draft || !!review || !matching || !undo.length} onClick={() => void replay('undo')}>元に戻す</Button>
        <Button disabled={busy || !!draft || !!review || !matching || !redo.length} onClick={() => void replay('redo')}>やり直す</Button>
      </div>
      <p>undo/redoはこの画面の確定操作を最大100件保持します。再読込・画面移動・server restartで操作履歴は終了します。保存済みDrawingは残ります。</p>
      {interval !== 'day' ? <p>端点を含む週・月へ投影します。同じ足に端点が重なる場合は非表示です。ドラッグは日足で利用でき、日付・価格欄は全間隔で編集できます。</p> : null}
      <p role={failed ? 'alert' : 'status'}>{message}</p>
      {!matching && page ? <p role="alert">表示価格とDrawingの確認対象が異なります。価格と保存状態を再読込してください。線は表示していません。</p> : null}
      {staleDraft ? <p role="alert">編集中に価格が更新されました。入力を保持しています。キャンセル後に選び直してください。</p> : null}
      {review ? <section aria-label="basis確認" className="design-stack">
        <p>元の価格・日付を変更せず、表示中の価格basisとして承認します。分割後の価格への自動換算はしません。</p>
        <p>価格 {review.item.price} 円 / 日付 {review.item.time}{review.item.kind !== 'horizontal' ? <> → {review.item.endPrice} 円 / {review.item.endTime}</> : null}</p>
        <p>根拠期間 {review.item.evidenceFrom}–{review.item.evidenceThrough} / revision {review.item.revision}</p>
        <p className="design-metadata" data-kind="data">作成basis {review.item.basisDigest}</p>
        {review.item.acceptedBasis ? <p className="design-metadata" data-kind="data">前回承認basis {review.item.acceptedBasis.digest} / revision {review.item.acceptedBasis.revision}</p> : null}
        <p>表示中の日足終値 {chart.intervals.day.at(-1)?.close} 円 / {chart.intervals.day.at(-1)?.displayDate}</p>
        <p className="design-metadata" data-kind="data">承認対象 {review.chartDigest}</p>
        <label><input ref={confirmationInput} type="checkbox" checked={confirmed} disabled={busy || failed} onChange={event => setConfirmed(event.target.checked)} />価格を自動換算せず現在のbasisとして扱うことを確認しました</label>
        <div className="design-actions"><Button disabled={!confirmed || busy || !matching || review.chartDigest !== chart.artifactDigest} onClick={() => void acceptBasis()}>このbasisを承認</Button>
          <Button disabled={busy} onClick={() => { setReview(null); setConfirmed(false); newButton.current?.focus(); }}>basis確認をキャンセル</Button></div>
      </section> : null}
      {draft ? <form className="design-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p>未保存 {draft.revision ? '編集' : '新規'} / revision {draft.revision}</p>
        <label className="design-field">{draft.kind === 'horizontal' ? 'Horizontal価格（円・調整後）' : `${draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'}始点価格（円・調整後）`}<input ref={priceInput} type="number" min="0.00000001" step="any" required value={draft.price} disabled={busy}
          onChange={event => setDraft({ ...draft, price: event.target.value })} /></label>
        <label className="design-field">{draft.kind === 'horizontal' ? 'Horizontal基準日（日足）' : `${draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'}始点日（日足）`}<input type="date" required value={draft.time} disabled={busy}
          onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
        {draft.kind !== 'horizontal' ? <>
          <label className="design-field">{draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'}終点価格（円・調整後）<input type="number" min="0.00000001" step="any" required value={draft.endPrice} disabled={busy} onChange={event => setDraft({ ...draft, endPrice: event.target.value })} /></label>
          <label className="design-field">{draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'}終点日（日足）<input type="date" required value={draft.endTime} disabled={busy} onChange={event => setDraft({ ...draft, endTime: event.target.value })} /></label>
          <p>日足チャートの端点をドラッグして編集できます。Escapeでドラッグを取り消します。日付・価格欄でも同じ端点を編集できます。</p>
        </> : null}
        <p>作成時の根拠期間を保持します。編集の基準日はその期間内の日足を指定してください。</p>
        <div className="design-actions"><Button type="submit" disabled={busy || !matching || staleDraft}>{draft.kind === 'horizontal' ? 'Horizontalを保存' : `${draft.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'}を保存`}</Button>
          <Button disabled={busy} onClick={() => { setDraft(null); setMessage('編集をキャンセルしました。'); newButton.current?.focus(); }}>編集をキャンセル</Button></div>
      </form> : null}
      <ul aria-label="保存済みDrawing">{page?.items.map(item => <li key={item.id}>
        <p>{item.price} 円 / 基準日 {item.time} / revision {item.revision} / {item.state === 'compatible' ? 'basis互換' : 'basis_review_required（保持・非表示）'}</p>
        {item.kind !== 'horizontal' ? <p>終点 {item.endPrice} 円 / {item.endTime}</p> : null}
        {item.kind === 'fibonacci' ? <p>Fibonacci（0＝始点、1＝終点）：{item.levels.map(level => <span key={level.ratio}> {level.ratio}：{level.price} 円 </span>)}</p> : null}
        {item.projections[interval].state === 'unavailable' ? <p>投影不可：{item.projections[interval].reason}（アンカー保持）</p> : null}
        {item.acceptedBasis ? <p>basis承認 revision {item.acceptedBasis.revision}</p> : null}
        <p>根拠期間 {item.evidenceFrom}–{item.evidenceThrough}</p>
        <div className="design-actions"><Button aria-pressed={selected === item.id} disabled={busy || !!draft || !!review || !matching || item.state !== 'compatible'} onClick={() => choose(item)}>{item.kind === 'horizontal' ? 'Horizontal' : item.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'} {item.id.slice(0, 8)} を選択・編集</Button>
          <Button variant="destructive" disabled={busy || !!draft || !!review || failed} onClick={() => void remove(item)}>{item.kind === 'horizontal' ? 'Horizontal' : item.kind === 'fibonacci' ? 'Fibonacci' : 'Trendline'} {item.id.slice(0, 8)} を削除</Button></div>
        {item.state === 'basis_review_required' ? <Button disabled={busy || !!draft || !!review || !matching} onClick={() => { setReview({ item, chartDigest: chart.artifactDigest }); setConfirmed(false); }}>basisを確認 {item.id.slice(0, 8)}</Button> : null}
      </li>)}</ul>
      {page && !page.items.length ? <p>保存済みDrawingはありません。</p> : null}
      {after || page?.next ? <div className="design-actions"><Button disabled={busy || !!draft || !!review || !after} onClick={() => setAfter(undefined)}>最初の100件</Button>
        <Button disabled={busy || !!draft || !!review || !page?.next} onClick={() => setAfter(page!.next!)}>次の100件</Button></div> : null}
    </section>
    {children(lines, trends, editor)}
  </>;
}

function writeDraft(draft: Draft) {
  const common = { id: draft.id, revision: draft.revision, chartDigest: draft.chartDigest, price: Number(draft.price), time: draft.time };
  return draft.kind !== 'horizontal' ? { ...common, kind: draft.kind, endTime: draft.endTime, endPrice: Number(draft.endPrice) } : common;
}
