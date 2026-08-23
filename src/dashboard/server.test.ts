import { describe, expect, test } from 'bun:test';
import type { AnalysisSnapshotReader } from './api.js';
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

describe('local dashboard server', () => {
  test('always configures the loopback hostname', () => {
    const options = createDashboardServerOptions(emptyRepository, 0) as {
      hostname?: string;
      port?: string | number;
    };

    expect(DASHBOARD_HOSTNAME).toBe('127.0.0.1');
    expect(options.hostname).toBe('127.0.0.1');
    expect(options.port).toBe(0);
    expect('tls' in options).toBeFalse();
  });

  test('starts on loopback and serves the read-only API', async () => {
    const server = startDashboardServer(emptyRepository, 0);
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
