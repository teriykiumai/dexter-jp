import { readFile } from 'node:fs/promises';
import {
  AnalysisSnapshotPersistenceError,
  AnalysisSnapshotSchema,
  type AnalysisSnapshotRepository,
} from '../analysis/snapshot/index.js';

export type AnalysisSnapshotReader = Pick<
  AnalysisSnapshotRepository,
  'listLatest' | 'loadLatest' | 'listHistory' | 'loadHistory'
>;

const INDEX_HTML_URL = new URL('./web/index.html', import.meta.url);
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

async function staticIndexResponse(): Promise<Response> {
  const html = await readFile(INDEX_HTML_URL, 'utf8');
  return new Response(html, {
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
    case 'filesystem_error':
    case 'latest_update_failed':
      return internalServerErrorResponse();
  }
}

export async function handleDashboardRequest(
  request: Request,
  repository: AnalysisSnapshotReader,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Only GET requests are supported.', {
      Allow: 'GET',
    });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      return await staticIndexResponse();
    } catch {
      return internalServerErrorResponse();
    }
  }

  const segments = decodedSegments(url.pathname);
  if (segments === null) {
    return errorResponse(400, 'invalid_route_parameter', 'The route contains invalid encoding.');
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
