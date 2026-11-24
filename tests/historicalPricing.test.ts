import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Workspace from '../src/components/Workspace.tsx';
import {
  countDistinctTradingDays,
  deduplicateAndSortHistoricalBars,
  formatHistoricalHourlyTimestamp,
  getHistoricalBarEasternIsoDate,
  isClosingPriceSnapshotBar,
  matchEarningsDatesToBars,
  parseAlphaVantageEarningsDates,
  parseAlphaVantageIntradayBars,
  parseEasternTimestampToSeconds,
  selectBestHistoricalBars,
  type HistoricalPriceBar,
} from '../src/utils/historicalPricing.ts';
import type { StockData } from '../src/types.ts';

function makeStock(overrides: Partial<StockData> = {}): StockData {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 342.56,
    change: 2.15,
    changePercent: 0.63,
    high: 344.2,
    low: 339.1,
    open: 340.4,
    prevClose: 340.41,
    volume: 42500000,
    marketCap: '$5.1T',
    peRatio: 32.4,
    beta: 1.2,
    history: [],
    ...overrides,
  };
}

test('isClosingPriceSnapshotBar detects legitimate 16:00 ET flat zero-volume snapshots only', () => {
  assert.equal(
    isClosingPriceSnapshotBar({
      date: '11/20 16:00',
      open: 342.56,
      high: 342.56,
      low: 342.56,
      close: 342.56,
      volume: 0,
    }),
    true
  );

  // Active 15:30 trading bar with real volume is not a closing snapshot
  assert.equal(
    isClosingPriceSnapshotBar({
      date: '11/20 15:30',
      open: 341.9,
      high: 342.8,
      low: 341.75,
      close: 342.56,
      volume: 4_120_500,
    }),
    false
  );

  // 16:00 bar with positive volume is active trading, not a zero-volume snapshot
  assert.equal(
    isClosingPriceSnapshotBar({
      date: '11/20 16:00',
      open: 342.56,
      high: 342.56,
      low: 342.56,
      close: 342.56,
      volume: 1200,
    }),
    false
  );

  // Non-16:00 zero-volume flat bar is not flagged as a 4:00 PM closing snapshot
  assert.equal(
    isClosingPriceSnapshotBar({
      date: '11/20 12:30',
      open: 342.56,
      high: 342.56,
      low: 342.56,
      close: 342.56,
      volume: 0,
    }),
    false
  );
});

test('deduplicateAndSortHistoricalBars removes duplicates, prefers higher volume, and sorts strictly newest-first', () => {
  const input: HistoricalPriceBar[] = [
    {
      date: '11/19 09:30',
      timestamp: 1795100000,
      open: 338.1,
      high: 340.2,
      low: 337.9,
      close: 339.8,
      volume: 10_871_951,
    },
    {
      date: '11/20 16:00',
      timestamp: 1795209600,
      open: 342.56,
      high: 342.56,
      low: 342.56,
      close: 342.56,
      volume: 0,
    },
    // Duplicate timestamp with zero volume should NOT overwrite the active bar
    {
      date: '11/19 10:30',
      timestamp: 1795103600,
      open: 339.8,
      high: 341.0,
      low: 339.2,
      close: 340.5,
      volume: 0,
    },
    {
      date: '11/19 10:30',
      timestamp: 1795103600,
      open: 339.8,
      high: 341.0,
      low: 339.2,
      close: 340.5,
      volume: 3_853_093,
    },
  ];

  const sorted = deduplicateAndSortHistoricalBars(input);
  assert.equal(sorted.length, 3);
  assert.equal(sorted[0].date, '11/20 16:00');
  assert.equal(sorted[0].isMarketCloseSnapshot, true);
  assert.equal(sorted[1].date, '11/19 10:30');
  assert.equal(sorted[1].volume, 3_853_093);
  assert.equal(sorted[1].isMarketCloseSnapshot, false);
  assert.equal(sorted[2].date, '11/19 09:30');
  assert.equal(sorted[2].volume, 10_871_951);
});

test('countDistinctTradingDays counts unique US Eastern trading sessions accurately', () => {
  const tsDay1Morning = parseEasternTimestampToSeconds('2026-10-15 09:30:00');
  const tsDay1Afternoon = parseEasternTimestampToSeconds('2026-10-15 15:30:00');
  const tsDay2Morning = parseEasternTimestampToSeconds('2026-10-16 09:30:00');
  const tsDay3Morning = parseEasternTimestampToSeconds('2026-11-18 09:30:00');

  const bars: HistoricalPriceBar[] = [
    { date: '10/15 09:30', timestamp: tsDay1Morning, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
    { date: '10/15 15:30', timestamp: tsDay1Afternoon, open: 100.5, high: 102, low: 100, close: 101.5, volume: 2000 },
    { date: '10/16 09:30', timestamp: tsDay2Morning, open: 101.5, high: 103, low: 101, close: 102.5, volume: 1500 },
    { date: '11/18 09:30', timestamp: tsDay3Morning, open: 105, high: 106, low: 104, close: 105.5, volume: 1800 },
  ];

  assert.equal(countDistinctTradingDays(bars), 3);
  assert.equal(formatHistoricalHourlyTimestamp(tsDay1Morning, false), '10/15 09:30');
  assert.equal(formatHistoricalHourlyTimestamp(tsDay3Morning, true), '11/18/26 09:30');
});

test('parseAlphaVantageIntradayBars parses 60min payload accurately across EST and EDT and detects notices', () => {
  const payload = {
    'Meta Data': {
      '1. Information': 'Intraday (60min) open, high, low, close prices and volume',
      '2. Symbol': 'AAPL',
    },
    'Time Series (60min)': {
      '2026-10-30 15:00:00': {
        '1. open': '330.1000',
        '2. high': '331.4000',
        '3. low': '329.8000',
        '4. close': '331.0500',
        '5. volume': '4210000',
      },
      '2026-11-19 09:00:00': {
        '1. open': '338.0000',
        '2. high': '340.5000',
        '3. low': '337.6000',
        '4. close': '340.1200',
        '5. volume': '6120400',
      },
    },
  };

  const parsed = parseAlphaVantageIntradayBars(payload);
  assert.equal(parsed.rateLimited, false);
  assert.equal(parsed.premiumRestricted, false);
  assert.equal(parsed.bars.length, 2);
  // Newest first
  assert.equal(parsed.bars[0].date, '11/19 09:00');
  assert.equal(parsed.bars[0].close, 340.12);
  assert.equal(parsed.bars[0].volume, 6120400);
  assert.equal(parsed.bars[1].date, '10/30 15:00');
  assert.equal(parsed.bars[1].open, 330.1);

  const premiumNotice = parseAlphaVantageIntradayBars({
    Information: 'Thank you for using Alpha Vantage! This is a premium endpoint for full outputsize.',
  });
  assert.equal(premiumNotice.bars.length, 0);
  assert.equal(premiumNotice.premiumRestricted, true);

  const rateLimitNotice = parseAlphaVantageIntradayBars({
    Information: 'We have detected your API key and our standard API rate limit is 25 requests per day.',
  });
  assert.equal(rateLimitNotice.bars.length, 0);
  assert.equal(rateLimitNotice.rateLimited, true);
});

test('selectBestHistoricalBars preserves valid historical data against empty or severely truncated responses', () => {
  const existing: HistoricalPriceBar[] = Array.from({ length: 120 }, (_, i) => ({
    date: `10/${String((i % 20) + 1).padStart(2, '0')} 10:30`,
    timestamp: 1790000000 + i * 3600,
    open: 300 + i * 0.1,
    high: 301 + i * 0.1,
    low: 299 + i * 0.1,
    close: 300.5 + i * 0.1,
    volume: 1_000_000 + i * 100,
  }));

  // Empty incoming response must not wipe valid existing history
  assert.equal(selectBestHistoricalBars([], existing).length, 120);

  // Severely truncated transient response (e.g. 10 bars) must not downgrade 120 bars
  assert.equal(selectBestHistoricalBars(existing.slice(0, 10), existing).length, 120);

  // Richer incoming dataset replaces existing
  const richer = [
    ...existing,
    {
      date: '11/20 15:30',
      timestamp: 1795207800,
      open: 341.9,
      high: 342.8,
      low: 341.75,
      close: 342.56,
      volume: 4_120_500,
    },
  ];
  assert.equal(selectBestHistoricalBars(richer, existing).length, 121);
});

test('Workspace HP screen renders INTERVAL VOLUME header, all 7 columns, A-/A+ controls, and Market Close labeling', () => {
  const bars: HistoricalPriceBar[] = [
    {
      date: '11/19 09:30',
      timestamp: parseEasternTimestampToSeconds('2026-11-19 09:30:00'),
      open: 338.1,
      high: 340.2,
      low: 337.9,
      close: 339.8,
      volume: 10_871_951,
    },
    {
      date: '11/20 15:30',
      timestamp: parseEasternTimestampToSeconds('2026-11-20 15:30:00'),
      open: 341.9,
      high: 342.8,
      low: 341.75,
      close: 342.56,
      volume: 4_120_500,
    },
    {
      date: '11/20 16:00',
      timestamp: parseEasternTimestampToSeconds('2026-11-20 16:00:00'),
      open: 342.56,
      high: 342.56,
      low: 342.56,
      close: 342.56,
      volume: 0,
      isMarketCloseSnapshot: true,
    },
  ];

  const stock = makeStock({ symbol: 'AAPL', history: bars });

  const html = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'HP',
      selectedTicker: 'AAPL',
      stocks: { AAPL: stock },
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );

  // All 7 expected columns, with INTERVAL VOLUME instead of ACCUMULATED VOLUME
  assert.equal(html.includes('INTERVAL VOLUME'), true);
  assert.equal(html.includes('ACCUMULATED VOLUME'), false);
  assert.equal(html.includes('TIME'), true);
  assert.equal(html.includes('OPEN VALUE'), true);
  assert.equal(html.includes('HIGH VALUE'), true);
  assert.equal(html.includes('LOW VALUE'), true);
  assert.equal(html.includes('CLOSE VALUE'), true);
  assert.equal(html.includes('DIFFERENTIAL'), true);

  // Title updated without "System", fixed header with TEXT SIZE controls, stats right-aligned below header and above scrollable table
  assert.equal(html.includes('AAPL Historical Price Log'), true);
  assert.equal(html.includes('Historical Price Log System'), false);
  assert.equal(html.includes('overflow-y-auto overflow-x-auto'), true);
  assert.equal(html.includes('overflow-x-auto'), true);
  assert.equal(html.includes('A-'), true);
  assert.equal(html.includes('A+'), true);

  // Coverage indicator (trading days & 60M without bar count) and accurate 4:00 PM snapshot vs active intraday labeling
  assert.equal(html.includes('BARS'), false);
  assert.equal(html.includes('2 TRADING DAYS • 60M'), true);
  assert.equal(html.includes('11/20 16:00 (Market Close)'), true);
  assert.equal(html.includes('11/20 15:30 (Intraday)'), true);
  assert.equal(html.includes('11/19 09:30 (Intraday)'), true);

  // Header -> TEXT SIZE controls -> right-aligned statistics -> scrollable table ordering
  const idxTitle = html.indexOf('AAPL Historical Price Log');
  const idxTextSize = html.indexOf('TEXT SIZE');
  const idxStats = html.indexOf('2 TRADING DAYS • 60M');
  const idxTableScroll = html.indexOf('overflow-y-auto overflow-x-auto');
  assert.ok(
    idxTitle > -1 && idxTextSize > idxTitle && idxStats > idxTextSize && idxTableScroll > idxStats,
    'Expected fixed header & TEXT SIZE controls above right-aligned statistics and independent scrollable table'
  );

  // Strictly newest-first ordering in rendered DOM
  const idxClose = html.indexOf('11/20 16:00 (Market Close)');
  const idxLatestActive = html.indexOf('11/20 15:30 (Intraday)');
  const idxEarlierDay = html.indexOf('11/19 09:30 (Intraday)');
  assert.ok(idxClose > -1 && idxLatestActive > idxClose && idxEarlierDay > idxLatestActive);

  // Without earnings dates, no earnings highlights or legend appear
  assert.equal(html.includes('data-earnings-date='), false);
  assert.equal(html.includes('EARNINGS DATE'), false);
});

test('parseAlphaVantageEarningsDates extracts quarterly reportedDate only, ignores fiscalDateEnding/annualEarnings, and handles rate limits/errors', () => {
  const payload = {
    symbol: 'AAPL',
    annualEarnings: [
      { fiscalDateEnding: '2026-09-30', reportedDate: '2026-10-30', reportedEPS: '7.45' },
    ],
    quarterlyEarnings: [
      {
        fiscalDateEnding: '2026-09-30',
        reportedDate: '2026-10-29',
        reportedEPS: '1.85',
      },
      {
        fiscalDateEnding: '2026-06-30',
        reportedDate: '2026-07-30',
        reportedEPS: '1.52',
      },
      {
        // Duplicate reportedDate and malformed dates must be deduplicated/ignored
        fiscalDateEnding: '2026-09-30',
        reportedDate: '2026-10-29',
      },
      {
        fiscalDateEnding: '2026-03-31',
        reportedDate: 'None',
      },
      {
        fiscalDateEnding: '2025-12-31',
        reportedDate: '2026-02-30',
      },
    ],
  };

  const parsed = parseAlphaVantageEarningsDates(payload);
  assert.deepEqual(parsed.reportedDates, ['2026-10-29', '2026-07-30']);
  // fiscalDateEnding and annualEarnings must never leak into reportedDates
  assert.equal(parsed.reportedDates.includes('2026-09-30'), false);
  assert.equal(parsed.reportedDates.includes('2026-06-30'), false);
  assert.equal(parsed.reportedDates.includes('2026-10-30'), false);
  assert.equal(parsed.rateLimited, false);
  assert.equal(parsed.errorMessage, null);

  const rateLimited = parseAlphaVantageEarningsDates({
    Information: 'We have detected your API key and our standard API rate limit is 25 requests per day.',
  });
  assert.equal(rateLimited.reportedDates.length, 0);
  assert.equal(rateLimited.rateLimited, true);

  const emptyEtf = parseAlphaVantageEarningsDates({});
  assert.deepEqual(emptyEtf.reportedDates, []);
  assert.equal(emptyEtf.rateLimited, false);
  assert.equal(emptyEtf.errorMessage, null);
});

test('getHistoricalBarEasternIsoDate and matchEarningsDatesToBars align US Eastern trading dates without fabricating years or extra dates', () => {
  // 2026-10-29 19:30 ET (EDT = UTC-4) is 2026-10-29 23:30 UTC; 2026-11-19 19:30 ET (EST = UTC-5) is 2026-11-20 00:30 UTC!
  const lateEstTs = parseEasternTimestampToSeconds('2026-11-19 19:30:00');
  const openEdtTs = parseEasternTimestampToSeconds('2026-10-29 09:30:00');

  const bars: HistoricalPriceBar[] = [
    {
      date: formatHistoricalHourlyTimestamp(lateEstTs, false),
      timestamp: lateEstTs,
      open: 200,
      high: 202,
      low: 199,
      close: 201,
      volume: 1000,
    },
    {
      date: formatHistoricalHourlyTimestamp(openEdtTs, false),
      timestamp: openEdtTs,
      open: 195,
      high: 198,
      low: 194,
      close: 197,
      volume: 2000,
    },
    {
      // Yearless string with no timestamp must return null rather than fabricating a year
      date: '10/29 15:30',
      timestamp: 0,
      open: 196,
      high: 197,
      low: 195,
      close: 196,
      volume: 500,
    },
  ];

  // Even though 19:30 EST rolls over to 2026-11-20 in UTC, Eastern calendar date is 2026-11-19
  assert.equal(getHistoricalBarEasternIsoDate(bars[0]), '2026-11-19');
  assert.equal(getHistoricalBarEasternIsoDate(bars[1]), '2026-10-29');
  assert.equal(getHistoricalBarEasternIsoDate(bars[2]), null);

  // Only overlapping trading dates match; non-overlapping or weekend dates are excluded
  const matched = matchEarningsDatesToBars(
    ['2026-11-20', '2026-10-29', '2026-07-30', '2026-11-01'],
    bars
  );
  assert.deepEqual(Array.from(matched), ['2026-10-29']);
});

test('Workspace HP screen highlights matching earnings-date rows, displays legend, and isolates highlights per ticker', () => {
  const tsEarnClose = parseEasternTimestampToSeconds('2026-10-29 16:00:00');
  const tsEarnIntraday = parseEasternTimestampToSeconds('2026-10-29 15:30:00');
  const tsNormal = parseEasternTimestampToSeconds('2026-10-28 15:30:00');

  const bars: HistoricalPriceBar[] = [
    {
      date: '10/29 16:00',
      timestamp: tsEarnClose,
      open: 230,
      high: 230,
      low: 230,
      close: 230,
      volume: 0,
      isMarketCloseSnapshot: true,
    },
    {
      date: '10/29 15:30',
      timestamp: tsEarnIntraday,
      open: 228,
      high: 231,
      low: 227,
      close: 230,
      volume: 4200000,
    },
    {
      date: '10/28 15:30',
      timestamp: tsNormal,
      open: 225,
      high: 227,
      low: 224,
      close: 226,
      volume: 3100000,
    },
  ];

  const aapl = makeStock({ symbol: 'AAPL', history: bars });
  const msft = makeStock({ symbol: 'MSFT', name: 'Microsoft Corp.', history: bars });

  const aaplHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'HP',
      selectedTicker: 'AAPL',
      stocks: { AAPL: aapl, MSFT: msft },
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
      initialHpEarningsDates: {
        // Includes one matching date and one non-overlapping historical date (must not add extra rows)
        AAPL: ['2026-10-29', '2026-07-30'],
      },
    })
  );

  // Legend appears above the table and both 2026-10-29 rows are highlighted while 2026-10-28 is not
  assert.equal(aaplHtml.includes('EARNINGS DATE'), true);
  const highlightedMatches = aaplHtml.match(/data-earnings-date="2026-10-29"/g) || [];
  assert.equal(highlightedMatches.length, 2);
  assert.equal(aaplHtml.includes('data-earnings-date="2026-10-28"'), false);
  assert.equal(aaplHtml.includes('data-earnings-date="2026-07-30"'), false);
  assert.equal(aaplHtml.includes('bg-[#ff9900]/12'), true);
  // Exact 3 rows rendered (no synthetic row added for 2026-07-30)
  const tbodySlice = aaplHtml.slice(aaplHtml.indexOf('<tbody>'), aaplHtml.indexOf('</tbody>'));
  const rowCount = (tbodySlice.match(/<tr\b/g) || []).length;
  assert.equal(rowCount, 3);

  // Switching to MSFT (no matching earnings dates) renders no highlights and no legend
  const msftHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'HP',
      selectedTicker: 'MSFT',
      stocks: { AAPL: aapl, MSFT: msft },
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
      initialHpEarningsDates: {
        AAPL: ['2026-10-29'],
      },
    })
  );
  assert.equal(msftHtml.includes('data-earnings-date='), false);
  assert.equal(msftHtml.includes('EARNINGS DATE'), false);
  assert.equal(msftHtml.includes('MSFT Historical Price Log'), true);
});

