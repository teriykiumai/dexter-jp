import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateWorkspace, WORKSPACE_MIGRATIONS, WORKSPACE_SCHEMA_VERSION } from './schema.js';
import { WorkspaceDatabase, workspaceFingerprint } from './database.js';
import { digest, json } from './contracts.js';
import { backupWorkspace, validateWorkspaceBackup, restoreWorkspace } from './backup.js';

test('V4 AI migration rollback preserves foundation jobs and user settings without reinterpreting old input', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'dexter-v4-ai-'));
  try {
    const old = new Database(resolve(root, 'workspace.sqlite'), { create: true }); migrateWorkspace(old, WORKSPACE_MIGRATIONS.slice(0, 4));
    old.exec('PRAGMA foreign_keys=ON');
    const id = randomUUID(), job = randomUUID(), input = `sha256:${'1'.repeat(64)}`;
    old.run("INSERT INTO instruments VALUES (?,'stock')", [id]); old.run("INSERT INTO workspaces VALUES (?,'2026-09-11',1,7)", [id]);
    old.run("INSERT INTO immutable_objects VALUES (?,'input.json','foundation_fixture',?,'{}')", [input, input]);
    old.run("INSERT INTO analysis_jobs VALUES (?,?,'fundamental',?,NULL,'prepared')", [job, id, input]);
    const before = old.query('SELECT * FROM analysis_jobs').get();
    expect(() => migrateWorkspace(old, [...WORKSPACE_MIGRATIONS.slice(0, 4), { version: 5, sql: `${WORKSPACE_MIGRATIONS[4].sql}\nINVALID SQL;` }])).toThrow();
    expect(old.query('PRAGMA user_version').get()).toEqual({ user_version: 4 }); expect(old.query('SELECT * FROM analysis_jobs').get()).toEqual(before); old.close();
    const db = new WorkspaceDatabase(root);
    try {
      expect(db.sqlite.query('SELECT job_id,instrument_id,profile,input_object,result_object,state FROM analysis_jobs').get()).toEqual(before);
      expect(db.sqlite.query('SELECT accepted_at,publication,error FROM analysis_jobs').get()).toEqual({ accepted_at: null, publication: null, error: null });
      expect(db.sqlite.query('SELECT favorite,revision FROM workspaces').get()).toEqual({ favorite: 1, revision: 7 });
      expect(db.sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('V3 to V4 failed migration preserves jobs and user preferences, then reopens successfully', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'dexter-v3-financial-'));
  try {
    const old = new Database(resolve(root, 'workspace.sqlite'), { create: true }); migrateWorkspace(old, WORKSPACE_MIGRATIONS.slice(0, 3));
    const id = randomUUID(), job = randomUUID();
    old.run("INSERT INTO instruments VALUES (?,'stock')", [id]); old.run("INSERT INTO workspaces VALUES (?,'2026-09-11',1,7)", [id]);
    old.run('INSERT INTO chart_preferences VALUES (?,?,4)', [id, json({ interval: 'month', sma: [20], rsi: true, macd: true, volume: true })]);
    old.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state) VALUES (?,'catalog','2026-09-11T00:00:00.000Z','interrupted')", [job]);
    const before = old.query('SELECT * FROM workspace_data_jobs').all();
    expect(() => migrateWorkspace(old, [...WORKSPACE_MIGRATIONS.slice(0, 3), { version: 4, sql: `${WORKSPACE_MIGRATIONS[3].sql}\nINVALID SQL;` }])).toThrow();
    expect(old.query('PRAGMA user_version').get()).toEqual({ user_version: 3 });
    expect(old.query('SELECT * FROM workspace_data_jobs').all()).toEqual(before); old.close();
    const db = new WorkspaceDatabase(root);
    try { expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: WORKSPACE_SCHEMA_VERSION });
      expect(db.sqlite.query('SELECT * FROM workspace_data_jobs').all()).toEqual(before);
      expect(db.sqlite.query('SELECT instrument_id,revision FROM chart_preferences').get()).toEqual({ instrument_id: id, revision: 4 });
      expect(() => db.sqlite.run("UPDATE workspace_data_jobs SET kind='financial'")).toThrow('immutable');
      expect(db.sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('V2 job migration rolls back failed DDL and preserves existing jobs and immutable triggers on reopen', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'dexter-v2-jobs-'));
  try {
    const old = new Database(resolve(root, 'workspace.sqlite'), { create: true });
    migrateWorkspace(old, WORKSPACE_MIGRATIONS.slice(0, 2));
    const id = randomUUID();
    old.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state) VALUES (?,'catalog','2026-09-11T00:00:00.000Z','interrupted')", [id]);
    const before = old.query('SELECT * FROM workspace_data_jobs').all();
    expect(() => migrateWorkspace(old, [...WORKSPACE_MIGRATIONS.slice(0, 2),
      { version: 3, sql: `${WORKSPACE_MIGRATIONS[2].sql}\nINVALID SQL;` }])).toThrow();
    expect(old.query('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(old.query('SELECT * FROM workspace_data_jobs').all()).toEqual(before);
    old.close();
    const reopened = new WorkspaceDatabase(root);
    try {
      expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: WORKSPACE_SCHEMA_VERSION });
      expect(reopened.sqlite.query('SELECT * FROM workspace_data_jobs').all()).toEqual(before);
      expect(() => reopened.sqlite.run("UPDATE workspace_data_jobs SET accepted_at='changed'")).toThrow('immutable');
      expect(() => reopened.sqlite.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state) VALUES (?,'margin','2026-09-11T00:00:00.000Z','queued')", [randomUUID()])).toThrow();
      expect(reopened.sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
    try { expect(upgraded.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: WORKSPACE_SCHEMA_VERSION });
      expect(upgraded.sqlite.query('SELECT instrument_id,favorite,revision FROM workspaces').get()).toEqual({ instrument_id: id, favorite: 1, revision: 7 });
      expect(upgraded.sqlite.query('SELECT revision FROM chart_preferences').get()).toEqual({ revision: 4 });
    } finally { upgraded.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); rmSync(`${root}-backup`, { recursive: true, force: true }); }
});
