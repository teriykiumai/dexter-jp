import { createMarketDataReaderV1, type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, resolveTechnicalEligibleThroughV1,
  validateCurrentTechnicalMasterV1 } from '../market-data/technical-source-gate.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import type { WorkspaceRepository } from './repository.js';
import { EpisodeObjectSchema, workspaceDataCodecs } from './data-objects.js';
import { resolveReference } from './references.js';
import { parse, fail, json, type FrozenIdentity, type ObjectRef } from './contracts.js';
import { mapWorkspaceFinancialSummaries } from './financial-input.js';
import type { FinancialInput } from './financial-artifact.js';
import { runFinancialWorker } from './financial-worker-client.js';

export async function collectWorkspaceFinancial(identity: FrozenIdentity, master: ObjectRef, repository: WorkspaceRepository,
  context: TechnicalCollectionContextV1, environment: JQuantsExecutionEnvironmentV1) {
  const episode = parse(EpisodeObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(repository.db, master, workspaceDataCodecs).bytes)));
  if (episode.instrumentId !== identity.instrumentId || episode.observation.Code !== identity.code) fail('identity_review_required');
  const window = createTechnicalSourceRequestWindowV1(context.acceptedAt);
  const reader = createMarketDataReaderV1(context, environment, { pages: 20, rows: 8000, responseBytes: 32 * 1024 * 1024 });
  const calendarRows = await reader.fetchRows('calendar', '/v2/markets/calendar', { from: window.queryFrom, to: window.calendarCoverageTo });
  const calendar = mapTechnicalCalendarV1(calendarRows, window.queryFrom, window.calendarCoverageTo);
  const through = resolveTechnicalEligibleThroughV1({ ...window, calendarCoverageFrom: window.queryFrom }, calendar.calendar);
  const masters = await reader.fetchRows('master', '/v2/equities/master', { code: identity.code, date: through });
  const checked = validateCurrentTechnicalMasterV1(masters, { ticker: identity.code.slice(0, 4), eligibleThrough: through });
  if (checked.state !== 'accepted' || json(checked.observation) !== json(episode.observation)) fail('identity_review_required');
  const rows = mapWorkspaceFinancialSummaries(await reader.fetchRows('summary', '/v2/fins/summary', { code: identity.code }), identity.code);
  const evidence = (role: string) => { const source = reader.fetched.get(role)!;
    return { fetchedAt: source.fetchedAt, pageCount: source.pageCount, rowCount: source.rows.length }; };
  const input: FinancialInput = { version: 'workspace_financial_input_v1', identity, masterEvidence: master,
    episodeFrom: episode.from, through, calendarFrom: window.queryFrom, calendarThrough: window.calendarCoverageTo,
    calendar: [...calendar.rows], rows, sources: { summary: evidence('summary'), calendar: evidence('calendar'), master: evidence('master') },
    correctionVintage: 'current_at_fetch_not_point_in_time', forecastPriceShareBasis: 'not_verified' };
  if (context.signal.aborted) fail('invalid_input');
  return { version: 'workspace_financial_prepared_v1' as const, identity, master, observation: episode.observation,
    artifact: await runFinancialWorker({ operation: 'build', root: repository.db.root, input, acceptedAt: context.acceptedAt }, context.signal) };
}
