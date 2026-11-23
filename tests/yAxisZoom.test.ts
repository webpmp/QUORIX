import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartWidget from '../src/components/ChartWidget.tsx';
import ErrorBoundary from '../src/components/ErrorBoundary.tsx';
import {
  clearMarketHistoryCache,
  setCachedMarketHistory,
  type HistoryBar,
} from '../src/utils/marketHistoryCache.ts';
import {
  BASE_PRICE_HEIGHT,
  BASE_VOL_ADJ_HEIGHT,
  BASE_VOL_HEIGHT,
  DEFAULT_EDGE_PADDING_RATIO,
  MAX_VOL_EXPANSION_PX,
  PRICE_MIN_CANDLE_HEIGHT_PX,
  PRICE_MIN_CANDLE_HEIGHT_RATIO,
  PRICE_ZOOM_EDGE_PADDING_RATIO,
  REFERENCE_LABEL_MIN_GAP_PX,
  RSI_MIN_VISIBLE_SPAN,
  RSI_NATURAL_MAX,
  RSI_NATURAL_MIN,
  VOL_PADDING_BOTTOM,
  VOL_PADDING_TOP,
  computeAutoPriceRange,
  computeOffscalePcBadgeLayout,
  computePriceZoomLimits,
  computeScaledBoundedRange,
  computeScaledRsiRange,
  computeScaledVolumeMax,
  computeVolumePanelLayout,
  dragDeltaToZoomFactor,
  ensureRangeIncludesFocusBand,
  getVolumeZoomLimits,
  panBoundedRange,
  resolveReferenceLevelLabels,
  shouldShowYScaleIndicator,
  wheelDeltaToZoomFactor,
} from '../src/utils/yAxisZoom.ts';
import type { StockData } from '../src/types.ts';

function buildBars(count = 20): HistoryBar[] {
  const bars: HistoryBar[] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + Math.sin(i / 2) * 5 + i * 0.4;
    bars.push({
      date: `11/19 10:${String(i).padStart(2, '0')}`,
      timestamp: 1795080000 + i * 60,
      open: close - 0.5,
      high: close + 1.0,
      low: close - 1.0,
      close,
      volume: 100_000 + i * 25_000,
      volMa: 150_000 + i * 10_000,
    });
  }
  return bars;
}

function makeStock(overrides: Partial<StockData> = {}): StockData {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    price: 108.5,
    change: 1.25,
    changePercent: 1.17,
    high: 110,
    low: 96,
    open: 100,
    prevClose: 107.25,
    volume: 4_500_000,
    marketCap: '3.2T',
    peRatio: 28,
    beta: 1.2,
    history: [],
    ...overrides,
  };
}

function extractPriceSvgMetrics(html: string) {
  const clipMatch = html.match(/id="gp-price-plot-clip"><rect[^>]*y="([0-9.-]+)"[^>]*height="([0-9.-]+)"/);
  assert.ok(clipMatch, 'Expected gp-price-plot-clip rect in rendered SVG');
  const clipTop = Number(clipMatch[1]);
  const clipBottom = clipTop + Number(clipMatch[2]);
  const plotTop = clipTop + 3; // pricePaddingTop = 18
  const plotBottom = clipBottom - 3;

  const wickMatches = [
    ...html.matchAll(/<line x1="([0-9.-]+)" y1="([0-9.-]+)" x2="([0-9.-]+)" y2="([0-9.-]+)" stroke="(?:#00ff00|#ff4444)" stroke-width="1\.2"\/?>/g),
  ];
  const bodyMatches = [
    ...html.matchAll(/<rect x="([0-9.-]+)" y="([0-9.-]+)" width="([0-9.-]+)" height="([0-9.-]+)" fill="(?:black|#ff4444)" stroke="(?:#00ff00|#ff4444)" stroke-width="1\.5" class="cursor-crosshair"\/?>/g),
  ];
  const currentPriceCircle = html.match(/data-current-price-indicator="true"[\s\S]*?<circle[^>]*cy="([0-9.-]+)"/);

  return {
    clipTop,
    clipBottom,
    plotTop,
    plotBottom,
    wicks: wickMatches.map((m) => ({
      x: Number(m[1]),
      highY: Number(m[2]),
      lowY: Number(m[4]),
    })),
    bodies: bodyMatches.map((m) => ({
      topY: Number(m[2]),
      bottomY: Number(m[2]) + Number(m[4]),
    })),
    currentPriceY: currentPriceCircle ? Number(currentPriceCircle[1]) : null,
  };
}

test('wheel and drag delta conversions match Price Chart zoom sensitivity and direction', () => {
  // Wheel up (negative deltaY) zooms IN (factor > 1); wheel down zooms OUT (factor < 1)
  assert.ok(wheelDeltaToZoomFactor(-100) > 1);
  assert.ok(wheelDeltaToZoomFactor(100) < 1);
  assert.equal(wheelDeltaToZoomFactor(0), 1);

  // Dragging up (negative dy) zooms IN; dragging down zooms OUT
  assert.ok(dragDeltaToZoomFactor(-50) > 1);
  assert.ok(dragDeltaToZoomFactor(50) < 1);
  assert.equal(dragDeltaToZoomFactor(0), 1);
});

test('Volume zoom narrows/expands upper bound, preserves zero baseline, never goes negative, and enforces limits', () => {
  const autoMax = 1_000_000;
  const { minVisibleMax, maxVisibleMax } = getVolumeZoomLimits(autoMax);

  // Zoom in (factor > 1) lowers visible max volume -> expands volume bars upward from 0 baseline
  const zoomedIn = computeScaledVolumeMax(autoMax, autoMax, 2);
  assert.equal(zoomedIn, 500_000);

  // Zoom out (factor < 1) raises visible max volume -> compresses volume bars toward 0 baseline
  const zoomedOut = computeScaledVolumeMax(autoMax, autoMax, 0.5);
  assert.equal(zoomedOut, 2_000_000);

  // Extreme zoom in cannot collapse below minVisibleMax and stays strictly positive
  let cur = autoMax;
  for (let i = 0; i < 40; i++) {
    cur = computeScaledVolumeMax(cur, autoMax, 2);
  }
  assert.equal(cur, minVisibleMax);
  assert.ok(cur >= 1);

  // Extreme zoom out cannot exceed maxVisibleMax
  cur = autoMax;
  for (let i = 0; i < 40; i++) {
    cur = computeScaledVolumeMax(cur, autoMax, 0.5);
  }
  assert.equal(cur, maxVisibleMax);
});

test('Volume limited dynamic height expands up to +50px (125px max), fits taller bars where possible, preserves small bar magnification, and clips extreme outliers', () => {
  const outlierSpike = 14_500_000;
  const moderateHighBar = 900_000;
  const typicalSmallBar = 100_000;

  // 1. Default unzoomed layout stays exact 75px
  const defaultLayout = computeVolumePanelLayout({
    visibleMaxVolume: outlierSpike,
    peakRenderedVolume: outlierSpike,
    isZoomed: false,
  });
  assert.equal(defaultLayout.volHeight, BASE_VOL_HEIGHT);
  assert.equal(defaultLayout.extraHeight, 0);
  assert.equal(defaultLayout.volPlotHeight, BASE_VOL_ADJ_HEIGHT);

  const mapVolY = (vol: number, visibleMax: number, layout: ReturnType<typeof computeVolumePanelLayout>) =>
    layout.volBaselineY - (Math.max(0, vol) / Math.max(visibleMax, 1)) * layout.volScaleHeight;

  // 2. Moderate zoom on bars without extreme spike expands smoothly (e.g. 1.6x -> +27px) so tallest bar fits unclipped
  const moderateZoomMax = moderateHighBar / 1.6; // 562.5K
  const modLayout = computeVolumePanelLayout({
    visibleMaxVolume: moderateZoomMax,
    peakRenderedVolume: moderateHighBar,
    isZoomed: true,
  });
  assert.equal(modLayout.extraHeight, 27);
  assert.equal(modLayout.volHeight, 75 + 27);
  assert.equal(modLayout.volHeight, VOL_PADDING_TOP + modLayout.volPlotHeight + VOL_PADDING_BOTTOM);
  // Tallest bar fits completely above volPaddingTop and below volBaselineY
  const modPeakY = mapVolY(moderateHighBar, moderateZoomMax, modLayout);
  assert.ok(modPeakY >= modLayout.volPaddingTop && modPeakY <= modLayout.volBaselineY);
  // Smaller bar magnification is preserved (exact same scale as unexpanded)
  assert.equal(
    modLayout.volBaselineY - mapVolY(typicalSmallBar, moderateZoomMax, modLayout),
    (typicalSmallBar / moderateZoomMax) * BASE_VOL_ADJ_HEIGHT
  );

  // 3. Extreme zoom (e.g. 88.82x on 14.5M outlier -> visibleMax ~ 163K) caps strictly at +50px (125px max)
  const extremeZoomMax = outlierSpike / 88.82;
  const extremeLayout = computeVolumePanelLayout({
    visibleMaxVolume: extremeZoomMax,
    peakRenderedVolume: outlierSpike,
    isZoomed: true,
  });
  assert.equal(extremeLayout.extraHeight, MAX_VOL_EXPANSION_PX);
  assert.equal(extremeLayout.volHeight, 125);
  assert.equal(extremeLayout.volPlotHeight, 95);
  // Smaller bar (100K) is substantially magnified (~27.6px tall!)
  const smallBarHeightPx = extremeLayout.volBaselineY - mapVolY(typicalSmallBar, extremeZoomMax, extremeLayout);
  assert.ok(smallBarHeightPx > 27);
  // Zero baseline stays fixed at volBaselineY
  assert.equal(mapVolY(0, extremeZoomMax, extremeLayout), extremeLayout.volBaselineY);
  // Bars up to topBoundaryVolume (~2.11x visibleMax) fit completely inside the expanded 125px panel
  assert.ok(mapVolY(extremeZoomMax * 2, extremeZoomMax, extremeLayout) >= extremeLayout.volPaddingTop);
  // Extreme outlier (14.5M) extends above volPaddingTop and clips cleanly at #gp-vol-plot-clip instead of forcing unlimited height
  assert.ok(mapVolY(outlierSpike, extremeZoomMax, extremeLayout) < extremeLayout.volPaddingTop);

  // 4. Zooming out / resetting restores 75px height
  const zoomedOutLayout = computeVolumePanelLayout({
    visibleMaxVolume: outlierSpike * 2,
    peakRenderedVolume: outlierSpike,
    isZoomed: true,
  });
  assert.equal(zoomedOutLayout.volHeight, BASE_VOL_HEIGHT);
  assert.equal(zoomedOutLayout.extraHeight, 0);

  const resetLayout = computeVolumePanelLayout({
    visibleMaxVolume: outlierSpike,
    peakRenderedVolume: outlierSpike,
    isZoomed: false,
  });
  assert.equal(resetLayout.volHeight, BASE_VOL_HEIGHT);
});

test('Volume zoom magnifies small bars even when an outlier spike dominates autoMax', () => {
  const outlierSpike = 14_500_000;
  const typicalSmallBar = 100_000;
  const { minVisibleMax } = getVolumeZoomLimits(outlierSpike, typicalSmallBar);
  assert.equal(minVisibleMax, 200_000);

  let visibleMax = outlierSpike;
  for (let i = 0; i < 12; i++) {
    visibleMax = computeScaledVolumeMax(visibleMax, outlierSpike, 2, typicalSmallBar);
  }
  assert.equal(visibleMax, 200_000);
});

test('RSI zoom stays strictly within [0, 100], enforces min span, and anchors near current RSI', () => {
  // Zoom in from natural [0, 100] anchored near 72
  const z1 = computeScaledRsiRange(0, 100, 1.5, 72);
  assert.ok(z1.min >= RSI_NATURAL_MIN);
  assert.ok(z1.max <= RSI_NATURAL_MAX);
  assert.ok(z1.max - z1.min < 100);
  assert.ok(72 >= z1.min && 72 <= z1.max);

  // Repeated zoom in stops at RSI_MIN_VISIBLE_SPAN while keeping valid 0..100 bounds
  let range = { min: 0, max: 100 };
  for (let i = 0; i < 30; i++) {
    range = computeScaledRsiRange(range.min, range.max, 1.5, 95);
  }
  assert.ok(range.min >= RSI_NATURAL_MIN);
  assert.ok(range.max <= RSI_NATURAL_MAX);
  assert.equal(Math.round(range.max - range.min), RSI_MIN_VISIBLE_SPAN);
  assert.ok(95 >= range.min && 95 <= range.max);

  // Repeated zoom out restores full [0, 100] and never exceeds it
  for (let i = 0; i < 30; i++) {
    range = computeScaledRsiRange(range.min, range.max, 0.5, 95);
  }
  assert.equal(range.min, 0);
  assert.equal(range.max, 100);
});

test('Price Chart range scaling preserves non-negative bounds and anchor tracking', () => {
  const scaled = computeScaledBoundedRange({
    baseMin: 95,
    baseMax: 115,
    factor: 2,
    minVisibleSpan: 2,
    maxVisibleSpan: 80,
    anchorValue: 112,
    boundMin: 0,
  });
  assert.ok(scaled.min >= 0);
  assert.equal(scaled.max - scaled.min, 10);
  assert.ok(112 >= scaled.min && 112 <= scaled.max);
});

test('computeAutoPriceRange prioritizes candlesticks and isolates large previous-close gaps', () => {
  // 1. Small gap from previous close: softly includes prevClose without crushing candles
  const smallGap = computeAutoPriceRange({
    candleLow: 164,
    candleHigh: 168,
    currentPrice: 167.2,
    prevClose: 163.2,
  });
  assert.equal(smallGap.includesPrevClose, true);
  assert.ok(smallGap.min < 163.2);
  assert.ok(smallGap.max > 168);
  assert.ok((168 - 164) / (smallGap.max - smallGap.min) > 0.55);

  // 2. Large gap UP from previous close: excludes distant prevClose so candles stay large & centered
  const largeGapUp = computeAutoPriceRange({
    candleLow: 165,
    candleHigh: 168.5,
    currentPrice: 167.8,
    prevClose: 148,
  });
  assert.equal(largeGapUp.includesPrevClose, false);
  assert.ok(largeGapUp.min > 160, 'Distant prevClose must not drag minPrice down');
  assert.ok(largeGapUp.min < 165 && largeGapUp.max > 168.5);
  assert.ok((168.5 - 165) / (largeGapUp.max - largeGapUp.min) > 0.72);

  // 3. Large gap DOWN from previous close: excludes distant prevClose above candles
  const largeGapDown = computeAutoPriceRange({
    candleLow: 140,
    candleHigh: 143,
    currentPrice: 141.2,
    prevClose: 162,
  });
  assert.equal(largeGapDown.includesPrevClose, false);
  assert.ok(largeGapDown.max < 146, 'Distant prevClose must not drag maxPrice up');
  assert.ok(largeGapDown.min < 140 && largeGapDown.max > 143);
  assert.ok((143 - 140) / (largeGapDown.max - largeGapDown.min) > 0.72);
});

test('Price Chart repeated zoom-in, zoom-out, and vertical panning keep highest/lowest candlesticks and current price strictly inside plot', () => {
  const candleLow = 163.46;
  const candleHigh = 168.6;
  const currentPrice = 166.38;
  const moderatePrevClose = 158.0;
  const auto = computeAutoPriceRange({
    candleLow,
    candleHigh,
    currentPrice,
    prevClose: moderatePrevClose,
  });
  const plotHeightPx = BASE_PRICE_HEIGHT - 36;
  const { minVisibleSpan, maxVisibleSpan, minCandleHeightRatio } = computePriceZoomLimits({
    candleLow,
    candleHigh,
    autoMinPrice: auto.min,
    autoMaxPrice: auto.max,
    plotHeightPx,
  });

  // Repeated zoom-in (50x): never clips highest or lowest wick or current price
  let range = { min: auto.min, max: auto.max };
  for (let step = 0; step < 50; step++) {
    range = computeScaledBoundedRange({
      baseMin: range.min,
      baseMax: range.max,
      factor: 1.2,
      minVisibleSpan,
      maxVisibleSpan,
      anchorValue: currentPrice,
      focusMin: auto.coreLow,
      focusMax: auto.coreHigh,
      boundMin: 0,
      edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
    });

    const span = range.max - range.min;
    const pad = span * PRICE_ZOOM_EDGE_PADDING_RATIO;
    assert.ok(candleLow >= range.min + pad - 1e-6, `zoom-in step ${step}: candleLow must stay padded`);
    assert.ok(candleHigh <= range.max - pad + 1e-6, `zoom-in step ${step}: candleHigh must stay padded`);
    assert.ok(currentPrice >= range.min + pad - 1e-6 && currentPrice <= range.max - pad + 1e-6);
  }

  // Repeated zoom-out (50x): stops at maxVisibleSpan (>= 25% plot height for candles)
  // while still allowing moderately nearby prevClose (158.0) to enter view in-scale
  for (let step = 0; step < 50; step++) {
    range = computeScaledBoundedRange({
      baseMin: range.min,
      baseMax: range.max,
      factor: 1 / 1.2,
      minVisibleSpan,
      maxVisibleSpan,
      anchorValue: currentPrice,
      focusMin: auto.coreLow,
      focusMax: auto.coreHigh,
      boundMin: 0,
      edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
    });
    assert.ok(range.min >= 0);
    assert.ok(candleLow >= range.min && candleHigh <= range.max);
    const renderedRatio = (candleHigh - candleLow) / (range.max - range.min);
    assert.ok(
      renderedRatio >= minCandleHeightRatio - 1e-6,
      `zoom-out step ${step}: candlestick height ratio (${renderedRatio}) must stay >= ${minCandleHeightRatio}`
    );
  }
  assert.ok(
    Math.abs((range.max - range.min) - maxVisibleSpan) < 1e-6,
    'Repeated zoom-out must stop cleanly at maxVisibleSpan'
  );
  assert.ok(
    moderatePrevClose >= range.min && moderatePrevClose <= range.max,
    'Zooming out should allow moderately nearby prevClose to enter view without flattening candles'
  );

  // Vertical panning up and down cannot push highest or lowest candlestick outside the visible plot
  const pannedUp = panBoundedRange({
    baseMin: range.min,
    baseMax: range.max,
    deltaPrice: 500,
    minVisibleSpan,
    maxVisibleSpan,
    anchorValue: currentPrice,
    focusMin: auto.coreLow,
    focusMax: auto.coreHigh,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  const pannedDown = panBoundedRange({
    baseMin: range.min,
    baseMax: range.max,
    deltaPrice: -500,
    minVisibleSpan,
    maxVisibleSpan,
    anchorValue: currentPrice,
    focusMin: auto.coreLow,
    focusMax: auto.coreHigh,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  for (const panned of [pannedUp, pannedDown]) {
    const pad = (panned.max - panned.min) * PRICE_ZOOM_EDGE_PADDING_RATIO;
    assert.ok(candleLow >= panned.min + pad - 1e-6);
    assert.ok(candleHigh <= panned.max - pad + 1e-6);
    assert.ok(currentPrice >= panned.min + pad - 1e-6 && currentPrice <= panned.max - pad + 1e-6);
  }
});

test('Price Chart zoom handles large latest-candlestick range and preserves zoom span when already visible', () => {
  const range = computeScaledBoundedRange({
    baseMin: 125,
    baseMax: 155,
    factor: 10,
    minVisibleSpan: 4.5,
    maxVisibleSpan: 120,
    anchorValue: 146,
    focusMin: 140,
    focusMax: 150,
    boundMin: 0,
  });

  const span = range.max - range.min;
  const pad = span * DEFAULT_EDGE_PADDING_RATIO;
  assert.ok(span >= 10 / (1 - 2 * DEFAULT_EDGE_PADDING_RATIO) - 1e-6);
  assert.ok(140 >= range.min + pad - 1e-6);
  assert.ok(150 <= range.max - pad + 1e-6);

  const alreadyVisible = ensureRangeIncludesFocusBand({
    range: { min: 135, max: 155 },
    focusMin: 142,
    focusMax: 148,
    anchorValue: 146,
    minVisibleSpan: 4.5,
    maxVisibleSpan: 120,
    boundMin: 0,
  });
  assert.equal(alreadyVisible.min, 135);
  assert.equal(alreadyVisible.max, 155);
});

test('Price Chart handles live price movement while zoomed without resetting zoom span', () => {
  const shiftedUp = ensureRangeIncludesFocusBand({
    range: { min: 100, max: 110 },
    focusMin: 106,
    focusMax: 113,
    anchorValue: 112.5,
    minVisibleSpan: 5,
    maxVisibleSpan: 80,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  // Preserves exact 10-point zoom span while shifting minimally to frame [106, 113]
  assert.ok(Math.abs((shiftedUp.max - shiftedUp.min) - 10) < 1e-6);
  const pad = 10 * PRICE_ZOOM_EDGE_PADDING_RATIO;
  assert.ok(113 <= shiftedUp.max - pad + 1e-6);
  assert.ok(106 >= shiftedUp.min + pad - 1e-6);
});

function withStudiesStorage<T>(studies: string[], fn: () => T): T {
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>([['quorix_gp_studies_v1', JSON.stringify(studies)]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  try {
    return fn();
  } finally {
    if (prevDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', prevDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
}

test('ChartWidget keeps ALL candlesticks and current-price indicator unclipped across normal, large gap-up, large gap-down, wide-range, and zoomed states', () => {
  withStudiesStorage(['rsi', 'volume', 'levels', 'vwap'], () => {
    // Scenario 0: Normal trading session with small gap from previous close (PC stays in-range as dashed line)
    clearMarketHistoryCache();
    setCachedMarketHistory('AAPL', '1h', buildBars(24));
    const normalHtml = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({ prevClose: 107.25 }),
      })
    );
    const normalMetrics = extractPriceSvgMetrics(normalHtml);
    assert.equal(normalHtml.includes('>PC</text>'), true, 'Small gap should render in-range horizontal PC line');
    assert.equal(normalHtml.includes('data-pc-offscale'), false);
    for (const wick of normalMetrics.wicks) {
      assert.ok(wick.highY >= normalMetrics.plotTop && wick.lowY <= normalMetrics.plotBottom);
    }
    assert.ok(
      normalMetrics.currentPriceY !== null &&
        normalMetrics.currentPriceY >= normalMetrics.plotTop &&
        normalMetrics.currentPriceY <= normalMetrics.plotBottom
    );

    // Scenario 1: Large gap UP from previous close (candles 165..169.5, prevClose 148, outlier VWAP ignored)
    clearMarketHistoryCache();
    const gapUpBars: HistoryBar[] = Array.from({ length: 24 }, (_, i) => {
      const base = 165.5 + Math.sin(i / 3) * 1.4 + i * 0.08;
      const isLast = i === 23;
      const open = isLast ? 167.2 : base;
      const close = isLast ? 168.4 : base + 0.35;
      const high = isLast ? 169.5 : Math.max(open, close) + 0.45;
      const low = isLast ? 166.4 : Math.min(open, close) - 0.45;
      return {
        date: `11/23 ${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
        timestamp: 1795400000 + i * 3600,
        open,
        high,
        low,
        close,
        vwap: 154.0, // Deliberate distant VWAP to verify overlays never distort candlestick scale
        volume: 2_000_000 + i * 50_000,
      };
    });
    setCachedMarketHistory('NVDA', '1h', gapUpBars);

    const gapUpHtml = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({
          symbol: 'NVDA',
          name: 'NVIDIA Corp.',
          price: 168.6,
          prevClose: 148.0,
        }),
      })
    );
    const gapUpMetrics = extractPriceSvgMetrics(gapUpHtml);
    assert.equal(gapUpMetrics.wicks.length, gapUpBars.length);
    assert.equal(gapUpMetrics.bodies.length, gapUpBars.length);
    assert.ok(gapUpHtml.includes('data-pc-offscale="below"'), 'Large gap up should show off-scale PC below badge');
    assert.ok(gapUpHtml.includes('▼ PC 148.00'), 'Off-scale PC badge should display exact previous close');
    assert.ok(gapUpMetrics.currentPriceY !== null);
    assert.ok(gapUpMetrics.currentPriceY >= gapUpMetrics.plotTop && gapUpMetrics.currentPriceY <= gapUpMetrics.plotBottom);
    // Every single candlestick wick and body must stay strictly inside [plotTop, plotBottom] (never negative Y!)
    const minWickY = Math.min(...gapUpMetrics.wicks.map((w) => w.highY));
    const maxWickY = Math.max(...gapUpMetrics.wicks.map((w) => w.lowY));
    assert.ok(minWickY >= gapUpMetrics.plotTop, `Highest wick (${minWickY}) must be >= plotTop (${gapUpMetrics.plotTop})`);
    assert.ok(maxWickY <= gapUpMetrics.plotBottom, `Lowest wick (${maxWickY}) must be <= plotBottom (${gapUpMetrics.plotBottom})`);
    // Candlesticks must occupy a substantial readable vertical share (>65% of plot height), not be compressed by prevClose/VWAP
    const plotHeightPx = gapUpMetrics.plotBottom - gapUpMetrics.plotTop;
    assert.ok((maxWickY - minWickY) / plotHeightPx > 0.65, 'Candlesticks should fill >65% of plot height');

    // Scenario 2: Large gap DOWN from previous close (candles 140..143, prevClose 162)
    clearMarketHistoryCache();
    const gapDownBars: HistoryBar[] = Array.from({ length: 20 }, (_, i) => {
      const close = 141.5 + Math.cos(i / 3) * 0.9;
      return {
        date: `11/23 10:${String(i).padStart(2, '0')}`,
        timestamp: 1795400000 + i * 60,
        open: close + 0.2,
        high: close + 0.6,
        low: close - 0.6,
        close,
        volume: 500_000 + i * 10_000,
      };
    });
    setCachedMarketHistory('TSLA', '1h', gapDownBars);

    const gapDownHtml = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({
          symbol: 'TSLA',
          name: 'Tesla Inc.',
          price: 141.1,
          prevClose: 162.0,
        }),
      })
    );
    const gapDownMetrics = extractPriceSvgMetrics(gapDownHtml);
    assert.ok(gapDownHtml.includes('data-pc-offscale="above"'), 'Large gap down should show off-scale PC above badge');
    assert.ok(gapDownHtml.includes('▲ PC 162.00'));
    for (const wick of gapDownMetrics.wicks) {
      assert.ok(wick.highY >= gapDownMetrics.plotTop && wick.lowY <= gapDownMetrics.plotBottom);
    }
    assert.ok(
      gapDownMetrics.currentPriceY !== null &&
        gapDownMetrics.currentPriceY >= gapDownMetrics.plotTop &&
        gapDownMetrics.currentPriceY <= gapDownMetrics.plotBottom
    );

    // Scenario 3: Wide intraday high-to-low range + stale narrow zoomed customYRange (reproduces clipped multi-candle bug)
    clearMarketHistoryCache();
    const wideRallyBars: HistoryBar[] = Array.from({ length: 24 }, (_, i) => {
      const base = 128 + i * 1.65;
      const isLast = i === 23;
      const open = isLast ? 166.2 : base;
      const close = isLast ? 168.4 : base + 0.8;
      const high = isLast ? 169.5 : close + 0.9;
      const low = isLast ? 165.1 : open - 0.8;
      return {
        date: `11/23 ${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
        timestamp: 1795400000 + i * 3600,
        open,
        high,
        low,
        close,
        vwap: (open + close) / 2,
        volume: 2_000_000 + i * 50_000,
      };
    });
    setCachedMarketHistory('NVDA', '1h', wideRallyBars);

    const zoomedHtml = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({
          symbol: 'NVDA',
          name: 'NVIDIA Corp.',
          price: 163.84,
          prevClose: 161.2,
        }),
        // Stale narrow range from bug report (157.15..164.12) that previously pushed candles to negative Y and below plot
        initialCustomYRange: { min: 157.15, max: 164.12 },
      })
    );
    assert.equal(zoomedHtml.includes('Y-SCALE:'), true);
    const zoomedMetrics = extractPriceSvgMetrics(zoomedHtml);
    assert.equal(zoomedMetrics.wicks.length, wideRallyBars.length);
    for (const wick of zoomedMetrics.wicks) {
      assert.ok(wick.highY >= zoomedMetrics.plotTop, `Every wick highY (${wick.highY}) must stay >= plotTop`);
      assert.ok(wick.lowY <= zoomedMetrics.plotBottom, `Every wick lowY (${wick.lowY}) must stay <= plotBottom`);
      assert.ok(wick.highY > zoomedMetrics.clipTop && wick.lowY < zoomedMetrics.clipBottom);
    }
    for (const body of zoomedMetrics.bodies) {
      assert.ok(body.topY >= zoomedMetrics.plotTop && body.bottomY <= zoomedMetrics.plotBottom);
    }
    assert.ok(
      zoomedMetrics.currentPriceY !== null &&
        zoomedMetrics.currentPriceY >= zoomedMetrics.plotTop &&
        zoomedMetrics.currentPriceY <= zoomedMetrics.plotBottom
    );
  });
});

test('ChartWidget renders expanded 260px Price Chart, compact 75px Volume Study, increased Y-axis/plot horizontal gap, clip paths, and untouched RSI', () => {
  clearMarketHistoryCache();
  setCachedMarketHistory('AAPL', '1h', buildBars(24));

  const html = renderToStaticMarkup(
    React.createElement(ChartWidget, {
      stock: makeStock(),
    })
  );

  assert.equal(html.includes('Scroll or drag vertically to zoom price scale (Double-click or press 0 to reset)'), true);
  assert.equal(html.includes('Scroll or drag vertically to zoom volume scale (Double-click or press 0 to reset)'), true);
  assert.equal(html.includes('Scroll or drag vertically to zoom RSI scale (Double-click or press 0 to reset)'), true);
  assert.equal(html.includes('gp-price-plot-clip'), true);
  assert.equal(html.includes('gp-vol-plot-clip'), true);
  assert.equal(html.includes('gp-rsi-plot-clip'), true);
  assert.equal(html.includes(`height="${BASE_PRICE_HEIGHT}" viewBox="0 0 600 ${BASE_PRICE_HEIGHT}"`), true);
  assert.equal(html.includes('height="75" viewBox="0 0 600 75"'), true);
  assert.equal(html.includes('70 OB'), true);
  assert.equal(html.includes('30 OS'), true);

  // Visible Y-axis highlight boxes extend 6px farther above and below labels while keeping x="2" width="52"
  assert.equal(html.includes(`<rect x="2" y="6" width="52" height="${BASE_PRICE_HEIGHT - 12}"`), true);
  assert.equal(html.includes('<rect x="2" y="8" width="52" height="69"'), true);
  assert.equal(html.includes('<rect x="2" y="10" width="52" height="106"'), true);

  // Interactive Y-axis hit areas preserve 58px width and add 6px top & 6px bottom vertical padding
  assert.equal(html.includes(`<rect x="0" y="-6" width="58" height="${BASE_PRICE_HEIGHT + 12}"`), true);
  assert.equal(html.includes('<rect x="0" y="-6" width="58" height="87"'), true);
  assert.equal(html.includes('<rect x="0" y="-6" width="58" height="128"'), true);

  assert.equal(html.includes('<text x="46" y="26" text-anchor="end"'), true);
  assert.equal(html.includes('<text x="46" y="68" text-anchor="end"'), true);
  assert.equal(html.includes('<text x="52" y="26" text-anchor="end"'), false);
  assert.equal(html.includes('<text x="52" y="68" text-anchor="end"'), false);

  // Price Chart & Volume Study plot area starts at x="74" (20px gap from x="54" box) and preserves x2="568" right edge
  assert.equal(html.includes('<line x1="74" y1="18" x2="568" y2="18"'), true);
  assert.equal(html.includes('<line x1="74" y1="31.25" x2="568" y2="31.25"'), true);
  assert.equal(html.includes('<clipPath id="gp-price-plot-clip"><rect x="66" y="15" width="510"'), true);
  assert.equal(html.includes('<clipPath id="gp-vol-plot-clip"><rect x="66" y="19" width="510"'), true);
  assert.equal(html.includes('<rect x="74" y="18"'), true);
  assert.equal(html.includes('<rect x="74" y="20"'), true);

  // RSI Oscillator plot coordinates remain untouched (gridlines at x1="58", clip at x="50")
  assert.equal(html.includes('<line x1="58" y1="46.6" x2="568" y2="46.6"'), true);
  assert.equal(html.includes('<clipPath id="gp-rsi-plot-clip"><rect x="50" y="19" width="526"'), true);

  // Default 1.00x zoom level never displays Y-SCALE indicator
  assert.equal(html.includes('Y-SCALE:'), false);

  // Verify every AAPL candlestick and current-price indicator sits cleanly inside plot bounds
  const metrics = extractPriceSvgMetrics(html);
  assert.equal(metrics.wicks.length, 24);
  for (const wick of metrics.wicks) {
    assert.ok(wick.highY >= metrics.plotTop && wick.lowY <= metrics.plotBottom);
  }
  assert.ok(
    metrics.currentPriceY !== null &&
      metrics.currentPriceY >= metrics.plotTop &&
      metrics.currentPriceY <= metrics.plotBottom
  );
});

test('shouldShowYScaleIndicator hides 1.00x default/reset scale and displays zoomed in/out multipliers', () => {
  assert.equal(shouldShowYScaleIndicator(1), false);
  assert.equal(shouldShowYScaleIndicator(1.004), false);
  assert.equal(shouldShowYScaleIndicator(0.996), false);
  assert.equal(shouldShowYScaleIndicator(NaN), false);
  assert.equal(shouldShowYScaleIndicator(0), false);

  assert.equal(shouldShowYScaleIndicator(1.13), true);
  assert.equal(shouldShowYScaleIndicator(1.01), true);
  assert.equal(shouldShowYScaleIndicator(0.99), true);
  assert.equal(shouldShowYScaleIndicator(0.5), true);
  assert.equal(shouldShowYScaleIndicator(8.21), true);
});

test('yAxisZoom helpers return finite valid ranges when given NaN or Infinity inputs', () => {
  const autoNan = computeAutoPriceRange({
    candleLow: Number.NaN,
    candleHigh: Number.POSITIVE_INFINITY,
    currentPrice: Number.NaN,
    prevClose: Number.NaN,
  });
  assert.ok(Number.isFinite(autoNan.min) && Number.isFinite(autoNan.max) && autoNan.max > autoNan.min);

  const ensuredNan = ensureRangeIncludesFocusBand({
    range: { min: Number.NaN, max: Number.NaN },
    focusMin: 100,
    focusMax: 105,
    anchorValue: 102,
    minVisibleSpan: Number.NaN,
    maxVisibleSpan: Number.POSITIVE_INFINITY,
    boundMin: 0,
    edgePaddingRatio: Number.NaN,
  });
  assert.ok(Number.isFinite(ensuredNan.min) && Number.isFinite(ensuredNan.max) && ensuredNan.max > ensuredNan.min);
  assert.ok(100 >= ensuredNan.min && 105 <= ensuredNan.max);

  const scaledNan = computeScaledBoundedRange({
    baseMin: Number.NaN,
    baseMax: Number.POSITIVE_INFINITY,
    factor: Number.NaN,
    minVisibleSpan: Number.NaN,
    maxVisibleSpan: Number.NaN,
    anchorValue: 150,
    focusMin: 148,
    focusMax: 152,
    boundMin: 0,
  });
  assert.ok(Number.isFinite(scaledNan.min) && Number.isFinite(scaledNan.max) && scaledNan.max > scaledNan.min);
  assert.ok(148 >= scaledNan.min && 152 <= scaledNan.max);

  const volMax = computeScaledVolumeMax(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
  assert.ok(Number.isFinite(volMax) && volMax >= 1);

  const volLayout = computeVolumePanelLayout({
    visibleMaxVolume: Number.NaN,
    peakRenderedVolume: Number.POSITIVE_INFINITY,
    isZoomed: true,
  });
  assert.ok(Number.isFinite(volLayout.volHeight) && Number.isFinite(volLayout.topBoundaryVolume));
});

test('ChartWidget renders safely without NaN SVG attributes on malformed/partial OHLC bars and NaN customYRange', () => {
  withStudiesStorage(['rsi', 'volume', 'levels', 'vwap'], () => {
    clearMarketHistoryCache();
    const malformedBars: HistoryBar[] = [
      {
        date: '11/23 09:30',
        timestamp: 1795400000,
        open: Number.NaN,
        high: undefined as unknown as number,
        low: null as unknown as number,
        close: Number.NaN,
        volume: Number.NaN,
      },
      ...buildBars(18),
      {
        date: '11/23 11:00',
        timestamp: 1795405400,
        open: 108,
        high: Number.POSITIVE_INFINITY,
        low: 107,
        close: 108.5,
        volume: undefined as unknown as number,
      },
    ];
    setCachedMarketHistory('AAPL', '1h', malformedBars);

    const html = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({ price: 108.5, prevClose: Number.NaN }),
        initialCustomYRange: { min: Number.NaN, max: Number.NaN },
      })
    );

    assert.equal(html.includes('NaN'), false, 'Rendered ChartWidget SVG must never contain NaN');
    assert.equal(html.includes('Infinity'), false, 'Rendered ChartWidget SVG must never contain Infinity');
    assert.equal(html.includes('PRICE CHART'), true);
    const metrics = extractPriceSvgMetrics(html);
    assert.equal(metrics.wicks.length, 18, 'Valid candlesticks still render while malformed bars are safely skipped');
  });
});

test('ErrorBoundary renders fallback state cleanly when in error state', () => {
  const errState = ErrorBoundary.getDerivedStateFromError(new Error('Simulated chart crash'));
  assert.ok(errState.error instanceof Error);
  assert.equal(errState.error.message, 'Simulated chart crash');

  const normalMarkup = renderToStaticMarkup(
    React.createElement(
      ErrorBoundary,
      { compact: true, fallbackTitle: 'PRICE CHART RENDER ERROR' },
      React.createElement('div', null, 'Healthy Chart')
    )
  );
  assert.equal(normalMarkup.includes('Healthy Chart'), true);
});

test('Maximum zoom-out enforces >= 25% candlestick plot height across wheel, Y-axis drag, and keyboard shortcuts, and allows zooming back in', () => {
  // Exact scenario from bug report: candles ~$163..$167, prevClose $125.53, 260px chart (224px plot)
  const candleLow = 163.0;
  const candleHigh = 167.0;
  const currentPrice = 165.4;
  const distantPrevClose = 125.53;
  const plotHeightPx = BASE_PRICE_HEIGHT - 36; // 224px

  const auto = computeAutoPriceRange({
    candleLow,
    candleHigh,
    currentPrice,
    prevClose: distantPrevClose,
  });
  const limits = computePriceZoomLimits({
    candleLow,
    candleHigh,
    autoMinPrice: auto.min,
    autoMaxPrice: auto.max,
    plotHeightPx,
  });

  // 25% of 224px = 56px -> maxVisibleSpan = 4 / 0.25 = 16.0 (Y-SCALE floor ~0.32x, never 0.06x!)
  assert.equal(limits.minCandleHeightRatio, PRICE_MIN_CANDLE_HEIGHT_RATIO);
  assert.equal(limits.minCandleHeightPx, plotHeightPx * PRICE_MIN_CANDLE_HEIGHT_RATIO);
  assert.ok(Math.abs(limits.maxVisibleSpan - 16.0) < 1e-6);
  assert.ok(limits.minZoomFactor > 0.3 && limits.minZoomFactor < 0.35);

  const runZoomOutSequence = (factor: number, steps: number) => {
    let range = { min: auto.min, max: auto.max };
    for (let i = 0; i < steps; i++) {
      range = computeScaledBoundedRange({
        baseMin: range.min,
        baseMax: range.max,
        factor,
        minVisibleSpan: limits.minVisibleSpan,
        maxVisibleSpan: limits.maxVisibleSpan,
        anchorValue: currentPrice,
        focusMin: auto.coreLow,
        focusMax: auto.coreHigh,
        boundMin: 0,
        edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
      });
    }
    return range;
  };

  // 1. Mouse-wheel zoom-out (deltaY > 0 repeated 60 times)
  const wheelMaxOut = runZoomOutSequence(wheelDeltaToZoomFactor(120), 60);
  // 2. Y-axis drag zoom-out (large positive dy = 500px in one drag)
  const dragMaxOut = computeScaledBoundedRange({
    baseMin: auto.min,
    baseMax: auto.max,
    factor: dragDeltaToZoomFactor(500),
    minVisibleSpan: limits.minVisibleSpan,
    maxVisibleSpan: limits.maxVisibleSpan,
    anchorValue: currentPrice,
    focusMin: auto.coreLow,
    focusMax: auto.coreHigh,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  // 3. Keyboard '-' zoom-out (1 / 1.2 repeated 40 times)
  const keyMaxOut = runZoomOutSequence(1 / 1.2, 40);

  for (const r of [wheelMaxOut, dragMaxOut, keyMaxOut]) {
    const span = r.max - r.min;
    assert.ok(Math.abs(span - limits.maxVisibleSpan) < 1e-6, 'All zoom controls must stop at exact same maxVisibleSpan');
    const renderedCandleHeightPx = ((candleHigh - candleLow) / span) * plotHeightPx;
    assert.ok(renderedCandleHeightPx >= limits.minCandleHeightPx - 1e-6);
    assert.ok(renderedCandleHeightPx / plotHeightPx >= PRICE_MIN_CANDLE_HEIGHT_RATIO - 1e-6);
    // Distant prevClose ($125.53) stays outside range rather than flattening candles
    assert.ok(distantPrevClose < r.min);
  }

  // Zooming back in from max zoom-out narrows the span smoothly
  const zoomedBackIn = computeScaledBoundedRange({
    baseMin: wheelMaxOut.min,
    baseMax: wheelMaxOut.max,
    factor: 1.5,
    minVisibleSpan: limits.minVisibleSpan,
    maxVisibleSpan: limits.maxVisibleSpan,
    anchorValue: currentPrice,
    focusMin: auto.coreLow,
    focusMax: auto.coreHigh,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  assert.ok(zoomedBackIn.max - zoomedBackIn.min < wheelMaxOut.max - wheelMaxOut.min);
  assert.ok(candleLow >= zoomedBackIn.min && candleHigh <= zoomedBackIn.max);
});

test('Live updates and chart resizing enforce max zoom-out without unnecessarily resetting valid user zoom', () => {
  // Initial volatile session: candles 160..172 (span 12), plotHeight 224px -> maxVisibleSpan = 48
  const autoWide = computeAutoPriceRange({ candleLow: 160, candleHigh: 172, currentPrice: 166 });
  const wideLimits = computePriceZoomLimits({
    candleLow: 160,
    candleHigh: 172,
    autoMinPrice: autoWide.min,
    autoMaxPrice: autoWide.max,
    plotHeightPx: 224,
  });
  // User zooms out to span 30 (well within 48)
  const userZoomed = { min: 151, max: 181 };

  // Case A: Small live tick (currentPrice 166.5, same candle band) preserves user's exact zoom span (no reset)
  const afterSmallTick = ensureRangeIncludesFocusBand({
    range: userZoomed,
    focusMin: 160,
    focusMax: 172,
    anchorValue: 166.5,
    minVisibleSpan: wideLimits.minVisibleSpan,
    maxVisibleSpan: wideLimits.maxVisibleSpan,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  assert.ok(Math.abs((afterSmallTick.max - afterSmallTick.min) - 30) < 1e-6);

  // Case B: Live update rolls old bars off, narrowing candles to 164..168 (span 4 -> maxVisibleSpan = 16)
  const autoNarrow = computeAutoPriceRange({ candleLow: 164, candleHigh: 168, currentPrice: 166.5 });
  const narrowLimits = computePriceZoomLimits({
    candleLow: 164,
    candleHigh: 168,
    autoMinPrice: autoNarrow.min,
    autoMaxPrice: autoNarrow.max,
    plotHeightPx: 224,
  });
  const afterLiveNarrow = ensureRangeIncludesFocusBand({
    range: userZoomed,
    focusMin: autoNarrow.coreLow,
    focusMax: autoNarrow.coreHigh,
    anchorValue: 166.5,
    minVisibleSpan: narrowLimits.minVisibleSpan,
    maxVisibleSpan: narrowLimits.maxVisibleSpan,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  assert.ok(afterLiveNarrow.max - afterLiveNarrow.min <= narrowLimits.maxVisibleSpan + 1e-6);
  assert.ok(((168 - 164) / (afterLiveNarrow.max - afterLiveNarrow.min)) >= PRICE_MIN_CANDLE_HEIGHT_RATIO - 1e-6);

  // Case C: Chart resized to compact 120px plot height enforces pixel floor (40px -> 33.3% of 120px)
  const compactLimits = computePriceZoomLimits({
    candleLow: 164,
    candleHigh: 168,
    autoMinPrice: autoNarrow.min,
    autoMaxPrice: autoNarrow.max,
    plotHeightPx: 120,
  });
  assert.equal(compactLimits.minCandleHeightPx, PRICE_MIN_CANDLE_HEIGHT_PX);
  assert.ok(compactLimits.maxVisibleSpan < narrowLimits.maxVisibleSpan);
  const afterResize = ensureRangeIncludesFocusBand({
    range: afterLiveNarrow,
    focusMin: autoNarrow.coreLow,
    focusMax: autoNarrow.coreHigh,
    anchorValue: 166.5,
    minVisibleSpan: compactLimits.minVisibleSpan,
    maxVisibleSpan: compactLimits.maxVisibleSpan,
    boundMin: 0,
    edgePaddingRatio: PRICE_ZOOM_EDGE_PADDING_RATIO,
  });
  const compactCandlePx = ((168 - 164) / (afterResize.max - afterResize.min)) * 120;
  assert.ok(compactCandlePx >= PRICE_MIN_CANDLE_HEIGHT_PX - 1e-6);
});

test('resolveReferenceLevelLabels and computeOffscalePcBadgeLayout prevent HI/LO/PC overlaps in all edge cases', () => {
  // 1. Well-spaced HI, PC, LO -> zero displacement
  const wellSpaced = resolveReferenceLevelLabels({
    items: [
      { id: 'HI', lineY: 48, priority: 0 },
      { id: 'PC', lineY: 125, priority: 1 },
      { id: 'LO', lineY: 205, priority: 2 },
    ],
    minY: 22,
    maxY: 238,
  });
  assert.deepEqual(
    wellSpaced.map((l) => [l.id, l.labelY, l.displaced]),
    [
      ['HI', 48, false],
      ['PC', 125, false],
      ['LO', 205, false],
    ]
  );

  // 2. Very close HI and LO (only 3px apart) -> separated symmetrically by >= REFERENCE_LABEL_MIN_GAP_PX
  const closeHiLo = resolveReferenceLevelLabels({
    items: [
      { id: 'HI', lineY: 120, priority: 0 },
      { id: 'LO', lineY: 123, priority: 2 },
    ],
    minY: 22,
    maxY: 238,
  });
  assert.equal(closeHiLo[0].id, 'HI');
  assert.equal(closeHiLo[1].id, 'LO');
  assert.ok(closeHiLo[1].labelY - closeHiLo[0].labelY >= REFERENCE_LABEL_MIN_GAP_PX - 1e-6);
  assert.equal(closeHiLo[0].lineY, 120, 'Underlying reference line Y must remain unchanged');
  assert.equal(closeHiLo[1].lineY, 123, 'Underlying reference line Y must remain unchanged');

  // 3. Flat-price session where HI === PC === LO near top boundary -> all stay in bounds & non-overlapping
  const flatTop = resolveReferenceLevelLabels({
    items: [
      { id: 'HI', lineY: 20, priority: 0 },
      { id: 'PC', lineY: 20, priority: 1 },
      { id: 'LO', lineY: 20, priority: 2 },
    ],
    minY: 22,
    maxY: 238,
  });
  assert.deepEqual(flatTop.map((l) => l.id), ['HI', 'PC', 'LO']);
  assert.ok(flatTop[0].labelY >= 22);
  assert.ok(flatTop[2].labelY <= 238);
  assert.ok(flatTop[1].labelY - flatTop[0].labelY >= REFERENCE_LABEL_MIN_GAP_PX - 1e-6);
  assert.ok(flatTop[2].labelY - flatTop[1].labelY >= REFERENCE_LABEL_MIN_GAP_PX - 1e-6);

  // 4. Off-scale PC badge shifts to left edge if HI or LO sits in the same right-edge vertical band
  const clearRight = computeOffscalePcBadgeLayout({
    isAbove: false,
    labelText: '▼ PC 125.53',
    plotLeft: 74,
    plotRight: 568,
    plotTop: 18,
    plotBottom: 242,
    avoidRightEdgeYs: [60, 180],
  });
  assert.equal(clearRight.side, 'right');
  assert.ok(clearRight.x >= 74 && clearRight.x + clearRight.width <= 568);
  assert.ok(clearRight.y >= 18 && clearRight.y + clearRight.height <= 242);

  const crowdedBottomRight = computeOffscalePcBadgeLayout({
    isAbove: false,
    labelText: '▼ PC 125.53',
    plotLeft: 74,
    plotRight: 568,
    plotTop: 18,
    plotBottom: 242,
    avoidRightEdgeYs: [180, 232], // LO right at bottom edge
  });
  assert.equal(crowdedBottomRight.side, 'left');
  assert.ok(crowdedBottomRight.x >= 74 && crowdedBottomRight.x + crowdedBottomRight.width <= 568);
  assert.ok(crowdedBottomRight.y >= 18 && crowdedBottomRight.y + crowdedBottomRight.height <= 242);
});

test('ChartWidget clamps extreme zoom-out (bug-report $143..$230 / 0.06x case), keeps candles >= 25% tall, keeps HI/LO non-overlapping, and preserves off-scale PC badge', () => {
  withStudiesStorage(['rsi', 'volume', 'levels', 'vwap'], () => {
    clearMarketHistoryCache();
    // Reproduce bug report: candles clustered at $163..$167, prevClose $125.53
    const clusteredBars: HistoryBar[] = Array.from({ length: 24 }, (_, i) => {
      const base = 164.0 + Math.sin(i / 2.5) * 1.2;
      const open = base;
      const close = base + (i % 2 === 0 ? 0.4 : -0.35);
      const high = i === 12 ? 167.0 : Math.max(open, close) + 0.35;
      const low = i === 4 ? 163.0 : Math.min(open, close) - 0.35;
      return {
        date: `11/23 10:${String(i).padStart(2, '0')}`,
        timestamp: 1795400000 + i * 60,
        open,
        high,
        low,
        close,
        volume: 800_000 + i * 20_000,
      };
    });
    setCachedMarketHistory('NVDA', '1h', clusteredBars);

    // Supply the exact overly zoomed-out range from the bug report ($143.34..$229.96 -> 0.06x)
    const html = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({
          symbol: 'NVDA',
          name: 'NVIDIA Corp.',
          price: 165.4,
          prevClose: 125.53,
        }),
        initialCustomYRange: { min: 143.34, max: 229.96 },
      })
    );

    const metrics = extractPriceSvgMetrics(html);
    const plotHeightPx = metrics.plotBottom - metrics.plotTop;
    const minWickY = Math.min(...metrics.wicks.map((w) => w.highY));
    const maxWickY = Math.max(...metrics.wicks.map((w) => w.lowY));
    const candlePixelHeight = maxWickY - minWickY;

    // Candlesticks must occupy >= 25% of plot height (~56px), never collapsing to ~10px
    assert.ok(
      candlePixelHeight / plotHeightPx >= PRICE_MIN_CANDLE_HEIGHT_RATIO - 0.005,
      `Candlestick height (${candlePixelHeight.toFixed(1)}px / ${plotHeightPx}px) must be >= 25% of plot height`
    );

    // Y-SCALE must NOT collapse to 0.06x
    const yScaleMatch = html.match(/Y-SCALE:\s*([0-9.]+)×/);
    assert.ok(yScaleMatch, 'Expected Y-SCALE indicator when zoomed out');
    const yScaleVal = Number(yScaleMatch[1]);
    assert.ok(yScaleVal >= 0.3, `Y-SCALE (${yScaleVal}x) must be clamped well above 0.06x`);

    // HI, LO, and off-scale PC badge all visible and non-overlapping
    const hiLabelMatch = html.match(/data-level-label="HI"[^>]*y="([0-9.-]+)"/);
    const loLabelMatch = html.match(/data-level-label="LO"[^>]*y="([0-9.-]+)"/);
    assert.ok(hiLabelMatch && loLabelMatch, 'Both HI and LO labels must render');
    const hiLabelY = Number(hiLabelMatch[1]);
    const loLabelY = Number(loLabelMatch[1]);
    assert.ok(loLabelY - hiLabelY >= REFERENCE_LABEL_MIN_GAP_PX - 0.1, 'HI and LO labels must not overlap');
    assert.ok(html.includes('data-pc-offscale="below"'), 'Distant PC $125.53 must render as off-scale below badge');
    assert.ok(html.includes('▼ PC 125.53'));

    // Also test flat/nearly-flat candles where HI and LO are nearly identical: labels still do not overlap!
    clearMarketHistoryCache();
    const flatBars: HistoryBar[] = Array.from({ length: 12 }, (_, i) => ({
      date: `11/23 11:${String(i).padStart(2, '0')}`,
      timestamp: 1795403600 + i * 60,
      open: 165.0,
      high: 165.01,
      low: 165.0,
      close: 165.0,
      volume: 100_000,
    }));
    setCachedMarketHistory('NVDA', '1h', flatBars);

    const flatHtml = renderToStaticMarkup(
      React.createElement(ChartWidget, {
        stock: makeStock({
          symbol: 'NVDA',
          name: 'NVIDIA Corp.',
          price: 165.0,
          prevClose: 165.0,
        }),
      })
    );
    const flatHi = flatHtml.match(/data-level-label="HI"[^>]*y="([0-9.-]+)"/);
    const flatPc = flatHtml.match(/data-level-label="PC"[^>]*y="([0-9.-]+)"/);
    const flatLo = flatHtml.match(/data-level-label="LO"[^>]*y="([0-9.-]+)"/);
    assert.ok(flatHi && flatPc && flatLo, 'HI, PC, and LO labels must all render on flat session');
    assert.ok(Number(flatPc[1]) - Number(flatHi[1]) >= REFERENCE_LABEL_MIN_GAP_PX - 0.1);
    assert.ok(Number(flatLo[1]) - Number(flatPc[1]) >= REFERENCE_LABEL_MIN_GAP_PX - 0.1);
  });
});








