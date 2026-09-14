import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { MARKET_SHORT_COVERAGE_V1, MARKET_SHORT_COVERAGE_DIGEST_V1, MARKET_SHORT_PUBLIC_SAMPLE_V1 } from './market-short-source-gate.js';
import { MARKET_SHORT_BINDING_POLICY_V2, type MarketShortInputV2 } from './market-short-policy-v2.js';

/** Synthetic source rows and calendar; never evidence of live provider completeness. */
export function marketShortFixtureV2(date = '2026-09-11', acceptedAt = '2026-09-14T00:00:00.000Z'): MarketShortInputV2 {
  return { version: 'workspace_market_short_input_v2', policyVersion: MARKET_SHORT_BINDING_POLICY_V2,
    scope: MARKET_SHORT_SCOPE_V1, registry: MARKET_SHORT_COVERAGE_V1, registryDigest: MARKET_SHORT_COVERAGE_DIGEST_V1,
    date, acceptedAt, correctionVintage: 'current_at_fetch_not_point_in_time',
    source: { endpoint: '/v2/markets/short-ratio', query: { date },
      fetchedAt: new Date(Date.parse(acceptedAt) + 12_000).toISOString(), pageCount: 1, rowCount: 34, complete: true },
    calendar: { endpoint: '/v2/markets/calendar', query: { from: date, to: date },
      evidence: { fetchedAt: acceptedAt, pageCount: 1, rowCount: 1, complete: true }, rows: [{ Date: date, HolDiv: '1' }] },
    execution: { attempts: 2, pages: 2, acceptedRows: 35, responseBytes: 5000, elapsedMs: 12_000, requestsPerMinute: 5, retries: 0 },
    publishedReference: date === MARKET_SHORT_PUBLIC_SAMPLE_V1.date ? MARKET_SHORT_PUBLIC_SAMPLE_V1 : null,
    rows: MARKET_SHORT_COVERAGE_V1.codes.map(S33 => ({ Date: date, S33, SellExShortVa: 90, ShrtWithResVa: 5, ShrtNoResVa: 5 })) };
}
