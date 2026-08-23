import { describe, expect, test } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { DEFAULT_MODEL, getChatModel } from './llm.js';
import { getDefaultModelForProvider } from '../utils/model.js';

describe('OpenAI model transport', () => {
  test('uses the same Terra default in model selection and agent calls', () => {
    expect(DEFAULT_MODEL).toBe('gpt-5.6-terra');
    expect(getDefaultModelForProvider('openai')).toBe(DEFAULT_MODEL);
  });

  test('uses the Responses API for GPT-5.6 without changing existing models', () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      const terra = getChatModel('gpt-5.6-terra') as ChatOpenAI;
      const existing = getChatModel('gpt-5.5') as ChatOpenAI;

      expect(terra.useResponsesApi).toBeTrue();
      expect(existing.useResponsesApi).toBeFalse();
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
    }
  });
});
