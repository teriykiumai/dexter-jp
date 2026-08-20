import { afterEach, describe, expect, test } from 'bun:test';
import { clearSkillCache, discoverSkills, getSkill } from './index.js';
import { skillTool } from '../tools/skill.js';

afterEach(() => clearSkillCache());

describe('MVP analysis skill', () => {
  test('is discoverable with instructions for every deterministic engine tool', async () => {
    clearSkillCache();
    expect(discoverSkills().map((skill) => skill.name)).toContain('mvp-analysis');

    const skill = getSkill('mvp-analysis');
    expect(skill?.source).toBe('builtin');
    for (const toolName of [
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
