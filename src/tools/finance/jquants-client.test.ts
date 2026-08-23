import { afterEach, describe, expect, test } from 'bun:test';
import {
  JQuantsApiError,
  jquantsGet,
  jquantsGetAll,
  resolveJQuantsCode,
} from './jquants-client.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.JQUANTS_API_KEY;
  } else {
    process.env.JQUANTS_API_KEY = originalApiKey;
  }
});

describe('jquantsGet', () => {
  test('rejects a request when the API key is missing', async () => {
    delete process.env.JQUANTS_API_KEY;

    expect(jquantsGet('/equities/bars/daily')).rejects.toMatchObject({
      name: 'JQuantsApiError',
      kind: 'missing_api_key',
    });
  });

  test('sends query parameters and the API key header', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const request = { url: '', apiKey: null as string | null };
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      request.url = String(input);
      request.apiKey = new Headers(init?.headers).get('x-api-key');
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    await jquantsGet('/equities/bars/daily', {
      code: '72030',
      from: '2026-05-01',
      to: undefined,
    });

    const url = new URL(request.url);
    expect(url.origin).toBe('https://api.jquants.com');
    expect(url.pathname).toBe('/v2/equities/bars/daily');
    expect(url.searchParams.get('code')).toBe('72030');
    expect(url.searchParams.get('from')).toBe('2026-05-01');
    expect(url.searchParams.has('to')).toBe(false);
    expect(request.apiKey).toBe('test-key');
  });

  test('reports generic HTTP failures without exposing the API key', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async () => jsonResponse({ message: 'server failed' }, 500)) as unknown as typeof fetch;

    try {
      await jquantsGet('/equities/bars/daily');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(JQuantsApiError);
      expect(error).toMatchObject({ kind: 'http_error', status: 500 });
      expect((error as Error).message).not.toContain('secret-test-key');
    }
  });

  test('classifies unavailable subscription endpoints explicitly', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => jsonResponse({
      message: 'This API is not available on your subscription.',
    }, 403)) as unknown as typeof fetch;

    expect(jquantsGet('/markets/margin-interest')).rejects.toMatchObject({
      kind: 'plan_unavailable',
      status: 403,
    });
  });

  test('classifies subscription date coverage failures explicitly', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => jsonResponse({
      message: 'Your subscription covers the following dates: 2024-01-01 ~ 2026-01-01.',
    }, 400)) as unknown as typeof fetch;

    expect(jquantsGet('/equities/bars/daily')).rejects.toMatchObject({
      kind: 'plan_unavailable',
      status: 400,
    });
  });

  test('rejects successful responses with invalid JSON', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    globalThis.fetch = (async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;

    expect(jquantsGet('/equities/bars/daily')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('jquantsGetAll', () => {
  test('follows pagination keys and combines response rows', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      requestedUrls.push(String(input));
      if (requestedUrls.length === 1) {
        return jsonResponse({ data: [{ Code: '72030' }], pagination_key: 'next-page' });
      }
      return jsonResponse({ data: [{ Code: '67580' }] });
    }) as unknown as typeof fetch;

    const rows = await jquantsGetAll('/equities/bars/daily', { code: '72030' });

    expect(rows).toEqual([{ Code: '72030' }, { Code: '67580' }]);
    expect(new URL(requestedUrls[1]).searchParams.get('pagination_key')).toBe('next-page');
  });
});

describe('resolveJQuantsCode', () => {
  test('converts numeric and alphanumeric canonical codes to J-Quants codes', async () => {
    expect(await resolveJQuantsCode('7203')).toBe('72030');
    expect(await resolveJQuantsCode('72030')).toBe('72030');
    expect(await resolveJQuantsCode('130A')).toBe('130A0');
    expect(await resolveJQuantsCode('130A0')).toBe('130A0');
  });
});
