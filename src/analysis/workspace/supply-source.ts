import { createMarketDataReaderV1, type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, resolveTechnicalEligibleThroughV1,
  validateCurrentTechnicalMasterV1 } from '../market-data/technical-source-gate.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import type { WorkspaceRepository } from './repository.js';
import { EpisodeObjectSchema, workspaceDataCodecs } from './data-objects.js';
import { resolveReference } from './references.js';
import { parse, fail, json, type FrozenIdentity, type ObjectRef } from './contracts.js';
import { SupplyMasterSchema } from './supply-objects.js';
import { MarginRowSchema, ReportRowSchema, SectorRowSchema,
  type SupplyDataset, type SupplyInput } from './supply-artifact.js';
import { runSupplyWorker } from './supply-worker-client.js';

export async function collectWorkspaceSupply(dataset: SupplyDataset, identity: FrozenIdentity, master: ObjectRef,
  repository: WorkspaceRepository, context: TechnicalCollectionContextV1, environment: JQuantsExecutionEnvironmentV1) {
  if (dataset === 'margin' && Date.parse(context.acceptedAt) >= Date.parse('2026-09-27T15:00:00Z')) fail('invalid_input');
  const episode = parse(EpisodeObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(repository.db, master, workspaceDataCodecs).bytes)));
  if (episode.instrumentId !== identity.instrumentId || episode.observation.Code !== identity.code) fail('identity_review_required');
  // Report publication is normally 17:30 JST. Use the existing EOD calendar
  // boundary with a one-hour lag for all three inputs, retaining a common date.
  const window = createTechnicalSourceRequestWindowV1(new Date(Date.parse(context.acceptedAt) - 3600_000).toISOString());
  const calendarStart = new Date(`${window.calculationDate.slice(0, 7)}-01T00:00:00Z`);
  calendarStart.setUTCMonth(calendarStart.getUTCMonth() - 1);
  const calendarFrom = calendarStart.toISOString().slice(0, 10);
  const reader = createMarketDataReaderV1(context, environment, { pages: 20, rows: 8000, responseBytes: 32 * 1024 * 1024 });
  const calendarRows = await reader.fetchRows('calendar', '/v2/markets/calendar', { from: calendarFrom, to: window.calendarCoverageTo });
  const calendar = mapTechnicalCalendarV1(calendarRows, calendarFrom, window.calendarCoverageTo);
  const through = resolveTechnicalEligibleThroughV1({ ...window, queryFrom: calendarFrom, calendarCoverageFrom: calendarFrom }, calendar.calendar);
  const masters = await reader.fetchRows('master', '/v2/equities/master', { code: identity.code, date: through });
  const checked = validateCurrentTechnicalMasterV1(masters, { ticker: identity.code.slice(0, 4), eligibleThrough: through });
  if (checked.state !== 'accepted' || json(checked.observation) !== json(episode.observation)) fail('identity_review_required');
  const rawMaster = masters[0] as Record<string, unknown>;
  const observation = parse(SupplyMasterSchema, { ...checked.observation, S33: rawMaster.S33, S33Nm: rawMaster.S33Nm });
  const historyStart = new Date(`${through}T00:00:00Z`); historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 1);
  const from = dataset === 'sector_short' ? through : [episode.from, historyStart.toISOString().slice(0, 10)].sort().at(-1)!;
  if (from > through) fail('identity_review_required');
  const endpoint = dataset === 'margin' ? '/v2/markets/margin-interest' : dataset === 'issuer_short'
    ? '/v2/markets/short-sale-report' : '/v2/markets/short-ratio';
  const query: Record<string, string> = dataset === 'margin' ? { code: identity.code, from, to: through }
    : dataset === 'issuer_short' ? { code: identity.code, disc_date_from: from, disc_date_to: through }
      : { s33: observation.S33, date: through };
  const rows = await reader.fetchRows('data', endpoint, query);
  const picked = (raw: unknown, keys: readonly string[]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_input');
    const row = raw as Record<string, unknown>;
    if (dataset === 'margin' && ['ShrtVal', 'LongVal', 'ShrtNegVal', 'LongNegVal', 'ShrtStdVal', 'LongStdVal'].some(key => Object.hasOwn(row, key))) fail('invalid_input');
    return Object.fromEntries(keys.map(key => [key, row[key]]));
  };
  const input: SupplyInput = { version: 'workspace_supply_input_v1', dataset,
    scope: dataset === 'sector_short' ? { kind: 'sector-scoped', provider: 'jquants', scheme: 's33', sectorCode: observation.S33, definitionVersion: 'v1' }
      : { kind: 'instrument-owned', instrumentId: identity.instrumentId }, identity: dataset === 'sector_short' ? null : identity,
    masterEvidence: dataset === 'sector_short' ? null : master, from, through,
    source: { endpoint, query, fetchedAt: reader.fetched.get('data')!.fetchedAt, pageCount: reader.fetched.get('data')!.pageCount },
    margin: dataset === 'margin' ? rows.map(row => parse(MarginRowSchema, picked(row, Object.keys(MarginRowSchema.shape)))).sort((a, b) => a.Date.localeCompare(b.Date)) : [],
    reports: dataset === 'issuer_short' ? rows.map(row => parse(ReportRowSchema, picked(row, Object.keys(ReportRowSchema.shape)))) : [],
    sector: dataset === 'sector_short' ? rows.map(row => parse(SectorRowSchema, picked(row, Object.keys(SectorRowSchema.shape)))) : [],
    volume: [], volumeEvidence: null, basisComparable: false };
  if (dataset === 'margin') {
    const evidence = repository.current({ kind: 'instrument-owned', instrumentId: identity.instrumentId }, 'technical');
    if (evidence) {
      Object.assign(input, await runSupplyWorker({ operation: 'price', root: repository.db.root, input, reference: evidence }, context.signal),
        { volumeEvidence: evidence });
    }
  }
  if (input.reports.some(row => row.CalcDate < from)) fail('identity_review_required');
  if (context.signal.aborted || dataset === 'margin' && environment.wallNowMs() >= Date.parse('2026-09-27T15:00:00Z')) fail('invalid_input');
  return { version: 'workspace_supply_prepared_v1' as const, identity, master, observation,
    artifact: await runSupplyWorker({ operation: 'build', root: repository.db.root, input, acceptedAt: context.acceptedAt }, context.signal) };
}
