import { z } from 'zod';
import { AnalysisSnapshotPersistenceError } from './errors.js';

const SNAPSHOT_ID_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

export const SnapshotIdSchema = z.string().regex(
  SNAPSHOT_ID_PATTERN,
  'snapshotId must be a Windows-safe UTC timestamp.',
);

export type SnapshotId = z.infer<typeof SnapshotIdSchema>;

export function snapshotGeneratedAtFromId(snapshotIdValue: unknown): string {
  const parsed = SnapshotIdSchema.safeParse(snapshotIdValue);
  const match = parsed.success ? SNAPSHOT_ID_PATTERN.exec(parsed.data) : null;
  if (!parsed.success || match === null) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id', 'Cannot derive generatedAt from an unsafe snapshot ID.',
    );
  }
  const generatedAt = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const timestamp = new Date(generatedAt);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== generatedAt) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id', 'Cannot derive generatedAt from an invalid snapshot timestamp.',
    );
  }
  return generatedAt;
}

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
