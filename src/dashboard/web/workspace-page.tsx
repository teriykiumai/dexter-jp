import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Button, Card, DashboardDesign, TableScroll } from './primitives.js';
import { PriceChart, LIGHTWEIGHT_CHARTS_NOTICE } from './chart.js';
import { buildMarketOverviewPath } from './presentation.js';
import { workspaceTerminal, WorkspaceJobViewSchema, type WorkspaceItem, type WorkspaceView, type WorkspaceJobView } from '../workspace-contracts.js';

const intervalNames = { day: '日足', week: '週足', month: '月足' } as const;
type Interval = keyof typeof intervalNames;
export function workspaceRoute(search: string) {
  const params = new URLSearchParams(search), id = params.get('instrument'), interval = params.get('interval') ?? 'day';
  if ([...params.keys()].some(key => !['instrument', 'interval'].includes(key)) || params.getAll('instrument').length > 1
    || params.getAll('interval').length > 1 || id !== null && !z.uuid().safeParse(id).success || !['day', 'week', 'month'].includes(interval)) return null;
  return { id, interval: interval as Interval };
}
const path = (id: string | null, interval: Interval) => `/workspace${id ? `?instrument=${encodeURIComponent(id)}&interval=${interval}` : ''}`;
async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init), value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? ({ identity_review_required: '銘柄の同一性確認が必要です。',
    revision_conflict: '別の操作で更新されました。ページを再読み込みしてください。', invalid_input: '入力またはJ-Quants設定を確認してください。'
  } as Record<string, string>)[value.error?.code] ?? '処理を確認できません。ページ全体を再読み込みしてください。');
  return value as T;
}
async function mutate<T>(url: string, body: unknown): Promise<T> {
  const session = await read<{ csrfToken: string }>('/api/workspace/session');
  return read(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken }, body: JSON.stringify(body) });
}
let jobReadFailed = false;

export function WorkspacePage() {
  const [route, setRoute] = useState(() => workspaceRoute(location.search));
  const [query, setQuery] = useState(''), [items, setItems] = useState<WorkspaceItem[]>([]), [recents, setRecents] = useState<WorkspaceItem[]>([]);
  const [revision, refresh] = useState(0), [job, setJob] = useState<WorkspaceJobView | null>(null);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(jobReadFailed);
  const [message, setMessage] = useState<string | null>(null), [blockingKind, setBlockingKind] = useState<string | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(!route?.id);
  const navigation = useRef(0);
  const navigate = (id: string | null, interval: Interval = 'day') => { navigation.current++; history.pushState(null, '', path(id, interval)); setRoute(workspaceRoute(location.search)); setSearchExpanded(!id); };
  useEffect(() => { const pop = () => { navigation.current++; const next = workspaceRoute(location.search); setRoute(next); setSearchExpanded(!next?.id); }; addEventListener('popstate', pop); return () => removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void read<{ items: WorkspaceItem[] }>(`/api/workspace/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setItems(value.items); }).catch(() => { if (!controller.signal.aborted) { setItems([]); setMessage('銘柄一覧を読み込めませんでした。'); } }); }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, revision]);
  useEffect(() => {
    const controller = new AbortController();
    void read<{ items: WorkspaceItem[] }>('/api/workspace/recents', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setRecents(value.items); })
      .catch(() => { if (!controller.signal.aborted) setMessage('最近開いた銘柄を読み込めませんでした。'); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (jobReadFailed) return;
    const controller = new AbortController();
    void read<{ job: WorkspaceJobView | null; blockingKind: string | null }>('/api/workspace/jobs/active', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setJob(value.job === null ? null : WorkspaceJobViewSchema.parse(value.job)); setBlockingKind(value.blockingKind); setReady(true); } })
      .catch(() => { if (!controller.signal.aborted) { jobReadFailed = true; setBlocked(true); } });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!job || workspaceTerminal(job) || blocked) return;
    let timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    const schedule = () => {
      clearTimeout(timer); request?.abort();
      if (document.visibilityState !== 'visible') return;
      timer = setTimeout(() => {
        const current = new AbortController(); request = current;
        void read<WorkspaceJobView>(`/api/workspace/jobs/${job.id}`, { signal: current.signal }).then(next => {
          if (current.signal.aborted) return;
          WorkspaceJobViewSchema.parse(next);
          if (next.id !== job.id || next.kind !== job.kind || next.instrumentId !== job.instrumentId) throw new Error('Job identity mismatch');
          setJob(next); if (workspaceTerminal(next)) { refresh(value => value + 1); if (next.state !== 'published') setMessage(next.state === 'identity_review_required'
            ? '銘柄の同一性確認が必要なため更新できません。保存済みデータを表示します。' : '取得は完了しませんでした。保存済みデータを確認してください。'); }
        }).catch(() => { if (!current.signal.aborted) { jobReadFailed = true; setBlocked(true); } });
      }, 1000);
    };
    document.addEventListener('visibilitychange', schedule); schedule();
    return () => { clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', schedule); };
  }, [job, blocked]);
  async function start(kind: 'catalog' | 'technical') {
    if (busy || blocked || !ready || job && !workspaceTerminal(job)) return;
    setBusy(true); setMessage(null);
    try { const next = await mutate<WorkspaceJobView>('/api/workspace/jobs', kind === 'catalog' ? { kind } : { kind, instrumentId: route?.id });
      WorkspaceJobViewSchema.parse(next);
      if (next.kind !== kind || kind === 'technical' && next.instrumentId !== route?.id) throw new Error('受付結果を確認できません。ページ全体を再読み込みしてください。');
      setJob(next); if (workspaceTerminal(next)) refresh(value => value + 1);
    } catch (error) { jobReadFailed = true; setBlocked(true); setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    const token = ++navigation.current;
    try { await mutate(`/api/workspace/instruments/${id}/open`, {}); if (token !== navigation.current) return; navigate(id); refresh(value => value + 1); }
    catch (error) { setMessage((error as Error).message); }
  }
  const disabled = busy || blocked || !ready || !!blockingKind || !!job && !workspaceTerminal(job);
  return <DashboardDesign>
    <header className="dashboard-page-header"><div className="design-content dashboard-header-content">
      <span className="dashboard-wordmark">DEXTER / JP</span><nav className="dashboard-page-nav" aria-label="共通ナビゲーション">
        <a href="/workspace" aria-current="page">銘柄Workspace</a><a href="/">保存済み分析</a><a href={buildMarketOverviewPath('')}>市場概況</a>
      </nav></div></header>
    <main className="design-content design-stack">
      <h1>Stock Workspace</h1>
      <div className="design-actions"><Button aria-expanded={searchExpanded} aria-controls="workspace-search" onClick={() => setSearchExpanded(!searchExpanded)}>銘柄検索・最近開いた銘柄</Button></div>
      <div id="workspace-search" hidden={!searchExpanded}><Card title="普通株を検索"><div className="design-stack">
        <label className="design-field">銘柄名・証券コード<input type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
        <div className="design-actions"><Button disabled={disabled} onClick={() => void start('catalog')}>銘柄一覧を取得・更新</Button></div>
        <p>取得ボタンを押すとJ-Quantsへ通信します。検索・表示切替では通信しません。</p>
        {items.length ? <ul>{items.map(item => <li key={item.instrumentId}><Button onClick={() => void open(item.instrumentId)}>{item.code} {item.label}</Button></li>)}</ul> : <p>一致する銘柄がありません。未取得の場合は銘柄一覧を取得してください。</p>}
        {recents.length ? <nav aria-label="お気に入り・最近開いた銘柄"><h2>お気に入り・最近開いた銘柄</h2><ul>{recents.map(item => <li key={item.instrumentId}>
          <Button onClick={() => void open(item.instrumentId)}>{item.favorite ? 'お気に入り / ' : ''}{item.code} {item.label}</Button></li>)}</ul></nav> : null}
      </div></Card></div>
      {blocked ? <p role="alert">ジョブ状態の確認を停止しました。再送せずページ全体を再読み込みしてください。</p> : null}
      {blockingKind ? <p role="status">他のデータジョブが実行中です。完了後にページを再読み込みしてください。</p> : null}
      {job ? <p role="status">{job.kind === 'catalog' ? '銘柄一覧' : `日足価格${job.instrumentId !== route?.id ? '（別の銘柄）' : ''}`}: {job.state}</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      {!route ? <p role="alert">Workspace URLが不正です。</p> : route.id ? <WorkspaceInstrument key={route.id} id={route.id} interval={route.interval}
        revision={revision} navigate={interval => navigate(route.id, interval)} disabled={disabled} acquire={() => void start('technical')} onFavorite={() => refresh(value => value + 1)} /> : <p>普通株を選択してWorkspaceを開いてください。Snapshot・LLM API keyは不要です。</p>}
    </main>
  </DashboardDesign>;
}

function WorkspaceInstrument({ id, interval, revision, navigate, disabled, acquire, onFavorite }: {
  id: string; interval: Interval; revision: number; navigate: (interval: Interval) => void; disabled: boolean; acquire: () => void; onFavorite: () => void;
}) {
  const [view, setView] = useState<WorkspaceView | null>(null), [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]), [sma, setSma] = useState(true), [selected, setSelected] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const initialFocus = useRef(true);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    void read<WorkspaceView>(`/api/workspace/instruments/${id}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) {
        if (value.schemaVersion !== 'workspace_view_v1' || value.item.instrumentId !== id) throw new Error('銘柄の読込結果が一致しません。');
        setView(value); if (initialFocus.current) { initialFocus.current = false; heading.current?.focus(); }
      }
    }).catch(error => { if (!controller.signal.aborted) { setView(null); setError((error as Error).message); } });
    return () => controller.abort();
  }, [id, revision]);
  const rows = useMemo(() => view?.chart?.intervals[interval] ?? [], [view?.chart, interval]);
  const gaps = useMemo(() => view?.chart?.unavailablePeriods.filter(period => period.interval === interval && period.reason === 'source_gap') ?? [], [view?.chart, interval]);
  const bars = useMemo(() => rows.map(row => ({ date: row.displayDate, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume })), [rows]);
  const gapDates = useMemo(() => gaps.map(gap => gap.periodStart), [gaps]);
  const smaRows = useMemo(() => sma ? rows.map(row => ({ date: row.displayDate, value: row.sma20.state === 'available' ? row.sma20.value : null })) : [], [sma, rows]);
  const page = Math.min(tablePage, Math.max(0, Math.ceil(rows.length / 100) - 1)), end = rows.length - page * 100;
  const tableRows = rows.slice(Math.max(0, end - 100), end);
  const toggle = (pane: string) => setCollapsed(current => current.includes(pane) ? current.filter(value => value !== pane) : [...current, pane]);
  const indicator = (value: { state: string; value?: number; reason?: string }) => value.state === 'available' ? value.value : `利用不可 (${value.reason})`;
  async function favorite() {
    if (!view) return;
    try { const item = await mutate<WorkspaceItem>(`/api/workspace/instruments/${id}/favorite`, { favorite: !view.item.favorite, revision: view.item.revision }); setView({ ...view, item }); onFavorite(); }
    catch (error) { setError((error as Error).message); }
  }
  return <section className="design-stack">
    <h2 tabIndex={-1} ref={heading}>{view ? `${view.item.code} ${view.item.label}` : 'Workspaceを読み込み中'}</h2>
    {error ? <p role="alert">{error}</p> : null}
    <div className="design-actions"><Button disabled={disabled || !view} onClick={acquire}>日足データを取得・更新</Button>
      {view?.item.revision ? <Button aria-pressed={!!view.item.favorite} onClick={() => void favorite()}>お気に入り</Button> : null}</div>
    {view && !view.chart ? <p>価格データは未取得です。日足データを明示取得してください。</p> : null}
    {view?.chart ? <Card title="価格・出来高"><div className="design-stack">
      <p>J-Quants / 日次 / データ日 {view.chart.dataDate} / identity確認済み価格の開始日 {view.chart.eligibilityFrom}</p>
      <p>調整後価格・出来高。配当込みリターンではありません。日付をまたぐ銘柄の継続性は未確認のため、別日更新は停止します。</p>
      <div className="design-actions"><label className="design-field">表示間隔<select value={interval} onChange={event => navigate(event.target.value as Interval)}>
        {Object.entries(intervalNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <Button aria-pressed={sma} onClick={() => setSma(!sma)}>SMA 20</Button>
        {['volume', 'rsi', 'macd'].map(pane => <Button key={pane} aria-pressed={!collapsed.includes(pane)} onClick={() => toggle(pane)}>{pane === 'volume' ? '出来高' : pane.toUpperCase()}</Button>)}
      </div>
      <p id="workspace-chart-description">ローソク足と出来高。進行中の週・月は未確定、indicatorは確定足のみ。source不足は別状態で表示します。</p>
      <PriceChart bars={bars} priceLines={[]} describedBy="workspace-chart-description" technical={{ candles: rows, interval, collapsed,
        selectedDate: selected, onSelect: setSelected, unavailableDates: gapDates, sma20: smaRows }} />
      <p>{LIGHTWEIGHT_CHARTS_NOTICE.join(' / ')}</p>
      <p>確定indicator対象日: {rows.filter(row => !row.partial).at(-1)?.lastSessionDate ?? '利用不可'}</p>
      {rows.length > 100 ? <div className="design-actions" aria-label="正確な値の表示範囲">
        <Button disabled={end <= 100} onClick={() => setTablePage(page + 1)}>古い100行</Button>
        <span>{Math.max(1, end - 99)}–{end} / {rows.length}行</span>
        <Button disabled={page === 0} onClick={() => setTablePage(page - 1)}>新しい100行</Button>
      </div> : null}
      <TableScroll label="価格とindicatorの正確な値"><table><thead><tr>{['日付', '足の状態', 'source範囲', '始値 (円)', '高値 (円)', '安値 (円)', '終値 (円)', '出来高 (株)', 'SMA 20', 'RSI', 'MACD', 'Signal', 'Histogram'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{tableRows.map(row => <tr key={row.displayDate}><td>{row.displayDate}</td><td>{row.completion === 'ongoing' ? '未確定（進行中）' : '確定'}</td>
          <td>{row.sourceGaps.length ? `source不足: ${row.sourceGaps.join(', ')}` : row.coverage === 'history_coverage_clipped' ? '履歴範囲不足' : '充足'}</td>
          {[row.open, row.high, row.low, row.close, row.volume, indicator(row.sma20), indicator(row.rsi), indicator(row.macd), indicator(row.signal), indicator(row.histogram)].map((value, index) => <td className={typeof value === 'number' ? 'numeric-cell' : undefined} key={index}>{value}</td>)}</tr>)}</tbody></table></TableScroll>
      {gaps.length ? <ul aria-label="source不足の期間">{gaps.map(gap => <li key={gap.identity}>{gap.periodStart}–{gap.periodEnd}: source不足（価格利用不可）</li>)}</ul> : null}
    </div></Card> : null}
  </section>;
}
