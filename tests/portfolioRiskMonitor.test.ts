import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CommandPanel from '../src/components/CommandPanel';
import Workspace from '../src/components/Workspace';
import PortfolioRiskMonitorScreen from '../src/components/PortfolioRiskMonitorScreen';
import {
  DEFAULT_PORTFOLIO_THRESHOLDS,
  addPortfolioToStore,
  createEmptyPortfolioStore,
  createPortfolioAccount,
  deletePortfolioFromStore,
  loadPortfolioStore,
  loadPortfolioThresholds,
  removeHoldingFromPortfolio,
  savePortfolioStore,
  savePortfolioThresholds,
  setPortfolioCashBalance,
  updatePortfolioInStore,
  upsertHoldingInPortfolio,
} from '../src/utils/portfolioStorage';
import {
  detectCsvColumnMapping,
  parseCsvText,
  validateCsvImportRows,
} from '../src/utils/portfolioCsv';
import {
  computeDownsideScenario,
  computePortfolioRiskAnalysis,
} from '../src/utils/portfolioRiskEngine';
import {
  buildCorrelationMatrix,
  type DailyPricePoint,
  type SecurityHistorySeries,
} from '../src/utils/correlation';
import type { PortfolioSecurityMetadata, StockData } from '../src/types';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Generates deterministic daily adjusted-close series with known return patterns
 * so volatility, covariance, beta, correlation, and drawdown math can be verified exactly.
 */
function buildSeriesFromDailyReturns(
  symbol: string,
  name: string,
  dailyReturns: number[],
  startPrice = 100
): SecurityHistorySeries {
  const bars: DailyPricePoint[] = [];
  let price = startPrice;
  const start = new Date('2025-01-02T00:00:00Z');
  let tradingDayIdx = 0;

  bars.push({
    date: '2025-01-02',
    timestamp: Math.floor(start.getTime() / 1000),
    close: Number(price.toFixed(6)),
    adjClose: Number(price.toFixed(6)),
    usedAdjustedClose: true,
  });

  for (let i = 0; i < dailyReturns.length; i++) {
    tradingDayIdx += 1;
    const d = new Date(start.getTime() + tradingDayIdx * 86400_000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      tradingDayIdx += 1;
      d.setTime(start.getTime() + tradingDayIdx * 86400_000);
    }
    price = price * (1 + dailyReturns[i]);
    const rounded = Number(price.toFixed(6));
    bars.push({
      date: d.toISOString().slice(0, 10),
      timestamp: Math.floor(d.getTime() / 1000),
      close: rounded,
      adjClose: rounded,
      usedAdjustedClose: true,
    });
  }

  return {
    symbol,
    name,
    instrumentType: symbol === 'SPY' || symbol === 'TLT' ? 'ETF' : 'EQUITY',
    exchange: 'NASDAQ',
    currency: 'USD',
    priceBasis: 'adjclose',
    adjustedCloseAvailable: true,
    bars,
    earliestDate: bars[0]?.date ?? null,
    latestDate: bars[bars.length - 1]?.date ?? null,
  };
}

function makeFixtureData() {
  const n = 90;
  const spyReturns: number[] = [];
  const techAReturns: number[] = [];
  const techBReturns: number[] = [];
  const hedgeReturns: number[] = [];

  for (let i = 0; i < n; i++) {
    const wave1 = Math.sin((i + 1) * 0.45) * 0.012;
    const wave2 = Math.cos((i + 1) * 0.17) * 0.008;
    const drawShock = i >= 30 && i < 42 ? -0.015 : 0;
    const rSpy = wave1 + wave2 * 0.5 + drawShock;
    const idioA = Math.sin((i + 1) * 1.3) * 0.004;
    const idioB = Math.cos((i + 1) * 1.1) * 0.003;

    spyReturns.push(rSpy);
    techAReturns.push(rSpy * 1.4 + idioA);
    techBReturns.push(rSpy * 1.25 + idioA * 0.85 + idioB * 0.2);
    hedgeReturns.push(-rSpy * 0.6 + idioB * 0.4);
  }

  const spySeries = buildSeriesFromDailyReturns('SPY', 'SPDR S&P 500 ETF Trust', spyReturns, 500);
  const aaplSeries = buildSeriesFromDailyReturns('AAPL', 'Apple Inc.', techAReturns, 200);
  const msftSeries = buildSeriesFromDailyReturns('MSFT', 'Microsoft Corporation', techBReturns, 400);
  const tltSeries = buildSeriesFromDailyReturns('TLT', 'iShares 20+ Year Treasury Bond ETF', hedgeReturns, 90);

  const fetchedAt = '2026-01-15T12:00:00Z';
  const metadataMap: Record<string, PortfolioSecurityMetadata> = {
    AAPL: {
      symbol: 'AAPL',
      valid: true,
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      instrumentType: 'EQUITY',
      price: 200,
      prevClose: 198,
      changePercent: 1.01,
      sector: 'Technology',
      gicsSectorId: 'TECHNOLOGY',
      industry: 'Consumer Electronics',
      classificationMethod: 'yahoo_search',
      fetchedAt,
    },
    MSFT: {
      symbol: 'MSFT',
      valid: true,
      name: 'Microsoft Corporation',
      exchange: 'NASDAQ',
      instrumentType: 'EQUITY',
      price: 400,
      prevClose: 396,
      changePercent: 1.01,
      sector: 'Technology',
      gicsSectorId: 'TECHNOLOGY',
      industry: 'Software - Infrastructure',
      classificationMethod: 'yahoo_search',
      fetchedAt,
    },
    TLT: {
      symbol: 'TLT',
      valid: true,
      name: 'iShares 20+ Year Treasury Bond ETF',
      exchange: 'NASDAQ',
      instrumentType: 'ETF',
      price: 100,
      prevClose: 100,
      changePercent: 0,
      sector: null,
      gicsSectorId: null,
      industry: null,
      classificationMethod: 'unclassified_fund',
      fetchedAt,
    },
  };

  let portfolio = createPortfolioAccount('Core Growth', 10000);
  portfolio = upsertHoldingInPortfolio(portfolio, {
    ticker: 'AAPL',
    shares: 250, // $50,000 -> 50% of $100,000
    avgCostBasis: 160,
    source: 'manual',
  });
  portfolio = upsertHoldingInPortfolio(portfolio, {
    ticker: 'MSFT',
    shares: 75, // $30,000 -> 30% of $100,000
    avgCostBasis: 350,
    source: 'manual',
  });
  portfolio = upsertHoldingInPortfolio(portfolio, {
    ticker: 'TLT',
    shares: 100, // $10,000 -> 10% of $100,000
    avgCostBasis: 105,
    source: 'csv',
  });

  return {
    portfolio,
    metadataMap,
    historyMap: {
      AAPL: aaplSeries,
      MSFT: msftSeries,
      TLT: tltSeries,
    },
    spySeries,
  };
}

test('Navigation exposes PRM as a dedicated top-level workspace and HELP documents PRM', () => {
  const navHtml = renderToStaticMarkup(
    React.createElement(CommandPanel, {
      stocks: {},
      trackedTickers: ['AAPL', 'MSFT'],
      selectedTicker: 'AAPL',
      onSelectTicker: () => {},
      onReorderTicker: () => {},
      onRemoveTicker: () => {},
      onResetTrackedTickers: () => {},
      activeScreen: 'PRM',
      onSelectScreen: () => {},
    })
  );

  assert.match(navHtml, />PRM</);
  assert.match(navHtml, /PORTFOLIO RISK MONITOR/);
  assert.match(navHtml, /CORRELATION ANALYZER/);

  const helpHtml = renderToStaticMarkup(
    React.createElement(Workspace, {
      activeScreen: 'HELP',
      selectedTicker: 'AAPL',
      stocks: {},
      currencies: [],
      economics: [],
      onExecuteCommand: () => {},
    })
  );

  assert.match(helpHtml, /PRM/);
  assert.match(helpHtml, /Portfolio Risk Monitor/);
});

test('Portfolio storage supports empty default, multi-portfolio isolation, duplicate prevention, and localStorage round-trip', () => {
  const storage = new MemoryStorage();

  // Default state has no mock/simulated holdings
  const emptyStore = loadPortfolioStore(storage);
  assert.equal(emptyStore.portfolios.length, 0);
  assert.equal(emptyStore.activePortfolioId, null);

  // Create two independent portfolios via store helpers
  const step1 = addPortfolioToStore(createEmptyPortfolioStore(), 'Taxable Account', 5000);
  const p1Id = step1.created.id;
  let store = updatePortfolioInStore(step1.store, p1Id, (p) => {
    let next = upsertHoldingInPortfolio(p, {
      ticker: 'aapl',
      shares: 10,
      avgCostBasis: 150,
      source: 'manual',
    });
    // Replace mode overwrites without creating duplicate
    next = upsertHoldingInPortfolio(
      next,
      { ticker: 'AAPL', shares: 15, avgCostBasis: 160, source: 'manual' },
      'replace'
    );
    assert.equal(next.holdings.length, 1);
    assert.equal(next.holdings[0].shares, 15);
    assert.equal(next.holdings[0].avgCostBasis, 160);

    // Add mode merges shares and computes weighted average cost basis
    next = upsertHoldingInPortfolio(
      next,
      { ticker: 'AAPL', shares: 5, avgCostBasis: 200, source: 'csv' },
      'add'
    );
    return next;
  });

  const p1After = store.portfolios.find((p) => p.id === p1Id)!;
  assert.equal(p1After.holdings.length, 1);
  assert.equal(p1After.holdings[0].shares, 20);
  assert.ok(Math.abs((p1After.holdings[0].avgCostBasis ?? 0) - 170) < 1e-6);

  const step2 = addPortfolioToStore(store, 'IRA Retirement', 1250);
  const p2Id = step2.created.id;
  store = updatePortfolioInStore(step2.store, p2Id, (p) => {
    let next = upsertHoldingInPortfolio(p, {
      ticker: 'MSFT',
      shares: 8,
      avgCostBasis: 380,
      source: 'tracked_watchlist',
    });
    next = setPortfolioCashBalance(next, 2500);
    return next;
  });

  assert.equal(store.portfolios.length, 2);
  assert.equal(store.activePortfolioId, p2Id);

  // Persist and reload
  savePortfolioStore(storage, store);
  const reloaded = loadPortfolioStore(storage);
  assert.equal(reloaded.portfolios.length, 2);
  assert.equal(reloaded.portfolios[0].holdings[0].ticker, 'AAPL');
  assert.equal(reloaded.portfolios[1].holdings[0].ticker, 'MSFT');
  assert.equal(reloaded.portfolios[1].cashBalance, 2500);

  // Remove holding on p1 without affecting p2
  const afterUpdate = updatePortfolioInStore(reloaded, p1Id, (p) =>
    removeHoldingFromPortfolio(p, 'AAPL')
  );
  assert.equal(afterUpdate.portfolios[0].holdings.length, 0);
  assert.equal(afterUpdate.portfolios[1].holdings.length, 1);

  // Delete portfolio switches activePortfolioId cleanly
  const afterDelete = deletePortfolioFromStore(afterUpdate, p2Id);
  assert.equal(afterDelete.portfolios.length, 1);
  assert.equal(afterDelete.activePortfolioId, p1Id);

  // Thresholds persistence round-trip
  savePortfolioThresholds(storage, {
    ...DEFAULT_PORTFOLIO_THRESHOLDS,
    maxSinglePositionPct: 20,
  });
  const loadedThresholds = loadPortfolioThresholds(storage);
  assert.equal(loadedThresholds.maxSinglePositionPct, 20);
});

test('CSV parser, auto-mapper, and validator handle brokerage rows, cash, duplicates, missing cost basis, and invalid tickers', () => {
  const csv = [
    'Symbol,Description,Quantity,"Average Cost Basis",Current Value',
    'AAPL,"Apple, Inc.",10,$150.00,$2000.00',
    'AAPL,"Apple, Inc.",5,$180.00,$1000.00',
    'MSFT,Microsoft Corp,8,,$3200.00',
    'SPAXX,Fidelity Government Money Market,2500,$1.00,$2500.00',
    'BAD$$$,Broken Symbol,4,$10.00,$40.00',
    'NVDA,NVIDIA Corp,-2,$120.00,$0.00',
  ].join('\r\n');

  const parsed = parseCsvText(csv);
  assert.equal(parsed.headers.length, 5);
  assert.equal(parsed.rows.length, 6);

  const mapping = detectCsvColumnMapping(parsed.headers);
  assert.equal(mapping.tickerCol, 0);
  assert.equal(mapping.sharesCol, 2);
  assert.equal(mapping.costBasisCol, 3);
  assert.equal(mapping.marketValueCol, 4);

  const summary = validateCsvImportRows(parsed.rows, mapping, {
    duplicateStrategy: 'merge',
    existingHoldings: [
      {
        id: 'existing-1',
        ticker: 'MSFT',
        shares: 2,
        avgCostBasis: 300,
        source: 'manual',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  });

  assert.equal(summary.errorRowCount, 2); // BAD$$$ and NVDA negative shares
  assert.equal(summary.cashRowCount, 1); // SPAXX money market
  assert.equal(summary.detectedCashTotal, 2500);
  assert.equal(summary.duplicateRowCount, 1); // Second AAPL row
  assert.deepEqual(summary.existingOverlapTickers, ['MSFT']);
  assert.equal(summary.validHoldings.length, 2); // AAPL + MSFT

  const mergedAapl = summary.validHoldings.find((h) => h.ticker === 'AAPL');
  assert.ok(mergedAapl);
  assert.equal(mergedAapl.shares, 15);
  assert.ok(Math.abs((mergedAapl.avgCostBasis ?? 0) - 160) < 1e-6);

  const msftRow = summary.rows.find((r) => r.ticker === 'MSFT');
  assert.ok(msftRow);
  assert.equal(msftRow.existsInPortfolio, true);
  assert.ok(msftRow.warnings.some((w) => /cost basis/i.test(w)));

  // Skip strategy ignores second AAPL row instead of merging
  const skipSummary = validateCsvImportRows(parsed.rows, mapping, {
    duplicateStrategy: 'skip',
  });
  const skippedAapl = skipSummary.validHoldings.find((h) => h.ticker === 'AAPL');
  assert.equal(skippedAapl?.shares, 10);
});

test('Portfolio Risk Engine computes exact sizing, concentration, unclassified sectors, covariance volatility, CORR parity, and stress tests', () => {
  const { portfolio, metadataMap, historyMap, spySeries } = makeFixtureData();

  const analysis = computePortfolioRiskAnalysis({
    portfolio,
    metadataMap,
    stocksMap: {},
    historyMap,
    spySeries,
    lookbackPeriod: '90D',
    thresholds: DEFAULT_PORTFOLIO_THRESHOLDS,
  });

  // 1. Portfolio Valuation & Sizing
  assert.equal(analysis.totalPortfolioValue, 100000);
  assert.equal(analysis.totalEquityValue, 90000);
  assert.equal(analysis.cashBalance, 10000);
  assert.equal(analysis.cashWeightPct, 10);
  assert.equal(analysis.holdingCount, 3);
  assert.equal(analysis.concentration.largestPosition?.ticker, 'AAPL');
  assert.equal(analysis.concentration.largestPosition?.weightPct, 50);

  const aaplPos = analysis.positions.find((p) => p.ticker === 'AAPL')!;
  assert.equal(aaplPos.marketValue, 50000);
  assert.equal(aaplPos.unrealizedGain, 10000); // (200 - 160) * 250
  assert.equal(aaplPos.isOversized, true); // 50% > 15% default threshold

  // 2. Concentration & HHI
  assert.equal(analysis.concentration.top5WeightPct, 90);
  assert.equal(analysis.concentration.singleStockWeightPct, 80); // AAPL 50% + MSFT 30%
  assert.equal(analysis.concentration.etfFundWeightPct, 10); // TLT 10%
  // Total portfolio weights: AAPL 50%, MSFT 30%, TLT 10%, Cash 10% -> HHI = 2500+900+100+100 = 3600
  assert.ok(analysis.concentration.hhi !== null && Math.abs(analysis.concentration.hhi - 3600) < 1);
  assert.ok(analysis.concentration.warnings.length >= 1);

  // 3. Sector & Industry Exposure (no invented classifications for TLT)
  assert.equal(analysis.sectorExposure.benchmarkAvailable, false);
  assert.ok(analysis.sectorExposure.benchmarkUnavailableReason);
  const techSector = analysis.sectorExposure.sectors.find((s) => s.sector === 'Technology');
  const unclassifiedSector = analysis.sectorExposure.sectors.find((s) => !s.isClassified);
  assert.ok(techSector);
  assert.equal(techSector.portfolioWeightPct, 80); // AAPL 50% + MSFT 30%
  assert.equal(techSector.status, 'overweight');
  assert.ok(unclassifiedSector);
  assert.equal(unclassifiedSector.portfolioWeightPct, 10); // TLT remains explicitly Unclassified

  // 4. Covariance-weighted Volatility (NOT simple weighted average) + Euler Risk Contributions
  const vol = analysis.volatilityRisk;
  assert.ok(vol.portfolioVolatilityPct !== null);
  assert.ok(vol.weightedAvgHoldingVolPct !== null);
  assert.ok(vol.portfolioBetaVsSpy !== null && vol.portfolioBetaVsSpy > 0.8);
  assert.ok(vol.maxDrawdownPct !== null && vol.maxDrawdownPct < 0);
  assert.ok(vol.drawdownCurve.length > 20);

  // Verify diversification benefit: covariance-weighted vol < naive weighted average of individual vols
  assert.ok(
    vol.portfolioVolatilityPct < vol.weightedAvgHoldingVolPct,
    `Expected covariance vol (${vol.portfolioVolatilityPct.toFixed(2)}%) < weighted avg (${vol.weightedAvgHoldingVolPct.toFixed(2)}%)`
  );

  // Euler risk contributions must sum to 100%
  const totalRiskShare = analysis.positions.reduce(
    (sum, p) => sum + (p.riskContributionPct ?? 0),
    0
  );
  assert.ok(
    Math.abs(totalRiskShare - 100) < 0.5,
    `Expected Euler risk contributions to sum to 100%, got ${totalRiskShare}`
  );
  // TLT is negatively correlated, so its risk contribution should be negative (hedging)
  const tltPos = analysis.positions.find((p) => p.ticker === 'TLT')!;
  assert.ok((tltPos.riskContributionPct ?? 0) < 0);

  // 5. CORR Integration Parity: PRM reuses buildCorrelationMatrix directly
  const directCorr = buildCorrelationMatrix(
    [historyMap.AAPL, historyMap.MSFT, historyMap.TLT],
    '90D'
  );
  assert.deepEqual(analysis.diversification.matrix.symbols, directCorr.symbols);
  assert.deepEqual(analysis.diversification.matrix.cells, directCorr.cells);
  assert.ok(analysis.diversification.highlyCorrelatedPairs.length >= 1);
  assert.equal(analysis.diversification.highlyCorrelatedPairs[0].symbolA, 'AAPL');
  assert.equal(analysis.diversification.highlyCorrelatedPairs[0].symbolB, 'MSFT');
  assert.ok(analysis.diversification.clusters.length >= 1);

  // 6. Downside Risk Scenarios (SPY -5/-10/-15/-20, custom sector shock, multi-position shock)
  assert.equal(analysis.marketScenarios.length, 4);
  const spy10 = analysis.marketScenarios.find((s) => s.id === 'spy-10')!;
  assert.ok(spy10.estimatedLossDollars < 0);
  assert.equal(
    Number((spy10.remainingPortfolioValue - (100000 + spy10.estimatedLossDollars)).toFixed(2)),
    0
  );

  // Custom sector shock: Technology -20% hits AAPL (-$10,000) and MSFT (-$6,000), leaves TLT & Cash untouched
  const techShock = computeDownsideScenario({
    id: 'custom-tech',
    name: 'Technology -20%',
    category: 'sector',
    description: 'Test sector stress',
    methodologyNote: 'Test',
    positions: analysis.positions,
    cashBalance: analysis.cashBalance,
    totalPortfolioValue: analysis.totalPortfolioValue,
    sectorShock: { sector: 'Technology', shockPct: -20 },
  });
  assert.equal(techShock.estimatedLossDollars, -16000);
  assert.equal(techShock.estimatedLossPct, -16);
  assert.equal(techShock.remainingPortfolioValue, 84000);

  // Custom simultaneous multi-position shock: AAPL -30% (-$15,000) and TLT +10% (+$1,000) => -$14,000
  const multiShock = computeDownsideScenario({
    id: 'custom-multi',
    name: 'Simultaneous Shock',
    category: 'position',
    description: 'Test multi-position stress',
    methodologyNote: 'Test',
    positions: analysis.positions,
    cashBalance: analysis.cashBalance,
    totalPortfolioValue: analysis.totalPortfolioValue,
    positionShocks: { AAPL: -30, TLT: 10 },
  });
  assert.equal(multiShock.estimatedLossDollars, -14000);
  assert.equal(multiShock.remainingPortfolioValue, 86000);
});

test('PortfolioRiskMonitorScreen renders empty onboarding state and complete 7-section analytics workspace without errors', () => {
  // 1. Empty state (no mock portfolio data)
  const emptyHtml = renderToStaticMarkup(
    React.createElement(PortfolioRiskMonitorScreen, {
      stocks: {},
      trackedTickers: ['AAPL', 'MSFT'],
      initialStore: createEmptyPortfolioStore(),
      disableAutoFetch: true,
    })
  );

  assert.match(emptyHtml, /Portfolio Risk Monitor/i);
  assert.match(emptyHtml, /NO PERSONAL PORTFOLIO CONFIGURED/);
  assert.match(emptyHtml, /ADD HOLDINGS MANUALLY/);
  assert.match(emptyHtml, /IMPORT BROKERAGE CSV/);
  assert.match(emptyHtml, /SEED FROM TRACKED EQUITIES/);

  // 2. Populated 7-section analytics state
  const { portfolio, metadataMap, historyMap, spySeries } = makeFixtureData();
  const populatedStore = {
    version: 1 as const,
    activePortfolioId: portfolio.id,
    portfolios: [portfolio],
  };
  const stocks: Record<string, StockData> = {
    AAPL: {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 200,
      change: 2,
      changePercent: 1.01,
      high: 202,
      low: 197,
      open: 199,
      prevClose: 198,
      volume: 1000000,
      marketCap: '3.0T',
      peRatio: 30,
      beta: 1.2,
      history: [],
    },
  };

  const fullHtml = renderToStaticMarkup(
    React.createElement(PortfolioRiskMonitorScreen, {
      stocks,
      trackedTickers: ['AAPL', 'MSFT'],
      initialStore: populatedStore,
      initialMetadataMap: metadataMap,
      initialHistoryMap: historyMap,
      initialSpySeries: spySeries,
      initialLookback: '90D',
      disableAutoFetch: true,
      onOpenCorrWorkspace: () => {},
    })
  );

  // Verify all 7 required analytical sections render
  assert.match(fullHtml, /PORTFOLIO OVERVIEW/);
  assert.match(fullHtml, /PORTFOLIO CONCENTRATION/);
  assert.match(fullHtml, /SECTOR &amp; INDUSTRY EXPOSURE/);
  assert.match(fullHtml, /POSITION SIZING &amp; ALLOCATION/);
  assert.match(fullHtml, /VOLATILITY &amp; PORTFOLIO RISK/);
  assert.match(fullHtml, /PORTFOLIO DIVERSIFICATION &amp; CORRELATION RISK/);
  assert.match(fullHtml, /DOWNSIDE RISK SCENARIOS &amp; STRESS TESTS/);

  // Verify key analytics output & transparent disclaimers appear
  assert.match(fullHtml, /\$100,000\.00/);
  assert.match(fullHtml, /Unclassified/);
  assert.match(fullHtml, /OPEN IN CORR/);
  assert.match(fullHtml, /hypothetical stress test/i);
});
