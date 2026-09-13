import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './primitives.js';
import { DrawingPageSchema, DrawingSavedSchema, DrawingDeletedSchema, type DrawingPage, type HorizontalView } from '../drawing-contracts.js';
import { read, mutate, WorkspaceHttpError } from './workspace-http.js';
import type { WorkspaceChart } from '../workspace-contracts.js';
import type { ChartOverlay } from './chart.js';

type Draft = { id: string; revision: number; chartDigest: string; price: string; time: string };
export function HorizontalDrawings({ id, chart, children }: { id: string; chart: WorkspaceChart; children: (lines: ChartOverlay[]) => ReactNode }) {
  const [page, setPage] = useState<DrawingPage | null>(null), [after, setAfter] = useState<string | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  const [message, setMessage] = useState('Drawingを読み込み中です。');
  const priceInput = useRef<HTMLInputElement>(null), newButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true), inFlight = useRef(false);
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
  const lines = useMemo<ChartOverlay[]>(() => matching ? page!.items.filter(item => item.state === 'compatible').map(item => ({
    price: item.price, label: `Horizontal ${item.id.slice(0, 8)}${selected === item.id ? ' 選択中' : ''}`,
    colorToken: '--color-chart-price',
  })) : [], [page, matching, selected]);
  const choose = (item?: HorizontalView) => {
    const last = chart.intervals.day.at(-1);
    if (!last) return;
    setSelected(item?.id ?? null);
    setDraft({ id: item?.id ?? crypto.randomUUID(), revision: item?.revision ?? 0, chartDigest: chart.artifactDigest,
      price: String(item?.price ?? last.close), time: item?.time ?? last.displayDate });
    setMessage('未保存。数値を確認して保存してください。');
    queueMicrotask(() => priceInput.current?.focus());
  };
  async function save() {
    if (!draft || inFlight.current || !matching || staleDraft) return;
    inFlight.current = true; setBusy(true);
    const submitted = draft;
    try {
      const saved = await mutate(submitted.revision ? `${url}/${submitted.id}` : url,
        { ...submitted, price: Number(submitted.price) }, DrawingSavedSchema, submitted.revision ? 'PUT' : 'POST');
      if (saved.instrumentId !== id || saved.id !== submitted.id || saved.revision !== submitted.revision + 1) throw new Error('Drawing response mismatch');
      if (alive.current) { setDraft(null); setSelected(saved.id); setAfter(undefined); setReload(value => value + 1); setMessage('保存しました。'); newButton.current?.focus(); }
    } catch (error) {
      if (alive.current) { setFailed(true); setMessage(error instanceof WorkspaceHttpError && error.status === 409
        ? '保存競合またはbasis確認が必要です。入力は未保存のまま保持しています。保存状態を再読込し、キャンセル後に選び直してください。'
        : '保存結果を確認できません。入力を保持しています。自動再送せず、保存状態を再読込してください。'); }
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function remove(item: HorizontalView) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const deleted = await mutate(`${url}/${item.id}`, { revision: item.revision }, DrawingDeletedSchema, 'DELETE');
      if (deleted.instrumentId !== id || deleted.id !== item.id) throw new Error('Drawing response mismatch');
      if (alive.current) { setSelected(null); setReload(value => value + 1); setMessage('削除しました。'); newButton.current?.focus(); }
    } catch { if (alive.current) { setFailed(true); setMessage('削除結果を確認できません。保存状態を再読込してください。'); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <>
    <section className="design-stack" aria-label="Horizontal Drawing">
      <h3>Horizontal line</h3>
      <p>手動の価格メモです。売買推奨ではありません。日足の基準日・調整後価格を保存し、日・週・月で同じ価格を表示します。</p>
      <p>一覧は最大100件です。表示中の一覧でbasis互換を確認できた線だけをチャートに表示します。</p>
      <div className="design-actions">
        <Button ref={newButton} disabled={busy || !!draft || !matching || !chart.intervals.day.length} onClick={() => choose()}>Horizontal lineを作成</Button>
        <Button disabled={busy} onClick={() => setReload(value => value + 1)}>保存状態を再読込</Button>
      </div>
      <p role={failed ? 'alert' : 'status'}>{message}</p>
      {!matching && page ? <p role="alert">表示価格とDrawingの確認対象が異なります。価格と保存状態を再読込してください。線は表示していません。</p> : null}
      {staleDraft ? <p role="alert">編集中に価格が更新されました。入力を保持しています。キャンセル後に選び直してください。</p> : null}
      {draft ? <form className="design-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p>未保存 {draft.revision ? '編集' : '新規'} / revision {draft.revision}</p>
        <label className="design-field">Horizontal価格（円・調整後）<input ref={priceInput} type="number" min="0.00000001" step="any" required value={draft.price} disabled={busy}
          onChange={event => setDraft({ ...draft, price: event.target.value })} /></label>
        <label className="design-field">Horizontal基準日（日足）<input type="date" required value={draft.time} disabled={busy}
          onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
        <p>作成時の根拠期間を保持します。編集の基準日はその期間内の日足を指定してください。</p>
        <div className="design-actions"><Button type="submit" disabled={busy || !matching || staleDraft}>Horizontalを保存</Button>
          <Button disabled={busy} onClick={() => { setDraft(null); setMessage('編集をキャンセルしました。'); newButton.current?.focus(); }}>編集をキャンセル</Button></div>
      </form> : null}
      <ul aria-label="保存済みHorizontal">{page?.items.map(item => <li key={item.id}>
        <p>{item.price} 円 / 基準日 {item.time} / revision {item.revision} / {item.state === 'compatible' ? 'basis互換' : 'basis_review_required（保持・非表示）'}</p>
        <p>根拠期間 {item.evidenceFrom}–{item.evidenceThrough}</p>
        <div className="design-actions"><Button aria-pressed={selected === item.id} disabled={busy || !!draft || !matching || item.state !== 'compatible'} onClick={() => choose(item)}>Horizontal {item.id.slice(0, 8)} を選択・編集</Button>
          <Button variant="destructive" disabled={busy || !!draft || failed} onClick={() => void remove(item)}>Horizontal {item.id.slice(0, 8)} を削除</Button></div>
      </li>)}</ul>
      {page && !page.items.length ? <p>保存済みHorizontalはありません。</p> : null}
      {after || page?.next ? <div className="design-actions"><Button disabled={busy || !!draft || !after} onClick={() => setAfter(undefined)}>最初の100件</Button>
        <Button disabled={busy || !!draft || !page?.next} onClick={() => setAfter(page!.next!)}>次の100件</Button></div> : null}
    </section>
    {children(lines)}
  </>;
}
