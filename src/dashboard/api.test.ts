import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AnalysisSnapshotRepository,
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotInput,
} from '../analysis/snapshot/index.js';
import { handleDashboardRequest } from './api.js';

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
    supplyDemand: null,
    marketCorrelation: null,
    strategy: null,
    priceHistory: null,
    scenarios: null,
    risks: null,
    finalReportMarkdown: '# Analysis',
    priceSourceUrls: [],
    peerSourceUrls: [],
    sourceUsage: {
      valuation: { priceFromJQuants: false, financialsFromEdinetDb: false },
      technical: { priceFromJQuants: false },
      supplyDemand: { marginFromJQuants: false, volumeFromJQuants: false },
      marketCorrelation: { stockFromJQuants: false, benchmarkFromJQuants: false },
    },
    additionalUnavailable: [],
  };
  return buildAnalysisSnapshot(input);
}

function request(path: string, method = 'GET'): Request {
  return new Request(`http://127.0.0.1${path}`, { method });
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
    expect(list[0]).not.toHaveProperty('finalReportMarkdown');

    const latestResponse = await handleDashboardRequest(request('/api/analyses/7203'), repository);
    expect(await responseJson(latestResponse)).toMatchObject({
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

  test('serves only the minimal static entry with CSP and an explicit content type', async () => {
    const { repository } = await createRepository();

    const response = await handleDashboardRequest(request('/'), repository);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(html).toContain('Dexter JP Dashboard');
    expect(html).not.toContain('<script');
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
});
