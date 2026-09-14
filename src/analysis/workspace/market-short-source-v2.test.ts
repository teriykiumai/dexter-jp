import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { DashboardJobCoordinatorV1, type DashboardJobLeaseV1, type DashboardJobProjectionV1 } from '../dashboard-jobs/coordinator.js';
import { collectWorkspaceMarketShortV2, type MarketShortCollectionContextV2 } from './market-short-source-v2.js';
import { marketShortFixtureV2 } from './market-short-v2-test-fixtures.js';
import { MARKET_SHORT_LIMITS_V2, calculateMarketShortV2 } from './market-short-policy-v2.js';
import { WorkspaceMarketShortCodecV2 } from './market-short-artifact-v2.js';
import { retainWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { resolveReference } from './references.js';
import { fixtureCodecs, fixtureWorkspace } from './test-fixtures.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function fixture(date = '2026-09-11', acceptedAt = '2026-09-14T00:00:00.000Z') {
  const input = marketShortFixtureV2(date, acceptedAt), controller = new AbortController();
  const requests: { url: URL; init?: RequestInit; at: number }[] = [], sleeps: number[] = [];
  const progress: { pages: number; acceptedRows: number; responseBytes: number }[] = [];
  let elapsed = 0, credentials = 0, dispatches = 0;
  const environment: Mutable<JQuantsExecutionEnvironmentV1> = {
    wallNowMs: () => Date.parse(acceptedAt) + elapsed, monotonicNowMs: () => elapsed,
    sleep: async ms => { elapsed += ms; sleeps.push(ms); }, apiKey: () => { credentials++; return 'fixture-secret'; },
    fetch: async (url, init) => {
      requests.push({ url: new URL(String(url)), init, at: elapsed });
      return Response.json({ data: String(url).includes('/calendar') ? input.calendar.rows : input.rows });
    },
  };
  const context: Mutable<MarketShortCollectionContextV2> = { jobId: randomUUID(), acceptedAt, signal: controller.signal,
    monotonicOriginMs: 0, requestsPerMinute: 5, dispatch: async start => { dispatches++; return start(controller.signal); },
    shareSource: async () => { throw new Error('must not reuse an old observation'); },
    waitBeforeRetry: async () => { throw new Error('must not use owner retry'); }, recordProgress: p => { progress.push(p); } };
  return { input, environment, context, controller, requests, sleeps, progress,
    advance: (ms: number) => { elapsed += ms; }, counts: () => ({ credentials, dispatches }),
    run: () => collectWorkspaceMarketShortV2(date, context, environment) };
}

test('calendar then date-only market query produce exact V2 input through the admitted dispatcher', async () => {
  const f = fixture(); f.input.rows.reverse(); const input = await f.run();
  expect(f.requests.map(r => r.url.toString())).toEqual([
    'https://api.jquants.com/v2/markets/calendar?from=2026-09-11&to=2026-09-11',
    'https://api.jquants.com/v2/markets/short-ratio?date=2026-09-11',
  ]);
  expect(f.counts()).toEqual({ credentials: 1, dispatches: 2 }); expect(f.sleeps).toEqual([12_000]);
  expect(input.execution).toMatchObject({ attempts: 2, pages: 2, acceptedRows: 35, elapsedMs: 12_000, requestsPerMinute: 5, retries: 0 });
  expect(input.execution.responseBytes).toBe(f.progress.reduce((sum, p) => sum + p.responseBytes, 0));
  expect(input.source.fetchedAt).toBe('2026-09-14T00:00:12.000Z');
  expect(calculateMarketShortV2(input).qualification.reconciliation.state).toBe('approximate');
  expect(JSON.stringify(input)).not.toContain('fixture-secret');
  for (const request of f.requests) {
    expect(request.init?.headers).toEqual({ 'x-api-key': 'fixture-secret' });
    expect(request.init?.redirect).toBe('error'); expect(request.init?.signal).toBeInstanceOf(AbortSignal);
  }
});

test.each(['2026-09-14T08:29:59.999Z', '2026-09-13T15:00:00.000Z'])('before cutoff %s stops before credentials', async acceptedAt => {
  const f = fixture('2026-09-14', acceptedAt); await expect(f.run()).rejects.toThrow();
  expect(f.counts()).toEqual({ credentials: 0, dispatches: 0 });
});
test.each(['2026-09-14T08:30:00.000Z', '2026-09-14T15:00:00.000Z'])('cutoff/next-day %s uses the same policy and warnings', async acceptedAt => {
  const f = fixture('2026-09-14', acceptedAt), q = calculateMarketShortV2(await f.run()).qualification;
  expect(q.warnings).toEqual(['provider_completion_not_guaranteed', 'not_point_in_time_history']);
});
test.each(['0', '3'] as const)('official non-session %s stops before market dispatch', async HolDiv => {
  const f = fixture(); f.input.calendar.rows[0]!.HolDiv = HolDiv; await expect(f.run()).rejects.toThrow();
  expect(f.requests).toHaveLength(1);
});
test.each(['empty', 'duplicate', 'wrong_date', 'unknown_field', 'unknown_division'])('calendar %s fails closed before market fetch', async kind => {
  const f = fixture(); const row = f.input.calendar.rows[0]!;
  f.environment.fetch = async () => {
    const rows = kind === 'empty' ? [] : kind === 'duplicate' ? [row, row] : kind === 'wrong_date' ? [{ ...row, Date: '2026-09-10' }]
      : kind === 'unknown_field' ? [{ ...row, secret: 'private-secret' }] : [{ ...row, HolDiv: '9' }];
    return Response.json({ data: rows });
  };
  await expect(f.run()).rejects.toThrow(); expect(f.counts().dispatches).toBe(1);
});

test('pagination and reversed rows preserve qualification and shared counts across both queries', async () => {
  const f = fixture(); const original = f.environment.fetch; let page = 0;
  f.context.requestsPerMinute = 500;
  f.environment.fetch = async (url, init) => String(url).includes('/calendar') ? original(url, init)
    : Response.json(++page === 1 ? { data: f.input.rows.slice(17).reverse(), pagination_key: 'cursor' }
      : { data: f.input.rows.slice(0, 17).reverse() });
  const input = await f.run();
  expect(input.execution).toMatchObject({ attempts: 3, pages: 3, acceptedRows: 35, elapsedMs: 24_000, requestsPerMinute: 5 });
  expect(input.rows).toEqual(f.input.rows); expect(f.sleeps).toEqual([12_000, 12_000]);
});
test('the final allowed page succeeds, and an early timer wakeup cannot dispatch too soon', async () => {
  const f = fixture(), original = f.environment.fetch; let page = 0, wakes = 0;
  f.environment.sleep = async ms => { f.advance(++wakes === 1 ? ms - 1 : ms); };
  f.environment.fetch = async (url, init) => {
    if (String(url).includes('/calendar')) return original(url, init);
    const params = new URL(String(url)).searchParams;
    expect(params.get('pagination_key')).toBe(page ? String(page) : null);
    expect([...params.keys()].sort()).toEqual(page ? ['date', 'pagination_key'] : ['date']);
    page++; return Response.json({ data: page === 4 ? f.input.rows : [], ...(page < 4 ? { pagination_key: String(page) } : {}) });
  };
  const input = await f.run();
  expect(input.execution).toMatchObject({ attempts: 5, pages: 5, elapsedMs: 48_000, acceptedRows: 35 });
  expect(wakes).toBe(5);
});
test.each([2, 4])('lower configured rate %s is retained', async rpm => {
  const f = fixture(); f.context.requestsPerMinute = rpm; const input = await f.run();
  expect(f.sleeps).toEqual([60_000 / rpm]); expect(input.execution.requestsPerMinute).toBe(rpm);
});
test('controls are frozen across awaits and cancellation during spacing prevents the next request', async () => {
  const f = fixture(), original = f.environment.fetch;
  f.environment.fetch = async (url, init) => {
    const response = await original(url, init);
    f.context.acceptedAt = '2026-09-14T00:01:00.000Z'; f.context.monotonicOriginMs = 60_000; f.context.requestsPerMinute = 1;
    return response;
  };
  const input = await f.run();
  expect(input.acceptedAt).toBe('2026-09-14T00:00:00.000Z');
  expect(input.execution).toMatchObject({ requestsPerMinute: 5, elapsedMs: 12_000 });
  const cancelled = fixture(); cancelled.environment.sleep = async () => { cancelled.controller.abort(); };
  await expect(cancelled.run()).rejects.toThrow(); expect(cancelled.requests).toHaveLength(1);
});
test.each([0, 501, NaN, 1.5, 1])('invalid/infeasible rate %s makes no request', async rpm => {
  const f = fixture(); f.context.requestsPerMinute = rpm; await expect(f.run()).rejects.toThrow();
  expect(f.counts()).toEqual({ credentials: 0, dispatches: 0 });
});
test.each(['expired', 'late_entry', 'future_origin', 'wall_before_admission', 'cancelled', 'future_date'])('%s stops before credentials', async kind => {
  const f = fixture(kind === 'future_date' ? '2026-09-15' : '2026-09-11');
  if (kind === 'expired') f.advance(60_000);
  if (kind === 'late_entry') f.advance(48_000);
  if (kind === 'future_origin') f.context.monotonicOriginMs = 1;
  if (kind === 'wall_before_admission') f.environment.wallNowMs = () => Date.parse(f.context.acceptedAt) - 1;
  if (kind === 'cancelled') f.controller.abort();
  await expect(f.run()).rejects.toThrow(); expect(f.counts()).toEqual({ credentials: 0, dispatches: 0 });
});

test.each([401, 403, 429, 500])('HTTP %s cannot retry or leak source text', async status => {
  const f = fixture(); f.environment.fetch = async () => new Response('private-secret', { status });
  await expect(f.run()).rejects.toThrow(); expect(f.counts().dispatches).toBe(1);
});
test.each(['cycle', 'unending', 'rows', 'declared_bytes', 'streamed_bytes', 'invalid_json', 'duplicate_json_key', 'unknown_envelope',
  'unknown_field', 'unknown_category', 'missing', 'duplicate', 'null', 'negative', 'overflow', 'wrong_date', 'network'])('%s returns no eligible input', async kind => {
  const f = fixture(), original = f.environment.fetch; let pages = 0;
  f.environment.fetch = async (url, init) => {
    if (String(url).includes('/calendar')) return original(url, init);
    pages++;
    if (kind === 'network') throw new Error('private-secret');
    if (kind === 'cycle' || kind === 'unending') return Response.json({ data: [], pagination_key: kind === 'cycle' ? 'cursor' : String(pages) });
    if (kind === 'rows') return Response.json({ data: Array.from({ length: 200 }, () => f.input.rows[0]) });
    if (kind === 'declared_bytes') return new Response('{}', { headers: { 'content-length': String(MARKET_SHORT_LIMITS_V2.responseBytes) } });
    if (kind === 'streamed_bytes') return new Response(' '.repeat(MARKET_SHORT_LIMITS_V2.responseBytes));
    if (kind === 'invalid_json') return new Response('private-secret');
    if (kind === 'duplicate_json_key') return new Response('{"data":[],"data":[]}');
    if (kind === 'unknown_envelope') return Response.json({ data: f.input.rows, extra: 'private-secret' });
    const first = f.input.rows[0]!;
    const row = kind === 'unknown_field' ? { ...first, extra: 'private-secret' } : kind === 'unknown_category' ? { ...first, S33: 'private-secret' }
      : kind === 'null' ? { ...first, SellExShortVa: null } : kind === 'negative' ? { ...first, SellExShortVa: -1 }
        : kind === 'overflow' ? { ...first, SellExShortVa: Number.MAX_VALUE } : kind === 'wrong_date' ? { ...first, Date: '2026-09-10' } : first;
    return Response.json({ data: kind === 'missing' ? f.input.rows.slice(1) : kind === 'duplicate' ? [...f.input.rows, first] : [row, ...f.input.rows.slice(1)] });
  };
  try { await f.run(); throw new Error('unexpected_success'); }
  catch (error) { expect(String(error)).not.toContain('private-secret'); expect(String(error)).not.toContain('unexpected_success'); }
  expect(f.counts().dispatches).toBe(kind === 'cycle' ? 3 : kind === 'unending' ? 5 : 2);
});

test('queued owner callback cannot fetch after deadline, and cancellation settles even an uncooperative fetch', async () => {
  const queued = fixture(); queued.context.dispatch = async start => { queued.advance(60_000); return start(queued.controller.signal); };
  await expect(queued.run()).rejects.toThrow(); expect(queued.requests).toHaveLength(0);
  const f = fixture(); f.environment.fetch = async () => { f.controller.abort(); return new Promise<Response>(() => {}); };
  await expect(f.run()).rejects.toThrow(); expect(f.counts().dispatches).toBe(1);
});
test('request duration is capped separately from the total budget', async () => {
  const f = fixture(), fetch = f.environment.fetch;
  f.environment.fetch = async (url, init) => { f.advance(30_000); return fetch(url, init); };
  await expect(f.run()).rejects.toThrow(); expect(f.counts().dispatches).toBe(1);
});
test('a stalled body is rejected by the real 30-second watchdog without retry', async () => {
  const f = fixture(); let requestSignal: AbortSignal | null | undefined;
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  f.environment.fetch = async (_url, init) => {
    requestSignal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
  };
  try {
    await expect(f.run()).rejects.toMatchObject({ code: 'source_timeout' });
    expect(requestSignal?.aborted).toBe(true); expect(f.counts().dispatches).toBe(1);
  } finally { f.controller.abort(); body?.close(); }
}, 35_000);

test('real shared coordinator retains both attempts and rejects use after lease release', async () => {
  const f = fixture(), coordinator = new DashboardJobCoordinatorV1(f.environment, 5);
  let record: DashboardJobProjectionV1 | undefined;
  for (const domain of ['strategy_validation', 'market_data'] as const) coordinator.register({ domain,
    inventory: async () => domain === 'market_data' && record ? [record] : [], isAbsent: async () => !record,
    cleanup: async () => {}, reconcile: async () => { throw new Error('unexpected recovery'); } });
  await coordinator.initialize(); let lease!: DashboardJobLeaseV1;
  // An existing kind exercises the dispatcher seam, not a new Dashboard job route.
  await coordinator.admit({ kind: 'overview_refresh', jobId: f.context.jobId, revalidate() {},
    create: async value => { record = { domain: 'market_data', kind: value.kind, jobId: value.jobId, terminal: false };
      return { state: 'published', record }; }, adopt: value => { lease = value; } });
  Object.assign(f.context, { acceptedAt: new Date(lease.acceptedAtMs).toISOString(), monotonicOriginMs: lease.monotonicOriginMs,
    requestsPerMinute: coordinator.requestsPerMinute, signal: lease.signal });
  f.context.dispatch = (start, signal) => coordinator.dispatch(lease, () => {}, () => start(lease.signal), signal);
  await f.run();
  await coordinator.exclusive(async () => {
    record = { ...record!, terminal: true }; await coordinator.afterReplace(lease, { state: 'published', record });
  });
  await expect(coordinator.admit({ kind: 'overview_refresh', jobId: randomUUID(), revalidate() {},
    create: async () => { throw new Error('must not admit during cooldown'); }, adopt() {} })).rejects.toMatchObject({ reason: 'cooldown' });
  await expect(f.run()).rejects.toMatchObject({ reason: 'recovery_required' });
  expect(f.requests).toHaveLength(2);
});

test('collector output publishes, binds and restores the exact qualified reference offline', async () => {
  const f = fixture('2026-09-10'), workspace = await fixtureWorkspace(), codec = new WorkspaceMarketShortCodecV2();
  f.input.rows.forEach(row => { row.SellExShortVa = row.ShrtWithResVa = row.ShrtNoResVa = 0; });
  Object.assign(f.input.rows[0]!, { SellExShortVa: 5_245_919_759_105, ShrtWithResVa: 2_948_443_262_888, ShrtNoResVa: 908_768_748_764 });
  let restored: WorkspaceDatabase | undefined;
  try {
    const input = await f.run(), inputRef = await retainWorkspaceObject(workspace.db, input.version, input);
    const repository = new MarketDataRepositoryV1(codec, resolve(workspace.directory, 'market-data'));
    const saved = await repository.publish(codec.build(input, inputRef, input.acceptedAt),
      { jobId: f.context.jobId, acceptedAt: input.acceptedAt, checkedAt: input.source.fetchedAt });
    const artifact = await retainWorkspaceObject(workspace.db, saved.artifact.schemaVersion, saved.artifact);
    const receipt = await retainWorkspaceObject(workspace.db, 'workspace_market_short_receipt_v2',
      { version: 'workspace_market_short_receipt_v2', artifact, observationInput: inputRef, receipt: saved.receipt });
    workspace.repository.bindContext(input.scope, artifact, receipt, 'market_short');
    const q = saved.artifact.qualification;
    expect(q.reconciliation.state).toBe('approximate');
    expect(q.reconciliation.differences![0]!.cells.at(-1)!.differenceJPY).toBe(1_770_757);
    const packageRoot = resolve(workspace.directory, 'package'), target = resolve(workspace.directory, 'restored');
    const codecs = new Map([...fixtureCodecs, ...workspaceDataCodecs]);
    workspace.db.close(); backupWorkspace(workspace.root, packageRoot, codecs); restoreWorkspace(packageRoot, target, codecs);
    restored = new WorkspaceDatabase(target);
    expect(new WorkspaceRepository(restored).current(input.scope, 'market_short')).toEqual(artifact);
    const roundtrip = JSON.parse(new TextDecoder().decode(resolveReference(restored, inputRef, codecs).bytes));
    expect(calculateMarketShortV2(roundtrip).qualification).toEqual(q);
    expect(f.counts().dispatches).toBe(2);
  } finally { restored?.close(); workspace.dispose(); }
});
