import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartWidget from '../src/components/ChartWidget.tsx';
import {
  HISTORY_CACHE_FRESH_MS,
  clearMarketHistoryCache,
  deriveChartDataPhase,
  getCachedMarketHistory,
  getHistoryCacheKey,
  isCachedHistoryFresh,
  setCachedMarketHistory,
  type HistoryBar,
} from '../src/utils/marketHistoryCache.ts';
import type { StockData } from '../src/types.ts';

function sampleBars(close = 352.45): HistoryBar[] {
  return [
    {
      date: '11/18 15:25',
      timestamp: 1795033500,
      open: close - 2,
      high: close,
      low: close - 2.5,
      close: close - 0.5,
      volume: 100000,
    },
    {
      date: '11/18 15:30',
      timestamp: 1795033800,
      open: close - 1,
      high: close + 0.5,
      low: close - 1.5,
      close,
      volume: 120000,
    },
  ];
}

function makeStock(overrides: Partial<StockData> = {}): StockData {
  return {
    symbol: 'COST',
    name: 'COST',
    price: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    open: 0,
    prevClose: 0,
    volume: 0,
    marketCap: '—',
    peRatio: 0,
    beta: 0,
    history: [],
    ...overrides,
  };
}

test('search for AAPL or previously viewed ticker uses cached history immediately as ready', () => {
  clearMarketHistoryCache();

  const now = 1_700_000_000_000;
  setCachedMarketHistory('AAPL', '1h', sampleBars(352.45), now);

  const cached = getCachedMarketHistory('aapl', '1h');
  assert.ok(cached);
  assert.equal(cached.bars.length, 2);
  assert.equal(isCachedHistoryFresh(cached, now + 5_000), true);
  assert.equal(isCachedHistoryFresh(cached, now + HISTORY_CACHE_FRESH_MS + 1), false);

  // Stale background refresh keeps cached bars visible in 'ready' phase
  const phase = deriveChartDataPhase({
    hasStock: true,
    hasUsableBars: cached.bars.length > 0,
    hasResolvedHistoryAttempt: true,
    isHistoryFetching: true,
  });
  assert.equal(phase, 'ready');
});

test('uncached valid ticker starts in pending phase and only reaches unavailable after empty resolution', () => {
  clearMarketHistoryCache();

  // Frame 1 before history finishes: must be 'pending' (never flash 'unavailable')
  assert.equal(
    deriveChartDataPhase({
      hasStock: true,
      hasUsableBars: false,
      hasResolvedHistoryAttempt: false,
      isHistoryFetching: false,
    }),
    'pending'
  );

  // While history fetch is in-flight: remains 'pending'
  assert.equal(
    deriveChartDataPhase({
      hasStock: true,
      hasUsableBars: false,
      hasResolvedHistoryAttempt: false,
      isHistoryFetching: true,
    }),
    'pending'
  );

  // As soon as history bars arrive: transitions directly to 'ready'
  assert.equal(
    deriveChartDataPhase({
      hasStock: true,
      hasUsableBars: true,
      hasResolvedHistoryAttempt: true,
      isHistoryFetching: false,
    }),
    'ready'
  );
});

test('valid ticker with confirmed empty history (e.g. ANT) resolves to unavailable', () => {
  clearMarketHistoryCache();

  setCachedMarketHistory('ANT', '1h', []);
  assert.equal(getCachedMarketHistory('ANT', '1h'), null);

  assert.equal(
    deriveChartDataPhase({
      hasStock: true,
      hasUsableBars: false,
      hasResolvedHistoryAttempt: true,
      isHistoryFetching: false,
    }),
    'unavailable'
  );
});

test('cache keys isolate intervals and rapid ticker switches never mix symbols', () => {
  clearMarketHistoryCache();

  setCachedMarketHistory('PLTR', '1h', sampleBars(156.67), 1000);
  setCachedMarketHistory('COST', '1h', sampleBars(1096.62), 1000);
  setCachedMarketHistory('PLTR', '1D', sampleBars(157.1), 1000);

  assert.equal(getHistoryCacheKey(' pltr ', '1h'), 'PLTR:1h');
  assert.equal(getCachedMarketHistory('PLTR', '1h')?.bars[1].close, 156.67);
  assert.equal(getCachedMarketHistory('COST', '1h')?.bars[1].close, 1096.62);
  assert.equal(getCachedMarketHistory('PLTR', '1D')?.bars[1].close, 157.1);
  assert.equal(getCachedMarketHistory('NVDA', '1h'), null);
});

test('ChartWidget renders Graph Price layout immediately on uncached search with zero loading screen', () => {
  clearMarketHistoryCache();

  const html = renderToStaticMarkup(
    React.createElement(ChartWidget, {
      stock: makeStock({ symbol: 'COST', name: 'COST' }),
    })
  );

  assert.equal(html.includes('LOADING LIVE MARKET DATA FOR'), false);
  assert.equal(html.includes('NO HISTORICAL DATA AVAILABLE FOR'), false);
  assert.equal(html.includes('COST'), true);
  assert.equal(html.includes('PRICE CHART'), true);
  assert.equal(html.includes('CANDLES'), true);
  assert.equal(html.includes('LAST PRICE'), true);
  assert.equal(html.includes('RANGE: 1H (LAST 60 MIN)'), true);
  assert.equal(html.includes('$0.00'), false);
});

test('ChartWidget renders full SVG chart immediately when ticker history is cached', () => {
  clearMarketHistoryCache();
  setCachedMarketHistory('AAPL', '1h', sampleBars(234.56));

  const html = renderToStaticMarkup(
    React.createElement(ChartWidget, {
      stock: makeStock({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        price: 234.56,
        open: 232.5,
        high: 235.1,
        low: 232.0,
        volume: 1200000,
      }),
    })
  );

  assert.equal(html.includes('LOADING LIVE MARKET DATA FOR'), false);
  assert.equal(html.includes('NO HISTORICAL DATA AVAILABLE FOR'), false);
  assert.equal(html.includes('Apple Inc.'), true);
  assert.equal(html.includes('$234.56'), true);
  assert.equal(html.includes('<svg'), true);
});
