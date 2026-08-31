import { describe, expect, test } from 'bun:test';
import {
  TSE_TICK_BANDS_V1,
  isExecutableTsePriceV1,
  nextTseQuoteAboveV1,
  resolveTseTickV1,
} from './index.js';

describe('TseTickRuleV1', () => {
  test('matches every fine and ordinary tick band at its inclusive upper boundary', () => {
    for (const band of TSE_TICK_BANDS_V1) {
      if (band.upper === null) continue;
      expect(resolveTseTickV1('2025-01-06', ['topix_core30'], band.upper)).toMatchObject({
        state: 'available', table: 'fine', tick: band.fine,
      });
      expect(resolveTseTickV1('2025-01-06', ['other'], band.upper)).toMatchObject({
        state: 'available', table: 'ordinary', tick: band.ordinary,
      });
    }
    expect(resolveTseTickV1('2025-01-06', ['topix_core30'], 50_000_001)).toMatchObject({ tick: 10_000 });
    expect(resolveTseTickV1('2025-01-06', ['other'], 50_000_001)).toMatchObject({ tick: 100_000 });
  });

  test('honors supported dates and the Mid400 regime boundary', () => {
    expect(resolveTseTickV1('2015-09-23', ['topix_core30'], 900)).toEqual({
      state: 'unavailable', reason: 'tick_rule_period_unsupported',
    });
    expect(resolveTseTickV1('2015-09-24', ['topix_core30'], 900)).toMatchObject({ table: 'fine' });
    expect(resolveTseTickV1('2015-09-24', ['topix_large70'], 900)).toMatchObject({ table: 'fine' });
    expect(resolveTseTickV1('2015-09-24', ['topix_mid400'], 900)).toMatchObject({ table: 'ordinary' });
    expect(resolveTseTickV1('2023-06-04', ['topix_mid400'], 900)).toMatchObject({ table: 'ordinary' });
    expect(resolveTseTickV1('2023-06-05', ['topix_mid400'], 900)).toMatchObject({ table: 'fine' });
    expect(resolveTseTickV1('2027-02-28', ['other'], 900)).toMatchObject({ table: 'ordinary' });
    expect(resolveTseTickV1('2027-03-01', ['other'], 900)).toEqual({
      state: 'unavailable', reason: 'tick_rule_period_unsupported',
    });
  });

  test('fails closed for missing, unknown, or contradictory category evidence', () => {
    for (const evidence of [[], ['unknown'], ['other', 'topix_core30']] as const) {
      expect(resolveTseTickV1('2025-01-06', evidence, 900)).toEqual({
        state: 'unavailable', reason: 'tick_category_unavailable',
      });
    }
    expect(resolveTseTickV1('2025-01-06', ['other', 'other'], 900)).toMatchObject({
      state: 'available', category: 'other',
    });
  });

  test('uses the submitted price band and exact decimal integer-multiple checks', () => {
    expect(isExecutableTsePriceV1('2025-01-06', ['topix_core30'], 1_000)).toMatchObject({
      tick: 0.1, executable: true,
    });
    expect(isExecutableTsePriceV1('2025-01-06', ['topix_core30'], 1_000.1)).toMatchObject({
      tick: 0.5, executable: false,
    });
    expect(isExecutableTsePriceV1('2025-01-06', ['topix_core30'], 1_000.5)).toMatchObject({
      tick: 0.5, executable: true,
    });
    expect(isExecutableTsePriceV1('2025-01-06', ['other'], 1_000.5)).toMatchObject({
      tick: 1, executable: false,
    });
  });

  test('finds the first executable quote strictly above a raw level across bands', () => {
    expect(nextTseQuoteAboveV1('2025-01-06', ['topix_core30'], 999.95)).toMatchObject({
      price: 1_000, tick: 0.1,
    });
    expect(nextTseQuoteAboveV1('2025-01-06', ['topix_core30'], 1_000)).toMatchObject({
      price: 1_000.5, tick: 0.5,
    });
    expect(nextTseQuoteAboveV1('2025-01-06', ['other'], 50_000_000)).toMatchObject({
      price: 50_100_000, tick: 100_000,
    });
  });
});
