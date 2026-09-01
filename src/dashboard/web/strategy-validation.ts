import type { AnalysisSnapshotHistoryItem } from '../../analysis/snapshot/repository.js';
import type { StrategyValidationCaseV1 } from '../../analysis/strategy-validation/artifacts.js';
import type { StrategyValidationJobViewV1 } from '../../analysis/strategy-validation/job-artifact.js';
import {
  parseStrategyValidationCampaignJsonV1,
  STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES,
  type StrategyValidationCampaignManifestV1,
} from '../../analysis/strategy-validation/manifest.js';
import type { StrategyValidationPreflightViewV1 } from '../../analysis/strategy-validation/job-service.js';
import type { StrategyValidationRunV1 } from '../../analysis/strategy-validation/run-artifact.js';

export const STRATEGY_VALIDATION_RUN_QUERY = 'validationRun' as const;
export const STRATEGY_VALIDATION_CASE_QUERY = 'validationCase' as const;
export const STRATEGY_VALIDATION_MANIFEST_MAX_BYTES =
  STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StrategyValidationPageSelection =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'valid'; runId: string; caseId: string | null }>
  | Readonly<{ kind: 'invalid'; message: string }>;

export interface StrategyValidationRunSummaryV1 {
  readonly schemaVersion: 'strategy_validation_run_summary_v1';
  readonly runId: string;
  readonly mode: 'snapshot' | 'campaign';
  readonly confidence: 'precommitted' | 'reconstructed_251_as_of';
  readonly campaignName: string | null;
  readonly completedAt: string;
  readonly outcomeAsOfSession: string | null;
  readonly aggregationScope: StrategyValidationRunV1['aggregationScope'];
  readonly caseCount: number;
  readonly warnings: readonly string[];
}

export interface StrategyValidationListResponseV1<T> {
  readonly schemaVersion: 'strategy_validation_list_v1';
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface DashboardSessionV1 {
  readonly schemaVersion: 'dashboard_session_v1';
  readonly csrfHeader: 'X-Dexter-CSRF';
  readonly csrfToken: string;
}

export interface StrategyValidationActiveJobV1 {
  readonly schemaVersion: 'strategy_validation_active_job_v1';
  readonly job: StrategyValidationJobViewV1 | null;
}

export interface StrategyValidationJobAcceptedV1 {
  readonly schemaVersion: 'strategy_validation_job_accepted_v1';
  readonly job: StrategyValidationJobViewV1;
  readonly statusUrl: string;
}

export interface StrategyValidationApiFailureV1 {
  readonly error: Readonly<{ code: string; message: string }>;
}

export type StrategyValidationPreflightInputV1 =
  | Readonly<{ mode: 'snapshot'; ticker: string; snapshotId: string }>
  | Readonly<{ mode: 'campaign'; manifest: StrategyValidationCampaignManifestV1 }>;

export type StrategyValidationSnapshotOptionV1 = Pick<
  AnalysisSnapshotHistoryItem,
  'snapshotId' | 'generatedAt' | 'status'
>;

export function parseStrategyValidationPageSelection(
  search: string,
): StrategyValidationPageSelection {
  const parameters = new URLSearchParams(search);
  const runs = parameters.getAll(STRATEGY_VALIDATION_RUN_QUERY);
  const cases = parameters.getAll(STRATEGY_VALIDATION_CASE_QUERY);
  if (runs.length > 1 || cases.length > 1) {
    return Object.freeze({
      kind: 'invalid',
      message: '戦略検証のrunまたはcase指定が重複しています。',
    });
  }
  const runId = runs[0] ?? null;
  const caseId = cases[0] ?? null;
  if (runId === null && caseId === null) return Object.freeze({ kind: 'none' });
  if (runId === null && caseId !== null) {
    return Object.freeze({
      kind: 'invalid',
      message: 'caseを指定するにはvalidationRunが必要です。',
    });
  }
  if (runId === null || !UUID_V4.test(runId) || (caseId !== null && !UUID_V4.test(caseId))) {
    return Object.freeze({
      kind: 'invalid',
      message: '戦略検証のrunまたはcase IDが不正です。',
    });
  }
  return Object.freeze({ kind: 'valid', runId, caseId });
}

export function strategyValidationSelectionKey(
  selection: StrategyValidationPageSelection,
): string {
  if (selection.kind === 'none') return 'none';
  if (selection.kind === 'invalid') return `invalid:${selection.message}`;
  return `valid:${selection.runId}:${selection.caseId ?? ''}`;
}

export function clearStrategyValidationQuery(parameters: URLSearchParams): void {
  parameters.delete(STRATEGY_VALIDATION_RUN_QUERY);
  parameters.delete(STRATEGY_VALIDATION_CASE_QUERY);
}

export function buildStrategyValidationSelectionPath(
  ticker: string,
  selection: Extract<StrategyValidationPageSelection, { kind: 'none' | 'valid' }>,
  currentSearch = '',
): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set('ticker', ticker);
  parameters.set('tab', 'validation');
  clearStrategyValidationQuery(parameters);
  if (selection.kind === 'valid') {
    parameters.set(STRATEGY_VALIDATION_RUN_QUERY, selection.runId);
    if (selection.caseId !== null) {
      parameters.set(STRATEGY_VALIDATION_CASE_QUERY, selection.caseId);
    }
  }
  return `/?${parameters.toString()}`;
}

export function parseStrategyValidationCampaignBytes(
  bytes: Uint8Array,
): StrategyValidationCampaignManifestV1 {
  return parseStrategyValidationCampaignJsonV1(bytes, {});
}

export function isStrategyValidationJobTerminal(status: StrategyValidationJobViewV1['status']): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
}

export function strategyValidationCaseLabel(value: StrategyValidationCaseV1): string {
  if (value.caseKind === 'anchor_unavailable') {
    return `${value.anchorDate} / 基準日利用不可 / ${value.unavailableReason}`;
  }
  return `${value.anchorDate} / ${value.candidate.stop.reason} / ${value.candidate.target.reason}`;
}

export function strategyValidationRunLabel(value: StrategyValidationRunSummaryV1): string {
  const mode = value.mode === 'snapshot' ? '保存Snapshot' : value.campaignName ?? 'キャンペーン';
  return `${value.completedAt} / ${mode} / ${value.confidence} / ${value.caseCount}ケース / ${value.runId}`;
}

export type {
  StrategyValidationCampaignManifestV1,
  StrategyValidationCaseV1,
  StrategyValidationJobViewV1,
  StrategyValidationPreflightViewV1,
  StrategyValidationRunV1,
};
