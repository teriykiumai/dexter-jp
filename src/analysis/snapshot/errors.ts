export type AnalysisSnapshotPersistenceErrorKind =
  | 'missing_snapshot'
  | 'malformed_json'
  | 'schema_validation_failed'
  | 'unsupported_schema_version'
  | 'snapshot_identity_mismatch'
  | 'unsafe_ticker'
  | 'unsafe_snapshot_id'
  | 'filesystem_error'
  | 'snapshot_id_collision'
  | 'snapshot_history_corrupt'
  | 'create_only_publish_unsupported'
  | 'latest_resolution_failed';

export class AnalysisSnapshotPersistenceError extends Error {
  readonly kind: AnalysisSnapshotPersistenceErrorKind;
  readonly causeValue: unknown;

  constructor(
    kind: AnalysisSnapshotPersistenceErrorKind,
    message: string,
    causeValue?: unknown,
  ) {
    super(message);
    this.name = 'AnalysisSnapshotPersistenceError';
    this.kind = kind;
    this.causeValue = causeValue;
  }
}
