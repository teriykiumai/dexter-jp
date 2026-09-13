import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { isStrictGregorianDate } from '../strategy-validation/date.js';
import { assertMarketDataSafeV1 } from '../market-data/contracts.js';

export type WorkspaceErrorCode = 'invalid_input' | 'not_found' | 'revision_conflict'
  | 'identity_review_required' | 'reference_conflict' | 'reference_missing'
  | 'schema_unsupported' | 'database_invalid' | 'database_busy' | 'sqlite_unsupported' | 'storage_unsafe'
  | 'maintenance_required' | 'backup_invalid';
export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode) { super(`Workspace: ${code}`); }
}
export function fail(code: WorkspaceErrorCode): never { throw new WorkspaceError(code); }
export const Id = z.uuid();
export const Token = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const DateValue = z.string().refine(isStrictGregorianDate);
export const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RelativePath = z.string().max(500).refine(value => value.split('/').every(part =>
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.')
  && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)));
export const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('instrument-owned'), instrumentId: Id }).strict(),
  z.object({ kind: z.literal('sector-scoped'), provider: Token, scheme: Token,
    sectorCode: Token, definitionVersion: Token }).strict(),
  z.object({ kind: z.literal('market-scoped'), universe: Token, definitionVersion: Token }).strict(),
]);
export type WorkspaceScope = z.infer<typeof ScopeSchema>;
export const ObjectRefSchema = z.object({ path: RelativePath, codec: Token, digest: Digest }).strict();
export type ObjectRef = z.infer<typeof ObjectRefSchema>;
export const ObjectMetadataSchema = z.object({ scope: ScopeSchema, effectiveDate: DateValue,
  sourceDefinition: Token, calculationVersion: Token,
  dependencies: z.array(ObjectRefSchema).max(1000) }).strict();
export type ObjectMetadata = z.infer<typeof ObjectMetadataSchema>;
export type ReferenceCodec = (value: unknown) => ObjectMetadata;
export type ReferenceCodecs = ReadonlyMap<string, ReferenceCodec>;
export const FrozenIdentitySchema = z.object({ instrumentId: Id, provider: Token, code: Token,
  mappingRevision: z.number().int().positive(), catalogGeneration: z.number().int().positive() }).strict();
export type FrozenIdentity = z.infer<typeof FrozenIdentitySchema>;
export const PreferencesSchema = z.object({ interval: z.enum(['day', 'week', 'month']),
  sma: z.array(z.number().int().min(2).max(250)).max(8), rsi: z.boolean(), macd: z.boolean(),
  volume: z.boolean() }).strict();
export type ChartPreferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PREFERENCES: ChartPreferences = { interval: 'day', sma: [20], rsi: true, macd: true, volume: true };
const drawingBase = z.object({ id: Id, instrumentId: Id,
  price: z.number().positive().finite(), time: DateValue, evidenceFrom: DateValue,
  evidenceThrough: DateValue, basisObject: ObjectRefSchema, revision: z.number().int().positive() });
export const DrawingSchema = z.discriminatedUnion('kind', [
  drawingBase.extend({ kind: z.literal('horizontal') }).strict(),
  drawingBase.extend({ kind: z.literal('trendline'), endTime: DateValue, endPrice: z.number().positive().finite() }).strict(),
]).refine(d => d.evidenceFrom <= d.time && d.time <= d.evidenceThrough
  && (d.kind === 'horizontal' || (d.time < d.endTime && d.endTime <= d.evidenceThrough)));
export type StoredDrawing = z.infer<typeof DrawingSchema>;
export function restoredDrawing(anchors: string, basisObject: ObjectRef, revision: number): StoredDrawing {
  const value: unknown = JSON.parse(anchors);
  if (!value || typeof value !== 'object' || 'basisObject' in value || 'revision' in value) fail('invalid_input');
  return parse(DrawingSchema, { ...value, basisObject, revision });
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail('invalid_input');
  return result.data;
}
export function json(value: unknown): string { return canonicalJsonV1(value as CanonicalJsonValue); }
export function digest(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
export function safe(value: unknown): void {
  try { assertMarketDataSafeV1(value as CanonicalJsonValue, process.env); }
  catch { fail('invalid_input'); }
}
export function objectKey(ref: ObjectRef): string { return digest(json(parse(ObjectRefSchema, ref))); }
export function scopeKey(scope: WorkspaceScope): string { return json(parse(ScopeSchema, scope)); }
