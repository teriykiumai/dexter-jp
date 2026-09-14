import { z } from 'zod';
import { MarketDataInstantV1Schema } from '../market-data/contracts.js';
import { mapTechnicalCalendarV1 } from '../market-data/technical-source-gate.js';
import { DateValue, json, parse, fail, safe } from './contracts.js';
import { MARKET_SHORT_COVERAGE_V1, MARKET_SHORT_COVERAGE_DIGEST_V1, MARKET_SHORT_PUBLIC_SAMPLE_V1,
  MarketShortRowSchemaV1, inspectMarketShortCoverageV1 } from './market-short-source-gate.js';
import { MARKET_SHORT_SCOPE_V1, MarketShortInputSchema } from './market-short-artifact.js';

export const MARKET_SHORT_BINDING_POLICY_V2 = 'workspace_market_short_binding_qualification_v2';
export const MARKET_SHORT_COMPLETION_POLICY_V2 = 'dexter_market_short_1730_jst_v2';
export const MARKET_SHORT_LIMITS_V2 = Object.freeze({ logicalQueries: 2, attempts: 5, pages: 5, rows: 200,
  responseBytes: 2 * 1024 * 1024, requestTimeoutMs: 30_000, deadlineMs: 60_000, retries: 0, maximumRequestsPerMinute: 5 });
export const MarketShortReconciliationStateV2 = z.enum(['approximate', 'verified']);
export const MarketShortReconciliationReasonV2 = z.enum(['published_rounding_method_unverified',
  'published_reference_unavailable', 'published_total_difference_present', 'published_component_difference_present']);
const CalendarRow = z.object({ Date: DateValue, HolDiv: z.enum(['0', '1', '2', '3']) }).strict();
const evidence = z.object({ fetchedAt: MarketDataInstantV1Schema, pageCount: z.number().int().min(1).max(5),
  rowCount: z.number().int().nonnegative().max(200), complete: z.literal(true) }).strict();
export const MarketShortInputSchemaV2 = MarketShortInputSchema.omit({ version: true, sourceQualification: true, source: true }).extend({
  version: z.literal('workspace_market_short_input_v2'), policyVersion: z.literal(MARKET_SHORT_BINDING_POLICY_V2),
  acceptedAt: MarketDataInstantV1Schema,
  source: evidence.extend({ endpoint: z.literal('/v2/markets/short-ratio'), query: z.object({ date: DateValue }).strict() }).strict(),
  calendar: z.object({ endpoint: z.literal('/v2/markets/calendar'), query: z.object({ from: DateValue, to: DateValue }).strict(),
    evidence, rows: z.array(CalendarRow).length(1) }).strict(),
  execution: z.object({ attempts: z.number().int().min(2).max(5), pages: z.number().int().min(2).max(5),
    acceptedRows: z.number().int().min(1).max(200), responseBytes: z.number().int().positive().max(MARKET_SHORT_LIMITS_V2.responseBytes),
    elapsedMs: z.number().finite().nonnegative().lt(MARKET_SHORT_LIMITS_V2.deadlineMs),
    requestsPerMinute: z.number().int().min(1).max(5), retries: z.literal(0) }).strict(),
  // Only the already reviewed, dated public reference is supported in this version.
  publishedReference: z.unknown(), rows: z.array(MarketShortRowSchemaV1).max(200),
}).strict();
export type MarketShortInputV2 = z.infer<typeof MarketShortInputSchemaV2>;

/** Application admission time, never a claim that JPX guarantees completion. */
export function marketShortAdmissionV2(date: string, acceptedAt: string): string {
  parse(DateValue, date); parse(MarketDataInstantV1Schema, acceptedAt);
  const today = new Date(Date.parse(acceptedAt) + 9 * 3600_000).toISOString().slice(0, 10);
  if (date < MARKET_SHORT_COVERAGE_V1.effectiveFrom || date > today) fail('reference_conflict');
  if (date === today && acceptedAt < `${date}T08:30:00.000Z`) fail('reference_conflict');
  return today;
}
export function marketShortCalendarV2(raw: unknown, date: string) {
  const rows = parse(z.array(CalendarRow).length(1), raw);
  const calendar = mapTechnicalCalendarV1(rows, date, date);
  if (!calendar.calendar.isSession(date)) fail('reference_conflict');
  return rows;
}
export function marketShortInputV2(raw: unknown): MarketShortInputV2 {
  const input = parse(MarketShortInputSchemaV2, raw);
  const today = marketShortAdmissionV2(input.date, input.acceptedAt);
  if (json(input.scope) !== json(MARKET_SHORT_SCOPE_V1) || json(input.registry) !== json(MARKET_SHORT_COVERAGE_V1)
    || input.registryDigest !== MARKET_SHORT_COVERAGE_DIGEST_V1 || input.source.query.date !== input.date
    || input.calendar.query.from !== input.date || input.calendar.query.to !== input.date
    || input.source.rowCount !== input.rows.length || input.calendar.evidence.rowCount !== input.calendar.rows.length
    || input.execution.pages !== input.source.pageCount + input.calendar.evidence.pageCount
    || input.execution.attempts !== input.execution.pages
    || input.execution.elapsedMs < (input.execution.attempts - 1) * 60_000 / input.execution.requestsPerMinute
    || input.execution.acceptedRows !== input.source.rowCount + input.calendar.evidence.rowCount
    || input.calendar.evidence.fetchedAt < input.acceptedAt || input.source.fetchedAt < input.calendar.evidence.fetchedAt
    || Date.parse(input.source.fetchedAt) - Date.parse(input.acceptedAt) >= MARKET_SHORT_LIMITS_V2.deadlineMs
    || input.rows.some((row, i) => i > 0 && input.rows[i - 1]!.S33 >= row.S33)) fail('reference_conflict');
  marketShortCalendarV2(input.calendar.rows, input.date);
  const result = inspectMarketShortCoverageV1(input.rows, input.date, today);
  if (result.state !== 'available') fail('reference_conflict');
  const published = input.date === MARKET_SHORT_PUBLIC_SAMPLE_V1.date ? MARKET_SHORT_PUBLIC_SAMPLE_V1 : null;
  if (json(input.publishedReference) !== json(published)) fail('reference_conflict');
  safe(input);
  return { ...input, registry: MARKET_SHORT_COVERAGE_V1,
    publishedReference: input.publishedReference === null ? null : MARKET_SHORT_PUBLIC_SAMPLE_V1 };
}

/** No tolerance or verified-producing branch: differences are evidence only. */
export function calculateMarketShortV2(raw: unknown) {
  const input = marketShortInputV2(raw);
  const result = inspectMarketShortCoverageV1(input.rows, input.date, marketShortAdmissionV2(input.date, input.acceptedAt));
  if (result.state !== 'available') fail('reference_conflict');
  const reasons: z.infer<typeof MarketShortReconciliationReasonV2>[] = ['published_rounding_method_unverified'];
  const published = input.publishedReference === null ? null : MARKET_SHORT_PUBLIC_SAMPLE_V1;
  const differences = published === null ? null : (['totals', 'other'] as const).map(group => ({ group,
    cells: (Object.keys(published[group]) as (keyof typeof published.totals)[]).map(component => ({ component,
      aggregateJPY: result[group][component], publishedMillionJPY: published[group][component],
      differenceJPY: result[group][component] - published[group][component] * 1_000_000 })) }));
  if (!differences) reasons.push('published_reference_unavailable');
  else {
    if (differences.some(group => group.cells.some(cell => cell.component === 'totalSellingValue' && cell.differenceJPY !== 0)))
      reasons.push('published_total_difference_present');
    if (differences.some(group => group.cells.some(cell => cell.component !== 'totalSellingValue' && cell.differenceJPY !== 0)))
      reasons.push('published_component_difference_present');
  }
  return { result, qualification: { policyVersion: MARKET_SHORT_BINDING_POLICY_V2, state: 'eligible_reference' as const,
    completionPolicy: MARKET_SHORT_COMPLETION_POLICY_V2, providerCompletion: 'not_guaranteed' as const,
    correctionVintage: input.correctionVintage, warnings: ['provider_completion_not_guaranteed', 'not_point_in_time_history'] as const,
    reconciliation: { state: 'approximate' as const, reasons, differences } } };
}
