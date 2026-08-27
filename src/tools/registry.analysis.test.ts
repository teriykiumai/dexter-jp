import { describe, expect, test } from 'bun:test';
import { getToolRegistry } from './registry.js';

const ANALYSIS_TOOL_NAMES = [
  'analyze_financial_metrics',
  'analyze_technical',
  'analyze_supply_demand',
  'analyze_advanced_dividend',
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

  test('exposes the dividend raw sources only when J-Quants is configured', () => {
    const originalApiKey = process.env.JQUANTS_API_KEY;
    process.env.JQUANTS_API_KEY = 'test-key';
    try {
      const registry = getToolRegistry('gpt-5.5');
      const summary = registry.find(({ name }) => name === 'get_dividend_summary');
      const events = registry.find(({ name }) => name === 'get_dividend_events');

      expect(summary?.concurrencySafe).toBe(true);
      expect(summary?.tool.name).toBe('get_dividend_summary');
      expect(events?.concurrencySafe).toBe(true);
      expect(events?.tool.name).toBe('get_dividend_events');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.JQUANTS_API_KEY;
      } else {
        process.env.JQUANTS_API_KEY = originalApiKey;
      }
    }
  });
});
