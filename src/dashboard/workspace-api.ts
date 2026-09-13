import { z } from 'zod';
import { Id, parse, fail, WorkspaceError, scopeKey, type ObjectRef } from '../analysis/workspace/contracts.js';
import { rowRef, objectRow } from '../analysis/workspace/references.js';
import type { WorkspaceDataJobs, WorkspaceDataJob } from '../analysis/workspace/data-jobs.js';
import { DashboardJobCoordinatorErrorV1, dashboardCoordinatorFailureV1 } from '../analysis/dashboard-jobs/coordinator.js';
import { parseStrictJsonBytesV1, StrictJsonErrorV1 } from '../analysis/strategy-validation/strict-json.js';
import { DashboardSessionV1, DashboardSecurityErrorV1, dashboardSecurityFailureV1, isAllowedDashboardHost,
  requireDashboardJsonMediaType, readDashboardBody } from './session.js';
import { WorkspaceResponseSchema, WorkspaceItemSchema, WorkspaceChartSchema, workspaceTerminal, type WorkspaceChart, type WorkspaceItem, type WorkspaceJobView, type WorkspaceView } from './workspace-contracts.js';

const response = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(WorkspaceResponseSchema.parse(value), { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const errorResponse = (code: string, status: number, headers?: Record<string, string>) => response({ schemaVersion: 'workspace_error_v1', error: { code } }, status, headers);
const jobView = (job: WorkspaceDataJob): WorkspaceJobView => ({ schemaVersion: 'workspace_job_v1', id: job.job_id, kind: job.kind, state: job.state,
  instrumentId: job.identity ? JSON.parse(job.identity).instrumentId as string : null, error: job.error });

export class WorkspaceDashboardApi {
  private readQueue: Promise<unknown> = Promise.resolve();
  private queuedReads = 0;
  constructor(readonly jobs: WorkspaceDataJobs, readonly session: DashboardSessionV1) {}
  private item(id: string): WorkspaceItem {
    parse(Id, id);
    const row = this.jobs.repository.db.sqlite.query<Omit<WorkspaceItem, 'schemaVersion'>, [string]>(`SELECT i.instrument_id AS instrumentId,
      r.code,r.label,COALESCE(w.favorite,0) AS favorite,COALESCE(w.revision,0) AS revision
      FROM instruments i JOIN catalog_rows r USING(instrument_id) JOIN catalog_generations g USING(generation)
      LEFT JOIN workspaces w USING(instrument_id) WHERE i.instrument_id=? AND g.activated=1 ORDER BY r.generation DESC LIMIT 1`).get(id) ?? fail('not_found');
    return WorkspaceItemSchema.parse({ schemaVersion: 'workspace_item_v1', ...row });
  }
  private async chart(id: string): Promise<WorkspaceChart | null> {
    const db = this.jobs.repository.db;
    const binding = db.sqlite.query<{ artifact: string; receipt: string }, [string]>(`SELECT b.artifact,b.receipt
      FROM data_sync_state s JOIN artifact_bindings b USING(binding_id) WHERE s.scope=? AND s.dataset='technical'`)
      .get(scopeKey({ kind: 'instrument-owned', instrumentId: id }));
    if (!binding) return null;
    const artifact = rowRef(objectRow(db, binding.artifact)), receipt = rowRef(objectRow(db, binding.receipt));
    if (this.queuedReads >= 8) fail('database_busy');
    this.queuedReads++;
    const read = this.readQueue.then(() => this.readChart(id, artifact, receipt));
    this.readQueue = read.catch(() => undefined);
    try { return await read; } finally { this.queuedReads--; }
  }
  private readChart(instrumentId: string, artifact: ObjectRef, receipt: ObjectRef): Promise<WorkspaceChart> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./workspace-read-worker.ts', import.meta.url).href);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      const timer = setTimeout(() => { finish(); reject(new WorkspaceError('reference_conflict')); }, 60_000);
      worker.onerror = () => { finish(); reject(new WorkspaceError('reference_conflict')); };
      worker.onmessage = (event: MessageEvent<{ ok: boolean; chart: WorkspaceChart }>) => {
        finish(); const parsed = WorkspaceChartSchema.safeParse(event.data.chart);
        if (event.data.ok && parsed.success) resolve(parsed.data); else reject(new WorkspaceError('reference_conflict'));
      };
      worker.postMessage({ root: this.jobs.repository.db.root, instrumentId, artifact, receipt });
    });
  }
  async handle(request: Request, url: URL, segments: readonly string[]): Promise<Response | null> {
    if (segments[0] !== 'api' || segments[1] !== 'workspace') return null;
    try {
      if (!isAllowedDashboardHost(request.headers.get('host'))) throw new DashboardSecurityErrorV1('forbidden_host');
      const route = segments.slice(2).join('/');
      const jobRoute = segments.length === 4 && segments[2] === 'jobs' && segments[3] !== 'active';
      const allow = ['search', 'session', 'recents', 'jobs/active'].includes(route) ? 'GET'
        : route === 'jobs' ? 'POST' : jobRoute ? 'GET, DELETE'
        : segments.length === 4 && segments[2] === 'instruments' ? 'GET'
        : segments.length === 5 && segments[2] === 'instruments' && ['open', 'favorite'].includes(segments[4]!) ? 'POST' : null;
      if (!allow) return errorResponse('invalid_input', 400);
      if (!allow.split(', ').includes(request.method)) return errorResponse('method_not_allowed', 405, { Allow: allow });
      this.jobs.repository.db.assertAvailable();
      if (request.method === 'DELETE') {
        this.session.requireMutation(request, url);
        if ([...url.searchParams].length) fail('invalid_input');
        if ((await readDashboardBody(request, 0)).byteLength) fail('invalid_input');
        const id = parse(Id, segments[3]), job = jobView(this.jobs.get(id));
        if (workspaceTerminal(job) || job.state === 'publishing') fail('revision_conflict');
        this.jobs.cancel(id);
        return response(jobView(this.jobs.get(id)), 202);
      }
      if (request.method === 'GET') {
        if (route === 'search') {
          if ([...url.searchParams.keys()].some(key => key !== 'q') || url.searchParams.getAll('q').length > 1) fail('invalid_input');
          return response({ schemaVersion: 'workspace_search_v1', items: this.jobs.repository.search(url.searchParams.get('q') ?? '') });
        }
        if ([...url.searchParams].length) fail('invalid_input');
        if (route === 'session') return response(this.session.view());
        if (route === 'recents') {
          const rows = this.jobs.repository.db.sqlite.query<{ instrument_id: string }, []>(
            'SELECT instrument_id FROM workspaces ORDER BY favorite DESC,last_opened_at DESC,instrument_id LIMIT 30').all();
          return response({ schemaVersion: 'workspace_recents_v1', items: rows.map(row => this.item(row.instrument_id)) });
        }
        if (route === 'jobs/active') {
          const active = await this.jobs.coordinator.active();
          return response({ schemaVersion: 'workspace_active_v1', job: active?.domain === 'workspace' ? jobView(this.jobs.get(active.jobId)) : null,
            blockingKind: active?.domain !== 'workspace' ? active?.kind ?? null : null });
        }
        if (segments.length === 4 && segments[2] === 'jobs') return response(jobView(this.jobs.get(parse(Id, segments[3]))));
        if (segments.length === 4 && segments[2] === 'instruments') {
          const id = parse(Id, segments[3]), item = this.item(id);
          const view: WorkspaceView = { schemaVersion: 'workspace_view_v1', item, chart: await this.chart(id) };
          return response(view);
        }
      } else if (request.method === 'POST') {
        this.session.requireMutation(request, url);
        if ([...url.searchParams].length) fail('invalid_input');
        requireDashboardJsonMediaType(request);
        const raw = parseStrictJsonBytesV1(await readDashboardBody(request, 4096), 4096);
        if (route === 'jobs') {
          const body = parse(z.discriminatedUnion('kind', [z.object({ kind: z.literal('catalog') }).strict(),
            z.object({ kind: z.literal('technical'), instrumentId: Id }).strict()]), raw);
          return response(jobView(this.jobs.get(await this.jobs.start(body.kind, 'instrumentId' in body ? body.instrumentId : undefined))), 202);
        }
        if (segments.length === 5 && segments[2] === 'instruments') {
          const id = parse(Id, segments[3]);
          if (segments[4] === 'open') {
            parse(z.object({}).strict(), raw); this.item(id); this.jobs.repository.openWorkspace(id); return response(this.item(id));
          }
          if (segments[4] === 'favorite') {
            const body = parse(z.object({ favorite: z.boolean(), revision: z.number().int().positive() }).strict(), raw);
            this.jobs.repository.db.transaction(() => {
              if (this.jobs.repository.db.sqlite.run('UPDATE workspaces SET favorite=?,revision=revision+1 WHERE instrument_id=? AND revision=?',
                [Number(body.favorite), id, body.revision]).changes !== 1) fail('revision_conflict');
            });
            return response(this.item(id));
          }
        }
      } else return errorResponse('method_not_allowed', 405);
      return errorResponse('invalid_input', 400);
    } catch (error) {
      if (error instanceof StrictJsonErrorV1) return errorResponse('invalid_input', 400);
      if (error instanceof DashboardSecurityErrorV1) { const failure = dashboardSecurityFailureV1(error, 'market_data'); return errorResponse(failure.code, failure.status); }
      if (error instanceof DashboardJobCoordinatorErrorV1) { const failure = dashboardCoordinatorFailureV1(error, 'workspace'); return response({ schemaVersion: 'workspace_error_v1', error: { code: failure.code, message: failure.message } }, failure.status,
        failure.retryAfterSeconds ? { 'Retry-After': String(failure.retryAfterSeconds) } : undefined); }
      if (error instanceof WorkspaceError) return errorResponse(error.code, error.code === 'not_found' ? 404 : error.code === 'invalid_input' ? 400
        : ['identity_review_required', 'revision_conflict'].includes(error.code) ? 409 : 500);
      return errorResponse('workspace_unavailable', 500);
    }
  }
}
