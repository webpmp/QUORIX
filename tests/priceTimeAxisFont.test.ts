import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartWidget from '../src/components/ChartWidget';
import { StockData } from '../src/types';
import { clearMarketHistoryCache, setCachedMarketHistory } from '../src/utils/marketHistoryCache';

const historyBars = Array.from({ length: 30 }, (_, i) => ({
  date: `11/${i + 1}`,
  timestamp: 1732550400 + i * 3600,
  open: 240 + (i % 5),
  high: 242 + (i % 5),
  low: 239 + (i % 5),
  close: 241 + (i % 5),
  volume: 1000000 + i * 10000,
}));

const mockStock: StockData = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 242.5,
  change: 1.25,
  changePercent: 0.52,
  prevClose: 241.25,
  open: 241.5,
  high: 243.0,
  low: 240.8,
  volume: 52000000,
  marketCap: '$3.7T',
  peRatio: 35.2,
  beta: 1.1,
  history: historyBars,
};

test('Price History chart renders bottom axis time labels with 12px font size', () => {
  clearMarketHistoryCache();
  setCachedMarketHistory('AAPL', '1h', historyBars);

  const html = renderToStaticMarkup(
    React.createElement(ChartWidget, {
      stock: mockStock,
      chartWidth: 800,
      activeStudies: [],
      onToggleStudy: () => {},
      onResetStudies: () => {},
    })
  );

  // Assert font-size="12" is present for the monospace bold bottom-axis text
  assert.ok(
    html.includes('fontSize="12"') || html.includes('font-size="12"'),
    'Expected SVG text to use font-size="12"'
  );
  // Ensure font-size="9" is no longer used for the bottom-axis time ticks
  assert.ok(
    !html.includes('font-size="9" font-family="monospace" font-weight="bold"') &&
      !html.includes('fontSize="9" fontFamily="monospace" fontWeight="bold"'),
    'Bottom-axis text should no longer use font-size="9"'
  );
});
