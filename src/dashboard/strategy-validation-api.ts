import { DashboardSessionV1, DashboardSecurityErrorV1, dashboardSecurityFailureV1,
  readDashboardBody as readBody, requireDashboardJsonMediaType as requireJsonMediaType } from './session.js';
import { DashboardJobCoordinatorErrorV1, dashboardCoordinatorFailureV1 } from '../analysis/dashboard-jobs/coordinator.js';
import { validateStrategyValidationInputV1 } from '../analysis/strategy-validation/manifest.js';
import { z } from 'zod';
import {
  AnalysisSnapshotPersistenceError,
  CanonicalTickerSchema,
} from '../analysis/snapshot/index.js';
import {
  compareStrategyValidationCasesV1,
  JQuantsValidationErrorV1,
  parseStrictJsonBytesV1,
  StrictJsonErrorV1,
  StrategyValidationJobServiceErrorV1,
  StrategyValidationJobServiceV1,
  StrategyValidationManifestErrorV1,
  StrategyValidationRunRepositoryErrorV1,
  StrategyValidationUuidV4Schema,
  type LoadedStrategyValidationRunV1,
  type StrategyValidationCaseV1,
} from '../analysis/strategy-validation/index.js';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../analysis/snapshot/canonical-json.js';

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;
const PREFLIGHT_BODY_LIMIT = 1_100_000;
const JOB_BODY_LIMIT = 4_096;
const CURSOR_MAX_BYTES = 1_024;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

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

function methodNotAllowed(allow: string): Response {
  return errorResponse(405, 'method_not_allowed', 'The request method is not supported.', {
    Allow: allow,
  });
}

class StrategyValidationApiErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
  }
}

function invalidQuery(code = 'invalid_query'): never {
  throw new StrategyValidationApiErrorV1(400, code, 'The request query is invalid.');
}

function requireOnlyQueryParameters(url: URL, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!allowedSet.has(key) || url.searchParams.getAll(key).length !== 1) invalidQuery();
  }
}

function canonicalTickerParameter(url: URL, required: boolean): string | null {
  const values = url.searchParams.getAll('ticker');
  if (values.length === 0 && !required) return null;
  if (values.length !== 1) return invalidQuery();
  const parsed = CanonicalTickerSchema.safeParse(values[0]);
  if (!parsed.success) return invalidQuery();
  return parsed.data;
}

function canonicalLimit(url: URL): number {
  const values = url.searchParams.getAll('limit');
  if (values.length === 0) return LIST_DEFAULT_LIMIT;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]!)) return invalidQuery();
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value > LIST_MAX_LIMIT) return invalidQuery();
  return value;
}

type RunCursorV1 = Readonly<{
  version: 'strategy_validation_cursor_v1';
  routeKind: 'runs';
  filterDigest: string;
  completedAt: string;
  runId: string;
}>;

type CaseCursorV1 = Readonly<{
  version: 'strategy_validation_cursor_v1';
  routeKind: 'cases';
  filterDigest: string;
  ticker: string;
  anchorDate: string;
  caseKind: 'anchor_unavailable' | 'candidate';
  candidateId: string | null;
}>;

const cursorBase = {
  version: z.literal('strategy_validation_cursor_v1'),
  filterDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
};
const RunCursorSchema = z.object({
  ...cursorBase,
  routeKind: z.literal('runs'),
  completedAt: z.string(),
  runId: StrategyValidationUuidV4Schema,
}).strict();
const CaseCursorSchema = z.object({
  ...cursorBase,
  routeKind: z.literal('cases'),
  ticker: CanonicalTickerSchema,
  anchorDate: z.string(),
  caseKind: z.enum(['anchor_unavailable', 'candidate']),
  candidateId: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.caseKind === 'anchor_unavailable') !== (value.candidateId === null)) {
    context.addIssue({ code: 'custom', message: 'Cursor case identity is invalid.' });
  }
});

function encodeCursor(value: RunCursorV1 | CaseCursorV1): string {
  return Buffer.from(canonicalJsonV1(value as CanonicalJsonValue), 'utf8').toString('base64url');
}

function decodeCursor<T>(
  url: URL,
  schema: z.ZodType<T>,
  expectedFilterDigest: string,
): T | null {
  const values = url.searchParams.getAll('cursor');
  if (values.length === 0) return null;
  const encoded = values[0]!;
  if (values.length !== 1 || encoded.length === 0 || encoded.length > CURSOR_MAX_BYTES
    || !/^[A-Za-z0-9_-]+$/.test(encoded)) return invalidQuery('invalid_cursor');
  let bytes: Uint8Array;
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) return invalidQuery('invalid_cursor');
    bytes = decoded;
  } catch {
    return invalidQuery('invalid_cursor');
  }
  let raw: unknown;
  try {
    raw = parseStrictJsonBytesV1(bytes, CURSOR_MAX_BYTES);
  } catch {
    return invalidQuery('invalid_cursor');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || (parsed.data as { filterDigest: string }).filterDigest !== expectedFilterDigest
    || canonicalJsonV1(parsed.data as CanonicalJsonValue)
      !== new TextDecoder().decode(bytes)) return invalidQuery('invalid_cursor');
  return parsed.data;
}

function filterDigest(routeKind: 'runs' | 'cases', ticker: string | null, runId?: string): string {
  return sha256CanonicalJsonV1({
    version: 'strategy_validation_filter_v1',
    routeKind,
    ticker,
    runId: runId ?? null,
  });
}

function runSummary(loaded: LoadedStrategyValidationRunV1) {
  const run = loaded.run;
  return Object.freeze({
    schemaVersion: 'strategy_validation_run_summary_v1' as const,
    runId: run.runId,
    mode: run.mode,
    confidence: run.confidence,
    campaignName: run.campaignName,
    completedAt: run.completedAt,
    outcomeAsOfSession: run.outcomeAsOfSession,
    aggregationScope: run.aggregationScope,
    caseCount: run.caseReferences.length,
    warnings: run.warnings,
  });
}

function caseCursorValue(
  value: StrategyValidationCaseV1,
  digest: string,
): CaseCursorV1 {
  return Object.freeze({
    version: 'strategy_validation_cursor_v1',
    routeKind: 'cases',
    filterDigest: digest,
    ticker: value.ticker,
    anchorDate: value.anchorDate,
    caseKind: value.caseKind,
    candidateId: value.caseKind === 'candidate' ? value.candidateId : null,
  });
}

function sameCaseCursor(value: StrategyValidationCaseV1, cursor: CaseCursorV1): boolean {
  return value.ticker === cursor.ticker
    && value.anchorDate === cursor.anchorDate
    && value.caseKind === cursor.caseKind
    && (value.caseKind === 'candidate' ? value.candidateId : null) === cursor.candidateId;
}
function parseJsonBody(bytes: Uint8Array, maximumBytes: number): unknown {
  try {
    return parseStrictJsonBytesV1(bytes, maximumBytes);
  } catch (error) {
    if (error instanceof StrictJsonErrorV1 && error.kind === 'input_too_large') {
      throw new StrategyValidationApiErrorV1(413, 'payload_too_large', 'The request body is too large.');
    }
    throw new StrategyValidationApiErrorV1(400, 'invalid_json', 'The request JSON is invalid.');
  }
}
function mapServiceError(error: unknown): Response {
  if (error instanceof DashboardJobCoordinatorErrorV1) {
    const failure = dashboardCoordinatorFailureV1(error, 'strategy_validation');
    return errorResponse(failure.status, failure.code, failure.message,
      failure.retryAfterSeconds ? { 'Retry-After': String(failure.retryAfterSeconds) } : undefined);
  }
  if (error instanceof DashboardSecurityErrorV1) {
    const failure = dashboardSecurityFailureV1(error, 'strategy_validation');
    return errorResponse(failure.status, failure.code, failure.message);
  }
  if (error instanceof StrategyValidationApiErrorV1) {
    return errorResponse(error.status, error.code, error.publicMessage);
  }
  if (error instanceof StrategyValidationJobServiceErrorV1) {
    switch (error.kind) {
      case 'invalid_preflight_id':
        return errorResponse(400, 'invalid_request', 'The request is invalid.');
      case 'preflight_expired':
        return errorResponse(409, 'preflight_expired', 'The preflight has expired.');
      case 'preflight_consumed':
        return errorResponse(409, 'preflight_consumed', 'The preflight was already consumed.');
      case 'preflight_mismatch':
        return errorResponse(409, 'preflight_mismatch', 'The preflight no longer matches.');
      case 'active_job_conflict':
        return errorResponse(409, 'active_job_conflict', 'Another Strategy-validation job is active.');
      case 'job_not_found':
        return errorResponse(404, 'job_not_found', 'The Strategy-validation job was not found.');
      case 'invalid_job_transition':
        return errorResponse(409, 'invalid_job_transition', 'The job cannot make that transition.');
      case 'artifact_unavailable':
        return errorResponse(500, 'artifact_unavailable', 'The Strategy-validation artifact is unavailable.');
      case 'internal_failure':
        return errorResponse(500, 'internal_failure', 'The request could not be completed.');
    }
  }
  if (error instanceof StrategyValidationRunRepositoryErrorV1) {
    switch (error.kind) {
      case 'unsafe_run_id':
      case 'unsafe_case_id':
        return errorResponse(400, 'invalid_route_parameter', 'A route parameter is invalid.');
      case 'missing_run':
        return errorResponse(404, 'run_not_found', 'The Strategy-validation run was not found.');
      case 'missing_case':
        return errorResponse(404, 'case_not_found', 'The Strategy-validation case was not found.');
      default:
        return errorResponse(500, 'artifact_unavailable', 'The Strategy-validation artifact is unavailable.');
    }
  }
  if (error instanceof AnalysisSnapshotPersistenceError) {
    return error.kind === 'missing_snapshot'
      ? errorResponse(404, 'snapshot_not_found', 'The requested analysis snapshot was not found.')
      : errorResponse(500, 'artifact_unavailable', 'The Strategy-validation artifact is unavailable.');
  }
  if (error instanceof StrategyValidationManifestErrorV1) {
    return errorResponse(400, 'invalid_request', 'The request is invalid.');
  }
  if (error instanceof JQuantsValidationErrorV1
    && error.code === 'external_schedule_infeasible') {
    return errorResponse(
      400,
      'external_schedule_infeasible',
      'The minimum external-request schedule cannot finish within the fixed limits.',
    );
  }
  return errorResponse(500, 'internal_failure', 'The request could not be completed.');
}

export class StrategyValidationDashboardApiV1 {
  readonly session: DashboardSessionV1;
  get csrfToken(): string { return this.session.csrfToken; }

  constructor(
    readonly service: StrategyValidationJobServiceV1,
    session: DashboardSessionV1 | string = new DashboardSessionV1(),
  ) {
    this.session = typeof session === 'string' ? new DashboardSessionV1(session) : session;
    void service.initialize().catch(() => undefined);
  }

  async handle(
    request: Request,
    url: URL,
    segments: readonly string[],
  ): Promise<Response | null> {
    const isSession = segments.length === 2
      && segments[0] === 'api' && segments[1] === 'session';
    const isStrategy = segments.length >= 2
      && segments[0] === 'api' && segments[1] === 'strategy-validation';
    if (!isSession && !isStrategy) return null;

    try {
      if (isSession) {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireOnlyQueryParameters(url, []);
        return jsonResponse(this.session.view());
      }

      if (segments.length === 3 && segments[2] === 'preflights') {
        if (request.method !== 'POST') return methodNotAllowed('POST');
        this.#requireMutationSecurity(request, url);
        requireOnlyQueryParameters(url, []);
        requireJsonMediaType(request);
        const body = parseJsonBody(await readBody(request, PREFLIGHT_BODY_LIMIT), PREFLIGHT_BODY_LIMIT);
        validateStrategyValidationInputV1(body);
        this.service.coordinator.assertHealthy();
        return jsonResponse(await this.service.createPreflight(body));
      }

      if (segments.length === 3 && segments[2] === 'jobs') {
        if (request.method !== 'POST') return methodNotAllowed('POST');
        this.#requireMutationSecurity(request, url);
        requireOnlyQueryParameters(url, []);
        requireJsonMediaType(request);
        const body = parseJsonBody(await readBody(request, JOB_BODY_LIMIT), JOB_BODY_LIMIT);
        const parsed = z.object({
          preflightId: StrategyValidationUuidV4Schema,
          confirmExternalFetch: z.literal(true),
        }).strict().safeParse(body);
        if (!parsed.success) {
          throw new StrategyValidationApiErrorV1(400, 'invalid_request', 'The request is invalid.');
        }
        this.service.coordinator.assertHealthy();
        return jsonResponse(
          await this.service.acceptPreflight(parsed.data.preflightId, true),
          202,
        );
      }

      if (segments.length === 4 && segments[2] === 'jobs' && segments[3] === 'active') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireOnlyQueryParameters(url, []);
        this.service.coordinator.assertHealthy();
        return jsonResponse({
          schemaVersion: 'strategy_validation_active_job_v1',
          job: await this.service.activeJob(),
        });
      }

      if (segments.length === 4 && segments[2] === 'jobs') {
        if (!StrategyValidationUuidV4Schema.safeParse(segments[3]).success) {
          throw new StrategyValidationApiErrorV1(
            400, 'invalid_route_parameter', 'A route parameter is invalid.',
          );
        }
        requireOnlyQueryParameters(url, []);
        if (request.method === 'GET') return jsonResponse(await this.service.getJob(segments[3]!));
        if (request.method === 'DELETE') {
          this.#requireMutationSecurity(request, url);
          const body = await readBody(request, 0).catch(error => {
            if (error instanceof DashboardSecurityErrorV1 && error.reason === 'payload_too_large') {
              throw new StrategyValidationApiErrorV1(400, 'invalid_request', 'The request is invalid.');
            }
            throw error;
          });
          if (body.byteLength !== 0) {
            throw new StrategyValidationApiErrorV1(400, 'invalid_request', 'The request is invalid.');
          }
          this.service.coordinator.assertHealthy();
          const result = await this.service.cancelJob(segments[3]!);
          return jsonResponse(result.job, result.status);
        }
        return methodNotAllowed('GET, DELETE');
      }

      if (segments.length === 3 && segments[2] === 'runs') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        return await this.#listRuns(url);
      }

      if (segments.length === 4 && segments[2] === 'runs') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireOnlyQueryParameters(url, []);
        this.#requireUuid(segments[3]);
        const loaded = await this.service.loadRun(segments[3]!);
        return jsonResponse(loaded.run);
      }

      if (segments.length === 5 && segments[2] === 'runs' && segments[4] === 'cases') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        this.#requireUuid(segments[3]);
        return await this.#listCases(url, segments[3]!);
      }

      if (segments.length === 6 && segments[2] === 'runs' && segments[4] === 'cases') {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireOnlyQueryParameters(url, []);
        this.#requireUuid(segments[3]);
        this.#requireUuid(segments[5]);
        return jsonResponse(await this.service.loadCase(segments[3]!, segments[5]!));
      }

      return errorResponse(400, 'invalid_route_parameter', 'A route parameter is invalid.');
    } catch (error) {
      return mapServiceError(error);
    }
  }

  async #listRuns(url: URL): Promise<Response> {
    requireOnlyQueryParameters(url, ['ticker', 'cursor', 'limit']);
    const ticker = canonicalTickerParameter(url, false);
    const limit = canonicalLimit(url);
    const digest = filterDigest('runs', ticker);
    const cursor = decodeCursor(url, RunCursorSchema, digest);
    let values = [...await this.service.listRuns()]
      .filter(value => ticker === null || value.run.aggregationScope.tickers.includes(ticker));
    if (cursor !== null) {
      const index = values.findIndex(value => value.run.completedAt === cursor.completedAt
        && value.run.runId === cursor.runId);
      if (index < 0) return invalidQuery('invalid_cursor');
      values = values.slice(index + 1);
    }
    const page = values.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = values.length > page.length && last !== undefined
      ? encodeCursor(Object.freeze({
        version: 'strategy_validation_cursor_v1',
        routeKind: 'runs',
        filterDigest: digest,
        completedAt: last.run.completedAt,
        runId: last.run.runId,
      }))
      : null;
    return jsonResponse({
      schemaVersion: 'strategy_validation_list_v1',
      items: page.map(runSummary),
      nextCursor,
    });
  }

  async #listCases(url: URL, runId: string): Promise<Response> {
    requireOnlyQueryParameters(url, ['ticker', 'cursor', 'limit']);
    const ticker = canonicalTickerParameter(url, false);
    const limit = canonicalLimit(url);
    const loaded = await this.service.loadRun(runId);
    if (ticker !== null && !loaded.run.aggregationScope.tickers.includes(ticker)) {
      return invalidQuery();
    }
    const digest = filterDigest('cases', ticker, runId);
    const cursor = decodeCursor(url, CaseCursorSchema, digest);
    let values = [...loaded.cases]
      .filter(value => ticker === null || value.ticker === ticker)
      .sort(compareStrategyValidationCasesV1);
    if (cursor !== null) {
      const index = values.findIndex(value => sameCaseCursor(value, cursor));
      if (index < 0) return invalidQuery('invalid_cursor');
      values = values.slice(index + 1);
    }
    const page = values.slice(0, limit);
    const last = page.at(-1);
    return jsonResponse({
      schemaVersion: 'strategy_validation_list_v1',
      items: page,
      nextCursor: values.length > page.length && last !== undefined
        ? encodeCursor(caseCursorValue(last, digest))
        : null,
    });
  }

  #requireMutationSecurity(request: Request, url: URL): void {
    this.session.requireMutation(request, url);
  }

  #requireUuid(value: string | undefined): void {
    if (!StrategyValidationUuidV4Schema.safeParse(value).success) {
      throw new StrategyValidationApiErrorV1(
        400, 'invalid_route_parameter', 'A route parameter is invalid.',
      );
    }
  }
}
