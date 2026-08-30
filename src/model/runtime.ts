import { getProviderById, resolveProvider, type ProviderDef } from '../providers.js';

export const DEFAULT_PROVIDER = 'openai';
export const DEFAULT_MODEL = 'gpt-5.6-terra';

export type LlmTaskProfile = 'deep_analysis' | 'balanced' | 'fast_structured';
export type LlmReasoningEffort = 'low' | 'medium' | 'high';

export type ResolvedLlmRuntime = Readonly<{
  model: string;
  providerId: string;
  reasoningEffort?: LlmReasoningEffort;
}>;

const OPENAI_GPT_5_6_REASONING_MODELS = new Set([
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
]);

const OPENAI_REASONING_EFFORT_BY_PROFILE: Record<LlmTaskProfile, LlmReasoningEffort> = {
  deep_analysis: 'high',
  balanced: 'medium',
  fast_structured: 'low',
};

/** Resolve provider-neutral task intent into one immutable LLM runtime. */
export function resolveLlmRuntime(
  selectedModel: string = DEFAULT_MODEL,
  taskProfile?: LlmTaskProfile,
): ResolvedLlmRuntime {
  const selectedProvider = resolveProvider(selectedModel);
  const model = taskProfile === 'fast_structured'
    ? selectedProvider.fastModel ?? selectedModel
    : selectedModel;
  const provider = resolveProvider(model);
  const reasoningEffort = resolveReasoningEffort(model, provider.id, taskProfile);

  return Object.freeze({
    model,
    providerId: provider.id,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });
}

export function resolveReasoningEffort(
  effectiveModel: string,
  effectiveProviderId: string,
  taskProfile?: LlmTaskProfile,
): LlmReasoningEffort | undefined {
  if (
    taskProfile === undefined
    || effectiveProviderId !== 'openai'
    || !OPENAI_GPT_5_6_REASONING_MODELS.has(effectiveModel)
  ) {
    return undefined;
  }
  return OPENAI_REASONING_EFFORT_BY_PROFILE[taskProfile];
}

export function getResolvedProvider(runtime: ResolvedLlmRuntime): ProviderDef {
  const provider = getProviderById(runtime.providerId);
  if (!provider) {
    throw new Error(`[LLM] Unknown provider: ${runtime.providerId}`);
  }
  return provider;
}
