import { describe, expect, test } from 'bun:test';
import { getToolRegistry } from './registry.js';

const ANALYSIS_TOOL_NAMES = [
  'analyze_financial_metrics',
  'analyze_technical',
  'analyze_supply_demand',
  'analyze_reported_short_positions',
  'analyze_investor_type_flows',
  'analyze_peer_comparison',
  'analyze_market_correlation',
  'analyze_sector_benchmark',
  'analyze_sector_short_ratio',
  'analyze_strategy',
];

describe('analysis tool registry', () => {
  test('exposes every deterministic MVP engine to the standard agent', () => {
    const registry = getToolRegistry('gpt-5.5');
    const names = registry.map((entry) => entry.name);

    for (const name of ANALYSIS_TOOL_NAMES) {
      expect(names).toContain(name);
      expect(registry.find((entry) => entry.name === name)?.concurrencySafe).toBe(true);
    }
  });

  test('exposes the dividend-summary source only when J-Quants is configured', () => {
    const originalApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-key';
    try {
      const registry = getToolRegistry('gpt-5.5');
      const entry = registry.find(({ name }) => name === 'get_dividend_summary');

      expect(entry?.concurrencySafe).toBe(true);
      expect(entry?.tool.name).toBe('get_dividend_summary');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.JQUANTS_API_KEY;
      } else {
        process.env.JQUANTS_API_KEY = originalApiKey;
      }
    }
  });
});
