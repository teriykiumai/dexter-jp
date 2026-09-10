import { useEffect, useState } from 'react';
import type { EtfModuleArtifactV1 } from '../../analysis/market-data/etf-artifact.js';
import type { EtfRelativeRangeV1 } from '../../analysis/market-data/etf-series.js';
import type { MarketDataModuleViewV1 } from '../../analysis/market-data/overview-registry.js';
import { Button, Card, MetricGrid, StatusBadge, TableScroll } from './primitives.js';
import { EtfRelativeChart, LIGHTWEIGHT_CHARTS_NOTICE } from './chart.js';
import { MARKET_RANGES, elapsedCalendarDays, etfDirection, etfNumber, marketRange, marketRangePath } from './market-overview.js';
import { overviewJobTerminal, useOverviewRefresh } from './overview-refresh.js';

const moduleTitles = { etf_1321_eod: '1321 日経225連動ETF proxy', etf_1321_2633_relative: '1321 / 2633 JPY建てETF市場価格比較' } as const;
type CollectedModule = Exclude<MarketDataModuleViewV1, { state: 'not_implemented' }>;
function Metadata({ module, artifact }: { module: CollectedModule; artifact: EtfModuleArtifactV1 }) {
  return <div className="design-stack">
    <p>状態: {module.state} / dataDate: <span className="design-data">{artifact.dataDate}</span> / 経過暦日: {elapsedCalendarDays(artifact.dataDate)}日（Browserの現地日付との差・鮮度判定ではありません）</p>
    <p>fetchedAt（収集日時）: <span className="design-data">{artifact.fetchedAt}</span> / checkedAt（このpayloadの確認日時）: <span className="design-data">{module.checkedAt}</span></p>
    <p>source: {artifact.sourceId} / cadence: {artifact.cadence} / 単位: {artifact.displayUnit} / schema: {artifact.schemaVersion} / calculation: {artifact.calculationVersion}</p>
    <TableScroll label={`${moduleTitles[artifact.moduleId]}の出典`}><table><caption>保存済み入力の出典・revision</caption><thead><tr><th>役割</th><th>source</th><th>endpoint / registry</th><th>contract / mapping / revision</th></tr></thead>
      <tbody>{artifact.sourceInputs.map(input => <tr key={input.role}><th scope="row">{input.role}</th><td>{input.sourceId}</td>
        <td>{input.kind === 'provider' ? input.endpoint : input.registryId}</td><td>{input.sourceContractVersion} / {input.kind === 'provider' ? input.sourceMappingVersion : input.registryVersion} / {input.sourceRevisionIds.join(' / ')}</td></tr>)}</tbody></table></TableScroll>
  </div>;
}
function RelativeResult({ result }: { result: EtfRelativeRangeV1 }) {
  if (result.state === 'unavailable') return <p>選択期間は利用不可: {result.reason} / 共通取引日 {result.commonDateCount}件 / {result.rangeStart ?? '開始日なし'} ～ {result.rangeEnd ?? '終了日なし'}。補間や他期間への代替は行いません。</p>;
  return <>
    <p>{result.rangeStart} ～ {result.rangeEnd} / 最初の共通取引日 = 100（取得できた期間・設定来ではありません）</p>
    <p>{etfDirection(result)}</p>
    <p>期間変化率: 1321 {etfNumber(result.return1321Percent)}% / 2633 {etfNumber(result.return2633Percent)}% / 差 {etfNumber(result.differencePercentagePoints)} percentage points</p>
    <p>保存済み未丸め差: <span className="design-data">{String(result.differencePercentagePoints)}</span> percentage points。方向表示はこの未丸め差に基づきます。表示上0に丸められても同水準とは限りません。</p>
    <EtfRelativeChart result={result} describedBy="etf-chart-description" />
    <p id="etf-chart-description">1321は実線、2633は破線。共通取引日のみ・補間なし。チャートと同じ保存値を下表でキーボード操作により確認できます。</p>
    <TableScroll label="ETF比較の正確な値"><table><caption>共通取引日と正規化価格（表示は小数4桁まで・保存済み未丸め値を併記）</caption>
      <thead><tr><th>共通取引日</th><th className="numeric-cell">1321</th><th className="numeric-cell">2633</th><th className="numeric-cell">1321 未丸め値</th><th className="numeric-cell">2633 未丸め値</th></tr></thead>
      <tbody>{result.commonDates.map((date, index) => <tr key={date}><th scope="row"><span className="design-data">{date}</span></th>
        <td className="numeric-cell">{etfNumber(result.normalized1321[index]!)}</td><td className="numeric-cell">{etfNumber(result.normalized2633[index]!)}</td>
        <td className="numeric-cell">{String(result.normalized1321[index])}</td><td className="numeric-cell">{String(result.normalized2633[index])}</td></tr>)}</tbody></table></TableScroll>
    <p>{LIGHTWEIGHT_CHARTS_NOTICE.join(' / ')} <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></p>
  </>;
}
export function MarketOverviewPanel({ navigationRevision }: { navigationRevision: number }) {
  const refresh = useOverviewRefresh(navigationRevision);
  const [range, setRange] = useState(() => marketRange(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => { setRange(marketRange(window.location.search)); }, [navigationRevision]);
  const active = refresh.job && !overviewJobTerminal(refresh.job);
  return <div className="design-stack">
    <Card title="市場データと更新">
      <StatusBadge label="全市場共通" />
      <h3 ref={refresh.heading} tabIndex={-1}>保存済み市場データ</h3>
      <div className="design-actions"><Button ref={refresh.button} disabled={!refresh.ready || refresh.busy || !!refresh.blocked || !!active} onClick={() => void refresh.mutate()}>市場データを取得</Button>
        {active && refresh.job?.kind === 'overview_refresh' ? <Button disabled={refresh.busy || !!refresh.blocked || refresh.job.status === 'publishing' || refresh.job.status === 'cancel_requested'} onClick={() => void refresh.mutate(true)}>市場データ更新をキャンセル</Button> : null}</div>
      <p>J-Quants Standard以上が必要です。取得ボタンで実装済みETF 2項目の外部通信を開始し、API quotaを消費します。最大40 HTTP試行・40ページ・16,000行・64 MiB・600秒。戦略検証・Technical更新とDashboard内の通信枠を共有します。CLI・別processとのアカウント全体の通信調整は行いません。</p>
      <p>最小dispatch時間とExecution budgetは受付成立後の時間です。直前の通信から最大60秒は受付できず、手動再試行が必要です。</p>
      {refresh.loading ? <p role="status">保存済み市場データを読み込み中です。</p> : null}
      {refresh.warning || refresh.blocked ? <p ref={refresh.alert} role="alert" tabIndex={-1}>{refresh.blocked ?? refresh.warning}</p> : null}
      {refresh.job ? <p role="status">更新ジョブ{refresh.blocked ? '（最終確認時点・現在の状態は未確認）' : ''}: {refresh.job.kind} / 対象 {refresh.job.target.kind === 'technical' ? refresh.job.target.ticker : '全市場'} / {refresh.job.status} / 試行 {refresh.job.progress.attempts} / 完了項目 {refresh.job.progress.completedModules}/{refresh.job.progress.totalModules}{refresh.job.failure ? ` / ${refresh.job.failure.code}: ${refresh.job.failure.message}` : ''}</p> : null}
    </Card>
    {(['etf_1321_eod', 'etf_1321_2633_relative'] as const).map(id => {
      const module = refresh.data?.modules.find(item => item.moduleId === id);
      if (!module || module.state === 'not_implemented') return null;
      // The GET projects a server-validated ETF artifact; never import its I/O codec into the Browser.
      const artifact = module.payload as EtfModuleArtifactV1 | null;
      const result = refresh.job?.result?.kind === 'overview' ? refresh.job.result.moduleResults.find(item => item.moduleId === id) : null;
      return <Card key={id} title={moduleTitles[id]}>
        <div className="design-stack">
          {id === 'etf_1321_eod' ? <p>最新取得済みEOD。日経平均現物の現在値ではありません。</p> : <>
            <p>1321は日経225連動ETF proxy。2633は為替ヘッジなしのS&amp;P 500連動ETF proxyで、JPY市場価格にはUSD/JPY、東京・米国の取引時間差、連動誤差、費用、市場価格の影響を含みます。</p>
            <label className="design-field">ETF比較期間<select value={range} onChange={event => {
              const next = MARKET_RANGES.find(value => value === event.target.value)!;
              refresh.invalidate(); window.history.pushState(window.history.state ?? {}, '', marketRangePath(window.location.search, next)); setRange(next);
            }}>{MARKET_RANGES.map(value => <option key={value} value={value}>{value === 'max' ? 'Max' : value.toUpperCase()}</option>)}</select></label>
          </>}
          {id === 'etf_1321_eod' && artifact ? artifact.observations.map(row => 'adjustedCloseYen' in row ? <MetricGrid key={row.identity} metrics={
            ([['調整後終値 JPY', row.adjustedCloseYen], ['前回差 JPY', row.changeYen], ['前回差率 %', row.changeRatePercent]] as const).map(([label, value]) => ({
              label, valueKind: 'data', value: value.state === 'available' ? { text: etfNumber(value.value), available: true } : { text: `利用不可: ${value.reason}`, available: false },
            }))
          } /> : null) : null}
          <p>分配金を含まない調整後市場価格です。分配金再投資・ETF/指数のtotal returnではありません。選択期間の比較から将来予測・国全体の投資優位性・Buy/Sellを導きません。</p>
          {module.state === 'unavailable' ? <p>利用不可: {module.reason}（0ではありません）</p> : null}
          {module.state === 'fallback' ? <p>警告: 検証できないrevisionがあるため、直前のvalid artifactへフォールバックしています。</p> : null}
          {module.warnings.map(item => <p key={item.code}>警告: {item.message}</p>)}
          {result && (result.state === 'retained_previous' || result.state === 'failed' || result.warningCodes.length > 0) ? <p>更新結果: {result.state}{'failureCode' in result ? ` / ${result.failureCode}` : ''} / {result.warningCodes.join(' / ')}。以前の値がある場合は維持します。</p> : null}
          {artifact ? <>
            <Metadata module={module} artifact={artifact} />
            {id === 'etf_1321_eod' ? artifact.observations.map(row => 'adjustedCloseYen' in row ? <TableScroll label="1321 EODの正確な値" key={row.identity}><table><caption>保存済み調整後終値と前回共通source営業日との差</caption><thead><tr><th>項目</th><th>値</th></tr></thead><tbody>
              <tr><th scope="row">前回共通source営業日</th><td>{row.previousCommonDate ?? '利用不可'}</td></tr>
              {([['調整後終値 JPY', row.adjustedCloseYen], ['前回調整後終値 JPY', row.previousAdjustedCloseYen], ['前回差 JPY', row.changeYen], ['前回差率 %', row.changeRatePercent]] as const).map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td className={value.state === 'available' ? 'numeric-cell' : undefined}>{value.state === 'available' ? String(value.value) : `利用不可: ${value.reason}`}</td></tr>)}
            </tbody></table></TableScroll> : null) : artifact.observations.map(row => 'range' in row && row.range === range ? <RelativeResult key={row.range} result={row} /> : null)}
          </> : null}
        </div>
      </Card>;
    })}
  </div>;
}
