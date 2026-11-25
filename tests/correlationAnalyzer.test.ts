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
  CORRELATION_LEGEND_BANDS,
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

test('Command line and Workspace route BWRITE legacy alias directly to ASK', () => {
  // CommandPanel should NOT list BWRITE as an explicit command shortcut or separate entry
  const panelHtml = renderToStaticMarkup(
    React.createElement(CommandPanel, {
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      selectedTicker: 'AAPL',
      onSelectTicker: () => {},
      onReorderTicker: () => {},
      onRemoveTicker: () => {},
      onResetTrackedTickers: () => {},
      activeScreen: 'ASK',
      onSelectScreen: () => {},
    })
  );
  assert.equal(panelHtml.includes('id="cmd-shortcut-ASK"'), true);
  assert.equal(panelHtml.includes('id="cmd-shortcut-BWRITE"'), false);

  // Workspace rendered with activeScreen='BWRITE' or 'ASK' resolves to same QUORIX INTELLIGENCE interface
  const askHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'ASK',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );

  const bwriteHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'BWRITE',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );

  assert.equal(askHtml.includes('QUORIX INTELLIGENCE'), true);
  assert.equal(bwriteHtml.includes('QUORIX INTELLIGENCE'), true);
  assert.equal(askHtml.includes('QI — ASK COMMAND EXAMPLES'), true);
  assert.equal(bwriteHtml.includes('QI — ASK COMMAND EXAMPLES'), true);
});

test('ASK and BWRITE commands with ticker prefill prompt, leave input empty when tickerless, and do not auto-submit', () => {
  // 1. Ticker-qualified ASK prefill: "AAPL ASK" produces askPrefillPrompt with "Give me a brief analysis of AAPL"
  const prefilledHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'ASK',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
      askPrefillPrompt: { id: 1, text: 'Give me a brief analysis of AAPL' },
      pendingAiQuery: null, // Critical: no auto-submit
    })
  );
  assert.equal(prefilledHtml.includes('value="Give me a brief analysis of AAPL"'), true);
  // Verify no immediate response / no auto-submit message rendered
  assert.equal(prefilledHtml.includes('UNABLE TO REACH LIVE TERMINAL ANALYSIS SERVICE'), false);

  // 2. Ticker-qualified BWRITE alias prefill: "NVDA BWRITE" produces identical prefill behavior
  const bwritePrefilledHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'BWRITE',
      selectedTicker: 'NVDA',
      stocks: { NVDA: makeDummyStock('NVDA') },
      trackedTickers: ['NVDA'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
      askPrefillPrompt: { id: 2, text: 'Give me a brief analysis of NVDA' },
      pendingAiQuery: null,
    })
  );
  assert.equal(bwritePrefilledHtml.includes('value="Give me a brief analysis of NVDA"'), true);
  assert.equal(bwritePrefilledHtml.includes('UNABLE TO REACH LIVE TERMINAL ANALYSIS SERVICE'), false);

  // 3. Plain "ASK" alone: leaves input empty
  const plainAskHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'ASK',
      selectedTicker: 'AAPL',
      stocks: { AAPL: makeDummyStock('AAPL') },
      trackedTickers: ['AAPL'],
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
      askPrefillPrompt: null,
      pendingAiQuery: null,
    })
  );
  assert.equal(plainAskHtml.includes('value=""'), true);
  assert.equal(plainAskHtml.includes('value="Give me a brief analysis of'), false);
});

test('ASK prefill clears stale prefill when navigating away but preserves user-typed input', () => {
  // Pure logic session simulating Workspace prefill lifecycle
  function createAskInputSession(initialPrefill: string | null) {
    let userInput = initialPrefill || '';
    let lastPrefillText: string | null = initialPrefill;

    return {
      getUserInput: () => userInput,
      getLastPrefill: () => lastPrefillText,
      receivePrefill: (text: string) => {
        lastPrefillText = text;
        userInput = text;
      },
      userEdit: (newText: string) => {
        lastPrefillText = null; // Clear stored prefill reference when user edits input
        userInput = newText;
      },
      changeScreen: (newScreen: string) => {
        if (newScreen !== 'ASK' && newScreen !== 'BWRITE') {
          // If input value still exactly equals the last auto-generated prefill text, clear it
          if (lastPrefillText !== null && userInput === lastPrefillText) {
            userInput = '';
          }
          lastPrefillText = null;
        }
      },
    };
  }

  // Case (a): Untouched prefill is cleared when navigating away from ASK
  const untouchedSession = createAskInputSession('Give me a brief analysis of AAPL');
  assert.equal(untouchedSession.getUserInput(), 'Give me a brief analysis of AAPL');
  untouchedSession.changeScreen('GP');
  assert.equal(untouchedSession.getUserInput(), '', 'Untouched prefill must be cleared when leaving ASK screen');
  assert.equal(untouchedSession.getLastPrefill(), null);

  // Case (b): User-typed or edited input is preserved when navigating away
  const editedSession = createAskInputSession('Give me a brief analysis of AAPL');
  editedSession.userEdit('Compare NVDA balance sheet with AAPL');
  assert.equal(editedSession.getLastPrefill(), null, 'Stored prefill reference must be cleared on edit');
  editedSession.changeScreen('GP');
  assert.equal(
    editedSession.getUserInput(),
    'Compare NVDA balance sheet with AAPL',
    'User-edited input must be preserved when leaving ASK screen'
  );
  editedSession.changeScreen('ASK');
  assert.equal(
    editedSession.getUserInput(),
    'Compare NVDA balance sheet with AAPL',
    'User-edited input must remain preserved upon returning to ASK screen'
  );
});

test('invalid ticker does not prefill prompt or call AI', async () => {
  // Simulate command resolution and validation logic from App.tsx
  const { resolveEquitySearch } = await import('../src/utils/equityValidation.ts');

  let prefillSet: { id: number; text: string } | null = null;
  let aiCalled = false;

  async function simulateCommand(rawTicker: string, cmd: string, mockFetch: typeof fetch) {
    const ticker = rawTicker.toUpperCase().trim();
    const targetScreen = cmd === 'BWRITE' ? 'ASK' : cmd;

    // In App.tsx: If ticker is not already tracked, validate through resolveEquitySearch
    const res = await resolveEquitySearch(ticker, mockFetch);
    if (res.accepted && targetScreen === 'ASK') {
      const resolvedSym = res.stock?.symbol || ticker;
      prefillSet = { id: Date.now(), text: `Give me a brief analysis of ${resolvedSym}` };
    } else {
      // Invalid ticker: do NOT prefill, do NOT call AI
      prefillSet = null;
      aiCalled = false;
    }
    return res;
  }

  // Mock fetch rejecting invalid ticker 'ZZZZ'
  const mockFetchInvalid = (async () => {
    return new Response(
      JSON.stringify({
        success: false,
        isInvalidTicker: true,
        error: 'No valid equity found for symbol "ZZZZ".',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const invalidRes = await simulateCommand('ZZZZ', 'ASK', mockFetchInvalid);
  assert.equal(invalidRes.accepted, false);
  assert.equal(invalidRes.isInvalidTicker, true);
  assert.equal(prefillSet, null, 'Prefill must NOT be set for invalid ticker');
  assert.equal(aiCalled, false, 'AI must NOT be called for invalid ticker');

  // Verify valid ticker 'AAPL' does validate and set prefill
  const mockFetchValid = (async () => {
    return new Response(
      JSON.stringify({
        success: true,
        quote: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          exchange: 'NASDAQ',
          instrumentType: 'EQUITY',
          price: 230.5,
          volume: 45000000,
          isValidSecurity: true,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const validRes = await simulateCommand('AAPL', 'ASK', mockFetchValid);
  assert.equal(validRes.accepted, true);
  assert.ok(prefillSet !== null, 'Prefill must be set for valid ticker');
  assert.equal((prefillSet as any).text, 'Give me a brief analysis of AAPL');
});

test('command-line parser pure logic: multi-word aliases, ticker positions, and race condition prevention', async () => {
  const { parseCommandLineInput } = await import('../src/utils/commandParser.ts');

  // 1. Multi-word command names and aliases match BEFORE ticker parsing and do not select command words as tickers
  assert.deepEqual(parseCommandLineInput('GRAPH PRICE'), { type: 'SCREEN', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('PORTFOLIO RISK MONITOR'), { type: 'SCREEN', screen: 'PRM' });
  assert.deepEqual(parseCommandLineInput('HISTORICAL PRICING'), { type: 'SCREEN', screen: 'HP' });
  assert.deepEqual(parseCommandLineInput('CORRELATION ANALYZER'), { type: 'SCREEN', screen: 'CORR' });
  assert.deepEqual(parseCommandLineInput('ASK QUORIX'), { type: 'SCREEN', screen: 'ASK' });
  assert.deepEqual(parseCommandLineInput('SECURITY ANALYTICS'), { type: 'SCREEN', screen: 'DES' });
  assert.deepEqual(parseCommandLineInput('ANALYST RECS'), { type: 'SCREEN', screen: 'ANR' });
  assert.deepEqual(parseCommandLineInput('INSTITUTIONAL ACTIVITY'), { type: 'SCREEN', screen: 'INST' });
  assert.deepEqual(parseCommandLineInput('ECONOMIC INDICATOR'), { type: 'SCREEN', screen: 'ECO' });
  assert.deepEqual(parseCommandLineInput('POLYMARKET SCREENER'), { type: 'SCREEN', screen: 'POLY' });
  assert.deepEqual(parseCommandLineInput('SYSTEM SETTINGS'), { type: 'SCREEN', screen: 'SETT' });
  assert.deepEqual(parseCommandLineInput('USER MANUAL'), { type: 'SCREEN', screen: 'HELP' });

  // 2. Ticker prefix and suffix syntax: "<TICKER> <COMMAND>" and "<COMMAND> <TICKER>"
  assert.deepEqual(parseCommandLineInput('AAPL GP'), { type: 'TICKER_SCREEN', ticker: 'AAPL', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('GP AAPL'), { type: 'TICKER_SCREEN', ticker: 'AAPL', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('AAPL GRAPH PRICE'), { type: 'TICKER_SCREEN', ticker: 'AAPL', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('GRAPH PRICE AAPL'), { type: 'TICKER_SCREEN', ticker: 'AAPL', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('MSFT PORTFOLIO RISK MONITOR'), { type: 'TICKER_SCREEN', ticker: 'MSFT', screen: 'PRM' });
  assert.deepEqual(parseCommandLineInput('PORTFOLIO RISK MONITOR MSFT'), { type: 'TICKER_SCREEN', ticker: 'MSFT', screen: 'PRM' });
  assert.deepEqual(parseCommandLineInput('NVDA ASK'), { type: 'TICKER_SCREEN', ticker: 'NVDA', screen: 'ASK' });
  assert.deepEqual(parseCommandLineInput('ASK NVDA'), { type: 'TICKER_SCREEN', ticker: 'NVDA', screen: 'ASK' });
  assert.deepEqual(parseCommandLineInput('NVDA BWRITE'), { type: 'TICKER_SCREEN', ticker: 'NVDA', screen: 'ASK' });

  // 3. Command words alone must never be treated as tickers
  assert.deepEqual(parseCommandLineInput('GP'), { type: 'SCREEN', screen: 'GP' });
  assert.deepEqual(parseCommandLineInput('ASK'), { type: 'SCREEN', screen: 'ASK' });
  assert.deepEqual(parseCommandLineInput('NEWS'), { type: 'SCREEN', screen: 'NEWS' });
  assert.deepEqual(parseCommandLineInput('ECO'), { type: 'SCREEN', screen: 'ECO' });

  // 4. Pure state harness simulating App.tsx command submission, validation, and async race guard
  function createTerminalParserSession() {
    let selectedTicker = 'AAPL';
    let activeScreen = 'GP';
    let errorMessage: string | null = null;
    let activeValidationToken = 0;
    const trackedTickers = ['AAPL', 'MSFT', 'GOOG'];

    const executeCommand = async (
      rawInput: string,
      validateFn: (sym: string) => Promise<{ accepted: boolean; symbol: string }>
    ) => {
      errorMessage = null;
      const parsed = parseCommandLineInput(rawInput);
      const executionToken = ++activeValidationToken;

      if (parsed.type === 'SCREEN') {
        activeScreen = parsed.screen;
        return;
      }

      if (parsed.type === 'TICKER_SCREEN') {
        const ticker = parsed.ticker.toUpperCase();
        const targetScreen = parsed.screen;

        if (trackedTickers.includes(ticker)) {
          selectedTicker = ticker;
          activeScreen = targetScreen;
          return;
        }

        // Untracked ticker: token-based race protection
        const res = await validateFn(ticker);
        if (executionToken !== activeValidationToken) {
          // Out of order response: discard
          return;
        }

        if (res.accepted) {
          selectedTicker = res.symbol;
          activeScreen = targetScreen;
        } else {
          errorMessage = `${ticker}: ticker not found`;
        }
      }
    };

    return {
      getState: () => ({ selectedTicker, activeScreen, errorMessage }),
      executeCommand,
    };
  }

  // 4a. Invalid ticker leaves selectedTicker and screen unchanged
  const session1 = createTerminalParserSession();
  await session1.executeCommand('ZZZZ ASK', async () => ({ accepted: false, symbol: 'ZZZZ' }));
  assert.deepEqual(session1.getState(), {
    selectedTicker: 'AAPL', // Unchanged
    activeScreen: 'GP',     // Unchanged
    errorMessage: 'ZZZZ: ticker not found',
  });

  // 4b. Out-of-order pending validation does not overwrite a newer command
  const session2 = createTerminalParserSession();
  let slowResolve: (val: any) => void = () => {};
  const slowPromise = new Promise<{ accepted: boolean; symbol: string }>((resolve) => {
    slowResolve = resolve;
  });

  // Command 1: Slow validation for untracked ticker 'SLOW'
  const cmd1Promise = session2.executeCommand('SLOW GP', () => slowPromise);

  // Command 2: Fast command for tracked ticker 'MSFT'
  await session2.executeCommand('MSFT ASK', async () => ({ accepted: true, symbol: 'MSFT' }));
  assert.equal(session2.getState().selectedTicker, 'MSFT');
  assert.equal(session2.getState().activeScreen, 'ASK');

  // Command 1 resolves late: must be safely discarded by activeValidationToken
  slowResolve({ accepted: true, symbol: 'SLOW' });
  await cmd1Promise;

  assert.equal(
    session2.getState().selectedTicker,
    'MSFT',
    'Out-of-order slow validation must not overwrite newer selected ticker'
  );
  assert.equal(
    session2.getState().activeScreen,
    'ASK',
    'Out-of-order slow validation must not overwrite newer active screen'
  );
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

test('interpretCorrelation maps all 7 interpretation bands accurately with symmetric boundaries', () => {
  assert.deepEqual(
    CORRELATION_LEGEND_BANDS.map((b) => [b.label, b.rangeLabel]),
    [
      ['Strong positive', '+0.80 to +1.00'],
      ['Moderate positive', '+0.40 to +0.79'],
      ['Weak positive', '+0.10 to +0.39'],
      ['Little or no correlation', '-0.09 to +0.09'],
      ['Weak negative', '-0.39 to -0.10'],
      ['Moderate negative', '-0.79 to -0.40'],
      ['Strong negative', '-1.00 to -0.80'],
    ]
  );

  // Positive and negative exact boundary symmetry (no overlaps, no gaps)
  assert.equal(interpretCorrelation(1.0).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.95).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.8).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.795).label, 'Strong positive');
  assert.equal(interpretCorrelation(0.79).label, 'Moderate positive');
  assert.equal(interpretCorrelation(0.65).label, 'Moderate positive');
  assert.equal(interpretCorrelation(0.4).label, 'Moderate positive');
  assert.equal(interpretCorrelation(0.395).label, 'Moderate positive');
  assert.equal(interpretCorrelation(0.39).label, 'Weak positive');
  assert.equal(interpretCorrelation(0.25).label, 'Weak positive');
  assert.equal(interpretCorrelation(0.1).label, 'Weak positive');
  assert.equal(interpretCorrelation(0.095).label, 'Weak positive');
  assert.equal(interpretCorrelation(0.09).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(0.05).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(0).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(-0.08).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(-0.09).label, 'Little or no correlation');
  assert.equal(interpretCorrelation(-0.095).label, 'Weak negative');
  assert.equal(interpretCorrelation(-0.1).label, 'Weak negative');
  assert.equal(interpretCorrelation(-0.25).label, 'Weak negative');
  assert.equal(interpretCorrelation(-0.39).label, 'Weak negative');
  assert.equal(interpretCorrelation(-0.395).label, 'Moderate negative');
  assert.equal(interpretCorrelation(-0.4).label, 'Moderate negative');
  assert.equal(interpretCorrelation(-0.6).label, 'Moderate negative');
  assert.equal(interpretCorrelation(-0.79).label, 'Moderate negative');
  assert.equal(interpretCorrelation(-0.795).label, 'Strong negative');
  assert.equal(interpretCorrelation(-0.8).label, 'Strong negative');
  assert.equal(interpretCorrelation(-0.85).label, 'Strong negative');
  assert.equal(interpretCorrelation(-1.0).label, 'Strong negative');
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

  // Rolling correlation legend labels placed centered below the chart
  const rollingSvgIdx = populatedHtml.indexOf('viewBox="0 0 680 210"');
  const posLegendIdx = populatedHtml.indexOf('POSITIVE (+1.00)');
  const negLegendIdx = populatedHtml.indexOf('NEGATIVE (-1.00)');
  assert.ok(rollingSvgIdx > -1 && posLegendIdx > rollingSvgIdx && negLegendIdx > rollingSvgIdx, 'Legend labels must appear below the chart SVG');
  assert.equal(populatedHtml.includes('text-[#00ff00]">POSITIVE (+1.00)</span>'), true);
  assert.equal(populatedHtml.includes('text-[#ff4444]">NEGATIVE (-1.00)</span>'), true);

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

  // Continuous correlation scale legend replaces the old 7-card grid
  assert.equal(populatedHtml.includes('CORRELATION SCALE'), true);
  assert.equal(populatedHtml.includes('xl:grid-cols-7'), false);
  assert.equal(populatedHtml.includes('>-1.0<'), true);
  assert.equal(populatedHtml.includes('>0<'), true);
  assert.equal(populatedHtml.includes('>+1.0<'), true);
  assert.equal(populatedHtml.includes('NEGATIVE'), true);
  assert.equal(populatedHtml.includes('Move in opposite directions'), true);
  assert.equal(populatedHtml.includes('NEAR ZERO'), true);
  assert.equal(populatedHtml.includes('Little or no relationship'), true);
  assert.equal(populatedHtml.includes('POSITIVE'), true);
  assert.equal(populatedHtml.includes('Move in the same direction'), true);
  assert.equal(
    populatedHtml.includes("Correlation measures how closely two securities&#x27; daily returns move together. Correlation does not establish causation."),
    false
  );

  // Old mismatched band tooltip ranges must no longer exist
  for (const staleRange of ['+0.50 to +0.79', '+0.20 to +0.49', '-0.19 to +0.19', '-0.49 to -0.20', '-0.79 to -0.50']) {
    assert.equal(populatedHtml.includes(staleRange), false, `Stale inconsistent range still rendered: ${staleRange}`);
  }

  // Contextual tooltips across configuration, matrix cells, scale classifications popover, KPIs, charts, and insights
  const expectedTooltipFragments = [
    'Historical period used for correlation calculations.',
    'daily percentage returns from consecutive trading sessions.',
    'strength and direction of the linear relationship',
    'separate from the overall lookback period.',
    'Each cell represents the Pearson correlation',
    'SPY / QQQ · Pearson:',
    'Self-correlation: 1.00',
    '+1 indicates perfect positive correlation, 0 indicates no linear correlation, and -1 indicates perfect negative correlation.',
    'Strong positive: +0.80 to +1.00',
    'Moderate positive: +0.40 to +0.79',
    'Weak positive: +0.10 to +0.39',
    'Little or no correlation: -0.09 to +0.09',
    'Weak negative: -0.39 to -0.10',
    'Moderate negative: -0.79 to -0.40',
    'Strong negative: -1.00 to -0.80',
    'changes over time using a moving observation window.',
    'Compares historical percentage performance using Base 100: both securities are indexed to a common starting value of 100 so their percentage performance can be compared regardless of share price.',
    'Each point represents the daily percentage returns of both securities on the same trading date. The fitted orange line is the ordinary least squares (OLS) regression line, showing their best-fitting linear relationship.',
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

  // Verify PAIRWISE COMPARISON contains exactly the 7 designated tooltip icons and none of the 6 removed ones
  const pairwiseStart = populatedHtml.indexOf('PAIRWISE COMPARISON');
  const insightsStart = populatedHtml.indexOf('CORRELATION INSIGHTS');
  assert.ok(pairwiseStart > -1 && insightsStart > pairwiseStart, 'Expected PAIRWISE COMPARISON before CORRELATION INSIGHTS');
  const pairwiseSectionHtml = populatedHtml.slice(pairwiseStart, insightsStart);

  const expectedPairwiseTooltipLabels = [
    'Rolling window explanation',
    'Pearson correlation explanation',
    'Same-direction sessions explanation',
    'Overlapping observations explanation',
    'Rolling correlation explanation',
    'Normalized performance explanation',
    'Return distribution scatter plot explanation',
  ];
  for (const label of expectedPairwiseTooltipLabels) {
    const matches = pairwiseSectionHtml.match(new RegExp(`aria-label="${label}"`, 'g')) || [];
    assert.equal(matches.length, 1, `Expected exactly 1 tooltip icon for "${label}" in PAIRWISE COMPARISON`);
  }

  const removedPairwiseTooltipLabels = [
    'Correlation interpretation explanation',
    'Latest rolling correlation explanation',
    'Zero reference line explanation',
    'Base 100 explanation',
    'OLS regression line explanation',
  ];
  for (const label of removedPairwiseTooltipLabels) {
    assert.equal(
      pairwiseSectionHtml.includes(`aria-label="${label}"`),
      false,
      `Removed tooltip icon should not appear in PAIRWISE COMPARISON: ${label}`
    );
  }

  // Verify labels and chart legends are still preserved after removing redundant tooltip icons
  for (const preservedLabel of ['INTERPRETATION', 'LATEST 30D ROLLING', '0.00 line', 'BASE 100', 'OLS REGRESSION']) {
    assert.equal(
      pairwiseSectionHtml.includes(preservedLabel),
      true,
      `Expected preserved label/legend in PAIRWISE COMPARISON: ${preservedLabel}`
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

test('CorrelationAnalyzerScreen renders frozen top controls wrapper with sticky classes and no overflow-hidden', () => {
  const dates = buildTradingDates(40);
  const returnsA = Array.from({ length: 39 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
  const returnsB = Array.from({ length: 39 }, (_, i) => (i % 3 === 0 ? -0.015 : 0.012));
  const sA = buildSeriesFromReturns('AAPL', 'Apple Inc.', dates, returnsA);
  const sB = buildSeriesFromReturns('MSFT', 'Microsoft Corp.', dates, returnsB);

  const html = renderToStaticMarkup(
    React.createElement(CorrelationAnalyzerScreen, {
      stocks: {},
      initialSymbols: ['AAPL', 'MSFT'],
      initialSeriesMap: { AAPL: sA, MSFT: sB },
    })
  );

  // Wrapper asserts
  assert.ok(
    html.includes('sticky') && html.includes('z-30') && html.includes('bg-black'),
    'Frozen wrapper must include sticky, z-30, and bg-black'
  );
  assert.ok(
    html.includes('lg:[@media(min-height:800px)]:sticky'),
    'Frozen wrapper must be enabled conditionally via min-height 800px on lg+'
  );
  assert.ok(
    html.includes('lg:[@media(min-height:800px)]:-top-4'),
    'Frozen wrapper must use -top-4 to cover scroller padding when sticky'
  );

  // Content inside frozen block: Header card and SECURITY SELECTION
  const headerIdx = html.indexOf('CORRELATION ANALYZER');
  const secSelectIdx = html.indexOf('SECURITY SELECTION');
  const matrixIdx = html.indexOf('CORRELATION MATRIX');
  const pairwiseIdx = html.indexOf('PAIRWISE COMPARISON');
  const insightsIdx = html.indexOf('CORRELATION INSIGHTS');

  assert.ok(headerIdx !== -1, 'Header must be rendered');
  assert.ok(secSelectIdx !== -1, 'Security selection must be rendered');
  assert.ok(matrixIdx !== -1, 'Matrix must be rendered');
  assert.ok(pairwiseIdx !== -1, 'Pairwise comparison must be rendered');
  assert.ok(insightsIdx !== -1, 'Insights must be rendered');

  // Verify order: header -> security selection -> matrix -> pairwise -> insights
  assert.ok(headerIdx < secSelectIdx);
  assert.ok(secSelectIdx < matrixIdx);
  assert.ok(matrixIdx < pairwiseIdx);
  assert.ok(pairwiseIdx < insightsIdx);

  // Assert that matrix and subsequent sections are outside the frozen wrapper
  // The frozen wrapper ends after security selection and before the matrix
  const frozenWrapperEnd = html.indexOf('SECURITY SELECTION');
  const matrixTableIdx = html.indexOf('CORRELATION MATRIX');
  assert.ok(matrixTableIdx > frozenWrapperEnd);
});

