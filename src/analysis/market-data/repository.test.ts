import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { canonicalJsonV1, sha256CanonicalJsonV1 } from '../snapshot/canonical-json.js';
import { MarketDataRepositoryV1, type MarketDataRepositoryOptionsV1 } from './repository.js';
import { MarketDataFilesV1, MarketDataRecoveryBudgetV1, MARKET_DATA_RECOVERY_LIMITS_V1 } from './repository-files.js';
import { MarketDataRepositoryErrorV1, receiptIdentityV1, type MarketDataObservationReceiptV1,
  type MarketDataRepositoryErrorCodeV1 } from './contracts.js';
import { fixtureArtifact, fixtureCodec, fixtureDraft, observationFor } from './repository-test-fixtures.js';

const directories: string[] = [];
async function context(options: MarketDataRepositoryOptionsV1 = {}, technical = false) {
  const root = await mkdtemp(join(tmpdir(), 'dexter-market-repository-'));
  directories.push(root);
  const codec = fixtureCodec(technical);
  const repository = new MarketDataRepositoryV1(codec, root, options);
  return { root, codec, repository };
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (!path.startsWith(join(tmpdir(), 'dexter-market-repository-'))) throw new Error('Unsafe test cleanup.');
    await rm(path, { recursive: true, force: true });
  }
});
async function expectCode(action: Promise<unknown>, code: MarketDataRepositoryErrorCodeV1) {
  try { await action; throw new Error('Expected failure.'); }
  catch (error) { expect(error).toBeInstanceOf(MarketDataRepositoryErrorV1); expect((error as MarketDataRepositoryErrorV1).code).toBe(code); }
}
const at = (seconds: number) => new Date(Date.parse('2026-09-03T07:30:00.000Z') + seconds * 1000).toISOString();
function receiptAt(receipt: MarketDataObservationReceiptV1, acceptedAt: string, jobId = randomUUID()) {
  const { receiptDigest: _digest, ...preimage } = { ...receipt, jobId, acceptedAt,
    checkedAt: new Date(Date.parse(acceptedAt) + 2000).toISOString() };
  return { ...preimage, receiptDigest: sha256CanonicalJsonV1(preimage) };
}
async function writeReceipt(root: string, receipt: MarketDataObservationReceiptV1) {
  const path = join(root, receiptIdentityV1(receipt).rootRelativeIdentity);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJsonV1(receipt));
}

describe('Market Data immutable repository', () => {
  for (const technical of [false, true]) test(`create/reuse retains all original bytes and appends receipt (${technical ? 'technical' : 'overview'})`, async () => {
    const { root, codec, repository } = await context({}, technical);
    const artifact = fixtureArtifact(at(0), 0, technical), original = structuredClone(artifact);
    const first = await repository.publish(artifact, observationFor(artifact, randomUUID()));
    const path = join(root, first.artifactIdentity.rootRelativeIdentity);
    const bytes = await readFile(path);
    const draft = fixtureDraft(at(5), 0, technical);
    for (const input of draft.sourceInputs) if (input.kind === 'provider') input.pagination.pageCount = 2;
    const candidate = codec.build(draft);
    const second = await repository.publish(candidate, observationFor(candidate, randomUUID()));
    expect(first.state).toBe('published'); expect(second.state).toBe('idempotent_reuse');
    expect(second.artifact).toEqual(original); expect(await readFile(path)).toEqual(bytes);
    expect(second.checkedAt).not.toBe(first.checkedAt);
    expect((await repository.latest()).observationReceiptIdentity).toEqual(second.observationReceiptIdentity);
    expect(artifact).toEqual(original);
  });
  test('A(t1) -> corrected B(t2) -> A(t3) chooses re-observation of old content', async () => {
    const { repository } = await context();
    const a = fixtureArtifact(at(0), 0), b = fixtureArtifact(at(10), 1), a2 = fixtureArtifact(at(20), 0);
    const first = await repository.publish(a, observationFor(a, randomUUID()));
    await repository.publish(b, observationFor(b, randomUUID()));
    const last = await repository.publish(a2, observationFor(a2, randomUUID()));
    expect(last.state).toBe('idempotent_reuse');
    expect(last.artifactIdentity).toEqual(first.artifactIdentity);
    const latest = await repository.latest();
    expect(latest.artifact.syntheticResult.value).toBe(0); expect(latest.checkedAt).toBe(last.checkedAt);
  });
  test('delayed older admission cannot overwrite newer latest even with a backwards cache', async () => {
    const { root, repository } = await context();
    const newer = fixtureArtifact(at(10), 1), older = fixtureArtifact(at(0), 0);
    const latest = await repository.publish(newer, observationFor(newer, randomUUID()));
    const delayed = await repository.publish(older, observationFor(older, randomUUID()));
    await writeFile(join(root, 'overview/market_short_ratio_v1/latest.json'), JSON.stringify({ artifactIdentity: delayed.artifactIdentity }));
    expect((await repository.latest()).artifactIdentity).toEqual(latest.artifactIdentity);
  });
  test('equal admission equivalent receipts choose lexical UUID; different artifacts fail closed', async () => {
    const { repository } = await context();
    const artifact = fixtureArtifact();
    const large = 'ffffffff-ffff-4fff-8fff-ffffffffffff', small = '00000000-0000-4000-8000-000000000000';
    await repository.publish(artifact, observationFor(artifact, large));
    await repository.publish(artifact, observationFor(artifact, small));
    expect((await repository.latest()).receipt.jobId).toBe(small);
    const different = fixtureArtifact(undefined, 1);
    await repository.publish(different, observationFor(different, randomUUID()));
    await expectCode(repository.latest(), 'latest_resolution_failed');
  });
  test('same-content concurrent winner preserves its later fetchedAt without rewriting earlier checkedAt', async () => {
    const { root, repository } = await context();
    const early = fixtureArtifact(at(0)), later = fixtureArtifact(at(5));
    const won = await repository.publish(later, observationFor(later, randomUUID()));
    const lost = await repository.publish(early, observationFor(early, randomUUID()));
    expect(lost.checkedAt < lost.artifact.fetchedAt).toBe(true);
    expect((await repository.latest()).artifactIdentity).toEqual(won.artifactIdentity);
    const receipt = receiptAt(lost.receipt, at(20));
    await writeReceipt(root, receipt);
    expect((await repository.latest()).receipt).toEqual(receipt);
  });
  test('deterministic result mismatch collides without replacing content; same receipt cannot change', async () => {
    const { root, codec, repository } = await context();
    const a = fixtureArtifact(), id = randomUUID();
    const original = await repository.publish(a, observationFor(a, id));
    const draft = fixtureDraft(); draft.syntheticResult.value = 123; // Same source digest, different calculation result.
    const mismatch = codec.build(draft);
    await expectCode(repository.publish(mismatch, observationFor(mismatch, randomUUID())), 'artifact_collision');
    await expectCode(repository.publish(a, { ...observationFor(a, id), checkedAt: at(30) }), 'artifact_collision');
    expect(await readFile(join(root, original.artifactIdentity.rootRelativeIdentity), 'utf8')).toBe(canonicalJsonV1(a));
    expect((await repository.latest()).receipt.jobId).toBe(id);
  });
  test('concurrent EEXIST validates entire output projection', async () => {
    const { root, codec } = await context();
    const draft = fixtureDraft(); draft.syntheticResult.value = 999;
    const candidates = [fixtureArtifact(), codec.build(draft)];
    const results = await Promise.allSettled(candidates.map(candidate => new MarketDataRepositoryV1(codec, root)
      .publish(candidate, observationFor(candidate, randomUUID()))));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason.code).toBe('artifact_collision');
  });
  test('orphan content and missing cache are never latest; reads do not create a missing root', async () => {
    const { root, codec, repository } = await context();
    const absent = new MarketDataRepositoryV1(codec, join(root, 'absent'));
    await expectCode(absent.latest(), 'artifact_not_found');
    expect(await readdir(root)).toEqual([]);
    const a = fixtureArtifact(), path = join(root, codec.identity(a).rootRelativeIdentity);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, canonicalJsonV1(a));
    await expectCode(repository.latest(), 'artifact_not_found');
    expect(await repository.loadExact(codec.identity(a))).toEqual(a);
  });
  test('receipt failure leaves orphan content and prior committed observation unchanged', async () => {
    let fail = false;
    const { root, repository } = await context({ linkFile: async (source, destination) => {
      if (fail && destination.includes(`${join('observations', 'overview')}`)) throw Object.assign(new Error('failure'), { code: 'EIO' });
      await link(source, destination);
    } });
    const a = fixtureArtifact(), first = await repository.publish(a, observationFor(a, randomUUID()));
    fail = true;
    const b = fixtureArtifact(at(10), 1);
    await expectCode(repository.publish(b, observationFor(b, randomUUID())), 'artifact_write_failed');
    expect((await repository.latest()).artifactIdentity).toEqual(first.artifactIdentity);
    const names = await readdir(join(root, 'overview/market_short_ratio_v1/2026-09-03'));
    expect(names.filter(name => name.endsWith('.json'))).toHaveLength(2);
    expect(names.some(name => name.endsWith('.tmp'))).toBe(false);
  });
  test('post-link exception and cache failure cannot hide a committed receipt', async () => {
    const { root, codec, repository } = await context({ linkFile: async (a, b) => {
      await link(a, b); throw Object.assign(new Error('after promotion'), { code: 'EIO' });
    }, writeCache: async () => { throw new Error('cache failure'); } });
    const a = fixtureArtifact();
    const result = await repository.publish(a, observationFor(a, randomUUID()));
    expect((await new MarketDataRepositoryV1(codec, root).latest()).receipt).toEqual(result.receipt);
  });
  test('unsupported hard link never falls back to overwrite and does not delete an unowned temp', async () => {
    const { root, codec, repository } = await context({ linkFile: async () => {
      throw Object.assign(new Error('unsupported'), { code: 'ENOSYS' });
    } });
    const artifact = fixtureArtifact(), directory = dirname(join(root, codec.identity(artifact).rootRelativeIdentity));
    await mkdir(directory, { recursive: true });
    const unowned = `.${randomUUID()}.tmp`; await writeFile(join(directory, unowned), 'other writer');
    await expectCode(repository.publish(artifact, observationFor(artifact, randomUUID())), 'create_only_publish_unsupported');
    expect(await readdir(directory)).toEqual([unowned]);
    expect(await readFile(join(directory, unowned), 'utf8')).toBe('other writer');
  });
  for (const cache of ['absent', 'corrupt', 'stale']) test(`${cache} cache rebuilt without fallback warning`, async () => {
    const { root, repository } = await context();
    const artifact = fixtureArtifact(), first = await repository.publish(artifact, observationFor(artifact, randomUUID()));
    const path = join(root, 'overview/market_short_ratio_v1/latest.json');
    if (cache === 'absent') await rm(path); else await writeFile(path, cache === 'corrupt' ? '{broken' : '{}');
    const latest = await repository.latest(); expect(latest.warnings).toEqual([]);
    const reconstructed = JSON.parse(await readFile(path, 'utf8'));
    expect(reconstructed.observationReceiptIdentity).toEqual(first.observationReceiptIdentity);
  });
  for (const corrupt of ['artifact', 'receipt', 'digest', 'identity', 'duplicate-key', 'invalid-utf8']) {
    test(`corrupt newest ${corrupt} uses explicit prior-observation fallback`, async () => {
      const { root, repository } = await context();
      const a = fixtureArtifact(at(0)), b = fixtureArtifact(at(10), 1);
      const previous = await repository.publish(a, observationFor(a, randomUUID()));
      const newest = await repository.publish(b, observationFor(b, randomUUID()));
      const path = join(root, corrupt === 'artifact' ? newest.artifactIdentity.rootRelativeIdentity : newest.observationReceiptIdentity.rootRelativeIdentity);
      if (corrupt === 'identity') await writeFile(path, canonicalJsonV1(receiptAt(newest.receipt, at(11))));
      else if (corrupt === 'digest') await writeFile(path, JSON.stringify({ ...newest.receipt, receiptDigest: `sha256:${'0'.repeat(64)}` }));
      else if (corrupt === 'duplicate-key') await writeFile(path, '{"jobId":1,"jobId":2}');
      else if (corrupt === 'invalid-utf8') await writeFile(path, new Uint8Array([0xff]));
      else await writeFile(path, '{broken');
      const latest = await repository.latest();
      expect(latest.state).toBe('fallback'); expect(latest.artifactIdentity).toEqual(previous.artifactIdentity);
      expect(latest.warnings).toHaveLength(1); expect(latest.warnings[0]!.code).toBe('artifact_corrupt_fallback');
      expect(JSON.stringify(latest)).not.toContain(root);
    });
  }
  test('all-corrupt observed artifacts fail, not initial 404 or orphan fallback', async () => {
    const { root, repository } = await context(); const artifact = fixtureArtifact();
    const result = await repository.publish(artifact, observationFor(artifact, randomUUID()));
    await rm(join(root, result.artifactIdentity.rootRelativeIdentity));
    await expectCode(repository.latest(), 'artifact_corrupt');
  });
  test('exact observation association validates both digests and never adopts latest or fallback', async () => {
    const { root, repository } = await context();
    const a = fixtureArtifact(), b = fixtureArtifact(at(10), 1);
    const first = await repository.publish(a, observationFor(a, randomUUID()));
    await repository.publish(b, observationFor(b, randomUUID()));
    expect((await repository.loadObservation(first.observationReceiptIdentity)).artifact).toEqual(a);
    await expectCode(repository.loadObservation({ ...first.observationReceiptIdentity, receiptDigest: `sha256:${'0'.repeat(64)}` }), 'artifact_corrupt');
    await rm(join(root, first.artifactIdentity.rootRelativeIdentity));
    await expectCode(repository.loadObservation(first.observationReceiptIdentity), 'artifact_corrupt');
  });
  for (const count of [255, 256]) test(`${count} repeated corrupt references count individually`, async () => {
    const { root, repository } = await context({ monotonicNow: () => 0 });
    const a = fixtureArtifact(), b = fixtureArtifact(at(1), 1);
    const previous = await repository.publish(a, observationFor(a, randomUUID()));
    const corrupt = await repository.publish(b, observationFor(b, randomUUID()));
    for (let i = 1; i < count; i++) await writeReceipt(root, receiptAt(corrupt.receipt, at(i + 1)));
    await writeFile(join(root, corrupt.artifactIdentity.rootRelativeIdentity), '{broken');
    if (count === 256) await expectCode(repository.latest(), 'artifact_recovery_bound_exceeded');
    else {
      const latest = await repository.latest(); expect(latest.artifactIdentity).toEqual(previous.artifactIdentity);
      expect(latest.diagnostics.inspectedReceipts).toBe(256);
    }
  }, 15000);
  test('same-admission corruption does not bypass group proof; conflict cannot be hidden by shared content', async () => {
    const { root, repository } = await context();
    const a = fixtureArtifact(), b = fixtureArtifact(at(10), 1);
    const previous = await repository.publish(a, observationFor(a, randomUUID()));
    const newer = await repository.publish(b, observationFor(b, randomUUID()));
    const bad = receiptAt(newer.receipt, b.asOfCutoff);
    await writeReceipt(root, bad); await writeFile(join(root, receiptIdentityV1(bad).rootRelativeIdentity), '{}');
    expect((await repository.latest()).artifactIdentity).toEqual(previous.artifactIdentity);
  });
  test('receipt, byte and elapsed boundaries fail closed, including sparse oversized file', async () => {
    let now = 0; const budget = new MarketDataRecoveryBudgetV1(() => now);
    budget.consume(MARKET_DATA_RECOVERY_LIMITS_V1.bytes); budget.check();
    expect(() => budget.consume(1)).toThrow('artifact_recovery_bound_exceeded');
    const time = new MarketDataRecoveryBudgetV1(() => now);
    now = 1999; time.check(); now = 2000; expect(() => time.check()).toThrow('artifact_recovery_bound_exceeded');
    const { root } = await context(), path = join(root, 'oversized.json');
    const handle = await open(path, 'wx');
    try { await handle.truncate(MARKET_DATA_RECOVERY_LIMITS_V1.bytes + 1); } finally { await handle.close(); }
    await expectCode(new MarketDataFilesV1(root).read(path, new MarketDataRecoveryBudgetV1(() => 0)), 'artifact_recovery_bound_exceeded');
  });
  test('valid conflicting receipts remain ambiguous even when one pointed artifact is corrupt', async () => {
    const { root, repository } = await context();
    const prior = fixtureArtifact(at(0)), a = fixtureArtifact(at(10), 1), b = fixtureArtifact(at(10), 2);
    await repository.publish(prior, observationFor(prior, randomUUID()));
    await repository.publish(a, observationFor(a, randomUUID()));
    const other = await repository.publish(b, observationFor(b, randomUUID()));
    await rm(join(root, other.artifactIdentity.rootRelativeIdentity));
    await expectCode(repository.latest(), 'latest_resolution_failed');
  });
  test('publication rejects invalid observation and retains winner bytes on corrupt collision', async () => {
    const { root, repository } = await context(); const a = fixtureArtifact(), original = structuredClone(a);
    await expectCode(repository.publish(a, { jobId: '../escape', acceptedAt: a.asOfCutoff, checkedAt: at(2) }), 'invalid_artifact');
    await expectCode(repository.publish(a, { ...observationFor(a, randomUUID()), checkedAt: at(0) }), 'invalid_artifact');
    const first = await repository.publish(a, observationFor(a, randomUUID()));
    const path = join(root, first.artifactIdentity.rootRelativeIdentity);
    await writeFile(path, '{broken');
    await expectCode(repository.publish(a, observationFor(a, randomUUID())), 'artifact_corrupt');
    expect(await readFile(path, 'utf8')).toBe('{broken'); expect(a).toEqual(original);
  });
  for (const count of [1, 256, 10000]) test(`enumeration proves all ${count} filenames despite warm cache`, async () => {
    const { root, repository } = await context();
    const artifact = fixtureArtifact(); await repository.publish(artifact, observationFor(artifact, randomUUID()));
    const directory = join(root, 'observations/overview/market_short_ratio_v1');
    // Older bodies are deliberately unread: proof enumerates identities, not all
    // historical content. Corruption is inspected if recovery actually reaches it.
    for (let start = 0; start < count - 1; start += 100) await Promise.all(
      Array.from({ length: Math.min(100, count - 1 - start) }, (_, i) =>
        writeFile(join(directory, `${start + i}_${randomUUID()}.json`), '{}')));
    const latest = await repository.latest();
    expect(latest.diagnostics.enumeratedReceipts).toBe(count);
    expect(latest.diagnostics.inspectedReceipts).toBe(1);
    console.info(`DR-A1 enumeration: ${count} receipts, ${latest.diagnostics.enumerationMilliseconds.toFixed(2)} ms`);
  }, 30000);
  test('unsafe identities, unknown filenames, symlink directories and receipts fail closed', async () => {
    const { root, codec, repository } = await context();
    const artifact = fixtureArtifact(), identity = codec.identity(artifact);
    await expectCode(repository.loadExact({ ...identity, rootRelativeIdentity: '../outside.json' }), 'artifact_corrupt');
    const outside = await context();
    await symlink(outside.root, join(root, 'observations'), process.platform === 'win32' ? 'junction' : 'dir');
    await expectCode(repository.latest(), 'repository_unsafe');
    expect(await readdir(outside.root)).toEqual([]);
  });
  test('noncanonical receipt filenames and unreadable directory are not no-data', async () => {
    const { root, repository } = await context();
    const path = join(root, 'observations/overview/market_short_ratio_v1'); await mkdir(path, { recursive: true });
    await writeFile(join(path, `01_${randomUUID()}.json`), '{}');
    await expectCode(repository.latest(), 'repository_unsafe');
  });
  test('two real processes finishing in inverse admission order retain newer observation', async () => {
    const { root, repository } = await context();
    const module = resolve('src/analysis/market-data/repository.ts').replaceAll('\\', '/');
    const fixtures = resolve('src/analysis/market-data/repository-test-fixtures.ts').replaceAll('\\', '/');
    const script = `import { MarketDataRepositoryV1 } from '${module}';
      import { fixtureCodec, fixtureArtifact, observationFor } from '${fixtures}';
      const [root, admitted, value] = process.argv.slice(1);
      const artifact = fixtureArtifact(admitted, Number(value));
      const repository = new MarketDataRepositoryV1(fixtureCodec(), root);
      console.log('ready');
      for await (const chunk of Bun.stdin.stream()) { if (chunk.length) break; }
      await repository.publish(artifact, observationFor(artifact, crypto.randomUUID()));`;
    const old = Bun.spawn([process.execPath, '-e', script, root, at(0), '0'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const newer = Bun.spawn([process.execPath, '-e', script, root, at(10), '1'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    try {
      const oldReader = old.stdout.getReader(), newReader = newer.stdout.getReader();
      expect(new TextDecoder().decode((await oldReader.read()).value)).toContain('ready');
      expect(new TextDecoder().decode((await newReader.read()).value)).toContain('ready');
      newer.stdin.write('go'); newer.stdin.end(); expect(await newer.exited).toBe(0);
      old.stdin.write('go'); old.stdin.end(); expect(await old.exited).toBe(0);
      expect((await repository.latest()).artifact.syntheticResult.value).toBe(1);
    } finally { old.kill(); newer.kill(); }
  }, 15000);
});
