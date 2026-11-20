export interface YRange {
  min: number;
  max: number;
}

export const RSI_NATURAL_MIN = 0;
export const RSI_NATURAL_MAX = 100;
export const RSI_MIN_VISIBLE_SPAN = 10;

export function clampZoomFactor(factor: number): number {
  return Math.max(0.05, Math.min(20, factor));
}

export function wheelDeltaToZoomFactor(deltaY: number): number {
  const clampedDelta = Math.max(-180, Math.min(180, deltaY));
  return Math.exp(-clampedDelta * 0.0022);
}

export function dragDeltaToZoomFactor(dy: number): number {
  return Math.exp(-dy * 0.0085);
}

/**
 * Scales a [min, max] range by factor (>1 zooms in / narrows range, <1 zooms out / expands range),
 * anchoring to keep anchorValue inside the visible band and clamping within [boundMin, boundMax] when provided.
 */
export function computeScaledBoundedRange(params: {
  baseMin: number;
  baseMax: number;
  factor: number;
  minVisibleSpan: number;
  maxVisibleSpan: number;
  anchorValue?: number;
  boundMin?: number;
  boundMax?: number;
}): YRange {
  const {
    baseMin,
    baseMax,
    factor,
    minVisibleSpan,
    maxVisibleSpan,
    anchorValue,
    boundMin,
    boundMax,
  } = params;

  const curSpan = Math.max(baseMax - baseMin, minVisibleSpan);
  const safeFactor = clampZoomFactor(factor);
  const nextSpan = Math.max(minVisibleSpan, Math.min(maxVisibleSpan, curSpan / safeFactor));
  const mid = (baseMin + baseMax) / 2;
  const half = nextSpan / 2;

  let nextMin = mid - half;
  let nextMax = mid + half;

  if (typeof anchorValue === 'number' && !Number.isNaN(anchorValue)) {
    const edgePad = nextSpan * 0.04;
    if (anchorValue > nextMax - edgePad) {
      const shift = anchorValue + edgePad - nextMax;
      nextMin += shift;
      nextMax += shift;
    } else if (anchorValue < nextMin + edgePad) {
      const shift = nextMin + edgePad - anchorValue;
      nextMin -= shift;
      nextMax -= shift;
    }
  }

  if (typeof boundMin === 'number' && nextMin < boundMin) {
    const shiftUp = boundMin - nextMin;
    nextMin = boundMin;
    nextMax = Math.max(nextMax + shiftUp, boundMin + minVisibleSpan);
  }

  if (typeof boundMax === 'number' && nextMax > boundMax) {
    const shiftDown = nextMax - boundMax;
    nextMax = boundMax;
    nextMin = Math.min(nextMin - shiftDown, boundMax - minVisibleSpan);
    if (typeof boundMin === 'number' && nextMin < boundMin) {
      nextMin = boundMin;
    }
  }

  if (nextMax <= nextMin) {
    nextMax = nextMin + minVisibleSpan;
  }

  return { min: nextMin, max: nextMax };
}

export function getVolumeZoomLimits(
  autoMaxVolume: number,
  referenceLowVolume?: number
): {
  minVisibleMax: number;
  maxVisibleMax: number;
} {
  const safeAutoMax = Math.max(autoMaxVolume, 1);
  const defaultMinMax = safeAutoMax * 0.05;
  const outlierAwareMinMax =
    typeof referenceLowVolume === 'number' &&
    !Number.isNaN(referenceLowVolume) &&
    referenceLowVolume > 0
      ? Math.min(defaultMinMax, referenceLowVolume * 2)
      : defaultMinMax;
  const minVisibleMax = Math.max(1, outlierAwareMinMax);
  const maxVisibleMax = Math.max(safeAutoMax * 10, minVisibleMax * 2);
  return { minVisibleMax, maxVisibleMax };
}

/**
 * Scales the top of the zero-anchored Volume Y-axis [0, visibleMax].
 */
export function computeScaledVolumeMax(
  baseMax: number,
  autoMaxVolume: number,
  factor: number,
  referenceLowVolume?: number
): number {
  const { minVisibleMax, maxVisibleMax } = getVolumeZoomLimits(autoMaxVolume, referenceLowVolume);
  const safeBaseMax = Math.max(baseMax, minVisibleMax);
  const safeFactor = clampZoomFactor(factor);
  return Math.max(minVisibleMax, Math.min(maxVisibleMax, safeBaseMax / safeFactor));
}

/**
 * Scales the RSI Y-axis range within natural [0, 100] bounds.
 */
export function computeScaledRsiRange(
  baseMin: number,
  baseMax: number,
  factor: number,
  anchorRsi?: number
): YRange {
  return computeScaledBoundedRange({
    baseMin,
    baseMax,
    factor,
    minVisibleSpan: RSI_MIN_VISIBLE_SPAN,
    maxVisibleSpan: RSI_NATURAL_MAX - RSI_NATURAL_MIN,
    anchorValue:
      typeof anchorRsi === 'number' && !Number.isNaN(anchorRsi)
        ? Math.max(RSI_NATURAL_MIN, Math.min(RSI_NATURAL_MAX, anchorRsi))
        : 50,
    boundMin: RSI_NATURAL_MIN,
    boundMax: RSI_NATURAL_MAX,
  });
}

export const BASE_VOL_HEIGHT = 75;
export const VOL_PADDING_TOP = 20;
export const VOL_PADDING_BOTTOM = 10;
export const BASE_VOL_ADJ_HEIGHT = BASE_VOL_HEIGHT - VOL_PADDING_TOP - VOL_PADDING_BOTTOM;
export const MAX_VOL_EXPANSION_PX = 50;

export interface VolumePanelLayout {
  volHeight: number;
  volPaddingTop: number;
  volPaddingBottom: number;
  volScaleHeight: number;
  volPlotHeight: number;
  volBaselineY: number;
  extraHeight: number;
  topBoundaryVolume: number;
}

/**
 * Computes limited dynamic headroom (0..50px) above the [0, visibleMaxVolume] plotting scale
 * so taller bars can remain unclipped when zoomed in without altering the Y-axis zoom scale
 * or letting extreme outliers force unlimited vertical growth.
 */
export function computeVolumePanelLayout(params: {
  visibleMaxVolume: number;
  peakRenderedVolume: number;
  isZoomed: boolean;
}): VolumePanelLayout {
  const safeVisibleMax = Math.max(params.visibleMaxVolume, 1);
  const safePeak = Math.max(params.peakRenderedVolume, 0);

  let extraHeight = 0;
  if (params.isZoomed && safePeak > safeVisibleMax) {
    const peakHeightPx = (safePeak / safeVisibleMax) * BASE_VOL_ADJ_HEIGHT;
    const neededExtraPx = Math.ceil(peakHeightPx - BASE_VOL_ADJ_HEIGHT);
    extraHeight = Math.max(0, Math.min(MAX_VOL_EXPANSION_PX, neededExtraPx));
  }

  const volPlotHeight = BASE_VOL_ADJ_HEIGHT + extraHeight;
  const volHeight = VOL_PADDING_TOP + volPlotHeight + VOL_PADDING_BOTTOM;
  const volBaselineY = VOL_PADDING_TOP + volPlotHeight;
  const topBoundaryVolume = safeVisibleMax * (volPlotHeight / BASE_VOL_ADJ_HEIGHT);

  return {
    volHeight,
    volPaddingTop: VOL_PADDING_TOP,
    volPaddingBottom: VOL_PADDING_BOTTOM,
    volScaleHeight: BASE_VOL_ADJ_HEIGHT,
    volPlotHeight,
    volBaselineY,
    extraHeight,
    topBoundaryVolume,
  };
}

/**
 * Returns true only when the Y-axis zoom multiplier differs from the default 1.00× scale.
 */
export function shouldShowYScaleIndicator(zoomFactor: number): boolean {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return false;
  return zoomFactor.toFixed(2) !== '1.00';
}


