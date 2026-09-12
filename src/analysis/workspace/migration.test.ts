import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateWorkspace, WORKSPACE_MIGRATIONS } from './schema.js';
import { WorkspaceDatabase, workspaceFingerprint } from './database.js';
import { digest, json } from './contracts.js';
import { backupWorkspace, validateWorkspaceBackup, restoreWorkspace } from './backup.js';

test('V1 DB and backup remain readable; writable reopen migrates without losing preferences or instrument IDs', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'dexter-v1-backup-')), destination = `${root}-restored`;
  const id = randomUUID(), path = resolve(root, 'workspace.sqlite');
  try {
    const old = new Database(path, { create: true }); migrateWorkspace(old, WORKSPACE_MIGRATIONS.slice(0, 1));
    old.run("INSERT INTO instruments VALUES (?,'stock')", [id]); old.run("INSERT INTO workspaces VALUES (?, '2026-09-11T00:00:00.000Z', 1, 7)", [id]);
    old.run('INSERT INTO chart_preferences VALUES (?,?,4)', [id, json({ interval: 'week', sma: [20], rsi: true, macd: true, volume: true })]); old.close();
    writeFileSync(resolve(root, 'manifest.json'), json({ version: 1, schemaVersion: 1, schemaFingerprint: workspaceFingerprint(1),
      databaseDigest: digest(readFileSync(path)), roots: [], objects: [], omissions: [] }));
    expect(validateWorkspaceBackup(root, new Map()).schemaVersion).toBe(1);
    const backup = `${root}-backup`;
    backupWorkspace(root, backup, new Map());
    const sourceAfterBackup = new Database(path, { readonly: true });
    try { expect(sourceAfterBackup.query('PRAGMA user_version').get()).toEqual({ user_version: 1 }); }
    finally { sourceAfterBackup.close(); }
    expect(validateWorkspaceBackup(backup, new Map()).schemaVersion).toBe(1);
    restoreWorkspace(root, destination, new Map());
    const upgraded = new WorkspaceDatabase(destination);
    try { expect(upgraded.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 2 });
      expect(upgraded.sqlite.query('SELECT instrument_id,favorite,revision FROM workspaces').get()).toEqual({ instrument_id: id, favorite: 1, revision: 7 });
      expect(upgraded.sqlite.query('SELECT revision FROM chart_preferences').get()).toEqual({ revision: 4 });
    } finally { upgraded.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); rmSync(`${root}-backup`, { recursive: true, force: true }); }
});
