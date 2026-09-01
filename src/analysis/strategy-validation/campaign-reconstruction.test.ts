import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisSnapshotRepository } from '../snapshot/repository.js';
import { comparisonSnapshot } from '../comparison/test-fixtures.js';
import { analyzeStrategy } from '../../tools/finance/strategy-engine.js';
import { analyzeTechnical } from '../../tools/finance/technical-engine.js';
import {
  CAMPAIGN_RECONSTRUCTION_WARNING_V1,
  CAMPAIGN_TECHNICAL_SESSION_COUNT_V1,
  createCampaignReconstructionPreflightV1,
  executeCampaignReconstructionV1,
  reconstructCampaignCandidatesV1,
  selectCampaignCandidateSessionsV1,
} from './campaign-reconstruction.js';
import { createTseSessionCalendarV1 } from './calendar.js';
import { parseTseSessionDate } from './date.js';
import type { TseDailyBarV1 } from './daily-bar.js';
import {
  JQuantsExecutionRuntimeV1,
  acceptJQuantsExecutionV1,
  type JQuantsExecutionEnvironmentV1,
} from './jquants-execution.js';
import {
  JQuantsValidationAdapterV1,
  type JQuantsMasterResultV1,
} from './jquants-validation-adapter.js';
import type { StrategyValidationCampaignManifestV1 } from './manifest.js';
import { StrategyValidationRunRepositoryV1 } from './run-repository.js';
import {
  parseValidateStrategyCliArgsV1,
  runValidateStrategyCliV1,
} from './validate-strategy-cli.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function dates(from: string, to: string): string[] {
  const result: string[] = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`);
    cursor <= Date.parse(`${to}T00:00:00.000Z`);
    cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function calendar(from: string, to: string) {
  return createTseSessionCalendarV1(
    dates(from, to).map(date => ({ Date: date, HolDiv: isWeekday(date) ? '1' : '0' })),
    from,
    to,
  );
}

function technicalBars(
  sessions: readonly string[],
  offset = 0,
): readonly TseDailyBarV1[] {
  const wave = [0, 1, 3, 6, 3, 1, 0, -4, 0, 1];
  return sessions.map((date, index) => {
    const close = offset + 100 + index * 0.02 + wave[index % wave.length]!;
    return Object.freeze({
      date: parseTseSessionDate(date),
      open: close,
      high: close + 2,
      low: close - 2,
      close,
      upperLimitFlag: '0' as const,
      lowerLimitFlag: '0' as const,
      adjustmentFactor: 1,
      exRightsType: null,
    });
  });
}

function master(): JQuantsMasterResultV1 {
  return {
    state: 'available',
    observation: {
      date: parseTseSessionDate('2025-12-31'),
      code: '72030',
      ticker: '7203',
      tickCategory: 'other',
      scaleCategory: null,
      marketCode: '0111',
      productCategory: '011',
    },
    envelope: {} as never,
  };
}

function manifest(): StrategyValidationCampaignManifestV1 {
  return Object.freeze({
    schemaVersion: 'strategy_validation_campaign_v1',
    name: 'fixed-window',
    anchors: Object.freeze([Object.freeze({
      ticker: '7203',
      anchorDate: '2025-12-31',
      resistanceEvidence: Object.freeze([]),
    })]),
  });
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function repositories(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return {
    directory,
    snapshots: new AnalysisSnapshotRepository(join(directory, 'analysis')),
    runs: new StrategyValidationRunRepositoryV1(join(directory, 'research'), {
      promoteDirectory: rename,
    }),
  };
}

function validationEnvironment(options: Readonly<{
  calendarRows?: (url: URL, rows: readonly string[]) => readonly string[];
  dailyBars: (url: URL, sessions: readonly string[]) => readonly TseDailyBarV1[];
}>) {
  let wallMs = Date.parse('2026-08-01T00:00:01.000Z');
  let monotonicMs = 0;
  const requests: URL[] = [];
  const environment: JQuantsExecutionEnvironmentV1 = {
    fetch: async input => {
      const url = new URL(String(input));
      requests.push(url);
      const from = url.searchParams.get('from')!;
      const to = url.searchParams.get('to')!;
      if (url.pathname === '/v2/markets/calendar') {
        const rows = options.calendarRows?.(url, dates(from, to)) ?? dates(from, to);
        return response({
          data: rows.map(date => ({ Date: date, HolDiv: isWeekday(date) ? '1' : '0' })),
        });
      }
      const sourceCode = url.searchParams.get('code')!;
      if (url.pathname === '/v2/equities/master') {
        return response({ data: [{
          Date: url.searchParams.get('date'),
          Code: sourceCode,
          ScaleCat: 'その他',
          Mkt: '0111',
          ProdCat: '011',
        }] });
      }
      const bars = options.dailyBars(url, dates(from, to).filter(isWeekday));
      return response({ data: bars.map(bar => ({
        Date: bar.date,
        Code: sourceCode,
        O: bar.open,
        H: bar.high,
        L: bar.low,
        C: bar.close,
        UL: bar.upperLimitFlag,
        LL: bar.lowerLimitFlag,
        AdjFactor: bar.adjustmentFactor,
        ExRT: bar.exRightsType,
      })) });
    },
    wallNowMs: () => wallMs,
    monotonicNowMs: () => monotonicMs,
    sleep: (durationMs, signal) => {
      if (signal !== undefined && durationMs === 30_000) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      wallMs += durationMs;
      monotonicMs += durationMs;
      return Promise.resolve();
    },
    apiKey: () => 'test-key',
  };
  return { environment, requests };
}

function flatBars(
  sessions: readonly string[],
  price: number,
): readonly TseDailyBarV1[] {
  return sessions.map(date => Object.freeze({
    date: parseTseSessionDate(date),
    open: price,
    high: price + 1,
    low: price - 1,
    close: price,
    upperLimitFlag: '0' as const,
    lowerLimitFlag: '0' as const,
    adjustmentFactor: 1,
    exRightsType: null,
  }));
}

describe('historical Strategy reconstruction', () => {
  test('parses the mutually exclusive manifest CLI mode', () => {
    expect(parseValidateStrategyCliArgsV1([
      '--manifest', 'campaign.json', '--confirm-external-fetch',
    ])).toEqual({
      manifestPath: 'campaign.json',
      confirmedExternalFetch: true,
    });
    for (const invalid of [
      ['--manifest', 'campaign.json', '--ticker', '7203'],
      ['--manifest', 'a.json', '--manifest', 'b.json'],
      ['--manifest'],
      [],
    ]) {
      expect(() => parseValidateStrategyCliArgsV1(invalid)).toThrow(
        expect.objectContaining({ code: 'invalid_configuration' }),
      );
    }
  });

  test('reads the strict manifest before default-No external confirmation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dexter-campaign-cli-'));
    directories.push(directory);
    const manifestPath = join(directory, 'campaign.json');
    await writeFile(manifestPath, JSON.stringify(manifest()));
    let confirmationCount = 0;
    await expect(runValidateStrategyCliV1(['--manifest', manifestPath], {
      snapshotRepository: new AnalysisSnapshotRepository(join(directory, 'analysis')),
      runRepository: new StrategyValidationRunRepositoryV1(join(directory, 'research'), {
        promoteDirectory: rename,
      }),
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
      confirm: async warning => {
        confirmationCount += 1;
        expect(warning).toContain('technical_251_strategy_v1 (not production-pipeline parity)');
        expect(warning).not.toContain(manifestPath);
        return false;
      },
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(confirmationCount).toBe(1);
  });

  test('selects exactly t0 and its preceding 250 sessions independent of older rows', () => {
    const short = calendar('2024-12-01', '2025-12-31');
    const long = calendar('2020-01-01', '2025-12-31');
    const shortWindow = selectCampaignCandidateSessionsV1(short, '2025-12-31');
    const longWindow = selectCampaignCandidateSessionsV1(long, '2025-12-31');
    expect(shortWindow).toHaveLength(CAMPAIGN_TECHNICAL_SESSION_COUNT_V1);
    expect(longWindow).toEqual(shortWindow);
    expect(longWindow.at(-1)).toBe(parseTseSessionDate('2025-12-31'));
  });

  test('proves the fixed-window policy can differ from full-history production input', () => {
    const sessions = calendar('2024-12-01', '2025-12-31').sessions.slice(-258);
    const bars = sessions.map((date, index) => ({
      date,
      open: 100 + index,
      high: index === 3 ? 1_000 : 102 + index,
      low: 98 + index,
      close: 100 + index,
      volume: null,
    }));
    const productionTechnical = analyzeTechnical(bars);
    const reconstructedTechnical = analyzeTechnical(bars.slice(-251));
    expect(productionTechnical.latestSwingHigh).toBe(1_000);
    expect(reconstructedTechnical.latestSwingHigh).toBeNull();
    expect(analyzeStrategy(productionTechnical, { tickSize: 1 }).candidates.length)
      .toBeGreaterThan(0);
    expect(analyzeStrategy(reconstructedTechnical, { tickSize: 1 }).candidates).toEqual([]);
  });

  test('maps normalized resistance collisions to the exact candidate digest union', () => {
    const sessions = calendar('2024-12-01', '2025-12-31').sessions.slice(-251);
    const digestA = `sha256:${'a'.repeat(64)}` as const;
    const digestB = `sha256:${'b'.repeat(64)}` as const;
    const reconstructed = reconstructCampaignCandidatesV1({
      ticker: '7203',
      anchorDate: parseTseSessionDate('2025-12-31'),
      sessions,
      bars: technicalBars(sessions),
      master: master(),
      resistanceEvidence: {
        state: 'available',
        levels: [
          { price: 120.1, snapshotDigests: [digestA] },
          { price: 120.9, snapshotDigests: [digestB] },
        ],
      },
    });
    expect(reconstructed.state).toBe('available');
    if (reconstructed.state !== 'available') return;
    const resistance = reconstructed.candidates.filter(candidate => (
      candidate.candidate.target.reason === 'resistance_level'
    ));
    expect(resistance.length).toBeGreaterThan(0);
    expect(new Set(resistance.map(candidate => candidate.candidate.target.price))).toEqual(
      new Set([120]),
    );
    expect(resistance.every(candidate => (
      candidate.resistanceEvidenceSnapshotDigests.join(',') === `${digestA},${digestB}`
    ))).toBe(true);
    expect(reconstructed.candidates
      .filter(candidate => candidate.candidate.target.reason === 'risk_reward_2R')
      .every(candidate => candidate.resistanceEvidenceSnapshotDigests.length === 0)).toBe(true);
  });

  test('fails a missing-OHLC technical window closed without shortening it', () => {
    const sessions = calendar('2024-12-01', '2025-12-31').sessions.slice(-251);
    const bars = [...technicalBars(sessions)];
    bars[100] = Object.freeze({
      ...bars[100]!,
      open: null,
      high: null,
      low: null,
      close: null,
    });
    expect(reconstructCampaignCandidatesV1({
      ticker: '7203',
      anchorDate: parseTseSessionDate('2025-12-31'),
      sessions,
      bars,
      master: master(),
      resistanceEvidence: { state: 'available', levels: [] },
    })).toEqual({ state: 'unavailable', reason: 'invalid_candidate' });
  });

  test('accepts only exact, temporally valid persisted resistance targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dexter-campaign-evidence-'));
    directories.push(directory);
    const snapshots = new AnalysisSnapshotRepository(join(directory, 'analysis'));
    const snapshot = comparisonSnapshot();
    snapshot.generatedAt = '2026-08-21T01:00:00.000Z';
    snapshot.strategy!.dataDate = '2026-08-21';
    snapshot.strategy!.candidates[0]!.target = {
      price: 3_600,
      reason: 'resistance_level',
    };
    snapshot.strategy!.candidates[1]!.target = {
      price: 9_999,
      reason: 'risk_reward_2R',
    };
    const saved = await snapshots.save(snapshot);
    const withReference: StrategyValidationCampaignManifestV1 = {
      schemaVersion: 'strategy_validation_campaign_v1',
      name: 'resistance',
      anchors: [{
        ticker: '7203',
        anchorDate: '2026-08-21',
        resistanceEvidence: [{ kind: 'analysis_snapshot', snapshotId: saved.snapshotId }],
      }],
    };
    const valid = await createCampaignReconstructionPreflightV1(withReference, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(valid.anchors[0]!.resistanceEvidence).toMatchObject({
      state: 'available',
      levels: [{ price: 3_600 }],
    });

    const futureClaim = comparisonSnapshot();
    futureClaim.generatedAt = '2026-08-20T01:00:00.000Z';
    futureClaim.strategy!.dataDate = '2026-08-21';
    futureClaim.strategy!.candidates[0]!.target = {
      price: 3_700,
      reason: 'resistance_level',
    };
    const invalidSaved = await snapshots.save(futureClaim);
    const invalid = await createCampaignReconstructionPreflightV1({
      ...withReference,
      anchors: [{
        ...withReference.anchors[0]!,
        resistanceEvidence: [{
          kind: 'analysis_snapshot',
          snapshotId: invalidSaved.snapshotId,
        }],
      }],
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-12-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(invalid.anchors[0]!.resistanceEvidence).toEqual({
      state: 'unavailable', reason: 'resistance_evidence_invalid',
    });
    expect(invalid.executionPlan.estimatedMinimumAttempts).toBe(1);
  });

  test('gives the official-session guard precedence over invalid resistance evidence', async () => {
    const { snapshots, runs } = await repositories('dexter-campaign-session-guard-');
    const preflight = await createCampaignReconstructionPreflightV1({
      schemaVersion: 'strategy_validation_campaign_v1',
      name: 'non-session',
      anchors: [{
        ticker: '7203',
        anchorDate: '2025-12-28',
        resistanceEvidence: [{
          kind: 'analysis_snapshot',
          snapshotId: '2025-01-01T00-00-00-000Z',
        }],
      }],
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(preflight.anchors[0]!.resistanceEvidence.state).toBe('unavailable');
    const { environment, requests } = validationEnvironment({
      dailyBars: (_url, sessions) => flatBars(sessions, 50),
    });
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    await expect(executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
    })).rejects.toMatchObject({ code: 'calendar_incomplete' });
    expect(requests.map(url => url.pathname)).toEqual(['/v2/markets/calendar']);
    expect(await runs.list()).toEqual([]);
  });

  test('retains the shared planning calendar when resistance evidence ends the anchor early', async () => {
    const { snapshots, runs } = await repositories('dexter-campaign-planning-evidence-');
    const preflight = await createCampaignReconstructionPreflightV1({
      schemaVersion: 'strategy_validation_campaign_v1',
      name: 'planning-evidence',
      anchors: [{
        ticker: '7203',
        anchorDate: '2025-12-31',
        resistanceEvidence: [{
          kind: 'analysis_snapshot',
          snapshotId: '2025-01-01T00-00-00-000Z',
        }],
      }],
    }, {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(preflight.anchors[0]!.resistanceEvidence.state).toBe('unavailable');
    const { environment, requests } = validationEnvironment({
      dailyBars: (_url, sessions) => flatBars(sessions, 50),
    });
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    const derivedOutcomeAsOfSessions: string[] = [];
    const result = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
      onOutcomeAsOfSession: value => { derivedOutcomeAsOfSessions.push(value); },
    });
    const loaded = await runs.load(result.runId);
    expect(loaded.cases).toMatchObject([{
      caseKind: 'anchor_unavailable',
      unavailableReason: 'resistance_evidence_invalid',
      outcomeAsOfSession: '2026-07-31',
      sourceManifest: { sources: [{ role: 'outcome_calendar' }] },
    }]);
    expect(loaded.sources).toHaveLength(1);
    expect(loaded.sources[0]!.result.state).toBe('available');
    expect(derivedOutcomeAsOfSessions).toEqual(['2026-07-31']);
    expect(requests.map(url => url.pathname)).toEqual(['/v2/markets/calendar']);
  });

  test('keeps a campaign complete when one exact candidate calendar is incomplete', async () => {
    const { snapshots, runs } = await repositories('dexter-campaign-calendar-gap-');
    const campaign: StrategyValidationCampaignManifestV1 = {
      schemaVersion: 'strategy_validation_campaign_v1',
      name: 'calendar-gap',
      anchors: [
        { ticker: '7203', anchorDate: '2025-12-30', resistanceEvidence: [] },
        { ticker: '7203', anchorDate: '2025-12-31', resistanceEvidence: [] },
      ],
    };
    const preflight = await createCampaignReconstructionPreflightV1(campaign, {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { environment, requests } = validationEnvironment({
      calendarRows: (url, rows) => url.searchParams.get('to') === '2025-12-30'
        ? rows.filter((_date, index) => index !== 10)
        : rows,
      dailyBars: (url, sessions) => url.searchParams.get('to') === '2025-12-31'
        ? technicalBars(sessions)
        : flatBars(sessions, 50),
    });
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    const result = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    const incomplete = loaded.cases.find(value => value.anchorDate === '2025-12-30');
    expect(incomplete).toMatchObject({
      caseKind: 'anchor_unavailable',
      unavailableReason: 'calendar_incomplete',
      outcomeAsOfSession: '2026-07-31',
      sourceManifest: {
        outcomeAsOfSession: '2026-07-31',
        sources: [
          { role: 'candidate_calendar' },
          { role: 'outcome_calendar' },
        ],
      },
    });
    expect(loaded.cases.some(value => value.anchorDate === '2025-12-31'
      && value.caseKind === 'candidate')).toBe(true);
    const incompleteReference = incomplete!.sourceManifest.sources[0]!;
    expect(loaded.sources.find(source => source.digest === incompleteReference.digest)?.result)
      .toEqual({ state: 'unavailable', reason: 'calendar_incomplete', rows: [] });
    expect(requests.some(url => url.pathname === '/v2/equities/bars/daily'
      && url.searchParams.get('to') === '2025-12-30')).toBe(false);
  });

  test('persists Engine entry-tick injection and cross-band per-level failure', async () => {
    const { snapshots, runs } = await repositories('dexter-campaign-cross-band-');
    const preflight = await createCampaignReconstructionPreflightV1(manifest(), {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const { environment } = validationEnvironment({
      dailyBars: (url, sessions) => url.searchParams.get('to') === '2025-12-31'
        ? technicalBars(sessions, 2_886)
        : flatBars(sessions, 50),
    });
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    const result = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    const crossBand = loaded.cases.find(value => value.caseKind === 'candidate'
      && value.tickEvidence.levels.target.executable === false);
    expect(crossBand).toMatchObject({
      caseKind: 'candidate',
      candidate: { entry: { price: 2_999 } },
      tickEvidence: {
        levels: {
          entry: { tick: 1, executable: true },
          target: { tick: 5, executable: false },
        },
      },
      outcome: { kind: 'unavailable', reason: 'non_executable_tick' },
    });
  });

  test('observes an entry on t20 through holding day 60 at evaluation session 79', async () => {
    const { snapshots, runs } = await repositories('dexter-campaign-t20-h60-');
    const preflight = await createCampaignReconstructionPreflightV1(manifest(), {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    const candidateSessions = calendar('2024-12-01', '2025-12-31').sessions.slice(-251);
    const reconstructed = reconstructCampaignCandidatesV1({
      ticker: '7203',
      anchorDate: parseTseSessionDate('2025-12-31'),
      sessions: candidateSessions,
      bars: technicalBars(candidateSessions),
      master: master(),
      resistanceEvidence: { state: 'available', levels: [] },
    });
    if (reconstructed.state !== 'available') throw new Error('Fixture candidate is unavailable.');
    const entry = reconstructed.candidates[0]!.candidate.entry.price;
    const outcomeSessions = calendar('2025-12-31', '2026-08-01').sessions
      .filter(date => date > '2025-12-31')
      .slice(0, 79);
    const safePrice = entry + 1;
    const { environment } = validationEnvironment({
      dailyBars: (url, sessions) => {
        if (url.searchParams.get('to') === '2025-12-31') return technicalBars(sessions);
        return sessions.map((date, index) => {
          const waiting = index < 19;
          const open = waiting ? entry - 2 : safePrice;
          return Object.freeze({
            date: parseTseSessionDate(date),
            open,
            high: waiting ? entry - 1 : safePrice,
            low: waiting ? entry - 3 : safePrice,
            close: open,
            upperLimitFlag: '0' as const,
            lowerLimitFlag: '0' as const,
            adjustmentFactor: 1,
            exRightsType: null,
          });
        });
      },
    });
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    const result = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    const candidates = loaded.cases.filter(value => value.caseKind === 'candidate');
    expect(candidates.length).toBeGreaterThan(0);
    for (const value of candidates) {
      if (value.caseKind !== 'candidate') continue;
      expect(value.outcome).toMatchObject({
        kind: 'horizon_expired',
        evaluationEndDate: outcomeSessions[78],
        entryFill: {
          date: outcomeSessions[19],
          evaluationSession: 20,
          holdingDay: 1,
        },
        mark: { date: outcomeSessions[78] },
      });
    }
  });

  test('publishes and reloads an immutable campaign-global run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dexter-campaign-reconstruction-'));
    directories.push(directory);
    const snapshots = new AnalysisSnapshotRepository(join(directory, 'analysis'));
    const runs = new StrategyValidationRunRepositoryV1(join(directory, 'research'), {
      promoteDirectory: rename,
    });
    const preflight = await createCampaignReconstructionPreflightV1(manifest(), {
      snapshotRepository: snapshots,
      startedAt: '2026-08-01T00:00:00.000Z',
      requestsPerMinute: 500,
    });
    expect(preflight.executionPlan.estimatedMinimumAttempts).toBe(3);
    let wallMs = Date.parse('2026-08-01T00:00:01.000Z');
    let monotonicMs = 0;
    const paths: string[] = [];
    const environment: JQuantsExecutionEnvironmentV1 = {
      fetch: async input => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        const from = url.searchParams.get('from')!;
        const to = url.searchParams.get('to')!;
        if (url.pathname === '/v2/markets/calendar') {
          return response({
            data: dates(from, to).map(date => ({
              Date: date,
              HolDiv: isWeekday(date) ? '1' : '0',
            })),
          });
        }
        if (url.pathname === '/v2/equities/master') {
          return response({ data: [{
            Date: url.searchParams.get('date'),
            Code: '72030',
            ScaleCat: 'その他',
            Mkt: '0111',
            ProdCat: '011',
          }] });
        }
        const sessions = dates(from, to).filter(isWeekday);
        const candidateInput = to === '2025-12-31';
        const bars = candidateInput
          ? technicalBars(sessions)
          : sessions.map(date => ({
            date: parseTseSessionDate(date),
            open: 50,
            high: 51,
            low: 49,
            close: 50,
            upperLimitFlag: '0' as const,
            lowerLimitFlag: '0' as const,
            adjustmentFactor: 1,
            exRightsType: null,
          }));
        return response({ data: bars.map(bar => ({
          Date: bar.date,
          Code: '72030',
          O: bar.open,
          H: bar.high,
          L: bar.low,
          C: bar.close,
          UL: bar.upperLimitFlag,
          LL: bar.lowerLimitFlag,
          AdjFactor: bar.adjustmentFactor,
          ExRT: bar.exRightsType,
        })) });
      },
      wallNowMs: () => wallMs,
      monotonicNowMs: () => monotonicMs,
      sleep: (durationMs, signal) => {
        if (signal !== undefined && durationMs === 30_000) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        wallMs += durationMs;
        monotonicMs += durationMs;
        return Promise.resolve();
      },
      apiKey: () => 'test-key',
    };
    const accepted = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const runtime = new JQuantsExecutionRuntimeV1(accepted, { environment });
    const result = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(runtime),
      runtime,
      accepted,
      runRepository: runs,
    });
    const loaded = await runs.load(result.runId);
    const acceptedRerun = acceptJQuantsExecutionV1(preflight.executionPlan, environment);
    const rerunRuntime = new JQuantsExecutionRuntimeV1(acceptedRerun, { environment });
    const rerun = await executeCampaignReconstructionV1(preflight, {
      source: new JQuantsValidationAdapterV1(rerunRuntime),
      runtime: rerunRuntime,
      accepted: acceptedRerun,
      runRepository: runs,
    });
    const reloadedRerun = await runs.load(rerun.runId);

    expect(loaded.run).toMatchObject({
      mode: 'campaign',
      confidence: 'reconstructed_251_as_of',
      campaignName: 'fixed-window',
      candidateGenerationPolicy: 'technical_251_strategy_v1',
      aggregationScope: {
        kind: 'campaign_global',
        tickers: ['7203'],
        tickerCount: 1,
        requestedAnchorCount: 1,
      },
      warnings: [CAMPAIGN_RECONSTRUCTION_WARNING_V1],
    });
    expect(loaded.cases.length).toBeGreaterThan(0);
    expect(loaded.cases.every(value => value.mode === 'campaign')).toBe(true);
    expect(loaded.cases.every(value => value.caseKind === 'candidate'
      && value.candidateIdentityVersion === 'campaign_candidate_identity_v1')).toBe(true);
    expect(reloadedRerun.cases.map(value => value.caseKind === 'candidate'
      ? value.candidateId
      : null)).toEqual(loaded.cases.map(value => value.caseKind === 'candidate'
      ? value.candidateId
      : null));
    expect(rerun.runId).not.toBe(result.runId);
    expect(paths.filter(path => path === '/v2/markets/calendar')).toHaveLength(4);
    expect(paths.filter(path => path === '/v2/equities/bars/daily')).toHaveLength(4);
  });
});
