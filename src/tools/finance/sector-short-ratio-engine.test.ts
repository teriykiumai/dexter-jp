import { describe, expect, test } from 'bun:test';
import { analyzeSectorShortRatio } from './sector-short-ratio-engine.js';
import type { SectorShortRatioSourceResult } from './sector-short-ratio.js';

function source(): SectorShortRatioSourceResult {
  return {
    analysisAsOfDate: '2026-05-20',
    issuerCode: '72030',
    classification: {
      classificationDate: '2026-05-20',
      sectorCode: '3700',
      sectorName: '輸送用機器',
    },
    rows: [{
      date: '2026-05-20',
      sectorCode: '3700',
      nonShortSellingValue: 100,
      restrictedShortSellingValue: 20,
      unrestrictedShortSellingValue: 30,
    }],
    provenance: {
      classification: { source: 'jquants', endpoint: '/v2/equities/master' },
      flow: { source: 'jquants', endpoint: '/v2/markets/short-ratio' },
    },
  };
}

describe('analyzeSectorShortRatio', () => {
  test('calculates only the fixed total and short-selling ratio in source JPY units', () => {
    const result = analyzeSectorShortRatio(source());

    expect(result.dataDate).toBe('2026-05-20');
    expect(result.observations).toEqual([{
      date: '2026-05-20',
      nonShortSellingValue: 100,
      restrictedShortSellingValue: 20,
      unrestrictedShortSellingValue: 30,
      shortSellingValue: 50,
      totalSellingValue: 150,
      shortSellingRatio: 1 / 3,
      unavailable: [],
    }]);
    expect(result.units).toEqual({
      nonShortSellingValue: 'JPY',
      restrictedShortSellingValue: 'JPY',
      unrestrictedShortSellingValue: 'JPY',
      shortSellingValue: 'JPY',
      totalSellingValue: 'JPY',
      shortSellingRatio: 'ratio',
    });
  });

  test('preserves missing, invalid, and zero-denominator observations without filling', () => {
    const input = source();
    input.rows = [
      { ...input.rows[0], date: '2026-05-17', nonShortSellingValue: null },
      { ...input.rows[0], date: '2026-05-18', restrictedShortSellingValue: -1 },
      {
        ...input.rows[0], date: '2026-05-19',
        nonShortSellingValue: 0, restrictedShortSellingValue: 0,
        unrestrictedShortSellingValue: 0,
      },
      input.rows[0],
    ];

    const result = analyzeSectorShortRatio(input);

    expect(result.observations.map(item => ({
      date: item.date,
      ratio: item.shortSellingRatio,
      reason: item.unavailable[0]?.reason ?? null,
    })) as Array<{ date: string; ratio: number | null; reason: string | null }>).toEqual([
      { date: '2026-05-17', ratio: null, reason: 'missing_data' },
      { date: '2026-05-18', ratio: null, reason: 'invalid_data' },
      { date: '2026-05-19', ratio: null, reason: 'zero_total_selling_value' },
      { date: '2026-05-20', ratio: 1 / 3, reason: null },
    ]);
  });

  test('excludes future rows, sorts a copied sequence, and does not mutate input', () => {
    const input = source();
    input.rows = [
      { ...input.rows[0], date: '2026-05-21', nonShortSellingValue: 999 },
      input.rows[0],
      { ...input.rows[0], date: '2026-05-19', nonShortSellingValue: 50 },
    ];
    const before = structuredClone(input);

    const result = analyzeSectorShortRatio(input);

    expect(result.observations.map(item => item.date)).toEqual([
      '2026-05-19', '2026-05-20',
    ]);
    expect(result.dataDate).toBe('2026-05-20');
    expect(input).toEqual(before);
  });

  test('preserves source-level unavailability and provenance without claiming zero', () => {
    const result = analyzeSectorShortRatio({
      analysisAsOfDate: '2026-05-20',
      issuerCode: '72030',
      classification: null,
      reason: 'sector_classification_unavailable',
      error: 'No classification.',
      provenance: { classification: null, flow: null },
    });

    expect(result).toMatchObject({
      sector: null,
      dataDate: null,
      observations: [],
      unavailable: [{ reason: 'sector_classification_unavailable' }],
      provenance: { classification: null, flow: null },
    });
  });

  test('rejects conflicting sector identity and duplicate eligible dates as invalid data', () => {
    const mismatched = source();
    mismatched.rows = [{ ...mismatched.rows[0], sectorCode: '3650' }];
    expect(analyzeSectorShortRatio(mismatched).unavailable).toEqual([
      { reason: 'invalid_data' },
    ]);

    const duplicate = source();
    duplicate.rows = [duplicate.rows[0], { ...duplicate.rows[0] }];
    expect(analyzeSectorShortRatio(duplicate).unavailable).toEqual([
      { reason: 'invalid_data' },
    ]);
  });
});
