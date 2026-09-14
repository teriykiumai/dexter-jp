import { z } from 'zod';
import { WorkspaceAiJobs } from '../analysis/workspace/ai-jobs.js';
import { AiProfileSchema } from '../analysis/workspace/ai-contracts.js';
import { Id, parse, fail } from '../analysis/workspace/contracts.js';
import { parseStrictJsonBytesV1 } from '../analysis/strategy-validation/strict-json.js';
import { DashboardSessionV1, requireDashboardJsonMediaType, readDashboardBody } from './session.js';

export class WorkspaceAiApi {
  constructor(readonly jobs: WorkspaceAiJobs, readonly session: DashboardSessionV1) {}
  async handle(request: Request, url: URL, segments: readonly string[]): Promise<Response> {
    const id = parse(Id, segments[3]), leaf = segments[5], item = segments[6];
    const list = segments.length === 5, start = segments.length === 6 && leaf === 'jobs',
      job = segments.length === 7 && leaf === 'jobs', detail = segments.length === 7 && leaf === 'runs';
    const respond = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
    const allowed = list || detail ? 'GET' : start ? 'POST' : job ? 'GET, DELETE' : null;
    if (!allowed) fail('invalid_input');
    if (!allowed.split(', ').includes(request.method)) return respond({ schemaVersion: 'workspace_error_v1', error: { code: 'method_not_allowed' } }, 405, { Allow: allowed });
    if ([...url.searchParams.keys()].some(key => !list || key !== 'before') || url.searchParams.getAll('before').length > 1) fail('invalid_input');
    if (request.method === 'GET') {
      if (list) return respond(await this.jobs.history(id, url.searchParams.get('before')));
      await this.jobs.initialize();
      if (job) return respond(this.jobs.get(id, parse(Id, item)));
      return respond(await this.jobs.detail(id, parse(Id, item)));
    }
    this.session.requireMutation(request, url);
    if (request.method === 'DELETE') {
      if ((await readDashboardBody(request, 0)).byteLength) fail('invalid_input');
      return respond(this.jobs.cancel(id, parse(Id, item)), 202);
    }
    requireDashboardJsonMediaType(request);
    const body = parse(z.object({ profile: AiProfileSchema }).strict(), parseStrictJsonBytesV1(await readDashboardBody(request, 1024), 1024));
    try { return respond(await this.jobs.start(id, body.profile), 202); }
    catch (error) {
      if (error instanceof Error && error.message === 'model_unavailable') return respond({ schemaVersion: 'workspace_error_v1', error: { code: 'model_unavailable' } }, 409);
      throw error;
    }
  }
}
