import { afterEach, describe, expect, test } from 'bun:test';
import { clearResolverCache, resolveCompany } from './resolver.js';

const originalFetch = globalThis.fetch;
type FetchInput = Parameters<typeof fetch>[0];

function searchResponse(): Response {
  return new Response(JSON.stringify({
    data: [
      {
        edinet_code: 'E99999',
        name: 'Unrelated Company',
        sec_code: '99990',
        listing_status: 'listed',
      },
      {
        edinet_code: 'E02144',
        name: 'Toyota Motor Corporation',
        sec_code: '72030',
        listing_status: 'listed',
      },
      {
        edinet_code: 'E12345',
        name: 'Alphanumeric Company',
        sec_code: '130A0',
        listing_status: 'listed',
      },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearResolverCache();
});

describe('EDINET DB company resolver', () => {
  test.each([
    ['7203', 'E02144', '72030'],
    ['72030', 'E02144', '72030'],
    ['130A', 'E12345', '130A0'],
    ['130A0', 'E12345', '130A0'],
  ])('matches canonical and five-character securities code %s exactly', async (
    query,
    expectedEdinetCode,
    expectedSecCode,
  ) => {
    globalThis.fetch = (async (_input: FetchInput) => searchResponse()) as typeof fetch;

    const company = await resolveCompany(query);

    expect(company.edinetCode).toBe(expectedEdinetCode);
    expect(company.secCode).toBe(expectedSecCode);
  });

  test('does not fall back to the first search hit for an unmatched code query', async () => {
    globalThis.fetch = (async (_input: FetchInput) => new Response(JSON.stringify({
      data: [{
        edinet_code: 'E99999',
        name: 'Unrelated Company',
        sec_code: '99990',
        listing_status: 'listed',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    expect(resolveCompany('130A')).rejects.toThrow('Company not found: 130A');
  });
});
