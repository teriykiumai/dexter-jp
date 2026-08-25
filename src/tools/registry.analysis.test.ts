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
});
