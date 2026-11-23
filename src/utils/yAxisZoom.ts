export interface YRange {
  min: number;
  max: number;
}

export const RSI_NATURAL_MIN = 0;
export const RSI_NATURAL_MAX = 100;
export const RSI_MIN_VISIBLE_SPAN = 10;

export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.max(0.05, Math.min(20, factor));
}

export function wheelDeltaToZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 1;
  const clampedDelta = Math.max(-180, Math.min(180, deltaY));
  return Math.exp(-clampedDelta * 0.0022);
}

export function dragDeltaToZoomFactor(dy: number): number {
  if (!Number.isFinite(dy)) return 1;
  return Math.exp(-dy * 0.0085);
}

export const DEFAULT_EDGE_PADDING_RATIO = 0.12;
export const PRICE_AUTO_PADDING_RATIO = 0.14;
export const PRICE_ZOOM_EDGE_PADDING_RATIO = 0.04;
export const PRICE_PREV_CLOSE_MAX_GAP_RATIO = 0.35;
export const BASE_PRICE_HEIGHT = 260;
export const MAX_PRICE_EXPANSION_PX = 60;
export const PRICE_MIN_CANDLE_HEIGHT_RATIO = 0.25;
export const PRICE_MIN_CANDLE_HEIGHT_PX = 40;
export const REFERENCE_LABEL_MIN_GAP_PX = 11;

export interface PriceZoomLimits {
  minVisibleSpan: number;
  maxVisibleSpan: number;
  minCandleHeightPx: number;
  minCandleHeightRatio: number;
  minZoomFactor: number;
}

/**
 * Computes vertical price-axis zoom limits dynamically from the displayed candlestick
 * high-to-low range and available plot height so zooming out can never flatten candlesticks
 * below the configured minimum height ratio (~25% of plot height) or pixel floor.
 */
export function computePriceZoomLimits(params: {
  candleLow: number;
  candleHigh: number;
  autoMinPrice: number;
  autoMaxPrice: number;
  plotHeightPx: number;
  minCandleHeightRatio?: number;
  minCandleHeightPx?: number;
}): PriceZoomLimits {
  const safePlotHeight =
    Number.isFinite(params.plotHeightPx) && params.plotHeightPx > 0
      ? params.plotHeightPx
      : BASE_PRICE_HEIGHT - 36;
  const targetRatio =
    typeof params.minCandleHeightRatio === 'number' && Number.isFinite(params.minCandleHeightRatio)
      ? Math.max(0.05, Math.min(0.85, params.minCandleHeightRatio))
      : PRICE_MIN_CANDLE_HEIGHT_RATIO;
  const targetMinPx =
    typeof params.minCandleHeightPx === 'number' && Number.isFinite(params.minCandleHeightPx)
      ? Math.max(1, params.minCandleHeightPx)
      : PRICE_MIN_CANDLE_HEIGHT_PX;

  const requiredCandleHeightPx = Math.min(
    safePlotHeight * 0.85,
    Math.max(safePlotHeight * targetRatio, targetMinPx)
  );
  const effectiveMinRatio = requiredCandleHeightPx / safePlotHeight;

  const hasAuto =
    Number.isFinite(params.autoMinPrice) &&
    Number.isFinite(params.autoMaxPrice) &&
    params.autoMaxPrice > params.autoMinPrice;
  const autoSpan = hasAuto ? Math.max(params.autoMaxPrice - params.autoMinPrice, 0.0001) : 1;
  const autoMid = hasAuto ? (params.autoMinPrice + params.autoMaxPrice) / 2 : 1;

  const hasCandles =
    Number.isFinite(params.candleLow) &&
    Number.isFinite(params.candleHigh) &&
    params.candleHigh >= params.candleLow;
  const rawCandleSpan = hasCandles ? Math.max(0, params.candleHigh - params.candleLow) : 0;

  // For flat/zero-range candles, derive an effective span from autoSpan so flat sessions
  // still have a finite, consistent maximum zoom-out limit.
  const effectiveCandleSpan =
    rawCandleSpan > 0
      ? rawCandleSpan
      : autoSpan / (1 + 2 * PRICE_AUTO_PADDING_RATIO);

  const minVisibleSpan = Math.max(autoSpan * 0.15, Math.abs(autoMid) * 0.002, 0.02);
  const maxSpanFromCandles = effectiveCandleSpan / Math.max(effectiveMinRatio, 0.05);
  const maxVisibleSpan = Math.max(maxSpanFromCandles, autoSpan, minVisibleSpan);
  const minZoomFactor = autoSpan / Math.max(maxVisibleSpan, 0.0001);

  return {
    minVisibleSpan,
    maxVisibleSpan,
    minCandleHeightPx: requiredCandleHeightPx,
    minCandleHeightRatio: effectiveMinRatio,
    minZoomFactor,
  };
}

export interface ReferenceLevelLabelInput {
  id: 'HI' | 'LO' | 'PC';
  lineY: number;
  priority: number;
}

export interface ReferenceLevelLabelLayout {
  id: 'HI' | 'LO' | 'PC';
  lineY: number;
  labelY: number;
  displaced: boolean;
}

/**
 * Resolves non-overlapping vertical label positions for HI, LO, and in-range PC labels
 * within [minY, maxY] using minimum-displacement isotonic separation (PAVA) so reference
 * labels remain readable without altering the chart price scale or line positions.
 */
export function resolveReferenceLevelLabels(params: {
  items: ReferenceLevelLabelInput[];
  minY: number;
  maxY: number;
  minGapPx?: number;
}): ReferenceLevelLabelLayout[] {
  const validItems = params.items.filter(
    (item) => typeof item.lineY === 'number' && Number.isFinite(item.lineY)
  );
  if (validItems.length === 0) return [];

  const safeMinY = Number.isFinite(params.minY) ? params.minY : 0;
  const safeMaxY = Number.isFinite(params.maxY) ? Math.max(safeMinY, params.maxY) : safeMinY;
  const requestedGap =
    typeof params.minGapPx === 'number' && Number.isFinite(params.minGapPx) && params.minGapPx > 0
      ? params.minGapPx
      : REFERENCE_LABEL_MIN_GAP_PX;

  const sorted = [...validItems].sort(
    (a, b) => a.lineY - b.lineY || a.priority - b.priority
  );
  const n = sorted.length;
  const availableSpan = Math.max(0, safeMaxY - safeMinY);
  const gap = n > 1 ? Math.min(requestedGap, availableSpan / (n - 1)) : 0;

  const lowerBound = safeMinY;
  const upperBound = Math.max(lowerBound, safeMaxY - (n - 1) * gap);

  // Pool-Adjacent-Violators Algorithm on transformed targets z[i] = lineY[i] - i * gap
  const blocks: Array<{ sum: number; count: number; start: number; end: number }> = [];
  for (let i = 0; i < n; i++) {
    const z = sorted[i].lineY - i * gap;
    blocks.push({ sum: z, count: 1, start: i, end: i });
    while (blocks.length >= 2) {
      const prev = blocks[blocks.length - 2];
      const curr = blocks[blocks.length - 1];
      if (prev.sum / prev.count > curr.sum / curr.count) {
        prev.sum += curr.sum;
        prev.count += curr.count;
        prev.end = curr.end;
        blocks.pop();
      } else {
        break;
      }
    }
  }

  const resolvedYs = new Array<number>(n);
  for (const block of blocks) {
    const avg = Math.max(lowerBound, Math.min(upperBound, block.sum / block.count));
    for (let i = block.start; i <= block.end; i++) {
      resolvedYs[i] = avg + i * gap;
    }
  }

  return sorted.map((item, i) => ({
    id: item.id,
    lineY: item.lineY,
    labelY: resolvedYs[i],
    displaced: Math.abs(resolvedYs[i] - item.lineY) >= 1.5,
  }));
}

export interface OffscalePcBadgeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'right' | 'left';
  direction: 'above' | 'below';
}

/**
 * Positions the pinned off-scale Previous Close badge inside the chart plot boundary
 * and automatically shifts it to the left edge if HI or LO reference labels/lines
 * occupy the same vertical band along the right edge.
 */
export function computeOffscalePcBadgeLayout(params: {
  isAbove: boolean;
  labelText: string;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  avoidRightEdgeYs?: number[];
}): OffscalePcBadgeLayout {
  const height = 13;
  const plotWidth = Math.max(40, params.plotRight - params.plotLeft);
  const rawWidth = Math.max(66, Math.round(params.labelText.length * 5.2 + 12));
  const width = Math.min(rawWidth, Math.max(40, plotWidth - 4));
  const y = params.isAbove
    ? params.plotTop + 2
    : Math.max(params.plotTop + 2, params.plotBottom - height - 2);

  const rightX = Math.max(params.plotLeft + 2, params.plotRight - width - 2);
  const leftX = params.plotLeft + 4;

  const avoids = params.avoidRightEdgeYs ?? [];
  const collidesRightBand = avoids.some(
    (ay) => Number.isFinite(ay) && ay >= y - 5 && ay <= y + height + 5
  );
  const canShiftLeft = leftX + width < rightX - 4;
  const side: 'right' | 'left' = collidesRightBand && canShiftLeft ? 'left' : 'right';
  const x = side === 'left' ? leftX : rightX;

  return {
    x,
    y,
    width,
    height,
    side,
    direction: params.isAbove ? 'above' : 'below',
  };
}

export interface AutoPriceRangeResult {
  min: number;
  max: number;
  coreLow: number;
  coreHigh: number;
  includesPrevClose: boolean;
}

/**
 * Computes the automatic Y-axis price domain from actual candlestick highs/lows (plus
 * live currentPrice when plausible). Only incorporates prevClose when it is close enough
 * not to distort or compress candlestick price action; large gaps are left off-scale so
 * the chart can display a pinned Previous Close edge indicator instead.
 */
export function computeAutoPriceRange(params: {
  candleLow: number;
  candleHigh: number;
  currentPrice?: number;
  prevClose?: number | null;
  paddingRatio?: number;
  maxPrevCloseGapRatio?: number;
}): AutoPriceRangeResult {
  const {
    candleLow,
    candleHigh,
    currentPrice,
    prevClose,
    paddingRatio = PRICE_AUTO_PADDING_RATIO,
    maxPrevCloseGapRatio = PRICE_PREV_CLOSE_MAX_GAP_RATIO,
  } = params;

  const hasFiniteLow = typeof candleLow === 'number' && Number.isFinite(candleLow);
  const hasFiniteHigh = typeof candleHigh === 'number' && Number.isFinite(candleHigh);
  const hasFiniteCurrent =
    typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0;
  const hasPrevClose =
    typeof prevClose === 'number' && Number.isFinite(prevClose) && prevClose > 0;

  let rawLow: number;
  let rawHigh: number;
  if (hasFiniteLow && hasFiniteHigh) {
    rawLow = Math.min(candleLow, candleHigh);
    rawHigh = Math.max(candleLow, candleHigh);
  } else if (hasFiniteLow) {
    rawLow = candleLow;
    rawHigh = candleLow;
  } else if (hasFiniteHigh) {
    rawLow = candleHigh;
    rawHigh = candleHigh;
  } else if (hasFiniteCurrent) {
    rawLow = currentPrice;
    rawHigh = currentPrice;
  } else if (hasPrevClose) {
    rawLow = prevClose;
    rawHigh = prevClose;
  } else {
    rawLow = 1;
    rawHigh = 1;
  }

  const hasPlausibleCurrent =
    hasFiniteCurrent &&
    (rawHigh <= 0 || (currentPrice >= rawLow * 0.5 && currentPrice <= rawHigh * 1.5));

  const coreLow = hasPlausibleCurrent ? Math.min(rawLow, currentPrice) : rawLow;
  const coreHigh = hasPlausibleCurrent ? Math.max(rawHigh, currentPrice) : rawHigh;
  const coreSpan = Math.max(coreHigh - coreLow, 0);
  const coreMid = (coreLow + coreHigh) / 2;
  const minNaturalSpan = Math.max(Math.abs(coreMid) * 0.0005, 0.02);
  const baseSpan = Math.max(coreSpan, minNaturalSpan);

  const safeGapRatio =
    typeof maxPrevCloseGapRatio === 'number' && Number.isFinite(maxPrevCloseGapRatio)
      ? Math.max(0, maxPrevCloseGapRatio)
      : PRICE_PREV_CLOSE_MAX_GAP_RATIO;
  const prevCloseGap = hasPrevClose
    ? Math.max(0, prevClose - coreHigh, coreLow - prevClose)
    : Number.POSITIVE_INFINITY;
  const includesPrevClose = hasPrevClose && prevCloseGap <= baseSpan * safeGapRatio;

  const scaleLow = includesPrevClose ? Math.min(coreLow, prevClose) : coreLow;
  const scaleHigh = includesPrevClose ? Math.max(coreHigh, prevClose) : coreHigh;
  const scaleSpan = Math.max(scaleHigh - scaleLow, 0);

  let min: number;
  let max: number;
  if (scaleSpan <= 0) {
    const half = minNaturalSpan / 2;
    min = scaleLow - half;
    max = scaleHigh + half;
  } else {
    const rawPadRatio =
      typeof paddingRatio === 'number' && Number.isFinite(paddingRatio)
        ? paddingRatio
        : PRICE_AUTO_PADDING_RATIO;
    const safePadRatio = Math.max(0.02, Math.min(0.4, rawPadRatio));
    const pad = Math.max(scaleSpan * safePadRatio, minNaturalSpan * 0.25);
    min = scaleLow - pad;
    max = scaleHigh + pad;
  }

  if (coreLow >= 0 && min < 0) {
    min = 0;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = Number.isFinite(coreLow) ? coreLow - minNaturalSpan / 2 : 0;
    max = min + minNaturalSpan;
  }

  return {
    min,
    max,
    coreLow,
    coreHigh,
    includesPrevClose,
  };
}

/**
 * Adjusts a [min, max] range by the smallest shift (or minimal span expansion when the
 * focus band itself exceeds the current span) needed to keep [focusMin, focusMax] and
 * anchorValue comfortably inside the visible band with vertical edge padding.
 */
export function ensureRangeIncludesFocusBand(params: {
  range: YRange;
  focusMin?: number;
  focusMax?: number;
  anchorValue?: number;
  minVisibleSpan: number;
  maxVisibleSpan: number;
  boundMin?: number;
  boundMax?: number;
  edgePaddingRatio?: number;
}): YRange {
  const {
    range,
    focusMin,
    focusMax,
    anchorValue,
    minVisibleSpan,
    maxVisibleSpan,
    boundMin,
    boundMax,
    edgePaddingRatio = DEFAULT_EDGE_PADDING_RATIO,
  } = params;

  const hasAnchor = typeof anchorValue === 'number' && Number.isFinite(anchorValue);
  const hasFocusMin = typeof focusMin === 'number' && Number.isFinite(focusMin);
  const hasFocusMax = typeof focusMax === 'number' && Number.isFinite(focusMax);
  const safeBoundMin =
    typeof boundMin === 'number' && Number.isFinite(boundMin) ? boundMin : undefined;
  const safeBoundMax =
    typeof boundMax === 'number' && Number.isFinite(boundMax) ? boundMax : undefined;

  let targetLow: number | undefined;
  let targetHigh: number | undefined;
  if (hasFocusMin && hasFocusMax) {
    targetLow = Math.min(focusMin, focusMax);
    targetHigh = Math.max(focusMin, focusMax);
    if (hasAnchor) {
      targetLow = Math.min(targetLow, anchorValue);
      targetHigh = Math.max(targetHigh, anchorValue);
    }
  } else if (hasAnchor) {
    targetLow = anchorValue;
    targetHigh = anchorValue;
  }

  const rawPadRatio =
    typeof edgePaddingRatio === 'number' && Number.isFinite(edgePaddingRatio)
      ? edgePaddingRatio
      : DEFAULT_EDGE_PADDING_RATIO;
  const safePadRatio = Math.max(0, Math.min(0.4, rawPadRatio));
  const focusSpan =
    targetLow !== undefined && targetHigh !== undefined
      ? Math.max(0, targetHigh - targetLow)
      : 0;
  const requiredSpanForFocus =
    focusSpan > 0 ? focusSpan / Math.max(0.2, 1 - 2 * safePadRatio) : 0;

  const boundSpan =
    safeBoundMin !== undefined && safeBoundMax !== undefined
      ? Math.max(0, safeBoundMax - safeBoundMin)
      : undefined;

  const safeMinSpanInput =
    typeof minVisibleSpan === 'number' && Number.isFinite(minVisibleSpan) && minVisibleSpan > 0
      ? minVisibleSpan
      : 0.02;
  const safeMaxSpanInput =
    typeof maxVisibleSpan === 'number' && Number.isFinite(maxVisibleSpan) && maxVisibleSpan > 0
      ? maxVisibleSpan
      : Math.max(safeMinSpanInput * 2, 1);

  let effectiveMinSpan = Math.max(safeMinSpanInput, requiredSpanForFocus);
  let effectiveMaxSpan = Math.max(safeMaxSpanInput, effectiveMinSpan);
  if (boundSpan !== undefined && boundSpan > 0) {
    effectiveMinSpan = Math.min(effectiveMinSpan, boundSpan);
    effectiveMaxSpan = Math.min(effectiveMaxSpan, boundSpan);
  }

  let nextMin =
    typeof range?.min === 'number' && Number.isFinite(range.min) ? range.min : Number.NaN;
  let nextMax =
    typeof range?.max === 'number' && Number.isFinite(range.max) ? range.max : Number.NaN;
  let span = nextMax - nextMin;

  if (!Number.isFinite(span) || span <= 0) {
    const fallbackMid = hasAnchor
      ? anchorValue
      : targetLow !== undefined && targetHigh !== undefined
      ? (targetLow + targetHigh) / 2
      : 0;
    span = effectiveMinSpan;
    nextMin = fallbackMid - span / 2;
    nextMax = fallbackMid + span / 2;
  } else if (span < effectiveMinSpan) {
    const center =
      targetLow !== undefined && targetHigh !== undefined
        ? (targetLow + targetHigh) / 2
        : (nextMin + nextMax) / 2;
    span = effectiveMinSpan;
    nextMin = center - span / 2;
    nextMax = center + span / 2;
  } else if (span > effectiveMaxSpan) {
    const center = hasAnchor ? anchorValue : (nextMin + nextMax) / 2;
    span = effectiveMaxSpan;
    nextMin = center - span / 2;
    nextMax = center + span / 2;
  }

  if (targetLow !== undefined && targetHigh !== undefined) {
    const edgePad = Math.min(span * safePadRatio, Math.max(0, (span - focusSpan) / 2));
    if (targetHigh > nextMax - edgePad) {
      const shift = targetHigh + edgePad - nextMax;
      nextMin += shift;
      nextMax += shift;
    } else if (targetLow < nextMin + edgePad) {
      const shift = nextMin + edgePad - targetLow;
      nextMin -= shift;
      nextMax -= shift;
    }
  }

  if (safeBoundMin !== undefined && nextMin < safeBoundMin) {
    const shiftUp = safeBoundMin - nextMin;
    nextMin = safeBoundMin;
    nextMax = Math.max(nextMax + shiftUp, safeBoundMin + effectiveMinSpan);
  }

  if (safeBoundMax !== undefined && nextMax > safeBoundMax) {
    const shiftDown = nextMax - safeBoundMax;
    nextMax = safeBoundMax;
    nextMin = Math.min(nextMin - shiftDown, safeBoundMax - effectiveMinSpan);
    if (safeBoundMin !== undefined && nextMin < safeBoundMin) {
      nextMin = safeBoundMin;
    }
  }

  if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) {
    const safeBase = Number.isFinite(nextMin) ? nextMin : 0;
    nextMin = safeBase;
    nextMax = safeBase + Math.max(effectiveMinSpan, 0.0001);
  }

  return { min: nextMin, max: nextMax };
}

/**
 * Vertically pans a [baseMin, baseMax] range by deltaPrice while keeping [focusMin, focusMax]
 * and anchorValue strictly inside the visible padded bounds.
 */
export function panBoundedRange(params: {
  baseMin: number;
  baseMax: number;
  deltaPrice: number;
  minVisibleSpan: number;
  maxVisibleSpan: number;
  anchorValue?: number;
  focusMin?: number;
  focusMax?: number;
  boundMin?: number;
  boundMax?: number;
  edgePaddingRatio?: number;
}): YRange {
  const {
    baseMin,
    baseMax,
    deltaPrice,
    minVisibleSpan,
    maxVisibleSpan,
    anchorValue,
    focusMin,
    focusMax,
    boundMin,
    boundMax,
    edgePaddingRatio = DEFAULT_EDGE_PADDING_RATIO,
  } = params;

  const safeDelta = Number.isFinite(deltaPrice) ? deltaPrice : 0;
  return ensureRangeIncludesFocusBand({
    range: { min: baseMin + safeDelta, max: baseMax + safeDelta },
    focusMin,
    focusMax,
    anchorValue,
    minVisibleSpan,
    maxVisibleSpan,
    boundMin,
    boundMax,
    edgePaddingRatio,
  });
}

/**
 * Scales a [min, max] range by factor (>1 zooms in / narrows range, <1 zooms out / expands range),
 * anchoring around anchorValue and ensuring [focusMin, focusMax] stays comfortably visible
 * within [boundMin, boundMax] when provided.
 */
export function computeScaledBoundedRange(params: {
  baseMin: number;
  baseMax: number;
  factor: number;
  minVisibleSpan: number;
  maxVisibleSpan: number;
  anchorValue?: number;
  focusMin?: number;
  focusMax?: number;
  boundMin?: number;
  boundMax?: number;
  edgePaddingRatio?: number;
}): YRange {
  const {
    baseMin,
    baseMax,
    factor,
    minVisibleSpan,
    maxVisibleSpan,
    anchorValue,
    focusMin,
    focusMax,
    boundMin,
    boundMax,
    edgePaddingRatio = DEFAULT_EDGE_PADDING_RATIO,
  } = params;

  const hasAnchor = typeof anchorValue === 'number' && Number.isFinite(anchorValue);
  const safePadRatio = Number.isFinite(edgePaddingRatio)
    ? Math.max(0, Math.min(0.4, edgePaddingRatio))
    : DEFAULT_EDGE_PADDING_RATIO;
  const hasFocusMin = typeof focusMin === 'number' && Number.isFinite(focusMin);
  const hasFocusMax = typeof focusMax === 'number' && Number.isFinite(focusMax);

  let targetLow: number | undefined;
  let targetHigh: number | undefined;
  if (hasFocusMin && hasFocusMax) {
    targetLow = Math.min(focusMin, focusMax);
    targetHigh = Math.max(focusMin, focusMax);
    if (hasAnchor) {
      targetLow = Math.min(targetLow, anchorValue);
      targetHigh = Math.max(targetHigh, anchorValue);
    }
  } else if (hasAnchor) {
    targetLow = anchorValue;
    targetHigh = anchorValue;
  }

  const focusSpan =
    targetLow !== undefined && targetHigh !== undefined
      ? Math.max(0, targetHigh - targetLow)
      : 0;
  const requiredSpanForFocus =
    focusSpan > 0 ? focusSpan / Math.max(0.2, 1 - 2 * safePadRatio) : 0;

  const safeBoundMin = typeof boundMin === 'number' && Number.isFinite(boundMin) ? boundMin : undefined;
  const safeBoundMax = typeof boundMax === 'number' && Number.isFinite(boundMax) ? boundMax : undefined;
  const boundSpan =
    safeBoundMin !== undefined && safeBoundMax !== undefined
      ? Math.max(0, safeBoundMax - safeBoundMin)
      : undefined;

  const safeMinSpanInput =
    Number.isFinite(minVisibleSpan) && minVisibleSpan > 0 ? minVisibleSpan : 0.0001;
  const safeMaxSpanInput =
    Number.isFinite(maxVisibleSpan) && maxVisibleSpan > 0 ? maxVisibleSpan : safeMinSpanInput;

  let effectiveMinSpan = Math.max(safeMinSpanInput, requiredSpanForFocus);
  let effectiveMaxSpan = Math.max(safeMaxSpanInput, effectiveMinSpan);
  if (boundSpan !== undefined && boundSpan > 0) {
    effectiveMinSpan = Math.min(effectiveMinSpan, boundSpan);
    effectiveMaxSpan = Math.min(effectiveMaxSpan, boundSpan);
  }

  const fallbackCenter =
    hasAnchor
      ? anchorValue
      : targetLow !== undefined && targetHigh !== undefined
        ? (targetLow + targetHigh) / 2
        : safeBoundMin !== undefined
          ? safeBoundMin + effectiveMinSpan / 2
          : 0;
  const safeBaseMin = Number.isFinite(baseMin) ? baseMin : fallbackCenter - effectiveMinSpan / 2;
  const safeBaseMax =
    Number.isFinite(baseMax) && baseMax > safeBaseMin
      ? baseMax
      : safeBaseMin + effectiveMinSpan;

  const curSpan = Math.max(safeBaseMax - safeBaseMin, effectiveMinSpan);
  const safeFactor = clampZoomFactor(factor);
  const nextSpan = Math.max(effectiveMinSpan, Math.min(effectiveMaxSpan, curSpan / safeFactor));

  let nextMin: number;
  let nextMax: number;

  if (hasAnchor) {
    // Keep anchorValue (current price) smoothly anchored at its relative screen position
    // within comfortable vertical margins so zooming never pushes it out of view.
    const rawRatio = curSpan > 0 ? (anchorValue - safeBaseMin) / curSpan : 0.5;
    const minRatio = Math.max(safePadRatio, 0.15);
    const maxRatio = Math.min(1 - safePadRatio, 0.85);
    const anchorRatio = Math.max(minRatio, Math.min(maxRatio, rawRatio));
    nextMin = anchorValue - anchorRatio * nextSpan;
    nextMax = nextMin + nextSpan;
  } else {
    const mid = (safeBaseMin + safeBaseMax) / 2;
    const half = nextSpan / 2;
    nextMin = mid - half;
    nextMax = mid + half;
  }

  return ensureRangeIncludesFocusBand({
    range: { min: nextMin, max: nextMax },
    focusMin: targetLow,
    focusMax: targetHigh,
    anchorValue,
    minVisibleSpan: effectiveMinSpan,
    maxVisibleSpan: effectiveMaxSpan,
    boundMin: safeBoundMin,
    boundMax: safeBoundMax,
    edgePaddingRatio: safePadRatio,
  });
}

export function getVolumeZoomLimits(
  autoMaxVolume: number,
  referenceLowVolume?: number
): {
  minVisibleMax: number;
  maxVisibleMax: number;
} {
  const safeAutoMax = Number.isFinite(autoMaxVolume) && autoMaxVolume > 0 ? Math.max(autoMaxVolume, 1) : 1;
  const defaultMinMax = safeAutoMax * 0.05;
  const outlierAwareMinMax =
    typeof referenceLowVolume === 'number' &&
    Number.isFinite(referenceLowVolume) &&
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
  const safeBaseMax =
    Number.isFinite(baseMax) && baseMax > 0 ? Math.max(baseMax, minVisibleMax) : maxVisibleMax / 10;
  const safeFactor = clampZoomFactor(factor);
  return Math.max(minVisibleMax, Math.min(maxVisibleMax, safeBaseMax / safeFactor));
}

export const BASE_MACD_HEIGHT = 104;
export const MACD_PADDING_TOP = 22;
export const MACD_PADDING_BOTTOM = 12;
export const MACD_ADJ_HEIGHT = BASE_MACD_HEIGHT - MACD_PADDING_TOP - MACD_PADDING_BOTTOM;
export const MAX_MACD_EXPANSION_PX = 80;
export const MACD_ZOOM_HEIGHT_GROWTH_RATIO = 0.85;
export const MACD_MIN_ZOOM_FACTOR = 0.4;
export const MACD_MAX_ZOOM_FACTOR_CAP = 3.5;
export const MACD_MIN_ZOOM_IN_HEADROOM = 1.25;
export const MACD_AUTO_PADDING_RATIO = 0.16;
export const MACD_ASYMMETRY_THRESHOLD = 0.4;
export const MACD_MIN_SIDE_RATIO = 0.25;
export const MACD_MIN_VISIBLE_EXTENT = 0.005;

export interface MacdBarValues {
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
}

export interface AutoMacdRangeResult {
  min: number;
  max: number;
  coreMin: number;
  coreMax: number;
  isSymmetric: boolean;
  minZoomFactor: number;
  maxZoomFactor: number;
}

export interface MacdPanelLayout {
  min: number;
  max: number;
  zoomFactor: number;
  isZoomed: boolean;
  macdHeight: number;
  plotHeight: number;
  extraHeight: number;
}

function sortedQuantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const clampedQ = Math.max(0, Math.min(1, q));
  const pos = (sorted.length - 1) * clampedQ;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const weight = pos - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

/**
 * Computes a data-aware automatic Y-axis domain for MACD across all visible MACD line,
 * signal line, and histogram values.
 *
 * Accepts either structured bar records (preferred: computes per-bar vertical envelopes so
 * smaller histogram values do not dilute line-series percentiles) or flat numeric arrays.
 *
 * - Uses symmetric scaling around zero when positive and negative sides are reasonably balanced.
 * - Adapts asymmetrically (keeping zero strictly within 20%..80% of plot height) when one side
 *   dominates substantially so data visibility is never sacrificed for artificial symmetry.
 * - Protects against single extreme outliers (>3x 90th percentile) crushing the majority of bars.
 * - Derives a data-aware maxZoomFactor (accounting for bounded vertical panel expansion) so
 *   zooming in never unexpectedly clips the majority of visible MACD, signal, and histogram data.
 */
export function computeAutoMacdRange(
  input: ReadonlyArray<number | MacdBarValues>
): AutoMacdRangeResult {
  const barPosExtents: number[] = [];
  const barNegExtents: number[] = [];
  const barAbsExtents: number[] = [];
  const rawFiniteValues: number[] = [];

  let hasStructuredBars = false;
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (typeof item === 'number') {
      if (Number.isFinite(item)) {
        rawFiniteValues.push(item);
      }
    } else if (item && typeof item === 'object') {
      hasStructuredBars = true;
      const candidates = [item.macd, item.macdSignal, item.macdHist].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      );
      if (candidates.length > 0) {
        let bPos = 0;
        let bNeg = 0;
        for (let j = 0; j < candidates.length; j++) {
          const v = candidates[j];
          rawFiniteValues.push(v);
          if (v > bPos) bPos = v;
          if (-v > bNeg) bNeg = -v;
        }
        barPosExtents.push(bPos);
        barNegExtents.push(bNeg);
        barAbsExtents.push(Math.max(bPos, bNeg));
      }
    }
  }

  if (rawFiniteValues.length === 0) {
    const fallback = MACD_MIN_VISIBLE_EXTENT * (1 + MACD_AUTO_PADDING_RATIO);
    return {
      min: -fallback,
      max: fallback,
      coreMin: -MACD_MIN_VISIBLE_EXTENT,
      coreMax: MACD_MIN_VISIBLE_EXTENT,
      isSymmetric: true,
      minZoomFactor: MACD_MIN_ZOOM_FACTOR,
      maxZoomFactor: MACD_MIN_ZOOM_IN_HEADROOM,
    };
  }

  // Build sorted distributions for positive, negative, and absolute magnitudes
  let posSorted: number[];
  let negSorted: number[];
  let absSorted: number[];
  let sampleCount: number;

  if (hasStructuredBars && barAbsExtents.length > 0) {
    posSorted = [...barPosExtents].sort((a, b) => a - b);
    negSorted = [...barNegExtents].sort((a, b) => a - b);
    absSorted = [...barAbsExtents].sort((a, b) => a - b);
    sampleCount = barAbsExtents.length;
  } else {
    posSorted = rawFiniteValues.map((v) => Math.max(0, v)).sort((a, b) => a - b);
    negSorted = rawFiniteValues.map((v) => Math.max(0, -v)).sort((a, b) => a - b);
    absSorted = rawFiniteValues.map((v) => Math.abs(v)).sort((a, b) => a - b);
    sampleCount = rawFiniteValues.length;
  }

  const rawPosMax = posSorted[posSorted.length - 1];
  const rawNegExtent = negSorted[negSorted.length - 1];

  const p90Pos = sortedQuantile(posSorted, 0.9);
  const p90Neg = sortedQuantile(negSorted, 0.9);
  const p90Abs = sortedQuantile(absSorted, 0.9);
  const maxAbs = absSorted[absSorted.length - 1];

  // Fit full visible data for ordinary sessions; cap only genuinely extreme (>3x p90) outliers
  // so a single anomalous spike does not make the majority of MACD bars unreadable.
  const hasExtremeOutlier =
    sampleCount >= 12 &&
    p90Abs > MACD_MIN_VISIBLE_EXTENT &&
    maxAbs > p90Abs * 3;

  const fitPosExtent = hasExtremeOutlier
    ? Math.min(rawPosMax, Math.max(p90Pos * 1.45, p90Abs * 2))
    : rawPosMax;
  const fitNegExtent = hasExtremeOutlier
    ? Math.min(rawNegExtent, Math.max(p90Neg * 1.45, p90Abs * 2))
    : rawNegExtent;

  const dominant = Math.max(fitPosExtent, fitNegExtent, MACD_MIN_VISIBLE_EXTENT);
  const minor = Math.min(fitPosExtent, fitNegExtent);
  const isSymmetric =
    dominant <= MACD_MIN_VISIBLE_EXTENT * 2 ||
    minor >= dominant * MACD_ASYMMETRY_THRESHOLD;

  let autoMin: number;
  let autoMax: number;
  if (isSymmetric) {
    const padded = dominant * (1 + MACD_AUTO_PADDING_RATIO);
    autoMin = -padded;
    autoMax = padded;
  } else {
    const basePos = Math.max(fitPosExtent, dominant * MACD_MIN_SIDE_RATIO);
    const baseNeg = Math.max(fitNegExtent, dominant * MACD_MIN_SIDE_RATIO);
    autoMax = basePos * (1 + MACD_AUTO_PADDING_RATIO);
    autoMin = -baseNeg * (1 + MACD_AUTO_PADDING_RATIO);
  }

  const coreMax = Math.max(0, p90Pos);
  const coreMin = -Math.max(0, p90Neg);

  // Account for bounded vertical plot expansion (70px -> up to 150px) when computing the
  // data-safe zoom ceiling so zooming in genuinely magnifies detail while keeping the
  // core majority (>= 90% of per-bar envelopes) strictly inside the plotting area.
  const maxExpansionRatio = (MACD_ADJ_HEIGHT + MAX_MACD_EXPANSION_PX) / MACD_ADJ_HEIGHT;
  const posZoomCeiling =
    coreMax > MACD_MIN_VISIBLE_EXTENT * 0.25
      ? (autoMax * maxExpansionRatio) / (coreMax * 1.06)
      : MACD_MAX_ZOOM_FACTOR_CAP;
  const negZoomCeiling =
    -coreMin > MACD_MIN_VISIBLE_EXTENT * 0.25
      ? (-autoMin * maxExpansionRatio) / (-coreMin * 1.06)
      : MACD_MAX_ZOOM_FACTOR_CAP;
  const dataSafeMaxZoom = Math.min(posZoomCeiling, negZoomCeiling);
  const maxZoomFactor = Math.max(
    MACD_MIN_ZOOM_IN_HEADROOM,
    Math.min(MACD_MAX_ZOOM_FACTOR_CAP, dataSafeMaxZoom)
  );

  return {
    min: autoMin,
    max: autoMax,
    coreMin,
    coreMax,
    isSymmetric,
    minZoomFactor: MACD_MIN_ZOOM_FACTOR,
    maxZoomFactor,
  };
}

/**
 * Clamps a MACD zoom multiplier into the data-aware [minZoomFactor, maxZoomFactor] bounds.
 */
export function clampMacdZoomFactor(
  zoomFactor: number,
  limits: Pick<AutoMacdRangeResult, 'minZoomFactor' | 'maxZoomFactor'>
): number {
  const minZ =
    Number.isFinite(limits.minZoomFactor) && limits.minZoomFactor > 0
      ? limits.minZoomFactor
      : MACD_MIN_ZOOM_FACTOR;
  const maxZ =
    Number.isFinite(limits.maxZoomFactor) && limits.maxZoomFactor >= minZ
      ? limits.maxZoomFactor
      : Math.max(minZ, MACD_MIN_ZOOM_IN_HEADROOM);
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return 1;
  return Math.max(minZ, Math.min(maxZ, zoomFactor));
}

/**
 * Applies a relative wheel/drag/keyboard zoom delta factor (>1 zooms in, <1 zooms out)
 * to the current MACD zoom multiplier while respecting data-aware limits.
 */
export function computeScaledMacdZoom(
  baseZoomFactor: number,
  factor: number,
  limits: Pick<AutoMacdRangeResult, 'minZoomFactor' | 'maxZoomFactor'>
): number {
  const safeBase = clampMacdZoomFactor(baseZoomFactor, limits);
  const safeFactor = clampZoomFactor(factor);
  return clampMacdZoomFactor(safeBase * safeFactor, limits);
}

/**
 * Computes the active MACD panel height, plot height, and visible Y-axis domain together
 * so vertical zoom achieves exact `zoomFactor` pixel magnification while expanding plot
 * height smoothly (up to +80px) to keep plotted MACD/signal/histogram data unclipped.
 *
 * Zero baseline relative position (`max / (max - min)`) stays invariant across all zoom levels.
 */
export function computeMacdPanelLayout(
  autoRange: AutoMacdRangeResult,
  customZoomFactor: number | null
): MacdPanelLayout {
  if (customZoomFactor === null || !Number.isFinite(customZoomFactor) || customZoomFactor <= 0) {
    return {
      min: autoRange.min,
      max: autoRange.max,
      zoomFactor: 1,
      isZoomed: false,
      macdHeight: BASE_MACD_HEIGHT,
      plotHeight: MACD_ADJ_HEIGHT,
      extraHeight: 0,
    };
  }

  const zoomFactor = clampMacdZoomFactor(customZoomFactor, autoRange);
  const extraHeight =
    zoomFactor > 1
      ? Math.min(
          MAX_MACD_EXPANSION_PX,
          Math.max(0, Math.round(MACD_ADJ_HEIGHT * (zoomFactor - 1) * MACD_ZOOM_HEIGHT_GROWTH_RATIO))
        )
      : 0;
  const plotHeight = MACD_ADJ_HEIGHT + extraHeight;
  const macdHeight = BASE_MACD_HEIGHT + extraHeight;
  const heightScale = plotHeight / MACD_ADJ_HEIGHT;

  return {
    min: (autoRange.min * heightScale) / zoomFactor,
    max: (autoRange.max * heightScale) / zoomFactor,
    zoomFactor,
    isZoomed: true,
    macdHeight,
    plotHeight,
    extraHeight,
  };
}

/**
 * Convenience wrapper returning the active MACD visible Y-axis range and zoom state.
 */
export function computeMacdVisibleRange(
  autoRange: AutoMacdRangeResult,
  customZoomFactor: number | null
): {
  min: number;
  max: number;
  zoomFactor: number;
  isZoomed: boolean;
} {
  const layout = computeMacdPanelLayout(autoRange, customZoomFactor);
  return {
    min: layout.min,
    max: layout.max,
    zoomFactor: layout.zoomFactor,
    isZoomed: layout.isZoomed,
  };
}

/**
 * Formats MACD Y-axis tick values cleanly across zoom extremes and price magnitudes so labels
 * stay readable, non-redundant (never collapsing small non-zero bounds to "0.00"), and inside
 * the 52px Y-axis label box.
 */
export function formatMacdAxisValue(val: number, referenceExtent: number): string {
  if (!Number.isFinite(val)) return '--';
  if (Math.abs(val) < 1e-9) return '0';
  const ref =
    Number.isFinite(referenceExtent) && referenceExtent > 0
      ? referenceExtent
      : Math.abs(val);
  if (ref < 0.01) return val.toFixed(4);
  if (ref < 0.1) return val.toFixed(3);
  if (ref < 100) return val.toFixed(2);
  if (ref < 1000) return val.toFixed(1);
  return val.toFixed(0);
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
      typeof anchorRsi === 'number' && Number.isFinite(anchorRsi)
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
  const safeVisibleMax =
    Number.isFinite(params.visibleMaxVolume) && params.visibleMaxVolume > 0
      ? Math.max(params.visibleMaxVolume, 1)
      : 1;
  const safePeak =
    Number.isFinite(params.peakRenderedVolume) && params.peakRenderedVolume > 0
      ? params.peakRenderedVolume
      : 0;

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


