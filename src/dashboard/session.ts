import { randomBytes, timingSafeEqual } from 'node:crypto';

export type DashboardSecurityReasonV1 = 'forbidden_host' | 'forbidden_origin' | 'csrf_failed'
  | 'payload_too_large' | 'invalid_request' | 'unsupported_media_type';
export class DashboardSecurityErrorV1 extends Error {
  constructor(readonly reason: DashboardSecurityReasonV1) { super(reason); }
}

export function dashboardSecurityFailureV1(error: DashboardSecurityErrorV1, domain: 'strategy_validation' | 'market_data') {
  const forbidden = ['forbidden_host', 'forbidden_origin', 'csrf_failed'].includes(error.reason);
  const status = forbidden ? 403 : error.reason === 'payload_too_large' ? 413 : error.reason === 'unsupported_media_type' ? 415 : 400;
  const code = domain === 'market_data' && forbidden ? 'request_forbidden'
    : domain === 'market_data' && error.reason === 'payload_too_large' ? 'request_body_too_large' : error.reason;
  const messages: Record<DashboardSecurityReasonV1, string> = {
    forbidden_host: 'The request Host is not allowed.', forbidden_origin: 'The request Origin is not allowed.',
    csrf_failed: 'The CSRF token is invalid.', payload_too_large: 'The request body is too large.',
    invalid_request: 'The request is invalid.', unsupported_media_type: 'The request media type is not supported.',
  };
  return { status, code, message: messages[error.reason] };
}

export function isAllowedDashboardHost(host: string | null): boolean {
  if (host === null) return false;
  const match = /^(?:127\.0\.0\.1|localhost)(?::([1-9]\d{0,4}))?$/.exec(host.trim().toLowerCase());
  return !!match && (match[1] === undefined || Number(match[1]) <= 65_535);
}

/** One process-owned session is supplied to all domain route adapters. */
export class DashboardSessionV1 {
  constructor(readonly csrfToken = randomBytes(32).toString('base64url')) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(csrfToken)) throw new TypeError('The Dashboard CSRF token must be 32-byte unpadded base64url.');
  }

  view() {
    return { schemaVersion: 'dashboard_session_v1', csrfHeader: 'X-Dexter-CSRF', csrfToken: this.csrfToken } as const;
  }

  requireMutation(request: Request, url: URL): void {
    const host = request.headers.get('host');
    if (!isAllowedDashboardHost(host)) throw new DashboardSecurityErrorV1('forbidden_host');
    if (host!.toLowerCase() !== url.host.toLowerCase() || request.headers.get('origin') !== url.origin) {
      throw new DashboardSecurityErrorV1('forbidden_origin');
    }
    const actual = Buffer.from(request.headers.get('x-dexter-csrf') ?? '', 'utf8');
    const expected = Buffer.from(this.csrfToken, 'utf8');
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new DashboardSecurityErrorV1('csrf_failed');
    }
  }
}

export function requireDashboardJsonMediaType(request: Request): void {
  const contentType = request.headers.get('content-type');
  if (contentType === null || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new DashboardSecurityErrorV1('unsupported_media_type');
  }
}

export async function readDashboardBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new DashboardSecurityErrorV1('invalid_request');
    if (Number(length) > maximumBytes) throw new DashboardSecurityErrorV1('payload_too_large');
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new DashboardSecurityErrorV1('payload_too_large');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
