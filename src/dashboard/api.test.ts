import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AnalysisSnapshotPersistenceError,
  AnalysisSnapshotRepository,
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
} from '../analysis/snapshot/index.js';
import {
  handleDashboardRequest,
  isAllowedDashboardHost,
  type AnalysisSnapshotReader,
} from './api.js';

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<{ repository: AnalysisSnapshotRepository; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dexter-dashboard-'));
  temporaryDirectories.push(root);
  return { repository: new AnalysisSnapshotRepository(root), root };
}

function partialSnapshot(
  generatedAt = '2026-08-23T01:02:03.000Z',
  canonicalTicker = '7203',
): AnalysisSnapshot {
  const input: AnalysisSnapshotInput = {
    identity: {
      canonicalTicker,
      companyName: canonicalTicker === '7203' ? 'トヨタ自動車株式会社' : 'テスト株式会社',
      industry: '輸送用機器',
      listingStatus: 'listed',
      isDelisted: false,
      dataDate: '2026-08-21',
      sourceUrls: ['https://example.test/company'],
    },
    generatedAt,
    fundamental: null,
    valuation: null,
    peerComparison: null,
    peerCandidateMarketCapsComplete: null,
    technical: null,
    advancedTechnical: null,
    supplyDemand: null,
    reportedShortPositions: null,
    investorTypeFlows: null,
    marketCorrelation: null,
    sectorBenchmark: null,
    sectorShortRatio: null,
    advancedDividend: null,
    volumeProfile: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    reportedShortPositionSourceUrls: [],
    investorTypeFlowSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
      reportedShortPositions: { sourceFromJQuants: false },
      investorTypeFlows: { sourceFromJQuants: false, calendarFromJQuants: false },
      sectorBenchmark: { stockFromJQuants: false },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

function request(path: string, method = 'GET', host = '127.0.0.1'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { Host: host },
  });
}

function comparisonPath(baseSnapshotId: string, targetSnapshotId: string): string {
  const query = new URLSearchParams({ baseSnapshotId, targetSnapshotId });
  return `/api/analyses/7203/comparison?${query.toString()}`;
}

async function responseJson(response: Response): Promise<Record<string, unknown> | unknown[]> {
  return await response.json() as Record<string, unknown> | unknown[];
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('dashboard request handler', () => {
  test('serves latest metadata, latest detail, history metadata, and history detail', async () => {
    const { repository } = await createRepository();
    const older = partialSnapshot('2026-08-22T01:02:03.000Z');
    const latest = partialSnapshot('2026-08-23T01:02:03.000Z');
    const alpha = partialSnapshot('2026-08-23T02:03:04.000Z', '130A');
    await repository.save(older);
    const latestSaved = await repository.save(latest);
    await repository.save(alpha);

    const listResponse = await handleDashboardRequest(request('/api/analyses'), repository);
    const list = await responseJson(listResponse) as Array<Record<string, unknown>>;
    expect(list.map(item => item.canonicalTicker)).toEqual(['130A', '7203']);
    expect(list[0]).toMatchObject({
      latestSourceDataDate: '2026-08-21',
      metrics: {
        latestPrice: null,
        per: null,
        pbr: null,
        roe: null,
        trend: null,
        marginPercentile: null,
        beta250: null,
      },
    });
    expect(list[0]).not.toHaveProperty('finalReportMarkdown');

    const latestResponse = await handleDashboardRequest(request('/api/analyses/7203'), repository);
    expect(await responseJson(latestResponse)).toMatchObject({
      schemaVersion: 9,
      canonicalTicker: '7203',
      generatedAt: latest.generatedAt,
      finalReportMarkdown: '# Analysis',
    });

    const historyResponse = await handleDashboardRequest(
      request('/api/analyses/7203/history'),
      repository,
    );
    const history = await responseJson(historyResponse) as Array<Record<string, unknown>>;
    expect(history.map(item => item.generatedAt)).toEqual([
      latest.generatedAt,
      older.generatedAt,
    ]);
    expect(history[0]).not.toHaveProperty('finalReportMarkdown');

    const detailResponse = await handleDashboardRequest(
      request(`/api/analyses/7203/history/${latestSaved.snapshotId}`),
      repository,
    );
    expect(await responseJson(detailResponse)).toEqual(latest);
    expect(detailResponse.headers.get('cache-control')).toBe('no-store');
    expect(detailResponse.headers.has('access-control-allow-origin')).toBeFalse();
  });

  test('uses epoch-ordered immutable history for watchlist, latest detail, and history GET', async () => {
    const { repository } = await createRepository();
    const older = partialSnapshot('2026-08-23T01:02:03Z');
    const newer = partialSnapshot('2026-08-23T01:02:03.500Z');
    await repository.save(older);
    await repository.save(newer);
    await repository.save(older);

    const list = await responseJson(await handleDashboardRequest(
      request('/api/analyses'),
      repository,
    )) as Array<Record<string, unknown>>;
    expect(list[0]?.generatedAt).toBe(newer.generatedAt);

    const detail = await responseJson(await handleDashboardRequest(
      request('/api/analyses/7203'),
      repository,
    )) as Record<string, unknown>;
    expect(detail.generatedAt).toBe(newer.generatedAt);

    const history = await responseJson(await handleDashboardRequest(
      request('/api/analyses/7203/history'),
      repository,
    )) as Array<Record<string, unknown>>;
    expect(history.map(item => item.generatedAt)).toEqual([newer.generatedAt, older.generatedAt]);
  });

  test('serves the exact versioned comparison union with safe response headers', async () => {
    const { repository } = await createRepository();
    const base = await repository.save(partialSnapshot('2026-08-22T01:02:03.000Z'));
    const target = await repository.save(partialSnapshot('2026-08-23T01:02:03.000Z'));

    const response = await handleDashboardRequest(
      request(comparisonPath(base.snapshotId, target.snapshotId)),
      repository,
    );
    const body = await responseJson(response) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('access-control-allow-origin')).toBeFalse();
    expect(body).toMatchObject({
      resultVersion: 1,
      registryVersion: 1,
      outcome: 'success',
      ticker: '7203',
      base: { snapshotId: base.snapshotId },
      target: { snapshotId: target.snapshotId },
      comparisonAsOf: '2026-08-23T01:02:03.000Z',
    });
    expect((body.base as Record<string, unknown>).snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((body.target as Record<string, unknown>).snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body).not.toHaveProperty('finalReportMarkdown');
  });

  test('maps invalid comparison selectors and order to exact 400 failures before reads', async () => {
    const { repository } = await createRepository();
    const base = await repository.save(partialSnapshot('2026-08-22T01:02:03.000Z'));
    const target = await repository.save(partialSnapshot('2026-08-23T01:02:03.000Z'));
    const cases = [
      ['/api/analyses/7203/comparison', 'invalid_base_snapshot_id'],
      [`/api/analyses/7203/comparison?baseSnapshotId=${base.snapshotId}`, 'invalid_target_snapshot_id'],
      [comparisonPath('latest', target.snapshotId), 'invalid_base_snapshot_id'],
      [`${comparisonPath(base.snapshotId, target.snapshotId)}&baseSnapshotId=${base.snapshotId}`, 'invalid_base_snapshot_id'],
      [comparisonPath(base.snapshotId, base.snapshotId), 'same_snapshot_id'],
      [comparisonPath(target.snapshotId, base.snapshotId), 'invalid_order'],
    ] as const;

    for (const [path, code] of cases) {
      const response = await handleDashboardRequest(request(path), repository);
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({
        resultVersion: 1,
        registryVersion: 1,
        outcome: 'failure',
        error: { code },
      });
    }
  });

  test('uses side-specific 404 comparison failures', async () => {
    const { repository } = await createRepository();
    const base = await repository.save(partialSnapshot('2026-08-22T01:02:03.000Z'));
    const target = await repository.save(partialSnapshot('2026-08-23T01:02:03.000Z'));
    const missingBase = '2026-08-21T01-02-03-000Z';
    const missingTarget = '2026-08-24T01-02-03-000Z';

    for (const [path, code] of [
      [comparisonPath(missingBase, target.snapshotId), 'base_snapshot_not_found'],
      [comparisonPath(base.snapshotId, missingTarget), 'target_snapshot_not_found'],
    ] as const) {
      const response = await handleDashboardRequest(request(path), repository);
      expect(response.status).toBe(404);
      expect(await responseJson(response)).toMatchObject({ outcome: 'failure', error: { code } });
    }
  });

  test('maps corrupt, unsupported, and filesystem comparison failures to exact safe 500 unions', async () => {
    const base = partialSnapshot('2026-08-22T01:02:03.000Z');
    const target = partialSnapshot('2026-08-23T01:02:03.000Z');
    const baseId = '2026-08-22T01-02-03-000Z';
    const targetId = '2026-08-23T01-02-03-000Z';

    for (const [kind, code] of [
      ['schema_validation_failed', 'corrupt_snapshot'],
      ['unsupported_schema_version', 'unsupported_snapshot_version'],
      ['filesystem_error', 'snapshot_filesystem_failure'],
    ] as const) {
      const repository: AnalysisSnapshotReader = {
        listLatest: async () => [],
        loadLatest: async () => target,
        listHistory: async () => [],
        loadHistory: async (_ticker, snapshotId) => {
          if (snapshotId === baseId) return base;
          throw new AnalysisSnapshotPersistenceError(kind, 'private path and parser details');
        },
      };
      const response = await handleDashboardRequest(
        request(comparisonPath(baseId, targetId)),
        repository,
      );
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toContain(`\"code\":\"${code}\"`);
      expect(body).not.toContain('private path');
      expect(body).not.toContain('parser details');
    }
  });

  test('maps a returned Snapshot ticker mismatch to an exact 400 comparison failure', async () => {
    const baseId = '2026-08-22T01-02-03-000Z';
    const targetId = '2026-08-23T01-02-03-000Z';
    const repository: AnalysisSnapshotReader = {
      listLatest: async () => [],
      loadLatest: async () => partialSnapshot(),
      listHistory: async () => [],
      loadHistory: async (_ticker, snapshotId) => snapshotId === baseId
        ? partialSnapshot('2026-08-22T01:02:03.000Z', '6758')
        : partialSnapshot('2026-08-23T01:02:03.000Z'),
    };

    const response = await handleDashboardRequest(
      request(comparisonPath(baseId, targetId)),
      repository,
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      outcome: 'failure',
      error: { code: 'base_ticker_mismatch' },
    });
  });

  test('returns safe errors for unknown ticker and history snapshots', async () => {
    const { repository } = await createRepository();
    await repository.save(partialSnapshot());

    const unknownTicker = await handleDashboardRequest(
      request('/api/analyses/6758'),
      repository,
    );
    const unknownHistory = await handleDashboardRequest(
      request('/api/analyses/6758/history'),
      repository,
    );
    const unknownSnapshot = await handleDashboardRequest(
      request('/api/analyses/7203/history/2026-08-22T00-00-00-000Z'),
      repository,
    );

    expect(unknownTicker.status).toBe(404);
    expect(unknownHistory.status).toBe(404);
    expect(unknownSnapshot.status).toBe(404);
    expect(await responseJson(unknownSnapshot)).toEqual({
      error: {
        code: 'snapshot_not_found',
        message: 'The requested analysis snapshot was not found.',
      },
    });
  });

  test('rejects unsafe or malformed route parameters before filesystem access', async () => {
    const { repository } = await createRepository();

    const unsafeTicker = await handleDashboardRequest(
      request('/api/analyses/%2E%2E%2F7203'),
      repository,
    );
    const unsafeSnapshot = await handleDashboardRequest(
      request('/api/analyses/7203/history/latest'),
      repository,
    );
    const malformedEncoding = await handleDashboardRequest(
      request('/api/analyses/%ZZ'),
      repository,
    );

    expect(unsafeTicker.status).toBe(400);
    expect(unsafeSnapshot.status).toBe(400);
    expect(malformedEncoding.status).toBe(400);
  });

  test('rejects unsupported methods without enabling CORS', async () => {
    const { repository } = await createRepository();

    const response = await handleDashboardRequest(request('/api/analyses', 'POST'), repository);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('access-control-allow-origin')).toBeFalse();
  });

  test('allows only local IPv4 and localhost Host headers', async () => {
    expect([
      '127.0.0.1',
      '127.0.0.1:3000',
      'localhost',
      'localhost:65535',
      'LOCALHOST:3000',
    ].every(isAllowedDashboardHost)).toBeTrue();
    expect([
      null,
      '127.0.0.2',
      'localhost:0',
      'localhost:65536',
      'localhost.example.com',
      '[::1]:3000',
    ].some(isAllowedDashboardHost)).toBeFalse();

    const { repository } = await createRepository();
    const response = await handleDashboardRequest(
      request('/api/analyses', 'GET', 'example.com'),
      repository,
    );

    expect(response.status).toBe(403);
    expect(await responseJson(response)).toEqual({
      error: {
        code: 'forbidden_host',
        message: 'The request Host is not allowed.',
      },
    });
  });

  test('serves the bundled dashboard and its same-origin assets with CSP', async () => {
    const { repository } = await createRepository();

    const response = await handleDashboardRequest(request('/'), repository);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(html).toContain('Dexter JP Dashboard');
    expect(html).toContain('<script');

    const scriptPath = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    expect(scriptPath).toBeDefined();
    const scriptResponse = await handleDashboardRequest(request(scriptPath!), repository);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get('content-type')).toContain('javascript');
    expect(scriptResponse.headers.get('cache-control')).toBe('no-store');
  });

  test('does not return extraneous secret-like persisted input', async () => {
    const { repository } = await createRepository();
    await repository.save({
      ...partialSnapshot(),
      apiKey: 'must-not-survive',
      rawPrompt: 'must-not-survive',
      rawToolArgs: 'must-not-survive',
    });

    const response = await handleDashboardRequest(request('/api/analyses/7203'), repository);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('must-not-survive');
  });

  test('does not expose filesystem details or stack traces for corrupted snapshots', async () => {
    const { repository, root } = await createRepository();
    await mkdir(join(root, '7203'), { recursive: true });
    await writeFile(join(root, '7203', 'latest.json'), '{invalid', 'utf8');

    const response = await handleDashboardRequest(request('/api/analyses/7203'), repository);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({
      error: {
        code: 'snapshot_unavailable',
        message: 'The requested analysis snapshot is unavailable.',
      },
    }));
    expect(body).not.toContain(root);
    expect(body).not.toContain('SyntaxError');
  });

  test('maps immutable-history resolution failure to one sanitized 500 response', async () => {
    const { repository, root } = await createRepository();
    await repository.save(partialSnapshot());
    await writeFile(join(root, '7203', 'unexpected.json'), '{invalid', 'utf8');

    for (const path of [
      '/api/analyses',
      '/api/analyses/7203',
      '/api/analyses/7203/history',
    ]) {
      const response = await handleDashboardRequest(request(path), repository);
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(body).toBe(JSON.stringify({
        error: {
          code: 'snapshot_unavailable',
          message: 'The requested analysis snapshot is unavailable.',
        },
      }));
      expect(body).not.toContain(root);
      expect(body).not.toContain('unexpected.json');
    }
  });

  test('does not expose identity mismatch details through the API', async () => {
    const { repository, root } = await createRepository();
    await mkdir(join(root, '7203'), { recursive: true });
    await writeFile(
      join(root, '7203', 'latest.json'),
      JSON.stringify(partialSnapshot('2026-08-23T01:02:03.000Z', '6758')),
      'utf8',
    );

    const response = await handleDashboardRequest(request('/api/analyses/7203'), repository);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({
      error: {
        code: 'snapshot_unavailable',
        message: 'The requested analysis snapshot is unavailable.',
      },
    }));
    expect(body).not.toContain('6758');
    expect(body).not.toContain(root);
  });
});
