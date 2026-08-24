import { describe, expect, test } from 'bun:test';
import { resolveLlmRuntime, type ResolvedLlmRuntime } from '../model/llm.js';
import { withStreamingFallback } from './streaming-fallback.js';

describe('withStreamingFallback', () => {
  test('shares one resolved runtime object with streaming and blocking fallback', async () => {
    let resolveCount = 0;
    const runtime = (() => {
      resolveCount++;
      return resolveLlmRuntime('gpt-5.6-terra', 'deep_analysis');
    })();
    let streamingRuntime: ResolvedLlmRuntime | undefined;
    let blockingRuntime: ResolvedLlmRuntime | undefined;

    const iterator = withStreamingFallback(
      runtime,
      async function* (resolvedRuntime) {
        streamingRuntime = resolvedRuntime;
        yield 'progress';
        throw new Error('stream unavailable');
      },
      async (resolvedRuntime) => {
        blockingRuntime = resolvedRuntime;
        return 'blocking result';
      },
    );

    expect(await iterator.next()).toEqual({ value: 'progress', done: false });
    expect(await iterator.next()).toEqual({ value: 'blocking result', done: true });
    expect(resolveCount).toBe(1);
    expect(streamingRuntime).toBe(runtime);
    expect(blockingRuntime).toBe(runtime);
  });
});
