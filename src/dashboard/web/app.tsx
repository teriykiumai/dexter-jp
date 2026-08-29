import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  AnalysisSnapshotSchema,
  type AnalysisSnapshot,
  type AnalysisSnapshotLatestItem,
} from '../../analysis/snapshot/index.js';
import { LIGHTWEIGHT_CHARTS_NOTICE, PriceChart } from './chart.js';
import {
  DASHBOARD_GLOSSARY,
  DASHBOARD_GLOSSARY_ENTRIES,
  type DashboardGlossaryTermId,
} from './glossary.js';
import {
  ADVANCED_DIVIDEND_CONTEXT_NOTE,
  DASHBOARD_TABS,
  DEFAULT_DASHBOARD_TAB,
  UNAVAILABLE_TEXT,
  INVESTOR_TYPE_FLOW_CONTEXT_NOTE,
  REPORTED_SHORT_POSITION_DISCLOSURE_NOTE,
  SECTOR_BENCHMARK_CONTEXT_NOTE,
  SECTOR_SHORT_RATIO_CONTEXT_NOTE,
  VOLUME_PROFILE_CONTEXT_NOTE,
  WATCHLIST_STALE_AFTER_DAYS,
  buildDetailPath,
  buildWatchlistPath,
  hasCanonicalDetailTab,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  moveDashboardTab,
  parseDetailTab,
  parseDetailTicker,
  sortWatchlistItems,
  type DashboardMetric,
  type DashboardAvailabilityCount,
  type DashboardTabId,
  type DisplayValue,
  type InvestorTypeCategoryView,
  type VolumeProfileView,
  type WatchlistItemView,
  type WatchlistSortKey,
} from './presentation.js';

function Value({ value }: { value: DisplayValue }) {
  return <span className={value.available ? undefined : 'unavailable'}>{value.text}</span>;
}

type OpenGlossary = (
  term: DashboardGlossaryTermId,
  invoker: HTMLButtonElement,
) => void;

function GuidanceButton({ term, onOpen }: {
  term: DashboardGlossaryTermId;
  onOpen: OpenGlossary;
}) {
  const entry = DASHBOARD_GLOSSARY[term];
  return (
    <button
      aria-label={`${entry.label}の説明を開く`}
      className="guidance-button"
      onClick={event => onOpen(term, event.currentTarget)}
      type="button"
    >
      ?
    </button>
  );
}

function Card({
  title,
  eyebrow,
  children,
  className = '',
  guidanceTerm,
  onOpenGuidance,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  guidanceTerm?: DashboardGlossaryTermId;
  onOpenGuidance?: OpenGlossary;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="panel-title-line">
          <h2>{title}</h2>
          {guidanceTerm && onOpenGuidance
            ? <GuidanceButton term={guidanceTerm} onOpen={onOpenGuidance} />
            : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function MetricGrid({ metrics, guidance = {}, onOpenGuidance }: {
  metrics: DashboardMetric[];
  guidance?: Readonly<Record<string, DashboardGlossaryTermId>>;
  onOpenGuidance?: OpenGlossary;
}) {
  return (
    <dl className="metric-grid">
      {metrics.map(metric => {
        const term = guidance[metric.label];
        return (
          <div className="metric-row" key={metric.label}>
            <dt>
              <span>{metric.label}</span>
              {term && onOpenGuidance
                ? <GuidanceButton term={term} onOpen={onOpenGuidance} />
                : null}
            </dt>
            <dd><Value value={metric.value} /></dd>
            {metric.note ? <small>{metric.note}</small> : null}
          </div>
        );
      })}
    </dl>
  );
}

type GlossarySelection = 'index' | DashboardGlossaryTermId | null;
type GlossaryFocusDestination = 'active-tab' | 'main-heading';

function GlossaryDialog({ selection, onSelect, onClosed }: {
  selection: GlossarySelection;
  onSelect: (selection: 'index' | DashboardGlossaryTermId) => void;
  onClosed: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selection !== null && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (selection === null && dialog.open) {
      dialog.close();
    }
  }, [selection]);

  const selectedEntry = selection && selection !== 'index'
    ? DASHBOARD_GLOSSARY[selection]
    : null;

  return (
    <dialog
      aria-describedby="glossary-dialog-description"
      aria-labelledby="glossary-dialog-title"
      className="glossary-dialog"
      onClose={onClosed}
      ref={dialogRef}
    >
      <header className="glossary-dialog-header">
        <div>
          <span className="eyebrow">Snapshot指標ガイド</span>
          <h2 id="glossary-dialog-title">
            {selectedEntry ? `用語集 / ${selectedEntry.label}` : '用語集'}
          </h2>
        </div>
        <button
          aria-label="用語集を閉じる"
          className="glossary-close"
          onClick={() => dialogRef.current?.close()}
          ref={closeButtonRef}
          type="button"
        >
          閉じる
        </button>
      </header>
      <p className="glossary-description" id="glossary-dialog-description">
        Snapshotに保存された指標の読み方と制約を確認できます。ここでは値を再計算しません。
      </p>
      {selectedEntry ? (
        <>
          <button className="glossary-back" onClick={() => onSelect('index')} type="button">
            ← 用語一覧
          </button>
          <dl className="glossary-definition">
            <div>
              <dt>何を測るか</dt>
              <dd>{selectedEntry.measures}</dd>
            </div>
            <div>
              <dt>単位と読み方</dt>
              <dd>{selectedEntry.unitAndReading}</dd>
            </div>
            <div>
              <dt>主な制約</dt>
              <dd>{selectedEntry.limitation}</dd>
            </div>
            <div>
              <dt>判断上の注意</dt>
              <dd>{selectedEntry.decisionBoundary}</dd>
            </div>
          </dl>
        </>
      ) : (
        <ul className="glossary-index">
          {DASHBOARD_GLOSSARY_ENTRIES.map(entry => (
            <li key={entry.id}>
              <button onClick={() => onSelect(entry.id)} type="button">
                <strong>{entry.label}</strong>
                <span>{entry.measures}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

function isVisibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return element !== null
    && element.isConnected
    && element.closest('[hidden]') === null
    && element.getClientRects().length > 0;
}

function focusGlossaryDestination(): void {
  const focusTarget = (): boolean => {
    if (parseDetailTicker(window.location.search)) {
      const activeTab = document.getElementById(
        `dashboard-tab-${parseDetailTab(window.location.search)}`,
      );
      if (isVisibleFocusTarget(activeTab)) {
        activeTab.focus();
        return true;
      }
    }

    const heading = document.querySelector<HTMLElement>('[data-main-heading]');
    if (isVisibleFocusTarget(heading)) {
      heading.focus();
      return true;
    }
    return false;
  };

  if (focusTarget()) return;
  const root = document.getElementById('root');
  if (!root) return;
  const observer = new MutationObserver(() => {
    if (focusTarget()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  if (focusTarget()) observer.disconnect();
}

function AvailabilityBadges({ counts, compact = false }: {
  counts: DashboardAvailabilityCount;
  compact?: boolean;
}) {
  if (counts.unavailable === 0 && counts.uncollected === 0) return null;
  return (
    <span className={compact ? 'availability-badges compact' : 'availability-badges'}>
      {counts.unavailable > 0 ? (
        <span className="availability-badge unavailable-count">
          利用不可 {counts.unavailable}
        </span>
      ) : null}
      {counts.uncollected > 0 ? (
        <span className="availability-badge uncollected-count">
          未収集 {counts.uncollected}
        </span>
      ) : null}
    </span>
  );
}

const DEFAULT_DISCLOSURE_STATE = {
  volumeProfileMethodology: false,
  volumeProfileBins: false,
  investorBrokerage: false,
  reportedShortPositions: true,
  advancedDividend: true,
} as const;

type DashboardDisclosureId = keyof typeof DEFAULT_DISCLOSURE_STATE;
type DashboardDisclosureState = Record<DashboardDisclosureId, boolean>;

const RELOAD_NO_REANALYSIS_NOTE = '外部ソースからの最新データ取得・再分析は実行していません';

type SnapshotReloadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'updated' }
  | { status: 'unchanged' }
  | { status: 'error'; detail: string };

function reloadFeedbackMessage(state: SnapshotReloadState, generatedAt: string): string | null {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return '保存済みSnapshotを再読み込み中…';
  const result = state.status === 'updated'
    ? '更新'
    : state.status === 'unchanged'
      ? '変更なし'
      : `エラー: ${state.detail}`;
  return `${result}。表示中の生成日時 ${generatedAt}。${RELOAD_NO_REANALYSIS_NOTE}。`;
}

function StoredDisclosure({
  children,
  open,
  onOpenChange,
  summary,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ReactNode;
}) {
  return (
    <details
      className="stored-disclosure"
      onToggle={event => onOpenChange(event.currentTarget.open)}
      open={open}
    >
      <summary>{summary}</summary>
      <div className="stored-disclosure-content">{children}</div>
    </details>
  );
}

function VolumeProfileChart({ profile }: { profile: VolumeProfileView }) {
  const poc = profile.poc;
  const valueArea = profile.valueArea;
  if (!poc || !valueArea) return null;

  return (
    <figure className="volume-profile-figure">
      <figcaption>
        保存済み価格帯別分布（低価格帯から高価格帯）。横棒は各価格帯の保存済み出来高比率を
        0〜100%の固定範囲で表示します。値の再配分や最大値探索、POC・Value Areaの再選択は
        していません。
      </figcaption>
      <div className="volume-profile-legend" aria-label="出来高価格分布の凡例">
        <span><i className="volume-profile-swatch poc" />保存済みPOC</span>
        <span><i className="volume-profile-swatch value-area" />保存済みValue Area</span>
        <span><i className="volume-profile-swatch other" />その他の価格帯</span>
      </div>
      <div
        aria-label="保存済み出来高価格分布チャート"
        className="volume-profile-plot"
        role="region"
        tabIndex={0}
      >
        <ol>
          {profile.bins.map(bin => {
            const isPoc = bin.index === poc.binIndex;
            const isValueArea = bin.index >= valueArea.firstBinIndex
              && bin.index <= valueArea.lastBinIndex;
            const marker = isPoc ? 'POC' : isValueArea ? 'VA' : '';
            return (
              <li
                className={`${isValueArea ? 'value-area ' : ''}${isPoc ? 'poc' : ''}`.trim()}
                data-poc={isPoc}
                data-value-area={isValueArea}
                data-volume-profile-bin={bin.index}
                key={bin.index}
              >
                <span aria-hidden="true" className="volume-profile-bin-price">
                  <Value value={bin.representativePrice} />
                </span>
                <meter
                  aria-label={`価格帯 ${bin.index}、代表価格 ${bin.representativePrice.text}、配分出来高 ${bin.allocatedVolume.text}、出来高比率 ${bin.volumeShare.text}${marker ? `、${marker}` : ''}`}
                  max={1}
                  min={0}
                  value={bin.volumeShareValue}
                />
                <span aria-hidden="true" className="volume-profile-bin-marker">
                  {marker}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="volume-profile-boundary">
        POC・VAL・VAHは支持線・抵抗線や売買シグナルを意味しません。正確な保存値は下の全件表で確認できます。
      </p>
    </figure>
  );
}

function InvestorTypeTable({ label, rows }: {
  label: string;
  rows: InvestorTypeCategoryView[];
}) {
  return (
    <div aria-label={label} className="table-scroll" role="region" tabIndex={0}>
      <table className="investor-type-table">
        <thead>
          <tr><th>公式区分</th><th>売り</th><th>買い</th><th>合計</th><th>差引</th></tr>
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

function DashboardTabs({
  availability,
  selectedTab,
  onSelect,
}: {
  availability: Record<DashboardTabId, DashboardAvailabilityCount>;
  selectedTab: DashboardTabId;
  onSelect: (tab: DashboardTabId) => void;
}) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<DashboardTabId, HTMLButtonElement>>>({});

  useEffect(() => {
    const tabList = tabListRef.current;
    const selectedElement = tabRefs.current[selectedTab];
    if (!tabList || !selectedElement) return;

    const selectedLeft = selectedElement.offsetLeft;
    const selectedRight = selectedLeft + selectedElement.offsetWidth;
    const style = window.getComputedStyle(tabList);
    const leftPadding = Number.parseFloat(style.scrollPaddingLeft) || 0;
    const rightPadding = Number.parseFloat(style.scrollPaddingRight) || 0;
    const visibleLeft = tabList.scrollLeft + leftPadding;
    const visibleRight = tabList.scrollLeft + tabList.clientWidth - rightPadding;
    if (selectedLeft < visibleLeft) {
      tabList.scrollLeft = Math.max(0, Math.floor(selectedLeft - leftPadding));
    }
    else if (selectedRight > visibleRight) {
      tabList.scrollLeft = Math.ceil(
        selectedRight - tabList.clientWidth + rightPadding,
      ) + 1;
    }
  }, [selectedTab]);

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTab: DashboardTabId,
  ) => {
    if (
      event.key !== 'ArrowLeft'
      && event.key !== 'ArrowRight'
      && event.key !== 'Home'
      && event.key !== 'End'
    ) return;
    event.preventDefault();
    const nextTab = moveDashboardTab(currentTab, event.key);
    onSelect(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <nav className="detail-tabs-shell" aria-label="分析表示の切り替え">
      <div
        aria-label="分析セクション"
        className="detail-tabs"
        ref={tabListRef}
        role="tablist"
      >
        {DASHBOARD_TABS.map(tab => (
          <button
            aria-controls={`dashboard-panel-${tab.id}`}
            aria-selected={selectedTab === tab.id}
            className="detail-tab"
            id={`dashboard-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onKeyDown={event => handleKeyDown(event, tab.id)}
            ref={element => {
              if (element) tabRefs.current[tab.id] = element;
              else delete tabRefs.current[tab.id];
            }}
            role="tab"
            tabIndex={selectedTab === tab.id ? 0 : -1}
            type="button"
          >
            <span className="detail-tab-label">{tab.label}</span>
            <AvailabilityBadges compact counts={availability[tab.id]} />
          </button>
        ))}
      </div>
    </nav>
  );
}

function DashboardTabPanel({
  children,
  selectedTab,
  tab,
}: {
  children: ReactNode;
  selectedTab: DashboardTabId;
  tab: DashboardTabId;
}) {
  return (
    <section
      aria-labelledby={`dashboard-tab-${tab}`}
      className="detail-tab-panel"
      hidden={selectedTab !== tab}
      id={`dashboard-panel-${tab}`}
      role="tabpanel"
      tabIndex={0}
    >
      {selectedTab === tab ? children : null}
    </section>
  );
}

function Dashboard({
  navigationRevision,
  snapshot,
  onBack,
  onReload,
  reloadState,
  onSelectTab,
  selectedTab,
}: {
  navigationRevision: number;
  snapshot: AnalysisSnapshot;
  onBack: () => void;
  onReload: () => void;
  reloadState: SnapshotReloadState;
  onSelectTab: (tab: DashboardTabId) => void;
  selectedTab: DashboardTabId;
}) {
  const view = useMemo(() => mapSnapshotToDashboard(snapshot), [snapshot]);
  const [disclosures, setDisclosures] = useState<DashboardDisclosureState>({
    ...DEFAULT_DISCLOSURE_STATE,
  });
  const [hiddenPriceLineLabels, setHiddenPriceLineLabels] = useState<readonly string[]>([]);
  const [glossarySelection, setGlossarySelection] = useState<GlossarySelection>(null);
  const glossaryInvokerRef = useRef<HTMLButtonElement | null>(null);
  const glossarySelectionRef = useRef<GlossarySelection>(glossarySelection);
  const selectedTabRef = useRef(selectedTab);
  const previousSelectedTabRef = useRef(selectedTab);
  const previousNavigationRevisionRef = useRef(navigationRevision);
  const visiblePriceLines = useMemo(() => view.chart.priceLines.filter(
    line => !hiddenPriceLineLabels.includes(line.label),
  ), [hiddenPriceLineLabels, view.chart.priceLines]);
  const togglePriceLine = (label: string) => {
    setHiddenPriceLineLabels(current => current.includes(label)
      ? current.filter(item => item !== label)
      : [...current, label]);
  };
  const setDisclosure = (id: DashboardDisclosureId, open: boolean) => {
    setDisclosures(current => current[id] === open ? current : { ...current, [id]: open });
  };
  glossarySelectionRef.current = glossarySelection;
  selectedTabRef.current = selectedTab;

  const openGlossary = useCallback<OpenGlossary>((term, invoker) => {
    glossaryInvokerRef.current = invoker;
    setGlossarySelection(term);
  }, []);
  const openGlossaryIndex = (invoker: HTMLButtonElement) => {
    glossaryInvokerRef.current = invoker;
    setGlossarySelection('index');
  };
  const handleGlossaryClosed = useCallback(() => {
    setGlossarySelection(null);
    const invoker = glossaryInvokerRef.current;
    glossaryInvokerRef.current = null;
    window.requestAnimationFrame(() => {
      if (isVisibleFocusTarget(invoker)) {
        invoker.focus();
        return;
      }
      const activeTab = document.getElementById(`dashboard-tab-${selectedTabRef.current}`);
      if (isVisibleFocusTarget(activeTab)) {
        activeTab.focus();
        return;
      }
      focusGlossaryDestination();
    });
  }, []);

  useEffect(() => {
    if (
      previousSelectedTabRef.current !== selectedTab
      && glossarySelectionRef.current !== null
    ) {
      glossaryInvokerRef.current = null;
      setGlossarySelection(null);
    }
    previousSelectedTabRef.current = selectedTab;
  }, [selectedTab]);

  useEffect(() => {
    if (
      previousNavigationRevisionRef.current !== navigationRevision
      && glossarySelectionRef.current !== null
    ) {
      setGlossarySelection(null);
    }
    previousNavigationRevisionRef.current = navigationRevision;
  }, [navigationRevision]);

  useEffect(() => () => {
    if (glossarySelectionRef.current === null) return;
    glossaryInvokerRef.current = null;
    window.requestAnimationFrame(() => focusGlossaryDestination());
  }, []);

  const chartDescriptionId = 'stored-price-chart-description';
  const visibleLineDescription = visiblePriceLines.length > 0
    ? visiblePriceLines.map(line => `${line.label} ${line.displayPrice.text}`).join('、')
    : 'なし';
  const storedPriceDescription = view.chart.startDate.available && view.chart.endDate.available
    ? `保存済み調整後日足 ${view.chart.startDate.text}から${view.chart.endDate.text}。保存済み最新行の終値 ${view.chart.latestClose.text}。`
    : '保存済み調整後日足は利用できません。';
  const drawablePriceDescription = view.chart.bars.length === 0 && view.chart.startDate.available
    ? '完全なOHLCを持つ描画可能な行はありません。'
    : '';
  const chartDescription = `${storedPriceDescription}${drawablePriceDescription}表示中の価格線: ${visibleLineDescription}。`;
  const reloadMessage = reloadFeedbackMessage(reloadState, view.header.generatedAt);

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
            <h1 data-main-heading tabIndex={-1}>{view.header.companyName}</h1>
          </div>
          <p className="generated-at">生成日時 {view.header.generatedAt}</p>
        </div>
        <div className="hero-actions">
          <div className="snapshot-reload-control">
            <button
              aria-busy={reloadState.status === 'loading'}
              className="snapshot-reload-button"
              onClick={onReload}
              type="button"
            >
              保存済みSnapshotを再読み込み
            </button>
            <p
              aria-atomic="true"
              aria-live="polite"
              className={`snapshot-reload-feedback ${reloadState.status}`}
              role="status"
            >
              {reloadMessage}
            </p>
          </div>
          <button
            className="glossary-open"
            onClick={event => openGlossaryIndex(event.currentTarget)}
            type="button"
          >
            用語集
          </button>
          <div className={`status-badge ${view.header.status}`}>
            <span className="status-dot" />
            {view.header.status.toUpperCase()}
          </div>
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

      <section className="availability-overview" aria-label="Snapshotのデータ利用状況">
        <div>
          <strong>データ利用状況</strong>
          <AvailabilityBadges counts={view.availability.global} />
        </div>
        {view.availability.global.uncollected > 0 ? (
          <p>未収集は、このSnapshotでは未収集の項目です。0やSnapshotの失敗を意味しません。</p>
        ) : view.availability.global.unavailable === 0 ? (
          <p>利用不可・未収集として記録された項目はありません。</p>
        ) : null}
      </section>

      <DashboardTabs
        availability={view.availability.tabs}
        selectedTab={selectedTab}
        onSelect={onSelectTab}
      />

      {DASHBOARD_TABS.map(tab => (
        <DashboardTabPanel key={tab.id} selectedTab={selectedTab} tab={tab.id}>
          {tab.id === 'technical' ? (
            <>
      <Card title="株価チャート" eyebrow="調整後OHLCV" className="chart-panel">
        <div className="chart-presentation">
          <div className="chart-visual">
            <PriceChart
              bars={view.chart.bars}
              describedBy={chartDescriptionId}
              priceLines={visiblePriceLines}
            />
            <p className="chart-description" id={chartDescriptionId}>{chartDescription}</p>
          </div>
          <aside className="chart-context" aria-label="チャート表示情報">
            <section className="chart-legend" aria-labelledby="chart-legend-title">
              <h3 id="chart-legend-title">価格線</h3>
              <p>表示だけを切り替えます。保存値は変更しません。</p>
              {view.chart.priceLines.length > 0 ? (
                <div className="chart-line-toggles">
                  {view.chart.priceLines.map(line => {
                    const visible = !hiddenPriceLineLabels.includes(line.label);
                    return (
                      <button
                        aria-pressed={visible}
                        key={line.label}
                        onClick={() => togglePriceLine(line.label)}
                        type="button"
                      >
                        <span aria-hidden="true" style={{ backgroundColor: line.color }} />
                        <strong>{line.label}</strong>
                        <small>{line.displayPrice.text}</small>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="empty-state compact-empty">保存済み価格線はありません。</div>}
            </section>

            <section className="chart-latest-values" aria-labelledby="chart-latest-title">
              <h3 id="chart-latest-title">最新値</h3>
              {view.advancedTechnical ? (
                <>
                  <p>
                    データ基準日 <Value value={view.advancedTechnical.dataDate} />。
                    チャートのcrosshair日付とは連動しません。
                  </p>
                  <MetricGrid
                    guidance={{
                      'RSI 14': 'rsi',
                      MACD: 'macd',
                      'MACD シグナル': 'macd',
                      'MACD ヒストグラム': 'macd',
                      'ボリンジャー中心線': 'bollingerBands',
                      'ボリンジャー上限': 'bollingerBands',
                      'ボリンジャー下限': 'bollingerBands',
                    }}
                    metrics={view.advancedTechnical.metrics}
                    onOpenGuidance={openGlossary}
                  />
                  {view.advancedTechnical.unavailableReasons.length > 0 ? (
                    <p className="reason-list">
                      {view.advancedTechnical.unavailableReasons.join(' / ')}
                    </p>
                  ) : null}
                </>
              ) : <div className="empty-state compact-empty">テクニカル指標は未収集です。</div>}
            </section>
          </aside>
        </div>
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

      <Card title="出来高価格分布（Volume Profile）" eyebrow="日足OHLCVによる推定分布">
        <p className="disclosure-note">{VOLUME_PROFILE_CONTEXT_NOTE}</p>
        {view.volumeProfile.state !== 'not_collected' ? (
          <>
            <MetricGrid metrics={[
              { label: '分析基準日', value: view.volumeProfile.analysisAsOfDate },
              { label: '収集日時', value: view.volumeProfile.collectedAt },
              { label: 'データ基準日', value: view.volumeProfile.dataDate },
              { label: '対象期間の開始日', value: view.volumeProfile.windowStartDate },
              { label: '対象期間の終了日', value: view.volumeProfile.windowEndDate },
              { label: '入力日足数', value: view.volumeProfile.inputBarCount },
            ]} />
            <StoredDisclosure
              open={disclosures.volumeProfileMethodology}
              onOpenChange={open => setDisclosure('volumeProfileMethodology', open)}
              summary="算出方法・データ基準"
            >
              <MetricGrid metrics={[
                { label: '価格の基準', value: view.volumeProfile.priceBasis },
                { label: '出来高の基準', value: view.volumeProfile.volumeBasis },
                { label: '配分方法', value: view.volumeProfile.allocationMethod },
                { label: '価格帯分割方法', value: view.volumeProfile.binningMethod },
                { label: '指定価格帯数', value: view.volumeProfile.requestedBinCount },
                { label: '有効価格帯数', value: view.volumeProfile.effectiveBinCount },
                { label: '最小価格', value: view.volumeProfile.minPrice },
                { label: '最大価格', value: view.volumeProfile.maxPrice },
                { label: '算出方法ID', value: view.volumeProfile.methodology },
                { label: '推定方法ID', value: view.volumeProfile.approximation },
                {
                  label: 'コーポレートアクション基準',
                  value: view.volumeProfile.corporateActionBasisStatus,
                },
              ]} />
            </StoredDisclosure>
            {view.volumeProfile.state === 'available'
              && view.volumeProfile.poc
              && view.volumeProfile.valueArea ? (
                <>
                  <div className="two-column">
                    <article className="window-card">
                      <div className="guided-heading">
                        <h3>POC（最大出来高価格帯）</h3>
                        <GuidanceButton term="poc" onOpen={openGlossary} />
                      </div>
                      <MetricGrid metrics={[
                        { label: '価格帯番号', value: { text: String(view.volumeProfile.poc.binIndex), available: true } },
                        { label: '代表価格', value: view.volumeProfile.poc.price },
                        { label: '配分出来高', value: view.volumeProfile.poc.allocatedVolume },
                        { label: '出来高比率', value: view.volumeProfile.poc.volumeShare },
                      ]} />
                    </article>
                    <article className="window-card">
                      <h3>Value Area（保存済みの連続価格帯）</h3>
                      <MetricGrid guidance={{ VAL: 'val', VAH: 'vah' }} metrics={[
                        { label: '目標出来高比率', value: view.volumeProfile.valueArea.targetVolumeShare },
                        { label: '達成出来高比率', value: view.volumeProfile.valueArea.achievedVolumeShare },
                        { label: 'VAL', value: view.volumeProfile.valueArea.val },
                        { label: 'VAH', value: view.volumeProfile.valueArea.vah },
                        { label: '開始価格帯番号', value: { text: String(view.volumeProfile.valueArea.firstBinIndex), available: true } },
                        { label: '終了価格帯番号', value: { text: String(view.volumeProfile.valueArea.lastBinIndex), available: true } },
                      ]} onOpenGuidance={openGlossary} />
                    </article>
                  </div>
                  <VolumeProfileChart profile={view.volumeProfile} />
                  <StoredDisclosure
                    open={disclosures.volumeProfileBins}
                    onOpenChange={open => setDisclosure('volumeProfileBins', open)}
                    summary={`価格帯別分布 ${view.volumeProfile.bins.length}件`}
                  >
                    <div
                      aria-label="出来高価格分布の価格帯別データ"
                      className="table-scroll"
                      role="region"
                      tabIndex={0}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th>価格帯番号</th><th>下端</th><th>上端</th><th>代表価格</th>
                            <th>配分出来高</th><th>出来高比率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {view.volumeProfile.bins.map(bin => (
                            <tr key={bin.index}>
                              <th>{bin.index}</th>
                              <td><Value value={bin.lowerPrice} /></td>
                              <td><Value value={bin.upperPrice} /></td>
                              <td><Value value={bin.representativePrice} /></td>
                              <td><Value value={bin.allocatedVolume} /></td>
                              <td><Value value={bin.volumeShare} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </StoredDisclosure>
                </>
              ) : (
                <div className="empty-state">
                  出来高価格分布は利用できません。利用不可は0を意味しません。
                </div>
              )}
            {view.volumeProfile.unavailableReasons.length ? (
              <p className="reason-list">
                {view.volumeProfile.unavailableReasons.join(' / ')}
              </p>
            ) : null}
          </>
        ) : <div className="empty-state">出来高価格分布は未収集です。</div>}
      </Card>
            </>
          ) : null}

          {tab.id === 'fundamentals' ? (
        <Card title="同業比較" eyebrow="保存済みの決定論的比較">
          {view.peer ? (
            <>
              <div className="priority-line">
                <span>時価総額priority</span>
                <Value value={view.peer.marketCapPriority} />
                {view.peer.marketCapPriorityReason
                  ? <small>{view.peer.marketCapPriorityReason}</small>
                  : null}
              </div>
              <div
                aria-label="同業比較の指標一覧"
                className="table-scroll"
                role="region"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr><th>指標</th><th>対象企業</th><th>同業中央値</th><th>順位</th><th>パーセンタイル</th></tr>
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
          ) : null}

          {tab.id === 'supply-demand' ? (
        <Card title="信用需給" eyebrow="信用取引残高">
          <p className="section-context">
            公開された信用買残・売残と日次出来高から保存された需給指標です。未収集・利用不可は0ではありません。
          </p>
          {view.supplyDemand
            ? (
                <MetricGrid
                  guidance={{ 信用倍率: 'marginBalanceRatio', 消化日数: 'digestionDays' }}
                  metrics={view.supplyDemand}
                  onOpenGuidance={openGlossary}
                />
              )
            : <div className="empty-state">需給データは利用できません。</div>}
        </Card>
          ) : null}

          {tab.id === 'fundamentals' ? (
      <Card title="配当分析" eyebrow="基準日時点の決定論的な配当情報">
        <p className="disclosure-note">{ADVANCED_DIVIDEND_CONTEXT_NOTE}</p>
        {view.advancedDividend.state !== 'not_collected' ? (
          <>
            <div className="investor-flow-meta">
              <MetricGrid metrics={[
                { label: '分析基準日', value: view.advancedDividend.analysisAsOfDate },
                { label: 'データ基準日', value: view.advancedDividend.dataDate },
                { label: '収集日時', value: view.advancedDividend.collectedAt },
                {
                  label: '既存の配当利回り',
                  value: view.advancedDividend.existingDividendYield,
                  note: '既存analyze_financial_metricsのdeterministic value',
                },
              ]} />
            </div>

            <StoredDisclosure
              open={disclosures.advancedDividend}
              onOpenChange={open => setDisclosure('advancedDividend', open)}
              summary={(
                <>
                  年間観測 {view.advancedDividend.observations.length}件
                  {' / '}配当イベント {view.advancedDividend.events === null
                    ? '利用不可'
                    : `${view.advancedDividend.events.length}件`}
                  {' / '}データ基準日 <Value value={view.advancedDividend.dataDate} />
                </>
              )}
            >
            <section className="dividend-group">
              <h3>年度別観測</h3>
              {view.advancedDividend.observations.length ? (
                <div
                  aria-label="配当分析の年間観測"
                  className="table-scroll"
                  role="region"
                  tabIndex={0}
                >
                  <table className="advanced-dividend-table">
                    <thead>
                      <tr>
                        <th>種別</th><th>会計年度末</th><th>開示日</th>
                        <th>開示時刻</th><th>利用可能日</th><th>年間1株配当</th>
                        <th>配当性向</th><th>配当額のsource field</th>
                        <th>配当性向のsource field</th><th>開示番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.advancedDividend.observations.map(observation => (
                        <tr key={`${observation.disclosureNumber.text}-${observation.sourceField.text}`}>
                          <th>{observation.kind}</th>
                          <td><Value value={observation.fiscalYearEndDate} /></td>
                          <td><Value value={observation.disclosedDate} /></td>
                          <td><Value value={observation.disclosedTime} /></td>
                          <td><Value value={observation.sourceEligibleDate} /></td>
                          <td><Value value={observation.annualDividendPerShare} /></td>
                          <td><Value value={observation.payoutRatio} /></td>
                          <td><Value value={observation.sourceField} /></td>
                          <td><Value value={observation.payoutRatioSourceField} /></td>
                          <td><Value value={observation.disclosureNumber} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-state">年間配当観測は利用できません。</div>}
            </section>

            <section className="dividend-group">
              <h3>配当イベント</h3>
              {view.advancedDividend.events === null ? (
                <div className="empty-state">
                  event-level配当内訳は利用できません。利用不可はordinary-onlyや0を意味しません。
                </div>
              ) : view.advancedDividend.events.length ? (
                <div
                  aria-label="配当分析の配当イベント"
                  className="table-scroll"
                  role="region"
                  tabIndex={0}
                >
                  <table className="advanced-dividend-table">
                    <thead>
                      <tr>
                        <th>通知日</th><th>通知時刻</th><th>利用可能日</th>
                        <th>種別</th><th>決定区分</th><th>基準年月</th>
                        <th>1株配当合計</th><th>普通配当</th>
                        <th>記念配当</th><th>特別配当</th>
                        <th>基準日</th><th>権利基準日</th><th>権利落ち日</th>
                        <th>支払日</th><th>参照番号</th><th>CA参照番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.advancedDividend.events.map(event => (
                        <tr key={`${event.referenceNumber.text}-${event.corporateActionReferenceNumber.text}`}>
                          <td><Value value={event.notifiedDate} /></td>
                          <td><Value value={event.notifiedTime} /></td>
                          <td><Value value={event.sourceEligibleDate} /></td>
                          <td><Value value={event.kind} /></td>
                          <td><Value value={event.decision} /></td>
                          <td><Value value={event.recordDateYearMonth} /></td>
                          <td><Value value={event.dividendPerShare} /></td>
                          <td><Value value={event.ordinaryDividendPerShare} /></td>
                          <td><Value value={event.commemorativeDividendPerShare} /></td>
                          <td><Value value={event.specialDividendPerShare} /></td>
                          <td><Value value={event.recordDate} /></td>
                          <td><Value value={event.rightsRecordDate} /></td>
                          <td><Value value={event.exDate} /></td>
                          <td><Value value={event.paymentDate} /></td>
                          <td><Value value={event.referenceNumber} /></td>
                          <td><Value value={event.corporateActionReferenceNumber} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">Snapshotのreplay後event rowsは0件です。</div>
              )}
            </section>
            </StoredDisclosure>

            {view.advancedDividend.unavailableReasons.length ? (
              <p className="reason-list">
                {view.advancedDividend.unavailableReasons.join(' / ')}
              </p>
            ) : null}
          </>
        ) : <div className="empty-state">配当分析は未収集です。</div>}
      </Card>
          ) : null}

          {tab.id === 'supply-demand' ? (
      <Card
        title="公開空売り残高報告"
        eyebrow="J-Quants 公開基準 0.5%以上"
        guidanceTerm="reportedShortPositions"
        onOpenGuidance={openGlossary}
      >
        <p className="disclosure-note">{REPORTED_SHORT_POSITION_DISCLOSURE_NOTE}</p>
        {view.reportedShortPositions.reports.length > 0 ? (
          <StoredDisclosure
            open={disclosures.reportedShortPositions}
            onOpenChange={open => setDisclosure('reportedShortPositions', open)}
            summary={(
              <>
                公開報告 {view.reportedShortPositions.reports.length}件
                {' / '}データ基準日 <Value value={view.reportedShortPositions.dataDate} />
              </>
            )}
          >
            <div
              aria-label="公開空売り残高報告の全報告"
              className="table-scroll"
              role="region"
              tabIndex={0}
            >
              <table className="short-position-table">
                <thead>
                  <tr>
                    <th>開示日</th>
                    <th>計算日</th>
                    <th>報告者</th>
                    <th>運用委託先</th>
                    <th>ファンド</th>
                    <th>残高比率</th>
                    <th>残高株数</th>
                    <th>前回計算日</th>
                    <th>前回残高比率</th>
                    <th>比率増減</th>
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
          </StoredDisclosure>
        ) : (
          <div className="empty-state">
            {view.reportedShortPositions.state === 'not_collected'
              ? '公開空売り残高報告は未収集です。'
              : `公開空売り残高報告は利用できません。${view.reportedShortPositions.unavailableReasons.join(' / ')}`}
          </div>
        )}
      </Card>
          ) : null}

          {tab.id === 'market' ? (
      <Card
        title="投資部門別売買"
        eyebrow="東京・名古屋市場の週次情報"
        guidanceTerm="investorTypeFlows"
        onOpenGuidance={openGlossary}
      >
        <p className="disclosure-note">{INVESTOR_TYPE_FLOW_CONTEXT_NOTE}</p>
        {view.investorTypeFlows.state === 'available' ? (
          <>
            <div className="investor-flow-meta">
              <MetricGrid metrics={[
                { label: '市場区分', value: view.investorTypeFlows.section },
                { label: '公表日', value: view.investorTypeFlows.publishedDate },
                { label: '対象期間の開始日', value: view.investorTypeFlows.periodStartDate },
                { label: '対象期間の終了日', value: view.investorTypeFlows.periodEndDate },
              ]} />
            </div>
            <section className="investor-flow-group">
              <h3>集計</h3>
              <InvestorTypeTable
                label="投資部門別売買の集計"
                rows={view.investorTypeFlows.summary}
              />
            </section>
            <StoredDisclosure
              open={disclosures.investorBrokerage}
              onOpenChange={open => setDisclosure('investorBrokerage', open)}
              summary={`委託内訳 ${view.investorTypeFlows.brokerageBreakdown.length}区分`}
            >
              <section className="investor-flow-group">
                <h3 className="visually-hidden">委託内訳</h3>
                <InvestorTypeTable
                  label="投資部門別売買の委託内訳"
                  rows={view.investorTypeFlows.brokerageBreakdown}
                />
            </section>
            </StoredDisclosure>
          </>
        ) : (
          <div className="empty-state">
            {view.investorTypeFlows.state === 'not_collected'
              ? '投資部門別データは未収集です。'
              : `投資部門別データは利用できません。${view.investorTypeFlows.unavailableReasons.join(' / ')}`}
          </div>
        )}
      </Card>
          ) : null}

          {tab.id === 'market' ? (
        <Card title="市場相関" eyebrow="TOPIXとの比較">
          <p className="section-context">
            日付を一致させた銘柄とTOPIXのリターンから計算され、Snapshotへ保存された期間別の比較です。
          </p>
          {view.correlations?.length ? (
            <div className="correlation-grid">
              {view.correlations.map(window => (
                <article className="window-card" key={window.period}>
                  <h3>{window.period}日</h3>
                  <MetricGrid guidance={{ Beta: 'beta', '年率Alpha': 'alpha', 'R²': 'rSquared' }} metrics={[
                    { label: '観測数', value: window.observations },
                    { label: '相関係数', value: window.correlation },
                    { label: 'Beta', value: window.beta },
                    { label: '年率Alpha', value: window.alpha },
                    { label: 'R²', value: window.rSquared },
                  ]} onOpenGuidance={openGlossary} />
                  {window.unavailableReasons.length
                    ? <p className="reason-list">{window.unavailableReasons.join(' / ')}</p>
                    : null}
                </article>
              ))}
            </div>
          ) : <div className="empty-state">市場相関は利用できません。</div>}
        </Card>
          ) : null}

          {tab.id === 'market' ? (
      <Card title="業種指数比較" eyebrow="東証33業種の株価指数">
        <p className="disclosure-note">{SECTOR_BENCHMARK_CONTEXT_NOTE}</p>
        {view.sectorBenchmark.state !== 'not_collected' ? (
          <>
            <MetricGrid metrics={[
              { label: '分析基準日', value: view.sectorBenchmark.analysisAsOfDate },
              { label: '比較対象種別', value: view.sectorBenchmark.benchmarkType },
              { label: '業種コード', value: view.sectorBenchmark.sectorCode },
              { label: '業種名', value: view.sectorBenchmark.sectorName },
              { label: '指数コード', value: view.sectorBenchmark.indexCode },
              { label: '業種分類の基準日', value: view.sectorBenchmark.classificationDate },
              { label: 'データ基準日', value: view.sectorBenchmark.dataDate },
              { label: '日付一致終値数', value: view.sectorBenchmark.alignedPriceCount },
            ]} />
            {view.sectorBenchmark.windows.length ? (
              <div className="correlation-grid">
                {view.sectorBenchmark.windows.map(window => (
                  <article className="window-card" key={window.period}>
                    <h3>{window.period}日</h3>
                    <MetricGrid guidance={{ Beta: 'beta', '年率Alpha': 'alpha', 'R²': 'rSquared' }} metrics={[
                      { label: '観測数', value: window.observations },
                      { label: '相関係数', value: window.correlation },
                      { label: 'Beta', value: window.beta },
                      { label: '年率Alpha', value: window.alpha },
                      { label: 'R²', value: window.rSquared },
                      { label: '銘柄の年率ボラティリティ', value: window.stockVolatility },
                      { label: '業種指数の年率ボラティリティ', value: window.benchmarkVolatility },
                      { label: '超過リターン', value: window.excessReturn },
                    ]} onOpenGuidance={openGlossary} />
                    {window.unavailableReasons.length
                      ? <p className="reason-list">{window.unavailableReasons.join(' / ')}</p>
                      : null}
                  </article>
                ))}
              </div>
            ) : null}
            {view.sectorBenchmark.unavailableReasons.length ? (
              <p className="reason-list">
                業種指数比較は利用できません。{view.sectorBenchmark.unavailableReasons.join(' / ')}
              </p>
            ) : null}
          </>
        ) : (
          <div className="empty-state">業種指数比較は未収集です。</div>
        )}
      </Card>
          ) : null}

          {tab.id === 'market' ? (
      <Card title="業種別空売り売買代金" eyebrow="東証33業種の日次売買代金">
        <p className="disclosure-note">{SECTOR_SHORT_RATIO_CONTEXT_NOTE}</p>
        {view.sectorShortRatio.state !== 'not_collected' ? (
          <>
            <MetricGrid metrics={[
              { label: '分析基準日', value: view.sectorShortRatio.analysisAsOfDate },
              { label: '業種分類の基準日', value: view.sectorShortRatio.classificationDate },
              { label: '業種コード', value: view.sectorShortRatio.sectorCode },
              { label: '業種名', value: view.sectorShortRatio.sectorName },
              { label: 'データ基準日', value: view.sectorShortRatio.dataDate },
            ]} />
            <p className="record-count">保存済み観測 {view.sectorShortRatio.observations.length}件</p>
            {view.sectorShortRatio.observations.length ? (
              <div
                aria-label="業種別空売り売買代金の観測一覧"
                className="table-scroll"
                role="region"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>日付</th><th>空売り以外</th><th>価格規制あり空売り</th>
                      <th>価格規制なし空売り</th><th>空売り合計</th>
                      <th>売り合計</th><th>空売り比率</th><th>利用状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.sectorShortRatio.observations.map(observation => (
                      <tr key={observation.date.text}>
                        <td><Value value={observation.date} /></td>
                        <td><Value value={observation.nonShortSellingValue} /></td>
                        <td><Value value={observation.restrictedShortSellingValue} /></td>
                        <td><Value value={observation.unrestrictedShortSellingValue} /></td>
                        <td><Value value={observation.shortSellingValue} /></td>
                        <td><Value value={observation.totalSellingValue} /></td>
                        <td><Value value={observation.shortSellingRatio} /></td>
                        <td>{observation.unavailableReasons.join(' / ') || '利用可能'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {view.sectorShortRatio.unavailableReasons.length ? (
              <p className="reason-list">
                業種別空売り売買代金は利用できません。{view.sectorShortRatio.unavailableReasons.join(' / ')}
              </p>
            ) : null}
          </>
        ) : (
          <div className="empty-state">業種別空売り売買代金は未収集です。</div>
        )}
      </Card>
          ) : null}

          {tab.id === 'technical' ? (
        <Card title="戦略水準" eyebrow="保存済みの決定論的水準">
          {view.strategy ? (
            <>
              <MetricGrid metrics={[
                { label: '発動条件', value: view.strategy.trigger },
                { label: '確定Entry', value: view.strategy.exactEntry },
              ]} />
              {view.strategy.candidates.map((candidate, index) => (
                <article className="strategy-candidate" key={`${candidate.entry.text}-${index}`}>
                  <span>実行可能な候補 {index + 1}</span>
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
          ) : <div className="empty-state">戦略水準は利用できません。</div>}
        </Card>
          ) : null}

          {tab.id === 'report' ? (
            <>
      <div className="two-column">
        <Card title="データ基準日" eyebrow="ソース基準日">
          <MetricGrid metrics={view.dataDates} />
        </Card>
        <Card title="データ状態" eyebrow={`保存済みレコード ${view.unavailable.length}件`}>
          <AvailabilityBadges counts={view.availability.global} />
          <section className="data-state-group" aria-labelledby="uncollected-sections-heading">
            <h3 id="uncollected-sections-heading">未収集セクション</h3>
            {view.availability.uncollectedSections.length ? (
              <ul className="unavailable-list">
                {view.availability.uncollectedSections.map(section => (
                  <li key={section}>
                    <strong>{section}</strong>
                    <span>このSnapshotでは未収集</span>
                  </li>
                ))}
              </ul>
            ) : <p className="clear-state">未収集セクションはありません。</p>}
          </section>
          <section className="data-state-group" aria-labelledby="stored-state-records-heading">
            <h3 id="stored-state-records-heading">保存済みデータ状態レコード</h3>
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
            ) : <p className="clear-state">保存済みデータ状態レコードはありません。</p>}
          </section>
        </Card>
      </div>

      <Card title="総合レポート" eyebrow="Agentによる文章">
        <pre className="report-markdown">{view.finalReportMarkdown}</pre>
      </Card>

      {view.scenarios ? (
        <Card title="シナリオ" eyebrow="構造化された文章">
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
        <Card title="リスク" eyebrow="構造化された文章">
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
            </>
          ) : null}

        </DashboardTabPanel>
      ))}

      <footer className="footer">
        <span>DEXTER JP / READ-ONLY LOCAL ANALYSIS</span>
        <span>Snapshot値は再計算せず表示しています。</span>
      </footer>
      <GlossaryDialog
        selection={glossarySelection}
        onSelect={setGlossarySelection}
        onClosed={handleGlossaryClosed}
      />
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
          <h1 data-main-heading tabIndex={-1}>Saved Analysis</h1>
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
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Snapshot JSONを読み込めませんでした。');
  }
  const parsed = AnalysisSnapshotSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('Snapshotの形式を検証できませんでした。');
  }
  if (parsed.data.canonicalTicker !== ticker) {
    throw new Error('Snapshotの銘柄が表示中の銘柄と一致しません。');
  }
  return parsed.data;
}

function App() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(() => (
    parseDetailTicker(window.location.search)
  ));
  const [selectedTab, setSelectedTab] = useState<DashboardTabId>(() => (
    parseDetailTab(window.location.search)
  ));
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItemView[]>([]);
  const [sortKey, setSortKey] = useState<WatchlistSortKey>('latestDataDate');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadState, setReloadState] = useState<SnapshotReloadState>({ status: 'idle' });
  const selectedTickerRef = useRef(selectedTicker);
  const reloadAbortControllerRef = useRef<AbortController | null>(null);
  const reloadRequestTokenRef = useRef(0);
  const pendingGlossaryFocusRef = useRef<GlossaryFocusDestination | null>(null);
  selectedTickerRef.current = selectedTicker;

  const cancelSnapshotReload = useCallback(() => {
    reloadRequestTokenRef.current += 1;
    reloadAbortControllerRef.current?.abort();
    reloadAbortControllerRef.current = null;
    setReloadState({ status: 'idle' });
  }, []);

  const rememberGlossaryFocusDestination = (ticker: string | null) => {
    if (document.querySelector<HTMLDialogElement>('dialog.glossary-dialog[open]')) {
      pendingGlossaryFocusRef.current = ticker ? 'active-tab' : 'main-heading';
    }
  };

  useEffect(() => {
    const canonicalizeTab = (ticker: string, tab: DashboardTabId) => {
      if (!hasCanonicalDetailTab(window.location.search)) {
        window.history.replaceState(
          {},
          '',
          buildDetailPath(ticker, tab, window.location.search),
        );
      }
    };
    const initialTicker = parseDetailTicker(window.location.search);
    if (initialTicker) canonicalizeTab(initialTicker, parseDetailTab(window.location.search));

    const handlePopState = () => {
      const focusWasInTablist = document.activeElement instanceof HTMLElement
        && document.activeElement.closest('[role="tablist"]') !== null;
      const nextTicker = parseDetailTicker(window.location.search);
      const nextTab = nextTicker
        ? parseDetailTab(window.location.search)
        : DEFAULT_DASHBOARD_TAB;
      if (nextTicker) canonicalizeTab(nextTicker, nextTab);
      rememberGlossaryFocusDestination(nextTicker);
      if (nextTicker !== selectedTickerRef.current) {
        cancelSnapshotReload();
        setLoading(true);
      }
      setSelectedTicker(nextTicker);
      setSelectedTab(nextTab);
      setNavigationRevision(current => current + 1);
      if (nextTicker && focusWasInTablist) {
        window.requestAnimationFrame(() => {
          document.getElementById(`dashboard-tab-${nextTab}`)?.focus();
        });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [cancelSnapshotReload]);

  useEffect(() => () => {
    reloadRequestTokenRef.current += 1;
    reloadAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const destination = pendingGlossaryFocusRef.current;
    if (!destination || loading) return;
    const target = destination === 'active-tab' && selectedTicker && snapshot && !error
      ? document.getElementById(`dashboard-tab-${selectedTab}`)
      : document.querySelector<HTMLElement>('[data-main-heading]');
    if (isVisibleFocusTarget(target)) {
      target.focus();
      pendingGlossaryFocusRef.current = null;
    }
  }, [error, loading, selectedTab, selectedTicker, snapshot]);

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
    rememberGlossaryFocusDestination(ticker);
    cancelSnapshotReload();
    window.history.pushState(
      {},
      '',
      buildDetailPath(ticker, DEFAULT_DASHBOARD_TAB, window.location.search),
    );
    setLoading(true);
    setSelectedTicker(ticker);
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
  };
  const navigateToWatchlist = () => {
    rememberGlossaryFocusDestination(null);
    cancelSnapshotReload();
    window.history.pushState({}, '', buildWatchlistPath(window.location.search));
    setLoading(true);
    setSelectedTicker(null);
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
  };
  const navigateToTab = (tab: DashboardTabId) => {
    if (!selectedTicker) return;
    window.history.replaceState(
      {},
      '',
      buildDetailPath(selectedTicker, tab, window.location.search),
    );
    setSelectedTab(tab);
  };
  const reloadSnapshot = () => {
    if (!selectedTicker || !snapshot) return;
    const requestedTicker = selectedTicker;
    const displayedIdentity = `${snapshot.canonicalTicker}:${snapshot.generatedAt}`;
    reloadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    const requestToken = reloadRequestTokenRef.current + 1;
    reloadRequestTokenRef.current = requestToken;
    reloadAbortControllerRef.current = abortController;
    setReloadState({ status: 'loading' });

    void fetchSnapshot(requestedTicker, abortController.signal)
      .then(nextSnapshot => {
        if (
          abortController.signal.aborted
          || reloadRequestTokenRef.current !== requestToken
          || selectedTickerRef.current !== requestedTicker
        ) return;
        const nextIdentity = `${nextSnapshot.canonicalTicker}:${nextSnapshot.generatedAt}`;
        if (nextIdentity === displayedIdentity) {
          setReloadState({ status: 'unchanged' });
          return;
        }
        setSnapshot(nextSnapshot);
        setReloadState({ status: 'updated' });
      })
      .catch((cause: unknown) => {
        if (
          abortController.signal.aborted
          || reloadRequestTokenRef.current !== requestToken
          || selectedTickerRef.current !== requestedTicker
        ) return;
        setReloadState({
          status: 'error',
          detail: cause instanceof Error ? cause.message : 'Snapshotを読み込めませんでした。',
        });
      })
      .finally(() => {
        if (reloadRequestTokenRef.current === requestToken) {
          reloadAbortControllerRef.current = null;
        }
      });
  };

  if (error) {
    return (
      <main className="load-state">
        <span className="brand-mark">DEXTER / JP</span>
        <h1 data-main-heading tabIndex={-1}>
          {selectedTicker ? 'Single Stock Dashboard' : 'Analysis Watchlist'}
        </h1>
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
        <h1 className="visually-hidden" tabIndex={-1}>
          {selectedTicker ? 'Single Stock Dashboard' : 'Analysis Watchlist'}
        </h1>
        <div className="loading-bar" />
        <p>{selectedTicker ? `${selectedTicker} Snapshotを読み込み中…` : '保存済みAnalysisを読み込み中…'}</p>
      </main>
    );
  }
  if (selectedTicker && snapshot) {
    return (
      <Dashboard
        key={`${snapshot.canonicalTicker}:${snapshot.generatedAt}`}
        navigationRevision={navigationRevision}
        snapshot={snapshot}
        onBack={navigateToWatchlist}
        onReload={reloadSnapshot}
        reloadState={reloadState}
        onSelectTab={navigateToTab}
        selectedTab={selectedTab}
      />
    );
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
