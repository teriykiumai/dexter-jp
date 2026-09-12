import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { buildTechnicalFromInputsV1, createMarketDataReaderV1, type TechnicalFetchedInputsV1, type TechnicalCollectionContextV1, TECHNICAL_JOB_LIMITS_V1 } from '../market-data/technical-source.js';
import { createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1, resolveTechnicalEligibleThroughV1,
  validateCurrentTechnicalMasterV1, TECHNICAL_SOURCE_ENDPOINTS_V1 } from '../market-data/technical-source-gate.js';
import type { JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { fail, json, parse, type FrozenIdentity, type ObjectRef } from './contracts.js';
import { EpisodeObjectSchema, stageWorkspaceObject } from './data-objects.js';
import { mapWorkspaceDailyRows, type TechnicalInput } from './technical-input.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { registerReferences, resolveReference, rowRef, objectRow } from './references.js';
import { workspaceDataCodecs } from './data-objects.js';
import type { WorkspaceRepository, CatalogRow } from './repository.js';

export function buildWorkspaceTechnical(identity: FrozenIdentity, master: ObjectRef, repository: WorkspaceRepository,
  fetched: TechnicalFetchedInputsV1) {
  const episode = parse(EpisodeObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(repository.db, master, workspaceDataCodecs).bytes)));
  if (identity.instrumentId !== episode.instrumentId || identity.code !== episode.observation.Code
    || json(fetched.master) !== json(episode.observation)) fail('identity_review_required');
  const collected = buildTechnicalFromInputsV1(fetched);
  const retained: Omit<TechnicalInput, 'queryFrom' | 'queryTo' | 'calculationDate' | 'calendarFrom' | 'calendarThrough'> = {
      version: 'workspace_technical_input_v1', identity, masterEvidence: master, eligibilityFrom: episode.from,
      master: { ...fetched.master, ProdCat: '011' }, daily: mapWorkspaceDailyRows(fetched.barRows), calendar: [...fetched.calendarRows],
      adjustmentMethod: 'jquants_adjusted_ohlcv_not_total_return', factorSemantics: 'provider_daily_event_factor_not_cumulative', historicalIdentity: 'not_verified' };
  const source = collected.artifact, window = createTechnicalSourceRequestWindowV1(source.acceptedAt);
  const input: TechnicalInput = { ...retained, queryFrom: source.queryFrom, queryTo: source.queryTo,
    calculationDate: source.calculationDate, calendarFrom: window.calendarCoverageFrom, calendarThrough: window.calendarCoverageTo };
  return new WorkspaceTechnicalCodec(source.ticker).parse(new WorkspaceTechnicalCodec(source.ticker).build(source, input));
}

export async function collectWorkspaceCatalog(context: TechnicalCollectionContextV1, environment: JQuantsExecutionEnvironmentV1) {
  const window = createTechnicalSourceRequestWindowV1(context.acceptedAt), start = new Date(`${window.calculationDate.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1); const from = start.toISOString().slice(0, 10);
  const reader = createMarketDataReaderV1(context, environment, { pages: TECHNICAL_JOB_LIMITS_V1.maximumPages,
    rows: TECHNICAL_JOB_LIMITS_V1.maximumRows, responseBytes: TECHNICAL_JOB_LIMITS_V1.maximumResponseBytes });
  const calendarRows = await reader.fetchRows('trading_calendar', TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar, { from, to: window.calendarCoverageTo });
  const calendar = mapTechnicalCalendarV1(calendarRows, from, window.calendarCoverageTo);
  const date = resolveTechnicalEligibleThroughV1({ ...window, queryFrom: from, calendarCoverageFrom: from }, calendar.calendar);
  const raw = await reader.fetchRows('catalog', TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster, { date });
  const seen = new Set<string>(), rows = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('invalid_input');
    const r = item as Record<string, unknown>;
    if (r.Date !== date || typeof r.Code !== 'string' || !/^[0-9A-Z]{5}$/.test(r.Code)
      || seen.has(r.Code) || typeof r.ProdCat !== 'string' || typeof r.Mkt !== 'string') fail('invalid_input');
    seen.add(r.Code);
    if (r.ProdCat !== '011' || !['0105', '0111', '0112', '0113'].includes(r.Mkt) || !r.Code.endsWith('0')) continue;
    const checked = validateCurrentTechnicalMasterV1([r], { ticker: r.Code.slice(0, 4), eligibleThrough: date });
    if (checked.state !== 'accepted') fail('identity_review_required');
    rows.push({ ...checked.observation, ProdCat: '011' as const });
  }
  if (!rows.length) fail('invalid_input');
  const evidence = (role: string) => { const source = reader.fetched.get(role)!;
    return { fetchedAt: source.fetchedAt, pageCount: source.pageCount, rowCount: source.rows.length, complete: true as const }; };
  return { version: 'workspace_catalog_v1' as const, date, acceptedAt: context.acceptedAt,
    sourceDefinition: 'jquants_dated_ordinary_master_v1' as const,
    calendarFrom: from, calendarThrough: window.calendarCoverageTo, calendar: [...calendar.rows],
    sources: { master: { ...evidence('catalog'), endpoint: TECHNICAL_SOURCE_ENDPOINTS_V1.securityMaster },
      calendar: { ...evidence('trading_calendar'), endpoint: TECHNICAL_SOURCE_ENDPOINTS_V1.tradingCalendar } },
    rows: rows.sort((a, b) => a.Code.localeCompare(b.Code)) };
}

export async function activateWorkspaceCatalog(repository: WorkspaceRepository, generation: number,
  catalog: Awaited<ReturnType<typeof collectWorkspaceCatalog>>) {
  const db = repository.db;
  const master = stageWorkspaceObject(db, 'workspace_catalog_v1', catalog), rows: CatalogRow[] = [];
  for (const observation of catalog.rows) {
    const previous = db.sqlite.query<{ instrument_id: string; evidence: string; mapping_revision: number }, [string]>(
      `SELECT r.instrument_id,r.evidence,r.mapping_revision FROM catalog_rows r JOIN catalog_generations g USING(generation)
       WHERE g.state='active' AND r.provider='jquants' AND r.code=?`).get(observation.Code);
    const ref = previous ? rowRef(objectRow(db, previous.evidence)) : null;
    const episode = ref ? parse(EpisodeObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(db, ref, workspaceDataCodecs).bytes))) : null;
    // A dated current master cannot establish continuity across an unobserved gap.
    // Keep the accepted catalog until an independently evidenced episode is supplied.
    if (episode && (episode.observation.Date !== observation.Date || episode.observation.Code !== observation.Code)) fail('identity_review_required');
    const instrumentId = episode?.instrumentId ?? randomUUID(), from = episode?.from ?? catalog.date;
    const evidence = stageWorkspaceObject(db, 'workspace_episode_v1', { version: 'workspace_episode_v1', instrumentId,
      observation, from, catalog: master, previous: ref });
    rows.push({ instrumentId, assetType: 'stock', provider: 'jquants', code: observation.Code, label: observation.CoName,
      mappingRevision: previous?.mapping_revision ?? 1, episodeFrom: from, episodeThrough: null, evidence });
    if (rows.length % 16 === 0) await setImmediate();
  }
  await registerReferences(db, resolve(db.root, 'imports'), rows.map(row => row.evidence), workspaceDataCodecs);
  db.transaction(() => {
    if (db.sqlite.run("UPDATE catalog_generations SET effective_date=? WHERE generation=? AND state='pending'", [catalog.date, generation]).changes !== 1) fail('revision_conflict');
  });
  await repository.acceptCatalog(generation, rows, master);
  return master;
}
