import { z } from 'zod';
import { AnalysisSnapshotPersistenceError } from './errors.js';

export const SnapshotIdSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
  'snapshotId must be a Windows-safe UTC timestamp.',
);

export type SnapshotId = z.infer<typeof SnapshotIdSchema>;

export function createSnapshotId(generatedAt: string): SnapshotId {
  const timestamp = new Date(generatedAt);
  if (!generatedAt.endsWith('Z') || Number.isNaN(timestamp.getTime())) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id',
      `Cannot create snapshot ID from generatedAt: ${generatedAt}`,
    );
  }
  const parsed = SnapshotIdSchema.safeParse(timestamp.toISOString().replace(/[:.]/g, '-'));
  if (!parsed.success) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id',
      `Cannot create snapshot ID from generatedAt: ${generatedAt}`,
      parsed.error,
    );
  }
  return parsed.data;
}
