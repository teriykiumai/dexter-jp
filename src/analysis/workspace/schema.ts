import type { Database } from 'bun:sqlite';
import { digest, fail, json } from './contracts.js';

export const WORKSPACE_SCHEMA_VERSION = 3;
const ddl = `
CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO workspace_meta VALUES ('object_store_layout','object-key-v1');
CREATE TABLE immutable_objects (
  object_key TEXT PRIMARY KEY, path TEXT NOT NULL, codec TEXT NOT NULL,
  digest TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata))
) STRICT;
CREATE TABLE object_dependencies (
  parent TEXT NOT NULL REFERENCES immutable_objects(object_key),
  child TEXT NOT NULL REFERENCES immutable_objects(object_key),
  PRIMARY KEY(parent, child), CHECK(parent <> child)
) STRICT;
CREATE TABLE instruments (
  instrument_id TEXT PRIMARY KEY, asset_type TEXT NOT NULL CHECK(asset_type IN ('stock','etf','reit'))
) STRICT;
CREATE TABLE catalog_generations (
  generation INTEGER PRIMARY KEY AUTOINCREMENT, effective_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','active','superseded','failed')),
  evidence TEXT REFERENCES immutable_objects(object_key),
  activated INTEGER NOT NULL DEFAULT 0 CHECK(activated IN (0,1))
) STRICT;
CREATE UNIQUE INDEX one_active_catalog ON catalog_generations(state) WHERE state='active';
CREATE TABLE catalog_rows (
  generation INTEGER NOT NULL REFERENCES catalog_generations(generation),
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id),
  provider TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL,
  mapping_revision INTEGER NOT NULL CHECK(mapping_revision > 0),
  episode_from TEXT NOT NULL, episode_through TEXT,
  evidence TEXT NOT NULL REFERENCES immutable_objects(object_key),
  PRIMARY KEY(generation, provider, code), UNIQUE(generation, instrument_id),
  CHECK(episode_through IS NULL OR episode_through >= episode_from)
) STRICT;
CREATE INDEX catalog_owner ON catalog_rows(instrument_id,generation);
CREATE INDEX catalog_search ON catalog_rows(generation,code);
CREATE TABLE workspaces (
  instrument_id TEXT PRIMARY KEY REFERENCES instruments(instrument_id),
  last_opened_at TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
) STRICT;
CREATE INDEX recent_workspaces ON workspaces(last_opened_at DESC);
CREATE TABLE chart_preferences (
  instrument_id TEXT PRIMARY KEY REFERENCES workspaces(instrument_id),
  settings TEXT NOT NULL CHECK(json_valid(settings)), revision INTEGER NOT NULL CHECK(revision > 0)
) STRICT;
CREATE TABLE drawings (
  drawing_id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES workspaces(instrument_id),
  anchors TEXT NOT NULL CHECK(json_valid(anchors)),
  basis_object TEXT NOT NULL REFERENCES immutable_objects(object_key),
  revision INTEGER NOT NULL CHECK(revision > 0)
) STRICT;
CREATE INDEX drawings_owner ON drawings(instrument_id,drawing_id);
CREATE TABLE artifact_bindings (
  binding_id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(json_valid(scope)),
  dataset TEXT NOT NULL,
  artifact TEXT NOT NULL REFERENCES immutable_objects(object_key),
  receipt TEXT NOT NULL REFERENCES immutable_objects(object_key),
  frozen_identity TEXT CHECK(frozen_identity IS NULL OR json_valid(frozen_identity)),
  UNIQUE(artifact,receipt)
) STRICT;
CREATE INDEX bindings_scope ON artifact_bindings(scope);
CREATE TABLE data_sync_state (
  scope TEXT NOT NULL, dataset TEXT NOT NULL,
  binding_id TEXT REFERENCES artifact_bindings(binding_id),
  status TEXT NOT NULL CHECK(status IN ('available','unavailable','uncollected')),
  PRIMARY KEY(scope,dataset), CHECK((status='available') = (binding_id IS NOT NULL))
) STRICT;
CREATE TABLE shared_context_links (
  instrument_id TEXT NOT NULL REFERENCES workspaces(instrument_id), role TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES artifact_bindings(binding_id),
  membership TEXT NOT NULL REFERENCES immutable_objects(object_key), PRIMARY KEY(instrument_id,role)
) STRICT;
CREATE TABLE analysis_jobs (
  job_id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES workspaces(instrument_id),
  profile TEXT NOT NULL CHECK(profile IN ('fundamental','supply_demand')),
  input_object TEXT NOT NULL REFERENCES immutable_objects(object_key),
  result_object TEXT REFERENCES immutable_objects(object_key),
  state TEXT NOT NULL CHECK(state IN ('prepared','interrupted','published')),
  CHECK((state='published') = (result_object IS NOT NULL))
) STRICT;
CREATE INDEX analysis_owner ON analysis_jobs(instrument_id,job_id);
CREATE TRIGGER immutable_object_update BEFORE UPDATE ON immutable_objects BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER immutable_object_delete BEFORE DELETE ON immutable_objects BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER immutable_binding_update BEFORE UPDATE ON artifact_bindings BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER immutable_binding_delete BEFORE DELETE ON artifact_bindings BEGIN SELECT RAISE(ABORT,'immutable'); END;
`;

export function schemaFingerprint(db: Database): string {
  return digest(json(db.query<{ type: string; name: string; sql: string }, []>(
    "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()));
}
const workspaceJobsDdl = `
CREATE TABLE workspace_data_jobs (
  job_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('catalog','technical')),
  accepted_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','running','publishing','published','failed','interrupted','identity_review_required')),
  identity TEXT CHECK(identity IS NULL OR json_valid(identity)),
  master_object TEXT REFERENCES immutable_objects(object_key),
  input_object TEXT REFERENCES immutable_objects(object_key),
  result_object TEXT REFERENCES immutable_objects(object_key),
  generation INTEGER REFERENCES catalog_generations(generation),
  error TEXT,
  CHECK((kind='technical') = (identity IS NOT NULL AND master_object IS NOT NULL)),
  CHECK(state <> 'published' OR result_object IS NOT NULL)
) STRICT;
CREATE INDEX workspace_jobs_state ON workspace_data_jobs(state);
CREATE TRIGGER workspace_job_identity_update BEFORE UPDATE OF job_id,kind,accepted_at,identity,master_object,generation ON workspace_data_jobs
BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER workspace_job_input_update BEFORE UPDATE OF input_object ON workspace_data_jobs
WHEN OLD.input_object IS NOT NULL AND NEW.input_object IS NOT OLD.input_object BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER workspace_job_result_update BEFORE UPDATE OF result_object ON workspace_data_jobs
WHEN OLD.result_object IS NOT NULL AND NEW.result_object IS NOT OLD.result_object BEGIN SELECT RAISE(ABORT,'immutable'); END;
`;
export const WORKSPACE_MIGRATIONS = [{ version: 1, sql: ddl }, { version: 2, sql: workspaceJobsDdl },
  { version: 3, sql: `
DROP TRIGGER workspace_job_identity_update;
DROP TRIGGER workspace_job_input_update;
DROP TRIGGER workspace_job_result_update;
DROP INDEX workspace_jobs_state;
ALTER TABLE workspace_data_jobs RENAME TO workspace_data_jobs_v2;
${workspaceJobsDdl.replace("kind IN ('catalog','technical')", "kind IN ('catalog','technical','margin','issuer_short','sector_short')")
  .replace("(kind='technical')", "(kind<>'catalog')")}
INSERT INTO workspace_data_jobs SELECT * FROM workspace_data_jobs_v2;
DROP TABLE workspace_data_jobs_v2;
` }] as const;
/** Each version is atomic, including its marker. Failed DDL never replaces the old DB. */
export function migrateWorkspace(db: Database, migrations: readonly { version: number; sql: string }[] = WORKSPACE_MIGRATIONS): void {
  let version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
  if (version > migrations.length) fail('schema_unsupported');
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    if (migration.version !== version + 1) fail('schema_unsupported');
    db.transaction(() => {
      db.exec(migration.sql);
      db.run('INSERT OR REPLACE INTO workspace_meta VALUES (?,?)', ['schema_fingerprint', schemaFingerprint(db)]);
      db.exec(`PRAGMA user_version=${migration.version}`);
    }).immediate();
    version = migration.version;
  }
}
export function validateWorkspaceSchema(db: Database, expectedFingerprint: string, version = WORKSPACE_SCHEMA_VERSION): void {
  if (db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version !== version
    || schemaFingerprint(db) !== expectedFingerprint
    || db.query<{ value: string }, [string]>('SELECT value FROM workspace_meta WHERE key=?').get('schema_fingerprint')?.value !== expectedFingerprint
    || db.query<{ value: string }, [string]>('SELECT value FROM workspace_meta WHERE key=?').get('object_store_layout')?.value !== 'object-key-v1') {
    fail('schema_unsupported');
  }
  const integrity = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok'
    || db.query('PRAGMA foreign_key_check').all().length) fail('database_invalid');
}
