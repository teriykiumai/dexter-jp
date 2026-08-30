import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  EvaluationFindingWireV1Schema,
  type EvaluationFindingV1,
} from '../../analysis/evaluation/schema.js';
import { validateEvaluationFindingsWireV1 } from '../../analysis/evaluation/findings.js';
import {
  canonicalJsonV1,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from '../../analysis/snapshot/canonical-json.js';
import {
  GOLD_SET_CANDIDATE_V1,
  GOLD_SET_CANDIDATE_V1_DIGEST,
  type GoldCaseV1,
} from './set.js';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const CaseAnnotationV1Schema = z.object({
  caseId: z.string().regex(/^gold_v1_(?:dev|holdout)_\d{2}$/),
  annotatorAFindings: z.array(EvaluationFindingWireV1Schema).max(20),
  annotatorBFindings: z.array(EvaluationFindingWireV1Schema).max(20),
  adjudicatedFindings: z.array(EvaluationFindingWireV1Schema).max(20),
}).strict();

export const GoldAdjudicationV1Schema = z.object({
  version: z.literal(1),
  candidateDigest: digestSchema,
  annotationMethod: z.literal('two_independent_then_adjudicated'),
  annotatorAId: z.string().min(1).max(100),
  annotatorBId: z.string().min(1).max(100),
  adjudicatorId: z.string().min(1).max(100),
  completedAt: z.string().datetime({ offset: true }).refine(value => value.endsWith('Z')),
  cases: z.array(CaseAnnotationV1Schema).length(64),
}).strict();
export type GoldAdjudicationV1 = z.infer<typeof GoldAdjudicationV1Schema>;

export type AdjudicatedGoldCaseV1 = Readonly<{
  input: GoldCaseV1;
  expectedFindings: readonly EvaluationFindingV1[];
}>;

export type AdjudicatedGoldSetV1 = Readonly<{
  version: 1;
  candidateDigest: `sha256:${string}`;
  adjudicationDigest: `sha256:${string}`;
  goldSetDigest: `sha256:${string}`;
  cases: readonly AdjudicatedGoldCaseV1[];
}>;

function validateAnnotationFindings(
  raw: unknown,
  input: GoldCaseV1,
): readonly EvaluationFindingV1[] {
  return validateEvaluationFindingsWireV1(raw, input.report, input.evidenceManifest);
}

export function validateGoldAdjudicationV1(raw: unknown): AdjudicatedGoldSetV1 {
  const record = GoldAdjudicationV1Schema.parse(raw);
  if (
    record.candidateDigest !== GOLD_SET_CANDIDATE_V1_DIGEST
    || record.annotatorAId === record.annotatorBId
  ) {
    throw new Error('Gold-set adjudication identity does not match the candidate set.');
  }
  const inputById = new Map(GOLD_SET_CANDIDATE_V1.cases.map(value => [value.caseId, value]));
  if (
    new Set(record.cases.map(value => value.caseId)).size !== GOLD_SET_CANDIDATE_V1.cases.length
    || record.cases.some((value, index) => value.caseId !== GOLD_SET_CANDIDATE_V1.cases[index]!.caseId)
  ) {
    throw new Error('Gold-set adjudication case order or identity changed.');
  }
  const cases = record.cases.map(annotation => {
    const input = inputById.get(annotation.caseId);
    if (input === undefined) throw new Error('Gold-set adjudication references an unknown case.');
    validateAnnotationFindings(annotation.annotatorAFindings, input);
    validateAnnotationFindings(annotation.annotatorBFindings, input);
    return {
      input,
      expectedFindings: validateAnnotationFindings(annotation.adjudicatedFindings, input),
    };
  });
  const adjudicationDigest = sha256CanonicalJsonV1({
    kind: 'dexter_gold_adjudication',
    version: 1,
    record,
  } as CanonicalJsonValue);
  const goldSetDigest = sha256CanonicalJsonV1({
    kind: 'dexter_gold_set',
    version: 1,
    candidateDigest: GOLD_SET_CANDIDATE_V1_DIGEST,
    adjudicationDigest,
  } as CanonicalJsonValue);
  return {
    version: 1,
    candidateDigest: GOLD_SET_CANDIDATE_V1_DIGEST,
    adjudicationDigest,
    goldSetDigest,
    cases,
  };
}

export async function loadTrackedAdjudicatedGoldSetV1(
  rootDirectory: string = process.cwd(),
): Promise<AdjudicatedGoldSetV1> {
  const path = resolve(rootDirectory, 'src/evaluator/gold/adjudicated-v1.json');
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return validateGoldAdjudicationV1(raw);
}

export function canonicalGoldAdjudicationV1(record: GoldAdjudicationV1): string {
  return `${canonicalJsonV1(record as CanonicalJsonValue)}\n`;
}
