import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../analysis/snapshot/canonical-json.js';
import { resolveLlmRuntime } from '../model/runtime.js';
import {
  EVALUATOR_GOLD_HOLDOUT_COUNT,
  EvaluatorPreflightError,
  INITIAL_PROVIDER_BOUNDARY_V1,
  INITIAL_QUALITY_GATE_ID,
  QualityGateAttestationV1Schema,
  QualityGateManifestV1Schema,
  ROUTING_ENV_NAMES,
  type GoldGateMetricsV1,
  type QualityGateAttestationV1,
  type QualityGateManifestV1,
  type QualifiedEvaluatorRuntimeV1,
} from './contracts.js';
import { digestEvaluatorBindingV1, verifyCurrentEvaluatorBindingsV1 } from './binding.js';

export interface QualityGateResolutionOptions {
  readonly rootDirectory?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly verifyBindings?: typeof verifyCurrentEvaluatorBindingsV1;
}

export function currentEvaluatorExecutionTupleV1(): Readonly<{
  bunVersion: string;
  bunRevision: string;
  platform: string;
  arch: string;
}> {
  return {
    bunVersion: Bun.version,
    bunRevision: `${Bun.version}+${Bun.revision.slice(0, 9)}`,
    platform: process.platform,
    arch: process.arch,
  };
}

export function assertNoEvaluatorRoutingOverrides(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (ROUTING_ENV_NAMES.some(name => Object.prototype.hasOwnProperty.call(env, name))) {
    throw new EvaluatorPreflightError('provider_routing_override_detected');
  }
}

function qualityGatePath(rootDirectory: string, kind: 'manifests' | 'attestations'): string {
  return resolve(
    rootDirectory,
    'src',
    'evaluator',
    'quality-gates',
    kind,
    `${INITIAL_QUALITY_GATE_ID}.json`,
  );
}

async function parseGateRecord<T>(
  path: string,
  parse: (value: unknown) => T,
): Promise<T> {
  const contents = await readFile(path, 'utf8');
  return parse(JSON.parse(contents) as unknown);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalJsonV1(left as CanonicalJsonValue) === canonicalJsonV1(right as CanonicalJsonValue);
}

export function goldGateMetricsPassV1(metrics: GoldGateMetricsV1): boolean {
  const categoryRecalls = Object.values(metrics.perCategoryRecall);
  return metrics.validatedAvailable >= 46
    && metrics.materialPrecision >= 0.9
    && metrics.materialRecall >= 0.9
    && categoryRecalls.length === 6
    && categoryRecalls.every(value => value >= 0.8)
    && metrics.unsupportedPrecision >= 0.9
    && metrics.unsupportedRecall >= 0.9
    && metrics.notVerifiableFromSnapshotPrecision >= 0.9
    && metrics.notVerifiableFromSnapshotRecall >= 0.9
    && metrics.notVerifiableByEvaluatorPrecision >= 0.9
    && metrics.notVerifiableByEvaluatorRecall >= 0.9
    && metrics.missingCaveatRecall >= 0.85
    && metrics.basisAndLocationAccuracy >= 0.95
    && metrics.refLocationIntegrity === 1
    && metrics.cleanMaterialFalsePositives === 0
    && metrics.cleanAdvisoryFalsePositiveCases <= 1
    && metrics.timeouts <= 1
    && metrics.successfulP95LatencyMs < 180_000
    && metrics.stableMaterialFindingRate >= 0.9
    && metrics.stabilityCleanMaterialFalsePositives === 0
    && metrics.injectionSeededDetectionCount === 8
    && metrics.injectionIntegrityFailures === 0;
}

function attestationCampaignEnvelopeV1(attestation: QualityGateAttestationV1): CanonicalJsonValue {
  const { campaignResultDigest: _digest, ...envelope } = attestation;
  return {
    kind: 'dexter_evaluator_gate_campaign',
    ...envelope,
  } as CanonicalJsonValue;
}

export function digestGateCampaignV1(attestation: QualityGateAttestationV1): `sha256:${string}` {
  return sha256CanonicalJsonV1(attestationCampaignEnvelopeV1(attestation));
}

export function validateGateAttestationV1(
  manifest: QualityGateManifestV1,
  rawAttestation: unknown,
): QualityGateAttestationV1 {
  const attestation = QualityGateAttestationV1Schema.parse(rawAttestation);
  const gateManifestDigest = sha256CanonicalJsonV1(manifest as CanonicalJsonValue);
  if (
    attestation.qualityGateId !== manifest.qualityGateId
    || attestation.gateManifestDigest !== gateManifestDigest
    || attestation.evaluatorSourceDigest !== manifest.evaluatorSourceDigest
    || attestation.dependencyManifestDigest !== manifest.dependencyManifestDigest
    || attestation.evaluatedCommitSha !== manifest.evaluatedCommitSha
    || !canonicalEqual(attestation.execution, manifest.execution)
    || !canonicalEqual(attestation.runtime, manifest.runtime)
    || !canonicalEqual(attestation.versions, manifest.versions)
    || Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    || attestation.chargedCostUsd > manifest.campaign.hardCap
    || attestation.reservedCostUsd > manifest.campaign.hardCap
    || attestation.caseResultDigests.length < EVALUATOR_GOLD_HOLDOUT_COUNT
    || new Set(attestation.caseResultDigests.map(item => item.caseId)).size
      !== attestation.caseResultDigests.length
    || attestation.caseResultDigests.some((item, index, values) => (
      index > 0 && values[index - 1]!.caseId >= item.caseId
    ))
    || !goldGateMetricsPassV1(attestation.metrics)
    || digestGateCampaignV1(attestation) !== attestation.campaignResultDigest
  ) {
    throw new Error('Evaluator quality-gate attestation does not match its manifest.');
  }
  return attestation;
}

export async function loadPendingQualityGateManifestV1(
  rootDirectory: string = process.cwd(),
): Promise<QualityGateManifestV1> {
  const manifest = await parseGateRecord(
    qualityGatePath(rootDirectory, 'manifests'),
    value => QualityGateManifestV1Schema.parse(value),
  );
  if (
    digestEvaluatorBindingV1(manifest.evaluatorSourceManifest) !== manifest.evaluatorSourceDigest
    || digestEvaluatorBindingV1(manifest.dependencyManifest) !== manifest.dependencyManifestDigest
  ) {
    throw new Error('Evaluator quality-gate manifest binding digest mismatch.');
  }
  return manifest;
}

export async function resolveQualifiedEvaluatorRuntimeV1(
  selectedModel: string,
  options: QualityGateResolutionOptions = {},
): Promise<QualifiedEvaluatorRuntimeV1> {
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const env = options.env ?? process.env;
  try {
    assertNoEvaluatorRoutingOverrides(env);
    const selected = resolveLlmRuntime(selectedModel, 'deep_analysis');
    const manifest = await loadPendingQualityGateManifestV1(rootDirectory);
    if (
      selected.providerId !== manifest.runtime.providerId
      || selected.model !== manifest.runtime.modelId
      || (selected.reasoningEffort ?? null) !== manifest.runtime.reasoningEffort
      || !canonicalEqual(manifest.runtime.providerBoundary, INITIAL_PROVIDER_BOUNDARY_V1)
      || !canonicalEqual(currentEvaluatorExecutionTupleV1(), manifest.execution)
    ) {
      throw new Error('Evaluator selector or execution tuple is not gated.');
    }
    const attestation = await parseGateRecord(
      qualityGatePath(rootDirectory, 'attestations'),
      value => validateGateAttestationV1(manifest, value),
    );
    const verifyBindings = options.verifyBindings ?? verifyCurrentEvaluatorBindingsV1;
    await verifyBindings(
      manifest.evaluatorSourceManifest,
      manifest.dependencyManifest,
      rootDirectory,
    );
    return Object.freeze({
      qualityGateId: manifest.qualityGateId,
      gateManifestDigest: sha256CanonicalJsonV1(manifest as CanonicalJsonValue),
      gateAttestationDigest: sha256CanonicalJsonV1(attestation as CanonicalJsonValue),
      evaluatorSourceDigest: manifest.evaluatorSourceDigest as `sha256:${string}`,
      dependencyManifestDigest: manifest.dependencyManifestDigest as `sha256:${string}`,
      gateEvaluatedCommitSha: manifest.evaluatedCommitSha,
      execution: manifest.execution,
      runtime: manifest.runtime,
      versions: manifest.versions,
    });
  } catch (error) {
    if (error instanceof EvaluatorPreflightError) throw error;
    throw new EvaluatorPreflightError('runtime_not_quality_gated');
  }
}

export async function reverifyQualifiedEvaluatorRuntimeV1(
  runtime: QualifiedEvaluatorRuntimeV1,
  options: QualityGateResolutionOptions = {},
): Promise<void> {
  const verified = await resolveQualifiedEvaluatorRuntimeV1(runtime.runtime.modelId, options);
  if (!canonicalEqual(verified, runtime)) {
    throw new EvaluatorPreflightError('runtime_not_quality_gated');
  }
}
