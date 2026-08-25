import { afterEach, describe, expect, test } from 'bun:test';
import { clearSkillCache, discoverSkills, getSkill } from './index.js';
import { skillTool } from '../tools/skill.js';
import { buildSystemPrompt } from '../agent/prompts.js';

afterEach(() => clearSkillCache());

describe('MVP analysis skill', () => {
  test('is discoverable with instructions for every deterministic engine tool', async () => {
    clearSkillCache();
    expect(discoverSkills().map((skill) => skill.name)).toContain('mvp-analysis');

    const skill = getSkill('mvp-analysis');
    expect(skill?.source).toBe('builtin');
    for (const toolName of [
      'analyze_financial_metrics',
      'analyze_technical',
      'analyze_supply_demand',
      'analyze_peer_comparison',
      'analyze_market_correlation',
      'analyze_strategy',
    ]) {
      expect(skill?.instructions).toContain(toolName);
    }

    const invoked = await skillTool.invoke({
      skill: 'mvp-analysis',
      args: '7203 technical analysis',
    });
    expect(invoked).toContain('## Skill: mvp-analysis');
    expect(invoked).toContain('7203 technical analysis');
  });
});

describe('comprehensive analysis skill', () => {
  test('is discoverable and fixes the complete MVP workflow contract', async () => {
    clearSkillCache();
    expect(discoverSkills().map((skill) => skill.name)).toContain('comprehensive-analysis');

    const skill = getSkill('comprehensive-analysis');
    expect(skill?.source).toBe('builtin');
    for (const toolName of [
      'get_financials',
      'company_screener',
      'get_stock_price',
      'get_margin_data',
      'get_topix',
      'analyze_financial_metrics',
      'analyze_technical',
      'analyze_supply_demand',
      'analyze_reported_short_positions',
      'analyze_peer_comparison',
      'analyze_market_correlation',
      'analyze_strategy',
    ]) {
      expect(skill?.instructions).toContain(toolName);
    }

    for (const heading of [
      '# Summary',
      '# Data Dates',
      '# Fundamental',
      '# Valuation',
      '# Peer Comparison',
      '# Technical',
      '# Supply & Demand',
      '# Reported Short Positions',
      '# Market Correlation',
      '# Entry / Stop / Target',
      '# Bull / Base / Bear',
      '# Risks',
      '# Conclusion',
    ]) {
      expect(skill?.instructions).toContain(heading);
    }

    expect(skill?.instructions).toContain('may not create prices');
    expect(skill?.instructions).toContain('Missing-data audit');
    expect(skill?.instructions).toContain('0.5% or more');
    expect(skill?.instructions).toContain('neither total market short interest');
    expect(skill?.instructions).toContain('margin-interest selling');
    expect(skill?.instructions).toContain('balance');
    expect(skill?.instructions).toContain('Do not aggregate');
    expect(skill?.instructions).toContain('no qualifying public');
    expect(skill?.instructions).toContain('report was obtained');
    expect(skill?.instructions).toContain('Do not derive a short-squeeze threshold');
    expect(skill?.instructions).toContain('Buy/Sell signal');
    expect(skill?.instructions).toContain('Missing or unavailable report data');
    expect(skill?.instructions).toContain('support an investment claim');
    expect(skill?.instructions).toContain('disclosedDate');
    expect(skill?.instructions).toContain('calculatedDate');

    const invoked = await skillTool.invoke({
      skill: 'comprehensive-analysis',
      args: '7203を分析して',
    });
    expect(invoked).toContain('## Skill: comprehensive-analysis');
    expect(invoked).toContain('7203を分析して');
  });

  test('advertises broad analysis routing to the standard agent', () => {
    clearSkillCache();
    const prompt = buildSystemPrompt('gpt-5.5');

    expect(prompt).toContain('**comprehensive-analysis**');
    expect(prompt).toContain('7203を分析して');
    expect(prompt).toContain('rather than a single metric');
  });
});
