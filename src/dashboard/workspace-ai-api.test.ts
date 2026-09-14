import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { financialFixture } from '../analysis/workspace/financial-test-fixtures.js';
import { WorkspaceAiJobs } from '../analysis/workspace/ai-jobs.js';
import { syntheticAiModel, syntheticAiOutput } from '../analysis/workspace/ai-test-fixtures.js';
import { AiJobViewSchema, AiHistorySchema, AiDetailSchema } from '../analysis/workspace/ai-contracts.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';

test('AI admission and active-slot conflicts are 409 without another run; unresolved publication stays 500', async () => {
  const f = await financialFixture(true), session = new DashboardSessionV1(); let calls = 0;
  const admitting = Promise.withResolvers<void>(), accept = Promise.withResolvers<void>();
  const invoked = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const ai = new WorkspaceAiJobs(f.repository, syntheticAiModel(async input => { calls++; invoked.resolve(); await finish.promise; return syntheticAiOutput(input); }),
    async phase => {
      if (phase === 'before_admission') { admitting.resolve(); await accept.promise; }
      if (phase === 'before_result_write') throw new Error('Synthetic ambiguous publication');
    });
  const api = new WorkspaceDashboardApi(f.jobs, session, ai), url = new URL(`http://127.0.0.1:3000/api/workspace/instruments/${f.id}/ai/jobs`);
  const start = () => api.handle(new Request(url, { method: 'POST', headers: { host: url.host, origin: url.origin,
    'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken }, body: JSON.stringify({ profile: 'fundamental' }) }), url, url.pathname.slice(1).split('/'));
  let jobId: string | undefined;
  try {
    expect((await f.jobs.wait(await f.jobs.start('financial', f.id))).state).toBe('published');
    const first = start(); await admitting.promise;
    const beforeAdmission = (await start())!;
    expect(beforeAdmission.status).toBe(409); expect(await beforeAdmission.json()).toMatchObject({ error: { code: 'revision_conflict' } });
    expect(f.db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(0); expect(calls).toBe(0);
    accept.resolve(); const response = (await first)!; expect(response.status).toBe(202);
    const job = AiJobViewSchema.parse(await response.json()); jobId = job.id; await invoked.promise;
    const active = (await start())!; expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ error: { code: 'revision_conflict' } });
    expect((await ai.history(f.id)).active?.id).toBe(job.id);
    expect(f.db.sqlite.query('SELECT * FROM analysis_jobs').all()).toHaveLength(1); expect(calls).toBe(1);
    finish.resolve(); await ai.wait(job.id);
    expect(ai.get(f.id, job.id).error).toBe('publication_unresolved');
    const ambiguous = (await start())!; expect(ambiguous.status).toBe(500);
    expect(await ambiguous.json()).toMatchObject({ error: { code: 'database_busy' } }); expect(calls).toBe(1);
  } finally { accept.resolve(); finish.resolve(); if (jobId) await ai.wait(jobId); f.dispose(); }
}, 60_000);

test('AI API enforces same-origin explicit actions, profile schema, exact ownership and read-only history', async () => {
  const f = await financialFixture(), session = new DashboardSessionV1(); let calls = 0;
  const ai = new WorkspaceAiJobs(f.repository, syntheticAiModel(async input => { calls++; return syntheticAiOutput(input); }));
  const api = new WorkspaceDashboardApi(f.jobs, session, ai), base = `instruments/${f.id}/ai`;
  const call = async (path = base, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:3000/api/workspace/${path}`);
    return (await api.handle(new Request(url, { method, headers: { host: url.host, origin: url.origin, 'Content-Type': 'application/json',
      'X-Dexter-CSRF': session.csrfToken, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), url, url.pathname.slice(1).split('/')))!;
  };
  const dataCalls = f.calls();
  try {
    const forbidden: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }, { 'X-Dexter-CSRF': 'bad' }];
    for (const headers of forbidden)
      expect((await call(`${base}/jobs`, 'POST', { profile: 'fundamental' }, headers)).status).toBe(403);
    expect((await call(base, 'GET', undefined, { host: 'evil.test' })).status).toBe(403);
    expect((await call(`${base}/jobs`, 'GET')).status).toBe(405);
    expect((await call(`${base}/jobs`, 'POST', { profile: 'peer' })).status).toBe(400);
    expect((await call(`${base}/jobs`, 'POST', { profile: 'fundamental', drawingId: randomUUID() })).status).toBe(400);
    expect((await call(`${base}/jobs`, 'POST', { profile: 'fundamental' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await call(`${base}?before=bad`)).status).toBe(400);
    expect((await call(`${base}?before=${randomUUID()}&before=${randomUUID()}`)).status).toBe(400);
    expect(AiHistorySchema.parse(await (await call()).json()).items).toHaveLength(0);
    const job = AiJobViewSchema.parse(await (await call(`${base}/jobs`, 'POST', { profile: 'fundamental' })).json());
    expect(job.state).toBe('insufficient_inputs');
    expect(AiDetailSchema.parse(await (await call(`${base}/runs/${job.id}`)).json()).result).toBeNull();
    expect((await call(`instruments/${randomUUID()}/ai/jobs/${job.id}`)).status).toBe(404);
    expect((await call(`instruments/${randomUUID()}/ai/runs/${job.id}`)).status).toBe(404);
    expect((await call(`${base}/jobs/${job.id}`, 'DELETE')).status).toBe(409);
    expect(calls).toBe(0); expect(f.calls()).toBe(dataCalls);
    expect((await call()).headers.get('Cache-Control')).toBe('no-store');
  } finally { f.dispose(); }
}, 60_000);
