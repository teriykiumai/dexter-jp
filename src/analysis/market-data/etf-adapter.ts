import type { CanonicalJsonValue } from '../snapshot/canonical-json.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { createEtfArtifactCodecV1, etfWarningInputV1 } from './etf-artifact.js';
import { collectEtfModuleV1 } from './etf-source.js';
import { createOverviewModuleAdapterV1, OverviewModuleRegistryV1 } from './overview-registry.js';
import { MarketDataRepositoryV1 } from './repository.js';

export function createEtfOverviewRegistryV1(environment: JQuantsExecutionEnvironmentV1,
  root?: string, secrets: NodeJS.ProcessEnv = process.env) {
  return new OverviewModuleRegistryV1((['etf_1321_eod', 'etf_1321_2633_relative'] as const).map(moduleId =>
    createOverviewModuleAdapterV1({ repository: new MarketDataRepositoryV1(createEtfArtifactCodecV1(moduleId, secrets), root),
      collect: context => collectEtfModuleV1(moduleId, context, environment, secrets),
      currentCodeWarningInput: etfWarningInputV1, environment: secrets,
      project: artifact => artifact.state === 'available'
        ? { state: 'available', payload: artifact as CanonicalJsonValue, warnings: artifact.warnings }
        : { state: 'unavailable', reason: artifact.reason!, payload: artifact as CanonicalJsonValue, warnings: artifact.warnings },
    })));
}
