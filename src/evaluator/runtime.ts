import { randomUUID } from 'node:crypto';
import {
  EVALUATION_UNAVAILABLE_MESSAGES,
  type EvaluationResultV1,
  type EvaluationSidecarV1,
} from '../analysis/evaluation/schema.js';
import {
  EvaluationFindingValidationError,
  buildEvidenceManifestV1,
  digestArtifactInputV1,
  digestEvidenceManifestV1,
  EvaluationRepository,
  validateEvaluationFindingsWireV1,
} from '../analysis/evaluation/index.js';
import {
  canonicalJsonV1,
  digestValidatedAnalysisSnapshot,
  type CanonicalJsonValue,
} from '../analysis/snapshot/canonical-json.js';
import { SnapshotIdSchema } from '../analysis/snapshot/id.js';
import { AnalysisSnapshotRepository } from '../analysis/snapshot/repository.js';
import {
  ArtifactSafetyError,
  assertEvaluatorInputSafe,
} from '../analysis/snapshot/safety.js';
import { CanonicalTickerSchema } from '../analysis/snapshot/schema.js';
import {
  EVALUATOR_HTTP_REQUEST_MAX_UTF8_BYTES,
  EVALUATOR_TIMEOUT_MS,
  EvaluatorPreflightError,
  type QualifiedEvaluatorRuntimeV1,
} from './contracts.js';
import {
  EvaluatorProviderError,
  buildEvaluatorProviderRequestV1,
  evaluatorLogicalInputV1,
  invokeEvaluatorOnce,
  type EvaluatorProviderResultV1,
  type InvokeEvaluatorOptionsV1,
} from './provider.js';
import {
  assertNoEvaluatorRoutingOverrides,
  resolveQualifiedEvaluatorRuntimeV1,
  reverifyQualifiedEvaluatorRuntimeV1,
  type QualityGateResolutionOptions,
} from './quality-gate.js';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}` as const;

export type EvaluatorRunFailureCode =
  | 'invalid_ticker'
  | 'invalid_snapshot_id'
  | 'snapshot_not_found'
  | 'snapshot_unavailable'
  | 'runtime_not_quality_gated'
  | 'provider_routing_override_detected'
  | 'provider_credential_missing'
  | 'external_send_not_confirmed'
  | 'cancelled'
  | 'artifact_safety_failure'
  | 'save_after_cost_failure';

const RUN_FAILURE_MESSAGES: Readonly<Record<EvaluatorRunFailureCode, string>> = {
  invalid_ticker: 'The Evaluator ticker is invalid.',
  invalid_snapshot_id: 'The Evaluator Snapshot ID is invalid.',
  snapshot_not_found: 'The requested Snapshot was not found.',
  snapshot_unavailable: 'The requested Snapshot could not be verified.',
  runtime_not_quality_gated: 'The selected Evaluator runtime has not passed its quality gate.',
  provider_routing_override_detected: 'OpenAI routing overrides are not allowed for the Evaluator.',
  provider_credential_missing: 'The OpenAI credential is not configured.',
  external_send_not_confirmed: 'External sending was not confirmed.',
  cancelled: 'The Evaluator run was cancelled.',
  artifact_safety_failure: 'The Evaluator input failed the safety policy.',
  save_after_cost_failure: 'The Evaluation could not be saved after dispatch; API cost may have occurred.',
};

export class EvaluatorRunError extends Error {
  readonly code: EvaluatorRunFailureCode;
  readonly selector: Readonly<{ ticker: string; snapshotId: string }>;
  readonly safetyCode: string | null;
  readonly costMayHaveOccurred: boolean;

  constructor(
    code: EvaluatorRunFailureCode,
    selector: Readonly<{ ticker: string; snapshotId: string }>,
    options: Readonly<{ safetyCode?: string; costMayHaveOccurred?: boolean }> = {},
  ) {
    super(RUN_FAILURE_MESSAGES[code]);
    this.name = 'EvaluatorRunError';
    this.code = code;
    this.selector = selector;
    this.safetyCode = options.safetyCode ?? null;
    this.costMayHaveOccurred = options.costMayHaveOccurred ?? false;
  }
}

export type EvaluatorConfirmationSummaryV1 = Readonly<{
  ticker: string;
  snapshotId: string;
  providerId: string;
  modelId: string;
  reasoningEffort: string | null;
  baseUrl: string;
  organizationId: null;
  projectId: null;
  reportUtf16Units: number;
  reportUtf8Bytes: number;
  manifestUtf16Units: number;
  totalLogicalInputUtf16Units: number;
  httpRequestUtf8Bytes: number;
  httpRequestMaxUtf8Bytes: number;
  timeoutMs: number;
  externalSend: true;
  apiCostPossible: true;
}>;

export interface EvaluatorRunDependencies {
  readonly snapshotRepository?: AnalysisSnapshotRepository;
  readonly evaluationRepository?: EvaluationRepository;
  readonly qualityGateOptions?: QualityGateResolutionOptions;
  readonly resolveQualifiedRuntime?: typeof resolveQualifiedEvaluatorRuntimeV1;
  readonly reverifyQualifiedRuntime?: typeof reverifyQualifiedEvaluatorRuntimeV1;
  readonly invokeProvider?: typeof invokeEvaluatorOnce;
  readonly providerOptions?: InvokeEvaluatorOptionsV1;
  readonly confirmExternalSend?: (summary: EvaluatorConfirmationSummaryV1) => Promise<boolean>;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly createEvaluationId?: () => string;
}

export interface EvaluatorRunRequest {
  readonly ticker: string;
  readonly snapshotId: string;
  readonly selectedModel: string;
  readonly signal?: AbortSignal;
}

export type EvaluatorRunSuccess = Readonly<{
  state: 'saved';
  evaluationId: string;
  resultState: EvaluationSidecarV1['result']['state'];
  sidecar: EvaluationSidecarV1;
}>;

function fail(
  code: EvaluatorRunFailureCode,
  request: EvaluatorRunRequest,
  options?: Readonly<{ safetyCode?: string; costMayHaveOccurred?: boolean }>,
): never {
  throw new EvaluatorRunError(
    code,
    { ticker: request.ticker, snapshotId: request.snapshotId },
    options,
  );
}

function mapPreflightError(error: EvaluatorPreflightError, request: EvaluatorRunRequest): never {
  fail(error.code, request);
}

function unavailableResult(
  code: keyof typeof EVALUATION_UNAVAILABLE_MESSAGES,
): EvaluationResultV1 {
  return {
    state: 'unavailable',
    code,
    message: EVALUATION_UNAVAILABLE_MESSAGES[code],
    findings: [],
  };
}

function buildSidecar(
  input: Readonly<{
    request: EvaluatorRunRequest;
    snapshot: Awaited<ReturnType<AnalysisSnapshotRepository['loadHistory']>>;
    manifest: ReturnType<typeof buildEvidenceManifestV1>;
    runtime: QualifiedEvaluatorRuntimeV1;
    evaluationId: string;
    createdAt: string;
    completedAt: string;
    durationMs: number;
    tokenUsage: EvaluatorProviderResultV1['tokenUsage'];
    result: EvaluationResultV1;
  }>,
): EvaluationSidecarV1 {
  const draft: EvaluationSidecarV1 = {
    version: 1,
    evaluationId: input.evaluationId,
    target: {
      canonicalTicker: input.snapshot.canonicalTicker,
      snapshotId: input.request.snapshotId,
      schemaVersion: input.snapshot.schemaVersion,
      generatedAt: input.snapshot.generatedAt,
      snapshotDigest: digestValidatedAnalysisSnapshot(input.snapshot),
    },
    artifactInputDigest: ZERO_DIGEST,
    evidenceManifest: input.manifest,
    evidenceManifestDigest: digestEvidenceManifestV1(input.manifest),
    evaluatorSchemaVersion: input.runtime.versions.evaluatorSchemaVersion,
    evidenceManifestVersion: input.runtime.versions.evidenceManifestVersion,
    rubricVersion: input.runtime.versions.rubricVersion,
    promptVersion: input.runtime.versions.promptVersion,
    safetyPolicyVersion: input.runtime.versions.safetyPolicyVersion,
    qualityGateId: input.runtime.qualityGateId,
    gateManifestDigest: input.runtime.gateManifestDigest,
    gateAttestationDigest: input.runtime.gateAttestationDigest,
    evaluatorSourceDigest: input.runtime.evaluatorSourceDigest,
    gateEvaluatedCommitSha: input.runtime.gateEvaluatedCommitSha,
    executionEnvironment: {
      ...input.runtime.execution,
      dependencyManifestDigest: input.runtime.dependencyManifestDigest,
    },
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    runtime: input.runtime.runtime,
    attemptCount: 1,
    timeoutMs: EVALUATOR_TIMEOUT_MS,
    durationMs: input.durationMs,
    tokenUsage: input.tokenUsage,
    result: input.result,
  };
  return { ...draft, artifactInputDigest: digestArtifactInputV1(draft) };
}

async function saveDispatchedResult(
  sidecar: EvaluationSidecarV1,
  repository: EvaluationRepository,
  request: EvaluatorRunRequest,
): Promise<EvaluatorRunSuccess> {
  try {
    await repository.save(sidecar);
  } catch {
    fail('save_after_cost_failure', request, { costMayHaveOccurred: true });
  }
  return {
    state: 'saved',
    evaluationId: sidecar.evaluationId,
    resultState: sidecar.result.state,
    sidecar,
  };
}

export async function evaluatePersistedSnapshotV1(
  request: EvaluatorRunRequest,
  dependencies: EvaluatorRunDependencies = {},
): Promise<EvaluatorRunSuccess> {
  if (!CanonicalTickerSchema.safeParse(request.ticker).success) fail('invalid_ticker', request);
  if (!SnapshotIdSchema.safeParse(request.snapshotId).success) fail('invalid_snapshot_id', request);
  if (request.signal?.aborted) fail('cancelled', request);
  const env = dependencies.env ?? process.env;
  const qualityGateOptions = { ...dependencies.qualityGateOptions, env };
  let runtime: QualifiedEvaluatorRuntimeV1;
  try {
    runtime = await (dependencies.resolveQualifiedRuntime ?? resolveQualifiedEvaluatorRuntimeV1)(
      request.selectedModel,
      qualityGateOptions,
    );
  } catch (error) {
    if (error instanceof EvaluatorPreflightError) mapPreflightError(error, request);
    fail('runtime_not_quality_gated', request);
  }
  const snapshotRepository = dependencies.snapshotRepository ?? new AnalysisSnapshotRepository();
  let snapshot: Awaited<ReturnType<AnalysisSnapshotRepository['loadHistory']>>;
  try {
    snapshot = await snapshotRepository.loadHistory(request.ticker, request.snapshotId);
  } catch (error) {
    const missing = error instanceof Error && 'kind' in error
      && (error as { kind?: unknown }).kind === 'missing_snapshot';
    fail(missing ? 'snapshot_not_found' : 'snapshot_unavailable', request);
  }
  if (snapshot.canonicalTicker !== request.ticker) fail('snapshot_unavailable', request);
  let manifest: ReturnType<typeof buildEvidenceManifestV1>;
  try {
    manifest = buildEvidenceManifestV1(snapshot);
    const logicalInput = evaluatorLogicalInputV1(snapshot.finalReportMarkdown, manifest);
    assertEvaluatorInputSafe({
      reportMarkdown: snapshot.finalReportMarkdown,
      logicalInput,
      evidenceManifest: manifest as CanonicalJsonValue,
    }, env);
  } catch (error) {
    if (error instanceof ArtifactSafetyError) {
      fail('artifact_safety_failure', request, { safetyCode: error.code });
    }
    fail('snapshot_unavailable', request);
  }
  if (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.length === 0) {
    fail('provider_credential_missing', request);
  }
  const providerRequest = buildEvaluatorProviderRequestV1({
    report: snapshot.finalReportMarkdown,
    evidenceManifest: manifest,
    runtime,
  });
  const manifestJson = canonicalJsonV1(manifest as CanonicalJsonValue);
  const logicalInput = evaluatorLogicalInputV1(snapshot.finalReportMarkdown, manifest);
  const summary: EvaluatorConfirmationSummaryV1 = {
    ticker: request.ticker,
    snapshotId: request.snapshotId,
    providerId: runtime.runtime.providerId,
    modelId: runtime.runtime.modelId,
    reasoningEffort: runtime.runtime.reasoningEffort,
    baseUrl: runtime.runtime.providerBoundary.baseUrl,
    organizationId: runtime.runtime.providerBoundary.organizationId,
    projectId: runtime.runtime.providerBoundary.projectId,
    reportUtf16Units: snapshot.finalReportMarkdown.length,
    reportUtf8Bytes: Buffer.byteLength(snapshot.finalReportMarkdown, 'utf8'),
    manifestUtf16Units: manifestJson.length,
    totalLogicalInputUtf16Units: logicalInput.length,
    httpRequestUtf8Bytes: providerRequest.bodyUtf8Bytes,
    httpRequestMaxUtf8Bytes: EVALUATOR_HTTP_REQUEST_MAX_UTF8_BYTES,
    timeoutMs: EVALUATOR_TIMEOUT_MS,
    externalSend: true,
    apiCostPossible: true,
  };
  if (dependencies.confirmExternalSend === undefined || !await dependencies.confirmExternalSend(summary)) {
    fail('external_send_not_confirmed', request);
  }
  if (request.signal?.aborted) fail('cancelled', request);
  try {
    await (dependencies.reverifyQualifiedRuntime ?? reverifyQualifiedEvaluatorRuntimeV1)(
      runtime,
      qualityGateOptions,
    );
    assertNoEvaluatorRoutingOverrides(env);
    assertEvaluatorInputSafe({
      reportMarkdown: snapshot.finalReportMarkdown,
      logicalInput,
      evidenceManifest: manifest as CanonicalJsonValue,
    }, env);
  } catch (error) {
    if (error instanceof EvaluatorPreflightError) mapPreflightError(error, request);
    if (error instanceof ArtifactSafetyError) {
      fail('artifact_safety_failure', request, { safetyCode: error.code });
    }
    fail('runtime_not_quality_gated', request);
  }
  const evaluationId = (dependencies.createEvaluationId ?? randomUUID)();
  const now = dependencies.now ?? Date.now;
  const dispatchStarted = now();
  const createdAt = new Date(dispatchStarted).toISOString();
  const invoke = dependencies.invokeProvider ?? invokeEvaluatorOnce;
  let providerResult: EvaluatorProviderResultV1 | null = null;
  let result: EvaluationResultV1;
  try {
    providerResult = await invoke(providerRequest, {
      ...dependencies.providerOptions,
      env,
      apiKey: env.OPENAI_API_KEY,
      signal: request.signal,
    });
    result = {
      state: 'available',
      findings: [...validateEvaluationFindingsWireV1(
        providerResult.findings,
        snapshot.finalReportMarkdown,
        manifest,
      )],
    };
  } catch (error) {
    if (error instanceof EvaluatorProviderError && error.code === 'cancelled') {
      fail('cancelled', request);
    }
    if (error instanceof EvaluatorProviderError && error.attemptCount === 0) {
      fail('provider_credential_missing', request);
    }
    if (request.signal?.aborted) fail('cancelled', request);
    const code = error instanceof EvaluationFindingValidationError
      ? error.code
      : error instanceof EvaluatorProviderError && error.code === 'provider_timeout'
        ? 'provider_timeout'
        : error instanceof EvaluatorProviderError && error.code === 'output_schema_invalid'
          ? 'output_schema_invalid'
          : 'provider_failure';
    providerResult = {
      findings: [],
      tokenUsage: providerResult?.tokenUsage
        ?? { inputTokens: null, outputTokens: null, totalTokens: null },
      attemptCount: 1,
    };
    result = unavailableResult(code);
  }
  if (request.signal?.aborted) fail('cancelled', request);
  const completedMs = now();
  const sidecar = buildSidecar({
    request,
    snapshot,
    manifest,
    runtime,
    evaluationId,
    createdAt,
    completedAt: new Date(completedMs).toISOString(),
    durationMs: Math.max(0, Math.round(completedMs - dispatchStarted)),
    tokenUsage: providerResult.tokenUsage,
    result,
  });
  return saveDispatchedResult(
    sidecar,
    dependencies.evaluationRepository ?? new EvaluationRepository(),
    request,
  );
}
