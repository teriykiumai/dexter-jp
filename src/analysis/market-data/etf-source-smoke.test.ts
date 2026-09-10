import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { validateCurrentEtfMasterV1 } from './technical-source-gate.js';
import { TechnicalSourceSmokeClientV1 } from './technical-source-smoke.js';
import { proveEtfSourceGateV1 } from './etf-source-smoke.js';

test('ETF gate requires explicit confirmation before credential access', () => {
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL('./etf-source-smoke.ts', import.meta.url))],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, JQUANTS_API_KEY: '' } });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
});

test('ETF current master freezes code/product/market and keeps rejection precedence', () => {
  for (const ticker of ['1321', '2633'] as const) {
    const row = { Date: '2026-09-09', Code: `${ticker}0`, ProdCat: '014', Mkt: '0109', CoName: '現在のETF名' };
    const validate = (rows: unknown) => validateCurrentEtfMasterV1(rows, { ticker, eligibleThrough: row.Date, environment: {} });
    expect(validate([row]).state).toBe('accepted');
    expect(validate([{ ...row, CoName: '新しい名称' }]).state).toBe('accepted');
    for (const [patch, reason] of [
      [{ Date: '2026-09-08', Code: '72030' }, 'effective_date_mismatch'],
      [{ Code: '72030', ProdCat: '011' }, 'code_mismatch'],
      [{ ProdCat: '011', Mkt: '0111' }, 'product_category_mismatch'],
      [{ Mkt: '0111' }, 'market_code_mismatch'], [{ CoName: ' ' }, 'blank_name'],
      [{ CoName: ' bad' }, 'invalid_name'],
    ] as const) expect(validate([{ ...row, ...patch }])).toEqual({ state: 'rejected', reason });
    expect(validate([])).toEqual({ state: 'rejected', reason: 'missing_row' });
    expect(validate([row, row])).toEqual({ state: 'rejected', reason: 'duplicate_row' });
  }
});

test('ETF smoke makes five queries with a single calendar and sanitized evidence', async () => {
  const paths: string[] = [];
  const client = new TechnicalSourceSmokeClientV1({ environment: {
    apiKey: () => 'fixture-key', processEnvironment: {}, wallNowMs: () => Date.parse('2026-09-09T08:00:00Z'),
    monotonicNowMs: () => 0,
    sleep: (_duration, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    fetch: async input => {
      const url = new URL(String(input)); paths.push(url.pathname);
      let data: unknown[];
      if (url.pathname.endsWith('calendar')) {
        data = [];
        for (let time = Date.parse('2016-09-09'); time <= Date.parse('2026-09-30'); time += 86400000) {
          const DateValue = new Date(time).toISOString().slice(0, 10);
          data.push({ Date: DateValue, HolDiv: DateValue === '2026-09-09' ? '1' : '0' });
        }
      } else if (url.pathname.endsWith('master')) data = [{ Date: '2026-09-09', Code: url.searchParams.get('code'),
        ProdCat: '014', Mkt: '0109', CoName: 'ETF', ignored: 'raw-secret' }];
      else data = [{ Date: '2026-09-09', Code: url.searchParams.get('code'), AdjO: 100, AdjH: 110, AdjL: 90,
        AdjC: 105, AdjVo: 0, AdjFactor: 1, ExRT: null }];
      return new Response(JSON.stringify({ data }));
    },
  }, requestsPerMinute: 500 });
  const result = await proveEtfSourceGateV1(client);
  expect(result.state).toBe('passed'); expect(result.totals.attempts).toBe(5);
  expect(paths.filter(path => path.endsWith('calendar'))).toHaveLength(1);
  expect(result.evidence.map(item => item.currentMaster.Code)).toEqual(['13210', '26330']);
  expect(JSON.stringify(result)).not.toContain('raw-secret');
  expect(JSON.stringify(result)).not.toContain('fixture-key');
});
