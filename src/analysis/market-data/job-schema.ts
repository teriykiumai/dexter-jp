import { z } from 'zod';
import { canonicalJsonV1 } from '../snapshot/canonical-json.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { StrategyValidationUuidV4Schema } from '../strategy-validation/artifacts.js';
import {
  MARKET_DATA_MODULE_IDS_V1, MarketDataArtifactIdentityV1Schema, MarketDataInstantV1Schema,
  MarketDataObservationReceiptIdentityV1Schema, type MarketDataModuleIdV1,
} from './contracts.js';

export const MARKET_DATA_JOB_MAX_BYTES_V1 = 65_536;
export const MARKET_DATA_WARNING_CODES_V1 = [
  'artifact_corrupt_fallback', 'artifact_corrupt_no_fallback', 'cadence_changed', 'basis_break',
  'source_gap', 'source_refresh_failed', 'instrument_lifetime_clipped', 'job_record_write_failed',
] as const;
export const MARKET_DATA_JOB_FAILURE_CODES_V1 = [
  'source_unauthorized', 'source_entitlement_required', 'source_rate_limited', 'source_timeout',
  'source_not_yet_updated', 'source_no_observation', 'instrument_identity_unverified',
  'source_invalid_response', 'source_pagination_incomplete', 'source_response_too_large',
  'external_schedule_infeasible', 'artifact_collision', 'artifact_write_failed',
  'all_modules_failed', 'invariant_failure',
] as const;
export type MarketDataJobFailureCodeV1 = typeof MARKET_DATA_JOB_FAILURE_CODES_V1[number];
export type MarketDataModuleFailureCodeV1 = Exclude<MarketDataJobFailureCodeV1, 'all_modules_failed' | 'source_no_observation'>;
const failureMessages: Record<MarketDataJobFailureCodeV1, string> = {
  source_unauthorized: 'データソースの認証に失敗しました。',
  source_entitlement_required: '必要なデータ利用契約を確認できませんでした。',
  source_rate_limited: 'データソースの利用回数制限に達しました。',
  source_timeout: 'データ取得の制限時間に達しました。',
  source_not_yet_updated: '対象日のデータ更新を確認できませんでした。',
  source_no_observation: '対象期間に表示できる観測がありません。',
  instrument_identity_unverified: '対象銘柄の同一性を確認できませんでした。',
  source_invalid_response: 'データソースの応答を検証できませんでした。',
  source_pagination_incomplete: 'データ取得範囲の完全性を確認できませんでした。',
  source_response_too_large: 'データ取得量の上限に達しました。',
  external_schedule_infeasible: '設定された上限内でデータ取得を完了できません。',
  artifact_collision: '既存の保存データと内容が衝突しました。',
  artifact_write_failed: 'データを保存できませんでした。外部通信の割当が消費された可能性があります。',
  all_modules_failed: '全ての市場データ更新に失敗しました。各項目の理由を確認してください。',
  invariant_failure: '市場データ処理の整合性を確認できませんでした。',
};
export function marketDataJobFailureV1(code: MarketDataJobFailureCodeV1) {
  return { code, message: failureMessages[code] };
}
export class MarketDataSourceFailureV1 extends Error {
  constructor(readonly code: MarketDataModuleFailureCodeV1) { super(failureMessages[code]); }
}
export const persistedModuleReasonsV1 = ['source_no_observation', 'missing_expected_row', 'duplicate_identity',
  'ambiguous_vintage', 'insufficient_common_dates', 'invalid_base'] as const;
export const MarketDataWarningV1Schema = z.object({
  code: z.enum(MARKET_DATA_WARNING_CODES_V1), message: z.string().max(2048),
  moduleId: z.enum(MARKET_DATA_MODULE_IDS_V1).nullable(), artifactIdentity: MarketDataArtifactIdentityV1Schema.nullable(),
}).strict();
export type MarketDataWarningV1 = z.infer<typeof MarketDataWarningV1Schema>;
const warningCodes = z.array(z.enum(MARKET_DATA_WARNING_CODES_V1)).max(MARKET_DATA_WARNING_CODES_V1.length)
  .refine(values => new Set(values).size === values.length);
const moduleFailure = z.enum(MARKET_DATA_JOB_FAILURE_CODES_V1)
  .refine(code => code !== 'all_modules_failed' && code !== 'source_no_observation');
const association = { artifactIdentity: MarketDataArtifactIdentityV1Schema,
  observationReceiptIdentity: MarketDataObservationReceiptIdentityV1Schema };
const moduleBase = { moduleId: z.enum(MARKET_DATA_MODULE_IDS_V1), checkedAt: MarketDataInstantV1Schema, warningCodes };
export const MarketDataModuleResultV1Schema = z.discriminatedUnion('state', [
  z.object({ ...moduleBase, ...association, state: z.enum(['published', 'idempotent_reuse']) }).strict(),
  z.object({ ...moduleBase, ...association, state: z.literal('retained_previous'), failureCode: moduleFailure }).strict(),
  z.object({ ...moduleBase, state: z.literal('failed'), failureCode: moduleFailure,
    artifactIdentity: z.null(), observationReceiptIdentity: z.null() }).strict(),
]).refine(value => value.state === 'failed' || (value.artifactIdentity.scope === 'overview'
  && value.artifactIdentity.tickerOrSourceId === `${value.moduleId}_v1`
  && value.observationReceiptIdentity.scope === 'overview'
  && value.observationReceiptIdentity.tickerOrSourceId === `${value.moduleId}_v1`));
export type MarketDataModuleResultV1 = z.infer<typeof MarketDataModuleResultV1Schema>;
export const MarketDataJobResultV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('technical'), state: z.enum(['published', 'idempotent_reuse']),
    checkedAt: MarketDataInstantV1Schema, ...association, warningCodes }).strict(),
  z.object({ kind: z.literal('overview'), checkedAt: MarketDataInstantV1Schema,
    moduleResults: z.array(MarketDataModuleResultV1Schema).min(1).max(6) }).strict(),
]);
export const MARKET_DATA_JOB_STATUSES_V1 = ['accepted', 'running', 'cancel_requested', 'publishing',
  'completed', 'failed', 'cancelled', 'interrupted'] as const;
export type MarketDataJobStatusV1 = typeof MARKET_DATA_JOB_STATUSES_V1[number];
export function isMarketDataJobTerminalV1(status: MarketDataJobStatusV1): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
}
const count = z.number().int().nonnegative().safe();
export const MarketDataJobViewV1Schema = z.object({
  schemaVersion: z.literal('market_data_job_view_v1'), jobId: StrategyValidationUuidV4Schema,
  kind: z.enum(['technical_refresh', 'overview_refresh']),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('technical'), ticker: CanonicalTickerSchema }).strict(),
    z.object({ kind: z.literal('overview') }).strict(),
  ]),
  status: z.enum(MARKET_DATA_JOB_STATUSES_V1), acceptedAt: MarketDataInstantV1Schema,
  startedAt: MarketDataInstantV1Schema.nullable(), completedAt: MarketDataInstantV1Schema.nullable(),
  progress: z.object({ attempts: count, pages: count, acceptedRows: count, responseBytes: count,
    completedModules: count, totalModules: z.number().int().min(1).max(6) }).strict(),
  failure: z.object({ code: z.enum(MARKET_DATA_JOB_FAILURE_CODES_V1), message: z.string() }).strict().nullable(),
  result: MarketDataJobResultV1Schema.nullable(),
}).strict().superRefine((job, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Invalid Market Data job invariant.' });
  const technical = job.kind === 'technical_refresh';
  if (technical !== (job.target.kind === 'technical')) invalid();
  if (technical && job.progress.totalModules !== 1) invalid();
  if (job.progress.completedModules > job.progress.totalModules) invalid();
  if (isMarketDataJobTerminalV1(job.status) !== (job.completedAt !== null)) invalid();
  if ((job.status === 'failed') !== (job.failure !== null)) invalid();
  const hasResult = job.status === 'completed' || (job.status === 'failed' && !technical);
  if (hasResult !== (job.result !== null)) invalid();
  if ((job.startedAt !== null && job.startedAt < job.acceptedAt)
    || (job.completedAt !== null && job.completedAt < (job.startedAt ?? job.acceptedAt))) invalid();
  if (job.status === 'accepted' && job.startedAt !== null) invalid();
  if (['running', 'publishing', 'completed'].includes(job.status) && job.startedAt === null) invalid();
  if (job.failure && (job.failure.message !== failureMessages[job.failure.code]
    || (technical ? job.failure.code === 'all_modules_failed' : job.failure.code !== 'all_modules_failed'))) invalid();
  if (!job.result) return;
  if (technical !== (job.result.kind === 'technical')) { invalid(); return; }
  if (job.result.checkedAt < job.acceptedAt || job.result.checkedAt > job.completedAt!) invalid();
  const successes: { artifactIdentity: z.infer<typeof MarketDataArtifactIdentityV1Schema>;
    observationReceiptIdentity: z.infer<typeof MarketDataObservationReceiptIdentityV1Schema> }[] = [];
  if (job.result.kind === 'overview') {
    const results = job.result.moduleResults;
    if (results.length !== job.progress.totalModules || job.progress.completedModules !== job.progress.totalModules) invalid();
    const indexes = results.map(result => MARKET_DATA_MODULE_IDS_V1.indexOf(result.moduleId));
    if (indexes.some((index, i) => i > 0 && index <= indexes[i - 1]!)) invalid();
    for (const result of results) {
      if (result.checkedAt !== job.result.checkedAt) invalid();
      if (result.state === 'published' || result.state === 'idempotent_reuse') successes.push(result);
      else if (result.warningCodes.includes('job_record_write_failed')) invalid();
    }
    if ((job.status === 'completed') !== (successes.length > 0)) invalid();
  } else {
    if (job.target.kind !== 'technical' || job.result.artifactIdentity.scope !== 'technical'
      || job.result.artifactIdentity.tickerOrSourceId !== job.target.ticker) invalid();
    successes.push(job.result);
    if (job.status === 'completed' && job.progress.completedModules !== 1) invalid();
  }
  for (const result of successes) {
    const receipt = result.observationReceiptIdentity;
    if (receipt.jobId !== job.jobId || receipt.acceptedAtEpochMs !== Date.parse(job.acceptedAt)
      || receipt.scope !== result.artifactIdentity.scope || receipt.tickerOrSourceId !== result.artifactIdentity.tickerOrSourceId) invalid();
  }
});
export type MarketDataJobViewV1 = z.infer<typeof MarketDataJobViewV1Schema>;
export type MarketDataJobResultV1 = NonNullable<MarketDataJobViewV1['result']>;
const transitions: Record<MarketDataJobStatusV1, readonly MarketDataJobStatusV1[]> = {
  accepted: ['running', 'failed', 'cancel_requested', 'interrupted'],
  running: ['publishing', 'failed', 'cancel_requested', 'interrupted'],
  cancel_requested: ['cancelled', 'interrupted'], publishing: ['completed', 'failed', 'interrupted'],
  completed: [], failed: [], cancelled: [], interrupted: [],
};
export function assertMarketDataJobReplacementV1(previous: MarketDataJobViewV1, next: MarketDataJobViewV1): void {
  if (previous.jobId !== next.jobId || previous.kind !== next.kind || previous.acceptedAt !== next.acceptedAt
    || canonicalJsonV1(previous.target) !== canonicalJsonV1(next.target)
    || previous.progress.totalModules !== next.progress.totalModules
    || (previous.startedAt !== null && previous.startedAt !== next.startedAt)
    || (previous.status === next.status ? isMarketDataJobTerminalV1(previous.status)
      : !transitions[previous.status].includes(next.status))
    || (Object.keys(previous.progress) as (keyof typeof previous.progress)[])
      .some(key => next.progress[key] < previous.progress[key])) throw new Error('Invalid job replacement.');
}
export const moduleOrderV1 = (id: MarketDataModuleIdV1) => MARKET_DATA_MODULE_IDS_V1.indexOf(id);
