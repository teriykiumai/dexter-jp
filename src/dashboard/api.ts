import {
  AnalysisSnapshotPersistenceError,
  AnalysisSnapshotSchema,
  CanonicalTickerSchema,
  SnapshotIdSchema,
  type AnalysisSnapshotRepository,
} from '../analysis/snapshot/index.js';
import { digestValidatedAnalysisSnapshot } from '../analysis/snapshot/canonical-json.js';
import {
  compareAnalysisSnapshotsV1,
  comparisonFailureV1,
  type AnalysisSnapshotComparisonResponseV1,
  type ComparisonFailureCodeV1,
  type ComparisonRequestSelectorsV1,
} from '../analysis/comparison/index.js';
import { loadDashboardAsset } from './assets.js';
import type { StrategyValidationDashboardApiV1 } from './strategy-validation-api.js';

export type AnalysisSnapshotReader = Pick<
  AnalysisSnapshotRepository,
  'listLatest' | 'loadLatest' | 'listHistory' | 'loadHistory'
>;

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

export function internalServerErrorResponse(): Response {
  return errorResponse(500, 'snapshot_unavailable', 'The requested analysis snapshot is unavailable.');
}

async function staticAssetResponse(pathname: string): Promise<Response | null> {
  const asset = await loadDashboardAsset(pathname);
  if (!asset) return null;
  return new Response(asset.body, {
    headers: {
      ...BASE_HEADERS,
      'Content-Type': asset.contentType,
      ...(asset.isHtml ? {
        'Content-Security-Policy': [
          "default-src 'self'",
          "img-src 'self' data:",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join('; '),
      } : {}),
    },
  });
}

function decodedSegments(pathname: string): string[] | null {
  try {
    return pathname.split('/').slice(1).map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function persistenceErrorResponse(error: AnalysisSnapshotPersistenceError): Response {
  switch (error.kind) {
    case 'unsafe_ticker':
    case 'unsafe_snapshot_id':
      return errorResponse(400, 'invalid_route_parameter', 'The route contains an invalid ticker or snapshot ID.');
    case 'missing_snapshot':
      return errorResponse(404, 'snapshot_not_found', 'The requested analysis snapshot was not found.');
    case 'malformed_json':
    case 'schema_validation_failed':
    case 'unsupported_schema_version':
    case 'snapshot_identity_mismatch':
    case 'filesystem_error':
    case 'snapshot_id_collision':
    case 'snapshot_history_corrupt':
    case 'create_only_publish_unsupported':
    case 'latest_resolution_failed':
      return internalServerErrorResponse();
  }
}

const COMPARISON_BAD_REQUEST_CODES = new Set<ComparisonFailureCodeV1>([
  'invalid_ticker',
  'invalid_base_snapshot_id',
  'invalid_target_snapshot_id',
  'same_snapshot_id',
  'base_ticker_mismatch',
  'target_ticker_mismatch',
  'invalid_order',
]);

function comparisonResponse(value: AnalysisSnapshotComparisonResponseV1): Response {
  if (value.outcome === 'success') return jsonResponse(value);
  if (COMPARISON_BAD_REQUEST_CODES.has(value.error.code)) return jsonResponse(value, 400);
  if (value.error.code === 'base_snapshot_not_found' || value.error.code === 'target_snapshot_not_found') {
    return jsonResponse(value, 404);
  }
  return jsonResponse(value, 500);
}

function comparisonPersistenceFailure(
  request: ComparisonRequestSelectorsV1,
  side: 'base' | 'target',
  error: AnalysisSnapshotPersistenceError,
): AnalysisSnapshotComparisonResponseV1 {
  if (error.kind === 'missing_snapshot') {
    return comparisonFailureV1(request, `${side}_snapshot_not_found`);
  }
  if (error.kind === 'unsupported_schema_version') {
    return comparisonFailureV1(request, 'unsupported_snapshot_version');
  }
  if (
    error.kind === 'malformed_json'
    || error.kind === 'schema_validation_failed'
    || error.kind === 'snapshot_identity_mismatch'
    || error.kind === 'snapshot_history_corrupt'
  ) {
    return comparisonFailureV1(request, 'corrupt_snapshot');
  }
  return comparisonFailureV1(request, 'snapshot_filesystem_failure');
}

async function loadComparisonInput(
  repository: AnalysisSnapshotReader,
  request: ComparisonRequestSelectorsV1,
  side: 'base' | 'target',
) {
  const snapshotId = side === 'base' ? request.baseSnapshotId : request.targetSnapshotId;
  try {
    const rawSnapshot = await repository.loadHistory(request.ticker, snapshotId);
    const parsed = AnalysisSnapshotSchema.safeParse(rawSnapshot);
    if (!parsed.success) return comparisonFailureV1(request, 'corrupt_snapshot');
    const snapshot = parsed.data;
    return {
      snapshotId,
      snapshot,
      snapshotDigest: digestValidatedAnalysisSnapshot(snapshot),
    } as const;
  } catch (error) {
    if (error instanceof AnalysisSnapshotPersistenceError) {
      return comparisonPersistenceFailure(request, side, error);
    }
    return comparisonFailureV1(request, 'snapshot_filesystem_failure');
  }
}

async function handleComparisonRequest(
  url: URL,
  ticker: string,
  repository: AnalysisSnapshotReader,
): Promise<Response> {
  const baseSnapshotIds = url.searchParams.getAll('baseSnapshotId');
  const targetSnapshotIds = url.searchParams.getAll('targetSnapshotId');
  const request = {
    ticker,
    baseSnapshotId: baseSnapshotIds.length === 1 ? baseSnapshotIds[0]! : '',
    targetSnapshotId: targetSnapshotIds.length === 1 ? targetSnapshotIds[0]! : '',
  } satisfies ComparisonRequestSelectorsV1;

  if (!CanonicalTickerSchema.safeParse(request.ticker).success) {
    return comparisonResponse(comparisonFailureV1(request, 'invalid_ticker'));
  }
  if (!SnapshotIdSchema.safeParse(request.baseSnapshotId).success) {
    return comparisonResponse(comparisonFailureV1(request, 'invalid_base_snapshot_id'));
  }
  if (!SnapshotIdSchema.safeParse(request.targetSnapshotId).success) {
    return comparisonResponse(comparisonFailureV1(request, 'invalid_target_snapshot_id'));
  }
  if (request.baseSnapshotId === request.targetSnapshotId) {
    return comparisonResponse(comparisonFailureV1(request, 'same_snapshot_id'));
  }

  const base = await loadComparisonInput(repository, request, 'base');
  if ('outcome' in base) return comparisonResponse(base);
  const target = await loadComparisonInput(repository, request, 'target');
  if ('outcome' in target) return comparisonResponse(target);
  return comparisonResponse(compareAnalysisSnapshotsV1({ ticker, base, target }));
}

export function isAllowedDashboardHost(host: string | null): boolean {
  if (host === null) return false;
  const match = /^(?:127\.0\.0\.1|localhost)(?::([1-9]\d{0,4}))?$/.exec(
    host.trim().toLowerCase(),
  );
  if (!match) return false;
  return match[1] === undefined || Number(match[1]) <= 65_535;
}

export async function handleDashboardRequest(
  request: Request,
  repository: AnalysisSnapshotReader,
  strategyValidationApi?: StrategyValidationDashboardApiV1,
): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedDashboardHost(request.headers.get('host'))) {
    return errorResponse(403, 'forbidden_host', 'The request Host is not allowed.');
  }

  const segments = decodedSegments(url.pathname);
  if (segments === null) {
    return errorResponse(400, 'invalid_route_parameter', 'The route contains invalid encoding.');
  }

  if (strategyValidationApi !== undefined) {
    const strategyResponse = await strategyValidationApi.handle(request, url, segments);
    if (strategyResponse !== null) return strategyResponse;
  }

  if (request.method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Only GET requests are supported.', {
      Allow: 'GET',
    });
  }

  if (!url.pathname.startsWith('/api/')) {
    try {
      const assetResponse = await staticAssetResponse(url.pathname);
      if (assetResponse) return assetResponse;
    } catch {
      return internalServerErrorResponse();
    }
  }

  try {
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'analyses') {
      return jsonResponse(await repository.listLatest());
    }

    if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'analyses') {
      const snapshot = await repository.loadLatest(segments[2]);
      return jsonResponse(AnalysisSnapshotSchema.parse(snapshot));
    }

    if (
      segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'analyses'
      && segments[3] === 'comparison'
    ) {
      return await handleComparisonRequest(url, segments[2], repository);
    }

    if (
      segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'analyses'
      && segments[3] === 'history'
    ) {
      const history = await repository.listHistory(segments[2]);
      if (history.length === 0) await repository.loadLatest(segments[2]);
      return jsonResponse(history);
    }

    if (
      segments.length === 5
      && segments[0] === 'api'
      && segments[1] === 'analyses'
      && segments[3] === 'history'
    ) {
      const snapshot = await repository.loadHistory(segments[2], segments[4]);
      return jsonResponse(AnalysisSnapshotSchema.parse(snapshot));
    }
  } catch (error) {
    if (error instanceof AnalysisSnapshotPersistenceError) {
      return persistenceErrorResponse(error);
    }
    return internalServerErrorResponse();
  }

  return errorResponse(404, 'route_not_found', 'The requested route was not found.');
}
