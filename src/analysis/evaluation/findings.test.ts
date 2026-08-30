import { describe, expect, test } from 'bun:test';
import { comparisonSnapshot, snapshotAtVersion } from '../comparison/test-fixtures.js';
import {
  EvaluationFindingValidationError,
  validateEvaluationFindingsWireV1,
  validateEvaluationFindingWireV1,
  validatePersistedEvaluationFindingsV1,
} from './findings.js';
import { buildEvidenceManifestV1 } from './manifest.js';

describe('Evaluation finding V1 validation', () => {
  test('implements the reviewed unsupported-claim finding ID golden vector', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const finding = validateEvaluationFindingWireV1({
      category: 'unsupported_claim',
      claimDomains: ['valuation_metrics'],
      importance: 'material',
      summary: '根拠がない評価主張です。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '根拠' } },
      basis: {
        kind: 'manifest_absence',
        scopeRefs: ['valuation'],
        reason: 'no_matching_allowlisted_evidence',
      },
    }, '根拠', manifest);
    expect(finding.findingId).toBe('f_462879a85341fa9c9caf9503');
  });

  test('resolves exact available and non-available fact refs with domain coverage', () => {
    const current = buildEvidenceManifestV1(comparisonSnapshot());
    const availableItem = current.items.find(item => item.definitionKey === 'valuation.currentPrice');
    if (availableItem === undefined) throw new Error('expected valuation evidence');
    const available = validateEvaluationFindingWireV1({
      category: 'internal_inconsistency',
      claimDomains: ['valuation_metrics'],
      importance: 'material',
      summary: '保存値と矛盾します。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '株価' } },
      basis: {
        kind: 'available_fact_refs',
        refs: [{ itemId: availableItem.itemId, factKey: 'value' }],
      },
    }, '株価', current);
    expect(available.basis.kind).toBe('available_fact_refs');

    const old = buildEvidenceManifestV1(snapshotAtVersion(comparisonSnapshot(), 1));
    const missing20Day = old.items.find(item => (
      item.definitionKey === 'marketCorrelation.window'
      && item.instanceIdentity.some(value => value.name === 'period' && value.value === 20)
    ));
    if (missing20Day === undefined) throw new Error('expected fixed 20-day evidence');
    const unavailable = validateEvaluationFindingWireV1({
      category: 'not_verifiable_from_snapshot',
      claimDomains: ['market_correlation_windows'],
      importance: 'advisory',
      summary: '旧schemaでは20日窓を確認できません。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 4, excerpt: '20日窓' } },
      basis: {
        kind: 'non_available_fact_refs',
        refs: [{ itemId: missing20Day.itemId, factKey: 'observations' }],
      },
    }, '20日窓', old);
    expect(unavailable.basis.kind).toBe('non_available_fact_refs');
  });

  test('canonicalizes duplicate and reversed provider refs before hashing', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const valuationRefs = manifest.items
      .filter(item => ['valuation.currentPrice', 'valuation.per'].includes(item.definitionKey))
      .map(item => ({ itemId: item.itemId, factKey: 'value' }));
    if (valuationRefs.length !== 2) throw new Error('expected valuation evidence');
    const finding = {
      category: 'internal_inconsistency' as const,
      claimDomains: ['valuation_metrics'] as const,
      importance: 'material' as const,
      summary: '保存値と矛盾します。',
      location: { kind: 'single_anchor' as const, anchor: { start: 0, end: 2, excerpt: '株価' } },
      basis: {
        kind: 'available_fact_refs' as const,
        refs: [valuationRefs[1], valuationRefs[0], valuationRefs[1]],
      },
    };
    const normalized = validateEvaluationFindingWireV1(finding, '株価', manifest);
    const canonical = validateEvaluationFindingWireV1({
      ...finding,
      basis: { ...finding.basis, refs: valuationRefs },
    }, '株価', manifest);
    expect(normalized.basis).toEqual({ kind: 'available_fact_refs', refs: valuationRefs });
    expect(normalized.findingId).toBe(canonical.findingId);

    const absence = {
      category: 'unsupported_claim' as const,
      claimDomains: ['valuation_metrics', 'technical_metrics'] as const,
      importance: 'material' as const,
      summary: '根拠がありません。',
      location: { kind: 'single_anchor' as const, anchor: { start: 0, end: 2, excerpt: '根拠' } },
      basis: {
        kind: 'manifest_absence' as const,
        scopeRefs: ['technical', 'valuation', 'technical'] as const,
        reason: 'no_matching_allowlisted_evidence' as const,
      },
    };
    const normalizedAbsence = validateEvaluationFindingWireV1(absence, '根拠', manifest);
    const canonicalAbsence = validateEvaluationFindingWireV1({
      ...absence,
      basis: { ...absence.basis, scopeRefs: ['valuation', 'technical'] },
    }, '根拠', manifest);
    expect(normalizedAbsence.basis).toEqual({
      kind: 'manifest_absence', scopeRefs: ['valuation', 'technical'],
      reason: 'no_matching_allowlisted_evidence',
    });
    expect(normalizedAbsence.findingId).toBe(canonicalAbsence.findingId);
  });

  test('requires manifest absence when an entire scope is unavailable', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const peer = manifest.items.find(item => item.definitionKey === 'peerComparison.position');
    if (peer === undefined) throw new Error('expected peer placeholder evidence');
    expect(peer.facts[0].state).not.toBe('available');
    const finding = {
      category: 'not_verifiable_from_snapshot' as const,
      claimDomains: ['peer_positions'] as const,
      importance: 'advisory' as const,
      summary: 'Peer比較全体を確認できません。',
      location: { kind: 'single_anchor' as const, anchor: { start: 0, end: 6, excerpt: 'Peer比較' } },
    };
    expect(() => validateEvaluationFindingWireV1({
      ...finding,
      basis: {
        kind: 'non_available_fact_refs',
        refs: [{ itemId: peer.itemId, factKey: peer.facts[0].factKey }],
      },
    }, 'Peer比較', manifest)).toThrow(EvaluationFindingValidationError);

    const accepted = validateEvaluationFindingWireV1({
      ...finding,
      basis: {
        kind: 'manifest_absence', scopeRefs: ['peer_comparison'],
        reason: 'relevant_evidence_unavailable',
      },
    }, 'Peer比較', manifest);
    expect(accepted.basis).toEqual({
      kind: 'manifest_absence', scopeRefs: ['peer_comparison'],
      reason: 'relevant_evidence_unavailable',
    });

    const oldManifest = buildEvidenceManifestV1(snapshotAtVersion(comparisonSnapshot(), 1));
    const sector = oldManifest.items.find(item => item.definitionKey === 'sectorBenchmark.identity');
    if (sector === undefined) throw new Error('expected sector placeholder evidence');
    expect(() => validateEvaluationFindingWireV1({
      category: 'not_verifiable_from_snapshot',
      claimDomains: ['sector_benchmark_persisted_windows'],
      importance: 'advisory',
      summary: '旧schemaではセクター比較を確認できません。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 6, excerpt: 'セクター比較' } },
      basis: {
        kind: 'non_available_fact_refs',
        refs: [{ itemId: sector.itemId, factKey: sector.facts[0].factKey }],
      },
    }, 'セクター比較', oldManifest)).toThrow(EvaluationFindingValidationError);
    const oldAccepted = validateEvaluationFindingWireV1({
      category: 'not_verifiable_from_snapshot',
      claimDomains: ['sector_benchmark_persisted_windows'],
      importance: 'advisory',
      summary: '旧schemaではセクター比較を確認できません。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 6, excerpt: 'セクター比較' } },
      basis: {
        kind: 'manifest_absence', scopeRefs: ['sector_benchmark'],
        reason: 'relevant_evidence_unavailable',
      },
    }, 'セクター比較', oldManifest);
    expect(oldAccepted.basis.kind).toBe('manifest_absence');
  });

  test('distinguishes outside scope and intentionally excluded persisted evidence', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const outside = validateEvaluationFindingWireV1({
      category: 'not_verifiable_from_snapshot',
      claimDomains: ['outside_filing_narrative'],
      importance: 'advisory',
      summary: '提出書類本文はSnapshot外です。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '提出' } },
      basis: {
        kind: 'manifest_absence', scopeRefs: ['outside_filing_narrative'],
        reason: 'outside_snapshot_scope',
      },
    }, '提出', manifest);
    expect(outside.category).toBe('not_verifiable_from_snapshot');

    const excluded = validateEvaluationFindingWireV1({
      category: 'not_verifiable_by_evaluator',
      claimDomains: ['price_history_series'],
      importance: 'advisory',
      summary: '価格系列はEvaluatorへ送っていません。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '価格' } },
      basis: {
        kind: 'manifest_absence', scopeRefs: ['price_history_series'],
        reason: 'persisted_evidence_not_sent',
      },
    }, '価格', manifest);
    expect(excluded.category).toBe('not_verifiable_by_evaluator');

    expect(() => validateEvaluationFindingWireV1({
      category: 'unsupported_claim',
      claimDomains: ['outside_filing_narrative'],
      importance: 'material',
      summary: '誤った分類です。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '提出' } },
      basis: {
        kind: 'manifest_absence', scopeRefs: ['outside_filing_narrative'],
        reason: 'no_matching_allowlisted_evidence',
      },
    }, '提出', manifest)).toThrow(EvaluationFindingValidationError);
  });

  test('accepts only ordered non-overlapping 2-4 anchor report contradictions', () => {
    const report = '利益は増加。利益は減少。';
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const finding = validateEvaluationFindingWireV1({
      category: 'internal_inconsistency',
      claimDomains: ['fundamental_periods'],
      importance: 'material',
      summary: '報告本文内で方向が矛盾します。',
      location: {
        kind: 'report_anchor_set',
        anchors: [
          { start: 0, end: 5, excerpt: '利益は増加' },
          { start: 6, end: 11, excerpt: '利益は減少' },
        ],
      },
      basis: { kind: 'report_contradiction' },
    }, report, manifest);
    expect(finding.location.kind).toBe('report_anchor_set');

    expect(() => validateEvaluationFindingWireV1({
      category: 'internal_inconsistency',
      claimDomains: ['fundamental_periods'],
      importance: 'material',
      summary: '重複anchorです。',
      location: {
        kind: 'report_anchor_set',
        anchors: [
          { start: 0, end: 5, excerpt: '利益は増加' },
          { start: 4, end: 8, excerpt: '加。利益' },
        ],
      },
      basis: { kind: 'report_contradiction' },
    }, report, manifest)).toThrow(EvaluationFindingValidationError);
  });

  test('rejects surrogate-splitting anchors, fabricated refs, wrong order, and duplicate IDs', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const base = {
      category: 'unsupported_claim' as const,
      claimDomains: ['valuation_metrics'] as const,
      importance: 'material' as const,
      summary: '根拠がありません。',
      location: { kind: 'single_anchor' as const, anchor: { start: 0, end: 2, excerpt: '根拠' } },
      basis: {
        kind: 'manifest_absence' as const, scopeRefs: ['valuation'] as const,
        reason: 'no_matching_allowlisted_evidence' as const,
      },
    };
    expect(() => validateEvaluationFindingWireV1({
      ...base,
      location: { kind: 'single_anchor', anchor: { start: 1, end: 2, excerpt: '\ude00' } },
    }, '😀', manifest)).toThrow(EvaluationFindingValidationError);

    const valuation = manifest.items.find(item => item.definitionKey === 'valuation.currentPrice');
    if (valuation === undefined) throw new Error('expected valuation evidence');
    expect(() => validateEvaluationFindingWireV1({
      category: 'internal_inconsistency', claimDomains: ['valuation_metrics'],
      importance: 'material', summary: 'refが不正です。',
      location: base.location,
      basis: { kind: 'available_fact_refs', refs: [{ itemId: valuation.itemId, factKey: 'private' }] },
    }, '根拠', manifest)).toThrow(EvaluationFindingValidationError);

    expect(() => validateEvaluationFindingWireV1({
      ...base,
      claimDomains: ['technical_metrics', 'valuation_metrics'],
      basis: {
        ...base.basis,
        scopeRefs: ['technical', 'valuation'],
      },
    }, '根拠', manifest)).toThrow(EvaluationFindingValidationError);

    expect(() => validateEvaluationFindingsWireV1([
      base,
      { ...base, summary: '別summaryでも同じ契約IDです。' },
    ], '根拠', manifest)).toThrow(EvaluationFindingValidationError);
  });

  test('persists only canonical finding IDs and canonical result order', () => {
    const manifest = buildEvidenceManifestV1(comparisonSnapshot());
    const wire = [{
      category: 'unsupported_claim', claimDomains: ['valuation_metrics'],
      importance: 'material', summary: '根拠がありません。',
      location: { kind: 'single_anchor', anchor: { start: 0, end: 2, excerpt: '根拠' } },
      basis: {
        kind: 'manifest_absence', scopeRefs: ['valuation'],
        reason: 'no_matching_allowlisted_evidence',
      },
    }];
    const findings = validateEvaluationFindingsWireV1(wire, '根拠', manifest);
    expect(validatePersistedEvaluationFindingsV1(findings, '根拠', manifest)).toEqual(findings);
    const corrupt = [{ ...findings[0], findingId: 'f_000000000000000000000000' }];
    expect(() => validatePersistedEvaluationFindingsV1(corrupt, '根拠', manifest))
      .toThrow(EvaluationFindingValidationError);
  });
});
