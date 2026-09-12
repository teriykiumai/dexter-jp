import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { proveWorkspaceSourceFields } from './source-smoke.js';
import { TechnicalSourceSmokeClientV1, type TechnicalSourceSmokeEnvironmentV1 } from '../market-data/technical-source-smoke.js';

function fixture(change: (path: string, rows: Record<string, unknown>[]) => void = () => {}) {
  const requests: URL[] = [];
  const environment: TechnicalSourceSmokeEnvironmentV1 = {
    apiKey: () => 'fixture-key', processEnvironment: {}, wallNowMs: () => Date.parse('2026-09-11T08:00:00.000Z'),
    monotonicNowMs: () => 0,
    sleep: (_ms, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })),
    fetch: async input => {
      const url = new URL(String(input)); requests.push(url);
      let rows: Record<string, unknown>[] = [];
      if (url.pathname.endsWith('/master')) rows = [
        { Date: '2026-09-11', Code: '72030', CoName: 'Fixture', Mkt: '0111', ProdCat: '011' },
        { Date: '2026-09-11', Code: '13210', CoName: 'ETF', Mkt: '0109', ProdCat: '014' }];
      else for (let time = Date.parse(`${url.searchParams.get('from')}T00:00:00Z`);
        time <= Date.parse(`${url.searchParams.get('to')}T00:00:00Z`); time += 86_400_000) {
        const date = new Date(time), DateValue = date.toISOString().slice(0, 10);
        const session = date.getUTCDay() !== 0 && date.getUTCDay() !== 6;
        if (url.pathname.endsWith('/calendar')) rows.push({ Date: DateValue, HolDiv: session ? '1' : '0' });
        else if (session) rows.push({ Date: DateValue, Code: '72030', O: 100, H: 110, L: 90, C: 105, Vo: 1000,
          AdjO: 50, AdjH: 55, AdjL: 45, AdjC: 52.5, AdjVo: 2000, AdjFactor: 1, ExRT: null });
      }
      change(url.pathname, rows);
      return new Response(JSON.stringify({ data: rows }));
    },
  };
  return { client: new TechnicalSourceSmokeClientV1({ environment, requestsPerMinute: 500 }), requests };
}

test('Workspace smoke refuses before credentials/network without explicit flag', () => {
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL('./source-smoke.ts', import.meta.url))],
    { env: { ...process.env, JQUANTS_API_KEY: '' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe('');
  expect(JSON.parse(result.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
});
test('bounded catalog/raw-price gate excludes ETF and does not claim historical identity', async () => {
  const f = fixture(); const result = await proveWorkspaceSourceFields(f.client);
  expect(result.ordinaryStockCount).toBe(1); expect(result.dailyRowCount).toBeGreaterThan(20);
  expect(result.historicalIdentity).toBe('not_verified');
  expect(result.maximumTenYearEntitlement).toBe('not_tested');
  expect(f.requests).toHaveLength(3);
  expect([...f.requests[1]!.searchParams.keys()]).toEqual(['date']);
  expect(JSON.stringify(result)).not.toContain('fixture-key');
  expect(JSON.stringify(result)).not.toContain('Fixture');
});
test.each(['duplicate', 'date', 'raw_missing', 'raw_invalid'])('Workspace gate fails closed for %s', async kind => {
  const f = fixture((path, rows) => {
    if (path.endsWith('/master')) {
      if (kind === 'duplicate') rows.push(rows[0]!);
      if (kind === 'date') rows[0]!.Date = '2026-09-10';
    } else if (path.endsWith('/daily')) {
      if (kind === 'raw_missing') delete rows[0]!.O;
      if (kind === 'raw_invalid') rows[0]!.H = 1;
    }
  });
  let error: unknown; try { await proveWorkspaceSourceFields(f.client); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error);
});
test('catalog access does not relax legacy Technical master query selectors', async () => {
  const f = fixture();
  let error: unknown; try { await f.client.getAll('/v2/equities/master', { date: '2026-09-11' }); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error); expect(f.requests).toHaveLength(0);
  await f.client.getCatalog('2026-09-11'); expect(f.requests).toHaveLength(1);
});
