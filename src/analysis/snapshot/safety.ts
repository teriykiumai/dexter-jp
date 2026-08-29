import { posix, win32 } from 'node:path';
import type { CanonicalJsonValue } from './canonical-json.js';

export const SAFETY_POLICY_VERSION = 1 as const;
export const STORED_REPORT_MAX_UTF16_UNITS = 50_000;
export const STORED_REPORT_MAX_UTF8_BYTES = 200_000;
export const EVALUATOR_LOGICAL_INPUT_MAX_UTF16_UNITS = 200_000;

export const SAFETY_CREDENTIAL_ENV_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'MOONSHOT_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'EDINETDB_API_KEY',
  'JQUANTS_API_KEY',
  'EXASEARCH_API_KEY',
  'PERPLEXITY_API_KEY',
  'TAVILY_API_KEY',
  'LANGSEARCH_API_KEY',
  'X_BEARER_TOKEN',
  'LANGSMITH_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'DISCORD_BOT_TOKEN',
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
] as const;

export const EVIDENCE_ENDPOINT_ALLOWLIST_V1 = [
  '/v2/equities/investor-types',
  '/v2/equities/master',
  '/v2/equities/bars/daily',
  '/v2/fins/summary',
  '/v2/fins/dividend',
  '/v2/indices/bars/daily',
  '/v2/markets/calendar',
  '/v2/markets/short-ratio',
] as const;

export type ArtifactSafetyErrorCode =
  | 'credential_value_detected'
  | 'credential_marker_detected'
  | 'private_key_marker_detected'
  | 'disallowed_control_character'
  | 'report_utf16_too_large'
  | 'report_utf8_too_large'
  | 'logical_input_too_large'
  | 'absolute_path_detected';

const SAFETY_ERROR_MESSAGES: Readonly<Record<ArtifactSafetyErrorCode, string>> = {
  credential_value_detected: 'Stored content contains a configured credential value.',
  credential_marker_detected: 'Stored content contains a credential marker.',
  private_key_marker_detected: 'Stored content contains a private-key marker.',
  disallowed_control_character: 'Stored content contains a disallowed control character.',
  report_utf16_too_large: 'The stored report exceeds the UTF-16 size limit.',
  report_utf8_too_large: 'The stored report exceeds the UTF-8 size limit.',
  logical_input_too_large: 'The evaluator logical input exceeds the size limit.',
  absolute_path_detected: 'Evaluator input contains a disallowed absolute path.',
};

const PRIVATE_KEY_MARKER = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const CREDENTIAL_MARKERS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
] as const;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PATH_TOKEN_SPLITTER = /[\s"'`<>()\[\]{}]+/u;
const TRAILING_PATH_PUNCTUATION = /[.,;:!?。、，；：！？]+$/u;
const ALLOWED_ENDPOINTS = new Set<string>(EVIDENCE_ENDPOINT_ALLOWLIST_V1);

export class ArtifactSafetyError extends Error {
  readonly code: ArtifactSafetyErrorCode;

  constructor(code: ArtifactSafetyErrorCode) {
    super(SAFETY_ERROR_MESSAGES[code]);
    this.name = 'ArtifactSafetyError';
    this.code = code;
  }
}

function fail(code: ArtifactSafetyErrorCode): never {
  throw new ArtifactSafetyError(code);
}

function assertContentSafe(content: string, env: NodeJS.ProcessEnv): void {
  for (const name of SAFETY_CREDENTIAL_ENV_NAMES) {
    const configuredValue = env[name];
    if (
      configuredValue !== undefined
      && configuredValue.length >= 8
      && content.includes(configuredValue)
    ) {
      fail('credential_value_detected');
    }
  }
  if (PRIVATE_KEY_MARKER.test(content)) fail('private_key_marker_detected');
  if (CREDENTIAL_MARKERS.some(marker => marker.test(content))) {
    fail('credential_marker_detected');
  }
  if (DISALLOWED_CONTROL.test(content)) fail('disallowed_control_character');
}

export function assertStoredReportSafe(
  reportMarkdown: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (Buffer.byteLength(reportMarkdown, 'utf8') > STORED_REPORT_MAX_UTF8_BYTES) {
    fail('report_utf8_too_large');
  }
  if (reportMarkdown.length > STORED_REPORT_MAX_UTF16_UNITS) {
    fail('report_utf16_too_large');
  }
  assertContentSafe(reportMarkdown, env);
}

function urlProtocol(token: string): string | null {
  try {
    return new URL(token).protocol;
  } catch {
    return null;
  }
}

function assertPathTokensSafe(content: string): void {
  for (const rawToken of content.split(PATH_TOKEN_SPLITTER)) {
    const token = rawToken.replace(TRAILING_PATH_PUNCTUATION, '');
    if (token === '' || token === '/' || ALLOWED_ENDPOINTS.has(token)) continue;
    const protocol = urlProtocol(token);
    if (protocol === 'file:') fail('absolute_path_detected');
    if (protocol === 'http:' || protocol === 'https:') continue;
    if (win32.isAbsolute(token) || posix.isAbsolute(token)) {
      fail('absolute_path_detected');
    }
  }
}

function collectStringValues(value: CanonicalJsonValue, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, output);
  }
}

export interface EvaluatorSafetyInputV1 {
  readonly reportMarkdown: string;
  readonly logicalInput: string;
  readonly evidenceManifest: CanonicalJsonValue;
}

export function assertEvaluatorInputSafe(
  input: EvaluatorSafetyInputV1,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertStoredReportSafe(input.reportMarkdown, env);
  if (input.logicalInput.length > EVALUATOR_LOGICAL_INPUT_MAX_UTF16_UNITS) {
    fail('logical_input_too_large');
  }
  assertContentSafe(input.logicalInput, env);
  assertPathTokensSafe(input.reportMarkdown);
  const manifestStrings: string[] = [];
  collectStringValues(input.evidenceManifest, manifestStrings);
  for (const value of manifestStrings) assertPathTokensSafe(value);
}
