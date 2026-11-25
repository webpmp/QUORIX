import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseMetricPair,
  isDividerLine,
  isSectionHeading,
  parseAnrTable,
  sanitizeHeadlineUrl,
  StructuredDesReport,
} from '../src/utils/reportFormatting';

test('parseMetricPair parses single and pipe-separated key-value pairs', () => {
  const line1 = '  LAST PRICE   : $355.58 (+1.23 / +0.35%)';
  const res1 = parseMetricPair(line1);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].label, 'LAST PRICE');
  assert.equal(res1[0].value, '$355.58 (+1.23 / +0.35%)');

  const line2 = '  MARKET CAP   : 5.17T    |  BETA         : 1.09';
  const res2 = parseMetricPair(line2);
  assert.equal(res2.length, 2);
  assert.equal(res2[0].label, 'MARKET CAP');
  assert.equal(res2[0].value, '5.17T');
  assert.equal(res2[1].label, 'BETA');
  assert.equal(res2[1].value, '1.09');

  const line3 = '  CONSENSUS    : BUY (45 analysts) | MEAN TARGET: $260.00';
  const res3 = parseMetricPair(line3);
  assert.equal(res3.length, 2);
  assert.equal(res3[0].label, 'CONSENSUS');
  assert.equal(res3[0].value, 'BUY (45 analysts)');
  assert.equal(res3[1].label, 'MEAN TARGET');
  assert.equal(res3[1].value, '$260.00');
});

test('isDividerLine detects divider lines and ignores standard content', () => {
  assert.equal(isDividerLine('========================================================================'), true);
  assert.equal(isDividerLine('====='), true);
  assert.equal(isDividerLine('MARKET & VALUATION METRICS'), false);
  assert.equal(isDividerLine(''), false);
});

test('isSectionHeading detects known headings in DES and ANR reports', () => {
  assert.equal(isSectionHeading('MARKET & VALUATION METRICS'), true);
  assert.equal(isSectionHeading('FINANCIAL HEALTH & CASH FLOW'), true);
  assert.equal(isSectionHeading('BUSINESS OVERVIEW'), true);
  assert.equal(isSectionHeading('KEY EXECUTIVES'), true);
  assert.equal(isSectionHeading('RECENT HEADLINES (AAPL)'), true);
  assert.equal(isSectionHeading('RATING BREAKDOWN (BY PERIOD)'), true);
  assert.equal(isSectionHeading('KEY FUNDAMENTAL DRIVERS'), true);
  assert.equal(isSectionHeading('SOMETHING ELSE'), false);
});

test('parseAnrTable extracts breakdown rows and handles dashes and empty lines', () => {
  const sampleLines = [
    'RECOMMENDATION : BUY  |  ANALYST COUNT: 45',
    '',
    'RATING BREAKDOWN (BY PERIOD)',
    '  PERIOD   STRONG BUY   BUY   HOLD   SELL   STRONG SELL',
    '  ------   ----------   ---   ----   ----   -----------',
    '  0m               15    22      8      1             0',
    '  -1m              14    23      8      1             0',
    '  -2m              14    22      9      1             0',
    '',
    'KEY FUNDAMENTAL DRIVERS',
    '  • Revenue Growth (YoY) : 8.5%',
  ];

  const { tableRows, remainingLines } = parseAnrTable(sampleLines);
  assert.equal(tableRows.length, 3);
  assert.deepEqual(tableRows[0], {
    period: '0m',
    strongBuy: '15',
    buy: '22',
    hold: '8',
    sell: '1',
    strongSell: '0',
  });
  assert.deepEqual(tableRows[1], {
    period: '-1m',
    strongBuy: '14',
    buy: '23',
    hold: '8',
    sell: '1',
    strongSell: '0',
  });

  // Table header, separator, and data rows are removed from remainingLines (only the section heading remains in remainingLines)
  assert.equal(remainingLines.some((l) => l.includes('STRONG BUY')), false);
  assert.equal(remainingLines.some((l) => l.includes('KEY FUNDAMENTAL DRIVERS')), true);
});

test('parseAnrTable gracefully handles missing or malformed tables', () => {
  const sampleLines = ['NO TABLE HERE', 'JUST SOME TEXT'];
  const { tableRows, remainingLines } = parseAnrTable(sampleLines);
  assert.equal(tableRows.length, 0);
  assert.deepEqual(remainingLines, sampleLines);
});

test('sanitizeHeadlineUrl validates and allows only http and https protocols', () => {
  assert.equal(sanitizeHeadlineUrl('https://finance.yahoo.com/news/article-1.html'), 'https://finance.yahoo.com/news/article-1.html');
  assert.equal(sanitizeHeadlineUrl('http://reuters.com/markets/123'), 'http://reuters.com/markets/123');
  assert.equal(sanitizeHeadlineUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeHeadlineUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeHeadlineUrl('file:///etc/passwd'), null);
  assert.equal(sanitizeHeadlineUrl(''), null);
  assert.equal(sanitizeHeadlineUrl(null), null);
  assert.equal(sanitizeHeadlineUrl(undefined), null);
});

test('StructuredDesReport headline links: valid URL renders <a> tag with target=_blank and rel=noopener noreferrer', () => {
  const rawText = `RECENT HEADLINES (AAPL)
  • [2026-11-25] MarketWatch: Apple Unveils Next-Gen AI Silicon`;

  const headlines = [
    {
      date: '2026-11-25',
      source: 'MarketWatch',
      title: 'Apple Unveils Next-Gen AI Silicon',
      url: 'https://finance.yahoo.com/news/apple-ai-silicon.html',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(StructuredDesReport, {
      rawText,
      headlines,
    })
  );

  assert.match(html, /<a\s+href="https:\/\/finance\.yahoo\.com\/news\/apple-ai-silicon\.html"\s+target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(html, /Apple Unveils Next-Gen AI Silicon<\/a>/);
  assert.match(html, /\[2026-11-25\]/);
  assert.match(html, /MarketWatch:/);
});

test('StructuredDesReport headline links: headline without URL renders as plain text without <a> tag', () => {
  const rawText = `RECENT HEADLINES (AAPL)
  • [2026-11-25] Reuters: Apple Quarterly Earnings Preview`;

  const headlines = [
    {
      date: '2026-11-25',
      source: 'Reuters',
      title: 'Apple Quarterly Earnings Preview',
      url: '',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(StructuredDesReport, {
      rawText,
      headlines,
    })
  );

  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /<span class="text-zinc-200">Apple Quarterly Earnings Preview<\/span>/);
});

test('StructuredDesReport headline links: unsafe URL (e.g. javascript:) is not linked', () => {
  const rawText = `RECENT HEADLINES (AAPL)
  • [2026-11-25] MaliciousWire: Click Here For Free Shares`;

  const headlines = [
    {
      date: '2026-11-25',
      source: 'MaliciousWire',
      title: 'Click Here For Free Shares',
      url: 'javascript:alert(document.cookie)',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(StructuredDesReport, {
      rawText,
      headlines,
    })
  );

  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<span class="text-zinc-200">Click Here For Free Shares<\/span>/);
});

test('StructuredDesReport headline links: matches and renders all 4 links using real DES text and headlines payload', () => {
  const realDesText = `APPLE INC. (AAPL)
========================================================================
SECTOR: Technology | INDUSTRY: Consumer Electronics | EXCHANGE: NasdaqGS
HQ: Cupertino, CA, United States | EMPLOYEES: 167,000 | WEB: https://www.apple.com

MARKET & VALUATION METRICS
  LAST PRICE   : $355.58 (+1.51 / +0.43%)
  MARKET CAP   : 5.17T    |  BETA         : 1.09

RECENT HEADLINES (AAPL)
  • [2026-11-25] Investor's Business Daily: Dow Jones Futures: Market Goes On Wild Ride. Nasdaq, Nvidia Slash Losses While Anthropic Reverses Higher.
  • [2026-11-25] Motley Fool: Qualcomm vs. Sandisk: Which Technology Stock Is a Better Buy for 2027?
  • [2026-11-25] Simply Wall St.: Apple (AAPL) Pushes Back As 24 7 Tokenized Shares Trading Opens
  • [2026-11-25] Barrons.com: Chips and iPhones Are Safe From New Tariffs. Here’s What Isn’t.

SOURCE: YAHOO FINANCE LIVE STREAM`;

  const realHeadlines = [
    {
      date: '2026-11-25',
      source: "Investor's Business Daily",
      title: 'Dow Jones Futures: Market Goes On Wild Ride. Nasdaq, Nvidia Slash Losses While Anthropic Reverses Higher.',
      url: 'https://finance.yahoo.com/m/158e82fc-b889-34b6-8704-99a49e9a83ae/dow-jones-futures%3A-market.html',
    },
    {
      date: '2026-11-25',
      source: 'Motley Fool',
      title: 'Qualcomm vs. Sandisk: Which Technology Stock Is a Better Buy for 2027?',
      url: 'https://finance.yahoo.com/markets/stocks/articles/qualcomm-vs-sandisk-technology-stock-212002575.html',
    },
    {
      date: '2026-11-25',
      source: 'Simply Wall St.',
      title: 'Apple (AAPL) Pushes Back As 24 7 Tokenized Shares Trading Opens',
      url: 'https://finance.yahoo.com/markets/crypto/articles/apple-aapl-pushes-back-24-211147818.html',
    },
    {
      date: '2026-11-25',
      source: 'Barrons.com',
      title: 'Chips and iPhones Are Safe From New Tariffs. Here’s What Isn’t.',
      url: 'https://finance.yahoo.com/m/fed0ba1a-1835-3234-b475-4ad6bcc3e25d/chips-and-iphones-are-safe.html',
    },
  ];

  const html = renderToStaticMarkup(
    React.createElement(StructuredDesReport, {
      rawText: realDesText,
      headlines: realHeadlines,
    })
  );

  // All 4 links must be present with safe attributes
  assert.equal((html.match(/target="_blank"/g) || []).length, 4);
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 4);
  assert.match(html, /href="https:\/\/finance\.yahoo\.com\/m\/158e82fc-b889-34b6-8704-99a49e9a83ae\/dow-jones-futures%3A-market\.html"/);
  assert.match(html, /href="https:\/\/finance\.yahoo\.com\/markets\/stocks\/articles\/qualcomm-vs-sandisk-technology-stock-212002575\.html"/);
  assert.match(html, /href="https:\/\/finance\.yahoo\.com\/markets\/crypto\/articles\/apple-aapl-pushes-back-24-211147818\.html"/);
  assert.match(html, /href="https:\/\/finance\.yahoo\.com\/m\/fed0ba1a-1835-3234-b475-4ad6bcc3e25d\/chips-and-iphones-are-safe\.html"/);
});


