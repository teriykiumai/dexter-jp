import { createHash } from 'node:crypto';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import {
  EVIDENCE_CLAIM_DOMAINS,
  EVIDENCE_SCOPE_DOMAIN_V1,
  EVIDENCE_SCOPE_IDS,
  EvaluationFindingV1Schema,
  EvaluationFindingWireV1Schema,
  type AvailableFactRefsBasisV1,
  type EvidenceClaimDomainV1,
  type EvidenceFactRefV1,
  type EvidenceItemV1,
  type EvidenceManifestV1,
  type EvaluationFindingIdEnvelopeV1,
  type EvaluationFindingV1,
  type EvaluationFindingWireV1,
  type ManifestAbsenceBasisV1,
  type NonAvailableFactRefsBasisV1,
  type ReportAnchorSetLocationV1,
  type ReportAnchorV1,
} from './schema.js';
import { validateEvidenceManifestV1 } from './manifest.js';

export type EvaluationFindingFailureCodeV1 =
  | 'output_schema_invalid'
  | 'evidence_reference_invalid'
  | 'report_anchor_invalid';

export class EvaluationFindingValidationError extends Error {
  readonly code: EvaluationFindingFailureCodeV1;
  readonly causeValue: unknown;

  constructor(code: EvaluationFindingFailureCodeV1, causeValue?: unknown) {
    const messages: Readonly<Record<EvaluationFindingFailureCodeV1, string>> = {
      output_schema_invalid: 'The Evaluator output did not match the required schema.',
      evidence_reference_invalid: 'The Evaluator output contained an invalid evidence reference.',
      report_anchor_invalid: 'The Evaluator output contained an invalid report anchor.',
    };
    super(messages[code]);
    this.name = 'EvaluationFindingValidationError';
    this.code = code;
    this.causeValue = causeValue;
  }
}

const CATEGORY_ORDER = [
  'unsupported_claim',
  'not_verifiable_from_snapshot',
  'not_verifiable_by_evaluator',
  'internal_inconsistency',
  'unclear_reasoning',
  'missing_caveat',
] as const;

function rawSha256Hex(value: CanonicalJsonValue): string {
  return createHash('sha256').update(canonicalJsonV1(value), 'utf8').digest('hex');
}

function isSurrogateBoundary(report: string, offset: number): boolean {
  if (offset <= 0 || offset >= report.length) return true;
  const previous = report.charCodeAt(offset - 1);
  const current = report.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function validateAnchor(anchor: ReportAnchorV1, report: string): void {
  if (
    anchor.start < 0
    || anchor.start >= anchor.end
    || anchor.end > report.length
    || !isSurrogateBoundary(report, anchor.start)
    || !isSurrogateBoundary(report, anchor.end)
    || report.slice(anchor.start, anchor.end) !== anchor.excerpt
  ) {
    throw new EvaluationFindingValidationError('report_anchor_invalid', anchor);
  }
}

function validateLocation(
  location: EvaluationFindingWireV1['location'],
  report: string,
): void {
  if (location.kind === 'single_anchor') {
    validateAnchor(location.anchor, report);
    return;
  }
  const anchors = (location as ReportAnchorSetLocationV1).anchors;
  let previous: ReportAnchorV1 | undefined;
  const keys = new Set<string>();
  for (const anchor of anchors) {
    validateAnchor(anchor, report);
    const key = `${anchor.start}:${anchor.end}`;
    if (
      keys.has(key)
      || (previous !== undefined && (
        anchor.start < previous.start
        || (anchor.start === previous.start && anchor.end <= previous.end)
        || anchor.start < previous.end
      ))
    ) {
      throw new EvaluationFindingValidationError('report_anchor_invalid', anchors);
    }
    keys.add(key);
    previous = anchor;
  }
}

function assertRegistryOrder<T extends string>(
  values: readonly T[],
  registry: readonly T[],
  code: EvaluationFindingFailureCodeV1,
): void {
  const seen = new Set<T>();
  let previous = -1;
  for (const value of values) {
    const index = registry.indexOf(value);
    if (index < 0 || index <= previous || seen.has(value)) {
      throw new EvaluationFindingValidationError(code, values);
    }
    seen.add(value);
    previous = index;
  }
}

function sameDomains(
  reached: ReadonlySet<EvidenceClaimDomainV1>,
  expected: readonly EvidenceClaimDomainV1[],
): boolean {
  return reached.size === expected.length && expected.every(domain => reached.has(domain));
}

type ResolvedFactRef = Readonly<{
  ref: EvidenceFactRefV1;
  item: EvidenceItemV1;
  itemIndex: number;
  factIndex: number;
  state: 'available' | 'unavailable' | 'not_collected';
}>;

function resolveFactRefs(
  basis: AvailableFactRefsBasisV1 | NonAvailableFactRefsBasisV1,
  manifest: EvidenceManifestV1,
): readonly ResolvedFactRef[] {
  const itemById = new Map(manifest.items.map(item => [item.itemId, item]));
  const refs: ResolvedFactRef[] = [];
  const seen = new Set<string>();
  for (const ref of basis.refs) {
    const item = itemById.get(ref.itemId);
    if (item === undefined) {
      throw new EvaluationFindingValidationError('evidence_reference_invalid', ref);
    }
    const itemIndex = manifest.items.indexOf(item);
    const factIndex = item.facts.findIndex(fact => fact.factKey === ref.factKey);
    const key = `${ref.itemId}\u0000${ref.factKey}`;
    if (factIndex < 0) {
      throw new EvaluationFindingValidationError('evidence_reference_invalid', ref);
    }
    if (seen.has(key)) continue;
    const fact = item.facts[factIndex];
    if (
      (basis.kind === 'available_fact_refs' && fact.state !== 'available')
      || (basis.kind === 'non_available_fact_refs' && fact.state === 'available')
    ) {
      throw new EvaluationFindingValidationError('evidence_reference_invalid', ref);
    }
    refs.push({ ref, item, itemIndex, factIndex, state: fact.state });
    seen.add(key);
  }
  return refs.sort((left, right) => (
    left.itemIndex - right.itemIndex || left.factIndex - right.factIndex
  ));
}

function validateFactBasis(
  finding: EvaluationFindingWireV1,
  basis: AvailableFactRefsBasisV1 | NonAvailableFactRefsBasisV1,
  manifest: EvidenceManifestV1,
): void {
  const refs = resolveFactRefs(basis, manifest);
  const scopeById = new Map(manifest.scopes.map(scope => [scope.scopeId, scope]));
  if (basis.kind === 'non_available_fact_refs' && refs.some(value => {
    const scope = scopeById.get(value.item.scopeId);
    return scope === undefined
      || scope.state !== 'available'
      || scope.coverage !== 'complete_for_domain';
  })) {
    throw new EvaluationFindingValidationError('evidence_reference_invalid', basis);
  }
  const reached = new Set(refs.map(value => EVIDENCE_SCOPE_DOMAIN_V1[value.item.scopeId]));
  if (!sameDomains(reached, finding.claimDomains)) {
    throw new EvaluationFindingValidationError('evidence_reference_invalid', basis);
  }
}

function canonicalizeEvidenceBasis(
  finding: EvaluationFindingWireV1,
  manifest: EvidenceManifestV1,
): EvaluationFindingWireV1 {
  const basis = finding.basis;
  if (basis.kind === 'available_fact_refs' || basis.kind === 'non_available_fact_refs') {
    const refs = resolveFactRefs(basis, manifest).map(value => value.ref);
    return { ...finding, basis: { kind: basis.kind, refs } } as EvaluationFindingWireV1;
  }
  if (basis.kind === 'manifest_absence') {
    const scopeRefs = [...new Set(basis.scopeRefs)].sort((left, right) => (
      EVIDENCE_SCOPE_IDS.indexOf(left) - EVIDENCE_SCOPE_IDS.indexOf(right)
    ));
    return {
      ...finding,
      basis: { kind: basis.kind, scopeRefs, reason: basis.reason },
    } as EvaluationFindingWireV1;
  }
  return finding;
}

function validateAbsenceBasis(
  finding: EvaluationFindingWireV1,
  basis: ManifestAbsenceBasisV1,
  manifest: EvidenceManifestV1,
): void {
  assertRegistryOrder(basis.scopeRefs, EVIDENCE_SCOPE_IDS, 'evidence_reference_invalid');
  const scopeById = new Map(manifest.scopes.map(scope => [scope.scopeId, scope]));
  const scopes = basis.scopeRefs.map(scopeId => {
    const scope = scopeById.get(scopeId);
    if (scope === undefined) {
      throw new EvaluationFindingValidationError('evidence_reference_invalid', scopeId);
    }
    return scope;
  });
  const reached = new Set(scopes.map(scope => scope.claimDomain));
  if (!sameDomains(reached, finding.claimDomains)) {
    throw new EvaluationFindingValidationError('evidence_reference_invalid', basis);
  }
  const compatible = scopes.every(scope => {
    switch (basis.reason) {
      case 'no_matching_allowlisted_evidence':
        return scope.state === 'available' && scope.coverage === 'complete_for_domain';
      case 'relevant_evidence_unavailable':
        return (scope.state === 'unavailable' || scope.state === 'not_collected')
          && scope.coverage === 'partial';
      case 'persisted_evidence_not_sent':
        return scope.state === 'persisted_but_excluded'
          && scope.coverage === 'excluded_from_manifest';
      case 'outside_snapshot_scope':
        return scope.state === 'outside_snapshot_scope'
          && scope.coverage === 'outside_snapshot_scope';
    }
  });
  if (!compatible) {
    throw new EvaluationFindingValidationError('evidence_reference_invalid', basis);
  }
}

function validateCategoryBasis(
  finding: EvaluationFindingWireV1,
  manifest: EvidenceManifestV1,
): void {
  const basis = finding.basis;
  switch (finding.category) {
    case 'unsupported_claim':
      if (basis.kind !== 'manifest_absence' || basis.reason !== 'no_matching_allowlisted_evidence') {
        throw new EvaluationFindingValidationError('output_schema_invalid', finding);
      }
      validateAbsenceBasis(finding, basis, manifest);
      return;
    case 'not_verifiable_from_snapshot':
      if (basis.kind === 'non_available_fact_refs') {
        validateFactBasis(finding, basis, manifest);
        return;
      }
      if (
        basis.kind !== 'manifest_absence'
        || !['relevant_evidence_unavailable', 'outside_snapshot_scope'].includes(basis.reason)
      ) {
        throw new EvaluationFindingValidationError('output_schema_invalid', finding);
      }
      validateAbsenceBasis(finding, basis, manifest);
      return;
    case 'not_verifiable_by_evaluator':
      if (basis.kind !== 'manifest_absence' || basis.reason !== 'persisted_evidence_not_sent') {
        throw new EvaluationFindingValidationError('output_schema_invalid', finding);
      }
      validateAbsenceBasis(finding, basis, manifest);
      return;
    case 'internal_inconsistency':
      if (basis.kind === 'report_contradiction') return;
      if (basis.kind === 'available_fact_refs') {
        validateFactBasis(finding, basis, manifest);
        return;
      }
      throw new EvaluationFindingValidationError('output_schema_invalid', finding);
    case 'unclear_reasoning':
      if (basis.kind === 'available_fact_refs') {
        validateFactBasis(finding, basis, manifest);
        return;
      }
      throw new EvaluationFindingValidationError('output_schema_invalid', finding);
    case 'missing_caveat':
      if (basis.kind === 'manifest_absence') validateAbsenceBasis(finding, basis, manifest);
      else if (basis.kind === 'available_fact_refs' || basis.kind === 'non_available_fact_refs') {
        validateFactBasis(finding, basis, manifest);
      } else {
        throw new EvaluationFindingValidationError('output_schema_invalid', finding);
      }
  }
}

function createFindingId(finding: EvaluationFindingWireV1): string {
  const envelope: EvaluationFindingIdEnvelopeV1 = {
    kind: 'dexter_evaluation_finding_id',
    version: 1,
    category: finding.category,
    claimDomains: finding.claimDomains as [EvidenceClaimDomainV1, ...EvidenceClaimDomainV1[]],
    importance: finding.importance,
    location: finding.location,
    basis: finding.basis,
  };
  return `f_${rawSha256Hex(envelope as CanonicalJsonValue).slice(0, 24)}`;
}

function firstAnchorStart(finding: EvaluationFindingV1): number {
  return finding.location.kind === 'single_anchor'
    ? finding.location.anchor.start
    : finding.location.anchors[0].start;
}

function compareFindings(left: EvaluationFindingV1, right: EvaluationFindingV1): number {
  const importance = (left.importance === 'material' ? 0 : 1)
    - (right.importance === 'material' ? 0 : 1);
  if (importance !== 0) return importance;
  const anchor = firstAnchorStart(left) - firstAnchorStart(right);
  if (anchor !== 0) return anchor;
  const category = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
  if (category !== 0) return category;
  return left.findingId < right.findingId ? -1 : left.findingId > right.findingId ? 1 : 0;
}

export function validateEvaluationFindingWireV1(
  rawFinding: unknown,
  report: string,
  rawManifest: unknown,
): EvaluationFindingV1 {
  const parsed = EvaluationFindingWireV1Schema.safeParse(rawFinding);
  if (!parsed.success) {
    throw new EvaluationFindingValidationError('output_schema_invalid', parsed.error);
  }
  const parsedFinding = parsed.data;
  if (parsedFinding.summary.trim() !== parsedFinding.summary) {
    throw new EvaluationFindingValidationError('output_schema_invalid', 'summary whitespace');
  }
  assertRegistryOrder(
    parsedFinding.claimDomains,
    EVIDENCE_CLAIM_DOMAINS,
    'evidence_reference_invalid',
  );
  validateLocation(parsedFinding.location, report);
  const manifest = validateEvidenceManifestV1(rawManifest);
  const finding = canonicalizeEvidenceBasis(parsedFinding, manifest);
  validateCategoryBasis(finding, manifest);
  const withId = { ...finding, findingId: createFindingId(finding) };
  const complete = EvaluationFindingV1Schema.safeParse(withId);
  if (!complete.success) {
    throw new EvaluationFindingValidationError('output_schema_invalid', complete.error);
  }
  return complete.data;
}

export function validateEvaluationFindingsWireV1(
  rawFindings: unknown,
  report: string,
  rawManifest: unknown,
): readonly EvaluationFindingV1[] {
  if (!Array.isArray(rawFindings) || rawFindings.length > 20) {
    throw new EvaluationFindingValidationError('output_schema_invalid', rawFindings);
  }
  const manifest = validateEvidenceManifestV1(rawManifest);
  const findings = rawFindings.map(finding => (
    validateEvaluationFindingWireV1(finding, report, manifest)
  ));
  const ids = new Set<string>();
  for (const finding of findings) {
    if (ids.has(finding.findingId)) {
      throw new EvaluationFindingValidationError('evidence_reference_invalid', finding.findingId);
    }
    ids.add(finding.findingId);
  }
  return findings.sort(compareFindings);
}

function withoutFindingId(finding: EvaluationFindingV1): EvaluationFindingWireV1 {
  const { findingId: _findingId, ...wire } = finding;
  return wire;
}

export function validatePersistedEvaluationFindingsV1(
  rawFindings: unknown,
  report: string,
  rawManifest: unknown,
): readonly EvaluationFindingV1[] {
  if (!Array.isArray(rawFindings) || rawFindings.length > 20) {
    throw new EvaluationFindingValidationError('output_schema_invalid', rawFindings);
  }
  const parsed = rawFindings.map(raw => {
    const result = EvaluationFindingV1Schema.safeParse(raw);
    if (!result.success) {
      throw new EvaluationFindingValidationError('output_schema_invalid', result.error);
    }
    return result.data;
  });
  const regenerated = validateEvaluationFindingsWireV1(
    parsed.map(withoutFindingId),
    report,
    rawManifest,
  );
  if (canonicalJsonV1(parsed as CanonicalJsonValue) !== canonicalJsonV1(regenerated as CanonicalJsonValue)) {
    throw new EvaluationFindingValidationError('evidence_reference_invalid', 'persisted ordering or ID');
  }
  return regenerated;
}
