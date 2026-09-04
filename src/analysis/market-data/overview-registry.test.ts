import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureArtifact, fixtureCodec, type FixtureArtifact } from './repository-test-fixtures.js';
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
});
