import {
  digestValidatedAnalysisSnapshot,
  type Phase3SnapshotInput,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import { generatedAtEpochMs } from '../snapshot/latest-order.js';
import { createSnapshotId, SnapshotIdSchema } from '../snapshot/repository.js';
import {
  AnalysisSnapshotSchema,
  CanonicalTickerSchema,
  type AnalysisSnapshot,
} from '../snapshot/schema.js';
import {
  ComparisonCorruptSnapshotError,
  COMPARISON_METRIC_REGISTRY_V1,
  classifyComparisonSectionV1,
  resolveComparisonInstancesV1,
} from './registry.js';
import {
  AnalysisSnapshotComparisonResponseV1Schema,
  COMPARISON_REGISTRY_VERSION,
  COMPARISON_RESULT_VERSION,
  COMPARISON_SECTIONS,
  type AnalysisSnapshotComparisonResponseV1,
  type CompareAnalysisSnapshotsRequestV1,
  type ComparisonFailureCodeV1,
  type ComparisonSnapshotIdentityV1,
  type SnapshotComparisonMetricRowV1,
} from './schema.js';

const FAILURE_MESSAGES: Readonly<Record<ComparisonFailureCodeV1, string>> = {
  invalid_ticker: 'The requested ticker is invalid.',
  invalid_base_snapshot_id: 'The base Snapshot ID is invalid.',
  invalid_target_snapshot_id: 'The target Snapshot ID is invalid.',
  same_snapshot_id: 'Base and target Snapshot IDs must be different.',
  base_snapshot_not_found: 'The base Snapshot was not found.',
  target_snapshot_not_found: 'The target Snapshot was not found.',
  base_ticker_mismatch: 'The base Snapshot does not belong to the requested ticker.',
  target_ticker_mismatch: 'The target Snapshot does not belong to the requested ticker.',
  invalid_order: 'The base Snapshot must be older than the target Snapshot.',
  unsupported_snapshot_version: 'A requested Snapshot version is unsupported.',
  corrupt_snapshot: 'A requested Snapshot is corrupt.',
  snapshot_filesystem_failure: 'The requested Snapshots could not be read.',
};

export type ComparisonRequestSelectorsV1 = Readonly<{
  ticker: string;
  baseSnapshotId: string;
  targetSnapshotId: string;
}>;

export function comparisonFailureV1(
  request: ComparisonRequestSelectorsV1,
  code: ComparisonFailureCodeV1,
): AnalysisSnapshotComparisonResponseV1 {
  return AnalysisSnapshotComparisonResponseV1Schema.parse({
    resultVersion: COMPARISON_RESULT_VERSION,
    registryVersion: COMPARISON_REGISTRY_VERSION,
    outcome: 'failure',
    request,
    error: { code, message: FAILURE_MESSAGES[code] },
  });
}

function selectors(request: CompareAnalysisSnapshotsRequestV1): ComparisonRequestSelectorsV1 {
  return {
    ticker: typeof request.ticker === 'string' ? request.ticker : '',
    baseSnapshotId: typeof request.base?.snapshotId === 'string' ? request.base.snapshotId : '',
    targetSnapshotId: typeof request.target?.snapshotId === 'string' ? request.target.snapshotId : '',
  };
}

function hasUnsupportedVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) return false;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && (version < 1 || version > 9);
}

function validatedInput(
  raw: Phase3SnapshotInput,
): { snapshot: AnalysisSnapshot; snapshotDigest: SnapshotDigest } | ComparisonFailureCodeV1 {
  if (hasUnsupportedVersion(raw?.snapshot)) return 'unsupported_snapshot_version';
  const parsed = AnalysisSnapshotSchema.safeParse(raw?.snapshot);
  if (!parsed.success) return 'corrupt_snapshot';
  if (!/^sha256:[0-9a-f]{64}$/.test(raw.snapshotDigest)) return 'corrupt_snapshot';
  if (createSnapshotId(parsed.data.generatedAt) !== raw.snapshotId) return 'corrupt_snapshot';
  const calculatedDigest = digestValidatedAnalysisSnapshot(parsed.data);
  if (calculatedDigest !== raw.snapshotDigest) return 'corrupt_snapshot';
  return { snapshot: parsed.data, snapshotDigest: calculatedDigest };
}

function snapshotIdentity(
  input: Phase3SnapshotInput,
  snapshot: AnalysisSnapshot,
  snapshotDigest: SnapshotDigest,
): ComparisonSnapshotIdentityV1 {
  return {
    snapshotId: input.snapshotId,
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    snapshotDigest,
  };
}

function successResponse(
  ticker: string,
  baseInput: Phase3SnapshotInput,
  targetInput: Phase3SnapshotInput,
  base: AnalysisSnapshot,
  target: AnalysisSnapshot,
  baseDigest: SnapshotDigest,
  targetDigest: SnapshotDigest,
): AnalysisSnapshotComparisonResponseV1 {
  const sectionStates = COMPARISON_SECTIONS.map(section => ({
    section,
    base: classifyComparisonSectionV1(base, section),
    target: classifyComparisonSectionV1(target, section),
  }));

  const metricRows: SnapshotComparisonMetricRowV1[] = [];
  for (const definition of COMPARISON_METRIC_REGISTRY_V1) {
    const instances = resolveComparisonInstancesV1(definition.key, base, target);
    for (const instance of instances) {
      const baseObservation = definition.extractObservation(base, instance);
      const targetObservation = definition.extractObservation(target, instance);
      metricRows.push({
        metricKey: definition.key,
        section: definition.section,
        valueKind: definition.valueKind,
        expectedUnit: definition.expectedUnit,
        displaySemantics: definition.displaySemantics,
        definitionIntroducedInSnapshotVersion: definition.introducedInSnapshotVersion,
        instanceIntroducedInSnapshotVersion: instance.introducedInSnapshotVersion,
        instanceIdentity: instance.identity,
        base: baseObservation,
        target: targetObservation,
        comparison: definition.compare(baseObservation, targetObservation),
      });
    }
  }

  return AnalysisSnapshotComparisonResponseV1Schema.parse({
    resultVersion: COMPARISON_RESULT_VERSION,
    registryVersion: COMPARISON_REGISTRY_VERSION,
    outcome: 'success',
    ticker,
    base: snapshotIdentity(baseInput, base, baseDigest),
    target: snapshotIdentity(targetInput, target, targetDigest),
    comparisonAsOf: target.generatedAt,
    sectionStates,
    metricRows,
  });
}

export function compareAnalysisSnapshotsV1(
  request: CompareAnalysisSnapshotsRequestV1,
): AnalysisSnapshotComparisonResponseV1 {
  const requestSelectors = selectors(request);
  if (!CanonicalTickerSchema.safeParse(requestSelectors.ticker).success) {
    return comparisonFailureV1(requestSelectors, 'invalid_ticker');
  }
  if (!SnapshotIdSchema.safeParse(requestSelectors.baseSnapshotId).success) {
    return comparisonFailureV1(requestSelectors, 'invalid_base_snapshot_id');
  }
  if (!SnapshotIdSchema.safeParse(requestSelectors.targetSnapshotId).success) {
    return comparisonFailureV1(requestSelectors, 'invalid_target_snapshot_id');
  }
  if (requestSelectors.baseSnapshotId === requestSelectors.targetSnapshotId) {
    return comparisonFailureV1(requestSelectors, 'same_snapshot_id');
  }

  const baseInput = validatedInput(request.base);
  if (typeof baseInput === 'string') return comparisonFailureV1(requestSelectors, baseInput);
  const targetInput = validatedInput(request.target);
  if (typeof targetInput === 'string') return comparisonFailureV1(requestSelectors, targetInput);
  if (baseInput.snapshot.canonicalTicker !== requestSelectors.ticker) {
    return comparisonFailureV1(requestSelectors, 'base_ticker_mismatch');
  }
  if (targetInput.snapshot.canonicalTicker !== requestSelectors.ticker) {
    return comparisonFailureV1(requestSelectors, 'target_ticker_mismatch');
  }
  if (generatedAtEpochMs(baseInput.snapshot) >= generatedAtEpochMs(targetInput.snapshot)) {
    return comparisonFailureV1(requestSelectors, 'invalid_order');
  }

  try {
    return successResponse(
      requestSelectors.ticker,
      request.base,
      request.target,
      baseInput.snapshot,
      targetInput.snapshot,
      baseInput.snapshotDigest,
      targetInput.snapshotDigest,
    );
  } catch (error) {
    if (error instanceof ComparisonCorruptSnapshotError) {
      return comparisonFailureV1(requestSelectors, 'corrupt_snapshot');
    }
    throw error;
  }
}
