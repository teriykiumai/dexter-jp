import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AnalysisSnapshot,
  AnalysisSnapshotLatestItem,
} from '../../analysis/snapshot/index.js';
import { LIGHTWEIGHT_CHARTS_NOTICE, PriceChart } from './chart.js';
import {
  UNAVAILABLE_TEXT,
  INVESTOR_TYPE_FLOW_CONTEXT_NOTE,
  REPORTED_SHORT_POSITION_DISCLOSURE_NOTE,
  WATCHLIST_STALE_AFTER_DAYS,
  buildDetailPath,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  parseDetailTicker,
  sortWatchlistItems,
  type DashboardMetric,
  type DisplayValue,
  type InvestorTypeCategoryView,
  type WatchlistItemView,
  type WatchlistSortKey,
} from './presentation.js';

function Value({ value }: { value: DisplayValue }) {
  return <span className={value.available ? undefined : 'unavailable'}>{value.text}</span>;
}

function Card({ title, eyebrow, children, className = '' }: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function MetricGrid({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <dl className="metric-grid">
      {metrics.map(metric => (
        <div className="metric-row" key={metric.label}>
          <dt>{metric.label}</dt>
          <dd><Value value={metric.value} /></dd>
          {metric.note ? <small>{metric.note}</small> : null}
        </div>
      ))}
    </dl>
  );
}

function InvestorTypeTable({ rows }: { rows: InvestorTypeCategoryView[] }) {
  return (
    <div className="table-scroll">
      <table className="investor-type-table">
        <thead>
          <tr><th>Source category</th><th>Sell</th><th>Buy</th><th>Total</th><th>Balance</th></tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.category}>
              <th>{row.category}</th>
              <td><Value value={row.sell} /></td>
              <td><Value value={row.buy} /></td>
              <td><Value value={row.total} /></td>
              <td><Value value={row.balance} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ snapshot, onBack }: { snapshot: AnalysisSnapshot; onBack: () => void }) {
  const view = mapSnapshotToDashboard(snapshot);

  return (
    <main className="dashboard-shell">
      <button className="back-button" type="button" onClick={onBack}>
        ← Analysis Portfolio
      </button>
      <header className="hero">
        <div>
          <div className="brand-line">
            <span className="brand-mark">DEXTER / JP</span>
            <span className="local-badge">LOCAL SNAPSHOT</span>
          </div>
          <div className="company-title">
            <span className="ticker">{view.header.ticker}</span>
            <h1>{view.header.companyName}</h1>
          </div>
          <p className="generated-at">生成日時 {view.header.generatedAt}</p>
        </div>
        <div className={`status-badge ${view.header.status}`}>
          <span className="status-dot" />
          {view.header.status.toUpperCase()}
        </div>
      </header>

      <section className="kpi-grid" aria-label="主要指標">
        {view.kpis.map(kpi => (
          <article className="kpi-card" key={kpi.label}>
            <span>{kpi.label}</span>
            <strong><Value value={kpi.value} /></strong>
          </article>
        ))}
      </section>

      <Card title="Price Structure" eyebrow="Adjusted OHLCV" className="chart-panel">
        <PriceChart bars={view.chart.bars} priceLines={view.chart.priceLines} />
        <p className="chart-credit">
          <span>{LIGHTWEIGHT_CHARTS_NOTICE[0]}</span>
          <span>
            {LIGHTWEIGHT_CHARTS_NOTICE[1]}{' '}
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              https://www.tradingview.com/
            </a>
          </span>
        </p>
      </Card>

      <Card title="Advanced Technical" eyebrow="Latest deterministic values">
        {view.advancedTechnical ? (
          <>
            <MetricGrid metrics={view.advancedTechnical.metrics} />
            {view.advancedTechnical.unavailableReasons.length
              ? (
                  <p className="reason-list">
                    {view.advancedTechnical.unavailableReasons.join(' / ')}
                  </p>
                )
              : null}
          </>
        ) : <div className="empty-state">Advanced Technicalは未収集です。</div>}
      </Card>

      <div className="two-column">
        <Card title="Peer Position" eyebrow="Deterministic comparison">
          {view.peer ? (
            <>
              <div className="priority-line">
                <span>時価総額priority</span>
                <Value value={view.peer.marketCapPriority} />
                {view.peer.marketCapPriorityReason
                  ? <small>{view.peer.marketCapPriorityReason}</small>
                  : null}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Metric</th><th>Target</th><th>Peer median</th><th>Rank</th><th>Percentile</th></tr>
                  </thead>
                  <tbody>
                    {view.peer.rows.map(row => (
                      <tr key={row.label}>
                        <th>{row.label}</th>
                        <td><Value value={row.target} /></td>
                        <td><Value value={row.median} /></td>
                        <td><Value value={row.rank} /></td>
                        <td><Value value={row.percentile} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <div className="empty-state">Peer比較は利用できません。</div>}
        </Card>

        <Card title="Supply & Demand" eyebrow="Margin balance">
          {view.supplyDemand
            ? <MetricGrid metrics={view.supplyDemand} />
            : <div className="empty-state">需給データは利用できません。</div>}
        </Card>
      </div>

      <Card title="Public Short Position Reports" eyebrow="J-Quants disclosure ≥ 0.5%">
        <p className="disclosure-note">{REPORTED_SHORT_POSITION_DISCLOSURE_NOTE}</p>
        {view.reportedShortPositions.reports.length > 0 ? (
          <div className="table-scroll">
            <table className="short-position-table">
              <thead>
                <tr>
                  <th>Disclosed</th>
                  <th>Calculated</th>
                  <th>Reporter</th>
                  <th>Discretionary manager</th>
                  <th>Fund</th>
                  <th>Ratio</th>
                  <th>Shares</th>
                  <th>Previous calculated</th>
                  <th>Previous ratio</th>
                  <th>Ratio delta</th>
                </tr>
              </thead>
              <tbody>
                {view.reportedShortPositions.reports.map((report, index) => (
                  <tr key={`${report.disclosedDate.text}-${report.calculatedDate.text}-${index}`}>
                    <td><Value value={report.disclosedDate} /></td>
                    <td><Value value={report.calculatedDate} /></td>
                    <td><Value value={report.reporterName} /></td>
                    <td><Value value={report.discretionaryManagerName} /></td>
                    <td><Value value={report.fundName} /></td>
                    <td><Value value={report.shortPositionRatio} /></td>
                    <td><Value value={report.shortPositionShares} /></td>
                    <td><Value value={report.previousCalculatedDate} /></td>
                    <td><Value value={report.previousReportedRatio} /></td>
                    <td><Value value={report.ratioDelta} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {view.reportedShortPositions.state === 'not_collected'
              ? '公開空売り残高報告は未収集です。'
              : `公開空売り残高報告は利用できません。${view.reportedShortPositions.unavailableReasons.join(' / ')}`}
          </div>
        )}
      </Card>

      <Card title="Investor Type Flows" eyebrow="Tokyo/Nagoya weekly market context">
        <p className="disclosure-note">{INVESTOR_TYPE_FLOW_CONTEXT_NOTE}</p>
        {view.investorTypeFlows.state === 'available' ? (
          <>
            <div className="investor-flow-meta">
              <MetricGrid metrics={[
                { label: 'Section', value: view.investorTypeFlows.section },
                { label: 'Published', value: view.investorTypeFlows.publishedDate },
                { label: 'Period start', value: view.investorTypeFlows.periodStartDate },
                { label: 'Period end', value: view.investorTypeFlows.periodEndDate },
              ]} />
            </div>
            <section className="investor-flow-group">
              <h3>Summary</h3>
              <InvestorTypeTable rows={view.investorTypeFlows.summary} />
            </section>
            <section className="investor-flow-group">
              <h3>Brokerage breakdown</h3>
              <InvestorTypeTable rows={view.investorTypeFlows.brokerageBreakdown} />
            </section>
          </>
        ) : (
          <div className="empty-state">
            {view.investorTypeFlows.state === 'not_collected'
              ? '投資部門別データは未収集です。'
              : `投資部門別データは利用できません。${view.investorTypeFlows.unavailableReasons.join(' / ')}`}
          </div>
        )}
      </Card>

      <div className="two-column">
        <Card title="Market Correlation" eyebrow="TOPIX benchmark">
          {view.correlations?.length ? (
            <div className="correlation-grid">
              {view.correlations.map(window => (
                <article className="window-card" key={window.period}>
                  <h3>{window.period}日</h3>
                  <MetricGrid metrics={[
                    { label: '観測数', value: window.observations },
                    { label: 'Correlation', value: window.correlation },
                    { label: 'Beta', value: window.beta },
                    { label: 'Alpha annualized', value: window.alpha },
                    { label: 'R²', value: window.rSquared },
                  ]} />
                  {window.unavailableReasons.length
                    ? <p className="reason-list">{window.unavailableReasons.join(' / ')}</p>
                    : null}
                </article>
              ))}
            </div>
          ) : <div className="empty-state">市場相関は利用できません。</div>}
        </Card>

        <Card title="Strategy" eyebrow="Deterministic levels">
          {view.strategy ? (
            <>
              <MetricGrid metrics={[
                { label: 'Trigger', value: view.strategy.trigger },
                { label: 'Exact entry', value: view.strategy.exactEntry },
              ]} />
              {view.strategy.candidates.map((candidate, index) => (
                <article className="strategy-candidate" key={`${candidate.entry.text}-${index}`}>
                  <span>Executable setup {index + 1}</span>
                  <MetricGrid metrics={[
                    { label: 'Entry', value: candidate.entry },
                    { label: 'Stop', value: candidate.stop },
                    { label: 'Target', value: candidate.target },
                    { label: 'Reward / Risk', value: candidate.rewardRisk },
                  ]} />
                </article>
              ))}
              {view.strategy.unavailableReasons.length
                ? <p className="reason-list">{view.strategy.unavailableReasons.join(' / ')}</p>
                : null}
            </>
          ) : <div className="empty-state">Strategyは利用できません。</div>}
        </Card>
      </div>

      <div className="two-column">
        <Card title="Data Freshness" eyebrow="Source dates">
          <MetricGrid metrics={view.dataDates} />
        </Card>
        <Card title="Unavailable" eyebrow={`${view.unavailable.length} recorded gaps`}>
          {view.unavailable.length ? (
            <ul className="unavailable-list">
              {view.unavailable.map((item, index) => (
                <li key={`${item.section}-${item.metric ?? ''}-${index}`}>
                  <strong>{item.section}{item.metric ? ` / ${item.metric}` : ''}</strong>
                  <span>{item.reason}</span>
                  {item.detail ? <small>{item.detail}</small> : null}
                </li>
              ))}
            </ul>
          ) : <p className="clear-state">記録された欠損はありません。</p>}
        </Card>
      </div>

      {view.scenarios ? (
        <Card title="Scenarios" eyebrow="Structured narrative">
          <div className="scenario-grid">
            {Object.entries(view.scenarios).map(([name, scenario]) => (
              <article className={`scenario ${name}`} key={name}>
                <h3>{name.toUpperCase()}</h3>
                <p>{scenario.condition}</p>
                <ul>{scenario.evidence.map(item => <li key={item}>{item}</li>)}</ul>
                <small>Invalidation — {scenario.invalidation}</small>
              </article>
            ))}
          </div>
        </Card>
      ) : null}

      {view.risks ? (
        <Card title="Risks" eyebrow="Structured narrative">
          <ul className="risk-list">
            {view.risks.map((risk, index) => (
              <li key={`${risk.category ?? 'risk'}-${index}`}>
                <span>{risk.category ?? 'General'}</span>
                <p>{risk.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Final Report" eyebrow="Agent narrative">
        <pre className="report-markdown">{view.finalReportMarkdown}</pre>
      </Card>

      <footer className="footer">
        <span>DEXTER JP / READ-ONLY LOCAL ANALYSIS</span>
        <span>Snapshot values are displayed without recalculation.</span>
      </footer>
    </main>
  );
}

function Watchlist({
  items,
  sortKey,
  onSort,
  onSelect,
}: {
  items: WatchlistItemView[];
  sortKey: WatchlistSortKey;
  onSort: (sortKey: WatchlistSortKey) => void;
  onSelect: (ticker: string) => void;
}) {
  const sortedItems = useMemo(() => sortWatchlistItems(items, sortKey), [items, sortKey]);
  const completeCount = items.filter(item => item.status === 'complete').length;
  const staleCount = items.filter(item => item.stale).length;

  return (
    <main className="dashboard-shell watchlist-shell">
      <header className="portfolio-hero">
        <div>
          <div className="brand-line">
            <span className="brand-mark">DEXTER / JP</span>
            <span className="local-badge">ANALYSIS PORTFOLIO</span>
          </div>
          <h1>Saved Analysis</h1>
          <p>保存済み企業分析のlatest Snapshot。保有資産・配分情報は含みません。</p>
        </div>
        <dl className="portfolio-summary">
          <div><dt>Tracked</dt><dd>{items.length}</dd></div>
          <div><dt>Complete</dt><dd>{completeCount}</dd></div>
          <div><dt>Stale</dt><dd>{staleCount}</dd></div>
        </dl>
      </header>

      <section className="watchlist-panel" aria-labelledby="watchlist-title">
        <header className="watchlist-header">
          <div>
            <span className="eyebrow">Latest snapshots</span>
            <h2 id="watchlist-title">Analysis Watchlist</h2>
          </div>
          <div className="sort-control" aria-label="一覧の並び順">
            <span>Sort</span>
            <button
              className={sortKey === 'latestDataDate' ? 'active' : undefined}
              type="button"
              onClick={() => onSort('latestDataDate')}
            >
              Source date
            </button>
            <button
              className={sortKey === 'generatedAt' ? 'active' : undefined}
              type="button"
              onClick={() => onSort('generatedAt')}
            >
              Generated
            </button>
          </div>
        </header>

        {sortedItems.length === 0 ? (
          <div className="empty-state watchlist-empty">
            保存済みAnalysis Snapshotはありません。
          </div>
        ) : (
          <div className="table-scroll">
            <table className="watchlist-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Price</th>
                  <th>PER</th>
                  <th>PBR</th>
                  <th>ROE</th>
                  <th>Trend</th>
                  <th>Margin %ile</th>
                  <th>Beta 250</th>
                  <th>Latest source</th>
                  <th>Generated</th>
                  <th>Status</th>
                  <th><span className="visually-hidden">Detail</span></th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(item => (
                  <tr key={item.ticker}>
                    <th>
                      <button
                        className="company-link"
                        type="button"
                        onClick={() => onSelect(item.ticker)}
                      >
                        <span>{item.ticker}</span>
                        <strong>{item.companyName}</strong>
                      </button>
                    </th>
                    <td><Value value={item.price} /></td>
                    <td><Value value={item.per} /></td>
                    <td><Value value={item.pbr} /></td>
                    <td><Value value={item.roe} /></td>
                    <td><Value value={item.trend} /></td>
                    <td><Value value={item.marginPercentile} /></td>
                    <td><Value value={item.beta250} /></td>
                    <td>
                      <Value value={item.latestDataDate} />
                      {item.stale
                        ? <small className="stale-label">{WATCHLIST_STALE_AFTER_DAYS}日超</small>
                        : null}
                    </td>
                    <td><Value value={item.generatedAt} /></td>
                    <td>
                      <span className={`compact-status ${item.status}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="detail-button"
                        type="button"
                        aria-label={`${item.ticker} ${item.companyName}の詳細を表示`}
                        onClick={() => onSelect(item.ticker)}
                      >
                        詳細 →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>DEXTER JP / READ-ONLY LOCAL ANALYSIS</span>
        <span>Sorted and formatted from canonical Snapshot values.</span>
      </footer>
    </main>
  );
}

async function fetchSnapshot(ticker: string, signal: AbortSignal): Promise<AnalysisSnapshot> {
  const response = await fetch(`/api/analyses/${ticker}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? `${ticker} の保存済みSnapshotがありません。`
      : 'Snapshotを読み込めませんでした。');
  }
  return await response.json() as AnalysisSnapshot;
}

function App() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(() => (
    parseDetailTicker(window.location.search)
  ));
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItemView[]>([]);
  const [sortKey, setSortKey] = useState<WatchlistSortKey>('latestDataDate');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handlePopState = () => setSelectedTicker(parseDetailTicker(window.location.search));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    if (selectedTicker) {
      setSnapshot(null);
      void fetchSnapshot(selectedTicker, abortController.signal)
        .then(setSnapshot)
        .catch((cause: unknown) => {
          if (!abortController.signal.aborted) {
            setError(cause instanceof Error ? cause.message : 'Snapshotを読み込めませんでした。');
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) setLoading(false);
        });
    } else {
      void fetch('/api/analyses', {
        headers: { Accept: 'application/json' },
        signal: abortController.signal,
      }).then(async response => {
        if (!response.ok) throw new Error('Analysis一覧を読み込めませんでした。');
        return await response.json() as AnalysisSnapshotLatestItem[];
      }).then(latest => {
        const referenceDate = new Date();
        setWatchlistItems(latest.map(item => (
          mapLatestAnalysisToWatchlistItem(item, referenceDate)
        )));
      }).catch((cause: unknown) => {
        if (!abortController.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Analysis一覧を読み込めませんでした。');
        }
      }).finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });
    }
    return () => abortController.abort();
  }, [selectedTicker]);

  const navigateToTicker = (ticker: string) => {
    window.history.pushState({}, '', buildDetailPath(ticker));
    setSelectedTicker(ticker);
  };
  const navigateToWatchlist = () => {
    window.history.pushState({}, '', '/');
    setSelectedTicker(null);
  };

  if (error) {
    return (
      <main className="load-state">
        <span className="brand-mark">DEXTER / JP</span>
        <h1>{selectedTicker ? 'Single Stock Dashboard' : 'Analysis Watchlist'}</h1>
        <p>{error}</p>
        <small>{UNAVAILABLE_TEXT}は0を意味しません。</small>
        {selectedTicker ? (
          <button className="back-button centered" type="button" onClick={navigateToWatchlist}>
            ← Analysis Portfolio
          </button>
        ) : null}
      </main>
    );
  }
  if (loading) {
    return (
      <main className="load-state">
        <span className="brand-mark">DEXTER / JP</span>
        <div className="loading-bar" />
        <p>{selectedTicker ? `${selectedTicker} Snapshotを読み込み中…` : '保存済みAnalysisを読み込み中…'}</p>
      </main>
    );
  }
  if (selectedTicker && snapshot) {
    return <Dashboard snapshot={snapshot} onBack={navigateToWatchlist} />;
  }
  return (
    <Watchlist
      items={watchlistItems}
      sortKey={sortKey}
      onSort={setSortKey}
      onSelect={navigateToTicker}
    />
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Dashboard root element was not found.');
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
