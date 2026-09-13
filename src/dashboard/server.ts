import type { Serve } from 'bun';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/index.js';
import { StrategyValidationJobServiceV1 } from '../analysis/strategy-validation/index.js';
import { DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1, resolveJQuantsRequestsPerMinuteV1 } from '../analysis/strategy-validation/jquants-execution.js';
import { DashboardJobCoordinatorV1 } from '../analysis/dashboard-jobs/coordinator.js';
import { MarketDataJobServiceV1 } from '../analysis/market-data/job-service.js';
import { TechnicalAdapterV1 } from '../analysis/market-data/technical-adapter.js';
import { createEtfOverviewRegistryV1 } from '../analysis/market-data/etf-adapter.js';
import { ETF_JOB_LIMITS_V1 } from '../analysis/market-data/etf-source.js';
import {
  handleDashboardRequest,
  internalServerErrorResponse,
  type AnalysisSnapshotReader,
} from './api.js';
import { StrategyValidationDashboardApiV1 } from './strategy-validation-api.js';
import { DashboardSessionV1 } from './session.js';
import { MarketDataDashboardApiV1 } from './market-data-api.js';
import { resolve } from 'node:path';
import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { WorkspaceRepository } from '../analysis/workspace/repository.js';
import { WorkspaceDataJobs } from '../analysis/workspace/data-jobs.js';
import { WorkspaceDashboardApi } from './workspace-api.js';

export const DASHBOARD_HOSTNAME = '127.0.0.1' as const;
export const DASHBOARD_DEFAULT_PORT = 3000;

export function createDefaultDashboardApisV1(): Readonly<{
  strategyValidationApi: StrategyValidationDashboardApiV1;
  marketDataApi: MarketDataDashboardApiV1;
  workspaceApi: WorkspaceDashboardApi;
}> {
  const session = new DashboardSessionV1();
  const coordinator = new DashboardJobCoordinatorV1(
    DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1,
    resolveJQuantsRequestsPerMinuteV1(),
  );
  const strategyService = new StrategyValidationJobServiceV1({
    snapshotRepository: new AnalysisSnapshotRepository(), coordinator,
  });
  const marketService = new MarketDataJobServiceV1({ coordinator,
    overviewRegistry: createEtfOverviewRegistryV1(DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1), limits: ETF_JOB_LIMITS_V1,
    technicalSource: new TechnicalAdapterV1(DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1) });
  const workspace = new WorkspaceDataJobs(coordinator,
    new WorkspaceRepository(new WorkspaceDatabase(resolve('.dexter/workspace'), { create: true })), resolve('.dexter/market-data'));
  return Object.freeze({
    strategyValidationApi: new StrategyValidationDashboardApiV1(strategyService, session),
    marketDataApi: new MarketDataDashboardApiV1(marketService, session),
    workspaceApi: new WorkspaceDashboardApi(workspace, session),
  });
}

export function createDefaultStrategyValidationDashboardApiV1(): StrategyValidationDashboardApiV1 {
  return createDefaultDashboardApisV1().strategyValidationApi;
}

export function createDashboardServerOptions(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
  strategyValidationApi?: StrategyValidationDashboardApiV1,
  marketDataApi?: MarketDataDashboardApiV1,
  workspaceApi?: WorkspaceDashboardApi,
): Serve.Options<undefined> {
  const defaults = strategyValidationApi === undefined && marketDataApi === undefined && workspaceApi === undefined
    ? createDefaultDashboardApisV1() : null;
  const strategy = strategyValidationApi ?? defaults?.strategyValidationApi;
  const market = marketDataApi ?? defaults?.marketDataApi;
  return {
    hostname: DASHBOARD_HOSTNAME,
    port,
    fetch: request => handleDashboardRequest(request, repository, strategy, market, workspaceApi ?? defaults?.workspaceApi),
    error: () => internalServerErrorResponse(),
  };
}

export function startDashboardServer(
  repository: AnalysisSnapshotReader = new AnalysisSnapshotRepository(),
  port = DASHBOARD_DEFAULT_PORT,
  strategyValidationApi?: StrategyValidationDashboardApiV1,
  marketDataApi?: MarketDataDashboardApiV1,
  workspaceApi?: WorkspaceDashboardApi,
): Bun.Server<undefined> {
  return Bun.serve(createDashboardServerOptions(repository, port, strategyValidationApi, marketDataApi, workspaceApi));
}
