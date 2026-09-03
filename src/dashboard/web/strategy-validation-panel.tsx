import { Button, Value } from './primitives.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import type { StrategyAmbiguityBoundV1 } from '../../analysis/strategy-validation/outcome-validator.js';
import {
  STRATEGY_VALIDATION_MANIFEST_MAX_BYTES,
  buildStrategyValidationSelectionPath,
  isStrategyValidationJobTerminal,
  parseStrategyValidationCampaignBytes,
  parseStrategyValidationPageSelection,
  strategyValidationCaseLabel,
  strategyValidationRunLabel,
  strategyValidationSelectionKey,
  type DashboardSessionV1,
  type StrategyValidationActiveJobV1,
  type StrategyValidationApiFailureV1,
  type StrategyValidationCampaignManifestV1,
  type StrategyValidationCaseV1,
  type StrategyValidationJobAcceptedV1,
  type StrategyValidationJobViewV1,
  type StrategyValidationListResponseV1,
  type StrategyValidationPageSelection,
  type StrategyValidationPreflightInputV1,
  type StrategyValidationPreflightViewV1,
  type StrategyValidationRunSummaryV1,
  type StrategyValidationRunV1,
  type StrategyValidationSnapshotOptionV1,
} from './strategy-validation.js';

type ValidationMode = 'snapshot' | 'campaign';

class StrategyValidationDashboardError extends Error {}

// Page-lifetime latch: tab/ticker remounts must not resume failed job reads.
// Only an explicit full page reload creates a fresh module instance.
let pageJobReadFailure: string | null = null;

async function responseJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StrategyValidationDashboardError('戦略検証APIの応答を読み込めませんでした。');
  }
  if (!response.ok) {
    const failure = payload as Partial<StrategyValidationApiFailureV1>;
    const message = failure.error?.message;
    throw new StrategyValidationDashboardError(
      typeof message === 'string' && message.length > 0
        ? message
        : '戦略検証APIの要求に失敗しました。',
    );
  }
  return payload as T;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return responseJson<T>(await fetch(path, {
    headers: { Accept: 'application/json' },
    signal,
  }));
}

async function mutateJson<T>(
  path: string,
  session: DashboardSessionV1,
  method: 'POST' | 'DELETE',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return responseJson<T>(await fetch(path, {
    method,
    headers: {
      Accept: 'application/json',
      [session.csrfHeader]: session.csrfToken,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal,
  }));
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '利用不可';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '利用不可';
  return String(value);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds === 0) return '0秒';
  const seconds = Math.ceil(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}分${remainder ? `${remainder}秒` : ''}` : `${seconds}秒`;
}

function rateText(value: StrategyValidationRunV1['aggregation']['track']['anchorCoverage']): string {
  if (value.state === 'unavailable') {
    return `利用不可 (${value.reason}; ${value.numerator}/${value.denominator}; ${value.denominatorMetric})`;
  }
  return `${(value.value * 100).toFixed(2)}% (${value.numerator}/${value.denominator}; ${value.denominatorMetric})`;
}

function summaryText(value: StrategyValidationRunV1['aggregation']['candidateStrata'][number]['exactRealizedR']): string {
  return value.state === 'available'
    ? `件数 ${value.count} / 平均 ${value.mean}R / 中央値 ${value.median}R`
    : `利用不可 (${value.reason}; 件数 ${value.count})`;
}

function limitQueueOrderRole(orderSide: 'buy' | 'sell'): 'エントリー側' | 'ストップ側' {
  return orderSide === 'buy' ? 'エントリー側' : 'ストップ側';
}

// The caller owns the content role, never a formatted label or numeric-looking string.
function Data({ value }: { value: string | number | null | undefined }) {
  return <Value kind="data" value={{ text: text(value), available: value !== null && value !== undefined }} />;
}

function KeyValueTable({ rows, label }: {
  rows: readonly Readonly<[string, ReactNode, ('number' | 'data')?]>[];
  label: string;
}) {
  return (
    <div className="validation-table-scroll table-scroll" aria-label={label} role="region" tabIndex={0}>
      <table className="validation-table key-value-table" aria-label={label}>
        <tbody>
          {rows.map(([name, value, kind]) => (
            <tr key={name}><th scope="row">{name}</th><td className={kind === 'number' ? 'numeric-cell' : undefined}>{kind && (typeof value === 'number' || typeof value === 'string' || value == null) ? <Data value={value} /> : value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FillTable({ fill, label }: {
  fill: Readonly<{
    date: string;
    evaluationSession: number;
    holdingDay: number;
    order: string;
    method: string;
    price: number;
  }>;
  label: string;
}) {
  return <KeyValueTable label={label} rows={[
    ['日付', fill.date, 'data'],
    ['評価session', fill.evaluationSession, 'number'],
    ['保有日', fill.holdingDay, 'number'],
    ['注文', fill.order],
    ['方法', fill.method],
    ['価格', fill.price, 'number'],
  ]} />;
}

function AmbiguityBound({
  bound,
  title,
}: {
  bound: StrategyAmbiguityBoundV1;
  title: string;
}) {
  if (bound.kind === 'horizon_expired') {
    return (
      <section className="validation-bound">
        <h5>{title}: horizon_expired</h5>
        <p>{bound.mark.state === 'available'
          ? `${bound.mark.date} / ${bound.mark.price} / ${bound.mark.markR}R`
          : `${bound.mark.date} / 利用不可`}</p>
      </section>
    );
  }
  if (bound.kind === 'unavailable') {
    return (
      <section className="validation-bound">
        <h5>{title}</h5><p>利用不可 ({bound.reason})</p>
      </section>
    );
  }
  return (
    <section className="validation-bound">
      <h5>{title}: {bound.kind}</h5>
      <p>実現R <Data value={bound.realizedR} /></p>
      <FillTable fill={bound.exitFill} label={`${title}のexit fill`} />
    </section>
  );
}

function OutcomeView({ value }: {
  value: Extract<StrategyValidationCaseV1, { caseKind: 'candidate' }>['outcome'];
}) {
  return (
    <section className={`validation-outcome ${value.kind}`} aria-labelledby="validation-outcome-title">
      <h4 id="validation-outcome-title">観測結果: {value.kind}</h4>
      <KeyValueTable label="観測結果の共通情報" rows={[
        ['Entry成立', text(value.entryProven)],
        ['計画リスク', value.plannedRisk, 'number'],
        ['実リスク', value.actualRisk, 'number'],
        ['評価終了日', <Data value={value.evaluationEndDate} />],
        ['Outcome algorithm', value.algorithmVersion],
        ['Limit queue', value.limitQueueVersion],
      ]} />
      {value.entryFill ? <FillTable fill={value.entryFill} label="Entry fill" /> : null}
      {value.kind === 'stop_hit' || value.kind === 'target_hit' ? (
        <>
          <p className="validation-exact-value">実現R <Data value={value.realizedR} /></p>
          <FillTable fill={value.exitFill} label="Exit fill" />
        </>
      ) : null}
      {value.kind === 'horizon_expired' ? (
        <p className="validation-exact-value">
          Horizon mark: {value.mark.state === 'available'
            ? `${value.mark.date} / ${value.mark.price} / ${value.mark.markR}R`
            : `${value.mark.date} / 利用不可`}
        </p>
      ) : null}
      {value.kind === 'ambiguous_intraday' ? (
        <div className="validation-ambiguity">
          <p>同日内順序が確定できません。曖昧日: <Data value={value.ambiguityDate} /></p>
          <AmbiguityBound title="悲観境界" bound={value.pessimistic} />
          <AmbiguityBound title="楽観境界" bound={value.optimistic} />
        </div>
      ) : null}
      {value.kind === 'unavailable' ? (
        <>
          <p className="validation-unavailable">利用不可 ({value.reason})</p>
          {value.reason === 'limit_queue_ambiguous' && value.limitQueueEvidence ? (
            <KeyValueTable label="Limit queue evidence" rows={[
              ['日付', value.limitQueueEvidence.date, 'data'],
              ['注文役割', limitQueueOrderRole(value.limitQueueEvidence.orderSide)],
              ['fill kind', value.limitQueueEvidence.fillKind],
              ['選択価格', value.limitQueueEvidence.selectedFillPrice, 'number'],
              ['境界', `${value.limitQueueEvidence.boundaryKind} / ${value.limitQueueEvidence.boundaryPrice}`],
              ['source flag', value.limitQueueEvidence.sourceFlag],
            ]} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RunView({ run, ticker }: { run: StrategyValidationRunV1; ticker: string }) {
  const campaign = run.aggregationScope.kind === 'campaign_global';
  const heading = campaign
    ? `キャンペーン全体（${run.aggregationScope.tickerCount}銘柄・${run.aggregationScope.requestedAnchorCount}基準日）`
    : `保存済みSnapshot監査（${ticker}）`;
  return (
    <section className="validation-result" aria-labelledby="validation-run-heading">
      <h3 id="validation-run-heading" tabIndex={-1}>{heading}</h3>
      {campaign ? (
        <p className="validation-campaign-warning">
          集計値はキャンペーン全体です。表示中の銘柄は{ticker}ですが、ケース一覧だけがこの銘柄に絞り込まれています。
        </p>
      ) : null}
      <KeyValueTable label="Run metadata" rows={[
        ['Run ID', run.runId, 'data'],
        ['Mode', run.mode],
        ['Confidence', run.confidence],
        ['Campaign', text(run.campaignName)],
        ['開始', run.startedAt, 'data'],
        ['受付', run.acceptedAt, 'data'],
        ['完了', run.completedAt, 'data'],
        ['Outcome基準session', <Data value={run.outcomeAsOfSession} />],
        ['候補生成policy', text(run.candidateGenerationPolicy)],
        ['終了状態', run.terminationState],
        ['試行回数', run.execution.attemptCount, 'number'],
        ['Cache hit', run.execution.cacheHitCount, 'number'],
        ['Duration', formatDuration(run.execution.durationMs)],
      ]} />
      <h4>Track coverage</h4>
      <KeyValueTable label="Track coverage" rows={[
        ['Requested anchors', run.aggregation.track.requestedAnchorCount, 'number'],
        ['Anchor unavailable', run.aggregation.track.anchorUnavailableCount, 'number'],
        ['Candidate-bearing anchors', run.aggregation.track.candidateBearingAnchorCount, 'number'],
        ['Entered anchors', run.aggregation.track.enteredAnchorCount, 'number'],
        ['Anchor coverage', rateText(run.aggregation.track.anchorCoverage)],
        ['Eligible-anchor entry rate', rateText(run.aggregation.track.eligibleAnchorEntryRate)],
        ['Requested-anchor entry rate', rateText(run.aggregation.track.requestedAnchorEntryRate)],
      ]} />
      <div className="validation-table-scroll table-scroll" aria-label="Candidate strata（保存済み集計）" role="region" tabIndex={0}>
        <table className="validation-table validation-strata-table">
          <caption>Candidate strata（保存済み集計）</caption>
          <thead><tr>
            <th>Confidence</th><th>Target</th><th>Stop</th><th>Resistance</th>
            <th>Anchor entry</th><th>Candidate entry</th><th>Outcomes</th>
            <th>Exact R</th><th>Horizon R</th><th>曖昧R境界</th>
          </tr></thead>
          <tbody>{run.aggregation.candidateStrata.map((stratum, index) => (
            <tr key={`${stratum.confidence}-${stratum.targetReason}-${stratum.stopReason}-${stratum.resistanceEvidenceTier}-${index}`}>
              <td>{stratum.confidence}</td><td>{stratum.targetReason}</td><td>{stratum.stopReason}</td>
              <td>{stratum.resistanceEvidenceTier}</td>
              <td>{rateText(stratum.stratumAnchorEntryRate)}</td>
              <td>{rateText(stratum.candidateEntryRate)}</td>
              <td>
                not_triggered {stratum.outcomes.notTriggered.count} / stop {stratum.outcomes.stopHit.count}
                {' / '}target {stratum.outcomes.targetHit.count} / horizon {stratum.outcomes.horizonExpired.count}
                {' / '}ambiguous {stratum.outcomes.ambiguousIntraday.count} / unavailable {stratum.outcomes.unavailable.count}
              </td>
              <td>{summaryText(stratum.exactRealizedR)}</td>
              <td>{summaryText(stratum.horizonMarkR)}</td>
              <td>悲観 {summaryText(stratum.pessimisticAmbiguousR)} / 楽観 {summaryText(stratum.optimisticAmbiguousR)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h4>Version</h4>
      <KeyValueTable label="Run versions" rows={Object.entries(run.versions).map(
        ([name, value]) => [name, value] as const,
      )} />
      {run.warnings.length ? (
        <div className="validation-warnings"><h4>Warnings</h4><ul>{run.warnings.map(
          (warning, index) => <li key={`${warning}-${index}`}>{warning}</li>,
        )}</ul></div>
      ) : null}
    </section>
  );
}

function CaseView({ value }: { value: StrategyValidationCaseV1 }) {
  return (
    <section className="validation-case-detail" aria-labelledby="validation-case-heading">
      <h3 id="validation-case-heading" tabIndex={-1}>ケース詳細</h3>
      <KeyValueTable label="Case metadata" rows={[
        ['Case ID', value.caseId, 'data'],
        ['Run ID', value.runId, 'data'],
        ['Ticker', value.ticker, 'data'],
        ['Case kind', value.caseKind],
        ['Confidence', value.confidence],
        ['Anchor date', value.anchorDate, 'data'],
        ['Decision date', value.decisionDate, 'data'],
        ['Strategy data date', <Data value={value.strategyDataDate} />],
        ['Outcome基準session', <Data value={value.outcomeAsOfSession} />],
        ['候補生成policy', text(value.candidateGenerationPolicy)],
      ]} />
      {value.caseKind === 'anchor_unavailable' ? (
        <p className="validation-unavailable">基準日利用不可 ({value.unavailableReason})</p>
      ) : (
        <>
          <KeyValueTable label="Candidate" rows={[
            ['Candidate ID', value.candidateId, 'data'],
            ['Identity version', value.candidateIdentityVersion],
            ['Duplicate ordinal', value.duplicateOrdinal, 'number'],
            ['Entry', <><Data value={value.candidate.entry.price} /> / {value.candidate.entry.reason}</>],
            ['Stop', <><Data value={value.candidate.stop.price} /> / {value.candidate.stop.reason}</>],
            ['Target', <><Data value={value.candidate.target.price} /> / {value.candidate.target.reason}</>],
            ['Resistance tier', value.resistanceEvidenceTier],
            ['Resistance digests', value.resistanceEvidenceSnapshotDigests.length
              ? <Data value={value.resistanceEvidenceSnapshotDigests.join(' / ')} />
              : 'なし'],
          ]} />
          <h4>Tick evidence</h4>
          <KeyValueTable label="Tick evidence" rows={[
            ['Effective date', value.tickEvidence.effectiveDate, 'data'],
            ['Category', text(value.tickEvidence.category)],
            ['利用不可理由', text(value.tickEvidence.unavailableReason)],
            ...Object.entries(value.tickEvidence.levels).map(([level, evidence]) => [
              level,
              `tick ${text(evidence.tick)} / executable ${text(evidence.executable)}`,
            ] as const),
          ]} />
          <OutcomeView value={value.outcome} />
        </>
      )}
      <h4>Evidence manifest</h4>
      <KeyValueTable label="Evidence manifest metadata" rows={[
        ['Schema', value.sourceManifest.schemaVersion, 'number'],
        ['Role version', value.sourceManifest.roleVersion],
        ['Started at', value.sourceManifest.startedAt, 'data'],
        ['Outcome基準session', <Data value={value.sourceManifest.outcomeAsOfSession} />],
      ]} />
      <div className="validation-table-scroll table-scroll" aria-label="Source references" role="region" tabIndex={0}>
        <table className="validation-table">
          <caption>Source references</caption>
          <thead><tr><th>Role</th><th>Digest</th></tr></thead>
          <tbody>{value.sourceManifest.sources.length ? value.sourceManifest.sources.map(source => (
            <tr key={source.digest}><td>{source.role}</td><td><Data value={source.digest} /></td></tr>
          )) : <tr><td colSpan={2}>参照sourceなし</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

function JobView({
  busy,
  lastKnown,
  job,
  onCancel,
  onOpenResults,
}: {
  busy: boolean;
  lastKnown: boolean;
  job: StrategyValidationJobViewV1;
  onCancel: () => void;
  onOpenResults: () => void;
}) {
  const cancellable = !isStrategyValidationJobTerminal(job.status) && job.status !== 'publishing';
  return (
    <section className="validation-job" aria-labelledby="validation-job-heading">
      <h3 id="validation-job-heading">{lastKnown ? '最後に確認したjob' : '実行job'}</h3>
      <div aria-atomic="true" aria-live="polite" role="status">
        {lastKnown ? '最終確認時点（現在の実行状態は未確認）: ' : ''}
        状態 {job.status} / request {job.progress.attemptCount} / case {job.progress.caseCount}
      </div>
      <KeyValueTable label="Job details" rows={[
        ['Job ID', job.jobId, 'data'],
        ['Run ID', job.runId, 'data'],
        ['受付', job.acceptedAt, 'data'],
        ['Deadline', job.executionDeadline, 'data'],
        ['Outcome基準session', <Data value={job.outcomeAsOfSession} />],
        ['Failure', job.failure ? `${job.failure.code}: ${job.failure.message}` : 'なし'],
      ]} />
      <div className="validation-actions">
        {cancellable ? <Button disabled={busy || lastKnown} type="button" onClick={onCancel}>実行をキャンセル</Button> : null}
        {job.status === 'completed' ? (
          <Button disabled={busy} type="button" onClick={onOpenResults}>結果を明示的に開く</Button>
        ) : null}
      </div>
    </section>
  );
}

export function StrategyValidationPanel({
  history,
  navigationRevision,
  ticker,
}: {
  history: readonly StrategyValidationSnapshotOptionV1[];
  navigationRevision: number;
  ticker: string;
}) {
  const [selection, setSelection] = useState<StrategyValidationPageSelection>(() => (
    parseStrategyValidationPageSelection(window.location.search)
  ));
  const [session, setSession] = useState<DashboardSessionV1 | null>(null);
  const [runs, setRuns] = useState<readonly StrategyValidationRunSummaryV1[]>([]);
  const [runsCursor, setRunsCursor] = useState<string | null>(null);
  const [run, setRun] = useState<StrategyValidationRunV1 | null>(null);
  const [cases, setCases] = useState<readonly StrategyValidationCaseV1[]>([]);
  const [casesCursor, setCasesCursor] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<StrategyValidationCaseV1 | null>(null);
  const [selectionIssue, setSelectionIssue] = useState<string | null>(null);
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [loadingMoreCases, setLoadingMoreCases] = useState(false);
  const [listIssue, setListIssue] = useState<string | null>(null);
  const [job, setJob] = useState<StrategyValidationJobViewV1 | null>(null);
  const [mode, setMode] = useState<ValidationMode>('snapshot');
  const [snapshotId, setSnapshotId] = useState('');
  const [manifest, setManifest] = useState<StrategyValidationCampaignManifestV1 | null>(null);
  const [manifestMessage, setManifestMessage] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<StrategyValidationPreflightViewV1 | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [operationIssue, setOperationIssue] = useState<string | null>(null);
  const [jobReadIssue, setJobReadIssue] = useState<string | null>(() => pageJobReadFailure);
  const [operationBusy, setOperationBusy] = useState(false);
  const [runsRevision, setRunsRevision] = useState(0);
  const selectionErrorRef = useRef<HTMLDivElement>(null);
  const explicitFocusRef = useRef<'run' | 'case' | null>(null);
  const requestTokenRef = useRef(0);
  const listTokenRef = useRef(0);
  const runsPageTokenRef = useRef(0);
  const casesPageTokenRef = useRef(0);
  const formRevisionRef = useRef(0);
  const jobGenerationRef = useRef(0);
  const jobRequestRef = useRef<AbortController | null>(null);

  const beginJobRequest = useCallback(() => {
    jobRequestRef.current?.abort();
    const controller = new AbortController();
    const generation = jobGenerationRef.current + 1;
    jobGenerationRef.current = generation;
    jobRequestRef.current = controller;
    return { controller, generation };
  }, []);

  const isCurrentJobRequest = useCallback((
    controller: AbortController,
    generation: number,
  ) => !controller.signal.aborted
    && jobRequestRef.current === controller
    && jobGenerationRef.current === generation, []);

  const finishJobRequest = useCallback((controller: AbortController) => {
    if (jobRequestRef.current === controller) jobRequestRef.current = null;
  }, []);

  const invalidateJobRequest = useCallback((controller?: AbortController) => {
    if (controller !== undefined && jobRequestRef.current !== controller) return;
    jobRequestRef.current?.abort();
    jobRequestRef.current = null;
    jobGenerationRef.current += 1;
  }, []);

  const invalidatePreflight = useCallback(() => {
    formRevisionRef.current += 1;
    setPreflight(null);
    setConfirmed(false);
    setOperationIssue(null);
  }, []);

  useEffect(() => {
    setSelection(parseStrategyValidationPageSelection(window.location.search));
  }, [navigationRevision]);

  useEffect(() => {
    if (selection.kind !== 'invalid') return;
    setSelectionIssue(selection.message);
  }, [selection]);

  useEffect(() => {
    if (selectionIssue === null) return;
    const frame = window.requestAnimationFrame(() => selectionErrorRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selectionIssue]);

  useEffect(() => {
    const controller = new AbortController();
    const token = listTokenRef.current + 1;
    listTokenRef.current = token;
    runsPageTokenRef.current += 1;
    setLoadingMoreRuns(false);
    const current = () => !controller.signal.aborted && listTokenRef.current === token;
    setListIssue(null);
    void Promise.allSettled([
      getJson<DashboardSessionV1>('/api/session', controller.signal),
      getJson<StrategyValidationListResponseV1<StrategyValidationRunSummaryV1>>(
        `/api/strategy-validation/runs?ticker=${encodeURIComponent(ticker)}&limit=20`,
        controller.signal,
      ),
    ]).then(([nextSession, runList]) => {
      if (!current()) return;
      const issues: string[] = [];
      if (nextSession.status === 'fulfilled') setSession(nextSession.value);
      else issues.push(nextSession.reason instanceof Error
        ? nextSession.reason.message : 'Sessionを読み込めませんでした。');
      if (runList.status === 'fulfilled') {
        setRuns(runList.value.items);
        setRunsCursor(runList.value.nextCursor);
      } else {
        issues.push(runList.reason instanceof Error
          ? runList.reason.message : 'Run一覧を読み込めませんでした。');
      }
      setListIssue(issues.length ? issues.join(' / ') : null);
    });
    return () => controller.abort();
  }, [runsRevision, ticker]);

  useEffect(() => {
    if (pageJobReadFailure !== null) { setJobReadIssue(pageJobReadFailure); return; }
    const { controller, generation } = beginJobRequest();
    void getJson<StrategyValidationActiveJobV1>(
      '/api/strategy-validation/jobs/active',
      controller.signal,
    ).then(active => {
      if (isCurrentJobRequest(controller, generation)) setJob(active.job);
    }).catch((cause: unknown) => {
      if (isCurrentJobRequest(controller, generation)) {
        pageJobReadFailure = cause instanceof Error ? cause.message : 'Active jobを読み込めませんでした。';
        setJobReadIssue(pageJobReadFailure);
      }
    }).finally(() => finishJobRequest(controller));
    return () => invalidateJobRequest(controller);
  }, [beginJobRequest, finishJobRequest, invalidateJobRequest, isCurrentJobRequest, ticker]);

  const selectionKey = strategyValidationSelectionKey(selection);
  useEffect(() => {
    const controller = new AbortController();
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    casesPageTokenRef.current += 1;
    setLoadingMoreCases(false);
    const current = () => !controller.signal.aborted && requestTokenRef.current === token;
    setRun(null);
    setCases([]);
    setCasesCursor(null);
    setSelectedCase(null);
    if (selection.kind !== 'valid') {
      setLoadingSelection(false);
      if (selection.kind === 'none') setSelectionIssue(null);
      return () => controller.abort();
    }
    setLoadingSelection(true);
    setSelectionIssue(null);
    const runPath = `/api/strategy-validation/runs/${selection.runId}`;
    const casesPath = `${runPath}/cases?ticker=${encodeURIComponent(ticker)}&limit=100`;
    void Promise.all([
      getJson<StrategyValidationRunV1>(runPath, controller.signal),
      getJson<StrategyValidationListResponseV1<StrategyValidationCaseV1>>(casesPath, controller.signal),
      selection.caseId === null
        ? Promise.resolve(null)
        : getJson<StrategyValidationCaseV1>(`${runPath}/cases/${selection.caseId}`, controller.signal),
    ]).then(([loadedRun, caseList, loadedCase]) => {
      if (!current()) return;
      if (!loadedRun.aggregationScope.tickers.includes(ticker)) {
        throw new StrategyValidationDashboardError('このrunは表示中の銘柄を対象にしていません。');
      }
      if (loadedCase !== null && (loadedCase.runId !== loadedRun.runId || loadedCase.ticker !== ticker)) {
        throw new StrategyValidationDashboardError('このcaseは表示中の銘柄に属していません。');
      }
      setRun(loadedRun);
      setCases(caseList.items);
      setCasesCursor(caseList.nextCursor);
      setSelectedCase(loadedCase);
      const destination = explicitFocusRef.current;
      explicitFocusRef.current = null;
      if (destination !== null) {
        window.requestAnimationFrame(() => document.getElementById(
          destination === 'run' ? 'validation-run-heading' : 'validation-case-heading',
        )?.focus());
      }
    }).catch((cause: unknown) => {
      if (!current()) return;
      setSelectionIssue(cause instanceof Error ? cause.message : '戦略検証結果を読み込めませんでした。');
      explicitFocusRef.current = null;
    }).finally(() => {
      if (current()) setLoadingSelection(false);
    });
    return () => controller.abort();
  }, [selectionKey, ticker]);

  useEffect(() => {
    if (jobReadIssue || pageJobReadFailure || operationBusy || job === null || isStrategyValidationJobTerminal(job.status)) return;
    let request: ReturnType<typeof beginJobRequest> | null = null;
    const timeout = window.setTimeout(() => {
      request = beginJobRequest();
      const { controller, generation } = request;
      void getJson<StrategyValidationJobViewV1>(
        `/api/strategy-validation/jobs/${job.jobId}`,
        controller.signal,
      ).then(next => {
        if (!isCurrentJobRequest(controller, generation)) return;
        setJob(next);
        if (next.status === 'completed') setRunsRevision(current => current + 1);
      }).catch((cause: unknown) => {
        if (isCurrentJobRequest(controller, generation)) {
          pageJobReadFailure = cause instanceof Error ? cause.message : 'Job状態を確認できませんでした。';
          setJobReadIssue(pageJobReadFailure);
        }
      }).finally(() => finishJobRequest(controller));
    }, 2_000);
    return () => {
      window.clearTimeout(timeout);
      if (request !== null) invalidateJobRequest(request.controller);
    };
  }, [
    beginJobRequest,
    finishJobRequest,
    invalidateJobRequest,
    isCurrentJobRequest,
    job,
    jobReadIssue,
    operationBusy,
  ]);

  const navigate = (next: Extract<StrategyValidationPageSelection, { kind: 'none' | 'valid' }>, focus?: 'run' | 'case') => {
    explicitFocusRef.current = focus ?? null;
    window.history.pushState(
      {},
      '',
      buildStrategyValidationSelectionPath(ticker, next, window.location.search),
    );
    setSelection(next);
  };

  const createPreflight = async () => {
    if (session === null) return;
    const input: StrategyValidationPreflightInputV1 | null = mode === 'snapshot'
      ? (snapshotId ? { mode: 'snapshot', ticker, snapshotId } : null)
      : (manifest ? { mode: 'campaign', manifest } : null);
    if (input === null) {
      setOperationIssue(mode === 'snapshot'
        ? '保存済みSnapshotを選択してください。'
        : '検証済みcampaign manifestを選択してください。');
      return;
    }
    setOperationBusy(true);
    setOperationIssue(null);
    const formRevision = formRevisionRef.current;
    try {
      const result = await mutateJson<StrategyValidationPreflightViewV1>(
        '/api/strategy-validation/preflights', session, 'POST', input,
      );
      if (formRevisionRef.current === formRevision) {
        setPreflight(result);
        setConfirmed(false);
      }
    } catch (cause) {
      if (formRevisionRef.current === formRevision) {
        setOperationIssue(cause instanceof Error ? cause.message : 'Preflightに失敗しました。');
      }
    } finally {
      setOperationBusy(false);
    }
  };

  const startJob = async () => {
    if (session === null || preflight === null || !confirmed) return;
    const { controller, generation } = beginJobRequest();
    setOperationBusy(true);
    setOperationIssue(null);
    try {
      const accepted = await mutateJson<StrategyValidationJobAcceptedV1>(
        '/api/strategy-validation/jobs',
        session,
        'POST',
        { preflightId: preflight.preflightId, confirmExternalFetch: true },
        controller.signal,
      );
      if (!isCurrentJobRequest(controller, generation)) return;
      setJob(accepted.job);
      setPreflight(null);
      setConfirmed(false);
    } catch (cause) {
      if (isCurrentJobRequest(controller, generation)) {
        setOperationIssue(cause instanceof Error ? cause.message : 'Jobを開始できませんでした。');
      }
    } finally {
      if (isCurrentJobRequest(controller, generation)) setOperationBusy(false);
      finishJobRequest(controller);
    }
  };

  const cancelJob = async () => {
    if (session === null || job === null || operationBusy) return;
    const selectedJobId = job.jobId;
    const { controller, generation } = beginJobRequest();
    setOperationBusy(true);
    setOperationIssue(null);
    try {
      const cancelled = await mutateJson<StrategyValidationJobViewV1>(
        `/api/strategy-validation/jobs/${selectedJobId}`,
        session,
        'DELETE',
        undefined,
        controller.signal,
      );
      if (isCurrentJobRequest(controller, generation)) setJob(cancelled);
    } catch (cause) {
      if (isCurrentJobRequest(controller, generation)) {
        setOperationIssue(cause instanceof Error ? cause.message : 'Jobをキャンセルできませんでした。');
      }
    } finally {
      if (isCurrentJobRequest(controller, generation)) setOperationBusy(false);
      finishJobRequest(controller);
    }
  };

  const readManifest = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setManifest(null);
    setManifestMessage(null);
    invalidatePreflight();
    const formRevision = formRevisionRef.current;
    if (!file) return;
    if (file.size > STRATEGY_VALIDATION_MANIFEST_MAX_BYTES) {
      setManifestMessage('Manifestは1,048,576 bytes以下である必要があります。');
      return;
    }
    try {
      const parsed = parseStrategyValidationCampaignBytes(new Uint8Array(await file.arrayBuffer()));
      if (formRevisionRef.current !== formRevision) return;
      setManifest(parsed);
      setManifestMessage(`${parsed.name} / ${parsed.anchors.length}基準日を検証しました。`);
    } catch (cause) {
      if (formRevisionRef.current !== formRevision) return;
      setManifestMessage(cause instanceof Error ? cause.message : 'Manifestを検証できませんでした。');
    }
  };

  const loadMoreRuns = async () => {
    if (runsCursor === null || loadingMoreRuns) return;
    const cursor = runsCursor;
    const listToken = listTokenRef.current;
    const pageToken = runsPageTokenRef.current + 1;
    runsPageTokenRef.current = pageToken;
    setLoadingMoreRuns(true);
    try {
      const next = await getJson<StrategyValidationListResponseV1<StrategyValidationRunSummaryV1>>(
        `/api/strategy-validation/runs?ticker=${encodeURIComponent(ticker)}&limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      if (listTokenRef.current !== listToken || runsPageTokenRef.current !== pageToken) return;
      setRuns(current => [...current, ...next.items]);
      setRunsCursor(next.nextCursor);
    } catch (cause) {
      if (listTokenRef.current !== listToken || runsPageTokenRef.current !== pageToken) return;
      setListIssue(cause instanceof Error ? cause.message : 'Run一覧の続きを読み込めませんでした。');
    } finally {
      if (runsPageTokenRef.current === pageToken) setLoadingMoreRuns(false);
    }
  };

  const loadMoreCases = async () => {
    if (selection.kind !== 'valid' || casesCursor === null || loadingMoreCases) return;
    const cursor = casesCursor;
    const requestToken = requestTokenRef.current;
    const pageToken = casesPageTokenRef.current + 1;
    casesPageTokenRef.current = pageToken;
    try {
      setLoadingMoreCases(true);
      const next = await getJson<StrategyValidationListResponseV1<StrategyValidationCaseV1>>(
        `/api/strategy-validation/runs/${selection.runId}/cases?ticker=${encodeURIComponent(ticker)}&limit=100&cursor=${encodeURIComponent(cursor)}`,
      );
      if (requestTokenRef.current !== requestToken || casesPageTokenRef.current !== pageToken) return;
      setCases(current => [...current, ...next.items]);
      setCasesCursor(next.nextCursor);
    } catch (cause) {
      if (requestTokenRef.current !== requestToken || casesPageTokenRef.current !== pageToken) return;
      setSelectionIssue(cause instanceof Error ? cause.message : 'Case一覧の続きを読み込めませんでした。');
    } finally {
      if (casesPageTokenRef.current === pageToken) setLoadingMoreCases(false);
    }
  };

  const snapshotOptions = useMemo(() => [...history].sort((left, right) => (
    Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
  )), [history]);

  return (
    <div className="validation-panel">
      <section className="panel validation-operation" aria-labelledby="validation-operation-heading">
        <header className="panel-header">
          <div><span className="eyebrow">POINT-IN-TIME / EXPLICIT EXTERNAL FETCH</span><h2 id="validation-operation-heading">戦略検証を実行</h2></div>
        </header>
        <p>自動実行はしません。Preflightはローカル検証のみで、外部送信前に内容を確認します。</p>
        <fieldset className="validation-mode">
          <legend>入力方式</legend>
          {(['snapshot', 'campaign'] as const).map(value => (
            <label key={value}>
              <input
                checked={mode === value}
                name="validation-mode"
                onChange={() => { setMode(value); invalidatePreflight(); }}
                type="radio"
              />
              {value === 'snapshot' ? '保存済みSnapshot' : 'Campaign JSON'}
            </label>
          ))}
        </fieldset>
        {mode === 'snapshot' ? (
          <label className="validation-field design-field">
            保存済みSnapshot
            <select value={snapshotId} onChange={event => {
              setSnapshotId(event.currentTarget.value);
              invalidatePreflight();
            }}>
              <option value="">選択してください</option>
              {snapshotOptions.map(item => (
                <option key={item.snapshotId} value={item.snapshotId}>
                  {item.generatedAt} / {item.status} / {item.snapshotId}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="validation-field design-field">
            Campaign JSON（最大1 MiB）
            <input aria-describedby={manifestMessage ? 'validation-manifest-message' : undefined} accept="application/json,.json" onChange={event => void readManifest(event)} type="file" />
            {manifestMessage ? <small id="validation-manifest-message">{manifestMessage}</small> : null}
          </label>
        )}
        <Button disabled={operationBusy || session === null} onClick={() => void createPreflight()} type="button">
          ローカルPreflightを実行
        </Button>
        {preflight ? (
          <section className="validation-confirmation" aria-labelledby="validation-confirmation-heading">
            <h3 id="validation-confirmation-heading">外部送信・利用枠の確認</h3>
            <p>このjobはticker/date selectorを設定済みJ-Quants accountへ送信し、subscription quotaを消費する可能性があります。</p>
            <KeyValueTable label="Preflight estimate" rows={[
              ['入力digest', preflight.inputDigest, 'data'],
              ['Ticker数', preflight.tickerCount, 'number'],
              ['基準日数', preflight.anchorCount, 'number'],
              ['最小request数', preflight.estimatedMinimumAttempts, 'number'],
              ['最小dispatch時間', formatDuration(preflight.minimumDispatchDurationMs)],
              ['Rate', `${preflight.requestsPerMinute} requests/min (${preflight.rateLimitVersion})`],
              ['Request timeout', formatDuration(preflight.requestTimeoutMs)],
              ['Execution budget', formatDuration(preflight.executionBudgetMs)],
              ['Hard maximum attempts', preflight.hardMaximumAttempts, 'number'],
              ['有効期限', preflight.expiresAt, 'data'],
            ]} />
            <p>最小値にはpagination、retry、response latency、追加で必要になる証拠取得を含みません。1回ごとの金額は推定しません。</p>
            {preflight.warnings.length ? <ul>{preflight.warnings.map(
              (warning, index) => <li key={`${warning}-${index}`}>{warning}</li>,
            )}</ul> : null}
            <label className="validation-confirm-checkbox">
              <input checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} type="checkbox" />
              上記の外部送信と利用枠消費の可能性を確認しました
            </label>
            <Button disabled={!confirmed || operationBusy} onClick={() => void startJob()} type="button">Jobを開始</Button>
          </section>
        ) : null}
        {operationIssue ? <p className="validation-error" role="alert">{operationIssue}</p> : null}
        {jobReadIssue ? <p className="validation-error" role="alert">{jobReadIssue} 状態の自動確認を停止しました。再確認するにはページを再読み込みしてください。</p> : null}
      </section>

      {job ? <JobView
        busy={operationBusy}
        lastKnown={jobReadIssue !== null && !isStrategyValidationJobTerminal(job.status)}
        job={job}
        onCancel={() => void cancelJob()}
        onOpenResults={() => navigate({ kind: 'valid', runId: job.runId, caseId: null }, 'run')}
      /> : null}

      <section className="panel validation-results" aria-labelledby="validation-results-heading">
        <header className="panel-header">
          <div><span className="eyebrow">IMMUTABLE LOCAL RESEARCH</span><h2 id="validation-results-heading">保存済み検証結果</h2></div>
        </header>
        <p>Runは自動選択しません。表示するrunを明示的に選択してください。</p>
        {listIssue ? <p className="validation-error" role="alert">{listIssue}</p> : null}
        <div className="validation-run-list">
          {runs.length ? runs.map(item => (
            <Button
              aria-pressed={selection.kind === 'valid' && selection.runId === item.runId}
              key={item.runId}
              onClick={() => navigate({ kind: 'valid', runId: item.runId, caseId: null }, 'run')}
              type="button"
            >
              {strategyValidationRunLabel(item)}
            </Button>
          )) : <p>この銘柄を含む保存済みrunはありません。</p>}
          {runsCursor ? <Button disabled={loadingMoreRuns} onClick={() => void loadMoreRuns()} type="button">Runをさらに読み込む</Button> : null}
          {selection.kind !== 'none' ? (
            <Button onClick={() => navigate({ kind: 'none' })} type="button">Run選択を解除</Button>
          ) : null}
        </div>
        {selectionIssue ? (
          <div className="validation-selection-error" ref={selectionErrorRef} role="alert" tabIndex={-1}>
            {selectionIssue}
          </div>
        ) : null}
        <p aria-atomic="true" aria-live="polite" className="validation-announcement" role="status">
          {loadingSelection ? '選択した戦略検証結果を読み込み中です。' : ''}
        </p>
        {run ? <RunView run={run} ticker={ticker} /> : null}
        {run ? (
          <section className="validation-case-list" aria-labelledby="validation-case-list-heading">
            <h3 id="validation-case-list-heading">{ticker}のケース一覧</h3>
            <div className="validation-table-scroll table-scroll" aria-label="現在銘柄のケース一覧" role="region" tabIndex={0}>
              <table className="validation-table">
                <thead><tr><th>Case ID</th><th>基準日</th><th>種別</th><th>Confidence</th><th>概要</th><th>操作</th></tr></thead>
                <tbody>{cases.map(item => (
                  <tr key={item.caseId}>
                    <td><Data value={item.caseId} /></td><td><Data value={item.anchorDate} /></td><td>{item.caseKind}</td><td>{item.confidence}</td>
                    <td>{strategyValidationCaseLabel(item)}</td>
                    <td><Button
                      aria-label={`${strategyValidationCaseLabel(item)} / ${item.caseId} を開く`}
                      onClick={() => navigate({
                        kind: 'valid', runId: run.runId, caseId: item.caseId,
                      }, 'case')}
                      type="button"
                    >ケースを開く</Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {casesCursor ? <Button disabled={loadingMoreCases} onClick={() => void loadMoreCases()} type="button">Caseをさらに読み込む</Button> : null}
          </section>
        ) : null}
        {selectedCase ? <CaseView value={selectedCase} /> : null}
      </section>
    </div>
  );
}
