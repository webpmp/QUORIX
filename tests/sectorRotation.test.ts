import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GICS_SECTORS,
  aggregateInstitutionalBySector,
  buildSectorMarketPerformance,
  classifyInsiderSentiment,
  classifySectorRotation,
  computePeriodReturn,
  finalizeMarketRankingsAndOverview,
  isBroadMarketOrMultiSectorFund,
  mapMarketSectorToGicsSector,
  mapSicToGicsSector,
  matchDirectSectorEtf,
  normalizeCompanyMatchKey,
  type ClassifiedSecurityMeta,
} from '../src/utils/sectorRotation';
import type {
  InstitutionalAccumulationRow,
  InstitutionalPositionChangeRow,
  SectorPerformancePeriod,
  SectorPeriodReturnPoint,
  SectorPriceHistoryPoint,
  SectorRotationItem,
} from '../src/types';

function makeDailyBars(startIso: string, endIso: string, startClose: number, endClose: number): SectorPriceHistoryPoint[] {
  const bars: SectorPriceHistoryPoint[] = [];
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  const endMs = Date.parse(`${endIso}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const dates: string[] = [];
  for (let t = startMs; t <= endMs; t += dayMs) {
    const dt = new Date(t);
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    dates.push(dt.toISOString().slice(0, 10));
  }
  const n = Math.max(1, dates.length - 1);
  dates.forEach((date, i) => {
    const close = startClose + ((endClose - startClose) * i) / n;
    bars.push({ date, close: Number(close.toFixed(4)) });
  });
  return bars;
}

test('GICS_SECTORS defines all 11 standard US sectors with unique SPDR ETFs and representative SICs', () => {
  assert.equal(GICS_SECTORS.length, 11);
  const etfs = new Set(GICS_SECTORS.map((s) => s.etfTicker));
  assert.equal(etfs.size, 11);
  for (const s of GICS_SECTORS) {
    assert.ok(s.representativeSics.length >= 3, `Expected representative SICs for ${s.name}`);
  }
});

test('computePeriodReturn computes exact lookback returns and returns null on insufficient history', () => {
  const bars: SectorPriceHistoryPoint[] = [
    { date: '2026-05-01', close: 100 },
    { date: '2026-08-03', close: 110 },
    { date: '2026-10-01', close: 120 },
    { date: '2026-10-23', close: 125 },
    { date: '2026-10-30', close: 130 },
  ];

  const r1w = computePeriodReturn(bars, '1W');
  assert.equal(r1w.startDate, '2026-10-23');
  assert.equal(r1w.endDate, '2026-10-30');
  assert.ok(r1w.returnPct !== null);
  assert.ok(Math.abs(r1w.returnPct - 4.0) < 0.001);

  const r1m = computePeriodReturn(bars, '1M');
  assert.equal(r1m.startDate, '2026-08-03'); // latest bar <= 2026-09-30
  assert.ok(r1m.returnPct !== null);
  assert.ok(Math.abs(r1m.returnPct - ((130 - 110) / 110) * 100) < 0.001);

  const r6m = computePeriodReturn(bars, '6M');
  assert.equal(r6m.startDate, '2026-05-01');
  assert.ok(r6m.returnPct !== null);
  assert.ok(Math.abs(r6m.returnPct - 30.0) < 0.001);

  // Short history (only 10 days) must NOT fabricate 3M or 6M returns
  const shortBars: SectorPriceHistoryPoint[] = [
    { date: '2026-10-20', close: 100 },
    { date: '2026-10-23', close: 102 },
    { date: '2026-10-30', close: 105 },
  ];
  assert.ok(computePeriodReturn(shortBars, '1W').returnPct !== null);
  assert.equal(computePeriodReturn(shortBars, '1M').returnPct, null);
  assert.equal(computePeriodReturn(shortBars, '3M').returnPct, null);
  assert.equal(computePeriodReturn(shortBars, '6M').returnPct, null);
});

test('classifySectorRotation implements transparent quadrant rules across all periods', () => {
  assert.equal(
    classifySectorRotation('3M', { '1W': 1.0, '1M': 2.0, '3M': 5.0, '6M': 8.0 }),
    'LEADING'
  );
  assert.equal(
    classifySectorRotation('3M', { '1W': -1.0, '1M': -1.5, '3M': 4.0, '6M': 6.0 }),
    'WEAKENING'
  );
  assert.equal(
    classifySectorRotation('3M', { '1W': 1.2, '1M': 1.5, '3M': -3.0, '6M': -5.0 }),
    'IMPROVING'
  );
  assert.equal(
    classifySectorRotation('3M', { '1W': -0.5, '1M': -2.0, '3M': -4.0, '6M': -6.0 }),
    'LAGGING'
  );
  assert.equal(
    classifySectorRotation('1M', { '1W': 0.8, '1M': -1.2, '3M': null, '6M': null }),
    'IMPROVING'
  );
  assert.equal(
    classifySectorRotation('1W', { '1W': 0.9, '1M': -1.1, '3M': null, '6M': null }),
    'IMPROVING'
  );
  assert.equal(
    classifySectorRotation('3M', { '1W': 1.0, '1M': null, '3M': 2.0, '6M': 3.0 }),
    'INSUFFICIENT_DATA'
  );
});

test('SIC-to-GICS mapping, Communication Services overrides, and broad ETF exclusions work accurately', () => {
  assert.equal(mapSicToGicsSector('7372', 'MICROSOFT CORP'), 'TECHNOLOGY');
  assert.equal(mapSicToGicsSector('3674', 'NVIDIA CORP'), 'TECHNOLOGY');
  assert.equal(mapSicToGicsSector('6021', 'JPMORGAN CHASE & CO'), 'FINANCIALS');
  assert.equal(mapSicToGicsSector('6324', 'UNITEDHEALTH GROUP INC'), 'HEALTHCARE');
  assert.equal(mapSicToGicsSector('6798', 'PROLOGIS INC'), 'REAL_ESTATE');
  assert.equal(mapSicToGicsSector('1311', 'EXXON MOBIL CORP'), 'ENERGY');
  assert.equal(mapSicToGicsSector('4911', 'NEXTERA ENERGY INC'), 'UTILITIES');

  // Communication Services overrides for tech-era SIC codes
  assert.equal(mapSicToGicsSector('7370', 'ALPHABET INC'), 'COMMUNICATION_SERVICES');
  assert.equal(mapSicToGicsSector('7370', 'META PLATFORMS INC'), 'COMMUNICATION_SERVICES');

  // Investment offices / funds / SPACs return null (Unclassified)
  assert.equal(mapSicToGicsSector('6722', 'SPDR S&P 500 ETF TRUST'), null);
  assert.equal(mapSicToGicsSector('6726', 'ISHARES CORE S&P 500 ETF'), null);
  assert.equal(mapSicToGicsSector('6770', 'EXAMPLE ACQUISITION CORP'), null);

  // Broad-market ETF detection vs single-sector SPDR ETF matching
  assert.equal(isBroadMarketOrMultiSectorFund('STATE STR SPDR S&P 500 ETF T', 'TR UNIT'), true);
  assert.equal(isBroadMarketOrMultiSectorFund('INVESCO QQQ TRUST', 'ETF'), true);
  assert.equal(matchDirectSectorEtf('TECHNOLOGY SELECT SECTOR SPDR FUND'), 'TECHNOLOGY');
  assert.equal(isBroadMarketOrMultiSectorFund('TECHNOLOGY SELECT SECTOR SPDR FUND'), false);

  // Yahoo Finance sector mapping
  assert.equal(mapMarketSectorToGicsSector('Consumer Cyclical'), 'CONSUMER_DISCRETIONARY');
  assert.equal(mapMarketSectorToGicsSector('Consumer Defensive'), 'CONSUMER_STAPLES');
  assert.equal(mapMarketSectorToGicsSector('Financial Services'), 'FINANCIALS');
  assert.equal(mapMarketSectorToGicsSector('Basic Materials'), 'MATERIALS');

  assert.equal(normalizeCompanyMatchKey('Alphabet Inc. Class A'), 'ALPHABET');
});

test('aggregateInstitutionalBySector prevents double-counting managers and excludes unclassified funds', () => {
  const accumulation: InstitutionalAccumulationRow[] = [
    {
      cusip: '037833100',
      ticker: 'AAPL',
      issuerName: 'APPLE INC',
      titleOfClass: 'COM',
      institutionsIncreasing: 2,
      institutionsDecreasing: 0,
      newPositions: 0,
      exitedPositions: 0,
      unchangedPositions: 0,
      totalInstitutions: 2,
      netShareChange: 1500,
      priorTotalShares: 10000,
      currentTotalShares: 11500,
      netPercentChange: 15,
      totalValueUsd: 2_000_000,
      reportingPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      isAccumulating: true,
    },
    {
      cusip: '594918104',
      ticker: 'MSFT',
      issuerName: 'MICROSOFT CORP',
      titleOfClass: 'COM',
      institutionsIncreasing: 1,
      institutionsDecreasing: 1,
      newPositions: 0,
      exitedPositions: 0,
      unchangedPositions: 0,
      totalInstitutions: 2,
      netShareChange: 500,
      priorTotalShares: 5000,
      currentTotalShares: 5500,
      netPercentChange: 10,
      totalValueUsd: 1_500_000,
      reportingPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      isAccumulating: false,
    },
    // Duplicate CUSIP should be ignored defensively
    {
      cusip: '594918104',
      ticker: 'MSFT',
      issuerName: 'MICROSOFT CORP',
      titleOfClass: 'COM',
      institutionsIncreasing: 1,
      institutionsDecreasing: 1,
      newPositions: 0,
      exitedPositions: 0,
      unchangedPositions: 0,
      totalInstitutions: 2,
      netShareChange: 500,
      priorTotalShares: 5000,
      currentTotalShares: 5500,
      netPercentChange: 10,
      totalValueUsd: 1_500_000,
      reportingPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      isAccumulating: false,
    },
    // Broad ETF should stay Unclassified and not distort Financials or Technology
    {
      cusip: '78462F103',
      ticker: 'SPY',
      issuerName: 'SPDR S&P 500 ETF TRUST',
      titleOfClass: 'TR UNIT',
      institutionsIncreasing: 3,
      institutionsDecreasing: 0,
      newPositions: 1,
      exitedPositions: 0,
      unchangedPositions: 0,
      totalInstitutions: 4,
      netShareChange: 9000,
      priorTotalShares: 10000,
      currentTotalShares: 19000,
      netPercentChange: 90,
      totalValueUsd: 10_000_000,
      reportingPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      isAccumulating: true,
    },
  ];

  // Manager A increased BOTH AAPL (+1000) and MSFT (+800) => must count as 1 increasing manager in TECHNOLOGY, NOT 2
  // Manager B increased AAPL (+500) and decreased MSFT (-300) => net +200 => 1 increasing manager in TECHNOLOGY
  const changes: InstitutionalPositionChangeRow[] = [
    {
      id: 'm1-aapl',
      category: 'INCREASED',
      managerCik: '0000000001',
      managerName: 'MANAGER ALPHA',
      cusip: '037833100',
      ticker: 'AAPL',
      issuerName: 'APPLE INC',
      previousShares: 5000,
      currentShares: 6000,
      shareChange: 1000,
      percentChange: 20,
      previousValueUsd: 900_000,
      currentValueUsd: 1_100_000,
      currentPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      filingDate: '2026-11-14',
      sourceUrl: null,
    },
    {
      id: 'm1-msft',
      category: 'INCREASED',
      managerCik: '0000000001',
      managerName: 'MANAGER ALPHA',
      cusip: '594918104',
      ticker: 'MSFT',
      issuerName: 'MICROSOFT CORP',
      previousShares: 2000,
      currentShares: 2800,
      shareChange: 800,
      percentChange: 40,
      previousValueUsd: 700_000,
      currentValueUsd: 1_000_000,
      currentPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      filingDate: '2026-11-14',
      sourceUrl: null,
    },
    {
      id: 'm2-aapl',
      category: 'INCREASED',
      managerCik: '0000000002',
      managerName: 'MANAGER BETA',
      cusip: '037833100',
      ticker: 'AAPL',
      issuerName: 'APPLE INC',
      previousShares: 5000,
      currentShares: 5500,
      shareChange: 500,
      percentChange: 10,
      previousValueUsd: 800_000,
      currentValueUsd: 900_000,
      currentPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      filingDate: '2026-11-14',
      sourceUrl: null,
    },
    {
      id: 'm2-msft',
      category: 'DECREASED',
      managerCik: '0000000002',
      managerName: 'MANAGER BETA',
      cusip: '594918104',
      ticker: 'MSFT',
      issuerName: 'MICROSOFT CORP',
      previousShares: 3000,
      currentShares: 2700,
      shareChange: -300,
      percentChange: -10,
      previousValueUsd: 600_000,
      currentValueUsd: 500_000,
      currentPeriod: '2026-09-30',
      previousPeriod: '2026-06-30',
      filingDate: '2026-11-14',
      sourceUrl: null,
    },
  ];

  const classificationByCusip = new Map<string, ClassifiedSecurityMeta>([
    ['037833100', { sectorId: 'TECHNOLOGY', method: '3SPREAD_SIC', sic: '3571', ticker: 'AAPL' }],
    ['594918104', { sectorId: 'TECHNOLOGY', method: '3SPREAD_SIC', sic: '7372', ticker: 'MSFT' }],
    ['78462F103', { sectorId: null, method: 'UNCLASSIFIED_FUND', ticker: 'SPY' }],
  ]);

  const { bySector, coverage } = aggregateInstitutionalBySector({
    accumulation,
    changes,
    classificationByCusip,
    reportingPeriod: '2026-09-30',
    previousPeriod: '2026-06-30',
    comparableManagersTotal: 2,
    available: true,
  });

  const tech = bySector.TECHNOLOGY;
  assert.equal(tech.classifiedSecuritiesCount, 2);
  assert.equal(tech.activeManagersCount, 2); // distinct managers, never double-counted
  assert.equal(tech.managersIncreasing, 2);
  assert.equal(tech.managersDecreasing, 0);
  assert.equal(tech.netShareChange, 2000);
  assert.equal(tech.aggregateValueUsd, 3_500_000);
  assert.equal(tech.trend, 'ACCUMULATING');

  // Financials must remain unaffected by SPY ETF
  assert.equal(bySector.FINANCIALS.classifiedSecuritiesCount, 0);
  assert.equal(bySector.FINANCIALS.aggregateValueUsd, 0);

  // Coverage transparently tracks classified vs unclassified broad ETF
  assert.equal(coverage.totalSecuritiesInCohort, 3);
  assert.equal(coverage.classifiedSecuritiesCount, 2);
  assert.equal(coverage.unclassifiedSecuritiesCount, 1);
  assert.equal(coverage.unclassifiedFundOrEtfCount, 1);
  assert.equal(coverage.classifiedValueUsd, 3_500_000);
  assert.equal(coverage.unclassifiedValueUsd, 10_000_000);
});

test('classifyInsiderSentiment enforces minimum transaction threshold and transparent ratio cutoffs', () => {
  assert.equal(classifyInsiderSentiment({ buySellRatio: 0.65, buysCount: 1, sellsCount: 1 }), 'UNAVAILABLE');
  assert.equal(classifyInsiderSentiment({ buySellRatio: null, buysCount: 5, sellsCount: 5 }), 'UNAVAILABLE');
  assert.equal(classifyInsiderSentiment({ buySellRatio: 0.45, buysCount: 4, sellsCount: 2 }), 'NET_BUYING');
  assert.equal(classifyInsiderSentiment({ buySellRatio: 0.25, buysCount: 2, sellsCount: 4 }), 'BALANCED');
  assert.equal(classifyInsiderSentiment({ buySellRatio: 0.08, buysCount: 1, sellsCount: 10 }), 'NET_SELLING');
});

test('finalizeMarketRankingsAndOverview computes exact RS rankings and period overview', () => {
  const spyBars = makeDailyBars('2026-01-02', '2026-10-30', 100, 110); // +10%
  const benchReturns = {
    '1W': computePeriodReturn(spyBars, '1W'),
    '1M': computePeriodReturn(spyBars, '1M'),
    '3M': computePeriodReturn(spyBars, '3M'),
    '6M': computePeriodReturn(spyBars, '6M'),
  } as Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;

  const techDef = GICS_SECTORS[0];
  const utilDef = GICS_SECTORS[8];

  const techBars = makeDailyBars('2026-01-02', '2026-10-30', 100, 125); // +25% (outperforms SPY)
  const utilBars = makeDailyBars('2026-01-02', '2026-10-30', 100, 95); // -5% (underperforms SPY)

  const dummyInst = aggregateInstitutionalBySector({
    accumulation: [],
    changes: [],
    classificationByCusip: new Map(),
    reportingPeriod: null,
    previousPeriod: null,
    comparableManagersTotal: 0,
    available: false,
  }).bySector;

  const dummyInsider = {
    available: false,
    windowDays: 90,
    since: null,
    until: null,
    buysDollars: null,
    sellsDollars: null,
    buysCount: null,
    sellsCount: null,
    buySellRatio: null,
    sicCodesQueried: [],
    sicCodesWithActivity: 0,
    sentiment: 'UNAVAILABLE' as const,
    unavailableReason: null,
  };

  const items: SectorRotationItem[] = [
    {
      id: techDef.id,
      name: techDef.name,
      shortName: techDef.shortName,
      etfTicker: techDef.etfTicker,
      etfName: techDef.etfName,
      market: buildSectorMarketPerformance({ sector: techDef, bars: techBars, benchmarkReturns: benchReturns }),
      institutional: dummyInst[techDef.id],
      insider: dummyInsider,
    },
    {
      id: utilDef.id,
      name: utilDef.name,
      shortName: utilDef.shortName,
      etfTicker: utilDef.etfTicker,
      etfName: utilDef.etfName,
      market: buildSectorMarketPerformance({ sector: utilDef, bars: utilBars, benchmarkReturns: benchReturns }),
      institutional: dummyInst[utilDef.id],
      insider: dummyInsider,
    },
  ];

  const overview = finalizeMarketRankingsAndOverview(items);
  assert.equal(items[0].market.relativeStrengthRank['3M'], 1);
  assert.equal(items[1].market.relativeStrengthRank['3M'], 2);
  assert.equal(overview['3M'].strongestSector?.id, 'TECHNOLOGY');
  assert.equal(overview['3M'].weakestSector?.id, 'UTILITIES');
  assert.equal(overview['3M'].outperformingCount, 1);
  assert.equal(overview['3M'].underperformingCount, 1);
});

test('InstitutionalActivityScreen renders SECTOR ROTATION as 5th tab immediately right of POSITION CHANGES', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: InstitutionalActivityScreen } = await import(
    '../src/components/InstitutionalActivityScreen'
  );

  const html = renderToStaticMarkup(
    React.createElement(InstitutionalActivityScreen, {
      selectedTicker: 'AAPL',
      stocks: {},
    })
  );

  const labels = [
    '<span>INSTITUTIONAL HOLDINGS</span>',
    '<span>ACCUMULATION SCREENER</span>',
    '<span>INVESTOR PROFILES</span>',
    '<span>POSITION CHANGES</span>',
    '<span>SECTOR ROTATION</span>',
  ];
  const indices = labels.map((label) => html.indexOf(label));
  for (let i = 0; i < labels.length; i++) {
    assert.ok(indices[i] >= 0, `Expected tab "${labels[i]}" to render`);
    if (i > 0) {
      assert.ok(
        indices[i] > indices[i - 1],
        `Expected tab "${labels[i]}" to appear after "${labels[i - 1]}"`
      );
    }
  }
});

test('SectorRotationPanel renders updated insider tx format, 11 interactive ETF buttons, and clean matrix heading', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: SectorRotationPanel } = await import('../src/components/SectorRotationPanel');

  const spyBars = makeDailyBars('2026-01-02', '2026-10-30', 100, 110);
  const benchReturns = {
    '1W': computePeriodReturn(spyBars, '1W'),
    '1M': computePeriodReturn(spyBars, '1M'),
    '3M': computePeriodReturn(spyBars, '3M'),
    '6M': computePeriodReturn(spyBars, '6M'),
  } as Record<SectorPerformancePeriod, SectorPeriodReturnPoint>;

  const dummyInst = aggregateInstitutionalBySector({
    accumulation: [],
    changes: [],
    classificationByCusip: new Map(),
    reportingPeriod: '2026-09-30',
    previousPeriod: '2026-06-30',
    comparableManagersTotal: 14,
    available: true,
  }).bySector;

  const sectors: SectorRotationItem[] = GICS_SECTORS.map((def, i) => ({
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    etfTicker: def.etfTicker,
    etfName: def.etfName,
    market: buildSectorMarketPerformance({
      sector: def,
      bars: makeDailyBars('2026-01-02', '2026-10-30', 100, 105 + i),
      benchmarkReturns: benchReturns,
    }),
    institutional: dummyInst[def.id],
    insider: {
      available: true,
      windowDays: 30,
      since: '2026-10-01',
      until: '2026-10-30',
      buysDollars: 850_000,
      sellsDollars: 150_000,
      buysCount: 50,
      sellsCount: 25,
      buySellRatio: 0.85,
      sicCodesQueried: [...def.representativeSics],
      sicCodesWithActivity: def.representativeSics.length,
      sentiment: 'NET_BUYING',
      unavailableReason: null,
    },
  }));

  const overviewByPeriod = finalizeMarketRankingsAndOverview(sectors);

  const html = renderToStaticMarkup(
    React.createElement(SectorRotationPanel, {
      data: {
        success: true,
        fetchedAt: '2026-11-21T00:00:00Z',
        benchmark: {
          ticker: 'SPY',
          name: 'SPDR S&P 500 ETF Trust',
          latestPrice: 110,
          latestDate: '2026-10-30',
          returns: benchReturns,
          history: spyBars,
          unavailableReason: null,
        },
        overviewByPeriod,
        sectors,
        institutionalMeta: {
          available: true,
          requiresKey: false,
          rateLimited: false,
          error: null,
          reportingPeriod: '2026-09-30',
          previousPeriod: '2026-06-30',
          availablePeriods: ['2026-09-30'],
          managersAnalyzed: 14,
          freshness: null,
          coverage: {
            totalSecuritiesInCohort: 0,
            classifiedSecuritiesCount: 0,
            unclassifiedSecuritiesCount: 0,
            unclassifiedFundOrEtfCount: 0,
            unclassifiedUnknownCount: 0,
            classifiedValueUsd: 0,
            unclassifiedValueUsd: 0,
            classifiedValuePct: null,
            threeSpreadSicMatchedCount: 0,
            marketSectorMatchedCount: 0,
            directSectorEtfMatchedCount: 0,
          },
        },
        insiderMeta: {
          available: true,
          windowDays: 30,
          since: '2026-10-01',
          until: '2026-10-30',
          note: '',
        },
        methodology: {
          marketPerformance: '',
          rotationClassification: '',
          institutionalPositioning: '',
          insiderSentiment: '',
        },
      },
      loading: false,
      error: null,
      windowDays: 30,
      onWindowDaysChange: () => {},
      onRefresh: () => {},
      onInspectSecurity: () => {},
      onInspectInvestor: () => {},
      onSelectEtfTicker: () => {},
    })
  );

  // 1. Heading cleaned (instructional copy removed)
  assert.ok(html.includes('US EQUITY SECTOR ROTATION MATRIX'));
  assert.equal(html.includes('CLICK ANY ROW FOR DETAIL'), false);

// 1b. Table header row exists and does not use the old sub-12px text
  const headerRow = html.match(/<tr class="[^"]*uppercase[^"]*">/)?.[0] ?? '';
  assert.ok(headerRow.length > 0, 'Expected an uppercase table header row');
  assert.equal(headerRow.includes('text-[10px]'), false, 'Header row must not use sub-12px text');
  
  for (const headerLabel of ['INSTITUTIONAL (13F)', 'INSIDER (30D)', 'ROTATION STATUS']) {
    assert.ok(html.includes(`<span>${headerLabel}</span>`), `Expected full header "${headerLabel}"`);
  }

  // 2. Insider format uses "85% buy (75 tx)" with whitespace-nowrap and does not expand tx -> transactions
  assert.ok(html.includes('85% buy (75 tx)'));
  assert.equal(html.includes('buy $ •'), false);
  assert.equal(html.includes('75 transactions'), false);

  // 3. All 11 sector ETF tickers render as interactive buttons targeting Graph Price
  for (const def of GICS_SECTORS) {
    assert.ok(
      html.includes(`aria-label="Open ${def.etfTicker} in Graph Price"`),
      `Expected interactive button for ETF ${def.etfTicker}`
    );
  }
});
