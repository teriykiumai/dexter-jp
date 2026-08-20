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
    expect(prompt).toContain('# Data Dates');
    expect(prompt).toContain('# Bull / Base / Bear');
    expect(prompt).toContain('may not create prices');
  });
});
