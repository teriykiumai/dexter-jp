import { mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { dexterPath } from '../../utils/paths.js';
import {
  canonicalJsonV1,
  digestValidatedAnalysisSnapshot,
  type CanonicalJsonValue,
  type SnapshotDigest,
} from './canonical-json.js';
import {
  CreateOnlyFilePublicationError,
  publishCreateOnlyFile,
  type CreateOnlyLinkFile,
} from './create-only-file.js';
import { AnalysisSnapshotPersistenceError } from './errors.js';
import { createSnapshotId, SnapshotIdSchema, type SnapshotId } from './id.js';
import {
  compareLatestSnapshotOrderV1,
  resolveLatestSnapshotV1,
} from './latest-order.js';
import { assertStoredReportSafe } from './safety.js';
import {
  ANALYSIS_SNAPSHOT_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V1_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V2_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V3_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V4_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V5_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V6_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V7_SCHEMA_VERSION,
  ANALYSIS_SNAPSHOT_V8_SCHEMA_VERSION,
  AnalysisSnapshotSchema,
  AnalysisSnapshotV9Schema,
  CanonicalTickerSchema,
  type AnalysisSnapshot,
} from './schema.js';

export { createSnapshotId, SnapshotIdSchema } from './id.js';
export type { SnapshotId } from './id.js';

export interface SavedAnalysisSnapshot {
  snapshotId: SnapshotId;
  canonicalTicker: string;
}

export interface AnalysisSnapshotRepositoryOptions {
  readonly linkFile?: CreateOnlyLinkFile;
}

export interface AnalysisSnapshotHistoryItem {
  snapshotId: SnapshotId;
  canonicalTicker: string;
  companyName: string;
  generatedAt: string;
  status: AnalysisSnapshot['status'];
  dataDates: AnalysisSnapshot['dataDates'];
}

export interface AnalysisSnapshotLatestItem extends AnalysisSnapshotHistoryItem {
  latestSourceDataDate: string | null;
  metrics: {
    latestPrice: number | null;
    per: number | null;
    pbr: number | null;
    roe: number | null;
    trend: 'uptrend' | 'downtrend' | 'range_or_transition' | 'unavailable' | null;
    marginPercentile: number | null;
    beta250: number | null;
  };
  units: {
    latestPrice: AnalysisSnapshot['units']['valuation'][string];
    per: AnalysisSnapshot['units']['valuation'][string];
    pbr: AnalysisSnapshot['units']['valuation'][string];
    roe: AnalysisSnapshot['units']['fundamental'][string];
    marginPercentile: AnalysisSnapshot['units']['supplyDemand'][string];
    beta250: AnalysisSnapshot['units']['marketCorrelation'][string];
  };
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

function latestSourceDataDate(snapshot: AnalysisSnapshot): string | null {
  const dates = snapshot.dataDates;
  return [
    dates.identity,
    dates.fundamental,
    dates.valuation.price,
    dates.valuation.financial,
    dates.peerComparison,
    dates.technical,
    dates.supplyDemand,
    dates.marketCorrelation,
    dates.strategy,
    dates.priceHistory,
    ...('reportedShortPositions' in dates ? [dates.reportedShortPositions] : []),
    ...('investorTypeFlows' in dates ? [dates.investorTypeFlows] : []),
    ...('sectorBenchmark' in dates ? [dates.sectorBenchmark] : []),
    ...('sectorShortRatio' in dates ? [dates.sectorShortRatio] : []),
    ...('advancedDividend' in dates ? [dates.advancedDividend] : []),
    ...('volumeProfile' in dates ? [dates.volumeProfile] : []),
  ].filter((date): date is string => date !== null).sort().at(-1) ?? null;
}

export function buildAnalysisSnapshotLatestItem(
  snapshot: AnalysisSnapshot,
): AnalysisSnapshotLatestItem {
  const latestFundamental = snapshot.fundamental?.periods.at(-1);
  const beta250 = snapshot.marketCorrelation?.windows.find(window => window.period === 250)?.beta;
  return {
    ...historyItem(snapshot),
    latestSourceDataDate: latestSourceDataDate(snapshot),
    metrics: {
      latestPrice: snapshot.valuation?.currentPrice ?? null,
      per: snapshot.valuation?.per ?? null,
      pbr: snapshot.valuation?.pbr ?? null,
      roe: latestFundamental?.roe ?? null,
      trend: snapshot.technical?.trend ?? null,
      marginPercentile: snapshot.supplyDemand?.percentile52w ?? null,
      beta250: beta250 ?? null,
    },
    units: {
      latestPrice: snapshot.units.valuation.currentPrice,
      per: snapshot.units.valuation.per,
      pbr: snapshot.units.valuation.pbr,
      roe: snapshot.units.fundamental.roe,
      marginPercentile: snapshot.units.supplyDemand.percentile52w,
      beta250: snapshot.units.marketCorrelation.beta,
    },
  };
}

function filesystemError(message: string, causeValue: unknown): AnalysisSnapshotPersistenceError {
  return new AnalysisSnapshotPersistenceError('filesystem_error', message, causeValue);
}

function latestResolutionError(causeValue: unknown): AnalysisSnapshotPersistenceError {
  return new AnalysisSnapshotPersistenceError(
    'latest_resolution_failed',
    'The latest saved Snapshot could not be resolved from immutable history.',
    causeValue,
  );
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
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V1_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V2_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V3_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V4_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V5_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V6_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V7_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_V8_SCHEMA_VERSION
    && (raw as { schemaVersion?: unknown }).schemaVersion
      !== ANALYSIS_SNAPSHOT_SCHEMA_VERSION
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
  private readonly linkFile: CreateOnlyLinkFile | undefined;

  constructor(
    rootDirectory: string = dexterPath('analysis'),
    options: AnalysisSnapshotRepositoryOptions = {},
  ) {
    this.rootDirectory = resolve(rootDirectory);
    this.linkFile = options.linkFile;
  }

  async save(rawSnapshot: unknown): Promise<SavedAnalysisSnapshot> {
    const parsed = AnalysisSnapshotV9Schema.safeParse(rawSnapshot);
    if (!parsed.success) {
      throw new AnalysisSnapshotPersistenceError(
        'schema_validation_failed',
        'Only a valid canonical AnalysisSnapshot V9 can be saved.',
        parsed.error,
      );
    }

    // Zod parsing creates the allowlisted object that is serialized below.
    const snapshot = parsed.data;
    assertStoredReportSafe(snapshot.finalReportMarkdown);
    const canonicalTicker = assertCanonicalTicker(snapshot.canonicalTicker);
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = this.resolveTickerDirectory(canonicalTicker);
    const historyPath = this.resolveSnapshotPath(canonicalTicker, `${snapshotId}.json`);
    const canonicalPayload = canonicalJsonV1(snapshot as CanonicalJsonValue);
    const expectedDigest = digestValidatedAnalysisSnapshot(snapshot);

    try {
      await mkdir(tickerDirectory, { recursive: true });
      await this.assertRealPathContained(tickerDirectory);
    } catch (error) {
      if (error instanceof AnalysisSnapshotPersistenceError) throw error;
      throw filesystemError(`Could not create snapshot directory for ${canonicalTicker}.`, error);
    }

    await this.publishHistoryCreateOnly({
      canonicalPayload,
      canonicalTicker,
      expectedDigest,
      historyPath,
      snapshotId,
    });
    await this.resolveLatestFromHistory(canonicalTicker);

    return { snapshotId, canonicalTicker };
  }

  async loadLatest(ticker: string): Promise<AnalysisSnapshot> {
    const canonicalTicker = assertCanonicalTicker(ticker);
    const latest = await this.resolveLatestFromHistory(canonicalTicker);
    if (latest !== null) return latest.snapshot;

    const legacy = await this.readSnapshot(
      this.resolveSnapshotPath(canonicalTicker, 'latest.json'),
      `${canonicalTicker}/latest.json`,
    );
    this.assertSnapshotIdentity(legacy, canonicalTicker);
    return legacy;
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
    const snapshots = await this.loadValidatedHistory(canonicalTicker);
    return snapshots
      .sort((left, right) => compareLatestSnapshotOrderV1(right, left))
      .map(({ snapshotId, snapshot }) => historyItem(snapshot, snapshotId));
  }

  async listLatest(): Promise<AnalysisSnapshotLatestItem[]> {
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
      .map(snapshot => buildAnalysisSnapshotLatestItem(snapshot))
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

  private async listHistoryFilenames(canonicalTicker: string): Promise<string[]> {
    const tickerDirectory = this.resolveTickerDirectory(canonicalTicker);
    let entries;
    try {
      entries = await readdir(tickerDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw latestResolutionError(error);
    }
    return entries
      .map(entry => entry.name)
      .filter(name => name.endsWith('.json') && name !== 'latest.json');
  }

  private async loadValidatedHistory(canonicalTicker: string): Promise<Array<{
    snapshotId: SnapshotId;
    snapshot: AnalysisSnapshot;
  }>> {
    const filenames = await this.listHistoryFilenames(canonicalTicker);
    try {
      return await Promise.all(filenames.map(async filename => {
        const snapshotId = assertSnapshotId(filename.slice(0, -'.json'.length));
        const snapshot = await this.loadHistory(canonicalTicker, snapshotId);
        digestValidatedAnalysisSnapshot(snapshot);
        return { snapshotId, snapshot };
      }));
    } catch (error) {
      throw latestResolutionError(error);
    }
  }

  private async resolveLatestFromHistory(canonicalTicker: string): Promise<{
    snapshotId: SnapshotId;
    snapshot: AnalysisSnapshot;
  } | null> {
    const candidates = await this.loadValidatedHistory(canonicalTicker);
    try {
      return resolveLatestSnapshotV1(candidates);
    } catch (error) {
      throw latestResolutionError(error);
    }
  }

  private async publishHistoryCreateOnly(input: {
    canonicalPayload: string;
    canonicalTicker: string;
    expectedDigest: SnapshotDigest;
    historyPath: string;
    snapshotId: SnapshotId;
  }): Promise<'created' | 'existing_same'> {
    try {
      return await publishCreateOnlyFile({
        finalPath: input.historyPath,
        canonicalPayload: input.canonicalPayload,
        assertTemporaryPath: temporaryPath => this.assertContained(temporaryPath),
        validateTemporary: async temporaryPath => {
          const temporarySnapshot = await this.readSnapshot(temporaryPath, 'temporary Snapshot');
          this.assertSnapshotIdentity(
            temporarySnapshot,
            input.canonicalTicker,
            input.snapshotId,
          );
          if (digestValidatedAnalysisSnapshot(temporarySnapshot) !== input.expectedDigest) {
            throw new AnalysisSnapshotPersistenceError(
              'snapshot_history_corrupt',
              'The temporary Snapshot failed canonical digest validation.',
            );
          }
        },
        resolveExisting: async historyPath => {
          let winner: AnalysisSnapshot;
          try {
            winner = await this.readSnapshot(historyPath, 'existing history Snapshot');
            this.assertSnapshotIdentity(winner, input.canonicalTicker, input.snapshotId);
          } catch (winnerError) {
            throw new AnalysisSnapshotPersistenceError(
              'snapshot_history_corrupt',
              'The existing immutable history Snapshot is invalid.',
              winnerError,
            );
          }
          if (digestValidatedAnalysisSnapshot(winner) !== input.expectedDigest) {
            throw new AnalysisSnapshotPersistenceError(
              'snapshot_id_collision',
              'The Snapshot ID already exists with a different canonical payload.',
            );
          }
          return 'existing_same' as const;
        },
        linkFile: this.linkFile,
      });
    } catch (error) {
      if (error instanceof AnalysisSnapshotPersistenceError) throw error;
      if (
        error instanceof CreateOnlyFilePublicationError
        && error.kind === 'publish_unsupported'
      ) {
        throw new AnalysisSnapshotPersistenceError(
          'create_only_publish_unsupported',
          'Create-only Snapshot publication is not supported by this filesystem.',
          error,
        );
      }
      throw filesystemError('Could not publish immutable Snapshot history.', error);
    }
  }
}
