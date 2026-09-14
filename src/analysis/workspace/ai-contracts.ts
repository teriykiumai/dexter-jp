import { z } from 'zod';
import { WorkspaceFinancialSchema, WorkspaceSupplySchema } from '../../dashboard/workspace-contracts.js';

export const AiProfileSchema = z.enum(['fundamental', 'supply_demand']);
export type AiProfile = z.infer<typeof AiProfileSchema>;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const AiRefSchema = z.object({ path: z.string().max(500), codec: z.string().max(80), digest }).strict();
export const AiRuntimeSchema = z.object({ model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,119}$/),
  providerId: z.string().regex(/^[a-z0-9_-]{1,40}$/), reasoningEffort: z.enum(['low', 'medium', 'high']).optional() }).strict();
export type AiRuntime = z.infer<typeof AiRuntimeSchema>;
const binding = z.object({ artifact: AiRefSchema, receipt: AiRefSchema }).strict();
export const AiSelectionSchema = z.object({ identity: z.object({ instrumentId: z.uuid(), provider: z.string(), code: z.string(),
  mappingRevision: z.number().int().positive(), catalogGeneration: z.number().int().positive() }).strict(), master: AiRefSchema,
  financial: binding.nullable(), technical: binding.nullable(), margin: binding.nullable(), issuer_short: binding.nullable(),
  sector_short: binding.extend({ membership: AiRefSchema }).strict().nullable() }).strict();
export type AiSelection = z.infer<typeof AiSelectionSchema>;
const common = { version: z.literal('workspace_ai_input_v1'), runId: z.uuid(), createdAt: z.iso.datetime(),
  profileVersion: z.literal('saved_interpretation_v1'), selection: AiSelectionSchema, runtime: AiRuntimeSchema };
export const AiInputSchema = z.discriminatedUnion('profile', [
  z.object({ ...common, profile: z.literal('fundamental'), data: WorkspaceFinancialSchema }).strict(),
  z.object({ ...common, profile: z.literal('supply_demand'), data: WorkspaceSupplySchema }).strict(),
]).refine(input => input.data.instrumentId === input.selection.identity.instrumentId
  && (input.profile === 'fundamental'
    ? input.selection.margin === null && input.selection.issuer_short === null && input.selection.sector_short === null
    : input.selection.financial === null && input.selection.technical === null));
export type AiInput = z.infer<typeof AiInputSchema>;
const statement = z.object({
  // Numeric values stay in the server-generated exact input tables, never in AI prose.
  text: z.string().trim().min(1).max(1200).refine(value => !/\p{N}/u.test(value)),
  sources: z.array(z.enum(['financial', 'margin', 'issuer_short', 'sector_short'])).min(1).max(3),
}).strict().refine(value => new Set(value.sources).size === value.sources.length);
export const AiInterpretationSchema = z.object({ observations: z.array(statement).min(1).max(6), limitations: z.array(statement).min(1).max(6) }).strict();
export type AiInterpretation = z.infer<typeof AiInterpretationSchema>;
export const AnalysisRunArtifactV1Schema = z.object({ version: z.literal('analysis_run_artifact_v1'), runId: z.uuid(), instrumentId: z.uuid(),
  profile: AiProfileSchema, profileVersion: z.literal('saved_interpretation_v1'), input: AiRefSchema, createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime(), runtime: AiRuntimeSchema,
  asOf: z.array(z.object({ source: z.enum(['financial', 'margin', 'issuer_short', 'sector_short']), through: z.iso.date().nullable(),
    checkedAt: z.iso.datetime().nullable() }).strict()).min(1).max(3), interpretation: AiInterpretationSchema }).strict()
  .refine(value => value.completedAt >= value.createdAt);
export type AnalysisRunArtifactV1 = z.infer<typeof AnalysisRunArtifactV1Schema>;
export const AiStateSchema = z.enum(['prepared', 'running', 'publishing', 'published', 'interrupted', 'failed', 'cancelled', 'insufficient_inputs']);
export type AiState = z.infer<typeof AiStateSchema>;
export const aiTerminal = (state: AiState) => !['prepared', 'running', 'publishing'].includes(state);
export const AiErrorSchema = z.enum(['model_unavailable', 'invalid_result', 'model_failed', 'cancelled', 'interrupted', 'insufficient_inputs', 'publication_unresolved']);
export const AiJobViewSchema = z.object({ schemaVersion: z.literal('workspace_ai_job_v1'), id: z.uuid(), instrumentId: z.uuid(),
  profile: AiProfileSchema, createdAt: z.iso.datetime(), state: AiStateSchema, error: AiErrorSchema.nullable(),
  input: AiRefSchema, result: AiRefSchema.nullable() }).strict().refine(value => (value.state === 'published') === (value.result !== null));
export type AiJobView = z.infer<typeof AiJobViewSchema>;
export const AiHistorySchema = z.object({ schemaVersion: z.literal('workspace_ai_history_v1'), instrumentId: z.uuid(),
  items: z.array(AiJobViewSchema).max(20), next: z.uuid().nullable(), active: AiJobViewSchema.nullable(), busy: z.boolean(),
  configured: z.boolean(), runtime: AiRuntimeSchema.nullable() }).strict()
  .refine(value => value.items.every(item => item.instrumentId === value.instrumentId) && (!value.active || value.active.instrumentId === value.instrumentId));
export type AiHistory = z.infer<typeof AiHistorySchema>;
export const AiDetailSchema = z.object({ schemaVersion: z.literal('workspace_ai_detail_v1'), job: AiJobViewSchema,
  input: AiInputSchema, result: AnalysisRunArtifactV1Schema.nullable() }).strict().refine(value => value.input.runId === value.job.id
    && value.input.selection.identity.instrumentId === value.job.instrumentId && value.input.profile === value.job.profile
    && (value.job.state === 'published') === (value.result !== null) && (!value.result || value.result.runId === value.job.id
      && value.result.instrumentId === value.job.instrumentId && value.result.profile === value.job.profile
      && value.result.input.digest === value.job.input.digest));
export type AiDetail = z.infer<typeof AiDetailSchema>;
