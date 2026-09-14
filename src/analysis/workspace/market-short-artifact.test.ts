import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { MarketDataRepositoryV1 } from '../market-data/repository.js';
import { MarketDataTargetV1Schema } from '../market-data/contracts.js';
import { MARKET_SHORT_COVERAGE_V1, MARKET_SHORT_COVERAGE_DIGEST_V1 } from './market-short-source-gate.js';
import { MARKET_SHORT_SCOPE_V1, WorkspaceMarketShortCodec, marketShortInput, type MarketShortInput } from './market-short-artifact.js';
import { digest, json, objectKey, type ObjectRef } from './contracts.js';
import { retainWorkspaceObject, stageWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { registerReferences, resolveReference, validateReferences, referencePath } from './references.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { backupWorkspace, restoreWorkspace, validateWorkspaceBackup } from './backup.js';
import { fixtureCodecs, fixtureWorkspace } from './test-fixtures.js';

const acceptedAt = '2026-09-14T00:00:00.000Z', checkedAt = '2026-09-14T00:02:00.000Z';
const codec = new WorkspaceMarketShortCodec();
function input(): MarketShortInput {
  return { version: 'workspace_market_short_input_v1', scope: MARKET_SHORT_SCOPE_V1,
    registry: MARKET_SHORT_COVERAGE_V1, registryDigest: MARKET_SHORT_COVERAGE_DIGEST_V1, date: '2026-09-11',
    sourceQualification: 'unverified', correctionVintage: 'current_at_fetch_not_point_in_time',
    source: { endpoint: '/v2/markets/short-ratio', query: { date: '2026-09-11' },
      fetchedAt: '2026-09-14T00:01:00.000Z', pageCount: 1, rowCount: 34, complete: true },
    rows: MARKET_SHORT_COVERAGE_V1.codes.map((S33, i) => ({ Date: '2026-09-11', S33,
      SellExShortVa: 100 * (i + 1), ShrtWithResVa: 20, ShrtNoResVa: 10 })) };
}
function ref(value: MarketShortInput): ObjectRef {
  return { path: `${randomUUID()}.json`, codec: 'workspace_market_short_input_v1', digest: digest(json(value)) };
}
function build(value = input()) { return codec.build(value, ref(value), acceptedAt); }
const fixtures: Awaited<ReturnType<typeof fixtureWorkspace>>[] = [], opened: WorkspaceDatabase[] = [];
const codecs = new Map([...fixtureCodecs, ...workspaceDataCodecs]);
afterEach(() => { opened.splice(0).forEach(db => db.close()); fixtures.splice(0).forEach(f => f.dispose()); });
async function fixture() { const f = await fixtureWorkspace(); fixtures.push(f); return f; }

describe('SW-M1 immutable market inputs and calculation', () => {
  test('rebuilds weighted JPY totals and percent, retaining unverified qualification and exact partition', () => {
    const artifact = build(), totals = artifact.result.totals!;
    expect(totals.nonShortSellingValue).toBe(59_500);
    expect(totals.shortSellingValue).toBe(1_020);
    expect(totals.totalSellingValue).toBe(60_520);
    expect(totals.shortSellingRatioPercent).toBe(100 * (1_020 / 60_520));
    const mean = artifact.input.rows.reduce((sum, row) => sum + 100 * (30 / (row.SellExShortVa! + 30)), 0) / 34;
    expect(totals.shortSellingRatioPercent).not.toBeCloseTo(mean, 3);
    expect(artifact.input.sourceQualification).toBe('unverified');
    expect(artifact.input.scope).toEqual(MARKET_SHORT_SCOPE_V1);
    expect(artifact.result.registryDigest).toBe(MARKET_SHORT_COVERAGE_DIGEST_V1);
    expect(codec.parse(artifact)).toEqual(artifact);
    expect(workspaceDataCodecs.get(artifact.schemaVersion)!(artifact).dependencies).toEqual([artifact.inputReference]);
  });
  test.each(['missing', 'duplicate', 'null', 'empty'] as const)('%s coverage retains evidence without a subset total', reason => {
    const value = input();
    if (reason === 'missing') value.rows.pop();
    if (reason === 'duplicate') value.rows.splice(1, 0, { ...value.rows[0]! });
    if (reason === 'null') value.rows[0]!.SellExShortVa = null;
    if (reason === 'empty') value.rows = [];
    value.source.rowCount = value.rows.length;
    const artifact = build(value);
    expect(artifact.result.state).toBe('unavailable');
    expect(artifact.result.totals).toBeNull();
    expect(codec.parse(artifact).input.rows).toEqual(value.rows);
  });
  test('zero denominator preserves observed zero with an unavailable ratio', () => {
    const value = input(); value.rows.forEach(row => { row.SellExShortVa = 0; row.ShrtWithResVa = 0; row.ShrtNoResVa = 0; });
    expect(build(value).result.totals).toMatchObject({ totalSellingValue: 0, shortSellingValue: 0,
      shortSellingRatioPercent: null, ratioUnavailableReason: 'zero_total_selling_value' });
  });
  test('refetch provenance changes exact bytes but does not change semantic content identity', () => {
    const a = build(), next = input(); next.source.fetchedAt = '2026-09-14T00:03:00.000Z'; next.source.pageCount = 2;
    const b = codec.build(next, ref(next), checkedAt);
    expect(a.artifactDigest).not.toBe(b.artifactDigest);
    expect(a.inputReference).not.toEqual(b.inputReference);
    expect(a.sourcePayloadDigest).toBe(b.sourcePayloadDigest);
    expect(codec.equivalent(a, b)).toBe(true);
    next.rows[0]!.SellExShortVa!++;
    const corrected = codec.build(next, ref(next), checkedAt);
    expect(codec.equivalent(a, corrected)).toBe(false);
    expect(codec.identity(a).rootRelativeIdentity).not.toBe(codec.identity(corrected).rootRelativeIdentity);
  });
  test.each([
    (v: MarketShortInput) => ({ ...v, scope: { kind: 'instrument-owned', instrumentId: randomUUID() } }),
    (v: MarketShortInput) => ({ ...v, scope: { ...v.scope, universe: 'all_japanese_markets' } }),
    (v: MarketShortInput) => ({ ...v, scope: { kind: 'sector-scoped', sectorCode: '0050' } }),
    (v: MarketShortInput) => ({ ...v, registry: { ...MARKET_SHORT_COVERAGE_V1, codes: ['0050'] } }),
    (v: MarketShortInput) => ({ ...v, sourceQualification: 'verified' }),
    (v: MarketShortInput) => ({ ...v, instrumentId: randomUUID() }),
    (v: MarketShortInput) => ({ ...v, source: { ...v.source, complete: false } }),
    (v: MarketShortInput) => ({ ...v, source: { ...v.source, rowCount: 33 } }),
    (v: MarketShortInput) => ({ ...v, source: { ...v.source, pageCount: 6 } }),
    (v: MarketShortInput) => ({ ...v, source: { ...v.source, query: { date: v.date, s33: '0050' } } }),
    (v: MarketShortInput) => ({ ...v, source: { ...v.source, query: { date: '2026-09-10' } } }),
    (v: MarketShortInput) => ({ ...v, rows: [...v.rows].reverse() }),
    (v: MarketShortInput) => ({ ...v, rows: [{ ...v.rows[0], SellExShortVa: -1 }, ...v.rows.slice(1)] }),
    (v: MarketShortInput) => ({ ...v, rows: [{ ...v.rows[0], S33: '0000' }, ...v.rows.slice(1)] }),
    (v: MarketShortInput) => ({ ...v, rows: [{ ...v.rows[0], Date: '2026-09-10' }, ...v.rows.slice(1)] }),
  ])('rejects changed scope/registry/source claims %#', change => {
    expect(() => marketShortInput(change(input()))).toThrow();
  });
  test('rejects unsafe totals, future dates, pre-cutoff collection and incompatible exact input references', () => {
    const value = input(); value.rows.forEach(row => { row.SellExShortVa = Number.MAX_SAFE_INTEGER; });
    expect(() => build(value)).toThrow('unsafe_total');
    const source = input();
    expect(() => codec.build(source, ref(source), '2026-09-10T12:00:00.000Z')).toThrow('reference_conflict');
    expect(() => codec.build(source, ref(source), '2026-09-11T08:29:59.999Z')).toThrow('reference_conflict');
    expect(() => codec.build(source, ref(source), '2026-09-11T08:30:00.000Z')).not.toThrow();
    expect(() => codec.build(source, ref(source), '2026-09-14T00:01:00.001Z')).toThrow('reference_conflict');
    expect(() => codec.build(source, { ...ref(source), codec: 'workspace_supply_artifact_v1' }, acceptedAt)).toThrow('reference_conflict');
    expect(() => codec.build(source, ref({ ...source, date: '2026-09-10' }), acceptedAt)).toThrow('reference_conflict');
  });
  test('rehashing an edited result cannot forge a calculated artifact', () => {
    const { artifactDigest: _digest, ...payload } = build();
    payload.result.totals!.shortSellingRatioPercent = 99;
    expect(() => codec.parse({ ...payload, artifactDigest: digest(json(payload)) })).toThrow('reference_conflict');
    expect(MarketDataTargetV1Schema.safeParse({ ...codec.target, key: 'market_short_other' }).success).toBe(false);
  });
  test('caller mutation cannot change the frozen registry or source rows after build', () => {
    const value: MarketShortInput = JSON.parse(json(input()));
    const artifact = build(value), before = json(artifact);
    (value.registry as { codes: string[] }).codes[0] = '0000';
    value.rows[0]!.SellExShortVa = 99;
    expect(json(artifact)).toBe(before);
    expect(codec.parse(artifact)).toEqual(artifact);
  });
});

describe('SW-M1 exact publication and backup closure without source activation', () => {
  async function publish(f: Awaited<ReturnType<typeof fixture>>, value = input(), cutoff = acceptedAt) {
    const inputRef = await retainWorkspaceObject(f.db, 'workspace_market_short_input_v1', value);
    const repository = new MarketDataRepositoryV1(codec, resolve(f.directory, 'market-data'));
    const observed = await repository.publish(codec.build(value, inputRef, cutoff),
      { jobId: randomUUID(), acceptedAt: cutoff, checkedAt: value.source.fetchedAt });
    const artifact = await retainWorkspaceObject(f.db, observed.artifact.schemaVersion, observed.artifact);
    const receipt = await retainWorkspaceObject(f.db, 'workspace_market_short_receipt_v1',
      { version: 'workspace_market_short_receipt_v1', artifact, receipt: observed.receipt });
    return { inputRef, artifact, receipt, observed, repository };
  }
  test('reuses immutable content, preserves exact old/corrected input, and restores without live files or network', async () => {
    const f = await fixture(), first = await publish(f);
    const next = input(); next.source.fetchedAt = '2026-09-14T00:03:00.000Z';
    const second = await publish(f, next, checkedAt);
    expect(second.observed.state).toBe('idempotent_reuse');
    expect(second.observed.artifact.inputReference).toEqual(first.inputRef);
    expect(second.observed.observationReceiptIdentity).not.toEqual(first.observed.observationReceiptIdentity);
    next.rows[0]!.SellExShortVa!++;
    const corrected = await publish(f, next, checkedAt);
    expect(corrected.observed.state).toBe('published');
    expect((await first.repository.loadObservation(first.observed.observationReceiptIdentity)).artifact).toEqual(first.observed.artifact);
    // Registered objects are persistent roots even without a current binding, Drawing or AI job.
    const packageRoot = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
    f.db.close(); backupWorkspace(f.root, packageRoot, codecs);
    const manifest = validateWorkspaceBackup(packageRoot, codecs);
    for (const saved of [first, second, corrected]) {
      expect(manifest.objects.some(o => objectKey(o.ref) === objectKey(saved.inputRef))).toBe(true);
      expect(manifest.objects.some(o => objectKey(o.ref) === objectKey(saved.receipt))).toBe(true);
    }
    for (const object of manifest.objects) unlinkSync(referencePath(f.root, object.ref));
    restoreWorkspace(packageRoot, restored, codecs);
    const db = new WorkspaceDatabase(restored); opened.push(db);
    expect(validateReferences(db, codecs)).toHaveLength(manifest.objects.length);
    for (const saved of [first, corrected]) {
      expect(JSON.parse(new TextDecoder().decode(resolveReference(db, saved.artifact, codecs).bytes))).toEqual(saved.observed.artifact);
    }
    expect(new WorkspaceRepository(db).freezeIdentity(f.instrumentId)).toEqual(f.identity);
    expect(db.sqlite.query('SELECT * FROM drawings').all()).toHaveLength(0);
    expect(db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(0);
    expect(new WorkspaceRepository(db).current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
  });
  test('market objects cannot be assigned to an instrument, sector, or different universe', async () => {
    const f = await fixture(), saved = await publish(f);
    expect(() => f.repository.bind(f.identity, saved.artifact, saved.receipt, 'market_short')).toThrow('reference_conflict');
    expect(() => f.repository.bindContext({ kind: 'sector-scoped', provider: 'jquants', scheme: 's33',
      sectorCode: '0050', definitionVersion: 'v1' }, saved.artifact, saved.receipt, 'market_short')).toThrow('reference_conflict');
    expect(() => f.repository.bindContext({ ...MARKET_SHORT_SCOPE_V1, universe: 'other' }, saved.artifact, saved.receipt, 'market_short')).toThrow('reference_conflict');
    expect(new WorkspaceRepository(f.db).current(f.scope, 'technical')).toEqual(f.artifact);
  });
  test('receipt claims must match the exact artifact; no latest fallback', async () => {
    const f = await fixture(), saved = await publish(f);
    const changed = input(); changed.rows[0]!.SellExShortVa!++;
    const other = await publish(f, changed);
    await expect(retainWorkspaceObject(f.db, 'workspace_market_short_receipt_v1',
      { version: 'workspace_market_short_receipt_v1', artifact: other.artifact, receipt: saved.observed.receipt }))
      .rejects.toThrow('reference_conflict');
    for (const change of [{ acceptedAt: '2026-09-10T12:00:00.000Z' },
      { acceptedAt: '2026-09-11T08:29:59.999Z' },
      { checkedAt: '2026-09-14T00:00:30.000Z' }]) {
      const { receiptDigest: _digest, ...original } = saved.observed.receipt;
      const payload = { ...original, ...change }, receipt = { ...payload, receiptDigest: digest(json(payload)) };
      await expect(retainWorkspaceObject(f.db, 'workspace_market_short_receipt_v1',
        { version: 'workspace_market_short_receipt_v1', artifact: saved.artifact, receipt })).rejects.toThrow('reference_conflict');
    }
  });
  test('input dependency cannot be omitted from registration or backup', async () => {
    const f = await fixture(), value = input();
    const inputRef = stageWorkspaceObject(f.db, 'workspace_market_short_input_v1', value);
    const artifact = stageWorkspaceObject(f.db, 'workspace_market_short_artifact_v1', codec.build(value, inputRef, acceptedAt));
    unlinkSync(resolve(f.root, 'imports', inputRef.path));
    await expect(registerReferences(f.db, resolve(f.root, 'imports'), [artifact], workspaceDataCodecs)).rejects.toThrow('reference_missing');
    const saved = await publish(f), packageRoot = resolve(f.directory, 'backup');
    f.db.close(); backupWorkspace(f.root, packageRoot, codecs);
    unlinkSync(referencePath(packageRoot, saved.inputRef));
    expect(() => restoreWorkspace(packageRoot, resolve(f.directory, 'restored'), codecs)).toThrow('reference_missing');
  });
});
