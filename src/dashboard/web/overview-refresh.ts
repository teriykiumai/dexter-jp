import { useEffect, useRef, useState } from 'react';
import type { MarketDataJobViewV1 } from '../../analysis/market-data/job-schema.js';
import type { MarketDataActiveJobV1 } from '../../analysis/market-data/job-service.js';
import type { MarketOverviewResponseV1 } from '../../analysis/market-data/overview-registry.js';
import type { DashboardSessionV1 } from './strategy-validation.js';
import { marketJobReadState } from './market-job-read-state.js';

// A remount or visibility change must not retry an uncertain job read.
const reloadMessage = 'ジョブ状態を確認できません。再送せずページ全体を再読み込みしてください。';
const recoveryMessage = 'ジョブ記録の整合性を確認できないため、新規実行を停止しました。Dashboardを再起動してください。解消しない場合は記録を変更せず調査してください。';
export const overviewJobTerminal = (job: MarketDataJobViewV1) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status);
class OverviewError extends Error {
  constructor(readonly status: number, readonly code: string, readonly safeMessage: string, readonly retryAfter: string | null) { super(code); }
}
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok) throw new OverviewError(response.status, payload?.error?.code ?? 'invalid_response', payload?.error?.message ?? '', response.headers.get('retry-after'));
  return payload as T;
}
async function readOverview(signal: AbortSignal): Promise<MarketOverviewResponseV1> {
  const value = await json<MarketOverviewResponseV1>('/api/market-data/overview', { signal });
  if (value.schemaVersion !== 'market_overview_response_v1' || !Array.isArray(value.modules)) throw new Error('Invalid overview response');
  return value;
}

export function useOverviewRefresh(navigationRevision: number) {
  const [data, setData] = useState<MarketOverviewResponseV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(marketJobReadState.failed ? reloadMessage : null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<MarketDataJobViewV1 | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLParagraphElement>(null), button = useRef<HTMLButtonElement>(null);
  const focusAlert = useRef(false);
  const mounted = useRef(false), generation = useRef(0), readToken = useRef(0), adoption = useRef<{ generation: number; search: string } | null>(null);
  const current = (capture: { generation: number; search: string }) => mounted.current && capture.generation === generation.current && capture.search === window.location.search;
  const capture = () => ({ generation: generation.current, search: window.location.search });
  const invalidate = () => { generation.current++; adoption.current = null; };
  function block(error: unknown, focus = false) {
    focusAlert.current = focus;
    marketJobReadState.failed = true;
    setBlocked(`${reloadMessage}${error instanceof OverviewError && error.safeMessage ? ` ${error.safeMessage}` : ''}`);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; invalidate(); }; }, []);
  useEffect(() => { invalidate(); }, [navigationRevision]);
  useEffect(() => {
    if ((blocked || warning) && focusAlert.current) { focusAlert.current = false; alert.current?.focus(); }
  }, [blocked, warning]);
  useEffect(() => {
    const controller = new AbortController(), token = ++readToken.current;
    void readOverview(controller.signal).then(value => { if (!controller.signal.aborted && token === readToken.current) setData(value); })
      .catch(() => { if (!controller.signal.aborted && token === readToken.current) setWarning('保存済み市場データを読み込めませんでした。値は確認できません。'); })
      .finally(() => { if (!controller.signal.aborted && token === readToken.current) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (marketJobReadState.failed) return;
    const controller = new AbortController(), captured = capture();
    void json<MarketDataActiveJobV1>('/api/market-data/jobs/active', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.schemaVersion !== 'market_data_active_job_v1') throw new Error('Invalid active job');
      if (current(captured) && value.marketJob?.kind === 'overview_refresh' && !overviewJobTerminal(value.marketJob)) adoption.current = captured;
      setJob(value.marketJob); setReady(true);
      setBlocked(value.blockingKind ? '戦略検証ジョブが実行中です。完了後にこの画面へ戻ってください。' : null);
    }).catch(error => { if (!controller.signal.aborted) block(error); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!job || overviewJobTerminal(job) || busy || marketJobReadState.failed) return;
    let timer: number | undefined, controller: AbortController | null = null;
    const suspend = () => { clearTimeout(timer); controller?.abort(); };
    const schedule = () => {
      suspend();
      if (document.visibilityState !== 'visible' || marketJobReadState.failed) return;
      timer = window.setTimeout(() => {
        const request = new AbortController(); controller = request;
        void json<MarketDataJobViewV1>(`/api/market-data/jobs/${job.jobId}`, { signal: request.signal }).then(next => {
          if (!request.signal.aborted && document.visibilityState === 'visible') setJob(next);
        }).catch(error => { if (!request.signal.aborted) block(error); });
      }, 1000);
    };
    document.addEventListener('visibilitychange', schedule); schedule();
    return () => { document.removeEventListener('visibilitychange', schedule); suspend(); };
  }, [job, busy]);
  useEffect(() => {
    if (job?.result?.kind === 'overview' && job.result.moduleResults.some(result => result.warningCodes.includes('job_record_write_failed'))) {
      marketJobReadState.failed = true; setBlocked(recoveryMessage);
    }
  }, [job]);
  useEffect(() => {
    if (!job || !overviewJobTerminal(job) || !adoption.current || !current(adoption.current)) return;
    const captured = adoption.current; adoption.current = null;
    if (job.status === 'cancelled') { button.current?.focus(); return; }
    if (job.status !== 'completed') { setWarning('更新できませんでした。直前の表示を維持しています。'); return; }
    const controller = new AbortController(), token = ++readToken.current;
    void readOverview(controller.signal).then(value => {
      if (controller.signal.aborted || !current(captured) || token !== readToken.current) return;
      setData(value); setWarning(null); setLoading(false); heading.current?.focus();
    }).catch(() => { if (!controller.signal.aborted && current(captured)) setWarning('更新後の読み込みに失敗しました。直前の表示を維持しています。'); })
      .finally(() => { if (!controller.signal.aborted && token === readToken.current) setLoading(false); });
    return () => controller.abort();
  }, [job]);
  async function mutate(cancel = false) {
    if (!ready || busy || blocked || marketJobReadState.failed) return;
    const captured = capture(); setBusy(true); setWarning(null);
    try {
      const session = await json<DashboardSessionV1>('/api/session');
      if (!current(captured)) return;
      const headers = { [session.csrfHeader]: session.csrfToken, 'Content-Type': 'application/json' };
      if (cancel && job?.kind === 'overview_refresh') {
        const next = await json<MarketDataJobViewV1>(`/api/market-data/jobs/${job.jobId}`, { method: 'DELETE', headers });
        if (current(captured)) { adoption.current = captured; setJob(next); }
      } else if (!cancel) {
        const accepted = await json<{ jobId: string }>('/api/market-data/overview/jobs', { method: 'POST', headers, body: '{}' });
        if (!current(captured)) return;
        adoption.current = captured;
        try {
          const next = await json<MarketDataJobViewV1>(`/api/market-data/jobs/${accepted.jobId}`);
          if (current(captured)) setJob(next);
        } catch (error) { if (current(captured)) block(error, true); }
      }
    } catch (error) {
      if (!current(captured)) return;
      focusAlert.current = true;
      if (error instanceof OverviewError && error.status < 500) setWarning(error.status === 409 && error.retryAfter && /^\d+$/.test(error.retryAfter)
        ? `あと ${error.retryAfter} 秒待って手動で再試行してください。ジョブは未受付です。`
        : `操作できませんでした (${error.code})。${error.safeMessage}`);
      else block(error, true);
    } finally { if (mounted.current) setBusy(false); }
  }
  return { data, loading, warning, blocked, ready, busy, job, heading, alert, button, invalidate, mutate };
}
