import { afterEach, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { unlinkSync, writeFileSync } from 'node:fs';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { marketShortFixtureV2 } from './market-short-v2-test-fixtures.js';
import { MARKET_SHORT_SCOPE_V1 } from './market-short-artifact.js';
import { objectKey } from './contracts.js';
import { marketShortJobDate } from './market-short-job-contract.js';
import { retainWorkspaceObject, workspaceDataCodecs } from './data-objects.js';
import { objectRow, rowRef, referencePath, resolveReference, validateReferences } from './references.js';
import { backupWorkspace, restoreWorkspace, validateWorkspaceBackup } from './backup.js';
import { WorkspaceDatabase } from './database.js';
import { WorkspaceRepository } from './repository.js';
import { WorkspaceDashboardApi } from '../../dashboard/workspace-api.js';
import { DashboardSessionV1 } from '../../dashboard/session.js';

type Fixture = Awaited<ReturnType<typeof workspaceDataFixture>>;
const fixtures: Fixture[] = [], opened: WorkspaceDatabase[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); fixtures.splice(0).forEach(f => f.dispose()); });
async function fixture(checkpoint?: Parameters<typeof workspaceDataFixture>[0]) {
  const f = await workspaceDataFixture(checkpoint); fixtures.push(f);
  f.advance(30 * 60_000);
  f.setTransform((path, rows, url) => {
    if (path.endsWith('/short-ratio')) rows.splice(0, rows.length, ...marketShortFixtureV2(url.searchParams.get('date')!).rows);
  });
  return f;
}
function value(f: Pick<Fixture, 'db'>, key: string) {
  return JSON.parse(new TextDecoder().decode(resolveReference(f.db, rowRef(objectRow(f.db, key)), workspaceDataCodecs).bytes));
}
async function start(f: Fixture, date = '2026-09-11') { return f.jobs.wait(await f.jobs.startMarketShort(date)); }

test('explicit market job needs no catalog, publishes approximate current and restores full closure offline', async () => {
  const f = await fixture(), first = await start(f);
  expect(first.state).toBe('published'); expect(f.calls()).toBe(2);
  expect(first.identity).toBeNull(); expect(first.master_object).toBeNull();
  expect(marketShortJobDate(f.db, first)).toBe('2026-09-11');
  const current = f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')!;
  expect(value(f, objectKey(current)).qualification.reconciliation).toMatchObject({ state: 'approximate', reasons: expect.arrayContaining(['published_reference_unavailable']) });
  const input = value(f, first.input_object!);
  expect(input.execution).toMatchObject({ attempts: 2, pages: 2, acceptedRows: 35, requestsPerMinute: 5, retries: 0 });
  expect(input.execution.elapsedMs).toBeGreaterThanOrEqual(12_000);
  f.advance(); const second = await start(f);
  expect(second.state).toBe('published'); expect(f.calls()).toBe(4);
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(current);
  expect(first.input_object).not.toBe(second.input_object);
  expect(value(f, second.result_object!).observationInput).toEqual(rowRef(objectRow(f.db, second.input_object!)));
  expect(value(f, objectKey(current)).inputReference).toEqual(rowRef(objectRow(f.db, first.input_object!)));
  validateReferences(f.db, workspaceDataCodecs);
  const inputs = [first, second].map(job => value(f, job.input_object!));
  const backup = resolve(f.directory, 'backup'), restored = resolve(f.directory, 'restored');
  f.db.close(); backupWorkspace(f.root, backup, workspaceDataCodecs);
  const manifest = validateWorkspaceBackup(backup, workspaceDataCodecs);
  expect(manifest.schemaVersion).toBe(6);
  expect(manifest.roots.filter(root => root.table === 'workspace_data_jobs')).toHaveLength(4);
  restoreWorkspace(backup, restored, workspaceDataCodecs);
  const db = new WorkspaceDatabase(restored); opened.push(db);
  const repository = new WorkspaceRepository(db);
  expect(repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(current);
  for (const [index, job] of [first, second].entries()) {
    expect(db.sqlite.query('SELECT * FROM workspace_data_jobs WHERE job_id=?').get(job.job_id)).toEqual(job);
    expect(marketShortJobDate(db, job)).toBe('2026-09-11');
    expect(value({ db }, job.input_object!)).toEqual(inputs[index]);
  }
  expect(db.sqlite.query('SELECT * FROM drawings').all()).toEqual([]);
  expect(db.sqlite.query('SELECT * FROM analysis_jobs').all()).toEqual([]);
  expect(db.sqlite.query('SELECT * FROM shared_context_links').all()).toEqual([]);
  expect(f.calls()).toBe(4);
});

test.each(['after_publish', 'before_binding'] as const)('%s interruption recovers exact receipt without API replay', async checkpoint => {
  let crash = true;
  const f = await fixture(async phase => { if (phase === checkpoint && crash) { crash = false; throw new Error('crash'); } });
  const job = await start(f); expect(job.state).toBe('publishing');
  const retained = f.db.sqlite.query('SELECT object_key FROM immutable_objects ORDER BY object_key').all();
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
  expect(() => validateReferences(f.db, workspaceDataCodecs)).toThrow('backup_invalid');
  const restarted = await f.restart();
  expect(restarted.jobs.get(job.job_id).state).toBe('published'); expect(f.calls()).toBe(2);
  await restarted.jobs.recover(job.job_id); expect(f.calls()).toBe(2);
  if (checkpoint === 'before_binding') expect(restarted.db.sqlite.query('SELECT object_key FROM immutable_objects ORDER BY object_key').all()).toEqual(retained);
  expect(restarted.db.sqlite.query('SELECT * FROM artifact_bindings').all()).toHaveLength(1);
  validateReferences(restarted.db, workspaceDataCodecs);
});

test('pre-publication cancellation stays terminal and shared active API never adopts a market job as an instrument job', async () => {
  let ready!: () => void, resume!: () => void;
  const reached = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  const f = await fixture(async phase => { if (phase === 'before_publish') { ready(); await gate; } });
  const session = new DashboardSessionV1(), api = new WorkspaceDashboardApi(f.jobs, session);
  const call = (path: string, method = 'GET', body?: unknown) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin, 'Content-Type': 'application/json',
      'X-Dexter-CSRF': session.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')) as Promise<Response>;
  };
  const id = await f.jobs.startMarketShort('2026-09-11');
  try {
    await reached;
    await expect(f.jobs.start('catalog')).rejects.toMatchObject({ reason: 'active_job_conflict', activeKind: 'workspace_market_short' });
    expect(await (await call('jobs/active')).json()).toEqual({ schemaVersion: 'workspace_active_v1', job: null, blockingKind: 'workspace_market_short' });
    expect((await call(`jobs/${id}`)).status).toBe(404);
    expect((await call(`jobs/${id}`, 'DELETE')).status).toBe(404);
    expect((await call('jobs', 'POST', { kind: 'market_short', date: '2026-09-11' })).status).toBe(400);
    expect(f.calls()).toBe(2); f.jobs.cancel(id);
  } finally { resume(); await f.jobs.wait(id); }
  expect(f.jobs.get(id).state).toBe('failed');
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
  const restarted = await f.restart(); expect(restarted.jobs.get(id).state).toBe('failed'); expect(f.calls()).toBe(2);
  validateReferences(restarted.db, workspaceDataCodecs);
});

test.each(['2026-09-10', '2026-09-11'])('invalid or incomplete source on %s never binds or retries', async date => {
  const f = await fixture();
  f.setTransform((path, rows) => { if (path.endsWith('/short-ratio')) rows.splice(0, rows.length, ...marketShortFixtureV2(date).rows.slice(1)); });
  expect((await start(f, date)).state).toBe('failed'); expect(f.calls()).toBe(2);
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
});

test.each(['2026-09-09', '2026-09-12', '2026-02-30'])('inadmissible %s creates no job and never reads credentials', async date => {
  const f = await fixture(), credentials = spyOn(f.environment, 'apiKey');
  await expect(f.jobs.startMarketShort(date)).rejects.toThrow();
  expect(f.jobs.inventory()).toEqual([]); expect(f.calls()).toBe(0); expect(credentials).not.toHaveBeenCalled(); credentials.mockRestore();
});

test('17:29:59.999 admission is rejected and 17:30:00.000 is frozen; date/identity/request cannot mutate', async () => {
  const f = await workspaceDataFixture(); fixtures.push(f); f.advance(30 * 60_000 - 1);
  await expect(f.jobs.startMarketShort('2026-09-11')).rejects.toThrow(); expect(f.calls()).toBe(0);
  f.advance(1);
  f.setTransform((path, rows) => { if (path.endsWith('/short-ratio')) rows.splice(0, rows.length, ...marketShortFixtureV2().rows); });
  const job = await start(f); expect(job.state).toBe('published'); expect(job.accepted_at).toBe('2026-09-11T08:30:00.000Z');
  expect(() => f.db.sqlite.run("UPDATE workspace_market_short_requests SET requested_date='2026-09-10'")).toThrow('immutable');
  expect(() => f.db.sqlite.run('DELETE FROM workspace_market_short_requests')).toThrow('immutable');
  expect(() => f.db.sqlite.run("UPDATE workspace_data_jobs SET identity='{}'")).toThrow('immutable');
  expect(() => f.db.sqlite.run("INSERT INTO workspace_market_short_requests VALUES (?,'2026-09-11')", [randomUUID()])).toThrow();
  expect(() => f.db.sqlite.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state,identity) VALUES (?,'market_short',?,'queued','{}')", [randomUUID(), job.accepted_at])).toThrow();
});

test('publishing without a receipt is interrupted; a different job latest receipt cannot substitute', async () => {
  const f = await fixture(), first = await start(f); f.advance();
  const id = randomUUID(), accepted = new Date(f.environment.wallNowMs()).toISOString();
  const input = marketShortFixtureV2('2026-09-11', accepted), ref = await retainWorkspaceObject(f.db, input.version, input);
  f.db.transaction(() => {
    f.db.sqlite.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state,input_object) VALUES (?,'market_short',?,'publishing',?)", [id, accepted, objectKey(ref)]);
    f.db.sqlite.run("INSERT INTO workspace_market_short_requests VALUES (?,'2026-09-11')", [id]);
  });
  const restarted = await f.restart(); expect(restarted.jobs.get(id).state).toBe('interrupted'); expect(f.calls()).toBe(2);
  expect(restarted.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toEqual(value(restarted, first.result_object!).artifact);
  validateReferences(restarted.db, workspaceDataCodecs);
});

test.each(['queued', 'running'] as const)('restart interrupts %s market job without collection', async state => {
  const f = await fixture(), id = randomUUID(), accepted = new Date(f.environment.wallNowMs()).toISOString();
  f.db.transaction(() => {
    f.db.sqlite.run("INSERT INTO workspace_data_jobs(job_id,kind,accepted_at,state) VALUES (?,'market_short',?,?)", [id, accepted, state]);
    f.db.sqlite.run("INSERT INTO workspace_market_short_requests VALUES (?,'2026-09-11')", [id]);
  });
  const restarted = await f.restart(); expect(restarted.jobs.get(id).state).toBe('interrupted'); expect(f.calls()).toBe(0);
  expect(restarted.jobs.get(id).input_object).toBeNull(); validateReferences(restarted.db, workspaceDataCodecs);
});

test.each(['missing', 'corrupt', 'different_date'] as const)('recovery fails closed for %s exact input', async defect => {
  const f = await fixture(async phase => { if (phase === 'after_publish') throw new Error('crash'); });
  const job = await start(f); expect(job.state).toBe('publishing');
  const ref = rowRef(objectRow(f.db, job.input_object!)), path = referencePath(f.root, ref);
  if (defect === 'missing') unlinkSync(path);
  else if (defect === 'corrupt') writeFileSync(path, '{}');
  else {
    f.db.sqlite.exec('DROP TRIGGER market_short_request_update');
    f.db.sqlite.run("UPDATE workspace_market_short_requests SET requested_date='2026-09-10'");
  }
  await expect(f.jobs.recover(job.job_id)).rejects.toThrow();
  expect(f.jobs.get(job.job_id).state).toBe('publishing'); expect(f.calls()).toBe(2);
  expect(f.repository.current(MARKET_SHORT_SCOPE_V1, 'market_short')).toBeNull();
});

test('published job must keep its own observation input even if an equivalent artifact was reused', async () => {
  const f = await fixture(), first = await start(f); f.advance(); const second = await start(f);
  f.db.sqlite.exec('DROP TRIGGER workspace_job_input_update');
  f.db.sqlite.run('UPDATE workspace_data_jobs SET input_object=? WHERE job_id=?', [first.input_object!, second.job_id]);
  await expect(f.jobs.recover(second.job_id)).rejects.toThrow('reference_conflict');
  expect(() => validateReferences(f.db, workspaceDataCodecs)).toThrow('reference_conflict'); expect(f.calls()).toBe(4);
});

test('terminal job cannot borrow another job receipt and binding despite equivalent source content', async () => {
  const f = await fixture(), first = await start(f); f.advance(); const second = await start(f);
  f.db.sqlite.exec('DROP TRIGGER workspace_job_result_update');
  f.db.sqlite.run('UPDATE workspace_data_jobs SET result_object=? WHERE job_id=?', [first.result_object!, second.job_id]);
  await expect(f.jobs.recover(second.job_id)).rejects.toThrow('reference_conflict');
  expect(() => validateReferences(f.db, workspaceDataCodecs)).toThrow('reference_conflict'); expect(f.calls()).toBe(4);
});

test('qualification is rechecked after the binding checkpoint inside the commit transaction', async () => {
  const f = await fixture(async (phase, job) => {
    if (phase === 'before_binding') writeFileSync(referencePath(f.root, rowRef(objectRow(f.db, job.input_object!))), '{}');
  });
  const job = await start(f); expect(job.state).toBe('publishing');
  expect(f.db.sqlite.query('SELECT * FROM artifact_bindings').all()).toEqual([]);
  expect(f.db.sqlite.query('SELECT * FROM data_sync_state').all()).toEqual([]);
  await expect(f.jobs.start('catalog')).rejects.toMatchObject({ reason: 'recovery_required' }); expect(f.calls()).toBe(2);
});

test('legacy admission retains the shared coordinator clock failure rather than market-date conversion', async () => {
  const f = await fixture(), wall = spyOn(f.environment, 'wallNowMs').mockReturnValue(NaN);
  try {
    await expect(f.jobs.start('catalog')).rejects.toMatchObject({ reason: 'clock_invalid' });
    expect(f.jobs.inventory()).toEqual([]); expect(f.calls()).toBe(0);
  } finally { wall.mockRestore(); }
});
