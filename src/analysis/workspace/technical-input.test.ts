import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { compareDrawingBasis, calculateWorkspaceTechnical, type TechnicalInput } from './technical-input.js';
import { calculateRsiSeries, calculateMacdSeries } from '../../tools/finance/advanced-technical-engine.js';
import { calculateSma } from '../../tools/finance/technical-engine.js';
import { buildTechnicalFromInputsV1 } from '../market-data/technical-source.js';
import { createTechnicalArtifactCodecV1 } from '../market-data/technical-artifact.js';
import { WorkspaceTechnicalCodec } from './technical-artifact.js';
import { workspaceTechnicalHistory } from './technical-test-fixtures.js';

function input(through = '2026-09-11'): TechnicalInput {
  const calendar = [], daily = [];
  for (let time = Date.parse('2026-09-01'); time <= Date.parse('2026-09-30'); time += 86_400_000) {
    const d = new Date(time), date = d.toISOString().slice(0, 10), session = ![0, 6].includes(d.getUTCDay());
    calendar.push({ Date: date, HolDiv: session ? '1' : '0' });
    if (session && date >= '2026-09-07' && date <= through) daily.push({ Date: date, Code: '72030',
      O: 100, H: 110, L: 90, C: 105, Vo: 1000, AdjO: 100, AdjH: 110, AdjL: 90, AdjC: 105, AdjVo: 1000, AdjFactor: 1, ExRT: null });
  }
  return { version: 'workspace_technical_input_v1', identity: { instrumentId: randomUUID(), provider: 'jquants', code: '72030', mappingRevision: 1, catalogGeneration: 1 },
    masterEvidence: { path: 'master.json', digest: `sha256:${'a'.repeat(64)}`, codec: 'workspace_episode_v1' },
    eligibilityFrom: '2026-09-07', master: { Date: through, Code: '72030', CoName: 'Fixture', Mkt: '0111', ProdCat: '011' },
    queryFrom: '2026-09-01', queryTo: through, calculationDate: through, calendarFrom: '2026-09-01', calendarThrough: '2026-09-30', calendar, daily,
    adjustmentMethod: 'jquants_adjusted_ohlcv_not_total_return', factorSemantics: 'provider_daily_event_factor_not_cumulative', historicalIdentity: 'not_verified' };
}
test('new day and volume correction preserve Drawing despite changed whole-artifact input', () => {
  const a = input(), b = input('2026-09-14'); b.identity = a.identity;
  expect(compareDrawingBasis(a, b, '2026-09-07', '2026-09-11')).toBe('compatible');
  b.daily[1]!.Vo = 0; b.daily[1]!.AdjVo = 0;
  expect(compareDrawingBasis(a, b, '2026-09-07', '2026-09-11')).toBe('compatible');
  b.daily.at(-1)!.AdjFactor = .5; b.daily.at(-1)!.ExRT = '1';
  expect(compareDrawingBasis(a, b, '2026-09-07', '2026-09-11')).toBe('basis_review_required');
});
test('corrections use the evidence window; splits and incomparable identity require review', () => {
  const a = input(), b = structuredClone(a); b.daily[0]!.C = 106; b.daily[0]!.AdjC = 106;
  expect(compareDrawingBasis(a, b, '2026-09-08', '2026-09-11')).toBe('compatible');
  expect(compareDrawingBasis(a, b, '2026-09-07', '2026-09-11')).toBe('basis_review_required');
  const split = structuredClone(a); split.daily[1]!.AdjFactor = .5; split.daily[1]!.ExRT = '1';
  expect(compareDrawingBasis(a, split, '2026-09-07', '2026-09-11')).toBe('basis_review_required');
  const other = structuredClone(a); other.identity.instrumentId = randomUUID();
  expect(compareDrawingBasis(a, other, '2026-09-07', '2026-09-11')).toBe('basis_review_required');
  expect(compareDrawingBasis(a, b, '2026-09-01', '2026-09-11')).toBe('basis_review_required');
});
test('ongoing, leading coverage and explicit source gaps remain independent; no provisional indicators', () => {
  const a = input(); a.daily[2] = { ...a.daily[2]!, O: null, H: null, L: null, C: null, Vo: null,
    AdjO: null, AdjH: null, AdjL: null, AdjC: null, AdjVo: null };
  const result = calculateWorkspaceTechnical(a).result;
  const weekly = result.intervals.week![0];
  expect(weekly.rsi).toEqual({ state: 'unavailable', reason: 'source_gap' });
  expect(result.intervals.week[0]!.rsi).toEqual({ state: 'unavailable', reason: 'source_gap' });
  expect(result.intervals.month![0]!.sma20).toEqual({ state: 'unavailable', reason: 'source_gap' });
});
test('missing sessions, invalid raw OHLC and mixed null rows fail closed', () => {
  for (const mutate of [(a: TechnicalInput) => { a.daily.splice(2, 1); },
    (a: TechnicalInput) => { a.daily[0]!.H = 1; }, (a: TechnicalInput) => { a.daily[0]!.O = null; }]) {
    const a = input(); mutate(a); expect(() => calculateWorkspaceTechnical(a)).toThrow();
  }
});

test('SMA uses confirmed closes and keeps the ongoing month unavailable', () => {
  const a = input('2026-09-30'); a.eligibilityFrom = '2026-09-01';
  a.calendarThrough = '2026-10-04';
  for (const Date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    a.calendar.push({ Date, HolDiv: Date <= '2026-10-02' ? '1' : '0' });
  const first = a.daily[0]!;
  a.daily.unshift(...['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(Date => ({ ...first, Date })));
  const result = calculateWorkspaceTechnical(a).result;
  expect(result.intervals.day[18]!.sma20).toEqual({ state: 'unavailable', reason: 'warmup' });
  expect(result.intervals.day[19]!.sma20).toEqual({ state: 'available', value: 105 });
  expect(result.intervals.month[0]!.sma20).toEqual({ state: 'unavailable', reason: 'partial_period' });
});

test('post-warmup gaps preserve legacy V1 artifacts while Workspace independently excludes gap periods', () => {
  const { input, fetched } = workspaceTechnicalHistory(['2025-03-12']);
  const legacy = buildTechnicalFromInputsV1(fetched, {}).artifact;
  const codec = createTechnicalArtifactCodecV1('7203', {});
  expect(codec.parse(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
  const { sourcePayloadDigest, artifactDigest, ...draft } = legacy;
  // Golden digests from the unchanged origin/main V1 builder/calculation/codec.
  expect(sourcePayloadDigest).toBe('sha256:0999793c27b792e4159aa7c269e8988e47924ced1c6a193cd5b29d7829fa1e1f');
  expect(artifactDigest).toBe('sha256:dc7cfcd4a49d964f4411bac3669e7a934ac01cccd2edcf0ce17c5017b878dc64');
  expect(codec.build(draft)).toEqual(legacy);
  expect(legacy.calculationVersion).toBe('technical_chart_calculation_v2');
  const workspaceCodec = new WorkspaceTechnicalCodec('7203');
  const artifact = workspaceCodec.build(legacy, input);
  expect(workspaceCodec.parse(artifact)).toEqual(artifact);
  expect(artifact.source).toEqual(legacy);
  for (const interval of ['week', 'month'] as const) {
    const legacyRows = legacy.series[interval].filter(row => !row.partial);
    const legacyCloses = legacyRows.map(row => row.close);
    const legacyRsi = calculateRsiSeries(legacyCloses), legacyMacd = calculateMacdSeries(legacyCloses);
    const gapIndex = legacyRows.findIndex(row => row.periodStart <= '2025-03-12' && row.periodEnd >= '2025-03-12');
    expect(gapIndex).toBeGreaterThan(34);
    for (const index of [gapIndex, gapIndex + 1]) {
      expect(legacyRows[index]!.rsi).toEqual({ state: 'available', value: legacyRsi[index]! });
      expect(legacyRows[index]!.macd).toEqual({ state: 'available', value: legacyMacd[index]!.value });
    }
    const rows = artifact.result.intervals[interval];
    const gap = rows.find(row => row.identity === legacyRows[gapIndex]!.identity)!;
    expect(gap).toMatchObject({ completion: 'confirmed', partial: false, sourceGaps: ['2025-03-12'] });
    for (const field of ['sma20', 'rsi', 'macd', 'signal', 'histogram', 'cross'] as const)
      expect(gap[field]).toEqual({ state: 'unavailable', reason: 'source_gap' });
    const complete = rows.filter(row => !row.partial && row.sourceGaps.length === 0);
    const closes = complete.map(row => row.close), rsi = calculateRsiSeries(closes), macd = calculateMacdSeries(closes);
    const nextIndex = complete.findIndex(row => row.identity === legacyRows[gapIndex + 1]!.identity);
    for (let index = nextIndex; index < complete.length; index++) {
      const current = macd[index]!, previous = macd[index - 1]!;
      expect(complete[index]).toMatchObject({
        sma20: { state: 'available', value: calculateSma(closes.slice(0, index + 1), 20) },
        rsi: { state: 'available', value: rsi[index] }, macd: { state: 'available', value: current.value },
        signal: { state: 'available', value: current.signal }, histogram: { state: 'available', value: current.histogram },
        cross: { state: 'available', value: previous.value <= previous.signal && current.value > current.signal ? 'golden_cross' : 'none' },
      });
    }
    expect(complete[nextIndex]!.macd).not.toEqual(legacyRows[gapIndex + 1]!.macd);
  }
}, 30_000);
