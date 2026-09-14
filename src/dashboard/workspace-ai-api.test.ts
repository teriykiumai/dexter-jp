import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { financialFixture } from '../analysis/workspace/financial-test-fixtures.js';
import { WorkspaceAiJobs } from '../analysis/workspace/ai-jobs.js';
import { syntheticAiModel, syntheticAiOutput } from '../analysis/workspace/ai-test-fixtures.js';
import { AiJobViewSchema, AiHistorySchema, AiDetailSchema } from '../analysis/workspace/ai-contracts.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';

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
