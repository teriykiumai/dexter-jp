import { describe, expect, test } from 'bun:test';
import {
  createPointInTimeSourceEnvelopeV1,
  createPointInTimeSourceManifestV1,
  PointInTimeSourceManifestV1Schema,
  tokyoEndOfDayV1,
  validateStrategyValidationSourceBindingV1,
  type PointInTimeSourceEndpointV1,
  type StrategyValidationSourceRoleV1,
} from './index.js';
import {
  TEST_OUTCOME_AS_OF,
  TEST_STARTED_AT,
} from './artifact-test-fixtures.js';

const campaignContext = Object.freeze({
  mode: 'campaign' as const,
  caseKind: 'candidate' as const,
  ticker: '7203',
  anchorDate: '2025-01-02',
  decisionDate: '2025-01-02',
  strategyDataDate: null,
  initialTickDate: '2025-01-02',
  startedAt: TEST_STARTED_AT,
  outcomeAsOfSession: TEST_OUTCOME_AS_OF,
});

function endpointFor(role: StrategyValidationSourceRoleV1): PointInTimeSourceEndpointV1 {
  if (role.endsWith('_calendar')) return '/v2/markets/calendar';
  if (role.endsWith('_master')) return '/v2/equities/master';
  return '/v2/equities/bars/daily';
}

function roleSource(
  role: StrategyValidationSourceRoleV1,
  overrides: Readonly<{
    ticker?: string | null;
    dateFrom?: string;
    dateTo?: string;
    asOfCutoff?: string;
  }> = {},
) {
  const candidate = role.startsWith('candidate_');
  const master = role.endsWith('_master');
  const calendar = role.endsWith('_calendar');
  const dateFrom = overrides.dateFrom ?? (candidate
    ? (master ? campaignContext.decisionDate : '2024-01-02')
    : (calendar ? campaignContext.decisionDate : '2025-01-03'));
  const dateTo = overrides.dateTo ?? (candidate
    ? campaignContext.anchorDate
    : (master ? '2025-01-03' : TEST_OUTCOME_AS_OF));
  return createPointInTimeSourceEnvelopeV1({
    sourceMappingVersion: `test_${role}_v1`,
    endpoint: endpointFor(role),
    query: [{ name: 'from', value: dateFrom }, { name: 'to', value: dateTo }],
    request: {
      ticker: overrides.ticker ?? (calendar ? null : campaignContext.ticker),
      dateFrom,
      dateTo,
      asOfCutoff: overrides.asOfCutoff
        ?? (candidate ? tokyoEndOfDayV1(campaignContext.anchorDate) : TEST_STARTED_AT),
    },
    fetchedAt: TEST_STARTED_AT,
    result: { state: 'available', rows: [{ Date: dateFrom }] },
  });
}

describe('Point-in-time source manifest V1', () => {
  test('canonically records unique calculation roles and validates correct bindings', () => {
    const roles = [
      'outcome_daily_bars',
      'candidate_master',
      'outcome_calendar',
      'candidate_daily_bars',
      'outcome_master',
      'candidate_calendar',
    ] as const;
    const sources = roles.map(role => ({ role, envelope: roleSource(role) }));
    const manifest = createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: sources.map(({ role, envelope }) => ({ role, digest: envelope.digest })),
    });
    expect(manifest.sources.map(value => value.role)).toEqual([
      'candidate_calendar',
      'candidate_master',
      'candidate_daily_bars',
      'outcome_calendar',
      'outcome_master',
      'outcome_daily_bars',
    ]);
    for (const reference of manifest.sources) {
      const envelope = sources.find(value => value.envelope.digest === reference.digest)?.envelope;
      if (envelope === undefined) throw new TypeError('Missing test source.');
      expect(() => validateStrategyValidationSourceBindingV1(
        reference, envelope, campaignContext,
      )).not.toThrow();
    }
  });

  test('rejects duplicate digests and noncanonical direct manifests', () => {
    const source = roleSource('candidate_calendar');
    const duplicate = {
      schemaVersion: 'point_in_time_source_manifest_v1',
      roleVersion: 'strategy_validation_source_role_v1',
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: TEST_OUTCOME_AS_OF,
      sources: [
        { role: 'candidate_calendar', digest: source.digest },
        { role: 'outcome_calendar', digest: source.digest },
      ],
    };
    expect(PointInTimeSourceManifestV1Schema.safeParse(duplicate).success).toBe(false);
    const outcome = roleSource('outcome_calendar');
    expect(PointInTimeSourceManifestV1Schema.safeParse({
      ...duplicate,
      sources: [
        { role: 'outcome_calendar', digest: outcome.digest },
        { role: 'candidate_calendar', digest: source.digest },
      ],
    }).success).toBe(false);
  });

  test('allows a null outcome boundary only without source references', () => {
    const empty = createPointInTimeSourceManifestV1({
      startedAt: TEST_STARTED_AT,
      outcomeAsOfSession: null,
      sources: [],
    });
    expect(empty.outcomeAsOfSession).toBeNull();
    const source = roleSource('candidate_calendar');
    expect(PointInTimeSourceManifestV1Schema.safeParse({
      ...empty,
      sources: [{ role: 'candidate_calendar', digest: source.digest }],
    }).success).toBe(false);
  });

  test('rejects t0/outcome role swaps and role-specific ticker, cutoff, or dates', () => {
    const candidateDaily = roleSource('candidate_daily_bars');
    const outcomeDaily = roleSource('outcome_daily_bars');
    expect(() => validateStrategyValidationSourceBindingV1(
      { role: 'outcome_daily_bars', digest: candidateDaily.digest },
      candidateDaily,
      campaignContext,
    )).toThrow();
    expect(() => validateStrategyValidationSourceBindingV1(
      { role: 'candidate_daily_bars', digest: outcomeDaily.digest },
      outcomeDaily,
      campaignContext,
    )).toThrow();

    for (const [role, envelope] of [
      ['outcome_daily_bars', roleSource('outcome_daily_bars', { ticker: '6758' })],
      ['candidate_daily_bars', roleSource('candidate_daily_bars', { asOfCutoff: TEST_STARTED_AT })],
      ['candidate_master', roleSource('candidate_master', { dateTo: '2025-01-03' })],
      ['outcome_daily_bars', roleSource('outcome_daily_bars', { dateFrom: '2025-01-02' })],
    ] as const) {
      expect(() => validateStrategyValidationSourceBindingV1(
        { role, digest: envelope.digest }, envelope, campaignContext,
      )).toThrow();
    }
  });

  test('rejects outcome roles for an unavailable anchor', () => {
    const source = roleSource('outcome_calendar');
    expect(() => validateStrategyValidationSourceBindingV1(
      { role: 'outcome_calendar', digest: source.digest },
      source,
      { ...campaignContext, caseKind: 'anchor_unavailable' },
    )).toThrow();
  });
});
