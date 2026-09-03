import type { Serve } from 'bun';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/index.js';
import { StrategyValidationJobServiceV1 } from '../analysis/strategy-validation/index.js';
import {
  handleDashboardRequest,
  internalServerErrorResponse,
  type AnalysisSnapshotReader,
} from './api.js';
import { StrategyValidationDashboardApiV1 } from './strategy-validation-api.js';
import { DashboardSessionV1 } from './session.js';

export const DASHBOARD_HOSTNAME = '127.0.0.1' as const;
export const DASHBOARD_DEFAULT_PORT = 3000;

export function createDefaultStrategyValidationDashboardApiV1(): StrategyValidationDashboardApiV1 {
  return new StrategyValidationDashboardApiV1(new StrategyValidationJobServiceV1({
    snapshotRepository: new AnalysisSnapshotRepository(),
  }), new DashboardSessionV1());
}

export function createDashboardServerOptions(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
  strategyValidationApi: StrategyValidationDashboardApiV1 =
    createDefaultStrategyValidationDashboardApiV1(),
): Serve.Options<undefined> {
  return {
    hostname: DASHBOARD_HOSTNAME,
    port,
    fetch: request => handleDashboardRequest(request, repository, strategyValidationApi),
    error: () => internalServerErrorResponse(),
  };
}

export function startDashboardServer(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
  strategyValidationApi: StrategyValidationDashboardApiV1 =
    createDefaultStrategyValidationDashboardApiV1(),
): Bun.Server<undefined> {
  return Bun.serve(createDashboardServerOptions(repository, port, strategyValidationApi));
}
