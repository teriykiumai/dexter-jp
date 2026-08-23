import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Agent } from '../agent/agent.js';
import type { AgentEvent, DoneEvent } from '../agent/types.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import { AgentRunnerController } from './agent-runner.js';

let nextOutcome: DoneEvent['outcome'] = 'success';

class SnapshotMockAgent {
  async *run(): AsyncGenerator<AgentEvent> {
    yield {
      type: 'tool_start',
      tool: 'skill',
      toolCallId: 'skill-1',
      args: { skill: 'comprehensive-analysis', args: '7203' },
    };
    yield {
      type: 'tool_end',
      tool: 'skill',
      toolCallId: 'skill-1',
      args: {},
      result: '## Skill: comprehensive-analysis',
      duration: 1,
    };
    yield {
      type: 'tool_start',
      tool: 'get_financials',
      toolCallId: 'financials-1',
      args: { query: '7203の会社情報' },
    };
    yield {
      type: 'tool_end',
      tool: 'get_financials',
      toolCallId: 'financials-1',
      args: {},
      result: JSON.stringify({
        data: {
          get_company_info_7203: {
            sec_code: '72030',
            name_ja: 'トヨタ自動車株式会社',
            industry: '輸送用機器',
            listing_status: 'listed',
            is_delisted: false,
            listing_status_as_of: '2026-08-21',
          },
        },
        sourceUrls: ['https://example.test/company'],
      }),
      duration: 1,
    };
    yield {
      type: 'done',
      outcome: nextOutcome,
      answer: '# Analysis',
      toolCalls: [],
      iterations: 1,
      totalTime: 10,
    };
  }
}

function createController(): AgentRunnerController {
  return new AgentRunnerController(
    { model: 'gpt-5.5', modelProvider: 'openai', maxIterations: 10 },
    new InMemoryChatHistory('gpt-5.5'),
  );
}

describe('AgentRunnerController snapshot finalization', () => {
  beforeEach(() => {
    nextOutcome = 'success';
    spyOn(Agent, 'create').mockResolvedValue(new SnapshotMockAgent() as unknown as Agent);
    spyOn(InMemoryChatHistory.prototype, 'saveAnswer').mockResolvedValue(undefined);
  });

  afterEach(() => {
    mock.restore();
  });

  test('returns a partial snapshot after a normally completed comprehensive run', async () => {
    const result = await createController().runQuery('7203を総合分析して');

    expect(result?.snapshot).toMatchObject({
      status: 'partial',
      canonicalTicker: '7203',
      companyName: 'トヨタ自動車株式会社',
    });
  });

  test('does not create a snapshot for an interrupted or failed terminal outcome', async () => {
    nextOutcome = 'interrupted';
    const interrupted = await createController().runQuery('7203を総合分析して');
    nextOutcome = 'error';
    const failed = await createController().runQuery('7203を総合分析して');

    expect(interrupted?.snapshot).toBeUndefined();
    expect(failed?.snapshot).toBeUndefined();
  });
});
