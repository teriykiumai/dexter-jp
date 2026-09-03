import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  absentMarketDataJobAdapterV1, dashboardCoordinatorFailureV1, DashboardJobCoordinatorErrorV1,
  DashboardJobCoordinatorV1, type DashboardJobAdapterV1, type DashboardJobDomainV1,
  type DashboardJobKindV1, type DashboardJobLeaseV1, type DashboardJobProjectionV1,
} from './coordinator.js';
import { acceptJQuantsExecutionV1, JQuantsExecutionRuntimeV1, planJQuantsExecutionV1, type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const kinds = ['strategy_validation', 'technical_refresh', 'overview_refresh'] as const;
function projection(kind: DashboardJobKindV1, terminal = false): DashboardJobProjectionV1 {
  return { domain: kind === 'strategy_validation' ? kind : 'market_data', kind, jobId: randomUUID(), terminal };
}
function adapter(domain: DashboardJobDomainV1) {
  const records = new Map<string, DashboardJobProjectionV1>();
  let corrupt = false;
  let cleanupCount = 0;
  let reconcileCount = 0;
  const value: DashboardJobAdapterV1 = {
    domain, inventory: async () => { if (corrupt) throw new Error('private path'); return [...records.values()]; },
    isAbsent: async id => !records.has(id),
    cleanup: async () => { cleanupCount++; },
    reconcile: async job => { reconcileCount++; records.set(job.jobId, { ...job, terminal: true }); },
  };
  return { value, records, setCorrupt: (value: boolean) => { corrupt = value; },
    effects: () => ({ cleanupCount, reconcileCount }) };
}
function harness(rate = 5) {
  let monotonic = 0;
  let wall = Date.parse('2026-09-03T00:00:00.000Z');
  const dispatches: number[] = [];
  const environment: JQuantsExecutionEnvironmentV1 = {
    monotonicNowMs: () => monotonic, wallNowMs: () => wall, apiKey: () => 'synthetic-key',
    fetch: async () => { dispatches.push(monotonic); return Response.json({ data: [] }); },
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw new Error('cancelled');
      if (ms === 30_000 && signal) return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
      monotonic += ms; wall += ms;
    },
  };
  const strategy = adapter('strategy_validation');
  const market = adapter('market_data');
  const coordinator = new DashboardJobCoordinatorV1(environment, rate);
  coordinator.register(strategy.value); coordinator.register(market.value);
  const owner = (kind: DashboardJobKindV1) => kind === 'strategy_validation' ? strategy : market;
  const begin = async (kind: DashboardJobKindV1) => {
    const job = projection(kind);
    let lease!: DashboardJobLeaseV1;
    await coordinator.admit({ kind, jobId: job.jobId, revalidate() {},
      create: async () => { owner(kind).records.set(job.jobId, job); return { state: 'published', record: job }; },
      adopt: value => { lease = value; },
    });
    return lease;
  };
  const finish = async (lease: DashboardJobLeaseV1) => coordinator.exclusive(async () => {
    const next = { ...owner(lease.kind).records.get(lease.jobId)!, terminal: true };
    owner(lease.kind).records.set(lease.jobId, next);
    await coordinator.afterReplace(lease, { state: 'published', record: next });
  });
  return { coordinator, strategy, market, owner, begin, finish, environment, dispatches,
    advance(ms: number) { monotonic += ms; wall += ms; }, setMonotonic(ms: number) { monotonic = ms; },
    setWall(ms: number) { wall = ms; }, now: () => monotonic };
}

describe('Dashboard shared admission and recovery', () => {
  for (const first of kinds) for (const next of kinds) {
    test(`${first} -> ${next}: single lease, retained actual-attempt cooldown, exact boundary`, async () => {
      const h = harness(); await h.coordinator.initialize();
      const lease = await h.begin(first);
      await expect(h.begin(next)).rejects.toMatchObject({ reason: 'active_job_conflict', retryAfterSeconds: undefined, activeKind: first });
      await h.coordinator.dispatch(lease, () => {}, async () => {});
      h.advance(100);
      await h.coordinator.dispatch(lease, () => {}, async () => {});
      await h.finish(lease);
      expect(await h.coordinator.exclusive(() => h.coordinator.active())).toBeNull();
      h.advance(59_899); // newest attempt is only 59,899 ms old
      await expect(h.begin(next)).rejects.toMatchObject({ reason: 'cooldown', retryAfterSeconds: 1 });
      h.advance(100);
      await expect(h.begin(next)).rejects.toMatchObject({ reason: 'cooldown', retryAfterSeconds: 1 });
      h.advance(1);
      const fresh = await h.begin(next);
      expect(fresh.monotonicOriginMs).toBe(60_100);
      await expect(h.coordinator.dispatch(lease, () => {}, async () => {})).rejects.toMatchObject({ reason: 'recovery_required' });
      await h.finish(fresh);
    });
  }

  test.each([1, 2, 5])('two runtime instances cannot bypass the R=%d process log', async rate => {
    const h = harness(rate); await h.coordinator.initialize(); const lease = await h.begin('strategy_validation');
    const accepted = acceptJQuantsExecutionV1(planJQuantsExecutionV1(1, rate), h.environment);
    const options = { environment: h.environment, dashboardDispatch: {
      assertCanContinue: () => h.coordinator.assertOwner(lease),
      dispatch: <T>(check: (waitMs?: number) => void, start: () => Promise<T>, signal?: AbortSignal) => h.coordinator.dispatch(lease, check, start, signal),
    } };
    const runtimes = [new JQuantsExecutionRuntimeV1(accepted, options), new JQuantsExecutionRuntimeV1(accepted, options)];
    for (let i = 0; i <= rate; i++) await runtimes[i % 2].getAll('/v2/markets/calendar', { from: `2025-01-${String(i + 1).padStart(2, '0')}`, to: '2025-02-01' });
    expect(h.dispatches).toEqual([...Array(rate).fill(0), 60_000]);
    await h.finish(lease);
    await expect(h.begin('overview_refresh')).rejects.toMatchObject({ reason: 'cooldown', retryAfterSeconds: 60 });
  });

  test('failed/cancelled attempts remain, but zero-dispatch jobs impose no cooldown', async () => {
    const h = harness(); await h.coordinator.initialize();
    const empty = await h.begin('technical_refresh'); await h.finish(empty);
    const failing = await h.begin('overview_refresh');
    await expect(h.coordinator.dispatch(failing, () => {}, async () => { throw new Error('network'); })).rejects.toThrow('network');
    await h.finish(failing);
    await expect(h.begin('strategy_validation')).rejects.toMatchObject({ reason: 'cooldown' });
    h.setWall(0); h.advance(60_000);
    const cancelled = await h.begin('strategy_validation');
    await h.coordinator.dispatch(cancelled, () => {}, async () => {});
    await h.finish(cancelled);
    await expect(h.begin('technical_refresh')).rejects.toMatchObject({ reason: 'cooldown' });
  });

  test('clock failures occur before reservation or create and never erase retained timestamps', async () => {
    const h = harness(); await h.coordinator.initialize();
    h.setMonotonic(100); const lease = await h.begin('strategy_validation'); await h.finish(lease);
    for (const time of [99, NaN, Infinity]) {
      h.setMonotonic(time);
      await expect(h.begin('overview_refresh')).rejects.toMatchObject({ reason: 'clock_invalid' });
      expect(h.market.records.size).toBe(0);
    }
    h.setMonotonic(100); const fresh = await h.begin('overview_refresh'); await h.finish(fresh);
  });

  test('simultaneous retries acquire once and revalidate after awaited idle proofs', async () => {
    const h = harness(); await h.coordinator.initialize();
    const results = await Promise.allSettled([h.begin('technical_refresh'), h.begin('overview_refresh')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const other = harness(); await other.coordinator.initialize(); let validations = 0; let writes = 0;
    await expect(other.coordinator.admit({ kind: 'strategy_validation', jobId: randomUUID(),
      revalidate: () => { if (++validations === 2) throw new Error('expired'); },
      create: async () => { writes++; return { state: 'definitely_not_published' }; }, adopt() {},
    })).rejects.toThrow('expired');
    expect(writes).toBe(0);
  });

  test.each(['zero', 'one-strategy', 'one-market', 'two-strategy', 'two-domains', 'corrupt'] as const)('combined startup: %s', async scenario => {
    const h = harness();
    if (scenario.includes('strategy') || scenario === 'two-domains') {
      const job = projection('strategy_validation'); h.strategy.records.set(job.jobId, job);
    }
    if (scenario === 'two-strategy') { const job = projection('strategy_validation'); h.strategy.records.set(job.jobId, job); }
    if (scenario === 'one-market' || scenario === 'two-domains') { const job = projection('technical_refresh'); h.market.records.set(job.jobId, job); }
    if (scenario === 'corrupt') h.market.setCorrupt(true);
    await h.coordinator.initialize();
    if (scenario.startsWith('two') || scenario === 'corrupt') {
      expect(() => h.coordinator.assertHealthy()).toThrow(DashboardJobCoordinatorErrorV1);
      expect(h.strategy.effects()).toEqual({ cleanupCount: 0, reconcileCount: 0 });
      expect(h.market.effects()).toEqual({ cleanupCount: 0, reconcileCount: 0 });
      h.market.setCorrupt(false); h.strategy.records.clear(); h.market.records.clear();
      await h.coordinator.initialize();
      expect(() => h.coordinator.assertHealthy()).toThrow(); // no live repair
    } else {
      expect(() => h.coordinator.assertHealthy()).not.toThrow();
      expect(h.strategy.effects().reconcileCount + h.market.effects().reconcileCount).toBe(scenario === 'zero' ? 0 : 1);
    }
  });

  test.each(['unpublished', 'ambiguous', 'throw', 'other-domain', 'inventory-failure', 'adopt-failure'] as const)('creation proof: %s', async scenario => {
    const h = harness(); await h.coordinator.initialize(); let queued = 0;
    const job = projection('strategy_validation');
    await expect(h.coordinator.admit({ kind: job.kind, jobId: job.jobId, revalidate() {},
      create: async () => {
        if (scenario === 'throw') throw new Error('unknown write outcome');
        if (scenario === 'other-domain') { const other = projection('overview_refresh'); h.market.records.set(other.jobId, other); }
        if (scenario === 'inventory-failure') h.market.setCorrupt(true);
        if (scenario === 'adopt-failure') { h.strategy.records.set(job.jobId, job); return { state: 'published', record: job }; }
        return { state: scenario === 'ambiguous' ? 'ambiguous' : 'definitely_not_published' };
      }, adopt: () => { if (scenario === 'adopt-failure') throw new Error('queue failed'); queued++; },
    })).rejects.toMatchObject({ reason: scenario === 'unpublished' ? 'publication_failed' : 'recovery_required' });
    expect(queued).toBe(0);
    if (scenario === 'unpublished') await h.begin('overview_refresh');
    else {
      h.market.setCorrupt(false); h.market.records.clear(); h.strategy.records.clear();
      await expect(h.begin('overview_refresh')).rejects.toMatchObject({ reason: 'recovery_required' });
    }
  });

  test.each(['ambiguous', 'definitely_not_published', 'terminal-inventory-failure'] as const)('replace failure retains blocker and aborts live lease: %s', async scenario => {
    const h = harness(); await h.coordinator.initialize(); const lease = await h.begin('technical_refresh');
    const record = { ...h.market.records.get(lease.jobId)!, terminal: true };
    h.market.records.set(record.jobId, record);
    if (scenario === 'terminal-inventory-failure') h.strategy.setCorrupt(true);
    await expect(h.coordinator.exclusive(() => h.coordinator.afterReplace(lease,
      scenario === 'terminal-inventory-failure' ? { state: 'published', record } : { state: scenario },
    ))).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(lease.signal.aborted).toBe(true);
    let dispatched = 0;
    await expect(h.coordinator.dispatch(lease, () => {}, async () => { dispatched++; })).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(dispatched).toBe(0);
  });

  test('missing adapter and nonempty/invalid absent-domain slots block without cleanup', async () => {
    const h = harness(); const missing = new DashboardJobCoordinatorV1(h.environment, 5);
    missing.register(h.strategy.value); await missing.initialize(); expect(() => missing.assertHealthy()).toThrow();
    const root = await mkdtemp(join(tmpdir(), 'dexter-absence-')); roots.push(root);
    const probe = absentMarketDataJobAdapterV1(join(root, 'market-data', 'jobs'));
    expect(await probe.inventory()).toEqual([]);
    await mkdir(join(root, 'market-data', 'jobs'), { recursive: true });
    expect(await probe.inventory()).toEqual([]);
    await writeFile(join(root, 'market-data', 'jobs', 'unknown.tmp'), 'retain');
    await expect(probe.inventory()).rejects.toThrow();
  });

  test('safe mappings retain native vocabularies and exact cooldown seconds only', () => {
    for (const domain of ['strategy_validation', 'market_data'] as const) {
      const recovery = dashboardCoordinatorFailureV1(new DashboardJobCoordinatorErrorV1('recovery_required'), domain);
      expect(recovery).toMatchObject({ status: 500, code: domain === 'strategy_validation' ? 'artifact_unavailable' : 'repository_failure' });
      expect(recovery.retryAfterSeconds).toBeUndefined();
      expect(dashboardCoordinatorFailureV1(new DashboardJobCoordinatorErrorV1('cooldown', 7), domain)).toEqual({ status: 409,
        code: 'active_job_conflict', retryAfterSeconds: 7, message: 'J-Quantsの通信間隔を確保するため、あと 7 秒待って再度実行してください。ジョブは未受付です。' });
    }
    expect(planJQuantsExecutionV1(90, 1).minimumDispatchDurationMs).toBe(5_340_000);
    expect(planJQuantsExecutionV1(91, 1).minimumScheduleFeasible).toBe(false);
    expect(planJQuantsExecutionV1(180, 2).minimumScheduleFeasible).toBe(true);
    expect(planJQuantsExecutionV1(181, 2).minimumScheduleFeasible).toBe(false);
  });
});
