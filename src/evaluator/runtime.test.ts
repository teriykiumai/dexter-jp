import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comparisonSnapshot } from '../analysis/comparison/test-fixtures.js';
import { buildEvidenceManifestV1 } from '../analysis/evaluation/manifest.js';
import { EvaluationRepository } from '../analysis/evaluation/repository.js';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/repository.js';
import {
  INITIAL_PROVIDER_BOUNDARY_V1,
  type QualifiedEvaluatorRuntimeV1,
} from './contracts.js';
import { EvaluatorProviderError } from './provider.js';
import {
  EvaluatorRunError,
  evaluatePersistedSnapshotV1,
} from './runtime.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function qualifiedRuntime(): QualifiedEvaluatorRuntimeV1 {
  return {
    qualityGateId: 'qg_v1_terra_high',
    gateManifestDigest: `sha256:${'1'.repeat(64)}`,
    gateAttestationDigest: `sha256:${'2'.repeat(64)}`,
    evaluatorSourceDigest: `sha256:${'3'.repeat(64)}`,
    dependencyManifestDigest: `sha256:${'4'.repeat(64)}`,
    gateEvaluatedCommitSha: 'a'.repeat(40),
    execution: {
      bunVersion: '1.3.14', bunRevision: '1.3.14+0d9b296af', platform: 'win32', arch: 'x64',
    },
    runtime: {
      providerId: 'openai', modelId: 'gpt-5.6-terra', taskProfile: 'deep_analysis',
      reasoningEffort: 'high', providerBoundary: INITIAL_PROVIDER_BOUNDARY_V1,
    },
    versions: {
      evaluatorSchemaVersion: 1, evidenceManifestVersion: 1, rubricVersion: 1,
      promptVersion: 1, safetyPolicyVersion: 1, goldSetVersion: 1,
    },
  };
}

async function repositories() {
  const root = await mkdtemp(join(tmpdir(), 'dexter-evaluator-runtime-'));
  directories.push(root);
  const snapshotRepository = new AnalysisSnapshotRepository(join(root, 'analysis'));
  const evaluationRoot = join(root, 'evaluations');
  const evaluationRepository = new EvaluationRepository(evaluationRoot, { snapshotRepository });
  const snapshot = comparisonSnapshot();
  const saved = await snapshotRepository.save(snapshot);
  return { root, snapshot, saved, snapshotRepository, evaluationRoot, evaluationRepository };
}

function successfulProviderResult() {
  return Promise.resolve({
    findings: [],
    tokenUsage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
    attemptCount: 1 as const,
  });
}

function runtimeDependencies() {
  const runtime = qualifiedRuntime();
  return {
    resolveQualifiedRuntime: async () => runtime,
    reverifyQualifiedRuntime: async (received: QualifiedEvaluatorRuntimeV1) => {
      expect(received).toEqual(runtime);
    },
    confirmExternalSend: async () => true,
    env: { OPENAI_API_KEY: 'test-openai-key' },
    invokeProvider: successfulProviderResult,
    createEvaluationId: () => '123e4567-e89b-42d3-a456-426614174000',
  };
}

async function directoryMissingOrEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path, { recursive: true })).length === 0;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}

describe('Evaluator runtime controller', () => {
  test('confirms, dispatches once, validates, and saves an available zero-finding sidecar', async () => {
    const state = await repositories();
    let confirmationSummary: unknown;
    let invocations = 0;
    const times = [Date.parse('2026-08-30T01:00:00.000Z'), Date.parse('2026-08-30T01:00:01.000Z')];
    const result = await evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      confirmExternalSend: async summary => {
        confirmationSummary = summary;
        return true;
      },
      invokeProvider: async () => {
        invocations += 1;
        return successfulProviderResult();
      },
      now: () => times.shift()!,
    });
    expect(invocations).toBe(1);
    expect(confirmationSummary).toMatchObject({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      baseUrl: 'https://api.openai.com/v1',
      httpRequestLimit: 1,
      externalSend: true,
      apiCostPossible: true,
    });
    expect(result.resultState).toBe('available');
    expect(result.sidecar.result).toEqual({ state: 'available', findings: [] });
    expect(await state.evaluationRepository.load(
      state.saved.canonicalTicker,
      state.saved.snapshotId,
      result.evaluationId,
    )).toEqual(result.sidecar);
  });

  test('resolves a unique exact provider excerpt before strict anchor validation', async () => {
    const state = await repositories();
    const manifest = buildEvidenceManifestV1(state.snapshot);
    const item = manifest.items.find(value => value.definitionKey === 'valuation.currentPrice');
    if (item === undefined) throw new Error('expected current-price evidence');
    const excerpt = state.snapshot.finalReportMarkdown.slice(0, 20);
    expect(state.snapshot.finalReportMarkdown.indexOf(excerpt, 1)).toBe(-1);
    const times = [Date.parse('2026-08-30T01:00:00.000Z'), Date.parse('2026-08-30T01:00:01.000Z')];
    const result = await evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      invokeProvider: async () => ({
        findings: [{
          category: 'unclear_reasoning',
          claimDomains: ['valuation_metrics'],
          summary: '利用可能な根拠から結論への説明が不足しています。',
          importance: 'material',
          location: { kind: 'single_anchor', anchor: { start: 1, end: 2, excerpt } },
          basis: {
            kind: 'available_fact_refs',
            refs: [{ itemId: item.itemId, factKey: 'value' }],
          },
        }],
        tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        attemptCount: 1,
      }),
      now: () => times.shift()!,
    });
    expect(result.sidecar.result).toMatchObject({
      state: 'available',
      findings: [{
        location: { kind: 'single_anchor', anchor: { start: 0, end: excerpt.length, excerpt } },
      }],
    });
  });

  test('default-No confirmation creates no sidecar and makes no provider call', async () => {
    const state = await repositories();
    let calls = 0;
    await expect(evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      confirmExternalSend: async () => false,
      invokeProvider: async () => {
        calls += 1;
        return successfulProviderResult();
      },
    })).rejects.toMatchObject({ code: 'external_send_not_confirmed' });
    expect(calls).toBe(0);
    expect(await directoryMissingOrEmpty(state.evaluationRoot)).toBe(true);
  });

  test('post-dispatch provider/schema failure creates one sanitized unavailable sidecar', async () => {
    const state = await repositories();
    const times = [Date.parse('2026-08-30T01:00:00.000Z'), Date.parse('2026-08-30T01:00:01.000Z')];
    const result = await evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      invokeProvider: async () => {
        throw new EvaluatorProviderError('output_schema_invalid', 1);
      },
      now: () => times.shift()!,
    });
    expect(result.sidecar.result).toEqual({
      state: 'unavailable',
      code: 'output_schema_invalid',
      message: 'The Evaluator output did not match the required schema.',
      findings: [],
    });
    expect(result.sidecar.tokenUsage).toEqual({
      inputTokens: null, outputTokens: null, totalTokens: null,
    });
  });

  test('keeps returned usage when local evidence-reference validation fails', async () => {
    const state = await repositories();
    const excerpt = state.snapshot.finalReportMarkdown.slice(0, 2);
    const times = [Date.parse('2026-08-30T01:00:00.000Z'), Date.parse('2026-08-30T01:00:01.000Z')];
    const result = await evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      invokeProvider: async () => ({
        findings: [{
          category: 'unclear_reasoning',
          claimDomains: ['valuation_metrics'],
          summary: '参照は構文上のみ有効です。',
          importance: 'material',
          location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt } },
          basis: {
            kind: 'available_fact_refs',
            refs: [{ itemId: 'e_000000000000000000000000', factKey: 'value' }],
          },
        }],
        tokenUsage: { inputTokens: 101, outputTokens: 6, totalTokens: 107 },
        attemptCount: 1,
      }),
      now: () => times.shift()!,
    });
    expect(result.sidecar.result).toMatchObject({
      state: 'unavailable', code: 'evidence_reference_invalid', findings: [],
    });
    expect(result.sidecar.tokenUsage).toEqual({
      inputTokens: 101, outputTokens: 6, totalTokens: 107,
    });
  });

  test('cancellation wins after a late provider result and creates no sidecar', async () => {
    const state = await repositories();
    const controller = new AbortController();
    await expect(evaluatePersistedSnapshotV1({
      ticker: state.saved.canonicalTicker,
      snapshotId: state.saved.snapshotId,
      selectedModel: 'gpt-5.6-terra',
      signal: controller.signal,
    }, {
      ...runtimeDependencies(),
      snapshotRepository: state.snapshotRepository,
      evaluationRepository: state.evaluationRepository,
      invokeProvider: async () => {
        controller.abort();
        return successfulProviderResult();
      },
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await directoryMissingOrEmpty(state.evaluationRoot)).toBe(true);
  });

  test('save-after-dispatch failure warns that cost may have occurred', async () => {
    const state = await repositories();
    const times = [Date.parse('2026-08-30T01:00:00.000Z'), Date.parse('2026-08-30T01:00:01.000Z')];
    const failingRepository = {
      save: async () => { throw new Error('private path must not escape'); },
    } as unknown as EvaluationRepository;
    try {
      await evaluatePersistedSnapshotV1({
        ticker: state.saved.canonicalTicker,
        snapshotId: state.saved.snapshotId,
        selectedModel: 'gpt-5.6-terra',
      }, {
        ...runtimeDependencies(),
        snapshotRepository: state.snapshotRepository,
        evaluationRepository: failingRepository,
        now: () => times.shift()!,
      });
      throw new Error('Expected save failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(EvaluatorRunError);
      expect(error).toMatchObject({ code: 'save_after_cost_failure', costMayHaveOccurred: true });
      expect((error as Error).message).not.toContain('private path');
    }
  });

  test('configured credential in the stored report fails before confirmation or dispatch', async () => {
    const snapshot = { ...comparisonSnapshot(), finalReportMarkdown: '秘密 test-openai-key' };
    let confirmations = 0;
    let invocations = 0;
    const snapshotRepository = {
      loadHistory: async () => snapshot,
    } as unknown as AnalysisSnapshotRepository;
    await expect(evaluatePersistedSnapshotV1({
      ticker: snapshot.canonicalTicker,
      snapshotId: '2026-08-22T01-00-00-000Z',
      selectedModel: 'gpt-5.6-terra',
    }, {
      ...runtimeDependencies(),
      snapshotRepository,
      confirmExternalSend: async () => {
        confirmations += 1;
        return true;
      },
      invokeProvider: async () => {
        invocations += 1;
        return successfulProviderResult();
      },
    })).rejects.toMatchObject({
      code: 'artifact_safety_failure', safetyCode: 'credential_value_detected',
    });
    expect(confirmations).toBe(0);
    expect(invocations).toBe(0);
  });
});
