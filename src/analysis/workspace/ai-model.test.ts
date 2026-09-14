import { expect, test } from 'bun:test';
import { invokeWorkspaceAi, AI_MAX_OUTPUT_TOKENS } from './ai-model.js';
import { syntheticAiInput, syntheticAiOutput } from './ai-test-fixtures.js';
import { validateInterpretation, validateAiResult, aiAsOf } from './ai-objects.js';
import { AiInputSchema } from './ai-contracts.js';

test('AI SDK sends one bounded tool-free Responses request and does not retry transient failures', async () => {
  const previousFetch = globalThis.fetch, key = process.env.OPENAI_API_KEY, input = syntheticAiInput();
  process.env.OPENAI_API_KEY = 'synthetic-key';
  let calls = 0, fail = false, incomplete = false;
  globalThis.fetch = (async (target, init) => {
    calls++; expect(String(target)).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe(input.runtime.model); expect(body.max_output_tokens).toBe(AI_MAX_OUTPUT_TOKENS);
    expect(body.tools ?? []).toEqual([]); expect(body.store).toBe(false); expect(body.stream).toBe(false);
    expect(JSON.stringify(body.input.filter((message: { role: string }) => message.role === 'user'))).not.toMatch(/drawings|peerComparison|synthetic-key/);
    if (fail) return Response.json({ error: { message: 'Synthetic unavailable', type: 'server_error' } }, { status: 503 });
    return Response.json({ id: 'resp_synthetic', object: 'response', created_at: 1, status: incomplete ? 'incomplete' : 'completed', model: input.runtime.model,
      output: [{ type: 'message', id: 'msg_synthetic', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(syntheticAiOutput(input)), annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
  }) as typeof fetch;
  try {
    expect(await invokeWorkspaceAi(input, new AbortController().signal)).toEqual(syntheticAiOutput(input)); expect(calls).toBe(1);
    fail = true; await expect(invokeWorkspaceAi(input, new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(2);
    fail = false; incomplete = true; await expect(invokeWorkspaceAi(input, new AbortController().signal)).rejects.toThrow('invalid_result'); expect(calls).toBe(3);
  } finally { globalThis.fetch = previousFetch; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
}, 15_000);

test('AI contracts reject cross-profile citations, new numeric prose, unknown fields and foreign result ownership', () => {
  const input = syntheticAiInput(), output = syntheticAiOutput(input);
  expect(AiInputSchema.safeParse(input).success).toBe(true);
  expect(AiInputSchema.safeParse({ ...input, drawings: [] }).success).toBe(false);
  expect(AiInputSchema.safeParse({ ...input, profile: 'peer' }).success).toBe(false);
  for (const text of ['値は123', '値は９９', '値はⅨ']) expect(() => validateInterpretation(input, { ...output, observations: [{ text, sources: ['financial'] }] })).toThrow();
  expect(() => validateInterpretation(input, { ...output, observations: [{ text: '業種データ', sources: ['sector_short'] }] })).toThrow();
  expect(() => validateInterpretation(input, { ...output, score: 99 })).toThrow();
  const ref = { path: 'input.json', codec: input.version, digest: `sha256:${'1'.repeat(64)}` };
  const run = { version: 'analysis_run_artifact_v1' as const, runId: input.runId, instrumentId: input.selection.identity.instrumentId, profile: input.profile,
    profileVersion: input.profileVersion, input: ref, createdAt: input.createdAt, completedAt: input.createdAt, runtime: input.runtime, asOf: aiAsOf(input), interpretation: output };
  expect(validateAiResult(input, ref, run)).toEqual(run);
  expect(() => validateAiResult(input, ref, { ...run, instrumentId: input.runId })).toThrow();
  expect(() => validateAiResult(input, ref, { ...run, asOf: [] })).toThrow();
});
