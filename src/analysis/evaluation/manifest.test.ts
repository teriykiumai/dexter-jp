import { describe, expect, test } from 'bun:test';
import {
  comparisonSnapshot,
  snapshotAtVersion,
} from '../comparison/test-fixtures.js';
import type { AnalysisSnapshotV9 } from '../snapshot/schema.js';
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
