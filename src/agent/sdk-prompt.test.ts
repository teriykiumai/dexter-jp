import { describe, expect, test } from 'bun:test';
import { clearSkillCache } from '../skills/index.js';
import { buildSdkAgentSystemPrompt } from './sdk-prompt.js';

describe('SDK comprehensive analysis prompt', () => {
  test('embeds the bundled workflow without enabling the SDK Skill tool', async () => {
    clearSkillCache();
    const prompt = await buildSdkAgentSystemPrompt('claude-fable-5');

    expect(prompt).toContain('## Comprehensive analysis workflow');
    expect(prompt).toContain('The SDK Skill tool is intentionally disabled');
    expect(prompt).toContain('get_company_info');
    expect(prompt).toContain('analyze_strategy');
    expect(prompt).toContain('analyze_reported_short_positions');
    expect(prompt).toContain('analyze_investor_type_flows');
    expect(prompt).toContain('0.5% or more');
    expect(prompt).toContain('neither total market short interest');
    expect(prompt).toContain('TokyoNagoya');
    expect(prompt).toContain('publication lag');
    expect(prompt).toContain('evidence that an investor category');
    expect(prompt).toContain('reclassify, merge, or aggregate categories');
    expect(prompt).toContain('recalculate or repair source');
    expect(prompt).toContain('crowding score');
    expect(prompt).toContain('risk-on/off');
    expect(prompt).toContain('# Data Dates');
    expect(prompt).toContain('# Bull / Base / Bear');
    expect(prompt).toContain('may not create prices');
  });
});
