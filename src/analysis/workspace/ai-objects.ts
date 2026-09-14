import { AiInputSchema, AnalysisRunArtifactV1Schema, AiInterpretationSchema, type AiInput, type AnalysisRunArtifactV1 } from './ai-contracts.js';
import { parse, fail, safe, json, objectKey, type ObjectRef, type ObjectMetadata, type ReferenceCodecs } from './contracts.js';

function aiDependencies(selection: AiInput['selection']): ObjectRef[] {
  const refs = [selection.master, ...[selection.financial, selection.technical, selection.margin, selection.issuer_short, selection.sector_short]
    .flatMap(binding => binding ? [binding.artifact, binding.receipt] : []), ...(selection.sector_short ? [selection.sector_short.membership] : [])];
  return [...new Map(refs.map(ref => [objectKey(ref), ref])).values()];
}

export function aiAsOf(input: AiInput): AnalysisRunArtifactV1['asOf'] {
  if (input.profile === 'supply_demand') return input.data.datasets.map(dataset => ({ source: dataset.dataset, through: dataset.through, checkedAt: dataset.checkedAt }));
  const asOf: AnalysisRunArtifactV1['asOf'] = [{ source: 'financial', through: input.data.through, checkedAt: input.data.checkedAt }];
  if (input.technicalObservation) asOf.push({ source: 'technical', ...input.technicalObservation });
  return asOf;
}

export function validateInterpretation(input: AiInput, value: unknown) {
  const output = parse(AiInterpretationSchema, value); safe(output);
  const allowed = input.profile === 'fundamental' ? ['financial'] : ['margin', 'issuer_short', 'sector_short'];
  if ([...output.observations, ...output.limitations].some(item => item.sources.some(source => !allowed.includes(source)))) fail('invalid_input');
  return output;
}
export function validateAiResult(input: AiInput, ref: ObjectRef, value: unknown): AnalysisRunArtifactV1 {
  const result = parse(AnalysisRunArtifactV1Schema, value); safe(result);
  if (new TextEncoder().encode(json(result)).byteLength > 32 * 1024) fail('invalid_input');
  if (result.runId !== input.runId || result.instrumentId !== input.selection.identity.instrumentId || result.profile !== input.profile
    || result.createdAt !== input.createdAt || result.profileVersion !== input.profileVersion || json(result.runtime) !== json(input.runtime)
    || json(result.input) !== json(ref) || json(result.asOf) !== json(aiAsOf(input))) fail('reference_conflict');
  validateInterpretation(input, result.interpretation); return result;
}
export const aiCodecs: ReferenceCodecs = new Map([
  ['workspace_ai_input_v1', value => {
    const input = parse(AiInputSchema, value); safe(input);
    if (new TextEncoder().encode(json(input)).byteLength > 96 * 1024) fail('invalid_input');
    return { scope: { kind: 'instrument-owned', instrumentId: input.selection.identity.instrumentId },
      effectiveDate: input.createdAt.slice(0, 10), dependencies: aiDependencies(input.selection),
      sourceDefinition: 'workspace_saved_inputs_v1', calculationVersion: input.profileVersion } satisfies ObjectMetadata;
  }],
  ['analysis_run_artifact_v1', value => {
    const run = parse(AnalysisRunArtifactV1Schema, value); safe(run);
    return { scope: { kind: 'instrument-owned', instrumentId: run.instrumentId }, effectiveDate: run.createdAt.slice(0, 10),
      dependencies: [run.input], sourceDefinition: 'workspace_saved_inputs_v1', calculationVersion: run.profileVersion } satisfies ObjectMetadata;
  }],
]);
