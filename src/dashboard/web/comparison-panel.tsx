import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisSnapshotComparisonResponseV1,
  ComparisonObservationV1,
  ComparisonSectionV1,
  SnapshotComparisonMetricRowV1,
} from '../../analysis/comparison/index.js';
import type { AnalysisSnapshotHistoryItem } from '../../analysis/snapshot/repository.js';
import {
  COMPARISON_PAIR_REQUIREMENT,
  COMPARISON_SECTION_LABELS,
  comparisonIdentityKey,
  comparisonMetricLabel,
  comparisonRowId,
  comparisonRowMatchesFilter,
  comparisonStatusLabel,
  formatComparisonIdentity,
  formatComparisonDelta,
  formatComparisonObservation,
  orderedHistory,
  resolveComparisonPair,
  restoreComparisonHistoryState,
  type ComparisonHistoryStateV1,
  type ComparisonPair,
  type ComparisonRowFilter,
} from './comparison.js';

export type ComparisonPanelIssue = Readonly<{
  message: string;
  retryable: boolean;
}>;

interface ComparisonPanelProps {
  comparison: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }> | null;
  loading: boolean;
  displayedSnapshotId: string | null;
  history: readonly AnalysisSnapshotHistoryItem[];
  issue: ComparisonPanelIssue | null;
  notice: string | null;
  pair: ComparisonPair | null;
  selectionPresent: boolean;
  ticker: string;
  onAdoptBase: (snapshotId: string) => void;
  onAdoptTarget: (snapshotId: string) => void;
  onReset: () => void;
  onRetry: () => void;
  onStart: () => void;
  onTargetRejected: () => void;
}

const ROW_FILTER_OPTIONS: ReadonlyArray<Readonly<{ value: ComparisonRowFilter; label: string }>> = [
  { value: 'attention', label: '変化・要確認' },
  { value: 'all', label: 'すべて' },
  { value: 'changed', label: '値の変化' },
  { value: 'issues', label: '要確認' },
];

function initialHistoryState(
  ticker: string,
  comparison: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }>,
): ComparisonHistoryStateV1 {
  const identityKey = comparisonIdentityKey(ticker, comparison);
  return restoreComparisonHistoryState(window.history.state, identityKey) ?? {
    identityKey,
    rowFilter: 'attention',
    sectionFilter: 'all',
    openDisclosureIds: [],
  };
}

function persistHistoryState(next: ComparisonHistoryStateV1): void {
  const current = typeof window.history.state === 'object' && window.history.state !== null
    ? window.history.state as Record<string, unknown>
    : {};
  window.history.replaceState({ ...current, comparison: next }, '', window.location.href);
}

function observationContext(observation: ComparisonObservationV1): string[] {
  const values = [`状態: ${observation.state}`];
  if (observation.actualUnit) values.push(`単位: ${observation.actualUnit}`);
  if (observation.dataDates.length > 0) {
    values.push(`基準日: ${observation.dataDates.map(date => `${date.role}=${date.value ?? 'なし'}`).join(' / ')}`);
  }
  if (observation.unavailableReasons.length > 0) {
    values.push(`理由: ${observation.unavailableReasons.map(reason => (
      reason.detail ? `${reason.reason} (${reason.detail})` : reason.reason
    )).join(' / ')}`);
  }
  if (observation.state === 'ambiguous') values.push(`候補数: ${observation.candidateCount}`);
  return values;
}

function RowConditions({
  open,
  row,
  onOpenChange,
}: {
  open: boolean;
  row: SnapshotComparisonMetricRowV1;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <details
      className="comparison-row-conditions"
      onToggle={event => onOpenChange(event.currentTarget.open)}
      open={open}
    >
      <summary>日付・比較条件</summary>
      <dl>
        <div><dt>比較行の同一性</dt><dd>{formatComparisonIdentity(row.instanceIdentity)}</dd></div>
        <div><dt>基準の同一性</dt><dd>{formatComparisonIdentity(row.base.identity)}</dd></div>
        <div><dt>基準の状態・日付</dt><dd>{observationContext(row.base).join('。')}</dd></div>
        <div><dt>対象の同一性</dt><dd>{formatComparisonIdentity(row.target.identity)}</dd></div>
        <div><dt>対象の状態・日付</dt><dd>{observationContext(row.target).join('。')}</dd></div>
      </dl>
    </details>
  );
}

function ComparisonResults({
  comparison,
  ticker,
}: {
  comparison: Extract<AnalysisSnapshotComparisonResponseV1, { outcome: 'success' }>;
  ticker: string;
}) {
  const [historyState, setHistoryState] = useState(() => initialHistoryState(ticker, comparison));
  const openDisclosureIds = useMemo(
    () => new Set(historyState.openDisclosureIds),
    [historyState.openDisclosureIds],
  );
  const visibleRows = useMemo(() => comparison.metricRows.filter(row => (
    comparisonRowMatchesFilter(row, historyState.rowFilter, historyState.sectionFilter)
  )), [comparison.metricRows, historyState.rowFilter, historyState.sectionFilter]);

  const updateHistoryState = (update: Partial<Omit<ComparisonHistoryStateV1, 'identityKey'>>) => {
    setHistoryState(current => {
      const next = { ...current, ...update };
      persistHistoryState(next);
      return next;
    });
  };
  const setDisclosure = (rowId: string, open: boolean) => {
    const next = new Set(openDisclosureIds);
    if (open) next.add(rowId); else next.delete(rowId);
    updateHistoryState({ openDisclosureIds: [...next] });
  };

  return (
    <div className="comparison-results">
      <p className="comparison-as-of">
        比較基準日時 {comparison.comparisonAsOf}。差分は対象値 − 基準値です。相対変化や良否判定は行いません。
      </p>
      <div className="comparison-filters" aria-label="比較行フィルター">
        <label>
          表示
          <select
            value={historyState.rowFilter}
            onChange={event => updateHistoryState({ rowFilter: event.currentTarget.value as ComparisonRowFilter })}
          >
            {ROW_FILTER_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          セクション
          <select
            value={historyState.sectionFilter}
            onChange={event => updateHistoryState({
              sectionFilter: event.currentTarget.value as ComparisonSectionV1 | 'all',
            })}
          >
            <option value="all">すべて</option>
            {Object.entries(COMPARISON_SECTION_LABELS).map(([section, label]) => (
              <option key={section} value={section}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <p className="comparison-empty">選択した条件に一致する比較行はありません。</p>
      ) : Object.entries(COMPARISON_SECTION_LABELS).map(([section, label]) => {
        const rows = visibleRows.filter(row => row.section === section);
        if (rows.length === 0) return null;
        return (
          <section className="comparison-section" key={section} aria-labelledby={`comparison-${section}`}>
            <h3 id={`comparison-${section}`}>{label}</h3>
            <div
              aria-label={`${label}の保存済み分析比較表`}
              className="comparison-table-scroll"
              role="region"
              tabIndex={0}
            >
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>指標</th><th>基準値</th><th>対象値</th><th>差分</th><th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const rowId = comparisonRowId(row);
                    return (
                      <tr key={rowId} data-comparison-row={row.metricKey}>
                        <th scope="row">
                          <span>{comparisonMetricLabel(row)}</span>
                          <RowConditions
                            open={openDisclosureIds.has(rowId)}
                            row={row}
                            onOpenChange={open => setDisclosure(rowId, open)}
                          />
                        </th>
                        <td>{formatComparisonObservation(row.base, row)}</td>
                        <td>{formatComparisonObservation(row.target, row)}</td>
                        <td>{formatComparisonDelta(row)}</td>
                        <td>{comparisonStatusLabel(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ComparisonPanel({
  comparison,
  displayedSnapshotId,
  history,
  issue,
  loading,
  notice,
  pair,
  selectionPresent,
  ticker,
  onAdoptBase,
  onAdoptTarget,
  onReset,
  onRetry,
  onStart,
  onTargetRejected,
}: ComparisonPanelProps) {
  const comparisonResultsRef = useRef<HTMLDivElement | null>(null);
  const previousResultsHeightRef = useRef(0);
  const ascendingHistory = useMemo(() => orderedHistory(history), [history]);
  const targetIndex = pair
    ? ascendingHistory.findIndex(item => item.snapshotId === pair.targetSnapshotId)
    : -1;
  const initialPair = displayedSnapshotId
    ? resolveComparisonPair(history, displayedSnapshotId)
    : null;

  useLayoutEffect(() => {
    if (comparison && comparisonResultsRef.current) {
      previousResultsHeightRef.current = comparisonResultsRef.current.getBoundingClientRect().height;
    }
  }, [comparison]);

  return (
    <section
      aria-busy={loading}
      className="panel comparison-panel"
      aria-labelledby="comparison-title"
    >
      <header className="panel-header comparison-panel-header">
        <div>
          <span className="eyebrow">IMMUTABLE SNAPSHOTS</span>
          <h2 id="comparison-title">保存済み分析の比較</h2>
        </div>
        {selectionPresent ? (
          <button className="comparison-reset" onClick={onReset} type="button">比較を解除</button>
        ) : null}
      </header>

      {pair ? (
        <div className="comparison-selectors">
          <label>
            基準Snapshot
            <select value={pair.baseSnapshotId} onChange={event => onAdoptBase(event.currentTarget.value)}>
              {ascendingHistory.map((item, index) => (
                  <option
                    disabled={targetIndex < 0 || index >= targetIndex}
                    key={item.snapshotId}
                    value={item.snapshotId}
                  >
                    {item.generatedAt}
                  </option>
                ))}
            </select>
          </label>
          <label>
            対象Snapshot
            <select
              value={pair.targetSnapshotId}
              onChange={event => {
                if (resolveComparisonPair(history, event.currentTarget.value)) {
                  onAdoptTarget(event.currentTarget.value);
                } else {
                  onTargetRejected();
                }
              }}
            >
              {ascendingHistory.map((item, index) => (
                <option disabled={index === 0} key={item.snapshotId} value={item.snapshotId}>
                  {item.generatedAt}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : !selectionPresent ? (
        <div className="comparison-start">
          <p>表示中の分析と、その直前に保存された分析を比較します。</p>
          <button disabled={initialPair === null} onClick={onStart} type="button">比較を開始</button>
          {initialPair === null ? <p className="comparison-requirement">{COMPARISON_PAIR_REQUIREMENT}</p> : null}
        </div>
      ) : null}

      <p aria-atomic="true" aria-live="polite" className="comparison-announcement" role="status">
        {loading ? '比較結果を読み込み中…' : notice ?? ''}
      </p>
      {issue ? (
        <div className="comparison-error" role="alert">
          <p>{issue.message}</p>
          {issue.retryable ? <button onClick={onRetry} type="button">比較を再試行</button> : null}
        </div>
      ) : null}
      {comparison ? (
        <div ref={comparisonResultsRef}>
          <ComparisonResults
            key={comparisonIdentityKey(ticker, comparison)}
            comparison={comparison}
            ticker={ticker}
          />
        </div>
      ) : loading && previousResultsHeightRef.current > 0 ? (
        <div
          aria-hidden="true"
          className="comparison-loading-space"
          style={{ minHeight: previousResultsHeightRef.current }}
        />
      ) : null}
    </section>
  );
}
