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
import {
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV1,
  type AnalysisSnapshotV2,
  type AnalysisSnapshotV3,
  type AnalysisSnapshotV4,
} from './schema.js';

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<{ repository: AnalysisSnapshotRepository; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dexter-analysis-'));
  temporaryDirectories.push(root);
  return { repository: new AnalysisSnapshotRepository(root), root };
}

function partialSnapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV4 {
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
    advancedTechnical: null,
    supplyDemand: {
      dataDate: '2026-08-19',
      volumeDataDate: '2026-08-21',
      buyingBalance: 1_000,
      sellingBalance: 500,
      marginRatio: 2,
      buyingBalanceWeeklyChange: 100,
      sellingBalanceWeeklyChange: -50,
      mean4w: 950,
      mean13w: null,
      mean52w: null,
      deviation52w: null,
      percentile52w: null,
      averageDailyVolume20: 10_000,
      digestionDays: 0.1,
      unavailable: [
        { metric: 'mean13w', reason: 'insufficient_history' },
        { metric: 'mean52w', reason: 'insufficient_history' },
        { metric: 'deviation52w', reason: 'insufficient_history' },
        { metric: 'percentile52w', reason: 'insufficient_history' },
      ],
    },
    reportedShortPositions: {
      dataDate: '2026-08-20',
      reports: [{
        disclosedDate: '2026-08-20',
        calculatedDate: '2026-08-18',
        reporterName: 'Reporter Exact',
        discretionaryManagerName: null,
        fundName: null,
        shortPositionRatio: 0.006,
        shortPositionShares: 120_000,
        previousCalculatedDate: '2026-08-11',
        previousReportedRatio: 0.005,
        ratioDelta: 0.001,
      }],
      unavailable: [],
    },
    marketCorrelation: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: ['https://example.test/short-position'],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
      reportedShortPositions: { sourceFromJQuants: true },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

function v3Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV3 {
  const v4 = partialSnapshot(generatedAt, canonicalTicker);
  const {
    reportedShortPositions: _reportedShortPositions,
    dataDates: v4DataDates,
    provenance: v4Provenance,
    units: v4Units,
    unavailable: v4Unavailable,
    ...common
  } = v4;
  const { reportedShortPositions: _reportedDate, ...dataDates } = v4DataDates;
  const { reportedShortPositions: _reportedProvenance, ...provenance } = v4Provenance;
  const { reportedShortPositions: _reportedUnits, ...units } = v4Units;

  return AnalysisSnapshotV3Schema.parse({
    ...common,
    schemaVersion: 3,
    dataDates,
    provenance,
    units,
    unavailable: v4Unavailable.filter(item => item.section !== 'reportedShortPositions'),
  });
}

function v2Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV2 {
  const v3 = v3Snapshot(generatedAt, canonicalTicker);
  const { mean4w: _mean4w, unavailable, ...supplyDemand } = v3.supplyDemand!;
  const { mean4w: _mean4wUnit, ...supplyDemandUnits } = v3.units.supplyDemand;

  return AnalysisSnapshotV2Schema.parse({
    ...v3,
    schemaVersion: 2,
    supplyDemand: {
      ...supplyDemand,
      unavailable: unavailable.filter(item => item.metric !== 'mean4w'),
    },
    units: { ...v3.units, supplyDemand: supplyDemandUnits },
  });
}

function v1Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV1 {
  const v2 = v2Snapshot(generatedAt, canonicalTicker);
  const {
    advancedTechnical: _advancedTechnical,
    dataDates: v2DataDates,
    provenance: v2Provenance,
    units: v2Units,
    unavailable: v2Unavailable,
    ...common
  } = v2;
  const { advancedTechnical: _advancedDate, ...dataDates } = v2DataDates;
  const { advancedTechnical: _advancedProvenance, ...provenance } = v2Provenance;
  const { advancedTechnical: _advancedUnits, ...units } = v2Units;

  return AnalysisSnapshotV1Schema.parse({
    ...common,
    schemaVersion: 1,
    dataDates,
    provenance,
    units,
    unavailable: v2Unavailable.filter(item => item.section !== 'advancedTechnical'),
  });
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
  test('saves validated V4 history and latest JSON atomically and loads both', async () => {
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
    expect(latest.schemaVersion).toBe(4);
    if (latest.schemaVersion !== 4) throw new Error('Expected Snapshot V4.');
    expect(latest.supplyDemand?.mean4w).toBe(950);
    expect(latest.reportedShortPositions?.reports[0]?.ratioDelta).toBe(0.001);
    expect(filenames.sort()).toEqual([
      '2026-08-23T01-02-03-000Z.json',
      'latest.json',
    ]);
  });

  test('reads existing V1 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v1Snapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = join(root, '7203');
    const historyPath = join(tickerDirectory, `${snapshotId}.json`);
    const latestPath = join(tickerDirectory, 'latest.json');
    const originalJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(historyPath, originalJson, 'utf8');
    await writeFile(latestPath, originalJson, 'utf8');

    const history = await repository.loadHistory('7203', snapshotId);
    const latest = await repository.loadLatest('7203');

    expect(history).toEqual(snapshot);
    expect(latest).toEqual(snapshot);
    expect(history.schemaVersion).toBe(1);
    expect('advancedTechnical' in history).toBeFalse();
    expect(await readFile(historyPath, 'utf8')).toBe(originalJson);
    expect(await readFile(latestPath, 'utf8')).toBe(originalJson);
  });

  test('reads existing V2 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v2Snapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = join(root, '7203');
    const historyPath = join(tickerDirectory, `${snapshotId}.json`);
    const latestPath = join(tickerDirectory, 'latest.json');
    const originalJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(historyPath, originalJson, 'utf8');
    await writeFile(latestPath, originalJson, 'utf8');

    const history = await repository.loadHistory('7203', snapshotId);
    const latest = await repository.loadLatest('7203');

    expect(history).toEqual(snapshot);
    expect(latest).toEqual(snapshot);
    expect(history.schemaVersion).toBe(2);
    expect(history.supplyDemand && 'mean4w' in history.supplyDemand).toBeFalse();
    expect(await readFile(historyPath, 'utf8')).toBe(originalJson);
    expect(await readFile(latestPath, 'utf8')).toBe(originalJson);
  });

  test('reads existing V3 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v3Snapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = join(root, '7203');
    const historyPath = join(tickerDirectory, `${snapshotId}.json`);
    const latestPath = join(tickerDirectory, 'latest.json');
    const originalJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(historyPath, originalJson, 'utf8');
    await writeFile(latestPath, originalJson, 'utf8');

    expect(await repository.loadHistory('7203', snapshotId)).toEqual(snapshot);
    expect(await repository.loadLatest('7203')).toEqual(snapshot);
    expect(await readFile(historyPath, 'utf8')).toBe(originalJson);
    expect(await readFile(latestPath, 'utf8')).toBe(originalJson);
  });

  test('rejects V1, V2, and V3 at the V4-only save boundary', async () => {
    const { repository } = await createRepository();

    await expectPersistenceError(repository.save(v1Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v2Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v3Snapshot()), 'schema_validation_failed');
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
      latestSourceDataDate: '2026-08-21',
      metrics: {
        latestPrice: null,
        per: null,
        pbr: null,
        roe: null,
        trend: null,
        marginPercentile: null,
        beta250: null,
      },
    });
    expect(latest[0]).not.toHaveProperty('finalReportMarkdown');
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

    await writeFile(join(tickerDirectory, 'latest.json'), JSON.stringify({ schemaVersion: 5 }), 'utf8');
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

  test('rejects a schema-valid latest Snapshot for a different canonical ticker', async () => {
    const { repository, root } = await createRepository();
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(
      join(tickerDirectory, 'latest.json'),
      JSON.stringify(partialSnapshot('2026-08-23T01:02:03.000Z', '6758')),
      'utf8',
    );

    await expectPersistenceError(
      repository.loadLatest('7203'),
      'snapshot_identity_mismatch',
    );
  });

  test('rejects a schema-valid history Snapshot for a different canonical ticker', async () => {
    const { repository, root } = await createRepository();
    const snapshot = partialSnapshot('2026-08-23T01:02:03.000Z', '6758');
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(
      join(tickerDirectory, `${snapshotId}.json`),
      JSON.stringify(snapshot),
      'utf8',
    );

    await expectPersistenceError(
      repository.loadHistory('7203', snapshotId),
      'snapshot_identity_mismatch',
    );
  });

  test('rejects history whose filename does not match the Snapshot generatedAt', async () => {
    const { repository, root } = await createRepository();
    const snapshot = partialSnapshot('2026-08-23T01:02:03.000Z');
    const mismatchedId = createSnapshotId('2026-08-22T01:02:03.000Z');
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(
      join(tickerDirectory, `${mismatchedId}.json`),
      JSON.stringify(snapshot),
      'utf8',
    );

    await expectPersistenceError(
      repository.loadHistory('7203', mismatchedId),
      'snapshot_identity_mismatch',
    );
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
