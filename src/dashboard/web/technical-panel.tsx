import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnalysisSnapshot } from '../../analysis/snapshot/schema.js';
import type { MarketDataJobViewV1 } from '../../analysis/market-data/job-schema.js';
import type { MarketDataActiveJobV1 } from '../../analysis/market-data/job-service.js';
import { Button, Card, TableScroll } from './primitives.js';
import { LIGHTWEIGHT_CHARTS_NOTICE, PriceChart } from './chart.js';
import { selectedTechnicalSource, snapshotChartDate, technicalPath, technicalSelection, technicalValue,
  type TechnicalLatest } from './technical.js';
import type { DashboardSessionV1 } from './strategy-validation.js';

let pageReadFailure = false;
const panePreferences = new Map<string, string[]>();
class TechnicalReadError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter: string | null = null) { super(code); }
}
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok) throw new TechnicalReadError(response.status, payload?.error?.code ?? 'invalid_response', response.headers.get('retry-after'));
  return payload as T;
}
const terminal = (job: MarketDataJobViewV1) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status);
async function readLatest(ticker: string, signal: AbortSignal): Promise<TechnicalLatest> {
  const value = await json<TechnicalLatest>(`/api/market-data/technical/${ticker}/latest`, { signal });
  if (value.schemaVersion !== 'technical_latest_response_v1' || value.artifact?.ticker !== ticker
    || value.artifact.dataDate !== value.artifact.series?.day?.at(-1)?.displayDate) {
    throw new TechnicalReadError(500, 'invalid_response');
  }
  return value;
}

export function TechnicalPanel({ snapshot, comparison, navigationRevision, children }: {
  snapshot: AnalysisSnapshot; comparison: boolean; navigationRevision: number; children: ReactNode;
}) {
  const ticker = snapshot.canonicalTicker;
  const [selection, setSelection] = useState(() => technicalSelection(window.location.search));
  const [latest, setLatest] = useState<TechnicalLatest | null>(null);
  const [loading, setLoading] = useState(!comparison);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeReady, setActiveReady] = useState(false);
  const [job, setJob] = useState<MarketDataJobViewV1 | null>(null);
  const [blocked, setBlocked] = useState<string | null>(pageReadFailure ? '状態確認に失敗しました。ページ全体を再読み込みしてください。' : null);
  const [collapsed, setCollapsed] = useState<string[]>(() => panePreferences.get(ticker) ?? []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const mounted = useRef(true), scope = useRef(0), adoption = useRef<number | null>(null);
  const readToken = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scope.current++; readToken.current++; }; }, []);
  useEffect(() => { scope.current++; setSelection(technicalSelection(window.location.search)); }, [navigationRevision, ticker, comparison, snapshot.generatedAt]);
  useEffect(() => {
    if (job?.status !== 'completed' || adoption.current !== scope.current || comparison) return;
    const controller = new AbortController(), captured = scope.current, token = ++readToken.current;
    adoption.current = null;
    void readLatest(ticker, controller.signal).then(value => {
      if (controller.signal.aborted || captured !== scope.current || token !== readToken.current) return;
      setLatest(value); setWarning(null); setLoading(false);
      window.history.replaceState(window.history.state ?? {}, '', technicalPath(window.location.search, 'chartSource', 'latest'));
      setSelection(technicalSelection(window.location.search));
    }).catch(() => { if (!controller.signal.aborted && captured === scope.current) setWarning('更新後の読み込みに失敗しました。直前の表示を維持しています。'); });
    return () => controller.abort();
  }, [job, ticker, comparison]);

  useEffect(() => {
    const controller = new AbortController(), token = ++readToken.current;
    setLatest(null); setWarning(null); setLoading(!comparison);
    if (!comparison) void readLatest(ticker, controller.signal)
      .then(value => { if (token === readToken.current && !controller.signal.aborted) setLatest(value); })
      .catch(error => { if (controller.signal.aborted || token !== readToken.current) return;
        if (!(error instanceof TechnicalReadError && error.status === 404)) setWarning('保存済み最新データを検証できませんでした。Snapshotへのフォールバックは自動モードのみです。');
      }).finally(() => { if (token === readToken.current && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticker, comparison]);
  useEffect(() => {
    if (pageReadFailure) return;
    const controller = new AbortController();
    void json<MarketDataActiveJobV1>('/api/market-data/jobs/active', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setJob(value.marketJob);
      setActiveReady(true);
      setBlocked(value.blockingKind ? '戦略検証ジョブが実行中です。完了後にこのタブへ戻ってください。' : null);
    }).catch(() => { if (!controller.signal.aborted) { pageReadFailure = true; setBlocked('状態確認に失敗しました。ページ全体を再読み込みしてください。'); } });
    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    if (!job || terminal(job) || busy || pageReadFailure) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void json<MarketDataJobViewV1>(`/api/market-data/jobs/${job.jobId}`, { signal: controller.signal }).then(next => {
        if (controller.signal.aborted) return;
        setJob(next);
      }).catch(() => { if (!controller.signal.aborted) { pageReadFailure = true; setBlocked('ジョブ状態を確認できません。再試行せずページ全体を再読み込みしてください。'); } });
    }, 2000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [job, busy, ticker, comparison]);

  function choose(key: 'chartSource' | 'interval', value: string) {
    scope.current++; adoption.current = null;
    window.history.pushState(window.history.state ?? {}, '', technicalPath(window.location.search, key, value));
    setSelection(technicalSelection(window.location.search)); setSelectedDate(null);
  }
  async function mutate(cancel = false) {
    if (busy || blocked || pageReadFailure || comparison || !activeReady) return;
    const captured = scope.current;
    setBusy(true); setWarning(null);
    try {
      const session = await json<DashboardSessionV1>('/api/session');
      if (!mounted.current || captured !== scope.current) return;
      const headers = { [session.csrfHeader]: session.csrfToken, 'Content-Type': 'application/json' };
      if (cancel && job) {
        const next = await json<MarketDataJobViewV1>(`/api/market-data/jobs/${job.jobId}`, { method: 'DELETE', headers });
        if (mounted.current && captured === scope.current) setJob(next);
      } else {
        const accepted = await json<{ jobId: string }>('/api/market-data/technical/jobs', { method: 'POST', headers, body: JSON.stringify({ ticker }) });
        if (!mounted.current || captured !== scope.current) return;
        adoption.current = captured;
        try {
          const next = await json<MarketDataJobViewV1>(`/api/market-data/jobs/${accepted.jobId}`);
          if (mounted.current && captured === scope.current) setJob(next);
        } catch { if (mounted.current && captured === scope.current) { pageReadFailure = true; setBlocked('受付後のジョブ状態を確認できません。ページ全体を再読み込みしてください。'); } }
      }
    } catch (error) {
      if (!mounted.current || captured !== scope.current) return;
      if (error instanceof TechnicalReadError && error.status < 500) setWarning(error.status === 409 && error.retryAfter && /^\d+$/.test(error.retryAfter)
        ? `J-Quantsの通信間隔を確保するため、あと ${error.retryAfter} 秒待って再度実行してください。ジョブは未受付です。`
        : `受付できませんでした (${error.code})。再操作は明示的に行ってください。`);
      else { pageReadFailure = true; setBlocked('更新操作の成否を確認できません。再送せずページ全体を再読み込みしてください。'); }
    } finally { if (mounted.current) setBusy(false); }
  }
  const selected = selectedTechnicalSource(selection.source, snapshotChartDate(snapshot), latest, comparison);
  const candles = latest?.artifact.series[selection.interval] ?? [];
  const bars = useMemo(() => candles.map(row => ({ date: row.displayDate, open: row.open, high: row.high,
    low: row.low, close: row.close, volume: row.volume })), [candles]);
  const unavailableDates = useMemo(() => latest?.artifact.unavailablePeriods
    .filter(row => row.interval === selection.interval).map(row => row.periodStart) ?? [], [latest, selection.interval]);
  const activeCandle = candles.find(row => row.displayDate === selectedDate) ?? candles.at(-1);
  const noLines = useMemo(() => [], []);
  return <>
    <Card title="チャートのデータと更新">
      <div className="design-actions">
        <label className="design-field">データソース<select value={selection.source} disabled={comparison} onChange={event => choose('chartSource', event.target.value)}>
          <option value="auto">自動（基準日比較）</option><option value="snapshot">保存済みSnapshot</option><option value="latest">保存済み最新データ</option>
        </select></label>
        <label className="design-field">足種<select value={selection.interval} onChange={event => choose('interval', event.target.value)}>
          <option value="day">日足</option><option value="week">週足</option><option value="month">月足</option>
        </select></label>
        <Button disabled={comparison || busy || !activeReady || !!blocked || !!job && !terminal(job)} onClick={() => void mutate()}>最新EODを取得</Button>
        {job && !terminal(job) ? <Button disabled={busy || !!blocked || comparison} onClick={() => void mutate(true)}>更新をキャンセル</Button> : null}
      </div>
      <p>J-Quants Standard以上が必要です。取得ボタンは外部通信を開始し、API quotaを消費します。最大20 HTTP試行・600秒。Dashboard内の戦略検証と通信枠を共有します。CLI・別processとのアカウント全体の通信調整は行いません。</p>
      {comparison ? <p>Snapshot比較中：選択中の保存済みSnapshotだけを表示します。外部更新は無効です。</p> : null}
      {loading ? <p role="status">保存済み最新データを確認中です。</p> : null}
      {warning ? <p role="status">警告: {warning}</p> : null}
      {blocked ? <p role="alert">{blocked}</p> : null}
      {job ? <p role="status">更新ジョブ{blocked ? '（最終確認時点・現在の状態は未確認）' : ''}: {job.kind} / 対象 {job.target?.kind === 'technical' ? job.target.ticker : '全市場'} / {job.status}{job.failure ? ` / ${job.failure.code}` : ''}</p> : null}
      {job?.result?.kind === 'technical' && job.result.warningCodes.length ? <p role="status">ジョブ警告: {job.result.warningCodes.join(' / ')}</p> : null}
      <p>表示ソース: {selected === 'latest' ? 'J-Quants 保存済みTechnical artifact' : selected === 'snapshot' ? '保存済みSnapshot' : '利用不可'} / データ基準日: {selected === 'latest' ? latest?.artifact.dataDate : snapshotChartDate(snapshot) ?? '利用不可'}</p>
    </Card>
    {selected === 'snapshot' ? selection.interval === 'day' ? <>
      <p>RSI/MACDの時系列: series_not_collected（未収集）。指標・価格線はSnapshotに保存された値です。</p>{children}
    </> : <Card title="株価チャート"><p>source_interval_unavailable：Snapshotは日足のみです。</p>
      {!comparison ? <Button onClick={() => choose('chartSource', 'latest')}>保存済み最新データへ切り替え</Button> : null}</Card>
      : selected === 'latest' && latest ? <Card title="株価チャート" eyebrow="調整後OHLCV・RSI・MACD">
        <p>収集日時: <span className="design-data">{latest.artifact.fetchedAt}</span> / 確認日時: <span className="design-data">{latest.checkedAt}</span> / {latest.state}</p>
        <p>分配金再投資を含むtotal returnではありません。SnapshotのSMA/Swing価格線は重ねません。</p>
        {latest.warnings.map(item => <p key={item.code}>警告: {item.message}</p>)}
        <div className="design-actions">{(['volume', 'rsi', 'macd'] as const).map(pane => <Button key={pane} aria-pressed={!collapsed.includes(pane)} onClick={() => {
          const next = collapsed.includes(pane) ? collapsed.filter(value => value !== pane) : [...collapsed, pane];
          panePreferences.set(ticker, next); setCollapsed(next);
        }}>{pane.toUpperCase()} {collapsed.includes(pane) ? '展開' : '折り畳む'}</Button>)}</div>
        <PriceChart bars={bars} priceLines={noLines} describedBy="technical-exact-description" technical={{ candles, interval: selection.interval,
          unavailableDates, collapsed, selectedDate: activeCandle?.displayDate ?? null, onSelect: setSelectedDate }} />
        <p id="technical-exact-description">価格・出来高・RSI 14・MACD 12/26/9（signalは破線、histogramは棒）。進行中の足は指標対象外です。正確な値は下表で確認できます。</p>
        <label className="design-field">共有カーソル（矢印キーで選択）<select value={activeCandle?.displayDate ?? ''} onChange={event => setSelectedDate(event.target.value)}>
          {candles.map(row => <option key={row.identity} value={row.displayDate}>{row.identity}</option>)}
        </select></label>
        {activeCandle ? <p role="status">{activeCandle.identity} / {activeCandle.partial ? '進行中・不完全期間' : '完了期間'} / 始値 {activeCandle.open} / 高値 {activeCandle.high} / 安値 {activeCandle.low} / 終値 {activeCandle.close} JPY / 出来高 {activeCandle.volume} 株 / RSI {technicalValue(activeCandle.rsi)} / MACD {technicalValue(activeCandle.macd)} / signal {technicalValue(activeCandle.signal)} / histogram {technicalValue(activeCandle.histogram)}</p> : null}
        <TableScroll label="Technicalの正確な値"><table><caption>調整後OHLCV・RSI・MACD（全保存期間）</caption>
          <thead><tr>{['期間', '期間開始', '期間終了', '状態', '始値 JPY', '高値 JPY', '安値 JPY', '終値 JPY', '出来高 株', 'RSI', 'MACD JPY', 'signal JPY', 'histogram JPY', 'cross'].map((value, index) => <th key={value} className={index >= 4 && index < 13 ? 'numeric-cell' : undefined}>{value}</th>)}</tr></thead>
          <tbody>{candles.map(row => <tr key={row.identity}><th scope="row"><span className="design-data">{row.identity}</span></th><td><span className="design-data">{row.periodStart}</span></td><td><span className="design-data">{row.periodEnd}</span></td><td>{row.partial ? '不完全期間' : '完了期間'}</td>
            {(['open', 'high', 'low', 'close', 'volume'] as const).map(key => <td className="numeric-cell" key={key}>{row[key]}</td>)}
            {(['rsi', 'macd', 'signal', 'histogram', 'cross'] as const).map(key => <td key={key} className={key !== 'cross' && row[key].state === 'available' ? 'numeric-cell' : undefined}>{technicalValue(row[key])}</td>)}
          </tr>)}</tbody></table></TableScroll>
        <TableScroll label="描画できない期間"><table><caption>描画できない期間（補間なし）</caption><thead><tr><th>期間</th><th>開始</th><th>終了</th><th>理由</th></tr></thead><tbody>
          {latest.artifact.unavailablePeriods.filter(row => row.interval === selection.interval).map(row => <tr key={row.identity}><th>{row.identity}</th><td>{row.periodStart}</td><td>{row.periodEnd}</td><td>{row.reason === 'source_gap' ? '対象期間の全営業日が欠損' : '期間の一部のみ観測（取得部分はすべて欠損）'}</td></tr>)}
        </tbody></table></TableScroll>
        <p>{LIGHTWEIGHT_CHARTS_NOTICE.join(' / ')} <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></p>
      </Card> : (comparison || selection.source !== 'latest') && selection.interval === 'day'
        ? <><p>Snapshotチャートの基準日は利用不可です。描画せず、保存済みの正確な値だけを保持します。</p>{children}</>
        : <Card title="株価チャート"><p>選択したソースは未収集、または検証できません。明示的な最新モードではSnapshotへ代替しません。</p></Card>}
  </>;
}
