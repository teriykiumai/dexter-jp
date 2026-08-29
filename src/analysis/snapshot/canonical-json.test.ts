import { describe, expect, test } from 'bun:test';
import {
  canonicalJsonV1,
  digestAnalysisSnapshot,
  sha256CanonicalJsonV1,
  type CanonicalJsonValue,
} from './canonical-json.js';

describe('CanonicalJsonV1', () => {
  test('matches the reviewed Japanese, negative-zero, and null golden vector', () => {
    const value = { b: '日本', a: -0, c: null };
    expect(canonicalJsonV1(value)).toBe('{"a":0,"b":"日本","c":null}');
    expect(sha256CanonicalJsonV1(value)).toBe(
      'sha256:adc7d70bc50092a016f02fb4930fe657de189b28ace486f8f7448fbcff6bd1b5',
    );
  });

  test('matches the reviewed absent-optional-key golden vector', () => {
    expect(canonicalJsonV1({ a: 'x' })).toBe('{"a":"x"}');
    expect(sha256CanonicalJsonV1({ a: 'x' })).toBe(
      'sha256:bac82bcae3ff0e486fd02d6dce53dc6444bcbd21f6ab5dea0a69e86e8b723b7f',
    );
  });

  test('matches the reviewed evidence-item and finding ID envelope vectors', () => {
    const evidenceEnvelope = {
      kind: 'dexter_evidence_item_id',
      version: 1,
      manifestVersion: 1,
      scopeId: 'market_correlation',
      definitionKey: 'marketCorrelation.window',
      instanceIdentity: [
        { name: 'benchmark', value: 'TOPIX' },
        { name: 'period', value: 20 },
      ],
    } as const;
    expect(sha256CanonicalJsonV1(evidenceEnvelope)).toBe(
      'sha256:83b8164e241819769d1fe6fde8d7ebf80a2b06fa1bdf49fa616aa8de284eb907',
    );

    const findingEnvelope = {
      kind: 'dexter_evaluation_finding_id',
      version: 1,
      category: 'unsupported_claim',
      importance: 'material',
      claimDomains: ['valuation_metrics'],
      basis: {
        kind: 'manifest_absence',
        reason: 'no_matching_allowlisted_evidence',
        scopeRefs: ['valuation'],
      },
      location: {
        kind: 'single_anchor',
        anchor: { start: 0, end: 2, excerpt: '根拠' },
      },
    } as const;
    expect(sha256CanonicalJsonV1(findingEnvelope)).toBe(
      'sha256:462879a85341fa9c9caf9503fab4e1629e74bdeff3356a77be21a5c6e1b540f1',
    );
  });

  test('matches the reviewed complete artifact-input envelope vector', () => {
    const envelope = {
      kind: 'dexter_evaluator_input',
      version: 1,
      snapshotDigest: `sha256:${'0'.repeat(64)}`,
      evidenceManifestDigest: `sha256:${'1'.repeat(64)}`,
      evaluatorSchemaVersion: 1,
      evidenceManifestVersion: 1,
      rubricVersion: 1,
      promptVersion: 1,
      safetyPolicyVersion: 1,
      qualityGateId: 'qg_v1_terra_high',
      gateManifestDigest: `sha256:${'2'.repeat(64)}`,
      gateAttestationDigest: `sha256:${'3'.repeat(64)}`,
      evaluatorSourceDigest: `sha256:${'4'.repeat(64)}`,
      gateEvaluatedCommitSha: 'a'.repeat(40),
      executionEnvironment: {
        bunVersion: '1.3.14',
        bunRevision: '1.3.14+0d9b296af',
        platform: 'win32',
        arch: 'x64',
        dependencyManifestDigest: `sha256:${'5'.repeat(64)}`,
      },
      runtime: {
        providerId: 'openai',
        modelId: 'gpt-5.6-terra',
        reasoningEffort: 'high',
        providerBoundary: {
          baseUrl: 'https://api.openai.com/v1',
          organizationId: null,
          projectId: null,
          adapterMaxRetries: 0,
          sdkMaxRetries: 0,
        },
      },
    } as const;
    expect(sha256CanonicalJsonV1(envelope)).toBe(
      'sha256:7a0fd8c7bd15c3b9a197bc316e6ba1d63a7f094682a8b80ba9df88433cfcc86e',
    );
  });

  test('sorts every object by UTF-16 key order while preserving array and Unicode form', () => {
    const left = { z: [{ b: 2, a: 1 }], a: 'e\u0301' };
    const right = { a: 'e\u0301', z: [{ a: 1, b: 2 }] };
    expect(canonicalJsonV1(left)).toBe(canonicalJsonV1(right));
    expect(canonicalJsonV1(left)).toBe('{"a":"é","z":[{"a":1,"b":2}]}');
    expect(canonicalJsonV1({ a: 'é' })).not.toBe(canonicalJsonV1({ a: 'e\u0301' }));
    expect(canonicalJsonV1([2, 1])).toBe('[2,1]');
  });

  test('rejects undefined, implicit optional fields, non-finite numbers, and cycles', () => {
    expect(() => canonicalJsonV1(undefined as never)).toThrow(TypeError);
    expect(() => canonicalJsonV1({ a: undefined } as unknown as CanonicalJsonValue))
      .toThrow(TypeError);
    expect(() => canonicalJsonV1({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJsonV1({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    const cyclic: Record<string, CanonicalJsonValue> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJsonV1(cyclic)).toThrow(TypeError);
  });

  test('requires a schema-valid V1-V9 Snapshot before calculating a Snapshot digest', () => {
    expect(() => digestAnalysisSnapshot({ schemaVersion: 9 })).toThrow();
    expect(sha256CanonicalJsonV1({ value: 0 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
