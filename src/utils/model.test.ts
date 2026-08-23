import { describe, expect, test } from 'bun:test';
import {
  getDefaultModelForProvider,
  getModelDisplayName,
  getModelsForProvider,
} from './model.js';

describe('OpenAI model selection', () => {
  test('lists the current GPT-5.6 family before existing models', () => {
    expect(getModelsForProvider('openai')).toEqual([
      { id: 'gpt-5.6-terra', displayName: 'GPT 5.6 Terra' },
      { id: 'gpt-5.6-luna', displayName: 'GPT 5.6 Luna' },
      { id: 'gpt-5.6-sol', displayName: 'GPT 5.6 Sol' },
      { id: 'gpt-5.5', displayName: 'GPT 5.5' },
      { id: 'gpt-5.4', displayName: 'GPT 5.4' },
      { id: 'gpt-4.1', displayName: 'GPT 4.1' },
    ]);
    expect(getDefaultModelForProvider('openai')).toBe('gpt-5.6-terra');
    expect(getModelDisplayName('gpt-5.6-terra')).toBe('GPT 5.6 Terra');
  });
});
