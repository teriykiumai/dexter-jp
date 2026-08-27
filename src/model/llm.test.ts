import { describe, expect, test } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Runnable } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import {
  configureLlmRunnable,
  DEFAULT_MODEL,
  getChatModel,
  resolveLlmRuntime,
  resolveReasoningEffort,
} from './llm.js';
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
      const future = getChatModel('gpt-5.6-future') as ChatOpenAI;
      const existing = getChatModel('gpt-5.5') as ChatOpenAI;

      expect(terra.useResponsesApi).toBeTrue();
      expect(terra.reasoning).toBeUndefined();
      expect(future.useResponsesApi).toBeTrue();
      expect(future.reasoning).toBeUndefined();
      expect(existing.useResponsesApi).toBeFalse();
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
    }
  });
});

describe('task-aware LLM runtime profiles', () => {
  test('preserves legacy behavior when taskProfile is undefined', () => {
    const runtime = resolveLlmRuntime('gpt-5.6-terra');

    expect(runtime).toEqual({ model: 'gpt-5.6-terra', providerId: 'openai' });
    expect(runtime.reasoningEffort).toBeUndefined();
    expect(Object.isFrozen(runtime)).toBeTrue();
  });

  test('keeps the selected model for deep and balanced profiles', () => {
    expect(resolveLlmRuntime('gpt-5.6-terra', 'deep_analysis')).toEqual({
      model: 'gpt-5.6-terra',
      providerId: 'openai',
      reasoningEffort: 'high',
    });
    expect(resolveLlmRuntime('gpt-5.6-luna', 'balanced')).toEqual({
      model: 'gpt-5.6-luna',
      providerId: 'openai',
      reasoningEffort: 'medium',
    });
    expect(resolveLlmRuntime('claude-sonnet-4-6', 'deep_analysis')).toEqual({
      model: 'claude-sonnet-4-6',
      providerId: 'anthropic',
    });
  });

  test('uses provider fastModel and filters capability after model selection', () => {
    expect(resolveLlmRuntime('gpt-5.6-terra', 'fast_structured')).toEqual({
      model: 'gpt-5.6-luna',
      providerId: 'openai',
      reasoningEffort: 'low',
    });
    expect(resolveLlmRuntime('claude-sonnet-4-6', 'fast_structured')).toEqual({
      model: 'claude-haiku-4-5',
      providerId: 'anthropic',
    });
  });

  test('falls back to the selected model when the provider has no fastModel', () => {
    expect(resolveLlmRuntime('ollama:qwen3', 'fast_structured')).toEqual({
      model: 'ollama:qwen3',
      providerId: 'ollama',
    });
  });

  test('uses an explicit GPT-5.6 capability allowlist', () => {
    expect(resolveReasoningEffort('gpt-5.6', 'openai', 'fast_structured')).toBe('low');
    expect(resolveReasoningEffort('gpt-5.6-sol', 'openai', 'deep_analysis')).toBe('high');
    expect(resolveReasoningEffort('gpt-5.6-terra', 'openai', 'balanced')).toBe('medium');
    expect(resolveReasoningEffort('gpt-5.6-preview', 'openai', 'deep_analysis')).toBeUndefined();
    expect(resolveReasoningEffort('gpt-5.6-terra', 'openrouter', 'deep_analysis')).toBeUndefined();
    expect(resolveReasoningEffort('gpt-5.6-terra', 'openai')).toBeUndefined();
  });

  test('propagates GPT-5.6 effort without sending it to unsupported providers', () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousXaiKey = process.env.XAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.XAI_API_KEY = 'test-key';

    try {
      const openai = getChatModel(
        resolveLlmRuntime('gpt-5.6-terra', 'deep_analysis'),
      ) as ChatOpenAI;
      const xai = getChatModel(
        resolveLlmRuntime('grok-4', 'deep_analysis'),
      ) as ChatOpenAI;

      expect(openai.reasoning).toEqual({ effort: 'high' });
      expect(xai.reasoning).toBeUndefined();
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousXaiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousXaiKey;
    }
  });

  test('preserves DeepSeek V4 thinking configuration', () => {
    const previousApiKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-key';

    try {
      const pro = getChatModel(
        resolveLlmRuntime('deepseek-v4-pro', 'balanced'),
      ) as ChatOpenAI & {
        fields: {
          reasoning_effort?: string;
          extraBody?: { thinking?: { type?: string } };
        };
      };
      const flash = getChatModel(
        resolveLlmRuntime('deepseek-v4-pro', 'fast_structured'),
      ) as typeof pro;

      expect(pro.fields.reasoning_effort).toBe('high');
      expect(pro.fields.extraBody).toEqual({ thinking: { type: 'enabled' } });
      expect(pro.reasoning).toBeUndefined();
      expect(flash.model).toBe('deepseek-v4-flash');
      expect(flash.fields.reasoning_effort).toBe('high');
      expect(flash.fields.extraBody).toEqual({ thinking: { type: 'enabled' } });
    } finally {
      if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousApiKey;
    }
  });
});

describe('LLM runnable configuration', () => {
  test('preserves structured output precedence over tool binding', () => {
    const structuredRunnable = { kind: 'structured' } as unknown as Runnable<unknown, unknown>;
    const toolsRunnable = { kind: 'tools' } as unknown as Runnable<unknown, unknown>;
    let structuredCalls = 0;
    let toolCalls = 0;
    const llm = {
      withStructuredOutput: () => {
        structuredCalls++;
        return structuredRunnable;
      },
      bindTools: () => {
        toolCalls++;
        return toolsRunnable;
      },
    } as unknown as BaseChatModel;

    const runnable = configureLlmRunnable(
      llm,
      z.object({ value: z.string() }),
      [{} as StructuredToolInterface],
    );

    expect(runnable).toBe(structuredRunnable);
    expect(structuredCalls).toBe(1);
    expect(toolCalls).toBe(0);
  });

  test('preserves tool binding when no output schema is supplied', () => {
    const toolsRunnable = { kind: 'tools' } as unknown as Runnable<unknown, unknown>;
    const llm = {
      bindTools: () => toolsRunnable,
    } as unknown as BaseChatModel;

    expect(configureLlmRunnable(llm, undefined, [{} as StructuredToolInterface])).toBe(
      toolsRunnable,
    );
  });
});
