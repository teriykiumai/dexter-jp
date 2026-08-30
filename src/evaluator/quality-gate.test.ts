import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../analysis/snapshot/canonical-json.js';
import {
  INITIAL_PROVIDER_BOUNDARY_V1,
  type GoldGateMetricsV1,
  type QualityGateAttestationV1,
  type QualityGateManifestV1,
} from './contracts.js';
import { digestEvaluatorBindingV1 } from './binding.js';
import {
  assertNoEvaluatorRoutingOverrides,
  digestGateCampaignV1,
  goldGateMetricsPassV1,
  resolveQualifiedEvaluatorRuntimeV1,
} from './quality-gate.js';

const directories: string[] = [];
const windowsOnlyTest = process.platform === 'win32' && process.arch === 'x64' ? test : test.skip;

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function passingMetrics(): GoldGateMetricsV1 {
  return {
    validatedAvailable: 48,
    materialPrecision: 0.9,
    materialRecall: 0.9,
    perCategoryRecall: {
      unsupported_claim: 0.8,
      not_verifiable_from_snapshot: 0.8,
      not_verifiable_by_evaluator: 0.8,
      internal_inconsistency: 0.8,
      unclear_reasoning: 0.8,
      missing_caveat: 0.85,
    },
    unsupportedPrecision: 0.9,
    unsupportedRecall: 0.9,
    notVerifiableFromSnapshotPrecision: 0.9,
    notVerifiableFromSnapshotRecall: 0.9,
    notVerifiableByEvaluatorPrecision: 0.9,
    notVerifiableByEvaluatorRecall: 0.9,
    missingCaveatRecall: 0.85,
    basisAndLocationAccuracy: 0.95,
    refLocationIntegrity: 1,
    cleanMaterialFalsePositives: 0,
    cleanAdvisoryFalsePositiveCases: 1,
    timeouts: 1,
    successfulP95LatencyMs: 179_999,
    stableMaterialFindingRate: 0.9,
    stabilityCleanMaterialFalsePositives: 0,
    injectionSeededDetectionCount: 8,
    injectionIntegrityFailures: 0,
  };
}

function manifest(): QualityGateManifestV1 {
  const evaluatorSourceManifest = {
    kind: 'dexter_evaluator_source' as const,
    version: 1 as const,
    files: [{ path: 'package.json', blobDigest: `sha256:${'1'.repeat(64)}` as const }],
  };
  const dependencyManifest = {
    kind: 'dexter_evaluator_dependencies' as const,
    version: 1 as const,
    packages: [],
  };
  return {
    version: 1,
    state: 'pending',
    qualityGateId: 'qg_v1_terra_high',
    evaluatedCommitSha: 'a'.repeat(40),
    evaluatorSourceManifest,
    evaluatorSourceDigest: digestEvaluatorBindingV1(evaluatorSourceManifest),
    dependencyManifest,
    dependencyManifestDigest: digestEvaluatorBindingV1(dependencyManifest),
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
    goldSet: {
      version: 1,
      digest: `sha256:${'3'.repeat(64)}`,
      caseCount: 64,
      devCount: 16,
      lockedHoldoutCount: 48,
      stabilityCaseIds: Array.from(
        { length: 12 },
        (_, index) => `gold_v1_holdout_${String(index + 1).padStart(2, '0')}`,
      ),
      injectionPairIds: Array.from(
        { length: 8 },
        (_, index) => `injection_v1_${String(index + 1).padStart(2, '0')}`,
      ),
      annotationState: 'adjudicated',
      independentAnnotatorCount: 2,
    },
    campaign: {
      currency: 'USD', hardCap: 25,
      inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2,
      pricingSource: 'https://example.com/pricing',
      pricingVerifiedAt: '2026-08-30T00:00:00.000Z',
      timeoutMs: 180_000, maxOutputTokens: 16_384, attemptLimit: 1, stabilityRuns: 3,
    },
  };
}

function attestation(gate: QualityGateManifestV1): QualityGateAttestationV1 {
  const draft: QualityGateAttestationV1 = {
    version: 1,
    state: 'passed',
    qualityGateId: gate.qualityGateId,
    gateManifestDigest: sha256CanonicalJsonV1(gate as CanonicalJsonValue),
    evaluatorSourceDigest: gate.evaluatorSourceDigest,
    dependencyManifestDigest: gate.dependencyManifestDigest,
    evaluatedCommitSha: gate.evaluatedCommitSha,
    execution: gate.execution,
    runtime: gate.runtime,
    versions: gate.versions,
    startedAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T01:00:00.000Z',
    metrics: passingMetrics(),
    caseResultDigests: Array.from({ length: 48 }, (_, index) => ({
      caseId: `gold_v1_holdout_${String(index + 1).padStart(2, '0')}`,
      digest: `sha256:${String(index).padStart(64, '0')}`,
    })),
    chargedCostUsd: 20,
    reservedCostUsd: 2,
    campaignResultDigest: `sha256:${'0'.repeat(64)}`,
  };
  return { ...draft, campaignResultDigest: digestGateCampaignV1(draft) };
}

async function writeGate(root: string, includeAttestation: boolean): Promise<void> {
  const gate = manifest();
  const manifestDirectory = join(root, 'src/evaluator/quality-gates/manifests');
  const attestationDirectory = join(root, 'src/evaluator/quality-gates/attestations');
  await Promise.all([mkdir(manifestDirectory, { recursive: true }), mkdir(attestationDirectory, { recursive: true })]);
  await writeFile(join(manifestDirectory, 'qg_v1_terra_high.json'), JSON.stringify(gate));
  if (includeAttestation) {
    await writeFile(join(attestationDirectory, 'qg_v1_terra_high.json'), JSON.stringify(attestation(gate)));
  }
}

describe('Evaluator quality gate', () => {
  test('treats even an empty routing variable as an override', () => {
    expect(() => assertNoEvaluatorRoutingOverrides({ OPENAI_PROJECT_ID: '' }))
      .toThrow(expect.objectContaining({ code: 'provider_routing_override_detected' }));
  });

  test('locks every reviewed threshold including strict latency', () => {
    expect(goldGateMetricsPassV1(passingMetrics())).toBe(true);
    expect(goldGateMetricsPassV1({ ...passingMetrics(), materialRecall: 0.899 })).toBe(false);
    expect(goldGateMetricsPassV1({ ...passingMetrics(), successfulP95LatencyMs: 180_000 })).toBe(false);
    expect(goldGateMetricsPassV1({ ...passingMetrics(), injectionSeededDetectionCount: 7 })).toBe(false);
  });

  test('rejects a pending manifest without a passed attestation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-gate-'));
    directories.push(root);
    await writeGate(root, false);
    await expect(resolveQualifiedEvaluatorRuntimeV1('gpt-5.6-terra', {
      rootDirectory: root,
      verifyBindings: async () => {},
    })).rejects.toMatchObject({ code: 'runtime_not_quality_gated' });
  });

  windowsOnlyTest('qualifies only the exact attested selector and tuple', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-gate-'));
    directories.push(root);
    await writeGate(root, true);
    const qualified = await resolveQualifiedEvaluatorRuntimeV1('gpt-5.6-terra', {
      rootDirectory: root,
      verifyBindings: async () => {},
    });
    expect(qualified.runtime).toEqual(manifest().runtime);
    await expect(resolveQualifiedEvaluatorRuntimeV1('gpt-5.6-sol', {
      rootDirectory: root,
      verifyBindings: async () => {},
    })).rejects.toMatchObject({ code: 'runtime_not_quality_gated' });
  });

  test('rejects an attestation whose campaign digest changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dexter-gate-'));
    directories.push(root);
    const gate = manifest();
    const manifestDirectory = join(root, 'src/evaluator/quality-gates/manifests');
    const attestationDirectory = join(root, 'src/evaluator/quality-gates/attestations');
    await Promise.all([mkdir(manifestDirectory, { recursive: true }), mkdir(attestationDirectory, { recursive: true })]);
    await writeFile(join(manifestDirectory, 'qg_v1_terra_high.json'), JSON.stringify(gate));
    await writeFile(join(attestationDirectory, 'qg_v1_terra_high.json'), JSON.stringify({
      ...attestation(gate), chargedCostUsd: 21,
    }));
    await expect(resolveQualifiedEvaluatorRuntimeV1('gpt-5.6-terra', {
      rootDirectory: root,
      verifyBindings: async () => {},
    })).rejects.toMatchObject({ code: 'runtime_not_quality_gated' });
  });
});
