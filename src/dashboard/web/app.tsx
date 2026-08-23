import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnalysisSnapshot } from '../../analysis/snapshot/index.js';
import { LIGHTWEIGHT_CHARTS_NOTICE, PriceChart } from './chart.js';
import {
  UNAVAILABLE_TEXT,
  mapSnapshotToDashboard,
  type DashboardMetric,
  type DisplayValue,
} from './presentation.js';

const DASHBOARD_TICKER = '7203';

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

function Dashboard({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const view = mapSnapshotToDashboard(snapshot);

  return (
    <main className="dashboard-shell">
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

function App() {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    void fetch(`/api/analyses/${DASHBOARD_TICKER}`, {
      headers: { Accept: 'application/json' },
      signal: abortController.signal,
    }).then(async response => {
      if (!response.ok) {
        throw new Error(response.status === 404
          ? `${DASHBOARD_TICKER} の保存済みSnapshotがありません。`
          : 'Snapshotを読み込めませんでした。');
      }
      return await response.json() as AnalysisSnapshot;
    }).then(setSnapshot).catch((cause: unknown) => {
      if (!abortController.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Snapshotを読み込めませんでした。');
      }
    });
    return () => abortController.abort();
  }, []);

  if (error) {
    return (
      <main className="load-state">
        <span className="brand-mark">DEXTER / JP</span>
        <h1>Single Stock Dashboard</h1>
        <p>{error}</p>
        <small>{UNAVAILABLE_TEXT}は0を意味しません。</small>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="load-state">
        <span className="brand-mark">DEXTER / JP</span>
        <div className="loading-bar" />
        <p>7203 Snapshotを読み込み中…</p>
      </main>
    );
  }
  return <Dashboard snapshot={snapshot} />;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Dashboard root element was not found.');
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
