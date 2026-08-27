import { describe, expect, test } from 'bun:test';

const skill = await Bun.file(new URL('./SKILL.md', import.meta.url)).text();

describe('comprehensive-analysis Advanced Dividend contract', () => {
  test('requires the deterministic tool and a dedicated report section', () => {
    expect(skill).toContain('`analyze_advanced_dividend`');
    expect(skill).toContain('- [ ] Advanced dividend analysis');
    expect(skill).toContain('# Advanced Dividend');
    expect(skill.indexOf('# Valuation')).toBeLessThan(skill.indexOf('# Advanced Dividend'));
    expect(skill.indexOf('# Advanced Dividend')).toBeLessThan(skill.indexOf('# Peer Comparison'));
  });

  test('separates yield, amount, ratio, actual/forecast, and event components', () => {
    expect(skill).toContain('current-price dividend yield');
    expect(skill).toMatch(/annual\s+JPY-per-share amounts/);
    expect(skill).toContain('source payout ratios');
    expect(skill).toContain('`actual` and `company_forecast`');
    expect(skill).toContain('ordinary, commemorative, and special components');
  });

  test('forbids recalculation, aggregation, missing-policy inference, and signals', () => {
    expect(skill).toContain('do not aggregate interim and fiscal-year-end events');
    expect(skill).toContain('does not mean zero, no event,\nor ordinary-only');
    expect(skill).toContain('Do not calculate forecast yield');
    expect(skill).toContain('score, threshold, Entry/Stop/Target, or Buy/Sell signal');
  });
});
