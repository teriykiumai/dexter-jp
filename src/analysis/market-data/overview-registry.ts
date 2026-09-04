import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import type { MarketDataArtifactFieldsV1 } from './artifact-codec.js';
import {
  MARKET_DATA_MODULE_IDS_V1,
  assertMarketDataSafeV1,
  type MarketDataArtifactIdentityV1,
  type MarketDataModuleIdV1,
  type MarketDataObservationReceiptIdentityV1,
  type MarketDataTargetV1,
} from './contracts.js';
import { MarketDataWarningV1Schema, assertCurrentCodeWarningsV1, isCurrentCodePersistedWarningV1,
  marketDataWarningCodesV1, persistedModuleReasonsV1,
  type CurrentCodeWarningInputV1, type MarketDataWarningV1,
  type MarketDataModuleFailureCodeV1 } from './job-schema.js';
import {
  MarketDataRepositoryV1,
  type LatestMarketDataV1,
  type ObservedMarketDataV1,
} from './repository.js';

export type PersistedModuleUnavailableReasonV1 = typeof persistedModuleReasonsV1[number];

export type MarketOverviewProjectionV1 =
  | Readonly<{ state: 'available'; payload: CanonicalJsonValue; warnings: readonly MarketDataWarningV1[] }>
  | Readonly<{ state: 'unavailable'; payload: CanonicalJsonValue; reason: PersistedModuleUnavailableReasonV1;
    warnings: readonly MarketDataWarningV1[] }>;

export type MarketDataModuleViewV1 =
  | Readonly<{ moduleId: MarketDataModuleIdV1; state: 'available' | 'fallback';
    artifactIdentity: MarketDataArtifactIdentityV1;
    observationReceiptIdentity: MarketDataObservationReceiptIdentityV1;
    checkedAt: string; payload: CanonicalJsonValue; warnings: readonly MarketDataWarningV1[] }>
  | Readonly<{ moduleId: MarketDataModuleIdV1; state: 'unavailable';
    artifactIdentity: MarketDataArtifactIdentityV1;
    observationReceiptIdentity: MarketDataObservationReceiptIdentityV1;
    checkedAt: string; payload: CanonicalJsonValue; reason: PersistedModuleUnavailableReasonV1;
    warnings: readonly MarketDataWarningV1[] }>
  | Readonly<{ moduleId: MarketDataModuleIdV1; state: 'unavailable';
    artifactIdentity: null; observationReceiptIdentity: null; checkedAt: null; payload: null;
    reason: 'not_collected' | 'artifact_corrupt'; warnings: readonly MarketDataWarningV1[] }>
  | Readonly<{ moduleId: MarketDataModuleIdV1; state: 'not_implemented' }>;

export type MarketOverviewResponseV1 = Readonly<{
  schemaVersion: 'market_overview_response_v1';
  modules: readonly MarketDataModuleViewV1[];
}>;

export type OverviewPreparedModuleV1 = Readonly<{
  artifact: unknown;
  attempts: number;
  pages: number;
  acceptedRows: number;
  responseBytes: number;
}>;

export type OverviewCollectionContextV1 = Readonly<{
  jobId: string;
  acceptedAt: string;
  signal: AbortSignal;
  dispatch<T>(start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
  shareSource<T>(sourceKey: string, load: () => Promise<T>): Promise<T>;
  recordProgress(progress: Readonly<{ pages: number; acceptedRows: number; responseBytes: number }>): void;
}>;

export interface OverviewModuleAdapterV1 {
  readonly moduleId: MarketDataModuleIdV1;
  readonly sourceId: `${MarketDataModuleIdV1}_v1`;
  readonly target: Extract<MarketDataTargetV1, { kind: 'overview' }>;
  collect(context: OverviewCollectionContextV1): Promise<OverviewPreparedModuleV1>;
  validate(rawArtifact: unknown): MarketDataArtifactFieldsV1;
  publish(rawArtifact: unknown, observation: { jobId: string; acceptedAt: string; checkedAt: string }):
    Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1> & { state: 'published' | 'idempotent_reuse' }>;
  latest(): Promise<LatestMarketDataV1<MarketDataArtifactFieldsV1>>;
  loadObservation(identity: MarketDataObservationReceiptIdentityV1): Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1>>;
  findObservation(jobId: string, acceptedAt: string): Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1> | null>;
  project(artifact: MarketDataArtifactFieldsV1): MarketOverviewProjectionV1;
}

function cloneJson(value: CanonicalJsonValue): CanonicalJsonValue {
  return JSON.parse(canonicalJsonV1(value)) as CanonicalJsonValue;
}

/** Erases a module's generic artifact type only after its strict codec has parsed it. */
export function createOverviewModuleAdapterV1<T extends MarketDataArtifactFieldsV1
  & Readonly<{ warnings: readonly MarketDataWarningV1[] }>>(options: {
  repository: MarketDataRepositoryV1<T>;
  collect: (context: OverviewCollectionContextV1) => Promise<OverviewPreparedModuleV1>;
  project: (artifact: T) => MarketOverviewProjectionV1;
  currentCodeWarningInput?: (artifact: T) => CurrentCodeWarningInputV1;
  environment?: NodeJS.ProcessEnv;
}): OverviewModuleAdapterV1 {
  const target = options.repository.codec.target;
  if (target.kind !== 'overview') throw new TypeError('Overview modules require an overview repository.');
  const currentCodeModule = target.moduleId === 'etf_1321_eod'
    || target.moduleId === 'etf_1321_2633_relative';
  if (currentCodeModule !== (options.currentCodeWarningInput !== undefined)) {
    throw new TypeError('ETF modules require structural current-code warning input.');
  }
  const verifyProjection = (artifact: T): MarketOverviewProjectionV1 => {
    const projected = options.project(artifact);
    if (projected.state !== 'available' && projected.state !== 'unavailable') throw new TypeError('Invalid module projection.');
    if (projected.state === 'unavailable' && !persistedModuleReasonsV1.includes(projected.reason)) {
      throw new TypeError('Invalid unavailable reason.');
    }
    if (!Array.isArray(projected.warnings)) throw new TypeError('Invalid module warnings.');
    const storedWarnings = artifact.warnings.map(warning => MarketDataWarningV1Schema.parse(warning));
    const warnings = projected.warnings.map(warning => MarketDataWarningV1Schema.parse(warning));
    if (canonicalJsonV1(storedWarnings) !== canonicalJsonV1(warnings)) {
      throw new TypeError('Module projection must preserve stored warnings unchanged.');
    }
    const projectedCodes = warnings.map(warning => warning.code);
    if (warnings.some(warning => !['cadence_changed', 'basis_break', 'source_gap',
      'history_coverage_clipped', 'historical_identity_unverified'].includes(warning.code)
      || (['history_coverage_clipped', 'historical_identity_unverified'].includes(warning.code)
        && (!['etf_1321_eod', 'etf_1321_2633_relative'].includes(target.moduleId)
          || !isCurrentCodePersistedWarningV1(warning)))
      || warning.moduleId !== target.moduleId
      || warning.artifactIdentity !== null)
      || canonicalJsonV1(projectedCodes) !== canonicalJsonV1(marketDataWarningCodesV1(projectedCodes))) {
      throw new TypeError('Invalid persisted module warning.');
    }
    if (currentCodeModule) {
      const expectedInput = options.currentCodeWarningInput!(artifact);
      if (expectedInput.kind !== target.moduleId) {
        throw new TypeError('Current-code warning input does not match its module.');
      }
      assertCurrentCodeWarningsV1(warnings.filter(warning => warning.code === 'history_coverage_clipped'
        || warning.code === 'historical_identity_unverified'), expectedInput);
    }
    assertMarketDataSafeV1({ payload: projected.payload, warnings } as CanonicalJsonValue,
      options.environment ?? process.env);
    return Object.freeze({ ...projected, payload: cloneJson(projected.payload),
      warnings: Object.freeze(warnings) });
  };
  return Object.freeze({
    moduleId: target.moduleId,
    sourceId: target.sourceId,
    target,
    collect: options.collect,
    validate: (raw: unknown) => {
      const artifact = options.repository.codec.parse(raw);
      verifyProjection(artifact);
      return artifact;
    },
    publish: (raw: unknown, observation: { jobId: string; acceptedAt: string; checkedAt: string }) => {
      const artifact = options.repository.codec.parse(raw);
      verifyProjection(artifact);
      return options.repository.publish(artifact, observation) as Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1>
        & { state: 'published' | 'idempotent_reuse' }>;
    },
    latest: () => options.repository.latest() as Promise<LatestMarketDataV1<MarketDataArtifactFieldsV1>>,
    loadObservation: (identity: MarketDataObservationReceiptIdentityV1) =>
      options.repository.loadObservation(identity) as Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1>>,
    findObservation: (jobId: string, acceptedAt: string) =>
      options.repository.findObservation(jobId, acceptedAt) as Promise<ObservedMarketDataV1<MarketDataArtifactFieldsV1> | null>,
    project: (artifact: MarketDataArtifactFieldsV1) => verifyProjection(artifact as T),
  });
}

export class OverviewModuleRegistryV1 {
  readonly #modules = new Map<MarketDataModuleIdV1, OverviewModuleAdapterV1>();
  constructor(modules: readonly OverviewModuleAdapterV1[] = []) {
    for (const module of modules) {
      if (this.#modules.has(module.moduleId) || module.sourceId !== `${module.moduleId}_v1`
        || module.target.moduleId !== module.moduleId || module.target.sourceId !== module.sourceId) {
        throw new TypeError('Invalid or duplicate Overview module registration.');
      }
      this.#modules.set(module.moduleId, module);
    }
  }
  get size(): number { return this.#modules.size; }
  get(moduleId: MarketDataModuleIdV1): OverviewModuleAdapterV1 | undefined { return this.#modules.get(moduleId); }
  implemented(): readonly OverviewModuleAdapterV1[] {
    return MARKET_DATA_MODULE_IDS_V1.flatMap(id => this.#modules.get(id) ?? []);
  }
  moduleIds(): readonly MarketDataModuleIdV1[] { return this.implemented().map(module => module.moduleId); }
}

export type OverviewModuleAttemptFailureV1 = Readonly<{
  code: MarketDataModuleFailureCodeV1;
}>;
