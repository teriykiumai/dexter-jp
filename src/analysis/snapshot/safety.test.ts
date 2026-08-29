import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArtifactSafetyError,
  EVIDENCE_ENDPOINT_ALLOWLIST_V1,
  SAFETY_CREDENTIAL_ENV_NAMES,
  assertEvaluatorInputSafe,
  assertStoredReportSafe,
} from './safety.js';

function expectSafetyCode(operation: () => void, code: ArtifactSafetyError['code']): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactSafetyError);
    expect((error as ArtifactSafetyError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code} safety error.`);
}

function evaluatorInput(reportMarkdown: string, manifestValue = 'safe') {
  return {
    reportMarkdown,
    logicalInput: reportMarkdown,
    evidenceManifest: { value: manifestValue },
  } as const;
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  }));
  return nested.flat();
}

describe('SafetyPolicyV1', () => {
  test('rejects every allowlisted configured credential by exact case-sensitive value', () => {
    for (const [index, name] of SAFETY_CREDENTIAL_ENV_NAMES.entries()) {
      const value = `dummy-value-${index}`;
      const env = { [name]: value };
      expectSafetyCode(
        () => assertStoredReportSafe(`prefix ${value} suffix`, env),
        'credential_value_detected',
      );
      expect(() => assertStoredReportSafe(value.toUpperCase(), env)).not.toThrow();
    }
    expect(() => assertStoredReportSafe('short-abc', { OPENAI_API_KEY: 'short' })).not.toThrow();
    expectSafetyCode(
      () => assertStoredReportSafe('credential 😀😀😀😀 found', { OPENAI_API_KEY: '😀😀😀😀' }),
      'credential_value_detected',
    );
  });

  test('keeps the credential allowlist synchronized with configured integrations', async () => {
    const exactFiles = [
      'env.example',
      'src/providers.ts',
      'src/utils/env.ts',
      'src/agent/sdk-env-guard.ts',
      'src/tools/registry.ts',
    ].map(file => join(process.cwd(), file));
    const files = [
      ...exactFiles,
      ...await typescriptFiles(join(process.cwd(), 'src/tools/search')),
      ...await typescriptFiles(join(process.cwd(), 'src/tools/finance')),
      ...await typescriptFiles(join(process.cwd(), 'src/gateway')),
    ];
    const contents = await Promise.all(files.map(file => readFile(file, 'utf8')));
    const discovered = new Set<string>();
    const classifiedNonCredentials = new Set(['HEARTBEAT_OK_TOKEN']);
    const credentialName = /\b[A-Z][A-Z0-9_]*(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|BEARER_TOKEN|BOT_TOKEN|APP_TOKEN|CHANNEL_SECRET|CHANNEL_ACCESS_TOKEN|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/g;
    for (const content of contents) {
      for (const match of content.matchAll(credentialName)) {
        if (!classifiedNonCredentials.has(match[0])) discovered.add(match[0]);
      }
    }
    expect([...discovered].sort()).toEqual([...SAFETY_CREDENTIAL_ENV_NAMES].sort());
    expect(discovered.has('LANGSMITH_API_KEY')).toBeTrue();
  });

  test('rejects the exact marker grammar without exposing matched content', () => {
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----';
    expectSafetyCode(() => assertStoredReportSafe(privateKey, {}), 'private_key_marker_detected');
    const markers = [
      'sk-proj-abcdefghijklmnop',
      'xoxb-abcdefghijklmnop',
      'ghp_abcdefghijklmnopqrst',
      'AKIAABCDEFGHIJKLMNOP',
      'AIzaabcdefghijklmnopqrstuvwxyz123456789',
    ];
    for (const marker of markers) {
      try {
        assertStoredReportSafe(marker, {});
        throw new Error('Expected credential marker failure.');
      } catch (error) {
        expect(error).toBeInstanceOf(ArtifactSafetyError);
        expect((error as ArtifactSafetyError).code).toBe('credential_marker_detected');
        expect((error as Error).message).not.toContain(marker);
      }
    }
    expect(() => assertStoredReportSafe('SK-proj-abcdefghijklmnop', {})).not.toThrow();
    expect(() => assertStoredReportSafe('sk-proj-short', {})).not.toThrow();
  });

  test('allows TAB/LF/CR and rejects every disallowed control boundary', () => {
    expect(() => assertStoredReportSafe('a\tb\nc\rd', {})).not.toThrow();
    const rejected = [
      ...Array.from({ length: 9 }, (_, index) => index),
      0x0b,
      0x0c,
      ...Array.from({ length: 18 }, (_, index) => index + 0x0e),
      0x7f,
    ];
    for (const codePoint of rejected) {
      expectSafetyCode(
        () => assertStoredReportSafe(`a${String.fromCharCode(codePoint)}b`, {}),
        'disallowed_control_character',
      );
    }
    for (const codePoint of [0x09, 0x0a, 0x0d, 0x20]) {
      expect(() => assertStoredReportSafe(`a${String.fromCharCode(codePoint)}b`, {})).not.toThrow();
    }
  });

  test('enforces report and logical-input UTF-16 boundaries including surrogate pairs', () => {
    expect(() => assertStoredReportSafe('a'.repeat(50_000), {})).not.toThrow();
    expect(() => assertStoredReportSafe('😀'.repeat(25_000), {})).not.toThrow();
    expectSafetyCode(
      () => assertStoredReportSafe('😀'.repeat(25_001), {}),
      'report_utf16_too_large',
    );
    expectSafetyCode(
      () => assertStoredReportSafe('日'.repeat(66_667), {}),
      'report_utf8_too_large',
    );
    expectSafetyCode(
      () => assertEvaluatorInputSafe({
        reportMarkdown: 'safe',
        logicalInput: 'a'.repeat(200_001),
        evidenceManifest: {},
      }, {}),
      'logical_input_too_large',
    );
  });

  test('allows exact endpoints, URLs, prose separators, and relative paths', () => {
    const allowed = [
      '# Entry / Stop / Target',
      '# Bull / Base / Bear',
      ...EVIDENCE_ENDPOINT_ALLOWLIST_V1,
      'https://example.test/path?q=1',
      'http://127.0.0.1/test',
      'reports/result.json',
      'ticker-7203',
    ].join('\n');
    expect(() => assertEvaluatorInputSafe(evaluatorInput(allowed), {})).not.toThrow();
    expect(() => assertEvaluatorInputSafe(
      evaluatorInput(`${EVIDENCE_ENDPOINT_ALLOWLIST_V1[0]}、`),
      {},
    )).not.toThrow();
  });

  test('rejects Windows, UNC, POSIX, file URL, and manifest absolute paths', () => {
    const rejected = [
      'C:\\Users\\person\\report.md',
      '\\\\server\\share\\report.md',
      '/home/user/report.md',
      '/tmp/report.md',
      '/var/lib/report.md',
      'file:///tmp/report.md',
      'FILE:///tmp/report.md',
      '/api/analyses/7203',
    ];
    for (const value of rejected) {
      expectSafetyCode(
        () => assertEvaluatorInputSafe(evaluatorInput(value), {}),
        'absolute_path_detected',
      );
    }
    expectSafetyCode(
      () => assertEvaluatorInputSafe(evaluatorInput('safe', 'C:\\private\\manifest.json'), {}),
      'absolute_path_detected',
    );
  });
});
