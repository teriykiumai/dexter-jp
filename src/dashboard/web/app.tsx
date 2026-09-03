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
} from '../../analysis/snapshot/schema.js';
import type {
  AnalysisSnapshotHistoryItem,
  AnalysisSnapshotLatestItem,
} from '../../analysis/snapshot/repository.js';
import {
  AnalysisSnapshotComparisonResponseV1Schema,
  type AnalysisSnapshotComparisonResponseV1,
} from '../../analysis/comparison/schema.js';
import { LIGHTWEIGHT_CHARTS_NOTICE, PriceChart } from './chart.js';
import {
  ComparisonPanel,
  type ComparisonPanelIssue,
} from './comparison-panel.js';
import {
  COMPARISON_PAIR_REQUIREMENT,
  buildComparisonPath,
  buildComparisonResetPath,
  comparisonSelectionKey,
  isValidComparisonPair,
  isSnapshotId,
  parseComparisonPageSelection,
  resolveComparisonPair,
  snapshotIdFromGeneratedAt,
  type ComparisonPageSelection,
  type ComparisonPair,
} from './comparison.js';
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
  buildDashboardTabPath,
  buildDetailPath,
  buildMarketOverviewPath,
  buildWatchlistPath,
  hasCanonicalDetailTab,
  formatMetric,
  mapSnapshotToDashboard,
  mapLatestAnalysisToWatchlistItem,
  moveDashboardTab,
  parseDashboardPageRoute,
  parseDetailTab,
  parseDetailTicker,
  type DashboardAvailabilityCount,
  type DashboardTabId,
  type InvestorTypeCategoryView,
  type VolumeProfileView,
  type WatchlistItemView,
  type WatchlistSortKey,
} from './presentation.js';
import { PeerRadarPresentation } from './peer-radar-view.js';
import { StrategyValidationPanel } from './strategy-validation-panel.js';
import { DashboardHeader, DashboardRouteError, MarketOverviewContent, MarketOverviewPlaceholder, Watchlist, type PageNavigation } from './watchlist.js';
import {
  Button,
  DashboardDesign,
  StatusBadge,
  StatusNotice,
  TableScroll,
  AvailabilityBadges,
  Card,
  GuidanceButton,
  MetricGrid,
  Value,
  type OpenGlossary,
} from './primitives.js';

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
        <Button
          aria-label="用語集を閉じる"
          className="glossary-close"
          onClick={() => dialogRef.current?.close()}
          ref={closeButtonRef}
          type="button"
        >
          閉じる
        </Button>
      </header>
      <p className="glossary-description" id="glossary-dialog-description">
        Snapshotに保存された指標の読み方と制約を確認できます。ここでは値を再計算しません。
      </p>
      {selectedEntry ? (
        <>
          <Button className="glossary-back" onClick={() => onSelect('index')} type="button">
            ← 用語一覧
          </Button>
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
              <Button onClick={() => onSelect(entry.id)} type="button">
                <strong>{entry.label}</strong>
                <span>{entry.measures}</span>
              </Button>
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
  | { status: 'unchanged'; pinned?: boolean }
  | { status: 'newer'; snapshotId: string }
  | { status: 'error'; detail: string };

type TargetSnapshotIssue = Readonly<{
  snapshotId: string;
  message: string;
}>;

function reloadFeedbackMessage(state: SnapshotReloadState, generatedAt: string): string | null {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return '保存済みSnapshotを再読み込み中…';
  const result = state.status === 'updated'
    ? '更新'
    : state.status === 'unchanged'
      ? state.pinned ? '新しい保存済み分析はありません' : '変更なし'
      : state.status === 'newer'
        ? '新しい保存済み分析があります'
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
                  <Value value={bin.representativePrice} kind="data" />
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
          <tr><th>公式区分</th><th className="numeric-cell">売り</th><th className="numeric-cell">買い</th><th className="numeric-cell">合計</th><th className="numeric-cell">差引</th></tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.category}>
              <th>{row.category}</th>
              <td className="numeric-cell"><Value value={row.sell} kind="data" /></td>
              <td className="numeric-cell"><Value value={row.buy} kind="data" /></td>
              <td className="numeric-cell"><Value value={row.total} kind="data" /></td>
              <td className="numeric-cell"><Value value={row.balance} kind="data" /></td>
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
      <p className="tabs-scroll-hint">タブは横にスクロールできます</p>
      <div
        aria-label="分析セクション"
        className="detail-tabs"
        ref={tabListRef}
        role="tablist"
      >
        {DASHBOARD_TABS.map(tab => (
          <Button
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
          </Button>
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
  comparison,
  comparisonIssue,
  comparisonLoading,
  comparisonNotice,
  comparisonPair,
  comparisonSelectionPresent,
  displayedSnapshotId,
  history,
  navigationRevision,
  snapshot,
  onBack,
  onReload,
  onAdoptNewerSnapshot,
  onChangeComparisonBase,
  onChangeComparisonTarget,
  onResetComparison,
  onRetryComparison,
  onStartComparison,
  onTargetRejected,
  reloadState,
  targetSnapshotIssue,
  targetSnapshotPending,
  onSelectTab,
  selectedTab,
  pageNavigation,
}: {
  pageNavigation: PageNavigation;
  comparison: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }> | null;
  comparisonIssue: ComparisonPanelIssue | null;
  comparisonLoading: boolean;
  comparisonNotice: string | null;
  comparisonPair: ComparisonPair | null;
  comparisonSelectionPresent: boolean;
  displayedSnapshotId: string | null;
  history: readonly AnalysisSnapshotHistoryItem[];
  navigationRevision: number;
  snapshot: AnalysisSnapshot;
  onBack: () => void;
  onReload: () => void;
  onAdoptNewerSnapshot: () => void;
  onChangeComparisonBase: (snapshotId: string) => void;
  onChangeComparisonTarget: (snapshotId: string) => void;
  onResetComparison: () => void;
  onRetryComparison: () => void;
  onStartComparison: () => void;
  onTargetRejected: () => void;
  reloadState: SnapshotReloadState;
  targetSnapshotIssue: TargetSnapshotIssue | null;
  targetSnapshotPending: boolean;
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
  const previousSnapshotIdentityRef = useRef(`${snapshot.canonicalTicker}:${snapshot.generatedAt}`);
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
    const snapshotIdentity = `${snapshot.canonicalTicker}:${snapshot.generatedAt}`;
    if (previousSnapshotIdentityRef.current === snapshotIdentity) return;
    previousSnapshotIdentityRef.current = snapshotIdentity;
    glossaryInvokerRef.current = null;
    setGlossarySelection(null);
    setDisclosures({ ...DEFAULT_DISCLOSURE_STATE });
    setHiddenPriceLineLabels([]);
  }, [snapshot.canonicalTicker, snapshot.generatedAt]);

  useEffect(() => {
    if (!targetSnapshotIssue || glossarySelectionRef.current === null) return;
    glossaryInvokerRef.current = null;
    setGlossarySelection(null);
  }, [targetSnapshotIssue]);

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
  const targetSnapshotBlocked = targetSnapshotPending || targetSnapshotIssue !== null;
  const requestedTargetSnapshotId = targetSnapshotIssue?.snapshotId ?? comparisonPair?.targetSnapshotId;

  return (
    <DashboardDesign>
    <DashboardHeader {...pageNavigation} />
    <main className={`design-content dashboard-shell${targetSnapshotBlocked ? ' target-snapshot-unavailable' : ''}`}>
      <Button className="back-button" type="button" onClick={onBack}>
        ← 保存済み分析
      </Button>
      <header className="hero">
        {targetSnapshotBlocked ? (
          <div className="target-snapshot-status">
            <div className="brand-line">
              <span className="brand-mark">DEXTER / JP</span>
              <StatusBadge label="LOCAL SNAPSHOT" />
            </div>
            <div className="company-title">
              <span className="ticker">{view.header.ticker}</span>
              <h1 data-main-heading tabIndex={-1}>
                {targetSnapshotIssue ? '対象Snapshotを表示できません' : '対象Snapshotを読み込み中…'}
              </h1>
            </div>
            <p className="target-snapshot-id">対象Snapshot <span className="design-data">{requestedTargetSnapshotId}</span></p>
          </div>
        ) : null}
        <div className="snapshot-detail-mask">
        <div>
          <div className="brand-line">
            <span className="brand-mark">DEXTER / JP</span>
            <StatusBadge label="LOCAL SNAPSHOT" />
          </div>
          <div className="company-title">
            <span className="ticker">{view.header.ticker}</span>
            <h1 data-main-heading tabIndex={-1}>{view.header.companyName}</h1>
          </div>
          <p className="generated-at">生成日時 <span className="design-metadata" data-kind="data">{view.header.generatedAt}</span></p>
        </div>
        <div className="hero-actions">
          <div className="snapshot-reload-control">
            <Button
              aria-busy={reloadState.status === 'loading'}
              className="snapshot-reload-button"
              onClick={onReload}
              type="button"
            >
              保存済みSnapshotを再読み込み
            </Button>
            <p
              aria-atomic="true"
              aria-live="polite"
              className={`snapshot-reload-feedback ${reloadState.status}`}
              role="status"
            >
              {reloadMessage}
            </p>
            {reloadState.status === 'newer' ? (
              <Button className="snapshot-adopt-button" onClick={onAdoptNewerSnapshot} type="button">
                新しい保存済み分析を対象にする
              </Button>
            ) : null}
          </div>
          <Button
            className="glossary-open"
            onClick={event => openGlossaryIndex(event.currentTarget)}
            type="button"
          >
            用語集
          </Button>
          <StatusBadge label={view.header.status.toUpperCase()} tone={view.header.status === 'complete' ? 'neutral' : 'warning'} />
        </div>
        </div>
      </header>

      <div className="snapshot-detail-mask">
      <section className="kpi-grid" aria-label="主要指標">
        {view.kpis.map(kpi => (
          <article className="kpi-card" key={kpi.label}>
            <span>{kpi.label}</span>
            <strong className={kpi.valueKind === 'data' && kpi.value.available ? 'design-kpi' : 'kpi-text'}><Value value={kpi.value} kind={kpi.valueKind} /></strong>
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
      </div>

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
                      <Button
                        aria-pressed={visible}
                        key={line.label}
                        onClick={() => togglePriceLine(line.label)}
                        type="button"
                      >
                        <span aria-hidden="true" style={{ backgroundColor: `var(${line.colorToken})` }} />
                        <strong>{line.label}</strong>
                        <small className="design-data">{line.displayPrice.text}</small>
                      </Button>
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
                    データ基準日 <Value value={view.advancedTechnical.dataDate} kind="data" />。
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
                    metrics={view.advancedTechnical.metrics.map(metric => ({ ...metric, valueKind: 'data' }))}
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
        <TableScroll label="保存済み調整後OHLCVの正確な値">
          <table className="stored-price-table">
            <caption>保存済み調整後OHLCV（全行・欠損は利用不可。チャートで描画できない行も含みます）</caption>
            <thead><tr><th>日付</th>{['始値', '高値', '安値', '終値', '出来高'].map(label => <th className="numeric-cell" key={label}>{label}</th>)}</tr></thead>
            <tbody>{snapshot.priceHistory?.map(bar => (
              <tr key={bar.date}>
                <th><span className="design-data">{bar.date}</span></th>
                {(['open', 'high', 'low', 'close', 'volume'] as const).map(field => (
                  <td className="numeric-cell" key={field}><Value kind="data" value={formatMetric(bar[field], snapshot.units.priceHistory[field])} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </TableScroll>
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
              { label: '分析基準日', valueKind: 'data', value: view.volumeProfile.analysisAsOfDate },
              { label: '収集日時', valueKind: 'data', value: view.volumeProfile.collectedAt },
              { label: 'データ基準日', valueKind: 'data', value: view.volumeProfile.dataDate },
              { label: '対象期間の開始日', valueKind: 'data', value: view.volumeProfile.windowStartDate },
              { label: '対象期間の終了日', valueKind: 'data', value: view.volumeProfile.windowEndDate },
              { label: '入力日足数', valueKind: 'data', value: view.volumeProfile.inputBarCount },
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
                { label: '指定価格帯数', valueKind: 'data', value: view.volumeProfile.requestedBinCount },
                { label: '有効価格帯数', valueKind: 'data', value: view.volumeProfile.effectiveBinCount },
                { label: '最小価格', valueKind: 'data', value: view.volumeProfile.minPrice },
                { label: '最大価格', valueKind: 'data', value: view.volumeProfile.maxPrice },
                { label: '算出方法ID', valueKind: 'data', value: view.volumeProfile.methodology },
                { label: '推定方法ID', valueKind: 'data', value: view.volumeProfile.approximation },
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
                        { label: '価格帯番号', valueKind: 'data', value: { text: String(view.volumeProfile.poc.binIndex), available: true } },
                        { label: '代表価格', valueKind: 'data', value: view.volumeProfile.poc.price },
                        { label: '配分出来高', valueKind: 'data', value: view.volumeProfile.poc.allocatedVolume },
                        { label: '出来高比率', valueKind: 'data', value: view.volumeProfile.poc.volumeShare },
                      ]} />
                    </article>
                    <article className="window-card">
                      <h3>Value Area（保存済みの連続価格帯）</h3>
                      <MetricGrid guidance={{ VAL: 'val', VAH: 'vah' }} metrics={[
                        { label: '目標出来高比率', valueKind: 'data', value: view.volumeProfile.valueArea.targetVolumeShare },
                        { label: '達成出来高比率', valueKind: 'data', value: view.volumeProfile.valueArea.achievedVolumeShare },
                        { label: 'VAL', valueKind: 'data', value: view.volumeProfile.valueArea.val },
                        { label: 'VAH', valueKind: 'data', value: view.volumeProfile.valueArea.vah },
                        { label: '開始価格帯番号', valueKind: 'data', value: { text: String(view.volumeProfile.valueArea.firstBinIndex), available: true } },
                        { label: '終了価格帯番号', valueKind: 'data', value: { text: String(view.volumeProfile.valueArea.lastBinIndex), available: true } },
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
                            <th>価格帯番号</th><th className="numeric-cell">下端</th><th className="numeric-cell">上端</th><th className="numeric-cell">代表価格</th>
                            <th className="numeric-cell">配分出来高</th><th className="numeric-cell">出来高比率</th>
                          </tr>
                        </thead>
                        <tbody>
                          {view.volumeProfile.bins.map(bin => (
                            <tr key={bin.index}>
                              <th><span className="design-data">{bin.index}</span></th>
                              <td className="numeric-cell"><Value value={bin.lowerPrice} kind="data" /></td>
                              <td className="numeric-cell"><Value value={bin.upperPrice} kind="data" /></td>
                              <td className="numeric-cell"><Value value={bin.representativePrice} kind="data" /></td>
                              <td className="numeric-cell"><Value value={bin.allocatedVolume} kind="data" /></td>
                              <td className="numeric-cell"><Value value={bin.volumeShare} kind="data" /></td>
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
            <PeerRadarPresentation peer={view.peer} />
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
                  metrics={view.supplyDemand.map(metric => ({ ...metric, valueKind: 'data' }))}
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
                { label: '分析基準日', valueKind: 'data', value: view.advancedDividend.analysisAsOfDate },
                { label: 'データ基準日', valueKind: 'data', value: view.advancedDividend.dataDate },
                { label: '収集日時', valueKind: 'data', value: view.advancedDividend.collectedAt },
                {
                  label: '既存の配当利回り',
                  valueKind: 'data',
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
                  {' / '}データ基準日 <Value value={view.advancedDividend.dataDate} kind="data" />
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
                        <th>開示時刻</th><th>利用可能日</th><th className="numeric-cell">年間1株配当</th>
                        <th className="numeric-cell">配当性向</th><th>配当額のsource field</th>
                        <th>配当性向のsource field</th><th>開示番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.advancedDividend.observations.map(observation => (
                        <tr key={`${observation.disclosureNumber.text}-${observation.sourceField.text}`}>
                          <th>{observation.kind}</th>
                          <td><Value value={observation.fiscalYearEndDate} kind="data" /></td>
                          <td><Value value={observation.disclosedDate} kind="data" /></td>
                          <td><Value value={observation.disclosedTime} kind="data" /></td>
                          <td><Value value={observation.sourceEligibleDate} kind="data" /></td>
                          <td className="numeric-cell"><Value value={observation.annualDividendPerShare} kind="data" /></td>
                          <td className="numeric-cell"><Value value={observation.payoutRatio} kind="data" /></td>
                          <td><Value value={observation.sourceField} /></td>
                          <td><Value value={observation.payoutRatioSourceField} /></td>
                          <td><Value value={observation.disclosureNumber} kind="data" /></td>
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
                        <th className="numeric-cell">1株配当合計</th><th className="numeric-cell">普通配当</th>
                        <th className="numeric-cell">記念配当</th><th className="numeric-cell">特別配当</th>
                        <th>基準日</th><th>権利基準日</th><th>権利落ち日</th>
                        <th>支払日</th><th>参照番号</th><th>CA参照番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.advancedDividend.events.map(event => (
                        <tr key={`${event.referenceNumber.text}-${event.corporateActionReferenceNumber.text}`}>
                          <td><Value value={event.notifiedDate} kind="data" /></td>
                          <td><Value value={event.notifiedTime} kind="data" /></td>
                          <td><Value value={event.sourceEligibleDate} kind="data" /></td>
                          <td><Value value={event.kind} /></td>
                          <td><Value value={event.decision} /></td>
                          <td><Value value={event.recordDateYearMonth} kind="data" /></td>
                          <td className="numeric-cell"><Value value={event.dividendPerShare} kind="data" /></td>
                          <td className="numeric-cell"><Value value={event.ordinaryDividendPerShare} kind="data" /></td>
                          <td className="numeric-cell"><Value value={event.commemorativeDividendPerShare} kind="data" /></td>
                          <td className="numeric-cell"><Value value={event.specialDividendPerShare} kind="data" /></td>
                          <td><Value value={event.recordDate} kind="data" /></td>
                          <td><Value value={event.rightsRecordDate} kind="data" /></td>
                          <td><Value value={event.exDate} kind="data" /></td>
                          <td><Value value={event.paymentDate} kind="data" /></td>
                          <td><Value value={event.referenceNumber} kind="data" /></td>
                          <td><Value value={event.corporateActionReferenceNumber} kind="data" /></td>
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
                {' / '}データ基準日 <Value value={view.reportedShortPositions.dataDate} kind="data" />
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
                    <th className="numeric-cell">残高比率</th>
                    <th className="numeric-cell">残高株数</th>
                    <th>前回計算日</th>
                    <th className="numeric-cell">前回残高比率</th>
                    <th className="numeric-cell">比率増減</th>
                  </tr>
                </thead>
                <tbody>
                  {view.reportedShortPositions.reports.map((report, index) => (
                    <tr key={`${report.disclosedDate.text}-${report.calculatedDate.text}-${index}`}>
                      <td><Value value={report.disclosedDate} kind="data" /></td>
                      <td><Value value={report.calculatedDate} kind="data" /></td>
                      <td><Value value={report.reporterName} /></td>
                      <td><Value value={report.discretionaryManagerName} /></td>
                      <td><Value value={report.fundName} /></td>
                      <td className="numeric-cell"><Value value={report.shortPositionRatio} kind="data" /></td>
                      <td className="numeric-cell"><Value value={report.shortPositionShares} kind="data" /></td>
                      <td><Value value={report.previousCalculatedDate} kind="data" /></td>
                      <td className="numeric-cell"><Value value={report.previousReportedRatio} kind="data" /></td>
                      <td className="numeric-cell"><Value value={report.ratioDelta} kind="data" /></td>
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
                { label: '公表日', valueKind: 'data', value: view.investorTypeFlows.publishedDate },
                { label: '対象期間の開始日', valueKind: 'data', value: view.investorTypeFlows.periodStartDate },
                { label: '対象期間の終了日', valueKind: 'data', value: view.investorTypeFlows.periodEndDate },
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
                    { label: '観測数', valueKind: 'data', value: window.observations },
                    { label: '相関係数', valueKind: 'data', value: window.correlation },
                    { label: 'Beta', valueKind: 'data', value: window.beta },
                    { label: '年率Alpha', valueKind: 'data', value: window.alpha },
                    { label: 'R²', valueKind: 'data', value: window.rSquared },
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
              { label: '分析基準日', valueKind: 'data', value: view.sectorBenchmark.analysisAsOfDate },
              { label: '比較対象種別', value: view.sectorBenchmark.benchmarkType },
              { label: '業種コード', valueKind: 'data', value: view.sectorBenchmark.sectorCode },
              { label: '業種名', value: view.sectorBenchmark.sectorName },
              { label: '指数コード', valueKind: 'data', value: view.sectorBenchmark.indexCode },
              { label: '業種分類の基準日', valueKind: 'data', value: view.sectorBenchmark.classificationDate },
              { label: 'データ基準日', valueKind: 'data', value: view.sectorBenchmark.dataDate },
              { label: '日付一致終値数', valueKind: 'data', value: view.sectorBenchmark.alignedPriceCount },
            ]} />
            {view.sectorBenchmark.windows.length ? (
              <div className="correlation-grid">
                {view.sectorBenchmark.windows.map(window => (
                  <article className="window-card" key={window.period}>
                    <h3>{window.period}日</h3>
                    <MetricGrid guidance={{ Beta: 'beta', '年率Alpha': 'alpha', 'R²': 'rSquared' }} metrics={[
                      { label: '観測数', valueKind: 'data', value: window.observations },
                      { label: '相関係数', valueKind: 'data', value: window.correlation },
                      { label: 'Beta', valueKind: 'data', value: window.beta },
                      { label: '年率Alpha', valueKind: 'data', value: window.alpha },
                      { label: 'R²', valueKind: 'data', value: window.rSquared },
                      { label: '銘柄の年率ボラティリティ', valueKind: 'data', value: window.stockVolatility },
                      { label: '業種指数の年率ボラティリティ', valueKind: 'data', value: window.benchmarkVolatility },
                      { label: '超過リターン', valueKind: 'data', value: window.excessReturn },
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
              { label: '分析基準日', valueKind: 'data', value: view.sectorShortRatio.analysisAsOfDate },
              { label: '業種分類の基準日', valueKind: 'data', value: view.sectorShortRatio.classificationDate },
              { label: '業種コード', valueKind: 'data', value: view.sectorShortRatio.sectorCode },
              { label: '業種名', value: view.sectorShortRatio.sectorName },
              { label: 'データ基準日', valueKind: 'data', value: view.sectorShortRatio.dataDate },
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
                      <th>日付</th><th className="numeric-cell">空売り以外</th><th className="numeric-cell">価格規制あり空売り</th>
                      <th className="numeric-cell">価格規制なし空売り</th><th className="numeric-cell">空売り合計</th>
                      <th className="numeric-cell">売り合計</th><th className="numeric-cell">空売り比率</th><th>利用状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.sectorShortRatio.observations.map(observation => (
                      <tr key={observation.date.text}>
                        <td><Value value={observation.date} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.nonShortSellingValue} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.restrictedShortSellingValue} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.unrestrictedShortSellingValue} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.shortSellingValue} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.totalSellingValue} kind="data" /></td>
                        <td className="numeric-cell"><Value value={observation.shortSellingRatio} kind="data" /></td>
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
                { label: '発動条件', valueKind: 'data', value: view.strategy.trigger },
                { label: '確定Entry', valueKind: 'data', value: view.strategy.exactEntry },
              ]} />
              {view.strategy.candidates.map((candidate, index) => (
                <article className="strategy-candidate" key={`${candidate.entry.text}-${index}`}>
                  <span>実行可能な候補 {index + 1}</span>
                  <MetricGrid metrics={[
                    { label: 'Entry', valueKind: 'data', value: candidate.entry },
                    { label: 'Stop', valueKind: 'data', value: candidate.stop },
                    { label: 'Target', valueKind: 'data', value: candidate.target },
                    { label: 'Reward / Risk', valueKind: 'data', value: candidate.rewardRisk },
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
      <ComparisonPanel
        comparison={comparison}
        displayedSnapshotId={displayedSnapshotId}
        history={history}
        issue={comparisonIssue}
        loading={comparisonLoading}
        notice={comparisonNotice}
        pair={comparisonPair}
        selectionPresent={comparisonSelectionPresent}
        ticker={snapshot.canonicalTicker}
        onAdoptBase={onChangeComparisonBase}
        onAdoptTarget={onChangeComparisonTarget}
        onReset={onResetComparison}
        onRetry={onRetryComparison}
        onStart={onStartComparison}
        onTargetRejected={onTargetRejected}
      />
      <div className="snapshot-detail-mask">
      <div className="two-column">
        <Card title="データ基準日" eyebrow="ソース基準日">
          <MetricGrid metrics={view.dataDates.map(metric => ({ ...metric, valueKind: 'data' }))} />
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
      </div>
            </>
          ) : null}

          {tab.id === 'market-overview' ? <MarketOverviewContent /> : null}

          {tab.id === 'validation' ? (
            <StrategyValidationPanel
              history={history}
              navigationRevision={navigationRevision}
              ticker={snapshot.canonicalTicker}
            />
          ) : null}

        </DashboardTabPanel>
      ))}

      <footer className="footer">
        <span>DEXTER JP / LOCAL ANALYSIS &amp; RESEARCH</span>
        <span>Snapshot値は再計算せず表示しています。</span>
      </footer>
      <GlossaryDialog
        selection={glossarySelection}
        onSelect={setGlossarySelection}
        onClosed={handleGlossaryClosed}
      />
    </main>
    </DashboardDesign>
  );
}

class DashboardHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DashboardHttpError';
    this.status = status;
  }
}

function isRetryablePairLoadFailure(cause: unknown): boolean {
  return cause instanceof DashboardHttpError && cause.status === 500;
}

async function fetchSnapshot(
  ticker: string,
  signal: AbortSignal,
  snapshotId?: string,
): Promise<AnalysisSnapshot> {
  const endpoint = snapshotId
    ? `/api/analyses/${ticker}/history/${encodeURIComponent(snapshotId)}`
    : `/api/analyses/${ticker}`;
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new DashboardHttpError(response.status, response.status === 404
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

function parseHistoryItems(payload: unknown, ticker: string): AnalysisSnapshotHistoryItem[] {
  if (!Array.isArray(payload)) throw new Error('保存済み分析履歴の形式を検証できませんでした。');
  const items: AnalysisSnapshotHistoryItem[] = [];
  for (const value of payload) {
    if (
      typeof value !== 'object'
      || value === null
      || !('snapshotId' in value)
      || !('canonicalTicker' in value)
      || !('companyName' in value)
      || !('generatedAt' in value)
      || !('status' in value)
      || !('dataDates' in value)
      || !isSnapshotId(value.snapshotId)
      || value.canonicalTicker !== ticker
      || typeof value.companyName !== 'string'
      || typeof value.generatedAt !== 'string'
      || !['complete', 'partial'].includes(String(value.status))
      || typeof value.dataDates !== 'object'
      || value.dataDates === null
    ) {
      throw new Error('保存済み分析履歴の形式を検証できませんでした。');
    }
    try {
      if (snapshotIdFromGeneratedAt(value.generatedAt) !== value.snapshotId) {
        throw new Error('identity mismatch');
      }
    } catch {
      throw new Error('保存済み分析履歴の同一性を検証できませんでした。');
    }
    items.push(value as AnalysisSnapshotHistoryItem);
  }
  return items;
}

async function fetchSnapshotHistory(
  ticker: string,
  signal: AbortSignal,
): Promise<AnalysisSnapshotHistoryItem[]> {
  const response = await fetch(`/api/analyses/${ticker}/history`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new DashboardHttpError(response.status, '保存済み分析履歴を読み込めませんでした。');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('保存済み分析履歴JSONを読み込めませんでした。');
  }
  return parseHistoryItems(payload, ticker);
}

type ComparisonFetchResult = Readonly<{
  response: AnalysisSnapshotComparisonResponseV1;
  status: number;
}>;

async function fetchComparison(
  ticker: string,
  pair: ComparisonPair,
  signal: AbortSignal,
): Promise<ComparisonFetchResult> {
  const parameters = new URLSearchParams({
    baseSnapshotId: pair.baseSnapshotId,
    targetSnapshotId: pair.targetSnapshotId,
  });
  const response = await fetch(`/api/analyses/${ticker}/comparison?${parameters.toString()}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('比較結果JSONを読み込めませんでした。');
  }
  const parsed = AnalysisSnapshotComparisonResponseV1Schema.safeParse(payload);
  if (!parsed.success) throw new Error('比較結果の形式を検証できませんでした。');
  const matchesRequest = parsed.data.outcome === 'success'
    ? parsed.data.ticker === ticker
      && parsed.data.base.snapshotId === pair.baseSnapshotId
      && parsed.data.target.snapshotId === pair.targetSnapshotId
    : parsed.data.request.ticker === ticker
      && parsed.data.request.baseSnapshotId === pair.baseSnapshotId
      && parsed.data.request.targetSnapshotId === pair.targetSnapshotId;
  if (!matchesRequest) throw new Error('比較結果の対象が現在の選択と一致しません。');
  return { response: parsed.data, status: response.status };
}

function comparisonFailureMessage(
  response: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'failure' }>,
): string {
  const labels: Readonly<Record<string, string>> = {
    invalid_ticker: '比較対象の銘柄が不正です。',
    invalid_base_snapshot_id: '基準Snapshot IDが不正です。',
    invalid_target_snapshot_id: '対象Snapshot IDが不正です。',
    same_snapshot_id: '同じSnapshot同士は比較できません。',
    base_snapshot_not_found: '基準Snapshotが見つかりません。',
    target_snapshot_not_found: '対象Snapshotが見つかりません。',
    base_ticker_mismatch: '基準Snapshotの銘柄が一致しません。',
    target_ticker_mismatch: '対象Snapshotの銘柄が一致しません。',
    invalid_order: '基準Snapshotは対象Snapshotより前である必要があります。',
    unsupported_snapshot_version: '未対応のSnapshotバージョンです。',
    corrupt_snapshot: '保存済みSnapshotが破損しているため比較できません。',
    snapshot_filesystem_failure: '保存済みSnapshotを読み込めないため比較できません。',
  };
  return labels[response.error.code] ?? '保存済み分析を比較できませんでした。';
}

function matchingHistorySnapshotId(
  history: readonly AnalysisSnapshotHistoryItem[],
  snapshot: AnalysisSnapshot,
): string | null {
  return history.find(item => (
    item.canonicalTicker === snapshot.canonicalTicker && item.generatedAt === snapshot.generatedAt
  ))?.snapshotId ?? null;
}

function App() {
  const [pageRoute, setPageRoute] = useState(() => parseDashboardPageRoute(window.location.search));
  const selectedTicker = pageRoute.kind === 'detail' ? pageRoute.ticker : null;
  const [selectedTab, setSelectedTab] = useState<DashboardTabId>(() => (
    parseDetailTab(window.location.search)
  ));
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonPageSelection>(() => (
    pageRoute.kind === 'detail' ? parseComparisonPageSelection(window.location.search) : { kind: 'none' }
  ));
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [displayedSnapshotId, setDisplayedSnapshotId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<AnalysisSnapshotHistoryItem[]>([]);
  const [comparison, setComparison] = useState<
    Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }> | null
  >(null);
  const [comparisonPair, setComparisonPair] = useState<ComparisonPair | null>(null);
  const [comparisonIssue, setComparisonIssue] = useState<ComparisonPanelIssue | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonNotice, setComparisonNotice] = useState<string | null>(null);
  const [targetSnapshotIssue, setTargetSnapshotIssue] = useState<TargetSnapshotIssue | null>(null);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItemView[] | null>(null);
  const [sortKey, setSortKey] = useState<WatchlistSortKey>('latestDataDate');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadState, setReloadState] = useState<SnapshotReloadState>({ status: 'idle' });
  const selectedTickerRef = useRef(selectedTicker);
  const comparisonSelectionRef = useRef(comparisonSelection);
  const snapshotRef = useRef(snapshot);
  const mainRequestTokenRef = useRef(0);
  const reloadAbortControllerRef = useRef<AbortController | null>(null);
  const reloadRequestTokenRef = useRef(0);
  const pendingNavigationFocusRef = useRef<GlossaryFocusDestination | null>(null);
  const navigationFocusOriginRef = useRef<Element | null>(null);
  const pageRouteRef = useRef(pageRoute);
  pageRouteRef.current = pageRoute;
  selectedTickerRef.current = selectedTicker;
  comparisonSelectionRef.current = comparisonSelection;
  snapshotRef.current = snapshot;
  const selectionKey = comparisonSelectionKey(comparisonSelection);

  const cancelSnapshotReload = useCallback(() => {
    reloadRequestTokenRef.current += 1;
    reloadAbortControllerRef.current?.abort();
    reloadAbortControllerRef.current = null;
    setReloadState({ status: 'idle' });
  }, []);

  const queueNavigationFocus = (destination: GlossaryFocusDestination) => {
    pendingNavigationFocusRef.current = destination;
    navigationFocusOriginRef.current = document.activeElement;
  };
  const rememberNavigationFocusDestination = (ticker: string | null, pageChanged = false) => {
    if (pageChanged) queueNavigationFocus('main-heading');
    if (document.querySelector<HTMLDialogElement>('dialog.glossary-dialog[open]')) {
      queueNavigationFocus(ticker ? 'active-tab' : 'main-heading');
    }
  };

  useEffect(() => {
    const canonicalizeTab = (ticker: string, tab: DashboardTabId) => {
      if (!hasCanonicalDetailTab(window.location.search)) {
        window.history.replaceState(
          window.history.state ?? {},
          '',
          buildDashboardTabPath(ticker, tab, window.location.search),
        );
      }
    };
    const initialRoute = parseDashboardPageRoute(window.location.search);
    if (initialRoute.kind === 'detail') canonicalizeTab(initialRoute.ticker, parseDetailTab(window.location.search));

    const handlePopState = () => {
      const focusWasInTablist = document.activeElement instanceof HTMLElement
        && document.activeElement.closest('[role="tablist"]') !== null;
      const nextRoute = parseDashboardPageRoute(window.location.search);
      const nextTicker = nextRoute.kind === 'detail' ? nextRoute.ticker : null;
      const nextTab = nextTicker ? parseDetailTab(window.location.search) : DEFAULT_DASHBOARD_TAB;
      const nextComparison: ComparisonPageSelection = nextTicker
        ? parseComparisonPageSelection(window.location.search)
        : { kind: 'none' };
      if (nextTicker) canonicalizeTab(nextTicker, nextTab);
      const pageChanged = nextRoute.kind !== pageRouteRef.current.kind;
      rememberNavigationFocusDestination(nextTicker, pageChanged);
      const loadIdentityChanged = pageChanged || nextTicker !== selectedTickerRef.current
        || comparisonSelectionKey(nextComparison) !== comparisonSelectionKey(comparisonSelectionRef.current);
      if (loadIdentityChanged) {
        mainRequestTokenRef.current += 1;
        cancelSnapshotReload();
        setError(null);
        setComparison(null);
        setComparisonPair(nextComparison.kind === 'valid' ? nextComparison.pair : null);
        setComparisonIssue(null);
        setComparisonNotice(null);
        setTargetSnapshotIssue(null);
        if (nextTicker && snapshotRef.current?.canonicalTicker === nextTicker) {
          setComparisonLoading(true);
        } else {
          setComparisonLoading(false);
          setLoading(true);
        }
      }
      setPageRoute(nextRoute);
      setSelectedTab(nextTab);
      setComparisonSelection(nextComparison);
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
    mainRequestTokenRef.current += 1;
    reloadRequestTokenRef.current += 1;
    reloadAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const destination = pendingNavigationFocusRef.current;
    if (!destination || loading) return;
    const activeElement = document.activeElement;
    // A user who moved focus while a read was pending owns the new destination.
    if (activeElement instanceof HTMLElement && activeElement !== document.body
      && activeElement !== navigationFocusOriginRef.current && isVisibleFocusTarget(activeElement)) {
      pendingNavigationFocusRef.current = null;
      navigationFocusOriginRef.current = null;
      return;
    }
    const target = destination === 'active-tab' && selectedTicker && snapshot && !error
      ? document.getElementById(`dashboard-tab-${selectedTab}`)
      : document.querySelector<HTMLElement>('[data-main-heading]');
    if (isVisibleFocusTarget(target)) {
      target.focus();
      pendingNavigationFocusRef.current = null;
      navigationFocusOriginRef.current = null;
    }
  }, [error, loading, selectedTab, selectedTicker, snapshot, pageRoute.kind, navigationRevision]);

  useEffect(() => {
    const abortController = new AbortController();
    const requestToken = mainRequestTokenRef.current + 1;
    mainRequestTokenRef.current = requestToken;
    const isCurrent = () => !abortController.signal.aborted
      && mainRequestTokenRef.current === requestToken;
    if (pageRoute.kind !== 'detail' && pageRoute.kind !== 'watchlist') {
      setSnapshot(null);
      setDisplayedSnapshotId(null);
      setHistoryItems([]);
      setError(null);
      setLoading(false);
      setComparisonLoading(false);
      return () => abortController.abort();
    }
    const scopedDetailLoad = selectedTicker !== null
      && snapshot !== null
      && snapshot.canonicalTicker === selectedTicker;
    if (scopedDetailLoad) {
      setComparisonLoading(true);
    } else {
      setComparisonLoading(false);
      setLoading(true);
    }
    setError(null);
    setComparison(null);
    setComparisonPair(scopedDetailLoad && comparisonSelection.kind === 'valid'
      ? comparisonSelection.pair
      : null);
    setComparisonIssue(null);
    setComparisonNotice(null);
    setTargetSnapshotIssue(null);

    if (selectedTicker) {
      if (!scopedDetailLoad) {
        setSnapshot(null);
        setDisplayedSnapshotId(null);
      }
      void (async () => {
        const history = await fetchSnapshotHistory(selectedTicker, abortController.signal);
        if (!isCurrent()) return;
        if (comparisonSelection.kind === 'valid') {
          const [targetResult, comparisonResult] = await Promise.allSettled([
            fetchSnapshot(selectedTicker, abortController.signal, comparisonSelection.pair.targetSnapshotId),
            fetchComparison(selectedTicker, comparisonSelection.pair, abortController.signal),
          ]);
          if (!isCurrent()) return;
          setHistoryItems(history);
          if (targetResult.status === 'rejected') {
            const message = targetResult.reason instanceof Error
              ? targetResult.reason.message
              : '対象Snapshotを読み込めませんでした。';
            setComparisonPair(comparisonSelection.pair);
            setComparisonIssue({
              message,
              retryable: isRetryablePairLoadFailure(targetResult.reason),
            });
            setTargetSnapshotIssue({
              snapshotId: comparisonSelection.pair.targetSnapshotId,
              message,
            });
            return;
          }
          setSnapshot(targetResult.value);
          setDisplayedSnapshotId(comparisonSelection.pair.targetSnapshotId);
          setComparisonPair(comparisonSelection.pair);
          if (comparisonResult.status === 'rejected') {
            setComparisonIssue({
              message: comparisonResult.reason instanceof Error
                ? comparisonResult.reason.message
                : '比較結果を読み込めませんでした。',
              retryable: false,
            });
            return;
          }
          const fetchedComparison = comparisonResult.value;
          if (fetchedComparison.response.outcome === 'success' && fetchedComparison.status === 200) {
            setComparison(fetchedComparison.response);
          } else if (fetchedComparison.response.outcome === 'failure') {
            setComparisonIssue({
              message: comparisonFailureMessage(fetchedComparison.response),
              retryable: fetchedComparison.status === 500,
            });
          } else {
            setComparisonIssue({
              message: '比較APIの状態が不正です。',
              retryable: fetchedComparison.status === 500,
            });
          }
          return;
        }

        setComparisonPair(null);
        const displayed = await fetchSnapshot(selectedTicker, abortController.signal);
        if (!isCurrent()) return;
        setHistoryItems(history);
        setSnapshot(displayed);
        setDisplayedSnapshotId(matchingHistorySnapshotId(history, displayed));
        if (comparisonSelection.kind !== 'none') {
          setComparisonIssue({
            message: comparisonSelection.kind === 'invalid'
              ? '比較URLには有効な基準Snapshotと対象Snapshotの両方が必要です。'
              : '指定したSnapshotの組み合わせは比較できません。',
            retryable: false,
          });
        }
      })().catch((cause: unknown) => {
        if (isCurrent()) {
          const message = cause instanceof Error ? cause.message : 'Snapshotを読み込めませんでした。';
          if (comparisonSelection.kind === 'valid') {
            setComparison(null);
            setComparisonIssue({
              message,
              retryable: isRetryablePairLoadFailure(cause),
            });
            setTargetSnapshotIssue({
              snapshotId: comparisonSelection.pair.targetSnapshotId,
              message,
            });
          } else if (scopedDetailLoad) {
            setComparisonIssue({ message, retryable: false });
          } else {
            setError(message);
          }
        }
      }).finally(() => {
        if (isCurrent()) {
          setComparisonLoading(false);
          setLoading(false);
        }
      });
    } else {
      setSnapshot(null);
      setDisplayedSnapshotId(null);
      setHistoryItems([]);
      void fetch('/api/analyses', {
        headers: { Accept: 'application/json' },
        signal: abortController.signal,
      }).then(async response => {
        if (!response.ok) throw new Error('Analysis一覧を読み込めませんでした。');
        return await response.json() as AnalysisSnapshotLatestItem[];
      }).then(latest => {
        if (!isCurrent()) return;
        const referenceDate = new Date();
        setWatchlistItems(latest.map(item => mapLatestAnalysisToWatchlistItem(item, referenceDate)));
      }).catch((cause: unknown) => {
        if (isCurrent()) {
          setError(cause instanceof Error ? cause.message : 'Analysis一覧を読み込めませんでした。');
        }
      }).finally(() => {
        if (isCurrent()) {
          setComparisonLoading(false);
          setLoading(false);
        }
      });
    }
    return () => abortController.abort();
  }, [loadRevision, selectedTicker, selectionKey, pageRoute.kind]);

  const commitComparisonPair = (pair: ComparisonPair) => {
    if (!selectedTicker) return;
    rememberNavigationFocusDestination(selectedTicker);
    cancelSnapshotReload();
    const path = buildComparisonPath(
      selectedTicker,
      pair,
      window.location.search,
    );
    window.history.pushState({}, '', path);
    setComparison(null);
    setComparisonPair(pair);
    setComparisonIssue(null);
    setTargetSnapshotIssue(null);
    setComparisonSelection({ kind: 'valid', pair });
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
    setComparisonNotice(null);
    setComparisonLoading(true);
    setNavigationRevision(current => current + 1);
  };

  const navigateToTicker = (ticker: string) => {
    rememberNavigationFocusDestination(ticker, true);
    mainRequestTokenRef.current += 1;
    cancelSnapshotReload();
    window.history.pushState(
      {},
      '',
      buildDetailPath(ticker, DEFAULT_DASHBOARD_TAB, window.location.search),
    );
    setLoading(true);
    setError(null);
    setComparisonLoading(false);
    setTargetSnapshotIssue(null);
    setPageRoute({ kind: 'detail', ticker });
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
    setComparisonSelection({ kind: 'none' });
  };
  const navigateToWatchlist = () => {
    const path = buildWatchlistPath(window.location.search);
    if (pageRoute.kind === 'watchlist' && `${window.location.pathname}${window.location.search}` === path) return;
    rememberNavigationFocusDestination(null, true);
    mainRequestTokenRef.current += 1;
    cancelSnapshotReload();
    window.history.pushState({}, '', path);
    setLoading(true);
    setError(null);
    setComparisonLoading(false);
    setTargetSnapshotIssue(null);
    setPageRoute({ kind: 'watchlist' });
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
    setComparisonSelection({ kind: 'none' });
    setLoadRevision(current => current + 1);
  };
  const navigateToMarketOverview = () => {
    const path = buildMarketOverviewPath(window.location.search);
    if (pageRoute.kind === 'market-overview' && `${window.location.pathname}${window.location.search}` === path) return;
    rememberNavigationFocusDestination(null, true);
    mainRequestTokenRef.current += 1;
    cancelSnapshotReload();
    window.history.pushState({}, '', path);
    setPageRoute({ kind: 'market-overview' });
    setComparisonSelection({ kind: 'none' });
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
    setError(null);
    setLoading(false);
    setNavigationRevision(current => current + 1);
  };
  const navigateToTab = (tab: DashboardTabId) => {
    if (!selectedTicker) return;
    window.history.replaceState(
      window.history.state ?? {},
      '',
      buildDashboardTabPath(selectedTicker, tab, window.location.search),
    );
    setSelectedTab(tab);
  };
  const startComparison = () => {
    if (!displayedSnapshotId) {
      setComparisonNotice(COMPARISON_PAIR_REQUIREMENT);
      return;
    }
    const pair = resolveComparisonPair(historyItems, displayedSnapshotId);
    if (!pair) {
      setComparisonNotice(COMPARISON_PAIR_REQUIREMENT);
      return;
    }
    commitComparisonPair(pair);
  };
  const resetComparison = () => {
    if (!selectedTicker) return;
    cancelSnapshotReload();
    const path = buildComparisonResetPath(
      selectedTicker,
      window.location.search,
    );
    window.history.pushState({}, '', path);
    setComparison(null);
    setComparisonPair(null);
    setComparisonIssue(null);
    setTargetSnapshotIssue(null);
    setComparisonSelection({ kind: 'none' });
    setSelectedTab(DEFAULT_DASHBOARD_TAB);
    setComparisonLoading(true);
    if (!snapshot || targetSnapshotIssue) setLoading(true);
    setNavigationRevision(current => current + 1);
  };
  const changeComparisonBase = (baseSnapshotId: string) => {
    if (!comparisonPair) return;
    const pair = { ...comparisonPair, baseSnapshotId };
    if (!isValidComparisonPair(historyItems, pair)) {
      setComparisonNotice('基準Snapshotは対象Snapshotより前である必要があります。');
      return;
    }
    commitComparisonPair(pair);
  };
  const changeComparisonTarget = (targetSnapshotId: string) => {
    const pair = resolveComparisonPair(historyItems, targetSnapshotId);
    if (!pair) {
      setComparisonNotice(COMPARISON_PAIR_REQUIREMENT);
      return;
    }
    commitComparisonPair(pair);
  };
  const retryComparison = () => {
    if (comparisonSelection.kind !== 'valid') return;
    cancelSnapshotReload();
    setComparison(null);
    setComparisonIssue(null);
    setComparisonLoading(true);
    setLoadRevision(current => current + 1);
  };

  const reloadSnapshot = () => {
    if (!selectedTicker || !snapshot) return;
    const requestedTicker = selectedTicker;
    const requestedSelectionKey = comparisonSelectionKey(comparisonSelection);
    const displayedIdentity = `${snapshot.canonicalTicker}:${snapshot.generatedAt}`;
    reloadAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    const requestToken = reloadRequestTokenRef.current + 1;
    reloadRequestTokenRef.current = requestToken;
    reloadAbortControllerRef.current = abortController;
    setReloadState({ status: 'loading' });

    void Promise.all([
      fetchSnapshot(requestedTicker, abortController.signal),
      fetchSnapshotHistory(requestedTicker, abortController.signal),
    ]).then(([nextSnapshot, nextHistory]) => {
      if (
        abortController.signal.aborted
        || reloadRequestTokenRef.current !== requestToken
        || selectedTickerRef.current !== requestedTicker
        || comparisonSelectionKey(comparisonSelectionRef.current) !== requestedSelectionKey
      ) return;
      setHistoryItems(nextHistory);
      const nextSnapshotId = matchingHistorySnapshotId(nextHistory, nextSnapshot);
      if (comparisonSelection.kind === 'valid' && comparisonPair) {
        if (nextSnapshotId === comparisonPair.targetSnapshotId) {
          setReloadState({ status: 'unchanged', pinned: true });
        } else if (nextSnapshotId && resolveComparisonPair(nextHistory, nextSnapshotId)) {
          setReloadState({ status: 'newer', snapshotId: nextSnapshotId });
        } else {
          setReloadState({ status: 'error', detail: COMPARISON_PAIR_REQUIREMENT });
        }
        return;
      }
      const nextIdentity = `${nextSnapshot.canonicalTicker}:${nextSnapshot.generatedAt}`;
      if (nextIdentity === displayedIdentity) {
        setReloadState({ status: 'unchanged' });
        return;
      }
      setSnapshot(nextSnapshot);
      setDisplayedSnapshotId(nextSnapshotId);
      setReloadState({ status: 'updated' });
    }).catch((cause: unknown) => {
      if (
        abortController.signal.aborted
        || reloadRequestTokenRef.current !== requestToken
        || selectedTickerRef.current !== requestedTicker
        || comparisonSelectionKey(comparisonSelectionRef.current) !== requestedSelectionKey
      ) return;
      setReloadState({
        status: 'error',
        detail: cause instanceof Error ? cause.message : 'Snapshotを読み込めませんでした。',
      });
    }).finally(() => {
      if (reloadRequestTokenRef.current === requestToken) {
        reloadAbortControllerRef.current = null;
      }
    });
  };

  const adoptNewerSnapshot = () => {
    if (reloadState.status !== 'newer') return;
    const pair = resolveComparisonPair(historyItems, reloadState.snapshotId);
    if (!pair) {
      setComparisonNotice(COMPARISON_PAIR_REQUIREMENT);
      return;
    }
    commitComparisonPair(pair);
  };

  const pageNavigation = {
    currentSearch: window.location.search,
    onShowWatchlist: navigateToWatchlist,
    onShowMarketOverview: navigateToMarketOverview,
  };
  if (pageRoute.kind === 'invalid') return <DashboardRouteError {...pageNavigation} reason={pageRoute.reason} />;
  if (pageRoute.kind === 'market-overview') return <MarketOverviewPlaceholder {...pageNavigation} />;
  if (pageRoute.kind === 'watchlist') {
    return (
      <Watchlist
        {...pageNavigation}
        items={watchlistItems}
        sortKey={sortKey}
        loading={loading}
        error={error}
        onSort={setSortKey}
        onSelect={navigateToTicker}
        onRetry={() => {
          queueNavigationFocus('main-heading');
          setLoading(true);
          setError(null);
          setLoadRevision(current => current + 1);
        }}
      />
    );
  }
  if (error || loading || (selectedTicker && targetSnapshotIssue && !snapshot)) {
    const title = targetSnapshotIssue && !loading
      ? '対象Snapshotを表示できません' : '銘柄詳細';
    return (
      <DashboardDesign>
        <DashboardHeader {...pageNavigation} />
        <main className="design-content design-stack">
          <h1 data-main-heading tabIndex={-1}>{title}</h1>
          <Card title="保存済みSnapshot">
            {loading ? <StatusNotice title="読み込み中" tone="neutral" role="status">
              <p><span className="design-data">{selectedTicker}</span> Snapshotを読み込み中…</p>
            </StatusNotice> : <StatusNotice title="表示できません" tone="error" role="alert">
              {targetSnapshotIssue ? <p>対象Snapshot <span className="design-data">{targetSnapshotIssue.snapshotId}</span></p> : null}
              <p>{error ?? targetSnapshotIssue?.message}</p>
              <p>{UNAVAILABLE_TEXT}は0を意味しません。</p>
            </StatusNotice>}
            <div className="design-actions detail-state-actions">
              {targetSnapshotIssue && !loading ? <>
                {comparisonIssue?.retryable ? <Button onClick={retryComparison}>比較を再試行</Button> : null}
                <Button onClick={resetComparison}>比較を解除して最新へ戻る</Button>
              </> : null}
              <Button onClick={navigateToWatchlist}>← 保存済み分析</Button>
            </div>
          </Card>
        </main>
      </DashboardDesign>
    );
  }
  if (selectedTicker && snapshot) {
    return (
      <Dashboard
        pageNavigation={pageNavigation}
        key={snapshot.canonicalTicker}
        comparison={comparison}
        comparisonIssue={comparisonIssue}
        comparisonLoading={comparisonLoading}
        comparisonNotice={comparisonNotice}
        comparisonPair={comparisonPair}
        comparisonSelectionPresent={comparisonSelection.kind !== 'none'}
        displayedSnapshotId={displayedSnapshotId}
        history={historyItems}
        navigationRevision={navigationRevision}
        snapshot={snapshot}
        onAdoptNewerSnapshot={adoptNewerSnapshot}
        onBack={navigateToWatchlist}
        onChangeComparisonBase={changeComparisonBase}
        onChangeComparisonTarget={changeComparisonTarget}
        onReload={reloadSnapshot}
        onResetComparison={resetComparison}
        onRetryComparison={retryComparison}
        reloadState={reloadState}
        targetSnapshotIssue={targetSnapshotIssue}
        targetSnapshotPending={comparisonLoading
          && comparisonPair !== null
          && displayedSnapshotId !== comparisonPair.targetSnapshotId}
        onSelectTab={navigateToTab}
        onStartComparison={startComparison}
        onTargetRejected={() => setComparisonNotice(COMPARISON_PAIR_REQUIREMENT)}
        selectedTab={selectedTab}
      />
    );
  }
  return null;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Dashboard root element was not found.');
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
