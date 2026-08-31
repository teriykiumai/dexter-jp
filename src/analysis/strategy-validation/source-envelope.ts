import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from '../snapshot/canonical-json.js';
import { CanonicalTickerSchema } from '../snapshot/schema.js';
import { parseAsOfCutoff, parseSourceDate, type AsOfCutoff, type SourceDate } from './date.js';
import { PointInTimeErrorV1 } from './errors.js';

export const POINT_IN_TIME_SOURCE_ENVELOPE_VERSION = 1 as const;
export const POINT_IN_TIME_SOURCE_ENDPOINTS_V1 = Object.freeze([
  '/v2/markets/calendar',
  '/v2/equities/master',
  '/v2/equities/bars/daily',
] as const);
export type PointInTimeSourceEndpointV1 = (typeof POINT_IN_TIME_SOURCE_ENDPOINTS_V1)[number];

export const POINT_IN_TIME_SOURCE_UNAVAILABLE_REASONS_V1 = Object.freeze([
  'source_plan_unavailable',
  'source_history_unavailable',
  'source_response_invalid',
  'calendar_incomplete',
  'price_history_incomplete',
] as const);
export type PointInTimeSourceUnavailableReasonV1 =
  (typeof POINT_IN_TIME_SOURCE_UNAVAILABLE_REASONS_V1)[number];

export type PointInTimeQueryParameterV1 = Readonly<{
  name: string;
  value: string;
}>;

export type PointInTimeSourceRequestV1 = Readonly<{
  ticker: string | null;
  dateFrom: SourceDate;
  dateTo: SourceDate;
  asOfCutoff: AsOfCutoff;
}>;

export type PointInTimeSourceResultV1 =
  | Readonly<{ state: 'available'; rows: readonly Readonly<Record<string, CanonicalJsonValue>>[] }>
  | Readonly<{
    state: 'unavailable';
    reason: PointInTimeSourceUnavailableReasonV1;
    rows: readonly [];
  }>;

export type PointInTimeSourceEnvelopePayloadV1 = Readonly<{
  kind: 'point_in_time_source_envelope';
  schemaVersion: 1;
  sourceMappingVersion: string;
  endpoint: PointInTimeSourceEndpointV1;
  query: readonly PointInTimeQueryParameterV1[];
  request: PointInTimeSourceRequestV1;
  fetchedAt: AsOfCutoff;
  result: PointInTimeSourceResultV1;
}>;

export type PointInTimeSourceEnvelopeV1 = PointInTimeSourceEnvelopePayloadV1 & Readonly<{
  digest: SnapshotDigest;
}>;

export type CreatePointInTimeSourceEnvelopeInputV1 = Readonly<{
  sourceMappingVersion: unknown;
  endpoint: unknown;
  query: readonly unknown[];
  request: Readonly<{
    ticker: unknown;
    dateFrom: unknown;
    dateTo: unknown;
    asOfCutoff: unknown;
  }>;
  fetchedAt: unknown;
  result: Readonly<{
    state: unknown;
    reason?: unknown;
    rows: readonly unknown[];
  }>;
}>;

const SOURCE_MAPPING_VERSION_PATTERN = /^[a-z][a-z0-9_]{0,62}_v[1-9]\d*$/;
const FORBIDDEN_QUERY_NAME_PATTERN =
  /(?:api[_-]?key|authorization|credential|password|secret|token|pagination)/i;

function invalid(message: string, _causeValue?: unknown): never {
  // The rejected value may be a raw response or credential-bearing query. Keep it out of errors.
  throw new PointInTimeErrorV1('source_envelope_invalid', message);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalObject(value: unknown): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Source-envelope rows must be JSON objects.', value);
  }
  let canonical: string;
  try {
    canonical = canonicalJsonV1(value as CanonicalJsonValue);
  } catch (error) {
    return invalid('Source-envelope rows must contain canonical JSON values only.', error);
  }
  return deepFreezeCanonical(
    JSON.parse(canonical) as Readonly<Record<string, CanonicalJsonValue>>,
  ) as Readonly<Record<string, CanonicalJsonValue>>;
}

function deepFreezeCanonical(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeCanonical(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreezeCanonical(item);
    return Object.freeze(value);
  }
  return value;
}

function normalizedQuery(values: readonly unknown[]): readonly PointInTimeQueryParameterV1[] {
  const query = values.map(value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalid('Source-envelope query parameters must be objects.', value);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.name !== 'string' || record.name.length === 0
      || typeof record.value !== 'string' || FORBIDDEN_QUERY_NAME_PATTERN.test(record.name)) {
      return invalid('A source-envelope query parameter is unsafe or invalid.', value);
    }
    return Object.freeze({ name: record.name, value: record.value });
  }).sort((left, right) => compareText(left.name, right.name) || compareText(left.value, right.value));
  for (let index = 1; index < query.length; index += 1) {
    if (query[index - 1]?.name === query[index]?.name) {
      return invalid('Source-envelope query parameter names must be unique.', query[index]?.name);
    }
  }
  return Object.freeze(query);
}

function normalizedRows(values: readonly unknown[]): readonly Readonly<Record<string, CanonicalJsonValue>>[] {
  const rows = values.map(canonicalObject)
    .sort((left, right) => compareText(canonicalJsonV1(left), canonicalJsonV1(right)));
  for (let index = 1; index < rows.length; index += 1) {
    if (canonicalJsonV1(rows[index - 1]!) === canonicalJsonV1(rows[index]!)) {
      return invalid('Source-envelope rows must not contain canonical duplicates.');
    }
  }
  return Object.freeze(rows.map(row => Object.freeze(row)));
}

function payloadFromInput(
  input: CreatePointInTimeSourceEnvelopeInputV1,
): PointInTimeSourceEnvelopePayloadV1 {
  if (typeof input.sourceMappingVersion !== 'string'
    || !SOURCE_MAPPING_VERSION_PATTERN.test(input.sourceMappingVersion)) {
    return invalid('sourceMappingVersion is invalid.', input.sourceMappingVersion);
  }
  if (typeof input.endpoint !== 'string'
    || !POINT_IN_TIME_SOURCE_ENDPOINTS_V1.includes(input.endpoint as PointInTimeSourceEndpointV1)) {
    return invalid('The source endpoint is not allowlisted.', input.endpoint);
  }
  const ticker = input.request.ticker === null
    ? null
    : CanonicalTickerSchema.safeParse(input.request.ticker).data;
  if (input.request.ticker !== null && ticker === undefined) {
    return invalid('The requested ticker is invalid.', input.request.ticker);
  }
  const dateFrom = parseSourceDate(input.request.dateFrom);
  const dateTo = parseSourceDate(input.request.dateTo);
  if (dateFrom > dateTo) return invalid('The requested source date envelope is reversed.');
  const rows = normalizedRows(input.result.rows);
  let result: PointInTimeSourceResultV1;
  if (input.result.state === 'available') {
    if (input.result.reason !== undefined || rows.length === 0) {
      return invalid('An available source result must contain rows and cannot have a reason.');
    }
    result = Object.freeze({ state: 'available', rows });
  } else if (input.result.state === 'unavailable') {
    if (rows.length !== 0
      || typeof input.result.reason !== 'string'
      || !POINT_IN_TIME_SOURCE_UNAVAILABLE_REASONS_V1.includes(
        input.result.reason as PointInTimeSourceUnavailableReasonV1,
      )) {
      return invalid('An unavailable source result must have an allowed reason and no rows.');
    }
    result = Object.freeze({
      state: 'unavailable',
      reason: input.result.reason as PointInTimeSourceUnavailableReasonV1,
      rows: Object.freeze([]) as readonly [],
    });
  } else {
    return invalid('The source result state is invalid.', input.result.state);
  }

  return Object.freeze({
    kind: 'point_in_time_source_envelope',
    schemaVersion: POINT_IN_TIME_SOURCE_ENVELOPE_VERSION,
    sourceMappingVersion: input.sourceMappingVersion,
    endpoint: input.endpoint as PointInTimeSourceEndpointV1,
    query: normalizedQuery(input.query),
    request: Object.freeze({
      ticker: ticker ?? null,
      dateFrom,
      dateTo,
      asOfCutoff: parseAsOfCutoff(input.request.asOfCutoff),
    }),
    fetchedAt: parseAsOfCutoff(input.fetchedAt),
    result,
  });
}

export function createPointInTimeSourceEnvelopeV1(
  input: CreatePointInTimeSourceEnvelopeInputV1,
): PointInTimeSourceEnvelopeV1 {
  const payload = payloadFromInput(input);
  const digest = sha256CanonicalJsonV1(payload as CanonicalJsonValue);
  return Object.freeze({ ...payload, digest });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

export function validatePointInTimeSourceEnvelopeV1(value: unknown): PointInTimeSourceEnvelopeV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('A source envelope must be an object.', value);
  }
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, [
    'kind', 'schemaVersion', 'sourceMappingVersion', 'endpoint', 'query', 'request',
    'fetchedAt', 'result', 'digest',
  ]) || envelope.kind !== 'point_in_time_source_envelope' || envelope.schemaVersion !== 1
    || !Array.isArray(envelope.query)
    || typeof envelope.request !== 'object' || envelope.request === null || Array.isArray(envelope.request)
    || typeof envelope.result !== 'object' || envelope.result === null || Array.isArray(envelope.result)
    || typeof envelope.digest !== 'string') {
    return invalid('The source envelope shape is invalid.', value);
  }
  const request = envelope.request as Record<string, unknown>;
  const result = envelope.result as Record<string, unknown>;
  if (!exactKeys(request, ['ticker', 'dateFrom', 'dateTo', 'asOfCutoff'])
    || !Array.isArray(result.rows)
    || (result.state === 'available' && !exactKeys(result, ['state', 'rows']))
    || (result.state === 'unavailable' && !exactKeys(result, ['state', 'reason', 'rows']))) {
    return invalid('The source envelope nested shape is invalid.', value);
  }
  const recreated = createPointInTimeSourceEnvelopeV1({
    sourceMappingVersion: envelope.sourceMappingVersion,
    endpoint: envelope.endpoint,
    query: envelope.query,
    request: {
      ticker: request.ticker,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      asOfCutoff: request.asOfCutoff,
    },
    fetchedAt: envelope.fetchedAt,
    result: {
      state: result.state,
      reason: result.reason,
      rows: result.rows,
    },
  });
  if (recreated.digest !== envelope.digest
    || canonicalJsonV1(recreated as CanonicalJsonValue) !== canonicalJsonV1(value as CanonicalJsonValue)) {
    return invalid('The source envelope digest or normalization is invalid.', value);
  }
  return recreated;
}
