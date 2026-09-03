import { expect, test } from 'bun:test';
import { DashboardSessionV1, DashboardSecurityErrorV1, dashboardSecurityFailureV1, readDashboardBody } from './session.js';

test('shared session capability is usable by either native adapter, but not another process session', () => {
  const shared = new DashboardSessionV1(); const restarted = new DashboardSessionV1();
  const request = new Request('http://127.0.0.1:3000/api/example', { method: 'POST', headers: {
    Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-Dexter-CSRF': shared.view().csrfToken,
  } });
  expect(() => shared.requireMutation(request, new URL(request.url))).not.toThrow();
  expect(() => restarted.requireMutation(request, new URL(request.url))).toThrow(DashboardSecurityErrorV1);
  for (const reason of ['forbidden_host', 'forbidden_origin', 'csrf_failed', 'payload_too_large'] as const) {
    expect(dashboardSecurityFailureV1(new DashboardSecurityErrorV1(reason), 'strategy_validation').code).toBe(reason);
    expect(dashboardSecurityFailureV1(new DashboardSecurityErrorV1(reason), 'market_data').code)
      .toBe(reason === 'payload_too_large' ? 'request_body_too_large' : 'request_forbidden');
  }
});

test('shared body accounting rejects a chunked overflow despite a misleading Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } });
  const request = new Request('http://localhost/api/example', { method: 'POST', body: stream, headers: { 'content-length': '1' } });
  await expect(readDashboardBody(request, 4096)).rejects.toMatchObject({ reason: 'payload_too_large' });
  expect(cancelled).toBe(true);
});
