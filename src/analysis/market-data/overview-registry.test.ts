import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1, currentCodeWarningsV1 } from './job-schema.js';
import { fixtureArtifact, fixtureCodec, fixtureOverviewCodec, fixtureOverviewDraft,
  type FixtureArtifact } from './repository-test-fixtures.js';
import { MarketDataRepositoryV1 } from './repository.js';
import { OverviewModuleRegistryV1, createOverviewModuleAdapterV1 } from './overview-registry.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function adapter(project: (artifact: FixtureArtifact) => ReturnType<Parameters<typeof createOverviewModuleAdapterV1<FixtureArtifact>>[0]['project']>) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-overview-registry-')); roots.push(root);
  return createOverviewModuleAdapterV1<FixtureArtifact>({
    repository: new MarketDataRepositoryV1(fixtureCodec(false, {}), root),
    collect: async () => { throw new Error('not used'); }, project, environment: { JQUANTS_API_KEY: 'do-not-leak' },
  });
}

describe('Overview module registry', () => {
  test('orders by the fixed module registry and rejects duplicate identities', async () => {
    const module = await adapter(artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }));
    expect(new OverviewModuleRegistryV1([module]).moduleIds()).toEqual(['market_short_ratio']);
    expect(() => new OverviewModuleRegistryV1([module, module])).toThrow();
  });

  test('returns only a validated JSON projection and fails closed on secret-bearing output', async () => {
    const valid = await adapter(artifact => ({ state: 'available', payload: artifact.syntheticResult, warnings: [] }));
    expect(valid.project(fixtureArtifact())).toEqual({ state: 'available',
      payload: { identity: 'synthetic', value: 0 }, warnings: [] });
    const unsafe = await adapter(() => ({ state: 'available', payload: { value: 'do-not-leak' }, warnings: [] }));
    expect(() => unsafe.project(fixtureArtifact())).toThrow();
  });

  test('accepts the two persisted ETF range reasons in the common projection contract', async () => {
    for (const reason of ['insufficient_common_dates', 'invalid_base'] as const) {
      const module = await adapter(artifact => ({ state: 'unavailable', reason,
        payload: artifact.syntheticResult, warnings: [] }));
      expect(module.project(fixtureArtifact())).toEqual({ state: 'unavailable', reason,
        payload: { identity: 'synthetic', value: 0 }, warnings: [] });
    }
  });

  test('accepts current-code warnings only for their owning ETF module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-overview-registry-etf-')); roots.push(root);
    const codec = fixtureOverviewCodec('etf_1321_eod', {});
    const warningInput = { kind: 'etf_1321_eod', boundary: {
      state: 'available', sourceCoverageFrom: '2018-03-01', historyCoverageClipped: true,
    } } as const;
    const warnings = currentCodeWarningsV1(warningInput);
    const valid = createOverviewModuleAdapterV1({
      repository: new MarketDataRepositoryV1(codec, root),
      collect: async () => { throw new Error('not used'); },
      project: artifact => ({ state: 'available', payload: artifact.syntheticResult,
        warnings: artifact.warnings }),
      currentCodeWarningInput: artifact => artifact.syntheticCurrentCodeWarningInput!,
      environment: {},
    });
    const artifact = codec.build(fixtureOverviewDraft('etf_1321_eod', undefined, 0,
      warnings, warningInput));
    expect(valid.project(artifact).warnings).toEqual(warnings);
    expect(() => createOverviewModuleAdapterV1({
      repository: new MarketDataRepositoryV1(codec, root),
      collect: async () => { throw new Error('not used'); },
      project: value => ({ state: 'available', payload: value.syntheticResult,
        warnings: value.warnings }), environment: {},
    })).toThrow();

    for (const invalidWarnings of [
      [],
      warnings.slice(0, 1),
      warnings.slice(1),
      [...warnings].reverse(),
      [...warnings, warnings[1]!],
      warnings.map(warning => warning.code === 'historical_identity_unverified'
        ? { ...warning, message: '同一性は未確認です。' } : warning),
      warnings.map(warning => warning.code === 'history_coverage_clipped'
        ? { ...warning, message: warning.message.replace('2018-03-01', '2018-03-02') } : warning),
    ]) {
      const invalidEtf = createOverviewModuleAdapterV1({
        repository: new MarketDataRepositoryV1(codec, root),
        collect: async () => { throw new Error('not used'); },
        project: value => ({ state: 'available', payload: value.syntheticResult,
          warnings: value.warnings }),
        currentCodeWarningInput: value => value.syntheticCurrentCodeWarningInput!,
        environment: {},
      });
      const invalidArtifact = codec.build(fixtureOverviewDraft('etf_1321_eod', undefined, 0,
        invalidWarnings, warningInput));
      expect(() => invalidEtf.project(invalidArtifact)).toThrow();
    }

    for (const projectedWarnings of [[], warnings.slice(1)]) {
      const changedByProjection = createOverviewModuleAdapterV1({
        repository: new MarketDataRepositoryV1(codec, root),
        collect: async () => { throw new Error('not used'); },
        project: value => ({ state: 'available', payload: value.syntheticResult,
          warnings: projectedWarnings }),
        currentCodeWarningInput: value => value.syntheticCurrentCodeWarningInput!, environment: {},
      });
      expect(() => changedByProjection.project(artifact)).toThrow();
    }

    const invalid = await adapter(artifact => ({ state: 'available', payload: artifact.syntheticResult,
      warnings: [{ code: 'historical_identity_unverified',
        message: HISTORICAL_IDENTITY_UNVERIFIED_MESSAGE_V1,
        moduleId: 'market_short_ratio', artifactIdentity: null }] }));
    expect(() => invalid.project(fixtureArtifact())).toThrow();
  });
});
