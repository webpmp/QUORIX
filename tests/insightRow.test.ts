import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsightRow } from '../src/components/InsightRow.tsx';
import type { CorrelationInsight } from '../src/utils/correlation.ts';

test('InsightRow: renders scenario (a) one insight with a short metric, asserting grid layout classes', () => {
  const shortItem: CorrelationInsight = {
    id: 'short-test',
    category: 'WEAKENING_RELATIONSHIP',
    title: 'Weakening Relationship',
    summary: 'Short summary here.',
    metricLabel: 'Δ -0.16 (30D roll)',
    tone: 'warning',
  };

  const html = renderToStaticMarkup(
    React.createElement(InsightRow, { item: shortItem })
  );

  // Assert row has the 2-column grid on sm+ with gap-6 (24px) and justify-start
  assert.ok(
    html.includes('sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6'),
    'Row must have sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6'
  );
  // Assert mobile retains flex flex-col gap-2
  assert.ok(
    html.includes('flex flex-col gap-2'),
    'Row must have flex flex-col gap-2 on mobile'
  );

  // Assert text column has min-w-0 space-y-0.5, and no longer has flex-1 max-w-3xl
  assert.ok(
    html.includes('space-y-0.5 min-w-0'),
    'Text column must include space-y-0.5 min-w-0'
  );
  assert.ok(
    !html.includes('flex-1 max-w-3xl'),
    'Text column should not have flex-1 max-w-3xl since the grid column caps it'
  );

  // Assert metric column has sm:text-left, whitespace-nowrap shrink-0 tabular-nums
  assert.ok(
    html.includes('sm:text-left'),
    'Metric column must include sm:text-left'
  );
  assert.ok(
    html.includes('whitespace-nowrap shrink-0'),
    'Metric column must retain whitespace-nowrap shrink-0'
  );
  assert.ok(html.includes('Δ -0.16 (30D roll)'));
});

test('InsightRow: renders scenario (b) two insights with two-ticker metrics and ticker buttons', () => {
  const item1: CorrelationInsight = {
    id: 'strong-pos-AAPL-MSFT',
    category: 'STRONG_RELATIONSHIP',
    title: 'Strong Relationship',
    summary: 'AAPL and MSFT exhibit a high correlation.',
    metricLabel: 'AAPL / MSFT: +0.78',
    metricTickers: ['AAPL', 'MSFT'],
    metricValue: '+0.78',
    tone: 'positive',
  };

  const item2: CorrelationInsight = {
    id: 'diversify-PG',
    category: 'POTENTIAL_DIVERSIFICATION',
    title: 'Lower Historical Co-Movement',
    summary: 'PG exhibits the lowest average historical correlation with the other securities.',
    metricLabel: 'PG avg r: -0.13',
    metricTickers: ['PG'],
    metricValue: 'avg r: -0.13',
    tone: 'neutral',
  };

  const html1 = renderToStaticMarkup(
    React.createElement(InsightRow, { item: item1, onPopulateTicker: () => {} })
  );
  const html2 = renderToStaticMarkup(
    React.createElement(InsightRow, { item: item2, onPopulateTicker: () => {} })
  );

  // Verify item 1
  assert.ok(html1.includes('sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6'));
  assert.ok(html1.includes('sm:text-left'));
  assert.ok(html1.includes('aria-label="Populate ticker input with AAPL"'));
  assert.ok(html1.includes('aria-label="Populate ticker input with MSFT"'));
  assert.ok(html1.includes('+0.78'));

  // Verify item 2
  assert.ok(html2.includes('sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6'));
  assert.ok(html2.includes('sm:text-left'));
  assert.ok(html2.includes('aria-label="Populate ticker input with PG"'));
  assert.ok(html2.includes('avg r: -0.13'));
});

test('InsightRow: renders scenario (c) one insight with long text, asserting grid constraints', () => {
  const longItem: CorrelationInsight = {
    id: 'long-test',
    category: 'RELATIONSHIP_SHIFT',
    title: 'Relationship Shift',
    summary:
      'The 60-session rolling correlation between VERYLONGTICKERA and VERYLONGTICKERB reversed sign from +0.65 (2026-01-15) to -0.42 (2026-11-20), indicating a notable regime change in co-movement across multiple quarters of macroeconomic shift and central bank policy pivot.',
    metricLabel: '+0.65 → -0.42',
    tone: 'warning',
  };

  const html = renderToStaticMarkup(
    React.createElement(InsightRow, { item: longItem })
  );

  assert.ok(
    html.includes('sm:grid sm:grid-cols-[minmax(0,48rem)_9.5rem] sm:items-start sm:justify-start sm:gap-6'),
    'Long text item must still use grid layout'
  );
  assert.ok(
    html.includes('space-y-0.5 min-w-0'),
    'Long text item must still have space-y-0.5 min-w-0'
  );
  assert.ok(
    html.includes('sm:text-left'),
    'Metric column on long text item must still have sm:text-left'
  );
  assert.ok(html.includes('+0.65 → -0.42'));
});
