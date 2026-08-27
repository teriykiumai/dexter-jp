import { describe, expect, test } from 'bun:test';
import {
  allocateVolumeProfile,
  VolumeProfileAllocationInputError,
  volumeProfileConservationTolerance,
} from './volume-profile-engine.js';
import type { VolumeProfileAllocationBar } from './volume-profile-engine.js';

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
