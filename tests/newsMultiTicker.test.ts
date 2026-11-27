import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCommandLineInput } from '../src/utils/commandParser';
import Workspace from '../src/components/Workspace';
import { scoreArticleForTicker } from '../src/utils/gpNewsRelevance';

test('1. Command Parser parses single and multiple ticker NEWS commands', () => {
  // Bare command
  assert.deepStrictEqual(parseCommandLineInput('NEWS'), {
    type: 'SCREEN',
    screen: 'NEWS',
  });

  // Single ticker
  assert.deepStrictEqual(parseCommandLineInput('NEWS BTC'), {
    type: 'TICKER_SCREEN',
    screen: 'NEWS',
    ticker: 'BTC',
  });

  // Two tickers
  assert.deepStrictEqual(parseCommandLineInput('NEWS BTC NVDA'), {
    type: 'TICKER_SCREEN',
    screen: 'NEWS',
    ticker: 'BTC',
    tickers: ['BTC', 'NVDA'],
  });

  // Three tickers
  assert.deepStrictEqual(parseCommandLineInput('NEWS BTC NVDA AMD'), {
    type: 'TICKER_SCREEN',
    screen: 'NEWS',
    ticker: 'BTC',
    tickers: ['BTC', 'NVDA', 'AMD'],
  });

  // Case insensitivity & deduplication
  assert.deepStrictEqual(parseCommandLineInput('news btc nvda btc'), {
    type: 'TICKER_SCREEN',
    screen: 'NEWS',
    ticker: 'BTC',
    tickers: ['BTC', 'NVDA'],
  });

  // NEWS HUB alias prefix
  assert.deepStrictEqual(parseCommandLineInput('NEWS HUB BTC NVDA'), {
    type: 'TICKER_SCREEN',
    screen: 'NEWS',
    ticker: 'BTC',
    tickers: ['BTC', 'NVDA'],
  });
});

test('2. Multi-ticker OR filtering logic matches any selected ticker without duplicates', () => {
  const stockNames: Record<string, string> = {
    BTC: 'Bitcoin',
    NVDA: 'NVIDIA Corporation',
    AMD: 'Advanced Micro Devices',
    AAPL: 'Apple Inc.',
  };

  const articles = [
    { id: '1', title: 'BTC surges past 100k', relatedTickers: ['BTC'], content: 'Crypto markets rally' },
    { id: '2', title: 'NVDA reports record earnings', relatedTickers: ['NVDA'], content: 'AI demand surges' },
    { id: '3', title: 'AMD announces new GPU to compete with NVDA', relatedTickers: ['AMD', 'NVDA'], content: 'Chip competition' },
    { id: '4', title: 'AAPL launches new hardware', relatedTickers: ['AAPL'], content: 'Consumer tech' },
  ];

  const filterTickers = (activeTickers: string[]) => {
    const scored: Array<{ item: any; bestTier: 1 | 2 }> = [];
    for (const item of articles) {
      let bestTier: 1 | 2 | null = null;
      for (const ticker of activeTickers) {
        const companyName = stockNames[ticker];
        const tier = scoreArticleForTicker(item, ticker, companyName);
        if (tier === 1) {
          bestTier = 1;
          break;
        } else if (tier === 2) {
          bestTier = 2;
        }
      }
      if (bestTier !== null) {
        scored.push({ item, bestTier });
      }
    }
    return scored.map((s) => s.item);
  };

  // NEWS BTC -> article 1
  const btcOnly = filterTickers(['BTC']);
  assert.deepStrictEqual(btcOnly.map(a => a.id), ['1']);

  // NEWS BTC NVDA -> articles 1, 2, 3 (article 3 matches both NVDA and AMD, should appear once)
  const btcNvda = filterTickers(['BTC', 'NVDA']);
  assert.deepStrictEqual(btcNvda.map(a => a.id), ['1', '2', '3']);

  // NEWS BTC NVDA AMD -> articles 1, 2, 3 (no duplicate for article 3)
  const btcNvdaAmd = filterTickers(['BTC', 'NVDA', 'AMD']);
  assert.deepStrictEqual(btcNvdaAmd.map(a => a.id), ['1', '2', '3']);

  // NEWS AAPL -> article 4
  const aaplOnly = filterTickers(['AAPL']);
  assert.deepStrictEqual(aaplOnly.map(a => a.id), ['4']);
});

test('3. Workspace renders removable ticker chips and removes FILTERED badge & SHOW ALL', () => {
  const html = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'NEWS',
      newsHubFilterTickers: ['BTC', 'NVDA', 'AMD'],
      stocks: {},
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );

  // Removable chips for each ticker
  assert.ok(html.includes('>BTC<'), 'Chip for BTC must be rendered');
  assert.ok(html.includes('>NVDA<'), 'Chip for NVDA must be rendered');
  assert.ok(html.includes('>AMD<'), 'Chip for AMD must be rendered');
  assert.ok(html.includes('aria-label="Remove BTC filter"'), 'X button for BTC must exist');
  assert.ok(html.includes('aria-label="Remove NVDA filter"'), 'X button for NVDA must exist');
  assert.ok(html.includes('aria-label="Remove AMD filter"'), 'X button for AMD must exist');

  // Must NOT include FILTERED badge or SHOW ALL button
  assert.ok(!html.includes('FILTERED:'), 'FILTERED badge must be removed');
  assert.ok(!html.includes('SHOW ALL'), 'SHOW ALL button must be removed');
});
