import { expect, test } from 'bun:test';
import { WorkspaceFinancialSchema, WorkspaceResponseSchema, type WorkspaceFinancialView } from './workspace-contracts.js';
import type { FinancialUnavailable } from '../analysis/workspace/financial-artifact.js';

const reasons = ['missing_data', 'historical_identity_unverified', 'no_eligible_disclosure',
  'availability_calendar_unavailable', 'price_basis_unverified', 'price_unavailable'] as const satisfies readonly FinancialUnavailable[];
const view: WorkspaceFinancialView = { schemaVersion: 'workspace_financial_view_v1',
  instrumentId: '00000000-0000-4000-8000-000000000001', state: 'unavailable', through: '2026-09-11',
  checkedAt: '2026-09-11T08:00:00.000Z', artifactDigest: `sha256:${'a'.repeat(64)}`, rows: [], note: '',
  projection: { policyVersion: 'workspace_dividend_projection_v1', cutoff: '2026-10-01', state: 'unavailable',
    reason: 'price_basis_unverified', forecastReference: null, priceReference: null } };

test.each([...reasons])('financial V1 DTO accepts the declared unavailable reason %s', reason => {
  expect(WorkspaceFinancialSchema.parse({ ...view, projection: { ...view.projection, reason } }).projection?.reason).toBe(reason);
});

test.each(['', 'future_reason', 'price_basis_verified', 'missing-data'])('financial V1 DTO rejects undeclared reason %s', reason => {
  const invalid = { ...view, projection: { ...view.projection, reason } };
  expect(WorkspaceFinancialSchema.safeParse(invalid).success).toBe(false);
  expect(WorkspaceResponseSchema.safeParse(invalid).success).toBe(false);
});
