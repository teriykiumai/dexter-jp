import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from './contracts.js';
import { safeDirectory, safeFile } from './files.js';
import { migrateWorkspace, schemaFingerprint, validateWorkspaceSchema, WORKSPACE_MIGRATIONS, WORKSPACE_SCHEMA_VERSION } from './schema.js';

export function supportedSqlite(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  // https://www.sqlite.org/wal.html#walreset fixes 3.51.3+, with two explicit backports.
  return major === 3 && (minor > 51 || minor === 51 && patch >= 3
    || minor === 50 && patch >= 7 || minor === 44 && patch >= 6);
}
const expectedFingerprints = new Map<number, string>();
const openRoots = new Map<string, number>();
const rootKey = (root: string) => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
export function workspaceOpenCount(root: string): number { return openRoots.get(rootKey(root)) ?? 0; }
export function workspaceFingerprint(version = WORKSPACE_SCHEMA_VERSION): string {
  if (version < 1 || version > WORKSPACE_SCHEMA_VERSION) fail('schema_unsupported');
  if (!expectedFingerprints.has(version)) {
    const db = new Database(':memory:');
    try { migrateWorkspace(db, WORKSPACE_MIGRATIONS.slice(0, version)); expectedFingerprints.set(version, schemaFingerprint(db)); } finally { db.close(); }
  }
  return expectedFingerprints.get(version)!;
}
class WorkspaceSqlite extends Database {
  private statements = new Map<string, Statement<unknown, SQLQueryBindings[]>>();
  override query<R, P extends SQLQueryBindings | SQLQueryBindings[]>(sql: string) {
    const prepare = () => super.prepare<R, P>(sql);
    // Own statement lifetimes: an evicted Bun query-cache entry can otherwise keep
    // SQLite/file handles alive until GC, which is too late for offline restore.
    let statement = this.statements.get(sql);
    if (!statement) {
      if (this.statements.size >= 256) fail('invalid_input');
      statement = super.prepare<unknown, SQLQueryBindings[]>(sql); this.statements.set(sql, statement);
    }
    return statement as ReturnType<typeof prepare>;
  }
  override close(throwOnError = false): void {
    for (const statement of this.statements.values()) statement.finalize();
    this.statements.clear(); super.close(throwOnError);
  }
}
export class WorkspaceDatabase {
  readonly sqlite: Database;
  readonly root: string;
  readonly path: string;
  readonly sqliteVersion: string;
  private closed = false;
  constructor(root: string, options: { create?: boolean; maintenance?: boolean; readonly?: boolean; backgroundWriter?: boolean } = {}) {
    this.root = resolve(root); this.path = resolve(this.root, 'workspace.sqlite');
    if (!options.maintenance) this.assertAvailable();
    safeDirectory(this.root, options.create ?? false);
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`, `${this.path}-journal`]) safeFile(path);
    if (!existsSync(this.path) && !options.create) fail('not_found');
    this.sqlite = new WorkspaceSqlite(this.path, { create: options.create ?? false, readonly: options.readonly ?? false, strict: true });
    try {
      this.sqliteVersion = this.sqlite.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!.version;
      if (!supportedSqlite(this.sqliteVersion)) fail('sqlite_unsupported');
      // A background writer may wait for foreground saves without blocking the
      // server event loop. Foreground connections retain their short wait bound.
      this.sqlite.exec(`PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=${options.backgroundWriter ? 5000 : 100};`);
      if (!options.readonly && this.sqlite.query<{ journal_mode: string }, []>('PRAGMA journal_mode=WAL').get()!.journal_mode !== 'wal') fail('database_invalid');
      this.sqlite.exec('PRAGMA synchronous=FULL;');
      const version = this.sqlite.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
      if (version === 0 && this.sqlite.query("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all().length) fail('schema_unsupported');
      if (version > 0) validateWorkspaceSchema(this.sqlite, workspaceFingerprint(version), version);
      if (!options.readonly) migrateWorkspace(this.sqlite);
      validateWorkspaceSchema(this.sqlite, workspaceFingerprint(options.readonly ? version : WORKSPACE_SCHEMA_VERSION), options.readonly ? version : WORKSPACE_SCHEMA_VERSION);
      openRoots.set(rootKey(this.root), workspaceOpenCount(this.root) + 1);
    } catch (error) { this.sqlite.close(); throw error; }
  }
  assertAvailable(): void {
    if (this.closed || existsSync(`${this.root}.maintenance.json`)) fail('maintenance_required');
  }
  transaction<T>(operation: () => T): T {
    this.assertAvailable();
    if (operation.constructor.name === 'AsyncFunction') fail('invalid_input');
    return this.sqlite.transaction(() => {
      this.assertAvailable();
      const result = operation();
      if (result instanceof Promise || result !== null && typeof result === 'object'
        && 'then' in result && typeof result.then === 'function') fail('invalid_input');
      return result;
    }).immediate();
  }
  close(): void {
    if (!this.closed) {
      this.sqlite.close(true); this.closed = true; openRoots.set(rootKey(this.root), workspaceOpenCount(this.root) - 1);
    }
  }
}
