import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnalysisSnapshot } from './builder.js';
import { canonicalAnalysisSnapshotJsonV1 } from './canonical-json.js';
import { AnalysisSnapshotPersistenceError } from './errors.js';
import { snapshotGeneratedAtFromId } from './id.js';
import { ArtifactSafetyError } from './safety.js';
import {
  AnalysisSnapshotRepository,
  createSnapshotId,
} from './repository.js';
import {
  AnalysisSnapshotV1Schema,
  AnalysisSnapshotV2Schema,
  AnalysisSnapshotV3Schema,
  AnalysisSnapshotV4Schema,
  AnalysisSnapshotV5Schema,
  AnalysisSnapshotV6Schema,
  AnalysisSnapshotV7Schema,
  AnalysisSnapshotV8Schema,
  type AnalysisSnapshotInput,
  type AnalysisSnapshotV1,
  type AnalysisSnapshotV2,
  type AnalysisSnapshotV3,
  type AnalysisSnapshotV4,
  type AnalysisSnapshotV5,
  type AnalysisSnapshotV6,
  type AnalysisSnapshotV7,
  type AnalysisSnapshotV8,
  type AnalysisSnapshotV9,
} from './schema.js';

const temporaryDirectories: string[] = [];

function investorTypeFlowResult() {
  const zero = { sell: 0, buy: 0, total: 0, balance: 0 };
  return {
    dataDate: '2026-08-20',
    section: 'TokyoNagoya' as const,
    period: {
      publishedDate: '2026-08-20',
      periodStartDate: '2026-08-10',
      periodEndDate: '2026-08-14',
      section: 'TokyoNagoya' as const,
      summary: { proprietary: zero, brokerage: zero, total: zero },
      brokerageBreakdown: {
        individuals: zero,
        foreignInvestors: zero,
        securitiesCompanies: zero,
        investmentTrusts: zero,
        businessCorporations: zero,
        otherCorporations: zero,
        insuranceCompanies: zero,
        banks: zero,
        trustBanks: zero,
        otherFinancialInstitutions: zero,
      },
    },
    unavailable: [],
  };
}

function sectorBenchmarkResult() {
  return {
    analysisAsOfDate: '2026-08-21',
    benchmark: {
      type: 'TSE33_SECTOR_PRICE_INDEX' as const,
      sectorCode: '3700',
      sectorName: '輸送用機器',
      indexCode: '0050',
      classificationDate: '2026-08-21',
    },
    dataDate: '2026-08-21',
    alignedPriceCount: 251,
    windows: [],
    unavailable: [],
    provenance: {
      classification: { source: 'jquants' as const, endpoint: '/v2/equities/master' as const },
      index: { source: 'jquants' as const, endpoint: '/v2/indices/bars/daily' as const },
      calculation: { source: 'market_correlation_engine' as const },
    },
    units: {
      indexLevel: 'index_points' as const,
      observations: 'count' as const,
      correlation: 'ratio' as const,
      beta: 'ratio' as const,
      alphaAnnualized: 'ratio' as const,
      rSquared: 'ratio' as const,
      stockVolatilityAnnualized: 'ratio' as const,
      benchmarkVolatilityAnnualized: 'ratio' as const,
      excessReturn: 'ratio' as const,
    },
  };
}

function sectorShortRatioResult() {
  return {
    analysisAsOfDate: '2026-08-21',
    issuerCode: '72030',
    sector: {
      classificationDate: '2026-08-21',
      sectorCode: '3700',
      sectorName: '輸送用機器',
    },
    dataDate: '2026-08-21',
    observations: [{
      date: '2026-08-21',
      nonShortSellingValue: 100,
      restrictedShortSellingValue: 20,
      unrestrictedShortSellingValue: 30,
      shortSellingValue: 50,
      totalSellingValue: 150,
      shortSellingRatio: 1 / 3,
      unavailable: [],
    }],
    unavailable: [],
    provenance: {
      classification: { source: 'jquants' as const, endpoint: '/v2/equities/master' as const },
      flow: { source: 'jquants' as const, endpoint: '/v2/markets/short-ratio' as const },
      calculation: { source: 'sector_short_ratio_engine' as const },
    },
    units: {
      nonShortSellingValue: 'JPY' as const,
      restrictedShortSellingValue: 'JPY' as const,
      unrestrictedShortSellingValue: 'JPY' as const,
      shortSellingValue: 'JPY' as const,
      totalSellingValue: 'JPY' as const,
      shortSellingRatio: 'ratio' as const,
    },
  };
}

function advancedDividendResult(issuerCode = '72030') {
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-21T10:00:00.000Z',
    issuerCode,
    dataDate: '2026-08-20',
    observations: [{
      kind: 'company_forecast' as const,
      fiscalYearEndDate: '2027-03-31',
      disclosedDate: '2026-08-20',
      disclosedTime: '15:00:00',
      sourceEligibleDate: '2026-08-21',
      disclosureNumber: '20260820000001',
      sourceField: 'FDivAnn' as const,
      payoutRatioSourceField: 'FPayoutRatioAnn' as const,
      annualDividendPerShare: 100,
      payoutRatio: 0.35,
    }],
    events: null,
    unavailable: [{
      scope: 'event' as const,
      reason: 'event_source_plan_unavailable' as const,
    }],
    provenance: {
      financialSummary: { source: 'jquants' as const, endpoint: '/v2/fins/summary' as const },
      dividendEvents: null,
      availabilityCalendar: { source: 'jquants' as const, endpoint: '/v2/markets/calendar' as const },
      calculation: { source: 'advanced_dividend_engine' as const },
    },
    units: { dividendPerShare: 'JPY_per_share' as const, payoutRatio: 'ratio' as const },
  };
}

function volumeProfileResult(issuerCode = '72030') {
  const bins = Array.from({ length: 50 }, (_, index) => ({
    index,
    lowerPrice: 3_000 + index,
    upperPrice: 3_001 + index,
    representativePrice: 3_000.5 + index,
    allocatedVolume: 240,
    volumeShare: 0.02,
  }));
  return {
    analysisAsOfDate: '2026-08-21',
    collectedAt: '2026-08-23T01:00:00.000Z',
    issuerCode,
    dataDate: '2026-08-21',
    windowStartDate: '2026-03-06',
    windowEndDate: '2026-08-21',
    inputBarCount: 120,
    priceBasis: 'jquants_corporate_action_adjusted' as const,
    volumeBasis: 'jquants_corporate_action_adjusted' as const,
    allocationMethod: 'uniform_range_overlap_v1' as const,
    binningMethod: {
      id: 'fixed_count_linear_v1' as const,
      requestedBinCount: 50 as const,
      effectiveBinCount: 50,
      minPrice: 3_000,
      maxPrice: 3_050,
    },
    bins,
    poc: { binIndex: 0, price: 3_000.5, allocatedVolume: 240, volumeShare: 0.02 },
    valueArea: {
      targetVolumeShare: 0.7 as const,
      achievedVolumeShare: 0.7,
      val: 3_000,
      vah: 3_035,
      firstBinIndex: 0,
      lastBinIndex: 34,
    },
    unavailable: [],
    methodology: {
      id: 'daily_ohlcv_volume_profile_proxy_v1' as const,
      approximation: 'uniform_daily_range' as const,
      actualHolderCostBasis: false as const,
    },
    provenance: {
      source: 'jquants' as const,
      endpoint: '/v2/equities/bars/daily' as const,
      availabilityCalendarEndpoint: '/v2/markets/calendar' as const,
      sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1' as const,
      adjustmentFactorField: 'AdjFactor' as const,
      exRightsField: 'ExRT' as const,
      basisAudit: 'collection_horizon_rights_audit_v1' as const,
      basisAuditRequiredThroughDate: '2026-08-22',
      basisAuditThroughDate: '2026-08-22',
      corporateActionBasisStatus: 'supported_common_basis_established' as const,
      calculation: 'volume_profile_engine' as const,
    },
    units: {
      price: 'JPY' as const,
      allocatedVolume: 'adjusted_shares' as const,
      volumeShare: 'ratio' as const,
    },
  };
}

async function createRepository(): Promise<{ repository: AnalysisSnapshotRepository; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dexter-analysis-'));
  temporaryDirectories.push(root);
  return { repository: new AnalysisSnapshotRepository(root), root };
}

function partialSnapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV9 {
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
    investorTypeFlows: investorTypeFlowResult(),
    marketCorrelation: null,
    sectorBenchmark: sectorBenchmarkResult(),
    sectorShortRatio: sectorShortRatioResult(),
    advancedDividend: advancedDividendResult(`${canonicalTicker}0`),
    volumeProfile: volumeProfileResult(`${canonicalTicker}0`),
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: ['https://example.test/short-position'],
    investorTypeFlowSourceUrls: ['https://example.test/investor-types'],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
      reportedShortPositions: { sourceFromJQuants: true },
      investorTypeFlows: { sourceFromJQuants: true, calendarFromJQuants: true },
      sectorBenchmark: { stockFromJQuants: true },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

function v8Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV8 {
  const v9 = partialSnapshot(generatedAt, canonicalTicker);
  const {
    volumeProfile: _volumeProfile,
    dataDates: v9DataDates,
    provenance: v9Provenance,
    units: v9Units,
    unavailable: v9Unavailable,
    ...common
  } = v9;
  const { volumeProfile: _volumeProfileDate, ...dataDates } = v9DataDates;
  const { volumeProfile: _volumeProfileProvenance, ...provenance } = v9Provenance;
  const { volumeProfile: _volumeProfileUnits, ...units } = v9Units;
  return AnalysisSnapshotV8Schema.parse({
    ...common,
    schemaVersion: 8,
    dataDates,
    provenance,
    units,
    unavailable: v9Unavailable.filter(item => item.section !== 'volumeProfile'),
  });
}

function v7Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV7 {
  const v8 = v8Snapshot(generatedAt, canonicalTicker);
  const {
    advancedDividend: _advancedDividend,
    dataDates: v8DataDates,
    provenance: v8Provenance,
    units: v8Units,
    unavailable: v8Unavailable,
    ...common
  } = v8;
  const { advancedDividend: _advancedDividendDate, ...dataDates } = v8DataDates;
  const { advancedDividend: _advancedDividendProvenance, ...provenance } = v8Provenance;
  const { advancedDividend: _advancedDividendUnits, ...units } = v8Units;
  return AnalysisSnapshotV7Schema.parse({
    ...common,
    schemaVersion: 7,
    dataDates,
    provenance,
    units,
    unavailable: v8Unavailable.filter(item => item.section !== 'advancedDividend'),
  });
}

function v6Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV6 {
  const v7 = v7Snapshot(generatedAt, canonicalTicker);
  const {
    sectorShortRatio: _sectorShortRatio,
    dataDates: v7DataDates,
    provenance: v7Provenance,
    units: v7Units,
    unavailable: v7Unavailable,
    ...common
  } = v7;
  const { sectorShortRatio: _sectorShortRatioDate, ...dataDates } = v7DataDates;
  const { sectorShortRatio: _sectorShortRatioProvenance, ...provenance } = v7Provenance;
  const { sectorShortRatio: _sectorShortRatioUnits, ...units } = v7Units;
  return AnalysisSnapshotV6Schema.parse({
    ...common,
    schemaVersion: 6,
    dataDates,
    provenance,
    units,
    unavailable: v7Unavailable.filter(item => item.section !== 'sectorShortRatio'),
  });
}

function v5Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV5 {
  const v6 = v6Snapshot(generatedAt, canonicalTicker);
  const {
    sectorBenchmark: _sectorBenchmark,
    dataDates: v6DataDates,
    provenance: v6Provenance,
    units: v6Units,
    unavailable: v6Unavailable,
    ...common
  } = v6;
  const { sectorBenchmark: _sectorDate, ...dataDates } = v6DataDates;
  const { sectorBenchmark: _sectorProvenance, ...provenance } = v6Provenance;
  const { sectorBenchmark: _sectorUnits, ...units } = v6Units;

  return AnalysisSnapshotV5Schema.parse({
    ...common,
    schemaVersion: 5,
    dataDates,
    provenance,
    units,
    unavailable: v6Unavailable.filter(item => item.section !== 'sectorBenchmark'),
  });
}

function v4Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV4 {
  const v5 = v5Snapshot(generatedAt, canonicalTicker);
  const {
    investorTypeFlows: _investorTypeFlows,
    dataDates: v5DataDates,
    provenance: v5Provenance,
    units: v5Units,
    unavailable: v5Unavailable,
    ...common
  } = v5;
  const { investorTypeFlows: _investorDate, ...dataDates } = v5DataDates;
  const { investorTypeFlows: _investorProvenance, ...provenance } = v5Provenance;
  const { investorTypeFlows: _investorUnits, ...units } = v5Units;

  return AnalysisSnapshotV4Schema.parse({
    ...common,
    schemaVersion: 4,
    dataDates,
    provenance,
    units,
    unavailable: v5Unavailable.filter(item => item.section !== 'investorTypeFlows'),
  });
}

function v3Snapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshotV3 {
  const v4 = v4Snapshot(generatedAt, canonicalTicker);
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

async function saveInChildProcess(
  root: string,
  payloadPath: string,
  delayMs = 0,
): Promise<string> {
  const repositoryModule = new URL('./repository.ts', import.meta.url).href;
  const script = [
    "import { readFile } from 'node:fs/promises';",
    `import { AnalysisSnapshotRepository } from ${JSON.stringify(repositoryModule)};`,
    'const [root, payloadPath, delayMs] = process.argv.slice(1);',
    "const payload = JSON.parse(await readFile(payloadPath, 'utf8'));",
    'await Bun.sleep(Number(delayMs));',
    'try {',
    '  await new AnalysisSnapshotRepository(root).save(payload);',
    "  console.log('saved');",
    '} catch (error) {',
    "  console.log(error && typeof error === 'object' && 'kind' in error ? error.kind : 'unknown');",
    '}',
  ].join('\n');
  const child = Bun.spawn([process.execPath, '-e', script, root, payloadPath, String(delayMs)], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe('');
  return stdout.trim();
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('AnalysisSnapshotRepository', () => {
  test('saves validated V9 history create-only without writing latest JSON', async () => {
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
    expect(latest.schemaVersion).toBe(9);
    if (latest.schemaVersion !== 9) throw new Error('Expected Snapshot V9.');
    expect(latest.supplyDemand?.mean4w).toBe(950);
    expect(latest.reportedShortPositions?.reports[0]?.ratioDelta).toBe(0.001);
    expect(latest.investorTypeFlows).toEqual(investorTypeFlowResult());
    expect(latest.sectorBenchmark).toEqual(sectorBenchmarkResult());
    expect(latest.sectorShortRatio).toEqual(sectorShortRatioResult());
    expect(latest.advancedDividend).toEqual(advancedDividendResult());
    expect(latest.volumeProfile).toEqual(volumeProfileResult());
    expect(await readFile(join(root, '7203', `${saved.snapshotId}.json`), 'utf8'))
      .toBe(canonicalAnalysisSnapshotJsonV1(snapshot));
    expect(filenames).toEqual(['2026-08-23T01-02-03-000Z.json']);
  });

  test('keeps the winning inode for idempotent writes and rejects a different payload', async () => {
    const { repository, root } = await createRepository();
    const snapshot = partialSnapshot();
    const saved = await repository.save(snapshot);
    const historyPath = join(root, '7203', `${saved.snapshotId}.json`);
    const before = await stat(historyPath);

    await repository.save(snapshot);
    const after = await stat(historyPath);
    expect(after.ino).toBe(before.ino);

    await expectPersistenceError(repository.save({
      ...snapshot,
      finalReportMarkdown: '# Different analysis',
    }), 'snapshot_id_collision');
    expect((await stat(historyPath)).ino).toBe(before.ino);
    expect((await repository.loadHistory('7203', saved.snapshotId)).finalReportMarkdown)
      .toBe('# Analysis');
    expect((await readdir(join(root, '7203'))).some(name => name.endsWith('.tmp'))).toBeFalse();
  });

  test('publishes same and different payload races safely across real processes', async () => {
    const { root } = await createRepository();
    const samePayloadPath = join(root, 'same-payload.json');
    await writeFile(samePayloadPath, JSON.stringify(partialSnapshot()), 'utf8');

    const sameResults = await Promise.all(Array.from(
      { length: 3 },
      () => saveInChildProcess(root, samePayloadPath),
    ));
    expect(sameResults).toEqual(['saved', 'saved', 'saved']);

    const tickerDirectory = join(root, '7203');
    const historyPath = join(tickerDirectory, '2026-08-23T01-02-03-000Z.json');
    const winningInode = (await stat(historyPath)).ino;
    const payloadAPath = join(root, 'payload-a.json');
    const payloadBPath = join(root, 'payload-b.json');
    await writeFile(payloadAPath, JSON.stringify(partialSnapshot(
      '2026-08-23T01:02:04.000Z',
    )), 'utf8');
    await writeFile(payloadBPath, JSON.stringify({
      ...partialSnapshot('2026-08-23T01:02:04.000Z'),
      finalReportMarkdown: '# Competing analysis',
    }), 'utf8');

    const differentResults = await Promise.all([
      saveInChildProcess(root, payloadAPath),
      saveInChildProcess(root, payloadBPath),
    ]);
    expect(differentResults.sort()).toEqual(['saved', 'snapshot_id_collision']);
    expect((await stat(historyPath)).ino).toBe(winningInode);
    const competingHistoryPath = join(tickerDirectory, '2026-08-23T01-02-04-000Z.json');
    expect((await stat(competingHistoryPath)).nlink).toBe(1);
    const filenames = await readdir(tickerDirectory);
    expect(filenames.filter(name => name.endsWith('.json'))).toHaveLength(2);
    expect(filenames.some(name => name.endsWith('.tmp'))).toBeFalse();

    const delayedOlderPath = join(root, 'delayed-older.json');
    const immediateNewerPath = join(root, 'immediate-newer.json');
    const delayedOlder = partialSnapshot('2026-08-23T01:02:05.000Z');
    const immediateNewer = partialSnapshot('2026-08-23T01:02:06.000Z');
    await writeFile(delayedOlderPath, JSON.stringify(delayedOlder), 'utf8');
    await writeFile(immediateNewerPath, JSON.stringify(immediateNewer), 'utf8');
    expect(await Promise.all([
      saveInChildProcess(root, delayedOlderPath, 150),
      saveInChildProcess(root, immediateNewerPath),
    ])).toEqual(['saved', 'saved']);
    expect((await new AnalysisSnapshotRepository(root).loadLatest('7203')).generatedAt)
      .toBe(immediateNewer.generatedAt);
  });

  test('returns typed failures for a corrupt winner and unsupported hard links', async () => {
    const { repository, root } = await createRepository();
    const snapshot = partialSnapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(join(tickerDirectory, `${snapshotId}.json`), '{invalid', 'utf8');
    await expectPersistenceError(repository.save(snapshot), 'snapshot_history_corrupt');
    expect((await readdir(tickerDirectory)).some(name => name.endsWith('.tmp'))).toBeFalse();

    const unsupportedRoot = await mkdtemp(join(tmpdir(), 'dexter-analysis-unsupported-'));
    temporaryDirectories.push(unsupportedRoot);
    const unsupported = new AnalysisSnapshotRepository(unsupportedRoot, {
      linkFile: async () => {
        throw Object.assign(new Error('unsupported'), { code: 'ENOSYS' });
      },
    });
    await expectPersistenceError(
      unsupported.save(partialSnapshot('2026-08-23T01:02:04.000Z')),
      'create_only_publish_unsupported',
    );
    const unsupportedFiles = await readdir(join(unsupportedRoot, '7203'));
    expect(unsupportedFiles).toEqual([]);
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

  test('reads existing V4 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v4Snapshot();
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

  test('reads existing V5 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v5Snapshot();
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

  test('reads existing V6 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v6Snapshot();
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

  test('reads existing V7 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v7Snapshot();
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

  test('reads existing V8 history and latest JSON without rewriting either file', async () => {
    const { repository, root } = await createRepository();
    const snapshot = v8Snapshot();
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

  test('rejects V1 through V8 at the V9-only save boundary', async () => {
    const { repository } = await createRepository();

    await expectPersistenceError(repository.save(v1Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v2Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v3Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v4Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v5Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v6Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v7Snapshot()), 'schema_validation_failed');
    await expectPersistenceError(repository.save(v8Snapshot()), 'schema_validation_failed');
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

  test('orders by epoch milliseconds and a delayed old retry never changes latest', async () => {
    const { repository } = await createRepository();
    const older = partialSnapshot('2026-08-23T01:02:03Z');
    const newer = partialSnapshot('2026-08-23T01:02:03.500Z');
    await repository.save(older);
    await repository.save(newer);
    await repository.save(older);

    expect((await repository.loadLatest('7203')).generatedAt).toBe(newer.generatedAt);
    expect((await repository.listHistory('7203')).map(item => item.generatedAt)).toEqual([
      newer.generatedAt,
      older.generatedAt,
    ]);
  });

  test('normalizes equal epoch milliseconds to one ID and collides on different spelling', async () => {
    const { repository } = await createRepository();
    const withoutMilliseconds = partialSnapshot('2026-08-23T01:02:03Z');
    await repository.save(withoutMilliseconds);
    await repository.save(withoutMilliseconds);

    expect(createSnapshotId('2026-08-23T01:02:03.000Z')).toBe(
      createSnapshotId(withoutMilliseconds.generatedAt),
    );
    await expectPersistenceError(
      repository.save(partialSnapshot('2026-08-23T01:02:03.000Z')),
      'snapshot_id_collision',
    );
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

  test('fails closed on an unsafe stored report before creating persistence files', async () => {
    const { repository, root } = await createRepository();
    try {
      await repository.save({
        ...partialSnapshot(),
        finalReportMarkdown: 'sk-proj-abcdefghijklmnop',
      });
      throw new Error('Expected stored-report safety failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactSafetyError);
      expect((error as ArtifactSafetyError).code).toBe('credential_marker_detected');
      expect((error as Error).message).not.toContain('sk-proj-abcdefghijklmnop');
    }
    expect(await readdir(root)).toEqual([]);
  });

  test('distinguishes malformed JSON, schema validation, and unsupported versions', async () => {
    const { repository, root } = await createRepository();
    const tickerDirectory = join(root, '7203');
    await mkdir(tickerDirectory, { recursive: true });

    await writeFile(join(tickerDirectory, 'latest.json'), '{invalid', 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'malformed_json');

    await writeFile(join(tickerDirectory, 'latest.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'schema_validation_failed');

    await writeFile(join(tickerDirectory, 'latest.json'), JSON.stringify({ schemaVersion: 10 }), 'utf8');
    await expectPersistenceError(repository.loadLatest('7203'), 'unsupported_schema_version');
  });

  test('uses latest JSON only as an untouched zero-history legacy fallback', async () => {
    const { repository, root } = await createRepository();
    const tickerDirectory = join(root, '7203');
    const latestPath = join(tickerDirectory, 'latest.json');
    const legacy = v4Snapshot('2026-08-22T01:02:03.000Z');
    const legacyJson = `${JSON.stringify(legacy, null, 2)}\n`;
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(latestPath, legacyJson, 'utf8');

    expect(await repository.loadLatest('7203')).toEqual(legacy);
    expect(await readFile(latestPath, 'utf8')).toBe(legacyJson);

    const current = partialSnapshot('2026-08-23T01:02:03.000Z');
    await repository.save(current);
    await writeFile(latestPath, '{still-legacy-and-corrupt', 'utf8');
    expect(await repository.loadLatest('7203')).toEqual(current);
    expect(await repository.listHistory('7203')).toHaveLength(1);
    expect(await readFile(latestPath, 'utf8')).toBe('{still-legacy-and-corrupt');
  });

  test('fails latest resolution on any unsupported or mismatched history filename', async () => {
    const { repository, root } = await createRepository();
    await repository.save(partialSnapshot());
    await writeFile(join(root, '7203', 'unexpected.json'), '{}', 'utf8');

    await expectPersistenceError(repository.loadLatest('7203'), 'latest_resolution_failed');
    await expectPersistenceError(repository.listHistory('7203'), 'latest_resolution_failed');
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

    await expectPersistenceError(repository.loadLatest('7203'), 'latest_resolution_failed');
    await expectPersistenceError(repository.save(partialSnapshot()), 'filesystem_error');
  });

  test('does not read or write an existing latest path after history is present', async () => {
    const { repository, root } = await createRepository();
    const tickerDirectory = join(root, '7203');
    const latestPath = join(tickerDirectory, 'latest.json');
    await mkdir(tickerDirectory, { recursive: true });
    await writeFile(latestPath, '{legacy', 'utf8');
    const snapshot = partialSnapshot();
    const snapshotId = createSnapshotId(snapshot.generatedAt);

    await repository.save(snapshot);

    expect(await repository.loadHistory('7203', snapshotId)).toEqual(snapshot);
    expect(await repository.loadLatest('7203')).toEqual(snapshot);
    expect(await readFile(latestPath, 'utf8')).toBe('{legacy');
    const filenames = await readdir(tickerDirectory);
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
    expect(snapshotGeneratedAtFromId('2026-08-23T01-02-03-456Z'))
      .toBe('2026-08-23T01:02:03.456Z');
    expect(() => snapshotGeneratedAtFromId('2026-02-30T01-02-03-456Z')).toThrow(
      AnalysisSnapshotPersistenceError,
    );
    expect(() => createSnapshotId('2026-08-23T01:02:03+09:00')).toThrow(
      AnalysisSnapshotPersistenceError,
    );
  });
});
