import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/index.js';
import {
  StrategyValidationJobRepositoryV1,
  StrategyValidationJobServiceV1,
  StrategyValidationRunRepositoryV1,
} from '../analysis/strategy-validation/index.js';
import type { AnalysisSnapshotReader } from './api.js';
import { StrategyValidationDashboardApiV1 } from './strategy-validation-api.js';
import {
  DASHBOARD_HOSTNAME,
  createDashboardServerOptions,
  startDashboardServer,
} from './server.js';

const emptyRepository: AnalysisSnapshotReader = {
  listLatest: async () => [],
  loadLatest: async () => { throw new Error('not found'); },
  listHistory: async () => [],
  loadHistory: async () => { throw new Error('not found'); },
};

const temporaryRoots: string[] = [];

async function isolatedStrategyApi() {
  const root = await mkdtemp(join(tmpdir(), 'dexter-dashboard-server-'));
  temporaryRoots.push(root);
  const service = new StrategyValidationJobServiceV1({
    snapshotRepository: new AnalysisSnapshotRepository(join(root, 'analysis')),
    runRepository: new StrategyValidationRunRepositoryV1(join(root, 'research')),
    jobRepository: new StrategyValidationJobRepositoryV1(join(root, 'research')),
  });
  const api = new StrategyValidationDashboardApiV1(service);
  await service.initialize();
  return api;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('local dashboard server', () => {
  test('always configures the loopback hostname', async () => {
    const options = createDashboardServerOptions(
      emptyRepository, 0, await isolatedStrategyApi(),
    ) as {
      hostname?: string;
      port?: string | number;
    };

    expect(DASHBOARD_HOSTNAME).toBe('127.0.0.1');
    expect(options.hostname).toBe('127.0.0.1');
    expect(options.port).toBe(0);
    expect('tls' in options).toBeFalse();
  });

  test('starts on loopback and serves the read-only API', async () => {
    const server = startDashboardServer(emptyRepository, 0, await isolatedStrategyApi());
    try {
      expect(server.hostname).toBe('127.0.0.1');
      const response = await fetch(new URL('/api/analyses', server.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    } finally {
      await server.stop(true);
    }
  });
});
