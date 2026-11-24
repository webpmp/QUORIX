import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CommandPanel from '../src/components/CommandPanel.tsx';
import Workspace from '../src/components/Workspace.tsx';
import CorrelationAnalyzerScreen, {
  CORR_USAGE_WORKFLOW_STEPS,
  computeResponsiveChartWidth,
} from '../src/components/CorrelationAnalyzerScreen.tsx';
import {
  alignSecurityReturns,
  buildCorrelationMatrix,
  computeDailyReturns,
  computePairwiseAnalysis,
  computePearsonCorrelation,
  generateCorrelationInsights,
  interpretCorrelation,
  shiftIsoDate,
  type DailyPricePoint,
  type SecurityHistorySeries,
} from '../src/utils/correlation.ts';
import type { StockData } from '../src/types.ts';

function buildTradingDates(count: number, endIso = '2026-11-20'): string[] {
  const dates: string[] = [];
  let cursor = endIso;
  while (dates.length < count) {
    const dt = new Date(`${cursor}T00:00:00Z`);
    const day = dt.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor);
    }
    cursor = shiftIsoDate(cursor, -1);
  }
  return dates.reverse();
}

function buildSeriesFromReturns(
  symbol: string,
  name: string,
  dates: string[],
  dailyReturns: number[],
  startPrice = 100
): SecurityHistorySeries {
  const bars: DailyPricePoint[] = [];
  let price = startPrice;
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) {
      price = price * (1 + dailyReturns[i - 1]);
    }
    const ts = Math.floor(Date.parse(`${dates[i]}T14:30:00Z`) / 1000);
    bars.push({
      date: dates[i],
      timestamp: ts,
      close: Number(price.toFixed(6)),
      adjClose: Number(price.toFixed(6)),
      usedAdjustedClose: true,
    });
  }
  return {
    symbol,
    name,
    instrumentType: 'EQUITY',
    exchange: 'NASDAQ',
    priceBasis: 'adjclose',
    adjustedCloseAvailable: true,
    bars,
    earliestDate: bars[0]?.date ?? null,
    latestDate: bars[bars.length - 1]?.date ?? null,
    error: null,
  };
}

function makeDummyStock(symbol = 'AAPL'): StockData {
  return {
    symbol,
    name: `${symbol} Inc.`,
    price: 200,
    change: 1,
    changePercent: 0.5,
    high: 201,
    low: 199,
    open: 199.5,
    prevClose: 199,
    volume: 1_000_000,
    marketCap: '$1T',
    peRatio: 25,
    beta: 1.1,
    history: [],
  };
}

test('CommandPanel renders CORR immediately after GP while keeping all existing commands', () => {
  const html = renderToStaticMarkup(
    React.createElement(CommandPanel, {
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      selectedTicker: 'AAPL',
      onSelectTicker: () => {},
      onReorderTicker: () => {},
      onRemoveTicker: () => {},
      onResetTrackedTickers: () => {},
      activeScreen: 'CORR',
      onSelectScreen: () => {},
    })
  );

  assert.equal(html.includes('CORRELATION ANALYZER'), true);
  assert.equal(html.includes('Correlation &amp; portfolio analysis'), true);
  assert.equal(html.includes('Security correlation &amp; portfolio analysis'), false);
  assert.equal(html.includes('id="cmd-shortcut-CORR"'), true);

  // Verify exact order: GP followed by CORR, PRM, and HP
  const gpIdx = html.indexOf('id="cmd-shortcut-GP"');
  const corrIdx = html.indexOf('id="cmd-shortcut-CORR"');
  const prmIdx = html.indexOf('id="cmd-shortcut-PRM"');
  const hpIdx = html.indexOf('id="cmd-shortcut-HP"');
  assert.ok(gpIdx > -1 && corrIdx > gpIdx && prmIdx > corrIdx && hpIdx > prmIdx);

  // Verify existing commands remain intact
  for (const code of ['ASK', 'NEWS', 'GP', 'CORR', 'HP', 'DES', 'ANR', 'INST', 'CRNC', 'ECO', 'POLY', 'SETT', 'HELP']) {
    assert.equal(html.includes(`id="cmd-shortcut-${code}"`), true, `Missing command ${code}`);
  }
});

test('Workspace routes CORR to Correlation Analyzer and lists CORR in HELP reference', () => {
  const corrHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'CORR',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );
  assert.equal(corrHtml.includes('CORRELATION ANALYZER'), true);
  assert.equal(corrHtml.includes('CORRELATION MATRIX'), true);

  const helpHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'HELP',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );
  assert.equal(helpHtml.includes('CORR'), true);
  assert.equal(helpHtml.includes('Correlation Analyzer'), true);
});

test('computeDailyReturns computes (currentAdjClose / previousAdjClose) - 1, deduplicates dates, and skips invalid records', () => {
  const bars: DailyPricePoint[] = [
    { date: '2026-11-16', timestamp: 1, close: 100, adjClose: 100, usedAdjustedClose: true },
    // Duplicate date with newer timestamp should win
    { date: '2026-11-17', timestamp: 2, close: 105, adjClose: 105, usedAdjustedClose: true },
    { date: '2026-11-17', timestamp: 3, close: 110, adjClose: 110, usedAdjustedClose: true },
    // Invalid non-positive bar must be excluded (never turned into 0 return)
    { date: '2026-11-18', timestamp: 4, close: 0, adjClose: 0, usedAdjustedClose: true },
    { date: '2026-11-19', timestamp: 5, close: 99, adjClose: 99, usedAdjustedClose: true },
  ];

  const returns = computeDailyReturns(bars);
  assert.equal(returns.length, 2);
  assert.equal(returns[0].date, '2026-11-17');
  assert.ok(Math.abs(returns[0].ret - 0.1) < 1e-12); // (110 / 100) - 1 = +10%
  assert.equal(returns[1].date, '2026-11-19');
  assert.ok(Math.abs(returns[1].ret - -0.1) < 1e-12); // (99 / 110) - 1 = -10%
});

test('computePearsonCorrelation satisfies mathematical identities and guards constant/empty series', () => {
  const a = [0.01, -0.02, 0.03, 0.015, -0.005, 0.02, -0.01, 0.04, -0.025, 0.012];
  const identical = [...a];
  const inverse = a.map((x) => -x);
  const constant = a.map(() => 0.01);

  assert.equal(computePearsonCorrelation(a, identical), 1);
  assert.equal(computePearsonCorrelation(a, inverse), -1);
  assert.equal(computePearsonCorrelation(a, constant), null);
  assert.equal(computePearsonCorrelation([0.01], [0.02]), null);

  // Hand-verified dataset: x = [1,2,3,4,5], y = [2,3,5,4,6] => r = 0.9
  const knownR = computePearsonCorrelation([1, 2, 3, 4, 5], [2, 3, 5, 4, 6]);
  assert.ok(knownR !== null && Math.abs(knownR - 0.9) < 1e-12);
});

test('interpretCorrelation maps all 7 interpretation bands accurately', () => {
  assert.equal(interpretCorrelation(0.95).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.8).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.65).label, 'Moderate positive');
  assert.equal(interpretCorrelation(0.25).label, 'Weak positive');
  assert.equal(interpretCorrelation(0.05).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(-0.08).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(-0.25).label, 'Weak negative');
  assert.equal(interpretCorrelation(-0.6).label, 'Moderate negative');
  assert.equal(interpretCorrelation(-0.85).label, 'Strong negative');
  assert.equal(interpretCorrelation(null).label, 'Unavailable');
});

test('buildCorrelationMatrix is symmetrical, has 1.00 diagonal, excludes missing dates, and flags partial coverage', () => {
  const dates = buildTradingDates(120);
  const baseReturns = Array.from({ length: 119 }, (_, i) => Math.sin(i * 0.45) * 0.02 + Math.cos(i * 0.17) * 0.01);
  const inverseReturns = baseReturns.map((r) => -r);

  const secA = buildSeriesFromReturns('AAA', 'Alpha Corp', dates, baseReturns, 100);
  const secB = buildSeriesFromReturns('BBB', 'Beta Corp', dates, baseReturns.map((r) => r * 1.4 + 0.001), 250);
  const secC = buildSeriesFromReturns('CCC', 'Gamma Inverse', dates, inverseReturns, 50);

  // Short-history security (only 25 trading days) to test insufficient coverage detection on 90D
  const shortDates = dates.slice(-25);
  const secShort = buildSeriesFromReturns('NEW', 'Recent IPO', shortDates, baseReturns.slice(-24), 40);

  // Missing observations test: drop 5 dates from secB to ensure alignment excludes missing dates instead of zero-filling
  const secBWithGaps: SecurityHistorySeries = {
    ...secB,
    bars: secB.bars.filter((_, idx) => idx % 20 !== 7),
  };

  const alignedAB = alignSecurityReturns(secA.bars, secBWithGaps.bars);
  assert.ok(alignedAB.length < secA.bars.length - 1);

  const matrix = buildCorrelationMatrix([secA, secB, secC, secShort], '90D');

  // Diagonal = 1.00 for all valid series
  for (let i = 0; i < 4; i++) {
    assert.equal(matrix.cells[i][i].correlation, 1.0);
  }

  // Exact symmetry across entire matrix
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      assert.equal(matrix.cells[i][j].correlation, matrix.cells[j][i].correlation);
    }
  }

  // AAA vs BBB = +1.00 (positive linear transform of returns), AAA vs CCC = -1.00
  assert.ok(Math.abs((matrix.cells[0][1].correlation ?? 0) - 1) < 1e-10);
  assert.ok(Math.abs((matrix.cells[0][2].correlation ?? 0) - -1) < 1e-10);

  // Short-history security must be flagged as insufficient coverage for 90D lookback
  assert.equal(matrix.coverageBySymbol['NEW'].hasSufficientCoverage, false);
  assert.ok(matrix.coverageBySymbol['NEW'].warningMessage?.includes('shorter than the requested 90 Days'));
});

test('computePairwiseAnalysis computes rolling correlation, base-100 normalized series, scatter points, and handles insufficient rolling history', () => {
  const dates = buildTradingDates(140);
  const returnsA = Array.from({ length: 139 }, (_, i) => Math.sin(i * 0.35) * 0.018);
  // First 70 days positively correlated, last 69 days negatively correlated to test regime shift
  const returnsB = returnsA.map((r, i) => (i < 70 ? r * 0.9 + 0.001 : -r * 0.95));

  const secA = buildSeriesFromReturns('AAA', 'Alpha', dates, returnsA, 120);
  const secB = buildSeriesFromReturns('BBB', 'Beta', dates, returnsB, 40);

  const analysis = computePairwiseAnalysis(secA, secB, '90D', 30);
  assert.equal(analysis.rollingWindow, 30);
  assert.ok(analysis.rollingSeries.length > 10);
  assert.equal(analysis.rollingUnavailableReason, null);
  assert.ok(analysis.normalizedSeries.length >= 2);
  assert.equal(analysis.normalizedSeries[0].indexA, 100);
  assert.equal(analysis.normalizedSeries[0].indexB, 100);
  assert.equal(analysis.scatterPoints.length, analysis.observationCount);
  assert.ok(analysis.sameDirectionPct !== null && analysis.sameDirectionPct >= 0 && analysis.sameDirectionPct <= 100);

  // Insights should detect the regime shift on rolling correlation
  const matrix = buildCorrelationMatrix([secA, secB], '90D');
  const insights = generateCorrelationInsights(matrix, analysis);
  assert.ok(insights.length >= 1);

  // Insufficient observations for 30-obs rolling window must NOT fabricate values
  const tinyDates = dates.slice(-15);
  const tinyA = buildSeriesFromReturns('T1', 'Tiny One', tinyDates, returnsA.slice(-14), 100);
  const tinyB = buildSeriesFromReturns('T2', 'Tiny Two', tinyDates, returnsA.slice(-14), 100);
  const tinyAnalysis = computePairwiseAnalysis(tinyA, tinyB, '90D', 30);
  assert.equal(tinyAnalysis.rollingSeries.length, 0);
  assert.ok(tinyAnalysis.rollingUnavailableReason?.includes('30 required'));
});

test('CorrelationAnalyzerScreen renders populated matrix/charts, empty state, single-security state, and error states cleanly', () => {
  const dates = buildTradingDates(130);
  const rA = Array.from({ length: 129 }, (_, i) => Math.sin(i * 0.3) * 0.015 + 0.0005);
  const rB = rA.map((r, i) => r * 0.85 + Math.cos(i * 0.7) * 0.003);
  const rC = rA.map((r) => -r * 0.9);

  const sA = buildSeriesFromReturns('SPY', 'SPDR S&P 500 ETF', dates, rA, 500);
  const sB = buildSeriesFromReturns('QQQ', 'Invesco QQQ Trust', dates, rB, 420);
  const sC = buildSeriesFromReturns('TLT', 'iShares 20+ Year Treasury Bond ETF', dates, rC, 90);

  // 1. Populated workspace render (including trackedTickers prop to verify TRACKED shortcuts are removed)
  const populatedHtml = renderToStaticMarkup(
    React.createElement(CorrelationAnalyzerScreen, {
      stocks: {},
      trackedTickers: ['AAPL', 'MSFT', 'NVDA'],
      initialSymbols: ['SPY', 'QQQ', 'TLT'],
      initialSeriesMap: { SPY: sA, QQQ: sB, TLT: sC },
      initialLookback: '90D',
      initialRollingWindow: 30,
    })
  );
  // Concise terminal section headings & selection controls
  assert.equal(populatedHtml.includes('BENCHMARKS:'), true);
  assert.equal(populatedHtml.includes('TRACKED:'), false);
  assert.equal(populatedHtml.includes('CORRELATION MATRIX'), true);
  assert.equal(populatedHtml.includes('1.00'), true);
  assert.equal(populatedHtml.includes('Strong positive'), true);
  assert.equal(populatedHtml.includes('Strong negative'), true);
  assert.equal(populatedHtml.includes('PAIRWISE COMPARISON'), true);
  assert.equal(populatedHtml.includes('SPY / QQQ'), true);
  assert.equal(populatedHtml.includes('ROLLING CORRELATION'), true);
  assert.equal(populatedHtml.includes('NORMALIZED PERFORMANCE'), true);
  assert.equal(populatedHtml.includes('BASE 100'), true);
  assert.equal(populatedHtml.includes('RETURN DISTRIBUTION'), true);
  assert.equal(populatedHtml.includes('OLS REGRESSION'), true);
  assert.equal(populatedHtml.includes('SAME-DIRECTION SESSIONS'), true);
  assert.equal(populatedHtml.includes('OVERLAPPING OBSERVATIONS'), true);
  assert.equal(populatedHtml.includes('CORRELATION INSIGHTS'), true);
  assert.equal(populatedHtml.includes('Correlation does not establish causation'), true);

  // Matrix leftmost column renders ticker-only rows with compact w-px sticky header (no inline descriptions)
  const tableStart = populatedHtml.indexOf('<table');
  const tableEnd = populatedHtml.indexOf('</table>', tableStart);
  assert.ok(tableStart > -1 && tableEnd > tableStart);
  const matrixTableHtml = populatedHtml.slice(tableStart, tableEnd);
  assert.equal(matrixTableHtml.includes('<div class="text-xs font-bold text-[#3498db]">SPY</div></th>'), true);
  assert.equal(matrixTableHtml.includes('max-w-[110px]'), false);
  assert.equal(matrixTableHtml.includes('w-px min-w-[76px]'), true);
  assert.equal(matrixTableHtml.includes('class="block w-full"'), true);

  // All three analytical charts match viewBox height 1:1 to their rendered CSS heights
  // (Rolling Correlation: h-[210px] -> 210; Normalized Performance & Return Distribution: h-[200px] -> 200).
  assert.equal(populatedHtml.includes('viewBox="0 0 680 210"'), true);
  const twoHundredViewBoxes = populatedHtml.match(/viewBox="0 0 520 200"/g) || [];
  assert.equal(twoHundredViewBoxes.length, 2);
  assert.equal(populatedHtml.includes('viewBox="0 0 520 220"'), false);

  // Removed instructional / redundant prose and ACTIVE indicator should no longer clutter the workspace
  assert.equal(populatedHtml.includes('ACTIVE:'), false);
  assert.equal(populatedHtml.includes('INTERVAL:'), true);
  assert.equal(populatedHtml.includes('METHOD:'), true);
  assert.equal(populatedHtml.includes('SECURITIES:'), true);
  assert.equal(
    populatedHtml.includes('Historical Pearson correlation, rolling co-movement, normalized return paths'),
    false
  );
  assert.equal(populatedHtml.includes('Click any off-diagonal cell'), false);
  assert.equal(populatedHtml.includes('Each point computes trailing'), false);
  assert.equal(populatedHtml.includes('Orange line = OLS linear fit'), false);
  assert.equal(populatedHtml.includes('Practical reference bands (not universal statistical thresholds)'), false);

  // Contextual tooltips across configuration, matrix cells, interpretation bands, KPIs, charts, and insights
  const expectedTooltipFragments = [
    'Historical period used for correlation calculations.',
    'daily percentage returns from consecutive trading sessions.',
    'strength and direction of the linear relationship',
    'separate from the overall lookback period.',
    'Each cell represents the Pearson correlation',
    'SPY / QQQ · Pearson:',
    'Self-correlation: 1.00',
    '+1 indicates perfect positive correlation, 0 indicates no linear correlation, and -1 indicates perfect negative correlation.',
    '+0.80 to +1.00:',
    '+0.50 to +0.79:',
    '+0.20 to +0.49:',
    '-0.19 to +0.19:',
    '-0.49 to -0.20:',
    '-0.79 to -0.50:',
    '-1.00 to -0.80:',
    'changes over time using a moving observation window.',
    'Indicates zero linear correlation. Values above the line are positive; values below are negative.',
    'setting both securities to a common starting value of 100.',
    'regardless of share price.',
    'daily percentage returns of two securities on the same trading date.',
    'Least-squares regression line showing the best-fitting linear relationship',
    'same sign, whether positive or negative.',
    'trading-date observations available for both securities',
    'These are descriptive findings, not predictions.',
  ];
  for (const fragment of expectedTooltipFragments) {
    assert.equal(
      populatedHtml.includes(fragment),
      true,
      `Missing expected tooltip text: ${fragment}`
    );
  }

  // Portfolio usage help tooltip appears immediately to the LEFT of REFRESH DATA with exact 6-step content
  const helpBtnMarker = 'aria-label="How do I use the CORR Workspace?"';
  const refreshBtnMarker = '<span>REFRESH DATA</span>';
  const helpIdx = populatedHtml.indexOf(helpBtnMarker);
  const refreshIdx = populatedHtml.indexOf(refreshBtnMarker);
  assert.ok(helpIdx > -1 && refreshIdx > helpIdx, 'Help icon must appear to the left of REFRESH DATA');
  assert.equal(populatedHtml.includes('Here is a practical workflow for analyzing your portfolio.'), true);
  assert.equal(CORR_USAGE_WORKFLOW_STEPS.length, 6);
  for (const item of CORR_USAGE_WORKFLOW_STEPS) {
    assert.equal(populatedHtml.includes(item.step), true, `Missing workflow step heading: ${item.step}`);
    assert.equal(populatedHtml.includes(item.detail), true, `Missing workflow step detail: ${item.detail}`);
  }

  // 2. Empty state (0 securities)
  const emptyHtml = renderToStaticMarkup(
    React.createElement(CorrelationAnalyzerScreen, {
      stocks: {},
      initialSymbols: [],
      initialSeriesMap: {},
    })
  );
  assert.equal(emptyHtml.includes('No Securities Selected'), true);

  // 3. Single security state (1 security)
  const singleHtml = renderToStaticMarkup(
    React.createElement(CorrelationAnalyzerScreen, {
      stocks: {},
      initialSymbols: ['SPY'],
      initialSeriesMap: { SPY: sA },
    })
  );
  assert.equal(singleHtml.includes('One Security Selected (SPY)'), true);

  // 4. Error state (API error / invalid ticker)
  const errorSeries: SecurityHistorySeries = {
    symbol: 'BADSYM',
    name: 'BADSYM',
    instrumentType: 'UNKNOWN',
    exchange: '',
    priceBasis: 'close',
    adjustedCloseAvailable: false,
    bars: [],
    earliestDate: null,
    latestDate: null,
    isInvalidTicker: true,
    error: 'Symbol "BADSYM" was not found in the market data directory.',
  };
  const errHtml = renderToStaticMarkup(
    React.createElement(CorrelationAnalyzerScreen, {
      stocks: {},
      initialSymbols: ['SPY', 'BADSYM'],
      initialSeriesMap: { SPY: sA, BADSYM: errorSeries },
    })
  );
  assert.equal(errHtml.includes('Historical Data Errors'), true);
  assert.equal(errHtml.includes('BADSYM'), true);
});

test('computeResponsiveChartWidth adapts cleanly across desktop, tablet, mobile, and fallback measurements', () => {
  // Desktop full-width Rolling Correlation and half-width Normalized Performance
  assert.equal(computeResponsiveChartWidth(1184.6, 680), 1184);
  assert.equal(computeResponsiveChartWidth(582.3, 520), 582);

  // Tablet single-column width
  assert.equal(computeResponsiveChartWidth(712, 520), 712);

  // Standard mobile width and narrow floor guard
  assert.equal(computeResponsiveChartWidth(328, 680), 328);
  assert.equal(computeResponsiveChartWidth(210, 680), 260);

  // SSR / unmeasured fallback
  assert.equal(computeResponsiveChartWidth(null, 680), 680);
  assert.equal(computeResponsiveChartWidth(0, 520), 520);
});
