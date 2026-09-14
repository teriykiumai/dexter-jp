import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { financialFixture } from './financial-test-fixtures.js';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { WorkspaceAiJobs } from './ai-jobs.js';
import { syntheticAiModel, syntheticAiOutput } from './ai-test-fixtures.js';
import { type AiInput } from './ai-contracts.js';
import { backupWorkspace, restoreWorkspace } from './backup.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { workspaceDataCodecs, retainWorkspaceObject, EpisodeObjectSchema, ReceiptObjectSchema } from './data-objects.js';
import { referencePath, validateReferences, resolveReference } from './references.js';
import { json, parse } from './contracts.js';
import { financialArtifact } from './financial-objects.js';
import { collectWorkspaceCatalog } from './data-source.js';
import { validateAiResult } from './ai-objects.js';

async function fixture() {
  const f = await financialFixture(true);
  expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('published');
  return f;
}

test('saved supply AI retains exact shared-sector membership through backup and restore', async () => {
  const f = await workspaceDataFixture();
  f.setTransform((path, rows) => {
    if (path.endsWith('/master')) { rows[0]!.S33 = '3700'; rows[0]!.S33Nm = '輸送用機器'; }
    if (path.endsWith('/short-ratio')) rows.push({ Date: '2026-09-11', S33: '3700', SellExShortVa: 60, ShrtWithResVa: 30, ShrtNoResVa: 10 });
  });
  try {
    await f.jobs.wait(await f.jobs.start('catalog'));
    const id = f.repository.search('7203')[0]!.instrumentId;
    f.repository.openWorkspace(id); f.advance(3600_000);
    expect((await f.jobs.wait(await f.jobs.start('sector_short', id))).state).toBe('published');
    const jobs = new WorkspaceAiJobs(f.repository, syntheticAiModel()), job = await jobs.start(id, 'supply_demand');
    await jobs.wait(job.id); const before = await jobs.detail(id, job.id);
    expect(before.job.state).toBe('published'); expect(before.input.selection.sector_short?.membership).toBeDefined();
    expect(before.input.selection.financial).toBeNull(); expect(before.input.selection.technical).toBeNull();
    f.db.close();
    const backup = resolve(f.directory, 'supply-ai-backup'), restored = resolve(f.directory, 'supply-ai-restored');
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored);
    try { expect(await new WorkspaceAiJobs(new WorkspaceRepository(db), syntheticAiModel()).detail(id, job.id)).toEqual(before); }
    finally { db.close(); }
  } finally { f.dispose(); }
}, 90_000);
test('AI missing inputs and missing key do not invoke a model or collect data', async () => {
  const f = await financialFixture(); let calls = 0;
  const model = syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); });
  const jobs = new WorkspaceAiJobs(f.repository, model), before = f.calls();
  try {
    expect((await jobs.history(f.id)).items).toEqual([]); expect(calls).toBe(0);
    for (const profile of ['fundamental', 'supply_demand'] as const) {
      const job = await jobs.start(f.id, profile); expect(job.state).toBe('insufficient_inputs');
      expect((await jobs.detail(f.id, job.id)).result).toBeNull();
    }
    model.configured = () => false;
    await expect(jobs.start(f.id, 'fundamental')).rejects.toThrow('model_unavailable');
    expect((await jobs.history(f.id)).items).toHaveLength(2); expect(f.calls()).toBe(before); expect(calls).toBe(0);
  } finally { f.dispose(); }
}, 60_000);

test('AI records financial and newer exact Technical as-of independently through refresh, restart and backup', async () => {
  const f = await fixture(), inputs: AiInput[] = [];
  const jobs = new WorkspaceAiJobs(f.repository, syntheticAiModel(async input => { inputs.push(input); return syntheticAiOutput(input); }));
  try {
    const financial = f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'financial')!;
    const saved = financialArtifact(JSON.parse(new TextDecoder().decode(resolveReference(f.db, financial, workspaceDataCodecs).bytes)));
    expect(saved.dataDate).toBe('2026-09-11');
    // Offline synthetic continuity only; the production historical identity gate stays closed.
    const acceptedAt = '2026-10-01T08:00:00.000Z', signal = new AbortController().signal;
    f.advance(Date.parse(acceptedAt) - f.environment.wallNowMs());
    const catalog = await collectWorkspaceCatalog({ jobId: randomUUID(), acceptedAt, signal,
      dispatch: start => start(signal), shareSource: (_key, load) => load(), recordProgress: () => {}, waitBeforeRetry: async () => {} }, f.environment);
    const master = await retainWorkspaceObject(f.db, 'workspace_catalog_v1', catalog), previous = saved.input.masterEvidence;
    const episode = parse(EpisodeObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(f.db, previous, workspaceDataCodecs).bytes)));
    const observation = catalog.rows[0]!;
    const evidence = await retainWorkspaceObject(f.db, 'workspace_episode_v1', { ...episode, observation, catalog: master, previous });
    await f.repository.acceptCatalog(f.repository.requestCatalog(catalog.date), [{ instrumentId: f.id, assetType: 'stock',
      provider: 'jquants', code: observation.Code, label: observation.CoName, mappingRevision: saved.input.identity.mappingRevision,
      episodeFrom: episode.from, episodeThrough: null, evidence }], master);
    let summaries = 0;
    f.setTransform(path => { if (path.endsWith('/summary')) summaries++; });
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('technical', f.id))).state).toBe('published');
    const calls = f.calls(), job = await jobs.start(f.id, 'fundamental'); await jobs.wait(job.id);
    expect(jobs.get(f.id, job.id).state).toBe('published'); expect(inputs).toHaveLength(1);
    const before = await jobs.detail(f.id, job.id);
    if (before.input.profile !== 'fundamental') throw new Error('Unexpected profile');
    expect(before.input.selection.margin).toBeNull();
    expect(before.input.data.projection?.priceReference?.date).toBe('2026-10-01');
    const technical = parse(ReceiptObjectSchema, JSON.parse(new TextDecoder().decode(resolveReference(f.db, before.input.selection.technical!.receipt, workspaceDataCodecs).bytes)));
    expect(before.result!.asOf).toEqual([
      { source: 'financial', through: '2026-09-11', checkedAt: before.input.data.checkedAt },
      { source: 'technical', through: '2026-10-01', checkedAt: technical.receipt.checkedAt },
    ]);
    expect(before.input.technicalObservation).toEqual({ through: '2026-10-01', checkedAt: technical.receipt.checkedAt });
    const financialCheckedAt = before.input.data.checkedAt;
    expect(() => validateAiResult(before.input, before.job.input, { ...before.result, asOf: before.result!.asOf.slice(0, 1) })).toThrow('reference_conflict');
    expect(() => validateAiResult(before.input, before.job.input, { ...before.result, asOf: before.result!.asOf.map(item => item.source === 'technical' ? { ...item, checkedAt: financialCheckedAt } : item) })).toThrow('reference_conflict');
    expect(json(inputs)).not.toMatch(/drawings|peerComparison|rawPrompt/);
    expect(f.calls()).toBe(calls);
    f.advance(); f.setTransform((path, rows) => { if (path.endsWith('/summary')) summaries++;
      if (path.endsWith('/daily')) { rows.at(-1)!.C = 107; rows.at(-1)!.AdjC = 107; } });
    expect((await f.jobs.wait(await f.jobs.start('technical', f.id))).state).toBe('published');
    expect(await jobs.detail(f.id, job.id)).toEqual(before); expect(inputs).toHaveLength(1);
    expect(summaries).toBe(0);
    expect(f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'financial')).toEqual(financial);
    expect(() => jobs.get(randomUUID(), job.id)).toThrow('not_found');
    expect(() => f.db.sqlite.run("UPDATE analysis_jobs SET state='interrupted' WHERE job_id=?", [job.id])).toThrow('immutable');
    validateReferences(f.db, workspaceDataCodecs);
    const restarted = await f.restart(), afterRestart = new WorkspaceAiJobs(restarted.repository, syntheticAiModel(async () => { throw new Error('must not replay'); }));
    await afterRestart.initialize(); expect(await afterRestart.detail(f.id, job.id)).toEqual(before); restarted.db.close();
    const backup = resolve(f.directory, 'ai-backup'), restored = resolve(f.directory, 'ai-restored');
    backupWorkspace(f.root, backup, workspaceDataCodecs); restoreWorkspace(backup, restored, workspaceDataCodecs);
    const db = new WorkspaceDatabase(restored), reopened = new WorkspaceAiJobs(new WorkspaceRepository(db), syntheticAiModel(async () => { throw new Error('must not replay'); }));
    try {
      await reopened.initialize(); expect(await reopened.detail(f.id, job.id)).toEqual(before);
      writeFileSync(referencePath(db.root, before.job.input), '{}');
      await expect(reopened.detail(f.id, job.id)).rejects.toThrow();
    } finally { db.close(); }
  } finally { f.dispose(); }
}, 120_000);

test('AI admission refuses a mapping/data change during input preparation', async () => {
  const f = await fixture(); let calls = 0;
  const jobs = new WorkspaceAiJobs(f.repository, syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); }), async phase => {
    if (phase === 'before_admission') f.db.sqlite.run('UPDATE catalog_rows SET mapping_revision=mapping_revision+1 WHERE instrument_id=?', [f.id]);
  });
  try {
    await expect(jobs.start(f.id, 'fundamental')).rejects.toThrow('revision_conflict');
    expect(calls).toBe(0); expect(f.db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(0);
  } finally { f.dispose(); }
}, 60_000);

test.each(['before_result_write', 'after_result_write', 'after_result_register'])('AI publication recovery at %s never replays a model', async phase => {
  const f = await fixture(); let calls = 0;
  const model = syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); });
  const jobs = new WorkspaceAiJobs(f.repository, model, async current => { if (current === phase) throw new Error('simulated publication interruption'); });
  try {
    const job = await jobs.start(f.id, 'fundamental'); await jobs.wait(job.id);
    expect(jobs.get(f.id, job.id)).toMatchObject({ state: 'publishing', error: 'publication_unresolved' });
    await expect(jobs.start(f.id, 'fundamental')).rejects.toThrow('database_busy');
    expect(() => validateReferences(f.db, workspaceDataCodecs)).toThrow('backup_invalid');
    const restarted = await f.restart(), recovered = new WorkspaceAiJobs(restarted.repository, model); await recovered.initialize();
    expect(recovered.get(f.id, job.id).state).toBe(phase === 'before_result_write' ? 'interrupted' : 'published');
    expect(calls).toBe(1); validateReferences(restarted.db, workspaceDataCodecs);
  } finally { f.dispose(); }
}, 90_000);

test('AI cancellation, concurrent admission, safe failure and invalid output never replay or disable Drawing writes', async () => {
  const f = await fixture(); let release!: () => void, calls = 0;
  const entered = Promise.withResolvers<void>();
  const model = syntheticAiModel(async input => { calls++; entered.resolve(); await new Promise<void>(r => { release = r; }); return syntheticAiOutput(input); });
  const jobs = new WorkspaceAiJobs(f.repository, model);
  try {
    f.advance(); expect((await f.jobs.wait(await f.jobs.start('technical', f.id))).state).toBe('published');
    const job = await jobs.start(f.id, 'fundamental'); await entered.promise;
    await expect(jobs.start(f.id, 'fundamental')).rejects.toThrow('revision_conflict');
    expect(f.repository.search('7203')).toHaveLength(1);
    const prefs = f.repository.preferences(f.id);
    f.repository.savePreferences(f.id, { ...prefs.value, interval: 'month' }, prefs.revision);
    const drawingId = randomUUID(), basis = f.repository.current({ kind: 'instrument-owned', instrumentId: f.id }, 'technical')!;
    const start = performance.now();
    f.repository.saveDrawing({ id: drawingId, instrumentId: f.id, kind: 'horizontal', price: 100, time: '2026-09-11',
      evidenceFrom: '2026-09-11', evidenceThrough: '2026-09-11', basisObject: basis, revision: 1 }, 0);
    expect(performance.now() - start).toBeLessThan(250);
    expect(jobs.cancel(f.id, job.id).state).toBe('cancelled'); release(); await jobs.wait(job.id);
    expect((await jobs.detail(f.id, job.id)).result).toBeNull(); expect(calls).toBe(1);
    model.invoke = async () => { calls++; throw new Error('secret-provider-error'); };
    const failed = await jobs.start(f.id, 'fundamental'); await jobs.wait(failed.id);
    expect(jobs.get(f.id, failed.id).error).toBe('model_failed'); expect(json(await jobs.history(f.id))).not.toContain('secret-provider-error');
    model.invoke = async input => ({ ...syntheticAiOutput(input), observations: [{ text: '新しい数値は９９です', sources: ['financial'] }] });
    const invalid = await jobs.start(f.id, 'fundamental'); await jobs.wait(invalid.id);
    expect(jobs.get(f.id, invalid.id).state).toBe('failed'); expect(jobs.get(f.id, invalid.id).result).toBeNull();
  } finally { release?.(); f.dispose(); }
}, 120_000);

test.each(['before_invoke', 'after_invoke'])('process kill at %s keeps frozen input and never automatically invokes again', async phase => {
  const f = await fixture(); f.db.close();
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./ai-crash-worker.ts', import.meta.url)), f.root, f.id, phase],
    { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  let db: WorkspaceDatabase | undefined;
  const timer = setTimeout(() => child.kill(), 40_000);
  try {
    const reader = child.stdout.getReader(), first = await reader.read(); reader.releaseLock();
    const checkpoint = JSON.parse(new TextDecoder().decode(first.value)) as { id: string; calls: number };
    expect(checkpoint.calls).toBe(phase === 'before_invoke' ? 0 : 1);
    child.kill(); await child.exited;
    db = new WorkspaceDatabase(f.root); let calls = 0;
    const jobs = new WorkspaceAiJobs(new WorkspaceRepository(db), syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); }));
    await jobs.initialize(); expect(jobs.get(f.id, checkpoint.id).state).toBe('interrupted');
    expect((await jobs.detail(f.id, checkpoint.id)).input.runId).toBe(checkpoint.id); expect(calls).toBe(0);
  } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill(); await child.exited; } db?.close(); f.dispose(); }
}, 70_000);
