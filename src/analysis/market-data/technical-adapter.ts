import { CanonicalTickerSchema } from '../snapshot/schema.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { MarketDataRepositoryV1 } from './repository.js';
import { createTechnicalArtifactCodecV1 } from './technical-artifact.js';
import { collectTechnicalV1, type TechnicalCollectionContextV1 } from './technical-source.js';
import type { MarketDataObservationReceiptIdentityV1 } from './contracts.js';

export class TechnicalAdapterV1 {
  constructor(readonly environment: JQuantsExecutionEnvironmentV1,
    readonly root?: string, readonly secrets: NodeJS.ProcessEnv = process.env) {}
  configured(): boolean { const key = this.environment.apiKey(); return !!key && !/[\r\n]/.test(key); }
  repository(ticker: string) {
    CanonicalTickerSchema.parse(ticker);
    return new MarketDataRepositoryV1(createTechnicalArtifactCodecV1(ticker, this.secrets), this.root);
  }
  collect(ticker: string, context: TechnicalCollectionContextV1) {
    return collectTechnicalV1(ticker, context, this.environment, this.secrets);
  }
  async loadObservation(identity: MarketDataObservationReceiptIdentityV1) {
    if (identity.scope !== 'technical') throw new Error('Invalid Technical observation scope.');
    return this.repository(identity.tickerOrSourceId).loadObservation(identity);
  }
}
