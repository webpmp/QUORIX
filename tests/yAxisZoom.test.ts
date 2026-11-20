import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartWidget from '../src/components/ChartWidget.tsx';
import {
  clearMarketHistoryCache,
  setCachedMarketHistory,
  type HistoryBar,
} from '../src/utils/marketHistoryCache.ts';
import {
  BASE_VOL_ADJ_HEIGHT,
  BASE_VOL_HEIGHT,
  MAX_VOL_EXPANSION_PX,
  RSI_MIN_VISIBLE_SPAN,
  RSI_NATURAL_MAX,
  RSI_NATURAL_MIN,
  VOL_PADDING_BOTTOM,
  VOL_PADDING_TOP,
  computeScaledBoundedRange,
  computeScaledRsiRange,
  computeScaledVolumeMax,
  computeVolumePanelLayout,
  dragDeltaToZoomFactor,
  getVolumeZoomLimits,
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

test('ChartWidget renders compact 75px Volume Study by default, increased Y-axis/plot horizontal gap in Price and Volume, clip paths, and untouched RSI', () => {
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
  assert.equal(html.includes('height="75" viewBox="0 0 600 75"'), true);
  assert.equal(html.includes('70 OB'), true);
  assert.equal(html.includes('30 OS'), true);

  // Visible Y-axis highlight boxes extend 6px farther above and below labels while keeping x="2" width="52"
  assert.equal(html.includes('<rect x="2" y="6" width="52" height="172"'), true);
  assert.equal(html.includes('<rect x="2" y="8" width="52" height="69"'), true);
  assert.equal(html.includes('<rect x="2" y="10" width="52" height="106"'), true);

  // Interactive Y-axis hit areas preserve 58px width and add 6px top & 6px bottom vertical padding
  assert.equal(html.includes('<rect x="0" y="-6" width="58" height="196"'), true);
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





