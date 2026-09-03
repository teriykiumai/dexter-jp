import { useMemo, type MouseEvent, type ReactNode } from 'react';
import {
  buildMarketOverviewPath,
  buildWatchlistPath,
  sortWatchlistItems,
  WATCHLIST_STALE_AFTER_DAYS,
  type DashboardPageRoute,
  type WatchlistItemView,
  type WatchlistSortKey,
} from './presentation.js';
import { Button, Card, DashboardDesign, StatusBadge, StatusNotice, TableScroll, Value } from './primitives.js';

export interface PageNavigation {
  currentSearch: string;
  onShowWatchlist: () => void;
  onShowMarketOverview: () => void;
}

function followLocalLink(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigate();
}

export function DashboardHeader({ page = 'detail', ...navigation }: PageNavigation & {
  page?: 'watchlist' | 'market-overview' | 'invalid' | 'detail';
}) {
  return (
      <header className="dashboard-page-header">
        <div className="design-content dashboard-header-content">
          <span className="dashboard-wordmark">DEXTER / JP</span>
          <nav aria-label="共通ナビゲーション" className="dashboard-page-nav">
            <a
              aria-current={page === 'watchlist' ? 'page' : undefined}
              href={buildWatchlistPath(navigation.currentSearch)}
              onClick={event => followLocalLink(event, navigation.onShowWatchlist)}
            >保存済み分析</a>
            <a
              aria-current={page === 'market-overview' ? 'page' : undefined}
              href={buildMarketOverviewPath(navigation.currentSearch)}
              onClick={event => followLocalLink(event, navigation.onShowMarketOverview)}
            >市場概況</a>
          </nav>
        </div>
      </header>
  );
}

export function MarketOverviewContent() {
  return (
    <Card title="市場データは準備中です">
      <div className="design-stack">
        <StatusBadge label="全市場共通" />
        <p>データの取得・表示は後続ステップで追加します。現在、この画面では市場データを読み込まず、外部通信も行いません。</p>
        <p>このページは銘柄に依存しない全市場共通の情報を表示する予定です。</p>
      </div>
    </Card>
  );
}

function DashboardPage({ title, page, children, summary, ...navigation }: PageNavigation & {
  title: string;
  page: 'watchlist' | 'market-overview' | 'invalid';
  children: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <DashboardDesign>
      <DashboardHeader {...navigation} page={page} />
      <main className="design-content design-stack">
        <header className="dashboard-page-intro">
          <div className="dashboard-page-identity">
            <h1 data-main-heading tabIndex={-1}>{title}</h1>
            {page === 'watchlist' ? <p>各銘柄の最新の保存済みSnapshot。保有資産・配分情報は含みません。</p> : null}
          </div>
          {summary}
        </header>
        {children}
        <footer className="dashboard-page-footer">DEXTER JP / ローカル専用</footer>
      </main>
    </DashboardDesign>
  );
}

export function Watchlist({ items, sortKey, onSort, onSelect, loading, error, onRetry, ...navigation }: PageNavigation & {
  items: WatchlistItemView[] | null;
  sortKey: WatchlistSortKey;
  onSort: (sortKey: WatchlistSortKey) => void;
  onSelect: (ticker: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const sortedItems = useMemo(() => items ? sortWatchlistItems(items, sortKey) : [], [items, sortKey]);
  return (
    <DashboardPage
      {...navigation}
      page="watchlist"
      title="保存済み分析"
      summary={items === null ? null : (
        <dl className="watchlist-summary">
          <div><dt>保存銘柄数</dt><dd>{items.length}</dd></div>
          <div><dt>complete</dt><dd>{items.filter(item => item.status === 'complete').length}</dd></div>
          <div><dt>基準日{WATCHLIST_STALE_AFTER_DAYS}日超</dt><dd>{items.filter(item => item.stale).length}</dd></div>
        </dl>
      )}
    >
      {items === null ? (
        <Card title={error ? '一覧を読み込めませんでした' : '保存済み分析を読み込み中'}>
          <div className="design-stack">
            <p role={error ? 'alert' : 'status'}>{error ?? '保存済み分析を読み込み中…'}</p>
            <p>外部データの取得・再分析は行いません。利用不可は0を意味しません。</p>
            {error ? <Button onClick={onRetry} disabled={loading}>一覧の読み込みを再試行</Button> : null}
          </div>
        </Card>
      ) : (
        <Card title={sortedItems.length === 0 ? '保存済み分析はありません' : '分析一覧'}>
          <div className="design-stack">
            {error ? (
              <StatusNotice title="一覧を更新できませんでした" tone="warning" role="alert">
                <p>{error} 前回の保存済み一覧を表示しています。</p>
                <Button onClick={onRetry} disabled={loading}>一覧の読み込みを再試行</Button>
              </StatusNotice>
            ) : loading ? <p role="status">保存済み一覧を再読み込み中…（外部データの取得・再分析は行いません）</p> : null}
            {sortedItems.length === 0 ? (
              <p>CLIで企業分析を実行してSnapshotを保存すると、ここに表示されます。</p>
            ) : (
              <div className="design-stack">
                <div className="watchlist-toolbar">
                  <p>{sortKey === 'latestDataDate' ? '最新基準日の新しい順（基準日なしは最後）。' : '生成日時の新しい順。'}</p>
                  <div className="design-actions" role="group" aria-label="一覧の並び順">
                    <Button compact aria-pressed={sortKey === 'latestDataDate'} variant={sortKey === 'latestDataDate' ? 'primary' : 'secondary'} onClick={() => onSort('latestDataDate')}>データ基準日順</Button>
                    <Button compact aria-pressed={sortKey === 'generatedAt'} variant={sortKey === 'generatedAt' ? 'primary' : 'secondary'} onClick={() => onSort('generatedAt')}>生成日時順</Button>
                  </div>
                </div>
                <p className="design-metadata">幅に収まらない列は、表を左右にスクロールして確認できます。</p>
                <TableScroll label="保存済み分析一覧を横スクロール">
                  <table className="analysis-list-table">
                    <caption>各銘柄の最新保存値。利用不可は0ではありません。状態はSnapshot保存時点のものです。</caption>
                    <thead>
                      <tr>
                        <th scope="col">銘柄</th>
                        <th scope="col" className="numeric-cell">株価</th>
                        <th scope="col" className="numeric-cell">PER</th>
                        <th scope="col" className="numeric-cell">PBR</th>
                        <th scope="col" className="numeric-cell">ROE</th>
                        <th scope="col">トレンド</th>
                        <th scope="col" className="numeric-cell">信用倍率Percentile</th>
                        <th scope="col" className="numeric-cell">Beta 250</th>
                        <th scope="col">最新基準日</th>
                        <th scope="col">生成日時</th>
                        <th scope="col">状態</th>
                        <th scope="col"><span className="visually-hidden">詳細への移動</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedItems.map(item => (
                        <tr key={item.ticker} data-ticker={item.ticker}>
                          <th scope="row">
                            <Button compact variant="quiet" className="analysis-company" onClick={() => onSelect(item.ticker)}>
                              <span className="design-data">{item.ticker}</span>
                              <span>{item.companyName}</span>
                            </Button>
                          </th>
                          <td className="numeric-cell"><Value value={item.price} kind="data" /></td>
                          <td className="numeric-cell"><Value value={item.per} kind="data" /></td>
                          <td className="numeric-cell"><Value value={item.pbr} kind="data" /></td>
                          <td className="numeric-cell"><Value value={item.roe} kind="data" /></td>
                          <td><Value value={item.trend} /></td>
                          <td className="numeric-cell"><Value value={item.marginPercentile} kind="data" /></td>
                          <td className="numeric-cell"><Value value={item.beta250} kind="data" /></td>
                          <td>
                            <Value value={item.latestDataDate} kind="data" />
                            {item.stale ? <span className="analysis-date-note"><StatusBadge label={`${WATCHLIST_STALE_AFTER_DAYS}日超`} tone="warning" /></span> : null}
                          </td>
                          <td><Value value={item.generatedAt} kind="data" /></td>
                          <td><StatusBadge label={item.status} tone={item.status === 'complete' ? 'success' : 'warning'} /></td>
                          <td><Button compact aria-label={`${item.ticker} ${item.companyName}の詳細を表示`} onClick={() => onSelect(item.ticker)}>詳細 →</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
            )}
          </div>
        </Card>
      )}
    </DashboardPage>
  );
}

export function MarketOverviewPlaceholder(navigation: PageNavigation) {
  return (
    <DashboardPage {...navigation} page="market-overview" title="市場概況">
      <MarketOverviewContent />
    </DashboardPage>
  );
}

export function DashboardRouteError({ reason, ...navigation }: PageNavigation & {
  reason: Extract<DashboardPageRoute, { kind: 'invalid' }>['reason'];
}) {
  const message = reason === 'conflicting_owner'
    ? '全市場共通ページと銘柄詳細の指定が混在しています。'
    : reason === 'missing_owner'
      ? '表示条件に対応する銘柄またはページが指定されていません。'
      : 'URLの表示条件が不正、または重複しています。';
  return (
    <DashboardPage {...navigation} page="invalid" title="表示先を確認してください">
      <Card title="URLの指定を確認してください">
        <div className="design-stack">
          <p role="alert">{message} データの読み込みは行っていません。</p>
          <Button onClick={navigation.onShowWatchlist}>保存済み分析の一覧へ戻る</Button>
        </div>
      </Card>
    </DashboardPage>
  );
}
