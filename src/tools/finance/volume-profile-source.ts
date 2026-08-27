import {
  JQuantsApiError,
  jquantsGetAll,
  resolveJQuantsCode,
} from './jquants-client.js';
import {
  type VolumeProfileAvailabilityCalendarDay,
  type VolumeProfileSourceInput,
  type VolumeProfileSourceInputRow,
} from './volume-profile-engine.js';

const PRICE_ENDPOINT = '/equities/bars/daily';
const CALENDAR_ENDPOINT = '/markets/calendar';
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMPACT_DATE_PATTERN = /^\d{8}$/;
const OFFICIAL_HOLIDAY_DIVISIONS = new Set(['0', '1', '2', '3']);

export interface FetchVolumeProfileSourceInput {
  ticker: string;
  from: string;
}

function invalidResponse(endpoint: string, detail: string): never {
  throw new JQuantsApiError(
    `J-Quants endpoint ${endpoint} returned invalid volume-profile source data: ${detail}`,
    'invalid_response',
  );
}

function sourceRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResponse(endpoint, 'expected each row to be an object.');
  }
  return value as Record<string, unknown>;
}

function canonicalSourceDate(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): string {
  const value = row[field];
  if (typeof value !== 'string' || !CANONICAL_DATE_PATTERN.test(value)) {
    return invalidResponse(endpoint, `${field} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalidResponse(endpoint, `${field} must be a valid date.`);
  }
  return value;
}

function sourceString(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    return invalidResponse(endpoint, `${field} must be a non-empty string.`);
  }
  return value;
}

function sourceNumberOrNull(
  row: Record<string, unknown>,
  field: string,
  endpoint: string,
): number | null {
  const value = row[field];
  if (value !== null && typeof value !== 'number') {
    return invalidResponse(endpoint, `${field} must be a number or null.`);
  }
  return value;
}

function mapPriceRow(value: unknown, issuerCode: string): VolumeProfileSourceInputRow {
  const row = sourceRecord(value, PRICE_ENDPOINT);
  const code = sourceString(row, 'Code', PRICE_ENDPOINT);
  if (code !== issuerCode) {
    return invalidResponse(PRICE_ENDPOINT, 'Code does not match the requested issuer.');
  }
  return {
    Date: canonicalSourceDate(row, 'Date', PRICE_ENDPOINT),
    Code: code,
    AdjO: sourceNumberOrNull(row, 'AdjO', PRICE_ENDPOINT),
    AdjH: sourceNumberOrNull(row, 'AdjH', PRICE_ENDPOINT),
    AdjL: sourceNumberOrNull(row, 'AdjL', PRICE_ENDPOINT),
    AdjC: sourceNumberOrNull(row, 'AdjC', PRICE_ENDPOINT),
    AdjVo: sourceNumberOrNull(row, 'AdjVo', PRICE_ENDPOINT),
    // Preserve the raw metadata so the source validator, rather than the mapper,
    // decides whether the common adjusted basis can be established.
    AdjFactor: row.AdjFactor,
    ExRT: row.ExRT,
  };
}

function mapCalendarRow(value: unknown): VolumeProfileAvailabilityCalendarDay {
  const row = sourceRecord(value, CALENDAR_ENDPOINT);
  const holidayDivision = sourceString(row, 'HolDiv', CALENDAR_ENDPOINT);
  if (!OFFICIAL_HOLIDAY_DIVISIONS.has(holidayDivision)) {
    return invalidResponse(CALENDAR_ENDPOINT, 'HolDiv is not an official holiday division.');
  }
  return {
    date: canonicalSourceDate(row, 'Date', CALENDAR_ENDPOINT),
    holidayDivision,
  };
}

export function normalizeVolumeProfileSourceDate(value: string, fieldName: string): string {
  if (!COMPACT_DATE_PATTERN.test(value) && !CANONICAL_DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD or YYYYMMDD date.`);
  }
  const compact = value.replaceAll('-', '');
  const normalized = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD or YYYYMMDD date.`);
  }
  return normalized;
}

function collectionIdentity(): { collectedAt: string; collectionDate: string } {
  const now = new Date();
  return {
    collectedAt: now.toISOString(),
    collectionDate: new Date(now.getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  };
}

/** Fetch the complete collection-horizon input for the engine's source validator. */
export async function fetchVolumeProfileSourceInput(
  input: FetchVolumeProfileSourceInput,
): Promise<VolumeProfileSourceInput> {
  const from = normalizeVolumeProfileSourceDate(input.from, 'from');
  const { collectedAt, collectionDate } = collectionIdentity();
  if (from > collectionDate) {
    throw new Error('from must be on or before the collection date.');
  }
  const issuerCode = await resolveJQuantsCode(input.ticker);

  const [priceRows, calendarRows] = await Promise.all([
    jquantsGetAll<Record<string, unknown>>(PRICE_ENDPOINT, {
      code: issuerCode,
      from,
      to: collectionDate,
    }),
    jquantsGetAll<Record<string, unknown>>(CALENDAR_ENDPOINT, {
      from,
      to: collectionDate,
    }),
  ]);

  const sourceInput: VolumeProfileSourceInput = {
    issuerCode,
    collectedAt,
    rows: priceRows.map((row) => mapPriceRow(row, issuerCode)),
    calendar: calendarRows.map(mapCalendarRow),
    provenance: {
      source: 'jquants',
      endpoint: '/v2/equities/bars/daily',
      availabilityCalendarEndpoint: '/v2/markets/calendar',
      mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
      basisAudit: 'collection_horizon_rights_audit_v1',
    },
  };
  return sourceInput;
}
