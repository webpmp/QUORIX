import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewsCard } from '../src/components/NewsCard';
import { NewsItem } from '../src/types';

console.log('--- Testing NewsCard Component ---');

const baseItem: NewsItem = {
  id: 'news-1',
  title: 'Apple Unveils Next-Gen Silicon with Breakthrough Architecture - Bloomberg',
  source: 'Bloomberg News',
  time: '14:30',
  publishedAt: '2026-11-24T14:30:00Z',
  content: 'Apple announced its new chip design delivering unprecedented performance per watt across laptops and desktops.',
  url: 'https://bloomberg.com/news/articles/apple-chip',
  sentiment: 'positive',
  relatedTickers: ['AAPL', 'TSM', 'NVDA'],
};

// (a) with showTickers true (the default) and tickers present, the footer and chips render
const defaultHtml = renderToStaticMarkup(
  React.createElement(NewsCard, {
    item: baseItem,
    relatedTickers: ['AAPL', 'TSM', 'NVDA'],
  })
);
assert.ok(defaultHtml.includes('border-t border-[#151515]'), 'Expected border-t divider when showTickers=true');
assert.ok(defaultHtml.includes('AAPL') && defaultHtml.includes('TSM') && defaultHtml.includes('NVDA'), 'Expected ticker chips to render');
assert.ok(defaultHtml.includes('text-[#3498db]'), 'Expected ticker chip styling class');
console.log('✓ (a) Default showTickers=true renders footer and ticker chips');

// (b) with showTickers false, there is no footer, no chips, and no border-t divider
const gpNewsHtml = renderToStaticMarkup(
  React.createElement(NewsCard, {
    item: baseItem,
    showTickers: false,
    relatedTickers: ['AAPL', 'TSM', 'NVDA'],
  })
);
assert.ok(!gpNewsHtml.includes('border-t'), 'Expected NO border-t divider when showTickers=false');
assert.ok(!gpNewsHtml.includes('text-[#3498db]'), 'Expected NO ticker chip classes when showTickers=false');
assert.ok(!gpNewsHtml.includes('AAPL'), 'Expected NO ticker chips in footer when showTickers=false');
console.log('✓ (b) showTickers=false excludes footer, chips, and border-t divider even with related tickers present');

// (c) an item with no summary renders no empty <p>
const noSummaryItem: NewsItem = {
  ...baseItem,
  content: '',
};
const noSummaryHtml = renderToStaticMarkup(
  React.createElement(NewsCard, {
    item: noSummaryItem,
    showTickers: false,
  })
);
assert.ok(!noSummaryHtml.includes('<p'), 'Expected no <p> tag when content is empty');
assert.ok(noSummaryHtml.includes('Apple Unveils Next-Gen Silicon'), 'Expected title still present');
console.log('✓ (c) Item with no summary renders no <p> element');

// Also check duplicate headline as summary is hidden
const dupSummaryItem: NewsItem = {
  ...baseItem,
  content: 'Apple Unveils Next-Gen Silicon with Breakthrough Architecture',
};
const dupSummaryHtml = renderToStaticMarkup(
  React.createElement(NewsCard, {
    item: dupSummaryItem,
    showTickers: false,
  })
);
assert.ok(!dupSummaryHtml.includes('<p'), 'Expected duplicate summary matching headline to be suppressed');
console.log('✓ Duplicate headline summary suppressed cleanly');

// (d) the NEWS HUB classes are present (bg-black, border-[#151515], p-4, text-white, line-clamp-3)
assert.ok(gpNewsHtml.includes('bg-black'), 'Expected bg-black container');
assert.ok(gpNewsHtml.includes('border-[#151515]'), 'Expected border-[#151515]');
assert.ok(gpNewsHtml.includes('p-4'), 'Expected p-4 padding');
assert.ok(gpNewsHtml.includes('text-white'), 'Expected text-white headline');
assert.ok(gpNewsHtml.includes('line-clamp-3'), 'Expected line-clamp-3 for summary');
assert.ok(gpNewsHtml.includes('md:text-sm'), 'Expected md:text-sm on summary');
console.log('✓ (d) NEWS HUB card styles and classes are present on the GP card');

// Verify spacing: when showTickers is false, mb-3 is omitted from the summary paragraph so bottom margin is flush
assert.ok(!gpNewsHtml.includes('mb-3'), 'Expected mb-3 to be omitted from summary when showTickers=false');
assert.ok(defaultHtml.includes('mb-3'), 'Expected mb-3 to be present on summary when footer is rendered');
console.log('✓ Spacing: mb-3 cleanly toggled based on footer presence');

console.log('All NewsCard unit tests passed successfully!');
