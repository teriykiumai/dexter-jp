import { workspaceDataFixture } from '../analysis/workspace/data-test-fixtures.js';
import { WorkspaceDashboardApi } from './workspace-api.js';
import { DashboardSessionV1 } from './session.js';
import { handleDashboardRequest } from './api.js';
import { seedTrendlineFixture } from './drawing-test-fixtures.js';

const fixture = await workspaceDataFixture(undefined, false, process.env.WORKSPACE_BROWSER_ROOT
  ? { directory: process.env.WORKSPACE_BROWSER_ROOT, preserve: true } : undefined);
if (process.env.WORKSPACE_BROWSER_TRENDLINES === '1') await seedTrendlineFixture(fixture.db);
const api = new WorkspaceDashboardApi(fixture.jobs, new DashboardSessionV1());
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
  if (new URL(request.url).pathname === '/test/counts') return Response.json({ calls: fixture.calls() });
  if (request.method === 'POST' && new URL(request.url).pathname === '/test/supply') {
    fixture.advance(3600_000);
    fixture.setTransform((endpoint, rows) => {
      if (endpoint.endsWith('/master')) { rows[0]!.S33 = '3700'; rows[0]!.S33Nm = '輸送用機器'; }
      if (endpoint.endsWith('/margin-interest')) rows.splice(0, rows.length, { Date: '2026-09-11', Code: '72030', LongVol: 1000, ShrtVol: 0 });
      if (endpoint.endsWith('/short-sale-report')) rows.splice(0, rows.length, { DiscDate: '2026-09-11', CalcDate: '2026-09-11', Code: '72030',
        SSName: 'Synthetic Reporter', DICName: '', FundName: '', ShrtPosToSO: 0.0051, ShrtPosShares: 100, PrevRptDate: '-', PrevRptRatio: null });
      if (endpoint.endsWith('/short-ratio')) rows.splice(0, rows.length, { Date: '2026-09-11', S33: '3700', SellExShortVa: 60, ShrtWithResVa: 30, ShrtNoResVa: 10 });
    });
    return Response.json({ configured: true });
  }
  if (request.method === 'POST' && new URL(request.url).pathname === '/test/price-correction') {
    fixture.setTransform((endpoint, rows) => { if (endpoint.endsWith('/daily')) for (const row of rows) row.AdjC = 106; });
    return Response.json({ configured: true });
  }
  if (request.method === 'POST') fixture.advance();
  return handleDashboardRequest(request, { listLatest: async () => [], listHistory: async () => [],
    loadLatest: async () => { throw new Error('No Snapshot'); }, loadHistory: async () => { throw new Error('No Snapshot'); } }, undefined, undefined, api);
} });
console.log(server.url.href);
const stop = async () => { await server.stop(true); for (const job of fixture.jobs.inventory()) await fixture.jobs.wait(job.job_id); fixture.dispose(); process.exit(0); };
process.on('SIGTERM', () => void stop());
