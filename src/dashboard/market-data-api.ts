import { StrategyValidationUuidV4Schema } from '../analysis/strategy-validation/artifacts.js';
import { parseStrictJsonBytesV1 } from '../analysis/strategy-validation/strict-json.js';
import { DashboardJobCoordinatorErrorV1, dashboardCoordinatorFailureV1 } from '../analysis/dashboard-jobs/coordinator.js';
import { MarketDataJobRepositoryErrorV1 } from '../analysis/market-data/job-repository.js';
import { MarketDataJobServiceErrorV1, type MarketDataJobServiceV1 } from '../analysis/market-data/job-service.js';
import {
  DashboardSecurityErrorV1,
  DashboardSessionV1,
  dashboardSecurityFailureV1,
  isAllowedDashboardHost,
  readDashboardBody,
  requireDashboardJsonMediaType,
} from './session.js';

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const POST_LIMIT = 4096;

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...BASE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function errorResponse(status: number, code: string, message: string, headers?: Record<string, string>): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}
function methodNotAllowed(allow: string): Response {
  return errorResponse(405, 'method_not_allowed', 'The request method is not allowed.', { Allow: allow });
}
class MarketDataApiErrorV1 extends Error {
  constructor(readonly code: 'invalid_request' | 'invalid_query') { super(code); }
}
function mapError(error: unknown): Response {
  if (error instanceof DashboardJobCoordinatorErrorV1) {
    const failure = dashboardCoordinatorFailureV1(error, 'market_data');
    return errorResponse(failure.status, failure.code, failure.message,
      failure.retryAfterSeconds ? { 'Retry-After': String(failure.retryAfterSeconds) } : undefined);
  }
  if (error instanceof DashboardSecurityErrorV1) {
    const failure = dashboardSecurityFailureV1(error, 'market_data');
    return errorResponse(failure.status, failure.code, failure.message);
  }
  if (error instanceof MarketDataApiErrorV1) {
    return errorResponse(400, error.code, 'The request is invalid.');
  }
  if (error instanceof MarketDataJobServiceErrorV1) {
    const status = error.code === 'source_configuration_missing' ? 400
      : error.code === 'artifact_not_found' || error.code === 'job_not_found' ? 404
        : error.code === 'invalid_job_state' ? 409 : 500;
    const messages: Record<MarketDataJobServiceErrorV1['code'], string> = {
      source_configuration_missing: 'No Market Data source module is configured.',
      artifact_not_found: 'The requested Market Data artifact was not found.',
      job_not_found: 'The Market Data job was not found.',
      invalid_job_state: 'The Market Data job cannot make that transition.',
      artifact_corrupt: 'The Market Data artifact could not be validated.',
      artifact_recovery_bound_exceeded: 'The Market Data recovery bound was exceeded.',
      latest_resolution_failed: 'The latest Market Data observation could not be resolved.',
      repository_failure: 'The Market Data repository is unavailable.',
      invariant_failure: 'The Market Data request could not be completed.',
    };
    return errorResponse(status, error.code, messages[error.code]);
  }
  if (error instanceof MarketDataJobRepositoryErrorV1) {
    return errorResponse(500, 'repository_failure', 'The Market Data repository is unavailable.');
  }
  return errorResponse(500, 'invariant_failure', 'The Market Data request could not be completed.');
}

export class MarketDataDashboardApiV1 {
  constructor(readonly service: MarketDataJobServiceV1, readonly session: DashboardSessionV1) {
    void service.initialize().catch(() => undefined);
  }

  async handle(request: Request, url: URL, segments: readonly string[]): Promise<Response | null> {
    if (segments[0] !== 'api' || segments[1] !== 'market-data') return null;
    try {
      if (!isAllowedDashboardHost(request.headers.get('host'))) throw new DashboardSecurityErrorV1('forbidden_host');

      if (segments.length === 3 && segments[2] === 'overview') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        this.#requireNoQuery(url);
        return jsonResponse(await this.service.readOverview());
      }

      if (segments.length === 4 && segments[2] === 'overview' && segments[3] === 'jobs') {
        if (request.method !== 'POST') return methodNotAllowed('POST');
        this.session.requireMutation(request, url);
        this.#requireNoQuery(url);
        requireDashboardJsonMediaType(request);
        let body: unknown;
        try { body = parseStrictJsonBytesV1(await readDashboardBody(request, POST_LIMIT), POST_LIMIT); }
        catch (error) {
          if (error instanceof DashboardSecurityErrorV1) throw error;
          throw new MarketDataApiErrorV1('invalid_request');
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
          throw new MarketDataApiErrorV1('invalid_request');
        }
        return jsonResponse(await this.service.acceptOverview(), 202);
      }

      if (segments.length === 4 && segments[2] === 'jobs' && segments[3] === 'active') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        this.#requireNoQuery(url);
        return jsonResponse(await this.service.activeJob());
      }

      if (segments.length === 4 && segments[2] === 'jobs') {
        if (!StrategyValidationUuidV4Schema.safeParse(segments[3]).success) {
          throw new MarketDataApiErrorV1('invalid_request');
        }
        this.#requireNoQuery(url);
        if (request.method === 'GET') return jsonResponse(await this.service.getJob(segments[3]!));
        if (request.method === 'DELETE') {
          this.session.requireMutation(request, url);
          const body = await readDashboardBody(request, 0);
          if (body.byteLength) throw new DashboardSecurityErrorV1('invalid_request');
          const result = await this.service.cancelJob(segments[3]!);
          return jsonResponse(result.job, result.status);
        }
        return methodNotAllowed('GET, DELETE');
      }

      return errorResponse(400, 'invalid_request', 'The request is invalid.');
    } catch (error) { return mapError(error); }
  }

  #requireNoQuery(url: URL): void {
    if ([...url.searchParams].length) throw new MarketDataApiErrorV1('invalid_query');
  }
}
