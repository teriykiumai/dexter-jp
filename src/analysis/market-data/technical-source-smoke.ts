import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { canonicalJsonV1, sha256CanonicalJsonV1, type CanonicalJsonValue,
  type SnapshotDigest } from '../snapshot/canonical-json.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { parseStrictJsonBytesV1 } from '../strategy-validation/strict-json.js';
import { parseAsOfCutoff, type AsOfCutoff } from '../strategy-validation/date.js';
import { resolveJQuantsRequestsPerMinuteV1 } from '../strategy-validation/jquants-execution.js';
import { toJQuantsSecuritiesCode } from '../../utils/japanese-securities-code.js';
import {
  JQUANTS_CURRENT_MASTER_MAPPING_VERSION_V1,
  JQUANTS_TECHNICAL_CALENDAR_MAPPING_VERSION_V1,
  JQUANTS_TECHNICAL_DAILY_BARS_MAPPING_VERSION_V1,
  TECHNICAL_SOURCE_CONTRACT_VERSION_V1,
  TECHNICAL_CALENDAR_BOUNDARY_POLICY_V2,
  TECHNICAL_SOURCE_ENDPOINTS_V1,
  TECHNICAL_SOURCE_REGISTRY_V1,
  TECHNICAL_SOURCE_REVISIONS_V1,
  TechnicalSourceGateErrorV1,
  createTechnicalSourceRequestWindowV1,
  digestTechnicalSourceRowsV1,
  mapTechnicalCalendarV1,
  mapTechnicalDailyBarsV1,
  resolveTechnicalEligibleThroughV1,
  validateCurrentTechnicalMasterV1,
} from './technical-source-gate.js';

export const TECHNICAL_SOURCE_SMOKE_LIMITS_V1 = Object.freeze({
  logicalQueries: 3,
  attempts: 20,
  pages: 20,
  rows: 8_000,
  responseBytes: 32 * 1024 * 1024,
  requestTimeoutMs: 30_000,
  deadlineMs: 180_000,
  retries: 0,
} as const);

export type TechnicalSourceSmokeErrorCodeV1 =
  | 'invalid_configuration'
  | 'cancelled'
  | 'execution_timeout'
  | 'attempt_limit_exceeded'
  | 'page_limit_exceeded'
  | 'source_response_too_large'
  | 'source_plan_unavailable'
  | 'network_error'
  | 'http_error'
  | 'source_response_invalid'
  | 'calendar_incomplete'
  | 'source_not_yet_updated'
  | 'source_no_observation'
  | 'instrument_identity_unverified';

export type TechnicalSourcePlanRestrictionBoundaryV1 =
  | 'request_from_before_coverage'
  | 'request_to_after_coverage'
  | 'request_outside_coverage'
  | 'not_determined';

export class TechnicalSourceSmokeErrorV1 extends Error {
  constructor(
    readonly code: TechnicalSourceSmokeErrorCodeV1,
    readonly status?: number,
    readonly endpoint?: Endpoint,
    readonly restrictionBoundary?: TechnicalSourcePlanRestrictionBoundaryV1,
  ) {
    super(`Technical source smoke failed: ${code}.`);
    this.name = 'TechnicalSourceSmokeErrorV1';
  }
}

function fail(
  code: TechnicalSourceSmokeErrorCodeV1,
  status?: number,
  endpoint?: Endpoint,
  restrictionBoundary?: TechnicalSourcePlanRestrictionBoundaryV1,
): never {
  throw new TechnicalSourceSmokeErrorV1(code, status, endpoint, restrictionBoundary);
}

export type TechnicalSourceSmokeEnvironmentV1 = Readonly<{
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  wallNowMs: () => number;
  monotonicNowMs: () => number;
  sleep: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  apiKey: () => string | undefined;
  processEnvironment: NodeJS.ProcessEnv;
}>;

const defaultSleep = (durationMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, durationMs);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });

export const DEFAULT_TECHNICAL_SOURCE_SMOKE_ENVIRONMENT_V1: TechnicalSourceSmokeEnvironmentV1 = Object.freeze({
  fetch: (input, init) => fetch(input, init),
  wallNowMs: () => Date.now(),
  monotonicNowMs: () => performance.now(),
  sleep: defaultSleep,
  apiKey: () => process.env.JQUANTS_API_KEY,
  processEnvironment: process.env,
});

type Endpoint = (typeof TECHNICAL_SOURCE_ENDPOINTS_V1)[keyof typeof TECHNICAL_SOURCE_ENDPOINTS_V1];
type Query = Readonly<Record<string, string>>;

export type TechnicalSourceFetchMetricsV1 = Readonly<{
  endpoint: Endpoint;
  pageCount: number;
  rowCount: number;
  responseBytes: number;
}>;

export type TechnicalSourceFetchResultV1 = Readonly<{
  rows: readonly unknown[];
  metrics: TechnicalSourceFetchMetricsV1;
}>;

function expectedQueryNames(endpoint: Endpoint): readonly string[] {
  const contract = TECHNICAL_SOURCE_REGISTRY_V1.find(item => item.endpoint === endpoint);
  if (contract === undefined) return fail('invalid_configuration');
  return contract.queryFields;
}

function normalizeQuery(endpoint: Endpoint, query: Query): Query {
  const entries = Object.entries(query).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([name, value]) => !/^[a-z][a-z_]*$/.test(name)
    || typeof value !== 'string' || value.length === 0)
    || entries.map(([name]) => name).join('\0') !== [...expectedQueryNames(endpoint)].sort().join('\0')) {
    return fail('invalid_configuration');
  }
  return Object.freeze(Object.fromEntries(entries));
}

function responseObject(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('source_response_invalid');
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  const expected = record.pagination_key === undefined ? ['data'] : ['data', 'pagination_key'];
  if (keys.join('\0') !== expected.join('\0') || !Array.isArray(record.data)) return fail('source_response_invalid');
  if (record.pagination_key !== undefined
    && (typeof record.pagination_key !== 'string' || record.pagination_key.length === 0
      || record.pagination_key.length > 2_048 || /[\u0000-\u001f\u007f-\u009f]/u.test(record.pagination_key))) {
    return fail('source_response_invalid');
  }
  return record;
}

async function readBoundedResponse(response: Response, remainingBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > remainingBytes)) {
    return fail('source_response_too_large');
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > remainingBytes) {
        await reader.cancel();
        return fail('source_response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function classifyPlanRestrictionResponse(
  status: number,
  bytes: Uint8Array,
  query: Query,
): TechnicalSourcePlanRestrictionBoundaryV1 | null {
  if (status !== 400 && status !== 403) return null;
  let body: unknown;
  try { body = parseStrictJsonBytesV1(bytes, TECHNICAL_SOURCE_SMOKE_LIMITS_V1.responseBytes); }
  catch { return status === 403 ? 'not_determined' : null; }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return status === 403 ? 'not_determined' : null;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const detail = record.message ?? record.error;
  if (typeof detail !== 'string') return status === 403 ? 'not_determined' : null;
  if (!/not available on your subscription|subscription covers the following dates/i.test(detail)) {
    return status === 403 ? 'not_determined' : null;
  }
  const coverage = detail.match(/subscription covers the following dates:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})?/i);
  if (coverage === null) return 'not_determined';
  const requestFrom = query.from ?? query.date;
  const requestTo = query.to ?? query.date;
  const before = requestFrom !== undefined && requestFrom < coverage[1]!;
  const after = requestTo !== undefined && coverage[2] !== undefined && requestTo > coverage[2];
  if (before && after) return 'request_outside_coverage';
  if (before) return 'request_from_before_coverage';
  if (after) return 'request_to_after_coverage';
  return 'not_determined';
}

export class TechnicalSourceSmokeClientV1 {
  readonly acceptedAt!: AsOfCutoff;
  readonly #environment: TechnicalSourceSmokeEnvironmentV1;
  readonly #requestsPerMinute: number;
  readonly #apiKey: string;
  readonly #startedMonotonicMs: number;
  readonly #attemptTimes: number[] = [];
  readonly #metrics: TechnicalSourceFetchMetricsV1[] = [];
  #attempts = 0;
  #pages = 0;
  #rows = 0;
  #bytes = 0;

  constructor(options: Readonly<{
    environment?: TechnicalSourceSmokeEnvironmentV1;
    requestsPerMinute?: number;
  }> = {}) {
    this.#environment = options.environment ?? DEFAULT_TECHNICAL_SOURCE_SMOKE_ENVIRONMENT_V1;
    this.#requestsPerMinute = options.requestsPerMinute
      ?? resolveJQuantsRequestsPerMinuteV1(this.#environment.processEnvironment.JQUANTS_REQUESTS_PER_MINUTE);
    if (!Number.isSafeInteger(this.#requestsPerMinute) || this.#requestsPerMinute < 1 || this.#requestsPerMinute > 500) {
      fail('invalid_configuration');
    }
    const apiKey = this.#environment.apiKey();
    if (typeof apiKey !== 'string' || apiKey.length === 0 || /[\r\n]/.test(apiKey)) fail('invalid_configuration');
    this.#apiKey = apiKey;
    const wall = this.#environment.wallNowMs();
    this.#startedMonotonicMs = this.#environment.monotonicNowMs();
    if (!Number.isFinite(wall) || !Number.isFinite(this.#startedMonotonicMs)) fail('invalid_configuration');
    let acceptedAt: AsOfCutoff;
    try { acceptedAt = parseAsOfCutoff(new Date(wall).toISOString()); }
    catch { return fail('invalid_configuration'); }
    this.acceptedAt = acceptedAt;
  }

  get attempts(): number { return this.#attempts; }
  get pages(): number { return this.#pages; }
  get rows(): number { return this.#rows; }
  get responseBytes(): number { return this.#bytes; }
  get metrics(): readonly TechnicalSourceFetchMetricsV1[] {
    return Object.freeze(this.#metrics.map(item => Object.freeze({ ...item })));
  }
  get processEnvironment(): NodeJS.ProcessEnv { return this.#environment.processEnvironment; }

  now(): AsOfCutoff {
    const value = this.#environment.wallNowMs();
    if (!Number.isFinite(value) || value < Date.parse(this.acceptedAt)) return fail('invalid_configuration');
    try { return parseAsOfCutoff(new Date(value).toISOString()); }
    catch { return fail('invalid_configuration'); }
  }

  #remainingMs(): number {
    const elapsed = this.#environment.monotonicNowMs() - this.#startedMonotonicMs;
    if (!Number.isFinite(elapsed) || elapsed < 0) return fail('invalid_configuration');
    return TECHNICAL_SOURCE_SMOKE_LIMITS_V1.deadlineMs - elapsed;
  }

  #assertCanContinue(signal?: AbortSignal): void {
    if (signal?.aborted) return fail('cancelled');
    if (this.#remainingMs() <= 0) return fail('execution_timeout');
  }

  async #reserveAttempt(signal?: AbortSignal): Promise<void> {
    this.#assertCanContinue(signal);
    if (this.#attempts >= TECHNICAL_SOURCE_SMOKE_LIMITS_V1.attempts) return fail('attempt_limit_exceeded');
    while (true) {
      const now = this.#environment.monotonicNowMs();
      const retained = this.#attemptTimes.filter(value => now - value < 60_000);
      this.#attemptTimes.splice(0, this.#attemptTimes.length, ...retained);
      if (retained.some(value => value > now)) return fail('invalid_configuration');
      if (retained.length < this.#requestsPerMinute) break;
      const waitMs = 60_000 - (now - retained[0]!);
      if (waitMs >= this.#remainingMs()) return fail('execution_timeout');
      try { await this.#environment.sleep(waitMs, signal); }
      catch { return fail(signal?.aborted ? 'cancelled' : 'invalid_configuration'); }
      this.#assertCanContinue(signal);
    }
    this.#attemptTimes.push(this.#environment.monotonicNowMs());
    this.#attempts += 1;
  }

  async #request(endpoint: Endpoint, query: Query, signal?: AbortSignal): Promise<Uint8Array> {
    await this.#reserveAttempt(signal);
    const remaining = this.#remainingMs();
    const timeoutMs = Math.min(TECHNICAL_SOURCE_SMOKE_LIMITS_V1.requestTimeoutMs, remaining);
    if (timeoutMs <= 0) return fail('execution_timeout');
    const url = new URL(`https://api.jquants.com${endpoint}`);
    Object.entries(query).sort(([left], [right]) => left.localeCompare(right))
      .forEach(([name, value]) => url.searchParams.set(name, value));
    const requestController = new AbortController();
    const timeoutController = new AbortController();
    let timedOut = false;
    const onCancel = (): void => requestController.abort();
    signal?.addEventListener('abort', onCancel, { once: true });
    const timeoutPromise = this.#environment.sleep(timeoutMs, timeoutController.signal).then(() => {
      timedOut = true;
      requestController.abort();
      return fail('execution_timeout');
    });
    try {
      const fetchPromise = this.#environment.fetch(url, {
        method: 'GET', headers: { 'x-api-key': this.#apiKey }, signal: requestController.signal,
      }).then(async response => {
        const body = await readBoundedResponse(response, TECHNICAL_SOURCE_SMOKE_LIMITS_V1.responseBytes - this.#bytes);
        if (!response.ok) {
          const restrictionBoundary = classifyPlanRestrictionResponse(response.status, body, query);
          if (response.status === 401 || restrictionBoundary !== null) {
            return fail('source_plan_unavailable', response.status, endpoint,
              restrictionBoundary ?? 'not_determined');
          }
          return fail('http_error', response.status, endpoint);
        }
        return body;
      }).catch(error => {
        if (error instanceof TechnicalSourceSmokeErrorV1) throw error;
        if (signal?.aborted) return fail('cancelled');
        if (timedOut) return fail('execution_timeout');
        return fail('network_error');
      });
      return await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      timeoutController.abort();
      signal?.removeEventListener('abort', onCancel);
    }
  }

  async getAll(endpoint: Endpoint, rawQuery: Query, signal?: AbortSignal): Promise<TechnicalSourceFetchResultV1> {
    if (!Object.values(TECHNICAL_SOURCE_ENDPOINTS_V1).includes(endpoint)) return fail('invalid_configuration');
    const query = normalizeQuery(endpoint, rawQuery);
    const rows: unknown[] = [];
    const cursors = new Set<string>();
    let pageCount = 0;
    let responseBytes = 0;
    let paginationKey: string | undefined;
    do {
      this.#assertCanContinue(signal);
      if (this.#pages >= TECHNICAL_SOURCE_SMOKE_LIMITS_V1.pages) return fail('page_limit_exceeded');
      const pageQuery = paginationKey === undefined ? query : Object.freeze({ ...query, pagination_key: paginationKey });
      const bytes = await this.#request(endpoint, pageQuery, signal);
      this.#bytes += bytes.byteLength;
      responseBytes += bytes.byteLength;
      this.#pages += 1;
      pageCount += 1;
      let parsed: unknown;
      try { parsed = parseStrictJsonBytesV1(bytes, TECHNICAL_SOURCE_SMOKE_LIMITS_V1.responseBytes); }
      catch { return fail('source_response_invalid'); }
      const body = responseObject(parsed);
      const data = body.data as readonly unknown[];
      if (this.#rows + data.length > TECHNICAL_SOURCE_SMOKE_LIMITS_V1.rows) return fail('source_response_too_large');
      this.#rows += data.length;
      rows.push(...data);
      paginationKey = body.pagination_key as string | undefined;
      if (paginationKey !== undefined) {
        if (cursors.has(paginationKey)) return fail('source_response_invalid');
        cursors.add(paginationKey);
      }
    } while (paginationKey !== undefined);
    const metrics = Object.freeze({ endpoint, pageCount, rowCount: rows.length, responseBytes });
    this.#metrics.push(metrics);
    return Object.freeze({ rows: Object.freeze(rows), metrics });
  }
}

export type TechnicalSourceSmokeArgsV1 = Readonly<{
  ticker: string;
  confirmedExternalFetch: boolean;
}>;

function usageError(): never { return fail('invalid_configuration'); }

export function parseTechnicalSourceSmokeArgsV1(args: readonly string[]): TechnicalSourceSmokeArgsV1 {
  let ticker: string | undefined;
  let confirmedExternalFetch = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-external-fetch') {
      if (confirmedExternalFetch) usageError();
      confirmedExternalFetch = true;
      continue;
    }
    if (arg !== '--ticker' || ticker !== undefined) usageError();
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) usageError();
    const parsed = CanonicalTickerSchema.safeParse(value);
    if (!parsed.success) usageError();
    ticker = parsed.data;
    index += 1;
  }
  if (ticker === undefined) usageError();
  return Object.freeze({ ticker, confirmedExternalFetch });
}

export type TechnicalSourceGateEvidenceV1 = Readonly<{
  schemaVersion: 'technical_source_gate_evidence_v1';
  result: 'passed';
  sourceContractVersion: typeof TECHNICAL_SOURCE_CONTRACT_VERSION_V1;
  calendarBoundaryPolicy: typeof TECHNICAL_CALENDAR_BOUNDARY_POLICY_V2;
  checkedAt: AsOfCutoff;
  acceptedAt: AsOfCutoff;
  entitlementClass: 'configured_standard_or_higher';
  ticker: string;
  jquantsCode: string;
  calculationDate: string;
  queryFrom: string;
  queryTo: string;
  calendarCoverageFrom: string;
  calendarCoverageTo: string;
  currentMaster: Readonly<{ Date: string; Code: string; CoName: string; Mkt: string; ProdCat: string }>;
  historyBoundary: Readonly<{
    contractVersion: 'current_code_history_v1';
    mode: 'current_code_only';
    sourceCoverageFrom: string;
    sourceCoverageThrough: string;
    historicalIdentity: 'not_verified';
  }>;
  historyCoverageClipped: boolean;
  limits: typeof TECHNICAL_SOURCE_SMOKE_LIMITS_V1;
  totals: Readonly<{ attempts: number; pages: number; rows: number; responseBytes: number }>;
  sources: readonly Readonly<{
    role: 'trading_calendar' | 'security_master' | 'daily_bars';
    endpoint: Endpoint;
    sourceMappingVersion: string;
    sourceRevisionIds: readonly string[];
    normalizedQueryIdentity: SnapshotDigest;
    observationDigest: SnapshotDigest;
    pageCount: number;
    rowCount: number;
    responseBytes: number;
  }>[];
  checks: Readonly<{
    exactEndpointQueryFieldContract: true;
    standardMaximumTenYearRange: true;
    paginationCompleteWithinBounds: true;
    currentMasterExpectation: true;
    currentCodeOnlyBoundary: true;
    completePostStartSessions: true;
    noFutureRows: true;
    adjustedNotTotalReturn: true;
  }>;
}>;

function queryDigest(endpoint: Endpoint, query: Query): SnapshotDigest {
  return sha256CanonicalJsonV1({ endpoint, query: Object.entries(query).sort(([a], [b]) => a.localeCompare(b)) } as CanonicalJsonValue);
}

function fromSourceGate<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof TechnicalSourceGateErrorV1) return fail(error.code);
    throw error;
  }
}

export async function proveTechnicalSourceGateV1(
  client: TechnicalSourceSmokeClientV1,
  ticker: string,
  signal?: AbortSignal,
): Promise<TechnicalSourceGateEvidenceV1> {
  const parsedTicker = CanonicalTickerSchema.safeParse(ticker);
  if (!parsedTicker.success || client.metrics.length !== 0) return fail('invalid_configuration');
  const window = createTechnicalSourceRequestWindowV1(client.acceptedAt);
  const jquantsCode = toJQuantsSecuritiesCode(parsedTicker.data);
  const calendarQuery = Object.freeze({ from: window.calendarCoverageFrom, to: window.calendarCoverageTo });
  const calendarFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar, calendarQuery, signal);
  const mappedCalendar = fromSourceGate(() => mapTechnicalCalendarV1(
    calendarFetch.rows, window.calendarCoverageFrom, window.calendarCoverageTo,
  ));
  const eligibleThrough = fromSourceGate(() => resolveTechnicalEligibleThroughV1(window, mappedCalendar.calendar));
  const masterQuery = Object.freeze({ code: jquantsCode, date: eligibleThrough });
  const masterFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster, masterQuery, signal);
  const master = fromSourceGate(() => validateCurrentTechnicalMasterV1(masterFetch.rows, {
    ticker: parsedTicker.data, eligibleThrough, environment: client.processEnvironment,
  }));
  if (master.state === 'rejected') return fail('instrument_identity_unverified');
  const barsQuery = Object.freeze({ code: jquantsCode, from: window.queryFrom, to: eligibleThrough });
  const barsFetch = await client.getAll(TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars, barsQuery, signal);
  const bars = fromSourceGate(() => mapTechnicalDailyBarsV1(barsFetch.rows, {
      ticker: parsedTicker.data, queryFrom: window.queryFrom, eligibleThrough,
      calendar: mappedCalendar.calendar,
    }));
  if ([...client.metrics].length !== TECHNICAL_SOURCE_SMOKE_LIMITS_V1.logicalQueries) {
    return fail('invalid_configuration');
  }
  const source = (role: 'trading_calendar' | 'security_master' | 'daily_bars',
    endpoint: Endpoint, mapping: string, revisions: readonly { id: string }[], query: Query,
    rows: CanonicalJsonValue, metrics: TechnicalSourceFetchMetricsV1) => Object.freeze({
      role, endpoint, sourceMappingVersion: mapping,
      sourceRevisionIds: Object.freeze(revisions.map(item => item.id)),
      normalizedQueryIdentity: queryDigest(endpoint, query),
      observationDigest: digestTechnicalSourceRowsV1(rows, client.processEnvironment),
      pageCount: metrics.pageCount, rowCount: metrics.rowCount, responseBytes: metrics.responseBytes,
    });
  const sources = Object.freeze([
    source('daily_bars', TECHNICAL_SOURCE_ENDPOINTS_V1.dailyBars,
      JQUANTS_TECHNICAL_DAILY_BARS_MAPPING_VERSION_V1, TECHNICAL_SOURCE_REVISIONS_V1.bars,
      barsQuery, bars.rows as CanonicalJsonValue, barsFetch.metrics),
    source('security_master', TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster,
      JQUANTS_CURRENT_MASTER_MAPPING_VERSION_V1, TECHNICAL_SOURCE_REVISIONS_V1.master,
      masterQuery, [master.observation] as CanonicalJsonValue, masterFetch.metrics),
    source('trading_calendar', TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar,
      JQUANTS_TECHNICAL_CALENDAR_MAPPING_VERSION_V1, TECHNICAL_SOURCE_REVISIONS_V1.calendar,
      calendarQuery, mappedCalendar.rows as CanonicalJsonValue, calendarFetch.metrics),
  ]);
  const evidence: TechnicalSourceGateEvidenceV1 = Object.freeze({
    schemaVersion: 'technical_source_gate_evidence_v1',
    result: 'passed',
    sourceContractVersion: TECHNICAL_SOURCE_CONTRACT_VERSION_V1,
    calendarBoundaryPolicy: TECHNICAL_CALENDAR_BOUNDARY_POLICY_V2,
    checkedAt: client.now(),
    acceptedAt: client.acceptedAt,
    entitlementClass: 'configured_standard_or_higher',
    ticker: parsedTicker.data,
    jquantsCode,
    calculationDate: window.calculationDate,
    queryFrom: window.queryFrom,
    queryTo: eligibleThrough,
    calendarCoverageFrom: window.calendarCoverageFrom,
    calendarCoverageTo: window.calendarCoverageTo,
    currentMaster: master.observation,
    historyBoundary: Object.freeze({
      contractVersion: bars.historyBoundary.contractVersion,
      mode: bars.historyBoundary.mode,
      sourceCoverageFrom: bars.historyBoundary.sourceCoverageFrom,
      sourceCoverageThrough: bars.historyBoundary.sourceCoverageThrough,
      historicalIdentity: bars.historyBoundary.historicalIdentity,
    }),
    historyCoverageClipped: bars.historyCoverageClipped,
    limits: TECHNICAL_SOURCE_SMOKE_LIMITS_V1,
    totals: Object.freeze({ attempts: client.attempts, pages: client.pages,
      rows: client.rows, responseBytes: client.responseBytes }),
    sources,
    checks: Object.freeze({
      exactEndpointQueryFieldContract: true,
      standardMaximumTenYearRange: true,
      paginationCompleteWithinBounds: true,
      currentMasterExpectation: true,
      currentCodeOnlyBoundary: true,
      completePostStartSessions: true,
      noFutureRows: true,
      adjustedNotTotalReturn: true,
    }),
  });
  // Final safety pass also rejects an accidental absolute path or configured secret.
  digestTechnicalSourceRowsV1(evidence as CanonicalJsonValue, client.processEnvironment);
  return evidence;
}

async function interactiveConfirmation(warning: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${warning}\nContinue? [y/N] `);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally { prompt.close(); }
}

async function main(): Promise<void> {
  const args = parseTechnicalSourceSmokeArgsV1(process.argv.slice(2));
  const warning = [
    'DR-T0 J-Quants Technical source smoke (no artifact, receipt, or job output)',
    `target: ${args.ticker}; maximum ten-year adjusted daily bars`,
    `limits: ${TECHNICAL_SOURCE_SMOKE_LIMITS_V1.attempts} attempts, ${TECHNICAL_SOURCE_SMOKE_LIMITS_V1.rows} rows, ${TECHNICAL_SOURCE_SMOKE_LIMITS_V1.responseBytes} bytes, ${TECHNICAL_SOURCE_SMOKE_LIMITS_V1.deadlineMs} ms`,
    'This sends ticker/date selectors to the configured J-Quants account and consumes subscription quota.',
    'No credential, header, cursor, request ID, raw response body, or absolute path is printed.',
  ].join('\n');
  const confirmed = args.confirmedExternalFetch || await interactiveConfirmation(warning);
  if (!confirmed) return fail('cancelled');
  if (args.confirmedExternalFetch) stdout.write(`${warning}\n`);
  const client = new TechnicalSourceSmokeClientV1();
  const evidence = await proveTechnicalSourceGateV1(client, args.ticker);
  stdout.write(`${canonicalJsonV1(evidence as CanonicalJsonValue)}\n`);
}

if (import.meta.main) {
  main().catch(error => {
    const failure = error instanceof TechnicalSourceSmokeErrorV1
      ? { state: 'unavailable', code: error.code, ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.endpoint === undefined ? {} : { endpoint: error.endpoint }),
        ...(error.restrictionBoundary === undefined ? {} : { restrictionBoundary: error.restrictionBoundary }) }
      : { state: 'unavailable', code: 'internal_error' };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  });
}
