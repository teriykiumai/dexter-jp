import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceDatabase } from './database.js';
import { fixtureCodecs, fixtureObject, fixtureWorkspace } from './test-fixtures.js';
import { referencePath, registerReferences, resolveReference, validateReferences } from './references.js';
import { backupWorkspace, recoverWorkspaceMaintenance } from './backup.js';
import { digest, json } from './contracts.js';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { retainValidatedWorkspaceBytes, workspaceDataCodecs } from './data-objects.js';

test.each(['temporary_partial', 'temporary_complete', 'published'] as const)('Workspace byte retention process kill at %s leaves no partial canonical file', async phase => {
  const f = await workspaceDataFixture(); let db: WorkspaceDatabase | undefined;
  try {
    expect((await f.jobs.wait(await f.jobs.start('catalog'))).state).toBe('published');
    const objects = validateReferences(f.db, workspaceDataCodecs);
    const catalog = objects.find(object => object.ref.codec === 'workspace_catalog_v1')!;
    const archive = resolve(f.root, 'objects'), before = new Set(readdirSync(archive));
    f.db.close();
    const child = await paused(['workspace-bytes', f.root, referencePath(f.root, catalog.ref), catalog.ref.codec, phase]);
    child.kill('SIGKILL'); await child.exited;
    const added = readdirSync(archive).filter(name => !before.has(name));
    expect(added).toHaveLength(1);
    const name = added[0]!, bytes = readFileSync(resolve(archive, name));
    expect(name.endsWith('.json')).toBe(phase === 'published');
    expect(name.endsWith('.tmp')).toBe(phase !== 'published');
    expect(bytes).toEqual(Buffer.from(phase === 'temporary_partial' ? catalog.bytes.subarray(0, Math.floor(catalog.bytes.length / 2)) : catalog.bytes));
    db = new WorkspaceDatabase(f.root);
    expect(validateReferences(db, workspaceDataCodecs)).toHaveLength(objects.length);
    const ref = retainValidatedWorkspaceBytes(db, catalog.ref.codec, new TextDecoder().decode(catalog.bytes), catalog.metadata);
    expect(resolveReference(db, ref, workspaceDataCodecs).bytes).toEqual(catalog.bytes);
    expect(validateReferences(db, workspaceDataCodecs)).toHaveLength(objects.length + 1);
  } finally { db?.close(); f.dispose(); }
}, 30_000);

const worker = fileURLToPath(new URL('./publication-worker.ts', import.meta.url));
async function paused(args: string[]) {
  const child = Bun.spawn([process.execPath, worker, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Publication worker timed out')), 10_000);
    })]);
    expect(new TextDecoder().decode(ready.value)).toBe('ready');
  } catch (error) { child.kill('SIGKILL'); await child.exited; throw error; }
  finally { clearTimeout(timer); reader.releaseLock(); }
  return child;
}

test.each(['temporary_partial', 'temporary_complete', 'published'] as const)('archive process kill at %s permits exact retry', async phase => {
  const f = await fixtureWorkspace(); let db: WorkspaceDatabase | undefined;
  try {
    const ref = fixtureObject(f.objectRoot, f.scope), expected = readFileSync(resolve(f.objectRoot, ref.path)); f.db.close();
    const child = await paused(['archive', f.root, f.objectRoot, json(ref), phase]);
    child.kill('SIGKILL'); await child.exited;
    expect(existsSync(referencePath(f.root, ref))).toBe(phase === 'published');
    if (phase === 'temporary_partial') {
      const names = readdirSync(resolve(f.root, 'objects')).filter(name => name.endsWith('.tmp'));
      expect(names).toHaveLength(1);
      expect(readFileSync(resolve(f.root, 'objects', names[0]!))).toEqual(expected.subarray(0, Math.floor(expected.length / 2)));
    }
    db = new WorkspaceDatabase(f.root);
    expect(db.sqlite.query('SELECT COUNT(*) AS count FROM immutable_objects').get()).toEqual({ count: 4 });
    await registerReferences(db, f.objectRoot, [ref], fixtureCodecs);
    expect(resolveReference(db, ref, fixtureCodecs).bytes).toEqual(expected);
    expect(digest(readFileSync(referencePath(f.root, ref)))).toBe(ref.digest);
    expect(validateReferences(db, fixtureCodecs)).toHaveLength(5);
  } finally { db?.close(); f.dispose(); }
});

test('unregistered partial final is quarantined; registered corruption is never replaced', async () => {
  const f = await fixtureWorkspace();
  try {
    const ref = fixtureObject(f.objectRoot, f.scope), path = referencePath(f.root, ref);
    writeFileSync(path, 'partial');
    await registerReferences(f.db, f.objectRoot, [ref], fixtureCodecs);
    expect(resolveReference(f.db, ref, fixtureCodecs).ref).toEqual(ref);
    const quarantined = readdirSync(resolve(f.root, 'objects')).filter(name => name.includes('.quarantine-'));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(resolve(f.root, 'objects', quarantined[0]!), 'utf8')).toBe('partial');
    writeFileSync(path, 'registered corruption');
    let failure: unknown; try { await registerReferences(f.db, f.objectRoot, [ref], fixtureCodecs); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('reference_conflict');
    expect(readFileSync(path, 'utf8')).toBe('registered corruption');
  } finally { f.dispose(); }
});

test('two importer processes reconcile the same unregistered partial final idempotently', async () => {
  const f = await fixtureWorkspace(); let db: WorkspaceDatabase | undefined;
  try {
    const ref = fixtureObject(f.objectRoot, f.scope); writeFileSync(referencePath(f.root, ref), 'partial'); f.db.close();
    const children = Array.from({ length: 2 }, () => Bun.spawn([process.execPath, worker, 'import', f.root, f.objectRoot, json(ref)],
      { stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(children.map(async child => ({ code: await child.exited, error: await new Response(child.stderr).text() })));
    expect(results).toEqual([{ code: 0, error: '' }, { code: 0, error: '' }]);
    db = new WorkspaceDatabase(f.root);
    expect(validateReferences(db, fixtureCodecs)).toHaveLength(5);
    expect(resolveReference(db, ref, fixtureCodecs).ref).toEqual(ref);
  } finally { db?.close(); f.dispose(); }
});

test.each(['temporary_partial', 'temporary_complete', 'published'] as const)('maintenance marker process kill at %s remains recoverable', async phase => {
  const f = await fixtureWorkspace();
  try {
    f.db.close(); const marker = `${f.root}.maintenance.json`;
    const child = await paused(['marker', f.root, f.directory, '{}', phase]);
    try {
      expect(existsSync(marker)).toBe(phase === 'published');
      if (phase === 'published') {
        const before = readFileSync(resolve(marker, 'state.json'));
        expect(() => backupWorkspace(f.root, resolve(f.directory, 'contender'), fixtureCodecs)).toThrow();
        expect(readFileSync(resolve(marker, 'state.json'))).toEqual(before);
      }
    } finally { child.kill('SIGKILL'); await child.exited; }
    if (phase === 'published') expect(recoverWorkspaceMaintenance(f.root, fixtureCodecs)).toBe('recovered');
    backupWorkspace(f.root, resolve(f.directory, 'retry-backup'), fixtureCodecs);
    expect(existsSync(marker)).toBe(false);
  } finally { f.dispose(); }
});
