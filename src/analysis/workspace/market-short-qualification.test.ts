import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { ObjectMetadata, WorkspaceScope } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';
import { bindingQualificationV1, MARKET_SHORT_BINDING_POLICY_V1 } from './market-short-qualification.js';

const sector: WorkspaceScope = { kind: 'sector-scoped', provider: 'jquants', scheme: 's33',
  sectorCode: '0050', definitionVersion: 'v1' };
const market: WorkspaceScope = { kind: 'market-scoped', universe: MARKET_SHORT_COVERAGE_V1.scopeId,
  definitionVersion: MARKET_SHORT_COVERAGE_V1.version };
const object = (patch: Partial<ObjectMetadata> = {}, codec = 'workspace_supply_artifact_v1') => ({ codec,
  metadata: { scope: sector, effectiveDate: '2026-09-11', sourceDefinition: 'workspace_supply_source_v1',
    calculationVersion: 'workspace_supply_calculation_v1', dependencies: [], ...patch } satisfies ObjectMetadata });

test.each([
  { scope: sector, dataset: 'market_short', objects: [object(), object()] },
  { scope: sector, dataset: 'market_short_ratio', objects: [object(), object()] },
  { scope: market, dataset: 'alias', objects: [object(), object()] },
  { scope: { ...market, definitionVersion: 'future' }, dataset: 'alias', objects: [object(), object()] },
  { scope: sector, dataset: 'alias', objects: [object({ scope: market }), object()] },
  { scope: sector, dataset: 'alias', objects: [object(), object({ scope: market })] },
  { scope: sector, dataset: 'alias', objects: [object({ sourceDefinition: MARKET_SHORT_COVERAGE_V1.sourceDefinition }), object()] },
  { scope: sector, dataset: 'alias', objects: [object(), object({ calculationVersion: MARKET_SHORT_COVERAGE_V1.calculationVersion })] },
  ...['input_v1', 'artifact_v1', 'receipt_v1', 'artifact_future'].map(name => ({ scope: sector, dataset: 'alias',
    objects: [object({}, `workspace_market_short_${name}`), object()] })),
])('closed source qualification cannot be bypassed by relabelling one identity %#', ({ scope, dataset, objects }) => {
  expect(bindingQualificationV1(scope, dataset, objects)).toEqual({ policyVersion: MARKET_SHORT_BINDING_POLICY_V1,
    state: 'unqualified', reason: 'source_gate_unverified' });
});
test.each([
  { scope: sector, dataset: 'sector_short', codec: 'workspace_supply_artifact_v1' },
  { scope: { kind: 'instrument-owned' as const, instrumentId: randomUUID() }, dataset: 'financial', codec: 'workspace_financial_artifact_v1' },
  { scope: { kind: 'market-scoped' as const, universe: 'master', definitionVersion: 'v1' }, dataset: 'catalog', codec: 'workspace_catalog_v1' },
])('issuer/sector/catalog eligibility remains independent %#', ({ scope, dataset, codec }) => {
  expect(bindingQualificationV1(scope, dataset, [object({ scope }, codec)])).toMatchObject({ state: 'not_applicable', reason: null });
});
