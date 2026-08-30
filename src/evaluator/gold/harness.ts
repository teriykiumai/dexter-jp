import { resolve } from 'node:path';
import {
  validateEvaluationFindingsWireV1,
} from '../../analysis/evaluation/findings.js';
import {
  assertEvaluatorInputSafe,
} from '../../analysis/snapshot/safety.js';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../../analysis/snapshot/canonical-json.js';
import { dexterPath } from '../../utils/paths.js';
import {
  EVALUATOR_GOLD_COST_CAP_USD,
  EVALUATOR_MAX_OUTPUT_TOKENS,
  INITIAL_QUALITY_GATE_ID,
  QualityGateAttestationV1Schema,
  type QualityGateAttestationV1,
  type QualityGateManifestV1,
  type QualifiedEvaluatorRuntimeV1,
} from '../contracts.js';
import {
  verifyCurrentEvaluatorBindingsV1,
  writeCanonicalGateRecord,
} from '../binding.js';
import {
  EvaluatorProviderError,
  buildEvaluatorProviderRequestV1,
  evaluatorLogicalInputV1,
  invokeEvaluatorOnce,
  type InvokeEvaluatorOptionsV1,
} from '../provider.js';
import {
  assertNoEvaluatorRoutingOverrides,
  currentEvaluatorExecutionTupleV1,
  digestGateCampaignV1,
  goldGateMetricsPassV1,
  loadPendingQualityGateManifestV1,
} from '../quality-gate.js';
import {
  loadTrackedAdjudicatedGoldSetV1,
  type AdjudicatedGoldCaseV1,
  type AdjudicatedGoldSetV1,
} from './adjudication.js';
import {
  digestGoldCaseOutcomeV1,
  scoreGoldCampaignV1,
  type GoldCaseOutcomeV1,
} from './metrics.js';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}` as const;

export interface GoldCampaignDependenciesV1 {
  readonly rootDirectory?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly invokeProvider?: typeof invokeEvaluatorOnce;
  readonly providerOptions?: InvokeEvaluatorOptionsV1;
  readonly verifyBindings?: typeof verifyCurrentEvaluatorBindingsV1;
  readonly now?: () => number;
}

export type GoldCampaignResultV1 = Readonly<{
  passed: boolean;
  metrics: ReturnType<typeof scoreGoldCampaignV1>;
  chargedCostUsd: number;
  reservedCostUsd: number;
  attestation: QualityGateAttestationV1 | null;
}>;

function pendingAuthorizedRuntime(manifest: QualityGateManifestV1): QualifiedEvaluatorRuntimeV1 {
  return {
    qualityGateId: manifest.qualityGateId,
    gateManifestDigest: sha256CanonicalJsonV1(manifest as CanonicalJsonValue),
    gateAttestationDigest: ZERO_DIGEST,
    evaluatorSourceDigest: manifest.evaluatorSourceDigest as `sha256:${string}`,
    dependencyManifestDigest: manifest.dependencyManifestDigest as `sha256:${string}`,
    gateEvaluatedCommitSha: manifest.evaluatedCommitSha,
    execution: manifest.execution,
    runtime: manifest.runtime,
    versions: manifest.versions,
  };
}

function usdCost(inputTokens: number, outputTokens: number, manifest: QualityGateManifestV1): number {
  return (
    inputTokens * manifest.campaign.inputUsdPerMillionTokens
    + outputTokens * manifest.campaign.outputUsdPerMillionTokens
  ) / 1_000_000;
}

function reserveCost(requestUtf8Bytes: number, manifest: QualityGateManifestV1): number {
  return usdCost(requestUtf8Bytes, EVALUATOR_MAX_OUTPUT_TOKENS, manifest);
}

function assertManifestMatchesGoldSet(
  manifest: QualityGateManifestV1,
  goldSet: AdjudicatedGoldSetV1,
): void {
  const cases = goldSet.cases;
  const stabilityCaseIds = cases.filter(value => value.input.stability).map(value => value.input.caseId);
  const injectionPairIds = [...new Set(cases.flatMap(value => (
    value.input.injectionPairId === null ? [] : [value.input.injectionPairId]
  )))].sort();
  if (
    manifest.goldSet.digest !== goldSet.goldSetDigest
    || manifest.goldSet.caseCount !== cases.length
    || manifest.goldSet.devCount !== cases.filter(value => value.input.split === 'dev').length
    || manifest.goldSet.lockedHoldoutCount
      !== cases.filter(value => value.input.split === 'locked_holdout').length
    || canonicalJsonV1(manifest.goldSet.stabilityCaseIds)
      !== canonicalJsonV1(stabilityCaseIds)
    || canonicalJsonV1(manifest.goldSet.injectionPairIds)
      !== canonicalJsonV1(injectionPairIds)
  ) {
    throw new Error('Pending gate manifest does not bind the adjudicated gold set.');
  }
}

function runGit(rootDirectory: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: rootDirectory });
  if (result.exitCode !== 0) throw new Error('Manual gold campaign Git preflight failed.');
  return new TextDecoder().decode(result.stdout);
}

function assertManualCheckout(manifest: QualityGateManifestV1, rootDirectory: string): void {
  if (runGit(rootDirectory, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('Manual gold campaign requires a clean disposable checkout.');
  }
  const head = runGit(rootDirectory, ['rev-parse', 'HEAD']).trim();
  const changed = head === manifest.evaluatedCommitSha
    ? []
    : runGit(rootDirectory, ['diff', '--name-only', `${manifest.evaluatedCommitSha}..${head}`])
        .trim().split(/\r?\n/).filter(Boolean);
  const allowedManifest = `src/evaluator/quality-gates/manifests/${manifest.qualityGateId}.json`;
  if (changed.some(path => path !== allowedManifest)) {
    throw new Error('Manual gold campaign checkout differs from the evaluated source commit.');
  }
  if (canonicalJsonV1(currentEvaluatorExecutionTupleV1()) !== canonicalJsonV1(manifest.execution)) {
    throw new Error('Manual gold campaign execution tuple does not match.');
  }
  const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: rootDirectory,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (install.exitCode !== 0) throw new Error('Manual gold campaign frozen install failed.');
}

function campaignRuns(goldSet: AdjudicatedGoldSetV1): readonly Readonly<{
  goldCase: AdjudicatedGoldCaseV1;
  runIndex: 0 | 1 | 2;
}>[] {
  const locked = goldSet.cases.filter(value => value.input.split === 'locked_holdout');
  const stability = locked.filter(value => value.input.stability);
  return [
    ...locked.map(goldCase => ({ goldCase, runIndex: 0 as const })),
    ...stability.map(goldCase => ({ goldCase, runIndex: 1 as const })),
    ...stability.map(goldCase => ({ goldCase, runIndex: 2 as const })),
  ];
}

export async function runGoldCampaignV1(
  manifest: QualityGateManifestV1,
  goldSet: AdjudicatedGoldSetV1,
  dependencies: GoldCampaignDependenciesV1 = {},
): Promise<GoldCampaignResultV1> {
  const rootDirectory = dependencies.rootDirectory ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) throw new Error('OpenAI credential is unavailable.');
  assertNoEvaluatorRoutingOverrides(env);
  assertManifestMatchesGoldSet(manifest, goldSet);
  const runtime = pendingAuthorizedRuntime(manifest);
  const verifyBindings = dependencies.verifyBindings ?? verifyCurrentEvaluatorBindingsV1;
  await verifyBindings(manifest.evaluatorSourceManifest, manifest.dependencyManifest, rootDirectory);
  const now = dependencies.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const outcomes: GoldCaseOutcomeV1[] = [];
  let budgetConsumedUsd = 0;
  let chargedCostUsd = 0;
  let retainedReservationUsd = 0;
  for (const { goldCase, runIndex } of campaignRuns(goldSet)) {
    const logicalInput = evaluatorLogicalInputV1(
      goldCase.input.report,
      goldCase.input.evidenceManifest,
    );
    assertEvaluatorInputSafe({
      reportMarkdown: goldCase.input.report,
      logicalInput,
      evidenceManifest: goldCase.input.evidenceManifest as CanonicalJsonValue,
    }, env);
    const request = buildEvaluatorProviderRequestV1({
      report: goldCase.input.report,
      evidenceManifest: goldCase.input.evidenceManifest,
      runtime,
    });
    const reservation = reserveCost(request.bodyUtf8Bytes, manifest);
    if (budgetConsumedUsd + reservation > manifest.campaign.hardCap) {
      throw new Error('Manual gold campaign hard cost cap would be exceeded.');
    }
    await verifyBindings(manifest.evaluatorSourceManifest, manifest.dependencyManifest, rootDirectory);
    assertNoEvaluatorRoutingOverrides(env);
    const started = now();
    let outcomeWithoutDigest: Omit<GoldCaseOutcomeV1, 'resultDigest'>;
    try {
      const providerResult = await (dependencies.invokeProvider ?? invokeEvaluatorOnce)(request, {
        ...dependencies.providerOptions,
        env,
        apiKey,
      });
      const findings = validateEvaluationFindingsWireV1(
        providerResult.findings,
        goldCase.input.report,
        goldCase.input.evidenceManifest,
      );
      const usageKnown = providerResult.tokenUsage.inputTokens !== null
        && providerResult.tokenUsage.outputTokens !== null;
      const actualCost = usageKnown
        ? usdCost(
            providerResult.tokenUsage.inputTokens!,
            providerResult.tokenUsage.outputTokens!,
            manifest,
          )
        : reservation;
      budgetConsumedUsd += actualCost;
      chargedCostUsd += usageKnown ? actualCost : 0;
      if (!usageKnown) retainedReservationUsd += reservation;
      outcomeWithoutDigest = {
        caseId: goldCase.input.caseId,
        runIndex,
        state: 'available',
        unavailableCode: null,
        findings,
        latencyMs: Math.max(0, now() - started),
        inputTokens: providerResult.tokenUsage.inputTokens,
        outputTokens: providerResult.tokenUsage.outputTokens,
      };
    } catch (error) {
      budgetConsumedUsd += reservation;
      retainedReservationUsd += reservation;
      outcomeWithoutDigest = {
        caseId: goldCase.input.caseId,
        runIndex,
        state: 'unavailable',
        unavailableCode: error instanceof EvaluatorProviderError ? error.code : 'output_schema_invalid',
        findings: [],
        latencyMs: Math.max(0, now() - started),
        inputTokens: null,
        outputTokens: null,
      };
    }
    outcomes.push({
      ...outcomeWithoutDigest,
      resultDigest: digestGoldCaseOutcomeV1(outcomeWithoutDigest),
    });
  }
  const metrics = scoreGoldCampaignV1(goldSet.cases, outcomes);
  const passed = goldGateMetricsPassV1(metrics)
    && budgetConsumedUsd <= EVALUATOR_GOLD_COST_CAP_USD;
  if (!passed) {
    return {
      passed,
      metrics,
      chargedCostUsd,
      reservedCostUsd: retainedReservationUsd,
      attestation: null,
    };
  }
  const caseResultDigests = goldSet.cases
    .filter(value => value.input.split === 'locked_holdout')
    .map(value => ({
      caseId: value.input.caseId,
      digest: sha256CanonicalJsonV1({
        kind: 'dexter_gold_case_runs',
        version: 1,
        caseId: value.input.caseId,
        resultDigests: outcomes
          .filter(outcome => outcome.caseId === value.input.caseId)
          .map(outcome => outcome.resultDigest),
      } as CanonicalJsonValue),
    }));
  const draft: QualityGateAttestationV1 = {
    version: 1,
    state: 'passed',
    qualityGateId: manifest.qualityGateId,
    gateManifestDigest: sha256CanonicalJsonV1(manifest as CanonicalJsonValue),
    evaluatorSourceDigest: manifest.evaluatorSourceDigest,
    dependencyManifestDigest: manifest.dependencyManifestDigest,
    evaluatedCommitSha: manifest.evaluatedCommitSha,
    execution: manifest.execution,
    runtime: manifest.runtime,
    versions: manifest.versions,
    startedAt,
    completedAt: new Date(now()).toISOString(),
    metrics,
    caseResultDigests,
    chargedCostUsd,
    reservedCostUsd: retainedReservationUsd,
    campaignResultDigest: ZERO_DIGEST,
  };
  const attestation = QualityGateAttestationV1Schema.parse({
    ...draft,
    campaignResultDigest: digestGateCampaignV1(draft),
  });
  return {
    passed,
    metrics,
    chargedCostUsd,
    reservedCostUsd: retainedReservationUsd,
    attestation,
  };
}

function parseHarnessArgs(args: readonly string[]): Readonly<{
  qualityGateId: string;
  confirmPaidCampaign: boolean;
}> {
  let qualityGateId: string | undefined;
  let confirmPaidCampaign = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--confirm-paid-campaign') {
      if (confirmPaidCampaign) throw new Error('Duplicate paid-campaign confirmation.');
      confirmPaidCampaign = true;
    } else if (args[index] === '--quality-gate-id' && qualityGateId === undefined) {
      qualityGateId = args[index + 1];
      index += 1;
    } else {
      throw new Error('Invalid gold-harness arguments.');
    }
  }
  if (qualityGateId !== INITIAL_QUALITY_GATE_ID) throw new Error('Unknown quality-gate ID.');
  return { qualityGateId, confirmPaidCampaign };
}

export async function runGoldHarnessCli(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseHarnessArgs(args);
    if (!parsed.confirmPaidCampaign) {
      process.stderr.write('Paid campaign confirmation is required; default is No.\n');
      return 2;
    }
    const rootDirectory = process.cwd();
    const manifest = await loadPendingQualityGateManifestV1(rootDirectory);
    const goldSet = await loadTrackedAdjudicatedGoldSetV1(rootDirectory);
    assertManualCheckout(manifest, rootDirectory);
    const result = await runGoldCampaignV1(manifest, goldSet, { rootDirectory });
    const recordDigest = result.attestation?.campaignResultDigest
      ?? sha256CanonicalJsonV1({
        kind: 'dexter_failed_gold_campaign',
        version: 1,
        metrics: result.metrics,
        chargedCostUsd: result.chargedCostUsd,
        reservedCostUsd: result.reservedCostUsd,
      } as CanonicalJsonValue);
    const resultPath = resolve(
      dexterPath('evaluator-gates', parsed.qualityGateId),
      `${result.passed ? 'proposed-attestation' : 'failed-campaign'}-${recordDigest.slice(7, 23)}.json`,
    );
    const record = result.attestation ?? {
      version: 1,
      state: 'failed',
      qualityGateId: parsed.qualityGateId,
      metrics: result.metrics,
      chargedCostUsd: result.chargedCostUsd,
      reservedCostUsd: result.reservedCostUsd,
    };
    await writeCanonicalGateRecord(resultPath, record as CanonicalJsonValue);
    process.stdout.write(`${JSON.stringify({
      state: result.passed ? 'passed' : 'failed',
      qualityGateId: parsed.qualityGateId,
      chargedCostUsd: result.chargedCostUsd,
      reservedCostUsd: result.reservedCostUsd,
    })}\n`);
    return result.passed ? 0 : 1;
  } catch {
    process.stderr.write('Gold campaign preflight or execution failed. No qualification was published.\n');
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runGoldHarnessCli();
}
