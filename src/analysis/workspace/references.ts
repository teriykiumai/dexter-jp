import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { type WorkspaceDatabase } from './database.js';
import { FrozenIdentitySchema, PreferencesSchema, ObjectMetadataSchema, ObjectRefSchema, ScopeSchema, Token, digest, fail, json, objectKey, parse, restoredDrawing, safe,
  scopeKey, type ObjectMetadata, type ObjectRef, type ReferenceCodecs, type WorkspaceScope } from './contracts.js';
import { objectPath, readBytes, stageFile, syncDirectory, type PublicationCheckpoint } from './files.js';
import { parseStrictJsonBytesV1 } from '../strategy-validation/strict-json.js';
import { validateDataObjectLinks, ReceiptObjectSchema, EpisodeObjectSchema } from './data-objects.js';
import { TechnicalInputSchema } from './technical-input.js';
import { SupplyPreparedSchema, SupplyReceiptSchema, supplyArtifact } from './supply-objects.js';
import { WorkspaceSupplyCodec, supplyTarget } from './supply-artifact.js';

export type ObjectRow = { object_key: string; path: string; codec: string; digest: string; metadata: string };
export type VerifiedObject = { ref: ObjectRef; metadata: ObjectMetadata; bytes: Uint8Array };
/** Codecs are reviewed source-specific parsers, never supplied by HTTP or a backup.
 * No generic/open codec is installed: Step 2A registers the Market Data codecs. */
function verifyAt(path: string, ref: ObjectRef, codecs: ReferenceCodecs): VerifiedObject {
  parse(ObjectRefSchema, ref);
  const codec = codecs.get(ref.codec); if (!codec) fail('schema_unsupported');
  if (!existsSync(path)) fail('reference_missing');
  const bytes = readBytes(path);
  if (digest(bytes) !== ref.digest) fail('reference_conflict');
  const value = parseStrictJsonBytesV1(bytes, bytes.length); safe(value);
  const metadata = parse(ObjectMetadataSchema, codec(value));
  if (new Set(metadata.dependencies.map(objectKey)).size !== metadata.dependencies.length) fail('reference_conflict');
  return { ref, metadata, bytes };
}
/** Fixed object-key-v1 layout, also recorded in workspace_meta. Source paths remain
 * logical provenance; relocation never changes a ref or requires the original root. */
export function referencePath(workspaceRoot: string, ref: ObjectRef): string {
  return objectPath(resolve(workspaceRoot, 'objects'), `${objectKey(ref).slice(7)}.json`);
}
export function resolveReference(db: WorkspaceDatabase, ref: ObjectRef, codecs: ReferenceCodecs): VerifiedObject {
  db.assertAvailable();
  const row = objectRow(db, objectKey(ref));
  const object = verifyAt(referencePath(db.root, ref), ref, codecs);
  if (json(rowRef(row)) !== json(ref) || row.metadata !== json(object.metadata)) fail('reference_conflict');
  return object;
}
export function objectRow(db: WorkspaceDatabase, key: string): ObjectRow {
  return db.sqlite.query<ObjectRow, [string]>('SELECT * FROM immutable_objects WHERE object_key=?').get(key) ?? fail('reference_missing');
}
export function rowRef(row: ObjectRow): ObjectRef {
  return parse(ObjectRefSchema, { path: row.path, codec: row.codec, digest: row.digest });
}
export function metadataFor(db: WorkspaceDatabase, key: string): ObjectMetadata {
  return parse(ObjectMetadataSchema, JSON.parse(objectRow(db, key).metadata));
}
export function requireScope(db: WorkspaceDatabase, key: string, expected: WorkspaceScope): ObjectMetadata {
  const metadata = metadataFor(db, key);
  if (scopeKey(metadata.scope) !== scopeKey(expected)) fail('reference_conflict');
  return metadata;
}
function publishObject(db: WorkspaceDatabase, object: VerifiedObject, checkpoint?: PublicationCheckpoint): void {
  db.assertAvailable();
  const path = referencePath(db.root, object.ref);
  const temporary = stageFile(path, object.bytes, checkpoint);
  try {
    db.transaction(() => {
      const registered = db.sqlite.query('SELECT object_key FROM immutable_objects WHERE object_key=?').get(objectKey(object.ref));
      if (existsSync(path)) {
        if (digest(readBytes(path)) === object.ref.digest) return;
        if (registered) fail('reference_conflict');
        renameSync(path, `${path}.quarantine-${randomUUID()}`);
        syncDirectory(resolve(db.root, 'objects'));
      } else if (registered) fail('reference_missing');
      renameSync(temporary, path); syncDirectory(resolve(db.root, 'objects'));
      checkpoint?.('published');
    });
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function registerObjectRows(db: WorkspaceDatabase, objects: readonly VerifiedObject[]): void {
  db.transaction(() => {
    for (const { ref, metadata } of objects) {
      const key = objectKey(ref), existing = db.sqlite.query<ObjectRow, [string]>(
        'SELECT * FROM immutable_objects WHERE object_key=?').get(key);
      if (existing) {
        if (json(rowRef(existing)) !== json(ref) || existing.metadata !== json(metadata)) fail('reference_conflict');
        continue;
      }
      db.sqlite.run('INSERT INTO immutable_objects VALUES (?,?,?,?,?)', [key, ref.path, ref.codec, ref.digest, json(metadata)]);
      for (const child of metadata.dependencies) db.sqlite.run('INSERT INTO object_dependencies VALUES (?,?)', [key, objectKey(child)]);
    }
  });
}
/** Worker validation may avoid a second codec pass, but never the archive guard. */
export function retainVerifiedObject(db: WorkspaceDatabase, object: VerifiedObject, checkpoint?: PublicationCheckpoint): void {
  publishObject(db, object, checkpoint);
  registerObjectRows(db, [object]);
}
function* collectSteps(roots: readonly ObjectRef[], read: (ref: ObjectRef) => VerifiedObject): Generator<void, VerifiedObject[]> {
  const found = new Map<string, VerifiedObject>(), visiting = new Set<string>();
  let totalBytes = 0;
  function* visit(ref: ObjectRef): Generator<void> {
    yield; // A checkpoint also bounds duplicate roots and deep dependency walks.
    const key = objectKey(ref);
    if (visiting.has(key)) fail('reference_conflict');
    if (found.has(key)) return;
    if (visiting.size > 100 || found.size >= 100_000) fail('backup_invalid');
    visiting.add(key);
    const object = read(ref);
    yield;
    totalBytes += object.bytes.byteLength;
    if (totalBytes > 1024 * 1024 * 1024) fail('backup_invalid');
    for (const child of object.metadata.dependencies) {
      yield* visit(child);
      const childScope = found.get(objectKey(child))!.metadata.scope;
      if (childScope.kind === 'instrument-owned' && scopeKey(childScope) !== scopeKey(object.metadata.scope)) fail('reference_conflict');
    }
    visiting.delete(key); found.set(key, object);
  }
  if (roots.length > 100_000) fail('backup_invalid');
  for (const ref of roots) yield* visit(ref);
  return [...found.values()];
}
/** Import exact dependencies, not another EOD publisher or latest selector. A failed
 * ingest may retain verified unbound objects; catalog/binding activation is separate. */
export async function registerReferences(db: WorkspaceDatabase, sourceRoot: string, roots: readonly ObjectRef[], codecs: ReferenceCodecs,
  publicationCheckpoint?: PublicationCheckpoint): Promise<void> {
  db.assertAvailable();
  sourceRoot = resolve(sourceRoot);
  if (roots.length > 100_000) fail('backup_invalid');
  const input = roots.map(ref => ({ ...ref }));
  const walk = collectSteps(input, ref => {
    db.assertAvailable();
    const known = db.sqlite.query('SELECT object_key FROM immutable_objects WHERE object_key=?').get(objectKey(ref));
    // Registered dependencies resolve exclusively from the canonical archive.
    // A missing/corrupt archived object must not silently fall back to source/latest.
    return known ? resolveReference(db, ref, codecs) : verifyAt(objectPath(sourceRoot, ref.path), ref, codecs);
  });
  let sinceYield = performance.now(), steps = 0;
  async function checkpoint(): Promise<void> {
    if (++steps >= 16 || performance.now() - sinceYield >= 8) {
      await setImmediate(); db.assertAvailable(); steps = 0; sinceYield = performance.now();
    }
  }
  let next = walk.next();
  while (!next.done) { await checkpoint(); next = walk.next(); }
  const objects = next.value;
  validateDataObjectLinks(objects);
  for (let offset = 0; offset < objects.length; offset += 16) {
    const batch = objects.slice(offset, offset + 16);
    for (const object of batch) {
      publishObject(db, object, publicationCheckpoint);
      await checkpoint();
    }
    // Dependencies precede parents; every committed row has durable bytes and a
    // complete FK closure, including when a later batch fails or the process exits.
    registerObjectRows(db, batch);
    await checkpoint();
  }
}

// Every external-reference-bearing table/column is enumerated. The schema fingerprint
// rejects unregistered additions; object rows themselves retain persistent references.
export const REFERENCE_ROOT_QUERIES = [
  ['immutable_objects', 'object_key', 'object_key'], ['catalog_generations', 'generation', 'evidence'],
  ['catalog_rows', "generation || ':' || provider || ':' || code", 'evidence'],
  ['drawings', 'drawing_id', 'basis_object'], ['artifact_bindings', 'binding_id', 'artifact'],
  ['artifact_bindings', 'binding_id', 'receipt'], ['analysis_jobs', 'job_id', 'input_object'],
  ['analysis_jobs', 'job_id', 'result_object'],
  ['shared_context_links', "instrument_id || ':' || role", 'membership'],
] as const;
export type ReferenceRoot = { table: string; record: string; field: string; object: string };
export function referenceRoots(db: WorkspaceDatabase): ReferenceRoot[] {
  const result: ReferenceRoot[] = [];
  for (const [table, key, field] of REFERENCE_ROOT_QUERIES) {
    for (const row of db.sqlite.query<{ record: string; object: string }, []>(
      `SELECT CAST(${key} AS TEXT) AS record, ${field} AS object FROM ${table} WHERE ${field} IS NOT NULL ORDER BY 1`).all()) {
      result.push({ table, ...row, field });
    }
  }
  if (db.sqlite.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version >= 2) {
    for (const field of ['master_object', 'input_object', 'result_object']) {
      for (const row of db.sqlite.query<{ record: string; object: string }, []>(
        `SELECT job_id AS record,${field} AS object FROM workspace_data_jobs WHERE ${field} IS NOT NULL ORDER BY job_id`).all())
        result.push({ table: 'workspace_data_jobs', ...row, field });
    }
  }
  for (const row of db.sqlite.query<{ drawing_id: string; anchors: string; basis_object: string; revision: number }, []>('SELECT * FROM drawings ORDER BY drawing_id').all()) {
    const drawing = restoredDrawing(row.anchors, rowRef(objectRow(db, row.basis_object)), row.revision);
    if (drawing.acceptedBasis) result.push({ table: 'drawings', record: row.drawing_id,
      field: 'acceptedBasis', object: objectKey(drawing.acceptedBasis.object) });
  }
  // Internal binding FKs retain both exact references, even without Drawings/AI.
  for (const table of ['data_sync_state', 'shared_context_links'] as const) {
    const key = table === 'data_sync_state' ? "s.scope || ':' || s.dataset" : "s.instrument_id || ':' || s.role";
    for (const row of db.sqlite.query<{ record: string; object: string }, []>(
      `SELECT ${key} AS record,b.artifact AS object FROM ${table} s JOIN artifact_bindings b USING(binding_id) ORDER BY 1`).all()) {
      result.push({ table, ...row, field: 'binding_id.artifact' });
    }
  }
  return result.sort((a, b) => json(a).localeCompare(json(b), 'en'));
}
export function validateReferences(db: WorkspaceDatabase, codecs: ReferenceCodecs): VerifiedObject[] {
  const rows = db.sqlite.query<ObjectRow, []>('SELECT * FROM immutable_objects ORDER BY object_key').all();
  const walk = collectSteps(rows.map(rowRef), ref => verifyAt(referencePath(db.root, ref), ref, codecs));
  let next = walk.next(); while (!next.done) next = walk.next(); // Offline backup/restore only.
  const objects = next.value;
  validateDataObjectLinks(objects);
  if (objects.length !== rows.length) fail('reference_missing');
  const byKey = new Map(objects.map(object => [objectKey(object.ref), object]));
  if (db.sqlite.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version >= 2) {
    const value = (key: string) => {
      const object = byKey.get(key) ?? fail('reference_missing');
      return JSON.parse(new TextDecoder().decode(object.bytes));
    };
    for (const job of db.sqlite.query<{ job_id: string; kind: string; state: string; accepted_at: string; identity: string | null;
      master_object: string | null; input_object: string | null; result_object: string | null; generation: number | null }, []>('SELECT * FROM workspace_data_jobs').all()) {
      // Resolve ambiguous publication before an offline backup can claim closure.
      if (job.state === 'publishing') fail('backup_invalid');
      if (job.kind === 'technical') {
        const identity = parse(FrozenIdentitySchema, JSON.parse(job.identity!));
        const episode = parse(EpisodeObjectSchema, value(job.master_object!));
        if (identity.instrumentId !== episode.instrumentId || identity.code !== episode.observation.Code) fail('reference_conflict');
        if (job.input_object) {
          const prepared = value(job.input_object) as { input: unknown };
          const input = parse(TechnicalInputSchema, prepared.input);
          if (json(input.identity) !== json(identity) || objectKey(input.masterEvidence) !== job.master_object) fail('reference_conflict');
        }
        if (job.result_object) {
          const receipt = parse(ReceiptObjectSchema, value(job.result_object));
          if (json(receipt.identity) !== json(identity) || receipt.receipt.jobId !== job.job_id
            || receipt.receipt.acceptedAt !== job.accepted_at || !job.input_object) fail('reference_conflict');
          if (job.state === 'published' && !db.sqlite.query('SELECT binding_id FROM artifact_bindings WHERE artifact=? AND receipt=? AND frozen_identity=?')
            .get(objectKey(receipt.artifact), job.result_object, job.identity!)) fail('reference_conflict');
        }
      } else if (job.kind !== 'catalog') {
        const identity = parse(FrozenIdentitySchema, JSON.parse(job.identity!));
        const episode = parse(EpisodeObjectSchema, value(job.master_object!));
        if (identity.instrumentId !== episode.instrumentId || identity.code !== episode.observation.Code) fail('reference_conflict');
        if (job.input_object) {
          const prepared = parse(SupplyPreparedSchema, value(job.input_object));
          const artifact = supplyArtifact(prepared.artifact);
          if (json(prepared.identity) !== json(identity) || objectKey(prepared.master) !== job.master_object
            || artifact.input.dataset !== job.kind || artifact.asOfCutoff !== job.accepted_at) fail('reference_conflict');
        }
        if (job.result_object) {
          const receipt = parse(SupplyReceiptSchema, value(job.result_object));
          if (!job.input_object || receipt.receipt.jobId !== job.job_id || receipt.receipt.acceptedAt !== job.accepted_at) fail('reference_conflict');
          const prepared = supplyArtifact(parse(SupplyPreparedSchema, value(job.input_object)).artifact);
          const published = supplyArtifact(value(objectKey(receipt.artifact)));
          if (!new WorkspaceSupplyCodec(supplyTarget(prepared.input)).equivalent(prepared, published)) fail('reference_conflict');
          if (job.state === 'published' && !db.sqlite.query(`SELECT binding_id FROM artifact_bindings
            WHERE artifact=? AND receipt=? AND dataset=? AND scope=? AND frozen_identity IS ?`)
            .get(objectKey(receipt.artifact), job.result_object, job.kind, scopeKey(prepared.input.scope),
              job.kind === 'sector_short' ? null : job.identity!)) fail('reference_conflict');
        }
      } else if (job.result_object) {
        const generation = db.sqlite.query<{ evidence: string }, [number]>('SELECT evidence FROM catalog_generations WHERE generation=?').get(job.generation!);
        if (generation?.evidence !== job.result_object) fail('reference_conflict');
      }
    }
  }
  for (const row of rows) {
    const object = byKey.get(row.object_key);
    if (!object || objectKey(rowRef(row)) !== row.object_key || json(object.metadata) !== row.metadata) fail('reference_conflict');
    const children = db.sqlite.query<{ child: string }, [string]>(
      'SELECT child FROM object_dependencies WHERE parent=? ORDER BY child').all(row.object_key).map(r => r.child);
    if (json(children) !== json(object.metadata.dependencies.map(objectKey).sort())) fail('reference_conflict');
  }
  for (const root of referenceRoots(db)) if (!byKey.has(root.object)) fail('reference_missing');
  for (const generation of db.sqlite.query<{ effective_date: string; evidence: string | null; state: string; activated: number }, []>(
    'SELECT * FROM catalog_generations').all()) {
    if (generation.state === 'active' && !generation.activated || generation.activated && !generation.evidence) fail('reference_conflict');
    if (generation.evidence) {
      const master = metadataFor(db, generation.evidence);
      if (master.scope.kind !== 'market-scoped' || master.effectiveDate !== generation.effective_date) fail('reference_conflict');
    }
  }
  for (const table of ['drawings', 'analysis_jobs', 'catalog_rows'] as const) {
    const fields = table === 'drawings' ? ['basis_object'] : table === 'analysis_jobs' ? ['input_object', 'result_object'] : ['evidence'];
    for (const field of fields) {
      const owners = db.sqlite.query<{ instrument_id: string; object: string }, []>(
        `SELECT instrument_id,${field} AS object FROM ${table} WHERE ${field} IS NOT NULL`).all();
      for (const row of owners) requireScope(db, row.object, { kind: 'instrument-owned', instrumentId: row.instrument_id });
    }
  }
  for (const row of db.sqlite.query<{ settings: string }, []>('SELECT settings FROM chart_preferences').all()) parse(PreferencesSchema, JSON.parse(row.settings));
  for (const row of db.sqlite.query<{ drawing_id: string; instrument_id: string; anchors: string; basis_object: string; revision: number }, []>('SELECT * FROM drawings').all()) {
    const drawing = restoredDrawing(row.anchors, rowRef(objectRow(db, row.basis_object)), row.revision);
    if (drawing.id !== row.drawing_id || drawing.instrumentId !== row.instrument_id) fail('reference_conflict');
    if (drawing.acceptedBasis) requireScope(db, objectKey(drawing.acceptedBasis.object), { kind: 'instrument-owned', instrumentId: row.instrument_id });
  }
  for (const binding of db.sqlite.query<{ scope: string; dataset: string; artifact: string; receipt: string; frozen_identity: string | null }, []>('SELECT * FROM artifact_bindings').all()) {
    parse(Token, binding.dataset);
    const scope = parse(ScopeSchema, JSON.parse(binding.scope));
    if (scope.kind === 'instrument-owned') {
      const identity = parse(FrozenIdentitySchema, binding.frozen_identity ? JSON.parse(binding.frozen_identity) : null);
      const episode = db.sqlite.query<{ episode_from: string; episode_through: string | null }, [number, string, string, string, number]>(`SELECT r.episode_from,r.episode_through FROM catalog_rows r
        JOIN catalog_generations g USING(generation) WHERE g.activated=1 AND r.generation=? AND r.instrument_id=?
        AND r.provider=? AND r.code=? AND r.mapping_revision=?`).get(identity.catalogGeneration, identity.instrumentId,
        identity.provider, identity.code, identity.mappingRevision);
      const date = metadataFor(db, binding.artifact).effectiveDate;
      if (identity.instrumentId !== scope.instrumentId || !episode || date < episode.episode_from
        || episode.episode_through && date > episode.episode_through) fail('reference_conflict');
    } else if (binding.frozen_identity !== null) fail('reference_conflict');
    const artifact = requireScope(db, binding.artifact, scope), receipt = requireScope(db, binding.receipt, scope);
    if (!receipt.dependencies.some(ref => objectKey(ref) === binding.artifact)
      || artifact.effectiveDate !== receipt.effectiveDate || artifact.sourceDefinition !== receipt.sourceDefinition
      || artifact.calculationVersion !== receipt.calculationVersion) fail('reference_conflict');
  }
  for (const row of db.sqlite.query<{ instrument_id: string; membership: string; role: string; dataset: string; scope: string; artifact: string }, []>(
    'SELECT s.instrument_id,s.membership,s.role,b.dataset,b.scope,b.artifact FROM shared_context_links s JOIN artifact_bindings b USING(binding_id)').all()) {
    const membership = requireScope(db, row.membership, { kind: 'instrument-owned', instrumentId: row.instrument_id });
    if (row.role !== row.dataset || parse(ScopeSchema, JSON.parse(row.scope)).kind === 'instrument-owned'
      || membership.effectiveDate !== metadataFor(db, row.artifact).effectiveDate
      || !membership.dependencies.some(ref => objectKey(ref) === row.artifact)) fail('reference_conflict');
  }
  for (const row of db.sqlite.query<{ scope: string; binding_scope: string; dataset: string; binding_dataset: string }, []>(
    'SELECT s.scope,b.scope AS binding_scope,s.dataset,b.dataset AS binding_dataset FROM data_sync_state s JOIN artifact_bindings b USING(binding_id)').all()) {
    if (row.scope !== row.binding_scope || row.dataset !== row.binding_dataset) fail('reference_conflict');
  }
  return objects;
}
