import type { ObjectMetadata, WorkspaceScope } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1 } from './market-short-source-gate.js';

export const MARKET_SHORT_BINDING_POLICY_V1 = 'workspace_market_short_binding_qualification_v1';
type QualificationObject = { codec: string; metadata: ObjectMetadata };
const marketScope = (scope: WorkspaceScope) => scope.kind === 'market-scoped'
  && scope.universe === MARKET_SHORT_COVERAGE_V1.scopeId;

/** This reviewed policy has no production-qualified market source/schema version.
 * Stored flags, transport entitlement and successful coverage cannot open it.
 * Future activation requires a new reviewed policy, not an injected allow switch.
 */
export function bindingQualificationV1(scope: WorkspaceScope, dataset: string, objects: readonly QualificationObject[]) {
  const market = dataset === 'market_short' || dataset === 'market_short_ratio' || marketScope(scope)
    || objects.some(object => object.codec.startsWith('workspace_market_short_') || marketScope(object.metadata.scope)
      || object.metadata.sourceDefinition === MARKET_SHORT_COVERAGE_V1.sourceDefinition
      || object.metadata.calculationVersion === MARKET_SHORT_COVERAGE_V1.calculationVersion);
  return market
    ? { policyVersion: MARKET_SHORT_BINDING_POLICY_V1, state: 'unqualified' as const, reason: 'source_gate_unverified' as const }
    : { policyVersion: MARKET_SHORT_BINDING_POLICY_V1, state: 'not_applicable' as const, reason: null };
}
