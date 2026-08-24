import type { ResolvedLlmRuntime } from '../model/llm.js';

/**
 * Share one resolved runtime between a streaming attempt and its blocking fallback.
 */
export async function* withStreamingFallback<TEvent, TResult>(
  runtime: ResolvedLlmRuntime,
  stream: (resolvedRuntime: ResolvedLlmRuntime) => AsyncGenerator<TEvent, TResult>,
  block: (resolvedRuntime: ResolvedLlmRuntime) => Promise<TResult>,
): AsyncGenerator<TEvent, TResult> {
  try {
    return yield* stream(runtime);
  } catch {
    return await block(runtime);
  }
}
