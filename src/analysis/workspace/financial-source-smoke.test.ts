import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { FINANCIAL_SMOKE_LIMITS, inspectFinancialSourceRows, proveFinancialSourceFields } from './financial-source-smoke.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

function summaryRow() {
  return { Code: '72030', DiscDate: '2026-05-08', DiscTime: '15:00', DiscNo: '20260508000001',
    DocType: 'FYFinancialStatements_Consolidated_IFRS', CurPerType: 'FY', CurPerSt: '2025-04-01', CurPerEn: '2026-03-31',
    CurFYSt: '2025-04-01', CurFYEn: '2026-03-31', NxtFYEn: '2027-03-31',
    Sales: '1000', OP: '100', OdP: '', NP: '50', EPS: '10', BPS: '100', TA: '2000', Eq: '800', EqAR: '0.4',
    CFO: '100', CFI: '-50', CFF: '-20', ShOutFY: '100', TrShFY: '10',
    DivAnn: '3', PayoutRatioAnn: '0.3', FDivAnn: '', FPayoutRatioAnn: '', NxFDivAnn: '4', NxFPayoutRatioAnn: '0.4' };
}
function fixture(change: (path: string, rows: Record<string, unknown>[]) => void = () => {}) {
  const requests: { url: URL; init?: RequestInit }[] = []; let elapsed = 0;
  const environment: JQuantsExecutionEnvironmentV1 = {
    apiKey: () => 'fixture-secret', wallNowMs: () => Date.parse('2026-09-13T00:00:00Z'),
    monotonicNowMs: () => elapsed, sleep: async ms => { elapsed += ms; },
    fetch: async (input, init) => {
      const url = new URL(String(input)); requests.push({ url, init });
      const rows: Record<string, unknown>[] = [];
      if (url.pathname.endsWith('/master')) rows.push({ Date: '2026-09-11', Code: '72030', CoName: 'Private Fixture', Mkt: '0111', ProdCat: '011' });
      else if (url.pathname.endsWith('/summary')) rows.push(summaryRow());
      else for (let time = Date.parse(url.searchParams.get('from')!); time <= Date.parse(url.searchParams.get('to')!); time += 86_400_000) {
        const day = new Date(time), DateValue = day.toISOString().slice(0, 10), session = ![0, 6].includes(day.getUTCDay());
        if (url.pathname.endsWith('/calendar')) rows.push({ Date: DateValue, HolDiv: session ? '1' : '0' });
        else if (session) rows.push({ Date: DateValue, Code: '72030', O: 100, H: 110, L: 90, C: 100, Vo: 100,
          AdjO: 100, AdjH: 110, AdjL: 90, AdjC: 100, AdjVo: 100, AdjFactor: 1, ExRT: null });
      }
      change(url.pathname, rows); return Response.json({ data: rows });
    },
  };
  return { environment, requests, run: () => proveFinancialSourceFields({ confirmed: true, environment, requestsPerMinute: 5 }) };
}

test('financial diagnostic has no credential read or dispatch without the explicit CLI operation', async () => {
  const f = fixture(); let keys = 0;
  await expect(proveFinancialSourceFields({ confirmed: false, environment: { ...f.environment,
    apiKey: () => { keys++; return 'fixture'; } } })).rejects.toThrow('cancelled');
  expect(keys).toBe(0); expect(f.requests).toHaveLength(0);
  const process = Bun.spawnSync([Bun.which('bun')!, fileURLToPath(new URL('./financial-source-smoke.ts', import.meta.url))],
    { env: { JQUANTS_API_KEY: '' }, stdout: 'pipe', stderr: 'pipe' });
  expect(process.exitCode).toBe(1); expect(process.stdout.toString()).toBe('');
  expect(JSON.parse(process.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
});

test('four bounded queries prove fields, not ownership, share basis or point-in-time history', async () => {
  const f = fixture(), result = await f.run();
  expect(result.state).toBe('passed'); expect(result.metrics.attempts).toBe(4); expect(result.metrics.pages).toBe(4);
  expect(result).toMatchObject({ scope: 'field_shape_only', historicalIdentity: 'not_verified', forecastPriceShareBasis: 'not_verified',
    correctionVintage: 'current_at_fetch_not_point_in_time', productionProjectionGate: 'not_passed' });
  expect(f.requests.map(({ url }) => [url.pathname, Object.fromEntries(url.searchParams)])).toEqual([
    ['/v2/equities/master', { code: '72030', date: '2026-09-11' }], ['/v2/fins/summary', { code: '72030' }],
    ['/v2/markets/calendar', { from: '2016-09-13', to: '2026-09-11' }],
    ['/v2/equities/bars/daily', { code: '72030', from: '2026-08-01', to: '2026-09-11' }],
  ]);
  for (const { url, init } of f.requests) {
    expect(url.origin).toBe('https://api.jquants.com'); expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
  expect(JSON.stringify(result)).not.toContain('fixture-secret'); expect(JSON.stringify(result)).not.toContain('Private Fixture');
});

test('mapping preserves blank, zero, negative cash flow and unusual source payout without deriving payout', () => {
  const row = summaryRow(); row.PayoutRatioAnn = '-0.2'; row.FDivAnn = '0';
  expect(inspectFinancialSourceRows([row])[0]).toMatchObject({ CFI: -50, OdP: null,
    dividend: { actualPayoutRatio: -.2, forecastAnnualDividendPerShare: 0 } });
  row.PayoutRatioAnn = '';
  expect(inspectFinancialSourceRows([row])[0]!.dividend.actualPayoutRatio).toBeNull();
});

test.each(['empty', 'missing_payout', 'missing_forecast', 'unknown_document'])('%s is incomplete, not evidence of available projection', async kind => {
  const f = fixture((path, rows) => {
    if (!path.endsWith('/summary')) return;
    if (kind === 'empty') rows.length = 0;
    else if (kind === 'missing_payout') rows[0]!.PayoutRatioAnn = '';
    else if (kind === 'missing_forecast') rows[0]!.NxFDivAnn = '';
    else rows[0]!.DocType = 'UnverifiedDocument';
  });
  expect((await f.run()).state).toBe('incomplete');
});

test.each(['foreign_code', 'future_disclosure', 'duplicate', 'invalid_date', 'missing_field', 'nonfinite'])('invalid %s fails closed', async kind => {
  const f = fixture((path, rows) => {
    if (!path.endsWith('/summary')) return;
    const row = rows[0]!;
    if (kind === 'foreign_code') row.Code = '67580';
    if (kind === 'future_disclosure') row.DiscDate = '2026-09-12';
    if (kind === 'duplicate') rows.push({ ...row });
    if (kind === 'invalid_date') row.CurPerEn = '2026-02-30';
    if (kind === 'missing_field') delete row.Sales;
    if (kind === 'nonfinite') row.EPS = 'Infinity';
  });
  await expect(f.run()).rejects.toThrow('source_response_invalid');
});

test('unknown financial values never enter diagnostic errors', async () => {
  const f = fixture((path, rows) => { if (path.endsWith('/summary')) rows[0]!.Sales = 'provider-secret'; });
  try { await f.run(); throw new Error('expected failure'); }
  catch (error) { expect(error).toMatchObject({ code: 'source_response_invalid', fields: ['Sales'] });
    expect(JSON.stringify(error)).not.toContain('provider-secret'); }
});

test.each([401, 403, 429, 500])('HTTP %s stops without retry or other-source fallback', async status => {
  const f = fixture(); let attempts = 0;
  await expect(proveFinancialSourceFields({ confirmed: true, environment: { ...f.environment,
    fetch: async () => { attempts++; return new Response('private response', { status }); } } })).rejects.toThrow();
  expect(attempts).toBe(1);
});

test('pagination and row/byte budgets apply to the whole probe', async () => {
  const f = fixture(); let attempts = 0;
  await expect(proveFinancialSourceFields({ confirmed: true, environment: { ...f.environment,
    fetch: async () => Response.json({ data: [], pagination_key: String(++attempts) }) } })).rejects.toThrow();
  expect(attempts).toBeLessThanOrEqual(20); expect(attempts).toBeGreaterThan(1);
  for (const response of [() => Response.json({ data: Array.from({ length: 8001 }, () => ({})) }),
    () => new Response('{}', { headers: { 'content-length': String(FINANCIAL_SMOKE_LIMITS.responseBytes + 1) } })]) {
    await expect(proveFinancialSourceFields({ confirmed: true, environment: { ...f.environment, fetch: async () => response() } }))
      .rejects.toMatchObject({ code: 'source_response_too_large' });
  }
});

test('deadline prevents the fourth dispatch at the minimum configured rate', async () => {
  const f = fixture();
  await expect(proveFinancialSourceFields({ confirmed: true, environment: f.environment, requestsPerMinute: 1 })).rejects.toThrow();
  expect(f.requests).toHaveLength(3);
});
