import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnalysisSnapshot } from './builder.js';
import { AnalysisSnapshotPersistenceError } from './errors.js';
import {
  AnalysisSnapshotRepository,
  createSnapshotId,
} from './repository.js';
import type { AnalysisSnapshot, AnalysisSnapshotInput } from './schema.js';

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<{ repository: AnalysisSnapshotRepository; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dexter-analysis-'));
  temporaryDirectories.push(root);
  return { repository: new AnalysisSnapshotRepository(root), root };
}

function partialSnapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshot {
  const input: AnalysisSnapshotInput = {
    identity: {
      canonicalTicker,
      companyName: canonicalTicker === '7203' ? 'トヨタ自動車株式会社' : 'テスト株式会社',
      industry: '輸送用機器',
      listingStatus: 'listed',
      isDelisted: false,
      dataDate: '2026-08-21',
      sourceUrls: ['https://example.test/company'],
    },
    generatedAt,
    fundamental: null,
    valuation: null,
    peerComparison: null,
    peerCandidateMarketCapsComplete: null,
    technical: null,
    supplyDemand: null,
    marketCorrelation: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

async function expectPersistenceError(
  operation: Promise<unknown>,
  kind: AnalysisSnapshotPersistenceError['kind'],
): Promise<AnalysisSnapshotPersistenceError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisSnapshotPersistenceError);
    expect((error as AnalysisSnapshotPersistenceError).kind).toBe(kind);
    return error as AnalysisSnapshotPersistenceError;
  }
  throw new Error(`Expected ${kind} persistence error.`);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('AnalysisSnapshotRepository', () => {
  test('saves validated history and latest JSON atomically and loads both', async () => {
    const { repository, root } = await createRepository();
    const snapshot = partialSnapshot();

    const saved = await repository.save(snapshot);
    const history = await repository.loadHistory('7203', saved.snapshotId);
    const latest = await repository.loadLatest('7203');
    const filenames = await readdir(join(root, '7203'));

    expect(saved).toEqual({
      canonicalTicker: '7203',
      snapshotId: '2026-08-23T01-02-03-000Z',
    });
    expect(history).toEqual(snapshot);
    expect(latest).toEqual(snapshot);
    expect(filenames.sort()).toEqual([
      '2026-08-23T01-02-03-000Z.json',
      'latest.json',
    ]);
  });

  test('lists history metadata in descending generatedAt order', async () => {
    const { repository } = await createRepository();
    await repository.save(partialSnapshot('2026-08-22T01:02:03.000Z'));
    await repository.save(partialSnapshot('2026-08-23T01:02:03.000Z'));

    const history = await repository.listHistory('7203');

    expect(history.map(item => item.snapshotId)).toEqual([
      '2026-08-23T01-02-03-000Z',
      '2026-08-22T01-02-03-000Z',
    ]);
    expect(history[0]).toMatchObject({
      canonicalTicker: '7203',
      companyName: 'トヨタ自動車株式会社',
      status: 'partial',
    });
  });

  test('lists one latest metadata item per canonical ticker', async () => {
    const { repository } = await createRepository();
    await repository.save(partialSnapshot('2026-08-23T01:02:03.000Z', '7203'));
    await repository.save(partialSnapshot('2026-08-23T02:03:04.000Z', '130A'));

    const latest = await repository.listLatest();

    expect(latest.map(item => item.canonicalTicker)).toEqual(['130A', '7203']);
    expect(latest[0]).toMatchObject({
      snapshotId: '2026-08-23T02-03-04-000Z',
      companyName: 'テスト株式会社',
      status: 'partial',
    });
  });

  test('uses an alphanumeric canonical ticker as a safe directory segment', async () => {
    const { repository } = await createRepository();
    const snapshot = partialSnapshot('2026-08-23T01:02:03.000Z', '130A');

    const saved = await repository.save(snapshot);

    expect(saved.canonicalTicker).toBe('130A');
    expect(await repository.loadLatest('130A')).toEqual(snapshot);
  });

  test('serializes only allowlisted Snapshot fields', async () => {
    const { repository, root } = await createRepository();
    const snapshot = {
      ...partialSnapshot(),
      apiKey: 'must-not-survive',
      rawPrompt: 'must-not-survive',
    };

    const saved = await repository.save(snapshot);
    const raw = await readFile(join(root, '7203', `${saved.snapshotId}.json`), 'utf8');

    expect(raw).not.toContain('must-not-survive');
    expect('apiKey' in await repository.loadLatest('7203')).toBeFalse();
  });

  test('distinguishes malformed JSON, schema validation, and unsupported versions', async () => {
    const { repository, root } = await createRepository();
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });

    await writeFile(join(tickerDirectory, 'latest.json'), '{invalid', 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'malformed_json');

    await writeFile(join(tickerDirectory, 'latest.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'schema_validation_failed');

    await writeFile(join(tickerDirectory, 'latest.json'), JSON.stringify({ schemaVersion: 2 }), 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'unsupported_schema_version');
  });

  test('distinguishes missing snapshots and rejects unsafe path segments', async () => {
    const { repository } = await createRepository();

    await expectPersistenceError(repository.loadLatest('7203'), 'missing_snapshot');
    await expectPersistenceError(repository.loadLatest('../7203'), 'unsafe_ticker');
    await expectPersistenceError(
      repository.loadHistory('7203', '../latest'),
      'unsafe_snapshot_id',
    );
    await expectPersistenceError(
      repository.loadHistory('7203', '2026-08-23T01:02:03.000Z'),
      'unsafe_snapshot_id',
    );
  });

  test('distinguishes filesystem failures from missing snapshots', async () => {
    const { repository, root } = await createRepository();
    await mkdir(join(root, '7203', 'latest.json'), { recursive: true });

    await expectPersistenceError(repository.loadLatest('7203'), 'filesystem_error');
  });

  test('rejects ticker directories that resolve outside the repository root', async () => {
    const { repository, root } = await createRepository();
    const external = await createRepository();
    await external.repository.save(partialSnapshot());
    await symlink(
      join(external.root, '7203'),
      join(root, '7203'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expectPersistenceError(repository.loadLatest('7203'), 'filesystem_error');
    await expectPersistenceError(repository.save(partialSnapshot()), 'filesystem_error');
  });

  test('reports when history succeeds but latest cannot be atomically updated', async () => {
    const { repository, root } = await createRepository();
    await mkdir(join(root, '7203', 'latest.json'), { recursive: true });
    const snapshot = partialSnapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);

    await expectPersistenceError(repository.save(snapshot), 'latest_update_failed');

    expect(await repository.loadHistory('7203', snapshotId)).toEqual(snapshot);
    const filenames = await readdir(join(root, '7203'));
    expect(filenames.some(filename => filename.endsWith('.tmp'))).toBeFalse();
  });

  test('rejects invalid snapshots before creating persistence files', async () => {
    const { repository, root } = await createRepository();
    const invalid = { ...partialSnapshot(), status: 'success' };

    await expectPersistenceError(repository.save(invalid), 'schema_validation_failed');

    expect(await readdir(root)).toEqual([]);
  });

  test('creates Windows-safe IDs for canonical timestamps', () => {
    expect(createSnapshotId('2026-08-23T01:02:03Z')).toBe('2026-08-23T01-02-03-000Z');
    expect(createSnapshotId('2026-08-23T01:02:03.456Z')).toBe('2026-08-23T01-02-03-456Z');
    expect(() => createSnapshotId('2026-08-23T01:02:03+09:00')).toThrow(
      AnalysisSnapshotPersistenceError,
    );
  });
});
