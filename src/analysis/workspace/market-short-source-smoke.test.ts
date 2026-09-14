import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { proveMarketShortSourceCoverageV1, MARKET_SHORT_SMOKE_LIMITS } from './market-short-source-smoke.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

function fixture() {
  // Synthetic distribution matching the public aggregates, never saved as provider evidence.
  const rows: Record<string, unknown>[] = MARKET_SHORT_COVERAGE_V1.codes.map(S33 => ({ Date: '2026-09-10', S33,
    SellExShortVa: 0, ShrtWithResVa: 0, ShrtNoResVa: 0 }));
  Object.assign(rows.at(-1)!, { SellExShortVa: 181_612.6e6, ShrtWithResVa: 104_849.6e6, ShrtNoResVa: 36_738.6e6 });
  Object.assign(rows[0]!, { SellExShortVa: (5_245_919 - 181_612.6) * 1e6,
    ShrtWithResVa: (2_948_443 - 104_849.6) * 1e6, ShrtNoResVa: (908_768 - 36_738.6) * 1e6 });
  const requests: { url: URL; init?: RequestInit }[] = [];
  const sleeps: number[] = [];
  let elapsed = 0;
  const environment: JQuantsExecutionEnvironmentV1 = {
    apiKey: () => 'fixture-secret', wallNowMs: () => Date.parse('2026-09-14T00:00:00Z'),
    monotonicNowMs: () => elapsed, sleep: async ms => { elapsed += ms; sleeps.push(ms); },
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      return new Response(JSON.stringify({ data: rows }));
    },
  };
  const run = (overrides: Partial<JQuantsExecutionEnvironmentV1> = {}, requestsPerMinute = 5) =>
    proveMarketShortSourceCoverageV1({ confirmed: true, environment: { ...environment, ...overrides }, requestsPerMinute });
  return { rows, requests, sleeps, environment, run };
}

test('confirmation precedes credentials and network; the CLI without flag is inert', async () => {
  const f = fixture();
  await expect(proveMarketShortSourceCoverageV1({ confirmed: false, environment: { ...f.environment,
    apiKey: () => { throw new Error('must not read'); } } })).rejects.toThrow('cancelled');
  expect(f.requests).toHaveLength(0);
  const child = Bun.spawnSync([process.execPath, fileURLToPath(new URL('./market-short-source-smoke.ts', import.meta.url))],
    { env: { ...process.env, JQUANTS_API_KEY: '' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  expect(child.exitCode).toBe(1); expect(child.stdout.toString()).toBe('');
  expect(JSON.parse(child.stderr.toString())).toEqual({ state: 'unavailable', code: 'cancelled' });
});

test('one date-only query proves 34-category coverage and rounded public totals without owner reassignment', async () => {
  const f = fixture(), result = await f.run();
  expect(result.state).toBe('passed');
  expect(result.metrics).toMatchObject({ attempts: 1, pages: 1, acceptedRows: 34 });
  expect(result.registry.scope).toBe('market-scoped');
  expect(result.productionModule).toBe('not_implemented');
  expect(result.historicalCoverage).toBe('not_verified');
  expect(result.comparison.state).toBe('matched');
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]!.url.toString()).toBe('https://api.jquants.com/v2/markets/short-ratio?date=2026-09-10');
  expect(f.requests[0]!.init?.redirect).toBe('error');
  expect(f.requests[0]!.init?.signal).toBeInstanceOf(AbortSignal);
});

test.each(['empty', 'missing_other', 'duplicate', 'null', 'wrong_total'])('%s cannot pass a coverage gate', async kind => {
  const f = fixture();
  if (kind === 'empty') f.rows.length = 0;
  if (kind === 'missing_other') f.rows.pop();
  if (kind === 'duplicate') f.rows.push({ ...f.rows[0]! });
  if (kind === 'null') f.rows[0]!.SellExShortVa = null;
  if (kind === 'wrong_total') f.rows[0]!.SellExShortVa = 1;
  expect((await f.run()).state).toBe('incomplete');
});

test('pagination preserves exact query and spacing, and digest is independent of page boundaries', async () => {
  const f = fixture(), baseline = await f.run();
  let pages = 0;
  const result = await f.run({ fetch: async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.jquants.com'); expect(init?.redirect).toBe('error');
    expect(url.searchParams.get('date')).toBe('2026-09-10');
    expect(url.searchParams.get('s33')).toBeNull();
    expect(url.searchParams.get('pagination_key')).toBe(pages === 0 ? null : 'cursor');
    return new Response(JSON.stringify(++pages === 1 ? { data: f.rows.slice(0, 17), pagination_key: 'cursor' }
      : { data: f.rows.slice(17) }));
  } }, 500);
  expect(result.result).toEqual(baseline.result);
  expect(result.metrics.pages).toBe(2); expect(result.requestsPerMinute).toBe(5);
  expect(f.sleeps).toEqual([12_000]);
});

test.each([401, 403, 429, 500])('HTTP %s does not retry or reveal source body', async status => {
  const f = fixture(); let attempts = 0;
  await expect(f.run({ fetch: async () => { attempts++; return new Response('private-secret', { status }); } }))
    .rejects.toThrow();
  expect(attempts).toBe(1);
});

test.each(['cycle', 'unending', 'rows', 'declared_bytes', 'streamed_bytes', 'invalid_json', 'duplicate_json_key',
  'unknown_envelope', 'unknown_field', 'unknown_code', 'network'])('transport or schema %s stays bounded and fail-closed', async kind => {
  const f = fixture(); let attempts = 0;
  const run = f.run({ fetch: async () => {
    attempts++;
    if (kind === 'network') throw new Error('private-secret');
    if (kind === 'cycle' || kind === 'unending') return Response.json({ data: [],
      pagination_key: kind === 'cycle' ? 'cursor' : String(attempts) });
    if (kind === 'rows') return Response.json({ data: Array.from({ length: 201 }, () => f.rows[0]) });
    if (kind === 'declared_bytes') return new Response('{}', { headers: { 'content-length': String(MARKET_SHORT_SMOKE_LIMITS.responseBytes + 1) } });
    if (kind === 'streamed_bytes') return new Response(' '.repeat(MARKET_SHORT_SMOKE_LIMITS.responseBytes + 1));
    if (kind === 'invalid_json') return new Response('private-secret');
    if (kind === 'duplicate_json_key') return new Response('{"data":[],"data":[]}');
    if (kind === 'unknown_envelope') return Response.json({ data: f.rows, secret: 'private-secret' });
    if (kind === 'unknown_field') f.rows[0]!.secret = 'private-secret';
    if (kind === 'unknown_code') f.rows[0]!.S33 = 'private-secret';
    return Response.json({ data: f.rows });
  } });
  try { await run; throw new Error('unexpected_success'); }
  catch (error) { expect(String(error)).not.toContain('private-secret'); expect(String(error)).not.toContain('unexpected_success'); }
  expect(attempts).toBe(kind === 'cycle' ? 2 : kind === 'unending' ? 5 : 1);
});

test('deadline prevents a second page at 1 request/minute and reports attempt counts', async () => {
  const f = fixture(); let attempts = 0;
  await expect(f.run({ fetch: async () => { attempts++; return Response.json({ data: [], pagination_key: 'cursor' }); } }, 1))
    .rejects.toThrow();
  expect(attempts).toBe(1); expect(f.sleeps).toEqual([60_000]);
});

test.each([0, 501, NaN, 1.5])('invalid rate %s is rejected before credentials', async rate => {
  const f = fixture();
  await expect(f.run({ apiKey: () => { throw new Error('must not read'); } }, rate)).rejects.toThrow('invalid_configuration');
  expect(f.requests).toHaveLength(0);
});

test('future sample cannot dispatch and schema failures expose only numeric diagnostics', async () => {
  const f = fixture();
  await expect(f.run({ wallNowMs: () => Date.parse('2026-09-10T00:00:00Z') })).rejects.toThrow('invalid_configuration');
  expect(f.requests).toHaveLength(0);
  f.rows[0]!.S33 = 'private-secret';
  let diagnostic: unknown;
  await expect(proveMarketShortSourceCoverageV1({ confirmed: true, environment: f.environment,
    observe: value => { diagnostic = value; } })).rejects.toThrow('source_response_invalid');
  expect(diagnostic).toMatchObject({ attempts: 1, pages: 1, acceptedRows: 34 });
  expect(JSON.stringify(diagnostic)).not.toContain('private-secret');
});
