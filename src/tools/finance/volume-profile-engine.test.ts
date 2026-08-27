import { describe, expect, test } from 'bun:test';
import {
  allocateVolumeProfile,
  analyzeVolumeProfile,
  isVerifiedVolumeProfileSource,
  validateVolumeProfileSource,
  VolumeProfileAllocationInputError,
  VolumeProfileSourceValidationError,
  volumeProfileConservationTolerance,
} from './volume-profile-engine.js';
import type {
  VolumeProfileAllocationBar,
  VolumeProfileResult,
  VolumeProfileSourceInput,
  VolumeProfileSourceRow,
  VolumeProfileUnavailableReason,
} from './volume-profile-engine.js';

function bar(
  low: number | null,
  high: number | null,
  volume: number | null,
  open: number | null = low,
  close: number | null = high,
): VolumeProfileAllocationBar {
  return { open, high, low, close, volume };
}

function expectInputIssue(
  input: readonly VolumeProfileAllocationBar[],
  issue: VolumeProfileAllocationInputError['issue'],
): void {
  try {
    allocateVolumeProfile(input);
    throw new Error('Expected allocation to reject invalid input.');
  } catch (error) {
    expect(error).toBeInstanceOf(VolumeProfileAllocationInputError);
    expect((error as VolumeProfileAllocationInputError).issue).toBe(issue);
  }
}

describe('allocateVolumeProfile', () => {
  test('builds hand-verifiable fixed bins and allocates volume by range overlap', () => {
    const result = allocateVolumeProfile([
      bar(100, 150, 0),
      bar(100.25, 102, 70),
      bar(150, 150, 50),
    ]);

    expect(result).toMatchObject({
      minPrice: 100,
      maxPrice: 150,
      binWidth: 1,
      requestedBinCount: 50,
      effectiveBinCount: 50,
      totalInputVolume: 120,
    });
    expect(result.bins[0]).toEqual({
      index: 0,
      lowerPrice: 100,
      upperPrice: 101,
      representativePrice: 100.5,
      allocatedVolume: 30,
    });
    expect(result.bins[1].allocatedVolume).toBe(40);
    expect(result.bins[49]).toEqual({
      index: 49,
      lowerPrice: 149,
      upperPrice: 150,
      representativePrice: 149.5,
      allocatedVolume: 50,
    });
  });

  test('conserves each bar and total volume within the fixed tolerance', () => {
    const bars = [
      bar(100.1, 149.9, 1 / 3),
      bar(102.25, 138.75, 10_000_000_000.25),
      bar(150, 150, 7.5),
    ];
    const combined = allocateVolumeProfile(bars);
    const combinedVolume = combined.bins.reduce((sum, bin) => sum + bin.allocatedVolume, 0);

    expect(Math.abs(combinedVolume - combined.totalInputVolume)).toBeLessThanOrEqual(
      volumeProfileConservationTolerance(combined.totalInputVolume),
    );
    for (const inputBar of bars) {
      const single = allocateVolumeProfile([inputBar]);
      const allocated = single.bins.reduce((sum, bin) => sum + bin.allocatedVolume, 0);
      expect(Math.abs(allocated - inputBar.volume!)).toBeLessThanOrEqual(
        volumeProfileConservationTolerance(inputBar.volume!),
      );
    }
  });

  test('uses half-open boundaries and stores the maximum price in the last bin', () => {
    const result = allocateVolumeProfile([
      bar(100, 150, 0),
      bar(101, 101, 2),
      bar(150, 150, 3),
    ]);

    expect(result.bins[0].allocatedVolume).toBe(0);
    expect(result.bins[1].allocatedVolume).toBe(2);
    expect(result.bins[49].allocatedVolume).toBe(3);
    expect(result.bins[49].upperPrice).toBe(150);
  });

  test('uses constructed decimal edges for flat bars on internal boundaries', () => {
    const regression = allocateVolumeProfile([
      bar(0.01, 0.11, 0),
      bar(0.022, 0.022, 10),
    ]);

    expect(regression.bins[5].allocatedVolume).toBe(0);
    expect(regression.bins[6].allocatedVolume).toBe(10);

    for (const boundaryIndex of [1, 6, 17, 31, 49]) {
      const boundaryPrice = 0.01 + boundaryIndex * 0.002;
      const result = allocateVolumeProfile([
        bar(0.01, 0.11, 0),
        bar(boundaryPrice, boundaryPrice, 10),
      ]);

      expect(result.bins[boundaryIndex - 1].allocatedVolume).toBe(0);
      expect(result.bins[boundaryIndex].allocatedVolume).toBe(10);
    }
  });

  test('allocates a flat limit-move bar to one containing bin', () => {
    const result = allocateVolumeProfile([
      bar(100, 150, 0),
      bar(125, 125, 400, 125, 125),
    ]);

    expect(result.bins.filter((bin) => bin.allocatedVolume > 0)).toEqual([
      expect.objectContaining({ index: 25, allocatedVolume: 400 }),
    ]);
  });

  test('creates one degenerate bin when every price is identical', () => {
    const result = allocateVolumeProfile([
      bar(123.45, 123.45, 100),
      bar(123.45, 123.45, 50),
    ]);

    expect(result).toMatchObject({
      minPrice: 123.45,
      maxPrice: 123.45,
      binWidth: 0,
      requestedBinCount: 50,
      effectiveBinCount: 1,
      totalInputVolume: 150,
    });
    expect(result.bins).toEqual([{
      index: 0,
      lowerPrice: 123.45,
      upperPrice: 123.45,
      representativePrice: 123.45,
      allocatedVolume: 150,
    }]);
  });

  test('does not infer volume across a gap between bars', () => {
    const result = allocateVolumeProfile([
      bar(100, 105, 50),
      bar(145, 150, 50),
    ]);

    expect(result.bins.slice(5, 45).every((bin) => bin.allocatedVolume === 0)).toBe(true);
  });

  test('uses open and close only for geometry validation, not allocation weight', () => {
    const lowClose = allocateVolumeProfile([
      bar(100, 150, 0),
      bar(110, 140, 300, 110, 110),
    ]);
    const highClose = allocateVolumeProfile([
      bar(100, 150, 0),
      bar(110, 140, 300, 140, 140),
    ]);

    expect(highClose.bins).toEqual(lowClose.bins);
  });

  test('accepts zero-volume bars without fabricating allocation', () => {
    const result = allocateVolumeProfile([bar(100, 150, 0)]);

    expect(result.totalInputVolume).toBe(0);
    expect(result.bins.every((bin) => bin.allocatedVolume === 0)).toBe(true);
  });

  test('distinguishes missing price and volume input', () => {
    expectInputIssue([bar(null, 101, 10)], 'missing_price_data');
    expectInputIssue([bar(100, 101, null)], 'missing_volume_data');
  });

  test('rejects non-finite and non-positive prices', () => {
    for (const invalidPrice of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expectInputIssue([bar(invalidPrice, 101, 10)], 'invalid_price_data');
    }
  });

  test('rejects non-finite and negative volume', () => {
    for (const invalidVolume of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expectInputIssue([bar(100, 101, invalidVolume)], 'invalid_volume_data');
    }
  });

  test('rejects invalid high-low, open, and close geometry', () => {
    expectInputIssue([bar(101, 100, 10, 100, 101)], 'invalid_bar_geometry');
    expectInputIssue([bar(100, 101, 10, 99, 101)], 'invalid_bar_geometry');
    expectInputIssue([bar(100, 101, 10, 100, 102)], 'invalid_bar_geometry');
  });

  test('rejects empty input', () => {
    expectInputIssue([], 'invalid_input');
  });

  test('does not mutate input bars and normalizes negative zero outputs', () => {
    const bars = [bar(100, 102, 20), bar(150, 150, 50)];
    const original = structuredClone(bars);
    const result = allocateVolumeProfile(bars);

    expect(bars).toEqual(original);
    for (const value of [
      result.minPrice,
      result.maxPrice,
      result.binWidth,
      result.totalInputVolume,
      ...result.bins.flatMap((bin) => [
        bin.lowerPrice,
        bin.upperPrice,
        bin.representativePrice,
        bin.allocatedVolume,
      ]),
    ]) {
      expect(Object.is(value, -0)).toBe(false);
    }
  });
});

const SOURCE_START = Date.UTC(2025, 0, 1);

function sourceDate(index: number): string {
  return new Date(SOURCE_START + index * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function sourceRow(
  index: number,
  overrides: Partial<VolumeProfileSourceRow> = {},
  issuerCode = '72030',
): VolumeProfileSourceRow {
  const middle = 100 + (index % 20);
  return {
    Date: sourceDate(index),
    Code: issuerCode,
    AdjO: middle,
    AdjH: middle + 1,
    AdjL: middle - 1,
    AdjC: middle + 0.5,
    AdjVo: 1_000 + index,
    AdjFactor: 1,
    ExRT: null,
    ...overrides,
  };
}

function sourceRows(
  count: number,
  startIndex = 0,
  issuerCode = '72030',
): VolumeProfileSourceRow[] {
  return Array.from(
    { length: count },
    (_, offset) => sourceRow(startIndex + offset, {}, issuerCode),
  );
}

function sourceInput(
  rows: readonly VolumeProfileSourceRow[],
  options: {
    issuerCode?: string;
    collectionDateIndex?: number;
    calendar?: VolumeProfileSourceInput['calendar'];
  } = {},
): VolumeProfileSourceInput {
  const issuerCode = options.issuerCode ?? '72030';
  const lastRowIndex = rows.length === 0
    ? 0
    : Math.round((Date.parse(rows[rows.length - 1].Date) - SOURCE_START) / (24 * 60 * 60 * 1000));
  const collectionDateIndex = options.collectionDateIndex ?? lastRowIndex + 1;
  const calendar = options.calendar ?? Array.from(
    { length: collectionDateIndex + 1 },
    (_, index) => ({ date: sourceDate(index), holidayDivision: '1' }),
  );
  return {
    issuerCode,
    collectedAt: `${sourceDate(collectionDateIndex)}T00:00:00.000Z`,
    rows,
    calendar,
    provenance: {
      source: 'jquants',
      endpoint: '/v2/equities/bars/daily',
      availabilityCalendarEndpoint: '/v2/markets/calendar',
      mapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
      basisAudit: 'collection_horizon_rights_audit_v1',
    },
  };
}

function unavailableReasons(result: VolumeProfileResult): VolumeProfileUnavailableReason[] {
  return result.unavailable.map(({ reason }) => reason);
}

function expectCoreUnavailable(
  result: VolumeProfileResult,
  reasons: readonly VolumeProfileUnavailableReason[],
): void {
  expect(unavailableReasons(result)).toEqual([...reasons]);
  expect(result.bins).toBeNull();
  expect(result.poc).toBeNull();
  expect(result.valueArea).toBeNull();
  expect(result.binningMethod).toMatchObject({
    effectiveBinCount: 0,
    minPrice: null,
    maxPrice: null,
  });
}

function flatProfileRows(
  allocations: readonly { price: number; volume: number }[],
): VolumeProfileSourceRow[] {
  const rows = sourceRows(60).map((row) => ({
    ...row,
    AdjO: 100,
    AdjH: 100,
    AdjL: 100,
    AdjC: 100,
    AdjVo: 0,
  }));
  rows[1] = {
    ...rows[1],
    AdjO: 150,
    AdjH: 150,
    AdjL: 150,
    AdjC: 150,
  };
  allocations.forEach(({ price, volume }, index) => {
    rows[index + 2] = {
      ...rows[index + 2],
      AdjO: price,
      AdjH: price,
      AdjL: price,
      AdjC: price,
      AdjVo: volume,
    };
  });
  return rows;
}

describe('validateVolumeProfileSource', () => {
  test('adds only an internal non-serializable brand after source validation', () => {
    const input = sourceInput(sourceRows(60));
    const before = structuredClone(input);
    const source = validateVolumeProfileSource(input);

    expect(isVerifiedVolumeProfileSource(source)).toBe(true);
    expect(JSON.stringify(source)).not.toContain('verifiedVolumeProfileSource');
    expect(source).toMatchObject({
      issuerCode: '72030',
      basisAuditRequiredThroughDate: sourceDate(59),
      basisAuditThroughDate: sourceDate(59),
    });
    expect(input).toEqual(before);
  });

  test('supports normalized numeric and alphanumeric J-Quants issuer codes', () => {
    for (const issuerCode of ['72030', '130A0']) {
      const source = validateVolumeProfileSource(sourceInput(
        sourceRows(60, 0, issuerCode),
        { issuerCode },
      ));
      expect(source.issuerCode).toBe(issuerCode);
    }
  });

  test('derives the required audit date from the Asia/Tokyo collection date', () => {
    const input = sourceInput(sourceRows(61), { collectionDateIndex: 61 });
    input.collectedAt = `${sourceDate(60)}T16:00:00.000Z`;
    const source = validateVolumeProfileSource(input);

    expect(source.basisAuditRequiredThroughDate).toBe(sourceDate(60));
    expect(source.basisAuditThroughDate).toBe(sourceDate(60));
  });

  test('uses a returned same-date issuer row as the later required audit horizon', () => {
    const source = validateVolumeProfileSource(sourceInput(
      sourceRows(61),
      { collectionDateIndex: 60 },
    ));

    expect(source.basisAuditRequiredThroughDate).toBe(sourceDate(60));
    expect(source.basisAuditThroughDate).toBe(sourceDate(60));
  });

  test('rejects caller-asserted completeness and a forged string brand', () => {
    const input = {
      ...sourceInput(sourceRows(60)),
      basisAuditComplete: true,
      verified: true,
    } as unknown as VolumeProfileSourceInput;

    expect(() => validateVolumeProfileSource(input)).toThrow(VolumeProfileSourceValidationError);
    expect(isVerifiedVolumeProfileSource(input)).toBe(false);
    expectCoreUnavailable(
      analyzeVolumeProfile(sourceDate(59), input),
      ['invalid_input'],
    );
  });

  test('does not accept bare generic OHLCV as the verified source envelope', () => {
    const genericInput = {
      ...sourceInput([]),
      rows: [{
        date: sourceDate(0),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
      }],
    } as unknown as VolumeProfileSourceInput;

    expectCoreUnavailable(
      analyzeVolumeProfile(sourceDate(0), genericInput),
      ['invalid_input'],
    );
  });
});

describe('analyzeVolumeProfile', () => {
  test('requires 60 bars and returns the complete fixed result at the boundary', () => {
    const insufficient = analyzeVolumeProfile(
      sourceDate(58),
      sourceInput(sourceRows(59)),
    );
    expectCoreUnavailable(insufficient, ['insufficient_history']);
    expect(insufficient).toMatchObject({
      dataDate: sourceDate(58),
      windowStartDate: sourceDate(0),
      windowEndDate: sourceDate(58),
      inputBarCount: 59,
      priceBasis: null,
      volumeBasis: null,
      provenance: { corporateActionBasisStatus: 'not_evaluated' },
    });

    const available = analyzeVolumeProfile(
      sourceDate(59),
      sourceInput(sourceRows(60)),
    );
    expect(available.unavailable).toEqual([]);
    expect(available).toMatchObject({
      analysisAsOfDate: sourceDate(59),
      collectedAt: `${sourceDate(60)}T00:00:00.000Z`,
      issuerCode: '72030',
      dataDate: sourceDate(59),
      windowStartDate: sourceDate(0),
      windowEndDate: sourceDate(59),
      inputBarCount: 60,
      priceBasis: 'jquants_corporate_action_adjusted',
      volumeBasis: 'jquants_corporate_action_adjusted',
      allocationMethod: 'uniform_range_overlap_v1',
      binningMethod: {
        id: 'fixed_count_linear_v1',
        requestedBinCount: 50,
        effectiveBinCount: 50,
      },
      methodology: {
        id: 'daily_ohlcv_volume_profile_proxy_v1',
        approximation: 'uniform_daily_range',
        actualHolderCostBasis: false,
      },
      provenance: {
        source: 'jquants',
        endpoint: '/v2/equities/bars/daily',
        availabilityCalendarEndpoint: '/v2/markets/calendar',
        sourceMapping: 'jquants_adjusted_ohlcv_with_corporate_actions_v1',
        adjustmentFactorField: 'AdjFactor',
        exRightsField: 'ExRT',
        basisAudit: 'collection_horizon_rights_audit_v1',
        basisAuditRequiredThroughDate: sourceDate(59),
        basisAuditThroughDate: sourceDate(59),
        corporateActionBasisStatus: 'supported_common_basis_established',
        calculation: 'volume_profile_engine',
      },
      units: {
        price: 'JPY',
        allocatedVolume: 'adjusted_shares',
        volumeShare: 'ratio',
      },
    });
    expect(available.bins).toHaveLength(50);
    expect(
      available.bins!.reduce((sum, bin) => sum + bin.volumeShare, 0),
    ).toBeCloseTo(1, 12);
    expect(available.poc).not.toBeNull();
    expect(available.valueArea).not.toBeNull();
  });

  test('uses every available bar from 60 through 119', () => {
    const result = analyzeVolumeProfile(
      sourceDate(118),
      sourceInput(sourceRows(119)),
    );

    expect(result.unavailable).toEqual([]);
    expect(result).toMatchObject({
      inputBarCount: 119,
      windowStartDate: sourceDate(0),
      windowEndDate: sourceDate(118),
    });
  });

  test('uses exactly the latest 120 bars and ignores older values outside the window', () => {
    const rows = sourceRows(121);
    rows[0] = { ...rows[0], AdjO: null, AdjVo: null };
    const full = analyzeVolumeProfile(sourceDate(120), sourceInput(rows));
    const latestOnly = analyzeVolumeProfile(
      sourceDate(120),
      sourceInput(rows.slice(1), { collectionDateIndex: 121 }),
    );

    expect(full.unavailable).toEqual([]);
    expect(full).toMatchObject({
      inputBarCount: 120,
      windowStartDate: sourceDate(1),
      windowEndDate: sourceDate(120),
    });
    expect(full.bins).toEqual(latestOnly.bins);
    expect(full.poc).toEqual(latestOnly.poc);
    expect(full.valueArea).toEqual(latestOnly.valueArea);
  });

  test('keeps the same latest-120 result when older history is prepended', () => {
    const allRows = sourceRows(130);
    const full = analyzeVolumeProfile(sourceDate(129), sourceInput(allRows));
    const latestOnly = analyzeVolumeProfile(
      sourceDate(129),
      sourceInput(allRows.slice(-120), { collectionDateIndex: 130 }),
    );

    expect(full.bins).toEqual(latestOnly.bins);
    expect(full.poc).toEqual(latestOnly.poc);
    expect(full.valueArea).toEqual(latestOnly.valueArea);
  });

  test('excludes future OHLCV before validation while retaining future audit metadata', () => {
    const rows = sourceRows(61);
    const baseline = analyzeVolumeProfile(
      sourceDate(59),
      sourceInput(rows, { collectionDateIndex: 61 }),
    );
    rows[60] = {
      ...rows[60],
      AdjO: Number.NaN,
      AdjH: Number.NaN,
      AdjL: Number.NaN,
      AdjC: Number.NaN,
      AdjVo: Number.NaN,
    };
    const withInvalidFutureValues = analyzeVolumeProfile(
      sourceDate(59),
      sourceInput(rows, { collectionDateIndex: 61 }),
    );

    expect(withInvalidFutureValues.bins).toEqual(baseline.bins);
    expect(withInvalidFutureValues.poc).toEqual(baseline.poc);
    expect(withInvalidFutureValues.valueArea).toEqual(baseline.valueArea);
    expect(withInvalidFutureValues.dataDate).toBe(sourceDate(59));
  });

  test('returns invalid chronology for duplicate calculation or audit dates', () => {
    const calculationDuplicate = sourceRows(60);
    calculationDuplicate[10] = { ...calculationDuplicate[10], Date: calculationDuplicate[9].Date };
    expectCoreUnavailable(
      analyzeVolumeProfile(sourceDate(59), sourceInput(calculationDuplicate)),
      ['invalid_chronology'],
    );

    const auditDuplicate = sourceInput(sourceRows(60));
    const calendar = [...auditDuplicate.calendar];
    calendar[10] = { ...calendar[10], date: calendar[9].date };
    expectCoreUnavailable(
      analyzeVolumeProfile(sourceDate(59), { ...auditDuplicate, calendar }),
      ['invalid_chronology'],
    );
  });

  test('rejects rights issues inside the window and after the as-of date', () => {
    const inside = sourceRows(60);
    inside[30] = { ...inside[30], ExRT: '3', AdjFactor: 0.5 };
    const insideResult = analyzeVolumeProfile(sourceDate(59), sourceInput(inside));
    expectCoreUnavailable(insideResult, ['corporate_action_basis_unavailable']);
    expect(insideResult.provenance.corporateActionBasisStatus).toBe('rights_issue_unavailable');

    const withFuture = sourceRows(61);
    withFuture[60] = { ...withFuture[60], ExRT: '3', AdjFactor: 0.5 };
    const futureResult = analyzeVolumeProfile(
      sourceDate(59),
      sourceInput(withFuture, { collectionDateIndex: 61 }),
    );
    expectCoreUnavailable(futureResult, ['corporate_action_basis_unavailable']);
    expect(futureResult.provenance.corporateActionBasisStatus).toBe('rights_issue_unavailable');
  });

  test('keeps a source-supported non-rights adjustment on the common adjusted basis', () => {
    const rows = sourceRows(60);
    rows[30] = { ...rows[30], ExRT: '1', AdjFactor: 0.5 };
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.unavailable).toEqual([]);
    expect(result.provenance.corporateActionBasisStatus).toBe(
      'supported_common_basis_established',
    );
  });

  test('does not exempt numeric or alphanumeric issues from a rights-issue audit', () => {
    for (const issuerCode of ['72030', '130A0']) {
      const rows = sourceRows(60, 0, issuerCode);
      rows[20] = { ...rows[20], ExRT: '3', AdjFactor: 0.5 };
      const result = analyzeVolumeProfile(
        sourceDate(59),
        sourceInput(rows, { issuerCode }),
      );
      expect(result.provenance.corporateActionBasisStatus).toBe('rights_issue_unavailable');
    }
  });

  test('ignores a rights issue strictly before the canonical window', () => {
    const rows = sourceRows(121);
    rows[0] = { ...rows[0], ExRT: '3', AdjFactor: 0.5 };
    const result = analyzeVolumeProfile(sourceDate(120), sourceInput(rows));

    expect(result.unavailable).toEqual([]);
    expect(result.windowStartDate).toBe(sourceDate(1));
  });

  test('makes unknown metadata and incomplete calendar/issuer coverage basis-unavailable', () => {
    const unknown = sourceRows(60);
    unknown[20] = { ...unknown[20], AdjFactor: null };
    const unknownResult = analyzeVolumeProfile(sourceDate(59), sourceInput(unknown));
    expectCoreUnavailable(unknownResult, ['corporate_action_basis_unavailable']);
    expect(unknownResult.provenance.corporateActionBasisStatus).toBe('unknown_basis_unavailable');

    const incomplete = sourceRows(61).filter((_, index) => index !== 30);
    const incompleteResult = analyzeVolumeProfile(
      sourceDate(60),
      sourceInput(incomplete, { collectionDateIndex: 61 }),
    );
    expectCoreUnavailable(incompleteResult, ['corporate_action_basis_unavailable']);
    expect(incompleteResult.provenance.corporateActionBasisStatus).toBe('unknown_basis_unavailable');

    const completeInput = sourceInput(sourceRows(60));
    const missingCalendarDay = completeInput.calendar.filter(
      (day) => day.date !== sourceDate(30),
    );
    const incompleteCalendarResult = analyzeVolumeProfile(
      sourceDate(59),
      { ...completeInput, calendar: missingCalendarDay },
    );
    expectCoreUnavailable(
      incompleteCalendarResult,
      ['corporate_action_basis_unavailable'],
    );
    expect(incompleteCalendarResult.provenance.corporateActionBasisStatus).toBe(
      'unknown_basis_unavailable',
    );

    const delayedHorizonResult = analyzeVolumeProfile(
      sourceDate(59),
      sourceInput(sourceRows(60), { collectionDateIndex: 61 }),
    );
    expectCoreUnavailable(delayedHorizonResult, ['corporate_action_basis_unavailable']);
    expect(delayedHorizonResult.provenance).toMatchObject({
      basisAuditRequiredThroughDate: sourceDate(60),
      basisAuditThroughDate: sourceDate(59),
      corporateActionBasisStatus: 'unknown_basis_unavailable',
    });
  });

  test('distinguishes successful empty data and all-zero volume from each other', () => {
    const empty = analyzeVolumeProfile(sourceDate(0), sourceInput([], { collectionDateIndex: 1 }));
    expectCoreUnavailable(empty, ['no_price_data']);
    expect(empty.provenance.corporateActionBasisStatus).toBe('not_evaluated');

    const zeroRows = sourceRows(60).map((row) => ({ ...row, AdjVo: 0 }));
    const zero = analyzeVolumeProfile(sourceDate(59), sourceInput(zeroRows));
    expectCoreUnavailable(zero, ['zero_total_volume']);
    expect(zero.priceBasis).toBe('jquants_corporate_action_adjusted');
    expect(zero.provenance.corporateActionBasisStatus).toBe(
      'supported_common_basis_established',
    );
  });

  test('counts a returned no-sale row and preserves both missing reasons', () => {
    const rows = sourceRows(60);
    rows[20] = {
      ...rows[20],
      AdjO: null,
      AdjH: null,
      AdjL: null,
      AdjC: null,
      AdjVo: null,
      AdjFactor: null,
    };
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expectCoreUnavailable(result, ['missing_price_data', 'missing_volume_data']);
    expect(result.inputBarCount).toBe(60);
    expect(result.dataDate).toBe(sourceDate(59));
  });

  test('preserves typed invalid price, volume, and geometry reasons', () => {
    const cases: Array<{
      overrides: Partial<VolumeProfileSourceRow>;
      reason: VolumeProfileUnavailableReason;
    }> = [
      { overrides: { AdjL: 0 }, reason: 'invalid_price_data' },
      { overrides: { AdjVo: -1 }, reason: 'invalid_volume_data' },
      { overrides: { AdjO: 200 }, reason: 'invalid_bar_geometry' },
    ];
    for (const { overrides, reason } of cases) {
      const rows = sourceRows(60);
      rows[20] = { ...rows[20], ...overrides };
      expectCoreUnavailable(
        analyzeVolumeProfile(sourceDate(59), sourceInput(rows)),
        [reason],
      );
    }
  });

  test('uses the lower-priced POC when maximum volumes tie within tolerance', () => {
    const rows = flatProfileRows([
      { price: 110.5, volume: 100 },
      { price: 120.5, volume: 100 },
    ]);
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.poc).toMatchObject({ binIndex: 10, price: 110.5, allocatedVolume: 100 });

    const withinTolerance = flatProfileRows([
      { price: 110.5, volume: 100 },
      { price: 120.5, volume: 100 + 5e-9 },
    ]);
    expect(
      analyzeVolumeProfile(sourceDate(59), sourceInput(withinTolerance)).poc?.binIndex,
    ).toBe(10);
  });

  test('expands Value Area lower first on a tie and stops at the exact target', () => {
    const rows = flatProfileRows([
      { price: 125.5, volume: 40 },
      { price: 124.5, volume: 30 },
      { price: 126.5, volume: 30 },
    ]);
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.poc?.binIndex).toBe(25);
    expect(result.valueArea).toEqual({
      targetVolumeShare: 0.7,
      achievedVolumeShare: 0.7,
      val: 124,
      vah: 126,
      firstBinIndex: 24,
      lastBinIndex: 25,
    });
  });

  test('includes the final Value Area bin whole and preserves overshoot', () => {
    const rows = flatProfileRows([
      { price: 125.5, volume: 40 },
      { price: 124.5, volume: 35 },
      { price: 126.5, volume: 25 },
    ]);
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.valueArea).toMatchObject({
      achievedVolumeShare: 0.75,
      firstBinIndex: 24,
      lastBinIndex: 25,
    });
  });

  test('uses the POC alone when it already reaches the Value Area target', () => {
    const rows = flatProfileRows([
      { price: 125.5, volume: 80 },
      { price: 124.5, volume: 10 },
      { price: 126.5, volume: 10 },
    ]);
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.valueArea).toEqual({
      targetVolumeShare: 0.7,
      achievedVolumeShare: 0.8,
      val: 125,
      vah: 126,
      firstBinIndex: 25,
      lastBinIndex: 25,
    });
  });

  test('returns one-bin POC, VAL, and VAH for an all-same-price profile', () => {
    const rows = sourceRows(60).map((row) => ({
      ...row,
      AdjO: 123.45,
      AdjH: 123.45,
      AdjL: 123.45,
      AdjC: 123.45,
      AdjVo: 10,
    }));
    const result = analyzeVolumeProfile(sourceDate(59), sourceInput(rows));

    expect(result.bins).toHaveLength(1);
    expect(result.poc).toEqual({
      binIndex: 0,
      price: 123.45,
      allocatedVolume: 600,
      volumeShare: 1,
    });
    expect(result.valueArea).toEqual({
      targetVolumeShare: 0.7,
      achievedVolumeShare: 1,
      val: 123.45,
      vah: 123.45,
      firstBinIndex: 0,
      lastBinIndex: 0,
    });
  });

  test('does not mutate raw or verified source input', () => {
    const raw = sourceInput(sourceRows(60));
    const rawBefore = structuredClone(raw);
    const verified = validateVolumeProfileSource(raw);
    const verifiedRowsBefore = structuredClone(verified.rows);

    analyzeVolumeProfile(sourceDate(59), verified);

    expect(raw).toEqual(rawBefore);
    expect(verified.rows).toEqual(verifiedRowsBefore);
  });
});
