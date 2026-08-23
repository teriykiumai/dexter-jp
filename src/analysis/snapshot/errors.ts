export type AnalysisSnapshotPersistenceErrorKind =
  | 'missing_snapshot'
  | 'malformed_json'
  | 'schema_validation_failed'
  | 'unsupported_schema_version'
  | 'unsafe_ticker'
  | 'unsafe_snapshot_id'
  | 'filesystem_error'
  | 'latest_update_failed';

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
