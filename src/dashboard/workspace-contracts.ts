import { z } from 'zod';
import { isStrictGregorianDate } from '../analysis/strategy-validation/date.js';

const date = z.string().refine(isStrictGregorianDate), interval = z.enum(['day', 'week', 'month']);
const unavailable = z.object({ state: z.literal('unavailable'), reason: z.enum(['warmup', 'partial_period', 'source_gap']) }).strict();
const indicator = z.union([z.object({ state: z.literal('available'), value: z.number().finite() }).strict(), unavailable]);
const period = { interval, identity: z.string().min(1), periodStart: date, periodEnd: date };
// Public chart DTO is independent of the immutable artifact schema.
export const WorkspaceCandleSchema = z.object({ ...period,
  displayDate: date, firstSessionDate: date, lastSessionDate: date, partial: z.boolean(),
  open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative(),
  rsi: indicator, macd: indicator, signal: indicator, histogram: indicator, sma20: indicator,
  cross: z.union([z.object({ state: z.literal('available'), value: z.enum(['golden_cross', 'none']) }).strict(), unavailable]),
  completion: z.enum(['ongoing', 'confirmed']), coverage: z.enum(['history_coverage_clipped', 'complete']), sourceGaps: z.array(date),
}).strict();
export const WorkspaceChartSchema = z.object({ schemaVersion: z.literal('workspace_chart_v1'),
  dataDate: date, eligibilityFrom: date, artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  intervals: z.object({ day: z.array(WorkspaceCandleSchema), week: z.array(WorkspaceCandleSchema), month: z.array(WorkspaceCandleSchema) }).strict(),
  unavailablePeriods: z.array(z.union([
    z.object({ ...period, reason: z.literal('source_gap') }).strict(),
    z.object({ ...period, interval: z.enum(['week', 'month']), reason: z.literal('partial_period') }).strict(),
  ])),
}).strict().refine(chart => (['day', 'week', 'month'] as const).every(key => chart.intervals[key].every(row => row.interval === key)));
const candidate = z.object({ instrumentId: z.uuid(), code: z.string().min(1).max(5), label: z.string().min(1).max(160) }).strict();
export const WorkspaceItemSchema = candidate.extend({ schemaVersion: z.literal('workspace_item_v1'), favorite: z.union([z.literal(0), z.literal(1)]), revision: z.number().int().nonnegative() }).strict();
export const WorkspaceSearchSchema = z.object({ schemaVersion: z.literal('workspace_search_v1'), items: z.array(candidate) }).strict();
export const WorkspaceRecentsSchema = z.object({ schemaVersion: z.literal('workspace_recents_v1'), items: z.array(WorkspaceItemSchema) }).strict();
export const WorkspaceViewSchema = z.object({ schemaVersion: z.literal('workspace_view_v1'), item: WorkspaceItemSchema, chart: WorkspaceChartSchema.nullable() }).strict();
export const WorkspaceJobViewSchema = z.object({ schemaVersion: z.literal('workspace_job_v1'), id: z.uuid(), kind: z.enum(['catalog', 'technical']),
  state: z.enum(['queued', 'running', 'publishing', 'published', 'failed', 'interrupted', 'identity_review_required']),
  instrumentId: z.uuid().nullable(), error: z.string().max(80).nullable() }).strict()
  .refine(job => (job.kind === 'catalog') === (job.instrumentId === null));
export const WorkspaceActiveSchema = z.object({ schemaVersion: z.literal('workspace_active_v1'), job: WorkspaceJobViewSchema.nullable(), blockingKind: z.string().min(1).max(80).nullable() }).strict()
  .refine(value => value.job === null || value.blockingKind === null);
export const WorkspaceSessionSchema = z.object({ schemaVersion: z.literal('dashboard_session_v1'), csrfHeader: z.literal('X-Dexter-CSRF'), csrfToken: z.string().min(1) }).strict();
export const WorkspaceErrorSchema = z.object({ schemaVersion: z.literal('workspace_error_v1'), error: z.object({ code: z.string().min(1).max(80), message: z.string().max(300).optional() }).strict() }).strict();
export const WorkspaceResponseSchema = z.union([WorkspaceSearchSchema, WorkspaceRecentsSchema, WorkspaceItemSchema, WorkspaceViewSchema,
  WorkspaceJobViewSchema, WorkspaceActiveSchema, WorkspaceSessionSchema, WorkspaceErrorSchema]);
export type WorkspaceCandidate = z.infer<typeof candidate>;
export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;
export type WorkspaceChart = z.infer<typeof WorkspaceChartSchema>;
export type WorkspaceView = z.infer<typeof WorkspaceViewSchema>;
export type WorkspaceJobView = z.infer<typeof WorkspaceJobViewSchema>;
export const workspaceTerminal = (job: WorkspaceJobView) => ['published', 'failed', 'interrupted', 'identity_review_required'].includes(job.state);
