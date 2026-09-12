import { existsSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkspaceDatabase, workspaceFingerprint, workspaceOpenCount } from './database.js';
import { Digest, Id, ObjectMetadataSchema, ObjectRefSchema, RelativePath, Token, digest, fail, json, parse,
  type ReferenceCodecs } from './contracts.js';
import { objectPath, readBytes, readJson, safeDirectory, stageFile, syncDirectory, syncFile, writeExclusive, type PublicationCheckpoint } from './files.js';
import { referencePath, referenceRoots, validateReferences } from './references.js';
import { WORKSPACE_SCHEMA_VERSION } from './schema.js';

const ManifestSchema = z.object({ version: z.literal(1), schemaVersion: z.union([z.literal(1), z.literal(2)]),
  schemaFingerprint: Digest, databaseDigest: Digest,
  roots: z.array(z.object({ table: Token, record: z.string().max(2000), field: z.string().max(100), object: Digest }).strict()).max(500_000),
  objects: z.array(z.object({ ref: ObjectRefSchema, metadata: ObjectMetadataSchema }).strict()).max(100_000),
  omissions: z.array(z.never()).max(0) }).strict();
type Manifest = z.infer<typeof ManifestSchema>;
const MaintenanceSchema = z.discriminatedUnion('operation', [
  z.object({ version: z.literal(1), operation: z.literal('backup'), token: Id, pid: z.number().int().positive() }).strict(),
  z.object({ version: z.literal(1), operation: z.literal('restore'), token: Id,
    stage: RelativePath, previous: RelativePath, databaseDigest: Digest, existed: z.boolean(), pid: z.number().int().positive() }).strict(),
]);
const markerPath = (root: string) => `${resolve(root)}.maintenance.json`;
function requireSeparateTrees(first: string, second: string): void {
  const contains = (a: string, b: string) => {
    const child = relative(a, b);
    return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
  };
  if (contains(resolve(first), resolve(second)) || contains(resolve(second), resolve(first))) fail('storage_unsafe');
}
function beginMaintenance(root: string, value: z.infer<typeof MaintenanceSchema>, checkpoint?: PublicationCheckpoint): void {
  if (workspaceOpenCount(root)) fail('maintenance_required');
  const marker = markerPath(root), staging = `${marker}.prepare-${randomUUID()}`;
  safeDirectory(dirname(marker)); mkdirSync(staging);
  const payload = resolve(staging, 'state.json');
  const temporary = stageFile(payload, new TextEncoder().encode(json(parse(MaintenanceSchema, value))), phase => {
    if (phase !== 'published') checkpoint?.(phase);
  });
  renameSync(temporary, payload); syncDirectory(staging);
  // A nonempty marker directory is create-only under rename on supported local
  // filesystems; competing admission cannot overwrite its complete state.json.
  try { renameSync(staging, marker); }
  catch (error) { unlinkSync(payload); rmdirSync(staging); throw error; }
  syncDirectory(dirname(resolve(root)));
  checkpoint?.('published');
}
function finishMaintenance(root: string): void {
  const marker = markerPath(root), retired = `${marker}.retired-${randomUUID()}`;
  safeDirectory(marker); renameSync(marker, retired); syncDirectory(dirname(resolve(root)));
  unlinkSync(resolve(retired, 'state.json')); rmdirSync(retired);
}
function exclusive(db: WorkspaceDatabase): void {
  // Offline operation. Retain the exclusive SQLite lock outside a transaction so
  // VACUUM INTO can run; unmanaged active readers/writers cause SQLITE_BUSY.
  db.sqlite.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
}

export function validateWorkspaceBackup(packageRoot: string, codecs: ReferenceCodecs, maintenance = false): Manifest {
  safeDirectory(packageRoot);
  // A complete package is a standalone VACUUM snapshot. A sidecar must never
  // override bytes authenticated by databaseDigest when SQLite opens the file.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(resolve(packageRoot, `workspace.sqlite${suffix}`))) fail('backup_invalid');
  }
  const manifest = parse(ManifestSchema, readJson(resolve(packageRoot, 'manifest.json')));
  if (manifest.schemaFingerprint !== workspaceFingerprint(manifest.schemaVersion)
    || digest(readBytes(resolve(packageRoot, 'workspace.sqlite'))) !== manifest.databaseDigest) fail('backup_invalid');
  const db = new WorkspaceDatabase(packageRoot, { readonly: true, maintenance });
  try {
    const objects = validateReferences(db, codecs);
    const entries = objects.map(({ ref, metadata }) => ({ ref, metadata }));
    if (json(entries) !== json(manifest.objects) || json(referenceRoots(db)) !== json(manifest.roots)) fail('backup_invalid');
  } finally { db.close(); }
  return manifest;
}

/** Offline only. All registered exact objects are retained; no referenced cache
 * omission or destructive cleanup is implemented in this initial version. */
export function backupWorkspace(root: string, destination: string, codecs: ReferenceCodecs, checkpoint?: PublicationCheckpoint): void {
  root = resolve(root); destination = resolve(destination);
  requireSeparateTrees(root, destination);
  if (existsSync(destination)) fail('backup_invalid');
  safeDirectory(dirname(destination));
  beginMaintenance(root, { version: 1, operation: 'backup', token: randomUUID(), pid: process.pid }, checkpoint);
  let db: WorkspaceDatabase | undefined;
  try {
    db = new WorkspaceDatabase(root, { maintenance: true, readonly: true });
    const sourceVersion = db.sqlite.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
    if (sourceVersion < 1 || sourceVersion > WORKSPACE_SCHEMA_VERSION) fail('schema_unsupported');
    if (sourceVersion === WORKSPACE_SCHEMA_VERSION) exclusive(db);
    const objects = validateReferences(db, codecs), roots = referenceRoots(db);
    mkdirSync(destination);
    const snapshot = resolve(destination, 'workspace.sqlite');
    db.sqlite.run('VACUUM INTO ?', [snapshot]); syncFile(snapshot);
    const check = new WorkspaceDatabase(destination, { readonly: true });
    check.close();
    for (const object of objects) writeExclusive(referencePath(destination, object.ref), object.bytes);
    const manifest: Manifest = { version: 1, schemaVersion: sourceVersion as 1 | 2, schemaFingerprint: workspaceFingerprint(sourceVersion),
      databaseDigest: digest(readBytes(snapshot)), roots,
      objects: objects.map(({ ref, metadata }) => ({ ref, metadata })), omissions: [] };
    // Recheck copied bytes/closure before the completion manifest becomes visible.
    const staged = new WorkspaceDatabase(destination, { readonly: true });
    try { validateReferences(staged, codecs); } finally { staged.close(); }
    writeExclusive(resolve(destination, 'manifest.json'), json(manifest)); syncDirectory(destination);
  } finally {
    db?.close(); finishMaintenance(root);
  }
}

export type RestoreCheckpoint = 'started' | 'staged' | 'previous_preserved' | 'installed';
/** Returns the preserved old installation. Callers must stop the server first.
 * The checkpoint hook supports interruption tests; it cannot weaken validation. */
export function restoreWorkspace(packageRoot: string, root: string, codecs: ReferenceCodecs,
  checkpoint?: (phase: RestoreCheckpoint) => void): { previous: string | null } {
  root = resolve(root); packageRoot = resolve(packageRoot);
  requireSeparateTrees(packageRoot, root);
  const manifest = validateWorkspaceBackup(packageRoot, codecs);
  const token = randomUUID(), parent = dirname(root);
  const stageName = `${basename(root)}-restore-${token}`, previousName = `${basename(root)}-previous-${token}`;
  const stage = objectPath(parent, stageName), previous = objectPath(parent, previousName);
  const existed = existsSync(root);
  beginMaintenance(root, { version: 1, operation: 'restore', token,
    stage: stageName, previous: previousName, databaseDigest: manifest.databaseDigest, existed, pid: process.pid });
  // On error the durable marker and previous directory remain for explicit recovery.
  checkpoint?.('started');
  mkdirSync(stage);
  writeExclusive(resolve(stage, 'workspace.sqlite'), readBytes(resolve(packageRoot, 'workspace.sqlite')));
  for (const object of manifest.objects) writeExclusive(referencePath(stage, object.ref),
    readBytes(referencePath(packageRoot, object.ref)));
  writeExclusive(resolve(stage, 'manifest.json'), json(manifest));
  validateWorkspaceBackup(stage, codecs); syncDirectory(stage); checkpoint?.('staged');
  if (existed) {
    const old = new WorkspaceDatabase(root, { maintenance: true });
    try { exclusive(old); } finally { old.close(); }
    safeDirectory(root); renameSync(root, previous); syncDirectory(parent);
  }
  checkpoint?.('previous_preserved');
  renameSync(stage, root); syncDirectory(parent); checkpoint?.('installed');
  finishMaintenance(root);
  return { previous: existed ? previous : null };
}

/** Deliberate local maintenance recovery, never a data fetch or an AI replay. */
export function recoverWorkspaceMaintenance(root: string, codecs: ReferenceCodecs): 'recovered' | 'retry_restore' {
  root = resolve(root);
  if (workspaceOpenCount(root)) fail('maintenance_required');
  const marker = parse(MaintenanceSchema, readJson(resolve(markerPath(root), 'state.json')));
  if (marker.pid !== process.pid) {
    try { process.kill(marker.pid, 0); fail('maintenance_required'); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) fail('maintenance_required');
    }
  }
  if (marker.operation === 'backup') { finishMaintenance(root); return 'recovered'; }
  const parent = dirname(root);
  if (marker.stage !== `${basename(root)}-restore-${marker.token}`
    || marker.previous !== `${basename(root)}-previous-${marker.token}`) fail('backup_invalid');
  const stage = objectPath(parent, marker.stage), previous = objectPath(parent, marker.previous);
  if (existsSync(root)) {
    // If the old installation was moved, the installed replacement must be complete.
    if (existsSync(previous) || !marker.existed) {
      if (validateWorkspaceBackup(root, codecs, true).databaseDigest !== marker.databaseDigest) fail('backup_invalid');
    } else {
      const old = new WorkspaceDatabase(root, { maintenance: true }); old.close();
    }
  } else if (existsSync(previous)) {
    if (!marker.existed) fail('backup_invalid');
    const old = new WorkspaceDatabase(previous); old.close();
    renameSync(previous, root); syncDirectory(parent);
  } else if (!marker.existed && existsSync(stage)) {
    try {
      if (validateWorkspaceBackup(stage, codecs).databaseDigest !== marker.databaseDigest) fail('backup_invalid');
    } catch {
      // No previous installation existed. Leave incomplete staging for inspection,
      // clear the admission block and require an explicit retry from the package.
      finishMaintenance(root); return 'retry_restore';
    }
    renameSync(stage, root); syncDirectory(parent);
  } else if (marker.existed) fail('backup_invalid');
  else { finishMaintenance(root); return 'retry_restore'; }
  finishMaintenance(root);
  return 'recovered';
}
