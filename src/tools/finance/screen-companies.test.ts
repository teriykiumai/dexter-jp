import { describe, expect, test } from 'bun:test';
import { normalizeScreenerConditions } from './screen-companies.js';

describe('normalizeScreenerConditions', () => {
  test('preserves explicit screening conditions', () => {
    const input = {
      conditions: [{ metric: 'roe', operator: 'gte' as const, value: 10 }],
      industry: '輸送用機器',
      limit: 10,
    };

    expect(normalizeScreenerConditions(input)).toEqual(input);
  });

  test('adds a neutral revenue condition for an industry-only screen', () => {
    expect(normalizeScreenerConditions({
      conditions: [],
      industry: '輸送用機器',
    })).toEqual({
      conditions: [{ metric: 'revenue', operator: 'gte', value: 0 }],
      industry: '輸送用機器',
    });
  });
});
