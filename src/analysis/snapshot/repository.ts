import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { dexterPath } from '../../utils/paths.js';
import { AnalysisSnapshotPersistenceError } from './errors.js';
import {
  ANALYSIS_SNAPSHOT_SCHEMA_VERSION,
  AnalysisSnapshotSchema,
  CanonicalTickerSchema,
  type AnalysisSnapshot,
} from './schema.js';

export const SnapshotIdSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
  'snapshotId must be a Windows-safe UTC timestamp.',
);

export type SnapshotId = z.infer<typeof SnapshotIdSchema>;

export interface SavedAnalysisSnapshot {
  snapshotId: SnapshotId;
  canonicalTicker: string;
}

export interface AnalysisSnapshotHistoryItem {
  snapshotId: SnapshotId;
  canonicalTicker: string;
  companyName: string;
  generatedAt: string;
  status: AnalysisSnapshot['status'];
  dataDates: AnalysisSnapshot['dataDates'];
}

function historyItem(
  snapshot: AnalysisSnapshot,
  snapshotId = createSnapshotId(snapshot.generatedAt),
): AnalysisSnapshotHistoryItem {
  return {
    snapshotId,
    canonicalTicker: snapshot.canonicalTicker,
    companyName: snapshot.companyName,
    generatedAt: snapshot.generatedAt,
    status: snapshot.status,
    dataDates: snapshot.dataDates,
  };
}

function filesystemError(message: string, causeValue: unknown): AnalysisSnapshotPersistenceError {
  return new AnalysisSnapshotPersistenceError('filesystem_error', message, causeValue);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function assertCanonicalTicker(value: string): string {
  const parsed = CanonicalTickerSchema.safeParse(value);
  if (!parsed.success) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_ticker',
      `Unsafe canonical ticker: ${value}`,
      parsed.error,
    );
  }
  return parsed.data;
}

function assertSnapshotId(value: string): SnapshotId {
  const parsed = SnapshotIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id',
      `Unsafe snapshot ID: ${value}`,
      parsed.error,
    );
  }
  return parsed.data;
}

export function createSnapshotId(generatedAt: string): SnapshotId {
  const timestamp = new Date(generatedAt);
  if (!generatedAt.endsWith('Z') || Number.isNaN(timestamp.getTime())) {
    throw new AnalysisSnapshotPersistenceError(
      'unsafe_snapshot_id',
      `Cannot create snapshot ID from generatedAt: ${generatedAt}`,
    );
  }
  return assertSnapshotId(timestamp.toISOString().replace(/[:.]/g, '-'));
}

function parseSnapshotJson(contents: string, source: string): AnalysisSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (error) {
    throw new AnalysisSnapshotPersistenceError(
      'malformed_json',
      `Snapshot contains malformed JSON: ${source}`,
      error,
    );
  }

  if (
    raw !== null
    && typeof raw === 'object'
    && 'schemaVersion' in raw
    && (raw as { schemaVersion?: unknown }).schemaVersion !== ANALYSIS_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new AnalysisSnapshotPersistenceError(
      'unsupported_schema_version',
      `Unsupported AnalysisSnapshot schemaVersion in ${source}.`,
    );
  }

  const parsed = AnalysisSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisSnapshotPersistenceError(
      'schema_validation_failed',
      `Snapshot schema validation failed: ${source}`,
      parsed.error,
    );
  }
  return parsed.data;
}

export class AnalysisSnapshotRepository {
  readonly rootDirectory: string;

  constructor(rootDirectory: string = dexterPath('analysis')) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async save(rawSnapshot: unknown): Promise<SavedAnalysisSnapshot> {
    const parsed = AnalysisSnapshotSchema.safeParse(rawSnapshot);
    if (!parsed.success) {
      throw new AnalysisSnapshotPersistenceError(
        'schema_validation_failed',
        'Only a valid canonical AnalysisSnapshot can be saved.',
        parsed.error,
      );
    }

    // Zod parsing creates the allowlisted object that is serialized below.
    const snapshot = parsed.data;
    const canonicalTicker = assertCanonicalTicker(snapshot.canonicalTicker);
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = this.resolveTickerDirectory(canonicalTicker);
    const historyPath = this.resolveSnapshotPath(canonicalTicker, `${snapshotId}.json`);
    const latestPath = this.resolveSnapshotPath(canonicalTicker, 'latest.json');

    try {
      await mkdir(tickerDirectory, { recursive: true });
      await this.assertRealPathContained(tickerDirectory);
    } catch (error) {
      if (error instanceof AnalysisSnapshotPersistenceError) throw error;
      throw filesystemError(`Could not create snapshot directory for ${canonicalTicker}.`, error);
    }

    await this.writeValidatedAtomic(historyPath, snapshot);
    try {
      await this.writeValidatedAtomic(latestPath, snapshot);
    } catch (error) {
      throw new AnalysisSnapshotPersistenceError(
        'latest_update_failed',
        `Snapshot history was saved, but latest.json could not be updated for ${canonicalTicker}.`,
        error,
      );
    }

    return { snapshotId, canonicalTicker };
  }

  async loadLatest(ticker: string): Promise<AnalysisSnapshot> {
    const canonicalTicker = assertCanonicalTicker(ticker);
    const snapshot = await this.readSnapshot(
      this.resolveSnapshotPath(canonicalTicker, 'latest.json'),
      `${canonicalTicker}/latest.json`,
    );
    this.assertSnapshotIdentity(snapshot, canonicalTicker);
    return snapshot;
  }

  async loadHistory(ticker: string, snapshotId: string): Promise<AnalysisSnapshot> {
    const canonicalTicker = assertCanonicalTicker(ticker);
    const safeSnapshotId = assertSnapshotId(snapshotId);
    const snapshot = await this.readSnapshot(
      this.resolveSnapshotPath(canonicalTicker, `${safeSnapshotId}.json`),
      `${canonicalTicker}/${safeSnapshotId}.json`,
    );
    this.assertSnapshotIdentity(snapshot, canonicalTicker, safeSnapshotId);
    return snapshot;
  }

  async listHistory(ticker: string): Promise<AnalysisSnapshotHistoryItem[]> {
    const canonicalTicker = assertCanonicalTicker(ticker);
    const tickerDirectory = this.resolveTickerDirectory(canonicalTicker);
    let entries;
    try {
      entries = await readdir(tickerDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw filesystemError(`Could not list snapshot history for ${canonicalTicker}.`, error);
    }

    const snapshotIds = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'latest.json')
      .map(entry => entry.name.slice(0, -'.json'.length))
      .filter(name => SnapshotIdSchema.safeParse(name).success);

    const snapshots = await Promise.all(snapshotIds.map(async (snapshotId) => ({
      snapshotId: assertSnapshotId(snapshotId),
      snapshot: await this.loadHistory(canonicalTicker, snapshotId),
    })));

    return snapshots
      .sort((left, right) => right.snapshot.generatedAt.localeCompare(left.snapshot.generatedAt))
      .map(({ snapshotId, snapshot }) => historyItem(snapshot, snapshotId));
  }

  async listLatest(): Promise<AnalysisSnapshotHistoryItem[]> {
    let entries;
    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw filesystemError('Could not list latest analysis snapshots.', error);
    }

    const tickers = entries
      .filter(entry => entry.isDirectory() && CanonicalTickerSchema.safeParse(entry.name).success)
      .map(entry => entry.name);
    const latest = await Promise.all(tickers.map(ticker => this.loadLatest(ticker)));
    return latest
      .map(snapshot => historyItem(snapshot))
      .sort((left, right) => left.canonicalTicker.localeCompare(right.canonicalTicker));
  }

  private resolveTickerDirectory(ticker: string): string {
    const target = resolve(this.rootDirectory, ticker);
    this.assertContained(target);
    return target;
  }

  private resolveSnapshotPath(ticker: string, filename: string): string {
    const target = resolve(this.resolveTickerDirectory(ticker), filename);
    this.assertContained(target);
    return target;
  }

  private assertContained(target: string): void {
    const rel = relative(this.rootDirectory, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('/')) {
      throw filesystemError('Resolved snapshot path is outside the repository root.', target);
    }
  }

  private assertSnapshotIdentity(
    snapshot: AnalysisSnapshot,
    canonicalTicker: string,
    snapshotId?: SnapshotId,
  ): void {
    if (
      snapshot.canonicalTicker !== canonicalTicker
      || (snapshotId !== undefined && createSnapshotId(snapshot.generatedAt) !== snapshotId)
    ) {
      throw new AnalysisSnapshotPersistenceError(
        'snapshot_identity_mismatch',
        'Snapshot identity does not match its repository path.',
      );
    }
  }

  private async assertRealPathContained(target: string): Promise<void> {
    const [realRoot, realTarget] = await Promise.all([
      realpath(this.rootDirectory),
      realpath(target),
    ]);
    const rel = relative(realRoot, realTarget);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw filesystemError('Resolved snapshot path is outside the repository root.', target);
    }
  }

  private async readSnapshot(path: string, source: string): Promise<AnalysisSnapshot> {
    let contents: string;
    try {
      await this.assertRealPathContained(path);
      contents = await readFile(path, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new AnalysisSnapshotPersistenceError(
          'missing_snapshot',
          `Snapshot not found: ${source}`,
          error,
        );
      }
      throw filesystemError(`Could not read snapshot: ${source}`, error);
    }
    return parseSnapshotJson(contents, source);
  }

  private async writeValidatedAtomic(path: string, snapshot: AnalysisSnapshot): Promise<void> {
    const temporaryPath = resolve(dirname(path), `.${randomUUID()}.tmp`);
    this.assertContained(temporaryPath);
    let renamed = false;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await this.readSnapshot(temporaryPath, temporaryPath);
      await rename(temporaryPath, path);
      renamed = true;
    } catch (error) {
      if (error instanceof AnalysisSnapshotPersistenceError) throw error;
      throw filesystemError(`Could not atomically write snapshot: ${path}`, error);
    } finally {
      if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
