import type { AiModel } from './ai-model.js';
import type { AiInput, AiInterpretation } from './ai-contracts.js';
export function syntheticAiOutput(input: AiInput): AiInterpretation {
  const source = input.profile === 'fundamental' ? 'financial' : 'sector_short';
  return { observations: [{ text: '保存された開示データを確認できます。', sources: [source] }],
    limitations: [{ text: '保存された範囲に限る解釈です。未確認の情報は判断できません。', sources: [source] }] };
}
export function syntheticAiModel(invoke: AiModel['invoke'] = async input => syntheticAiOutput(input)): AiModel {
  return { runtime: { providerId: 'openai', model: 'synthetic-model' }, configured: () => true, invoke };
}
/** Transport/schema fixture only; never registered as identity/source evidence. */
export function syntheticAiInput(): AiInput {
  const instrumentId = '00000000-0000-4000-8000-000000000001';
  return { version: 'workspace_ai_input_v1', runId: '00000000-0000-4000-8000-000000000002', createdAt: '2026-09-11T09:00:00.000Z',
    profile: 'fundamental', profileVersion: 'saved_interpretation_v1', runtime: { providerId: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
    selection: { identity: { instrumentId, provider: 'jquants', code: '72030', mappingRevision: 1, catalogGeneration: 1 },
      master: { path: 'synthetic.json', codec: 'workspace_episode_v1', digest: `sha256:${'0'.repeat(64)}` },
      financial: null, technical: null, margin: null, issuer_short: null, sector_short: null },
    data: { schemaVersion: 'workspace_financial_view_v1', instrumentId, state: 'not_collected', through: null, checkedAt: null,
      artifactDigest: null, note: '合成テスト用。保存済み財務データなし。', rows: [], projection: null } };
}
