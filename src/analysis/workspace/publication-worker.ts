import { resolve } from 'node:path';
import { WorkspaceDatabase } from './database.js';
import { registerReferences } from './references.js';
import { fixtureCodecs } from './test-fixtures.js';
import { ObjectRefSchema, parse } from './contracts.js';
import { backupWorkspace } from './backup.js';
import type { PublicationCheckpoint } from './files.js';

const [kind, root, source, encoded, phase] = process.argv.slice(2);
if (!root || !source || !encoded || !['archive', 'marker', 'import'].includes(kind ?? '')) throw new Error('Invalid worker');
const checkpoint: PublicationCheckpoint = point => {
  if (point !== phase) return;
  process.stdout.write('ready');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
if (kind === 'marker') backupWorkspace(root, resolve(source, 'child-backup'), fixtureCodecs, checkpoint);
else {
  const db = new WorkspaceDatabase(root);
  try { await registerReferences(db, source, [parse(ObjectRefSchema, JSON.parse(encoded))], fixtureCodecs, kind === 'import' ? undefined : checkpoint); }
  finally { db.close(); }
  process.stdout.write('done');
}
