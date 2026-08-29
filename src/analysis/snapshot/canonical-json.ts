import { createHash } from 'node:crypto';
import { AnalysisSnapshotSchema, type AnalysisSnapshot } from './schema.js';

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export type SnapshotDigest = `sha256:${string}`;

export type Phase3SnapshotInput = Readonly<{
  snapshotId: string;
  snapshot: AnalysisSnapshot;
  snapshotDigest: SnapshotDigest;
}>;

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('CanonicalJsonV1 accepts finite numbers only.');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new TypeError('CanonicalJsonV1 accepts JSON values only.');
  }
  if (ancestors.has(value)) {
    throw new TypeError('CanonicalJsonV1 does not accept cyclic values.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('CanonicalJsonV1 does not accept sparse arrays.');
        }
        items.push(canonicalize(value[index], ancestors));
      }
      return `[${items.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('CanonicalJsonV1 accepts plain objects only.');
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonV1(value: CanonicalJsonValue): string {
  return canonicalize(value, new Set<object>());
}

export function sha256CanonicalJsonV1(value: CanonicalJsonValue): SnapshotDigest {
  const digest = createHash('sha256').update(canonicalJsonV1(value), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export function canonicalAnalysisSnapshotJsonV1(rawSnapshot: unknown): string {
  const snapshot = AnalysisSnapshotSchema.parse(rawSnapshot);
  return canonicalJsonV1(snapshot as CanonicalJsonValue);
}

export function digestAnalysisSnapshot(rawSnapshot: unknown): SnapshotDigest {
  const snapshot = AnalysisSnapshotSchema.parse(rawSnapshot);
  return sha256CanonicalJsonV1(snapshot as CanonicalJsonValue);
}

export function digestValidatedAnalysisSnapshot(snapshot: AnalysisSnapshot): SnapshotDigest {
  return sha256CanonicalJsonV1(snapshot as CanonicalJsonValue);
}
