import { describe, expect, test } from 'bun:test';
import {
  comparisonInput,
  comparisonSnapshot,
  snapshotAtVersion,
} from '../comparison/test-fixtures.js';
import { buildAnalysisSnapshot } from '../snapshot/builder.js';
import type { AnalysisSnapshotV9 } from '../snapshot/schema.js';
import { analyzePeerComparison } from '../../tools/finance/peer-comparison-engine.js';
import {
  buildEvidenceManifestV1,
  createEvidenceItemIdV1,
  digestEvidenceManifestV1,
  EvidenceManifestError,
  validateEvidenceManifestV1,
} from './manifest.js';

function fullMaximumSnapshot(): AnalysisSnapshotV9 {
  const snapshot = structuredClone(comparisonSnapshot());
  snapshot.unavailable = snapshot.unavailable.filter(item => ![
    'reportedShortPositions', 'investorTypeFlows', 'sectorShortRatio',
  ].includes(item.section));
  const fundamental = snapshot.fundamental;
  const strategy = snapshot.strategy;
  const dividend = snapshot.advancedDividend;
  if (fundamental === null || strategy === null || dividend === null || dividend.events === null) {
    throw new Error('The comparison fixture must provide full base sections.');
  }
  fundamental.periods = Array.from({ length: 6 }, (_, index) => ({
    ...fundamental.periods[0],
    fiscalYear: 2020 + index,
    submitDate: `202${index}-06-01`,
  }));

  snapshot.reportedShortPositions = {
    dataDate: '2026-08-20',
    reports: Array.from({ length: 100 }, (_, index) => ({
      disclosedDate: '2026-08-20',
      calculatedDate: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
      reporterName: `Reporter ${index}`,
      discretionaryManagerName: null,
      fundName: null,
      shortPositionRatio: 0.006,
      shortPositionShares: 120_000 + index,
      previousCalculatedDate: null,
      previousReportedRatio: null,
      ratioDelta: null,
    })),
    unavailable: [],
  };
  snapshot.dataDates.reportedShortPositions = '2026-08-20';
  snapshot.provenance.reportedShortPositions = [{
    source: 'jquants', role: 'short_position_data', asOfDate: '2026-08-20',
    sourceUrls: ['https://secret.invalid/reported'],
  }];
  snapshot.units.reportedShortPositions = {
    shortPositionRatio: 'ratio', shortPositionShares: 'shares',
    previousReportedRatio: 'ratio', ratioDelta: 'ratio',
  };

  const zero = { sell: 0, buy: 0, total: 0, balance: 0 };
  snapshot.investorTypeFlows = {
    dataDate: '2026-08-20',
    section: 'TokyoNagoya',
    period: {
      publishedDate: '2026-08-20', periodStartDate: '2026-08-10',
      periodEndDate: '2026-08-14', section: 'TokyoNagoya',
      summary: { proprietary: zero, brokerage: zero, total: zero },
      brokerageBreakdown: {
        individuals: zero, foreignInvestors: zero, securitiesCompanies: zero,
        investmentTrusts: zero, businessCorporations: zero, otherCorporations: zero,
        insuranceCompanies: zero, banks: zero, trustBanks: zero,
        otherFinancialInstitutions: zero,
      },
    },
    unavailable: [],
  };
  snapshot.dataDates.investorTypeFlows = '2026-08-20';
  snapshot.provenance.investorTypeFlows = [{
    source: 'jquants', role: 'investor_type_flow_data', asOfDate: '2026-08-20',
    sourceUrls: ['https://secret.invalid/flows'], endpoint: '/v2/equities/investor-types',
    section: 'TokyoNagoya',
  }];
  snapshot.units.investorTypeFlows = {
    sell: 'thousand_JPY', buy: 'thousand_JPY', total: 'thousand_JPY',
    balance: 'thousand_JPY',
  };

  snapshot.sectorShortRatio = {
    analysisAsOfDate: '2026-08-21', issuerCode: '72030',
    sector: { classificationDate: '2026-08-21', sectorCode: '3700', sectorName: '輸送用機器' },
    dataDate: '2026-08-21',
    observations: Array.from({ length: 100 }, (_, index) => ({
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      nonShortSellingValue: 100, restrictedShortSellingValue: 20,
      unrestrictedShortSellingValue: 30, shortSellingValue: 50,
      totalSellingValue: 150, shortSellingRatio: 1 / 3, unavailable: [],
    })),
    unavailable: [],
    provenance: {
      classification: { source: 'jquants', endpoint: '/v2/equities/master' },
      flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
      calculation: { source: 'sector_short_ratio_engine' },
    },
    units: {
      nonShortSellingValue: 'JPY', restrictedShortSellingValue: 'JPY',
      unrestrictedShortSellingValue: 'JPY', shortSellingValue: 'JPY',
      totalSellingValue: 'JPY', shortSellingRatio: 'ratio',
    },
  };
  snapshot.dataDates.sectorShortRatio = '2026-08-21';
  snapshot.provenance.sectorShortRatio = [{
    source: 'jquants', role: 'sector_short_ratio_data', asOfDate: '2026-08-21',
    sourceUrls: [], endpoint: '/v2/markets/short-ratio',
  }];
  snapshot.units.sectorShortRatio = { ...snapshot.sectorShortRatio.units };

  const fiscalBase = dividend.observations[0];
  dividend.observations = Array.from({ length: 20 }, (_, index) => ({
    ...fiscalBase,
    fiscalYearEndDate: `${2030 + index}-03-31`,
    disclosureNumber: `fiscal-${index}`,
  }));
  const eventBase = dividend.events[0];
  dividend.events = Array.from({ length: 50 }, (_, index) => ({
    ...eventBase,
    referenceNumber: `event-${index}`,
    corporateActionReferenceNumber: `action-${index}`,
    recordDateYearMonth: `${2030 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
  }));

  const candidate = strategy.candidates[0];
  strategy.candidates = Array.from({ length: 16 }, (_, index) => ({
    ...candidate,
    entry: { ...candidate.entry, price: 3_100 + index },
    stop: { ...candidate.stop, price: 2_800 - index },
    target: { ...candidate.target, price: 3_600 + index },
  }));
  return snapshot;
}

describe('Evidence Manifest V1', () => {
  test('builds deterministic V1-V9 manifests with the exact fixed scope registry', () => {
    const v9 = comparisonSnapshot();
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const snapshot = snapshotAtVersion(v9, version);
      const left = buildEvidenceManifestV1(snapshot);
      const right = buildEvidenceManifestV1(structuredClone(snapshot));
      expect(left).toEqual(right);
      expect(left.scopes).toHaveLength(24);
      expect(digestEvidenceManifestV1(left)).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(JSON.stringify(left)).not.toContain('https://');
      expect(JSON.stringify(left)).not.toContain('sourceUrls');
    }
  });

  test('implements the reviewed Evidence item ID golden vector', () => {
    expect(createEvidenceItemIdV1(
      'market_correlation',
      'marketCorrelation.window',
      [{ name: 'benchmark', value: 'TOPIX' }, { name: 'period', value: 20 }],
    )).toBe('e_83b8164e241819769d1fe6fd');
  });

  test('marks the V1/V2 20-day correlation instance not collected without weakening scope coverage', () => {
    const manifest = buildEvidenceManifestV1(snapshotAtVersion(comparisonSnapshot(), 1));
    const item = manifest.items.find(value => (
      value.definitionKey === 'marketCorrelation.window'
      && value.instanceIdentity.some(identity => identity.name === 'period' && identity.value === 20)
    ));
    expect(item?.facts.every(fact => fact.state === 'not_collected')).toBe(true);
    expect(manifest.scopes.find(scope => scope.scopeId === 'market_correlation')).toMatchObject({
      state: 'available', coverage: 'complete_for_domain', reason: null,
    });
  });

  test('keeps allowlisted stored reasons but excludes free-form top-level detail', () => {
    const snapshot = comparisonSnapshot();
    if (snapshot.valuation === null) throw new Error('expected valuation fixture');
    snapshot.valuation.per = null;
    snapshot.valuation.unavailable.push({
      metric: 'per', reason: 'missing_or_invalid_eps',
    });
    snapshot.unavailable.push({
      section: 'valuation', metric: 'per', reason: 'missing_or_invalid_eps',
      detail: 'C:\\private\\secret.txt',
    });
    const manifest = buildEvidenceManifestV1(snapshot);
    const per = manifest.items.find(item => item.definitionKey === 'valuation.per');
    expect(per?.facts[0]).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'missing_or_invalid_eps', detail: null }],
    });
    expect(JSON.stringify(manifest)).not.toContain('private');
  });

  test('preserves exact custom reasons and rejects available facts paired with them', () => {
    const fundamentalInput = comparisonInput();
    if (fundamentalInput.fundamental === null) throw new Error('expected fundamental fixture');
    fundamentalInput.fundamental.periods[0].revenue = null;
    fundamentalInput.fundamental.periods[0].roe = 0;
    fundamentalInput.additionalUnavailable.push({
      section: 'fundamental', metric: 'revenue', reason: 'fundamental_source_missing',
    });
    const fundamentalManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(fundamentalInput));
    const fundamental = fundamentalManifest.items.find(item => (
      item.definitionKey === 'fundamental.period'
    ));
    expect(fundamental?.facts.find(fact => fact.factKey === 'revenue')).toMatchObject({
      state: 'unavailable', value: null,
      unavailableReasons: [{ reason: 'fundamental_source_missing', detail: null }],
    });
    expect(fundamental?.facts.find(fact => fact.factKey === 'roe')).toMatchObject({
      state: 'available', value: 0, unavailableReasons: [],
    });

    const fundamentalContradiction = comparisonInput();
    fundamentalContradiction.additionalUnavailable.push({
      section: 'fundamental', metric: 'revenue', reason: 'fundamental_source_missing',
    });
    expect(() => buildEvidenceManifestV1(buildAnalysisSnapshot(fundamentalContradiction)))
      .toThrow(EvidenceManifestError);

    const strategyInput = comparisonInput();
    if (strategyInput.strategy === null) throw new Error('expected strategy fixture');
    strategyInput.strategy.entry = null;
    strategyInput.strategy.candidates = [];
    strategyInput.strategy.unavailable.push({
      candidate: 'entry', reason: 'missing_entry',
    });
    const strategyManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(strategyInput));
    const strategy = strategyManifest.items.find(item => item.definitionKey === 'strategy.entry');
    expect(strategy?.facts.find(fact => fact.factKey === 'entry.price')).toMatchObject({
      state: 'unavailable', value: null,
      unavailableReasons: [{ reason: 'missing_entry', detail: null }],
    });

    const strategyContradiction = comparisonInput();
    if (strategyContradiction.strategy === null) throw new Error('expected strategy fixture');
    strategyContradiction.strategy.unavailable.push({
      candidate: 'entry', reason: 'missing_entry',
    });
    expect(() => buildEvidenceManifestV1(buildAnalysisSnapshot(strategyContradiction)))
      .toThrow(EvidenceManifestError);
  });

  test('keeps grouped sibling facts available when exact reasons apply only to nullable facts', () => {
    const peerInput = comparisonInput();
    peerInput.peerComparison = analyzePeerComparison({
      id: '7203', name: 'トヨタ自動車株式会社', sector: '輸送用機器', marketCap: 1_000,
      dataDate: '2026-08-21',
      metrics: {
        per: 15, pbr: 1.2, roe: 12, roic: 10, operatingMargin: 8,
        revenueGrowth: 5, dividendYield: 2.5,
      },
    }, []);
    peerInput.peerCandidateMarketCapsComplete = true;
    const peerManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(peerInput));
    const per = peerManifest.items.find(item => (
      item.definitionKey === 'peerComparison.position'
      && item.instanceIdentity.some(value => value.name === 'metric' && value.value === 'per')
    ));
    expect(per?.facts.find(fact => fact.factKey === 'targetValue')).toMatchObject({
      state: 'available', value: 15,
    });
    expect(per?.facts.find(fact => fact.factKey === 'median')).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'insufficient_peer_data', detail: null }],
    });

    const sectorInput = comparisonInput();
    if (sectorInput.sectorBenchmark === null) throw new Error('expected sector fixture');
    sectorInput.sectorBenchmark.dataDate = null;
    sectorInput.sectorBenchmark.alignedPriceCount = 0;
    sectorInput.sectorBenchmark.windows = [];
    sectorInput.sectorBenchmark.unavailable = [{ reason: 'no_sector_index_data' }];
    const sectorManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(sectorInput));
    const sector = sectorManifest.items.find(item => item.definitionKey === 'sectorBenchmark.identity');
    expect(sector?.facts.find(fact => fact.factKey === 'benchmark.sectorCode')).toMatchObject({
      state: 'available', value: '3700',
    });
    expect(sector?.facts.find(fact => fact.factKey === 'dataDate')).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'no_sector_index_data', detail: null }],
    });

    const dividendInput = comparisonInput();
    if (dividendInput.advancedDividend === null || dividendInput.advancedDividend.events === null) {
      throw new Error('expected dividend fixture');
    }
    for (const event of dividendInput.advancedDividend.events) {
      event.ordinaryDividendPerShare = null;
      event.commemorativeDividendPerShare = null;
      event.specialDividendPerShare = null;
    }
    dividendInput.advancedDividend.unavailable.push({
      scope: 'component', reason: 'component_breakdown_unavailable',
    });
    const dividendManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(dividendInput));
    const dividend = dividendManifest.items.find(item => item.definitionKey === 'advancedDividend.event');
    expect(dividend?.facts.find(fact => fact.factKey === 'dividendPerShare')).toMatchObject({
      state: 'available', value: 50,
    });
    expect(dividend?.facts.find(fact => fact.factKey === 'ordinaryDividendPerShare')).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'component_breakdown_unavailable', detail: null }],
    });

    const volumeInput = comparisonInput();
    if (volumeInput.volumeProfile === null) throw new Error('expected volume fixture');
    volumeInput.volumeProfile.bins = null;
    volumeInput.volumeProfile.poc = null;
    volumeInput.volumeProfile.valueArea = null;
    volumeInput.volumeProfile.binningMethod.effectiveBinCount = 0;
    volumeInput.volumeProfile.binningMethod.minPrice = null;
    volumeInput.volumeProfile.binningMethod.maxPrice = null;
    volumeInput.volumeProfile.unavailable = [{ scope: 'profile', reason: 'zero_total_volume' }];
    const volumeManifest = buildEvidenceManifestV1(buildAnalysisSnapshot(volumeInput));
    const volume = volumeManifest.items.find(item => item.definitionKey === 'volumeProfile.summary');
    expect(volume?.facts.find(fact => fact.factKey === 'dataDate')).toMatchObject({
      state: 'available', value: '2026-08-21',
    });
    expect(volume?.facts.find(fact => fact.factKey === 'poc.price')).toMatchObject({
      state: 'unavailable',
      unavailableReasons: [{ reason: 'zero_total_volume', detail: null }],
    });
  });

  test('groups every maximum collection into exactly 343 items without source URLs', () => {
    const manifest = buildEvidenceManifestV1(fullMaximumSnapshot());
    expect(manifest.items).toHaveLength(343);
    expect(manifest.items.filter(item => item.definitionKey === 'reportedShortPositions.row')).toHaveLength(100);
    expect(manifest.items.filter(item => item.definitionKey === 'sectorShortRatio.observation')).toHaveLength(100);
    expect(manifest.items.filter(item => item.definitionKey === 'advancedDividend.fiscal')).toHaveLength(20);
    expect(manifest.items.filter(item => item.definitionKey === 'advancedDividend.event')).toHaveLength(50);
    expect(manifest.items.filter(item => item.definitionKey === 'strategy.candidate')).toHaveLength(16);
    const investor = manifest.items.find(item => item.definitionKey === 'investorTypeFlows.period');
    expect(investor?.facts.filter(fact => fact.value === 0).every(fact => fact.state === 'available'))
      .toBe(true);
  });

  test('fails rather than truncating a 101st sector observation or 17th strategy candidate', () => {
    const sectorOverflow = fullMaximumSnapshot();
    const sector = sectorOverflow.sectorShortRatio;
    if (sector === null) throw new Error('expected sector fixture');
    sector.observations.push({ ...sector.observations[0], date: '2030-01-01' });
    expect(() => buildEvidenceManifestV1(sectorOverflow)).toThrow(EvidenceManifestError);

    const strategyOverflow = fullMaximumSnapshot();
    const strategy = strategyOverflow.strategy;
    if (strategy === null) throw new Error('expected strategy fixture');
    strategy.candidates.push(structuredClone(strategy.candidates[0]));
    expect(() => buildEvidenceManifestV1(strategyOverflow)).toThrow(EvidenceManifestError);
  });

  test('rejects unknown fact reasons, definitions, and relative-but-unregistered endpoints', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const unknownReason = structuredClone(manifest);
    const unavailable = unknownReason.items.flatMap(item => item.facts)
      .find(fact => fact.state !== 'available');
    if (unavailable === undefined) throw new Error('expected unavailable fact');
    unavailable.unavailableReasons[0].reason = 'invented_reason';
    expect(() => validateEvidenceManifestV1(unknownReason)).toThrow(EvidenceManifestError);

    const wrongKnownReason = buildEvidenceManifestV1(snapshotAtVersion(comparisonSnapshot(), 1));
    const correlation = wrongKnownReason.items.find(item => (
      item.definitionKey === 'marketCorrelation.window'
      && item.facts[0].state === 'not_collected'
    ));
    if (correlation === undefined || correlation.facts[0].state === 'available') {
      throw new Error('expected non-available correlation fact');
    }
    correlation.facts[0].unavailableReasons[0].reason = 'no_public_disclosure_data';
    expect(() => validateEvidenceManifestV1(wrongKnownReason)).toThrow(EvidenceManifestError);

    const unknownDefinition = structuredClone(manifest);
    unknownDefinition.items[0].definitionKey = 'snapshot/private/path';
    expect(() => validateEvidenceManifestV1(unknownDefinition)).toThrow(EvidenceManifestError);

    const wrongUnit = structuredClone(manifest);
    const currentPrice = wrongUnit.items.find(item => item.definitionKey === 'valuation.currentPrice');
    if (currentPrice === undefined) throw new Error('expected current-price fact');
    currentPrice.facts[0].unit = 'shares';
    expect(() => validateEvidenceManifestV1(wrongUnit)).toThrow(EvidenceManifestError);

    const wrongMethod = structuredClone(manifest);
    wrongMethod.items[0].method = 'caller_supplied_method';
    expect(() => validateEvidenceManifestV1(wrongMethod)).toThrow(EvidenceManifestError);

    const endpoint = structuredClone(manifest);
    endpoint.items[0].provenance[0].qualifiers.push({ name: 'endpoint', value: '/private' });
    expect(() => validateEvidenceManifestV1(endpoint)).toThrow(EvidenceManifestError);

    const wrongKnownSource = structuredClone(manifest);
    wrongKnownSource.items[0].provenance[0].source = 'jquants';
    expect(() => validateEvidenceManifestV1(wrongKnownSource)).toThrow(EvidenceManifestError);
  });
});
