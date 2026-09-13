import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { handleDashboardRequest } from './api.js';

const fixture = await workspaceDataFixture();
const api = new WorkspaceDashboardApi(fixture.jobs, new DashboardSessionV1());
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
  if (new URL(request.url).pathname === '/test/counts') return Response.json({ calls: fixture.calls() });
  if (request.method === 'POST') fixture.advance();
  return handleDashboardRequest(request, { listLatest: async () => [], listHistory: async () => [],
    loadLatest: async () => { throw new Error('No Snapshot'); }, loadHistory: async () => { throw new Error('No Snapshot'); } }, undefined, undefined, api);
} });
console.log(server.url.href);
const stop = async () => { await server.stop(true); for (const job of fixture.jobs.inventory()) await fixture.jobs.wait(job.job_id); fixture.dispose(); process.exit(0); };
process.on('SIGTERM', () => void stop());
