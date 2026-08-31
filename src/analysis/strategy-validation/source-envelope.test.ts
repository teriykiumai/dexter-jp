import { describe, expect, test } from 'bun:test';
import {
  createPointInTimeSourceEnvelopeV1,
  validatePointInTimeSourceEnvelopeV1,
} from './index.js';

function input() {
  return {
    sourceMappingVersion: 'jquants_calendar_v1',
    endpoint: '/v2/markets/calendar',
    query: [
      { name: 'to', value: '2025-01-03' },
      { name: 'from', value: '2025-01-01' },
    ],
    request: {
      ticker: null,
      dateFrom: '2025-01-01',
      dateTo: '2025-01-03',
      asOfCutoff: '2025-01-03T14:59:59.999Z',
    },
    fetchedAt: '2025-01-04T00:00:00.000Z',
    result: {
      state: 'available',
      rows: [
        { date: '2025-01-03', holidayDivision: '1' },
        { holidayDivision: '0', date: '2025-01-01' },
      ],
    },
  } as const;
}

describe('PointInTimeSourceEnvelopeV1', () => {
  test('normalizes query and used-row order without mutating input, then validates its digest', () => {
    const value = input();
    const before = structuredClone(value);
    const envelope = createPointInTimeSourceEnvelopeV1(value);
    expect(value).toEqual(before);
    expect(envelope.query.map(item => item.name)).toEqual(['from', 'to']);
    expect(envelope.result.rows.map(row => row.date)).toEqual(['2025-01-01', '2025-01-03']);
    expect(envelope.digest).toBe(
      'sha256:8494177211f6787760a260fe5ec35f525e0568bf3a3a18ea5e72ef57743ff3d8',
    );
    expect(validatePointInTimeSourceEnvelopeV1(envelope)).toEqual(envelope);
  });

  test('produces the same digest for equal canonical content and a different digest for used content', () => {
    const left = createPointInTimeSourceEnvelopeV1(input());
    const reordered = input();
    const right = createPointInTimeSourceEnvelopeV1({
      ...reordered,
      query: [...reordered.query].reverse(),
      result: { ...reordered.result, rows: [...reordered.result.rows].reverse() },
    });
    const changed = createPointInTimeSourceEnvelopeV1({
      ...input(),
      fetchedAt: '2025-01-04T00:00:00.001Z',
    });
    expect(right.digest).toBe(left.digest);
    expect(changed.digest).not.toBe(left.digest);
  });

  test('rejects digest tampering, extra fields, credentials, duplicate rows, and non-allowlisted endpoints', () => {
    const envelope = createPointInTimeSourceEnvelopeV1(input());
    expect(() => validatePointInTimeSourceEnvelopeV1({
      ...envelope,
      digest: `sha256:${'0'.repeat(64)}`,
    })).toThrow('digest or normalization');
    expect(() => validatePointInTimeSourceEnvelopeV1({ ...envelope, rawBody: '{}' })).toThrow('shape');
    let credentialError: unknown;
    try {
      createPointInTimeSourceEnvelopeV1({
        ...input(), query: [{ name: 'api_key', value: 'do-not-store' }],
      });
    } catch (error) {
      credentialError = error;
    }
    expect(String(credentialError)).toContain('unsafe');
    expect(JSON.stringify(credentialError)).not.toContain('do-not-store');
    expect(() => createPointInTimeSourceEnvelopeV1({
      ...input(), result: { state: 'available', rows: [{ date: '2025-01-01' }, { date: '2025-01-01' }] },
    })).toThrow('duplicates');
    expect(() => createPointInTimeSourceEnvelopeV1({
      ...input(), endpoint: '/v2/not-allowlisted',
    })).toThrow('not allowlisted');
  });

  test('requires typed unavailable classification and zero rows', () => {
    const unavailable = createPointInTimeSourceEnvelopeV1({
      ...input(),
      result: { state: 'unavailable', reason: 'source_plan_unavailable', rows: [] },
    });
    expect(unavailable.result).toEqual({
      state: 'unavailable', reason: 'source_plan_unavailable', rows: [],
    });
    expect(() => createPointInTimeSourceEnvelopeV1({
      ...input(),
      result: {
        state: 'unavailable', reason: 'source_plan_unavailable',
        rows: [{ date: '2025-01-01' }],
      },
    })).toThrow('allowed reason and no rows');
    expect(() => createPointInTimeSourceEnvelopeV1({
      ...input(), result: { state: 'available', rows: [] },
    })).toThrow('must contain rows');
  });
});
