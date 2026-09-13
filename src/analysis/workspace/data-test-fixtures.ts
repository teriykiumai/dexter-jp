import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { WorkspaceDataJobs } from './data-jobs.js';
import { DashboardJobCoordinatorV1 } from '../dashboard-jobs/coordinator.js';
import { MarketDataJobServiceV1 } from '../market-data/job-service.js';
import { MarketDataJobRepositoryV1 } from '../market-data/job-repository.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';

export async function workspaceDataFixture(checkpoint?: ConstructorParameters<typeof WorkspaceDataJobs>[3], fullHistory = false,
  storage?: { directory: string; preserve: boolean }) {
  const directory = storage?.directory ?? mkdtempSync(resolve(tmpdir(), 'dexter-workspace-data-'));
  const root = resolve(directory, 'workspace'), artifacts = resolve(directory, 'market-data');
  let wall = Date.parse('2026-09-11T08:00:00.000Z'), monotonic = 0, calls = 0;
  let transform: (path: string, rows: Record<string, unknown>[]) => void = () => {};
  const environment: JQuantsExecutionEnvironmentV1 = {
    apiKey: () => 'synthetic-key', wallNowMs: () => wall, monotonicNowMs: () => monotonic,
    sleep: async ms => { wall += ms; monotonic += ms; }, fetch: async input => {
      calls++; const url = new URL(String(input)), calendar = url.pathname.endsWith('/calendar');
      const rows: Record<string, unknown>[] = [];
      if (url.pathname.endsWith('/master')) rows.push({ Date: url.searchParams.get('date'), Code: '72030', CoName: 'Synthetic', Mkt: '0111', ProdCat: '011' });
      else {
        const from = calendar || fullHistory ? url.searchParams.get('from')! : '2026-07-01', to = url.searchParams.get('to')!;
        for (let time = Date.parse(from); time <= Date.parse(to); time += 86_400_000) {
          const d = new Date(time), DateValue = d.toISOString().slice(0, 10), session = ![0, 6].includes(d.getUTCDay());
          if (calendar) rows.push({ Date: DateValue, HolDiv: session ? '1' : '0' });
          else if (session) rows.push({ Date: DateValue, Code: '72030', O: 100, H: 110, L: 90, C: 105, Vo: 1000,
            AdjO: 100, AdjH: 110, AdjL: 90, AdjC: 105, AdjVo: 1000, AdjFactor: 1, ExRT: null });
        }
      }
      transform(url.pathname, rows); wall += 10;
      return Response.json({ data: rows });
    },
  };
  let db = new WorkspaceDatabase(root, { create: true });
  const connect = async (hook = checkpoint) => {
    const repository = new WorkspaceRepository(db), coordinator = new DashboardJobCoordinatorV1(environment, 120);
    for (const domain of ['strategy_validation'] as const) coordinator.register({ domain,
      inventory: async () => [], isAbsent: async () => true, cleanup: async () => {}, reconcile: async () => {} });
    const market = new MarketDataJobServiceV1({ coordinator, jobRepository: new MarketDataJobRepositoryV1(artifacts) });
    const jobs = new WorkspaceDataJobs(coordinator, repository, artifacts, hook);
    await coordinator.initialize(); return { jobs, repository, coordinator, market };
  };
  return { directory, root, artifacts, db, environment, ...await connect(), calls: () => calls,
    setTransform(fn: typeof transform) { transform = fn; }, advance(ms = 61_000) { wall += ms; monotonic += ms; },
    async restart() { db.close(); db = new WorkspaceDatabase(root); return { db, ...await connect() }; },
    dispose() { db.close(); if (!storage?.preserve) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } };
}
