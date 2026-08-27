import { afterEach, describe, expect, test } from 'bun:test';
import {
  getSectorIndex,
  SECTOR_INDEX_CODE_BY_S33,
  SECTOR_INDEX_SOURCE_START_DATE,
  selectSectorClassificationDate,
} from './sector-index.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.JQUANTS_API_KEY;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function response(data: unknown[], paginationKey?: string): Response {
  return new Response(JSON.stringify({
    data,
    ...(paginationKey ? { pagination_key: paginationKey } : {}),
  }));
}

function masterRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Date: '2026-05-20',
    Code: '72030',
    S33: '3700',
    S33Nm: '輸送用機器',
    ...overrides,
  };
}

function indexRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Date: '2026-05-20',
    Code: '0050',
    O: 250.1,
    H: 252.2,
    L: 249.3,
    C: 251.4,
    ...overrides,
  };
}

function parseToolResult(result: unknown): unknown {
  return JSON.parse(String(result)).data;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.JQUANTS_API_KEY;
  } else {
    process.env.JQUANTS_API_KEY = originalApiKey;
  }
});

describe('TSE 33-sector source mapping', () => {
  test('fixes the complete official S33 to price-index mapping', () => {
    const expected = {
      '0050': '0040', '1050': '0041', '2050': '0042',
      '3050': '0043', '3100': '0044', '3150': '0045',
      '3200': '0046', '3250': '0047', '3300': '0048',
      '3350': '0049', '3400': '004A', '3450': '004B',
      '3500': '004C', '3550': '004D', '3600': '004E',
      '3650': '004F', '3700': '0050', '3750': '0051',
      '3800': '0052', '4050': '0053', '5050': '0054',
      '5100': '0055', '5150': '0056', '5200': '0057',
      '5250': '0058', '6050': '0059', '6100': '005A',
      '7050': '005B', '7100': '005C', '7150': '005D',
      '7200': '005E', '8050': '005F', '9050': '0060',
    } as const satisfies typeof SECTOR_INDEX_CODE_BY_S33;

    expect(Object.keys(SECTOR_INDEX_CODE_BY_S33)).toHaveLength(33);
    expect(SECTOR_INDEX_CODE_BY_S33).toEqual(expected);
  });

  test('selects the latest official full or half trading day without mutating input', () => {
    const calendar = [
      { date: '2026-01-09', holidayDivision: '1' },
      { date: '2026-01-10', holidayDivision: '0' },
      { date: '2026-01-11', holidayDivision: '3' },
      { date: '2026-01-12', holidayDivision: '2' },
      { date: '2026-01-13', holidayDivision: '1' },
    ] as const;
    const before = structuredClone(calendar);

    expect(selectSectorClassificationDate(calendar, '2026-01-12')).toBe('2026-01-12');
    expect(calendar).toEqual(before);
  });
});

describe('getSectorIndex', () => {
  test('preserves source-only and as-of benchmark semantics in the tool description', () => {
    expect(getSectorIndex.description).toContain('Standard plan or higher');
    expect(getSectorIndex.description).toContain('one as-of sector index only');
    expect(getSectorIndex.description).toContain('structured sectorIdentity envelope');
    expect(getSectorIndex.description).toContain('reverify');
    expect(getSectorIndex.description).toContain('issuerCode');
    expect(getSectorIndex.description).toContain('does not stitch');
    expect(getSectorIndex.description).toContain('no correlation');
    expect(getSectorIndex.description).toContain('unavailable, not zero');
  });

  test('rejects invalid or contradictory date inputs before fetching', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return response([]);
    }) as unknown as typeof fetch;

    await expect(getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-0520',
    })).rejects.toThrow('analysisAsOfDate must be a valid');
    await expect(getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-02-30',
    })).rejects.toThrow('analysisAsOfDate must be a valid');
    await expect(getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
      from: '2026-05-21',
    })).rejects.toThrow('from must be on or before analysisAsOfDate');
    expect(fetchCount).toBe(0);
  });

  test('uses calendar, exact equity master, and paginated sector-index endpoints', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    const requests: Array<{ url: URL; apiKey: string | null }> = [];
    let indexPage = 0;
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      const url = new URL(String(input));
      requests.push({
        url,
        apiKey: new Headers(init?.headers).get('x-api-key'),
      });
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([{ Date: '2026-05-20', HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) {
        return response([masterRow()]);
      }
      if (url.pathname.endsWith('/indices/bars/daily')) {
        indexPage += 1;
        if (indexPage === 1) {
          return response([indexRow({ Date: '2026-05-19', C: 249.5 })], 'next-index-page');
        }
        return response([indexRow()]);
      }
      throw new Error(`Unexpected endpoint: ${url.pathname}`);
    }) as unknown as typeof fetch;

    const input = Object.freeze({
      ticker: '7203',
      analysisAsOfDate: '20260520',
      from: '2026-01-01',
    });
    const result = await getSectorIndex.invoke(input);
    const parsed = parseToolResult(result);

    const calendarRequest = requests.find(({ url }) => url.pathname.endsWith('/markets/calendar'))!;
    const masterRequest = requests.find(({ url }) => url.pathname.endsWith('/equities/master'))!;
    const indexRequests = requests.filter(({ url }) => url.pathname.endsWith('/indices/bars/daily'));
    expect(calendarRequest.url.searchParams.get('from')).toBe('2026-04-19');
    expect(calendarRequest.url.searchParams.get('to')).toBe('2026-05-20');
    expect(masterRequest.url.searchParams.get('code')).toBe('72030');
    expect(masterRequest.url.searchParams.get('date')).toBe('2026-05-20');
    expect(indexRequests).toHaveLength(2);
    expect(indexRequests[0].url.searchParams.get('code')).toBe('0050');
    expect(indexRequests[0].url.searchParams.get('from')).toBe('2026-01-01');
    expect(indexRequests[0].url.searchParams.get('to')).toBe('2026-05-20');
    expect(indexRequests[1].url.searchParams.get('pagination_key')).toBe('next-index-page');
    expect(requests.every(({ apiKey }) => apiKey === 'secret-test-key')).toBe(true);
    expect(requests.every(({ url }) => !String(url).includes('secret-test-key'))).toBe(true);
    expect(String(result)).not.toContain('secret-test-key');
    expect(input).toEqual({
      ticker: '7203',
      analysisAsOfDate: '20260520',
      from: '2026-01-01',
    });
    expect(parsed).toEqual({
      analysisAsOfDate: '2026-05-20',
      classification: {
        issuerCode: '72030',
        classificationDate: '2026-05-20',
        sectorCode: '3700',
        sectorName: '輸送用機器',
        indexCode: '0050',
      },
      sectorIdentity: {
        analysisAsOfDate: '2026-05-20',
        issuerCode: '72030',
        classificationDate: '2026-05-20',
        sectorCode: '3700',
        sectorName: '輸送用機器',
        indexCode: '0050',
        provenance: { source: 'jquants', endpoint: '/v2/equities/master' },
      },
      prices: [
        {
          date: '2026-05-19', indexCode: '0050',
          open: 250.1, high: 252.2, low: 249.3, close: 249.5,
        },
        {
          date: '2026-05-20', indexCode: '0050',
          open: 250.1, high: 252.2, low: 249.3, close: 251.4,
        },
      ],
    });
    expect(String(result)).not.toContain('correlation');
    expect(String(result)).not.toContain('beta');
  });

  test('uses the latest official business day on a holiday and excludes future calendar rows', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const requests: URL[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([
          { Date: '2026-05-15', HolDiv: '1' },
          { Date: '2026-05-16', HolDiv: '0' },
          { Date: '2026-05-17', HolDiv: '0' },
          { Date: '2026-05-18', HolDiv: '1' },
        ]);
      }
      if (url.pathname.endsWith('/equities/master')) {
        return response([masterRow({ Date: '2026-05-15' })]);
      }
      return response([indexRow({ Date: '2026-05-15' })]);
    }) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-17',
    })) as { classification: { classificationDate: string } };

    expect(result.classification.classificationDate).toBe('2026-05-15');
    const masterRequest = requests.find(({ pathname }) => pathname.endsWith('/equities/master'))!;
    const indexRequest = requests.find(({ pathname }) => pathname.endsWith('/indices/bars/daily'))!;
    expect(masterRequest.searchParams.get('date')).toBe('2026-05-15');
    expect(indexRequest.searchParams.get('to')).toBe('2026-05-17');
  });

  test('does not request irrelevant pre-plan calendar history for a current classification', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const calendarFrom: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/markets/calendar')) {
        const from = url.searchParams.get('from')!;
        calendarFrom.push(from);
        if (from < '2016-08-27') {
          return new Response(JSON.stringify({
            message: 'Your subscription covers the following dates: 2016-08-27 ~ .',
          }), { status: 403 });
        }
        return response([{ Date: '2026-05-20', HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) return response([masterRow()]);
      return response([indexRow()]);
    }) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
      from: '2025-05-20',
    })) as { classification: { classificationDate: string } };

    expect(result.classification.classificationDate).toBe('2026-05-20');
    expect(calendarFrom).toEqual(['2026-04-19']);
  });

  test('resolves historical sector changes independently without stitching index codes', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const indexCodes: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([{ Date: url.searchParams.get('to'), HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) {
        const date = url.searchParams.get('date');
        return response([masterRow(date === '2026-01-15'
          ? { Date: date, S33: '3650', S33Nm: '電気機器' }
          : { Date: date })]);
      }
      const code = url.searchParams.get('code')!;
      indexCodes.push(code);
      return response([indexRow({
        Date: url.searchParams.get('to'),
        Code: code,
      })]);
    }) as unknown as typeof fetch;

    const historical = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-01-15',
      from: '2025-01-01',
    })) as { classification: { sectorCode: string; indexCode: string } };
    const later = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
      from: '2025-01-01',
    })) as { classification: { sectorCode: string; indexCode: string } };

    expect(historical.classification).toMatchObject({ sectorCode: '3650', indexCode: '004F' });
    expect(later.classification).toMatchObject({ sectorCode: '3700', indexCode: '0050' });
    expect(indexCodes).toEqual(['004F', '0050']);
  });

  test('rejects the pre-storage master fallback without making a source request', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return response([]);
    }) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2008-05-06',
    }));

    expect(result).toEqual({
      error: `Sector classification is unavailable before ${SECTOR_INDEX_SOURCE_START_DATE}.`,
      reason: 'sector_classification_unavailable',
    });
    expect(fetchCount).toBe(0);
  });

  test('keeps an empty official calendar unavailable without querying master data', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';
    const paths: string[] = [];
    globalThis.fetch = (async (input: FetchInput) => {
      paths.push(new URL(String(input)).pathname);
      return response([]);
    }) as unknown as typeof fetch;

    const result = parseToolResult(await getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
    }));

    expect(result).toEqual({
      error: 'No official classification business date found on or before 2026-05-20.',
      reason: 'sector_classification_unavailable',
    });
    expect(paths).toEqual(['/v2/markets/calendar']);
  });

  test('keeps delisted, mismatched-date, unsupported, and empty index states unavailable', async () => {
    process.env.JQUANTS_API_KEY = 'test-key';

    const invokeWith = async (master: unknown[], index: unknown[] = [indexRow()]) => {
      let indexFetches = 0;
      globalThis.fetch = (async (input: FetchInput) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/markets/calendar')) {
          return response([{ Date: '2026-05-20', HolDiv: '1' }]);
        }
        if (url.pathname.endsWith('/equities/master')) return response(master);
        indexFetches += 1;
        return response(index);
      }) as unknown as typeof fetch;
      const result = parseToolResult(await getSectorIndex.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-05-20',
      }));
      return { result, indexFetches };
    };

    expect(await invokeWith([])).toEqual({
      result: {
        error: 'No exact as-of sector classification found for 7203.',
        reason: 'sector_classification_unavailable',
      },
      indexFetches: 0,
    });
    expect(await invokeWith([masterRow({ Date: '2008-05-07' })])).toEqual({
      result: {
        error: 'No exact as-of sector classification found for 7203.',
        reason: 'sector_classification_unavailable',
      },
      indexFetches: 0,
    });
    expect(await invokeWith([masterRow({ S33: '9999', S33Nm: 'その他' })])).toEqual({
      result: {
        error: 'The as-of S33 classification for 7203 has no TSE 33-sector index.',
        reason: 'unsupported_sector',
      },
      indexFetches: 0,
    });
    expect(await invokeWith([masterRow()], [])).toEqual({
      result: {
        error: 'No sector-index data found for 0050 at the requested source boundary.',
        reason: 'no_sector_index_data',
      },
      indexFetches: 1,
    });
  });

  test('preserves malformed-response and plan-unavailable errors without exposing the key', async () => {
    process.env.JQUANTS_API_KEY = 'secret-test-key';
    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([{ Date: '2026-05-20', HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) {
        return response([masterRow({ S33: null })]);
      }
      return response([]);
    }) as unknown as typeof fetch;

    await expect(getSectorIndex.invoke({
      ticker: '7203',
      analysisAsOfDate: '2026-05-20',
    })).rejects.toMatchObject({
      name: 'JQuantsApiError',
      kind: 'invalid_response',
    });

    globalThis.fetch = (async (input: FetchInput) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/markets/calendar')) {
        return response([{ Date: '2026-05-20', HolDiv: '1' }]);
      }
      if (url.pathname.endsWith('/equities/master')) return response([masterRow()]);
      return new Response(JSON.stringify({
        message: 'This API is not available on your subscription.',
      }), { status: 403 });
    }) as unknown as typeof fetch;

    try {
      await getSectorIndex.invoke({
        ticker: '7203',
        analysisAsOfDate: '2026-05-20',
      });
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'JQuantsApiError',
        kind: 'plan_unavailable',
        status: 403,
      });
      expect((error as Error).message).not.toContain('secret-test-key');
    }
  });
});
