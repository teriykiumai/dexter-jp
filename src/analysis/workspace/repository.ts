import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import { WorkspaceDatabase } from './database.js';
import { DateValue, DEFAULT_PREFERENCES, DrawingSchema, FrozenIdentitySchema, Id, ObjectRefSchema,
  PreferencesSchema, ScopeSchema, Token, fail, json, objectKey, parse, restoredDrawing, safe, scopeKey,
  type ChartPreferences, type FrozenIdentity, type ObjectRef, type StoredDrawing, type WorkspaceScope } from './contracts.js';
import { metadataFor, objectRow, requireScope, rowRef } from './references.js';

const CatalogRowSchema = z.object({ instrumentId: Id, assetType: z.enum(['stock', 'etf', 'reit']),
  provider: Token, code: Token, label: z.string().trim().min(1).max(200), mappingRevision: z.number().int().positive(),
  episodeFrom: DateValue, episodeThrough: DateValue.nullable(), evidence: ObjectRefSchema }).strict()
  .refine(r => r.episodeThrough === null || r.episodeThrough >= r.episodeFrom);
export type CatalogRow = z.infer<typeof CatalogRowSchema>;
type SqlCatalogRow = { instrument_id: string; provider: string; code: string; label: string;
  mapping_revision: number; generation: number; episode_from: string; episode_through: string | null };
type Binding = { binding_id: string; scope: string; dataset: string; artifact: string; receipt: string; frozen_identity: string | null };

export class WorkspaceRepository {
  constructor(readonly db: WorkspaceDatabase) {}
  requestCatalog(effectiveDate: string): number {
    parse(DateValue, effectiveDate);
    return this.db.transaction(() => Number(this.db.sqlite.run(
      "INSERT INTO catalog_generations(effective_date,state) VALUES (?,'pending')", [effectiveDate]).lastInsertRowid));
  }
  failCatalog(generation: number): void {
    this.db.transaction(() => {
      this.db.sqlite.run("UPDATE catalog_generations SET state='failed' WHERE generation=? AND state='pending'", [generation]);
    });
  }
  /** Only validated complete typed master results enter here; pagination/source proof is Step 2A. */
  async acceptCatalog(generation: number, rows: readonly CatalogRow[], masterEvidence: ObjectRef): Promise<'active' | 'superseded'> {
    if (!Number.isSafeInteger(generation) || generation < 1 || rows.length === 0 || rows.length > 20_000) fail('invalid_input');
    // Snapshot the flat typed rows before yielding; validation/secret filtering of
    // all 10k rows at once can stall the foreground for more than a second.
    const input = rows.map(row => ({ ...row, evidence: { ...row.evidence } }));
    const normalized: CatalogRow[] = [];
    for (let offset = 0; offset < input.length; offset += 250) {
      const chunk = input.slice(offset, offset + 250).map(row => parse(CatalogRowSchema, row));
      safe(chunk); normalized.push(...chunk); await setImmediate();
    }
    if (new Set(normalized.map(r => `${r.provider}:${r.code}`)).size !== rows.length
      || new Set(normalized.map(r => r.instrumentId)).size !== rows.length) fail('invalid_input');
    const master = metadataFor(this.db, objectKey(masterEvidence));
    if (master.scope.kind !== 'market-scoped') fail('reference_conflict');
    this.assertPendingCatalog(generation);
    if (this.db.sqlite.query<{ effective_date: string }, [number]>(
      'SELECT effective_date FROM catalog_generations WHERE generation=?').get(generation)?.effective_date !== master.effectiveDate) fail('reference_conflict');
    for (let offset = 0; offset < normalized.length; offset += 250) {
      this.db.transaction(() => {
        this.assertPendingCatalog(generation);
        for (const row of normalized.slice(offset, offset + 250)) {
          const evidence = requireScope(this.db, objectKey(row.evidence), { kind: 'instrument-owned', instrumentId: row.instrumentId });
          if (evidence.effectiveDate !== master.effectiveDate
            || !evidence.dependencies.some(ref => objectKey(ref) === objectKey(masterEvidence))) fail('reference_conflict');
          const previous = this.db.sqlite.query<SqlCatalogRow, [string]>(`SELECT r.* FROM catalog_rows r
            JOIN catalog_generations g USING(generation) WHERE r.instrument_id=? AND g.activated=1
            ORDER BY generation DESC LIMIT 1`).get(row.instrumentId);
          if (previous) {
            const changed = previous.provider !== row.provider || previous.code !== row.code
              || previous.episode_from !== row.episodeFrom || previous.episode_through !== row.episodeThrough;
            if (row.mappingRevision !== previous.mapping_revision + (changed ? 1 : 0)) fail('identity_review_required');
          } else if (row.mappingRevision !== 1) fail('identity_review_required');
          const known = this.db.sqlite.query<{ asset_type: string }, [string]>(
            'SELECT asset_type FROM instruments WHERE instrument_id=?').get(row.instrumentId);
          if (known && known.asset_type !== row.assetType) fail('identity_review_required');
          this.db.sqlite.run('INSERT OR IGNORE INTO instruments VALUES (?,?)', [row.instrumentId, row.assetType]);
          this.db.sqlite.run('INSERT INTO catalog_rows VALUES (?,?,?,?,?,?,?,?,?)', [generation, row.instrumentId,
            row.provider, row.code, row.label, row.mappingRevision, row.episodeFrom, row.episodeThrough, objectKey(row.evidence)]);
        }
      });
      await setImmediate();
    }
    return this.db.transaction(() => {
      this.assertPendingCatalog(generation);
      const current = this.db.sqlite.query<{ effective_date: string }, []>(
        "SELECT effective_date FROM catalog_generations WHERE state='active'").get();
      const desired = this.db.sqlite.query<{ generation: number }, []>('SELECT MAX(generation) AS generation FROM catalog_generations').get()!.generation;
      if (desired !== generation || current && master.effectiveDate < current.effective_date) {
        this.db.sqlite.run("UPDATE catalog_generations SET state='superseded',evidence=? WHERE generation=?", [objectKey(masterEvidence), generation]);
        return 'superseded';
      }
      this.db.sqlite.run("UPDATE catalog_generations SET state='superseded' WHERE state='active'");
      this.db.sqlite.run("UPDATE catalog_generations SET state='active',activated=1,evidence=? WHERE generation=?", [objectKey(masterEvidence), generation]);
      return 'active';
    });
  }
  private assertPendingCatalog(generation: number): void {
    if (this.db.sqlite.query<{ state: string }, [number]>(
      'SELECT state FROM catalog_generations WHERE generation=?').get(generation)?.state !== 'pending') fail('revision_conflict');
  }
  search(query: string, limit = 30): { instrumentId: string; code: string; label: string }[] {
    this.db.assertAvailable();
    if (query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid_input');
    const term = query.trim().normalize('NFKC').replace(/[\\%_]/g, '\\$&');
    return this.db.sqlite.query<{ instrumentId: string; code: string; label: string }, [string, string, number]>(
      `SELECT r.instrument_id AS instrumentId,r.code,r.label FROM catalog_rows r
       JOIN catalog_generations g USING(generation) WHERE g.state='active'
       AND (r.code LIKE ? ESCAPE '\\' OR r.label LIKE ? ESCAPE '\\') ORDER BY r.code LIMIT ?`).all(`${term}%`, `%${term}%`, limit);
  }
  freezeIdentity(instrumentId: string): FrozenIdentity {
    this.db.assertAvailable(); parse(Id, instrumentId);
    const row = this.db.sqlite.query<SqlCatalogRow, [string]>(`SELECT r.* FROM catalog_rows r
      JOIN catalog_generations g USING(generation) WHERE g.state='active' AND r.instrument_id=?`).get(instrumentId);
    if (!row) fail('identity_review_required');
    return { instrumentId, provider: row.provider, code: row.code,
      mappingRevision: row.mapping_revision, catalogGeneration: row.generation };
  }
  identityMatches(identity: FrozenIdentity): boolean {
    parse(FrozenIdentitySchema, identity);
    const found = this.db.sqlite.query<{ count: number }, [string, string, string, number, number]>(`SELECT COUNT(*) AS count
      FROM catalog_rows r JOIN catalog_generations g USING(generation) WHERE g.state='active'
      AND r.instrument_id=? AND r.provider=? AND r.code=? AND r.mapping_revision=? AND r.generation=?`).get(
      identity.instrumentId, identity.provider, identity.code, identity.mappingRevision, identity.catalogGeneration);
    return found?.count === 1;
  }
  openWorkspace(instrumentId: string, openedAt = new Date().toISOString()): void {
    parse(Id, instrumentId); parse(z.iso.datetime(), openedAt);
    this.db.transaction(() => {
      if (!this.db.sqlite.query('SELECT instrument_id FROM instruments WHERE instrument_id=?').get(instrumentId)) fail('not_found');
      this.db.sqlite.run(`INSERT INTO workspaces(instrument_id,last_opened_at) VALUES (?,?)
        ON CONFLICT(instrument_id) DO UPDATE SET last_opened_at=excluded.last_opened_at,revision=revision+1`, [instrumentId, openedAt]);
      this.db.sqlite.run('INSERT OR IGNORE INTO chart_preferences VALUES (?,?,1)', [instrumentId, json(DEFAULT_PREFERENCES)]);
    });
  }
  preferences(instrumentId: string): { value: ChartPreferences; revision: number } {
    this.db.assertAvailable(); parse(Id, instrumentId);
    const row = this.db.sqlite.query<{ settings: string; revision: number }, [string]>(
      'SELECT settings,revision FROM chart_preferences WHERE instrument_id=?').get(instrumentId) ?? fail('not_found');
    return { value: parse(PreferencesSchema, JSON.parse(row.settings)), revision: row.revision };
  }
  savePreferences(instrumentId: string, value: ChartPreferences, expectedRevision: number): number {
    parse(Id, instrumentId); const normalized = parse(PreferencesSchema, value);
    return this.db.transaction(() => {
      const result = this.db.sqlite.run('UPDATE chart_preferences SET settings=?,revision=revision+1 WHERE instrument_id=? AND revision=?',
        [json(normalized), instrumentId, expectedRevision]);
      if (result.changes !== 1) fail('revision_conflict');
      return expectedRevision + 1;
    });
  }
  saveDrawing(value: StoredDrawing, expectedRevision: number): void {
    const drawing = parse(DrawingSchema, value);
    if (drawing.revision !== expectedRevision + 1 || expectedRevision < 0) fail('revision_conflict');
    this.db.transaction(() => {
      requireScope(this.db, objectKey(drawing.basisObject), { kind: 'instrument-owned', instrumentId: drawing.instrumentId });
      if (drawing.acceptedBasis) requireScope(this.db, objectKey(drawing.acceptedBasis.object), { kind: 'instrument-owned', instrumentId: drawing.instrumentId });
      const { basisObject: _basis, revision: _revision, ...anchors } = drawing;
      if (expectedRevision === 0) {
        if (this.db.sqlite.query('SELECT drawing_id FROM drawings WHERE drawing_id=?').get(drawing.id)) fail('revision_conflict');
        this.db.sqlite.run('INSERT INTO drawings VALUES (?,?,?,?,?)', [drawing.id, drawing.instrumentId,
          json(anchors), objectKey(drawing.basisObject), drawing.revision]);
      } else if (this.db.sqlite.run(`UPDATE drawings SET anchors=?,basis_object=?,revision=?
        WHERE drawing_id=? AND instrument_id=? AND revision=?`, [json(anchors), objectKey(drawing.basisObject),
        drawing.revision, drawing.id, drawing.instrumentId, expectedRevision]).changes !== 1) fail('revision_conflict');
    });
  }
  drawing(instrumentId: string, id: string): StoredDrawing | null {
    this.db.assertAvailable(); parse(Id, instrumentId); parse(Id, id);
    const row = this.db.sqlite.query<{ anchors: string; basis_object: string; revision: number }, [string, string]>(
      'SELECT anchors,basis_object,revision FROM drawings WHERE instrument_id=? AND drawing_id=?').get(instrumentId, id);
    if (!row) return null;
    const drawing = restoredDrawing(row.anchors, rowRef(objectRow(this.db, row.basis_object)), row.revision);
    if (drawing.instrumentId !== instrumentId || drawing.id !== id) fail('reference_conflict');
    requireScope(this.db, row.basis_object, { kind: 'instrument-owned', instrumentId });
    if (drawing.acceptedBasis) requireScope(this.db, objectKey(drawing.acceptedBasis.object), { kind: 'instrument-owned', instrumentId });
    return drawing;
  }
  /** Restore an exact server-retained command into an absent ID, without resetting its revision. */
  restoreDrawing(value: StoredDrawing): void {
    const drawing = parse(DrawingSchema, value);
    this.db.transaction(() => {
      const scope = { kind: 'instrument-owned' as const, instrumentId: drawing.instrumentId };
      requireScope(this.db, objectKey(drawing.basisObject), scope);
      if (drawing.acceptedBasis) requireScope(this.db, objectKey(drawing.acceptedBasis.object), scope);
      if (this.db.sqlite.query('SELECT drawing_id FROM drawings WHERE drawing_id=?').get(drawing.id)) fail('revision_conflict');
      const { basisObject, revision, ...anchors } = drawing;
      this.db.sqlite.run('INSERT INTO drawings VALUES (?,?,?,?,?)', [drawing.id, drawing.instrumentId, json(anchors), objectKey(basisObject), revision]);
    });
  }
  deleteDrawing(instrumentId: string, id: string, revision: number): void {
    parse(Id, instrumentId); parse(Id, id);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_input');
    this.db.transaction(() => {
      if (this.db.sqlite.run('DELETE FROM drawings WHERE instrument_id=? AND drawing_id=? AND revision=?',
        [instrumentId, id, revision]).changes !== 1) fail('revision_conflict');
    });
  }
  drawings(instrumentId: string, after = '', limit = 100): StoredDrawing[] {
    this.db.assertAvailable(); parse(Id, instrumentId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('invalid_input');
    return this.db.sqlite.query<{ drawing_id: string; anchors: string; basis_object: string; revision: number }, [string, string, number]>(
      'SELECT drawing_id,anchors,basis_object,revision FROM drawings WHERE instrument_id=? AND drawing_id>? ORDER BY drawing_id LIMIT ?').all(instrumentId, after, limit)
      .map(row => {
        const drawing = restoredDrawing(row.anchors, rowRef(objectRow(this.db, row.basis_object)), row.revision);
        if (drawing.instrumentId !== instrumentId || drawing.id !== row.drawing_id) fail('reference_conflict');
        requireScope(this.db, row.basis_object, { kind: 'instrument-owned', instrumentId });
        if (drawing.acceptedBasis) requireScope(this.db, objectKey(drawing.acceptedBasis.object), { kind: 'instrument-owned', instrumentId });
        return drawing;
      });
  }
  /** Foundation predicate for Step 2A's receipt-proven job finalizer; no publication here. */
  bind(identity: FrozenIdentity, artifact: ObjectRef, receipt: ObjectRef, dataset: string): string {
    parse(FrozenIdentitySchema, identity); parse(Token, dataset);
    return this.db.transaction(() => {
      const scope: WorkspaceScope = { kind: 'instrument-owned', instrumentId: identity.instrumentId };
      const committed = this.committedBinding(scope, artifact, receipt, dataset, identity);
      // Recovery acknowledges the exact committed result without moving a current
      // pointer backwards, even if a later catalog generation is now active.
      if (committed) return committed;
      if (!this.identityMatches(identity)) fail('identity_review_required');
      const row = this.db.sqlite.query<{ episode_from: string; episode_through: string | null }, [number, string]>(
        'SELECT episode_from,episode_through FROM catalog_rows WHERE generation=? AND instrument_id=?').get(identity.catalogGeneration, identity.instrumentId)!;
      const metadata = requireScope(this.db, objectKey(artifact), scope);
      if (metadata.effectiveDate < row.episode_from || row.episode_through && metadata.effectiveDate > row.episode_through) fail('identity_review_required');
      return this.insertBinding(scope, artifact, receipt, dataset, identity);
    });
  }
  bindContext(scope: WorkspaceScope, artifact: ObjectRef, receipt: ObjectRef, dataset: string): string {
    parse(ScopeSchema, scope); parse(Token, dataset);
    if (scope.kind === 'instrument-owned') fail('invalid_input');
    return this.db.transaction(() => this.insertBinding(scope, artifact, receipt, dataset, null));
  }
  private insertBinding(scope: WorkspaceScope, artifact: ObjectRef, receipt: ObjectRef, dataset: string, identity: FrozenIdentity | null): string {
    const a = requireScope(this.db, objectKey(artifact), scope), r = requireScope(this.db, objectKey(receipt), scope);
    if (!r.dependencies.some(ref => objectKey(ref) === objectKey(artifact)) || r.effectiveDate !== a.effectiveDate
      || r.sourceDefinition !== a.sourceDefinition || r.calculationVersion !== a.calculationVersion) fail('reference_conflict');
    const committed = this.committedBinding(scope, artifact, receipt, dataset, identity);
    if (committed) return committed;
    const id = randomUUID();
    this.db.sqlite.run('INSERT INTO artifact_bindings VALUES (?,?,?,?,?,?)', [id, scopeKey(scope), dataset, objectKey(artifact), objectKey(receipt), identity ? json(identity) : null]);
    this.db.sqlite.run(`INSERT INTO data_sync_state VALUES (?,?,?,'available')
      ON CONFLICT(scope,dataset) DO UPDATE SET binding_id=excluded.binding_id,status='available'`, [scopeKey(scope), dataset, id]);
    return id;
  }
  private committedBinding(scope: WorkspaceScope, artifact: ObjectRef, receipt: ObjectRef, dataset: string, identity: FrozenIdentity | null): string | null {
    const previous = this.db.sqlite.query<Binding, [string, string]>(
      'SELECT * FROM artifact_bindings WHERE artifact=? AND receipt=?').get(objectKey(artifact), objectKey(receipt));
    if (!previous) return null;
    if (previous.scope !== scopeKey(scope) || previous.dataset !== dataset
      || previous.frozen_identity !== (identity ? json(identity) : null)) fail('reference_conflict');
    return previous.binding_id;
  }
  linkContext(instrumentId: string, role: string, bindingId: string, membership: ObjectRef): void {
    parse(Id, instrumentId); parse(Token, role); parse(Id, bindingId);
    this.db.transaction(() => {
      const binding = this.db.sqlite.query<Binding, [string]>('SELECT * FROM artifact_bindings WHERE binding_id=?').get(bindingId) ?? fail('not_found');
      if (binding.dataset !== role) fail('reference_conflict');
      if (parse(ScopeSchema, JSON.parse(binding.scope)).kind === 'instrument-owned') fail('reference_conflict');
      const evidence = requireScope(this.db, objectKey(membership), { kind: 'instrument-owned', instrumentId });
      if (evidence.effectiveDate !== metadataFor(this.db, binding.artifact).effectiveDate
        || !evidence.dependencies.some(ref => objectKey(ref) === binding.artifact)) fail('reference_conflict');
      this.db.sqlite.run(`INSERT INTO shared_context_links VALUES (?,?,?,?) ON CONFLICT(instrument_id,role)
        DO UPDATE SET binding_id=excluded.binding_id,membership=excluded.membership`, [instrumentId, role, bindingId, objectKey(membership)]);
    });
  }
  current(scope: WorkspaceScope, dataset: string): ObjectRef | null {
    this.db.assertAvailable(); parse(Token, dataset);
    const row = this.db.sqlite.query<{ artifact: string }, [string, string]>(`SELECT b.artifact FROM data_sync_state s
      JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset=? AND s.status='available'`).get(scopeKey(scope), dataset);
    return row ? rowRef(objectRow(this.db, row.artifact)) : null;
  }
}
