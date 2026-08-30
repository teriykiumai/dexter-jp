import { resolve } from 'node:path';
import {
  EVALUATOR_ATTEMPT_LIMIT,
  EVALUATOR_GOLD_CASE_COUNT,
  EVALUATOR_GOLD_COST_CAP_USD,
  EVALUATOR_GOLD_DEV_COUNT,
  EVALUATOR_GOLD_HOLDOUT_COUNT,
  EVALUATOR_GOLD_SET_VERSION,
  EVALUATOR_MAX_OUTPUT_TOKENS,
  EVALUATOR_PROMPT_VERSION,
  EVALUATOR_RUBRIC_VERSION,
  EVALUATOR_TIMEOUT_MS,
  INITIAL_PROVIDER_BOUNDARY_V1,
  INITIAL_QUALITY_GATE_ID,
  QualityGateManifestV1Schema,
} from './contracts.js';
import {
  buildEvaluatorDependencyManifestV1,
  buildEvaluatorSourceManifestFromGitV1,
  digestEvaluatorBindingV1,
  writeCanonicalGateRecord,
} from './binding.js';
import { currentEvaluatorExecutionTupleV1 } from './quality-gate.js';
import { loadTrackedAdjudicatedGoldSetV1 } from './gold/adjudication.js';
import type { CanonicalJsonValue } from '../analysis/snapshot/canonical-json.js';

type GeneratorArguments = Readonly<{
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  pricingSource: string;
  pricingVerifiedAt: string;
}>;

function parsePositiveNumber(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Pricing must be positive.');
  return parsed;
}

function parseGeneratorArguments(args: readonly string[]): GeneratorArguments {
  const values = new Map<string, string>();
  const allowed = new Set([
    '--input-usd-per-million-tokens',
    '--output-usd-per-million-tokens',
    '--pricing-source',
    '--pricing-verified-at',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !allowed.has(key) || values.has(key)) {
      throw new Error('Invalid quality-gate manifest arguments.');
    }
    values.set(key, value);
  }
  const pricingSource = values.get('--pricing-source');
  const pricingVerifiedAt = values.get('--pricing-verified-at');
  if (pricingSource === undefined || pricingVerifiedAt === undefined) {
    throw new Error('Pricing provenance is required.');
  }
  return {
    inputUsdPerMillionTokens: parsePositiveNumber(values.get('--input-usd-per-million-tokens')),
    outputUsdPerMillionTokens: parsePositiveNumber(values.get('--output-usd-per-million-tokens')),
    pricingSource,
    pricingVerifiedAt,
  };
}

function gitHead(rootDirectory: string): string {
  const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: rootDirectory });
  const value = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('Quality-gate source commit is unavailable.');
  }
  return value;
}

export async function generatePendingQualityGateManifestV1(
  args: GeneratorArguments,
  rootDirectory: string = process.cwd(),
): Promise<string> {
  const goldSet = await loadTrackedAdjudicatedGoldSetV1(rootDirectory);
  const evaluatorSourceManifest = await buildEvaluatorSourceManifestFromGitV1(rootDirectory);
  const dependencyManifest = await buildEvaluatorDependencyManifestV1(rootDirectory);
  const stabilityCaseIds = goldSet.cases
    .filter(value => value.input.stability)
    .map(value => value.input.caseId);
  const injectionPairIds = [...new Set(goldSet.cases.flatMap(value => (
    value.input.injectionPairId === null ? [] : [value.input.injectionPairId]
  )))].sort();
  const manifest = QualityGateManifestV1Schema.parse({
    version: 1,
    state: 'pending',
    qualityGateId: INITIAL_QUALITY_GATE_ID,
    evaluatedCommitSha: gitHead(rootDirectory),
    evaluatorSourceManifest,
    evaluatorSourceDigest: digestEvaluatorBindingV1(evaluatorSourceManifest),
    dependencyManifest,
    dependencyManifestDigest: digestEvaluatorBindingV1(dependencyManifest),
    execution: currentEvaluatorExecutionTupleV1(),
    runtime: {
      providerId: 'openai',
      modelId: 'gpt-5.6-terra',
      taskProfile: 'deep_analysis',
      reasoningEffort: 'high',
      providerBoundary: INITIAL_PROVIDER_BOUNDARY_V1,
    },
    versions: {
      evaluatorSchemaVersion: 1,
      evidenceManifestVersion: 1,
      rubricVersion: EVALUATOR_RUBRIC_VERSION,
      promptVersion: EVALUATOR_PROMPT_VERSION,
      safetyPolicyVersion: 1,
      goldSetVersion: EVALUATOR_GOLD_SET_VERSION,
    },
    goldSet: {
      version: EVALUATOR_GOLD_SET_VERSION,
      digest: goldSet.goldSetDigest,
      caseCount: EVALUATOR_GOLD_CASE_COUNT,
      devCount: EVALUATOR_GOLD_DEV_COUNT,
      lockedHoldoutCount: EVALUATOR_GOLD_HOLDOUT_COUNT,
      stabilityCaseIds,
      injectionPairIds,
      annotationState: 'adjudicated',
      independentAnnotatorCount: 2,
    },
    campaign: {
      currency: 'USD',
      hardCap: EVALUATOR_GOLD_COST_CAP_USD,
      inputUsdPerMillionTokens: args.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: args.outputUsdPerMillionTokens,
      pricingSource: args.pricingSource,
      pricingVerifiedAt: args.pricingVerifiedAt,
      timeoutMs: EVALUATOR_TIMEOUT_MS,
      maxOutputTokens: EVALUATOR_MAX_OUTPUT_TOKENS,
      attemptLimit: EVALUATOR_ATTEMPT_LIMIT,
      stabilityRuns: 3,
    },
  });
  const path = resolve(
    rootDirectory,
    'src/evaluator/quality-gates/manifests',
    `${INITIAL_QUALITY_GATE_ID}.json`,
  );
  await writeCanonicalGateRecord(path, manifest as CanonicalJsonValue);
  return path;
}

if (import.meta.main) {
  try {
    const path = await generatePendingQualityGateManifestV1(
      parseGeneratorArguments(process.argv.slice(2)),
    );
    process.stdout.write(`Pending quality-gate manifest created: ${path}\n`);
  } catch {
    process.stderr.write('Pending quality-gate manifest generation failed.\n');
    process.exitCode = 1;
  }
}
