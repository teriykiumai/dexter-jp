export const VOLUME_PROFILE_BIN_COUNT = 50 as const;

export const VOLUME_PROFILE_ALLOCATION_METHOD = 'uniform_range_overlap_v1' as const;
export const VOLUME_PROFILE_BINNING_METHOD = 'fixed_count_linear_v1' as const;

export interface VolumeProfileAllocationBar {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface VolumeProfileAllocationBin {
  index: number;
  lowerPrice: number;
  upperPrice: number;
  representativePrice: number;
  allocatedVolume: number;
}

export interface VolumeProfileAllocation {
  minPrice: number;
  maxPrice: number;
  binWidth: number;
  requestedBinCount: typeof VOLUME_PROFILE_BIN_COUNT;
  effectiveBinCount: number;
  totalInputVolume: number;
  bins: VolumeProfileAllocationBin[];
}

export type VolumeProfileAllocationInputIssue =
  | 'invalid_input'
  | 'missing_price_data'
  | 'missing_volume_data'
  | 'invalid_price_data'
  | 'invalid_volume_data'
  | 'invalid_bar_geometry';

export class VolumeProfileAllocationInputError extends RangeError {
  constructor(
    public readonly issue: VolumeProfileAllocationInputIssue,
    public readonly barIndex: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'VolumeProfileAllocationInputError';
  }
}

interface ValidatedVolumeProfileAllocationBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function normalizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateBar(
  bar: VolumeProfileAllocationBar,
  barIndex: number,
): ValidatedVolumeProfileAllocationBar {
  if (bar.open === null || bar.high === null || bar.low === null || bar.close === null) {
    throw new VolumeProfileAllocationInputError(
      'missing_price_data',
      barIndex,
      `Bar ${barIndex} has missing adjusted price data.`,
    );
  }
  const prices = [bar.open, bar.high, bar.low, bar.close];
  if (!prices.every((price) => Number.isFinite(price) && price > 0)) {
    throw new VolumeProfileAllocationInputError(
      'invalid_price_data',
      barIndex,
      `Bar ${barIndex} has invalid adjusted price data.`,
    );
  }
  if (bar.volume === null) {
    throw new VolumeProfileAllocationInputError(
      'missing_volume_data',
      barIndex,
      `Bar ${barIndex} has missing adjusted volume data.`,
    );
  }
  if (!Number.isFinite(bar.volume) || bar.volume < 0) {
    throw new VolumeProfileAllocationInputError(
      'invalid_volume_data',
      barIndex,
      `Bar ${barIndex} has invalid adjusted volume data.`,
    );
  }
  if (
    bar.high < bar.low
    || bar.open < bar.low
    || bar.open > bar.high
    || bar.close < bar.low
    || bar.close > bar.high
  ) {
    throw new VolumeProfileAllocationInputError(
      'invalid_bar_geometry',
      barIndex,
      `Bar ${barIndex} has invalid adjusted OHLC geometry.`,
    );
  }

  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

export function volumeProfileConservationTolerance(totalVolume: number): number {
  return Math.max(1e-8, totalVolume * 1e-12);
}

function createBins(minPrice: number, maxPrice: number): VolumeProfileAllocationBin[] {
  if (minPrice === maxPrice) {
    return [{
      index: 0,
      lowerPrice: normalizeNegativeZero(minPrice),
      upperPrice: normalizeNegativeZero(maxPrice),
      representativePrice: normalizeNegativeZero(minPrice),
      allocatedVolume: 0,
    }];
  }

  const binWidth = (maxPrice - minPrice) / VOLUME_PROFILE_BIN_COUNT;
  return Array.from({ length: VOLUME_PROFILE_BIN_COUNT }, (_, index) => {
    const lowerPrice = minPrice + index * binWidth;
    const upperPrice = index === VOLUME_PROFILE_BIN_COUNT - 1
      ? maxPrice
      : minPrice + (index + 1) * binWidth;
    return {
      index,
      lowerPrice: normalizeNegativeZero(lowerPrice),
      upperPrice: normalizeNegativeZero(upperPrice),
      representativePrice: normalizeNegativeZero((lowerPrice + upperPrice) / 2),
      allocatedVolume: 0,
    };
  });
}

function findContainingBinIndex(
  price: number,
  minPrice: number,
  maxPrice: number,
  binWidth: number,
): number {
  if (price === maxPrice) return VOLUME_PROFILE_BIN_COUNT - 1;
  const calculatedIndex = Math.floor((price - minPrice) / binWidth);
  return Math.min(VOLUME_PROFILE_BIN_COUNT - 1, Math.max(0, calculatedIndex));
}

function addAllocation(bin: VolumeProfileAllocationBin, volume: number): void {
  bin.allocatedVolume = normalizeNegativeZero(bin.allocatedVolume + volume);
}

function allocateBar(
  bar: Readonly<ValidatedVolumeProfileAllocationBar>,
  bins: VolumeProfileAllocationBin[],
  minPrice: number,
  maxPrice: number,
  binWidth: number,
): void {
  if (bar.volume === 0) return;

  if (bar.high === bar.low) {
    const binIndex = bins.length === 1
      ? 0
      : findContainingBinIndex(bar.low, minPrice, maxPrice, binWidth);
    addAllocation(bins[binIndex], bar.volume);
    return;
  }

  const intersectedBins = bins.filter((bin) => (
    Math.min(bar.high, bin.upperPrice) - Math.max(bar.low, bin.lowerPrice) > 0
  ));
  let alreadyAllocated = 0;

  for (let index = 0; index < intersectedBins.length; index += 1) {
    const bin = intersectedBins[index];
    const isFinalBin = index === intersectedBins.length - 1;
    const overlap = Math.max(
      0,
      Math.min(bar.high, bin.upperPrice) - Math.max(bar.low, bin.lowerPrice),
    );
    const allocatedVolume = isFinalBin
      ? bar.volume - alreadyAllocated
      : bar.volume * overlap / (bar.high - bar.low);
    addAllocation(bin, allocatedVolume);
    alreadyAllocated += allocatedVolume;
  }
}

/**
 * Build fixed linear bins and allocate adjusted daily volume uniformly over each
 * supplied adjusted low-high range. Window selection and profile metrics belong to
 * the aggregate engine, not this helper.
 */
export function allocateVolumeProfile(
  bars: readonly VolumeProfileAllocationBar[],
): VolumeProfileAllocation {
  if (bars.length === 0) {
    throw new VolumeProfileAllocationInputError(
      'invalid_input',
      null,
      'At least one adjusted OHLCV bar is required.',
    );
  }

  const validBars = bars.map(validateBar);
  const minPrice = Math.min(...validBars.map((bar) => bar.low));
  const maxPrice = Math.max(...validBars.map((bar) => bar.high));
  const binWidth = (maxPrice - minPrice) / VOLUME_PROFILE_BIN_COUNT;
  const bins = createBins(minPrice, maxPrice);
  const totalInputVolume = validBars.reduce((sum, bar) => sum + bar.volume, 0);

  for (const bar of validBars) {
    allocateBar(bar, bins, minPrice, maxPrice, binWidth);
  }

  const totalAllocatedVolume = bins.reduce((sum, bin) => sum + bin.allocatedVolume, 0);
  const tolerance = volumeProfileConservationTolerance(totalInputVolume);
  if (Math.abs(totalAllocatedVolume - totalInputVolume) > tolerance) {
    throw new Error('Volume-profile allocation failed to conserve adjusted volume.');
  }

  return {
    minPrice: normalizeNegativeZero(minPrice),
    maxPrice: normalizeNegativeZero(maxPrice),
    binWidth: normalizeNegativeZero(binWidth),
    requestedBinCount: VOLUME_PROFILE_BIN_COUNT,
    effectiveBinCount: bins.length,
    totalInputVolume: normalizeNegativeZero(totalInputVolume),
    bins,
  };
}
