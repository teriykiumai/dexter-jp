import type { Serve } from 'bun';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/index.js';
import {
  handleDashboardRequest,
  internalServerErrorResponse,
  type AnalysisSnapshotReader,
} from './api.js';

export const DASHBOARD_HOSTNAME = '127.0.0.1' as const;
export const DASHBOARD_DEFAULT_PORT = 3000;

export function createDashboardServerOptions(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
): Serve.Options<undefined> {
  return {
    hostname: DASHBOARD_HOSTNAME,
    port,
    fetch: request => handleDashboardRequest(request, repository),
    error: () => internalServerErrorResponse(),
  };
}

export function startDashboardServer(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
): Bun.Server<undefined> {
  return Bun.serve(createDashboardServerOptions(repository, port));
}
