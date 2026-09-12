import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readdirSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { validateReceiptV1, MarketDataObservationReceiptV1Schema } from '../market-data/contracts.js';
import { validateCurrentTechnicalMasterV1, createTechnicalSourceRequestWindowV1, mapTechnicalCalendarV1,
  resolveTechnicalEligibleThroughV1 } from '../market-data/technical-source-gate.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { WorkspaceMasterSchema, TechnicalInputSchema, calculateWorkspaceTechnical } from './technical-input.js';
import { DateValue, Id, ObjectRefSchema, FrozenIdentitySchema, ObjectMetadataSchema, digest, json, fail, parse, type ReferenceCodecs, type ObjectRef, type ObjectMetadata } from './contracts.js';
import { writeExclusive, type PublicationCheckpoint } from './files.js';
import { registerReferences, retainVerifiedObject, type VerifiedObject } from './references.js';
import type { WorkspaceDatabase } from './database.js';

const FetchEvidenceSchema = z.object({ fetchedAt: z.iso.datetime(), pageCount: z.number().int().positive().max(20),
  rowCount: z.number().int().nonnegative().max(8000), complete: z.literal(true) }).strict();
export const CatalogObjectSchema = z.object({ version: z.literal('workspace_catalog_v1'), date: DateValue,
  acceptedAt: z.iso.datetime(), sourceDefinition: z.literal('jquants_dated_ordinary_master_v1'),
  calendarFrom: DateValue, calendarThrough: DateValue,
  calendar: z.array(z.object({ Date: DateValue, HolDiv: z.string() }).strict()).min(1).max(100),
  sources: z.object({ master: FetchEvidenceSchema.extend({ endpoint: z.literal('/v2/equities/master') }).strict(),
    calendar: FetchEvidenceSchema.extend({ endpoint: z.literal('/v2/markets/calendar') }).strict() }).strict(),
  rows: z.array(WorkspaceMasterSchema).min(1).max(10000) }).strict();
export const EpisodeObjectSchema = z.object({ version: z.literal('workspace_episode_v1'), instrumentId: Id,
  observation: WorkspaceMasterSchema, from: DateValue, catalog: ObjectRefSchema,
  previous: ObjectRefSchema.nullable() }).strict().refine(v => v.from <= v.observation.Date);
export const ReceiptObjectSchema = z.object({ version: z.literal('workspace_receipt_v1'), identity: FrozenIdentitySchema,
  artifact: ObjectRefSchema, receipt: MarketDataObservationReceiptV1Schema }).strict();
const metadata = (scope: ObjectMetadata['scope'], effectiveDate: string, dependencies: ObjectRef[],
  sourceDefinition = 'workspace_jquants_eod_v1', calculationVersion = 'technical_chart_calculation_v2'): ObjectMetadata =>
  ({ scope, effectiveDate, dependencies, sourceDefinition, calculationVersion });
export const workspaceDataCodecs: ReferenceCodecs = new Map([
  ['workspace_catalog_v1', value => {
    const catalog = parse(CatalogObjectSchema, value);
    const window = createTechnicalSourceRequestWindowV1(catalog.acceptedAt);
    const start = new Date(`${window.calculationDate.slice(0, 7)}-01T00:00:00Z`); start.setUTCMonth(start.getUTCMonth() - 1);
    if (catalog.calendarFrom !== start.toISOString().slice(0, 10) || catalog.calendarThrough !== window.calendarCoverageTo
      || catalog.sources.master.rowCount < catalog.rows.length || catalog.sources.calendar.rowCount !== catalog.calendar.length
      || Object.values(catalog.sources).some(source => source.fetchedAt < catalog.acceptedAt)) fail('reference_conflict');
    const calendar = mapTechnicalCalendarV1(catalog.calendar, catalog.calendarFrom, catalog.calendarThrough);
    if (resolveTechnicalEligibleThroughV1({ ...window, queryFrom: catalog.calendarFrom, calendarCoverageFrom: catalog.calendarFrom }, calendar.calendar) !== catalog.date)
      fail('reference_conflict');
    if (new Set(catalog.rows.map(r => r.Code)).size !== catalog.rows.length) fail('invalid_input');
    for (const row of catalog.rows) if (row.Date !== catalog.date || validateCurrentTechnicalMasterV1([row],
      { ticker: row.Code.slice(0, 4), eligibleThrough: catalog.date }).state !== 'accepted') fail('invalid_input');
    return metadata({ kind: 'market-scoped', universe: 'ordinary_stock_catalog', definitionVersion: 'v1' }, catalog.date, [],
      catalog.sourceDefinition, catalog.version);
  }],
  ['workspace_episode_v1', value => {
    const episode = parse(EpisodeObjectSchema, value);
    return metadata({ kind: 'instrument-owned', instrumentId: episode.instrumentId }, episode.observation.Date,
      [episode.catalog, ...(episode.previous ? [episode.previous] : [])], 'jquants_dated_ordinary_master_v1', episode.version);
  }],
  ['workspace_technical_input_v1', value => {
    const input = calculateWorkspaceTechnical(value).input;
    return metadata({ kind: 'instrument-owned', instrumentId: input.identity.instrumentId }, input.queryTo, [input.masterEvidence]);
  }],
  ['workspace_technical_v2', value => {
    const input = parse(TechnicalInputSchema, (value as { input?: unknown })?.input);
    const artifact = new WorkspaceTechnicalCodec(input.identity.code.slice(0, 4)).parse(value);
    return metadata({ kind: 'instrument-owned', instrumentId: input.identity.instrumentId }, artifact.dataDate, [input.masterEvidence]);
  }],
  ['workspace_receipt_v1', value => {
    const envelope = parse(ReceiptObjectSchema, value), receipt = validateReceiptV1(envelope.receipt);
    if (receipt.target.kind !== 'technical' || `${receipt.target.ticker}0` !== envelope.identity.code) fail('reference_conflict');
    return metadata({ kind: 'instrument-owned', instrumentId: envelope.identity.instrumentId }, receipt.artifactIdentity.dataDate, [envelope.artifact]);
  }],
]);

/** Source staging is private; only successfully registered canonical bytes are references. */
export async function retainWorkspaceObject(db: WorkspaceDatabase, codec: string, value: unknown): Promise<ObjectRef> {
  const ref = stageWorkspaceObject(db, codec, value);
  await registerReferences(db, resolve(db.root, 'imports'), [ref], workspaceDataCodecs);
  return ref;
}
export function stageWorkspaceObject(db: WorkspaceDatabase, codec: string, value: unknown): ObjectRef {
  if (!workspaceDataCodecs.has(codec)) fail('schema_unsupported');
  workspaceDataCodecs.get(codec)!(value);
  const bytes = json(value), path = `${randomUUID()}.json`, root = resolve(db.root, 'imports');
  const ref = { path, codec, digest: digest(bytes) };
  writeExclusive(resolve(root, path), bytes);
  return ref;
}
export function cleanupWorkspaceImports(db: WorkspaceDatabase): void {
  const root = resolve(db.root, 'imports');
  for (const name of readdirSync(root)) if (/^[a-f0-9-]{36}\.json$/.test(name)) unlinkSync(resolve(root, name));
}
/** Main-thread single-writer registration for worker-validated immutable bytes. */
export function retainValidatedWorkspaceObject(db: WorkspaceDatabase, codec: string, value: unknown, metadata: ObjectMetadata): ObjectRef {
  return retainValidatedWorkspaceBytes(db, codec, json(value), metadata);
}
export function retainValidatedWorkspaceBytes(db: WorkspaceDatabase, codec: string, bytes: string, metadata: ObjectMetadata,
  checkpoint?: PublicationCheckpoint): ObjectRef {
  if (!workspaceDataCodecs.has(codec)) fail('schema_unsupported');
  parse(ObjectMetadataSchema, metadata);
  const ref: ObjectRef = { path: `${randomUUID()}.json`, codec, digest: digest(bytes) };
  retainVerifiedObject(db, { ref, metadata, bytes: new TextEncoder().encode(bytes) }, checkpoint);
  return ref;
}

/** Validate cross-object claims as well as each codec; also used by Backup/Restore. */
export function validateDataObjectLinks(objects: readonly VerifiedObject[]): void {
  const index = new Map(objects.map(object => [json(object.ref), object]));
  const decoded = new Map<string, unknown>(), catalogs = new Map<string, Set<string>>();
  const get = (ref: ObjectRef) => {
    const key = json(ref), object = index.get(key);
    if (!object) fail('reference_missing');
    if (!decoded.has(key)) decoded.set(key, JSON.parse(new TextDecoder().decode(object.bytes)) as unknown);
    return decoded.get(key);
  };
  for (const object of objects) {
    if (!workspaceDataCodecs.has(object.ref.codec)) continue;
    const value: unknown = JSON.parse(new TextDecoder().decode(object.bytes));
    if (object.ref.codec === 'workspace_episode_v1') {
      const e = parse(EpisodeObjectSchema, value), key = json(e.catalog);
      if (!catalogs.has(key)) catalogs.set(key, new Set(parse(CatalogObjectSchema, get(e.catalog)).rows.map(row => json(row))));
      if (!catalogs.get(key)!.has(json(e.observation))) fail('reference_conflict');
      if (e.previous) {
        const old = parse(EpisodeObjectSchema, get(e.previous));
        if (old.instrumentId !== e.instrumentId || old.from !== e.from || old.observation.Code !== e.observation.Code
          || old.observation.Date > e.observation.Date) fail('reference_conflict');
      } else if (e.from !== e.observation.Date) fail('reference_conflict');
    } else if (['workspace_technical_input_v1', 'workspace_technical_v2'].includes(object.ref.codec)) {
      const input = parse(TechnicalInputSchema, object.ref.codec === 'workspace_technical_v2' ? (value as { input: unknown }).input : value);
      const episode = parse(EpisodeObjectSchema, get(input.masterEvidence));
      if (input.identity.instrumentId !== episode.instrumentId || input.identity.code !== episode.observation.Code
        || input.eligibilityFrom !== episode.from || json(input.master) !== json(episode.observation)) fail('reference_conflict');
    } else if (object.ref.codec === 'workspace_receipt_v1') {
      const e = parse(ReceiptObjectSchema, value), codec = new WorkspaceTechnicalCodec(e.identity.code.slice(0, 4));
      const artifact = codec.parse(get(e.artifact));
      if (json(codec.identity(artifact)) !== json(e.receipt.artifactIdentity) || json(e.identity) !== json(artifact.input.identity)) fail('reference_conflict');
    }
  }
}
