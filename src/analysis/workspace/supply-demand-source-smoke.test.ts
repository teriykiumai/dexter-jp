import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { proveSupplyDemandSourceFields, SUPPLY_DEMAND_SMOKE_LIMITS } from './supply-demand-source-smoke.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

function fixture(change: (path: string, rows: Record<string, unknown>[]) => void = () => {}) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  let elapsed = 0;
  const environment: JQuantsExecutionEnvironmentV1 = {
    apiKey: () => 'fixture-secret', wallNowMs: () => Date.parse('2026-09-13T00:00:00Z'),
    monotonicNowMs: () => elapsed, sleep: async ms => { elapsed += ms; },
    fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push({ url, init });
      const rows: Record<string, unknown>[] = url.pathname.endsWith('/master')
        ? [{ Date: '2026-09-11', Code: '72030', Mkt: '0111', ProdCat: '011', S33: '3700', S33Nm: 'fixture-sector' }]
        : url.pathname.endsWith('/margin-interest')
          ? [{ Date: '2026-09-04', Code: '72030', IssType: '2', ShrtVol: 0, LongVol: 100,
            ShrtNegVol: 0, LongNegVol: 0, ShrtStdVol: 0, LongStdVol: 100 }]
          : url.pathname.endsWith('/short-sale-report')
            ? [{ DiscDate: '2026-09-11', CalcDate: '2026-09-09', Code: '67580', SSName: 'fixture-reporter',
              DICName: null, FundName: '', ShrtPosToSO: 0.51, ShrtPosShares: 100,
              PrevRptDate: '', PrevRptRatio: null }]
            : [{ Date: '2026-09-11', S33: '3700', SellExShortVa: 0, ShrtWithResVa: 0, ShrtNoResVa: 0 }];
      change(url.pathname, rows);
      return new Response(JSON.stringify({ data: rows }));
    },
  };
  return { environment, requests, run: () => proveSupplyDemandSourceFields({ confirmed: true, environment, requestsPerMinute: 5 }) };
}

test('source smoke requires explicit confirmation before reading credentials or dispatching', async () => {
  const f = fixture();
  let keyReads = 0;
  await expect(proveSupplyDemandSourceFields({ confirmed: false, environment: {
    ...f.environment, apiKey: () => { keyReads++; return 'fixture'; },
  } })).rejects.toThrow('cancelled');
  expect(keyReads).toBe(0); expect(f.requests).toHaveLength(0);
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL('./supply-demand-source-smoke.ts', import.meta.url))],
    { env: { ...process.env, JQUANTS_API_KEY: '' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe('');
  expect(JSON.parse(result.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
});

test('four bounded source queries preserve scope and observed zero without printing raw rows or credentials', async () => {
  const f = fixture(), result = await f.run();
  expect(result.state).toBe('passed'); expect(result.metrics.attempts).toBe(4);
  expect(result.metrics.pages).toBe(4); expect(result.metrics.acceptedRows).toBe(4);
  expect(result.historicalIdentity).toBe('not_verified');
  expect(result.futureDailyMarginContract).toBe('not_verified');
  expect(result.sector.sectorCode).toBe('3700');
  expect(f.requests.map(({ url }) => [url.pathname, Object.fromEntries(url.searchParams)])).toEqual([
    ['/v2/equities/master', { code: '72030', date: '2026-09-11' }],
    ['/v2/markets/margin-interest', { code: '72030', from: '2026-08-01', to: '2026-09-11' }],
    ['/v2/markets/short-sale-report', { disc_date: '2026-09-11' }],
    ['/v2/markets/short-ratio', { s33: '3700', date: '2026-09-11' }],
  ]);
  for (const { url, init } of f.requests) {
    expect(url.origin).toBe('https://api.jquants.com'); expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  const output = JSON.stringify(result);
  for (const secret of ['fixture-secret', 'fixture-reporter', 'fixture-sector']) expect(output).not.toContain(secret);
});

test.each(['margin-interest', 'short-sale-report', 'short-ratio'])('empty %s cannot pass the source field gate', async endpoint => {
  const f = fixture((path, rows) => { if (path.endsWith(endpoint)) rows.length = 0; });
  expect((await f.run()).state).toBe('incomplete');
});

test.each(['master_identity', 'master_date', 'sector_identity', 'sector_date', 'negative', 'missing', 'duplicate_margin',
  'future_disclosure', 'future_calculation', 'invalid_date', 'new_margin_schema'])('source validation fails closed for %s', async kind => {
  const f = fixture((path, rows) => {
    const row = rows[0]!;
    if (path.endsWith('/master')) {
      if (kind === 'master_identity') row.Code = '67580';
      if (kind === 'master_date') row.Date = '2026-09-10';
    }
    if (path.endsWith('/short-ratio')) {
      if (kind === 'sector_identity') row.S33 = '3600';
      if (kind === 'sector_date') row.Date = '2026-09-10';
      if (kind === 'negative') row.ShrtWithResVa = -1;
      if (kind === 'missing') delete row.SellExShortVa;
    }
    if (path.endsWith('/margin-interest')) {
      if (kind === 'duplicate_margin') rows.push({ ...row });
      if (kind === 'invalid_date') row.Date = '2026-08-32';
      if (kind === 'new_margin_schema') row.ShrtVal = null;
    }
    if (path.endsWith('/short-sale-report')) {
      if (kind === 'future_disclosure') row.DiscDate = '2026-09-12';
      if (kind === 'future_calculation') row.CalcDate = '2026-09-12';
    }
  });
  await expect(f.run()).rejects.toThrow('source_response_invalid');
});

test('null numeric observations remain distinct from zero', async () => {
  const f = fixture((path, rows) => { if (path.endsWith('/short-ratio')) rows[0]!.SellExShortVa = null; });
  expect((await f.run()).coverage.sector).toBe(false);
});

test('observed previous-report dash remains an explicit non-date observation', async () => {
  const f = fixture((path, rows) => { if (path.endsWith('/short-sale-report')) rows[0]!.PrevRptDate = '-'; });
  const result = await f.run();
  expect(result.state).toBe('passed'); expect(result.reports.previousDateDashCount).toBe(1);
});

test('announced daily migration closes the weekly diagnostic before credentials or network', async () => {
  const f = fixture();
  await expect(proveSupplyDemandSourceFields({ confirmed: true, environment: {
    ...f.environment, wallNowMs: () => Date.parse('2026-09-27T15:00:00Z'),
    apiKey: () => { throw new Error('must not read credentials'); },
  } })).rejects.toThrow('specification_gate_expired');
  expect(f.requests).toHaveLength(0);
});

test.each([429, 500, 403, 401])('HTTP %s never retries or advances to another source', async status => {
  const f = fixture(); let attempts = 0;
  await expect(proveSupplyDemandSourceFields({ confirmed: true, environment: {
    ...f.environment, fetch: async () => { attempts++; return new Response('private body', { status }); },
  } })).rejects.toThrow();
  expect(attempts).toBe(1);
});

test('response byte limit is checked before reading a declared oversized body', async () => {
  const f = fixture();
  await expect(proveSupplyDemandSourceFields({ confirmed: true, environment: {
    ...f.environment, fetch: async () => new Response('{}', {
      headers: { 'content-length': String(SUPPLY_DEMAND_SMOKE_LIMITS.responseBytes + 1) },
    }),
  } })).rejects.toMatchObject({ code: 'source_response_too_large' });
});

test('pagination is bounded and incomplete pages never become successful evidence', async () => {
  const f = fixture(); let attempts = 0;
  await expect(proveSupplyDemandSourceFields({ confirmed: true, environment: {
    ...f.environment, fetch: async () => new Response(JSON.stringify({ data: [], pagination_key: String(++attempts) })),
  } })).rejects.toThrow();
  expect(attempts).toBeGreaterThan(1); expect(attempts).toBeLessThanOrEqual(20);
});

test('minimum configured rate and deadline prevent a late dispatch', async () => {
  const f = fixture();
  await expect(proveSupplyDemandSourceFields({ confirmed: true, environment: f.environment, requestsPerMinute: 1 }))
    .rejects.toMatchObject({ code: 'source_timeout' });
  expect(f.requests).toHaveLength(3);
});

test('failed field gate identifies source and field without reflecting the provider value', async () => {
  const f = fixture((path, rows) => {
    if (path.endsWith('/margin-interest')) rows[0]!.LongVol = 'private-provider-value';
  });
  let diagnostic: unknown;
  const result = proveSupplyDemandSourceFields({ confirmed: true, environment: f.environment,
    observe: value => { diagnostic = value; } });
  await expect(result).rejects.toMatchObject({ code: 'source_response_invalid', fields: ['LongVol'] });
  expect(diagnostic).toMatchObject({ stage: 'margin', attempts: 2, pages: 2, acceptedRows: 2 });
  expect(JSON.stringify(diagnostic)).not.toContain('private-provider-value');
  expect(f.requests).toHaveLength(2);
});
