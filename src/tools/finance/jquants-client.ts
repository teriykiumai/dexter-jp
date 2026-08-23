import { api as edinetApi } from './api.js';
import { resolveEdinetCode } from './resolver.js';
import {
  normalizeJapaneseSecuritiesCode,
  toJQuantsSecuritiesCode,
} from '../../utils/japanese-securities-code.js';

export const JQUANTS_BASE_URL = 'https://api.jquants.com/v2';

export type JQuantsErrorKind =
  | 'missing_api_key'
  | 'network_error'
  | 'http_error'
  | 'plan_unavailable'
  | 'invalid_response';

export class JQuantsApiError extends Error {
  constructor(
    message: string,
    public readonly kind: JQuantsErrorKind,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'JQuantsApiError';
  }
}

type QueryValue = string | number | undefined;

interface JQuantsResponse<T> {
  data: T[];
  pagination_key?: string;
}

function getApiKey(): string {
  const apiKey = process.env.JQUANTS_API_KEY;
  if (!apiKey) {
    throw new JQuantsApiError(
      'JQUANTS_API_KEY is not set. Configure a J-Quants V2 API key before using this tool.',
      'missing_api_key',
    );
  }
  return apiKey;
}

function getErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const value = record.message ?? record.error;
  return typeof value === 'string' ? value : undefined;
}

function isPlanRestriction(status: number, detail?: string): boolean {
  if (status === 403) return true;
  if (!detail) return false;
  return /not available on your subscription|subscription covers the following dates/i.test(detail);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    if (!response.ok) return { message: text };
    throw new JQuantsApiError(
      'J-Quants returned an invalid JSON response.',
      'invalid_response',
      response.status,
      { cause },
    );
  }
}

/** Make one authenticated J-Quants V2 GET request. */
export async function jquantsGet<T extends Record<string, unknown>>(
  endpoint: string,
  params: Record<string, QueryValue> = {},
): Promise<JQuantsResponse<T>> {
  const url = new URL(`${JQUANTS_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'x-api-key': getApiKey() },
    });
  } catch (cause) {
    if (cause instanceof JQuantsApiError) throw cause;
    throw new JQuantsApiError(
      `Could not connect to J-Quants endpoint ${endpoint}.`,
      'network_error',
      undefined,
      { cause },
    );
  }

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const detail = getErrorMessage(body);
    if (isPlanRestriction(response.status, detail)) {
      throw new JQuantsApiError(
        `J-Quants endpoint ${endpoint} is unavailable for the current subscription plan${detail ? `: ${detail}` : '.'}`,
        'plan_unavailable',
        response.status,
      );
    }
    throw new JQuantsApiError(
      `J-Quants request to ${endpoint} failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
      'http_error',
      response.status,
    );
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new JQuantsApiError(
      `J-Quants endpoint ${endpoint} returned an unexpected response shape.`,
      'invalid_response',
      response.status,
    );
  }

  return body as JQuantsResponse<T>;
}

/** Read all pages from a J-Quants V2 endpoint. */
export async function jquantsGetAll<T extends Record<string, unknown>>(
  endpoint: string,
  params: Record<string, QueryValue> = {},
): Promise<T[]> {
  const rows: T[] = [];
  let paginationKey: string | undefined;
  const seenKeys = new Set<string>();

  do {
    const response = await jquantsGet<T>(endpoint, {
      ...params,
      pagination_key: paginationKey,
    });
    rows.push(...response.data);
    paginationKey = response.pagination_key;
    if (paginationKey && seenKeys.has(paginationKey)) {
      throw new JQuantsApiError(
        `J-Quants endpoint ${endpoint} returned a repeated pagination key.`,
        'invalid_response',
      );
    }
    if (paginationKey) seenKeys.add(paginationKey);
  } while (paginationKey);

  return rows;
}

/** Resolve a ticker to the five-digit code used by J-Quants. */
export async function resolveJQuantsCode(ticker: string): Promise<string> {
  try {
    return toJQuantsSecuritiesCode(ticker);
  } catch {
    // Company names and EDINET codes continue through the existing resolver.
  }

  const edinetCode = await resolveEdinetCode(ticker);
  const { data: response } = await edinetApi.get(`/companies/${edinetCode}`, {});
  const company = (response.data || response) as Record<string, unknown>;
  const secCode = company.sec_code ?? company.secCode;
  if (typeof secCode !== 'string') {
    throw new Error(`No securities code found for ${ticker}`);
  }
  return `${normalizeJapaneseSecuritiesCode(secCode)}0`;
}

export function isJQuantsAvailable(): boolean {
  return Boolean(process.env.JQUANTS_API_KEY);
}
