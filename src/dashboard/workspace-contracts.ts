import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { WorkspaceDataJob } from '../analysis/workspace/data-jobs.js';
import { z } from 'zod';

export type WorkspaceItem = { instrumentId: string; code: string; label: string; favorite: number; revision: number };
export type WorkspaceChart = { dataDate: string; eligibilityFrom: string; artifactDigest: string;
  intervals: TechnicalArtifactV2['result']['intervals']; unavailablePeriods: TechnicalArtifactV2['result']['unavailablePeriods'] };
export type WorkspaceView = { schemaVersion: 'workspace_view_v1'; item: WorkspaceItem;
  chart: WorkspaceChart | null };
export type WorkspaceJobView = { id: string; kind: WorkspaceDataJob['kind']; state: WorkspaceDataJob['state'];
  instrumentId: string | null; error: string | null };
export const WorkspaceJobViewSchema = z.object({ id: z.uuid(), kind: z.enum(['catalog', 'technical']),
  state: z.enum(['queued', 'running', 'publishing', 'published', 'failed', 'interrupted', 'identity_review_required']),
  instrumentId: z.uuid().nullable(), error: z.string().max(80).nullable() }).strict()
  .refine(job => (job.kind === 'catalog') === (job.instrumentId === null));
export const workspaceTerminal = (job: WorkspaceJobView) => ['published', 'failed', 'interrupted', 'identity_review_required'].includes(job.state);
